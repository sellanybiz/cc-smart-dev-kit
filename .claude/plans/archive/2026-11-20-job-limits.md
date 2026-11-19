# Plan: job limits, so a heavy job never hangs the machine

## Summary

Queued heavy jobs run together in one systemd slice that has a CPU cap (90%), a low CPU weight
(they yield to the person's apps), a memory cap (90%), no swap, and a memory-pressure watchdog
(systemd-oomd) that stops a stalled job within seconds. The person changes the caps with `job
set cpu|memory <n>`. Where Linux cannot apply them, the job runs as today, and says so.

## Goal

The machine never hangs because of a heavy job. Today one job may use every core and all the
memory (docs/jobs.md § Limits), and a type check or a test run can push the machine into swap
until it stops answering. The person asked for "90% of CPU and 90% of RAM, adjustable, so the
machine doesn't hang".

A cap alone does not meet that goal (the plan's second read, proved live): the job cannot swap,
so before it reaches 90% the kernel swaps out the desktop and the sessions instead. **The caps
bound the jobs; the watchdog and the kill mark are what stop the hang.**

## Decisions

- **The owner, 2026-11-20:**
  - The caps are CPU 90% and memory 90% by default, adjustable per machine.
  - **Cap + watchdog:** systemd-oomd stops a job when the jobs' slice stalls on memory, and the
    kernel's OOM killer picks a job first. The cost is that a job may be stopped below 90% when
    the machine is really short.
  - **Cap + yield:** jobs get a low CPU weight, so the person's apps get the CPU first when it
    is busy. An idle machine runs the job at full speed, up to the cap.
  - **A bad setting runs without limits:** the job runs as today, prints one line naming the bad
    key, and `doctor` gives the fix. A typo never blocks a build, a test or a commit.
  - The plan is made now, beside the mixed-line work. It is built once that plan ships.
- **One shared slice**, `<COMMAND>-jobs.slice` (a dash nests it: it sits inside
  `<COMMAND>.slice`, and so on). Every queued job runs in its own scope in that slice, so the
  limits hold for all heavy jobs together, even with `job set max 3`.
- **The slice's properties, written in full before each launch** with `systemctl --user
  set-property --runtime <slice> …`:
  - **CPU:**
    - `CPUQuota` is the percentage times the machine's CPUs. The count comes from the user
      manager's `cpuset.cpus.effective`, or else `os.cpus().length`, never
      `availableParallelism()`: a `job run` started under `taskset` must not shrink every job's
      quota. At 100 it writes `CPUQuota=` (empty, which unsets it).
    - `CPUWeight=20` (systemd's default is 100), a fixed value: the jobs yield, but never starve
      behind steady background work, as `idle` could make them.
  - **Memory:**
    - `MemoryMax=<n>%` (systemd reads it as a share of the physical memory, so no `MemTotal`
      read is needed).
    - `MemorySwapMax=0`.
    - `MemoryHigh=infinity`, written explicitly. A `MemoryHigh` below `MemoryMax` made a job
      hang for good with no swap (proved live), so it is never set lower.
  - **The watchdog:** `ManagedOOMMemoryPressure=kill` and `ManagedOOMMemoryPressureLimit=40%`.
    `ManagedOOMMemoryPressureDurationSec=10s` goes in a separate call: it needs systemd 257, and
    on an older one that call alone fails, with the default duration kept.
  - **Why runtime:** the drop-ins live under `/run/user/<uid>/systemd/user.control/` (one file
    per property), and they are gone at reboot. No file in the person's home changes. A runtime
    property outlives a job, so every launch writes every property it owns, with its reset value
    where a cap is off. Equal writes from two `job run`s are harmless.
- **The scope:** `systemd-run --user --scope --quiet --collect --slice=<slice> -p
  OOMPolicy=kill --unit=<unique> -- choom -n 900 -- <argv>`.
  - `OOMPolicy=kill` ends the whole job when one of its processes is OOM-killed, so the exit is
    137. Without it the user manager's default (`stop`) gave 143 (live). It needs systemd 253;
    the probe tries with it first, then without (the pre-2.0 `chooseLaunch`).
  - `choom -n 900` is the kill mark: when the whole machine runs out and oomd is off, the
    kernel kills the job before the desktop. With no `choom`, the job runs without the mark,
    and the limits still apply.
  - The unique unit name follows the pre-2.0 `unitName`.
- **The empty-scope probe:** `systemd-run` exits 1 when it cannot make a scope, the same code as
  a type check that found errors. So the same switches run `-- true` first (about 30 ms); only
  then does the job start in a scope.
- **Every systemd call has one timeout** (`SYSTEMD_TIMEOUT_MS`, 10 s, as before 2.0). A hung
  user bus must never hang a heavy job or a commit hook (`--hook`: "a broken kit never blocks a
  commit").
- **When the limits cannot apply, the job still runs without them.** The checks come in a fixed
  order: Linux, the user manager's delegated `cpu` and `memory` controllers (the file at the
  chained cgroup path), `systemd-run`, the probe, then `set-property`. The first that fails names
  the reason. On Linux `job run` prints that reason in one line; elsewhere it prints nothing
  (every hook would repeat it), and `doctor` covers it. `doctor` also warns when systemd-oomd is
  not active: the caps still hold, but the watchdog does not.
- **Stopping a job, and its leftovers:** bring back the pre-2.0 `ScopeHandle`.
  - The signals go to the process group and also through `systemctl --user kill
    --signal=<sig> <unit>` (non-blocking), which reaches a worker that left the group.
  - The job counts as ended only once the scope's `cgroup.events` says `populated 0`, read at the
    chained path. Never `systemctl stop`: it waits up to 90 s.
- **A job stopped for memory says why.** The reads come before and after the job, from the
  slice's `memory.events` at the chained path (pre-2.0 `sliceChain`, `userSliceCgroup`,
  `oomKiller`):
  - `oom` rose: the jobs' memory cap.
  - only `oom_kill` rose: the machine ran out.
  - an oomd kill: the scope's result, or the journal line. The builder finds which signal is
    reliable, and the reviewer proves it.
  The line names the cap (GB and %), says "the heavy jobs together" when `max` is above 1, and
  gives the fix (`job set memory <n>`). It never prints after an exit 0, and it never depends on
  exit 137.
- **Settings:** `cpuPercent` and `memoryPercent` in the machine file `heavy-jobs.json`, beside
  `maxConcurrent`. Each is an integer from 10 to 100; a missing key means 90. `job set cpu <n>`
  and `job set memory <n>` sit beside `job set max <n>`, under the same lock. A bad value turns
  the limits off, with one line naming that key and its range. It never stops the queue:
  `maxConcurrent`'s read stays separate, and a bad `maxConcurrent` keeps today's behaviour. The
  error names the key that failed.
- **Tests never touch the host's systemd.** `JobContext` gets a required limits-facts field, and
  so does `heavyJobChecks`. The real facts come from the CLI entry and the portal's
  `jobContext`; every test world passes a fake. `readJobs` (polled by the portal) never probes
  systemd. The pre-2.0 opt-in live test comes back (`live-systemd.test.ts`): it is skipped unless
  `CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`, uses a throwaway slice, and reverts it and checks for
  leftovers in `afterAll`.
- **Play safe or go fully new:** neither applies; nothing old is kept or removed.

## Research

- **Live on this machine** (Linux 7.0, systemd 259, cgroup v2, the user manager delegated `cpu
  memory pids`, systemd-oomd active):
  - A scope with `CPUQuota=1080% MemoryHigh MemoryMax MemorySwapMax=0`: the kernel's files held
    every value.
  - `set-property --runtime` on a slice, then a scope inside it: the values held, and `revert`
    removed the drop-ins.
  - **The plan's second read (senior-engineer, opus xhigh), with throwaway slices:**
    - `MemoryHigh=200M MemoryMax=300M MemorySwapMax=0` with a 400 MB eater: the job stuck at
      229 MB in D state for over 2 minutes (`high 8402`, `oom_kill 0`, the slice's
      `memory.pressure` at full avg10=79). With `MemoryHigh=infinity` it was killed at once.
    - `ManagedOOMMemoryPressure=kill`, limit 40%, duration 5 s, on the slice: `oomctl` listed it,
      and oomd killed the stalled scope after 16 s (exit 137).
    - A default scope OOM-killed gave exit 143; with `OOMPolicy=kill` it gave 137.
    - A `systemd-run --scope` job keeps its caller as parent, and exit 3 passed through, so the
      ancestry check still finds a parent `job run`.
    - Each `set-property` writes one drop-in per property, and an empty `CPUQuota=` unsets it.
    - The slice's cgroup path is chained: each dash is one more folder level.
- **Man pages** (installed):
  - `systemd.resource-control`: `CPUQuota` is relative to one CPU; `MemoryHigh` slows and never
    kills; `MemoryMax` takes a percentage of physical memory; `ManagedOOMMemoryPressure*`
    (`DurationSec` since 257).
  - `systemd.scope`: `OOMPolicy` since 253.
  - `systemd-oomd`: "only descendant cgroups are eligible candidates for killing".
- **Prior art:** the pre-2.0 queue (`git show 64b889a4^:src/jobs/launch.ts`, `run.ts`,
  `memory.ts`, `live-systemd.test.ts`) had the slice, the probe, `OOMPolicy=kill`, `choom`, the
  `ScopeHandle`, the systemd timeout, the chained cgroup path, and the OOM reading. The master
  plan's notes say it worked here. 2.0 cut it as scope, not as a failure. This plan brings back
  the parts that serve the ceiling and the hang, and none of the gates.

## Files to change

- `src/jobs/limits.ts` (new): the limits as data, the facts (injected), the checks in order, the
  `set-property` argv, the scope switches, the probe, the chained cgroup paths, the OOM reading.
- `src/jobs/limits.test.ts` and `src/jobs/live-systemd.test.ts` (both new).
- `src/jobs/config.ts` and `config.test.ts`: `cpuPercent` and `memoryPercent`, their schema, read
  and write, and errors that name their key.
- `src/jobs/launch.ts` and `launch.test.ts`: start in the scope, with the `ScopeHandle`'s signals
  and emptiness.
- `src/jobs/run.ts`, `commands.ts` and `commands.test.ts`: `job set cpu`, `job set memory`, the
  "no limits" line, and the memory line.
- `src/jobs/status.ts` and `status.test.ts`: `JobContext`'s limits facts; the limits in the
  status note (`job status`, `/api/jobs` and the Machine page read it there; no new API field, so
  the portal needs no rebuild).
- `src/jobs/doctor.ts` and `doctor.test.ts`: the limits line, the reason they are off, and
  systemd-oomd's state. It reads the slice's live `cpu.max` and `memory.max` before it claims a
  limit.
- `src/entries/cli.ts` and `src/portal/actions.ts`: pass the real facts.
- `plugin/dist/` (built).
- `docs/jobs.md`, `docs/windows-jobs.md` and `README.md`. The CHANGELOG comes at release.

## Patterns to follow

- `maxConcurrent` in `config.ts`.
- The pre-2.0 files named above. Reuse their logic, with today's names and the rules in
  `.claude/rules/` (no `homedir()`, one home per constant, `COMMAND` for names).
- `command-output.md`: one way to print, and a warning carries its fix.
- `testing.md`: fakes for every system fact; the live test is opt-in only.

## Edge cases

- **No user manager, the controllers not delegated, cgroup v1, a container or toolbox without
  the controllers file:** the limits are off, and the reason is named. Each case gets a test with
  a fake, the file being absent included.
- **systemd older than 253, or than 257:** the probe without `OOMPolicy`, and no duration call.
  The rest still applies.
- **systemd-oomd not active:** the caps and the kill mark still apply, and `doctor` warns.
- **A hung user bus:** every call times out after 10 s, and the job runs without limits.
- **`set-property` fails:** the job runs without limits, with one line.
- **The memory cap reached:** the line plus exit 137 (`OOMPolicy=kill`).
- **The machine runs out (not the cap):** the line says so; the kill mark made the job the
  first pick.
- **A stall below the cap:** oomd stops the job within about 10 to 20 s. The line says it
  stalled on memory.
- **A lower limit set while a job runs:** the next launch's write reaches the running slice at
  once, and a job above the new cap is killed then. Documented.
- **`job set cpu 100`:** writes `CPUQuota=` (unset). `job set memory 100` writes `MemoryMax=100%`,
  and swap stays 0.
- **After a reboot:** the drop-ins are gone, and the next launch writes them all again.
- **`job run` killed with SIGKILL:** its scope runs on. This is a known limit, unchanged.
- **Nested jobs and git hooks:** they run in the parent's scope (proved live), with no second
  scope or second write.
- **macOS, Windows, CI:** no per-run line, and a `doctor` note.
- **Neutral:** every unit name is built from `COMMAND`.

## What could break

- `spawnAndWait`: every queued job, every git hook and every nested job runs through it. Its
  tests cover the limits on and off, a failed probe, exit codes 0, 1, 130 and 137, signal
  forwarding, a leftover outside the group, and the timeout.
- `JobContext` grows a required field: every caller (the CLI, the portal, tests) must pass it,
  and the typecheck finds them all.
- `doctor`'s exit codes: a "limits off" or "oomd off" line is a warning, never a failure.

## A simpler approach?

A scope per job with `-p` limits needs no slice, but with `max` above 1 the caps add up. `nice`
and `ulimit` cap neither memory in use nor stalls. Without the watchdog, the cap does not stop
the hang (§ Goal). So: the slice, the watchdog and the kill mark.

## Rollback

`job set cpu 100` and `job set memory 100` lift the caps. `systemctl --user revert <slice>`
removes every drop-in at once. A release without the code goes back to plain runs.

## How we prove it

- **Unit tests with fakes:** the argv for each case, each reason the limits are off, the probe
  order, the reset values, the OOM reading, the config range and the bad-key line, `job set`'s
  output, and that `readJobs` never probes. Each new test is seen failing once.
- **The opt-in live test** (`CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`), run by the reviewer on this
  machine:
  - a CPU burner holds the quota;
  - an eater past the cap ends with exit 137 and the line;
  - a stalled eater is stopped by oomd;
  - exit codes 0, 1 and 130 pass through;
  - a leftover outside the group is stopped;
  - nothing is left after `revert`.
- **`bun run check`**, both validates, and the build: `router.js` stays unchanged.
- **With the person:** run `bun run check` through the queue while using the machine. It
  should stay smooth. Then run `cc-smart-dev-kit job status` and `doctor`, which should show
  the limits.

## Phases

| Phase | Files | Builder | Review |
|---|---|---|---|
| `limits` | `src/jobs/limits*`, `live-systemd.test.ts`, `config*`, `launch*`, `run.ts`, `commands*`, `status*`, `doctor*`, `src/entries/cli.ts`, `src/portal/actions.ts` | sonnet, high | senior-engineer, opus xhigh (process launch on every machine) |
| `docs` | `docs/jobs.md`, `docs/windows-jobs.md`, `README.md` | sonnet, high, after `limits` | senior-engineer, sonnet high |

After both phases, the main session runs the final review (opus xhigh) and the release: the
next minor version after the mixed-line release, with the CHANGELOG, `plugin.json`,
`install.sh`, `install.ps1` and `plugin/dist`.
