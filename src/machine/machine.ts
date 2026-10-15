import { existsSync, readFileSync } from "node:fs";
import type { Runner } from "../gateway/service";

/**
 * What machine setup needs from the system, in one place, so a test can hand in fakes:
 * commands run through a fake on PATH, the terminal question is a function, and the
 * operating system is a value.
 */
export interface Machine {
  /** Runs a command and captures its output. It never reads the terminal. */
  run: Runner;
  /**
   * Runs a command on the person's terminal, so `sudo` can ask for the password there
   * (anymodel never sees, stores or pipes it). Returns the exit code.
   */
  runOnTerminal: (argv: string[]) => number;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => string | null;
  /** Asks the person on the terminal; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  platform: NodeJS.Platform;
  /** `x64`, `arm64`, … (process.arch). */
  arch: string;
  /** The text of `/etc/os-release`, or null. */
  osRelease: () => string | null;
  /** True when a system path exists (`/etc/apt/…`, `/Applications/Warp.app`). */
  exists: (path: string) => boolean;
  /** Downloads a text file over HTTPS (Warp's signing key), with a timeout. */
  fetchText: (url: string) => Promise<string>;
}

/** Commands get this long: `claude plugin marketplace add` alone may clone for 120 s. */
const RUN_TIMEOUT_MS = 300_000;

/** The real machine, with commands found on `env.PATH`. */
export function realMachine(
  env: Record<string, string | undefined>,
  confirm: Machine["confirm"],
): Machine {
  const PATH = env.PATH ?? "";
  return {
    run: (cmd) => {
      try {
        const result = Bun.spawnSync(cmd, {
          env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: RUN_TIMEOUT_MS,
        });
        return {
          exitCode: result.exitCode ?? 1,
          output: `${result.stdout.toString()}${result.stderr.toString()}`,
        };
      } catch (error) {
        return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
      }
    },
    runOnTerminal: (argv) => {
      try {
        return (
          Bun.spawnSync(argv, { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
            .exitCode ?? 1
        );
      } catch {
        return 127;
      }
    },
    which: (command) => Bun.which(command, { PATH }),
    confirm,
    platform: process.platform,
    arch: process.arch,
    osRelease: () =>
      existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : null,
    exists: (path) => existsSync(path),
    fetchText: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.text();
    },
  };
}
