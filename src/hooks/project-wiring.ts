/**
 * How a project wires the worktree engine in its own `.claude/settings.json`: one handler per
 * project hook (`PROJECT_HOOKS`), each running `cc-smart-dev-kit hook <name>` through the launcher.
 *
 * The command is a shell string with the launcher's full path under `$HOME`, not the bare
 * name `cc-smart-dev-kit`: Claude Code's hook processes get the PATH Claude Code was started with,
 * and that may lack `~/.local/bin` (an IDE, a desktop launcher). `cc-smart-dev-kit setup` always
 * puts the launcher in `~/.local/bin`, and the launcher runs the bun setup baked into it, so
 * this works for every person who ran setup, whatever their PATH. The shell expands `$HOME`.
 *
 * The form holds on Windows too, where the shell is Git Bash (`docs/windows-hooks.md`): no
 * `args`, so Claude Code passes the string to a shell, and Git Bash sets `$HOME` itself. The
 * launcher is a `#!/bin/sh` script with no extension; Windows has no execute bit for `setup`
 * to set, so what runs it there is Git Bash's own rule — MSYS2 marks a file whose first two
 * characters are `#!` executable (`docs/claude-code-contract.md` § Windows). The quoting
 * wraps the whole path, so a home folder with a space stays one word. The Windows CI job's
 * smoke test runs this exact line (`scripts/windows-hook-smoke.sh`).
 *
 * The README's § Worktrees shows exactly `projectHookSettingsText()`; a test keeps the two
 * the same.
 */
import { LAUNCHER_NAME } from "../setup/launcher";
import { isObject, type JsonObject } from "../setup/managed-json";
import { PROJECT_HOOKS } from "./specs";

/** The launcher, as the shell finds it from a project hook: by its path under `$HOME`. */
export const LAUNCHER_IN_SHELL = `"$HOME/.local/bin/${LAUNCHER_NAME}"`;

/** Each project hook's timeout, in seconds: the setup command may take up to 540 s. */
const TIMEOUTS: Record<string, number> = {
  "worktree-create": 600,
  "worktree-remove": 60,
  "subagent-stop": 60,
};

/** The command a project wires for one of its hooks. */
export function projectHookCommand(name: string): string {
  return `${LAUNCHER_IN_SHELL} hook ${name}`;
}

/**
 * The `hooks` block a project pastes into its `.claude/settings.json`. `commandFor`: how each
 * hook runs; the default is the launcher, and `doctor --live` wires the plugin it is checking.
 */
export function projectHookSettings(commandFor: (name: string) => string = projectHookCommand): {
  hooks: Record<
    string,
    Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }>
  >;
} {
  const hooks: ReturnType<typeof projectHookSettings>["hooks"] = {};
  for (const spec of PROJECT_HOOKS) {
    const timeout = TIMEOUTS[spec.name];
    if (timeout === undefined) throw new Error(`no timeout for the project hook ${spec.name}`);
    for (const event of spec.events) {
      hooks[event] = [{ hooks: [{ type: "command", command: commandFor(spec.name), timeout }] }];
    }
  }
  return { hooks };
}

/** The block as the README shows it. */
export function projectHookSettingsText(): string {
  return JSON.stringify(projectHookSettings(), null, 2);
}

/** True when one settings group already wires a command of ours for `name`. */
function groupRuns(group: unknown, name: string): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (handler) =>
      isObject(handler) &&
      typeof handler.command === "string" &&
      runsProjectHook(handler.command, name),
  );
}

/**
 * A project's `.claude/settings.json` with the engine's hooks added: for each event the
 * engine needs, one handler of ours at the end of that event's list. Every group the project
 * already has stays, in its order, and an event that already runs that hook is left alone —
 * this is the merge `project init` offers, and the one place that knows the lines
 * (`projectHookSettings`). Returns the settings to write and the commands it added.
 */
export function withProjectHooks(settings: JsonObject): { settings: JsonObject; added: string[] } {
  const wanted = projectHookSettings().hooks;
  const hooks: JsonObject = isObject(settings.hooks) ? { ...settings.hooks } : {};
  const added: string[] = [];
  for (const spec of PROJECT_HOOKS) {
    for (const event of spec.events) {
      const handler = wanted[event]?.[0]?.hooks[0];
      if (handler === undefined) continue;
      const groups = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
      if (!groups.some((group) => groupRuns(group, spec.name))) {
        groups.push({ hooks: [{ ...handler }] });
        added.push(`${event}: ${handler.command} (timeout ${String(handler.timeout)} s)`);
      }
      hooks[event] = groups;
    }
  }
  return { settings: { ...settings, hooks }, added };
}

/**
 * One handler group's own command, in the words `withProjectHooks` reports it in: the command,
 * and the timeout after it. Null when the group holds no command at all.
 */
function groupCommand(group: unknown): null | string {
  if (!isObject(group) || !Array.isArray(group.hooks)) return null;
  const words = group.hooks
    .map((handler) => {
      if (!isObject(handler) || typeof handler.command !== "string") return null;
      return typeof handler.timeout === "number"
        ? `${handler.command} (timeout ${String(handler.timeout)} s)`
        : handler.command;
    })
    .filter((word): word is string => word !== null);
  return words.length === 0 ? null : words.join("; ");
}

/**
 * A project's `.claude/settings.json` with the engine's hooks taken back out — the inverse of
 * `withProjectHooks`, for a project that runs an engine of its own (`"worktrees.engine":
 * "own"`). An earlier `project init` left the plugin's handlers in the file, and with both
 * wired two engines answer each worktree request (`doctor` says exactly that).
 *
 * Only a group that is **exactly ours** goes: every handler in it runs one of our hooks for
 * that event. A group a person merged their own command into stays, and so does every other
 * key in the file — nothing else is touched. Returns the settings to write and the commands
 * it removed, in the same words `withProjectHooks` adds them.
 */
export function withoutProjectHooks(settings: JsonObject): {
  removed: string[];
  settings: JsonObject;
} {
  if (!isObject(settings.hooks)) return { removed: [], settings };
  const removed: string[] = [];
  const hooks: JsonObject = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const ours = PROJECT_HOOKS.filter((spec) => spec.events.includes(event));
    const kept = groups.filter((group) => {
      const name = ours.find((spec) => isOursAlone(group, spec.name))?.name;
      if (name === undefined) return true;
      removed.push(`${event}: ${groupCommand(group) ?? `cc-smart-dev-kit hook ${name}`}`);
      return false;
    });
    // An event with nothing left in it takes its key with it, rather than an empty list.
    if (kept.length > 0) hooks[event] = kept;
  }
  // The file's own keys in their own order, with `hooks` where it was; left out when nothing
  // of it is left.
  const next: JsonObject = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key !== "hooks") next[key] = value;
    else if (Object.keys(hooks).length > 0) next.hooks = hooks;
  }
  return { removed, settings: next };
}

/** True when every handler in one group runs one of our hooks for `name`. */
function isOursAlone(group: unknown, name: string): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks) || group.hooks.length === 0) return false;
  return group.hooks.every(
    (handler) =>
      isObject(handler) &&
      typeof handler.command === "string" &&
      runsProjectHook(handler.command, name),
  );
}

/**
 * True when a wired command runs `cc-smart-dev-kit hook <name>`: by the bare name, a path to the
 * launcher, or the plugin's own `bin/cc-smart-dev-kit`.
 */
export function runsProjectHook(command: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`(^|[\s/"'])${LAUNCHER_NAME}["']?\s+hook\s+["']?${escaped}["']?(\s|;|$)`,
  ).test(command);
}
