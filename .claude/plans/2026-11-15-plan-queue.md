# Plan: a session lays out several plans up front, then runs them in order (4.9.0)

**Summary.** In 4.8.0 a session may queue plans, but it may lay phases in only one of them.
So the later plans' phases live only in their plan files until their turn. The owner wants
them all laid out up front, visible in the ledger, so nothing gets lost. Fix: lay phases in
any plan, at any time. Only one plan is *in flight*: the plan task's own status marks it.
Starting work in another plan waits until that plan finishes or is parked.

## Context

Today (4.8.0, `src/tasks/ops.ts` and `src/tasks/plan-guards.ts`):
- `refuseOther(slug, "lay a phase")` (ops.ts:312) refuses a phase in plan B while plan A has an
  open phase. `activePlanOf` (src/tasks/work/queries.ts:152) calls A active because it has
  an open phase. So once B has pending phases laid, B would count as active too. That is why
  laying phases ahead is refused.
- Parking (plan-task § 6) drops A's open steps and phases with `parked: <why>`, and resuming
  reopens them. It works, but it is clumsy, and it hides the parked work as "dropped".

The owner's decision (2026-11-15): lay all phases up front; start only in one plan at a time.

## The model after this change

- **Queued plan:** the plan task's status is `pending`. It may hold phases and tasks, fully
  laid out with their briefs, and the cap applies per plan.
- **In-flight plan:** the plan task's status is `in_progress`. The store sets this itself when
  the plan's first phase or task starts. A session has at most one plan in flight. For plans
  started under 4.8.0, which never set their plan task, a plan with a phase `in_progress`
  also counts as in flight.
- **Start rule:** starting a phase or task in plan X is refused while another own plan is in
  flight. The refusal names that plan and the two ways forward: finish it, or park it.
- **Park:** set the in-flight plan task back to `pending` with `task_update`, plus a note
  `parked: <why>`. This is refused while one of its phases is `in_progress`; stop or finish
  that phase first. Nothing is dropped: phases, steps and briefs stay as they are. To resume,
  start one of its phases again; the start rule applies.
- **Order:** plans run one at a time. The skill says to take them in plan-number order. The
  store does not force the order, so the person can say "do plan 3 first".
- **Default plan** for a call that names none:
  1. the own in-flight plan;
  2. else the plan being finished (all phases closed, at least one done, plan still open; this
     is 4.8.0's rule 2, kept for plans started before 4.9.0);
  3. else the lowest-numbered own open plan that has an open phase (the next in the queue);
  4. else the newest own open plan, as today.
- **Lay and reopen:** laying a phase, or reopening a dropped one, needs only the cap. There is
  no plan refusal any more.
- **A plan in flight stays in flight until `task_done`.** So the final review and its fix pass
  belong to it, and the next plan cannot start before the plan closes. This also closes 4.8.0's
  "queued plan catches the fix pass" gap for good.
- **Visibility:** `task_list` with scope plan marks each plan `in flight`, `queued` or
  `parked`, in number order. The status line keeps showing the in-flight plan.

## Approach

### Phase Q: the store (`src/tasks/**`)
- `queries.ts`: replace `activePlanOf` with `inFlightPlanOf(all, owns)`: the own open plan with
  status `in_progress`, or with a phase `in_progress` (4.8.0 data). If two qualify, prefer the
  one with a phase `in_progress`, then the lowest number. Update `defaultPlanOf` to the order
  above. One home: `phases.ts`, ops and the list all call these helpers.
- `plan-guards.ts`: `refuseOtherPlan` keeps only the "start work" case. Remove the "lay a
  phase" and "reopen a phase" cases; the reopen keeps its cap check. Add `refuseParkWhileBusy`.
- `ops.ts`:
  - start path (~:426): after the guards pass, set the plan task `in_progress` in the same
    write when it is not already. Check the claim semantics in `store.ts:282`: a plan task in
    progress is claimed by the lead's process. Make sure `task_take` and the keep-going guard
    (`phases.ts`, `claimHeldBy`) still read right.
  - lay path (~:312): no plan refusal.
  - park: a plan task moving `in_progress` → `pending` is refused while one of its phases is
    `in_progress`; the note is the caller's own.
- `task_list` scope plan: the state mark per plan, in number order. Keep `Phases n/cap` and
  `waiting n`.
- `src/tasks/work/phases.ts` / the keep-going guard: "mine" and "ready" stay keyed to plans
  with a phase in progress; check that an in-flight plan between waves is still named right.
- The tool descriptions and the server instructions (`schemas.ts`, `mcp.ts`): lay many plans,
  start one at a time, park by setting the plan pending.
- Tests that fail without each change, in a temp HOME.
- `docs/design/tasks.md`, the store sections.

### Phase T: the text (`plugin/` skills, README, CHANGELOG)
- `plan-task` § 4: after approval, when the work is several plans, write one plan file per
  plan, create every plan task, and lay every plan's phases and tasks with their briefs. The
  first plan starts; the others wait as queued plans.
- `plan-task` § 6: one plan in flight, others queued and laid out. Park = plan task to
  `pending` with a note, after its running phases stop. Resume = start a phase. This replaces
  the drop-based park text. A later ask goes as a task into the next queued plan: under its
  phase when one fits, else waiting under the plan.
- `plan-task` § 8: a parked plan stays open and `pending`, with its work intact.
- `build` § 1–2 and § 6: start phases only in the in-flight plan. The next plan starts after
  this plan's final review, fix pass and `task_done`. Name the start refusal and its two ways
  forward.
- `memory-routing` if it mentions park or queue; `README.md` task rows; `CHANGELOG.md` 4.9.0.
- `core.md` stays untouched: it is at its token budget.

Phases Q and T share no files and start together. Main session: version 4.9.0 in
`plugin.json` and both installers, `bun run build` (router.js must not change), the full check
and both validates, the final review (`senior-engineer`, `opus`, `xhigh`), one fix pass, and
the PR after the owner's yes.

## Edge cases

- **A 4.8.0 plan mid-build after the update:** its plan task is still `pending`, but a phase is
  `in_progress`, so it counts as in flight. Its next start sets the plan task `in_progress`.
- **A 4.8.0 plan between waves** (no phase in progress, plan task `pending`): it is not in
  flight. If another plan starts first, this plan simply waits. Lower risk: the default plan
  rule 3 points at the lowest-numbered plan with open phases, which is usually this one.
- **A 4.8.0 drop-parked plan:** its dropped phases stay dropped. Reopening them needs only the
  cap now, then a start follows the start rule.
- **Two own plans in flight** (a `task_take`): prefer the one with a phase in progress, then the
  lowest number. A start in the other one is refused and names the first.
- **Park while a builder runs:** refused until its phase is done or set back to pending.
- **Process restart:** the plan task's claim dies with the process. "In flight" reads the
  status, not the claim, so the plan stays in flight. `task_take` moves it.
- **Another session's plans** never count, as today.
- **The cap** stays per plan. Laying phases ahead fills each plan's own cap only.
- **A plan with laid phases that is never started:** it stays queued. `doctor` and `task_list`
  show it. No auto-cleanup.

## What could break

- Every caller of `activePlanOf`, `defaultPlanOf` and `refuseOtherPlan` (ops, list, the herdr
  binding update, the portal take action); `phases.ts` (keep-going), the status-line reader
  (`read.ts:71`, which sorts in-progress items first), builder-finish.
- A plan task now goes `in_progress`. Check every reader that assumes plan tasks stay `pending`
  until closed: the portal plan view, the status line, `planCounted`, `layerProgress`.

## Rollback

Release a new version with the 4.8.0 behaviour. The data is compatible both ways: plan tasks
in `in_progress` read as open in 4.8.0.

## How we prove it

- Tests:
  - three plans laid up front, a start in plan 1 only;
  - a start in plan 2 refused while plan 1 is in flight;
  - park plan 1 (refused while a phase runs, allowed after), then plan 2 starts;
  - resume plan 1 refused while plan 2 is in flight;
  - plan 1 stays in flight through its final-review fix pass, so an unnamed task goes to it;
  - 4.8.0 data (plan task pending, phase in progress) counts as in flight;
  - `task_list` marks;
  - keep-going "ready" with an in-flight plan between waves.
- `bun run check`, both validates, router.js unchanged.
- A live run on this machine after the update: lay two plans with phases; start plan 1; the
  plan 2 start is refused; park plan 1; plan 2 starts.
