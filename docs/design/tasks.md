# The kit's task list (D75, D76)

D75 (2026-11-03, 1.10.0) replaces D68's split between claude-mem work state and Claude
Code's task list. The kit owns tasks; claude-mem keeps memory. The tools and the command
use the same operations. Setup denies the built-in task-writing tools, not background-job
controls such as `TaskStop` and `TaskOutput`. D68's history is in [claude-mem](claude-mem.md).

## Why two stores

Live work changes every minute. Every worktree must see it at once, without a commit for
every status change. Such commits would fill pull requests and invalidate review records.
A step owed around a deploy must instead travel with a branch, pass review, and reach teammates
on other machines. One local database cannot do that. So work tasks live locally in SQLite;
deploy tasks, for prod and for staging, live as Markdown files in the repo (5.0.0 made them the
only project tasks).
The task's kind selects its store, not a second set of tools. What belongs where, for Claude, is
the `tasks` skill (`plugin/skills/tasks/SKILL.md`): the one home of task knowledge.

A finding that belongs to the plan is covered by the plan, as a task under the phase that owns
it. One outside every plan is never a task. The main session asks the person at once; a yes files
a GitHub issue (on by default) and hands it to the lead's follow-up child. A subagent, or any
Herdr child, lists it in its report instead. Without GitHub the finding goes in the end-of-turn
summary. See `docs/design/herdr.md` § Follow-up children.

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
small decisions in `Ruling:` notes, checks each hand-back against the branch (no reviewer
reads a phase), merges it into the plan branch (phase branches stay local), closes its task
and starts what it unblocked. One review runs per plan, in two rounds on `opus`, plus a final review when round 2's fixes are big; then the
plan's one pull request opens.
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
a task stays its maker's across a `/clear` (below, Who a call belongs to). Schema 6 adds a plan's
file list and its reservation (below, Plans handed to children).

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
never move. A cycle with no task-under-task link is left alone.

The repair restores a hold only where `addBlockers` would accept it. Both read the one task graph
(`work/graph.ts`: `TaskGraph` and `blockRefusal`), so a hold the store refuses is never written
back: not one on a task above, not one that would close a wait cycle, not one the blocker already
waits for through a parent. The repair reads each project's tasks once, before the moves, and
brings the graph to where the moves left it; every hold it restores is added to that graph, so the
next hold is judged with it. Each hold it skips adds one `noted` entry to the task's history, with
the lift's reason and the task that was refused. A hold already stored is never deleted.

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
added does not matter. The three refusals are checked in that order (above it, then a cycle,
then through a parent), after the unknown-task and other-project checks, so a block that breaks
two of them says the first. `blockRefusal` in `work/graph.ts` is the one home of these rules; the
lift's repair uses it too. Done is judged only on the move to done, so a done task's other fields
still change.

A store an earlier release already lifted may still hold a block on an ancestor, which the repair
used to restore: neither task can then be done. The repair never deletes a hold, so `doctor`'s
project checks print one `!` line for each open task blocked by an open task above it, with the
fix (`task_update` with `blocked_by_remove`). The check only reads (`ancestorHoldChecks`).

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
  task, is in flight too while one of its phases is `in_progress`, and so is a plan whose work
  another session started (`isInFlight` in `queries.ts`: a phase or a step of it is `in_progress`,
  whatever its own task says). Only a session's work counts: a running task no session made and
  no process claims, such as an imported item, puts no plan in flight (§ Setup and the move from
  older lists). A caller's plan in flight (`inFlightPlanOf`: an own plan, judged on
  the plan's own task `owns`) is normally one. After a `task_take` it may hold two: the one with
  work in progress counts first, else the lower number. Another session's plan never counts.
  A plan stays in flight until its own `task_done`, so its review rounds, any final review and their fixes belong to
  it, and the next plan cannot start before it closes.
- **The start refusal.** Starting a phase or task of a plan other than the one in flight
  (`task_update` or `task_create` with `in_progress`, the plan task's own start too) is
  refused while the caller has a plan in flight (`refuseOtherPlan`); the refusal names that
  plan and the ways forward: finish it (`task_done` on its `#n`), or park it in two calls
  (the plan task to `pending`, then a `parked:` note). For a plan whose task never ran, there is
  no status to set back, so it says to stop the work running in it instead: the running phase of
  a plan started under 4.8.0, or else each running task by `#n` (`stopOrPark`). The refusal does not depend on owning the target: a queued plan the caller's process
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
  finished (an own open plan whose phases are all closed, at least one done: its review
  rounds and fixes; the newest such plan; this is how a plan started under 4.8.0 is read); else to
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
  one. A plan, a loose task and a waiting task keep the plain close, and the kit's own closes (a
  merge, an import) go through the store directly and need neither. A phase has its own rule,
  below.
- **A phase closes with its work in the plan** (`refuseEmptyHandBack`, on `task_done` and on
  `task_update` to done). When the phase records its builder's `branch` and `base`, the close needs
  at least one commit in `base..branch`, and `branch` must be reachable from the plan task's
  `branch` (`git merge-base --is-ancestor`). With no plan branch recorded, only the commit count is
  judged; with no `branch` or `base` recorded, nothing is. Git that cannot answer refuses with its
  own reason: a guess would close a phase with none of its work. `base` must be the commit the
  builder started from, not a branch name that moves on (`main..branch` counts nothing once the
  branch has been merged into it). A branch merged by a squash is refused: its commits are not in
  the plan branch, so merge the builder's own commit (`/cc-smart-dev-kit:build` § 5). A dropped
  close and a phase already done pass. Nothing checks the form of `base` when it is written: any
  name git reads is taken, a short sha too, and only a name that starts with `-` is refused, at
  the close.
- **A stale brief warns, never refuses** (`staleBriefWarning`, `plan-guards.ts`). A phase that
  starts with a `base` gets one more line in the answer when commits reached `origin/<default>`
  (the default branch from `baseBranch`, first parent, so a merge counts when it landed) after the
  phase's description was last written (its history) and changed any of the plan's files. The line
  names the files and the newest commit. One `rev-parse`, one `git --version` and one `git log`
  with the plan's paths as literal pathspecs; nothing is fetched. A commit counts by its own
  commit date, so a commit fast-forwarded onto the default branch keeps the date it was made, and
  one dated before the brief is not named. Git 2.38 and newer filters by that date
  (`--since-as-filter`), so such a commit at the tip never hides the changes behind it; an older
  git, or one whose version cannot be read, gets `--since`, which stops at the first older commit.
  No description, no files, no checkout and no `origin/<default>` add nothing; git that fails says
  so in the line.
- **The tools say these rules.** `task_create`'s `phase` field states the phase id rule
  (`PHASE_RULE` and `MAX_PHASE`, `words.ts`, the words the refusal uses), that a phase takes no
  parent and starts only with tasks; `task_update` says a phase takes no parent; `base` says what it
  accepts. Each is built from the constant, never typed twice.
- **Where it shows.** `task_list` with `scope: "plan"` lists the plans in number order and
  puts each open plan's place in the queue in its brackets in place of the status: `in flight`
  (`isInFlight`), `finishing` (pending, every phase closed and one done: a plan started under
  4.8.0 at its review), `parked` (pending, with an open phase and work started earlier:
  a phase done, or a note on its task that starts `parked:`), or `queued` (laid out, never
  started) (`planQueueState`). It also prints `Phases n/cap` on each plan, marks one over the cap as
  frozen, and adds `waiting n` for the open tasks directly under it. The status line shows the
  claimed task being worked on, as before, and the plan in flight when no phase runs between
  waves. `doctor`'s project checks print one `!` line for each open plan over the cap, with its
  fix. Readers that look at a plan task's status (`planCounted`, `layerProgress`, the portal's
  tree, `openPhasesOf`) read an `in_progress` plan the same way as a pending one: they count its
  phases and tasks, and the keep-going stop names the ready phases of the plan in flight and of
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
`refuseOtherPlan` refuses by); a loose task is always named. The keep-going stop
names the same work from the other side: `docs/design/hooks.md` § The keep-going stop.

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
earlier description in full. A deploy task's history is its file's git log (`git log
--follow`, which tracks the move into `archive/`): who committed each change, and when. Old
code that writes to the store records no entries; 1.10.0 is the first release with the store,
so every store has the table from its first write.

### Who a call belongs to

`src/tasks/context.ts` is the one resolver of project key, checkout and task settings.
The project key belongs to the main checkout, shared by its worktrees. A folder outside
git uses its own real path. A git failure is an error, never a guessed identity.

**A project file this kit cannot use stops every task write up front** (6.7.0). Before, a session
on an older kit could make a plan task and then have `task_update` of its files refused by the
project's `requires`, which left half a plan. Now `contextOf` keeps the project-file error beside
its message, with the file when the error is a `requires` this kit does not meet
(`CcSmartDevKitVersionError`), and `taskWriteRefusal(read, env)` (`context.ts`, the one home of the
gate) turns it into a reason and a fix. `createTaskOps().run` (`ops.ts`), the one path for the MCP
server, the `task` command and the portal's actions, asks it right after `taskContext`, before
the store is opened or a claim moved (`reclaimResumed`):

- every write (create, update, done, note, take, delete) throws `Task writes are refused: <the
  file's error>. <fix>`, and nothing changes;
- a read (get, list, search) answers and adds the same text as a line of its own; a list of
  project or all scope and a search also say `Deploy tasks were not read.`; a read still moves the
  session's own claims to its new process, which is bookkeeping, not a task write.

The fix for a broken file is `Fix that file; task reads still answer.` For a `requires` the kit
does not meet, it reads the installed version (`findUserInstall` on Claude Code's
`installed_plugins.json`, the reader `doctor` uses): when that version differs from the running
one and meets the file, `The kit on disk (<version>) already meets it: restart this session to
load it.`; when it is known and does not, `After an update, restart this session to load it.`;
when it is unknown, both. herdr checks the same gate (`openPlansWorld` in `src/herdr/plans.ts`,
and `startChild` and `adoptPlans` in `src/herdr/command.ts`), so `plans`, `plans --reserve`,
`plans --release`, `start --task`, `start --plan` and `adopt` reserve, launch or move nothing
under such a file. `task import claude-mem` (`src/tasks/command.ts`), the one store writer outside
`ops.ts` and herdr, asks the same gate before it opens the store; its `--dry-run` writes nothing,
so it still answers. A folder outside git has no project file, so no gate.

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
process is proved gone (`claimGone` in `identity.ts`: its pid no longer runs, or on Linux the pid
now has another start time). A claim whose process may still run is never the caller's, even
when its liveness cannot be proved (a record with no start time): two processes that opened one
conversation never pass a claim between them. The price: where there is no start time to compare
(off Linux, or a record without one), a dead claim whose pid an unrelated program now runs stays
put until that program ends; `task_take` moves it sooner. Every read that asks "is this my running work" counts a
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
same step also re-stamps the claims the caller's process holds, and the open tasks it made, to
the new session id (with a history entry each). A later resume under that id then finds the
work. The re-stamp needs a task call under the new id: a `/clear` followed by an exit, with no
task call between them, leaves the claims under the old id, and a resume under the new one does
not find them (nothing links the two ids once the process is gone). The step covers every
project in the store, not only the one the call is in: a session
that works in two repos keeps its work in both. When the session record gives no process start
time, `claimHeldBy` needs the session id too, so the `/clear` re-stamp never fires; the
resumed-claim move still does.

## Plans handed to children

A lead can give a queued plan to a linked Herdr child session (5.2.0). The store holds what makes
that safe: the plan's files, an atomic reservation, and the warnings that tell each session which
other plan shares its files. **An overlap warns and never refuses** (6.7.0, the owner's ruling:
"always warn, no block option"): two plans that share files may run at once, and the git merge,
with the catch-up of the plan that merges second, settles it (`plugin/skills/build/SKILL.md` § 6,
"An overlapping plan"). No setting brings the block back.
The commands and the live gates are `docs/design/herdr.md` § Handing out plans; the modes are
`plugin/skills/build/SKILL.md` § Lead + children and coordinator modes.

**Schema 6** adds the table `task_files(task_id, path)`, which deletes with its plan
(`ON DELETE CASCADE`, so an older kit's plain `DELETE` of a plan takes the rows with it), and five
columns on `tasks`: the lead (`lead_session`, `lead_pid`, `lead_start`), the holder kind
(`lead_child`: 1 when a child builds the plan, 0 when the lead does) and the hand-out id
(`lead_handout`). A plan is reserved when `lead_handout` is set. The step is additive:
`min_compatible` stays 1. The lead moves like the maker (`created_by`): to the new session on a
`/clear`, to the new process on a resume, on a closed plan too. The hand-out id never moves.

**Files.** `task_create` and `task_update` take `files` for a plan task only (CLI: `--path`, repeated;
`--no-files` clears). Each path is repo-relative with `/`, a folder ends in `/`; `./` and `\` are
tidied, and an absolute path, `..`, the root, a control character and `*` or `?` (a wildcard
would overlap nothing; `[` and `]` are plain characters of a name, as in `app/[id]/page.tsx`) are refused. The rule is `normalizeRepoPath` (`src/workflow/repo-path.ts`),
the one `plans.mergeFiles` follows too. The list replaces the stored one and
is in the task's history (`files` and `lead` are history fields). `task_get` prints a `Files:` line
and, for a reserved plan, `Reserved for: session … (a child builds it | the lead builds it) ·
hand-out id …`. A folder written without its `/` is refused by the ops, which stat the working
copy. `filesOverlap` (`queries.ts`, the one home) says two paths overlap when they are equal or
one is a folder holding the other. Paths in `plans.mergeFiles` take no part, and case folds when
`core.ignorecase` is on, both read by `planFilesCheck` (`files-check.ts`) before any write lock,
from the committed copy only (`docs/design/workflow.md`). Inside a `plans.appendOnly` folder
(6.3.0, a folder where plans add new files, such as a migrations folder) a path overlaps only the
same file named exactly: no folder entry holds it, whether that folder, one inside it or one around
it, so `db/` still holds `db/schema.ts` but not `db/migrations/3.sql`. A shared file inside such a
folder that every plan edits (a migrations journal) clashes only when both plans list it by name,
so list it in each plan that edits it. `planFilesCheck` reads it in
the same read of the committed file as `mergeFiles` (`resolvePlanFiles`); a file it cannot read gives no folders, so more paths
overlap, never fewer.

**Stacked plans** (schema 7, 6.3.0). A plan names the plan it is built on in `stacked_on` (its
slug; `task_create` and `task_update`, CLI `--stacked-on`, `--no-stack` clears it). Every overlap
judgment (`reservePlan`, `heldOverlaps`, `flightOverlaps`, and `herdr plans`' lines and
drift) first takes the held plans through `rivalsOf`, which drops the plan itself and its stacked
pair (`isStackedPair`): the plan it is stacked on, or one stacked on it, while that parent holds
its files (`parentHolds`): open (pending or in progress), or done and still reserved until its pull
request merges (a plan built on its parent's branch shares those files by construction, so judging
the pair then would only warn about the plan the stack exists for). Only that
one plan is skipped: a plan stacked on a stacked plan still meets the first parent, and every other
plan is warned about as before. Once the parent is released (its pull request merged or closed, or the plan
dropped, which releases it) it holds nothing, so the stack ends with it.

A stack silences a warning, so it is never taken on a session's word alone (6.3.0 fix). **Same lead:**
the store refuses a stack unless the caller leads both plans (`leadsPlan`: it holds the plan's
reservation, `isLead`, or owns its task, `ownerOf`). The reservation counts because a plan handed to
a child becomes the child's task once the child takes it, while the lead stays in its `lead_*`
columns; the lead stacks its next plan on its own held plan. The lead is asked again each time the
overlap is judged (`sameLead`, in `isStackedPair`): each plan's lead (its reservation's lead, else
the session that owns its task) must lead the other plan too, so a take that moves either plan to
another session ends the pair. Clearing a stack only adds checks, so anyone may.

**Proved, per pair.** A pair counts only when that very pair `{stacked plan's id, parent's slug}`
is proved (`provedStacks`, `src/tasks/stack-proof.ts`): a proof of the same plan on another parent
proves nothing. It is read from git before the write lock the way `planFilesCheck` is, from the task
rows **as the call will write them** (`asWritten` in `ops.ts`: the call's own `stacked_on`, `base`,
`branch` and `status` applied), and passed in as `FilesCheck.stacked` (the task tools, for a held
plan's new list or stack and for a start into flight, a create that starts included) or
`ReservePlan.stacked` (`herdr start --plan` and `plans --reserve`, which read it in `judgePlans`). So
a call that moves a stack to another parent, or sets a base and starts, is judged on what it writes.
The proof uses fork points. The default branch comes from `baseBranch` (`worktrees.base`, else
`origin/HEAD`); when it is only guessed nothing is proved. With T the parent's recorded branch tip
(`refs/heads`, then origin) and D `origin/<default>`:

- **The parent has work of its own:** T is not an ancestor of D. A parent with no commit past the
  default branch yet (or whose work already merged) proves nothing, and the fix says to wait for
  its first commit.
- **Its work has a lower end:** the parent's recorded `base` (where it started; the build skill and
  the herdr child brief both record it) and, when the parent is itself stacked on a plan that
  records a branch, that plan's branch tip G. A parent with no base git knows proves nothing.
- **The start shares it:** S is the commit a `herdr start` resets the child to, else the stacked
  plan's recorded `base`. Every fork point of S and T (`git merge-base --all`, so a criss-cross
  history cannot pick a lucky one) must be a commit of the parent's own first-parent line above
  its base (`git rev-list --first-parent <base>..T`), and an ancestor of neither D nor G. So a
  commit only missing from D (an unpushed default-branch commit, the grandparent's work in a chain
  of stacks, or a branch the parent merged in) never counts as the parent's own. This holds when
  the parent keeps building or merges the default branch after the stacked plan started, and
  when the start is the parent's own merge commit; it fails when the parent is rebased (the fork
  point then sits on D or under the parent's start). The base must be the exact commit the
  parent's branch was created from, not its fork from the default branch: a parent built on an
  unmerged branch would otherwise count that branch as its own line.
- **The stacked plan is built on it, on its own branch:** its recorded branch is never the parent's,
  and S must be an ancestor of that branch's tip. A start that is only recorded (its `base`, not a
  `herdr start` about to happen) counts only with that branch recorded; `herdr start` records the
  branch at launch, so a child it started keeps its proof. A base written down without building
  on it proves nothing.

A parent with no branch git knows, a start that names no commit, and any git error all leave the
pair as rivals: it fails closed, so the pair is warned about. When the grandparent is finished (it holds no files) and its
branch is gone, as after a squash merge, the fix clears the parent's stack on it rather than asking
for a fetch; the parent's own base still fences a wrong start. A stacked pair with one fork point
costs nine git calls (T, T on D, the parent's base, S, the fork points, the parent's first-parent
line, the fork point under D, the stacked plan's branch tip, S in it), two more when the parent is
stacked on a plan with a branch (G, and the fork point under G), two fewer for a start `herdr
start` gives before any branch is recorded, one or two more for each further fork point, and one
more for each branch read from origin. D is read
once per judgment, and the task tools read the default branch once more (two calls). A pair with
two leads runs none, and a project with no stack runs none at all. The store refuses a stack on a task that is not a plan,
on itself, on a slug with no plan, on a plan the caller does not lead, and one that
closes a loop. Setting or clearing a stack on a held plan is judged like a new list, so clearing it
while the two held plans share files warns. A plan another plan is stacked on is not deleted
until that stack is cleared, so a new plan made under the same slug never inherits it. The column
is additive (`min_compatible` stays 1); an older kit never reads it and judges the pair as an
overlap, which only says more (a kit before 6.7.0 refuses it). `task_list`, `task_get` and the answers show `stacked on <slug>`
in a plan's brackets; `herdr plans` shows `(stacked on <slug>)` after the plan's name.

**Held.** `heldPlans` is every plan with a reservation, whatever its status, until it is released,
plus every open plan in flight of **any** session, so a solo session's plan counts. A held plan's
files are its stored list plus, for a plan with a recorded branch, the branch diff the caller read
before the transaction (`extraFiles`). `task_update` of `files` (or `stacked_on`) on a held plan
is judged against the other held plans, from stored lists only, in the transaction
(`heldOverlaps`). A held plan with no stored list and no branch diff holds nothing a check can
find, and unknown is never clear: a reservation or a hand-out beside it gets an
`Overlap unknown:` line that names it and the fix (`task_update` on it with files), and no note,
since there are no paths to note. A plan already in flight when 5.2.0 is installed has no list, so
it reads this way.

**`reservePlan`** runs inside `writeWork`. It refuses a caller that does not own the plan or has no
session, a plan that is not pending, one that is already reserved, one with no file list (`has no
file list: set it first (task_update with files), so overlaps can be checked`: later plans can be
compared with it only through its list), and one with an open blocker (the store's view). Each
refusal names its reason. An overlap with a held plan, and a held plan with no file list and no
branch diff, never refuse: each goes into `ReservePlan.found` for the caller to warn about. Two
reservations at once both pass, and the second reads the first's write, so it finds their
overlap. On success it writes the lead, the holder kind and a new hand-out id.
`releasePlan` clears all five columns, guards the hand-out id and `updated_at` it was given (so a
plan handed out again meanwhile is left alone) and is idempotent: releasing a plan that is not
reserved changes nothing and adds no history. A **drop releases by itself; a done plan does
not**: it keeps holding until `herdr plans` releases it once its pull request merged or closed.
`swapPlanAgent` is a compare-and-set, a write that succeeds only if the value is still the one the
caller read. It lets one start claim a plan's `agent` (herdr's resume). `adoptLeadPlans` moves the
leads of plans whose lead has ended.

**The lead's own plan.** In lead + children mode the lead reserves its own plan with holder `self`,
through the same `reservePlan` and the same gates as a hand-out (`herdr plans --reserve <plan>`,
`docs/design/herdr.md` § Handing out plans), and then starts it as usual. Unlike a plan held only
by being in flight, it stays held after it is done, until its pull request merges or closes
(`docs/design/herdr.md` says when a pass releases it with no pull request).

**The take.** A reserved plan is taken only when `from` names the hand-out id or the current lead
session, when the taker already owns the plan, or when the person passes `force`. Then each row
must have been made by the taker, by `from`, by the lead's process, or by a maker proved ended
(`sessionEnded`), so a dead child's plan can be resumed, and a taken, unstarted plan with a live
maker is still refused for a second taker. An unreserved plan takes as before.

**The start.** `refuseOtherPlan` and `planInTheWay` also refuse starting work in a plan reserved
for another lead or owned by another session, with the hint to take it first with the hand-out id the
brief names. The lead never starts a plan whose holder is a child, owned or not: release it first
or let the child build it. Every existing refusal and message is unchanged.

**The solo first start.** A plan going into flight is judged in the same write
(`flightOverlaps`, `store.ts`), over stored lists with the same `filesOverlap`, against every
held plan but its own: a plan reserved for another lead or child, or in flight in another session.
Any task of the plan that starts puts it into flight, so any of them is judged (`enteringPlan`): its
own task, a phase, a step, a task created already running, and a running task moved into it,
whoever owns the plan (`insertTask` and `applyUpdate` share the one check). A plan already
in flight is not judged again. The `plans.mergeFiles` and case read (`planFilesCheck`) is taken
before the lock, once for each such start and never for a step in a running plan. The start goes
through, and each overlap goes into `FilesCheck.found`. A plan with no list beside a **reserved**
plan cannot be compared with it, and that is collected too; beside another session's unreserved
plan alone it is not. The plan's own reservation, as the lead's `self` or a child's take of its
hand-out, never counts against it.

**The warning and the note** (`warnOverlaps`, `src/tasks/files-check.ts`). After the write lock,
the caller turns what the write collected into one line for each pair of plans and set of shared
paths, for its answer: `task_create`, `task_update` and a start, through the task tools and the
`task` command, and `herdr plans --reserve` and `herdr start --plan`. The same text is saved as a
note on **both** plans, once (`addNotesOnce`, keyed by the note's head; a wider or narrower set of
shared paths is a new note). The note is written without moving the plans' `updated_at`
(`saveNote`): another lead's `releasePlan`, `swapPlanAgent` and herdr's hand-out grace key on it,
and a note is no move of the plan. The text, in this order:

- the head: `Overlap: #<n> "<subject>" and #<m> "<subject>" share <paths>.` (`overlapSummary`,
  the words `herdr plans` uses too), the two plans in number order and each shared path from the
  lower plan's list, with the higher plan's path beside it when they differ (`src/b/ (src/b/x.ts)`),
  sorted;
- `Leads: #<n> session <id>; …`, when a lead is known (the reservation's session, else the task's
  owner);
- for a plan that is done but still reserved, that `herdr plans` releases it when its pull request
  merges;
- a pointer to the rule, never a copy of it: ``Both may run at once; the plan that merges second
  catches up (`/cc-smart-dev-kit:build` § 6, An overlapping plan).``;
- when `plans.mergeFiles` was not read in full, that a merge file may count, and why;
- when the shared paths hold files the base marks `linguist-generated` (read only here, only for an
  overlap, through `src/project/generated.ts` with base-only attributes; a folder entry is read as
  the files the base holds in it): `origin/<base> marks <files> generated`, then one of:
  - the ready line `cc-smart-dev-kit workflow propose plans.mergeFiles <list>` (the current list
    and those files, comma-joined), which opens the pull request that leaves them out of every overlap once the person
    merges it. It is printed only when listing them would settle those files: the warning runs
    `filesOverlap` again on the two lists as compared, with that list, and prints it when no shared
    folder still holds one of them (other shared files may still overlap). The value is written by
    `shellWord`: bare when it holds only letters, digits and `_ . / -` (one plain path), else in
    single quotes (any list of two, since a comma is quoted), so a `$` or a backtick stays literal;
  - for a folder both plans list, which a merge file never settles (`settledBy`), the folder and
    the two ways that do: narrow that folder entry to the files the plan changes, or put the
    folder itself in `plans.mergeFiles`;
  - for a list too long for one line, the same advice to put their folder in `plans.mergeFiles`.

  With a list not read in full there is no propose line, since the line replaces the whole list.
  Git older than 2.40, or no base ref, gives the plain warning. A reader that throws adds one line,
  `The generated files could not be read: <why>`, and the warning is plain: it runs after the
  write committed, so it never turns the answer into an error.

Each list of paths in a note (the shared paths, the generated files, the folders) is capped at
about 2,000 characters, the first path always shown, then `and <k> more`, so a note always fits
under the note limit and is saved on both plans.

**The classifier** (`classifyLeadPlans`, `src/tasks/work/lead-plans.ts`) is the store-only reader
the status line and the keep-going hook share: no git, no gh, no hc. For the plans this caller
leads, and the queued plans it laid, it returns `own` (holder `self`, reserved by the lead for itself), `with-child`, `child-gone`,
`merging` (closed, still reserved), `waiting` (an open blocker), `no-files` and `ready`. An
overlap never makes a plan not ready (6.7.0), so this `ready` and `herdr plans`' agree;
`herdr plans` also reads the branch diffs, to name an overlap in the plan's line. A hand-out the
lead still owns reads `with-child`. After a take, `child-gone` needs the
child's session over (`sessionEnded`: its process gone **and** no running session carries its id)
for its maker and for its claim, if it has one. A reopened child that has not yet made a task call
reads `with-child`, and a child that cannot be proved either way does too: a resume must never
start a second child beside a live one. Session records are read only for a child already proved
gone, so a live child costs the status line no read.

**Older kits.** A 5.0.x session knows none of this. Its take and start do not check a
reservation, its drop does not release one, and its `task_*` tools do not know `files`. Restart a
session from before the update before plans are handed out. After a rollback the table and the
columns stay, unread, and a handed-out plan is an ordinary owned plan a solo build can finish.

**Limits, accepted.** A plan started without a reservation stops being held once it is done or
parked, though its pull request may still carry the changes; only a reservation holds until the
pull request merges or closes. A done, unreleased plan gets one history event for each
`/clear` of its lead, because its lead identity follows the session. A resumed session writes a
"maker moved" event for every open task it made (`restampsOf`). A `/clear` of the lead between a
reservation and the child's take is covered, because the hand-out id never moves.

## Deploy tasks

A deploy task is a step owed **before** or **after** a deploy to one environment, `prod` or
`staging`. `tasks.envs` lists the environments a project has (default both; `src/project/config.ts`).
`src/tasks/deploy/` owns the files, one `<id>-<slug>.md` per task: an open task in
`<tasks.dir>/<env>/` (default `.claude/tasks/prod/`), a closed one in `<env>/archive/`. The
4.x layout (a `T-…` file straight in `tasks.dir`, the kinds `follow-up` and `teammate`, the fields
`when` and `weight`) is gone: a clean break, with no migration.

An id is `<env>-<YYYYMMDD>-<HHMMSS>` in UTC (`prod-20261117-144503`), with `-2`, `-3` when the
second is taken. The front matter is the only authority for an id; a file name only reserves
one. One regex and `isDeployTaskId()` in `format.ts` hold the shape. Front matter writes each
value as JSON on its own line (YAML-compatible; no YAML writer is needed). `body` and `file` are
reserved keys, not metadata.

```markdown
---
id: "prod-20261117-144503"
title: "Run the orders migration"
env: "prod"
status: "open"
deploy: "before"
type: "blocking"
twin: "staging-20261117-144503"
flags: ["needs-yes"]
created: "2026-11-17T14:45:03Z"
from: "plan orders, phase db, branch worktree-db"
refs: ["docs/database.md"]
---

## What and why

## Steps

## How to check

## If it goes wrong

## Log
```

The headings are suggestions; the body is free Markdown. `status` is `open | done | dropped`.
`deploy` is `before | after` and `type` is `blocking | non-blocking`, both required: a blocking
task must be done, a non-blocking one is done or dropped with a reason. `env` must match the
folder and the id's prefix, and `created` and `closed` are UTC instants that end in `Z`; a file
that breaks either is a broken file. `twin` is the linked pair (below). Flags describe risk:
`needs-yes`, `twice-safe`, `spends-money`, `real-people`, `destructive`. `from` is an optional
origin string; `evidence` is set when the task closes.

### The life of a deploy task

- **Create** writes in the checkout the call resolves to, so the task ships in that branch's
  commit and pull request, and the answer names the checkout it wrote in. The `task` command
  resolves it from the folder it runs in (a builder's worktree included, and an explicit folder
  wins over a session record's); the task tools resolve it from the session record's folder, so a
  builder subagent's tool calls reach the session's checkout, and a builder that must write in its
  own worktree runs the command there. When a read shows deploy tasks from a checkout other than
  the session's (the command run in a second folder), it says "Deploy tasks in <folder>:".
  `kind` is `work | prod | staging` and defaults to `work`. `deploy`, `pair`, `flags`, `refs` and
  `from` on a work task are refused, so a forgotten `kind` never silently makes a
  machine-local task. `deploy` and `type` are required on a deploy task.
- **A linked pair.** `kind: "staging"` with `pair: true` (CLI `--pair`) creates the staging
  task and its prod twin in one call, each naming the other in `twin`. Refused when
  `tasks.envs` lacks either environment. Prod's `--before` gate refuses while the staging twin
  is open.
- **Close** with `task_done` (`task done`): `done` needs `evidence`, `dropped` needs a `note`.
  The file gets its `closed` date, the evidence and a log line, then moves to `archive/`; closing
  a closed task is refused. **Only the person drops a blocking task**, in their own terminal:
  inside Claude Code the MCP server and `task drop` refuse it (the check `workflow set` uses for
  its outbound keys), and the answer names the command to run. `task delete` removes an
  untracked file only; a tracked one closes. `task set <id> --type … --deploy …` changes a
  task's type or step, but weakening a blocking task (`--type non-blocking`, or `--deploy after`
  on a `before` one) is a drop by another name, so it is the person's too. This rule (D14)
  covers the task tools and the CLI, not a hand edit or removal of the file: no file guard
  stands behind it. A deploy task has no parent, `blocked_by` or builder bindings.
- **Reopen** (`task reopen <id>`, or `task_update` with status `open`) puts a closed task back
  from `archive/`, for a deploy that was rolled back. An open task left in `archive/` by an
  interrupted reopen is a `task check` finding; running the reopen again finishes it.
- `task list --branch [--base <branch>]` lists the task files this branch changed against the
  base, grouped by environment, for the pull request's notes. `task list --branches` finds open
  tasks on local branches not yet merged, and, for a task the base still has open, the closes
  already made on such a branch (`closed on <branch>, not merged`). It reports a broken file on
  one branch while it keeps listing the others. Both read the base the way the release gates do,
  and what the name is decides (`resolveListBase`). A local branch, slash or not (`main`,
  `release/1.0`), reads `origin/<base>` whenever origin has it, so a local copy that is behind
  gives no wrong answer. When the local branch holds commits `origin/<base>` lacks, the listing
  still reads origin's, because the release gates read origin's (`task release`), and says so in
  one line (`local <base> is ahead of origin/<base>`). A name git knows that is not a local
  branch (a commit id, a tag, `HEAD`, `origin/main`) is read as written, with no note: a phase's
  recorded base is a commit id. A local branch whose `origin/<base>` is not here (the plan
  branch, while it stays local; or a base never fetched), or any local branch with no `origin`
  remote, is read as written and says so in one line, with `git fetch origin` as the advice for
  the unfetched case. The local branch and origin's copy are both read by their full names
  (`refs/heads/<base>`, `refs/remotes/origin/<base>`), so a tag, or a stray local branch spelled
  `origin/main`, never stands in for either. A name that means more than one ref (a tag beside
  a branch, a stray local `origin/main` beside origin's, a bare `main` with a tag `main` and
  origin's copy) is refused and the refs named, in the gates' own words (`names more than one
  ref`): name the one you mean in full with `--base`, or delete the one that should not be
  there. A local branch and origin's copy of it are one branch, not a clash. A name that
  resolves nowhere gives the gates' advice (`git fetch origin`, or pass a ref git knows). The branch lists refuse
  `--json`, so the one-line note never reaches a JSON answer. A deploy
  branch left unmerged is a visible run in
  progress, and a prod gate that waits on an open staging twin points at this list: the twin's
  close may sit on a branch not merged yet.
- **Old ids.** An id that starts with `T-` answers "old task ids are gone in 5.0.0". The old
  kinds answer the same on the CLI (`--kind follow-up|teammate`, exit 2). The files themselves
  are never read; every surface counts them (`task check`, doctor, the session-start line) so
  the person recreates each as a deploy task or deletes it.

### The deploy run and the gates

`cc-smart-dev-kit task release <env> --before|--after [--ref <ref>] [--json]` is the gate around a
deploy (`release.ts`). `--ref` defaults to `origin/<worktrees.base>`; every answer prints the
ref and the commit it read. A run happens on a **deploy branch** cut from the commit that
ships, so the closes reach main through that branch's small pull request and nothing lingers.
Exit codes: 0 the gate passes, 1 a refusal (also a ref git does not know, a place outside git,
or a short ref name that matches more than one ref, such as a stray local branch `origin/main`
beside origin's or a tag beside a branch: git would ship the first match, so both gates stop
and name every match, `refBranchOf` in `branch.ts`), 2 a wrong command.

1. Cut the branch: `git switch --no-track -c deploy/<env>-<YYYYMMDD-HHMM> origin/<base>`, in
   the session's own checkout. `--no-track` keeps a plain `git push` from targeting the base.
   The refusal for a wrong branch prints this command; on a deploy branch, the refusal for a HEAD
   that is not the ref prints it instead, so an answer holds it once. The `task` command acts in
   the folder it runs in, and every deploy-task answer names the checkout and file it wrote, so a
   close lands where the gates read it.
2. `--before` exits 1 when the environment is not in `tasks.envs`; HEAD is detached, or on the
   base branch (`worktrees.base`) or the ref's own branch (the branch git resolves the ref to:
   `origin/<x>`, `upstream/<x>` and `refs/heads/<x>` are `<x>`; a tag or a commit has none): a
   run happens on a deploy branch, D12, and that refusal prints the branch to cut; HEAD is not
   the ref's commit
   (it may differ from it only under `tasks.dir`, closes already made, and it must hold every
   commit of the ref); a blocking `before` task is open; a task file is broken or its id is
   claimed by two file names; or, for prod, a task's staging twin is open, or names no task
   (live or archived: a deleted twin must not pass as a finished one; `task check` names it,
   `twin-missing`, with the same fix line). It names the open non-blocking `before` tasks as notes: do them now, or drop
   them with a reason. It adds a `!` warning line, never a refusal, when the working tree has
   uncommitted changes outside `tasks.dir` (`GitFacts.uncommittedOutside`): the gate judged
   committed code only, and a local-folder deploy could still ship those edits.
3. Claude closes each task with evidence and commits the closes on the deploy branch.
4. The deploy itself is the project's own deploy skill.
5. `--after` exits 1 when **any** task of that environment is open, before or after; `tasks.dir`
   has uncommitted changes; the branch is not pushed (`git push -u origin <branch>`, or it is
   ahead of its remote copy); HEAD is detached, or on the base branch or the ref's own branch (no
   line ever prints a push to it); the environment is not in `tasks.envs`; or a task file is
   broken or its id is claimed by two file names. Only `--before` reads the uncommitted
   changes outside `tasks.dir`; `--after` reads the tasks folder alone.
6. The branch's pull request (the task files only) merges as the workflow says.

With no flag, `release [<env>]` lists the open tasks by environment, step and type, blocking
first, and exits 0. Two files with one id **and the same file name** are a crash copy of a close:
the archived one wins. One id under different file names is a `duplicate-id` finding, and the
fix is to rename one id, never to delete a file.

### The CI check

Nothing makes a person or Claude run the gates: a deploy command typed directly, or a CI deploy on
merge, ignores open tasks. No hook stands in front of a deploy command any more (the `deploy-guard`
hook is retired, `docs/design/hooks.md` § Retired in 6.0.0): the session runs the gates itself
(`/cc-smart-dev-kit:tasks` § 5), and CI runs one pure check of the task files.

**`judgeTasks`** (`release.ts`): `judgeTasks(env, scan)` returns `{ refusals, notes }` from the
task files alone, with no git. The refusals: a blocking `before` task of `env` is open; a task
file is broken or an id is claimed twice (`brokenRefusals`); and, for prod, the twin rules as the
gate always had them (every open prod task is checked: a twin that names no task, or a staging
twin still open). The notes are the open non-blocking `before` tasks. The environment refusal
(`envRefusal`: `env` is not in `tasks.envs`) stays outside it, with the caller. `judgeBefore` is
the environment refusal, the wrong-branch and HEAD refusals (git facts), then `judgeTasks`; an
exact-array test (`deploy.test.ts`) pins the refusals and their order, so the extraction changed no gate.

**`task release <env> --check [--json]`** is `envRefusal` plus `judgeTasks` over
`scanDeployTasks(dir, { archive: true })` in the folder the command runs in. The checkout is
found by `locateCheckout`, which reads no history and no refs, so a detached or shallow CI checkout works.
`--check` with no environment, or with `--before`, `--after` or `--ref`, is a usage error (2).
It prints `Release check: <env>`, a `fail` line for each refusal, an `info` line for each note,
then `Ready: <env> has no open task that holds a deploy.` (0) or `Not ready: N reasons to stop. Fix
each one, then run this again.` (1). `--json` prints `{ ok, refusals, notes }`. A project file the
command cannot read, or a place outside git, is one line on stderr and exit 1 even with `--json`:
a script reads the exit code. The CI step is the README's (§ Deploy tasks in CI): the kit's
`plugin/dist/cli.js` at a pinned commit, run with `bun --no-env-file` and an empty `--config`,
so the project's own `bunfig.toml` preload and `.env` files cannot run. It needs Bun: the task
files are parsed with `Bun.YAML` and the version check is `Bun.semver`, so on Node every file
would read as broken. A test copies the built `cli.js` alone to a temp folder and runs it that
way, with a temp `HOME`, in a detached, shallow clone. In a container job git may refuse the
checkout ("dubious ownership"): the fix is `git config --global --add safe.directory "$PWD"`.

**`tasks.deployCommands`** (5.3.0) said which commands deploy, for the retired `deploy-guard`.
It is `{ "prod"?: Entry[], "staging"?: Entry[] }`; an entry is a string (one command as typed)
or a `MatchRule` of the jobs grammar (`matchRuleSchema`). The schema still refuses a string that
holds more than one command, a string that holds none, an empty list or object, and a key outside
`tasks.envs`, so a file written for 5.3 to 5.6 still parses. No hook reads it now.

### The deploy-skill block

`project init` keeps a short managed section in the project's own deploy skill, so the deploy
steps and the gates sit together (`src/project/deploy-skill.ts`, its text in `deploy-block.ts`).
The block's first line, `## Deploy tasks`, is the contract across versions: it is how a skill
written by an older kit is still found and updated. It holds the two gate commands, the
deploy-branch step, the close step, a line that says the session runs the gates before a deploy,
and a pointer to `/cc-smart-dev-kit:tasks`. Adding that line made every older block out of date:
`doctor` flags it until `project init` runs.

- **Find.** A deploy skill is a file under `.claude/skills/` that already holds the block, or
  whose folder name or front matter `name` has "deploy" in it; `--deploy-skill <path>` names one.
  With several, one question picks the file. The kit then shows the change, asks, and writes
  it. `--no-deploy-block` takes the block out (and creates no skill).
- **None found.** `project init` creates `.claude/skills/deploy/SKILL.md`: asked, yes by
  default, `--yes` creates it, and not when `.claude/commands` has a `deploy*.md` (a project
  with a `/deploy` command already). The starter says the project's deploy steps are not
  written yet: Claude asks the person how the project deploys and writes them, and never
  invents a deploy command.
- **Write.** Through the managed-markdown writer with a backup and an atomic write, never
  `changed.json`, so `restore` never touches a project file. A real path outside the checkout
  is refused, the file is read again before the rename, and CRLF line endings are kept.
  `--dry-run` shows the diff. The portal's init never writes a skill.
- **`requires`.** `project init` raises `requires` to `>=5.0` when the project has deploy task
  folders or the block, and removes `tasks.releaseBranch` and `tasks.legacyFolders`. Those two
  fields are accepted and ignored, not retired: the retired-field pattern fails every guard
  closed, and `project init` could not repair it. A 4.x kit then says "update" instead of
  showing nothing.

### Checks, and where they show

`task check [--json]` (`check.ts`) exits 1 on any finding. Each kind has plain words in
`doctor`, a `✗` unless marked advice:

| Finding | Words |
|---|---|
| `broken-file` | broken task file |
| `duplicate-id` | task id used by more than one file |
| `twin-missing` | twin that names no task |
| `open-in-archive` | open task left in `archive/` |
| `broken-ref` | missing reference (a `refs` path outside the checkout, or not there) |
| `stale` (advice, `!`) | task open for over `tasks.staleDays` days (default 30) |
| `duplicate-title` (advice, `!`) | repeated title, within one environment |
| `old-files` (`!`) | N old task files are not read since 5.0.0 |

`doctor` prints these as "deploy tasks:" lines, each with the fix `task check`. The same group
carries a `!` line for each `tasks` field nothing reads (fix: `project init`), a `requires`
below `>=5.0` while deploy folders or the block exist, and a deploy-skill block that is out of
date; a `·` line says a skills folder linked from outside the checkout is not searched, and
another says the project has a deploy skill but lists no `tasks.deployCommands`.

## The server, command and guards

`cc-smart-dev-kit task mcp` runs the stdio MCP server. Its official SDK is isolated in
`plugin/dist/tasks-mcp.js`, not `cli.js`. The tools are `task_create`, `task_update`,
`task_done`, `task_note`, `task_list`, `task_get`, `task_search`, `task_delete`, `task_take`.
The server's own instructions (`TASK_SERVER_INSTRUCTIONS`) say that a step owed around a deploy is
a deploy task, to list them before any deploy, production or database work, and to close each with
evidence, pointing to the `tasks` skill. The CLI exposes the same operations, including the import
of claude-mem's lists, branch lists, checks and the release gates; [README](../../README.md) lists
their arguments. The `acks` table stays in the work store's schema, though nothing writes it: a
4.x server still queries it, and `min_compatible` stays 1. `task_get` and `task show` cap
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
  registration exists, the hook says to run setup. When any deploy task is open, unreadable, a
  duplicate id or an old file, one more line follows: "Deploy tasks open: prod 2 (1 blocking
  before the deploy), staging 0; 1 unreadable; 3 old files not read — /cc-smart-dev-kit:tasks".
  It reads only the top of each environment folder, never `archive/`, and counts old files only
  in a project with a `cc-smart-dev-kit.json`; an unreadable folder leaves the line out and says
  why on stderr, never hiding the work list.
- `keep-going` (Stop) holds the main session's turn end once per stalled state while a phase
  of its plan is in progress and nothing runs, or while the plan in flight has ready phases
  and none runs. The same reason already given, with no subagent started or resumed since,
  keeps it silent. It names the agent to resume with `SendMessage`,
  or says to start a fresh builder, then every ready phase to start together, closing with `task_done`, or
  recording a blocker with `task_note` and a `Waiting for:` line, and warns against moving a
  phase back to pending to end the turn (`docs/design/hooks.md` § The keep-going stop).
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

When this process leads plans, the status line adds one `Plans · …` row from the store's
classifier (below): `Plans · 2 with children · 1 child gone · 1 merging · 1 waiting · 1 needs files
· 2 ready`, with `1 with child` for one. It counts `with-child`, `child-gone`, `merging`,
`waiting`, `no-files` and `ready`, leaves out any zero count and never counts `own`, since the own
plan shows in the `Plan` row. With claimed work it sits below the own rows and shows only when a
plan is reserved for this lead; with none it is the whole segment. So a solo session that laid
queued plans and claims nothing sees `Plans · N ready`: the store cannot tell it from a
coordinator before its first hand-out, and this is accepted. The row costs a second open of the
store per render, and reads no git, gh or hc.

The portal shows the list read-only, on a Tasks tab of its own (`/tasks`, from `/api/tasks`):
each project's work tree as plan › phase › task, its open work and what closed in the
last seven days, each row with its layer, type, blockers and progress, each phase with its
ledger, then the open deploy tasks in a prod and a staging section, blocking ones and stale
ones marked. Filters narrow it to one project,
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
An item claude-mem marks `doing` is stored `in_progress`, with no maker and no claim. It is no
session's work: the import is the kit's own write, so it is never judged as a plan's start
(`insertTask` with a `reason`), and the item holds no plan (`isInFlight`). A start by a
Claude process claims the task, and a task a session makes keeps its session id, so a session's
work counts. Two starts store neither, and hold no plan: a start of a task no session made, by
a terminal with no Claude identity or by a session known only by its id (no Claude process
found).
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
integrity, and the deploy task findings above. It does not replace the live checks in the contract.

## Not yet

FTS5 search, database snapshots, hand ordering, a Claude Code task-panel mirror,
cross-machine sync of live work, and editing tasks from the portal are not built yet.

`GET /api/tasks/<id>` returns `{task, notes, events}` from the read-only store (`read.ts`).
The internal id is the tree row's `id`, not its project-local `#n`. `WorkTaskNode` carries
`session` (creator/owner), `parentId`, `claim` (`live`, `dead`, `none`), and `notes` / `events`
counts. `task.take` takes `{task, session, from?, force?, confirm?}` through the CLI's own
operations. The destination must be a named live session; an unknown one changes nothing.
A forced move also needs `confirm: true`.
