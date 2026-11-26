# Plan: field fixes from project sessions (kit 6.7.0)

**Summary.** Fix four problems that sessions in a real project hit (kit tasks #929, #930, #931, #934), plus one security hole in the review gate that the plan's edge-case pass found:
- `workflow propose` commits by git plumbing, so a project's hooks never run in a folder without its packages.
- An overlap refusal names generated files and prints the ready `propose` line.
- Every task write refuses up front when the project file is too new or broken.
- The review hook records a review run from a builder's worktree, and the review counts for the PR it was pushed as.
- The base's `linguist-generated` marks can no longer be widened by local attribute files.

Slug `field-fixes`, version 6.7.0 (minor), base `origin/main` 77c70174 (6.6.0 merged). Second reads folded in: the senior engineer's plan review and the edge-case hunter (2026-11-26), both `opus` at `xhigh`.

## Context

Root causes, traced in the code on origin/main (task descriptions #929/#930/#931/#934 hold the reports):

- **#929, propose cannot commit.**
  - `src/workflow/propose.ts` adds a worktree from `origin/<base>` (:507), writes the file there (:549), and runs `git add` and `git commit` (:562/:568).
  - The commit runs the project's pre-commit hook. A fresh worktree has no installed packages, so a hook such as lefthook from `node_modules/.bin` is not found. The commit fails, and propose takes everything back. `worktree add` also runs post-checkout.
  - Effect: a session cannot hand the person a `plans.*` change. `workflow set plans.*` refuses inside Claude Code by design.
- **#930, generated files block parallel plans.**
  - Every plan with a migration regenerates the same generated files. The overlap check (`filesOverlap`, `src/tasks/work/queries.ts:396`, via `planFilesCheck`, `src/tasks/files-check.ts:34`) leaves out only `plans.mergeFiles`.
  - That list is person-only by design (`PLAN_KEYS`; read as committed on `origin/<base>`).
  - With #929 broken, nobody but the person at a terminal can change it, and the refusal does not say how.
- **#931, `requires` enforced unevenly.**
  - `taskContext` catches every project-file error (`src/tasks/context.ts:144-149`) into `projectConfig`/`projectTasks`.
  - A plan created with no `files` reads nothing, so it passes.
  - `task_update` with `files` goes `readCheck` → `planFilesCheck` → `baseBranch` (`src/worktrees/command.ts:107`, `loadProjectConfig`, uncaught) and throws. Other paths throw (`phaseCap`, deploy helpers) or degrade quietly (`task_list`).
  - herdr's `reservePlan` writes the store directly (`src/herdr/plans.ts:834`), not through `ops.run`.
- **#934, review not recorded.**
  - `src/hooks/review-record.ts:152` returns silently at start and stop when `inSubagentWorktree(cwd)`. That check was meant for a reviewer in its own isolated worktree, but it matches by folder shape (`.claude/worktrees/agent-<hex>`). It therefore also fires when the session's own folder is a builder's worktree.
  - This fits the report (no record, no pending start) but is not reproduced live yet: a brief the hook rejects also leaves no start (`:183` takes it before `:185`). The build reproduces it first.
  - Second, real: earlier-commit candidates match by branch name (`src/workflow/review-cover.ts:281-287`). The record holds the local name (`worktree-agent-…`), so fix commits after a review never count for a PR pushed under another name.
- **Found by the plan's edge-case pass (security, pre-existing).** `generatedOf` (`review-cover.ts:392`) runs `git check-attr --source=<base>`. But `$GIT_DIR/info/attributes` (highest precedence, gitattributes(5)) and `core.attributesFile` still apply. A session can therefore mark every file generated without a commit, and `tally` (`:417-429`) then counts a change after a review as zero lines. merge-check would say covered. Fixing it is in scope: the plan moves this reader into a shared home and the review phase owns `review-cover.ts`. Taken by the away rule (Decision log).

## Research

- **Plumbing commit:** `git hash-object -w --stdin`, then `git mktree` for the `.claude` tree and the root tree (no index, so no `post-index-change`), then `git commit-tree <tree> -p <baseSha> [-S] -m <msg>`.
  - `commit-tree` ignores `commit.gpgSign` (git 2.10.1 release notes), so propose reads `git config --type=bool commit.gpgSign` and passes `-S` itself.
  - Push with `git push --no-verify --force-with-lease=refs/heads/<branch>: origin <sha>:refs/heads/<branch>`. An empty lease value means the branch must not exist yet (git-push(1)), which replaces worktree add's name check.
  - The builder confirms each command against the current git docs.
- **Attributes from the base only:** run `check-attr --source=<sha>` with a git environment that has no local attribute sources: `GIT_ATTR_NOSYSTEM=1`, `-c core.attributesFile=` (empty), and an `info/attributes` that is not the repository's own. For the last one, a throwaway `GIT_DIR` that borrows the real objects (alternates), the way review-cover already isolates its object writes.
  - The builder proves each source is ignored in a test before relying on it.
  - git ≥ 2.40 for `--source`; on older git the set is empty, which is the safe side.
- **The PR's own line of work:** `git for-each-ref --contains <head> --format=%(refname:short) refs/heads/` lists the local branches whose tip holds the PR head. A builder branch pushed under another name is one of them; a squash-merged parent's branch is not.
- **Contract:** an isolated subagent's hook `cwd` is inside its worktree, and its `agent_id` is that folder's hex (`docs/claude-code-contract.md`, near :222). The session's hook `cwd` follows it into a worktree entered with EnterWorktree (:63). Whether a Bash `cd` moves it is unproven: the live repro answers it, and the contract gets a row.

## Decisions

1. **#929, propose by plumbing, no worktree.**
   - The project-file writer gets a pure step that returns the next text and the `requires` floor. The disk write wraps it, so there is one writer.
   - Propose reads the text, mode and parent from one `baseSha`, builds the commit with `hash-object`/`mktree`/`commit-tree` (with `-S` when `commit.gpgSign` is on), and pushes with `--no-verify` and the empty lease. The take-back delete also uses `--no-verify`.
   - No checkout, so the person's working copy is never touched, and no project hook runs.
   - The output and the pull request body say: "made without the project's git hooks; the review and CI are its gate". A hook-added trailer (a sign-off) is missing, and the body says so.
   - `runGit` gets a stdin option (`src/hooks/git.ts`), not a second spawner.
   - **The `--json` shape changes:** `worktree` is dropped. The portal's `proposedLine`, its success line and its fake move with it (the fake is built from the real output type). So do `PROPOSE_WORST_CASE_MS` and the timeout line.
   - Rejected: installing packages in a temp worktree (stack-specific, slow), and `commit --no-verify` in a worktree (still a checkout, still post-checkout).
2. **#930, the person stays in the loop; the refusal does the work.**
   - The overlap check is unchanged. A `.gitattributes` mark never loosens it: that would bypass `plans.mergeFiles`, a person-only control.
   - When an overlap refusal (store, task_update, herdr) names paths the base marks `linguist-generated`, it says so. It prints the ready line `cc-smart-dev-kit workflow propose plans.mergeFiles "<current list>,<those paths>"`, which a session can now run (#929). The person merges that pull request.
   - The generated reader moves into one shared home, `src/project/generated.ts`. It holds the pure parts (the arguments, the isolated environment, batching, the `-z` parse, the attribute name and the values that count) and is used by review-cover, claims and the refusal. Each caller runs git its own way: review-cover asynchronously with its deadline, the refusal synchronously.
3. **Security: generated marks from the base only.**
   - The shared reader ignores `info/attributes`, `core.attributesFile` and the system file.
   - Tests write `* linguist-generated` into each local source and expect an empty set, and a large fix after a review must not be covered.
   - This closes the hole in today's review gate.
4. **#931, one up-front refusal for task writes.**
   - When `!ctx.projectConfig.ok`, every writing tool (create, update, done, note, take, delete) refuses before anything changes, before `reclaimResumed` too (`ops.ts:320`). The message is the project-file error.
   - For a too-new `requires`, it adds the fix: update the kit, or restart the session if the kit on disk is already new enough.
   - Reads (get, list, search) still work, with one line naming the problem. A project-scope list says plainly that deploy tasks were not read.
   - herdr's `reservePlan` and `herdr start` check the same gate before they reserve or launch.
   - `baseBranch` is unchanged (the second read showed the change is not needed, and it has 11 callers).
5. **#934, record from a builder worktree; count the PR's own line of work.**
   - (a) The worktree skip applies only when the folder's hex equals the agent's own id (both through `agentIdKey`): a reviewer in its own isolated worktree. A session standing in a builder's worktree records as usual.
   - (b) `readCover` adds a candidate when the record's `branches` holds a local branch whose tip contains the PR head (`for-each-ref --contains <head>`, one call). This covers a branch pushed under another name, with or without `-u`. A squash-merged parent's review does not count. The branch-name match stays.
   - (c) A covered candidate wins even when a later candidate times out (today any timeout throws the whole cover, `:473`). Candidates are tried newest first.
   - (d) For a listed reviewer whose run records nothing, the hook prints one stderr line with the reason through `said()`. The hook log is written only under `doctor --live`, so `logFacts` cannot carry it.
   - Dropped from the first draft: noting the upstream name (it usually names the base) and the PR-range match (it let one PR's review cover another).

Play safe vs new: play safe. Old behaviour stays where it was right: the branch-name match, `mergeFiles`, reads in a stale session, the isolated-reviewer skip, and `baseBranch`. There are no legacy paths to delete later. The one deliberate break is propose's `--json` (`worktree` dropped), with its one consumer (the portal) changed in the same plan.

## Files to change

- **propose:** `src/workflow/propose.ts` (+test), `src/workflow/write.ts` (+test), `src/hooks/git.ts` (+ its test: the stdin option), `src/portal/actions.ts` (+test).
- **gate:** `src/tasks/context.ts` (+test), `src/tasks/ops.ts`, a new `src/tasks/requires-gate.test.ts`, `src/herdr/plans.ts`, `src/herdr/command.ts` (+ the herdr plans tests).
- **review:** `src/hooks/review-record.ts` (+test), `src/workflow/review-cover.ts` (+test), new `src/project/generated.ts` (+test), `src/workflow/claims.ts` (import only).
- **refusal:** `src/tasks/work/store.ts`, `src/tasks/work/files.test.ts`, `src/tasks/files-check.ts` (+test). The herdr refusal text is in `src/herdr/plans.ts`, so this phase is blocked by gate.
- **docs:**
  - `README.md` (propose, `plans.mergeFiles`, the review and task-tool rows);
  - `docs/design/workflow.md` (propose, the review record);
  - `docs/design/portal.md` (the propose action);
  - `docs/design/tasks.md` (the gate, the refusal);
  - `docs/design/hooks.md` (review-record);
  - `docs/claude-code-contract.md` (the hook `cwd` after `cd` vs EnterWorktree, from the live repro);
  - `.claude/rules/cc-smart-dev-kit-json.md` (the `plans.mergeFiles` row: the refusal's propose line).
- **Lead (shared):** `plugin/.claude-plugin/plugin.json`, `install.sh`, `install.ps1`, `CHANGELOG.md`, `plugin/dist/`.

## Phases and waves

| Phase | Owns | Agent | Blocked by |
|---|---|---|---|
| `propose` — Propose: plumbing commit, no worktree, no project hook; the portal's shape (#929) | propose files | builder, sonnet high (opus high while Sonnet is limited) | — |
| `gate` — Gate: one up-front refusal for task writes and herdr (#931) | gate files | builder, sonnet high | — |
| `review` — Review: record from a builder worktree, the PR's own branches, base-only generated marks (#934 + security) | review files | builder, opus high (merge gating, security) | — |
| `refusal` — Refusal: name generated paths, print the ready propose line (#930) | refusal files | builder, sonnet high | `review` (uses `generated.ts`), `gate` (`herdr/plans.ts`) |
| `docs` — Docs: the pages for all of it | docs files | rules-maintainer, sonnet high | all four |

- Wave 1: propose, gate, review.
- Wave 2: refusal.
- Wave 3: docs.
- The lead: the live repro of #934 before the review phase starts (so its builder gets the facts), then the version, the CHANGELOG, the build and the full check.

## Edge cases

- **propose:**
  - The base has no project file: refused, as today.
  - A symlinked or non-JSON file: refused.
  - A value is already set: no-op.
  - A taken branch name: the empty lease refuses, and propose picks the next name.
  - The push is refused: taken back, with git's output.
  - The push is killed after the ref was updated: the take-back checks the remote ref before saying nothing was left.
  - `commit.gpgSign`: `-S`, or git's refusal named.
  - The file mode on base is kept.
  - The commit identity is missing: git's message.
  - CRLF and the trailing newline: the blob is byte for byte the writer's text (test on the blob).
  - A clean filter on `*.json` is bypassed (named in the body).
  - A shallow or partial clone: `mktree` needs only the two trees and the blob, which the fetch brings.
  - `GIT_DIR` or `GIT_INDEX_FILE` from a hook: stripped by `gitEnv`.
  - Windows: no shell, `/` paths.
- **refusal:**
  - Generated paths are named only when they cause the overlap.
  - A folder entry that holds a generated file still overlaps, and the line names the file.
  - git < 2.40 or no `.gitattributes`: no generated list, plain refusal.
  - A broad `*` mark on base: named as is. It loosens nothing, because the person decides.
  - The current `mergeFiles` list is kept in the printed line, comma-joined as `propose` takes it.
- **security:**
  - Each local attribute source is ignored (three tests).
  - A mark set only on the branch is ignored, as today.
  - The isolated environment is removed after the call.
- **gate:**
  - A broken project file: the same refusal path, its own message.
  - A loose task outside a project: no gate.
  - The `task` CLI and the portal's `task.take` share `ops.run`.
  - herdr refuses before reserving and before launching.
  - A stale MCP server with a new kit on disk: the message says restart.
- **review:**
  - An isolated reviewer nested in a builder worktree: the innermost `agent-<hex>` is its own, so it is skipped.
  - A builder branch pushed as a PR head under another name: covered within the limits.
  - A squash-merged parent's review: not a candidate (negative test).
  - A merged-in reviewed branch: its tip does not contain the head, so it is not a candidate.
  - A stale local `origin/<base>`: no effect, since no range is read.
  - The local branch was deleted after the push: name match only (said in the reason).
  - A timeout after a covering candidate: covered.
  - A detached HEAD: exact sha only.
  - The hook timeout: no extra git call at start.
- **Neutrality:** examples use `my-app`; no project names.

## What could break

- `writeProjectSetting` callers (`workflow set --project`, propose): the pure step keeps their output byte for byte.
- propose's `--json` consumers: the portal (`src/portal/actions.ts:896-920, 1096-1114`); nothing else reads it (the builder confirms).
- `readCover`/merge-check: the CLI and the portal's merge verdicts; `reviewsOn` has no production caller and is left alone.
- `generatedOf`'s callers: review-cover (the tally), claims' pathspec (it keeps its own `:(attr:…)` pathspec, but takes the attribute name from the home).
- `ops.run` callers: the MCP server, the `task` CLI, the portal's actions.
- herdr: start, plans and the reserve.
- The router bundle must not change (none of these files is in it; checked after the build).

## A simpler approach?

- #929: "run propose from a terminal" leaves sessions without the path the report asks for.
- #930: auto-skipping generated files was simpler, but it loosens a person-only control. The refusal with a ready line is nearly as fast for the person, and safe.
- #934(b): the PR-range match was simpler, but unsafe. `for-each-ref --contains` is one call, and safe.

## Rollback

Revert the merge; a 6.7.1 with the old behaviour if needed (never a lower version). No stored data changes shape: the review record, the starts file, the slop record and the task store are as before. The portal and propose move together, so a rollback moves both.

## How we prove it

- **First, the live repro of #934 (lead, before the review phase):**
  - a session in the main checkout enters a builder worktree (EnterWorktree, then separately a Bash `cd`);
  - it runs a `senior-engineer` `Mode: review`;
  - read `<stateDir>/reviews/<key>.json` and `.starts.json`.
  - Expected before the fix: no start and no record when the hook `cwd` is the agent worktree. If the hook `cwd` stays the main checkout after a `cd`, the cause is elsewhere: the review phase's brief changes before it starts.
- **Tests that fail first:**
  - propose: a project pre-commit hook that always fails, and a pre-push hook that always fails, are both bypassed, and the proposal lands; `commit.gpgSign=true` gives `-S`; a taken name is refused by the lease; the portal parses the real `--json` shape.
  - refusal: a base-marked generated file in an overlap is named with the ready propose line, in both orders and for herdr.
  - security: `info/attributes`, `core.attributesFile` and a branch-only mark each give an empty set; a 500-line fix after a review is not covered.
  - gate: `task_update` with `files` and a too-new `requires` gives the same refusal as `task_create`; a broken file too; `task_list` still lists and names the problem; herdr refuses before reserving.
  - review:
    - the session cwd in an agent worktree with another agent id records;
    - the same hex skips with a stderr line;
    - a record on `worktree-agent-x` covers PR head `fix/y` when that local branch contains the head;
    - a squash-merged parent does not cover;
    - a timeout after a covering candidate stays covered.
- **The full `bun run check`, both validates, `plugin/dist` rebuilt, `router.js` unchanged.**
- **Reviews (approved with this plan):** `/cc-smart-dev-kit:build` § 6, two review-split rounds, risky (the merge gate, the review record, a security fix), then a final review if round 2's fixes are big.
- **Live after the build:**
  - the #934 repro again (records now);
  - `workflow propose plans.mergeFiles …` in a scratch repo with a failing lefthook-style pre-commit hook;
  - in the real project only with the person's yes, since it opens a pull request.

## Homes

- **Reused:** `runGit` (plus a stdin option), `gitEnv`, `readCommittedConfig`, the project-file writer (split, not copied), `agentIdKey`, `subagentWorktreeByShape`, `said`, `settledBy`, `taskContext`.
- **New shared homes:**
  - `src/project/generated.ts` (from review-cover's private `generatedOf`, plus the attribute name claims uses);
  - the pure next-text step in `src/workflow/write.ts`.
- **Deleted copies:** `generatedOf` in review-cover.ts (moved), claims' own spelling of the attribute name, propose's worktree, add and commit path.
- **Out of scope:**
  - task #854(2), `subagent-worktree.ts` knowing only the default folder shape. Named here and not folded in: the #934 fix keys on the agent id, which does not depend on it.
