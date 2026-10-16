/**
 * Starting a program that must outlive the process that starts it: the background update
 * check, the notifier, the usage-limit worker. A hook returns at once — Claude Code must
 * never wait for them — so each of them has to survive the hook's exit.
 *
 * Linux and macOS: `detached: true` gives the child its own session, so it does.
 *
 * Windows: it does not. Bun puts every child in a kill-on-close job object, and `detached`
 * does not break out of it, so the child dies the moment the hook exits
 * (oven-sh/bun#31603). There the program is started through `cmd /c start "" /b`, which
 * launches it as a job-breakaway process; the trampoline itself is waited for (it returns
 * at once), so the program is running before the hook returns. What must never be waited
 * for is the program.
 */
import { spawn } from "node:child_process";

/**
 * The argv that starts `argv` on `platform` so it outlives the caller: unchanged on Linux
 * and macOS, and behind the `cmd /c start` trampoline on Windows. Pinned per platform by
 * `detached.test.ts`.
 */
export function detachedArgv(platform: NodeJS.Platform, argv: string[]): string[] {
  // `cmd /c start "" /b <program> <args…>`: `""` is the window title `start` takes as its
  // first quoted argument, `/b` starts without a new window, and the program breaks away
  // from the job object the caller's child is in.
  return platform === "win32" ? ["cmd", "/c", "start", "", "/b", ...argv] : argv;
}

/** Where it runs, what it sees, and where one line goes when it cannot be started. */
export interface DetachedOptions {
  /** The folder it runs in; the caller's when not given. */
  cwd?: string;
  /** Its environment; the caller's when not given. */
  env?: Record<string, string>;
  /** One short line when it could not be started. */
  onError: (message: string) => void;
}

/**
 * Starts it, and returns without waiting for it. Linux and macOS: a detached child, never
 * waited for. Windows: the trampoline (whose own exit is waited for — it returns at once),
 * so the program survives this process.
 */
export function startDetached(
  platform: NodeJS.Platform,
  argv: string[],
  options: DetachedOptions,
): void {
  const [file, ...args] = argv;
  if (file === undefined) return;
  const where = {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
  };
  try {
    if (platform === "win32") {
      const result = Bun.spawnSync(detachedArgv(platform, argv), {
        ...where,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        // No console window for `cmd`, and none for the program it starts.
        windowsHide: true,
      });
      const exitCode = result.exitCode ?? 1;
      if (exitCode !== 0) options.onError(`cmd /c start failed (exit ${exitCode})`);
      return;
    }
    const child = spawn(file, args, { ...where, detached: true, stdio: "ignore" });
    child.on("error", (error) => options.onError(error.message));
    child.unref();
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
  }
}
