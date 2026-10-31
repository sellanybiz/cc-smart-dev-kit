/**
 * How a heavy job starts once the queue has given it its slot, and what `job run` says when it
 * ends.
 *
 * WHY
 *   The queue keeps the number of heavy jobs down. This file makes sure that if memory still
 *   runs out, a heavy job dies, not the desktop and not a Claude session: a heavy job is
 *   the one thing that can simply run again. (systemd starts desktop services with a
 *   higher "kill me first" score than ordinary commands, so without a mark a small
 *   desktop helper outranks a 9 GB build.)
 *
 * THE THREE WAYS TO START A JOB (`chooseLaunch`), with `launch: auto` (the default)
 *   scope  Linux with a systemd user manager: `systemd-run --user --scope` puts the job in
 *          its own memory group inside a slice (`cc-smart-dev-kit-heavy.slice`). The slice has a
 *          ceiling (`MemoryMax`, set before each launch): all heavy jobs together can
 *          never take the memory kept for everything else, and past it the kernel kills
 *          inside the slice only. `OOMPolicy=kill` ends the whole job when one of its
 *          processes is killed. Inside, `choom -n 900` marks the job to die first if the
 *          whole machine runs out. When `jobs.json` asks for a CPU or disk I/O weight, the
 *          slices carry it (`weightsArgv`); by default they carry none, so a job gets normal
 *          CPU and I/O.
 *   choom  Linux with no user manager (cron, a container, CI, ssh after logout): the mark.
 *   plain  No `choom`, macOS, or `launch: plain`: the command as it is. The queue still
 *          applies.
 *
 * PROBE FIRST, NEVER RETRY
 *   A scope that cannot be made makes `systemd-run` exit 1, the same code as a type check
 *   that found an error. So an empty scope is tried first (`-- true`, about 30 ms), and
 *   only then the real job. Once the job started, its exit code is the answer: it is
 *   never started a second time.
 *
 * "KILLED FOR MEMORY"
 *   An out-of-memory kill does not always show as exit 137: a killed test or build worker
 *   makes its parent exit 1. The kernel's `oom_kill` count in the slice's `memory.events`,
 *   read before and after, says it for sure. Which killer: the slice's own `oom` count
 *   rises only when the slice hit its ceiling; when only `oom_kill` rose, the whole
 *   machine ran out and the kernel's OOM killer picked the job (its kill mark).
 *
 * THE JOB'S OWN PROCESS GROUP, AND ITS LEFTOVERS
 *   The job starts in a process group of its own (a new session: `detached`; Node has no
 *   plain setpgid), so `job run` can signal all of it: its workers too, not only the first
 *   process. In a scope, `systemctl --user kill` also reaches a process that left the group.
 *   SIGINT, SIGTERM and SIGHUP are sent on, each once. (In its own session the job no
 *   longer gets the terminal's Ctrl+C itself: `job run` gets it, and sends it on once.)
 *   The memory is given back only once the group (and the scope) is empty: a worker that
 *   lives on after the job's first process ended still uses memory. Leftovers get a moment
 *   to end by themselves, then SIGTERM, then SIGKILL, so `job run` never hangs on them.
 *
 *   WINDOWS: there are no signals there, and no process groups to signal. So a stop is
 *   `taskkill /T /F` on the job's tree (`windows.ts`: Node's own rule, every signal ends
 *   the process forcefully), and "the group is empty" is "the job's first process is
 *   gone". A worker the job left behind is not seen: docs/windows-jobs.md § Running a job.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { type ReadText, userManagerControllers, userSliceCgroup } from "./memory";
import { endJobTree, processIsGone, realWindowsFacts, type WindowsFacts } from "./windows";

/**
 * How long a probe of systemd may take. A probe takes about 30 ms; a systemd that does not
 * answer (a hung user bus) must not hang `job run`. Past this, the probe failed.
 */
export const SYSTEMD_TIMEOUT_MS = 10_000;

/** The kill mark a heavy job carries: the kernel picks it before anything at 0 to 200. */
export const HEAVY_OOM_SCORE_ADJ = 900;

export interface LaunchFacts {
  platform: NodeJS.Platform;
  /** `/run/user/<uid>` exists: a systemd user manager may run for this user. */
  hasUserRuntimeDir: boolean;
  hasSystemdRun: boolean;
  hasChoom: boolean;
  /** Starts an empty scope in the slice; true when it exited 0. Called only when allowed. */
  probeScope: (withOomPolicy: boolean) => boolean;
}

export type Launch =
  /** `note`: one line saying why the job runs with less protection. */
  | { mode: "choom"; note?: string }
  | { mode: "plain"; note?: string }
  | { mode: "scope"; oomPolicy: boolean };

/**
 * A scope when systemd can make one here (tried with `OOMPolicy=kill` first; an older
 * systemd that refuses it on a scope gets a scope without it), else choom, else plain. A
 * light run gets choom alone: it never runs in the heavy slice, whose ceiling is for heavy
 * runs (`queue.ts` › TWO LANES).
 */
export function chooseLaunch(facts: LaunchFacts, light = false): Launch {
  if (facts.platform !== "linux") return { mode: "plain" };
  if (!facts.hasChoom) {
    return { mode: "plain", note: "no `choom` here: the job runs without its kill mark" };
  }
  if (light) return { mode: "choom" };
  if (!facts.hasSystemdRun) {
    return {
      mode: "choom",
      note: "no `systemd-run` here: the job runs with its kill mark only, no memory group or CPU and I/O priority",
    };
  }
  if (!facts.hasUserRuntimeDir) {
    return {
      mode: "choom",
      note: "no systemd user manager here: the job runs with its kill mark only, no memory group or CPU and I/O priority",
    };
  }
  if (facts.probeScope(true)) return { mode: "scope", oomPolicy: true };
  if (facts.probeScope(false)) return { mode: "scope", oomPolicy: false };
  return {
    mode: "choom",
    note: "systemd could not start a scope here (no user session bus?): the job runs with its kill mark only, no memory group or CPU and I/O priority",
  };
}

/** The scope switches shared by the probe and the launch, so the probe tests what runs. */
function scopeSwitches(slice: string, oomPolicy: boolean): string[] {
  return [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    `--slice=${slice}`,
    ...(oomPolicy ? ["-p", "OOMPolicy=kill"] : []),
  ];
}

export function probeArgv(slice: string, oomPolicy: boolean): [string, ...string[]] {
  return ["systemd-run", ...scopeSwitches(slice, oomPolicy), "--", "true"];
}

/**
 * A unit name says what runs and which `job run` started it. The start time (base 36)
 * makes it unique: a `job run` killed with SIGKILL leaves its scope running, and a new one
 * with the same pid would otherwise fail with "unit exists" (exit 1, read as a failure).
 */
export function unitName(slice: string, kind: string, pid: number, startedAt: number): string {
  const prefix = slice.replace(/\.slice$/, "");
  // A job with a name only (`--exclusive`) has no kind.
  const safeKind = kind === "" ? "job" : kind.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${prefix}-${safeKind}-${String(pid)}-${startedAt.toString(36)}.scope`;
}

export interface LaunchWhere {
  kind: string;
  pid: number;
  slice: string;
  startedAt: number;
}

export function launchArgv(
  launch: Launch,
  command: readonly [string, ...string[]],
  where: LaunchWhere,
): [string, ...string[]] {
  const choom = ["choom", "-n", String(HEAVY_OOM_SCORE_ADJ), "--"] as const;
  switch (launch.mode) {
    case "choom":
      return [...choom, ...command];
    case "plain":
      return [...command];
    case "scope":
      return [
        "systemd-run",
        ...scopeSwitches(where.slice, launch.oomPolicy),
        `--unit=${unitName(where.slice, where.kind, where.pid, where.startedAt)}`,
        "--",
        ...choom,
        ...command,
      ];
  }
}

/** A shell's exit code: the code, or 128 + the signal's number for a signal death. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal === null) return 1;
  const number: number | undefined = constants.signals[signal];
  return 128 + (number ?? 0);
}

/**
 * How one run of a job ended, as `job run` reports it: what it must say when the job's
 * output went down a pipe, where the shell's status is the pipe's own, not the job's.
 */
export interface JobEnd {
  /** The exit code, as a shell reports it: the code, 128 + n for a signal death, 127 when it cannot start. */
  code: number;
  /**
   * The signal that ended the job's own process, or null when it exited by itself. Another
   * process may have sent it: the kernel's OOM killer sends SIGKILL (`killedForMemoryLine`).
   */
  signal: NodeJS.Signals | null;
  /**
   * That signal was this wrapper's own stop: it sent on the one it caught, while the job
   * still ran. False when the job shrugged the signal off and ended by itself, and false
   * when another process sent the signal.
   */
  sentOn: boolean;
  /**
   * This wrapper had to stop processes the job left behind, after the job's own process was
   * gone. A fact of its own: a job can die of the wrapper's signal and still leave a
   * process that has to be stopped.
   */
  leftovers: boolean;
}

/** One count in a cgroup's `memory.events`, or null when it is not there. */
function memoryEvent(memoryEvents: string | null, key: string): number | null {
  if (memoryEvents === null) return null;
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(memoryEvents);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The `oom_kill` count: processes in the group any OOM killer stopped. */
export function oomKills(memoryEvents: string | null): number | null {
  return memoryEvent(memoryEvents, "oom_kill");
}

/** The `oom` count: times the group's own ceiling made an allocation fail. */
export function oomLimitHits(memoryEvents: string | null): number | null {
  return memoryEvent(memoryEvents, "oom");
}

/** Who killed a job for memory, from the slice's `memory.events` before and after. */
export type OomKiller = "ceiling" | "machine" | "unknown";

export function oomKiller(before: string | null, after: string | null): OomKiller | null {
  const killsBefore = oomKills(before);
  const killsAfter = oomKills(after);
  if (killsBefore === null || killsAfter === null || killsAfter <= killsBefore) return null;
  const hitsBefore = oomLimitHits(before);
  const hitsAfter = oomLimitHits(after);
  if (hitsBefore === null || hitsAfter === null) return "unknown";
  return hitsAfter > hitsBefore ? "ceiling" : "machine";
}

/** The line `job run` says after a job was killed for memory. */
export function killedForMemoryLine(killer: OomKiller, slice: string, code: number): string {
  switch (killer) {
    case "ceiling":
      return `killed for memory: the heavy jobs running here together went over ${slice}'s ceiling, and the kernel stopped the largest. Run it again when fewer heavy jobs run (exit code ${String(code)}).`;
    case "machine":
      return `killed for memory: the whole machine ran out of memory, and the kernel's OOM killer stopped this job first (its kill mark). Run it again when more memory is free (exit code ${String(code)}).`;
    case "unknown":
      return `killed for memory (the slice's ceiling or the machine's OOM killer). Run it again when fewer heavy jobs run (exit code ${String(code)}).`;
  }
}

/** The slice's ceiling as `MemoryMax=` takes it: the machine's memory ceiling for heavy jobs. */
export function sliceMemoryMax(ceilingGb: number): string {
  return `${String(Math.floor(ceilingGb))}G`;
}

/**
 * The slice's ceiling, and no swap for it: at `MemoryMax` the kernel first swaps a group
 * out and kills only when it cannot. With swap, heavy jobs over the ceiling would crawl
 * through the swap instead of dying, and leave none for the desktop.
 */
export function ceilingArgv(slice: string, memoryMax: string): [string, ...string[]] {
  return setPropertyArgv(slice, `MemoryMax=${memoryMax}`, "MemorySwapMax=0");
}

/** The one form every runtime slice property takes, for the ceiling and the weights. */
function setPropertyArgv(slice: string, ...properties: string[]): [string, ...string[]] {
  return ["systemctl", "--user", "set-property", "--runtime", slice, ...properties];
}

/**
 * The weights one slice carries. A weight that is absent is left at systemd's default
 * (100): a controller this machine's user manager was not given cannot carry one.
 */
export interface SliceWeights {
  cpu?: number;
  io?: number;
}

/**
 * `systemctl --user set-property --runtime <slice> CPUWeight=… IOWeight=…`, or null when
 * there is no weight to set. The same call and the same moment as the ceiling
 * (`ceilingArgv`), and weights, never quotas: an idle machine still gives a job every core.
 */
export function weightsArgv(slice: string, weights: SliceWeights): [string, ...string[]] | null {
  const properties = [
    ...(weights.cpu === undefined ? [] : [`CPUWeight=${String(weights.cpu)}`]),
    ...(weights.io === undefined ? [] : [`IOWeight=${String(weights.io)}`]),
  ];
  return properties.length === 0 ? null : setPropertyArgv(slice, ...properties);
}

const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Where `job run`'s signals arrive: `process`, or an emitter in the tests. */
export interface SignalSource {
  on: (signal: NodeJS.Signals, listener: () => void) => unknown;
  off: (signal: NodeJS.Signals, listener: () => void) => unknown;
}

/** A job's systemd scope: signalled, and waited for, with the job's process group. */
export interface ScopeHandle {
  /** `systemctl --user kill --signal=<signal> <unit>`: every process in the scope. */
  kill: (signal: NodeJS.Signals) => void;
  /** True when no process is left in the scope (or it is gone). */
  isEmpty: () => boolean;
}

export interface SpawnOptions {
  /** The job's scope (a scope launch), or null. */
  scope?: ScopeHandle | null;
  /** How long leftovers get to end by themselves after the job's first process ended. */
  leftoverGraceMs?: number;
  /** How long after SIGTERM before SIGKILL, and after SIGKILL before giving up. */
  killWaitMs?: number;
  /** How often to look whether the group is empty. */
  pollMs?: number;
  /** How this system stops the job's processes: the default is this process's platform. */
  platform?: NodeJS.Platform;
  /** Windows: one PowerShell call for a start time, and `taskkill`. Default: the real ones. */
  windows?: WindowsFacts;
}

const LEFTOVER_GRACE_MS = 2_000;
const KILL_WAIT_MS = 5_000;
const GROUP_POLL_MS = 50;

/** Signals every process in group `pgid`. A group that is gone is nothing to signal. */
function signalGroup(pgid: number, signal: NodeJS.Signals | 0): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // ESRCH: the group is empty. EPERM: a member we may not signal (a setuid program);
    // the scope's kill, or the bounded wait, deals with it.
  }
}

/** True when group `pgid` has no process left. */
function groupIsEmpty(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Starts `argv` with this process's stdin, stdout, stderr and environment, in a process
 * group of its own. SIGINT, SIGTERM and SIGHUP are sent on to the whole group (and the
 * scope); on Windows the job's tree is ended with `taskkill` instead, and only the job's
 * first process is watched. It resolves with how the job ended (`JobEnd`): the exit code
 * of the first process (a signal death: 128 + n; a command that cannot start: 127, as a
 * shell says), the signal when one ended it, and this wrapper's own stop when it made one
 * — and only once the group and the scope are empty: leftovers are stopped (THE JOB'S OWN
 * PROCESS GROUP above).
 */
export function spawnAndWait(
  argv: readonly [string, ...string[]],
  signals: SignalSource = process,
  say: (line: string) => void = () => undefined,
  options: SpawnOptions = {},
): Promise<JobEnd> {
  const [program, ...args] = argv;
  const scope = options.scope ?? null;
  const pollMs = options.pollMs ?? GROUP_POLL_MS;
  // Windows has no signals and no process groups to signal (`windows.ts`).
  const windows = (options.platform ?? process.platform) === "win32";
  const windowsFacts = options.windows ?? realWindowsFacts;
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "inherit", detached: true });
    const pgid = child.pid;
    /** The signals this wrapper sent on while the job still ran: its own stops. */
    const sentSignals = new Set<NodeJS.Signals>();
    const sendAll = (signal: NodeJS.Signals) => {
      if (pgid !== undefined) {
        if (windows) endJobTree(pgid, windowsFacts);
        else signalGroup(pgid, signal);
      }
      scope?.kill(signal);
    };
    const isEmpty = () =>
      (pgid === undefined || (windows ? processIsGone(pgid) : groupIsEmpty(pgid))) &&
      (scope?.isEmpty() ?? true);
    /** Waits up to `ms` for the group and the scope to empty; true when they did. */
    const emptyWithin = async (ms: number): Promise<boolean> => {
      const end = Date.now() + ms;
      for (;;) {
        if (isEmpty()) return true;
        if (Date.now() >= end) return false;
        await Bun.sleep(pollMs);
      }
    };
    let finished = false;
    const listeners = FORWARDED.map(
      (signal) =>
        [
          signal,
          () => {
            // The job was still running: this stop is the wrapper's own. A signal that
            // arrives while the leftovers end is not — the job itself is over already.
            if (!finished) sentSignals.add(signal);
            sendAll(signal);
          },
        ] as const,
    );
    for (const [signal, listener] of listeners) signals.on(signal, listener);
    const done = async (end: JobEnd) => {
      if (finished) return;
      finished = true;
      let leftovers = false;
      // Signals still go on while the leftovers end.
      if (!(await emptyWithin(options.leftoverGraceMs ?? LEFTOVER_GRACE_MS))) {
        const killWaitMs = options.killWaitMs ?? KILL_WAIT_MS;
        leftovers = true;
        say("the job left processes running: stopping them, so its memory is free");
        sendAll("SIGTERM");
        if (!(await emptyWithin(killWaitMs))) {
          sendAll("SIGKILL");
          if (!(await emptyWithin(killWaitMs))) {
            say("some of the job's processes still run: its memory is given back anyway");
          }
        }
      }
      for (const [signal, listener] of listeners) signals.off(signal, listener);
      // A signal the wrapper sent on counts as its own stop only when the job died of that
      // same one: a job that shrugged it off and ended by itself ended by itself. The
      // leftover stop is a fact of its own, true even then.
      const sentOn = end.signal !== null && sentSignals.has(end.signal);
      resolve({ ...end, sentOn, leftovers });
    };
    child.once("error", (error: NodeJS.ErrnoException) => {
      say(`could not start ${program}: ${error.code ?? error.message}`);
      void done({ code: 127, leftovers: false, sentOn: false, signal: null });
    });
    child.once("exit", (code, signal) => {
      void done({ code: exitCodeOf(code, signal), leftovers: false, sentOn: false, signal });
    });
  });
}

/** What the runner needs from systemd and the file system: replaced in the tests. */
export interface SliceControl {
  /** `ceilingArgv`: the slice's `MemoryMax`, and `MemorySwapMax=0`; true on success. */
  setMemoryMax: (slice: string, value: string) => boolean;
  /** `weightsArgv`: one slice's CPU and I/O weights; true on success, and for none. */
  setWeights: (slice: string, weights: SliceWeights) => boolean;
  /**
   * The controllers this machine's user manager was given (`userManagerControllers`), or
   * null when it cannot be read: no user manager, or not Linux.
   */
  controllers: () => string[] | null;
  /** The slice's cgroup path under `/sys/fs/cgroup`, or null. */
  controlGroup: (slice: string) => string | null;
  readFile: (path: string) => string | null;
}

function exitsZero(argv: readonly [string, ...string[]], timeoutMs: number): boolean {
  const [program, ...args] = argv;
  return spawnSync(program, args, { stdio: "ignore", timeout: timeoutMs }).status === 0;
}

/** Whether `program` can be started here, found the way spawning it would find it. */
function canRun(program: string, timeoutMs: number): boolean {
  return (
    spawnSync(program, ["--version"], { stdio: "ignore", timeout: timeoutMs }).error === undefined
  );
}

export function realLaunchFacts(slice: string, timeoutMs = SYSTEMD_TIMEOUT_MS): LaunchFacts {
  const uid = process.getuid?.();
  const linux = process.platform === "linux";
  return {
    platform: process.platform,
    hasUserRuntimeDir: uid !== undefined && existsSync(`/run/user/${String(uid)}`),
    hasSystemdRun: linux && canRun("systemd-run", timeoutMs),
    hasChoom: linux && canRun("choom", timeoutMs),
    probeScope: (withOomPolicy) => exitsZero(probeArgv(slice, withOomPolicy), timeoutMs),
  };
}

export function realSliceControl(read: ReadText, timeoutMs = SYSTEMD_TIMEOUT_MS): SliceControl {
  return {
    setMemoryMax: (slice, value) => exitsZero(ceilingArgv(slice, value), timeoutMs),
    setWeights: (slice, weights) => {
      const argv = weightsArgv(slice, weights);
      return argv === null || exitsZero(argv, timeoutMs);
    },
    controllers: () => {
      const uid = process.getuid?.();
      return uid === undefined ? null : userManagerControllers(read, uid);
    },
    controlGroup: (slice) => {
      const uid = process.getuid?.();
      return uid === undefined ? null : userSliceCgroup(uid, slice);
    },
    readFile: read,
  };
}

/** `systemctl --user kill`: a signal to every process of a unit. */
export function scopeKillArgv(unit: string, signal: NodeJS.Signals): [string, ...string[]] {
  return ["systemctl", "--user", "kill", `--signal=${signal}`, unit];
}

/**
 * The real scope of unit `unit` in `slice`: killed through systemd, and empty when its
 * cgroup's `cgroup.events` says `populated 0` (or the cgroup is gone: `--collect` removes
 * an empty scope). A scope sits in its slice's folder; only slices nest by their dashes.
 */
export function realScope(
  slice: string,
  unit: string,
  read: ReadText,
  timeoutMs = SYSTEMD_TIMEOUT_MS,
): ScopeHandle | null {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const events = `/sys/fs/cgroup${userSliceCgroup(uid, slice)}/${unit}/cgroup.events`;
  return {
    kill: (signal) => {
      const [program, ...args] = scopeKillArgv(unit, signal);
      spawnSync(program, args, { stdio: "ignore", timeout: timeoutMs });
    },
    isEmpty: () => {
      const text = read(events);
      return text === null || /^populated 0$/m.test(text);
    },
  };
}
