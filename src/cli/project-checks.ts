/**
 * `doctor`'s checks of the project in the folder it runs in:
 *
 * - **The project still on the plugin's old `anymodel` name.** `.claude/anymodel.json`, a
 *   `.claude/anymodel/` folder and a settings hook that calls `~/.local/bin/anymodel` are
 *   left there by 0.2.x: `migrate` moves a machine's own files, never a project's, so each of
 *   them is a warning that names the new file, folder or command.
 * - **The retired worktree engine.** Every project uses Claude Code's own worktrees. A
 *   project file that still sets `worktrees.prefix`, `worktrees.setup` or `worktrees.engine`
 *   does not load, so it is the `✗ project:` parse line, which names the field and the fix. A
 *   settings line that still runs `cc-smart-dev-kit hook worktree-create|worktree-remove|
 *   subagent-stop` fails every time it runs: one `✗` line per settings file, found by its
 *   command text, naming `cc-smart-dev-kit project init` as the fix. `.claude/worktrees/` that
 *   is not git-ignored is a warning, and so is a base branch with no `worktree.baseRef`.
 * - **The project's own copies of plugin hooks.** Each hook `ownHooks` lists is off here
 *   (information); a listed one with no project hook on its event left to answer is a
 *   warning. A project hook on the same event and tool as a plugin hook the list does NOT
 *   name is a warning too: both run, so both may answer. The machine-wide hooks
 *   (`MACHINE_WIDE_HOOKS`: stop-failure, update-check, notify, playwright-output, and
 *   `agent-guard`, `fable-session`, `session-escape-guard`, `crew-role`, `lead-notes` and
 *   `agent-usage`, which run with or without the project's file) are never warned about: they
 *   answer about the machine, so a project hook beside one is not a copy of a plugin piece.
 *   A retired hook name in `ownHooks` (`RETIRED_HOOK_NAMES`) is information: it silences
 *   nothing, and can be taken out.
 * - **Size fields in `jobs.kinds`.** The heavy-job queue counts jobs, not gigabytes
 *   (`src/jobs/kinds.ts`). A project file written for an older plugin may still set `gb`,
 *   `filesGb`, `maxFiles` or `workers` on a kind (`IGNORED_KIND_FIELDS`): it parses, the queue
 *   ignores every one, and one information line says so once, with the fix.
 * - **A git too old for the review gate's measure.** In a project with a `cc-smart-dev-kit.json`,
 *   git older than 2.40 is a warning: a review then counts for its exact commit only (D17).
 *
 * The project's settings are read where Claude Code reads them: `$CLAUDE_PROJECT_DIR` when
 * it is set (doctor run from a session), else the checkout of the folder doctor runs in.
 * Outside a git project it says nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, PLUGIN_UPDATE_COMMAND } from "../build-info";
import { runGitAsync } from "../hooks/git";
import {
  allWiredHandlers,
  projectSettingsFiles,
  retiredEngineHookOf,
  type WiredHandler,
  wiredHandlers,
} from "../hooks/settings-hooks";
import { MACHINE_WIDE_HOOKS } from "../hooks/specs";
import { issuesChecks } from "../issues/doctor";
import { ignoredFieldsOf } from "../jobs/kinds";
import {
  type CcSmartDevKitConfig,
  CcSmartDevKitConfigError,
  RETIRED_HOOK_NAMES,
  UNSWITCHABLE_HOOK_NAMES,
  WORKTREE_ENGINE_RETIRED_IN,
} from "../project/config";
import { requiresFloor, requiresTooLow } from "../project/init";
import {
  type Checkout,
  checkoutFailure,
  loadProjectConfig,
  locateCheckoutAsync,
} from "../project/resolve";
import { isObject } from "../setup/managed-json";
import { readUserJson } from "../setup/user-json";
import { taskContext } from "../tasks/context";
import { checkProjectTasks } from "../tasks/project/check";
import { shippedIdsOn } from "../tasks/project/release";
import { type GhExec, runGh } from "../workflow/merge-check";
import { parseGitVersion, tooOldToCover } from "../workflow/review-cover";
import type { Check } from "./check";
import { type CliPaths, tildify } from "./paths";
import { defaultBranchOf, realRunnerAsync } from "./project-init";

/** One project line of doctor's report: a check like any other (`check.ts`). */
export type ProjectLine = Check;

type Env = Record<string, string | undefined>;

/** What fixes a git that cannot read this folder's checkout. */
const GIT_FIX = `check that git works in this folder (git status), then run: ${COMMAND} doctor`;

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
 * A settings line that still runs the retired worktree engine, found by its command text
 * (`retiredEngineHookOf`), never through the engine's own specs: one `✗` line per settings
 * file, because `cc-smart-dev-kit hook <name>` now exits 1 on every run (a non-blocking error,
 * so the session goes on), and a WorktreeCreate that fails stops every worktree from being
 * made. `project init` takes the lines out.
 */
function engineLines(sources: string[], projectDir: string, home: string): ProjectLine[] {
  const lines: ProjectLine[] = [];
  for (const file of sources) {
    const names = [
      ...new Set(
        allWiredHandlers(file)
          .map((handler) => retiredEngineHookOf(handler.command))
          .filter((name): name is string => name !== null),
      ),
    ];
    if (names.length === 0) continue;
    const hooks = names.map((name) => `${COMMAND} hook ${name}`).join(", ");
    lines.push({
      ok: false,
      text: `project: ${shown(file, projectDir, home)} still runs ${hooks}, retired with the plugin's worktree engine in ${WORKTREE_ENGINE_RETIRED_IN}, so ${names.length === 1 ? "it fails" : "each of them fails"} every time (Claude Code's own worktrees need no hook)`,
      fix: `${COMMAND} project init (it takes ${names.length === 1 ? "the line" : "those lines"} out)`,
    });
  }
  return lines;
}

/**
 * `doctor`'s checks of the worktrees in a project that opted into them (`worktrees`):
 *
 * - **`.claude/worktrees/` is git-ignored.** Claude Code puts its worktrees there; a repo
 *   that does not ignore the folder sees every worktree in `git status`. One `!` line.
 * - **A base branch that is not the default has `worktree.baseRef: "head"`.** Otherwise
 *   Claude Code cuts a new worktree from the default branch. One `!` line.
 */
async function worktreeLines(
  config: CcSmartDevKitConfig | null,
  sources: string[],
  checkout: Checkout,
  env: Env,
): Promise<ProjectLine[]> {
  const worktrees = config?.worktrees;
  const lines: ProjectLine[] = [];
  // Claude Code puts its worktrees under `<repo>/.claude/worktrees/`; a repo that does not
  // ignore the folder shows every worktree's files in `git status`. Only a project that
  // opted into the worktree workflow has the `worktrees` field, and only it gets told.
  if (worktrees !== undefined) {
    const ignored = (
      await runGitAsync(checkout.root, ["check-ignore", "-q", ".claude/worktrees/"], env)
    ).ok;
    if (!ignored) {
      lines.push({
        ok: true,
        warn: true,
        text: "project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add \".claude/worktrees/\" to the repo's .gitignore and commit it",
      });
    }
    // Claude Code cuts a new worktree from the default branch, unless the project's settings
    // say `baseRef: "head"`. A base branch that is not the default needs that line.
    const defaultBranch = await defaultBranchOf(realRunnerAsync(env), checkout.root);
    if (worktrees.base !== defaultBranch && baseRefOf(sources) !== "head") {
      lines.push({
        ok: true,
        warn: true,
        text: `project: worktrees.base is ${worktrees.base}, not this repo's default branch ${defaultBranch}, and the project's settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it`,
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
 * A plugin hook that only answers when the project sets one of its fields: while that field
 * is unset the hook is silent, so a project hook on its event is no second copy of it.
 * `verify-gate` answers only with `checks.fast`.
 */
const OPT_IN_HOOKS: Record<string, (config: CcSmartDevKitConfig) => boolean> = {
  "verify-gate": (config) => config.checks !== undefined,
};

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
      {
        ok: false,
        text: `cannot read the plugin's hooks (${pluginHooksFile}): ${message(error)}`,
        fix: PLUGIN_UPDATE_COMMAND,
      },
    ];
  }
  const own: string[] = config.ownHooks ?? [];
  const lines: ProjectLine[] = [];
  for (const name of own) {
    if ((UNSWITCHABLE_HOOK_NAMES as readonly string[]).includes(name)) {
      // The plugin cannot switch it off any more (it became `alwaysOn`): the entry keeps
      // nothing quiet, and only costs a reader a question.
      lines.push({
        ok: true,
        info: true,
        text: `project: .claude/cc-smart-dev-kit.json lists ${name} in ownHooks, a plugin hook no project can switch off any more: it silences nothing. Take "${name}" out of ownHooks`,
      });
      continue;
    }
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
    // A name a project can no longer switch off (`alwaysOn`, `UNSWITCHABLE_HOOK_NAMES`) does
    // not take the project's own copy off the warning: the plugin answers all the same.
    if (
      own.includes(hook.name) &&
      !(UNSWITCHABLE_HOOK_NAMES as readonly string[]).includes(hook.name)
    ) {
      continue;
    }
    // A machine-wide hook (stop-failure, update-check, notify, agent-guard, fable-session)
    // answers about the machine, not this project: a project hook on its event is the person's
    // own business, not a second copy of a plugin piece, so nothing warns about it.
    if (MACHINE_WIDE_HOOKS.includes(hook.name)) continue;
    // A project that did not set the hook's own field gets no advice about a copy: the plugin
    // hook stays silent there, so nothing runs twice (D48's `worktrees`, `checks.fast` here).
    const optIn = OPT_IN_HOOKS[hook.name];
    if (optIn !== undefined && !optIn(config)) continue;
    for (const subject of hook.subjects) {
      for (const handler of sources.flatMap((file) => wiredHandlers(file, hook.event, subject))) {
        // A retired engine line (`cc-smart-dev-kit hook subagent-stop`) is never a copy of this
        // one: `SubagentStop` carries both, and `engineLines` judges it. Only a different
        // command may be a copy.
        if (retiredEngineHookOf(handler.command) !== null) continue;
        const key = JSON.stringify([hook.name, hook.event, handler.file, handler.command]);
        const entry = found.get(key) ?? { hook, handler, subjects: [] };
        if (subject !== null) entry.subjects.push(subject);
        found.set(key, entry);
      }
    }
  }
  for (const { hook, handler, subjects } of found.values()) {
    const advice = (UNSWITCHABLE_HOOK_NAMES as readonly string[]).includes(hook.name)
      ? `The plugin's ${hook.name} cannot be switched off (it judges every launch): remove the project's copy, or keep it knowing both answer`
      : `If that is the project's own copy of ${hook.name}, list "${hook.name}" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed`;
    lines.push({
      ok: true,
      warn: true,
      text: `project: the plugin's ${hook.name} and the project's ${handler.command} (${shown(handler.file, projectDir, home)}) both run on ${onEvent(hook.event, subjects)}, so both may answer. ${advice}`,
    });
  }
  return lines;
}

/**
 * One `!` line when the file's `requires` lets in a plugin older than the one that brought a
 * field the file holds (`requiresFloor`): that plugin reads the file strictly and refuses all
 * of it, instead of saying "update". 1.2.0's `workflow set` left such files (a
 * `crew.handoffTokens` under `>=1.0`). A file with no `requires`, or one in a form not read
 * there, is not judged. `workflow set --project` and `project init` both raise it.
 */
function requiresLines(configFile: string, projectDir: string, home: string): ProjectLine[] {
  let file: unknown;
  try {
    file = readUserJson(configFile);
  } catch {
    // The load above read this file already, so a failure here is a race: the next run says.
    return [];
  }
  if (!isObject(file)) return [];
  const needed = requiresFloor(file);
  if (!requiresTooLow(file.requires, needed.version)) return [];
  return [
    {
      ok: true,
      warn: true,
      text: `project: ${shown(configFile, projectDir, home)} says requires "${String(file.requires)}", but its fields need "${needed.floor}": a teammate on an older plugin gets the whole file refused instead of "update"`,
      fix: `${COMMAND} project init (or any ${COMMAND} workflow set … --project) raises it to "${needed.floor}"`,
    },
  ];
}

/**
 * One information line, once for the whole file, when a kind in `jobs.kinds` still sets a field
 * that sized a job. The queue counts jobs now and ignores them all, so they can go; nothing is
 * wrong, so it is never a warning.
 */
function jobKindLines(
  config: CcSmartDevKitConfig | null,
  configFile: string | null,
  projectDir: string,
  home: string,
): ProjectLine[] {
  if (config === null || configFile === null) return [];
  const sized = Object.entries(config.jobs?.kinds ?? {})
    .map(([name, kind]) => ({ fields: ignoredFieldsOf(kind), name }))
    .filter((one) => one.fields.length > 0);
  if (sized.length === 0) return [];
  const where = sized.map((one) => `${one.name}: ${one.fields.join(", ")}`).join("; ");
  return [
    {
      ok: true,
      info: true,
      text: `project: ${shown(configFile, projectDir, home)} sets size fields in jobs.kinds (${where}) that the job queue ignores: it counts jobs now, not gigabytes`,
      fix: `remove them from jobs.kinds; how many heavy jobs run at once is your own setting: ${COMMAND} job set max-jobs <n>`,
    },
  ];
}

/** The project checks for the folder `cwd`; none outside git. */
export async function projectChecks(
  cwd: string,
  env: Env,
  paths: CliPaths,
  pluginHooksFile: string,
  gh: GhExec = runGh,
): Promise<ProjectLine[]> {
  if (Bun.which("git", { PATH: env.PATH ?? "" }) === null) {
    return [{ ok: true, info: true, text: "project: not checked, git is not on PATH" }];
  }
  let checkout: Checkout | null;
  try {
    checkout = existsSync(cwd) ? await locateCheckoutAsync(cwd, { env }) : null;
  } catch (error) {
    // The check prints its fix on its own line: the reason alone, not a timeout's whole message.
    return [{ ok: false, text: `project: ${checkoutFailure(error)}`, fix: GIT_FIX }];
  }
  if (checkout === null) return [];
  // Where Claude Code reads the project's settings: the folder the session started in.
  const projectDir =
    env.CLAUDE_PROJECT_DIR !== undefined && env.CLAUDE_PROJECT_DIR !== ""
      ? env.CLAUDE_PROJECT_DIR
      : checkout.root;
  const sources = projectSettingsFiles(projectDir);
  // Read before the project's file: a file the retired engine left fields in fails to load,
  // and its hook lines are named all the same — `project init` fixes both in one run.
  const engine = engineLines(sources, projectDir, paths.home);
  let config: CcSmartDevKitConfig | null;
  let configFile: string | null;
  try {
    ({ config, configFile } = loadProjectConfig(checkout));
  } catch (error) {
    if (!(error instanceof CcSmartDevKitConfigError)) throw error;
    return [
      {
        ok: false,
        text: `project: ${error.message}`,
        fix: `correct the file as this line says, or run: ${COMMAND} project init`,
      },
      ...engine,
    ];
  }
  const lines = [
    ...oldNameLines(projectDir, sources, paths.home),
    ...engine,
    ...(configFile === null ? [] : requiresLines(configFile, projectDir, paths.home)),
    ...jobKindLines(config, configFile, projectDir, paths.home),
    ...(await worktreeLines(config, sources, checkout, env)),
  ];
  // Without cc-smart-dev-kit.json every plugin hook is silent: nothing can answer twice.
  if (config !== null) {
    lines.push(...ownCopyLines(config, sources, pluginHooksFile, projectDir, paths.home));
    lines.push(...(await coverGitLines(checkout, env)));
  }
  // GitHub Issues (D67): a line only while the switch is on, from the person's file or the base's.
  lines.push(...(await issuesChecks({ cwd: checkout.root, env, gh, paths })));
  lines.push(...(await projectTaskChecks(checkout.root, env)));
  return lines;
}

/**
 * One `!` line when this git is too old to measure a change made after a review
 * (`MIN_COVER_GIT`, `src/workflow/review-cover.ts`): the review gate then counts a review of
 * the exact head only, so every fix needs a review of its own.
 */
export async function projectTaskChecks(cwd: string, env: Env): Promise<Check[]> {
  const context = taskContext(cwd, env);
  if (!context.ok)
    return [
      { ok: false, text: `project tasks: ${context.why}`, fix: `run \`${COMMAND} task check\`` },
    ];
  if (context.checkoutRoot === null) return [];
  const tasks = context.projectTasks;
  if (!tasks.ok)
    return [
      { ok: false, text: `project tasks: ${tasks.why}`, fix: `run \`${COMMAND} task check\`` },
    ];
  if (!existsSync(tasks.dir) && tasks.legacyFolders.length === 0) return [];
  const lines: Check[] = [];
  try {
    const branch = tasks.releaseBranch();
    const present = (
      await runGitAsync(
        context.checkoutRoot,
        ["rev-parse", "--verify", "--end-of-options", `${branch}^{commit}`],
        env,
      )
    ).ok;
    if (!present)
      lines.push({
        ok: true,
        info: true,
        text: `project tasks: release branch ${branch} is not available locally; missed releases were not checked`,
      });
    const findings = checkProjectTasks({
      checkoutRoot: context.checkoutRoot,
      dir: tasks.dir,
      settings: { staleDays: tasks.staleDays },
      now: new Date(),
      shippedIds: present
        ? shippedIdsOn(context.checkoutRoot, tasks.dir, branch)
        : new Set<string>(),
      legacyFolders: tasks.legacyFolders,
    });
    const counts = new Map<string, number>();
    for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
    for (const [kind, count] of counts)
      lines.push({
        ok: false,
        text: `project tasks: ${count} ${kind}`,
        fix: `run \`${COMMAND} task check\``,
      });
    if (findings.length === 0) lines.push({ ok: true, text: "project tasks: no findings" });
    return lines;
  } catch (error) {
    return [
      { ok: false, text: `project tasks: ${message(error)}`, fix: `run \`${COMMAND} task check\`` },
    ];
  }
}

async function coverGitLines(checkout: Checkout, env: Env): Promise<ProjectLine[]> {
  const version = parseGitVersion((await runGitAsync(checkout.root, ["--version"], env)).out);
  if (version === null || !tooOldToCover(version)) return [];
  return [
    {
      ok: true,
      warn: true,
      text: `project: git ${version} is older than 2.40, so fixes made after a review cannot be measured here: each fix then needs a review of the exact new head (update git)`,
    },
  ];
}
