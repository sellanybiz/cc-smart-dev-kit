/**
 * What the background clean (`auto-clean.ts`) leaves in the state folder, and what the hooks
 * read from it.
 *
 *   worktrees-auto-clean.log                   one line per run, kept small (`appendLogLine`)
 *   worktrees-auto-clean/<key>.json            per repo: when the clean last ran, what it
 *                                              removed (and the number of that removal), and
 *                                              what it kept with the reason
 *   worktrees-auto-clean/<key>.told.json       per repo: the number of the last removal a
 *                                              session start showed
 *
 * `<key>` is a hash of the repo's main checkout (`pathForm`, so two spellings of one folder
 * share it). Each file has ONE writer, so no write can undo another: the record is written
 * only by the clean, under the machine-wide lock; the told mark only by a session start. A
 * repo has files of its own, so a session start in one repo never rewrites another's. A
 * file that cannot be read or does not match is treated as empty: the state is a
 * convenience, and a broken file must never stop a clean or a session.
 *
 * They are cc-smart-dev-kit's own state, not a user's file.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import { pathForm } from "../path-compare";
import { atomicWrite } from "../setup/write";
import type { KeptWorktree, RemovedWorktree } from "./clean";

/** Why the clean runs: a pull request merged into the base, or a session started. */
export type AutoCleanTrigger = "merge" | "session";

export const AUTO_CLEAN_TRIGGERS: readonly AutoCleanTrigger[] = ["merge", "session"];

/** At most one clean an hour per repo at a session start. */
export const AUTO_CLEAN_INTERVAL_MS = 60 * 60 * 1000;

/** The names a told line spells out; more than this are counted. */
export const TOLD_NAMES_MAX = 8;

const removedSchema = z.object({
  branch: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  why: z.string(),
});

const keptSchema = z.object({ name: z.string(), path: z.string(), why: z.string() });

const recordSchema = z.object({
  /** The base the work was judged against, for the told line. */
  base: z.string(),
  /** Worktrees still there with the reason, from the last run. */
  kept: z.array(keptSchema),
  /** When the clean last ran (ms since the epoch). */
  lastRunAt: z.number(),
  /** The removals since the last one a session was told about (the told ones stay until the next removal). */
  removed: z.array(removedSchema),
  /** The repo's main checkout, for a person who reads the file. */
  repo: z.string(),
  /** The number of the last run that removed something; 0 when none did. */
  seq: z.number(),
});

const toldSchema = z.object({ seq: z.number() });

/** One repo's record. */
export type RepoRecord = z.infer<typeof recordSchema>;

/** One repo's files, and the log every repo shares. */
export interface AutoCleanFiles {
  log: string;
  result: string;
  told: string;
}

/** The log every repo's runs share. */
export function autoCleanLog(stateDir: string): string {
  return join(stateDir, "worktrees-auto-clean.log");
}

/** The files of `repo` (its main checkout) in the state folder. */
export function autoCleanFiles(stateDir: string, repo: string): AutoCleanFiles {
  const key = createHash("sha256").update(pathForm(repo)).digest("hex").slice(0, 16);
  const dir = join(stateDir, "worktrees-auto-clean");
  return {
    log: autoCleanLog(stateDir),
    result: join(dir, `${key}.json`),
    told: join(dir, `${key}.told.json`),
  };
}

function readJson<T>(file: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    // No file yet, or one that is not JSON: nothing recorded.
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/** The repo's record, or null. */
export function readRepoRecord(files: AutoCleanFiles): RepoRecord | null {
  return readJson(files.result, recordSchema);
}

/** The number of the last removal a session start showed; 0 when none was. */
export function readTold(files: AutoCleanFiles): number {
  return readJson(files.told, toldSchema)?.seq ?? 0;
}

/**
 * Can the session-start clean run: there was none, the last one began an hour or more ago, or
 * the clock moved back. (The merge-triggered clean ignores this: a merge is the news.)
 */
export function hourlyDue(record: RepoRecord | null, nowMs: number): boolean {
  if (record === null) return true;
  return nowMs - record.lastRunAt >= AUTO_CLEAN_INTERVAL_MS || record.lastRunAt > nowMs + 60_000;
}

/** What one run found. */
export interface RunRecord {
  base: string;
  kept: KeptWorktree[];
  now: number;
  removed: RemovedWorktree[];
}

/**
 * Records a run (the clean only, under the lock): the time and the kept list always. A run
 * that removed something takes the next number, and adds its removals to the ones no session
 * was told about yet (a told set is replaced). A run that removed nothing leaves the earlier
 * removals and their number as they are. The number counts on from the told mark too, so a
 * record that was lost never hides new removals behind an old mark.
 */
export function recordRun(files: AutoCleanFiles, repo: string, run: RunRecord): void {
  const before = readRepoRecord(files);
  const told = readTold(files);
  const unchanged = { removed: before?.removed ?? [], seq: before?.seq ?? 0 };
  const removals =
    run.removed.length === 0
      ? unchanged
      : {
          removed: [
            ...(before !== null && before.seq > told ? before.removed : []),
            ...run.removed,
          ],
          seq: Math.max(before?.seq ?? 0, told) + 1,
        };
  writeJson(files.result, {
    base: run.base,
    kept: run.kept,
    lastRunAt: run.now,
    repo,
    ...removals,
  } satisfies RepoRecord);
}

/** Records only that a run started: the hourly limit counts from here even if the run dies. */
export function recordStart(files: AutoCleanFiles, repo: string, nowMs: number): void {
  const before = readRepoRecord(files);
  writeJson(
    files.result,
    before === null
      ? ({ base: "", kept: [], lastRunAt: nowMs, removed: [], repo, seq: 0 } satisfies RepoRecord)
      : { ...before, lastRunAt: nowMs },
  );
}

/**
 * Marks the removals numbered `seq` as shown (a session start only). Removals a clean recorded
 * since carry a higher number, so they are still told at the next start.
 */
export function markTold(files: AutoCleanFiles, seq: number): void {
  if (readTold(files) >= seq) return;
  writeJson(files.told, { seq });
}

/** The record when it holds removals no session has been told about, or null. */
export function untold(record: RepoRecord | null, told: number): RepoRecord | null {
  return record !== null && record.seq > told && record.removed.length > 0 ? record : null;
}

/**
 * The one line a person sees: `cc-smart-dev-kit removed 3 finished worktrees: a, b, c (work on
 * main)`. Past `TOLD_NAMES_MAX` names, the rest are counted.
 */
export function toldLine(record: RepoRecord): string {
  const count = record.removed.length;
  const shown = record.removed.slice(0, TOLD_NAMES_MAX).map((one) => one.name);
  const names =
    count > TOLD_NAMES_MAX
      ? `${shown.join(", ")} and ${String(count - TOLD_NAMES_MAX)} more`
      : shown.join(", ");
  const noun = count === 1 ? "1 finished worktree" : `${String(count)} finished worktrees`;
  return `${COMMAND} removed ${noun}: ${names} (work on ${record.base})`;
}
