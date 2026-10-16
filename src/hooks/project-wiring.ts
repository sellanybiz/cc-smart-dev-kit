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
 * True when a wired command runs `cc-smart-dev-kit hook <name>`: by the bare name, a path to the
 * launcher, or the plugin's own `bin/cc-smart-dev-kit`.
 */
export function runsProjectHook(command: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`(^|[\s/"'])${LAUNCHER_NAME}["']?\s+hook\s+["']?${escaped}["']?(\s|;|$)`,
  ).test(command);
}
