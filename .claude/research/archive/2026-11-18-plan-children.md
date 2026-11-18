# Research: plan-children (#353), 2026-11-18

Plan: `.claude/plans/2026-11-18-plan-children.md`. Everything here comes from reading the code on
`feat/deploy-tasks` (7bcbe6f, then 59023299) before plan #392 (5.0.0) merged. Line numbers will
move after it merges: find each place by its symbol. Nothing below was run live.

## Herdr (src/herdr/, docs/design/herdr.md, plugin/skills/herdr/SKILL.md)

**Starting a child**
- The command: `herdr start --model --effort --mode [--cwd] [--on] [--name] [--task] [--independent] [--asked] -- <brief>`.
  - The usage string is in `words.ts:45`, the parser in `words.ts:91-130`.
  - `--model`, `--effort` and `--mode` are mandatory. `bypassPermissions` is refused. A child's mode may be no wider than its lead's (`childModeAllowed`).
- **The brief.** `writeBrief` (`brief.ts:16-30`) adds a trailer and writes the brief to `<stateDir>/herdr/briefs/<core>-<name>/brief.md` (folder mode 700, file mode 600).
  - The `--task` trailer says "save a Report: note; never take, update or close the task".
  - The linked trailer says "report with herdr report … Start no sessions or agents unless this brief says so".
- **The launch.**
  - `hc run --bg --outlive-parent --no-notify --name kit-<name> --cwd --label …`, which runs `claude … -w kit-<name>` in the person's login shell (`command.ts:616-657`).
  - The worktree is `<repo>/.claude/worktrees/kit-<name>`, on branch `worktree-kit-<name>`. It is cut from `origin/HEAD`, not the lead's HEAD (`docs/claude-code-contract.md:206-207`).
  - `claude -w <existing>` resumes an existing worktree (contract `:218`).
- **Names.** Reusing a name, worktree or branch is refused (`command.ts:596-604`). `validChildName` allows a full `kit-<name>` of 1-32 characters from `[a-z0-9_-]` (`labels.ts:129-135`).
- **`--task`.**
  - It reads the store read-only before launch (`:538-548`). `getTask` matches `#n` or an id only, never a slug.
  - After a launch poll of up to `LAUNCH_CHECK_MS` (20 s), it binds `agent herdr:<core>/<address>`, `worktree` and `branch` through `ops.call("update")` (`:730-748`).
  - It is refused with `--on` or `--independent`.

**Links, reports and recovery**
- **Linking.** A linked start needs `HC_TERMINAL_ID`, a live local ancestor terminal. The lead id is `<core>/<address>`. The labels are `kit.lead`, `kit.repo` and an optional `kit.task`. `own()` filters `list` by `kit.lead`.
- **Reporting.** `herdr report` sends `<kit-report from=…>` to an idle, working or done lead. Otherwise it saves `report-<UTC>-<uuid>.md` beside the brief.
- **Waiting.** `herdr wait` (run in the background, 180 s timeout, a `--seen` continuation) settles on done, error or the terminal ending.
- **Recovery.**
  - `herdr adopt` takes over live children of a dead lead, in the same repo and on the same core (`:893-912`).
  - `herdr stop` keeps the worktree.
- **Limits.**
  - No kit-imposed cap on children.
  - Fable, and Opus at max, need `--asked`.
  - A remote child keeps its reports on its own machine.
- **Starting unasked.** No text tells a lead to start a child unasked (SKILL.md:13-23: "Choose from the person's words").
- **The Stop hook.** `keep-going.ts:139-142` names a herdr child bound to a phase.

## Task store (src/tasks/)

**Plans and the one-plan rule**
- **Plan rows.** A plan is a `tasks` row, `kind="plan"`, with a `plan` slug. Phases are `kind="phase"` with the same slug.
- **Edges.** `blocked_by` is a `task_deps` edge (`ON DELETE CASCADE`).
- **Queue state.** `isBlocked` and `isStartable` are in `queries.ts:346-373`, `planQueueState` in `queries.ts:167-300`.
- **The one-plan rule.** `refuseOtherPlan` → `planInTheWay` (`plan-guards.ts:27-46`).
  - It returns null when the caller has nothing in flight, or the target plan is claimed live elsewhere.
  - `inFlight` counts only the caller's own plans.

**Taking and owning**
- **`takeTasks`** (`store.ts:616-702`).
  - A plan slug moves every row. It rewrites `created_by`, `created_pid` and `created_start`.
  - The claim moves only on rows that already have one (`:661`).
  - A live claim refuses without `force`.
  - With `from`, it refuses a pending or in-progress row whose `createdBy` is neither the taker nor `from` (`:638-647`).
- **Entering flight.** `enterFlight` (`ops.ts:285`) sets the plan `in_progress` and claims it at the owner's first phase start.
- **Ownership.** `ownerOf` (`queries.ts:224-235`) matches the session id, the claim, or the creator process; the last survives a `/clear`.
- **Liveness.** `claimLive` (`work/identity.ts:39`) checks the `/proc` start time on Linux and the pid elsewhere.
- **Reading another session's plan.** `task_list scope:"plan" plan:<slug>` shows any plan.

**The database**
- **The schema.** `db.ts`: `WORK_SCHEMA_VERSION = 5`, a migration list, `min_compatible` 1, foreign keys on, WAL mode, `BEGIN IMMEDIATE`, `WRITE_TIMEOUT_MS = 3000`.
- **No file field.** No file or refs field exists on work tasks. `refs` exists only on deploy (project) tasks.

## Workflow settings (src/workflow/)

- **`plans.maxPhases`.**
  - Its schema is at `schema.ts:167-171`, its rule in `NUMBER_RULES`, its default at `:280`.
  - It is in `POLICY_KEYS` and in `PLAN_KEYS` (`:384`), refused in-session (`commands.ts:532`).
- **Precedents.**
  - The enum: `openPr` (`:127`).
  - The list: `reviewAgents` (`:141`, parsing `:509`).
  - Personal-file-only: `switches.leadHint` (`:18-24`).
- **Resolution.** `plansFrom` (`resolve.ts:201`), `resolvePlans` (`:214`).
- **Strictness.** The schema is strict: `loadWorkflow` throws on an unknown key (`resolve.ts:127-129`).
- **Since-gate.** `init.ts:264` since-gates the whole `plans` object (4.8.0).
- **The portal mirror.** `portal/src/api/wire.ts:454` mirrors `WorkflowKey`.

## Other code to reuse

- **PR merged.** `pullRequestMerged(repo, branch, head, env)` (`src/worktrees/scan.ts:219`) runs `gh pr list --head <branch> --state merged` and matches `headRefOid`.
- **Not reusable.** The after-merge reader (`after-merge.ts:1418-1450`) keeps `viewPullRequest` private.
- **Git.** The `runGit` wrapper pattern is `taskGit` (`src/tasks/deploy/branch.ts:16`).
- **Status line.** `taskSegment` (`statusline.ts:101`) shows only work this process claims.
- **keep-going.** Its timeout is 10 s (`hooks.json:153`). It stays quiet while a background task runs.

## Overlap with plan #392 (5.0.0)

#392's docs phase edits:
- the build, plan-task, memory-routing, commit, pull-request, subagent-decision and react-best-practices skills;
- `core.md`, `README.md`, `docs/design.md`, `docs/design/{tasks,portal,sessions,hooks,roadmap}.md`, and `.claude/CLAUDE.md`.

Its other phases edit `src/workflow/schema.ts`, `src/tasks/{ops,mcp,schemas,words,command}.ts`, `src/hooks/task-start.ts` and `src/cli/project-checks.ts`.

Hence the ruling: build after it merges.

## Budgets

- `core.md` is 129 lines; the warning is above 130 and the failure above 140.
- `check:duplicates` flags a sentence of 12 or more words that repeats.
- `check:context-budget`: `ALWAYS_ON.max` 2766, `CORE.max` 2345. #392 re-measures them.

## Second reads (folded into the plan)

- **senior-engineer (plan-review, opus/xhigh).** It raised:
  - no store definition of "held";
  - parallel hand-outs race;
  - files must count until the PR merges;
  - the second-take row was wrong (pending rows have no claim);
  - two writers of `branch`;
  - D7 resume;
  - a cheap reader for the status line and hooks;
  - `pullRequestMerged`;
  - no merge signal;
  - solo blockers have no branch;
  - the `lead` identity;
  - rollback with a strict schema;
  - `runMode` personal-only;
  - a single ready plan;
  - FK cascade;
  - missing files (`wire.ts`, `workflow.md`, the rules file, `specs.ts`).
- **edge-case-hunter (opus/high).** 20 scenarios. Beyond the above:
  - `mergeFiles` bypass and path forms;
  - version collisions in this repo;
  - git under the write lock;
  - a child that coordinates;
  - concurrent fetches;
  - blocker states (PR closed, dropped, non-plan, stacked PR);
  - several PRs per head;
  - `--plan` slug resolution;
  - an old MCP server;
  - case folding;
  - pending rows look free to other sessions.
