# Plan: 2.0.0, subagent-driven parallel development

## Summary

The kit drops the crew system (crew sessions, leads, crew monitors, the crew start queue, and
every load and usage balancing gate). Its main way of working becomes **subagent-driven parallel
development**: the main session plans, puts each phase in the task system, starts builder
subagents at once (each in its own git worktree when files differ), reviews each hand-back,
merges, and runs one final review. The **task system is the kit's main feature, and the
ledger** that survives compaction. Heavy jobs keep one guard: **one full run at a time per
machine**. Everything else stays: the gateway, Issues, the portal, away mode, sessions, the
guards, the agents and the skills, each without its crew parts. This is a clean break, 2.0.0.

## Decisions (the owner, 2026-11-03)

- **Removed:**
  - crew sessions and leads (`src/crew/`, `crew` command, `lead` and `crew` skills, the crew
    monitors, the crew hooks);
  - the start queue and every balancing gate: caps, load, memory, usage, start spacing;
  - in jobs: memory checks, CPU and I/O weights, systemd slices, `choom`, shared folders, fair
    share, the light lane and `jobs.json` settings.
- **Kept, minus their crew parts:** the gateway, Issues (`issue file`, `issue fixed`, the release
  list; the phase pickup and crew hand-back go), the portal (its crew pages go), away mode (crew
  answers go), sessions, worktrees, every guard, the agents, the workflows.
- **The task system stays in full, upgraded** for subagent-driven development (§ Tasks).
- **Heavy jobs:** the project's `jobs.kinds` say what is heavy. A run on named files skips the
  queue. One heavy run at a time per machine, with no setting.
- **Parallel:** phases whose files differ run at once, each builder in its own worktree
  (`isolation: "worktree"`). Phases that share files run one after another.
- **Leftovers: leave everything.** 2.0 never cleans 1.x's crew store, crew worktrees or crew
  branches. A `workflow.crew` key, or an old `jobs` setting, still **loads and is ignored**,
  never refused: the schema keeps the key as `unknown`, with a comment that says it is ignored
  since 2.0. Nothing else from 1.x is read.
- **No other backward compatibility.**

## How the kit works in 2.0: the main session drives subagents

From the `superpowers` subagent-driven-development skill (obra/superpowers), and from Claude
Code's subagents: the `Agent` tool with `model`, `effort`, `isolation: "worktree"` and
`run_in_background`; `SendMessage` to resume a finished subagent with its context; and agent
frontmatter `skills`, `isolation`, `effort`, `maxTurns`.

1. **Plan** (`plan-task`): the design file, then the ledger in the task system: the plan task,
   one task per phase, and each phase's steps as subtasks.
   - **The phase task's description is the builder's brief:** its files, the patterns, the
     done-check and its limits.
   - Phases name their files. Two phases that share a file are ordered (`blocked_by`).
2. **Build** (the new `build` skill, which replaces `lead`).
   - Start every phase that waits for nothing at once, in one message. Each builder gets
     `isolation: "worktree"` when it runs beside others, and `run_in_background: true`.
   - **What the builder does:** it reads its brief with `task_get #n`, builds, tests and commits
     on its worktree branch. It saves its report as a `task_note` that starts `Report:`, and
     returns status, commits and a one-line test result.
   - **What it never does:** start another agent or review itself.
   - On each hand-back, the main session records the agent, branch, worktree and base on the
     task (§ Tasks).
3. **Review each phase.**
   - One task review: the `reviewer` agent on the phase's diff, for both spec and quality.
   - Fix rounds go back to the same builder through `SendMessage`, up to 3. After that, a fresh
     builder on a stronger model.
   - Then the main session merges the branch, closes the phase task and starts what it
     unblocked, in the same turn.
4. **End.**
   - One final review of the whole branch, on `opus`.
   - One fix pass, and the full check once.
   - Then the commit, the push and the PR, as the project's workflow says.
5. **Rulings, not stalls.** The main session decides ambiguities and records each one as a
   `task_note` that starts `Ruling:`. It stops only for:
   - a destructive or irreversible step;
   - a security-sensitive step;
   - a step outside the worktree that needs a yes (push, merge, publish);
   - a plan so broken that every path is a guess.
6. **After compaction,** `task_list scope plan` and `git log` are the truth: never re-run a phase
   that is done.

## Tasks: the upgrade

- **New work-task fields:** `agent` (the subagent's name or id), `branch`, `worktree` and `base`
  (the commit it started from). They are set through `task_create`/`task_update` and the CLI.
  They are shown by `task_get` and by `task_list scope plan`: one line per phase with its agent,
  branch, state and subtasks done, e.g. `3/5`.
- **Removed:** `crew_id`, `CC_SMART_DEV_KIT_CREW` identity, crew phase-task takeover, crew
  guards and crew run records. The SQLite column may stay unused: migrations stay additive.
- **`phase` stays:** the plan's phase id.
- **The MCP server's instructions say the 2.0 flow in a few lines:** the brief in the phase
  task, `Report:` and `Ruling:` notes, and the ledger after compaction.

## Phases (wave 1 all at once; each keeps the build green while `src/crew/` still exists)

| Phase | Owns | Done when |
|---|---|---|
| **H1 guards** | `src/hooks/{agent-guard,bash-judge,git-guard,merge-guard,message-guard,session-escape-guard,verify-gate,job-route}*` | no import of `src/crew/` or `src/machine/load`; crew refusals gone; their tests pass |
| **H2 hook lifecycle** | `src/hooks/{crew-role,lead-notes,notify,stop-failure,task-start,user-away,session-name,worktree-leftovers,after-merge,specs}*`, `src/entries/{crew-role,lead-notes}.ts` (delete), `plugin/hooks/hooks.json`, `plugin/monitors/monitors.json` (delete) | the same; crew hooks and monitors gone |
| **T tasks** | `src/tasks/**`, `src/entries/tasks-mcp.ts` | the § Tasks upgrade; no crew import; tests pass |
| **P portal** | `src/portal/**`, `portal/src/**` | the crew pages, API and live sources gone; the tasks view shows agent and branch; `cd portal && bun run test` passes |
| **J jobs** | `src/jobs/**`, `src/hooks/job-route*` stays with H1 (the hook calls only the queue's API) | one heavy slot, no memory, weights, slices, `choom`, shared folders, light lane or `jobs.json` settings; `job set` gone |
| **E1 issues and others** | `src/issues/**`, `src/sessions/**`, `src/user-away/**`, `src/worktrees/**` | crew parts gone (pickup, crew hand-back, feed to a lead, crew answers, crew clean); tests pass |
| **E2 workflow and CLI** | `src/workflow/**`, `src/models/**`, `src/cli/**`, `src/project/**`, `src/entries/cli.ts`, `src/machine/**` (but not `load.ts`) | the `crew` command and its help gone; `workflow.crew` read and ignored; crew kinds gone from the launch policy; tests pass |
| **D1 plugin text** | `plugin/instructions/**`, `plugin/skills/**`, `plugin/agents/**`, `plugin/output-styles/**`, `plugin/workflows/**` | `lead` and `crew` skills deleted; new `build` skill (§ How the kit works); `plan-task`, `subagent-decision`, `core.md`, `builder`, `reviewer` and every crew mention rewritten; `bun run check:duplicates` and `check:core-lines` pass |
| **D2 docs** | `README.md`, `docs/**`, `.claude/CLAUDE.md`, `.claude/rules/**`, `.claude/skills/**` | crew docs removed; jobs, tasks and design docs say 2.0; `bun run check:docs` passes |

| **S subagent cap** | `src/setup/max-subagents.ts` and its test (new) | `setup` writes `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "10"` as an owned key (the `retry-watchdog.ts` pattern). A person's own value stays. `setup --max-subagents <n>` sets the kit's value. `restore` takes it back. The main session wires it into `src/cli/setup.ts`, `doctor` and `restore` after E2 lands. |

Research: `.claude/research/2026-11-03-subagent-driven-development.md`.

**Wave 2 (the main session):**

- merge all phases;
- delete `src/crew/`, `src/machine/load.ts`, and the crew test worlds in `src/testing/`;
- fix the fallout;
- 2.0.0 in `plugin.json` and both installers, `bun run build`, `bun run build:portal`,
  CHANGELOG;
- `bun run check`, both validates, the portal's tests;
- own review, then the final review on `opus`;
- push and open the PR. The merge waits for the owner.

## Rules for every phase

- Work only in your worktree, and only on the files you own. A file outside your list that must
  change: say so in your report, never edit it.
- `src/crew/` still exists in wave 1. **Remove every import of it from your files**, and keep
  `bun run typecheck` and `bun run lint` green. Never edit `src/crew/`.
- Remove dead code fully: no shims, no "removed in 2.0" stubs, no legacy paths. The one
  exception is the ignored `workflow.crew`/jobs keys above (E2 and J).
- Tests: delete the tests of what you removed. Update the others, writing their expected values
  by hand. Run your targeted tests, then `bun run typecheck` and `bun run lint`.
- Never run `bun run build`, and never edit `plugin/dist`, `plugin/portal-ui`, `plugin.json`,
  the installers or `CHANGELOG.md`. The main session does those once.
- Neutral: no company, project, person or machine names anywhere. Bun only.
- Commit on your worktree branch when your done-check is green: conventional message, plain
  words, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Your report: a `task_note` on your phase task that starts `Report:`. It holds the diff stat,
  the tests run with their counts, what you removed, what you could not do, and every file
  outside your list that needs a change. Then return a short summary: status, commit, tests.
