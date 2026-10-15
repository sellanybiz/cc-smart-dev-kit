/**
 * The defer check: a plugin hook stays silent while the project still wires its own hook
 * for the same event (and a matcher that covers the same tool or source).
 *
 * Why: a project may still carry its own copy of a piece the plugin now ships (a worktree
 * hook, a guard). Claude Code runs every matching hook, the plugin's and the project's, so
 * both would act: two worktrees made for one request (seen live), two questions for one
 * command. So the plugin's hook exits 0 and prints nothing, and the project's copy runs
 * alone, until the project removes it (`docs/design.md` § The safe switch).
 *
 * The check is coarse on purpose: it cannot tell what a project's hook does, only when it
 * runs. A project hook on the same event and tool, whatever it does, silences the plugin's.
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

/** True when `file` wires at least one hook handler for `event` whose matcher selects `subject`. */
export function fileWiresHook(file: string, event: string, subject: string | null): boolean {
  const groups = hooksOf(file)?.[event];
  if (!Array.isArray(groups)) return false;
  return groups.some((group: unknown) => {
    if (typeof group !== "object" || group === null) return false;
    const { matcher, hooks } = group as { matcher?: unknown; hooks?: unknown };
    return Array.isArray(hooks) && hooks.length > 0 && matcherSelects(matcher, subject);
  });
}

/**
 * The settings files whose hooks count as the project's own: `.claude/settings.json` and
 * `.claude/settings.local.json` of the checkout `cwd` is in and of the main checkout. A
 * session in a worktree may have loaded either one. `userSettings`: also the user's
 * `settings.json` (for the worktree events, where any second creator makes a second
 * worktree).
 */
export function deferSources(checkout: Checkout, userSettings: string | null): string[] {
  const roots = [checkout.root];
  if (checkout.mainCheckout !== null && checkout.mainCheckout !== checkout.root) {
    roots.push(checkout.mainCheckout);
  }
  const files = roots.flatMap((root) => [
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ]);
  return userSettings === null ? files : [...files, userSettings];
}

/** The first of `files` that wires its own hook for `event` and `subject`, or null. */
export function ownHookIn(files: string[], event: string, subject: string | null): string | null {
  return files.find((file) => fileWiresHook(file, event, subject)) ?? null;
}
