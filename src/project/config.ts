import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
import { isValidRange, satisfiesRange } from "./version-range";

/**
 * The per-project opt-in file, `.claude/cc.json`.
 * Strict on purpose: a typo like `"worktree"` fails loudly instead of being ignored.
 */
export const ccConfigSchema = z.strictObject({
  /** The plugin versions this project needs, as a semver range (">=1.2"). */
  requires: z
    .string()
    .refine(isValidRange, 'not a valid version range (like ">=1.2" or "^1.2")')
    .optional(),
  worktrees: z
    .strictObject({
      /** The branch new worktrees start from ("dev"). */
      base: z.string().min(1),
      /** The folder-name prefix of a worktree beside the repo ("app-wt-"). */
      prefix: z.string().min(1),
      /** A command (argv form) run inside a new worktree, e.g. ["bun", "install"]. */
      setup: z.array(z.string().min(1)).min(1).optional(),
    })
    .optional(),
  /** Turn on the opt-in instructions for this project. */
  instructions: z.boolean().optional(),
  /** Auto-mode rules this project adds to the user's settings. */
  autoMode: z.array(z.string().min(1)).optional(),
});

export type CcConfig = z.infer<typeof ccConfigSchema>;

/** A cc.json that exists but cannot be used. The message names the file and the field. */
export class CcConfigError extends Error {
  override name = "CcConfigError";
}

/** The project needs a newer (or other) version of the plugin than the one running. */
export class CcVersionError extends CcConfigError {
  override name = "CcVersionError";
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => (field === "(top level)" ? key : `${field}.${key}`));
    return `${keys.join(", ")}: unknown field (a newer cc-agentic may be needed)`;
  }
  return `${field}: ${issue.message}`;
}

/**
 * Checks `requires` before anything else, reading only that field. A newer cc.json may hold
 * fields this plugin does not know yet; the user must hear "update the plugin", not
 * "unknown field".
 */
function checkRequires(file: string, raw: unknown, pluginVersion: string): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const requires = (raw as { requires?: unknown }).requires;
  // A broken value is reported by the full check below.
  if (typeof requires !== "string" || !isValidRange(requires)) return;
  if (!satisfiesRange(pluginVersion, requires)) {
    throw new CcVersionError(
      `${file}: this project needs cc-agentic ${requires}; you have ${pluginVersion}; ` +
        `run ${PLUGIN_UPDATE_COMMAND}`,
    );
  }
}

/**
 * Reads and validates one cc.json: first `requires` against the plugin version, then the
 * whole file, strictly. Returns null when the file does not exist; throws CcVersionError
 * when the plugin is too old, and CcConfigError when the file is invalid.
 */
export function loadCcConfig(file: string, pluginVersion: string = VERSION): CcConfig | null {
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CcConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  checkRequires(file, raw, pluginVersion);
  const parsed = ccConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new CcConfigError(`Invalid ${file}: ${issues}`);
  }
  return parsed.data;
}
