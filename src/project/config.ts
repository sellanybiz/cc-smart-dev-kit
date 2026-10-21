import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { COMMAND, PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
import { kindsSchema } from "../jobs/kinds";
import { workflowSchema } from "../workflow/schema";
import { isValidRange, satisfiesRange } from "./version-range";

/**
 * The hooks the plugin wires in `plugin/hooks/hooks.json`, by name: what `ownHooks` may
 * list. A test keeps it the same as `HOOKS` in `src/hooks/specs.ts`.
 */
export const PLUGIN_HOOK_NAMES = [
  "git-guard",
  "merge-guard",
  "main-folder-guard",
  "message-guard",
  "agent-guard",
  "fable-session",
  "job-route",
  "after-merge",
  "review-record",
  "worktree-leftovers",
  "session-name",
] as const;

/**
 * The plugin hooks a later version took out, by name: `ownHooks` still ACCEPTS them, and they
 * silence nothing (no hook of that name runs any more). Refusing one would fail the strict
 * parse of a project file written for an older plugin, and then every guard would ask on
 * every call. `doctor` says the name can go (`src/cli/project-checks.ts`). `serena-root`
 * went with Serena in 0.6.0.
 */
export const RETIRED_HOOK_NAMES = ["serena-root"] as const;

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
 * The release that brought `workflow.workers` and `workflow.fixesAfterReview`. A project file
 * that sets one needs that plugin version or newer: an older plugin reads the file strictly
 * and refuses it whole (a field it does not know), and every guard then fails closed.
 */
export const WORKFLOW_WORKERS_SINCE = "1.0.0";

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
       * A branch-name prefix (ending in "/") to the base that branch family's pull requests
       * go into: `{"hotfix/": "main", "release/": "main"}`. Every other branch's requests go
       * into `base`. The longest prefix that matches wins. Auto-merge and the after-merge
       * note read it.
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
   * What cc-smart-dev-kit may do by itself in this project, over the person's own defaults
   * (`~/.config/cc-smart-dev-kit/workflow.json`): the project's value wins field by field
   * (`src/workflow/`).
   */
  workflow: workflowSchema.optional(),
  /**
   * The plugin hooks this project still runs as its own copy (["git-guard"]): exactly
   * those stay silent here, so the two copies never both answer. Emptied once the project
   * removed its copies (`docs/design.md` § The safe switch). A retired name
   * (`RETIRED_HOOK_NAMES`) is accepted and silences nothing.
   */
  ownHooks: z.array(z.enum([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES])).optional(),
});

export type CcSmartDevKitConfig = z.infer<typeof ccSmartDevKitConfigSchema>;

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
 */
function checkRequires(file: string, raw: unknown, pluginVersion: string): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const requires = (raw as { requires?: unknown }).requires;
  // A broken value is reported by the full check below.
  if (typeof requires !== "string" || !isValidRange(requires)) return;
  if (!satisfiesRange(pluginVersion, requires)) {
    throw new CcSmartDevKitVersionError(
      `${file}: this project needs cc-smart-dev-kit ${requires}; you have ${pluginVersion}; ` +
        `run ${PLUGIN_UPDATE_COMMAND}`,
    );
  }
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
 * The names `ownHooks` lists in one cc-smart-dev-kit.json, read on their own, the way `requires` is:
 * a hook the project runs as its own copy stays silent even when the rest of the file needs
 * a newer plugin or is broken, so the person never gets two questions for one command.
 * Null when the file does not exist; empty when it cannot be read or lists nothing.
 */
export function readOwnHooks(file: string): string[] | null {
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
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
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CcSmartDevKitConfigError(`Invalid ${where}: not valid JSON (${reason})`);
  }
  return checkCcSmartDevKitConfig(raw, where, pluginVersion);
}

/**
 * Every check on a cc-smart-dev-kit.json already read as JSON, in its one order: `requires`
 * first, then the retired engine fields, then the strict parse. `parseCcSmartDevKitConfig` runs
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
  const parsed = ccSmartDevKitConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new CcSmartDevKitConfigError(`Invalid ${where}: ${issues}`);
  }
  return parsed.data;
}
