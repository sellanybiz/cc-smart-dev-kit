/**
 * The Windows side of the queue: what Linux and macOS read from `/proc`, from `ps` and
 * from process groups, Windows answers through PowerShell and `taskkill`.
 *
 * WHY
 *   A lease names its holder — a pid, that process's start time, this host, a pid
 *   namespace (`src/setup/lock.ts`) — and `job run` watches the job's processes while it
 *   ends. Windows has no `/proc` and no signals:
 *
 *   - **A process's start time** comes from PowerShell, one call per check:
 *     `(Get-Process -Id <pid>).StartTime.ToFileTimeUtc()` — the kernel's own creation
 *     time. The lease stores it as `win:<ticks>`: the same text for the same process,
 *     another text for another process that took the pid (the pid was reused).
 *   - **Liveness** is `process.kill(pid, 0)`, Node's platform-independent existence test:
 *     it sends nothing, also on Windows, and throws when the process is gone.
 *   - **Stopping a job** is ending its process tree (`taskkill /PID <pid> /T /F`). Windows
 *     has no signals, so every stop there is forceful (Node's own rule for SIGINT,
 *     SIGTERM and SIGKILL), and the tree is where a job's memory lives: its workers too.
 *
 * FAIL SAFE: never run a job on top of memory someone may still hold
 *   A start time that cannot be read (no PowerShell, or a process it may not open) does
 *   NOT mean the holder is gone: the recorded value is handed back, so the holder counts
 *   as alive and a waiting job keeps waiting. A dead pid is still judged dead at once:
 *   `process.kill(pid, 0)` answers that without PowerShell. (A pid reused inside one
 *   Windows clock tick — about 16 ms — could still look like the same process; that
 *   mistake makes a job wait, never run on top.)
 *
 * Everything here takes its facts as an argument (`WindowsFacts`), so the tests inject a
 * fake PowerShell and a fake `taskkill`, and no test starts one.
 */

import { spawnSync } from "node:child_process";
import { currentHolder, processStartTime, type StartTimeReader } from "../setup/lock";

/**
 * How long one PowerShell or `taskkill` call may take. Both answer in a moment on a
 * healthy machine; a call that does not answer must not hang `job status`, a job's wait,
 * or a stop.
 */
const WINDOWS_CALL_TIMEOUT_MS = 10_000;

/** What marks a start time Windows read: `win:<ticks>`. Values of two systems never compare. */
export const WINDOWS_START_PREFIX = "win:";

/** What the queue asks of Windows: the two calls it needs. Replaced in the tests. */
export interface WindowsFacts {
  /** One PowerShell call: its stdout when it exited 0, else null. */
  powershell: (script: string) => string | null;
  /** `taskkill`'s exit code: 0 ended the tree, 128 it was already gone, -1 it did not run. */
  taskkill: (pid: number) => number;
}

/** A command's exit code, or -1 when it cannot be started here (or does not answer). */
function exitCode(argv: readonly [string, ...string[]]): number {
  const [program, ...args] = argv;
  try {
    const run = spawnSync(program, args, {
      stdio: "ignore",
      timeout: WINDOWS_CALL_TIMEOUT_MS,
    });
    return run.status ?? -1;
  } catch {
    return -1; // not on this machine (or not startable): the caller falls back
  }
}

export const realWindowsFacts: WindowsFacts = {
  powershell: (script) => {
    const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: WINDOWS_CALL_TIMEOUT_MS,
    });
    return run.status === 0 ? run.stdout.toString() : null;
  },
  taskkill: (pid) => exitCode(["taskkill", "/PID", String(pid), "/T", "/F"]),
};

/** One PowerShell script: the process's start time in UTC file-time ticks. */
function startTimeScript(pid: number): string {
  return `(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`;
}

/** A Windows process's start time, in ticks, or null when it cannot be read. */
export function windowsStartTicks(pid: number, facts: WindowsFacts): string | null {
  const ticks = facts.powershell(startTimeScript(pid))?.trim() ?? "";
  return /^\d+$/.test(ticks) ? ticks : null;
}

/**
 * A pid's start time on Windows, as the lease store judges it. `like` is the value the
 * lease recorded. A reading that cannot be compared counts as ALIVE — the recorded value
 * handed back — so a job waits instead of running on top of a holder that may be there.
 */
export function windowsStartTime(
  pid: number,
  like: string | undefined,
  facts: WindowsFacts = realWindowsFacts,
): string | null {
  // A value another system wrote (a Linux or macOS lease) cannot be compared here.
  if (like !== undefined && !like.startsWith(WINDOWS_START_PREFIX)) return like;
  const ticks = windowsStartTicks(pid, facts);
  return ticks === null ? (like ?? null) : `${WINDOWS_START_PREFIX}${ticks}`;
}

/** Reads a pid's start time the way this platform's leases are judged. */
export function startTimeReader(
  platform: NodeJS.Platform,
  facts: WindowsFacts = realWindowsFacts,
): StartTimeReader {
  if (platform !== "win32") return processStartTime;
  return (pid, like) => windowsStartTime(pid, like, facts);
}

/**
 * What a lease records as its holder: this process (pid, host, pid namespace), with its
 * start time — `/proc` or `ps` where there is one, PowerShell on Windows.
 */
export function leaseHolder(
  platform: NodeJS.Platform,
  facts: WindowsFacts = realWindowsFacts,
): ReturnType<typeof currentHolder> {
  const holder = currentHolder();
  if (platform !== "win32") return holder;
  return { ...holder, startTime: windowsStartTime(holder.pid, undefined, facts) };
}

/**
 * Ends a job's whole process tree. Windows has no signals, so SIGINT, SIGTERM and SIGHUP
 * all mean the same thing there: the job ends now, its workers too. 128 from `taskkill`
 * is "no such process" — it is already gone, which is what ending it wanted. Where
 * `taskkill` cannot run at all, Node's own way ends the first process (its workers then
 * live on: that is what the bounded wait in `launch.ts` says out loud).
 */
export function endJobTree(pid: number, facts: WindowsFacts = realWindowsFacts): void {
  const code = facts.taskkill(pid);
  if (code === 0 || code === 128) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Gone already, or not ours to end: the bounded wait in `launch.ts` says what is left.
  }
}

/**
 * True when no process with this pid is left. `signal 0` is Node's existence test, on
 * Windows too: it sends nothing. A process of another user answers EPERM: it is there.
 */
export function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
