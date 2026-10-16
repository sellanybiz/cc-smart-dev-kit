import { existsSync, readFileSync } from "node:fs";
import type { Runner } from "../gateway/service";
import { hostPlatform, TEST_HOST_VAR } from "./host";

export { TEST_HOST_VAR };

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
   * (cc-smart-dev-kit never sees, stores or pipes it). Returns the exit code.
   */
  runOnTerminal: (argv: string[]) => number;
  /**
   * Starts a program and does not wait for it: the person's own Chrome, opened on a page
   * (`browser setup`). A window coming to the front is the point, so its output is not captured
   * and it never blocks the caller.
   */
  spawnDetached: (argv: string[]) => void;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => string | null;
  /** Asks the person on the terminal; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  platform: NodeJS.Platform;
  /** `x64`, `arm64`, … (process.arch). */
  arch: string;
  /** The text of `/etc/os-release`, or null. */
  osRelease: () => string | null;
  /** Where the Warp app sits on macOS: `/Applications/Warp.app`. */
  macApp: string;
  /** True when a system path exists (`/etc/apt/…`, the Warp app). */
  exists: (path: string) => boolean;
  /**
   * Downloads a text file (Warp's signing key), with a timeout. The address, and the
   * address it ends at after redirects, must be HTTPS.
   */
  fetchText: (url: string) => Promise<string>;
}

/** Commands get this long: `claude plugin marketplace add` alone may clone for 120 s. */
const RUN_TIMEOUT_MS = 300_000;

/**
 * Tests only: a JSON object in this variable stands in for the host's facts
 * (`platform`, `arch`, `osRelease`, `macApp`, `existing`), so a test that runs the CLI as its own
 * process never reads the machine it runs on. Unset, the real values are used.
 * (`TEST_HOST_VAR` itself lives in `host.ts`, so the platform has one home.)
 *
 * `existing`, when given, is the WHOLE truth about what is on this machine: a path is there
 * exactly when it is in that list, and nothing else is (`exists` below). That is what makes a
 * test about a program the plugin looks for — the browser's Chrome, the Warp app — the same on
 * every machine, including one where the real Chrome sits in a standard place.
 */
interface HostFacts {
  platform: NodeJS.Platform;
  arch: string;
  osRelease: () => string | null;
  macApp: string;
  exists: (path: string) => boolean;
}

function hostFacts(env: Record<string, string | undefined>): HostFacts {
  const real: HostFacts = {
    exists: (path) => existsSync(path),
    platform: hostPlatform(env),
    arch: process.arch,
    osRelease: () =>
      existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : null,
    macApp: "/Applications/Warp.app",
  };
  const text = env[TEST_HOST_VAR];
  if (!text) return real;
  const given = JSON.parse(text) as Partial<{
    platform: NodeJS.Platform;
    arch: string;
    osRelease: string | null;
    macApp: string;
    existing: string[];
  }>;
  return {
    exists:
      given.existing === undefined ? real.exists : (path) => (given.existing ?? []).includes(path),
    platform: given.platform ?? real.platform,
    arch: given.arch ?? real.arch,
    osRelease: given.osRelease !== undefined ? () => given.osRelease ?? null : real.osRelease,
    macApp: given.macApp ?? real.macApp,
  };
}

/** The real machine, with commands found on `env.PATH`. */
export function realMachine(
  env: Record<string, string | undefined>,
  confirm: Machine["confirm"],
): Machine {
  const PATH = env.PATH ?? "";
  const host = hostFacts(env);
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
    spawnDetached: (argv) => {
      try {
        // Its own process group and no pipes to this process: the window outlives the command.
        Bun.spawn(argv, { detached: true, env, stdio: ["ignore", "ignore", "ignore"] }).unref();
      } catch {
        // A program that cannot start is not this command's failure: the caller's own note
        // (and the guide it prints) says what to open by hand.
      }
    },
    which: (command) => Bun.which(command, { PATH }),
    confirm,
    platform: host.platform,
    arch: host.arch,
    osRelease: host.osRelease,
    macApp: host.macApp,
    exists: host.exists,
    fetchText: async (url) => {
      // Redirects are followed one at a time, so no step of the way leaves HTTPS: what
      // comes back is a signing key.
      let at = url;
      for (let hop = 0; hop <= 5; hop += 1) {
        if (!at.startsWith("https://")) {
          throw new Error(`${url} led to ${at}, which is not an HTTPS address`);
        }
        const response = await fetch(at, {
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location !== null) {
          at = new URL(location, at).href;
          continue;
        }
        if (!response.ok) throw new Error(`${at} answered ${response.status}`);
        return response.text();
      }
      throw new Error(`${url} redirected more than 5 times`);
    },
  };
}
