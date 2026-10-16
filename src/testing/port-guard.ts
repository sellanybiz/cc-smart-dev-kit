/**
 * The live-router guard: no test may ever reach port 20100 on this machine.
 *
 * A gateway router may be running there for real (the default port), and a test that
 * probes it, or worse sets Claude Code's settings after its health answer, touches the
 * machine the tests run on. Every test uses a fake server's free port, or a fake probe.
 *
 * `installPortGuard()` wraps the global `fetch`: a call to 127.0.0.1, localhost or [::1]
 * on a guarded port throws before anything is sent, and is recorded. The test preload
 * (`setup.ts`) installs it in the test process and fails the test that made the call,
 * even when the code under test catches the error (a health check does). A CLI test runs
 * its subprocess with `--preload` of `port-guard-preload.ts`, which installs it there too:
 * a call is written to the log file `CC_SMART_DEV_KIT_TEST_PORT_GUARD_LOG` names, and the
 * subprocess exits with `GUARD_EXIT_CODE`.
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The live router's port. Fixed here on purpose: it must not follow a changed default. */
export const GUARDED_PORTS: readonly number[] = [20100];

/** The environment variable that names the subprocess log of guarded calls. */
export const GUARD_LOG_ENV = "CC_SMART_DEV_KIT_TEST_PORT_GUARD_LOG";

/** A subprocess that tried a guarded port exits with this code. */
export const GUARD_EXIT_CODE = 97;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Guarded calls made in this process since the last `takeViolations()`. */
const violations: string[] = [];

/** True when `input` names a local host on a guarded port. */
export function isGuardedUrl(input: unknown): boolean {
  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof URL) text = input.href;
  else if (input instanceof Request) text = input.url;
  else return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return LOCAL_HOSTS.has(url.hostname.toLowerCase()) && GUARDED_PORTS.includes(port);
}

/** The log every guarded subprocess of this test process writes to; one file, made on first use. */
let subprocessLog: null | string = null;

/**
 * What a test adds to start a guarded subprocess of bun: `args` go right after the bun
 * path (`[process.execPath, ...args, script, ...]`), `env` into its environment.
 */
export function subprocessGuard(): { args: string[]; env: Record<string, string> } {
  subprocessLog ??= join(
    tmpdir(),
    `cc-smart-dev-kit-port-guard-${process.pid}-${crypto.randomUUID()}.log`,
  );
  return {
    args: ["--preload", join(import.meta.dir, "port-guard-preload.ts")],
    env: { [GUARD_LOG_ENV]: subprocessLog },
  };
}

/**
 * Returns, and forgets, every guarded call so far: those made in this process, and those
 * its subprocesses logged.
 */
export function takeViolations(): string[] {
  const found = violations.splice(0);
  if (subprocessLog !== null && existsSync(subprocessLog)) {
    found.push(
      ...readFileSync(subprocessLog, "utf8")
        .split("\n")
        .filter((line) => line !== ""),
    );
    writeFileSync(subprocessLog, "");
  }
  return found;
}

/** Removes the subprocess log at the end of the run. */
export function removeSubprocessLog(): void {
  if (subprocessLog !== null) rmSync(subprocessLog, { force: true });
}

let installed = false;

/**
 * Wraps the global `fetch` once. `subprocess`: also log the call to the file in
 * `GUARD_LOG_ENV` and exit with `GUARD_EXIT_CODE`, so a CLI that catches the error still
 * cannot hide it.
 */
export function installPortGuard(options: { subprocess?: boolean } = {}): void {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch;
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (isGuardedUrl(input)) {
      const what = `a test tried to reach the live router port: ${String(input instanceof Request ? input.url : input)}`;
      violations.push(what);
      if (options.subprocess === true) {
        const log = process.env[GUARD_LOG_ENV];
        if (log !== undefined && log !== "") appendFileSync(log, `${what}\n`);
        console.error(`port guard: ${what}`);
        process.exit(GUARD_EXIT_CODE);
      }
      return Promise.reject(new Error(`port guard: ${what}`));
    }
    return real(input, init);
  };
  globalThis.fetch = Object.assign(guarded, real);
}
