/**
 * The CPU and memory limits of the heavy jobs, so one job never hangs the machine.
 *
 * WHY
 *   A type check or a test run can use every core and all the memory, and push the machine
 *   into swap until it stops answering. A cap alone does not stop that: a job that cannot swap
 *   makes the kernel swap out the desktop instead. So the caps bound the jobs, and the
 *   watchdog and the kill mark are what stop the hang (`.claude/plans/2026-11-20-job-limits.md`).
 *
 * WHAT A QUEUED JOB GETS (Linux with a systemd user manager)
 *   Every queued job runs in its own scope inside ONE slice, `<COMMAND>-jobs.slice` (a dash
 *   nests it: it sits inside `<COMMAND>.slice`, and so on), so the limits hold for all heavy
 *   jobs together, even with `job set max 3`. Before each launch the slice gets, with
 *   `systemctl --user set-property --runtime` (gone at reboot, no file in the home changes):
 *   - `CPUQuota` (the percent times the machine's CPUs; empty at 100) and `CPUWeight=20`: the
 *     jobs yield to the person's apps, and never starve behind steady background work.
 *   - `MemoryMax=<n>%`, `MemorySwapMax=0`, and `MemoryHigh=infinity` written on purpose: a
 *     `MemoryHigh` below `MemoryMax` made a job hang for good with no swap.
 *   - `ManagedOOMMemoryPressure=kill` at 40%: systemd-oomd stops a job that stalls on memory.
 *     Its duration goes in a call of its own: systemd older than 257 refuses it, and the
 *     default duration stays.
 *   A runtime property outlives a job, so every launch writes every property it owns.
 *   The scope has `OOMPolicy=kill` (the whole job ends when one process is OOM-killed), and
 *   `choom -n 900` marks the job as the kernel's first pick when the machine runs out.
 *
 * WHEN THEY CANNOT APPLY, THE JOB STILL RUNS
 *   The checks come in a fixed order: Linux, the settings, the user manager's delegated `cpu`
 *   and `memory` controllers, `systemd-run`, the probe, then `set-property`. The first that
 *   fails names the reason. A broken kit never blocks a build, a test or a commit.
 *
 * PROBE FIRST, NEVER RETRY
 *   `systemd-run` exits 1 when it cannot make a scope, the same code as a type check that found
 *   errors. So an empty scope is tried first (`-- true`, about 30 ms), and only then the job.
 *   Once the job started, its exit code is the answer: it is never started a second time.
 *
 * THE JOB'S WORDS REACH IT AS WRITTEN
 *   `systemd-run --scope` reads the command with systemd's rules: `$HOME`, `${HOME}` and `$$`
 *   are changed. Every `$` of the job's own words is doubled (`systemdWord`), proved live.
 *
 * Every systemd call has one timeout (`SYSTEMD_TIMEOUT_MS`): a hung user bus must never hang a
 * job or a commit hook. Every fact comes in through `LimitFacts`, so a test never touches the
 * host's systemd.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { COMMAND } from "../build-info/names";
import {
  LIMIT_PERCENT_MAX,
  LIMIT_PERCENT_MIN,
  type LimitKey,
  type LimitRead,
  type LimitSettings,
} from "./config";

/** How long one systemd call may take. A call takes about 30 ms; a hung user bus must not hang a job. */
export const SYSTEMD_TIMEOUT_MS = 10_000;

/** The kill mark a heavy job carries: the kernel picks it before anything at 0 to 200. */
export const HEAVY_OOM_SCORE_ADJ = 900;

/** The CPU weight of the jobs' slice (systemd's default is 100): they yield, never starve. */
export const HEAVY_CPU_WEIGHT = 20;

/** The watchdog: systemd-oomd stops a job when the slice stalls on memory this much, this long. */
export const WATCHDOG_PRESSURE_PERCENT = 40;
export const WATCHDOG_DURATION = "10s";

/** The one slice of all heavy jobs. Built from the command's name: a dash nests it. */
export const JOBS_SLICE = `${COMMAND}-jobs.slice`;

/** Reads one file as text, or null when it is not there or cannot be read. */
export type ReadText = (path: string) => string | null;

/** How one systemd call ended: exit 0, any other end, or no answer within the timeout. */
export type SystemdResult = "ok" | "failed" | "timeout";

/** What the limits need from this machine: replaced in every test, never the host's systemd. */
export interface LimitFacts {
  platform: NodeJS.Platform;
  /** This user's id, or null where there is none (Windows). */
  uid: number | null;
  read: ReadText;
  /** How many CPUs the machine has: `os.cpus().length`, never `availableParallelism()`. */
  cpuCount: () => number;
  /** Is the program on the PATH? Nothing is started. */
  hasProgram: (name: string) => boolean;
  /** Does a `systemd-oomd` process run? Reads files only: `doctor` and the portal call it. */
  oomdRunning: () => boolean;
  /**
   * One call to systemd, with `SYSTEMD_TIMEOUT_MS`. Only a job's start calls it: never
   * `doctor`, never the status the portal polls.
   */
  systemd: (argv: readonly string[]) => SystemdResult;
}

const realReadText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null; // not there, or not ours to read
  }
};

/** Runs one systemd call; `spawn` is replaced in the tests that prove the timeout. */
export function runSystemd(
  argv: readonly string[],
  spawn: typeof spawnSync = spawnSync,
): SystemdResult {
  const [program, ...args] = argv;
  if (program === undefined) return "failed";
  const result = spawn(program, args, { stdio: "ignore", timeout: SYSTEMD_TIMEOUT_MS });
  // Bun, like Node, ends a timed-out child with SIGTERM and an `ETIMEDOUT` error.
  const failure: NodeJS.ErrnoException | undefined = result.error;
  if (failure?.code === "ETIMEDOUT") return "timeout";
  return result.status === 0 ? "ok" : "failed";
}

/** True when a `systemd-oomd` process runs (any pid's `comm`); files only. */
function oomdProcessRuns(): boolean {
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return false;
  }
  return pids.some((pid) => realReadText(`/proc/${pid}/comm`)?.trim() === "systemd-oomd");
}

/**
 * Tests only: a platform name in this variable makes the real facts say they run there, so a test
 * that runs the CLI as its own process never reads the machine's cgroups or PATH. `darwin` is
 * the quiet answer: the caps are not applied and nothing else is read. The same pattern as
 * `CC_SMART_DEV_KIT_TEST_HOST` (`src/machine/host.ts`); unset, the real values are used.
 */
export const TEST_LIMITS_VAR = "CC_SMART_DEV_KIT_TEST_LIMITS";

export function realLimitFacts(env: Record<string, string | undefined> = process.env): LimitFacts {
  return {
    platform: (env[TEST_LIMITS_VAR] as NodeJS.Platform | undefined) ?? process.platform,
    uid: process.getuid?.() ?? null,
    read: realReadText,
    cpuCount: () => cpus().length,
    hasProgram: (name) => Bun.which(name) !== null,
    oomdRunning: oomdProcessRuns,
    systemd: (argv) => runSystemd(argv),
  };
}

// ---------------------------------------------------------------------------------------
// Where a slice lives: systemd reads every dash in a slice name as nesting.
// ---------------------------------------------------------------------------------------

/**
 * The slices a slice nests in, outermost first: `a-b-jobs.slice` sits inside `a-b.slice`,
 * which sits inside `a.slice`.
 */
export function sliceChain(slice: string): string[] {
  const parts = slice.replace(/\.slice$/, "").split("-");
  return parts.map((_, i) => `${parts.slice(0, i + 1).join("-")}.slice`);
}

/** The cgroup of user `uid`'s systemd manager, under `/sys/fs/cgroup`. */
export function userManagerCgroup(uid: number): string {
  return `/user.slice/user-${String(uid)}.slice/user@${String(uid)}.service`;
}

/** The cgroup path (under `/sys/fs/cgroup`) of a slice of user `uid`'s systemd manager. */
export function userSliceCgroup(uid: number, slice: string): string {
  return `${userManagerCgroup(uid)}/${sliceChain(slice).join("/")}`;
}

/**
 * The controllers this user manager was given (`cgroup.controllers`), or null when that file
 * cannot be read: no user manager there, cgroup v1, or a container without the file. A
 * controller that is missing cannot carry a limit: systemd records the property and writes
 * nothing to the cgroup.
 */
function userManagerControllers(read: ReadText, uid: number): string[] | null {
  const text = read(`/sys/fs/cgroup${userManagerCgroup(uid)}/cgroup.controllers`);
  return text === null ? null : text.split(/\s+/).filter((name) => name !== "");
}

/** How many CPUs a `cpuset.cpus.effective` list names: `0-3,8` is five. Null when unreadable. */
export function cpuListCount(list: string): number | null {
  let count = 0;
  for (const part of list.trim().split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (match === null) return null;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (last < first) return null;
    count += last - first + 1;
  }
  return count;
}

/**
 * The CPUs a quota is relative to: the user manager's `cpuset.cpus.effective`, or the nearest
 * cgroup above it that has one, or else the machine's CPU count. Never
 * `availableParallelism()`: a `job run` started under `taskset` must not shrink every job's
 * quota.
 */
export function machineCpus(facts: LimitFacts): number {
  if (facts.uid !== null) {
    const parts = userManagerCgroup(facts.uid)
      .split("/")
      .filter((part) => part !== "");
    for (let depth = parts.length; depth >= 0; depth--) {
      const dir = `/sys/fs/cgroup/${parts.slice(0, depth).join("/")}`;
      const text = facts.read(`${dir}/cpuset.cpus.effective`);
      const count = text === null ? null : cpuListCount(text);
      if (count !== null && count > 0) return count;
    }
  }
  return facts.cpuCount();
}

/** One field of `/proc/meminfo`, in bytes, or null when it is not there. */
function meminfoBytes(meminfo: string | null, field: string): number | null {
  if (meminfo === null) return null;
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB\\s*$`, "m").exec(meminfo);
  return match?.[1] === undefined ? null : Number(match[1]) * 1024;
}

const GIB = 1024 ** 3;

// ---------------------------------------------------------------------------------------
// The slice's properties and the scope's switches, as argv.
// ---------------------------------------------------------------------------------------

/** `CPUQuota` as systemd reads it: relative to one CPU, empty (unset) at 100%. */
export function cpuQuota(cpuPercent: number, cpus: number): string {
  return cpuPercent >= LIMIT_PERCENT_MAX ? "" : `${String(cpuPercent * cpus)}%`;
}

function setPropertyArgv(slice: string, ...properties: string[]): string[] {
  return ["systemctl", "--user", "set-property", "--runtime", slice, ...properties];
}

/**
 * The two `set-property` calls of one launch: every property the jobs' slice owns, written in
 * full (a runtime property outlives a job, so a cap that is off still writes its reset value),
 * and the watchdog's duration alone: it needs systemd 257, and on an older one only that call
 * fails.
 */
export function slicePropertyArgvs(
  slice: string,
  settings: LimitSettings,
  cpus: number,
): { main: string[]; duration: string[] } {
  return {
    main: setPropertyArgv(
      slice,
      `CPUQuota=${cpuQuota(settings.cpuPercent, cpus)}`,
      `CPUWeight=${String(HEAVY_CPU_WEIGHT)}`,
      `MemoryMax=${String(settings.memoryPercent)}%`,
      "MemorySwapMax=0",
      "MemoryHigh=infinity",
      "ManagedOOMMemoryPressure=kill",
      `ManagedOOMMemoryPressureLimit=${String(WATCHDOG_PRESSURE_PERCENT)}%`,
    ),
    duration: setPropertyArgv(slice, `ManagedOOMMemoryPressureDurationSec=${WATCHDOG_DURATION}`),
  };
}

/**
 * A word of the job's command, as `systemd-run` must be given it for the job to get it as
 * written. `systemd-run --scope` reads the command line with systemd's own rules (proved live):
 * `$HOME` and `${HOME}` become the variable's value (or nothing), and `$$` becomes `$`. So a
 * `bun -e` script with a template literal, or a `$$` in a shell string, would reach the job
 * changed. `$$` is systemd's escape for one `$`: every `$` is doubled.
 */
export function systemdWord(word: string): string {
  return word.replaceAll("$", "$$$$");
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

export function probeArgv(slice: string, oomPolicy: boolean): string[] {
  return ["systemd-run", ...scopeSwitches(slice, oomPolicy), "--", "true"];
}

/**
 * A unit name says what runs and which `job run` started it. The start time (base 36) makes it
 * unique: a `job run` killed with SIGKILL leaves its scope running, and a new one with the
 * same pid would otherwise fail with "unit exists" (exit 1, read as a failure).
 */
export function unitName(slice: string, kind: string, pid: number, startedAt: number): string {
  const prefix = slice.replace(/\.slice$/, "");
  // A job with a name only (`--exclusive`) has no kind.
  const safeKind = kind === "" ? "job" : kind.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${prefix}-${safeKind}-${String(pid)}-${startedAt.toString(36)}.scope`;
}

// ---------------------------------------------------------------------------------------
// The scope of a running job: signalled and waited for, with the job's process group.
// ---------------------------------------------------------------------------------------

/** A job's systemd scope: signalled, and waited for, with the job's process group. */
export interface ScopeHandle {
  /** `systemctl --user kill --signal=<signal> <unit>`: every process in the scope, at once. */
  kill: (signal: NodeJS.Signals) => void;
  /** True when no process is left in the scope (or it is gone). */
  isEmpty: () => boolean;
}

/** `systemctl --user kill`: a signal to every process of a unit. Never `stop`: it waits 90 s. */
export function scopeKillArgv(unit: string, signal: NodeJS.Signals): string[] {
  return ["systemctl", "--user", "kill", `--signal=${signal}`, unit];
}

/**
 * The scope `unit` of a slice: killed through systemd, and empty when its cgroup's
 * `cgroup.events` says `populated 0` (or the cgroup is gone: `--collect` removes an empty
 * scope). A scope sits in its slice's folder; only slices nest by their dashes.
 */
export function scopeHandle(
  facts: LimitFacts,
  unit: string,
  slice = JOBS_SLICE,
): ScopeHandle | null {
  if (facts.uid === null) return null;
  const events = `/sys/fs/cgroup${userSliceCgroup(facts.uid, slice)}/${unit}/cgroup.events`;
  return {
    kill: (signal) => {
      facts.systemd(scopeKillArgv(unit, signal));
    },
    isEmpty: () => {
      const text = facts.read(events);
      return text === null || /^populated 0$/m.test(text);
    },
  };
}

// ---------------------------------------------------------------------------------------
// "Killed for memory": which killer stopped the job.
// ---------------------------------------------------------------------------------------

/** One count in a cgroup's `memory.events`, or null when it is not there. */
function memoryEvent(memoryEvents: string | null, key: string): number | null {
  if (memoryEvents === null) return null;
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(memoryEvents);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Who stopped a job for memory, from the slice's `memory.events` before and after:
 * - `cap`: the slice's own `oom` count rose: the jobs reached `MemoryMax`.
 * - `machine`: only `oom_kill` rose: the whole machine ran out, and the kernel picked a job.
 * - `unknown`: `oom_kill` rose, and `oom` cannot be read.
 * It never reads an exit code: a killed worker makes its parent exit 1.
 */
export type OomKiller = "cap" | "machine" | "unknown";

export function oomKiller(before: string | null, after: string | null): OomKiller | null {
  const killsBefore = memoryEvent(before, "oom_kill");
  const killsAfter = memoryEvent(after, "oom_kill");
  if (killsBefore === null || killsAfter === null || killsAfter <= killsBefore) return null;
  const hitsBefore = memoryEvent(before, "oom");
  const hitsAfter = memoryEvent(after, "oom");
  if (hitsBefore === null || hitsAfter === null) return "unknown";
  return hitsAfter > hitsBefore ? "cap" : "machine";
}

/** The slice's `some avg10` memory pressure (percent), or null when it cannot be read. */
function memoryPressure(text: string | null): number | null {
  const match = text === null ? null : /^some avg10=([\d.]+)/m.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** What a memory line needs to know about how the job ended: `JobEnd` fits. */
export interface MemoryEnd {
  code: number;
  signal: NodeJS.Signals | null;
  /** This wrapper sent that signal on itself (a Ctrl+C): not a stop for memory. */
  sentOn: boolean;
}

/** What the lines name: the cap, and whether the heavy jobs share it. */
interface MemoryWords {
  /** The cap in GB, when the machine's memory could be read. */
  capGb: number | null;
  capPercent: number;
  /** `maxConcurrent` is above 1: the cap is shared. */
  shared: boolean;
  /** The job carried the kill mark (`choom`). */
  marked: boolean;
  code: number;
}

const RUN_AGAIN = "Run it again when fewer heavy jobs run";
const SET_MEMORY = `${COMMAND} job set memory <n>`;

/** The line `job run` says after a job was stopped for memory, with the fix. */
export function killedForMemoryLine(killer: OomKiller | "stalled", words: MemoryWords): string {
  const exit = `(exit code ${String(words.code)})`;
  const gb = words.capGb === null ? "" : `${String(words.capGb)} GB, `;
  const cap = `${gb}${String(words.capPercent)}% of this machine's memory`;
  const who = words.shared ? "the heavy jobs together" : "this job";
  switch (killer) {
    case "cap":
      return `killed for memory: ${who} reached the memory cap (${cap}). ${RUN_AGAIN}, or raise the cap with: ${SET_MEMORY} ${exit}`;
    case "machine":
      return `killed for memory: the whole machine ran out of memory, and the kernel's OOM killer stopped this job${words.marked ? " first (its kill mark)" : ""}. ${RUN_AGAIN}, or lower the cap so the jobs leave more for the machine, with: ${SET_MEMORY} ${exit}`;
    case "unknown":
      return `killed for memory (the jobs' cap of ${cap}, or the machine's OOM killer). ${RUN_AGAIN} ${exit}`;
    case "stalled":
      return `stopped for memory: ${who} stalled on memory below the cap (${cap}), and the watchdog (systemd-oomd) stops a stalled job after ${WATCHDOG_DURATION}. ${RUN_AGAIN}, or lower the cap so the jobs leave more for the machine, with: ${SET_MEMORY} ${exit}`;
  }
}

// ---------------------------------------------------------------------------------------
// The checks, in their fixed order, and the start of a limited job.
// ---------------------------------------------------------------------------------------

/**
 * The reason the limits cannot apply on this machine, or null when nothing blocks them. The
 * checks that need no systemd call, in the fixed order: the delegated controllers, then
 * `systemd-run`. `doctor` reads the same answer; it never starts anything.
 */
export function limitsBlocker(facts: LimitFacts): string | null {
  const controllers = facts.uid === null ? null : userManagerControllers(facts.read, facts.uid);
  if (controllers === null) {
    return "no systemd user manager with cgroup v2 here (its controllers file is missing)";
  }
  const missing = ["cpu", "memory"].filter((name) => !controllers.includes(name));
  if (missing.length > 0) {
    return `the systemd user manager has no delegated ${missing.map((name) => `"${name}"`).join(" or ")} controller`;
  }
  if (!facts.hasProgram("systemd-run")) return "systemd-run is not installed";
  return null;
}

/** What `job run` is told about one queued job. */
export interface LimitJob {
  kind: string;
  command: readonly [string, ...string[]];
  pid: number;
  /** When `job run` started (ms): makes the unit name unique. */
  startedAt: number;
}

export type LimitedStart =
  /** `line`: why, in one line, or null where nothing is said (not Linux). */
  | { on: false; line: string | null }
  | {
      on: true;
      /** The command, wrapped to start in its scope. */
      argv: [string, ...string[]];
      scope: ScopeHandle | null;
      /** The line for a job stopped for memory, or null. Never after exit 0. */
      memoryLine: (end: MemoryEnd) => string | null;
    };

/**
 * The fix for a bad key. `job set` never overwrites a value the person wrote by hand (the managed
 * file's rule), so the fix is to correct it in the file, or remove it and let `job set` write it.
 */
export function limitKeysFix(keys: readonly LimitKey[]): string {
  const sets = keys.map(
    (key) => `${COMMAND} job set ${key === "cpuPercent" ? "cpu" : "memory"} <n>`,
  );
  return `correct ${keys.length > 1 ? "them" : "it"} in that file (a whole number from ${String(LIMIT_PERCENT_MIN)} to ${String(LIMIT_PERCENT_MAX)}), or remove ${keys.length > 1 ? "them" : "it"} and run ${sets.join(" and ")}`;
}

const fixFor = (keys: readonly LimitKey[]) =>
  keys.length === 0 ? "" : ` (fix: ${limitKeysFix(keys)})`;

const off = (reason: string, keys: readonly LimitKey[] = []): LimitedStart => ({
  on: false,
  line: `this job runs without CPU and memory limits: ${reason}${fixFor(keys)}`,
});

/**
 * Gets the limits ready for one queued job and returns how to start it. It never throws and
 * never stops the job: when any check fails the job runs as it would have, and on Linux the
 * first failing check names its reason in one line. `slots` is `maxConcurrent`: above 1 the
 * memory cap is the heavy jobs' together, and the memory line says so. `slice` is the jobs'
 * slice: only the opt-in live test names another, a throwaway one.
 */
export function startLimits(
  facts: LimitFacts,
  settings: LimitRead,
  job: LimitJob,
  slots: number,
  slice = JOBS_SLICE,
): LimitedStart {
  try {
    return start(facts, settings, job, slots, slice);
  } catch (error) {
    return off(error instanceof Error ? error.message : String(error));
  }
}

function start(
  facts: LimitFacts,
  settings: LimitRead,
  job: LimitJob,
  slots: number,
  slice: string,
): LimitedStart {
  if (facts.platform !== "linux") return { on: false, line: null };
  if (!settings.ok) return off(settings.message, settings.keys);
  const blocker = limitsBlocker(facts);
  if (blocker !== null) return off(blocker);
  // `limitsBlocker` proved a user id.
  const uid = facts.uid as number;

  const withPolicy = facts.systemd(probeArgv(slice, true));
  let oomPolicy = true;
  if (withPolicy !== "ok") {
    // A timeout means no answer at all: a second probe would wait as long again.
    const withoutPolicy =
      withPolicy === "timeout" ? withPolicy : facts.systemd(probeArgv(slice, false));
    if (withoutPolicy !== "ok") {
      return off(
        withoutPolicy === "timeout"
          ? `systemd did not answer within ${String(SYSTEMD_TIMEOUT_MS / 1000)} s`
          : "systemd could not start a scope here (no user session bus?)",
      );
    }
    oomPolicy = false;
  }

  const { main, duration } = slicePropertyArgvs(slice, settings.settings, machineCpus(facts));
  const written = facts.systemd(main);
  if (written !== "ok") {
    return off(
      written === "timeout"
        ? `systemd did not answer within ${String(SYSTEMD_TIMEOUT_MS / 1000)} s`
        : `systemd refused to set the limits on ${slice}`,
    );
  }
  // Only this call fails on a systemd older than 257: the default duration stays.
  facts.systemd(duration);

  const marked = facts.hasProgram("choom");
  const unit = unitName(slice, job.kind, job.pid, job.startedAt);
  const sliceDir = `/sys/fs/cgroup${userSliceCgroup(uid, slice)}`;
  const eventsBefore = facts.read(`${sliceDir}/memory.events`);
  return {
    on: true,
    argv: [
      "systemd-run",
      ...scopeSwitches(slice, oomPolicy),
      `--unit=${unit}`,
      "--",
      ...(marked ? ["choom", "-n", String(HEAVY_OOM_SCORE_ADJ), "--"] : []),
      ...job.command.map(systemdWord),
    ] as [string, ...string[]],
    scope: scopeHandle(facts, unit, slice),
    memoryLine: (end) => {
      if (end.code === 0) return null;
      const eventsAfter = facts.read(`${sliceDir}/memory.events`);
      const killer: OomKiller | "stalled" | null =
        oomKiller(eventsBefore, eventsAfter) ??
        // An oomd kill leaves no event: the job was ended by a SIGKILL that was not this
        // wrapper's own, while the jobs' slice stood above the watchdog's pressure.
        (end.signal === "SIGKILL" &&
        !end.sentOn &&
        (memoryPressure(facts.read(`${sliceDir}/memory.pressure`)) ?? 0) >=
          WATCHDOG_PRESSURE_PERCENT
          ? "stalled"
          : null);
      if (killer === null) return null;
      const total = meminfoBytes(facts.read("/proc/meminfo"), "MemTotal");
      const percent = settings.settings.memoryPercent;
      return killedForMemoryLine(killer, {
        capGb: total === null ? null : Math.round(((total * percent) / 100 / GIB) * 10) / 10,
        capPercent: percent,
        shared: slots > 1,
        marked,
        code: end.code,
      });
    },
  };
}

/**
 * What the jobs' slice carries right now, read from its cgroup files and compared with what a
 * launch writes (`doctor` never claims a limit it has not read):
 * - `absent`: no job ran since boot, so the slice has no cgroup yet.
 * - `applied`: `cpu.max` and `memory.max` match the settings.
 * - `different`: they do not (a reverted slice, or settings changed with no job since).
 */
export type LiveSlice =
  | { state: "absent" }
  | { state: "applied" }
  | { state: "different"; cpuMax: string; memoryMax: string };

/** `memory.max` may differ from the percent of `MemTotal` by this share: page rounding. */
const MEMORY_MATCH = 0.01;

export function liveSlice(
  facts: LimitFacts,
  settings: LimitSettings,
  slice = JOBS_SLICE,
): LiveSlice {
  if (facts.uid === null) return { state: "absent" };
  const dir = `/sys/fs/cgroup${userSliceCgroup(facts.uid, slice)}`;
  const cpuMax = facts.read(`${dir}/cpu.max`)?.trim() ?? null;
  const memoryMax = facts.read(`${dir}/memory.max`)?.trim() ?? null;
  if (cpuMax === null || memoryMax === null) return { state: "absent" };
  const wantCpu =
    settings.cpuPercent >= LIMIT_PERCENT_MAX
      ? "max 100000"
      : `${String(settings.cpuPercent * machineCpus(facts) * 1000)} 100000`;
  const total = meminfoBytes(facts.read("/proc/meminfo"), "MemTotal");
  const wantBytes = total === null ? null : (total * settings.memoryPercent) / 100;
  const memoryOk =
    wantBytes !== null && Math.abs(Number(memoryMax) - wantBytes) <= wantBytes * MEMORY_MATCH;
  return cpuMax === wantCpu && memoryOk
    ? { state: "applied" }
    : { state: "different", cpuMax, memoryMax };
}
