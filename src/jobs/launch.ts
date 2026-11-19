/** Launch a plain child and forward its signals and exit code. */
import { spawn } from "node:child_process";
import { constants } from "node:os";
import type { ScopeHandle } from "./limits";
import { endJobTree, processIsGone, realWindowsFacts, type WindowsFacts } from "./windows";

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
   * process may have sent it: the kernel's OOM killer sends SIGKILL.
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

export interface SignalSource {
  on: (signal: NodeJS.Signals, listener: () => void) => unknown;
  off: (signal: NodeJS.Signals, listener: () => void) => unknown;
}

export interface SpawnOptions {
  /**
   * The job's systemd scope (`limits.ts`), or null. A signal goes to the process group and also
   * through the scope, which reaches a worker that left the group; the job is over only once the
   * scope is empty too.
   */
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

const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

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
    /**
     * Forwards one signal the wrapper caught: to the job's process group only. Not through the
     * scope as well: the scope holds every process of the group, and a nested `job run` sits in
     * it with a group of its own that its own wrapper forwards to, so a scope kill would deliver
     * the signal twice to a nested job, and a tool that reads a second Ctrl+C as "force quit"
     * would quit.
     */
    const forward = (signal: NodeJS.Signals) => {
      if (pgid === undefined) return;
      if (windows) endJobTree(pgid, windowsFacts);
      else signalGroup(pgid, signal);
    };
    /** The leftover stop: the group and the scope both, so a worker that left the group is reached. */
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
            forward(signal);
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
