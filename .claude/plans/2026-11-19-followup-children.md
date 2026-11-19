# Follow-ups go to one child at once; fewer pull requests and CI runs (5.4.0)

**Summary.** A follow-up (a finding outside the plan) is asked about the moment it is found; a yes
files it and hands it to the lead's one follow-up child (`herdr start --followup`, or `herdr send`
to the running one), which collects every follow-up into one pull request. The kit also stops
spending CI: the plan archive rides in the plan's own PR, small fixes share one PR per session,
and fixes after a PR opens are batched, checked locally and pushed once.

## Context

- **Follow-ups.** Today a finding outside the plan is filed (`issue file`) or put in the summary,
  and nothing works on it: no command starts work from a filed issue (`kit:ready` is only a mark).
  The person wants it confirmed at once and worked by a child session, or added to one running.
- **CI usage.** Both repos run CI on `pull_request` and on `push` to `main` only
  (`.github/workflows/ci.yml`, `windows.yml`; `cancel-in-progress`). A branch push with no PR is
  free; each PR costs a PR run per push plus a main run at the merge. The waste comes from the
  kit's habits: bookkeeping PRs (plan archives #80, #78 here, #69 in 247chatapp; workflow file
  #77), one PR per small fix, and fix rounds pushed one by one after the PR opens (247chatapp: 91
  PR runs for ~25 PRs).

## Decisions (the person, 2026-11-19)

- Ask **the moment a follow-up is found**; the options can hand it to a child already running.
- **One follow-up child for all** follow-ups of a lead and repository: one branch, one PR at a time.
- A **code-backed** follow-up start (`herdr start --followup`).
- **No child possible** (outside Herdr, away, plan-mode lead): file it (or the summary) and wait;
  away, park a question; the yes later starts or sends.
- **One plan, one PR**: both changes ship together as 5.4.0.
- **The plan archive rides in the plan's own PR.**
- **Small fixes: one PR per session.**
- **After a PR opens: batch, check locally, push once.**

## Part A — the follow-up flow

1. **Found.** The main session meets a finding outside its plan — its own, or in a builder's
   `Report:`, a reviewer's "Outside this change", a rules-maintainer's "Follow-ups for the caller".
   A subagent or any Herdr child (plan or follow-up) never asks, files or starts: it lists the
   finding in its report (`herdr report` for a child); the lead asks when it reads it.
2. **Ask at once** (`AskUserQuestion`, one finding per question: what is wrong, its `file:line`,
   the cost). Options, recommended first:
   - **Send to the follow-up child** — when this lead's follow-up child for this repository is in a
     state `send` accepts (idle, working or done).
   - **Send to the plan child that holds it** — when the finding's files are in a live plan child's
     plan: it is inside that plan; the message asks the plan child to make it a task in its plan.
   - **Start a follow-up child** — when none is live; says it costs one full session.
   - **File it only** — as today.
3. **On a yes.** File the issue first when issues work (`issue file`, its fingerprint), then start
   (`herdr start --followup [--issue <n>]… --model --effort --mode -- "<finding>"`) or send
   (`herdr send <terminal> "Follow-up [#n]: <finding> [files now held: …]"`). Wait for a new child's
   first status before the first send (a null status is refused as blocked).
4. **The follow-up child** (trailer written by the command; it never stops on its own):
   - **Once, at the start:** reset to `origin/<base>` only when the branch has no commits past it
     and the tree is clean (`git rev-list --count origin/<base>..HEAD` is 0, `git status
     --porcelain` empty); otherwise never reset. (`claude -w` may cut the worktree from the lead's
     branch or a stale `origin/HEAD`.)
   - **Before each finding:** `gh pr view --json state` on its branch — open: add to it; merged or
     closed: `git fetch`, `git reset --hard origin/<base>` (that work is in the merged PR), new PR;
     none: go on.
   - **Never edit a file a held plan holds** (listed in the trailer, and in later messages): report
     it instead — the lead treats it as inside that plan.
   - **Per finding:** small fix → fix, check, review; bigger → plan mode, approved by the person in
     the child's pane. One commit per finding; `issue mark-fixed` for its issue (as a merged phase
     is marked); it may push its branch (free while no PR is open); it opens its PR, or pushes to
     an open one, only when the lead sends `ship` — full check first, then one push — as
     `workflow show` says, the body's `Fixes` lines from `issue fixed` (never by hand);
     `herdr report` after each finding. The lead sends `ship` at the ship point (Part B).
   - Its own findings go in its report: never ask, file or start.
   - It ends only on `herdr stop`.
5. **Blocked child** (waiting in its pane): no send option; offer "file it only" and say where it
   waits (`hc attach <terminal>`); the lead sends it the next time it sees the child idle, working
   or done. Never relay its question. A finding inside a held plan is a task in that plan (the task
   is the record; the issue is optional).
   **Error state:** neither send nor start; tell the person to look at the pane.
6. **No child possible** (not in a Herdr terminal, a plan-mode lead, the judge refuses, a child
   lead): file it (or the summary), say why. **Away:** `AskUserQuestion` is denied — park one
   `question` per finding with the same options; `user-available` turns a yes into file + start or
   send.

### The command: `herdr start --followup`

- New flag `--followup`; new option `--issue <n>` (repeatable, `^[1-9]\d*$`), only with
  `--followup`. `parseOptions`' `repeatable` set in both parses (`command.ts:1032-1036`,
  `words.ts:128`). The judge reuses `parseHerdrArgs` (`bash-judge.ts:787`): no judge change.
- Refused with `--plan`, `--task`, `--independent`, `--on` (the `PLAN_EXCLUSION` pattern,
  `words.ts:73`).
- Refused when this terminal carries `kit.lead` (any child; the `refusePlanChild` pattern,
  `command.ts:367-379`).
- **One per lead and repository** (lead core + `kit.repo`, `command.ts:834`): refused while one is
  live; the error names its terminal and says `herdr send`; in the error state it says to look at
  the pane. Also refused when an ended follow-up child of this lead left a branch with commits not
  on `origin/<base>` and no merged PR: the error names the worktree and branch.
- The base from `baseBranch()` (`plans.ts:31`, honours `worktrees.base`); refused while unknown,
  with the `git remote set-head origin --auto` fix (as `prepareStart`, `plans.ts:693-696`).
- The trailer (`followupTrailer` beside `planTrailer`, `brief.ts:32-37`): step 4, the issue
  numbers, and every held plan's slug and files (`heldPlans`, `queries.ts:448-455`; a snapshot).
- `planTrailer` gains the line: findings outside your plan go in `herdr report`; never ask, file or
  start.
- Label `kit.followup=1`; `herdr list` shows "follow-up". No issue-number label (it would go stale).
- One exported constant for the states `send` accepts (`command.ts:424-440`), used by the gate
  text and the skill.
- `herdr wait --all`: a follow-up child never settles; leave it out of the `--all` barrier (check
  `command.ts:118-120, 186-201`), with a test.

### Where the rule lives

- `plugin/instructions/core.md:34-36`, exactly: "One outside it is no fix and no task: the main
  session asks the person at once (`/cc-smart-dev-kit:tasks`), a subagent lists it in its report."
  (−3 characters; CORE stays ≤ 2338.)
- `plugin/skills/tasks/SKILL.md:31-39`, the one home: steps 1–3, 5, 6 (the ask, its options, file
  first, blocked, no child, away). No command lines here.
- `plugin/skills/herdr/SKILL.md`: a "Follow-up child" section with the command lines, the gate,
  send rules, wait for first status, what the child does.
- `build`, `review`: one pointer line each to the tasks rule for reports' outside findings (under
  12 words or worded apart).
- `user-unavailable`, `user-available`: a finding while away is a parked question; on return a yes
  goes through the tasks rule.
- `subagent-decision:65-66`, `plan-task:244-249`: reword only where they now contradict.

## Part B — fewer pull requests and CI runs

- **The plan archive rides in the plan's PR.** `plan-task` § 8 and `build` (final steps): after the
  final review and full check, move the plan file (and its research) to `archive/` as the last
  commit on the plan branch, then open the PR and close the plan task in the same turn, as before
  (ruling from the rules review: closing after the merge would stall the plan queue; the plan's
  files stay held until its PR settles). A plan whose PR is abandoned is moved back in its next PR.
- **Small fixes: one PR per session.** `commit`, `review` (small fix): a session's small fixes
  outside a plan collect on a branch of their own (never a plan branch) and open one PR at the
  **ship point**: the end of the turn that finishes the person's request, or at once when the
  person says ship now. The lead sends its follow-up child `ship` at the same point.
- **After a PR opens: batch, check, push once.** `commit`, `build` (fix pass, CI failure),
  `pull-request`: pushes before the PR opens are free backups; once it is open, collect every fix
  of a round (review findings, a CI failure), run the full check locally, then push once. Never
  push a fix at a time; never use CI to find what the local check finds.
- **Unchanged, on purpose:** one PR per plan (already the rule); a deploy run's small PR of task
  closes (they must reach the base before the next deploy's `release --check` reads it).

## Files to change

- `src/herdr/words.ts`, `command.ts`, `brief.ts`, `labels.ts`, `plans.ts` (reads only), and their
  tests (`src/herdr/*.test.ts`).
- `plugin/instructions/core.md`; `plugin/skills/{tasks,herdr,build,review,commit,pull-request,plan-task,user-unavailable,user-available,subagent-decision}/SKILL.md`.
- `docs/design/herdr.md`, `docs/design/issues.md`, `docs/design/workflow.md`, `README.md`,
  `CHANGELOG.md`.
- Main session: `plugin/.claude-plugin/plugin.json`, `install.sh`, `install.ps1` (5.4.0),
  `plugin/dist/`.

## Patterns to follow

- `--plan`'s start path end to end: gates (`command.ts:663-691`), `prepareStart`, `planTrailer`,
  `refusePlanChild`, labels — `--followup` is its smaller sibling.
- The issue contract: `issue mark-fixed` after a fix, `issue fixed` for `Fixes` lines
  (`docs/design/issues.md` § Mark at the merge, close with the release).
- One home per rule (tasks skill); other files point to it.

## Edge cases

- A child finds one → reports it; the lead asks. A child cannot start `--followup` (`kit.lead`).
- Inside a held plan's files → that plan's task, via its plan child; never the follow-up child.
- Follow-up PR merged or closed (by the person or `autoMerge`) → the child resets and opens a new PR
  at the next finding; the lead still sends to the same child.
- Gone child with unpushed work → the start is refused with its worktree and branch.
- `mark-fixed` with base = the child's branch: the builder proves it works or reports.
- Issues refused (public repo without `allowPublic`, no GitHub, off) → no `--issue`, no `Fixes`.
- Same finding twice → `issue file` says `updated #n`; do not send it again.
- Another repository → `--cwd` there, its own issue, its own follow-up child (the gate is per repo).
- Two yeses close together → the second start is refused and names the terminal.
- Lead in plan mode, away, outside Herdr, `claude -p` → no start; file or park.
- A new held plan after the start → the lead names its files in the send text.
- Abandoned plan PR → its archived plan file moves back in the next PR.
- The person says no → filed only.

## A simpler approach?

Instructions only was declined. Within the code path, a child that never stops removes the
merged/gone branching from the gate and from the lead.

## Rollback

Revert the PR. `--followup` is opt-in; the skill rules revert with it.

## Phases (all three in wave 1; disjoint files)

- **cli** — `src/herdr/` and tests. `cc-smart-dev-kit:builder`, sonnet, high.
- **rules** — core.md and the ten skills (Parts A and B). `cc-smart-dev-kit:rules-maintainer`,
  sonnet, high.
- **docs** — `docs/design/{herdr,issues,workflow}.md`, README (herdr table, `--followup`,
  `--issue`), CHANGELOG `## 5.4.0`. `cc-smart-dev-kit:rules-maintainer`, sonnet, high.
- **Main session:** version 5.4.0, dist rebuild, then check the herdr skill, `herdr.md` and README
  against the refusal words and trailer text that shipped; final review (opus, xhigh); full check;
  the plan archive as the branch's last commit; one PR.

## How we prove it

- Tests, each seen failing once: the parse (`--followup`, repeated `--issue`, every exclusion);
  the `kit.lead` refusal; one per lead and repo (names the terminal); the error-state and
  orphaned-branch refusals; unknown base; the trailer text exact (reset guard, PR-state step, issue
  numbers, held plans present and absent); `planTrailer`'s new line; the label and `herdr list`;
  `wait --all` ignores a follow-up child.
- `check:duplicates`, `check:context-budget` (CORE ≤ 2338, ALWAYS_ON unchanged),
  `check:core-lines`, `check:docs`, `bun run check`, portal tests, both validates.
- With the person, in a Herdr terminal: plant two findings; the session asks at once for each;
  the first yes files and starts the child (its worktree on `origin/main`, brief right); the second
  is sent to it; one PR carries both, its `Fixes` lines from `issue fixed`; merge it, plant a third:
  the same child resets and opens a new PR.
