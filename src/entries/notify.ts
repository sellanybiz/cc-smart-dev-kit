// The notifier hook: plugin/dist/notify.js, on Notification, Stop, PreToolUse and the events
// around a question (plugin/hooks/hooks.json). It reads no cc-smart-dev-kit.json: it is about the
// machine — a notifier on PATH, an SSH session, Warp, whose own plugin notifies — never about
// a project, so it does not enter the frame. The logic and its tests: src/hooks/notify.ts.

import { cliPaths } from "../cli/paths";
import { notifyHook, spawnNotify } from "../hooks/notify";
import { realTerminalProbe, sessionTerminalDevice, writeDevice } from "../hooks/terminal";

/** Writes one sequence to the session's terminal; false when there is none. */
function writeTerminal(sequence: string): boolean {
  // No controlling terminal (`claude -p`, a service): false, and the caller falls back.
  return writeDevice("/dev/tty", sequence);
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
  const probe = realTerminalProbe(env, process.ppid);
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    env,
    nowMs: Date.now(),
    paths: cliPaths(env),
    platform: process.platform,
    run: spawnNotify,
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
