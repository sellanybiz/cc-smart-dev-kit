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
 *   (`MACHINE_WIDE_HOOKS`: the user hooks stop-failure, update-check, notify and
 *   playwright-output, and the specs that run with or without the project's file, such as
 *   `fable-session`, `keep-going` and `agent-usage`) are never warned about: they
 *   answer about the machine, so a project hook beside one is not a copy of a plugin piece.
 *   A retired hook name in `ownHooks` (`RETIRED_HOOK_NAMES`) is information: it silences
 *   nothing, and can be taken out.
 * - **Size fields in `jobs.kinds`.** The heavy-job queue counts jobs, not gigabytes
 *   (`src/jobs/kinds.ts`). A project file written for an older plugin may still set `gb`,
 *   `filesGb`, `maxFiles` or `workers` on a kind (`IGNORED_KIND_FIELDS`): it parses, the queue
 *   ignores every one, and one information line says so once, with the fix.
 * - **A shadcn/ui project without raw-control lint restrictions.** The checkout root and
 *   named workspaces get an information line pointing to the React lint recipe. Configs
 *   are only read, never executed or edited; a read failure stays information too.
 * - **A git too old for the review gate's measure.** In a project with a `cc-smart-dev-kit.json`,
 *   git older than 2.40 is a warning: a review then counts for its exact commit only (D17).
 * - **Deploy tasks (5.0.0).** A `✗` line for each kind of finding in the task folders (fix:
 *   `task check`); the 4.x top-level files as a `!` line (recreate or delete); each `tasks`
 *   field nothing reads any more (`IGNORED_TASK_FIELDS`) as a `!` line (fix: `project init`);
 *   a `requires` below 5.0 while deploy folders exist; and a deploy-skill block that is out of
 *   date (`staleBlocks`; fix: `project init`, or by hand where init will not write the file).
 *
 * The project's settings are read where Claude Code reads them: `$CLAUDE_PROJECT_DIR` when
 * it is set (doctor run from a session), else the checkout of the folder doctor runs in.
 * Outside a git project it says nothing.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { COMMAND, PLUGIN_UPDATE_COMMAND } from "../build-info";
import { PLUGIN } from "../build-info/names";
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
  CcSmartDevKitVersionError,
  DEPLOY_TASKS_SINCE,
  IGNORED_TASK_FIELDS,
  RETIRED_HOOK_NAMES,
  UNSWITCHABLE_HOOK_NAMES,
  WORKFLOW_ALLOW_KEYS_SINCE,
  WORKTREE_ENGINE_RETIRED_IN,
} from "../project/config";
import { findDeploySkills, skillsFolderLink, staleBlocks } from "../project/deploy-skill";
import { hasDeployTaskFolders, requiresFloor, requiresFor, requiresTooLow } from "../project/init";
import {
  type Checkout,
  checkoutFailure,
  loadProjectConfig,
  locateCheckoutAsync,
} from "../project/resolve";
import { isObject } from "../setup/managed-json";
import { parseUserJson, readUserJson } from "../setup/user-json";
import { taskContext } from "../tasks/context";
import { checkDeployTasks, type DeployTaskFinding } from "../tasks/deploy/check";
import { oldTaskFiles } from "../tasks/deploy/files";
import { allTasks, isOpen, livePhaseCount } from "../tasks/work/queries";
import { readWorkStore } from "../tasks/work/read";
import { type GhExec, runGh } from "../workflow/merge-check";
import { resolvePlans } from "../workflow/resolve";
import { parseGitVersion, tooOldToCover } from "../workflow/review-cover";
import { oldNamesIn, workflowDefaults } from "../workflow/schema";
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

/** A retired review agent is still parsed, so doctor can explain how to migrate it. */
const OLD_REVIEW_AGENT = `${PLUGIN}:reviewer`;
const NEW_REVIEW_AGENT = workflowDefaults.reviewAgents[0];
const REPLACE_REVIEW_AGENT = `replace the old id ${OLD_REVIEW_AGENT} with the new one ${NEW_REVIEW_AGENT}`;

/** Shared by the project and machine checks; never rewrites the person's settings. */
export function retiredReviewAgentCheck(
  file: string,
  label: string,
  personal = false,
): Check | null {
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = readUserJson(file);
  } catch (error) {
    return {
      ok: false,
      text: `${label} cannot be read (${message(error)})`,
      fix: "correct the JSON in this file",
    };
  }
  const workflow = personal ? parsed : isObject(parsed) ? parsed.workflow : null;
  if (
    !isObject(workflow) ||
    !Array.isArray(workflow.reviewAgents) ||
    !workflow.reviewAgents.includes(OLD_REVIEW_AGENT)
  )
    return null;
  return {
    ok: false,
    text: `${label} names the retired ${OLD_REVIEW_AGENT} in ${personal ? "reviewAgents" : "workflow.reviewAgents"}`,
    fix: personal
      ? `${REPLACE_REVIEW_AGENT}: run ${COMMAND} workflow set reviewAgents ${NEW_REVIEW_AGENT}, or ${COMMAND} workflow unset reviewAgents to use the default; personal changes count at once`
      : `${REPLACE_REVIEW_AGENT}, then merge that change by hand or run ${COMMAND} workflow review-done, because merge-check judges with the base branch's list`,
  };
}

/**
 * One line for a workflow file that still holds an old setting name (`autoPush`, now `allowPush`;
 * `WORKFLOW_KEY_ALIASES`), or null. The old name keeps working, so it is a warning with the
 * rename, never a failure. A file that holds both names says to remove the old one: the new one
 * wins already. A project's file also gets the cost of the new name: `requires` rises to
 * 6.1 (`WORKFLOW_ALLOW_KEYS_SINCE`), which a teammate on an older plugin hears as "update". A file
 * that is missing or cannot be read is the other checks' to say, so it gives null here.
 */
export function oldWorkflowNamesCheck(file: string, label: string, personal = false): Check | null {
  let parsed: unknown;
  try {
    parsed = existsSync(file) ? readUserJson(file) : null;
  } catch {
    return null;
  }
  const workflow = personal || !isObject(parsed) ? parsed : parsed.workflow;
  if (!isObject(workflow)) return null;
  const found = oldNamesIn(workflow);
  if (found.length === 0) return null;
  const typedValue = (old: string) =>
    typeof workflow[old] === "boolean" ? String(workflow[old]) : "<true|false>";
  const steps = found.map(({ old, current, both }) => {
    if (both) return `remove ${old} from this file: ${current} is set there and wins`;
    const command = `${COMMAND} workflow set ${current} ${typedValue(old)}`;
    return personal
      ? `run ${command}`
      : `rename ${old} to ${current} in this file, or run ${command} --project (a file with the new name needs requires "${requiresFor(WORKFLOW_ALLOW_KEYS_SINCE)}")`;
  });
  const waiting = found.filter(({ both }) => !both).length;
  if (waiting > 0) {
    steps.push(`the old name${waiting === 1 ? " keeps" : "s keep"} working until then`);
  }
  const names = found.map(({ old, current }) => `${old} (now ${current})`).join(", ");
  return {
    ok: true,
    warn: true,
    text: `${label} uses the old setting name${found.length === 1 ? "" : "s"} ${names}`,
    fix: steps.join("; "),
  };
}

/**
 * The files `pattern` finds under `folder`. A folder this user may not read (mode 000) makes
 * the scan throw: the scan then ends with the files it found so far, so doctor still runs and
 * reports what it could read. These are optional instruction files; one it cannot read is one
 * Claude Code cannot load either.
 */
function readableMatches(pattern: string, folder: string): string[] {
  const found: string[] = [];
  try {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: folder, onlyFiles: true })) {
      found.push(file);
    }
  } catch {
    // The scan stops at the folder it cannot read; the files found before it stay, and an
    // unreadable folder is skipped as an unreadable file is below.
  }
  return found;
}

/** The memory files Claude Code loads from a project folder, relative to that folder. */
export const PROJECT_MEMORY_FILES = ["CLAUDE.md", join(".claude", "CLAUDE.md"), "CLAUDE.local.md"];

/**
 * The project's instruction files that still name the retired review agent: a `!` each. They
 * are the memory files at the project's root (`PROJECT_MEMORY_FILES`) and the Markdown, at any
 * depth, in `.claude/`'s add-ons, rules, agents, skills, commands and output styles, each named
 * relative to the project.
 */
function retiredReviewMentions(projectDir: string): ProjectLine[] {
  const folder = join(projectDir, ".claude");
  // One scan per folder, so a folder that cannot be read never hides the others.
  const inClaude = existsSync(folder)
    ? [
        `${PLUGIN}/**/*.md`,
        "rules/**/*.md",
        "agents/**/*.md",
        "skills/**/*.md",
        "commands/**/*.md",
        "output-styles/**/*.md",
      ]
        .flatMap((pattern) => readableMatches(pattern, folder))
        .map((file) => join(".claude", file))
    : [];
  const files = [
    ...PROJECT_MEMORY_FILES.filter((name) => existsSync(join(projectDir, name))),
    ...inClaude,
  ].sort();
  return files
    .filter((file) => {
      try {
        return readFileSync(join(projectDir, file), "utf8").includes(OLD_REVIEW_AGENT);
      } catch {
        // An optional instruction file can be private or removed during the scan.
        return false;
      }
    })
    .map((file) => ({
      ok: true,
      warn: true,
      text: `project: ${file} mentions the retired ${OLD_REVIEW_AGENT}`,
      fix: REPLACE_REVIEW_AGENT,
    }));
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
    // A machine-wide hook (stop-failure, update-check, notify, fable-session)
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
      ? `The plugin's ${hook.name} cannot be switched off (it queues heavy commands): remove the project's copy, or keep it knowing both answer`
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
 * of it, instead of saying "update" (a `workflow.issues` group, from 1.4.0, under `>=1.0`). A
 * file with no `requires`, or one in a form not read there, is not judged. `workflow set --project` and `project init` both raise it.
 */
function requiresLines(
  configFile: string,
  projectDir: string,
  home: string,
  usesDeployTasks: boolean,
): ProjectLine[] {
  let file: unknown;
  try {
    file = readUserJson(configFile);
  } catch {
    // The load above read this file already, so a failure here is a race: the next run says.
    return [];
  }
  if (!isObject(file)) return [];
  // Deploy task folders need the plugin that reads them (5.0.0) even when no field says so: a
  // 4.x plugin shows nothing of them. Only `project init` knows them; `workflow set` does not.
  const needed = requiresFloor(file, { deployTasks: usesDeployTasks });
  if (!requiresTooLow(file.requires, needed.version)) return [];
  const byDeploy = usesDeployTasks && needed.version !== requiresFloor(file).version;
  return [
    {
      ok: true,
      warn: true,
      text: `project: ${shown(configFile, projectDir, home)} says requires "${String(file.requires)}", but its fields${byDeploy ? " and its deploy tasks" : ""} need "${needed.floor}": a teammate on an older plugin gets the whole file refused instead of "update"`,
      fix: byDeploy
        ? `${COMMAND} project init raises it to "${needed.floor}"`
        : `${COMMAND} project init (or any ${COMMAND} workflow set … --project) raises it to "${needed.floor}"`,
    },
  ];
}

/**
 * One `!` line for each `tasks` field the file still sets that nothing reads since
 * `DEPLOY_TASKS_SINCE` (`IGNORED_TASK_FIELDS`): the file loads, so nothing fails, and
 * `project init` takes them out.
 */
function ignoredTaskFieldLines(
  config: CcSmartDevKitConfig | null,
  configFile: string | null,
  projectDir: string,
  home: string,
): ProjectLine[] {
  if (config === null || configFile === null) return [];
  return IGNORED_TASK_FIELDS.filter((field) => config.tasks?.[field] !== undefined).map(
    (field) => ({
      ok: true,
      warn: true,
      text: `project: ${shown(configFile, projectDir, home)} sets tasks.${field}, no longer read since ${DEPLOY_TASKS_SINCE}: remove it`,
      fix: `${COMMAND} project init removes it`,
    }),
  );
}

/**
 * True when the project uses deploy tasks: it has an environment folder, or a skill that holds
 * the kit's deploy block. Both need the plugin that reads them (`project init` raises `requires`
 * for either). A skill that cannot be read is not a holder here: `deployBlockLines` names it.
 */
function usesDeployTasksOf(root: string, config: CcSmartDevKitConfig | null): boolean {
  if (hasDeployTaskFolders(root, config?.tasks ?? {})) return true;
  try {
    return findDeploySkills(root).holders.length > 0;
  } catch {
    return false;
  }
}

/**
 * The deploy-skill block (`src/project/deploy-skill.ts`): one `!` line for each skill file whose
 * block is out of date, and one `·` line when the skills folder is a link out of the checkout,
 * which is not searched, in a project that uses deploy tasks. A block `project init` cannot
 * write (broken markers, a file outside the checkout) is fixed by hand.
 */
function deployBlockLines(root: string, usesDeployTasks: boolean): ProjectLine[] {
  try {
    const lines: ProjectLine[] = staleBlocks(root).map((stale) => ({
      ok: true,
      warn: true,
      text:
        stale.fix === "init"
          ? `project: the deploy-skill block in ${stale.shown} is out of date`
          : `project: the deploy-skill block in ${stale.shown} cannot be updated (${stale.why})`,
      fix:
        stale.fix === "init"
          ? `${COMMAND} project init rewrites it`
          : `correct that file by hand: ${COMMAND} cannot write it`,
    }));
    const link = skillsFolderLink(root);
    if (link !== null && usesDeployTasks)
      lines.push({
        ok: true,
        info: true,
        text: `project: ${link}, so the deploy-skill block there is not checked`,
      });
    return lines;
  } catch (error) {
    return [
      { ok: true, info: true, text: `project: deploy-skill block not checked, ${message(error)}` },
    ];
  }
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
      fix: "remove them from jobs.kinds: the queue runs one full heavy job per machine at a time, whatever a kind says",
    },
  ];
}

/** Strip JSONC comments and trailing commas without changing quoted strings. */
function parseLintJson(text: string): unknown {
  const uncommented = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) =>
    token.startsWith('"') ? token : " ",
  );
  return parseUserJson(
    uncommented.replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (token) =>
      token === "," ? "" : token,
    ),
  );
}

const MAX_LINT_CONFIG_BYTES = 1024 * 1024;

/** Inspect and bound one open descriptor; nonblocking open cannot wait for a FIFO writer. */
function readLintConfig(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_LINT_CONFIG_BYTES) {
      throw new Error("not a regular config file within the size limit");
    }
    const bytes = Buffer.alloc(MAX_LINT_CONFIG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_LINT_CONFIG_BYTES) throw new Error("config exceeds the size limit");
    return bytes.toString("utf8", 0, length);
  } finally {
    closeSync(fd);
  }
}

/** A folder-level nudge: match directory coverage, not a guessed source filename. */
function overrideMatches(patterns: unknown, path: string): boolean {
  if (!Array.isArray(patterns)) return false;
  let included = false;
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    const excluded = pattern.startsWith("!");
    // Bun's **/* needs a filename; ** already matches the directory and its descendants.
    const positive = pattern.replace(/^!{1,2}/, "");
    const glob = new Bun.Glob(positive === "**/*" ? "**" : positive.replace(/\/\*\*\/\*$/, "/**"));
    if (glob.match(path)) included = !excluded;
  }
  return included;
}

/** Merge only the relevant linter settings, in matching override order. */
function biomeRestriction(value: unknown, path: string): boolean {
  if (!isObject(value)) return false;
  let enabled = true;
  let level: unknown;
  let elements: unknown;
  const apply = (block: Record<string, unknown>) => {
    if (!isObject(block.linter)) return;
    const linter = block.linter;
    if (typeof linter.enabled === "boolean") enabled = linter.enabled;
    const rules = isObject(linter.rules) ? linter.rules : null;
    const correctness = rules && isObject(rules.correctness) ? rules.correctness : null;
    const rule = correctness?.noRestrictedElements;
    if (typeof rule === "string") level = rule;
    else if (isObject(rule)) {
      if (rule.level !== undefined) level = rule.level;
      if (isObject(rule.options) && rule.options.elements !== undefined)
        elements = rule.options.elements;
    }
  };
  apply(value);
  if (Array.isArray(value.overrides)) {
    for (const override of value.overrides) {
      if (isObject(override) && overrideMatches(override.includes, path)) apply(override);
    }
  }
  return enabled && level !== "off" && isObject(elements) && Object.keys(elements).length > 0;
}

function eslintRestriction(text: string): boolean {
  return (
    text.includes("forbid-elements") ||
    (text.includes("no-restricted-syntax") && text.includes("JSXOpeningElement"))
  );
}

type LintRestriction = { restricted: boolean; unreadable: string[] };

/** ESLint is read as text, never executed: this is a nudge, not a proof of enforcement. */
function lintRestriction(folder: string, projectFolder: string): LintRestriction {
  const result: LintRestriction = { restricted: false, unreadable: [] };
  let files: string[];
  try {
    files = readdirSync(folder);
  } catch {
    return { restricted: false, unreadable: ["linter configs"] };
  }
  for (const file of files.sort()) {
    const biome = file === "biome.json" || file === "biome.jsonc";
    const eslint = /^eslint\.config\.(js|mjs|cjs|ts)$/.test(file) || file.startsWith(".eslintrc");
    const packageConfig = file === "package.json";
    if (!biome && !eslint && !packageConfig) continue;
    try {
      const text = readLintConfig(join(folder, file));
      if (packageConfig) {
        const pkg = parseUserJson(text);
        result.restricted ||=
          isObject(pkg) && eslintRestriction(JSON.stringify(pkg.eslintConfig) ?? "");
      } else {
        const path = relative(folder, projectFolder).replaceAll("\\", "/");
        result.restricted ||= biome
          ? biomeRestriction(parseLintJson(text), path === "" ? "" : `${path}/`)
          : eslintRestriction(text);
      }
    } catch {
      result.unreadable.push(file);
    }
  }
  return result;
}

/** Root plus package.json workspaces: plain folders and one-level dir/* patterns only. */
function shadcnFolders(root: string): { folders: string[]; lines: ProjectLine[] } {
  const folders = new Map([[realpathSync(root), root]]);
  const lines: ProjectLine[] = [];
  const addFolder = (folder: string) => {
    try {
      const target = realpathSync(folder);
      const rel = relative(realpathSync(root), target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return;
      if (statSync(folder).isDirectory() && !folders.has(target)) folders.set(target, folder);
    } catch {
      // A broken symlink or a disappearing workspace is not a project doctor can check.
    }
  };
  const packageFile = join(root, "package.json");
  if (existsSync(packageFile)) {
    try {
      const pkg = parseUserJson(readLintConfig(packageFile));
      const workspaces = isObject(pkg) ? pkg.workspaces : null;
      const entries = Array.isArray(workspaces)
        ? workspaces
        : isObject(workspaces) && Array.isArray(workspaces.packages)
          ? workspaces.packages
          : [];
      for (const entry of entries) {
        if (typeof entry !== "string" || isAbsolute(entry)) continue;
        const folder = resolve(root, entry.replace(/\/\*$/, ""));
        const rel = relative(root, folder);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        if (entry.endsWith("/*") && !entry.slice(0, -2).includes("*")) {
          if (!existsSync(folder)) continue;
          const realFolder = realpathSync(folder);
          const realRel = relative(realpathSync(root), realFolder);
          if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) continue;
          for (const child of readdirSync(folder).sort()) addFolder(join(folder, child));
        } else if (!entry.includes("*")) addFolder(folder);
      }
    } catch {
      lines.push({
        ok: true,
        info: true,
        text: "project: could not check shadcn/ui workspaces from package.json",
      });
    }
  }
  return {
    folders: [...folders.values()]
      .filter((folder) => existsSync(join(folder, "components.json")))
      .sort(),
    lines,
  };
}

/** One info-only lint recipe per shadcn project, with a root rule covering its workspaces. */
function shadcnLintLines(root: string): ProjectLine[] {
  const { folders, lines } = shadcnFolders(root);
  if (folders.length === 0) return lines;
  for (const folder of folders) {
    const rootLint = lintRestriction(root, folder);
    const local = folder === root ? rootLint : lintRestriction(folder, folder);
    if (rootLint.restricted || local.restricted) continue;
    const label = relative(root, folder).replaceAll("\\", "/") || ".";
    const unreadable = [...new Set([...rootLint.unreadable, ...local.unreadable])];
    if (unreadable.length > 0) {
      lines.push({
        ok: true,
        info: true,
        text: `project: ${label} uses shadcn/ui; could not check raw HTML control restrictions (${unreadable.join(", ")} could not be read or parsed)`,
      });
    } else {
      lines.push({
        ok: true,
        info: true,
        text: `project: ${label} uses shadcn/ui without a lint rule against raw HTML controls`,
        fix: `add a restriction using the lint recipe in /${PLUGIN}:react-best-practices`,
      });
    }
  }
  return lines;
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
        // `project init` never changes which plugin versions a `requires` range lets in.
        fix:
          error instanceof CcSmartDevKitVersionError
            ? "do what this line says"
            : `correct the file as this line says, or run: ${COMMAND} project init`,
      },
      ...engine,
    ];
  }
  const usesDeployTasks = usesDeployTasksOf(checkout.root, config);
  const retired =
    configFile === null
      ? null
      : retiredReviewAgentCheck(
          configFile,
          `project: ${shown(configFile, projectDir, paths.home)}`,
        );
  const oldNames =
    configFile === null
      ? null
      : oldWorkflowNamesCheck(configFile, `project: ${shown(configFile, projectDir, paths.home)}`);
  const lines = [
    ...(retired === null ? [] : [retired]),
    ...(oldNames === null ? [] : [oldNames]),
    ...retiredReviewMentions(projectDir),
    ...oldNameLines(projectDir, sources, paths.home),
    ...engine,
    ...(configFile === null
      ? []
      : requiresLines(configFile, projectDir, paths.home, usesDeployTasks)),
    ...ignoredTaskFieldLines(config, configFile, projectDir, paths.home),
    ...jobKindLines(config, configFile, projectDir, paths.home),
    ...shadcnLintLines(checkout.root),
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
  lines.push(...deployBlockLines(checkout.root, usesDeployTasks));
  lines.push(...planCapChecks(checkout.root, env, paths, config));
  return lines;
}

/**
 * One `!` line for each open plan of this project that holds more phases than
 * `plans.maxPhases` allows: such a plan runs on but takes no new phase (the store refuses one).
 * A work store that is missing or cannot be read says nothing here: the work-store checks name it.
 */
export function planCapChecks(
  cwd: string,
  env: Env,
  paths: CliPaths,
  config: CcSmartDevKitConfig | null,
): Check[] {
  const context = taskContext(cwd, env);
  // `projectTaskChecks` already says a folder whose project cannot be found.
  if (!context.ok) return [];
  let cap: ReturnType<typeof resolvePlans>["maxPhases"];
  try {
    cap = resolvePlans(paths, config).maxPhases;
  } catch (error) {
    return [{ ok: true, info: true, text: `project plans: not checked, ${message(error)}` }];
  }
  const read = readWorkStore(paths, (db) => allTasks(db, context.project));
  if (read.state !== "ready") return [];
  const tasks = read.value;
  return tasks
    .filter((t) => t.kind === "plan" && t.plan !== null && isOpen(t))
    .flatMap((plan) => {
      const count = livePhaseCount(tasks, plan.plan ?? "");
      if (count <= cap.value) return [];
      return [
        {
          ok: true,
          warn: true,
          text: `project plans: plan "${plan.plan}" (#${plan.number}) holds ${count} phases, over the plans.maxPhases cap of ${cap.value} (${cap.source}): it is frozen and takes no new phase`,
          fix: "finish it, or re-plan its remaining work as plans within the cap",
        } satisfies Check,
      ];
    });
}

type FindingKind = Exclude<DeployTaskFinding["kind"], "old-files">;

/**
 * What each kind of finding is called in doctor's lines, singular and plural, in plain words.
 * `warn` marks the kinds that are advice (a task left open a long time, a repeated title): they
 * block nothing, so they are `!`, never `✗`. `{days}` is `tasks.staleDays`.
 */
const FINDING_WORDS: Record<FindingKind, { one: string; many: string; warn?: true }> = {
  "broken-file": { one: "broken task file", many: "broken task files" },
  "duplicate-id": {
    one: "task id used by more than one file",
    many: "task ids used by more than one file",
  },
  "twin-missing": { one: "twin that names no task", many: "twins that name no task" },
  "open-in-archive": {
    one: "open task left in archive/",
    many: "open tasks left in archive/",
  },
  "broken-ref": { one: "missing reference", many: "missing references" },
  stale: {
    one: "task open for over {days} days",
    many: "tasks open for over {days} days",
    warn: true,
  },
  "duplicate-title": { one: "repeated title", many: "repeated titles", warn: true },
};

/**
 * The deploy tasks' findings (`checkDeployTasks`): one line for each kind, with the fix
 * `task check` (`✗`, or `!` for the advice kinds in `FINDING_WORDS`); the old 4.x files as one
 * `!` line (nothing is wrong with the tasks, the files are only not read); and "no findings"
 * when there is nothing at all.
 */
export async function projectTaskChecks(cwd: string, env: Env): Promise<Check[]> {
  const context = taskContext(cwd, env);
  if (!context.ok)
    return [
      { ok: false, text: `deploy tasks: ${context.why}`, fix: `run \`${COMMAND} task check\`` },
    ];
  if (context.checkoutRoot === null) return [];
  const tasks = context.projectTasks;
  if (!tasks.ok)
    return [
      { ok: false, text: `deploy tasks: ${tasks.why}`, fix: `run \`${COMMAND} task check\`` },
    ];
  if (!existsSync(tasks.dir)) return [];
  const lines: Check[] = [];
  try {
    const findings = checkDeployTasks({
      checkoutRoot: context.checkoutRoot,
      dir: tasks.dir,
      settings: { staleDays: tasks.staleDays },
      now: new Date(),
    });
    const counts = new Map<FindingKind, number>();
    for (const finding of findings)
      if (finding.kind !== "old-files")
        counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
    const fix = `run \`${COMMAND} task check\``;
    const found = [...counts].map(([kind, count]): Check => {
      const words = FINDING_WORDS[kind];
      const text = `deploy tasks: ${count} ${(count === 1 ? words.one : words.many).replace("{days}", String(tasks.staleDays))}`;
      return words.warn === true ? { ok: true, warn: true, text, fix } : { ok: false, text, fix };
    });
    // The failures first, then the warnings.
    lines.push(...found.filter((line) => !line.ok), ...found.filter((line) => line.ok));
    const old = oldTaskFiles(tasks.dir).length;
    if (old > 0) {
      const many = old > 1;
      lines.push({
        ok: true,
        warn: true,
        text: `deploy tasks: ${old} old task ${many ? "files are" : "file is"} not read since ${DEPLOY_TASKS_SINCE}`,
        fix: `recreate ${many ? "each" : "it"} as a deploy task, or delete it (\`${COMMAND} task check\` names ${many ? "them" : "it"})`,
      });
    }
    if (lines.length === 0) lines.push({ ok: true, text: "deploy tasks: no findings" });
    return lines;
  } catch (error) {
    return [
      { ok: false, text: `deploy tasks: ${message(error)}`, fix: `run \`${COMMAND} task check\`` },
    ];
  }
}

/**
 * One `!` line when this git is too old to measure a change made after a review
 * (`MIN_COVER_GIT`, `src/workflow/review-cover.ts`): the review gate then counts a review of
 * the exact head only, so every fix needs a review of its own.
 */
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
