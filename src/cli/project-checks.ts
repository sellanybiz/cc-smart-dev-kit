/**
 * `doctor`'s checks of the project in the folder it runs in:
 *
 * - **The project still on the plugin's old `anymodel` name.** `.claude/anymodel.json`, a
 *   `.claude/anymodel/` folder and a settings hook that calls `~/.local/bin/anymodel` are
 *   left there by 0.2.x: `migrate` moves a machine's own files, never a project's, so each of
 *   them is a warning that names the new file, folder or command.
 * - **The deprecated worktree engine.** Every project uses Claude Code's own worktrees, so a
 *   project that still wires the engine's hooks, or still sets `worktrees.engine`,
 *   `worktrees.prefix` or `worktrees.setup`, gets a warning naming what to remove: the engine
 *   retires in the next minor version. `.claude/worktrees/` that is not git-ignored is a
 *   warning too.
 * - **The project's own copies of plugin hooks.** Each hook `ownHooks` lists is off here
 *   (information); a listed one with no project hook on its event left to answer is a
 *   warning. A project hook on the same event and tool as a plugin hook the list does NOT
 *   name is a warning too: both run, so both may answer. The machine-wide hooks
 *   (`MACHINE_WIDE_HOOKS`: stop-failure, update-check, notify, and `agent-guard` and
 *   `fable-session`, which run with or without the project's file) are never warned about: they
 *   answer about the machine, so a project hook beside one is not a copy of a plugin piece.
 *   A retired hook name in `ownHooks` (`RETIRED_HOOK_NAMES`) is information: it silences
 *   nothing, and can be taken out.
 *
 * The project's settings are read where Claude Code reads them: `$CLAUDE_PROJECT_DIR` when
 * it is set (doctor run from a session), else the checkout of the folder doctor runs in.
 * Outside a git project it says nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { runGit } from "../hooks/git";
import { runsProjectHook } from "../hooks/project-wiring";
import {
  allWiredHandlers,
  projectSettingsFiles,
  type WiredHandler,
  wiredHandlers,
} from "../hooks/settings-hooks";
import { MACHINE_WIDE_HOOKS, PROJECT_HOOKS } from "../hooks/specs";
import {
  type CcSmartDevKitConfig,
  CcSmartDevKitConfigError,
  RETIRED_HOOK_NAMES,
} from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type CliPaths, tildify } from "./paths";
import { defaultBranchOf, realRunner } from "./project-init";

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

/** The plugin's old name: 0.2.x wrote it into projects, and `migrate` moves no project's files. */
const OLD_NAME = "anymodel";

/** The old launcher in a settings hook: `"$HOME/.local/bin/anymodel" hook …`. */
const OLD_LAUNCHER = new RegExp(`(^|[\\s"'/])${OLD_NAME}(-bun)?(["'\\s]|$)`);

/**
 * A command with the plugin's old launcher written the new way, as the fix for it. A command
 * that named the hooks' old shim (`…/bin/anymodel-bun`) becomes the shim's own name today,
 * `cc-smart-dev-kit-bun.sh` — the hooks run in shell form, and the file ends in `.sh`.
 */
export function renamedCommand(command: string): string {
  return command.replace(
    new RegExp(OLD_LAUNCHER.source, "g"),
    (_all, before: string, bun: string | undefined, after: string) =>
      `${before}${COMMAND}${bun === undefined ? "" : "-bun.sh"}${after}`,
  );
}

/**
 * A project that ran 0.2.x still carries the old `anymodel` names: its config file, the
 * add-ons folder a skill reads, and a settings hook that calls the old launcher. `migrate`
 * moves a machine's own files, never a project's, so `doctor` names each one and the new
 * file, folder or command it becomes — a project with only the old config file looks like
 * one that never opted in, and every plugin hook stays silent in it.
 */
function oldNameLines(projectDir: string, sources: string[], home: string): ProjectLine[] {
  const lines: ProjectLine[] = [];
  const config = join(projectDir, ".claude", `${OLD_NAME}.json`);
  if (existsSync(config)) {
    lines.push({
      ok: true,
      warn: true,
      text: `project: ${shown(config, projectDir, home)} is the old name of .claude/cc-smart-dev-kit.json, which the plugin reads now: rename it (merge the two when both are there)`,
    });
  }
  const addons = join(projectDir, ".claude", OLD_NAME);
  if (existsSync(addons)) {
    lines.push({
      ok: true,
      warn: true,
      text: `project: ${shown(addons, projectDir, home)}/ is the old name of .claude/cc-smart-dev-kit/, where a skill reads the project's own add-ons: rename the folder`,
    });
  }
  for (const file of sources) {
    for (const handler of allWiredHandlers(file)) {
      if (!OLD_LAUNCHER.test(handler.command)) continue;
      lines.push({
        ok: true,
        warn: true,
        text: `project: the hook ${handler.command} (${shown(handler.file, projectDir, home)}) still runs the plugin's old "${OLD_NAME}" launcher: change it to ${renamedCommand(handler.command)}`,
      });
    }
  }
  return lines;
}

/**
 * `doctor`'s checks of the worktrees in the project it runs in:
 *
 * - **The deprecated engine.** Every project uses Claude Code's own worktrees
 *   (`<repo>/.claude/worktrees/<name>` on `worktree-<name>`), which need no hook. A project
 *   that still wires the plugin's engine hooks, or still sets `worktrees.engine`,
 *   `worktrees.prefix` or `worktrees.setup`, gets one `!` line naming what to remove: the
 *   engine retires in the next minor version. Hook lines wired with no `worktrees` at all are
 *   a `✗`, because each of them fails closed. A second WorktreeCreate hook next to the
 *   engine's makes a second worktree for each request, so that is a `✗` too.
 * - **`.claude/worktrees/` is git-ignored.** Claude Code puts its worktrees there; a repo
 *   that does not ignore the folder sees every worktree in `git status`. One `!` line.
 */
function worktreeLines(
  config: CcSmartDevKitConfig | null,
  sources: string[],
  projectDir: string,
  checkout: Checkout,
  paths: CliPaths,
  env: Env,
): ProjectLine[] {
  const hooks = PROJECT_HOOKS.map((spec) => {
    const event = spec.events[0] ?? "";
    const handlers = sources.flatMap((file) => wiredHandlers(file, event, null));
    return { spec, event, wired: handlers.some((h) => runsProjectHook(h.command, spec.name)) };
  });
  const wired = hooks.filter((hook) => hook.wired).map((hook) => hook.event);
  const worktrees = config?.worktrees;
  const fields =
    worktrees === undefined
      ? []
      : (["engine", "prefix", "setup"] as const).filter((field) => Object.hasOwn(worktrees, field));
  const named = fields.map((field) => `"worktrees.${field}"`);
  const move =
    '; Claude Code\'s own worktrees need no hook, and a project whose base branch is not the repo\'s default branch adds "worktree": {"baseRef": "head"} to .claude/settings.json';
  const lines: ProjectLine[] = [];
  if (wired.length > 0) {
    const what = `the project's settings wire ${wired.join(", ")} to cc-smart-dev-kit hook`;
    if (worktrees === undefined) {
      lines.push({
        ok: false,
        text: `project: ${what}, but ${config === null ? "there is no .claude/cc-smart-dev-kit.json" : '.claude/cc-smart-dev-kit.json has no "worktrees"'}, so each of them fails. Take the cc-smart-dev-kit hook lines out: the worktree engine is deprecated and retires in the next minor version${move}`,
      });
    } else {
      const drop =
        named.length > 0 ? ` and drop ${named.join(", ")} from .claude/cc-smart-dev-kit.json` : "";
      lines.push({
        ok: true,
        warn: true,
        text: `project: ${what}: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json${drop}${move}`,
      });
    }
  } else if (fields.length > 0) {
    lines.push({
      ok: true,
      warn: true,
      text: `project: .claude/cc-smart-dev-kit.json still sets ${named.join(", ")}: the worktree engine is deprecated and retires in the next minor version. Remove ${fields.length === 1 ? "it" : "them"}${move}`,
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
  // Claude Code puts its worktrees under `<repo>/.claude/worktrees/`; a repo that does not
  // ignore the folder shows every worktree's files in `git status`. Only a project that
  // opted into the worktree workflow has the `worktrees` field, and only it gets told.
  if (worktrees !== undefined) {
    const ignored = runGit(checkout.root, ["check-ignore", "-q", ".claude/worktrees/"], env).ok;
    if (!ignored) {
      lines.push({
        ok: true,
        warn: true,
        text: "project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add \".claude/worktrees/\" to the repo's .gitignore and commit it",
      });
    }
    // Claude Code cuts a new worktree from the default branch, unless the project's settings
    // say `baseRef: "head"`. A base branch that is not the default needs that line; while the
    // deprecated engine is wired, it decides where the worktree goes instead.
    const defaultBranch = defaultBranchOf(realRunner(env), checkout.root);
    if (worktrees.base !== defaultBranch && baseRefOf(sources) !== "head") {
      const engine =
        wired.length > 0 ? ", and the plugin's worktree engine decides while it is wired" : "";
      lines.push({
        ok: true,
        warn: true,
        text: `project: worktrees.base is ${worktrees.base}, not this repo's default branch ${defaultBranch}, and the project's settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead${engine}: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it`,
      });
    }
  }
  return lines;
}

/**
 * The `worktree.baseRef` the project's settings files set, or null. The last file that has
 * one wins, as Claude Code reads them (`settings.local.json` over `settings.json`).
 */
function baseRefOf(sources: string[]): string | null {
  let baseRef: string | null = null;
  for (const file of sources) {
    if (!existsSync(file)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) continue;
      const worktree = (parsed as { worktree?: unknown }).worktree;
      if (typeof worktree !== "object" || worktree === null) continue;
      const value = (worktree as { baseRef?: unknown }).baseRef;
      if (typeof value === "string") baseRef = value;
    } catch {
      // A settings file that is not JSON: Claude Code cannot read it either.
    }
  }
  return baseRef;
}

interface PluginHook {
  name: string;
  event: string;
  /** The tools (or sources) its matcher lists; [null] for an event without a matcher. */
  subjects: Array<string | null>;
}

/**
 * The hooks the plugin's hooks.json wires: each bundle's name, event and matcher's names.
 *
 * The handlers are shell form (`.claude/rules/hooks.md`), so the bundle is the one path under
 * `dist/` in the handler's command: `"…/bin/cc-smart-dev-kit-bun.sh" --missing=<mode>
 * "…/dist/<name>.js"`. A handler with no such path is not one of ours and is skipped.
 */
export function readPluginHooks(file: string): PluginHook[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
  };
  return Object.entries(parsed.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      (group.hooks ?? []).flatMap((handler) => {
        const bundle = /\/dist\/([a-z-]+)\.js(?:["'\s]|$)/.exec(handler.command ?? "")?.[1];
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
  config: CcSmartDevKitConfig,
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
    if ((RETIRED_HOOK_NAMES as readonly string[]).includes(name)) {
      // No hook of that name runs any more: the entry keeps nothing quiet, and only costs a
      // reader a question.
      lines.push({
        ok: true,
        info: true,
        text: `project: .claude/cc-smart-dev-kit.json lists ${name} in ownHooks, a plugin hook that is retired: it silences nothing. Take "${name}" out of ownHooks`,
      });
      continue;
    }
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
            text: `project: the plugin's ${name} is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone`,
          }
        : {
            ok: true,
            warn: true,
            text: `project: .claude/cc-smart-dev-kit.json lists ${name} in ownHooks, so the plugin's ${name} is off here, but the project's settings wire no hook on ${entries.map((hook) => onEvent(hook.event, hook.subjects)).join(", ") || "its event"}: nothing answers in its place. Take "${name}" out of ownHooks once the project's copy is gone`,
          },
    );
  }
  const found = new Map<string, { hook: PluginHook; handler: WiredHandler; subjects: string[] }>();
  for (const hook of pluginHooks) {
    if (own.includes(hook.name)) continue;
    // A machine-wide hook (stop-failure, update-check, notify, agent-guard, fable-session)
    // answers about the machine, not this project: a project hook on its event is the person's
    // own business, not a second copy of a plugin piece, so nothing warns about it.
    if (MACHINE_WIDE_HOOKS.includes(hook.name)) continue;
    for (const subject of hook.subjects) {
      for (const handler of sources.flatMap((file) => wiredHandlers(file, hook.event, subject))) {
        // The engine's own lines (`cc-smart-dev-kit hook subagent-stop`) are the plugin's
        // project-wired hooks, never a copy of this one: `SubagentStop` carries both, and the
        // engine's own check above judges them. Only a different command may be a copy.
        if (PROJECT_HOOKS.some((spec) => runsProjectHook(handler.command, spec.name))) continue;
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
      text: `project: the plugin's ${hook.name} and the project's ${handler.command} (${shown(handler.file, projectDir, home)}) both run on ${onEvent(hook.event, subjects)}, so both may answer. If that is the project's own copy of ${hook.name}, list "${hook.name}" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed`,
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
  let config: CcSmartDevKitConfig | null;
  try {
    config = loadProjectConfig(checkout).config;
  } catch (error) {
    if (!(error instanceof CcSmartDevKitConfigError)) throw error;
    return [{ ok: false, text: `project: ${error.message}` }];
  }
  const lines = [
    ...oldNameLines(projectDir, sources, paths.home),
    ...worktreeLines(config, sources, projectDir, checkout, paths, env),
  ];
  // Without cc-smart-dev-kit.json every plugin hook is silent: nothing can answer twice.
  if (config !== null) {
    lines.push(...ownCopyLines(config, sources, pluginHooksFile, projectDir, paths.home));
  }
  return lines;
}
