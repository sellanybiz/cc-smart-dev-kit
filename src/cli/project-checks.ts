/**
 * `doctor`'s checks of the project in the folder it runs in:
 *
 * - **The worktree engine is wired as `anymodel.json` says.** With `worktrees`, the project's
 *   settings must wire WorktreeCreate, WorktreeRemove and SubagentStop to
 *   `anymodel hook <name>`; wired without `worktrees`, every worktree would fail. Next to the
 *   engine, a second WorktreeCreate hook (the project's or the user's) would make a second
 *   worktree for each request (Claude Code runs both: `docs/claude-code-contract.md`).
 * - **Which plugin hooks a project hook silences**, as information: the defer check is
 *   coarse (any project hook on the same event and tool silences the plugin's), so doctor
 *   names each one it finds.
 *
 * Outside a git project it says nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { deferSources, type WiredHandler, wiredHandlers } from "../hooks/defer";
import { runsProjectHook } from "../hooks/project-wiring";
import { PROJECT_HOOKS } from "../hooks/specs";
import { type AnymodelConfig, AnymodelConfigError } from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type CliPaths, tildify } from "./paths";

export interface ProjectLine {
  ok: boolean;
  /** Information only, never a failure. */
  info?: boolean;
  text: string;
}

type Env = Record<string, string | undefined>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A settings file as the person knows it: relative to the checkout, else with `~`. */
function shown(file: string, checkout: Checkout, home: string): string {
  return file.startsWith(`${checkout.root}/`)
    ? file.slice(checkout.root.length + 1)
    : tildify(file, home);
}

const ENGINE_HINT =
  "Run `anymodel hook` for the lines to paste (also in the anymodel README, § Worktrees)";

/** The worktree engine's wiring against `worktrees` in anymodel.json. */
function engineLines(
  config: AnymodelConfig | null,
  sources: string[],
  checkout: Checkout,
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
        text: `project: another WorktreeCreate hook runs too: ${other.command} (${shown(other.file, checkout, paths.home)}). Claude Code runs both and makes two worktrees for each request; remove one`,
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

/** One line for each project hook that silences a plugin hook (the defer check). */
function silencedLines(
  sources: string[],
  pluginHooksFile: string,
  checkout: Checkout,
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
  const found = new Map<string, { hook: PluginHook; handler: WiredHandler; subjects: string[] }>();
  for (const hook of pluginHooks) {
    for (const subject of hook.subjects) {
      for (const handler of sources.flatMap((file) => wiredHandlers(file, hook.event, subject))) {
        const key = JSON.stringify([hook.name, hook.event, handler.file, handler.command]);
        const entry = found.get(key) ?? { hook, handler, subjects: [] };
        if (subject !== null) entry.subjects.push(subject);
        found.set(key, entry);
      }
    }
  }
  return [...found.values()].map(({ hook, handler, subjects }) => ({
    ok: true,
    info: true,
    text: `project: the plugin's ${hook.name} is off here for ${hook.event}${subjects.length > 0 ? ` (${subjects.join(", ")})` : ""}: ${handler.command} (${shown(handler.file, checkout, home)}) runs on the same event`,
  }));
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
  const sources = deferSources(checkout);
  const lines: ProjectLine[] = [];
  try {
    const { config } = loadProjectConfig(checkout);
    lines.push(...engineLines(config, sources, checkout, paths));
  } catch (error) {
    if (!(error instanceof AnymodelConfigError)) throw error;
    lines.push({ ok: false, text: `project: ${error.message}` });
  }
  lines.push(...silencedLines(sources, pluginHooksFile, checkout, paths.home));
  return lines;
}
