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
export async function setHeavyLimit(paths: CliPaths, slots: number): Promise<void> {
  heavySlotsSchema.parse(slots);
  // Serialize a limit change with acquisition too: an in-flight take cannot use the old limit.
  await withLock(paths.stateDir, () =>
    withLock(
      jobsPaths(paths.home).stateDir,
      () => {
        applyManagedJson({
          file: jobsPaths(paths.home).configFile,
          stateDir: paths.stateDir,
          set: [[["maxConcurrent"], slots]],
        });
      },
      { waitMs: 2_000 },
    ),
  );
}
