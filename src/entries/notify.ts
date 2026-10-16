// The notifier hook: plugin/dist/notify.js, on Notification, Stop, PreToolUse and the events
// around a question (plugin/hooks/hooks.json). It reads no cc-smart-dev-kit.json: it is about the
// machine — a notifier on PATH, an SSH session, Warp, whose own plugin notifies — never about
// a project, so it does not enter the frame. The logic and its tests: src/hooks/notify.ts.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { notifyHook, spawnNotifyFor } from "../hooks/notify";
import { spawnRunner } from "../hooks/stop-failure";
import {
  realTerminalProbe,
  sessionTerminalDevice,
  ttyDevice,
  writeDevice,
} from "../hooks/terminal";
import { LAUNCHER_NAME } from "../setup/launcher";

/** Writes one sequence to the session's terminal; false when there is none. */
function writeTerminal(sequence: string): boolean {
  // No controlling terminal (`claude -p`, a service) or no such device (`ttyDevice`: Windows
  // has none): false, and the caller falls back.
  const device = ttyDevice(process.platform);
  return device !== null && writeDevice(device, sequence);
}

async function hook(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("cc-smart-dev-kit notify: the hook input is not JSON");
    return;
  }
  const event =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as { hook_event_name?: unknown }).hook_event_name
      : undefined;
  const env = process.env;
  const paths = cliPaths(env);
  const probe = realTerminalProbe(env, process.ppid);
  // The worker behind a click waits up to a minute: it runs from the installed version
  // through the launcher, never from this hook's version folder, which an update may delete
  // while it waits (`src/hooks/stop-failure.ts`).
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    capture: spawnRunner,
    env,
    launcher: existsSync(launcher) ? launcher : null,
    nowMs: Date.now(),
    paths,
    platform: process.platform,
    run: spawnNotifyFor(process.platform),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
    // The session's own terminal device: the pty Claude Code is attached to, found from its
    // pid. The route for an event whose answer Claude Code does not read (`terminal.ts`).
    writeSessionTerminal: (sequence) => {
      const device = sessionTerminalDevice(probe);
      return device !== null && writeDevice(device, sequence);
    },
    writeTerminal,
  });
  // The one answer Claude Code reads here: the OSC sequence, written to the session's
  // terminal by Claude Code itself (2.1.141+). Every other event's answer was already
  // written to /dev/tty.
  if (result.stdout !== undefined) await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined) await Bun.write(Bun.stderr, `${result.stderr}\n`);
}

try {
  await hook();
} catch (error) {
  // A notifier must never stop the person's work: one line, exit 0.
  console.error(
    `cc-smart-dev-kit notify: ${error instanceof Error ? error.message : String(error)}`,
  );
}
