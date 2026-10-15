/**
 * `doctor`'s checks of the project in the folder it runs in:
 *
 * - **The worktree engine is wired as `anymodel.json` says.** With `worktrees`, the project's
 *   settings must wire WorktreeCreate, WorktreeRemove and SubagentStop to
 *   `anymodel hook <name>`; wired without `worktrees`, every worktree would fail. Next to the
 *   engine, a second WorktreeCreate hook (the project's or the user's) would make a second
 *   worktree for each request (Claude Code runs both: `docs/claude-code-contract.md`).
 * - **The project's own copies of plugin hooks.** Each hook `ownHooks` lists is off here
 *   (information); a listed one with no project hook on its event left to answer is a
 *   warning. A project hook on the same event and tool as a plugin hook the list does NOT
 *   name is a warning too: both run, so both may answer.
 *
 * The project's settings are read where Claude Code reads them: `$CLAUDE_PROJECT_DIR` when
 * it is set (doctor run from a session), else the checkout of the folder doctor runs in.
 * Outside a git project it says nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { runsProjectHook } from "../hooks/project-wiring";
import { projectSettingsFiles, type WiredHandler, wiredHandlers } from "../hooks/settings-hooks";
import { PROJECT_HOOKS } from "../hooks/specs";
import { type AnymodelConfig, AnymodelConfigError } from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type CliPaths, tildify } from "./paths";

export interface ProjectLine {
  ok: boolean;
  /** Information only, never a failure. */
  info?: boolean;
  /** Worth a look, but not a failure (`ok` stays true). */
  warn?: boolean;
  text: string;
}

type Env = Record<string, string | undefined>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A settings file as the person knows it: relative to the project folder, else with `~`. */
function shown(file: string, projectDir: string, home: string): string {
  return file.startsWith(`${projectDir}/`)
    ? file.slice(projectDir.length + 1)
    : tildify(file, home);
}

const ENGINE_HINT =
  "Run `anymodel hook` for the lines to paste (also in the anymodel README, § Worktrees)";

/** The worktree engine's wiring against `worktrees` in anymodel.json. */
function engineLines(
  config: AnymodelConfig | null,
  sources: string[],
  projectDir: string,
  paths: CliPaths,
): ProjectLine[] {
  const hooks = PROJECT_HOOKS.map((spec) => {
    const event = spec.events[0] ?? "";
    const handlers = sources.flatMap((file) => wiredHandlers(file, event, null));
    return { spec, event, wired: handlers.some((h) => runsProjectHook(h.command, spec.name)) };
  });
  const missing = hooks.filter((hook) => !hook.wired).map((hook) => hook.event);
  const wired = hooks.filter((hook) => hook.wired).map((hook) => hook.event);
  const lines: ProjectLine[] = [];
  if (config?.worktrees !== undefined) {
    lines.push(
      missing.length === 0
        ? { ok: true, text: `project: the worktree engine is wired (${wired.join(", ")})` }
        : {
            ok: false,
            text: `project: "worktrees" is set in .claude/anymodel.json, but the project's settings do not wire ${missing.join(", ")} to anymodel hook${missing.includes("WorktreeCreate") ? ", so Claude Code makes its own worktrees" : ""}. ${ENGINE_HINT}`,
          },
    );
  } else if (wired.length > 0) {
    lines.push({
      ok: false,
      text: `project: the project's settings wire ${wired.join(", ")} to anymodel hook, but ${config === null ? "there is no .claude/anymodel.json" : '.claude/anymodel.json has no "worktrees"'}, so each of them fails. Add "worktrees", or take the anymodel hook lines out`,
    });
  }
  if (hooks.find((hook) => hook.event === "WorktreeCreate")?.wired === true) {
    const others: WiredHandler[] = [...sources, paths.settingsFile]
      .flatMap((file) => wiredHandlers(file, "WorktreeCreate", null))
      .filter((handler) => !runsProjectHook(handler.command, "worktree-create"));
    for (const other of others) {
      lines.push({
        ok: false,
        text: `project: another WorktreeCreate hook runs too: ${other.command} (${shown(other.file, projectDir, paths.home)}). Claude Code runs both and makes two worktrees for each request; remove one`,
      });
    }
  }
  return lines;
}

interface PluginHook {
  name: string;
  event: string;
  /** The tools (or sources) its matcher lists; [null] for an event without a matcher. */
  subjects: Array<string | null>;
}

/** The hooks the plugin's hooks.json wires: each bundle's name, event and matcher's names. */
export function readPluginHooks(file: string): PluginHook[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ args?: string[] }> }>>;
  };
  return Object.entries(parsed.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      (group.hooks ?? []).flatMap((handler) => {
        const bundle = (handler.args ?? [])
          .map((arg) => /\/dist\/([a-z-]+)\.js$/.exec(arg)?.[1])
          .find((name) => name !== undefined);
        if (bundle === undefined) return [];
        const subjects =
          group.matcher === undefined || group.matcher === "" ? [null] : group.matcher.split("|");
        return [{ name: bundle, event, subjects }];
      }),
    ),
  );
}

/** "PreToolUse (Bash, PowerShell)": an event and the tools or sources it is about. */
function onEvent(event: string, subjects: Array<string | null>): string {
  const named = subjects.filter((subject): subject is string => subject !== null);
  return named.length > 0 ? `${event} (${named.join(", ")})` : event;
}

/**
 * The project's own copies of plugin hooks: one · line for each hook `ownHooks` lists, a
 * warning for a listed hook nothing in the project's settings replaces, and a warning for
 * each project hook that runs next to an unlisted plugin hook on the same event and tool.
 */
function ownCopyLines(
  config: AnymodelConfig,
  sources: string[],
  pluginHooksFile: string,
  projectDir: string,
  home: string,
): ProjectLine[] {
  let pluginHooks: PluginHook[];
  try {
    pluginHooks = readPluginHooks(pluginHooksFile);
  } catch (error) {
    return [
      { ok: false, text: `cannot read the plugin's hooks (${pluginHooksFile}): ${message(error)}` },
    ];
  }
  const own: string[] = config.ownHooks ?? [];
  const lines: ProjectLine[] = [];
  for (const name of own) {
    const entries = pluginHooks.filter((hook) => hook.name === name);
    const replaced = entries.some((hook) =>
      hook.subjects.some((subject) =>
        sources.some((file) => wiredHandlers(file, hook.event, subject).length > 0),
      ),
    );
    lines.push(
      replaced
        ? {
            ok: true,
            info: true,
            text: `project: the plugin's ${name} is off here: .claude/anymodel.json lists it in ownHooks, so the project's own copy answers alone`,
          }
        : {
            ok: true,
            warn: true,
            text: `project: .claude/anymodel.json lists ${name} in ownHooks, so the plugin's ${name} is off here, but the project's settings wire no hook on ${entries.map((hook) => onEvent(hook.event, hook.subjects)).join(", ") || "its event"}: nothing answers in its place. Take "${name}" out of ownHooks once the project's copy is gone`,
          },
    );
  }
  const found = new Map<string, { hook: PluginHook; handler: WiredHandler; subjects: string[] }>();
  for (const hook of pluginHooks) {
    if (own.includes(hook.name)) continue;
    for (const subject of hook.subjects) {
      for (const handler of sources.flatMap((file) => wiredHandlers(file, hook.event, subject))) {
        const key = JSON.stringify([hook.name, hook.event, handler.file, handler.command]);
        const entry = found.get(key) ?? { hook, handler, subjects: [] };
        if (subject !== null) entry.subjects.push(subject);
        found.set(key, entry);
      }
    }
  }
  for (const { hook, handler, subjects } of found.values()) {
    lines.push({
      ok: true,
      warn: true,
      text: `project: the plugin's ${hook.name} and the project's ${handler.command} (${shown(handler.file, projectDir, home)}) both run on ${onEvent(hook.event, subjects)}, so both may answer. If that is the project's own copy of ${hook.name}, list "${hook.name}" in ownHooks in .claude/anymodel.json until the copy is removed`,
    });
  }
  return lines;
}

/** The project checks for the folder `cwd`; none outside git. */
export function projectChecks(
  cwd: string,
  env: Env,
  paths: CliPaths,
  pluginHooksFile: string,
): ProjectLine[] {
  if (Bun.which("git", { PATH: env.PATH ?? "" }) === null) {
    return [{ ok: true, info: true, text: "project: not checked, git is not on PATH" }];
  }
  let checkout: Checkout | null;
  try {
    checkout = existsSync(cwd) ? locateCheckout(cwd, { env }) : null;
  } catch (error) {
    return [{ ok: false, text: `project: ${message(error)}` }];
  }
  if (checkout === null) return [];
  // Where Claude Code reads the project's settings: the folder the session started in.
  const projectDir =
    env.CLAUDE_PROJECT_DIR !== undefined && env.CLAUDE_PROJECT_DIR !== ""
      ? env.CLAUDE_PROJECT_DIR
      : checkout.root;
  const sources = projectSettingsFiles(projectDir);
  let config: AnymodelConfig | null;
  try {
    config = loadProjectConfig(checkout).config;
  } catch (error) {
    if (!(error instanceof AnymodelConfigError)) throw error;
    return [{ ok: false, text: `project: ${error.message}` }];
  }
  const lines = engineLines(config, sources, projectDir, paths);
  // Without anymodel.json every plugin hook is silent: nothing can answer twice.
  if (config !== null) {
    lines.push(...ownCopyLines(config, sources, pluginHooksFile, projectDir, paths.home));
  }
  return lines;
}
