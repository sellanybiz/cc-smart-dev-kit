// The notifier hook: plugin/dist/notify.js, on Notification, Stop, PreToolUse and the events
// around a question (plugin/hooks/hooks.json). It reads no cc-smart-dev-kit.json: it is about the
// machine — a notifier on PATH, an SSH session, Warp, whose own plugin notifies — never about
// a project, so it does not enter the frame. The same wiring runs as `cc-smart-dev-kit hook
// notify`, the user-level hook setup writes for agent view (`src/hooks/notify-entry.ts`; the
// logic and its tests: `src/hooks/notify.ts`).

import { runNotifyEntry } from "../hooks/notify-entry";

await runNotifyEntry();
