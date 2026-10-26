/**
 * The machine's own settings for heavy jobs: `~/.config/cc-smart-dev-kit/jobs.json`. Optional;
 * without it every default holds. The person sets `maxJobs` and the weights with
 * `cc-smart-dev-kit job set` (`set.ts`); a machine's own setup may write the rest (for example,
 * to point every container on a host at one shared folder); the plugin names no machine.
 *
 * ```json
 * {
 *   "maxJobs": 3,
 *   "reserveGb": 8,
 *   "sharedDirs": ["/srv/heavy-jobs"],
 *   "launch": "auto",
 *   "cpuWeight": 50,
 *   "ioWeight": "off"
 * }
 * ```
 *
 * A project's kinds come from its `.claude/cc-smart-dev-kit.json` (`jobs.kinds`), not from here:
 * the project knows its tools, the machine knows its memory and its slots. `maxJobs` is
 * machine-wide only: the slots are the machine's, so a project's file cannot set it.
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

/**
 * How many heavy jobs run at once on this machine, when `jobs.json` does not say. A job has no
 * size: one job alone may use all the memory and every core. A job past this number waits for a
 * slot, oldest first.
 */
export const DEFAULT_MAX_JOBS = 3;
/**
 * GB kept for what never queues: the desktop, Claude sessions, MCP and dev servers, a DB. The
 * memory ceiling of the heavy jobs together is the machine's memory less this, and never less
 * than `MIN_CEILING_GB` (`memory.ts`).
 */
export const DEFAULT_RESERVE_GB = 8;
/** The systemd slice heavy jobs run in. A dash nests: it sits inside `cc-smart-dev-kit.slice`. */
export const DEFAULT_SLICE = "cc-smart-dev-kit-heavy.slice";

const absolutePath = z
  .string()
  .min(1)
  .refine((path) => isAbsolute(path), "must be an absolute path");

/** The top of a cgroup weight: systemd's own range is 1 to 10000. One home, for `job set` too. */
export const MAX_WEIGHT = 10_000;

/**
 * A cgroup weight, 1 to `MAX_WEIGHT`. `0` or `"off"` leaves systemd's default (100) in force,
 * and so does leaving the field out: a heavy job runs at normal CPU and disk I/O unless the
 * person asks for a lower weight.
 */
const weightSchema = z.union([
  z.literal(0),
  z.literal("off"),
  z.number().int().min(1).max(MAX_WEIGHT),
]);

export const jobsMachineConfigSchema = z.strictObject({
  /** Where this user's leases live. Default: `~/.local/share/cc-smart-dev-kit/jobs`. */
  stateDir: absolutePath.optional(),
  /**
   * How many heavy jobs run at once on this machine, 1 or more. Default: 3. Machine-wide only:
   * the slots are the machine's, so a project's file cannot set this. `job set max-jobs <n>`
   * writes it.
   */
  maxJobs: z.number().int().min(1).optional(),
  /**
   * The memory ceiling of all heavy jobs together on Linux, in GB, instead of the machine's
   * memory less `reserveGb`. Past it a job dies inside its slice.
   */
  budgetGb: z.number().int().min(1).optional(),
  /** GB kept for what the heavy jobs never take: the ceiling is memory less this. Default: 8. */
  reserveGb: z.number().int().min(0).optional(),
  /**
   * Folders shared with other containers or users on this host. Each holds a `max-jobs`
   * file (a whole number: how many heavy jobs run at once for every user of the folder); a
   * job also takes one of its slots.
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
  /**
   * The heavy slices' CPU weight on a Linux systemd machine, 1 to 10000. Default: off, which
   * leaves systemd's own weight (100) in force. A weight below 100 makes a heavy job give way
   * under load. Machine-wide: the slices are the machine's, so a project's file cannot own this.
   */
  cpuWeight: weightSchema.optional(),
  /**
   * The heavy slices' disk I/O weight, 1 to 10000. Default: off (systemd's own 100).
   * Machine-wide, like `cpuWeight`.
   */
  ioWeight: weightSchema.optional(),
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

/** A weight from `jobs.json`; `0` means systemd's default is left in force (also unset). */
function weightOf(value: JobsMachineConfig["cpuWeight"]): number {
  return value === undefined || value === "off" ? 0 : value;
}

/** How many heavy jobs run at once on this machine. */
export function maxJobsOf(config: JobsMachineConfig): number {
  return config.maxJobs ?? DEFAULT_MAX_JOBS;
}

/** The CPU weight this machine's launches set on the slice chain; 0: systemd's default. */
export function cpuWeightOf(config: JobsMachineConfig): number {
  return weightOf(config.cpuWeight);
}

/** The I/O weight this machine's launches set on the slice chain; 0: systemd's default. */
export function ioWeightOf(config: JobsMachineConfig): number {
  return weightOf(config.ioWeight);
}
