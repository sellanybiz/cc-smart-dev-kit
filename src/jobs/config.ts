import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { withLock } from "../setup/lock";
import { applyManagedJson } from "../setup/managed-json";
import { parseUserJson } from "../setup/user-json";

export const HEAVY_SLOTS = 1;
export const MAX_HEAVY_SLOTS = 8;
export const heavySlotsSchema = z.number().int().min(HEAVY_SLOTS).max(MAX_HEAVY_SLOTS);
const configSchema = z.object({ maxConcurrent: heavySlotsSchema.optional() });

/** A new file, so an ignored 1.x maxJobs can never become an opt-in. */
export function jobsPaths(home: string): {
  stateDir: string;
  configFile: string;
  legacyFile: string;
} {
  const configDir = join(home, ".config", COMMAND);
  return {
    stateDir: join(home, ".local", "share", COMMAND, "jobs"),
    configFile: join(configDir, "heavy-jobs.json"),
    legacyFile: join(configDir, "jobs.json"),
  };
}
export interface HeavyLimit {
  slots: number;
  source: string;
}
export function readHeavyLimit(home: string): HeavyLimit {
  const file = jobsPaths(home).configFile;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { slots: HEAVY_SLOTS, source: "default" };
    throw error;
  }
  const parsed = configSchema.safeParse(parseUserJson(text));
  if (!parsed.success)
    throw new Error(
      `${file}: maxConcurrent must be an integer from ${HEAVY_SLOTS} to ${MAX_HEAVY_SLOTS}`,
    );
  return parsed.data.maxConcurrent === undefined
    ? { slots: HEAVY_SLOTS, source: "default" }
    : { slots: parsed.data.maxConcurrent, source: file };
}
export function heavyLimitLine(limit: HeavyLimit): string {
  return `Heavy-job limit: ${limit.slots} (${limit.source})`;
}
/**
 * Writes one key of the machine file under the same two locks as acquisition: an in-flight take
 * cannot use the old limit, and two `job set` calls never interleave.
 */
async function writeSetting(paths: CliPaths, key: string, value: number): Promise<void> {
  await withLock(paths.stateDir, () =>
    withLock(
      jobsPaths(paths.home).stateDir,
      () => {
        applyManagedJson({
          file: jobsPaths(paths.home).configFile,
          stateDir: paths.stateDir,
          set: [[[key], value]],
        });
      },
      { waitMs: 2_000 },
    ),
  );
}
export async function setHeavyLimit(paths: CliPaths, slots: number): Promise<void> {
  heavySlotsSchema.parse(slots);
  await writeSetting(paths, "maxConcurrent", slots);
}

/**
 * The CPU and memory caps of the heavy jobs together, as a percent of the machine
 * (`limits.ts` turns them into systemd properties). Read apart from `maxConcurrent`: a bad
 * value here turns the limits off for a job, and never stops the queue.
 */
export const LIMIT_PERCENT_MIN = 10;
export const LIMIT_PERCENT_MAX = 100;
export const DEFAULT_LIMIT_PERCENT = 90;
export const limitPercentSchema = z.number().int().min(LIMIT_PERCENT_MIN).max(LIMIT_PERCENT_MAX);
export const LIMIT_KEYS = ["cpuPercent", "memoryPercent"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type LimitSettings = Record<LimitKey, number>;
export type LimitRead =
  | { ok: true; settings: LimitSettings; source: string }
  /** `keys`: the keys that failed; empty when the whole file could not be read. */
  | { ok: false; keys: LimitKey[]; message: string };

/** Never throws: any trouble reading the file is a read that turns the limits off. */
export function readLimitSettings(home: string): LimitRead {
  const file = jobsPaths(home).configFile;
  const defaults: LimitSettings = {
    cpuPercent: DEFAULT_LIMIT_PERCENT,
    memoryPercent: DEFAULT_LIMIT_PERCENT,
  };
  let raw: unknown;
  try {
    raw = parseUserJson(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, settings: defaults, source: "default" };
    }
    return {
      ok: false,
      keys: [],
      message: `${file}: cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, keys: [], message: `${file}: must hold a JSON object` };
  }
  const given = raw as Record<string, unknown>;
  const bad = LIMIT_KEYS.filter(
    (key) => key in given && !limitPercentSchema.safeParse(given[key]).success,
  );
  if (bad.length > 0) {
    return {
      ok: false,
      keys: bad,
      message: `${file}: ${bad.join(" and ")} must be an integer from ${LIMIT_PERCENT_MIN} to ${LIMIT_PERCENT_MAX}`,
    };
  }
  const settings = { ...defaults };
  for (const key of LIMIT_KEYS) {
    if (key in given) settings[key] = given[key] as number;
  }
  const chosen = LIMIT_KEYS.some((key) => key in given);
  return { ok: true, settings, source: chosen ? file : "default" };
}
export function limitsLine(read: LimitRead): string {
  return read.ok
    ? `Heavy-job caps: CPU ${read.settings.cpuPercent}%, memory ${read.settings.memoryPercent}% (${read.source})`
    : `Heavy-job caps: off, ${read.message}`;
}
export async function setLimitPercent(
  paths: CliPaths,
  key: LimitKey,
  percent: number,
): Promise<void> {
  limitPercentSchema.parse(percent);
  await writeSetting(paths, key, percent);
}
