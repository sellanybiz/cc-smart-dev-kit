/**
 * Is the lead running with every permission check off (`bypassPermissions`)?
 *
 * A lead hears from its crew through messages, and a session in bypass mode acts on every
 * message without a question: a crew session's text could run anything there (R4: "never run a lead or
 * crew session in bypassPermissions — its inbox holds every message"). So `crew start` and
 * `crew lead` refuse in such a session. A crew session itself never runs in it: its launch names
 * `--permission-mode auto`, and the command line wins over every settings file.
 *
 * What it reads, the way Claude Code decides the mode at start:
 *   1. the session's own command line — `--dangerously-skip-permissions`, or
 *      `--permission-mode <mode>` — when this machine can show it (Linux, macOS);
 *   2. else `permissions.defaultMode` in the settings files, the most specific first: the
 *      checkout's `.claude/settings.local.json`, its `.claude/settings.json`, then the person's
 *      own `settings.json`.
 * A seatbelt, not a lock: a mode switched inside the session later (Shift+Tab) is not seen, and
 * a settings file that does not read says nothing.
 */
import { join } from "node:path";
import { readUserJson } from "../setup/user-json";

/** The mode with every permission check off. */
export const BYPASS_MODE = "bypassPermissions";

/** The flag that starts a session in `BYPASS_MODE`. */
const SKIP_FLAG = "--dangerously-skip-permissions";

/** The permission mode a command line starts a session in; null when it names none. */
export function commandLineMode(line: string): null | string {
  const words = line.split(/\s+/);
  for (const [index, word] of words.entries()) {
    if (word === SKIP_FLAG) return BYPASS_MODE;
    if (word === "--permission-mode") return words[index + 1] ?? null;
    if (word.startsWith("--permission-mode=")) return word.slice("--permission-mode=".length);
  }
  return null;
}

/** The settings files whose `permissions.defaultMode` counts, the most specific first. */
export function settingsFilesOf(checkoutRoot: string, userSettingsFile: string): string[] {
  return [
    join(checkoutRoot, ".claude", "settings.local.json"),
    join(checkoutRoot, ".claude", "settings.json"),
    userSettingsFile,
  ];
}

/** `permissions.defaultMode` of one settings file; null when it sets none or does not read. */
function defaultModeIn(file: string): null | string {
  try {
    const parsed = readUserJson(file);
    if (typeof parsed !== "object" || parsed === null) return null;
    const permissions = (parsed as { permissions?: unknown }).permissions;
    if (typeof permissions !== "object" || permissions === null) return null;
    const mode = (permissions as { defaultMode?: unknown }).defaultMode;
    return typeof mode === "string" ? mode : null;
  } catch {
    // No such file (most projects have no local one), or one Claude Code cannot read either.
    return null;
  }
}

/**
 * Why the caller runs in bypass mode, in words; null when it does not (or nobody can tell). The
 * command line wins when it names a mode; else the first settings file that sets one.
 */
export function bypassReason(commandLine: null | string, settingsFiles: string[]): null | string {
  const fromLine = commandLine === null ? null : commandLineMode(commandLine);
  if (fromLine !== null) {
    return fromLine === BYPASS_MODE ? "this session was started in bypassPermissions mode" : null;
  }
  for (const file of settingsFiles) {
    const mode = defaultModeIn(file);
    if (mode === null) continue;
    return mode === BYPASS_MODE ? `${file} sets permissions.defaultMode to ${BYPASS_MODE}` : null;
  }
  return null;
}
