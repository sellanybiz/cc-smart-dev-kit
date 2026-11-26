# Slop homes: the audit's seven copies go to their one home (6.7.1)

**Summary.** The slop audit of 2026-11-26 (`.claude/audits/2026-11-26-slop-homes.md`) confirmed seven
places in `src/tasks`, `src/herdr`, `src/workflow` and `src/project` that copy a shared home or go
around it. Three already behave differently from the home. This patch moves each one onto its home,
adds a guard where one is cheap, and ships as 6.7.1.

Approved by the owner on 2026-11-26 ("Fix all 7 as 6.7.1"). Base: main at 0882d5db.

## Goal

Each finding's code calls its one home, so a later change to that home reaches every caller. The
three drifted copies behave like the home afterwards:

- a workflow.json with a byte order mark reads;
- `gh pr create` runs through `runGh`;
- a `..name` folder counts as inside the checkout.

No user-facing behaviour changes beyond those three.

## Decisions

- **Play safe vs new:** neither applies. No stored value, flag or output shape changes. Each fix is
  a call moved onto its home.
- **`commitArgs` gets `--end-of-options`** (finding 3). Then a name that starts with `-` can never
  reach git as an option, for every caller. The per-copy `startsWith("-")` guards in
  `stack-proof.ts` and `issues/fixed.ts` are then deleted. `refCommit` (`deploy/branch.ts:25`)
  keeps its own spelling: it leaves out `--quiet` on purpose, so git's error reaches
  `unreadableRefMessage`.
- **propose keeps its timeout safety** (finding 2). `createPullRequest` on `runGh` counts every
  signal (`code === null` with kind `timeout` or `failed` from a signal) as `timedOut`. The pushed
  branch is then kept, because the pull request may exist.
- **One scan test for task tool names** (finding 4). It fails on a bare `task_<op>` string in
  the `src/herdr` and `src/tasks` modules. It reads `TASK_TOOL`'s values, never a typed list.

## Phases (one wave, disjoint files)

| Phase | Findings | Files |
|---|---|---|
| `gh` | 1, 2 | `src/workflow/resolve.ts`, `src/workflow/propose.ts`, `src/workflow/merge-check.ts`, `src/cli/project-init.ts`, `docs/design/issues.md`, their tests |
| `git` | 3, 5, 6 | `src/hooks/git.ts`, `src/tasks/stack-proof.ts`, `src/tasks/plan-guards.ts`, `src/tasks/deploy/branch.ts`, `src/tasks/deploy/check.ts`, `src/tasks/deploy/files.ts`, `src/issues/fixed.ts`, `src/project/deploy-skill.ts`, `src/path-compare.ts` (only if the throwing helper lives there), their tests |
| `names` | 4, 7 | `src/herdr/plans.ts`, `src/herdr/brief.ts`, `src/herdr/command.ts`, `src/tasks/ops.ts`, `src/tasks/mcp.ts`, `src/tasks/work/store.ts`, `src/tasks/schemas.ts`, a new `src/tasks/words.test.ts` scan (or the existing one), their tests |

The lead does the release files: the version in `plugin/.claude-plugin/plugin.json`,
`install.sh` and `install.ps1`, the `CHANGELOG.md` entry, `plugin/dist`, and this plan's archive.

## Edge cases

- **Finding 1, BOM:** `parseUserJson` skips the BOM. A broken file still throws
  `WorkflowConfigError` with the same text. The hook cache's parse (`config-check.ts`) goes
  through the same function, so the hook reads what `workflow show` reads.
- **Finding 2, gh:** a missing gh (`kind: missing`) becomes a `why` that names gh, not a raw
  spawn error. A non-zero exit keeps `lastLine(err)` as the reason. `project-init`'s copy gains
  `windowsHide` through `runGh`. Its sync twin stays only if no async caller can take it; the
  builder says which.
- **Finding 3, `--end-of-options`:** git has had it since 2.24. The kit's floor
  (`MIN_COVER_GIT`, 2.40) is above that. Every `commitArgs` caller is re-run in tests.
- **Finding 5, paths:** `..config` is inside, `../x` is outside, and the same folder is inside, on
  POSIX and on Windows separators (`path-compare`'s own tests cover the home). The three deploy
  copies keep the message "Task folder must be inside the checkout".
- **Finding 6:** the blob keeps its exact whitespace (`runGitRaw` does not trim). A timeout now says
  "timed out", not an empty stderr.
- **Finding 4:** the brief, the fix lines and the refusal texts print the same words as before.
  The test proves it against today's text.
- **Finding 7:** `leftBehind` keeps its order: the worktree's own HEAD first, then `branchTip`.

## What could break

`commitArgs` callers (files-check, workflow, review-record, review-cover, herdr plans), every
`runGh` caller (merge-check, issues, propose), and `isInside`'s callers. Each builder runs the
tests of every caller it touches.

## Simpler?

Leave the four copies that still behave the same. Rejected by the owner: the audit's point is that
copies drift, and three already did.

## Rollback

Revert the merge commit. No data, config or output shape changes.

## How we prove it

- For each drifted copy, a test that fails on the old code: a BOM workflow.json reads; propose
  on a gh killed by a signal keeps the branch; `..config/claude/skills` is searched.
- The scan test for bare tool names fails when one is added back.
- `bun run check`, both validates, `build:check`, and `plugin/dist/router.js` unchanged.
- Review: this is not risky (no security, money or schema), and the fixes are mechanical.
  `/cc-smart-dev-kit:build` § 6's two review rounds run as review-split at the normal tier, then a
  final review if the round-2 fixes pass `fixesAfterReview`.

## Homes

Reused: `parseUserJson` (`src/setup/user-json.ts`), `runGh` (`src/workflow/merge-check.ts`),
`commitArgs`/`commitIn` and `runGitRaw` (`src/hooks/git.ts`), `branchTip`
(`src/tasks/stack-proof.ts`), `isInside` (`src/path-compare.ts`), `TASK_TOOL`
(`src/tasks/words.ts`). New: one throwing "task folder inside the checkout" helper built on
`isInside`, at the place the `git` builder names. Deleted: the private `isInside` in
`deploy-skill.ts`, `createPullRequest`'s spawn, project-init's `runGh` copy, the hand-written
commit lookups, the `git show` spawn in `deploy/branch.ts`, and `leftBehind`'s copy of
`branchTip`.
