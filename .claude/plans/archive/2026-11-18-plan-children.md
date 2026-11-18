# Plan: queued plans run solo, lead + children, or through a coordinator (plan-children, #353)

**Summary**
- A session with several laid plans runs them in one of three modes:
  - **solo** (today: one plan at a time);
  - **lead + children** (it builds one plan itself and hands each other ready plan to a linked herdr child session);
  - **coordinator** (it builds nothing and hands every ready plan to a child).
- Each plan stores its **file list**. The store **reserves** a plan atomically before a child starts. A plan is ready only when no reserved or unmerged plan shares its files and every blocker's pull request has merged.
- The child takes the plan, builds it with `/build`, opens its own pull request and reports. The coordinator tracks the children with `herdr plans` (live gates), a status-line row and the Stop hook (store-only, cheap).

File home after approval: `.claude/plans/2026-11-18-plan-children.md`. Research archive: `.claude/research/archive/2026-11-18-plan-children.md`. Ships as **5.1.0**, built **after plan #392 (5.0.0) merges**.

## Context

The person asked (2026-11-15): "a session have like 4 plans can it start a herdr child sessions on unblocking plans?" On 2026-11-18 they ruled:
1. **Three modes:** solo lead, lead + children, and coordinator. Earlier on 2026-11-18 the person kept only solo and coordinator. After approval they asked for all three ("please support all 3 options").
2. **The child takes the plan** with `task_take`. The lead never edits a handed-out plan's work.
3. **A stored file list with a mechanical overlap check**, not `blocked_by` alone.
4. **A workflow setting picks the mode;** Claude asks when it is unset.
5. **Design now, build after 5.0.0.**

## Research (condensed; full notes go to the archive file)

Read from the code on `feat/deploy-tasks` (7bcbe6f, then 59023299; the store, herdr and hook files were the same in both). Two second reads ran: senior-engineer (plan-review) and edge-case-hunter. Their findings are folded in below.

**What already works**
- **Plans in the store.** A plan is a `tasks` row, `kind="plan"`, with a `plan` slug. Order between plans is `blocked_by` (`task_deps`). `isBlocked` and `isStartable` are in `queries.ts:346-373`.
- **The one-plan rule.** `refuseOtherPlan` → `planInTheWay` (`plan-guards.ts:27-46`) skips plans claimed live elsewhere. `inFlight` counts only the caller's own plans, so a child with nothing in flight is never blocked.
- **Taking a plan.**
  - `takeTasks` (`store.ts:616-702`) moves every row of the slug and rewrites `created_by`, `created_pid` and `created_start` to the taker.
  - A pending plan has **no claim**: a take keeps a null claim null (`store.ts:661`). So today a second take of a handed-out pending plan is **not** refused.
  - `from` is optional. With `from`, a take refuses a row whose `createdBy` is neither the taker nor `from` (`store.ts:638-647`).
- **Entering flight.** `enterFlight` sets the plan `in_progress` and claims it at the owner's first phase start (`ops.ts:285`).
- **Ownership.** `ownerOf` matches the session id, or the creator process (`queries.ts:224-235`); the process keeps ownership across a `/clear`. Liveness comes from `claimLive` (`work/identity.ts:39`).
- **Reading another session's plan.** `task_list scope:"plan" plan:<slug>` already shows it (`ops.ts`, the plan-scope branch).
- **herdr.** `herdr start` launches a linked child with `claude -w kit-<name>` (`src/herdr/command.ts`).
  - Its worktree is cut from `origin/HEAD` (stale up to a day; `docs/claude-code-contract.md:206-207`), not from the lead's HEAD.
  - `--task` reads the store read-only before launch (`:538-548`, `getTask` matches `#n`/id only) and binds `agent`/`worktree`/`branch` **after** a launch poll of up to 20 s (`:730-748`).
  - Name, worktree or branch reuse is refused (`:596-604`). `herdr stop` keeps the worktree. `herdr adopt` moves only live children of a dead lead (`:893-912`).
  - `claude -w <existing name>` resumes an existing worktree (`docs/claude-code-contract.md:218`).
- **The PR gate.** `pullRequestMerged(repo, branch, head, env)` (`src/worktrees/scan.ts:219`) checks "this branch's PR merged at this head", safe for squash merges. Reuse it.
- **Workflow settings.**
  - `schema.ts` is strict: `loadWorkflow` throws on an unknown key (`resolve.ts:127-129`).
  - `plans.maxPhases` is in `PLAN_KEYS` (`:384`), refused in-session (`commands.ts:532`).
  - Precedents:
    - a personal-file-only switch: `leadHint` (`schema.ts:18-24`);
    - a list: `reviewAgents` (`:141`, parsing `:509`);
    - the committed-copy gate: `workflow show`'s "gate" block, which reads `origin/<default>:.claude/cc-smart-dev-kit.json`.
  - `init.ts:264` since-gates the `plans` object at 4.8.0. `portal/src/api/wire.ts:454` mirrors the `WorkflowKey` union.
- **Schema steps.** The migration list is in `db.ts`. An additive step leaves `min_compatible` at 1, so an older kit still opens the store (`db.ts:33,219-249`). Foreign keys are on (`:205`), and `task_deps` uses `ON DELETE CASCADE` (`:44`). Writes run in `BEGIN IMMEDIATE` with a 3 s timeout (`:13,270`).
- **Status line and Stop hook.** `taskSegment` (`statusline.ts:101`) shows only work this process claims. `keep-going` has a 10 s timeout (`hooks.json:153`). It already names a herdr child bound to a phase (`keep-going.ts:139`), and it stays quiet while a background `herdr wait` runs (`:182-198`).

**What is missing**
- **No file sets.** No plan stores one.
- **No "held" state.** Nothing marks a plan as handed out before its first phase.
- **Checks and launches race.** Every check runs before the launch and every write after it, so two parallel hand-outs both pass.
- **No coordinator view.** Nothing shows a lead which child holds which plan.
- **No merge signal.** Nothing wakes the lead when a blocker's PR merges.
- **Blocker branches go unrecorded.** A plan built solo records no `branch` on its plan task (build SKILL.md:29-30).

## Decisions

**D1. Three modes.**
- **`plans.runMode`:** `ask` (the default), `solo`, `lead-children` or `coordinator`.
  - It lives **in the person's own workflow file only**, like `switches.leadHint`. A committed project value would spend every teammate's usage.
  - `workflow set` refuses it inside Claude Code; Claude gives the person the command.
- **When the mode is decided.** At build start, Claude decides when two or more open plans are laid (ready or not).
  - Under `ask`, it asks once, stating the cost of each mode:
    - **solo:** one session;
    - **lead + children:** the lead's full build context, plus one full session per child;
    - **coordinator:** a light lead, plus one full session per child.
  - With one open plan the mode is solo, and no question is asked.
- **Lead + children.** The lead takes the lowest-numbered ready plan for itself and reserves it with `reservePlan` (D4, the lead as its own holder). It then hands every other ready plan to a child, and builds its own plan with builder subagents, as in solo mode.
  - When its own plan closes, it takes the next ready plan for itself, the same way. When none is ready, it waits as a coordinator does.
  - The reports from its children arrive between its own phases.
  - Its own plan is held like any reserved plan, so no child's plan can overlap it.
- **Coordinator mode never builds.** Even a single ready plan goes to a child.
- **Outside a Herdr terminal,** both lead + children and coordinator fall back to solo, with one line saying why.
- **A plan child never coordinates.** `herdr start --plan` refuses when the caller's own terminal carries `kit.plan`. The brief says: build only this plan, never take another, and stop after the report. That overrides build §6's "start the next queued plan".

**D2. The plan's file list lives in the store.**
- A new table `task_files(task_id REFERENCES tasks(id) ON DELETE CASCADE, path)`, in the **next** schema step (whatever number 5.0.0 leaves). It is additive, and `min_compatible` does not change.
- Set with `files` on `task_create`/`task_update`, for **plan tasks only**. History records it (`shape()`).
- **Paths.**
  - Each path is repo-relative and uses `/`. Folders end in `/`.
  - Paths are normalised on write (`./`, `\`). Absolute paths, `..` and the root (`""`, `.`, `/`) are refused.
  - An existing folder written without a trailing `/` is refused with a hint.
- **Overlap.** Two paths overlap when they are equal, or one is a folder prefix of the other. Both sides are case-folded when `core.ignorecase` is true.
- **Where the list comes from.** The plan file's **Files to change** section is the design text. plan-task copies it into the store at approval, and `herdr plans` shows the store copy.

**D3. Merge files.**
- **`plans.mergeFiles`** is a list, default empty. It names paths every plan touches and each merge settles: a version manifest, a changelog, a lockfile, build output. The overlap check leaves them out.
- It is a project fact, so it lives in the project file. It is **read from the committed copy on `origin/<default>`**, like the review gate, so a session cannot widen it by editing its working copy. It is also in `PLAN_KEYS`, so it is refused in-session.
- How each child settles merge files after a rebase (re-bump the version, rebuild) is the project's own rule, in its `.claude/cc-smart-dev-kit/build.md`.

**D4. Held and reserved: one store operation.**
- **`reservePlan`** runs inside `writeWork` (`BEGIN IMMEDIATE`).
  - It re-reads the store.
  - It refuses unless the plan:
    - is open and pending;
    - is unreserved;
    - has a file list;
    - has no open blocker by the store;
    - has files, minus `mergeFiles`, that overlap **no held plan**.
  - On success it writes the reservation (the `lead` columns), all in one transaction.
  - **A reservation for the lead itself** (lead + children mode) records the lead as holder, with no child. The lead then starts the plan as its own, the usual way.
- **A held plan** is any of:
  - a reserved plan whose PR has not merged and was not closed or dropped (a child's, or the lead's own);
  - any session's own plan in flight. This covers a solo session that started a plan without reserving it.
- **Before the transaction,** the caller reads each held plan's branch diff (`git diff --name-only --no-renames <base>...<branch>`, which lists both sides of a rename). It passes the result in, so no git runs while the write lock is held. A held plan's files are its stored list plus its diff.
- **Same definition everywhere.** `task_update files` on a held plan checks only stored lists, inside the transaction. Its overlap refusal uses the same definition.
- **The lead.** Stored like `creator`: session, pid and process start, judged by the `ownerOf` rule. A `/clear` keeps it.
- **Taking a reserved plan.** `takeTasks` refuses unless `from` names the reserving lead (or the person passes `force`). After the first take, `created_by` is the child, so a second take by anyone refuses.
- **Starting work.** `refuseOtherPlan` also refuses starting a phase in a plan reserved for, or owned by, another session. That closes the "pending rows look free" gap.
- **Releasing.** A failed launch releases the reservation. So does `herdr plans` once a PR has merged or closed, and so does a dropped plan.

**D5. Readiness gates beyond the store** (`herdr plans` and `--plan` only, never the status line or a hook).
- **A blocking plan** is clear when it is closed, **and** either:
  - `pullRequestMerged(branch, tip)`, or
  - (no `gh` or no PR) its tip is an ancestor of `origin/<default>` **and** `base..branch` is not empty.
- **No recorded branch:** shown as *blocker has no branch*, with the fix (`task_update branch`). Unknown is never clear.
- **Other blockers:**
  - **PR closed unmerged:** *blocker PR closed*. The person decides.
  - **A dropped blocker:** clear, as `isBlocked` already treats it.
  - **A blocker that is a task or phase, not a plan:** clear when closed, as today. Documented.
- **The build skill records `branch` on the plan task in both modes** (one line in §1). Solo-built blockers can then be judged.

**D6. Handing out: `herdr start --plan <slug>`.**
- **Arguments.**
  - The slug resolves through the take path's resolver, not `getTask`.
  - It excludes `--task`, `--independent` and `--on`.
  - The default child name is the slug, which must fit `validChildName`; otherwise the command refuses with a `--name` hint.
- **Order.** Check the D5 gates → read the held diffs → `reservePlan` → launch → bind `agent herdr:<core>/<address>`, `worktree`, `branch` and the label `kit.plan`. Writing `branch` happens **once**: a resume never rewrites it.
- **The plan brief trailer** replaces the task trailer:
  1. `task_take <slug>` with `from: <lead session>`.
  2. In the fresh worktree, `git fetch origin <default>`. On failure, retry once, then stop and report; never branch from a stale ref. Then `git reset --hard origin/<default>`. The worktree's own branch is the plan branch. Skip this step on a resume.
  3. Run `/cc-smart-dev-kit:build` on this plan only. Builder subagents are allowed; other sessions are not.
  4. Push, pull request and merge follow `workflow show`; where they are off, ask the person in this terminal.
  5. `herdr report` with the PR link, what shipped and what failed. Then stop. Never take another plan.
- **Resume (child gone).** The plan is reserved, its process is dead and its pane is gone. `--plan` then starts the new child in the **recorded worktree** (`claude -w <recorded name>`), allowing that one reuse, and the brief skips step 2. A plan `in_progress` under a dead child is allowed here, and only here.

**D7. Tracking.**
- **A store-only classifier** (`src/tasks/work/`, one home), which the status line and keep-going read. It reports:
  - own: reserved for this lead itself;
  - reserved: with child (process alive), or child gone;
  - waiting (open blockers by the store);
  - no file list;
  - ready by the store.
- **`cc-smart-dev-kit herdr plans [--json] [--wait]`** adds the live gates: the PR states, branch diffs, the pane state and drift.
  - **Drift:** a held plan's diff reaches another held plan's files.
  - **`--wait`** runs in the background. It polls every `PLAN_POLL_MS` until a plan turns ready or a reserved PR merges, then prints the change and exits. Like `herdr wait`, it times out with a continuation command. That is the coordinator's "blocker merged" signal.
- **Status line.** When this process leads plans, it adds a row: `Plans · 2 with children · 1 waiting · 1 ready`.
  - In coordinator mode, that row is the whole segment.
  - In lead + children mode, it sits below the lead's own `Plan`/`Phases`/`Tasks` rows.
- **keep-going.** While this lead's plans are with children or waiting on PRs, it names `herdr wait` or `herdr plans --wait`. In lead + children mode, the existing "continue your own plan" reason comes first.
- **`herdr adopt`** moves `lead` on **every** open plan whose lead is dead, not only those with live children.

**Rejected**
- **The lead keeps ownership.** The store refuses phase starts by a non-owner.
- **`blocked_by` only.** The person chose the mechanical check.
- **`runMode` in the project file.** It would spend teammates' usage.
- **Phase-level file lists.** A follow-up can reuse `task_files`.
- **The after-merge PR reader.** It is private and lives in a hook module, and `pullRequestMerged` fits better.

## Files to change

| Phase | Files |
|---|---|
| `workflow` | `src/workflow/schema.ts` (`plans.mergeFiles`; `runMode` in the personal schema only; `PLAN_KEYS`; parsing), `resolve.ts` (incl. the committed-copy read of `mergeFiles`), `commands.ts` (help, refusals), their tests; `src/project/config.ts`, `src/project/init.ts` (since-gate per key); `src/testing/fake-workflow.ts`; `portal/src/api/wire.ts` (the `WorkflowKey` mirror) |
| `store` | `src/tasks/work/db.ts` (next step: `task_files`, the `lead_*` columns), `types.ts`, `store.ts` (`reservePlan`, release, the take refusal, files with history), `queries.ts` (`planFiles`, `filesOverlap`, `heldPlans`, the store-only classifier), `src/tasks/plan-guards.ts` (reserved/owned refusal), `src/tasks/schemas.ts`, `ops.ts`, `mcp.ts` (one `TASK_SERVER_INSTRUCTIONS` line), `command.ts`, `words.ts`; tests (new `work/files.test.ts`, `work/reserve.test.ts`) |
| `herdr` | `src/herdr/command.ts` (`--plan`, resume, the adopt change, `plans`), `words.ts`, `brief.ts` (the plan trailer), `labels.ts` (`kit.plan`), new `src/herdr/plans.ts` (the live gates, using `pullRequestMerged` and `runGit`); tests incl. `command-scenarios.test.ts` |
| `surfaces` | `src/cli/statusline.ts`, `src/hooks/keep-going.ts`, `src/hooks/specs.ts` (keep-going doc comment), tests |
| `docs` | `plugin/skills/plan-task/SKILL.md` (file lists; split plans file-disjoint, with `blocked_by` for real dependencies; the mode question), `plugin/skills/build/SKILL.md` (record the plan `branch`; a "Lead + children and coordinator modes" section; a plan child builds only its plan), `plugin/skills/herdr/SKILL.md`, `docs/design/herdr.md`, `docs/design/tasks.md`, `docs/design/workflow.md`, `docs/design/hooks.md`, `.claude/rules/cc-smart-dev-kit-json.md`, `README.md` (the settings, `--plan`, `herdr plans`, and the rollback note: unset the new keys before going back), `docs/roadmap.md` |
| main session | `plugin/.claude-plugin/plugin.json` (5.1.0), `CHANGELOG.md`, `plugin/dist/`; this repo's `.claude/cc-smart-dev-kit.json` (`plans.mergeFiles`: `plugin/.claude-plugin/plugin.json`, `CHANGELOG.md`, `plugin/dist/`, `plugin/portal-ui/`, `bun.lock`) and a new `.claude/cc-smart-dev-kit/build.md` (after a rebase: re-bump the version, rebuild) |

`core.md` does not change (129 lines, warning at 130). No new skill, so the always-on context budget does not change.

## Patterns to follow

- **Settings:**
  - `reviewAgents` for the list;
  - `leadHint` for the personal-only key;
  - the review gate's committed read for `mergeFiles`;
  - `maxPhases` for `PLAN_KEYS`.
- **The schema step:** append to `db.ts`'s list, with `ON DELETE CASCADE` like `task_deps`.
- **The store:** each new write goes through `writeWork`, and history through `shape()`.
- **herdr:** `--task`'s checks and binding, and `writeBrief`'s trailer shape; `herdr wait`'s background and continuation pattern for `plans --wait`.
- **Git and gh:** `runGit` (as in `src/tasks/deploy/branch.ts:16`) and `pullRequestMerged`; nothing shells out a second way.
- **One home:**
  - the overlap and the classifier in `queries.ts`;
  - the live gates in `src/herdr/plans.ts`;
  - the poll interval as one constant.

## Edge cases

| Case | Trigger | What the plan does |
|---|---|---|
| A handed-out plan reads as free | a pending plan has no claim until its first phase | D4: the reservation is the hold; `takeTasks` and `refuseOtherPlan` honour it |
| Parallel hand-outs overlap | two `--plan` in one message | D4: `reservePlan` is one transaction; the second refuses *overlaps #n* |
| Second take | another lead, a solo session, the person | D4: `from` must name the lead; after the first take, `created_by` refuses the rest; `force` stays the person's |
| A child ends with its PR open | a report, then the pane closes | D4: held until the PR merges or closes |
| Strays and renames | a builder edits an unlisted file; a rename | D4 diff with `--no-renames`; D7 drift; the lag until a phase merges is accepted and shown |
| Uncommitted edits | a builder mid-phase | not seen by the diff; the declared list covers them; accepted |
| A blocker has no branch / the branch equals the base | a solo-built blocker; an empty branch | D5: shown with the fix; the ancestry fallback needs a non-empty `base..branch` |
| Squash merge, several PRs per head | `mergeMethod squash` | `pullRequestMerged` matches the head oid |
| PR closed unmerged / blocker dropped / blocker not a plan | — | D5 rows |
| Nothing signals a merge | the person merges on GitHub | D7 `herdr plans --wait` in the background; keep-going names it |
| The child dies | crash or close, before or after its first phase | D6 resume in the recorded worktree; the branch is never rewritten |
| The coordinator restarts or runs `/clear` | — | `lead` judged by the `ownerOf` rule; `adopt` moves every open plan of a dead lead |
| `mergeFiles` widened to bypass the check | a session edits its config | D3: read from the committed copy; in `PLAN_KEYS`; the root and bare folders refused |
| Every plan bumps the version (this repo) | two PRs | D3 plus the repo's `build.md`: rebase, re-bump, rebuild |
| A child coordinates | `runMode` resolves in the child | D1: refused by label; the brief says solo |
| A single ready plan | coordinator mode | D1: still handed out; the lead never builds |
| A single ready plan | lead + children mode | D1: the lead takes it for itself; the others wait until they are ready |
| A hand-out races the lead's own pick | lead + children: the lead picks its plan while handing out others | D1/D4: the lead reserves its own plan first, through the same transaction |
| A solo session starts a plan without reserving it | an older session, or solo mode beside a coordinator | D4: any session's own plan in flight counts as held |
| A report arrives mid-phase | lead + children | a `<kit-report>` is not the person's prompt; the lead handles it after the current hand-back |
| Concurrent fetches in one `.git` | three children at once | D6 step 2: retry once, then stop |
| Git under the write lock | slow diffs | D4: diffs read before the transaction |
| Status line or hook latency | gh or git calls | D7: they read only the store classifier |
| Case-insensitive file systems | `Foo.ts` vs `foo.ts` | D2: case-fold when `core.ignorecase` |
| A pid reused off Linux | `claimLive` pid only | an existing limit (follow-up T-enpt7a); *child gone* also checks the pane |
| A remote child | `--on` | refused with `--plan` |
| Plans laid before 5.1.0 | no file list | *no file list*; never handed out until set |
| Old MCP server in a running session | a session from before the update | `files` is unknown there; the skill says to restart a session from before 5.1.0 |
| Rollback with the new keys set | a strict schema | README says to unset them first |
| Neutral text | help and tests | neutral examples; `check:neutral` |

## What could break

- **`task_create`/`task_update` schemas** (MCP and CLI). `files` is optional, so old calls are unchanged.
- **`takeTasks`.** It now refuses a reserved plan without `from`; unreserved plans behave as before. Existing take tests must pass unchanged.
- **`refuseOtherPlan`.** The new refusal covers only reserved or foreign-owned plans; the existing `plan-guards` tests stay green.
- **`ResolvedWorkflow`.** Consumers are `workflow show`, the portal settings API, `fake-workflow.ts` and the `wire.ts` mirror.
- **`herdr start`.** The `--task` and plain-start tests stay green.
- **Status line and keep-going.** Unchanged when this process claims work, or when it leads no plans.

## A simpler approach?

`blocked_by` only. The person rejected it for the mechanical check. Everything else reuses `takeTasks`, the herdr launch and binding, `pullRequestMerged`, the review gate's committed read and the plan-scope read.

## Rollback

Revert the 5.1.0 PR and release 5.1.1.
- **The store:** the new step's table and columns stay. An older kit ignores them (additive; `min_compatible` unchanged; the cascade lets it delete plans).
- **The settings:** a strict schema makes an older kit refuse an unknown key, so the person unsets `plans.runMode` and `plans.mergeFiles` first (README).
- **Handed-out plans:** they become ordinary owned plans that solo `/build` can finish.

## How we prove it

**Tests**
- **workflow:**
  - `runMode` only in the personal file, and refused in-session;
  - `mergeFiles` read from the committed copy, refused in-session, with the root and bare folders refused.
- **store:**
  - the migration on a fixture, and a delete through the old SQL with files present;
  - normalising and case folding;
  - overlap: equal, prefix, `mergeFiles`;
  - `reservePlan`: refuses an overlap, a blocker, no list, already reserved; a parallel second reservation refuses;
  - a reservation for the lead itself; any session's own plan in flight counts as held;
  - take: refused without `from` on a reserved plan, and a second take refused;
  - `refuseOtherPlan` on a reserved plan;
  - history records files;
  - the classifier states.
- **herdr (fake hc, git and gh):**
  - every `--plan` refusal, including a child caller and a slug that is too long;
  - reserve before launch, and release on a failed launch;
  - the binding written once;
  - resume in the recorded worktree;
  - the plan trailer;
  - every `herdr plans` state: PR merged, closed or open; no branch; an empty branch; a rename; drift;
  - `--wait` printing a change, and its timeout continuation;
  - adopt moving a dead lead's plans.
- **surfaces:**
  - the coordinator row alone;
  - the row below the lead's own plan rows (lead + children);
  - the keep-going text, with the own-plan reason first;
  - both stay fast with a stalled fake gh (they must not call it).

**Checks:** `bun run check`, `bun run build:check`, `cd portal && bun run test`, and both `claude plugin validate`.

**Live (the person, in Herdr).** In a scratch repo with a local origin, lay plans A and B (disjoint files), C blocked by A, and D sharing a file with B. Run `workflow set plans.runMode coordinator` in their own terminal, then `/build`. Expected:
- A and B go to children together.
- C shows *waiting on #A* and D shows *overlaps #B*.
- The status line reads `Plans · 2 with children · 2 waiting`.
- Each child takes its plan, resets to `origin/main` and opens a PR. Both reports arrive.
- Kill B's child mid-phase: `--plan B` resumes it in B's worktree.
- Merge A's PR: `herdr plans --wait` fires and C goes to a child.
- Merge B: D goes to a child.

Then repeat with `plans.runMode lead-children` on fresh plans A to D. Expected:
- The lead reserves A and builds it itself, with builder subagents.
- B goes to a child.
- D shows *overlaps #B*. C shows *waiting on #A*.
- The status line shows A's own rows plus `Plans · 1 with child · 2 waiting`.
- When A merges, C becomes ready. The lead takes C for itself, unless it is still building.

## Phases and waves

| Phase | Area | Agent / model / effort | Blocked by |
|---|---|---|---|
| `workflow` | `runMode` (`ask`/`solo`/`lead-children`/`coordinator`), `mergeFiles` | builder / sonnet / high | — |
| `store` | the schema step, files, reservation, the take and start refusals, the classifier | builder / sonnet / high (schema) | workflow |
| `herdr` | `--plan`, resume, the trailer, `herdr plans [--wait]`, adopt | builder / sonnet / high | store |
| `surfaces` | the status-line row, keep-going | builder / sonnet / high | store |
| `docs` | skills, design pages, rules, README | rules-maintainer / sonnet / high | herdr, surfaces |

**Waves**
1. `workflow`.
2. `store`.
3. `herdr` and `surfaces`, in parallel (disjoint files).
4. `docs`.
5. Main session: the version, changelog, build, this repo's `mergeFiles` and `build.md`, the full check, and the final review (senior-engineer, opus, xhigh). Phase reviews: `store` and `herdr` get opus at xhigh (schema, concurrency); the rest get sonnet at high.

The plan task waits on plan #392 (`blocked_by #392`), so its build starts from `main` after 5.0.0 merges.
