/**
 * How a heavy job starts once the queue has given it its gigabytes, and what `job run`
 * says when it ends.
 *
 * WHY
 *   The queue makes a burst of heavy jobs rare. This file makes sure that if memory still
 *   runs out, a heavy job dies, not the desktop and not a Claude session: a heavy job is
 *   the one thing that can simply run again. (systemd starts desktop services with a
 *   higher "kill me first" score than ordinary commands, so without a mark a small
 *   desktop helper outranks a 9 GB build.)
 *
 * THE THREE WAYS TO START A JOB (`chooseLaunch`), with `launch: auto` (the default)
 *   scope  Linux with a systemd user manager: `systemd-run --user --scope` puts the job in
 *          its own memory group inside a slice (`anymodel-heavy.slice`). The slice has a
 *          ceiling (`MemoryMax`, set before each launch): all heavy jobs together can
 *          never take the memory kept for everything else, and past it the kernel kills
 *          inside the slice only. `OOMPolicy=kill` ends the whole job when one of its
 *          processes is killed. Inside, `choom -n 900` marks the job to die first if the
 *          whole machine runs out.
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
 *   read before and after, says it for sure.
 *
 * SIGNALS
 *   A terminal's Ctrl+C reaches the whole foreground process group, the job as well, so
 *   SIGINT is NOT sent on (a test runner reads a second one as "force quit"); `job run`
 *   keeps waiting for the job. SIGTERM and SIGHUP are sent on.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { userSliceCgroup } from "./memory";

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
 * systemd that refuses it on a scope gets a scope without it), else choom, else plain.
 */
export function chooseLaunch(facts: LaunchFacts): Launch {
  if (facts.platform !== "linux") return { mode: "plain" };
  if (!facts.hasChoom) {
    return { mode: "plain", note: "no `choom` here: the job runs without its kill mark" };
  }
  if (!facts.hasSystemdRun) {
    return {
      mode: "choom",
      note: "no `systemd-run` here: the job runs with its kill mark only, no memory group",
    };
  }
  if (!facts.hasUserRuntimeDir) {
    return {
      mode: "choom",
      note: "no systemd user manager here: the job runs with its kill mark only, no memory group",
    };
  }
  if (facts.probeScope(true)) return { mode: "scope", oomPolicy: true };
  if (facts.probeScope(false)) return { mode: "scope", oomPolicy: false };
  return {
    mode: "choom",
    note: "systemd could not start a scope here (no user session bus?): the job runs with its kill mark only, no memory group",
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
  const safeKind = kind.replace(/[^A-Za-z0-9_-]/g, "-");
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

/** The `oom_kill` count in a cgroup's `memory.events`, or null when it is not there. */
export function oomKills(memoryEvents: string | null): number | null {
  if (memoryEvents === null) return null;
  const match = /^oom_kill (\d+)$/m.exec(memoryEvents);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The slice's ceiling: the machine's heavy-job budget, never below this job's size. */
export function sliceMemoryMax(budgetGb: number, jobGb: number): string {
  return `${String(Math.max(Math.floor(budgetGb), Math.ceil(jobGb)))}G`;
}

/**
 * The slice's ceiling, and no swap for it: at `MemoryMax` the kernel first swaps a group
 * out and kills only when it cannot. With swap, heavy jobs over the ceiling would crawl
 * through the swap instead of dying, and leave none for the desktop.
 */
export function ceilingArgv(slice: string, memoryMax: string): [string, ...string[]] {
  return [
    "systemctl",
    "--user",
    "set-property",
    "--runtime",
    slice,
    `MemoryMax=${memoryMax}`,
    "MemorySwapMax=0",
  ];
}

const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

/** Where `job run`'s signals arrive: `process`, or an emitter in the tests. */
export interface SignalSource {
  on: (signal: NodeJS.Signals, listener: () => void) => unknown;
  off: (signal: NodeJS.Signals, listener: () => void) => unknown;
}

/**
 * Starts `argv` with this process's stdin, stdout, stderr and environment, sends SIGTERM
 * and SIGHUP on to it, keeps waiting through SIGINT, and resolves with its exit code (a
 * signal death: 128 + n; a command that cannot start: 127, as a shell says).
 */
export function spawnAndWait(
  argv: readonly [string, ...string[]],
  signals: SignalSource = process,
  say: (line: string) => void = () => undefined,
): Promise<number> {
  const [program, ...args] = argv;
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "inherit" });
    // The terminal already sent SIGINT to the job; listening keeps this process alive.
    const keepWaiting = () => undefined;
    const listeners = FORWARDED.map(
      (signal) =>
        [
          signal,
          () => {
            child.kill(signal);
          },
        ] as const,
    );
    for (const [signal, listener] of listeners) signals.on(signal, listener);
    signals.on("SIGINT", keepWaiting);
    let finished = false;
    const done = (code: number) => {
      if (finished) return;
      finished = true;
      for (const [signal, listener] of listeners) signals.off(signal, listener);
      signals.off("SIGINT", keepWaiting);
      resolve(code);
    };
    child.once("error", (error: NodeJS.ErrnoException) => {
      say(`could not start ${program}: ${error.code ?? error.message}`);
      done(127);
    });
    child.once("exit", (code, signal) => {
      done(exitCodeOf(code, signal));
    });
  });
}

/** What the runner needs from systemd and the file system: replaced in the tests. */
export interface SliceControl {
  /** `ceilingArgv`: the slice's `MemoryMax`, and `MemorySwapMax=0`; true on success. */
  setMemoryMax: (slice: string, value: string) => boolean;
  /** The slice's cgroup path under `/sys/fs/cgroup`, or null. */
  controlGroup: (slice: string) => string | null;
  readFile: (path: string) => string | null;
}

function exitsZero(argv: readonly [string, ...string[]]): boolean {
  const [program, ...args] = argv;
  return spawnSync(program, args, { stdio: "ignore" }).status === 0;
}

/** Whether `program` can be started here, found the way spawning it would find it. */
function canRun(program: string): boolean {
  return spawnSync(program, ["--version"], { stdio: "ignore" }).error === undefined;
}

export function realLaunchFacts(slice: string): LaunchFacts {
  const uid = process.getuid?.();
  const linux = process.platform === "linux";
  return {
    platform: process.platform,
    hasUserRuntimeDir: uid !== undefined && existsSync(`/run/user/${String(uid)}`),
    hasSystemdRun: linux && canRun("systemd-run"),
    hasChoom: linux && canRun("choom"),
    probeScope: (withOomPolicy) => exitsZero(probeArgv(slice, withOomPolicy)),
  };
}

export function realSliceControl(read: (path: string) => string | null): SliceControl {
  return {
    setMemoryMax: (slice, value) => exitsZero(ceilingArgv(slice, value)),
    controlGroup: (slice) => {
      const uid = process.getuid?.();
      return uid === undefined ? null : userSliceCgroup(uid, slice);
    },
    readFile: read,
  };
}
