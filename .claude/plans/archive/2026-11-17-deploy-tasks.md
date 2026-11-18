# Plan: deploy tasks (prod and staging), a `tasks` skill, follow-ups as issues — 5.0.0

**Summary**
- "Project tasks" become **deploy tasks**: prod and staging, each a step owed **before** or
  **after** a deploy, **blocking** or **non-blocking**, with date-time ids. Follow-up and
  teammate kinds go. A new `/cc-smart-dev-kit:tasks` skill teaches every kind of task.
- A deploy runs on a **deploy branch** cut from the commit that ships. Two gates
  (`task release <env> --before|--after`) refuse while a task is open, and the closes reach
  main through that branch's small pull request. Nothing lingers.
- Plan-owned findings stay in the plan. Others become GitHub issues, now on by default.
  `project init` adds a managed section to a project's deploy skill. This is a breaking change:
  5.0.0.

Slug: `deploy-tasks`. On approval this file moves to `.claude/plans/2026-11-17-deploy-tasks.md`
on a new branch `feat/deploy-tasks` from `main`. The checkout still sits on the merged
`fix/herdr-no-relay`.

## Context

The person wants project tasks used only for what must happen around a deploy. Today they
also hold follow-ups and teammate setup. This repo has 28 open files, mostly follow-ups that
never close, and `doctor` raises false "missed release" alarms (T-gpmiae, T-xscjki). The
person asked for three things:
- Claude knows what each kind of task is for, sees deploy tasks whenever it works on a
  deploy, production or a database, and closes them.
- Deploy tasks are resolved by the release.
- Claude covers every finding that belongs to its plan.

## Decisions (the person's)

| # | Decision |
|---|---|
| D1 | Only deploy tasks. Kinds `follow-up` and `teammate` are removed. |
| D2 | Two separate kinds, **prod** and **staging**, each in its own folder. A project lists the environments it has (`tasks.envs`, default `["staging","prod"]`). |
| D3 | Two required fields: `deploy: before \| after` and `type: blocking \| non-blocking`. Blocking must be done. Non-blocking is done, or dropped with a reason. They replace `when` and `weight`. |
| D4 | Date-time ids, not random. |
| D5 | Nothing lingers: the deploy run is not finished while any task for that environment is open. |
| D6 | A bug, gap or follow-up that **belongs to the plan** is covered by the plan. Found while planning, it goes into the design and phases. Found while building, it becomes a task under the owning phase, done before the plan closes. Only a finding **outside** the plan becomes a GitHub issue, filed by the main session; a subagent lists it in its report. Without GitHub, the finding goes in the end-of-turn summary. |
| D7 | GitHub issues on by default; `allowPublic` stays off. |
| D8 | `project init` finds the deploy skill, shows the section, asks, then writes it. `project init --no-deploy-block` removes it. `restore` never touches project files. **With no deploy skill (the person, 2026-11-18), init creates one** at `.claude/skills/deploy/SKILL.md` (asked, default yes; `--yes` creates it): frontmatter `name: deploy` with a deploy/staging/prod description, a "This project's deploy steps" section that says they are not written yet (Claude asks the person how the project deploys and writes them; it never invents a deploy command), and the kit's managed block. |
| D9 | Old task files are not migrated; the person deletes them. The kit only *names* them, as "not read since 5.0.0". |
| D10 | Version 5.0.0, so the self-update holds until `cc-smart-dev-kit update`. #353 becomes 5.1.0. |
| D11 | A clean break: no compatibility for old kinds, fields or ids. |
| D12 | A deploy runs on a **deploy branch** cut from the commit that ships. Closes are committed there and merge into main by its pull request. |
| D13 | A step owed on both environments is a **linked pair**. Prod's `--before` refuses while the staging twin is open. |
| D14 | Only the person drops a **blocking** deploy task, in their own terminal. Inside Claude Code it is refused. |
| D15 | A new `tasks` skill is the one home for task knowledge. |

## The design

### Files and ids
- Under `tasks.dir` (default `.claude/tasks`), each env in `tasks.envs` has a folder: `prod/`,
  `staging/`. Each folder has its own `archive/`. One file per task: `<id>-<slug>.md`.
- **Id** is `<env>-<YYYYMMDD>-<HHMMSS>` in UTC, for example `prod-20261117-144503`.
  - A taken id gets `-2`, `-3`.
  - Front matter is the only authority for an id. The file-name reader only reserves taken ids.
  - One regex holds the shape.
  - One `isDeployTaskId()` replaces the five `startsWith("T-")` in `ops.ts`.
- **Front matter:**
  ```yaml
  id: "prod-20261117-144503"
  title: "Run the orders migration"
  env: "prod"              # must match its folder and its id prefix
  status: "open"           # open | done | dropped
  deploy: "before"         # required: before | after
  type: "blocking"         # required: blocking | non-blocking
  twin: "staging-20261117-144503"   # optional: the linked pair (D13)
  flags: ["needs-yes"]     # unchanged set
  created: "2026-11-17T14:45:03Z"   # ISO, must end in Z
  closed: …, from: …, refs: […], evidence: …
  ```
- **Copies vs collisions.** Two files with one id **and the same file name** are a crash copy:
  the archived one wins (today's rule). One id with **different file names** is a
  `duplicate-id` finding naming both paths. `find` refuses that id, the gate exits 1, and the
  fix is to rename one id. Never "delete this file".
- **Old files.** Top-level `*.md` in `tasks.dir` (the 4.x layout) are not read. `task check`,
  `doctor` and the session-start line give their count: "N old task files are not read since
  5.0.0: recreate each as a deploy task, or delete it".

### Closing, dropping, reopening
- `done` needs `evidence`; `dropped` needs a `note`, for every deploy task.
- Closing writes `closed`, the evidence and a log line, then moves the file to `archive/`.
  Closing a closed task is refused.
- **Dropping a blocking task** is refused in the MCP server and in `task drop` inside Claude Code
  (the same inside-Claude-Code check `workflow set` uses for `OUTBOUND_KEYS`). The person runs
  `cc-smart-dev-kit task drop <id> --note "…"` in their own terminal (D14).
- **Reopen** puts a closed task back to open, from `archive/` to its folder, for a deploy that
  was rolled back. It uses `task_update` with `status: "open"`, or `task reopen <id>`.

### The deploy run (D12) and the gates
`cc-smart-dev-kit task release <env> --before|--after [--ref <ref>]`. `--ref` defaults to
`origin/<worktrees.base>`. Every answer prints the ref and commit it read.

1. **Start** on a deploy branch from the commit that ships. `--before` refuses unless HEAD
   equals `--ref`, or differs from it only under `tasks.dir` (closes already made). The refusal
   prints the commands: `git fetch origin`, then
   `git switch --no-track -c deploy/<env>-<YYYYMMDD-HHMM> origin/<base>`, in the session's own
   checkout (`--no-track` keeps a plain `git push` from targeting the base).
2. `--before` exits 1 in four cases:
   - a blocking `before` task is open;
   - a broken or `duplicate-id` file;
   - for prod, a task whose staging `twin` is still open;
   - an env not in `tasks.envs`.
   It names the open non-blocking `before` tasks: do them now, or drop them with a reason.
3. Claude closes each task with evidence and commits the closes on the deploy branch.
4. The deploy itself is the project's own deploy skill.
5. `--after` exits 1 in four cases:
   - **any** task for that env is open, before or after;
   - `tasks.dir` has uncommitted changes;
   - the branch is not pushed;
   - a broken file.
   Then the branch's pull request (task files only) merges per the workflow: `commit` and
   `pull-request` skills.
6. With no flag, the command lists the tasks by deploy and type and exits 0.
7. Errors: outside git or an unknown ref exits 1 (exit 2 is only for a wrong command).

The release-branch idea goes, along with `missed-release`, `shippedIdsOn`,
`tasks.releaseBranch` and `tasks.legacyFolders`, and the T-gpmiae and T-xscjki bugs with them.
A deploy branch left unmerged is a visible "run in progress": `task list --branches` shows its
open tasks.

### The linked pair (D13)
- `task_create` with `kind: "staging"` and `pair: true` (CLI `--pair`) creates both files in
  one call. Each file names the other in `twin`.
- The pair is refused when `tasks.envs` lacks either env.
- `task check` reports a twin id that names no task.

### Tool rules (MCP and CLI)
- `kind` is `work | prod | staging` and defaults to `work`.
- `deploy`, `twin`/`pair`, `flags`, `refs` and `from` are **refused on a work task**. So a
  forgotten `kind` can never silently make a machine-local task.
- `deploy` and `type` are **required** on prod and staging.
- The shared `type` description covers both meanings: a work task's hold on its parent, and a
  deploy task's hold on the release.
- Removed: `when`, `weight`, `for_everyone`/`--for-everyone`, the teammate branches in
  `ops.ts`, `ack()` and its test, and `task import notes`.
- The `acks` table **stays in `SCHEMA`**: a 4.x server still queries it and `min_compatible`
  stays 1. A comment in `db.ts` says why.
- `task list --branches` reports a broken file on one branch and keeps listing the others.

### Config
- New: `tasks.envs`, an array from `{staging, prod}`, default both, in the since-table at 5.0.0.
- `tasks.releaseBranch` and `tasks.legacyFolders` are **accepted and ignored**, not retired.
  - Doctor shows a `!` line: "no longer read since 5.0.0: remove it", with the fix `project init`.
  - `project init` deletes both fields.
  - Why: the retired-field pattern fails every guard closed, and `project init` cannot repair
    it today (`init.ts:396-452`).
- **4.x silence:** `project init` raises `requires` to `>=5.0` when the project has deploy
  task folders or the deploy block. Doctor warns when they exist and `requires` is lower, with
  the fix `project init`. A 4.x kit then says "update" instead of showing nothing.

### The `tasks` skill (D15)
`plugin/skills/tasks/SKILL.md`, `/cc-smart-dev-kit:tasks`. It covers:
- **Which task, when:**
  - a loose work task;
  - plan › phase › task;
  - a deploy task, for prod or staging, as a pair when both;
  - a finding: "does it belong to the plan?" (D6). Yes: plan or phase task. No: an issue
    (main session), never a task.
- **How to create:** the MCP tools, their fields, and the CLI fallback.
- **How to use:**
  - status, notes, `type` and `blocked_by`;
  - taking, parking and resuming a plan;
  - closing with evidence, dropping with a reason, reopening.
- **The deploy run:** the steps in § The deploy run.
- **Description triggers:** "task", "track this", "deploy", "prod", "staging", "migration",
  "release".

Where the content comes from and goes:
- It moves out of `memory-routing` § Using tasks; `memory-routing` keeps one routing row
  pointing to the skill.
- Pointers to it go in `plan-task` § 4 and § 6, `build`, `commit`, `pull-request` and
  `plugin/agents/builder.md`.
- The always-on budget (`scripts/check-context-budget.ts` `ALWAYS_ON.max`, 2,766) is
  re-measured and raised by exactly the new description's cost.

### Where Claude learns it (always present, each pointing to `tasks`)
1. `TASK_SERVER_INSTRUCTIONS` (`src/tasks/mcp.ts`): "A step owed before or after a deploy to
   prod or staging is a deploy task. Before any deploy, production or database work, list them;
   close each with evidence (/cc-smart-dev-kit:tasks)."
2. `plugin/instructions/core.md`, which stays at 129 lines or fewer:
   - line 34 becomes D6's rule, keeping "the main session files the issue".
   - line 47 becomes "steps owed around a deploy → prod or staging tasks".
3. The session-start hook adds one line when any task is open, broken or old: "Deploy tasks
   open: prod 2 (1 blocking before the deploy), staging 0; 1 unreadable; 3 old files not
   read — /cc-smart-dev-kit:tasks". It scans the top level of each env folder only, never
   `archive/`, within the hook's 5 s budget.

### The deploy-skill block (D8)
- Text is short: the two gate commands, the deploy-branch step, the close step, and the pointer
  to `/cc-smart-dev-kit:tasks`. One home: `src/project/deploy-block.ts`.
- Its own planner and writer live in `src/project/deploy-skill.ts`. `ProjectInitPlan` is left
  alone, so the portal's init callers (`src/portal/actions.ts`, `facts.ts`,
  `workflow-adapter.ts`) never write a skill.
- **Find:**
  - `.claude/skills/*/SKILL.md` with "deploy" in the folder name or the frontmatter `name`;
  - or a file that already holds the kit marker;
  - or `--deploy-skill <path>`.
  If several are found, one question picks the file, asked with the other questions first. With
  `--yes` and no path, there is a note and no write.
- **Write:**
  - `renderManagedMarkdown` / `renderWithoutBlock`, with `backupFile` + `atomicWrite`, never
    `changed.json`;
  - the real path must be inside the checkout, so a symlink out is refused;
  - re-read and compare just before the rename;
  - keep the file's CRLF line endings;
  - `--dry-run` shows the diff.
- **Doctor** warns when the block differs from the current text, with the fix `project init`.
- One shared frontmatter reader, `src/project/frontmatter.ts`, extracted from
  `src/models/agent-definition.ts`'s private `frontmatter()`. `format.ts` and the deploy-skill
  finder use it too.

### Issues on by default (D7)
- `workflowDefaults.issues.enabled = true` (`src/workflow/schema.ts:269`). The D67 comment and
  the `OUTBOUND_KEYS` rationale are rewritten: the person chose this default.
- **Doctor** (`src/issues/doctor.ts`):
  - when the switch's source is `default`, every "cannot file here" result is a `·` info line
    ("follow-ups go in the summary"), and the `allowPublic` nudge goes;
  - an explicit setting keeps today's ✗.
  So the installer never exits 3 for a switch the person never touched.
- The gate that needs a project config stays (`src/issues/file.ts`), as do `allowPublic: false`
  and the issues command's help text (`src/issues/command.ts:27`).
- `project-checks.test.ts` gets a fake `gh`, so no test calls the real one.
- The CHANGELOG says plainly: the kit now files GitHub issues without an opt-in, in private
  repos with a kit config.

## Phases (one pull request; 7 phases)

| Phase | Owns | Agent · model · effort | Blocked by |
|---|---|---|---|
| `store` (contract) | `src/tasks/project/` → `src/tasks/deploy/` (format, files, release gate, check, branch; delete import-notes); `src/project/frontmatter.ts` + `src/models/agent-definition.ts`; `src/tasks/context.ts`; `src/project/config.ts` (`envs`, ignored fields, since-table); `src/project/deploy-block.ts`; `src/tasks/work/store.ts` (`ack` out), `db.ts` (comment), `history.test.ts`. **Plus the mechanical import and removal edits in every importer**, so the tree typechecks at every phase end: `ops.ts`, `command.ts`, `project-checks.ts`, `task-start.ts`, `src/portal/api/project-tasks.ts`. Tests first. | builder · sonnet · high | — |
| `issues` | `src/workflow/schema.ts`, `src/testing/fake-workflow.ts`, `src/issues/doctor.ts`, `command.ts` and tests, `src/workflow/*.test.ts`, `docs/design/issues.md` | builder · sonnet · high | — |
| `tools` | `src/tasks/ops.ts`, `schemas.ts`, `mcp.ts`, `command.ts`, `words.ts`, tests: kinds, required fields, pair, drop guard, reopen, gate CLI, `--branches` tolerance | builder · sonnet · high | store |
| `init` | `src/project/deploy-skill.ts` (find, plan, write, stale), `src/cli/project-init.ts` (question, `--deploy-skill`, `--no-deploy-block`), `src/project/init.ts` (delete the ignored fields, `requires` floor), tests | builder · sonnet · high | store |
| `portal` | `src/portal/api/project-tasks.ts` (files part: env, deploy, type, twin), `types.ts`, `wire-mirror.ts`, `portal/src/api/wire.ts`, `tasks-card.tsx` (prod/staging sections, blocking marks), `lib/tasks.ts`, `views/tasks.tsx`, fixtures, mocks (incl. `mock-projects.ts:114`), tests, then a `ui-verify` check | builder · **opus** · high | store, issues |
| `surfaces` | `src/hooks/task-start.ts`, `src/cli/project-checks.ts` (deploy findings, old files, ignored fields, `requires`, stale block), their tests | builder · sonnet · high | store, issues, init |
| `docs` | **new `plugin/skills/tasks/SKILL.md`**, `scripts/check-context-budget.ts`, `plugin/agents/builder.md`, `plugin/instructions/core.md`; skills memory-routing, plan-task, build, commit, pull-request, subagent-decision, react-best-practices (+ playbook line 4230); `docs/design/tasks.md`, `portal.md`, `sessions.md`, `hooks.md`, `roadmap.md`, `docs/design.md`; `README.md` (task table, config, doctor, issues lines 392/2675/2916); `.claude/rules/cc-smart-dev-kit-json.md`; `.claude/CLAUDE.md` | rules-maintainer · sonnet · high | store, issues, tools, init, portal, surfaces |

**Main session:**
- version 5.0.0 in `plugin.json`, `install.sh` and `install.ps1`;
- a `src/update/major-notes.json` entry for 5.0.0;
- `bun run build` and `build:portal` (`router.js` unchanged);
- `CHANGELOG.md`;
- the final full check and both validates;
- the final review (senior-engineer · opus · xhigh).

**Waves:**
1. `store`, `issues`.
2. `tools`, `init`, `portal`.
3. `surfaces`.
4. `docs`.
5. Integration.

## Edge cases

| Trigger | What the plan does |
|---|---|
| Gate run on a stale checkout or a feature worktree | `--before` refuses unless HEAD is `--ref` (plus task-file changes only). It prints the ref and commit read. |
| Closes made but never merged | `--after` refuses while they are uncommitted or unpushed. The deploy branch's PR carries them. |
| Two tasks in one second, same checkout | `-2` suffix. |
| Same id from two branches (different file names) | `duplicate-id` finding; the gate exits 1; never "delete". |
| `env` ≠ folder or ≠ id prefix; `created` without `Z` | broken-file finding. An archived file's env comes from `<env>/archive/`, built with `path` functions so Windows works. |
| prod task whose staging twin is open | prod `--before` exits 1. |
| A project with only prod | `tasks.envs: ["prod"]`; staging create and pair are refused. |
| Claude tries to drop a blocking task | Refused inside Claude Code; the person runs `task drop`. |
| `kind` forgotten with `deploy` set | Refused: `deploy` is not a work-task field. |
| Deploy rolled back after `before` closes | `task reopen` / `status: open` moves the task back; `--before` exits 1 again. |
| Old `T-*.md` files (4.x, or written by an old session after the update) | Counted and named on every surface; never read. `task_done T-…` answers "old task ids are gone in 5.0.0". |
| A 4.x kit, or a teammate held on 4.x | `requires >=5.0` (raised by init) makes 4.x say "update". Without init, doctor warns. |
| A project sets `tasks.releaseBranch` / `legacyFolders` | Loads fine. A doctor `!` line; init removes them. No guard fails. |
| Deploy skill is a symlink out of the repo, or a plugin's | Refused (real path outside the checkout) / not found (a note). |
| Broken marker pair in the skill | `findBlock` throws; init names the file and writes nothing to it. |
| Skill edited while init asks | Re-read and compare before the rename; a change aborts that write. |
| Issues on by default without GitHub, or in a public repo | `·` lines in doctor. `issue file` refuses with its reason, and the follow-up goes in the summary. |
| An older MCP server in a still-running session | It writes top-level `T-*.md`, which surfaces as "old files". The person restarts sessions on a major version. |
| A task closed in a worktree the MCP server does not resolve to | The tool answer names the checkout it wrote in. The `tasks` skill says to run deploy runs in the session's own checkout. Live check owed: `docs/claude-code-contract.md` row 33. |

Axes that cannot apply: money, auth and tenancy, and the router (`router.js` checked). There is
no load at scale.

## What could break

- Every importer of `src/tasks/project/*`: handled inside `store` so typecheck stays green.
- The portal: the hand-mirrored wire types, plus `planProjectInit`'s callers, which are
  untouched because the block has its own writer.
- `commit`/`pull-request` run `task list --branch`; its headings become prod/staging.
- Tests that assert issues are off by default flip. `project-checks.test.ts` needs the fake
  `gh`.
- The merge guard and the other hooks do not read the issues switch (checked).

## A simpler approach?

Skill text alone, with no gates, was rejected: "nothing lingers" and "closes reach main" need
checks that exit 1. One folder with an `env` field was rejected because the person asked for
separate kinds.

## Rollback

Revert the merge and release 5.0.1 with the 4.10.1 behaviour. 4.x code never reads `prod/` or
`staging/`, so the task files are harmless. `requires >=5.0` in a project would then need to be
lowered by hand; the rollback notes say so.

## How we prove it

**Tests, each seen failing first:**
- **Gate:**
  - `--before` on HEAD ≠ ref → 1;
  - an open blocking `before` task → 1;
  - only non-blocking tasks → 0;
  - an open staging twin → 1 for prod;
  - `--after` with an open task, an uncommitted close or an unpushed branch → 1.
- **Ids:** the `-2` suffix; `duplicate-id` vs a crash copy; env/prefix/folder mismatch; `Z`
  required, with `TZ` set.
- **Tools:**
  - a blocking drop is refused inside Claude Code;
  - `deploy` on a work task is refused;
  - a pair creates two files;
  - reopen moves a file back;
  - closing a closed task is refused.
- **Config:** the ignored fields load and give a doctor line; init removes them; `requires`
  is raised.
- **Deploy block:** insert, update and remove are byte-identical around the block (also with
  CRLF); a symlink out is refused.
- **Issues:** `enabled` resolves `true` by default; a non-GitHub origin under the default gives
  a `·` line and doctor exits 0.
- **Session start:** the line shows with open, broken or old tasks, and is absent with none.

**Full check:**
- `bun run check`;
- `cd portal && bun run test`;
- `bun run check:portal`;
- both strict validates;
- `git diff --stat plugin/dist` shows no `router.js` change.

**Live, by me, in a temp repo:**
1. `project init` writes the deploy block (`--dry-run` first).
2. `task add --kind staging --pair --deploy before --type blocking`.
3. `task release prod --before` on main → refused with the branch command.
4. On a deploy branch → refused (open twin), then green after the closes.
5. `--after` → refused until committed and pushed (to a local bare remote).

**For you:**
- after `cc-smart-dev-kit update` (the major hold), check that a new session shows the
  deploy-task line;
- read the block `project init` writes into one real project's deploy skill;
- check the portal's Tasks page shows the prod/staging sections;
- check `/cc-smart-dev-kit:tasks` loads when you say "deploy".

## Follow-ups this plan makes moot

T-gpmiae and T-xscjki: the code they describe is removed. The person deletes the old task files
(D9).
