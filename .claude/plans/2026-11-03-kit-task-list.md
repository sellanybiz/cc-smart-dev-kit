# Plan: the kit's own task list — live work in Bun SQLite, project tasks in the repo (1.10.0, D75)

## Context

A session's work has too many homes today, and they rot:

- **Claude Code's task tools** feed the kit's guards (`src/crew/tasks.ts`: the crew's first-edit
  gate, the crew and lead Stop blocks, the done-report gate `src/crew/report.ts:285`, the lead's
  reminder). On current models they are off unless opted in (D68's `CLAUDE_CODE_ENABLE_TODO_TOOLS`),
  deferred behind ToolSearch, missing in background subagents, keyed by session id, and 2.1.316 has
  a second storage backend the kit cannot read.
- **claude-mem's work state** tells every session to use it "instead of any built-in to-do tool",
  while the kit's guards need the built-in list.
- **A project's hand-kept ledgers.** A web app on the kit keeps three folders of notes (database
  follow-ups, production steps, teammate setup): 238 open, 744 archived, 102 open past 30 days.
  "Next release" database work missed a release. Closing is manual (status, proof, move, commit, a
  closing PR), and five notes looked finished while work remained. The rules disagree with each
  other, 5 of 36 release PRs had blank notes headings, notes on unmerged branches are invisible, and
  sorting ~110 notes took three agents. Its plans double as task logs (the largest is 4,862 lines,
  about half task log).

**The owner's ask:** the kit owns one task system: tasks with a title and a free description of
any length, subtasks, notes saved during work, an MCP server on Bun's SQL database, project-level
tasks that replace those ledgers, the guards as I judge, the plan skill on top of it, and plan files
that shrink to design.

## Decisions (the owner, 2026-11-03)

- **Hybrid storage.** Live work in a local `bun:sqlite` store keyed by project; project tasks as one
  Markdown file each in the repo. One set of tools for both.
- **Markdown + front matter** for a project task file.
- **Claude Code's task tools are replaced** (setup's deny rules; `restore` undoes them).
- **claude-mem keeps memory only** (work state off; a one-time import of its open lists).
- **The official MCP SDK**, `@modelcontextprotocol/server` + `@modelcontextprotocol/core` 2.4.0
  (deps: zod only; Apache-2.0), the kit's second runtime dependency.
- **One release, 1.10.0**, with the lead keep-going guard folded in. Trade-off written down: leads
  on backend models keep stalling at each step until it ships.

## Why two stores

Live work changes every minute and must be seen across worktrees at once; in git each worktree sees
only its own branch, and every status tick would be a commit (it breaks the review record, "changed
after review", and floods the PR diff). Project obligations must be shared with teammates and other
machines, reviewed in the PR that creates them, and travel with their branch; a local database
cannot. So: **work tasks** local, **project tasks** in git, one tool surface, the kind decides.

## The work store (`src/tasks/work/`, local)

- `<stateDir>/tasks/work.db`, `bun:sqlite`, WAL, short `BEGIN IMMEDIATE` writes with
  `busy_timeout`. Schema in `PRAGMA user_version` plus a `min_compatible` value: migrations are
  additive only, so old code still running from an old version folder keeps working.
- `tasks` (id, `number` per project shown as `#12`, project, parent, subject ≤ 200, description
  ≤ 200 KB free Markdown, status `pending | in_progress | done | dropped`, plan, phase, crew_id,
  `created_by` session, `claimed_by` Claude process (pid + start time), timestamps),
  `task_deps` (waits for), `task_notes` (≤ 64 KB each, the "save as you go" log), `acks` (a
  teammate project task done on this machine). Search is `LIKE` (no FTS5 in this release).
- **Rules, one home:** `done` only when every subtask is `done`/`dropped` (the refusal names
  them); a cycle is refused; a system close (merge, removal) drops open subtasks with an automatic
  note; a task made by mistake can be deleted while it has no subtasks or notes.
- **Who a call belongs to.** The server finds its Claude process (Linux: `/proc` ancestry,
  `src/jobs/ancestry.ts`; macOS and Windows: `ppid` plus one hop) and re-reads that process's
  session record on every call (`src/hooks/sessions.ts`): its session id and its `cwd`, which
  follows the session into a worktree. Project = the crew store's repo key for that `cwd` (a
  folder outside git: its own real path). So `/clear` and a background fork keep the same tasks.
  - **Crew:** `CC_SMART_DEV_KIT_CREW` → its **phase task**, keyed by (plan, phase); `crew start`
    makes it (also for a queued phase), `--waits-for` becomes `task_deps`, a continuation re-points
    `crew_id`. New tasks default to its subtasks.
  - **Lead:** its plan → the **plan task**. "The lead's own tasks" are those made by its sessions
    (`leadSessions`, so adoption carries them), not the plan task or phase tasks.
  - **Any session:** "mine" = claimed by this Claude process. Others' in-progress tasks show as
    "(another session)".
- **Hooks read** through `src/tasks/work/read.ts`: open read-write with `PRAGMA query_only` (a
  read-only open of a WAL file fails when no writer has it open), indexed, short busy wait, fail
  open. **For one release it also reads Claude Code's list** (`src/crew/tasks.ts`, the legacy
  reader), so a machine that updated before running setup is never stuck.

## The project store (`src/tasks/project/`, in the repo)

- Folder from `.claude/cc-smart-dev-kit.json` `tasks.dir` (new optional field, default
  `.claude/tasks`), closed ones in `archive/`. One file per task, `<id>-<slug>.md`; `id` is a short
  random `T-xxxx`, so branches never collide.
- Front matter, each value written as JSON on its own line (Bun's built-in YAML reads it back):
  `id, title, kind (production | database | teammate | follow-up), status (open | done | dropped),
  when (now | next-release | any), weight (blocks-release | after-deploy | owner), flags
  (needs-yes, twice-safe, spends-money, real-people, destructive), created, closed, from (plan,
  phase, branch), refs (paths it points at), evidence`. The body is free Markdown; each kind has
  suggested headings (what and why, steps, how to check, if it goes wrong, log), never enforced.
- **The kit runs the life of each one, never a session's memory:**
  - **Create:** written into the session's own checkout (a crew's worktree), so it ships in that
    branch's commit and PR.
  - **PR body:** `task list --branch` (task files new or changed against the base) fills the
    notes and still-owed headings; never blank.
  - **Release:** `task release` lists open production and database tasks by weight, every
    `next-release` one, and those that already missed a release.
  - **Close:** one call (`task_done T-xxxx --evidence …`) sets status, date, evidence and a log
    line and moves the file to `archive/`.
  - **Merge:** the lead's watch says which project tasks a merged crew branch brought.
  - **Teammate tasks:** each machine records "done here" (`acks`), so each person sees only what
    they have not done; the file closes when its author or a release closes it.
  - **Rot:** `task check` (and `doctor`'s project lines, one line in the lead's start block) finds
    tasks open past `tasks.staleDays` (default 30), `next-release` tasks that missed a release,
    `refs` that no longer exist, duplicate titles, broken files; `task list --branches` shows open
    tasks on local branches not yet merged.
- **Import a project's ledgers:** `task import notes <folder> --kind <kind> [--dry-run]`: each open
  note → one task file (title from its first heading, created from its file name, the body
  unchanged). The old files are removed by that project's own PR.

## What a session uses

- **MCP server** `cc-smart-dev-kit tasks mcp` (the SDK, bundled), registered by setup at user scope
  through the launcher (the `playwright` pattern, `src/mcp/servers.ts`: Windows-safe, outlives
  version folders) with `alwaysLoad: true`, a managed `permissions.allow` rule for its tools, and in
  **every crew session's `mcp.json`** (`serversFor`, `src/crew/claude.ts:355`; rewritten on resume,
  `src/crew/answer.ts:577`). Tools: `task_create` (kind decides the store), `task_update`,
  `task_done`, `task_note`, `task_list`, `task_get` (output capped, with an offset), `task_search`.
  Its `instructions` say what goes where, in a few lines.
- **CLI** `cc-smart-dev-kit task add|start|done|drop|note|list|show|search|check|release|import`:
  the same modules, for the person, and wherever the server is missing.
- **Session start:** plain sessions get one capped block (in progress first, then the 8 most recent,
  "+n more", no descriptions, stale ones hidden); a crew session's branch goes into `crew-role`'s
  card, not a second block; a lead gets one line for project tasks gone stale. Until setup has
  registered the server, one line says to run `cc-smart-dev-kit setup`.
- **Status line:** `#12 Merge the wave · 2/5`. **Board:** `crew status` / `crew list` show `3/5`
  per phase. **Portal:** a read-only Tasks view (work tree; project tasks by kind and weight, stale
  marked) and the phase subtree on a crew's page.

## The guards (on the kit's store, with the legacy reader for one release)

- **Crew first edit:** refused until its phase task has a subtask; a crew with no phase task (made
  before the update) is let through; the refusal names the tool and the CLI line.
- **Crew Stop:** open subtasks → "Your task #n (and m more) is still open. Continue it now…"; none
  → the report line (the 1.10.0 rule, folded in).
- **Crew done report:** refused while a subtask is open.
- **Lead Stop:** one of the lead's own tasks in progress, no `Waiting for:` line, no background work
  but its watch → one block; the notifier waits for it (`leadStopWouldBlockAt`) (1.10.0, folded in).
- **Lead reminder:** a lead with no task of its own gets one line per prompt.
- **Phase task follows its crew:** merged → `done`, removed → `dropped` (system close).

## One home: the old lists go (setup, through `src/setup/`; `restore` undoes each)

- Withdraws `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` and flips `doctor`'s D68 check in the same phase.
- Managed `permissions.deny`: `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TodoWrite` (names
  checked against the binary; never `TaskStop` or `TaskOutput`).
- `CLAUDE_MEM_WORK_STATE_ENABLED: "false"`; a person's own `"true"` stays, as information.
- Registers the server. **Import once, by the person:** `task import claude-mem [--dry-run]` reads
  `~/.claude-mem/claude-mem.db` read-only (`work_state_entries`), folds rows as claude-mem does, adds
  the open lists as work tasks; a schema it does not know is refused.
- `doctor`: the server registered, allow and deny entries, claude-mem's switch, the work store
  (schema, `integrity_check`), the project store (`task check`).

## Instructions and docs

- `plugin/instructions/core.md` "Save as you go": work → the kit's task tools (or `cc-smart-dev-kit
  task` where missing); an obligation for production, the database, teammates or later → a project
  task; a fact or preference beyond one task → claude-mem's `save_memory` (`check:core-lines`).
- **plan-task:** the plan file holds design; after approval it makes the plan task, a task per phase
  with steps as subtasks (done-check in each description), and project tasks for what is owed.
  **lead**, **crew**, **commit**, **pull-request**, **memory-routing**, the agents: the new homes.
- `docs/design/tasks.md` (new), D75 (replaces D68's split; `docs/design/claude-mem.md` says so),
  README (commands, the `tasks` field), `.claude/rules/cc-smart-dev-kit-json.md`, contract rows,
  CHANGELOG.

## Phases (each in its own worktree from `worktree-lead-keep-going`)

First, after approval: `bun install` in that worktree, a `wip` commit of the keep-going work, and
this plan copied to `.claude/plans/2026-11-03-kit-task-list.md`.

| Wave | Phase | Owns | Agent |
|---|---|---|---|
| 1 | **T1a Work store** | `src/tasks/work/` (schema, migrations, rules, claims, `read.ts`, legacy union, claude-mem import), `TASKS_SERVER_NAME` in `src/mcp/names.ts` | builder `sonnet` xhigh |
| 1 | **T1b Project store** | `src/tasks/project/` (format, scan, rules, branch list, release list, check, notes import) | builder `sonnet` high |
| 2 | **T2 Server + CLI** | `src/tasks/mcp.ts`, `src/tasks/command.ts`, `src/entries/cli.ts`, `src/cli/help.ts`, `package.json`, `bun.lock` | builder `sonnet` high |
| 2 | **T3 Guards + crew** | `crew-role.ts`, `lead-notes.ts`, `notify.ts`, `report.ts`, `crew start`/continue/queue, `src/crew/claude.ts`, `answer.ts`, watch/after-merge, `board.ts`, the start-block hook, status line, `specs.ts`, `hooks.json` | builder `sonnet` xhigh |
| 2 | **T4 Setup + doctor** | `src/setup/`, `src/cli/setup.ts`, `doctor.ts`, `restore.ts`, `src/mcp/` (registration), `src/machine/claude-mem.ts`, the `tasks` field (`src/workflow/schema.ts`/`src/project/`) | builder `sonnet` high |
| 2 | **T5 Instructions + docs** | `plugin/instructions/`, `plugin/skills/`, `plugin/agents/`, `docs/`, README, rules | rules-maintainer `sonnet` high |
| 2 | **T6 Portal** | `src/portal/api/` tasks routes, `portal/src` Tasks view | me (UI design on Opus) |

Built and versioned once at integration (`plugin/dist`, `plugin.json`, CHANGELOG), never in a phase.
T3 owns the hook text; T5's brief gives the words.

## After the release: the web app moves (its own worktree, branch, PR into its `dev`)

Run `task import notes` on its database, production and teammate ledgers; replace the ledger rules
(its `CLAUDE.md` lines, its notes rule, its commit, pull-request and memory-routing add-ons, its
deploy skill's read-every-note step → `task release`, its after-pull line → teammate tasks); move
its context notes into its docs; its plans README: tasks live in the kit, plans hold design. Its
`.claude/` paths need its code owners' review, so it merges on their yes.

## Verification

- Unit: every rule; additive migrations with old code writing; ten processes writing at once with no
  lost write; the hook reader on a WAL file with no writer, a locked file, a broken file; claims
  across `/clear` (a new session id, the same process); the project file round trip (front matter
  and a 200 KB body); `task check` on stale, missed-release, broken-ref, duplicate and broken
  files; both imports on fixtures; the server through the SDK's in-memory client; setup, restore and
  doctor with fake machines; the crew `mcp.json` with the server.
- `bun run check`, both `claude plugin validate … --strict`, `cd portal && bun run test`,
  `bun run check:portal`; `router.js` unchanged.
- Measured: a hook's read under 10 ms cold; one server process's memory under 60 MB.
- **Live, with you** (new contract rows): the tools appear with no ToolSearch; `TaskCreate` is gone
  from the model's tools; a background crew calls a task tool with no permission prompt; a crew
  session's server sees `CC_SMART_DEV_KIT_CREW`; `/clear` and a background fork keep the same tasks;
  the claude-mem import moves your open lists; a lead on a backend model is held at a promise and
  goes on.
- Review: my own pass on the whole diff, then `cc-smart-dev-kit:reviewer` on `opus` at `xhigh`.
  Then push and open the PR into `main`. **The merge waits for your yes.**

## Not in this release

FTS5 search, database snapshots, task ordering by hand, a Claude Code task-panel mirror, syncing
live work across machines.
