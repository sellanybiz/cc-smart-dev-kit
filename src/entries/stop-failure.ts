// The StopFailure hook (plugin/hooks/hooks.json) and its detached alert worker.
//
// As a hook: reads the input on stdin, decides on an alert (`planAlert`), starts this same
// bundle again as a detached worker that shows it, and exits at once, printing nothing.
// As the worker (`--alert-worker <alert JSON>`): shows the alert and, on Linux, waits for a
// click (`runAlert`). The logic and its tests: src/hooks/stop-failure.ts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  type Alert,
  planAlert,
  type Runner,
  readAlertContext,
  runAlert,
} from "../hooks/stop-failure";

const WORKER_FLAG = "--alert-worker";

/** This bundle's own file: `bun <file>` runs it. */
const self = process.argv[1] ?? "";

/** The CLI bundle beside this one; from the source, the built one. */
function cliBundle(): string {
  const beside = join(dirname(self), "cli.js");
  return existsSync(beside)
    ? beside
    : join(import.meta.dir, "..", "..", "plugin", "dist", "cli.js");
}

const runner: Runner = ({ argv, timeoutMs }) => {
  try {
    const result = Bun.spawnSync(argv, { stderr: "ignore", stdout: "pipe", timeout: timeoutMs });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      timedOut: result.exitedDueToTimeout === true,
    };
  } catch {
    // The program is not there (no notify-send): the caller falls back or gives up.
    return { exitCode: null, stdout: "", timedOut: false };
  }
};

async function hook(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("anymodel StopFailure: the hook input is not JSON");
    return;
  }
  const alert = planAlert(input, readAlertContext(cliPaths(), Date.now()));
  if (alert === null) return;
  const child = spawn(process.execPath, [self, WORKER_FLAG, JSON.stringify(alert)], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error(`anymodel StopFailure: could not show the alert: ${error.message}`);
  });
  child.unref();
}

function worker(payload: string): void {
  const alert = JSON.parse(payload) as Alert;
  const outcome = runAlert(
    alert,
    process.platform,
    { bunPath: process.execPath, cliBundle: cliBundle() },
    runner,
  );
  if (outcome === "no notifier") {
    console.error(`anymodel: ${alert.title}. ${alert.body}`);
  }
}

try {
  const [flag, payload] = process.argv.slice(2);
  if (flag === WORKER_FLAG && payload !== undefined) worker(payload);
  else await hook();
} catch (error) {
  // A bug here must never stop the person's work: one line, exit 0.
  console.error(`anymodel StopFailure: ${error instanceof Error ? error.message : String(error)}`);
}
