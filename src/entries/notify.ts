// The notifier hook: plugin/dist/notify.js, on Notification and Stop (plugin/hooks/hooks.json).
// It reads no anymodel.json: it is about the machine — a notifier on PATH, and Warp, whose own
// plugin notifies — never about a project, so it does not enter the frame. The logic and its
// tests: src/hooks/notify.ts.

import { notifyHook, spawnNotify } from "../hooks/notify";

async function hook(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("anymodel notify: the hook input is not JSON");
    return;
  }
  const event =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as { hook_event_name?: unknown }).hook_event_name
      : undefined;
  const env = process.env;
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    env,
    platform: process.platform,
    run: spawnNotify,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
  });
  if (result.stderr !== undefined) await Bun.write(Bun.stderr, `${result.stderr}\n`);
}

try {
  await hook();
} catch (error) {
  // A notifier must never stop the person's work: one line, exit 0.
  console.error(`anymodel notify: ${error instanceof Error ? error.message : String(error)}`);
}
