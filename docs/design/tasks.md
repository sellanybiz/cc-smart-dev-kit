# The kit's task list (D75, D76)

D75 (2026-11-03, 1.10.0) replaces D68's split between claude-mem work state and Claude
Code's task list. The kit owns tasks; claude-mem keeps memory. The tools and the command
use the same operations. Setup denies the built-in task-writing tools, not background-job
controls such as `TaskStop` and `TaskOutput`. D68's history is in [claude-mem](claude-mem.md).

## Why two stores

Live work changes every minute. Every worktree must see it at once, without a commit for
every status change. Such commits would fill pull requests and invalidate review records.
Project obligations must instead travel with a branch, pass review, and reach teammates on
other machines. One local database cannot do that. So work tasks live locally in SQLite;
production, database, teammate and follow-up tasks live as Markdown files in the repo.
The task's kind selects its store, not a second set of tools.

## The subagent ledger in 2.0

The main session creates the plan task, one phase task per builder and each phase's steps.
A plan is one result that ships as one pull request and holds at most `plans.maxPhases`
phases (default 10). A phase is one area of the code with its own files; its steps are its
tasks, usually 3 to 10, each with a done-check. The phase description is the brief: goal,
files and boundaries, patterns and tools, and verification. Disjoint phases run in parallel
worktrees; `blocked_by` orders shared files. A session may lay phases in any of its plans, up
front, but runs one plan at a time: the plan in flight (§ Layers, Plan shape). A later ask waits
as a task under the next queued plan, in its phase when one fits.

Work tasks add four optional fields, set through `task_create` / `task_update` or the CLI:

| Field | Meaning |
|---|---|
| `agent` | The builder's name or id, used to resume it for fixes. |
| `branch` | Its git branch. |
| `worktree` | Its checkout path. |
| `base` | The commit the builder started from. |

`phase` remains the plan's phase id. `task_get` shows the fields; `task_list scope plan`
shows each phase's agent, branch, state and completed steps, such as `3/5`.

A builder writes a `Report:` note with its result and checks. The main session records
small decisions in `Ruling:` notes, asks a fresh reviewer to review each phase, merges it
into the plan branch (phase branches stay local), closes its task and starts what it
unblocked. One final whole-branch review runs on `opus`; then the plan's one pull request
opens.
After compaction, this ledger and git history prevent repeating finished work.

## The work store

A work task has a project-local number such as `#12`, a subject, Markdown description,
status (`pending`, `in_progress`, `done`, `dropped`), type (`blocking` or `non-blocking`),
parent, plan, phase, agent, branch, worktree, base commit, creator, claim and timestamps.
Dependencies name tasks it waits for; notes hold reports, rulings and other work records.

`src/tasks/work/` owns `<stateDir>/tasks/work.db`, using `bun:sqlite`. WAL (write-ahead
logging) lets readers run beside a writer. Writes use short `BEGIN IMMEDIATE` transactions
and a busy timeout. `PRAGMA user_version` holds the schema version; `min_compatible` records
the oldest compatible reader. Migrations only add to the schema, because an older plugin
folder can still have a running server. Schema 5 adds the process that made a task
(`created_pid`, `created_start`; null on a row made before) and an index on `task_notes(task_id)`:
a task stays its maker's across a `/clear` (below, Who a call belongs to).

The store enforces these rules, not the caller:

- Done requires every blocking task under it to be done or dropped (below). A refusal names
  what remains, and keeps none of the call's notes or evidence: they are written in the same
  transaction.
- A task blocked by an open task can neither start nor be done.
- A parent cycle, a blocked-by cycle, and a fourth layer are refused.
- A plan holds at most `plans.maxPhases` phases: `layPhase` refuses the one past the cap, in
  the transaction that inserts it. The other plan-shape rules (a phase starts only once it
  holds a task, one plan in flight, a step closes with proof) are enforced by the task tools
  (`ops.ts`), not the store: § Layers, Plan shape.
- Delete is for a mistake with no notes or tasks, not for finished work. A deleted task's
  number is never given again: its history still answers to it.

### Layers, types and blocked-by (D76)

The hierarchy is **Session › Plan › Phase › Task**. Plans sit at the top. A phase sits under
its plan. A task sits under a phase, directly under its plan while it waits for a phase, or at
the top; a task never holds another task. A top-level task may still belong to a plan: the
`plan` column decides membership, not the parent chain. A task without a plan is loose.
`placeValid` enforces new placements. `layerOf` returns the kind,
including for a stray nested task written by an older kit.

Schema v4 lifts old tasks to tasks under the nearest phase, or to the top for loose work.
This is a repair on **every write-mode open**, not just the version change: a still-running 3.x
session may write another nested task. Read-only hooks and the portal tolerate those rows before
the next repair. The repair takes the SQLite write lock and saves `work.db.v4.bak` through
`serialize()`, including committed write-ahead-log data, before the first move. It keeps notes,
claims and history, and records every parent change. An open blocking child becomes an explicit
blocker of its former parent, preserving the hold on completion. Original holds are saved before
any move, including holds reached through closed blocking tasks, then restored as dependencies. A pending former parent also
cannot start until its lifted blocking children finish. Work below a non-blocking task
inherits that type, so the lifted work does not start holding the phase. Old code can still read
the store (`min_compatible` stays 1). The snapshot is written to a temporary file and renamed
atomically. If it fails, the store opens read-only and writes report how to free space or fix
folder rights; no task is lifted. The next task call reopens a refused handle and tries again. A legacy parent cycle is broken by lifting its lowest-numbered **task**
member to the top, with a history event, before the remaining tasks are lifted. Plans and phases
never move. A cycle with no task-under-task link is left alone. Restored holds are checked against
existing blockers and completion holds so they cannot introduce a wait cycle.

**The type** says whether a task holds the one above it. A `blocking` task (the default) must
be closed before its parent is done. A `non-blocking` one (a nice-to-have, a later idea) holds
nothing. `holdingUnder` (`queries.ts`) is the one answer to "what holds this task": the open
tasks below it, reached through blocking tasks only, those in progress first. It never walks
into a non-blocking task, so a blocking task of a non-blocking task holds only that task.
It does walk on below a closed task, so a task closed early cannot hide open work under it.
`doneValid`, the builder's hand-back check (`builder-finish`) and the portal's phase steps all
use it.

**Blocked-by** (`blocked_by` on create, `blocked_by_add` and `blocked_by_remove` on update)
names tasks that must finish first. A task blocked by an open task cannot go to `in_progress`
or `done`; a blocker that is done or dropped lets it go. The check runs on the change of status
only, so a task already in progress when a blocker is added keeps going, and says it is
blocked. `addBlockers` refuses a blocked-by cycle, a task of another project, a task above
this one, and a task that already waits for this one through a parent: a parent waits for its
blocking tasks, so a task blocked by its parent, or by a task that waits for that parent,
could never start, and none of them could ever be done. That last walk follows both kinds of
wait (blocked-by, and a parent for the tasks that hold it), so the order the blocks were
added does not matter. Done is judged only on the move to done, so a done task's other fields
still change.

**The main session lays out its phases ahead of its builders.** `task_create` with `phase` (its
id: letters, digits, `.`, `_` and `-`, a letter or a digit at each end) makes the phase task
under the plan task, once per plan and phase (`layPhase`). A second call answers with the phase
that is there, says so, and names the fields it did not use. `plan` is the plan's slug; left
out, a phase goes to the default plan (below, Plan shape: the plan in flight, else the plan
being finished, else the next queued plan, else the plan of its latest own task that has one,
made or claimed by it, only while that plan is open). Never another session's
plan or an older open plan. A plan is
open when its plan row is pending or in progress; without that row, it needs an open blocking
task. A phase still needs a named plan when no plan is open.
**A work task with neither `plan` nor `parent` is always loose**, whatever plans are open: a
small fix needs no plan (`plan-task`), starting it is never refused by the one-plan rule, and it
never puts a plan in flight. A task joins a plan only through its `parent`, a phase or the plan.
The store checks under the write lock too, for a named plan or parent as well as the default,
and when `task_update` moves a task into a phase. That move takes the destination phase's plan;
moving to the top keeps the task's plan. An unchanged placement stays editable after closure.
To add work to a closed plan, reopen its plan row with `task_update`; otherwise create a loose
task with no plan or parent. Reads keep the latest own plan even after it closes. Only
`task_list` with `scope: "plan"` falls back to the project's newest plan, to show it.
`task_list` also takes `plan` (CLI: `--plan`) to select a slug. When the session owns several
plans, `scope: "plan"` without a slug lists them all with their counts.
`plan` alone, with no `parent`, makes the plan task and takes a subject only. To add a task
to a named plan, give its phase as `parent`, or the plan itself to make it wait there for a
phase; `plan` may also be given to check that membership.
Neither takes a `parent` or a `status`: a plan sits at the top and a phase under its plan, and
each starts pending. The four ledger fields (above) go on with it, or later with `task_update`.

**Plan shape** (`plan-guards.ts`, called by `ops.ts`, so the MCP tools and the `task` command
refuse alike). These guard a plan's shape; they are not a security gate, and they read the
checkout's working copy through the normal workflow resolver:

- **The phase cap.** `layPhase` counts the plan's phases that are not dropped (`livePhaseCount`
  in `queries.ts`: done ones count, dropped ones free their slot) and refuses a new phase id
  once the count reaches the cap, in the same write transaction that inserts it, so two
  sessions cannot both take the last slot. Laying an id that is there is only answered, at the
  cap too. The cap is the workflow setting `plans.maxPhases` (default 10; project over person
  over default), resolved by `ops.ts` through `resolvePlans` for the caller's checkout; a broken
  workflow file fails the call and names the file and field. The refusal says the plan, its count,
  the cap and where it came from, and the ways forward: a task under the phase that owns its
  files, or a task under the next plan (`parent` set to that plan's `#n`). The cap is the person's
  to raise: `workflow set` of it refuses inside Claude Code (`PLAN_KEYS`), and the refusal says to
  ask them. The cap is per plan, so phases laid ahead in several plans fill each plan's own cap
  only. A dropped phase that comes back (`task_update` to pending or in progress) is judged
  like a new one: by the cap alone (`refuseOverCap` in `store.ts`).
- **No empty phase starts.** Moving a phase to `in_progress` (`task_update`, `task start`) is
  refused while it has no task that is not dropped; the refusal names `task_create` with `parent` set to the phase.
- **Phases in any plan, one plan in flight.** A session lays phases (with their tasks) in any of
  its own open plans, up front; only the cap judges that, and a dropped phase that comes back.
  A plan is **queued** while its task is `pending`, and **in flight** while its task is
  `in_progress`: the store sets that itself, in the same write, when the plan's first phase or
  task starts (`task_update` or `task_create` with `in_progress`; the plan task is claimed by
  the starting process, as any started task). A plan started under 4.8.0, which never set its
  task, is in flight too while one of its phases is `in_progress` (`isInFlight` in
  `queries.ts`). A caller's plan in flight (`inFlightPlanOf`: an own plan, judged on the plan's
  own task `owns`) is normally one. After a `task_take` it may hold two: the one with a phase
  in progress counts first, else the lower number. Another session's plan never counts.
  A plan stays in flight until its own `task_done`, so its final review and fix pass belong to
  it, and the next plan cannot start before it closes.
- **The start refusal.** Starting a phase or task of a plan other than the one in flight
  (`task_update` or `task_create` with `in_progress`, the plan task's own start too) is
  refused while the caller has a plan in flight (`refuseOtherPlan`); the refusal names that
  plan and the ways forward: finish it (`task_done` on its `#n`), or park it in two calls
  (the plan task to `pending`, then a `parked:` note). For a plan started under 4.8.0, whose
  task never ran, it says to stop the running phase instead, since there is no status to set
  back. The refusal does not depend on owning the target: a queued plan the caller's process
  made under an earlier session id (`/clear`), or another session laid but never started, is
  judged too. Only a plan another process holds a live claim in (`claimState`: another
  session's running work), and a plan with no task, are left alone.
- **Park and resume.** **Parking** is the in-flight plan task going from `in_progress` to
  `pending` with `task_update`, then a `parked: <why>` note. It is refused while one of the
  plan's phases or tasks is `in_progress` (`refuseParkWhileBusy`): stop or finish it first.
  Nothing is dropped: phases, steps and briefs stay as they are, and the claim on the plan task
  goes. **Resuming** is starting one of its phases again, which is a start like any other (it
  waits while another plan is in flight). The order of plans is the person's: the skills take
  them in plan-number order, the store does not force it.
- **The default plan** (`defaultPlanOf` in `queries.ts`). A phase laid with no plan, and a
  `task_list` that names none, go, in order, to the plan in flight; else to the plan being
  finished (an own open plan whose phases are all closed, at least one done: its final review
  and fix pass; the newest such plan; this is how a plan started under 4.8.0 is read); else to
  the next plan in the queue, the lowest-numbered own open plan with an open phase; else to the
  plan of the caller's latest own task while that plan is open. Only the first counts for the
  start refusal. A plain task never takes it: with neither `plan` nor `parent` it is loose.
- **Waiting tasks.** `task_create` with `parent` set to a plan's `#n` makes a task directly
  under the plan (its `plan` column is set). `task_update` with `parent` set to a phase of the
  same plan moves it there; another plan's phase, and a move of an existing task up under a plan,
  are refused. An open step of a phase cannot leave its phase by `parent` to the top or under a
  plan (it would skip the proof below); it may move to another phase, and once closed it moves
  freely. An open blocking waiting task holds the plan's close like any child
  (`holdingUnder`, `doneValid`). The status line and `layerProgress` already read "a task of a
  phased plan under no phase" this way: it counts in no layer.
- **Moving a running task is a start.** `task_update` with `parent` that puts a task which is
  running, or starts in the same call, into another plan counts as a start in that plan: the
  one-plan rule refuses it while another plan of yours is in flight, and otherwise puts the
  destination plan in flight in the same write.
- **Steps close with proof.** A task whose parent is a phase closes `done` only with `evidence`
  and `dropped` only with a `note` on `task_done` (`refuseBareClose`); `task_update` cannot close
  one. A phase, a plan, a loose task and a waiting task keep the plain close, and the kit's own
  closes (a merge, an import) go through the store directly and need neither.
- **Where it shows.** `task_list` with `scope: "plan"` lists the plans in number order and
  puts each open plan's place in the queue in its brackets in place of the status: `in flight`
  (`isInFlight`), `finishing` (pending, every phase closed and one done: a plan started under
  4.8.0 at its final review), `parked` (pending, with an open phase and work started earlier:
  a phase done, or a note on its task that starts `parked:`), or `queued` (laid out, never
  started) (`planQueueState`). It also prints `Phases n/cap` on each plan, marks one over the cap as
  frozen, and adds `waiting n` for the open tasks directly under it. The status line shows the
  claimed task being worked on, as before, and the plan in flight when no phase runs between
  waves. `doctor`'s project checks print one `!` line for each open plan over the cap, with its
  fix. Readers that look at a plan task's status (`planCounted`, `layerProgress`, the portal's
  tree, `openPhasesOf`) read an `in_progress` plan the same way as a pending one: they count its
  phases and tasks, and the keep-going guard names the ready phases of the plan in flight and of
  plans that have a phase running.

**The store** keeps the type in `tasks.blocking` (1 or 0, default 1). Schema 2 adds the column
with `ALTER TABLE`; `min_compatible` stays 1, so a reader from 1.10.x still opens a store that
1.11.0 migrated. A 1.10.x writer adds tasks with the default, blocking, which is the 1.10.x
rule. No hook query names the column, and a row without it reads as blocking.

### Freed work

Blocked is computed, never stored: a task is blocked while a task it waits for is open
(`isBlocked`), so the store lets a freed task start by itself. What it did not do is say so.
Now every close answers with the work it freed. `task_done` and `task_update` to `done` or
`dropped` (and so the command's `task done` and `task drop`, which call the same operations)
end their answer with `· now ready: #12 Phase x, #13 Phase y: start them together` (one task:
`: start it`) when the close made work startable, and say nothing more when it freed none.

The freed work (`freedBy`, `src/tasks/work/queries.ts`) is each task or phase that had the
closed task as a blocker and now could start (`isStartable`: pending, no other open blocker, and
for a phase at least one task that is not dropped, the test the store's start applies), and that
is the caller's own (`ownerOf`: another session's task is never named). It is read after the
close, in number order, capped like the hooks' lists (`cappedHookList`, eight, then
`+N more: task_list`). A task already started or closed is not named, and neither is work in a
plan the store would refuse to start while another plan is in flight (`planInTheWay`, the rule
`refuseOtherPlan` refuses by); a loose task is always named. The keep-going guard
names the same work from the other side: `docs/design/hooks.md` § The keep-going guard.

### A task's history

Every write in `store.ts` adds one entry to `task_events`, in the same transaction as the
change, so the two land together or not at all. An entry holds the time, what happened
(`created`, `changed`, `noted`, `closed`, `deleted`), each field's value before and after
(subject, description, status, type, parent, the four ledger fields, claim, blocked by), and who
made it: the session id and name (the name Claude Code shows, read from its session record by
`callerOf`) and the Claude process. A change the kit makes itself (an import, or the import's
repair) carries its reason instead. A change that changes nothing adds no entry. Entries are
never edited, and the table has no foreign key on purpose: a deleted task keeps its history,
whose last entry holds the task as it was.

`task_get` and `task show` print it as a timeline, oldest first, from `history.ts`, and a
deleted task's too (`#12 "Subject" [deleted]`, then its history). A
description is long, so its line gives the length; `history: true` (`--history`) prints every
earlier description in full. A project task's history is its file's git log (`git log
--follow`, which tracks the move into `archive/`): who committed each change, and when. Old
code that writes to the store records no entries; 1.10.0 is the first release with the store,
so every store has the table from its first write.

### Who a call belongs to

`src/tasks/context.ts` is the one resolver of project key, checkout and task settings.
The project key belongs to the main checkout, shared by its worktrees. A folder outside
git uses its own real path. A git failure is an error, never a guessed identity. A broken
project config leaves local work usable.

A claim belongs to the Claude process: pid plus start time, not just a session id. A task is
the caller's own (`ownerOf` in `src/tasks/work/queries.ts`, the one rule the task tools and the
status line use) when it made it under its current session id, when its process claims it, or
when its process made it, under any session id. The store records the maker (`creator`: pid,
start time and the session id it made the task under, schema 5) and tests it with the same
`claimHeldBy` as a claim, so a queued plan made before a `/clear` is still in the caller's
queue, with nothing claimed yet. A task another process made is never the caller's by a claim
on one of its sibling tasks. A plan is the caller's by its plan task (`ownsPlan`): a step it
claims in another session's plan makes neither that plan its default plan, nor its phases
the stop guard's to start. A row made before schema 5 has no maker process and is its session's
own only. `task_take` rewrites the maker to the taker, and records the old and new maker in the
task's history (`made by`); a take made by an older kit version leaves the old maker in place
until the old version folders are gone. Off
Linux there is no start time, so a claim and the maker rule there also need the caller's
session id (`claimHeldBy`): a later process that gets a dead one's pid holds none of its claims,
and a `/clear` there drops the claims and the queue's ownership until the task is started again. The
server finds that process through ancestry and reads its current session record on each
call. The record supplies the session id and cwd, including a move into a worktree. Thus
`/clear` and a background fork keep the process's tasks. Another process's in-progress
work is marked as belonging to another session. Live proof of these Claude Code behaviours
is still owed in [the contract](../claude-code-contract.md).

A reopened session (`claude --resume`, `cc-smart-dev-kit sessions --open`) keeps its session id
in a new process, so its in-progress claims name a process that is gone. A claim like that is a
**resumed claim** (`resumedClaim` in `queries.ts`): the caller has a process and a session id,
the claim carries that session id, the caller's process does not hold it, and the claim's
process is not live. A live claim with the same session id (two processes opened one
conversation) is never the caller's. Every read that asks "is this my running work" counts a
resumed claim as the caller's (`claimIsMine`: the status line's rows, `claimState`, the keep-going
guard's phases); a question about who holds a claim now (a take's refusal, a claim's liveness)
keeps `claimHeldBy` alone. The next task call from the resumed session also moves the claims
(`reclaimResumed`, run by `createTaskOps` before the operation, any operation): each goes to the
caller's pid, start time and session in one write, and its history says the claim moved to the
resumed session's process. A dead claim of another session id stays free. `callerOf` reads only
its own ancestors' session records (`sessionRecordOf`), so another session's record that cannot
be read never blanks the caller's rows; the caller's own unreadable record still fails. A read
operation whose move fails still answers, with one line saying the claims were not moved and the
next call retries; a write fails loudly.

Two live processes of one conversation both count a dead claim as theirs until one of them makes a
task call, which moves it. A `/clear` keeps the process and gives the session a new id, so the
same step also re-stamps the claims the caller's process holds, and the open tasks it made, to the new
session id (with a history entry each). A later resume under that id then finds the work. Off
Linux, `claimHeldBy` needs the session id, so this re-stamp never fires there.

## Project tasks

`src/tasks/project/` owns one `<id>-<slug>.md` file per task under `tasks.dir` (default
`.claude/tasks`). An id is `T-` followed by six base32 characters. Closed files live in
`archive/`. If the same id has an active and archived copy, the archived one wins, so a
merge cannot reopen it just by bringing back the active file.

Front matter writes each value as JSON on its own line. This is a YAML-compatible form;
no general YAML writer is needed. `body` and `file` are reserved keys, not metadata.

```markdown
---
id: "T-abc234"
title: "Check the database after release"
kind: "database"
status: "open"
when: "next-release"
weight: "after-deploy"
flags: ["needs-yes"]
created: "2026-11-03"
from: "plan release-work, phase database, branch worktree-database"
refs: ["docs/database.md"]
---

## What and why

Explain the obligation, not just its title.

## Steps

## How to check

## If it goes wrong

## Log
```

The headings are suggestions, not a required template. The body is free Markdown.
`kind` is `production | database | teammate | follow-up`; `status` is `open | done |
dropped`; `when` is `now | next-release | any`; `weight` is `blocks-release | after-deploy |
owner`. Flags describe risk: `needs-yes`, `twice-safe`, `spends-money`, `real-people`,
`destructive`. `created` and optional `closed` are calendar dates (`YYYY-MM-DD`); `from` is an optional
origin string naming plan, phase or branch. Optional `evidence` is a string; omit unset
fields rather than writing null. References and evidence keep the task understandable later.

### The life of a project task

- Create writes in the session's checkout, a builder's worktree included, so the task ships in
  that branch's commit and pull request.
- `task list --branch [--base <branch>]` lists task files changed against the base for the
  pull request's notes and still-owed sections. `task list --branches` finds open tasks on
  local branches not yet merged.
- `task release` lists production and database obligations by weight, every next-release
  task, and tasks that already missed a release. It does not execute their steps.
- One close call records status, date, evidence and a log entry, then archives the file.
- Teammate tasks are acknowledged per machine. `task done` means done here;
  `--for-everyone` closes the shared file. An acknowledgement is not evidence that another
  machine completed the task.
- `task check` finds stale open tasks (`tasks.staleDays`, default 30), missed releases,
  missing reference paths, duplicate titles, broken files and new notes in
  `tasks.legacyFolders`. Findings make the command exit 1. Doctor uses the same check.
- `task import notes` copies old open notes into task files; `--since` limits their date.
  It keeps the body. Removing the old files belongs to the project's own reviewed change.

## The server, command and guards

`cc-smart-dev-kit task mcp` runs the stdio MCP server. Its official SDK is isolated in
`plugin/dist/tasks-mcp.js`, not `cli.js`. The tools are `task_create`, `task_update`,
`task_done`, `task_note`, `task_list`, `task_get`, `task_search`, `task_delete`, `task_take`.
The CLI exposes the same operations, including import, branch lists, checks and release
lists; [README](../../README.md) lists their arguments. `task_get` and `task show` cap
long output and accept an offset. Search uses SQL `LIKE`, not FTS5.

### The hooks and pages that read it

Hooks open the work database with `PRAGMA query_only`, a short busy wait and fail-open handling
(`src/tasks/work/db.ts`). A read-write open with query-only mode also works when a WAL file has
no writer holding it open. Three hooks read it ([hooks](hooks.md) has each one's rules):

- `task-start` (SessionStart) is machine-wide. At every start, clear and compaction it adds one
  block of the project's open work tasks, without descriptions, at most eight lines
  (`START_TASK_LIMIT`) and "+n more". This process's own claimed tasks come first (a resumed
  claim, one its session left in a process that is gone, counts as its own), then the ones in
  progress, then the most recently touched. A task untouched for `tasks.staleDays`
  (default 30) is not listed but counted in one line, unless this process claims it. Until
  registration exists, the hook says to run setup.
- `keep-going` (Stop) holds the main session's turn end once per stalled state while a phase
  of its plan is in progress and nothing runs, or while the plan in flight has ready phases
  and none runs. The same reason already given, with no subagent started or resumed since,
  keeps it silent. It names the agent to resume with `SendMessage`,
  or says to start a fresh builder, then every ready phase to start together, closing with `task_done`, or
  recording a blocker with `task_note` and a `Waiting for:` line, and warns against moving a
  phase back to pending to end the turn (`docs/design/hooks.md` § The keep-going guard).
- `builder-finish` (SubagentStop) holds a builder's hand-back once while its phase task still
  has open blocking steps (`holdingUnder`).

`planProgress(paths, project, who)` reads the current in-progress claimed item, its plan, its
phase (the item itself, or a task's parent phase), and two counts of closed (done or dropped) out
of all: the plan's **phases**, by the `plan` column, and the current phase's **tasks**, by parent.
A plan with no phase counts its own tasks by the `plan` column instead, so a lead that lays phases
without steps still sees 5/25, and nothing counts twice. The most recently started claimed item
wins; notes and edits to an older plan do not steal the status line.
The status line prints a row per layer, each title whole: `Plan · <title>` (the slug when the plan
row is gone; then `· 2 queued, 1 parked` when the session's other open plans wait, counted by
`waitingPlans` with the task tools' own `ownerOf`), `Phases 5/25 · <phase>` when the plan has phases, and `Tasks 1/3` with the current
task's title when it is one; a task of a phased plan under no phase shows its title alone on the
last row instead (a task waiting directly under its plan is one). Such a task counts in no layer: the plan counts its phases. An empty plan shows
`Tasks 0/0`. A loose task shows its title alone,
without totals. With no current work, the task rows are absent. Plan counts in `task_list` and the
portal use the same rule (`layerProgress`). A phase's subtree counts and blocking steps stay
separate: progress says how much work closed, and `holdingUnder` says what holds completion.

**Take-over.** `task_take {task: "slug-or-#n", from?: "session", force?: true}` and
`task take <plan-slug|#n> [--from <session>] [--force]` move a plan and every member of it, or
one task, into the calling session. A phase alone cannot move. One `BEGIN IMMEDIATE` transaction
checks the project, optional source session and every claim before changing anything. A live
claim refuses and names the session; `force` takes it and says so. A dead claim needs no force.
Linux checks both pid and start time; elsewhere a reused live pid needs force. Each row's history
keeps both session ids. A caller with only a session id gets ownership but no process claim;
a caller with no identity cannot take work.

The portal shows the list read-only, on a Tasks tab of its own (`/tasks`, from `/api/tasks`):
each project's work tree as plan › phase › task, its open work and what closed in the
last seven days, each row with its layer, type, blockers and progress, each phase with its
ledger, then the open task files by kind, stale ones marked. Filters narrow it to one project,
blocked work or non-blocking work, and keep each match under the tasks above it. A project's
page keeps a one-line card that links there. Both read again on the live stream's `tasks`
event, which fires when the store's file or its write-ahead log changes ([portal](portal.md)).



## Setup and the move from older lists

[Setup](setup.md) owns registration, permissions and the managed settings, with restore
support. Run `cc-smart-dev-kit setup` after updating, then restart Claude Code. Setup
registers the launcher-backed server at user scope with `alwaysLoad: true`, asks for the
allow entry, denies the five built-in list tools, withdraws its D68 opt-in, and turns off
claude-mem work state. claude-mem seeds `"true"` itself, so only a `"true"` set after setup wrote
`"false"` is the person's, and stays.

Run `cc-smart-dev-kit task import claude-mem` once to move open lists. Each list becomes a plan
with one phase; its items become tasks under that phase. claude-mem keeps
lists per project, named for the folder, so the import reads the project named for the
current folder (`--project` selects another stored one) and writes into that folder's kit
project. It reads claude-mem's database read-only and refuses an unknown schema. It folds the
work-state rows as claude-mem 15.5.0 does: in its order (by entry time), with the project
name matched in any case, an entry with an empty item name as the list's own record, and
`done`, `dropped`, `completed` and `failed` as closed. Each task keeps claude-mem's first and
last entry times, so `tasks.staleDays` hides an old one; its history says when the kit
imported it. A name longer than a subject may be is cut, and kept whole in the description.
`--dry-run` makes every write and rolls them all back (`writeWork`'s `rehearse`), so it
refuses what the real run refuses.

claude-mem keeps its own data in work state too: `my-focus`, `my-rules` and
`agent-lifecycle` (written as each subagent ends), and `owner-goals` with `owner-goals/<start>`
for each past month. Those are not anyone's work, so the import leaves them out and says so.
1.10.0 took them in; a later run drops the open tasks an earlier import made from them, with
what is under them and an automatic note. A task a session made under the same name stays:
only a task whose history starts with the import counts. A list with an open task a session
made or changed under it stays open, and the run names those tasks: they may be someone's
work. The repair runs even when claude-mem's database is gone.
Doctor checks registration, permissions, the memory switch, work-store schema and
integrity, and project-file findings. It does not replace the live checks in the contract.

## Not yet

FTS5 search, database snapshots, hand ordering, a Claude Code task-panel mirror,
cross-machine sync of live work, and editing tasks from the portal are not built yet.

`GET /api/tasks/<id>` returns `{task, notes, events}` from the read-only store (`read.ts`).
The internal id is the tree row's `id`, not its project-local `#n`. `WorkTaskNode` carries
`session` (creator/owner), `parentId`, `claim` (`live`, `dead`, `none`), and `notes` / `events`
counts. `task.take` takes `{task, session, from?, force?, confirm?}` through the CLI's own
operations. The destination must be a named live session; an unknown one changes nothing.
A forced move also needs `confirm: true`.
