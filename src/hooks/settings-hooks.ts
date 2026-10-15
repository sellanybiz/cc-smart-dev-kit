/**
 * The hooks a Claude Code settings file wires: what `anymodel doctor` reads to check a
 * project's wiring (the worktree engine's lines, and a project hook that runs next to a
 * plugin hook on the same event and tool).
 *
 * No hook reads these files: what Claude Code loaded for a session is not knowable from a
 * hook (a worktree's settings may differ from the ones the session started with), so a
 * plugin hook steps aside only for what the project's anymodel.json says (`ownHooks`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * True when a settings `matcher` selects `subject` (a tool name, a SessionStart source, an
 * agent type), the way Claude Code reads it (code.claude.com/docs/en/hooks § matcher):
 * - "*", "" or no matcher: everything;
 * - only letters, digits, `_`, `-`, spaces, `,` and `|`: a list of exact names;
 * - anything else: a JavaScript regular expression, not anchored.
 * `subject` null: the event has no matcher support, so every matcher counts.
 */
export function matcherSelects(matcher: unknown, subject: string | null): boolean {
  if (matcher === undefined || matcher === null || matcher === "" || matcher === "*") return true;
  if (typeof matcher !== "string") return false;
  if (subject === null) return true;
  if (/^[A-Za-z0-9_\- ,|]*$/.test(matcher)) {
    return matcher
      .split(/[|,]/)
      .map((part) => part.trim())
      .includes(subject);
  }
  try {
    return new RegExp(matcher).test(subject);
  } catch {
    // Claude Code cannot use a broken pattern either.
    return false;
  }
}

/** The `hooks` of a settings file; null when it has none or cannot be read. */
function hooksOf(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const hooks = (parsed as { hooks?: unknown }).hooks;
    return typeof hooks === "object" && hooks !== null && !Array.isArray(hooks)
      ? (hooks as Record<string, unknown>)
      : null;
  } catch {
    // A settings file that is not JSON: Claude Code cannot run its hooks either.
    return null;
  }
}

/** One handler a settings file wires: the file, and its command as a person would type it. */
export interface WiredHandler {
  file: string;
  command: string;
}

/** A handler's command: `command` and its `args` (exec form), or its type when it has none. */
function describeHandler(handler: unknown): string {
  if (typeof handler !== "object" || handler === null) return "(a hook)";
  const { type, command, args } = handler as { type?: unknown; command?: unknown; args?: unknown };
  if (typeof command !== "string")
    return typeof type === "string" ? `(a ${type} hook)` : "(a hook)";
  const rest = Array.isArray(args) ? args.filter((arg) => typeof arg === "string") : [];
  return [command, ...rest].join(" ");
}

/** Every handler `file` wires for `event` in a group whose matcher selects `subject`. */
export function wiredHandlers(file: string, event: string, subject: string | null): WiredHandler[] {
  const groups = hooksOf(file)?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group: unknown) => {
    if (typeof group !== "object" || group === null) return [];
    const { matcher, hooks } = group as { matcher?: unknown; hooks?: unknown };
    if (!Array.isArray(hooks) || !matcherSelects(matcher, subject)) return [];
    return hooks.map((handler: unknown) => ({ file, command: describeHandler(handler) }));
  });
}

/** A project's two settings files: `.claude/settings.json` and `.claude/settings.local.json`. */
export function projectSettingsFiles(projectDir: string): string[] {
  return [
    join(projectDir, ".claude", "settings.json"),
    join(projectDir, ".claude", "settings.local.json"),
  ];
}
