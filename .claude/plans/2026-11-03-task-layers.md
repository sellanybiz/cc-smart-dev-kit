# Plan: three task layers, a blocking type, "blocked by", and a Tasks tab (1.11.0)

The owner's ask (2026-11-03, overnight, while away): "tasks will have 3 layers phase task and
subtask all have type blocking non blocking and blocked by. also please show tasks tab
separately in portal."

Built on `task-layers`, stacked on PR #39 (1.10.1). Every choice below was taken by the
recommended option while the owner was away, and parked as a decision to keep or undo.

## Today (1.10.x)

- A plan task (`kind = plan`) holds phase tasks (`kind = phase`, one per crew phase, made by
  `crew start`), which hold tasks of any depth (`kind = task`).
- The plan skill makes each phase a plain task under the plan task, and `crew start` makes its
  own phase task: two homes for one phase.
- A task is done only when every open task under it, at any depth, is closed. The crew's Stop
  block, its done report and the lead's Stop block count every open task.
- `waits_for` (`task_deps`) is stored and shown nowhere; nothing holds a task for it.
- The portal shows tasks only as a card inside a project's page, and a crew page's phase tree.

## The model

**Layers.** Plan › Phase › Task › Subtask. The plan is the container; the three working layers
are the ask.

- **Phase:** `kind = phase`, under its plan task. Made by `crew start` as today, or by a lead
  ahead of time: `task_create` with `phase: "<id>"` makes (or returns) the phase task of the
  caller's plan. `crew start` for that phase adopts it, so a phase has one home.
- **Task:** a task at the top, under a plan, or under a phase.
- **Subtask:** a task under a task. **A subtask has no subtasks**: a create or a move that would
  put one below a subtask is refused, and the refusal names where it can go. A move that would
  push a task's subtasks to a fourth layer is refused too. A phase stays under its plan.
- The layer is worked out from the parent chain, never stored, so it can never disagree with the
  tree. Tasks 1.10.x made deeper keep working: they read as subtasks, and get no more below.

**Type: blocking or non-blocking**, on every layer. Default blocking (today's behaviour).

- A **blocking** task holds its parent: the parent cannot be done while it is open. A crew
  session's Stop block and its done report count only blocking open tasks in its phase, and the
  lead's Stop block only its blocking tasks in progress.
- A **non-blocking** task holds nothing: noted work its parent can be done without. Its own
  subtasks still hold it.
- A parent closed as done keeps its open non-blocking tasks open, shown under it as left open. A
  merged phase does the same (the kit closes the blocking ones it finds open, as today). A phase
  removed (dropped) drops everything open under it, as today.
- Progress (`2/5`) still counts every task under it; the type is shown beside it.

**Blocked by**, on every layer: the tasks a task waits for (`task_deps`, renamed `blocked_by` in
the tools and the CLI).

- A task blocked by an open task cannot start (`in_progress`) or be done; the refusal names the
  blockers and how to lift the block. A blocker that is done or dropped no longer blocks.
- A task is **blocked** while one of its blockers is open: `task_list`, `task_get`, the
  session-start block and the portal say so, with the blockers' numbers.
- Cycles are refused, as today. The kit's own writes (crew start, a merge, an import) are not
  held: a phase's order is the crew queue's job (`--waits-for`).

**Store.** One additive column, `tasks.blocking INTEGER NOT NULL DEFAULT 1` (schema 2,
`min_compatible` stays 1, so older code from an old version folder keeps working and reads every
task as blocking). A hook reads the column from `SELECT *` and treats a store not yet migrated as
all blocking; no hook SQL names the column.

## Tools and CLI

- `task_create`: `type` (`blocking` | `non-blocking`), `blocked_by`, `phase` (a lead's phase).
- `task_update`: `type`, `blocked_by_add`, `blocked_by_remove`.
- `task_list` / `task_get`: each line shows the layer where it is not the obvious one, the type
  when non-blocking, and `blocked by #3` while blocked.
- The CLI (`task add|start|…`) takes the same as flags. The MCP server's instructions say what
  each type means in one line.

## Portal: a Tasks tab of its own

- A **Tasks** entry in the sidebar (`/tasks`), under Now beside Work: every project's work tree
  (Plan › Phase › Task › Subtask), each row with its status, its type, `blocked by #n` with the
  blocker's state, and its progress; filters for open only, blocked, and non-blocking; then the
  project's task files by kind and weight, stale ones marked.
- The project page's card becomes one line that opens the Tasks tab on that project (one home).
  The crew page keeps its phase tree, with the same row.
- Read-only, as today.

## Phases

| Phase | Owns | Who |
|---|---|---|
| A. Store, rules, tools, guards | `src/tasks/`, `src/crew/phase-task.ts`, `src/hooks/crew-role.ts` and `lead-notes.ts` reads, their tests | me |
| B. Portal Tasks tab | `portal/src/`, `src/portal/`, `plugin/portal-ui/`, `docs/design/portal.md` | builder, Opus at high (UI design) |
| C. Instructions and docs | `plugin/skills/plan-task`, `lead`, `crew`, `memory-routing`, `plugin/instructions/core.md` if needed, `docs/design/tasks.md`, README, CHANGELOG | me, after A |

The API contract B builds on (`TaskTreeNode` in `src/tasks/work/tree.ts`) lands first.

## Checks

- Unit tests for every rule: the layer cap on create and move, the phase a lead makes and the
  adoption by `crew start`, the done rule by type, the guards by type, blocked start and done,
  the merge keeping non-blocking work, the migration from schema 1 with old code still writing,
  a hook reading an unmigrated store.
- Each new test seen failing with its rule broken on purpose.
- `bun run check`, both validates, `cd portal && bun run test`, `bun run check:portal`.
- The portal page checked in a browser (the ui-verifier), light and dark, phone and desktop.
- One second opinion before the push: the reviewer on Opus at xhigh (it changes the guards).

## Not in this release

Project task files get no type or blocked-by (they have `weight`); a drag-and-drop editor; a
blocked-by link across projects.
