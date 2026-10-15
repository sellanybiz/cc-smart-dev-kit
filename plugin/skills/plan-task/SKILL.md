---
name: plan-task
description: Use before any non-trivial change - more than two files, a design that is not settled, an architecture decision, or an ambiguous request. Research and explore, ask, write the plan to a file, get approval, split it into phases with owners, then build and keep the plan live. Trigger phrases - "implement X", "build Y", "refactor Z", "what's the best way to", "should I", "how should we approach".
---

# Plan The Task

**Project add-on:** `.claude/anymodel/plan-task.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It names where plans live and the template to
copy.

Order: **research and explore → ask → write the plan → self-check → approval → phases →
build → keep it live → archive.**

The plan is a **file**, not only chat: it survives a compaction, a restart and a hand-off.
Where it lives: the add-on file says; else `.claude/plans/<YYYY-MM-DD>-<slug>.md`.

**No plan file** for a small fix (`/anymodel:review` defines it) or a change of two files or
fewer whose design is settled — the task is the plan. Its separable pieces still go to
subagents.

## 1. Research and explore first

A plan built on memory is worse than no plan. Gather the facts, then plan from them:

- **Research** — `/anymodel:research-first` for every library, API or pattern.
- **Prior art** for new work — how others already solve it: what to copy, what to skip, what
  fits this codebase. Look at the live product when the user experience matters.
- **The code** — the files that change and the patterns to match.
- **Impact** — every consumer of shared code you will touch (`/anymodel:impact-analysis`).

Write the findings into the plan's **Research** and **Code exploration** sections.

## 2. Ask with `AskUserQuestion`

Never as numbered prose. One to four questions per call, two to four options each; the
recommended option first, with `(Recommended)` on its label. Labels of one to five words; the
trade-off goes in the description. `multiSelect` when the choices do not exclude each other.

Ask about: a data-model change; edge cases the request does not settle; a change across
several systems (all now, or phased?); two valid approaches; a known risk in the person's
approach; a proposed fix that hides the root cause (offer the root-cause fix as
recommended); unclear scope; backward compatibility (old stored values, columns, URLs,
environment variables) — the recommended default is a clean break, never a silent legacy
shim. Skip asking for trivial fixes, a detailed "just do it", or settled decisions.

The recommended option is always the strongest one — never a shortcut dressed up as an
option. Label a workaround as one and name its debt.

## 3. Write the plan, before the first code edit

Answer seven questions; they are the plan's sections:

1. **Goal** — the real outcome, not the literal request.
2. **Files to change.**
3. **Patterns to follow** — from step 1.
4. **Edge cases** — walk the axes in `/anymodel:review` and write down every one this change
   can hit: what triggers it and what the plan does about it. An axis that cannot apply gets
   one line. Findings that reshape the design go into the approach, not a footnote.
5. **What could break** — the consumers of every shared symbol.
6. **A simpler approach?** — the best code is no code.
7. **Rollback** — how to undo it cleanly.

Put a three-line **Summary** at the top, and a **Status** line: `In review` until approved.
The built-in `Plan` agent is read-only: it returns the text, and you write the file.

## 4. Self-check, then approval

Re-read the plan as a skeptic: a simpler path, an unverified assumption, an edge case waved
away? For a big or risky plan, ask a second read from `anymodel:reviewer` (a read of the
plan, not of a change set). When the plan adds UI or a new architecture, show it — a diagram
or a mockup — rather than only describing it.

Then ask for approval with `AskUserQuestion` ("Start building this plan?"). Approved: Status
`Approved`, then build. Changes wanted: revise, ask again. Never go from `In review` to code
without an explicit yes.

## 5. Phases and owners — you lead, subagents build

Write the plan for a team. What stays with you is the core instructions' "do it yourself"
list.

- **Each phase has one owner** — a subagent, with its type, model and effort — or you.
- **Each phase names its files.** Phases that run at the same time own different files; two
  that must change one file run in turn.
- **Each phase names what it waits for** — any contract it builds on (a type, an API shape, a
  shared constant) and any code it calls. Contracts go first, alone; every phase that waits
  for nothing starts at once, in one message.
- **Each phase has a done-check** — the targeted tests that prove it.
- **Shared files stay with you, the integrator:** the plan file, the lockfile and new
  dependencies, the project's version number, shared index files (a docs index, a barrel, a
  changelog), environment variables, a schema migration, starting the dev server, full
  coverage or end-to-end runs. Parallel builders never bump the version or edit a shared
  index: you do it once, after their work lands, one merge at a time, rebasing and
  rebuilding as you go.

Brief each owner with its phase, its files, the patterns, its done-check and its limits
(`/anymodel:subagent-decision` § How to brief). Check each hand-back yourself: read
`git diff -- <its files>` in full, run its tests, confirm nothing changed outside its list.
That read is your own review pass for those files. While other owners still write, stage by
path, never `git add -A`. You tick the plan, integrate, commit and own the result.

## 6. Keep it live

- Status `In progress` while you build. Tick tasks and edge cases as you finish them.
- New ambiguity: blocking → ask; not blocking → pick, write the assumption in the plan, go on.
- A new ask mid-build goes into the task list before you act on it; outside this plan, see
  the core instructions' "one plan" rule.
- Write each decision in, with its reason, when you make it. After a compaction you resume
  from this file, not from the chat.

## 7. Finish the phase, then the plan

- **Run each phase to the end of its task list.** No "here is what I did, shall I continue?"
  on half-built work. The one reason to stop early is a blocking question, asked with
  `AskUserQuestion`. A part that turns out blocked: finish everything else, then say what you
  left out and why.
- **End of a phase:** commit it as `/anymodel:commit` allows (by default only when the person
  asks; it also says when to push and ask for merges), write one progress line in the plan,
  and start the next phase.
- **End of the plan:** a short summary (what shipped, what broke, what you left out), then
  the one merge question the commit skill describes.

## 8. Archive it — yourself, the moment it is finished

A finished plan does not stay with the live ones. In the same turn: Status `Done` (or
`Parked` with why and what would restart it, or `Superseded` naming the plan that replaced
it), the commits that shipped it, then move it to the archive folder and commit that. Never
leave it for the person or the next session. A status that is never updated becomes a claim
that reads as current and is false.

| Status | Meaning | Archive? |
|---|---|---|
| `In review` | written, not approved | no |
| `Approved` | cleared to build | no |
| `In progress` | being built | no |
| `Done` | shipped and verified | yes, now |
| `Parked` | stopped on purpose; say why | yes, now |
| `Superseded` | replaced; name the new plan | yes, now |

Architecture decisions compare at least two approaches and write down why one won. Bug fixes
find the root cause, by reading the code, before the fix.
