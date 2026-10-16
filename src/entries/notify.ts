// The notifier hook: plugin/dist/notify.js, on Notification, Stop, PreToolUse and the events
// around a question (plugin/hooks/hooks.json). It reads no cc-smart-dev-kit.json: it is about the
// machine — a notifier on PATH, an SSH session, Warp, whose own plugin notifies — never about
// a project, so it does not enter the frame. The logic and its tests: src/hooks/notify.ts.

import { closeSync, openSync, writeSync } from "node:fs";
import { cliPaths } from "../cli/paths";
import { notifyHook, spawnNotify } from "../hooks/notify";

/** Writes one sequence to the session's terminal; false when there is none. */
function writeTerminal(sequence: string): boolean {
  try {
    const fd = openSync("/dev/tty", "w");
    try {
      writeSync(fd, sequence);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    // No controlling terminal (`claude -p`, a service): the alert has nowhere to go.
    return false;
  }
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
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    env,
    nowMs: Date.now(),
    paths: cliPaths(env),
    platform: process.platform,
    run: spawnNotify,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
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
