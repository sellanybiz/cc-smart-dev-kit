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

## The work store

`src/tasks/work/` owns `<stateDir>/tasks/work.db`, using `bun:sqlite`. WAL (write-ahead
logging) lets readers run beside a writer. Writes use short `BEGIN IMMEDIATE` transactions
and a busy timeout. `PRAGMA user_version` holds the schema version; `min_compatible` records
the oldest compatible reader. Migrations only add to the schema, because an older plugin
folder can still have a running server.

A task has a project-local number, shown as `#12`, a subject and free Markdown description,
status (`pending`, `in_progress`, `done`, `dropped`), a type (`blocking` or `non-blocking`),
an optional parent, plan, phase and crew id, creator, process claim and timestamps. Its
blocked-by list (the `task_deps` table) names the tasks it waits for; notes keep the work log.
Machine acknowledgements record teammate tasks completed here.

The store enforces these rules, not the caller:

- Done requires every blocking task under it to be done or dropped (below). A refusal names
  what remains, and keeps none of the call's notes or evidence: they are written in the same
  transaction.
- A task blocked by an open task can neither start nor be done.
- A parent cycle, a blocked-by cycle, and a fourth layer are refused.
- A system close on merge or removal drops open subtasks and leaves an automatic note; a merge
  leaves non-blocking work open.
- Delete is for a mistake with no notes or subtasks, not for finished work. A deleted task's
  number is never given again: its history still answers to it.

### Layers, types and blocked-by (D76)

D76 (2026-11-03, 1.11.0) gives the work three layers under a plan: **phase › task ›
subtask**. A task's layer is never stored. `layerOf` (`queries.ts`) reads it from the parent
alone: a plan or a phase is its kind, a task under a task is a `subtask`, and any other task
(at the top, under a plan, under a phase) is a `task`. So a move changes the layer with it, and
there is no second value to drift. `placeValid` (`store.ts`) holds the shape, on create and on
every move:

- Nothing goes under a subtask. The refusal names the task above it, where the new one fits.
- A task that has subtasks cannot move under a task: its subtasks would be a fourth layer.
- A plan stays at the top and a phase under its plan: neither can be moved.

A store an older kit nested deeper reads as it is: anything below a task is a subtask. The
layer rules hold only a move, so each of those tasks still changes and closes where it sits.

**The type** says whether a task holds the one above it. A `blocking` task (the default) must
be closed before its parent is done. A `non-blocking` one (a nice-to-have, a later idea) holds
nothing. `holdingUnder` (`queries.ts`) is the one answer to "what holds this task": the open
tasks below it, reached through blocking tasks only, those in progress first. It never walks
into a non-blocking task, so a blocking subtask of a non-blocking task holds only that task.
It does walk on below a closed task, so a task closed early cannot hide open work under it.
`doneValid`, the crew gates and a merge's close all use it.

**Blocked-by** (`blocked_by` on create, `blocked_by_add` and `blocked_by_remove` on update)
names tasks that must finish first. A task blocked by an open task cannot go to `in_progress`
or `done`; a blocker that is done or dropped lets it go. The check runs on the change of status
only, so a task already in progress when a blocker is added keeps going, and says it is
blocked. `addBlockers` refuses a blocked-by cycle, a task of another project, and a task above
this one: a parent waits for its subtasks, so a subtask blocked by its parent could never
start, and neither could ever be done. The kit's own writes (a crew start, a merge's close, an
import) are not held.

**The store** keeps the type in `tasks.blocking` (1 or 0, default 1). Schema 2 adds the column
with `ALTER TABLE`; `min_compatible` stays 1, so a reader from 1.10.x still opens a store that
1.11.0 migrated. A 1.10.x writer adds tasks with the default, blocking, which is the 1.10.x
rule. No hook query names the column, and a row without it reads as blocking.

**A lead lays out its phases ahead of its crew.** `task_create` with `phase` (its id, as
`crew start` names it) makes the phase task under the plan task, once per plan and phase
(`layPhase`); a second call answers with the phase that is there. `plan` is the slug `crew lead
--plan` names, the lead's own plan when left out. `plan` alone makes the plan task, and takes a
subject only. Neither takes a `parent` or a `status`: a plan sits at the top and a phase under
its plan, and each starts pending. A crew session cannot lay phases: it works inside its own. `crew start` finds the phase by plan and phase (`ensurePhaseTask`) and adopts it with what
the lead put under it, so a phase has one task.

### A task's history

Every write in `store.ts` adds one entry to `task_events`, in the same transaction as the
change, so the two land together or not at all. An entry holds the time, what happened
(`created`, `changed`, `noted`, `closed`, `deleted`), each field's value before and after
(subject, description, status, type, parent, crew, claim, blocked by), and who made it: the session
id and name (the name Claude Code shows, read from its session record by `callerOf`), the crew
id and the Claude process. A change the kit makes itself (a merge or removal closing a phase,
a crew session taking a phase, an import) carries its reason instead. A change that changes
nothing adds no entry. Entries are never edited, and the table has no foreign key on purpose:
a deleted task keeps its history, whose last entry holds the task as it was.

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

A claim belongs to the Claude process: pid plus start time, not just a session id. The
server finds that process through ancestry and reads its current session record on each
call. The record supplies the session id and cwd, including a move into a worktree. Thus
`/clear` and a background fork keep the process's tasks. Another process's in-progress
work is marked as belonging to another session. Live proof of these Claude Code behaviours
is still owed in [the contract](../claude-code-contract.md).

`crew start` makes a phase task keyed by plan and phase, even while the phase is queued, or
adopts the one its lead laid out (above). `--waits-for` adds those phases to its blocked-by
list. A continuation points the same task at the new crew id and takes over its predecessor's
subtasks (their crew id moves too, with a history entry); new crew tasks default to its
subtasks. Merge closes the phase done and drops its open blocking work; its non-blocking work
stays open, for whoever picks it up. Removal drops the phase and everything open under it. A
phase started again after either opens again for the new crew session; the old session's
closed subtasks stay under it as its record, and stop counting (below).
A lead has a plan task too. Its *own* tasks are those created by its sessions in
`leadSessions`, outside every phase: not the plan or phase tasks, and not the tasks it laid out
inside a phase, which are that phase's crew session's work. Adoption carries that ownership
forward.

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

- Create writes in the session's checkout, including a crew worktree, so the task ships in
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
`task_done`, `task_note`, `task_list`, `task_get`, `task_search`, `task_delete`.
The CLI exposes the same operations, including import, branch lists, checks and release
lists; [README](../../README.md) lists their arguments. `task_get` and `task show` cap
long output and accept an offset. Search uses SQL `LIKE`, not FTS5.

`src/tasks/guard-view.ts` is the one join of the kit's list with Claude Code's legacy list
for one release, and only until setup has run: once the user's settings deny `TaskUpdate`, a
task left on Claude Code's list can never be closed, so it holds no stop and no done report.
Hooks read the work database with `PRAGMA query_only`, a short busy wait
and fail-open handling. A read-write open with query-only mode also works when a WAL file
has no writer holding it open. All gates use this view, including `crew report`:

- The first crew edit needs a subtask under its phase. A crew made before phase tasks
  existed is let through. A refusal names the task tool and CLI fallback.
- Crew Stop names an open blocking subtask (`holdingUnder` its phase) and says to continue;
  with none, it asks for the report. A done report is refused while one remains open.
  Non-blocking work never holds either: it stays open after the merge.
- Lead Stop holds once for the lead's own blocking work in progress, unless the turn names
  `Waiting for:` or has background work other than its watch. The notifier yields to it.
- The lead reminder asks for its own task when none exists.

`task-start` is machine-wide. At every start, clear and compaction it adds one block of the
project's open work tasks, without descriptions, at most eight lines and "+n more". An open
crew phase and its tasks stay out (they are that crew session's, on the board); what a merge
left open under a closed phase (non-blocking work) is listed, since it is anyone's now. This process's
own claimed tasks come first, then the ones in progress, then the most recently touched. A
task untouched for `tasks.staleDays` (default 30) is not listed but counted in one line,
unless this process claims it. Crew sessions get their subtasks on the role card instead. A
lead also gets a line about stale project tasks. Until registration exists, the hook says to
run setup.

Progress has one rule everywhere — the status line's `#12 Subject · 2/5`, the crew board,
`task_list`, the crew gates and the portal: the tasks under a task at every depth, closed (done
or dropped) of all of them (`subtreeProgress`). Non-blocking tasks count too: progress says how
much of the work is closed, and `holdingUnder` says what still holds the parent's done. Under a
crew phase, a closed task an earlier crew session of the phase made does not
count (`countsToward`): so a phase started again after a removal holds its new session at the
first-edit gate until that session lists its own work.

The portal shows the list read-only, on a Tasks tab of its own (`/tasks`, from `/api/tasks`):
each project's work tree as plan › phase › task › subtask, its open work and what closed in the
last seven days, each row with its layer, type, blockers and progress, then the open task files
by kind, stale ones marked. Filters narrow it to one project, blocked work or non-blocking work,
and keep each match under the tasks above it. A project's page keeps a one-line card that links
there, and each crew page a phase card with the same rows. All of them read again on the live
stream's `tasks` event, which fires when the store's file or its write-ahead log changes
([portal](portal.md)).

## Setup and the move from older lists

[Setup](setup.md) owns registration, permissions and the managed settings, with restore
support. Run `cc-smart-dev-kit setup` after updating, then restart Claude Code. Setup
registers the launcher-backed server at user scope with `alwaysLoad: true`, asks for the
allow entry, denies the five built-in list tools, withdraws its D68 opt-in, and turns off
claude-mem work state. claude-mem seeds `"true"` itself, so only a `"true"` set after setup wrote
`"false"` is the person's, and stays.

Run `cc-smart-dev-kit task import claude-mem` once to move open lists. claude-mem keeps
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
