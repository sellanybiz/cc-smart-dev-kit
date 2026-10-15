/**
 * How a project wires the worktree engine in its own `.claude/settings.json`: one handler per
 * project hook (`PROJECT_HOOKS`), each running `anymodel hook <name>` through the launcher.
 *
 * The command is a shell string with the launcher's full path under `$HOME`, not the bare
 * name `anymodel`: Claude Code's hook processes get the PATH Claude Code was started with,
 * and that may lack `~/.local/bin` (an IDE, a desktop launcher). `anymodel setup` always
 * puts the launcher in `~/.local/bin`, and the launcher runs the bun setup baked into it, so
 * this works for every person who ran setup, whatever their PATH. The shell expands `$HOME`.
 *
 * The README's § Worktrees shows exactly `projectHookSettingsText()`; a test keeps the two
 * the same.
 */
import { LAUNCHER_NAME } from "../setup/launcher";
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

/**
 * True when a wired command runs `anymodel hook <name>`: by the bare name, a path to the
 * launcher, or the plugin's own `bin/anymodel`.
 */
export function runsProjectHook(command: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`(^|[\s/"'])${LAUNCHER_NAME}["']?\s+hook\s+["']?${escaped}["']?(\s|;|$)`,
  ).test(command);
}
