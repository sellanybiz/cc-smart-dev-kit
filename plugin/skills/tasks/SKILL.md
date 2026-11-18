---
name: tasks
description: Use to track work or a finding, or for a step owed around a deploy. Which task, how to close it, the deploy run. Triggers include "task", "track this", "deploy", "prod", "staging", "migration", "release".
---

# Tasks

**Project add-on:** `.claude/cc-smart-dev-kit/tasks.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

This is the one home for task knowledge. Use the `cc-smart-dev-kit-tasks` server: its tools
(`task_create`, `task_update`, `task_done`, `task_note`, `task_list`, `task_get`, `task_search`,
`task_take`, `task_delete`) are always loaded, with no lookup step. Without them, use the CLI
(§ 4). Never fall back to a plan log or a second to-do list; with no CLI either, report the
blocker.

## 1. Which task

| You have | It is |
|---|---|
| A small ask or fix, no plan | a **loose work task**: `task_create` with a subject only |
| An approved plan | **plan › phase › task** (`/cc-smart-dev-kit:plan-task` § 4) |
| A step owed before or after a deploy to staging or prod | a **deploy task**: `kind` `staging` or `prod` |
| The same step on both | a **pair**: `kind: "staging"` with `pair: true` makes the staging task and its prod twin |
| A bug, gap or follow-up you found | the finding rule below |

Work tasks live in the kit's store on this machine. A deploy task is a Markdown file in the
repo (`tasks.dir`, default `.claude/tasks/<env>/`), so it travels with the branch you commit it
on. Nothing else is a deploy task: a follow-up or a teammate's setup is not.

**A finding.** Does it belong to the plan (the code the plan changes, or anything that would make
its result wrong)? Found while planning, it goes into the design and the phases. Found while
building, it becomes a task under the phase that owns its files, done before the plan closes.
Only a finding **outside** the plan leaves it: the main session files a GitHub issue, and a
subagent lists the finding in its report. With issues off, or where `issue file` refuses, the
finding goes in the end-of-turn summary. To file one:
`cc-smart-dev-kit issue file --title "<title>" --body-file - --fingerprint <stable key>`, the
body on standard input. The same fingerprint updates the issue it filed. Read the text first:
its secret screen knows only common shapes.

## 2. Create

- `task_create` takes a subject, a free-form description, and optionally `parent`, `type` and
  `blocked_by`. `type` is `blocking` (the default for a work task: it holds its parent while
  open) or `non-blocking` (holds nothing). `blocked_by` names the tasks it waits for: it cannot
  start or be done while one is open. Layers, phase fields and the plan cap:
  `/cc-smart-dev-kit:plan-task` § 4 and § 5.
- A **deploy task** also needs `deploy` (`before` or `after` the deploy) and `type`: a
  **blocking** one must be done before the gate passes; a **non-blocking** one is done, or
  dropped with a reason. Optional: `flags` (`needs-yes`, `twice-safe`, `spends-money`,
  `real-people`, `destructive`), `refs` (repo paths, and the URL of a related issue), `from`.
  The ids look like `prod-20261117-144503`. `deploy`, `pair`, `flags`, `refs` and `from` on a
  work task are refused, so a forgotten `kind` never makes a deploy step machine-local.
- The answer names the checkout the file was written in. Run a deploy in your session's own
  checkout, and commit the file with your branch.
- `tasks.envs` lists the environments the project has (default both). A kind outside it is
  refused.

## 3. Use

- Status: a work task is `pending`, `in_progress`, `done` or `dropped`; a deploy task is
  `open`, `done` or `dropped`. Starting work claims it. `task_note` records progress, rulings and
  decisions as you go; `task_get` reads a task with its notes and history.
- **Close** with `task_done` and `evidence`: what you ran or checked, and its result. A task
  with open blocking tasks cannot be done until they are. **Drop** with a `note` that gives the
  reason. A step of a phase closes the same way.
- **Only the person drops a blocking deploy task**, in their own terminal, outside Claude Code:
  `cc-smart-dev-kit task drop <id> --note "<reason>"`. Inside Claude Code it is refused; ask.
  `task_delete` removes a mistake that has no notes, and a deploy task only while its file is
  untracked; a committed one closes. Weakening a blocking
  task (`--type non-blocking`, or `--deploy after` on a `before` task) and deleting an open
  blocking one are the person's too, in their own terminal. The rule covers the task tools and
  the `task` command, not a hand edit or removal of the file.
- **Reopen** a closed deploy task after a rolled-back deploy: `task_update` with status `open`,
  or `task reopen <id>`.
- `task_take` takes a plan or task into this session (live claims need `force`). Park and
  resume a plan: `/cc-smart-dev-kit:plan-task` § 6.
- `task_list` reads `mine` (the default), `plan`, `project` (also the open deploy tasks) or
  `all`; ids look like `#12` or `prod-20261117-144503`. An old `T-…` id answers "old task ids
  are gone": the 4.x files are not read; recreate each as a deploy task or delete it.
- A plan's phase description is the builder brief. Keep the phase's `agent`, `branch`,
  `worktree` and `base` true (`task_create` and `task_update` set them), including after a
  replacement builder; `task_list` with `scope: "plan"` shows them with each phase's state, and
  `open_only: false` recovers completed work. Builders save a `Report:` note and the main
  session `Ruling:` notes, as `/cc-smart-dev-kit:build` says; no separate progress file.
- A new ask during a build: in scope, a task under the phase that owns its files; for later, a
  task in the next queued plan (`/cc-smart-dev-kit:plan-task` § 6).

## 4. The CLI fallback

`cc-smart-dev-kit task` runs the same operations:

```
add <subject> [--kind work|staging|prod] [--deploy before|after] [--type blocking|non-blocking]
    [--pair] [--parent <ref>] [--blocked-by <ref>]... [--flag <flag>]... [--ref <path>]...
set <ref> [--type …] [--deploy …]    done <ref> --evidence <text>    drop <ref> --note <text>
reopen <id>    note <ref> <text>    list [--scope …]    show <ref>    search <text>    delete <ref>
```

`task check` finds broken files, repeated ids, missing twins and stale tasks (exit 1 on any);
`task list --branch` and `--branches` list the deploy task changes of this branch and of
unmerged ones. The old kinds `follow-up` and `teammate` answer "gone in 5.0.0" (exit 2).

## 5. The deploy run

Before any deploy, production or database work, list the deploy tasks (`task_list` with scope
`project`, or `task release <env>`). Then, in your own checkout:

1. **Cut a deploy branch** from the commit that ships: `git fetch origin`, then
   `git switch --no-track -c deploy/<env>-<YYYYMMDD-HHMM> origin/<base>`, in the checkout you work
   in. The `task` command writes and reads deploy tasks in the folder it runs in; the task tools
   use the session's checkout. `--no-track` stops a plain `git push` from targeting the base.
2. **`cc-smart-dev-kit task release <env> --before`.** Exit 1 while the environment is not in
   `tasks.envs`, a blocking `before` task is open, a task file is broken or its id repeats, prod
   waits on an open staging twin (or names a twin that is no task: `task check` shows it), the
   branch is the base itself (or detached, or the ref's own branch), or HEAD is not the ref
   (default `origin/<worktrees.base>`): it must hold every commit of the ref and differ from it
   only in task files. A ref that names both a tag and a branch exits 1 too: give it in full
   (`refs/heads/<x>`). It names the open non-blocking `before` tasks: do them, or drop them with
   a reason. It also warns (`!`, no
   refusal) when files outside the tasks folder have uncommitted changes: the gate judged
   committed code only.
3. **Do each task and close it** with evidence; commit the closes on the deploy branch.
4. **Deploy**, with the project's own deploy skill.
5. **`git push -u origin <branch>`**, then **`task release <env> --after`.** Exit 1 while the
   environment is not in `tasks.envs`, any task of that environment is open (before or after), a
   close is uncommitted, a task file is broken or its id repeats, the branch is not pushed, or
   the branch is the base, detached or the ref's own branch (a close is never pushed there). With
   no flag, `release` lists the open tasks and exits 0.
6. **The branch's pull request** (the task files only) merges as the workflow says
   (`/cc-smart-dev-kit:commit`, `/cc-smart-dev-kit:pull-request`).

A wrong command exits 2; a refusal, an unknown ref or a place outside git exits 1. `--json`
prints the answer as data. A deploy branch left unmerged shows in `task list --branches`: its
open tasks, and its closes of tasks the base still has open ("closed on <branch>, not merged").
A prod refusal for an open staging twin may mean that close waits there.
