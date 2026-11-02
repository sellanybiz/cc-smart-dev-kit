# The kit's task list (D75)

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
status (`pending`, `in_progress`, `done`, `dropped`), an optional parent, plan, phase and
crew id, creator, process claim and timestamps. Dependencies say what it waits for; notes
keep the work log. Machine acknowledgements record teammate tasks completed here.

The store enforces these rules, not the caller:

- Done requires every subtask to be done or dropped. A refusal names what remains, and keeps
  none of the call's notes or evidence: they are written in the same transaction.
- A parent or dependency cycle is refused.
- A system close on merge or removal drops open subtasks and leaves an automatic note.
- Delete is for a mistake with no notes or subtasks, not for finished work. A deleted task's
  number is never given again: its history still answers to it.

### A task's history

Every write in `store.ts` adds one entry to `task_events`, in the same transaction as the
change, so the two land together or not at all. An entry holds the time, what happened
(`created`, `changed`, `noted`, `closed`, `deleted`), each field's value before and after
(subject, description, status, parent, crew, claim, waits-for), and who made it: the session
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

`crew start` makes a phase task keyed by plan and phase, even while the phase is queued.
`--waits-for` adds dependencies. A continuation points the same task at the new crew id and
takes over its predecessor's subtasks (their crew id moves too, with a history entry); new
crew tasks default to its subtasks. Merge closes the phase done; removal drops it. A phase
started again after either opens again for the new crew session; the old session's closed
subtasks stay under it as its record, and stop counting (below).
A lead has a plan task too. Its *own* tasks are those created by its sessions in
`leadSessions`, not the plan or phase tasks. Adoption carries that ownership forward.

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
- Crew Stop names an open subtask and says to continue; with none, it asks for the report.
  A done report is refused while subtasks remain open.
- Lead Stop holds once for the lead's own in-progress work, unless the turn names
  `Waiting for:` or has background work other than its watch. The notifier yields to it.
- The lead reminder asks for its own task when none exists.

`task-start` is machine-wide. At every start, clear and compaction it adds one block of the
project's open work tasks, without descriptions, at most eight lines and "+n more". A crew
phase and its subtasks stay out (they are that crew session's, on the board). This process's
own claimed tasks come first, then the ones in progress, then the most recently touched. A
task untouched for `tasks.staleDays` (default 30) is not listed but counted in one line,
unless this process claims it. Crew sessions get their subtasks on the role card instead. A
lead also gets a line about stale project tasks. Until registration exists, the hook says to
run setup.

Progress has one rule everywhere — the status line's `#12 Subject · 2/5`, the crew board,
`task_list`, the crew gates and the portal: the tasks under a task at every depth, closed (done
or dropped) of all of them (`subtreeProgress`), since a parent may be done once each is done or
dropped. Under a crew phase, a closed task an earlier crew session of the phase made does not
count (`countsToward`): so a phase started again after a removal holds its new session at the
first-edit gate until that session lists its own work.

The portal shows the list read-only: a Tasks card on each project's page (the work tree with
its open work and what closed in the last seven days; the open task files by kind, stale ones
marked) and a phase card on each crew page. Both read again on the live stream's `tasks`
event, which fires when the store's file or its write-ahead log changes
([portal](portal.md)).

## Setup and the move from older lists

[Setup](setup.md) owns registration, permissions and the managed settings, with restore
support. Run `cc-smart-dev-kit setup` after updating, then restart Claude Code. Setup
registers the launcher-backed server at user scope with `alwaysLoad: true`, asks for the
allow entry, denies the five built-in list tools, withdraws its D68 opt-in, and turns off
claude-mem work state. claude-mem seeds `"true"` itself, so only a `"true"` set after setup wrote
`"false"` is the person's, and stays.

Run `cc-smart-dev-kit task import claude-mem` once to move open lists. The import reads
claude-mem's database read-only, folds its work-state rows as claude-mem does, and refuses
an unknown schema. `--dry-run` previews it; `--project` selects a stored project.
Doctor checks registration, permissions, the memory switch, work-store schema and
integrity, and project-file findings. It does not replace the live checks in the contract.

## Not in 1.10.0

FTS5 search, database snapshots, hand ordering, a Claude Code task-panel mirror and
cross-machine sync of live work are not in this release.
