# Crew and job limits that hold under load (1.8.0)

**Status:** approved by the owner, 2026-10-31. Building on `crew-job-load-limits`.

## Context

On 2026-10-30 the PC froze twice (load 34–76 on 12 cores, 21 GB plus 10 GB swap). The logs show
the kit let it happen:

- After a reboot, 7 leads came back, and within ~7 minutes the crew code started 15+ crew
  sessions: 11 "started from the queue" in 50 s, 7 "resumed by the lead" at load 34–76, 2
  hand-off continuations. Each one ran `bun install`, dev servers, tests and type checks.
- **Resumes skip the start gate.** `crew resume`, `crew resume --paused`, `crew answer` to a dead
  session and the watch's paused recovery all reach `resumeSession` (`src/crew/answer.ts`), which
  never asks `placeFor` and never takes the places lock.
- **The load gate reads the 1-minute load average,** which lags. The watch's drain starts every
  queued record that fits in one pass (`src/crew/watch.ts` ~1685), so a burst passes before the
  load shows it.
- **Loose defaults:** `max` 24, `memoryGb` 2, `loadPerCore` 3 (`src/workflow/schema.ts` ~422).
- **Stale records hold places.** A crew session closed in agent view never changes its record:
  the watch skips a record with no agent row (`watch.ts` ~1380). On this PC now: 14 records say
  `working`, all 14 worktrees are gone, and none has a session. They count against `max` 12, so
  every new crew start waits.
- **Job queue holes:** a test run on named files takes no slot, no ceiling and no kill mark,
  with no limit on how many files (`src/jobs/kinds.ts` `namesOnlyFiles`, `src/jobs/run.ts` ~231);
  `bun install` is not a job kind, so 8 ran at once; a heavy job starts whatever memory is free.
- **The person's ask:** crew limits belong to the machine, not to a project. Today a project's
  `cc-smart-dev-kit.json` wins over the person's `workflow.json` field by field
  (`src/workflow/resolve.ts` `mergeWorkflows`).

Correction to what I said before: crew sessions **already** start lean (`--strict-mcp-config`,
Tavily only, plus Playwright for `ui`: `src/crew/claude.ts` `launchArgs`, `serversFor`). The
~300 MB of helper servers per session belongs to sessions the person opens and to leads. Nothing
to change there.

## Goal

No path the kit owns can start Claude sessions or heavy jobs faster than the machine can carry,
and the crew limits are the machine's alone.

## Decisions (new: D71–D74)

- **D71 Crew limits are the machine's.** `crew.max`, `maxOpus`, `perLead`, `perLeadOpus`,
  `memoryGb`, `loadPerCore`, `usagePercent` and the new `startGapSeconds` are read from the
  person's `workflow.json` only. **Play safe, no major version:** a project file that still sets
  one parses as before; the value is ignored, and `doctor` says once that it can go (the pattern of
  the ignored job-size fields, `jobKindLines` in `src/cli/project-checks.ts`). A clean break
  (refusing the file) would be a major version and break committed project files.
- **D72 One gate for every launch.** Start, queued start, continuation and every resume go
  through `placeFor` under `withPlacesLock`. New hold: **a launch waits until the machine's last
  launch is `crew.startGapSeconds` old** (default 60 s), so the load average catches up between
  launches. Continuations keep D70's load skip but wait for the gap. The lead's guard
  (`placeForLeadStart`, D59) ignores the gap: it is a pause, not a full machine.
- **D73 A session gone from agent view frees its place.** A lead's watch marks any running record
  on the machine whose session is missing from a readable agent view in two passes at least a
  minute apart as `stopped` ("its session is gone from agent view"). A row that comes back
  restores the record's last state. No read, no change.
- **D74 The job queue bounds every run.** A named-file test run of up to 10 files takes a
  **light slot** (`lightJobs`, default 2), separate from heavy slots so it never waits behind a full
  run; more files take a heavy slot. A new default `install` kind (bun/npm/pnpm/yarn install and
  add) takes a light slot. A light run gets the kill mark (`choom`), not the slice. **No job
  starts while free memory is below `startFreeGb`** (jobs.json, default 4); the wait line says why.

New defaults, for every machine: `crew.max` 24 → 12, `crew.memoryGb` 2 → 6, `crew.loadPerCore`
3 → 1.5, `crew.startGapSeconds` 60, `lightJobs` 2, `startFreeGb` 4. `reserveGb` stays 8.

## Phases (three, built in parallel, each in its own worktree)

### Phase 1 — Machine-only crew limits (D71) and the new defaults
Files: `src/workflow/schema.ts` (one list `MACHINE_CREW_KEYS`, defaults, field comments),
`resolve.ts` (a project's value for those keys never merges; `sourceOf` never says `project`),
`write.ts` / `propose.ts` (through `isProjectKey`: `workflow set --project crew.max` and
`workflow propose crew.max` refuse with the fix), `src/cli/project-checks.ts` (one info line),
`src/project/config.ts` (comment only), the portal's project settings list (already filtered by
`isProjectKey`: check its tests), README § The workflow and § A project's
`.claude/cc-smart-dev-kit.json`, `.claude/rules/cc-smart-dev-kit-json.md` (the `workflow.crew` row),
`docs/design/workflow.md`.
Reuse: `isProjectKey`, `PERSONAL_FILE_SWITCH_NAMES` (the statusLine/updateHold precedent),
`jobKindLines`.

### Phase 2 — One launch gate, the start gap, resumes that wait, the sweep (D72, D73)
Files: `src/crew/places.ts` (`PlaceInput` gets the last launch and the gap; a resume's own record
is left out of the counts, then counted as the one asking), `src/crew/store.ts` (optional record
fields `launchedAt`, set at every launch, and `resumeWaits: {at, answer: null | index}`),
`src/crew/answer.ts` (`resumeSession` decides and claims under the places lock, launches after
it; a refusal returns `waits`), `src/crew/end.ts` (`crew resume` with a refusal records
`resumeWaits` and exits 0 with the reason), `crew answer` (stores the answer, records
`resumeWaits` with it; the queued resume delivers it as its prompt), `src/crew/watch.ts` (drain
order: continuations, then waiting resumes, then queued starts oldest first; the sweep; paused
recovery skips a refused pass and says why once), `start.ts`, `board.ts`, `model.ts` (one input
builder, `placeInputOf`), `schema.ts`/`resolve.ts` (the `crew.startGapSeconds` field only),
`docs/design/crew.md` (§ The lead and the launch, the places text, § Waiting out a limit),
README § The crew.
Reuse: `placeFor`, `placeInputOf`, `withPlacesLock`, `claimResume`, `sessionLiveness`, `rowOf`,
`resumeOne` (one home for paused resumes), `RUNNING_STATES`.

### Phase 3 — Job queue: light slots, install kind, memory admission (D74)
Files: `src/jobs/kinds.ts` (`install` kind, the 10-file limit as one constant, a `light` kind
field), `src/jobs/classify.ts` (bun/npm/pnpm/yarn install reach the kind), `src/jobs/queue.ts`
(`decide`: light capacity, free-memory wait), `src/jobs/config.ts` (`lightJobs`, `startFreeGb`),
`src/jobs/commands.ts` (`job set light-jobs`, `job set start-free-gb`, `job status` lines),
`src/jobs/run.ts` / `launch.ts` (light runs: `choom`, never the slice), `src/jobs/status.ts`,
`src/project/config.ts` (`light` in `JOB_KIND_KEYS_SINCE`, raises `requires` to `>=1.8`),
`docs/jobs.md` (§ Kinds, § Waiting, § The machine config, § The classifier), `docs/design/jobs.md`,
README jobs section, the rule's `jobs.kinds` row.
Reuse: `realMemoryFacts`/`machineMemory` (one memory reader, crew and jobs), `chooseLaunch`,
`HEAVY_OOM_SCORE_ADJ`, `namesOnlyFiles`.

### Then (me, inline)
Merge the three branches, version 1.8.0, CHANGELOG, `bun run build`, `bun run check`, both
validates, `cd portal && bun run test`; the reviewer once (`opus`, `xhigh`: it changes the config
contract); the pull request. The merge waits for the person's yes.

## Edge cases

- A resume of a `paused` record already counts as running: left out, then counted as the asker,
  so it never counts twice. A `stopped` one adds a place, as it should.
- Agent view unreadable or `claude` missing: the sweep changes nothing; a resume refuses as today.
- A record mid-resume (a live claim) or `starting` with no session id yet: the sweep skips it.
- The gap across leads and repositories: the last launch is read from every store
  (`listAllCrew`), so twelve leads after a reboot launch one a minute, not twelve at once.
- A lead that is gone: its `resumeWaits` and queued records wait; `crew list` says so.
- A project file with `crew.max`: still loads on 1.7.x and 1.8.0; 1.8.0 ignores it and says so.
- macOS and native Windows give no free memory or load: the gap still holds; admission and the
  load hold do not apply (as today).
- A light run waiting on memory still never waits behind a heavy run.

## Verification

- Tests beside each change: the gate (resume counts, the gap, the guard ignores it), resolve
  (project caps ignored, their source), the `--project` and `propose` refusals, the doctor line,
  the sweep (two passes, unreadable view, a row that comes back), the drain order, `decide`
  (light lane, the 10-file limit, admission), the `install` kind's classifier cases, the light
  launch with `choom`. Each test fails first.
- `bun run check`, `bun run build:check`, both validates, `cd portal && bun run test`.
- Live on this PC after the update: `workflow show` shows the crew limits as `(personal)`; two
  `crew start`s 10 s apart, and the second waits with the gap's reason; a lead's watch moves the
  14 stale records to `stopped`; three named-file `vitest` runs at once, and the third waits for a
  light slot; `bun install` in a worktree goes through the queue; `job status` shows free memory
  and the light slots.
- **With the person:** one lead on the large web app starts a plan of about six phases; `uptime`
  stays under 18 (12 cores × 1.5), and the starts come a minute apart.

## Rollback

A new version with the old behaviour, never a lower one. On one machine, without a release:
`workflow set crew.startGapSeconds 1`, `job set light-jobs 99`, `job set start-free-gb 0`.

## Not in this plan

- Leads themselves: Claude Code's agent view brings them back after a reboot, not the kit.
- The helper MCP servers of sessions the person opens (~300 MB each).
- The T3 Code move and the full uninstall: both parked.
