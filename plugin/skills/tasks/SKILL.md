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
Only a finding **outside** the plan leaves it, and it follows these steps.

1. **Found.** The main session meets it: its own, or one in a builder's `Report:`, a reviewer's
   "Outside this change" or a rules-maintainer's "Follow-ups for the caller". A subagent, and any
   Herdr child (plan or follow-up), never asks, files or starts anything: it lists the finding in
   its report (`herdr report` for a child). The lead asks when it reads that report.
2. **Inside a held plan?** When the finding's files are in a plan that is held (the lead's own,
   or one handed to a plan child, live or gone), it is inside that plan and no follow-up: it
   becomes a task there, and nobody is asked. With a live plan child, send it the finding so it
   makes the task; otherwise create the task yourself (`task_create`, `parent` the plan's `#n`).
   The task is the record; an issue is optional.
   **Outside every plan: ask at once**, one finding per `AskUserQuestion`: what is wrong, its
   `file:line`, what it costs. The options, the recommended one first, only those that fit:
   - **Send it to the follow-up child**, when this lead's follow-up child for this repository is
     in a state `herdr send` accepts.
   - **Start a follow-up child**, when none is live. Say that it costs one full session.
   - **File it only**, as the steps below say. A blocked follow-up child offers only this one
     (step 4); a no is this too.
3. **On a yes, file first, then start or send.** When issues work, file it
   (`cc-smart-dev-kit issue file --title "<title>" --body-file - --fingerprint <stable key>`, the
   body on standard input; the same fingerprint updates the issue it filed, so `updated #n` means
   it is already known: send nothing twice). Read the text first: its secret screen knows only
   common shapes. With issues off, or where `issue file` refuses, there is no issue number: say so
   in the end-of-turn summary. Then start the child or send to it. The commands, the one-child
   gate, the send text and when the child ships are in `/cc-smart-dev-kit:herdr` § Follow-up
   child and `/cc-smart-dev-kit:commit` § Pushing.
4. **A blocked follow-up child** waits for the person in its pane, so a send is refused. Offer
   "file it only" and say where it waits (`hc attach <terminal>`). The issue stays filed, and you
   send it the next time you see the child idle, working or done. Never relay its question.
   **A child in the error state** gets neither a send nor a start: tell the person to look at
   its pane.
5. **No child possible** (not in a Herdr terminal, a plan-mode lead, a refused start): file it,
   or put it in the summary, and say why.
6. **Away:** `AskUserQuestion` is denied. Park one `question` for each finding, with the same
   options (`/cc-smart-dev-kit:user-unavailable`); a yes on return goes through step 3
   (`/cc-smart-dev-kit:user-available`).

## 2. Create

- `task_create` takes a subject, a free-form description, and optionally `parent`, `type` and
  `blocked_by`. `type` is `blocking` (the default for a work task: it holds its parent while
  open) or `non-blocking` (holds nothing). `blocked_by` names the tasks it waits for: it cannot
  start or be done while one is open. Layers, phase fields and the plan cap:
  `/cc-smart-dev-kit:plan-task` § 4 and § 5.
- **`files`** (CLI: `--path`, repeated) is the file list of a **plan task**; any other kind
  refuses it. Each path is repo-relative with `/` separators, and a folder ends in `/`. The call
  tidies `./` and `\`, and refuses an absolute path, `..`, the root, `*` and `?`. A set
  replaces the list (`[]` or `--no-files` clears it). Two plans overlap when a path is equal or
  sits inside the other's folder, except paths the project lists in `plans.mergeFiles`. A plan
  with no list is never handed to a child. `task_get` prints the list. A session opened before
  5.2.0 does not know `files` or reservations: restart it first.
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
- A plan **reserved** for a child (`task_get` shows `Reserved for:` and a hand-out id) is taken
  only with `from` set to the hand-out id (which the child's brief names) or to the lead's
  current session, or by its owner; `force` is the person's. Another session's start in it is refused, and so is the lead's. Its files stay held
  until `herdr plans` releases them (`/cc-smart-dev-kit:build` § Lead + children and coordinator
  modes, `/cc-smart-dev-kit:herdr`); dropping the plan releases them at once.
  A start of a plan that shares a file with a held plan is refused too, with the plan and the way out.
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
    [--plan <slug> [--path <file-or-folder/>]...]
set <ref> [--type …] [--deploy …] [--path <p>... | --no-files]    done <ref> --evidence <text>    drop <ref> --note <text>
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
   only in task files. It names the open non-blocking `before` tasks: do them, or drop them with
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

A wrong command exits 2; a refusal, an unknown ref, a ref name that matches more than one ref
(the answer names them: pick the one that ships) or a place outside git exits 1. `--json`
prints the answer as data. A deploy branch left unmerged shows in `task list --branches`: its
open tasks, and its closes of tasks the base still has open ("closed on <branch>, not merged").
A prod refusal for an open staging twin may mean that close waits there.

**The deploy guard.** A project lists the commands it deploys with in `tasks.deployCommands`
(`project init` asks for them). While the environment has a blocking problem (the same rules as
`--before`, minus the git ones), the guard asks the person before Claude runs a listed command.
It names each problem. Do the task and close it with evidence; never drop a blocking one
yourself. A command that is not listed, or is spelled another way, is not seen: the guard is
a rail against a skipped step, not a lock, so run the gates above either way.
`task release <env> --check` judges the task files alone, with no git, so a CI job can run it
before its deploy step (README § Deploy tasks in CI).
