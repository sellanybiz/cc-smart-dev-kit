/**
 * The defer check: a plugin hook stays silent while the project still wires its own hook
 * for the same event (and a matcher that covers the same tool or source).
 *
 * Why: a project may still carry its own copy of a piece the plugin now ships (a guard, a
 * note). Claude Code runs every matching hook, the plugin's and the project's, so both
 * would act: two questions for one command. So the plugin's hook exits 0 and prints
 * nothing, and the project's copy runs alone, until the project removes it
 * (`docs/design.md` § The safe switch).
 *
 * The check is coarse on purpose: it cannot tell what a project's hook does, only when it
 * runs. A project hook on the same event and tool, whatever it does, silences the plugin's.
 * `anymodel doctor` lists each one it finds in the project it runs in, so the silence is
 * visible.
 *
 * Only the hooks `plugin/hooks/hooks.json` wires have the check. The worktree hooks a
 * project wires itself (`anymodel hook <name>`) run because the project asked for them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Checkout } from "../project/resolve";

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

/** True when `file` wires at least one hook handler for `event` whose matcher selects `subject`. */
export function fileWiresHook(file: string, event: string, subject: string | null): boolean {
  return wiredHandlers(file, event, subject).length > 0;
}

/**
 * The settings files whose hooks count as the project's own: `.claude/settings.json` and
 * `.claude/settings.local.json` of the checkout `cwd` is in and of the main checkout. A
 * session in a worktree may have loaded either one.
 */
export function deferSources(checkout: Checkout): string[] {
  const roots = [checkout.root];
  if (checkout.mainCheckout !== null && checkout.mainCheckout !== checkout.root) {
    roots.push(checkout.mainCheckout);
  }
  return roots.flatMap((root) => [
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ]);
}

/** The first of `files` that wires its own hook for `event` and `subject`, or null. */
export function ownHookIn(files: string[], event: string, subject: string | null): string | null {
  return files.find((file) => fileWiresHook(file, event, subject)) ?? null;
}
