/**
 * The machine's own settings for heavy jobs: `~/.config/cc-smart-dev-kit/jobs.json`. Optional;
 * without it every default holds. A machine's own setup writes it (for example, to point
 * every container on a host at one shared folder); the plugin names no machine.
 *
 * ```json
 * {
 *   "reserveGb": 22,
 *   "sharedDirs": ["/srv/heavy-jobs"],
 *   "launch": "auto"
 * }
 * ```
 *
 * A project's kinds come from its `.claude/cc-smart-dev-kit.json` (`jobs.kinds`), not from here:
 * the project knows its tools, the machine knows its memory.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * The machine's heavy-job settings, `~/.config/cc-smart-dev-kit/jobs.json`, and this user's
 * leases, `~/.local/share/cc-smart-dev-kit/jobs`. From the home folder the caller passes, so a
 * test points them at a temp folder. (Not in `cliPaths()` itself: only the jobs code
 * reads these.)
 */
export function jobsPaths(home: string): { configFile: string; stateDir: string } {
  return {
    configFile: join(home, ".config", "cc-smart-dev-kit", "jobs.json"),
    stateDir: join(home, ".local", "share", "cc-smart-dev-kit", "jobs"),
  };
}

/** GB kept for what never queues: the desktop, Claude sessions, MCP and dev servers, a DB. */
export const DEFAULT_RESERVE_GB = 22;
/** The systemd slice heavy jobs run in. A dash nests: it sits inside `cc-smart-dev-kit.slice`. */
export const DEFAULT_SLICE = "cc-smart-dev-kit-heavy.slice";

const absolutePath = z
  .string()
  .min(1)
  .refine((path) => isAbsolute(path), "must be an absolute path");

export const jobsMachineConfigSchema = z.strictObject({
  /** Where this user's leases live. Default: `~/.local/share/cc-smart-dev-kit/jobs`. */
  stateDir: absolutePath.optional(),
  /** This machine's heavy-job budget in GB, instead of its memory less `reserveGb`. */
  budgetGb: z.number().int().min(1).optional(),
  /** GB kept for what never queues. Default: 22. */
  reserveGb: z.number().int().min(0).optional(),
  /**
   * Folders shared with other containers or users on this host. Each holds a `budget`
   * file (whole GB for all of them together); a job also reserves its GB there.
   */
  sharedDirs: z.array(absolutePath).optional(),
  /**
   * `auto`: on Linux, run each job in its own memory group in a systemd slice, marked to
   * die first if memory still runs out (when the system allows). `plain`: run it as it is.
   */
  launch: z.enum(["auto", "plain"]).optional(),
  /** The systemd slice for `launch: auto`. Default: `cc-smart-dev-kit-heavy.slice`. */
  slice: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*\.slice$/, "must be a slice name like name.slice")
    .optional(),
});

export type JobsMachineConfig = z.infer<typeof jobsMachineConfigSchema>;

/** A `jobs.json` that exists but cannot be used. The message names the file and the field. */
export class JobsConfigError extends Error {
  override name = "JobsConfigError";
}

/** Reads `file`: `{}` when it does not exist; JobsConfigError when it is broken. */
export function loadJobsConfig(file: string): JobsMachineConfig {
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new JobsConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = jobsMachineConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      return issue.code === "unrecognized_keys"
        ? `${issue.keys.join(", ")}: unknown field`
        : `${field}: ${issue.message}`;
    });
    throw new JobsConfigError(`Invalid ${file}: ${issues.join("; ")}`);
  }
  return parsed.data;
}
