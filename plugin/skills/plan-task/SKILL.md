---
name: plan-task
description: Use before building a change whose design is not settled or that spans several parts of the code - a new feature, a refactor, an architecture decision, an ambiguous request. Plans in plan mode - research, ask, write the plan file, get the person's approval - then splits it into phases with owners and keeps it live. Not for a question about a library or an API (research-first), nor a settled fix of a file or two. Trigger phrases - "implement X", "build Y", "refactor Z", "plan this", "how should we approach".
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
Where it lives: the add-on file says; else `.claude/plans/<YYYY-MM-DD>-<slug>.md`.

**A plan has its own folder**, beside its file and named as the file without `.md`:
`<plans dir>/<plan stem>/`. A crew phase's brief goes in it, named as its crew branch:
`<plans dir>/<plan stem>/briefs/<PHASE>-<slug>.md` (never one flat folder of briefs, never one folder
per lead session: the plan outlives its leads). Its `runs/` folder holds the kit's record of each
crew run (`/cc-smart-dev-kit:lead`). The lead registers the plan with `crew lead --plan-file <the plan
file>`.

**No plan file** for a small fix (`/cc-smart-dev-kit:review` defines it) or a change of two files or
fewer whose design is settled — the task is the plan. Its separable pieces still go to
subagents.

**Plan in plan mode** — steps 1 to 4 — when a person is there to approve: call
`EnterPlanMode` (the person can also press Shift+Tab, or type `/plan`). Plan mode lets you
read, search and explore, and blocks every edit but its own plan file, so nothing is built
before the yes. It keeps that file where the `plansDirectory` setting points: unset, that is
`~/.claude/plans`, outside the repo; a project that keeps its plans in git sets it to its
plans folder in `.claude/settings.json`. No plan mode — no `EnterPlanMode` among your tools,
a session nobody watches, a crew session (`/cc-smart-dev-kit:crew`): write the plan file
yourself, and ask for approval with `AskUserQuestion` (§ 4).

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
recommended option first, with `(Recommended)` on its label. Labels of one to five words; the
trade-off goes in the description. `multiSelect` when the choices do not exclude each other.

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
away? For a big or risky plan, ask a second read from `cc-smart-dev-kit:reviewer` (a read of the
plan, not of a change set). When the plan adds UI or a new architecture, show it — a diagram
or a mockup — rather than only describing it.

Then ask for approval. In plan mode that is `ExitPlanMode`: it shows the plan, and the person
approves it there or keeps planning — never a second "Start building?" with
`AskUserQuestion`. Without plan mode, ask with `AskUserQuestion`. After an explicit yes,
move a plan kept outside its home there. Move full research to
`.claude/research/archive/<YYYY-MM-DD>-<slug>.md` (or the add-on's home), linked from the plan.
Changes wanted: revise and ask again; never build without approval.

After approval, use `task_create` for one plan task, subject = the plan's title. Each phase
is its subtask; each phase's steps are subtasks with their done-check in the description.
For crew phases, let `crew start` create the phase task (§ 5); do not make a duplicate.
Create a project task for every production, database, teammate or follow-up obligation the
plan finds. Task routing and the CLI fallback: `/cc-smart-dev-kit:memory-routing`.

## 5. Phases and owners — you lead, subagents and crew sessions build

Write the plan for a team. What stays with you is the core instructions' inline list (§ Lead
the work).

- **Each phase has one owner** — a crew session with its kind (where the project has crew sessions
  on: `/cc-smart-dev-kit:lead`), a subagent with its type, model and effort, or you. The waves
  table has a **Crew sessions** column that names each phase's owner.
- **A phase is about 30 to 90 minutes of work.** A bigger one splits before it starts.
- **Each phase names its files.** Two phases that might change one file are split instead of
  run in turn: each takes its own part of it, or both run and you merge the small conflict.
- **Each phase names what it waits for** — any contract it builds on (a type, an API shape, a
  shared constant) and any code it calls. Contracts go first, alone.
- **The plan lists its phases in waves** — a wave is the group that starts together: wave 1
  holds every phase that waits for nothing, and it starts at once, in one message (crew
  through `cc-smart-dev-kit crew start`). On each hand-back, check the phases still waiting
  and start, in that turn, what it unblocked. A phase never waits for a merge or a review it
  does not use.
- **The last wave is a heavy cleanup**, run only once everything is verified live: the
  fallbacks and legacy paths a "play safe" plan kept for the move (§ 2), leftover branches,
  worktrees and crew sessions, docs that still name what was removed, and the plan's archive (§ 8).
- **Each phase has a done-check** — the targeted tests that prove it (§ 3, How we prove it).
- **A large mechanical change** — the same edit across many files that splits into many
  independent units: the bundled `/batch` skill plans it and runs each unit in its own
  worktree, and each unit publishes its own change. Check that against the project's
  workflow (`cc-smart-dev-kit workflow show`) before you use it.
- **Shared files stay with you, the integrator:** the plan file, the lockfile and new
  dependencies, the project's version number, shared index files (a docs index, a barrel, a
  changelog), environment variables, a schema migration, starting the dev server, full
  coverage or end-to-end runs. Parallel builders never bump the version or edit a shared
  index: you do it once, after their work lands, one merge at a time, rebasing and
  rebuilding as you go. None of it holds a phase back: it is your work, done after.

Brief each owner with its phase, its files, the patterns, its done-check and its limits
(`/cc-smart-dev-kit:subagent-decision` § How to brief; a crew session's brief: `/cc-smart-dev-kit:lead`
§ 3). Check each subagent's hand-back yourself: read `git diff -- <its files>` in full, run its
tests, confirm nothing changed outside its list. That read is your own review pass for those
files. A crew session's hand-back passes the lead skill's gate instead (§ 6 there). While other
owners still write, stage by path, never `git add -A`. You update tasks, integrate, commit and
own the result. Once a subagent's work is merged, remove its worktree and its branch in the same
step (`git worktree remove`, `git branch -D`): Claude Code keeps a worktree that holds commits,
and a squash merge never shows its branch as merged.

## 6. Keep tasks live, the design stable

- Start and finish work in the task tree; record evidence and work notes there.
- New ambiguity: blocking → ask; otherwise decide and note it on the task. If it changes
  the design, update the plan with the decision and its reason.
- Track a new ask before acting; scope still follows the core instructions' "one plan" rule.
- After compaction, read the task tree for progress and the file for design.

## 7. Finish the phase, then the plan

- **Run each phase to the end of its task list.** No "here is what I did, shall I continue?"
  on half-built work. The one reason to stop early is a blocking question, asked with
  `AskUserQuestion`. A part that turns out blocked: finish everything else, then say what you
  left out and why.
- **End of a phase:** commit it as `/cc-smart-dev-kit:commit` allows (by default only when the person
  asks; it also says when to push and ask for merges), close its task with evidence,
  and start the next phase. A crew merge closes its phase task through the watch.
- **End of the plan:** a short summary (what shipped, what broke, what you left out), then
  the one merge question the commit skill describes.

## 8. Archive it — yourself, the moment it is finished

A finished plan leaves the live folder in the same turn. Close the plan task with verification
and the commits that shipped it. If parked, leave its work pending and note why and what
would restart it; if superseded, drop it with a pointer to its replacement.

Move the file **with its folder** to `<plans dir>/archive/`: briefs and run records move to
`<plans dir>/archive/<plan stem>/`. Never delete run records; `cc-smart-dev-kit crew history`
reads them there. Commit the move as `/cc-smart-dev-kit:commit` allows. Keep the outcome on
the task, not in a status history added to the design.

Architecture decisions compare at least two approaches and write down why one won. Bug fixes
find the root cause, by reading the code, before the fix.
