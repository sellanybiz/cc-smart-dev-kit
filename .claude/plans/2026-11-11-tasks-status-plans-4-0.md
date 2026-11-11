# 4.0.0: tasks you can see and move, a true status line, plans in the project

**Summary.** Fix the eight things the owner found on 2026-11-11. Tasks become
Session › Plan › Phase › Task (no subtasks), get a portal page you can actually use, and can
move to another session. The status line stops showing a plan limit that belongs to another
login, and it counts the plan's tasks correctly. Plan mode writes into each project's
`.claude/plans`, and a session can run plans one after another. The portal's switches say what
they do, and Fable 5.2 is known. It is one release, **4.0.0**: dropping subtasks changes the task
tools' contract. A major version is not installed by the background update, so each machine
updates on purpose.

## Context

The owner's report, with screenshots (a status line `⛔ claude-sonnet-5 at its plan limit until
Nov 12 01:00 · 7d 8%`, and `/model` listing Fable 5.1). Three scouts mapped the code, and the
Claude Code docs were read. Every claim below was checked.

- **Stale plan limit (root cause).** The router records a plan limit per **model id**
  (`router.ts:1336` `observeClaude`, `limit-state.ts:37-43`). A record ends only when a later
  answer below 400 comes from **that same model** (`router.ts:1355-1363`), or when its reset time
  passes. But Anthropic's unified limit belongs to the **login**, not the model. After a switch to
  another account, nothing ever calls `claude-sonnet-5` through Claude (the `sonnet` tier answers
  from a backend), so its record stays until Nov 12. Worse, D65's skip (`knownLimit`) also trusts
  that stale record, so a chain may **skip a Claude target that has room**. The status line never
  checks the session's own `rate_limits` input (`statusline.ts:161-176, 197-210`), which is the
  true value for this session's login.
- **Task count.** `taskSegment` (`statusline.ts:82-93`) shows `#n title · closed/total`, where the
  count is every descendant of the claimed item, of any kind (`queries.ts:97-131`): phases and
  subtasks too. The title is cut at 60 characters. No test pins the format.
- **Task model.** `WorkTask.kind` is `plan|phase|task`. The layer (`subtask`) is derived, and
  `placeValid` (`store.ts:169-205`) allows phase › task › subtask. A session can already own
  several plans, but the tools pick "the caller's latest plan" (`ops.ts:150-159, 293-307`). No
  operation moves tasks to another session: a claim is a pid plus a start time, or the session id
  (`queries.ts:284-295`). The store is SQLite, schema v3 (`db.ts`).
- **Portal Tasks page.** `portal/src/views/tasks.tsx` (397 lines), `task-tree.tsx`,
  `tasks-card.tsx`. Rows are static: no detail, no collapse, no paging. Filters are only open or
  recent, blocked and non-blocking. `WorkTaskNode` has no session id and no parent id, only nesting
  (`src/portal/api/types.ts:450-505`).
- **Switches** (`overview.tsx:152-200`, `actions.ts:534-609`):
  - "Gateway" runs `gateway on|off`.
  - "Your own judge" runs `gateway slot judge custom|claude`: the code switches the judge slot
    only. But it reads as a second gateway switch. It does nothing while the gateway is off, its
    label does not say "auto mode", and it sits beside the real gateway switch.
  - "opus and fable slots" switches both model slots at once. The owner wants it gone: the Slots
    page already gives each slot its own switch.
- **Plan files.** Claude Code's `plansDirectory` is read "relative to the project root", in any
  settings file. Unset, it is `~/.claude/plans`. A path outside the root, or one with a
  backslash, falls back to `~/.claude/plans` (settings reference). The kit writes the setting
  nowhere. `verify-gate.ts:248-260` already reads it.
- **Fable 5.2** (`claude-fable-5-2`) needs Claude Code 2.1.321 or later. Off any gateway, the
  `fable` alias resolves to 5.2, but a session set through `ANTHROPIC_BASE_URL` may keep 5.1
  (model-config docs). This machine runs 2.1.322; the repo tests against 2.1.310
  (`.claude-code-version`). The kit pins no model id (gateway rule). It names Fable 5.1 as the
  newest in `prices.ts:60-77`, a comment in `router.ts:775`, the portal mock and docs examples.

## Decisions (owner, 2026-11-11)

- Old subtasks are **lifted to tasks** under the same phase. A subtask of a loose task becomes a
  loose task. Notes and history stay.
- Transfer: **the new session takes over** a plan or a task, through a tool and a command, plus a
  **"Move to session…"** button on the portal's task page.
- The status line counts **the current plan's tasks** (phases and plans not counted), as
  `3/10 · <task in progress>`, on its own line with the full title. With no plan, it shows the
  title alone.
- `setup` writes **`plansDirectory: ".claude/plans"` into the user settings**, for every project.
  A project's own value still wins (Claude Code's own order).
- The "opus and fable slots" switch is removed. Each slot keeps its own switch on the Slots page.
- **One release, 4.0.0** (the owner chose it over splitting off a 3.2.0). *Trade-off, written
  down:* the stale-limit fix and new-model discovery reach a machine only when it is updated by
  hand. Updating while 3.x sessions run is the migration's risky moment. B's lift-on-every-open
  repair covers that.
- **Plan files are committed** with their branch. `plan-task` commits the plan file after the
  yes, and archives it on finish. In a worktree it is committed on the worktree's branch.
- **Order:** this plan first, then Plan 3 (the web-app cleanup, task #181, which moves onto the new
  task layers), then Plan 2 (2.3.0 bug hunt). After approval, record this order in memory
  (`plan-3-webapp-cleanup.md`).

## Phases

Builders work in worktrees, and each checks only its own files. The main session merges, owns
the shared writes (version, CHANGELOG, `docs/design.md`, the wire mirror merge), and runs the
full check once.

**Wave 1 (start together):** A, B, E, F1, G. **Wave 2:** C (after A and B; both touch
`statusline.ts`), D (after B and E: the API, the wire mirror, the portal docs), F2 (after B: the
tool words).

**Built files:** builders commit source only. The main session rebuilds `plugin/dist` and
`plugin/portal-ui` after each merge, so no built bundle is ever merged by hand. B and E both edit
`wire.ts`, `wire-mirror.ts` and the mocks, in different sections; the main session settles that
merge.

### A. Plan limits follow the login (code: router, status line)
Builder, `sonnet`, `high`. It changes `router.js` (every router restarts once), so its review
runs on `opus`, `xhigh`.
- In `observeClaude`, an Anthropic `/v1/messages` answer below 400 ends a record of another
  model only when **that answer's own headers prove the window has room**: the
  `anthropic-ratelimit-unified-5h-utilization` header (for `five_hour`) or `-7d-utilization`
  (for `seven_day`) reads below 1 (contract row 178). A record with no claim ends on any such
  2xx. A per-family claim (`seven_day_opus`, `seven_day_sonnet`) ends only by an answer from
  that family. Any other claim, unknown included (for example `seven_day_oauth_apps`), ends only
  by the same model, as today.
  - The fallbacks that leaned on an ended record end with it, with the same log line as today.
  - A 429 still writes its record exactly as now.
  - One home for the rule: a pure function in `limit-state.ts`
    (`recordsEndedBy(answerModel, headers, limits)`), with tests.
  - Prove the header names on a real answer first, and add a contract row.
- The status line trusts the session's own `rate_limits` over the file. It hides a record only
  when the session's input carries the same window **with a different `resets_at`** than the
  record's `resetsAt`, which means another login or a new window. The same login's 429 names the
  same reset, so a real limit still shows in every session of that login.
  - The fallback banner of a hidden record hides with it (`statusline.ts:168-176`), so the line
    never says both.
  - A per-family claim stays (the input has no per-family window).
  - No `rate_limits` (an API key, a third-party provider): today's behaviour.
- D65: a stale record alone never skips a target, since `cooling` is in memory and set only by
  the target's own failure (`router.ts:2209-2213`). It does change `askedAtLimit`
  (`router.ts:2250`) and `noteFallback` (`router.ts:2932`). Test those two with a record that
  another model's proving answer ended.
- Docs: `docs/gateway.md` § The limit state, the status line, the alert; README § The usage
  limit; `.claude/rules/gateway.md` gets one line: a record ends by login, not only by model.
- Done-check: limit-state tests (each claim, cross-model end, per-family not ended by another
  family); gateway tests for D65 and the fallback end; status line tests with and without
  `rate_limits`; `git diff --stat plugin/dist` names `router.js` (expected, said in the PR).

### B. Task model: Session › Plan › Phase › Task, and take-over (code: store, tools, API)
Builder, `sonnet`, `high`. It migrates the task database, so its review runs on `opus`, `xhigh`.
- **Layers:** `placeValid` allows only a plan at the top, a phase under its plan, and a task
  under a phase, or a loose task at the top (no plan). A task never holds a task. The words
  "subtask" leave the tool descriptions (`schemas.ts`, `mcp.ts`, `words.ts`), the CLI help
  (`command.ts`) and the MCP server's instructions.
- **The lift is a repair, run on every write-mode open** (not only the 3 → 4 step), so a task an
  old 3.x session writes under a task after the move is lifted at the next open. Every 4.0 reader
  (`planProgress`, the portal tree, the guards) also tolerates a stray nested task. Schema v4
  marks the first run. `MIGRATIONS` gets a function step.
  - **The backup** is `serialize()` inside the write lock, so WAL data is included.
  - **The move:** every task whose parent is a task moves to that task's own parent (a phase, or
    the top), repeated until none is left.
  - **History:** each move gets a `task_events` row with action `changed` and `changes` naming the
    old parent.
  - **Held parents:** an open blocking subtask held its parent's `task_done` (`store.ts:208-210`).
    The lift keeps that hold as an explicit blocker row (the former parent waits for it). A
    subtask under a non-blocking task becomes non-blocking, so it does not start holding the phase.
  - Notes, history and claims stay.
- **Which tasks belong to a plan:** the `plan` column decides, everywhere (progress, the portal,
  take-over). A top-level task with a plan is valid. A task with no plan is "loose".
- **Plans by name, several per session:** every tool that defaults to the caller's plan also
  takes `plan` (the slug). `task_list scope plan` lists the session's plans with their counts when
  it owns more than one. The default stays exactly today's rule (`ops.ts:159`: the latest own
  task that has a plan), so nothing that works today breaks.
- **`task import claude-mem`** (`import-claude-mem.ts:241-254`) imports a list with items as a
  plan with one phase, its items as that phase's tasks. Update its tests.
- **Take-over:** a new MCP tool `task_take` and the CLI `task take <plan-slug|#n> [--from
  <session>]`. It moves `createdBy` and the claim of a plan (with its phases and tasks) or of one
  task to the calling session. It writes a `task_events` row for each move, with both session ids.
  - It refuses a task that a **live** process still claims (`claimLive`: on Linux the pid and
    its start time; elsewhere the pid alone, so a reused pid looks live and needs `--force`). It
    names that session. `--force` takes it anyway and says so; the portal button passes `--force`
    only after its confirmation.
  - A dead claim needs no force: that is the crash case.
  - **All or nothing:** one `writeWork` transaction (`BEGIN IMMEDIATE`) checks every claim and
    moves every row, so two takes at once give one winner, and a refusal changes nothing.
  - **The destination** must be the calling session with a resolvable identity (`callerOf`). A
    session-only caller (no pid) gets `createdBy` and no claim, said in the answer. The portal
    lists only sessions it can name, and refuses an unknown one with nothing changed.
- **Portal API:** `WorkTaskNode` gains `session` (`createdBy`), `parentId`, the claim's live or
  dead state, and `notes` and `events` counts. A new read route `GET /api/tasks/<id>` returns one
  task with its description, notes and history (built from `read.ts`, through `answerApi`). A new
  action `task.take` runs the CLI's own take-over code. `types.ts` and `wire.ts` change in the
  same commit (`wire-mirror.test.ts`).
- **Status query** for phase C: `planProgress(project, who)` returns the claimed task, its plan,
  and the plan's closed and total **tasks** (kind `task`, by the `plan` column). With several
  claimed items, it picks the one that is `in_progress` and most recently **started**, not the
  most recently edited, so editing a parked plan does not steal the line. A claimed phase counts
  its own plan.
- Also drop "subtask" in `plugin/skills/memory-routing/SKILL.md`, `portal/src/components/nav-items.ts`,
  `src/tasks/work/tree.ts`, `types.ts`, and every hook text (keep-going, builder-finish,
  task-start). `docs/roadmap.md` keeps its history.
- Docs: `docs/design/tasks.md` (layers, migration, take-over, plans per session), README task
  commands and tools.
- Done-check: store, layer, migration (a v3 fixture with subtasks two levels deep), take-over
  (live, dead, forced, cross-project refused), MCP and command tests, API route and wire-mirror
  tests.

### C. Status line task line (code), after A and B
Builder, `sonnet`, `medium`: small and well specified.
- `taskSegment` → `3/10 · <title>` from `planProgress`. With no plan: the title alone. It moves
  to its own status line row, so there is no 60-character cut. A title longer than the terminal
  width is cut there, by the terminal.
- Hand-written tests pin the format: plan with tasks, plan with no tasks yet, loose task, no
  task, a long title kept whole.
- Docs: README status line rows, `docs/design/setup.md:115`, `docs/design/tasks.md:246`.

### D. Portal Tasks page: designed for use (UI/UX), after B
Builder, `opus`, `high` (UI/UX design is Opus-only at high). It designs first, then builds.
- **Structure:** project › session › plan › phase › task, as one tree:
  - each level collapses, with remembered state (local storage, try/catch);
  - the done phases and plans start folded;
  - each plan and phase shows its count and progress.
- **Find:** a filter bar with session, plan, status (open, in progress, blocked, done), a text
  search over titles, and "mine / all sessions". The list is paged or virtualized, so it never
  scrolls without end; the page says how many are hidden.
- **Open a task:** a click opens a side panel with the description, notes, history,
  blockers, agent, branch and worktree, from `GET /api/tasks/<id>`. Keyboard and screen-reader
  usable.
- **Move:** "Move to session…" on a plan or a task opens a confirm dialog (`ConfirmDialog`) that
  names the sessions and whether the old claim is still live. It runs `task.take`, and the
  result shows in place.
- Project task files (the repo's own list) stay a separate tab with the same filter bar.
- The design lives inside the portal's rules: no inline script or style, nothing from the
  internet, the strict CSP (`.claude/rules/portal.md`). The mock data (`portal/src/api/mock*.ts`)
  gets a realistic tree: several sessions and plans, 200+ tasks, a dead claim.
- UI check: `ui-verifier` (one at a time) across the breakpoints and both colour schemes; the
  owner judges from the key screenshots.
- Docs: `docs/design/portal.md` Tasks section, README portal rows.
- Done-check: `cd portal && bun run test`, the portal typecheck, `bun run build:portal`.

### E. Portal switches say what they do (code + UI)
Builder, `sonnet`, `medium`.
- Remove "opus and fable slots": `SavedSwitch` in `overview.tsx`, `switchModelSlots` and the
  `models` switch name in `actions.ts`, `SwitchFacts.models`, `modelSlotsOn` if nothing else
  uses it, `wire.ts`, the mock, and the tests.
- The judge switch becomes **"Auto-mode judge"**, with on and off words: "Claude judges" or
  "Your judge chain judges". While the gateway is off it is disabled, with the line "Works only
  with the gateway on". The two switches sit in separate rows: the gateway first, then what
  runs through it.
- Live check with the owner: toggling the judge leaves `ANTHROPIC_BASE_URL` and `gateway status`
  as they were.
- Docs: `docs/design/portal.md` Overview, README portal rows.

### F. Plans in the project, one plan after another (code + instructions), after B
F1 builder, `sonnet`, `high` (it writes a user settings file); F2 `rules-maintainer`, `opus`,
`high` (text every session reads).
- **F1:**
  - `setup` writes `plansDirectory: ".claude/plans"` into `~/.claude/settings.json` through
    `applyManagedJson`, as an owned key, **in its own call**. A value the person set is theirs:
    the `ForeignKeyError` becomes a `·` line, and setup's other writes still happen.
  - First, prove live which root Claude Code uses in a worktree session (the worktree, or the
    main checkout), and add a contract row. Plan files are committed (Decisions). A worktree that
    still holds an uncommitted plan file is kept, never cleaned (`src/worktrees/verdict.ts:17`),
    which is the safe side.
  - `restore` removes it, and `--dry-run` shows it.
  - `doctor` gets a `·` line naming the plan folder in use.
  - README setup section and `docs/design/setup.md`. A contract row: plan mode writes into
    `plansDirectory`, relative to the project root, proved live.
- **F2:**
  - `plan-task`: the plan file lives in the project's `.claude/plans`. It is archived on finish.
    A session may run several plans one after another: finish or park one, then plan the next.
    Each plan has its own plan task, and the tools are named with `plan`.
  - `build`: it works on the plan named by slug, and "next plan" is a fresh plan task. Its
    "take over" section covers a crashed or handed-over session (`task_take`).
  - `core.md`: "One plan, start to finish" means one at a time, not one per session (within 140
    lines).
  - The `task-start` and `keep-going` hook texts: no "subtask". `docs/design/instructions.md`.

### G. Fable 5.2 (code + docs)
Builder, `sonnet`, `high`. A router change goes in the same release as A, so routers restart once.
- **Changed during the build (owner, 2026-11-11), after two live proofs:**
  - Claude Code skips gateway model discovery for a subscription login. The debug log says
    `[gatewayDiscovery] skipped: no credential`.
  - Claude Code 2.1.322's own model table maps the `fable` alias per provider:
    `gateway: "claude-fable-5"`. So `/model` shows an older Fable behind `ANTHROPIC_BASE_URL`;
    the owner saw Fable 5.1. Opus, Sonnet and Haiku are not affected.
  - So discovery is dropped.
- **The fix:** while the gateway is on, the kit pins `ANTHROPIC_DEFAULT_FABLE_MODEL` as an owned
  key in the user settings `env`, through `applyManagedJson`.
  - `gateway on` writes it, `gateway off` removes it while it is still ours, and a `setup` step
    adds or refreshes it on a machine whose gateway is already on.
  - A person's own value always wins.
  - The id has one home (`GATEWAY_FABLE_MODEL`). A test ties it to the newest Fable row in
    `CLAUDE_PRICES`, so a newer Fable cannot ship without moving the pin.
  - `doctor` names the pin.
- This is the one named exception to `.claude/rules/gateway.md`'s "no model id as a default",
  written there with the owner's date. A contract row records Claude Code's per-provider map.
- `CLAUDE_PRICES` gets the Fable 5.2 row, from Anthropic's pricing page on the day, cited.
  `CLAUDE_TARGET_RULES` gets a row only if Fable 5.2's migration guide names a refused field,
  with a test.
- Update the portal mock catalog, the `router.ts:775` comment and the docs examples that call
  5.1 the newest. Historical rows in the contract stay as they are.
- Raising `.claude-code-version` to 2.1.322 is separate work (the `claude-code-upgrade` skill
  walks every contract row). It is filed as a follow-up project task, not done here.

### Main session (after the merges)
- Bump `plugin.json` to **4.0.0** and `INSTALLER_VERSION` in both installers.
- CHANGELOG 4.0.0, with these steps:
  1. update on purpose (a major version);
  2. the task database moves subtasks up by itself (a backup first);
  3. routers restart once;
  4. run `setup` for the plan folder.
- Archive the 2.2.0 plan (kept at the end of this file) and this plan into
  `.claude/plans/archive/`.
- `bun run build`, `bun run build:portal`, the full `bun run check`, `check:portal`, both
  validates, the portal tests.
- The final whole-branch review (senior engineer, `opus`, `xhigh`), then the PR and the owner's yes.

## Edge cases

- **Two logins at once** (two sessions on two accounts, or an API key, through one router): one
  login's answer, with room in its headers, ends a record the other login still hits. The other
  login's next 429 writes it again within one request. Accepted, and said in the docs.
- **Discovery:** a router that is down at startup makes Claude Code fall back to its cached list
  (`~/.claude/cache/gateway-models.json`), then to its built-in list. Nothing breaks.
- **Per-family limits:** a `seven_day_opus` record is never ended by a Sonnet answer.
- **Migration:** a store that an older kit nested four deep; a subtask with blockers (kept); a
  database another session holds open (SQLite busy timeout, as today); an older kit reading a v4
  store (only a move was ever held to the layers, so it still reads it).
- **Take-over:** a pid reused after a crash (the start time decides); a plan with phases claimed by
  live builders (named, not taken without `--force`); a take of a plan in another project (refused).
- **plansDirectory:** a project whose root is home, or a path with a backslash on Windows. Claude
  Code then falls back to `~/.claude/plans`. Verify-gate already excludes both.
- **Status line:** no plan, a plan with zero tasks, a claimed phase (count its plan), a
  terminal narrower than the title.

## What could break

Every hook and skill text that says "subtask"; the portal wire mirror; D65's tests; the gateway
fallback-end logs; `statusline.test.ts`; the portal export. The main session's grep for
"subtask" across `src/`, `plugin/`, `portal/src` and `docs/`, and the full check, catch these.

## Rollback

Each phase is its own merge commit. A rollback is 4.0.1 with the old behaviour. The v4 migration
cannot be undone by a lower version, but v3 code still reads the lifted tasks.

## How we prove it

- Each phase's done-check, with hand-written expected values; the full check and both validates.
- **Live, with the owner:**
  - log into the other account: the stale `⛔` line goes on the next status tick, and it comes
    back only on a real 429;
  - the status line shows `n/m · title` and the full title;
  - the portal's Tasks page: collapse, filter, open a task, move a plan to another session;
  - plan mode writes into the project's `.claude/plans`;
  - the judge switch leaves the gateway as it was;
  - `/model` shows Fable 5.2 with the gateway on, from the live list.
