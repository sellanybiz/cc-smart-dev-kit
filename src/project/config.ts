import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
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
  "serena-root",
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
 * The plugin version that made `worktrees.prefix` optional. A project file written without
 * it needs at least this version: an older plugin still requires the field and refuses the
 * whole file, which would leave every guard asking. One home for the number.
 */
export const WORKTREE_PREFIX_OPTIONAL_SINCE = "0.5.2";

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
       * Deprecated: the folder-name prefix of a worktree the plugin's engine made beside the
       * repo ("app-wt-"). Still accepted, because a project wired to the engine uses it, and
       * it retires with the engine in the next minor version. A project on Claude Code's own
       * worktrees leaves it out.
       */
      prefix: z.string().min(1).optional(),
      /**
       * Deprecated: a command (argv form) the plugin's engine ran inside a new worktree, e.g.
       * ["bun", "install"]. Still accepted until the engine retires; a project on Claude
       * Code's own worktrees runs its install itself.
       */
      setup: z.array(z.string().min(1)).min(1).optional(),
      /**
       * Refuse an Edit, Write or NotebookEdit of a file in the main checkout itself (not in
       * a worktree): there, every change goes in a worktree. Off when left out.
       */
      guardMainFolder: z.boolean().optional(),
      /**
       * A branch-name prefix (ending in "/") to the base that branch family's pull requests
       * go into: `{"hotfix/": "main", "release/": "main"}`. Every other branch's requests go
       * into `base`. The longest prefix that matches wins. Auto-merge and the after-merge
       * note read it; the deprecated engine also started such a branch from it.
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
      /**
       * Deprecated: who made this project's worktrees. `"plugin"` wired cc-smart-dev-kit's
       * engine hooks (`worktree-create`, `worktree-remove`, `subagent-stop`); `"own"` meant the
       * project ran an engine of its own. Every project now uses Claude Code's own worktrees,
       * so this is accepted and ignored until the engine retires in the next minor version.
       */
      engine: z.enum(["plugin", "own"]).optional(),
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
   * removed its copies (`docs/design.md` § The safe switch).
   */
  ownHooks: z.array(z.enum(PLUGIN_HOOK_NAMES)).optional(),
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
 * whole file, strictly. Returns null when the file does not exist; throws CcSmartDevKitVersionError
 * when the plugin is too old, and CcSmartDevKitConfigError when the file is invalid.
 */
export function loadCcSmartDevKitConfig(
  file: string,
  pluginVersion: string = VERSION,
): CcSmartDevKitConfig | null {
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CcSmartDevKitConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  checkRequires(file, raw, pluginVersion);
  const parsed = ccSmartDevKitConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new CcSmartDevKitConfigError(`Invalid ${file}: ${issues}`);
  }
  return parsed.data;
}
