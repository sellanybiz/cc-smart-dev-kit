// The StopFailure hook (plugin/hooks/hooks.json).
//
// Reads the input on stdin, decides on an alert (`breakerAlert` for the router's breaker 429,
// `planAlert` for the plan's usage limit), starts the detached worker that shows it, and
// exits at once, printing nothing. A breaker alert is written down first, keyed on the
// opening, so one opening alerts once (`rememberBreakerAlert`). A background session shows
// nothing at all (`background-session.ts`). The worker runs through the launcher
// (`~/.local/bin/cc-smart-dev-kit alert-worker <alert JSON>`), never from this file's version
// folder: it may wait half an hour for a click, and an update may delete the folder
// meanwhile. With no launcher (setup never ran), a plain notification with no action,
// which ends at once, is started instead — and on Windows that plain notification is the
// route itself (`usesAlertWorker`: no click waits there, and the launcher is a `.cmd` twin
// this path does not name). The logic and its tests: src/hooks/stop-failure.ts.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { soundArgv } from "../hooks/alert-sound";
import { inBackgroundSession } from "../hooks/background-session";
import { startDetached } from "../hooks/detached";
import {
  ALERT_WORKER_COMMAND,
  breakerAlert,
  plainNotification,
  planAlert,
  readAlertContext,
  rememberBreakerAlert,
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
  // A background session shows nothing: agent view alerts for it while the list is open,
  // and it inherits the daemon's display, so an alert of its own would go to the wrong
  // place (`src/hooks/background-session.ts`).
  if (inBackgroundSession(process.env)) return;
  const paths = cliPaths();
  const ctx = readAlertContext(paths, Date.now(), input, process.env);
  const breaker = breakerAlert(input, ctx);
  const alert = breaker?.alert ?? planAlert(input, ctx);
  if (alert === null) return;
  // The alert settings could not be read: one line, and the alert goes on as it always did.
  if (ctx.alertsProblem !== null) console.error(ctx.alertsProblem);
  // One breaker opening, one alert: written before the worker starts, so a second stop of the
  // same opening (in this session or another) hears nothing.
  if (breaker !== null) rememberBreakerAlert(paths, ctx.breakerAlerted, breaker);
  // The sound the alert asks for (`alerts.sound`), where this platform has one: started now,
  // so it lands with the notification the worker shows — that worker may wait half an hour.
  if (ctx.alerts.sound.value) {
    const argv = soundArgv("dialog-warning", process.platform, (command) =>
      Bun.which(command, { PATH: process.env.PATH ?? "" }),
    );
    if (argv !== null) detached(argv);
  }
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
