# One strict review per plan, in two rounds

**Summary**
- **What changes:** a plan build drops the per-phase reviews. Each plan gets one review, run as the `review-split` workflow in two rounds: round 1, fixes, round 2 (a fresh workflow run over round 1's report and the fixes), fixes, then the pull request.
- **What else changes:** the lead checks each phase's hand-back quickly, without a reviewer. The workflow gains a spec track and a round-2 mode. A review that ran background commands is recorded again.
- **How it ships:** in the same 5.6.0 release as job limits (owner, 2026-11-20).

## Context

- **What the kit does today:** a fresh review for every phase (`/cc-smart-dev-kit:build` § 3). Fix rounds each get a scoped re-review (§ 4, up to three). Then one final review of the whole branch (§ 6).
- **The cost:** in the job-limits plan that was about eight review runs.
- **The owner's words:** this "makes clashback and work slow". They want what most teams do for a pull request: one good, strict, precise and honest review per plan, in two rounds.

**The owner's decisions (2026-11-20):**
1. **One review per plan, two rounds:** round 1 → fixes → round 2 → fixes. Round 2 is the last review; nothing reviews its fixes.
2. **Always the `review-split` workflow,** in both rounds. Round 2 is the workflow again, fed round 1's report. A workflow run cannot be resumed as one agent, so this replaces "the same agent resumed".
3. **After round 2:** fixes larger than the merge guard's allowance (`fixesAfterReview`: 200 lines, 10 files or 20% by default) need no third round. The merge guard asks the owner at merge, as today: it asks, never denies.
4. **At each phase's hand-back:** the lead does a quick check (the report against the branch: diff, file list, tests run). Obvious gaps go back to the builder. No reviewer, no extra agent.
5. **One release:** this ships in 5.6.0 with job limits, as one pull request.

**Facts from the code** (traced 2026-11-20, file:line in the trace):
- **No code gates on per-phase review.** It lives only in instructions. The merge guard checks once, at `gh pr merge` (`merge-check.ts:584`, `review-cover.ts:270`). A head counts as reviewed when it is a recorded review's commit, or within `fixesAfterReview` of one on the same branch.
- **A review is recorded** when a `reviewAgents` subagent stops and every prompt it got carries the `Mode: review` line (`review-record.ts:82-96`). The record holds the head of the agent's **cwd** at start (`:170-176`, `:193`).
- **`review-split`'s track reviewers record a review** (type senior-engineer, `Mode: review`, `Agent` disallowed). Its refuters record nothing (`review-split.js:118-143`).
- **Found while planning:** the job-limits final review, and its resumed round 2, recorded **nothing**.
  - The starts file was emptied at 23:15 UTC, when it stopped, but the record file was last written at 22:38 UTC.
  - Likely cause: notices from the reviewer's own background commands. The record counts a task notification as a later prompt without the marker (header `review-record.ts:36-46`). Not confirmed: the plan proves it first.
  - It matters here: a workflow track that runs a background `bun test` would also leave no record, and then the merge guard would not count the plan review.

## Approach

### 1. The workflow: `plugin/workflows/review-split.js`

Two new optional args, both checked like the rest (the `CHECKS` table):

- **`spec`** (string): the plan file's path. When it is set, one more track is added: **spec compliance**.
  - It reads the plan's Decisions and Edge cases, and every task's done-check and closing evidence (`task_get`; the reviewers are read-only).
  - It says for each one: met, or failed with file:line.
  - A step done only in name fails the spec.
- **`prior`** (string): round 1's whole report. It makes this run round 2. Every track's prompt then says:
  - check that each listed finding is really fixed, at its file:line;
  - check that the fixes broke nothing around them;
  - report what round 1 missed in the change set, at the same evidence bar.
  The report then has a "Round 1 findings" section: fixed, not fixed, or made worse, each with evidence.

**The tier:** the plan review is the last check, so the build skill always passes `risky: true`. That means every agent in a round is the `cc-smart-dev-kit:senior-engineer` agent, read-only (no Edit, Write or Agent), on `opus` at `xhigh`:
- the track reviewers: 2 to 4 tracks, plus the spec track;
- the refuters: one per finding, up to the budget.
No new model rule is needed. The order is always round 1 → fixes → round 2 → fixes → full check → PR.

**Kept as they are:** `pipeline`, the dedupe, the budget, unchecked findings and hunches. Build the prompt from one template plus the round-2 lines, so `check:duplicates` passes.

### 2. The record: `src/hooks/review-record.ts` and `src/hooks/transcript.ts`

1. **A failing test first:** a reviewer whose transcript holds a task-notification for its **own** background Bash command (a `bun test` it ran) records no review today.
2. **Prove it on the real transcript** of the job-limits final review, read-only.
3. **Fix the cause.**
   - A notice for the agent's own background task is not a prompt from the coordinator, so it counts as harmless. It is treated like the StructuredOutput nudge that `transcript.ts` already treats as harmless.
   - A coordinator message, a queued command or Stop-hook feedback still needs the marker.
4. **If the cause is something else,** fix that cause instead, and note a `Ruling:`.
5. **Update the contract row** in `docs/claude-code-contract.md` for the notice's shape, proved live.

### 3. The instructions and docs (one home: the build skill)

**`plugin/skills/build/SKILL.md`, rewritten:**
- **§ 3, "Handle each hand-back":**
  - the lead's quick check: report vs branch, `base..branch` diff and file list, the tests it ran;
  - send gaps back to the same builder;
  - merge;
  - no reviewer and no `Mode: review`.
- **§ 4, fix rounds with the builder:** only for a hand-back gap, a stuck builder or a review finding. Escalation stays: the consult, then a stronger builder.
- **§ 6, "Review the plan":**
  1. the archive commit;
  2. **round 1**: `review-split` with `spec`, `risky: true`, the plan's base..head, two to four tracks from `references/axes.md`, and a budget;
  3. each confirmed finding becomes a task under the plan, fixed by the builder that owns its files, resumed, or a fresh one;
  4. **round 2**: `review-split` with `prior` = round 1's report;
  5. its fixes;
  6. the full check;
  7. the PR.
  Keep the head unchanged while a round runs.
- **Starting the workflow:** the plan's approval covers both runs. The plan file names them and their cost. So the skill tells the lead to call the Workflow, with no second ask.
- **Gone:** per-phase verdicts, "at most `maxPhases` first reviews" and scoped re-reviews.

**Echoes, each made to match in one short line that points to build § 6:**
- `plugin/instructions/core.md`:
  - § Drive the work, the "On hand-back" line;
  - § Review: "a review per phase, then a final whole-branch review", and the model line;
  - within its line and token budget (≤ 130 lines, ≤ 2338 tokens; no growth).
- `plugin/agents/senior-engineer.md`: the phase-review and fix-check lines. The verdict format stays for a consult or a single review.
- `plugin/skills/`:
  - `subagent-decision` (the "ordinary phase review" row);
  - `pull-request` (the body lists the two rounds, not phase verdicts);
  - `commit` ("after a finished, reviewed phase");
  - `plan-task` (§ 5 and § 8 mentions; § 4 states the review runs in the approval);
  - `verify-change` (§ 4 timing);
  - `review` (its pointer to build).
- Docs:
  - `README.md` (§ build lines, the skills table row, the archive line);
  - `docs/design/instructions.md`, `workflow.md` and `tasks.md`;
  - `docs/roadmap.md` (current claim only);
  - `CHANGELOG.md` 5.6.0.
- The repo's own add-on: `.claude/cc-smart-dev-kit/build.md` (the release steps before the review).

**Unchanged:**
- the review skill's single second opinion for work outside a plan;
- a plan's second read before approval (`Mode: plan-review`);
- the merge guard;
- `fixesAfterReview`.

## Files to change

- `plugin/workflows/review-split.js`, `src/workflows/review-split.test.ts`
- `src/hooks/review-record.ts`, `src/hooks/transcript.ts`, `src/hooks/review-record.test.ts`, `src/hooks/transcript.test.ts`, `docs/claude-code-contract.md`
- `plugin/skills/build/SKILL.md`, `plugin/instructions/core.md`, `plugin/agents/senior-engineer.md`
- `plugin/skills/subagent-decision/SKILL.md`, `plugin/skills/pull-request/SKILL.md`, `plugin/skills/commit/SKILL.md`, `plugin/skills/plan-task/SKILL.md`, `plugin/skills/verify-change/SKILL.md`, `plugin/skills/review/SKILL.md`
- `README.md`, `docs/design/instructions.md`, `docs/design/workflow.md`, `docs/design/tasks.md`, `docs/roadmap.md`, `.claude/cc-smart-dev-kit/build.md`
- Release (main session): `CHANGELOG.md`, `plugin/dist/`

## Patterns to follow

- **The workflow:** its own `CHECKS` table and `refuse`, the two literal launch sets, and the script-runner fakes in `src/workflows/script-runner.ts`.
- **The record:** the harmless-entry list in `transcript.ts`, and the review-record tests' transcript builders.
- **Instructions:** one home per rule, with the others pointing to build § 6. `check:duplicates`, `check:core-lines` and `check:docs` must pass.

## Edge cases

- **A plan with one phase,** or no code: still two rounds. A docs-only plan uses tracks such as "accuracy against the code" and "one home".
- **Round 1 finds nothing:** round 2 still runs, as the owner's two rounds. With an empty `prior`, it is a plain second pass; the build skill passes `prior` = "no findings".
- **The review records the wrong commit:** the record takes the cwd's HEAD. Each round runs in the plan worktree at the plan head, and the head must not move during a round, so the record is that head. The old phase reviews recorded the lead's head, not the phase commit; that mismatch goes away.
- **Round 2's fixes exceed the allowance:** the merge guard asks the owner (decision 3). The PR body says how much changed after round 2.
- **A workflow track gets a later prompt:** none can, because `Agent` is disallowed and the run sends no messages. Its own background-task notices are fixed by § 2.
- **Cost:** both rounds run on `opus` `xhigh`, with 2 to 5 tracks plus the refuters within the budget, so about 6 to 15 agents a round. That is more than one reviewer, fewer than per-phase plus final with re-reviews. The session's workflow size guideline is under 10 agents, so a round keeps tracks + budget at 9 or fewer by default.
- **The Workflow tool needs the person's opt-in:** the approval of a plan covers its two review runs. The plan file names them. A plan approved under the old rule (none open now) would ask once.
- **Old wording in history:** CHANGELOG history and archived plans stay as they are.

## What could break

- **Sessions on 5.5.0 or older** keep the old rule until they update. Nothing else depends on it.
- **The review record's harmless list widens.** A test proves a real coordinator message still blocks a record.
- **`review-split` callers** (the review skill, by hand): both new keys are optional, so old calls run unchanged. The test pins that.

## A simpler approach?

- **Rejected: a single senior engineer per round,** which is cheaper. The owner chose the workflow.
- **Rejected: instructions only, without the record fix.** The plan's own review would then risk not counting at merge.

## Rollback

A new patch version with the old build skill text and the old workflow. The record fix stays: it is a fix either way.

## How we prove it

**Phase done-checks:**
- **The record:** the red-first test row; the real transcript of the job-limits final review shows the cause; `bun test src/hooks`.
- **The workflow:**
  - `bun test src/workflows`, with rows for: `spec` adds the spec track, `prior` adds the round-2 lines to every track, a bad type is refused, old args are unchanged;
  - a dry run through `script-runner.ts`.
- **The instructions:** `check:duplicates`, `check:core-lines`, `check:docs` and `check:neutral`; grep shows no "per phase" review claim left in `plugin/` or the docs.

**Live, this plan's own review:** this plan is built under the new rule, as its first use.
- Round 1 and round 2 of `review-split` run over this plan's range (`6351800f..head`).
- The review record then shows a record at the round-2 head.

**The full check:** `bun run check` with Bun 1.4.3 and both validates, then the 5.6.0 release (CHANGELOG, build; `router.js` unchanged).

**With the owner:** read the new build § 3 and § 6 and say they match what they asked.

## Phases

Waves: `record` and `workflow` run in parallel; `rules` waits for `workflow` (it names the new args).

| Phase | Files | Builder | Steps |
|---|---|---|---|
| `record`: a review that ran background commands is recorded | src/hooks/review-record*, transcript*, contract row | builder, `sonnet`, `high` (hooks) | prove the cause on the real transcript; red row; fix; contract row |
| `workflow`: review-split gets a spec track and a round-2 mode | review-split.js and its test | builder, `sonnet`, `high` | `spec` arg; `prior` arg and round-2 prompt; arg checks and rows; one template (no duplicate sentences) |
| `rules`: the build skill and its echoes say one review per plan in two rounds | the instructions and docs listed above | rules-maintainer, `sonnet`, `high` | build § 3/4/6; core.md in budget; agent and five skills; README and design docs; repo add-on |

**Review:** the plan's own two rounds (§ 6 as rewritten), each `review-split` with `risky: true`. **Approving this plan approves those two workflow runs.**

**Release:** 5.6.0 with job limits, in one pull request. The push and the PR still wait for the owner's yes.
