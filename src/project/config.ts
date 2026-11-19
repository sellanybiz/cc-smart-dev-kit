import { existsSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { COMMAND, PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
import { type KindSpec, kindsSchema, type MatchRule, matchRuleSchema } from "../jobs/kinds";
import { isObject } from "../setup/managed-json";
import { parseUserJson, readUserJson } from "../setup/user-json";
import { shellSteps } from "../shell/command";
import { DEPLOY_ENVS } from "../tasks/deploy/format";
import { PERSONAL_ONLY_KEYS, PERSONAL_ONLY_REASONS, workflowSchema } from "../workflow/schema";
import { allowsNewer, isValidRange, lowestAllowed, satisfiesRange } from "./version-range";

/**
 * The hooks the plugin wires in `plugin/hooks/hooks.json`, by name: what `ownHooks` may list
 * to switch a plugin hook off. A test keeps it the same as `HOOKS` in `src/hooks/specs.ts`,
 * except the hooks marked `alwaysOn` (`session-escape-guard`, `job-route`): a project cannot
 * switch those off, so their names are not here.
 */
export const PLUGIN_HOOK_NAMES = [
  "git-guard",
  "merge-guard",
  "main-folder-guard",
  "agent-guard",
  "fable-session",
  "tier-view",
  "after-merge",
  "review-record",
  "subagent-background",
  "builder-finish",
  "verify-gate",
  "keep-going",
  "agent-usage",
  "worktree-leftovers",
  "session-name",
  "task-start",
  "deploy-guard",
] as const;

/** One name from `PLUGIN_HOOK_NAMES`. */
export type PluginHookName = (typeof PLUGIN_HOOK_NAMES)[number];

/**
 * The plugin hooks a project's `ownHooks` still ACCEPTS although listing them silences
 * nothing: a hook a later version took out (`RETIRED_HOOK_NAMES`), and one a project can no
 * longer switch off (`UNSWITCHABLE_HOOK_NAMES`). Refusing the name would fail the strict parse
 * of a project file written for an older plugin, and then every guard would ask on every call.
 * `doctor` says the name can go (`src/cli/project-checks.ts`).
 */
export const RETIRED_HOOK_NAMES = [
  // 0.6.0: the Serena MCP server went.
  "serena-root",
  // 2.0.0: crew sessions and leads went, with their two hooks.
  "crew-role",
  "lead-notes",
  // 4.3.0: messages to sessions in other repos no longer ask.
  "message-guard",
] as const;

/**
 * The plugin hooks a project can no longer switch off (`HookSpec.alwaysOn`) whose name a
 * project file may still list from before: `job-route` became the machine-wide Bash judge in
 * 1.0.0 (its launch judge must hold in every session, so the frame skips the `ownHooks` step),
 * and a file that listed it must keep parsing. It silences nothing now.
 */
export const UNSWITCHABLE_HOOK_NAMES = ["job-route"] as const;

/**
 * The plugin version that made `worktrees.prefix` optional. A project file written without
 * it needs at least this version: an older plugin still requires the field and refuses the
 * whole file, which would leave every guard asking. One home for the number.
 */
export const WORKTREE_PREFIX_OPTIONAL_SINCE = "0.5.2";

/** The release that retired the plugin's own worktree engine: its fields and its hooks. */
export const WORKTREE_ENGINE_RETIRED_IN = "1.0.0";

/**
 * The `worktrees` fields only the plugin's worktree engine read. The engine retired in
 * `WORKTREE_ENGINE_RETIRED_IN`, and every project uses Claude Code's own worktrees, so a file
 * that still sets one is REFUSED. The strict parse alone would call it an unknown field that
 * "a newer cc-smart-dev-kit may" know, which is wrong for a field that is gone, so
 * `checkCcSmartDevKitConfig` names each one and the fix first. `project init` removes them
 * (`src/project/init.ts`).
 */
export const RETIRED_WORKTREE_FIELDS = ["prefix", "setup", "engine"] as const;

/**
 * The release that brought `workflow.fixesAfterReview`. A project file
 * that sets one needs that plugin version or newer: an older plugin reads the file strictly
 * and refuses it whole (a field it does not know), and every guard then fails closed.
 */
export const WORKFLOW_FIXES_SINCE = "1.0.0";

/**
 * The release that brought `worktrees.autoClean` (D48). A project file that sets it needs that
 * plugin version or newer, for the same reason as `WORKFLOW_FIXES_SINCE`.
 */
export const WORKTREE_AUTO_CLEAN_SINCE = "1.0.0";

/** The release that brought project-owned disposable ignored paths. */
export const WORKTREE_REBUILDABLE_SINCE = "1.9.0";

/**
 * The release that brought `checks` (MD-3): a project names the fast check a session runs
 * before it stops. A project file that sets it needs that plugin version or newer, for the
 * same reason as `WORKFLOW_FIXES_SINCE`.
 */
export const CHECKS_SINCE = "1.1.0";

/**
 * The release that brought `workflow.issues` (D67): the switch for GitHub Issues. A project
 * file that sets it needs that plugin version or newer, for the same reason as
 * `WORKFLOW_FIXES_SINCE`.
 */
export const WORKFLOW_ISSUES_SINCE = "1.4.0";

/**
 * The release that brought `workflow.plans` (the most phases one plan may hold). A project file
 * that sets it needs that plugin version or newer, for the same reason as `WORKFLOW_FIXES_SINCE`.
 */
export const WORKFLOW_PLANS_SINCE = "4.8.0";

/**
 * The release that brought `workflow.plans.mergeFiles` (the paths every plan touches, which the
 * plans' overlap check leaves out). Gated per key: `workflow.plans` alone stays at
 * `WORKFLOW_PLANS_SINCE`, so a project that only caps its phases keeps its floor. A plugin
 * before this one reads `plans` strictly and refuses a file that names `mergeFiles`, so the
 * floor makes it say "update". Setting `plans.runMode` in a project file is refused outright
 * (`checkPersonalOnlyFields`), so it has no floor.
 */
export const WORKFLOW_MERGE_FILES_SINCE = "5.2.0";

/**
 * The fields of a heavy-job kind (`jobs.kinds.<name>`) that came after 0.5.2, with the release
 * that brought them: `noSlotForFiles` (a run on named files goes at once) in 1.5.0. A project
 * file whose kind sets one needs that plugin version or newer, for the same reason as
 * `WORKFLOW_FIXES_SINCE`: an older plugin reads a kind strictly and refuses the whole file. The
 * keys are typed from the kind's schema; `config.test.ts` fails when a new kind field has no
 * entry here.
 */
export const JOB_KIND_KEYS_SINCE: Readonly<Partial<Record<keyof KindSpec, string>>> = {
  noSlotForFiles: "1.5.0",
  // `light` (1.8.0) is ignored since 2.0 (`IGNORED_KIND_FIELDS`): it raises no floor, and
  // doctor says it can go.
};

/**
 * The release that brought `tasks.deployCommands` and the `deploy-guard` hook: the commands a
 * project deploys with, and the guard that asks before one runs while a blocking deploy task is
 * open. A project file that sets the field, or lists the hook in `ownHooks`, needs that plugin
 * version or newer, for the same reason as `DEPLOY_TASKS_SINCE`.
 */
export const DEPLOY_GUARD_SINCE = "5.3.0";

/**
 * The plugin hooks `ownHooks` may list that came after `ownHooks` itself (0.3.0), with the
 * release that brought each. Older plugins validate the names as an enum, so one they do not
 * know makes them refuse the whole file, and every guard in that project fails closed. A
 * project file that lists one needs that plugin version or newer, for the same reason as
 * `WORKFLOW_FIXES_SINCE`. A name from 0.5.2 or earlier needs no entry: 0.5.2 is the floor of every
 * file (`WORKTREE_PREFIX_OPTIONAL_SINCE`). The keys are typed from `PLUGIN_HOOK_NAMES`;
 * `config.test.ts` fails when a new hook name has no entry here.
 */
export const OWN_HOOK_NAMES_SINCE: Readonly<
  Partial<Record<PluginHookName | (typeof RETIRED_HOOK_NAMES)[number], string>>
> = {
  "subagent-background": "1.0.0",
  // Retired in 2.0.0, still accepted (RETIRED_HOOK_NAMES): a file that lists one still needs
  // the release that first took it.
  "crew-role": "1.0.0",
  "lead-notes": "1.0.0",
  "verify-gate": "1.1.0",
  "agent-usage": "1.1.0",
  "tier-view": "1.3.0",
  "task-start": "1.10.0",
  "keep-going": "2.0.0",
  "builder-finish": "2.0.0",
  "deploy-guard": DEPLOY_GUARD_SINCE,
};

/**
 * The release that brought `tasks` (D75): the project's own task files. A project file that
 * sets it needs that plugin version or newer, for the same reason as `WORKFLOW_FIXES_SINCE`.
 */
export const TASKS_SINCE = "1.10.0";

/**
 * The release that made the project's task files deploy tasks (prod and staging) and brought
 * `tasks.envs`. A project file that sets `envs` needs that plugin version or newer. A 4.x plugin
 * does not know `envs` and refuses the whole file, so the floor makes it say "update".
 */
export const DEPLOY_TASKS_SINCE = "5.0.0";

/** One deploy command: the command as typed, or a rule of the jobs grammar (`matchRuleSchema`). */
export type DeployCommandEntry = string | MatchRule;

/**
 * One entry of `tasks.deployCommands`: a string, or a rule of the jobs grammar. A string is ONE
 * plain command as typed (`"vercel --prod"`): the shell reader counts its commands, and any
 * separator or shell construct outside quotes (`;`, `&&`, `||`, `|`, `&`, a new line, `$(…)`, a
 * here-doc, a group) makes more than one, so it is refused with the fix. A rule is checked by
 * the jobs grammar; the entry stays a union, so the floor's drift test (`config.test.ts`) walks
 * the rule's keys. Kept as written: the guard turns a string into a rule when it loads. The
 * error's field path (`tasks.deployCommands.prod.0`) names the entry; a string's message also
 * quotes it.
 */
const deployCommandEntry = z
  .union([z.string(), matchRuleSchema], { error: "is not a command or a match rule" })
  .superRefine((entry, ctx) => {
    if (typeof entry !== "string") return;
    // A separator makes more than one step even when a side is empty (`vercel --prod;`).
    const steps = shellSteps(entry);
    if (steps.every((step) => step.text.trim() === ""))
      ctx.addIssue({
        code: "custom",
        message: `${JSON.stringify(entry)} holds no command: write one command, such as \`vercel --prod\``,
      });
    else if (steps.length > 1)
      ctx.addIssue({
        code: "custom",
        message: `${JSON.stringify(entry)} holds more than one command or a shell construct (;, &&, ||, |, &, a new line, $(…), a here-doc or a group): write one plain command, such as \`vercel --prod\`; extra words in a run still match`,
      });
  });

const deployCommandList = z
  .array(deployCommandEntry)
  .min(1, "is an empty list: list at least one command, or remove the key");

/** A path inside the checkout, written with `/`: never absolute, never `.` or `..` segments. */
const inCheckout = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !posix.isAbsolute(path) && !win32.isAbsolute(path) && !path.split(/[\\/]/).includes(".."),
    "must be relative to the checkout root, without ..",
  )
  .refine((path) => !path.includes("\\"), "use / as the separator")
  .refine((path) => !path.split("/").includes("."), "must not contain . segments");

/**
 * The `tasks` fields no one reads since `DEPLOY_TASKS_SINCE`: the release branch and the old
 * notes folders. They are accepted and ignored, not retired: a retired field fails every guard
 * closed, and `project init` cannot repair a file that does. `doctor` names them with the fix
 * (`project init` removes them). The schema entries and the list of names are one table.
 */
const IGNORED_TASK_SCHEMAS = {
  releaseBranch: z.string().trim().min(1).optional(),
  legacyFolders: z.array(inCheckout).optional(),
};
export const IGNORED_TASK_FIELDS = Object.keys(IGNORED_TASK_SCHEMAS) as ReadonlyArray<
  keyof typeof IGNORED_TASK_SCHEMAS
>;

/**
 * The per-project opt-in file, `.claude/cc-smart-dev-kit.json`.
 * Strict on purpose: a typo like `"worktree"` fails loudly instead of being ignored.
 */
export const ccSmartDevKitConfigSchema = z.strictObject({
  /** The plugin versions this project needs, as a semver range (">=1.2"). */
  requires: z
    .string()
    .refine(isValidRange, 'not a valid version range (like ">=1.2" or "^1.2")')
    .optional(),
  worktrees: z
    .strictObject({
      /**
       * The branch new worktrees start from ("dev"). Every project uses Claude Code's own
       * worktrees (`<repo>/.claude/worktrees/<name>`); this is the integration base the
       * after-merge and leftovers notes compare with.
       */
      base: z.string().min(1),
      /**
       * Refuse an Edit, Write or NotebookEdit of a file in the main checkout itself (not in
       * a worktree): there, every change goes in a worktree. Off when left out.
       */
      guardMainFolder: z.boolean().optional(),
      /**
       * Finished worktrees clean themselves (D48): after a merge into the base, and when a
       * session starts, the plugin runs the same safe clean as `worktrees --clean` in the
       * background (`src/worktrees/auto-clean.ts`). On when left out; `false` starts nothing.
       * A minor change to the contract (1.0.0): a project that sets it raises `requires` to `>=1.0`.
       */
      autoClean: z.boolean().optional(),
      /**
       * Ignored paths safe to lose when removing a worktree. Patterns match at any depth;
       * a folder ends in `/`. A project that sets this needs at least 1.9.0.
       */
      rebuildable: z
        .array(
          inCheckout.refine(
            // A dot alone names nothing either: `.*` would match every ignored dotfile,
            // `.env.local` included.
            (path) => /[^*?/[\]{},!.]/.test(path),
            "names nothing; list the folder or file name",
          ),
        )
        .optional(),
      /**
       * A branch-name prefix (ending in "/") to the base that branch family's pull requests
       * go into: `{"hotfix/": "main", "release/": "main"}`. Every other branch's requests go
       * into `base`. The longest prefix that matches wins (`baseForBranch`). The merge guard's
       * opening check, auto-merge and the after-merge note read it.
       */
      bases: z
        .record(z.string(), z.string().min(1))
        .refine((bases) => Object.keys(bases).every((prefix) => prefix.endsWith("/")), {
          // The key is the branch-name prefix, so the message says which one is wrong: a
          // `z.record` key schema's own message never reaches the person ("Invalid key in record").
          error: (issue) => {
            const given = issue.input;
            const wrong =
              typeof given === "object" && given !== null
                ? Object.keys(given).find((prefix) => !prefix.endsWith("/"))
                : undefined;
            return `"${wrong ?? "a prefix"}" must end with "/" (a branch-name prefix, like "release/")`;
          },
        })
        .optional(),
    })
    .optional(),
  /**
   * The branches the git guard asks about before a push to one of them, as git names them
   * (["main", "release"]). When left out: ["main"].
   */
  protectedBranches: z.array(z.string().min(1)).min(1).optional(),
  /**
   * The project's check commands. `fast` is the one a session runs before it stops: the
   * `verify-gate` hook blocks a stop **once** when this session changed files and no Bash call
   * ran `fast` after the last change. Write it as you would type it
   * (`"bun run typecheck && bun test src/changed"`); `project init` offers one read from
   * `package.json`'s scripts. Optional, and inside it `fast` is required: `{}` is refused.
   * A field of 1.1.0: a project that sets it raises `requires` to `>=1.1`.
   */
  checks: z.strictObject({ fast: z.string().trim().min(1) }).optional(),
  /** Each session names itself after its task: a note at its start, the title at the next prompt. */
  sessionNames: z.boolean().optional(),
  /** Turn on the opt-in instructions for this project. */
  instructions: z.boolean().optional(),
  /** Auto-mode rules this project adds to the user's settings. */
  autoMode: z.array(z.string().min(1)).optional(),
  /**
   * Heavy jobs: the project's own kinds, over the defaults (`src/jobs/kinds.ts`).
   * `route: true` turns on the `job-route` hook: a heavy Bash command is sent through
   * `cc-smart-dev-kit job run` instead of running raw.
   */
  jobs: z.strictObject({ kinds: kindsSchema.optional(), route: z.boolean().optional() }).optional(),
  /**
   * The project's deploy tasks (D75, `docs/design/tasks.md`): one Markdown file per step owed
   * before or after a deploy to staging or prod, kept in the repo so it ships with its branch.
   * Every key is optional.
   * - `dir`: the folder, inside the checkout (default `.claude/tasks`); each environment has a
   *   folder in it, with its own `archive/` for closed tasks.
   * - `staleDays`: when an open task counts as stale for `task check` (default 30).
   * - `envs`: the environments the project deploys to, from `staging` and `prod`, no repeats
   *   (default both). A project with only prod lists `["prod"]`. A field of 5.0.0.
   * - `deployCommands`: the commands this project deploys with, for each environment
   *   (`{ "prod": ["vercel --prod"] }`): a string, or a match rule as in `jobs.kinds`. The deploy
   *   guard asks before one runs while that environment has work that holds a deploy
   *   (`judgeTasks`). Only keys of `envs` (both when
   *   `envs` is unset), no empty list, one command to a string. A field of `DEPLOY_GUARD_SINCE`.
   * - `releaseBranch`, `legacyFolders`: read by nothing since 5.0.0 (`IGNORED_TASK_FIELDS`).
   * A field of 1.10.0: a project that sets it raises `requires` to `>=1.10`.
   */
  tasks: z
    .strictObject({
      dir: inCheckout.optional(),
      staleDays: z.number().int().min(1).optional(),
      envs: z
        .array(z.enum(DEPLOY_ENVS))
        .min(1)
        .refine((envs) => new Set(envs).size === envs.length, "Each environment once")
        .optional(),
      deployCommands: z
        .strictObject({ prod: deployCommandList.optional(), staging: deployCommandList.optional() })
        .refine(
          (commands) => Object.keys(commands).length > 0,
          "is empty: list the commands for an environment, or remove the key",
        )
        .optional(),
      ...IGNORED_TASK_SCHEMAS,
    })
    .superRefine((tasks, ctx) => {
      // An empty `envs` has its own refusal above; a second issue here would only confuse.
      if (tasks.envs?.length === 0) return;
      const envs: readonly string[] = tasks.envs ?? DEPLOY_ENVS;
      for (const env of Object.keys(tasks.deployCommands ?? {}))
        if (!envs.includes(env))
          ctx.addIssue({
            code: "custom",
            path: ["deployCommands", env],
            message: `is not one of tasks.envs (${envs.join(", ")}): remove it, or add ${env} to tasks.envs`,
          });
    })
    .optional(),
  /**
   * What cc-smart-dev-kit may do by itself in this project, over the person's own defaults
   * (`~/.config/cc-smart-dev-kit/workflow.json`): the project's value wins field by field (`src/workflow/`).
   */
  workflow: workflowSchema.optional(),
  /**
   * The plugin hooks this project still runs as its own copy (["git-guard"]): exactly
   * those stay silent here, so the two copies never both answer. Emptied once the project
   * removed its copies (`docs/design.md` § The safe switch). A retired name
   * (`RETIRED_HOOK_NAMES`), and one a project can no longer switch off
   * (`UNSWITCHABLE_HOOK_NAMES`), is accepted and silences nothing.
   */
  ownHooks: z
    .array(z.enum([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES, ...UNSWITCHABLE_HOOK_NAMES]))
    .optional(),
});

export type CcSmartDevKitConfig = z.infer<typeof ccSmartDevKitConfigSchema>;

/**
 * The base a branch's pull request goes into: `worktrees.base`, or the longest
 * `worktrees.bases` prefix that matches the branch's name. The one home of that rule (the
 * schema's comment, `.claude/rules/cc-smart-dev-kit-json.md`): the merge guard's opening check
 * and the after-merge note name the same base.
 */
export function baseForBranch(
  worktrees: NonNullable<CcSmartDevKitConfig["worktrees"]>,
  branch: string,
): string {
  let match: string | null = null;
  for (const prefix of Object.keys(worktrees.bases ?? {})) {
    if (branch.startsWith(prefix) && (match === null || prefix.length > match.length)) {
      match = prefix;
    }
  }
  return match === null ? worktrees.base : (worktrees.bases?.[match] ?? worktrees.base);
}

/** A cc-smart-dev-kit.json that exists but cannot be used. The message names the file and the field. */
export class CcSmartDevKitConfigError extends Error {
  override name = "CcSmartDevKitConfigError";
}

/** The project needs a newer (or other) version of the plugin than the one running. */
export class CcSmartDevKitVersionError extends CcSmartDevKitConfigError {
  override name = "CcSmartDevKitVersionError";
}

/**
 * The file still sets a retired worktree engine field (`RETIRED_WORKTREE_FIELDS`). A config
 * error like any other to every reader; its own class only so the portal's Project card can
 * still offer its write, which takes the field out (`src/portal/facts.ts` › `readProject`).
 */
export class CcSmartDevKitRetiredFieldError extends CcSmartDevKitConfigError {
  override name = "CcSmartDevKitRetiredFieldError";
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => (field === "(top level)" ? key : `${field}.${key}`));
    return `${keys.join(", ")}: unknown field (a newer cc-smart-dev-kit may be needed)`;
  }
  return `${field}: ${issue.message}`;
}

/**
 * Checks `requires` before anything else, reading only that field. A newer cc-smart-dev-kit.json may hold
 * fields this plugin does not know yet; the user must hear "update the plugin", not
 * "unknown field".
 *
 * A plugin past the range's top (`^1.4` on 2.0.0) is the other way round: an update cannot
 * help, so the message says to widen the range instead. Which one: an update helps when some
 * version newer than the plugin is in the range (`allowsNewer`); so `^1.4 || ^2.1` on 2.0.0
 * hears update, and `^1.4` on 2.0.0 hears widen.
 */
function checkRequires(file: string, raw: unknown, pluginVersion: string): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const requires = (raw as { requires?: unknown }).requires;
  // A broken value is reported by the full check below.
  if (typeof requires !== "string" || !isValidRange(requires)) return;
  if (satisfiesRange(pluginVersion, requires)) return;
  if (!allowsNewer(pluginVersion, requires)) {
    const lowest = lowestAllowed(requires);
    const [major, minor] = lowest?.split(".") ?? [];
    const example =
      lowest === null || lowest === "0.0.0" ? "" : ` (for example >=${major}.${minor})`;
    throw new CcSmartDevKitVersionError(
      `${file}: this project's requires ${requires} does not let in cc-smart-dev-kit ` +
        `${pluginVersion}, which is newer; widen requires in that file${example}`,
    );
  }
  throw new CcSmartDevKitVersionError(
    `${file}: this project needs cc-smart-dev-kit ${requires}; you have ${pluginVersion}; ` +
      `run ${PLUGIN_UPDATE_COMMAND}`,
  );
}

/** One retired field's message: the field, what to do, and the command that does it. */
export function retiredFieldMessage(field: (typeof RETIRED_WORKTREE_FIELDS)[number]): string {
  return `worktrees.${field} is no longer supported: remove it — Claude Code's own worktrees need none. \`${COMMAND} project init\` removes it (README § Worktrees).`;
}

/**
 * The retired engine fields a cc-smart-dev-kit.json's parsed content still sets, in the order of
 * `RETIRED_WORKTREE_FIELDS`. A value of any type counts — the field is gone, whatever it holds.
 */
export function retiredFieldsOf(raw: unknown): (typeof RETIRED_WORKTREE_FIELDS)[number][] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const worktrees = (raw as { worktrees?: unknown }).worktrees;
  if (typeof worktrees !== "object" || worktrees === null || Array.isArray(worktrees)) return [];
  return RETIRED_WORKTREE_FIELDS.filter((field) => Object.hasOwn(worktrees, field));
}

/** Refuses a file that still sets a retired engine field: one message per field. */
function checkRetiredFields(where: string, raw: unknown): void {
  const found = retiredFieldsOf(raw);
  if (found.length === 0) return;
  throw new CcSmartDevKitRetiredFieldError(
    `Invalid ${where}: ${found.map(retiredFieldMessage).join(" ")}`,
  );
}

/**
 * Refuses a file that sets a workflow setting only the person's own file may hold
 * (`PERSONAL_ONLY_KEYS`: `plans.runMode`, which would spend every teammate's usage). It names the
 * key and the command to run instead, never "unknown field (a newer cc-smart-dev-kit may be
 * needed)", which would send the person to update. It runs after `requires` and before the strict parse.
 */
function checkPersonalOnlyFields(where: string, raw: unknown): void {
  const workflow = isObject(raw) ? raw.workflow : undefined;
  for (const key of PERSONAL_ONLY_KEYS) {
    const [group, field] = key.split(".");
    const settings = isObject(workflow) ? workflow[group ?? ""] : undefined;
    if (!isObject(settings) || !Object.hasOwn(settings, field ?? "")) continue;
    throw new CcSmartDevKitConfigError(
      `Invalid ${where}: workflow.${key} is your own setting, not the project's, because ${PERSONAL_ONLY_REASONS[key]}: remove it from this file and run \`${COMMAND} workflow set ${key} <value>\` in your own terminal.`,
    );
  }
}

/**
 * The names `ownHooks` lists in one cc-smart-dev-kit.json, read on their own, the way `requires` is:
 * a hook the project runs as its own copy stays silent even when the rest of the file needs
 * a newer plugin or is broken, so the person never gets two questions for one command.
 * Null when the file does not exist; empty when it cannot be read or lists nothing.
 */
export function readOwnHooks(file: string): string[] | null {
  if (!existsSync(file)) return null;
  try {
    // The one reader of a person-edited JSON file: an editor's byte order mark is skipped,
    // so a file Claude Code reads without trouble is not refused here (F5-2).
    const raw: unknown = readUserJson(file);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const listed = (raw as { ownHooks?: unknown }).ownHooks;
    return Array.isArray(listed)
      ? listed.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Reads and validates one cc-smart-dev-kit.json: first `requires` against the plugin version, then the
 * retired engine fields, then the whole file, strictly. Returns null when the file does not exist; throws CcSmartDevKitVersionError
 * when the plugin is too old, and CcSmartDevKitConfigError when the file is invalid.
 */
export function loadCcSmartDevKitConfig(
  file: string,
  pluginVersion: string = VERSION,
): CcSmartDevKitConfig | null {
  if (!existsSync(file)) return null;
  return parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file, pluginVersion);
}

/**
 * The same checks on a cc-smart-dev-kit.json's text, wherever it came from: a file on disk, or
 * the file as committed on a branch (`readCommittedConfig` in `src/project/resolve.ts`). `where`
 * names it in every error. Throws CcSmartDevKitVersionError when the plugin is too old, and
 * CcSmartDevKitConfigError when the text is invalid.
 */
export function parseCcSmartDevKitConfig(
  text: string,
  where: string,
  pluginVersion: string = VERSION,
): CcSmartDevKitConfig {
  let raw: unknown;
  try {
    // The one reader of a person-edited JSON file (F5-2): a leading byte order mark, which
    // `JSON.parse` refuses, is skipped. The text may come from a file or from git
    // (`readCommittedConfig`), and either may carry the mark.
    raw = parseUserJson(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CcSmartDevKitConfigError(`Invalid ${where}: not valid JSON (${reason})`);
  }
  return checkCcSmartDevKitConfig(raw, where, pluginVersion);
}

/**
 * Every check on a cc-smart-dev-kit.json already read as JSON, in its one order: `requires`
 * first, then the retired engine fields, then the person's own settings, then the strict parse. `parseCcSmartDevKitConfig` runs
 * it on a file's text; `writeProjectSetting` (`src/workflow/write.ts`) on the object it is about
 * to write, so nothing writes a file this would refuse. Throws as `parseCcSmartDevKitConfig` does.
 */
export function checkCcSmartDevKitConfig(
  raw: unknown,
  where: string,
  pluginVersion: string = VERSION,
): CcSmartDevKitConfig {
  checkRequires(where, raw, pluginVersion);
  checkRetiredFields(where, raw);
  checkPersonalOnlyFields(where, raw);
  const parsed = ccSmartDevKitConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new CcSmartDevKitConfigError(`Invalid ${where}: ${issues}`);
  }
  return parsed.data;
}
