// The StopFailure hook (plugin/hooks/hooks.json).
//
// Reads the input on stdin, decides on an alert (`planAlert`), starts the detached worker
// that shows it, and exits at once, printing nothing. The worker runs through the launcher
// (`~/.local/bin/cc-smart-dev-kit alert-worker <alert JSON>`), never from this file's version
// folder: it may wait half an hour for a click, and an update may delete the folder
// meanwhile. With no launcher (setup never ran), a plain notification with no action,
// which ends at once, is started instead — and on Windows that plain notification is the
// route itself (`usesAlertWorker`: no click waits there, and the launcher is a `.cmd` twin
// this path does not name). The logic and its tests: src/hooks/stop-failure.ts.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { startDetached } from "../hooks/detached";
import {
  ALERT_WORKER_COMMAND,
  plainNotification,
  planAlert,
  readAlertContext,
  usesAlertWorker,
} from "../hooks/stop-failure";
import { LAUNCHER_NAME } from "../setup/launcher";

/** Starts a program detached from the hook, which does not wait for it. */
function detached(argv: string[]): void {
  startDetached(process.platform, argv, {
    onError: (message) =>
      console.error(`cc-smart-dev-kit StopFailure: could not show the alert: ${message}`),
  });
}

async function hook(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("cc-smart-dev-kit StopFailure: the hook input is not JSON");
    return;
  }
  const paths = cliPaths();
  const alert = planAlert(input, readAlertContext(paths, Date.now(), input));
  if (alert === null) return;
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  if (usesAlertWorker(process.platform, existsSync(launcher))) {
    detached([launcher, ALERT_WORKER_COMMAND, JSON.stringify(alert)]);
    return;
  }
  const plain = plainNotification({ ...alert, action: null }, process.platform);
  if (plain === null) console.error(`cc-smart-dev-kit: ${alert.title}. ${alert.body}`);
  else detached(plain.argv);
}

try {
  await hook();
} catch (error) {
  // A bug here must never stop the person's work: one line, exit 0.
  console.error(
    `cc-smart-dev-kit StopFailure: ${error instanceof Error ? error.message : String(error)}`,
  );
}
