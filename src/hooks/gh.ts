/**
 * The gh the hooks and the worktree scan need: one blocking call with a timeout, and what every
 * `gh` call of the kit shares with the awaited `runGh` (`src/workflow/merge-check.ts`): its time
 * limit, its spawn options, how it ended, and whether gh is there at all. It loads no zod, so a
 * hook may import it (`.claude/rules/hooks.md`); `merge-check.ts` loads zod and hands these on.
 */
import type { Env } from "./run";

/** How long one `gh` call may take: a read-only network call, and a guard has 30 s. */
export const GH_TIMEOUT_MS = 10_000;

/** Where and how one `gh` call runs: the repository's folder, the environment, its time. */
export interface GhCall {
  env: Env;
  /**
   * The folder gh runs in. Left out, gh runs in the process's own folder as the child inherits
   * it, which still works after that folder was removed (a long-lived portal started from a
   * worktree that is gone now); asking `process.cwd()` there would throw.
   */
  folder?: string;
  /** Text written to gh's stdin (`--body-file -`); none when left out. */
  input?: string;
  timeoutMs: number;
}

/** What one `gh` call did: its streams and why it ended. */
export interface GhResult {
  /** gh's exit code; null when it did not exit on its own. */
  code: number | null;
  /** stderr, trimmed. */
  err: string;
  /** `ok` exit 0; `failed` another exit; `missing` no gh on PATH; `timeout` the time ran out. */
  kind: "failed" | "missing" | "ok" | "timeout";
  /** stdout, as gh printed it. */
  out: string;
  /**
   * The signal that ended gh, when one did (its number when it has no name): SIGTERM for a
   * timeout, another for gh dying. Left out when gh exited or never started. A caller whose
   * call may have acted before the end (`workflow propose`'s `gh pr create`) tells a signal
   * from a spawn that failed by it.
   */
  signal?: NodeJS.Signals | number;
}

/** True when no `gh` is on the PATH `env` names. */
export function ghMissing(env: Env): boolean {
  try {
    return Bun.which("gh", { PATH: env.PATH ?? "" }) === null;
  } catch {
    return false;
  }
}

/** The options every `gh` call starts with, whether it blocks or is awaited; stdin is its own. */
export function ghSpawnOptions({ env, folder, timeoutMs }: GhCall) {
  return {
    ...(folder === undefined ? {} : { cwd: folder }),
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    // A guard runs with no console of its own on Windows: without this, gh opens one.
    windowsHide: true,
  } as const;
}

/** How a `gh` that ran ended: its exit code, or the signal that stopped it. */
export function ghEnded(
  code: number | null,
  signal: NodeJS.Signals | number | null | undefined,
  out: string,
  err: string,
): GhResult {
  if (signal !== null && signal !== undefined) {
    // The time limit stops the child with SIGTERM; any other signal is gh dying, not time.
    const kind = signal === "SIGTERM" ? "timeout" : "failed";
    return { code: null, err: err.trim(), kind, out, signal };
  }
  return { code, err: err.trim(), kind: code === 0 ? "ok" : "failed", out };
}

/**
 * A `gh` whose spawn threw: no gh on the PATH the call runs with, or something else (a folder
 * that is not there). Only the first is "missing".
 */
export function ghNotStarted(error: unknown, env: Env): GhResult {
  return {
    code: null,
    err: error instanceof Error ? error.message : String(error),
    kind: ghMissing(env) ? "missing" : "failed",
    out: "",
  };
}

/**
 * One `gh` call that blocks its caller, with how it ended told apart, as `runGh` tells it. For
 * a hook or a command with a process of its own; the portal awaits `runGh` instead, since a
 * blocking spawn there freezes every page (`.claude/rules/portal.md`). gh reads no stdin.
 */
export function runGhSync(args: string[], call: Omit<GhCall, "input">): GhResult {
  try {
    const run = Bun.spawnSync(["gh", ...args], { ...ghSpawnOptions(call), stdin: "ignore" });
    return ghEnded(run.exitCode, run.signalCode, run.stdout.toString(), run.stderr.toString());
  } catch (error) {
    return ghNotStarted(error, call.env);
  }
}
