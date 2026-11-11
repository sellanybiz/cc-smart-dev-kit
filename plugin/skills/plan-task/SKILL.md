---
name: plan-task
description: Use before building a change whose design is not settled or that spans several parts of the code - a feature, a refactor, an architecture decision, an ambiguous request. Research, ask, write the plan file, get approval, split it into phases. Not for a settled fix of a file or two. Trigger phrases - "implement X", "build Y", "refactor Z", "plan this", "how should we approach".
---

# Plan The Task

**Project add-on:** `.claude/cc-smart-dev-kit/plan-task.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It names where plans live and the template to
copy.

Order: **research and explore → ask → write the plan → self-check → approval → tasks →
build → verify → archive.**

The file holds design: context, decisions, approach, phases and verification. No checkboxes,
build log, done lists or owed lists. Progress belongs in tasks; edit the file only when the
design changes.

The plan is a **file**, not only chat: it survives a compaction, a restart and a hand-off.
Where it lives: the add-on file says; else `.claude/plans/<YYYY-MM-DD>-<slug>.md` in the
project, committed with its branch (in a worktree, on that worktree's branch).

The phase task description holds its brief. Do not copy briefs or progress into a second
folder or ledger; `/cc-smart-dev-kit:build` reads the tasks to execute the plan.

**No plan file** for a small fix (`/cc-smart-dev-kit:review` defines it) or a change of two files or
fewer whose design is settled — the task is the plan, and a change that small stays with you.

**Plan in plan mode** — steps 1 to 4 — when a person is there to approve: call
`EnterPlanMode` (the person can also press Shift+Tab, or type `/plan`). Plan mode lets you
read, search and explore, and blocks every edit but its own plan file, so nothing is built
before the yes. It keeps that file where Claude Code's `plansDirectory` setting points,
relative to the project root: the kit's setup sets `.claude/plans`, and a project's own value
wins. Unset, or a path Claude Code cannot use, it falls back to `~/.claude/plans`, outside the
repo; the file then moves home after the yes (§ 4). No plan mode — no `EnterPlanMode` among
your tools, write the plan file yourself, then ask for approval with `AskUserQuestion` (§ 4).
A subagent reports to its caller instead of asking the person.

## 1. Research and explore first

A plan built on memory is worse than no plan. Gather the facts, then plan from them:

- **Research** — `/cc-smart-dev-kit:research-first` for every library, API or pattern.
- **Prior art** for new work — how others already solve it: what to copy, what to skip, what
  fits this codebase. Look at the live product when the user experience matters.
- **The code** — the files that change and the patterns to match.
- **Impact** — every consumer of shared code you will touch (`/cc-smart-dev-kit:impact-analysis`).

**Write the research down as you go**, in the plan's **Research** section (in plan mode the
plan file is the only file you may write); **Code exploration** holds what you read in the
code. On approval the full research moves to its own file in the archive (§ 4), and the plan
keeps a condensed version and the link.

## 2. Ask with `AskUserQuestion`

Never as numbered prose. One to four questions per call, two to four options each; the
recommended option first, with `(Recommended)` on its label. Labels of one to five words. Each
question says what is decided and why it matters; each description says what happens, the main
benefit and the downside, and the recommended one says why it fits here. The person may see
nothing else, so each must stand alone (examples: `/cc-smart-dev-kit:explain`). `multiSelect`
when the choices do not exclude each other.

Ask about: a data-model change; edge cases the request does not settle; a change across
several systems (all now, or phased?); two valid approaches; a known risk in the person's
approach; a proposed fix that hides the root cause (offer the root-cause fix as
recommended); unclear scope. Skip asking for trivial fixes, a detailed "just do it", or
settled decisions.

**Before a major change, offer two ways:** **play safe** — keep fallbacks, compatibility and
the legacy paths (old stored values, columns, URLs, environment variables) — or **go fully
new** — none of them, a clean break. Recommend the one the facts support, with its cost. The
plan writes down which was chosen: never a silent legacy shim, and never a silent break.

The recommended option is always the strongest one — never a shortcut dressed up as an
option. Label a workaround as one and name its debt.

## 3. Write the plan, before the first code edit

Answer eight questions; they are the plan's sections:

1. **Goal** — the real outcome, not the literal request.
2. **Files to change.**
3. **Patterns to follow** — from step 1.
4. **Edge cases** — walk the axes in the review skill's `references/axes.md`
   (`../review/references/axes.md` from this skill's folder) and write down every one this
   change can hit: what triggers it and what the plan does about it. An axis that cannot
   apply gets one line. Findings that reshape the design go into the approach, not a footnote.
5. **What could break** — the consumers of every shared symbol.
6. **A simpler approach?** — the best code is no code.
7. **Rollback** — how to undo it cleanly.
8. **How we prove it** — the checks that show it works: the tests (for a bug, the test that
   fails first), the checks the push and CI run, and what only the person can judge
   (`/cc-smart-dev-kit:verify-change` § 6). Each phase's done-check (§ 5) comes from here.

Put a three-line **Summary** at the top. Keep approval and build status out of the design.
Write it so a fresh session can build from the file alone: the approval screen may offer to
clear the context and start from the plan (the person's `showClearContextOnPlanAccept`
setting). The built-in `Plan` agent is read-only: it returns the text, and you write the file.

## 4. Self-check, then approval

Re-read the plan as a skeptic: a simpler path, an unverified assumption, an edge case waved
away? For a big or risky plan, start two agents in one message: the
`cc-smart-dev-kit:edge-case-hunter` for every scenario that can break the plan, and the
`cc-smart-dev-kit:senior-engineer`'s second read (`opus`, `xhigh`; a read of the plan, not of a
change set), its brief with the line `Mode: plan-review` alone on its line — never
`Mode: review`, which would record the plan read as a code review. Fold what they find into
the plan's approach and edge cases. When the plan adds UI or a new architecture, show it — a
diagram or a mockup — rather than only describing it.

Then ask for approval. In plan mode that is `ExitPlanMode`: it shows the plan, and the person
approves it there or keeps planning — never a second "Start building?" with
`AskUserQuestion`. Without plan mode, ask with `AskUserQuestion`. After an explicit yes,
move a plan kept outside its home there, and commit the plan file on the current branch as the
workflow allows. Move full research to
`.claude/research/archive/<YYYY-MM-DD>-<slug>.md` (or the add-on's home), linked from the plan.
Changes wanted: revise and ask again; never build without approval.

After approval, use `task_create` for the plan (`plan`: its slug, subject: its title), then
one phase task per phase (`phase`: its id, with the same `plan`). Put the complete builder
brief in each phase's description, in four parts: objective; files and boundaries; patterns
and tools; output format (`Report:` task note and short status). Include interfaces, edge cases and done-check.
Put caller rulings up front: commit permission, allowed checks, the refusal handling the
builder agent gives, decide small calls and note them as `Ruling:`.
The dispatch includes `Your task: #<n>` for the phase; the build skill explains the
hand-back guard that reads it. Under each phase create its steps with their checks: tasks whose
`parent` is the phase. A task holds no tasks. Set `blocked_by` for real dependencies and
shared-file phases.
Create project tasks for production, database, teammate and follow-up obligations.
Task fields and the CLI fallback: `/cc-smart-dev-kit:memory-routing`.

## 5. Phases, owners and waves

- **One fresh subagent owns each phase.** Name its agent type, model and effort using the
  core instructions' table. Keep shared integration work in the main session.
- **A phase is about 30 to 90 minutes of work.** A bigger one splits before it starts.
- **Name exact files.** Disjoint file sets run in parallel worktrees; any shared file orders
  those phases. Batch small edits of the same shape into one dispatch, not one agent per line.
- **Name contracts and dependencies.** Contracts (a type, an API shape, a shared constant) go
  first, in a phase of their own; the phases that use them are `blocked_by` it, so they start
  from its merged code. Put every other real wait in `blocked_by` too. Do not hold work for
  an unrelated review, merge or answer.
- **List waves.** The first wave contains all phases with no blockers. Execution and the
  hand-back, review, fix, merge and cleanup loop belong to `/cc-smart-dev-kit:build`.
- **The last wave is a heavy cleanup**, run only once everything is verified live: the
  fallbacks and legacy paths a "play safe" plan kept for the move (§ 2), leftover branches
  and worktrees, and docs that still name what was removed.
- **Give each phase a targeted done-check.**
- **Keep shared writes with the main session:** lockfiles, new dependencies, version bumps,
  shared indexes, migrations, dev servers and the final full check
  (`/cc-smart-dev-kit:verify-change` § 4). Never assign the same file to parallel builders.

## 6. Keep tasks live, the design stable

- Start and finish work in the task tree; record evidence and work notes there.
- During execution use the build skill's rulings and stop reasons. Update the plan only
  when a ruling changes the design.
- Track a new ask before acting; scope still follows the core instructions' "one plan" rule.
- **One plan at a time, several per session.** Finish the current plan (§ 8) or park it
  before you plan the next. Each plan gets its own plan task. Name the intended plan with
  `plan` on `task_list` and on every work-task `task_create` for it; never on a project task,
  which refuses it.
- After compaction, read the task tree for progress and the file for design.

## 7. Execute without check-ins between phases

Run `/cc-smart-dev-kit:build` after approval. Its task gates close phases with evidence and
start the next ready work. Do not ask whether to continue half-built work.
At plan end, give a short summary of what shipped, failed and remains.

## 8. Archive it — yourself, the moment it is finished

A finished plan leaves the live folder in the same turn. Close the plan task with verification
and the commits that shipped it. If parked, leave its work pending and note why and what
would restart it; if superseded, drop it with a pointer to its replacement.

Move the plan file to `<plans dir>/archive/`. Commit that move as the workflow allows.
Keep the outcome on its task, not in a status history appended to the design.

Architecture decisions compare at least two approaches and write down why one won. Bug fixes
find the root cause, by reading the code, before the fix.
