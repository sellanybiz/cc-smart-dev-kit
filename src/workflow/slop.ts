/**
 * The slop record (`cc-smart-dev-kit workflow slop`): how many plans closed since the last slop
 * audit on this machine, how many bypassed homes and drifted copies their reviews found, the
 * areas of code they touched, and when an audit is due.
 *
 * One small JSON file per repository, `<stateDir>/slop/<key>.json` (mode 0600, written
 * atomically), keyed like the review record (`repoKey`), so a repository and every worktree of it
 * share one count. Like the review record it is machine-local: a team on several machines gets an
 * audit offer on each. Every write holds the file's own lock, so two leads that close plans at
 * once both land.
 *
 * Nothing here runs an audit or decides to: `slopStatus` says whether one is due and why, and the
 * lead (`build` § 6) offers it to the person.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import { cappedHookList } from "../hooks/capped-list";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
import { REVIEWS_LOCK_WAIT_MS, repoKey } from "./reviews";

/** How many plans one repository's record keeps: the newest, older ones dropped. */
export const SLOP_PLANS_KEPT = 50;

/** One closed plan: its findings and the areas of code its file list named. */
export interface SlopPlan {
  plan: string;
  at: string;
  /** Homes a builder bypassed: code written again that a shared home already held. */
  bypassed: number;
  /** Copies that drifted: the same logic twice, changed apart. */
  drifted: number;
  areas: string[];
}

export interface SlopRecord {
  /** When the last audit was recorded; null: none yet. */
  auditedAt: string | null;
  /** The plans closed since, oldest first. */
  plans: SlopPlan[];
}

const count = z.number().int().min(0);

const recordSchema = z.strictObject({
  auditedAt: z.string().nullable(),
  plans: z.array(
    z.strictObject({
      plan: z.string().min(1),
      at: z.string(),
      bypassed: count,
      drifted: count,
      areas: z.array(z.string().min(1)),
    }),
  ),
});

/** The record file in `stateDir` for one repository. */
export function slopFile(stateDir: string, repo: string): string {
  return join(stateDir, "slop", `${repoKey(repo)}.json`);
}

/**
 * The areas a plan's file list touches: each path cut to its first two segments (a folder's
 * trailing `/` and a deeper path both count as the folder they sit in), each once, in order.
 */
export function areasOf(paths: readonly string[]): string[] {
  const areas = new Set<string>();
  for (const path of paths) {
    const area = path
      .split("/")
      .filter((segment) => segment !== "")
      .slice(0, 2)
      .join("/");
    if (area !== "") areas.add(area);
  }
  return [...areas].sort();
}

/**
 * The record in `file`: empty when there is none. A file that cannot be read as a record throws,
 * naming the file and the fix: the count is the only thing in it, and a quiet reset would lose it.
 */
export function readSlop(file: string): SlopRecord {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { auditedAt: null, plans: [] };
    throw error;
  }
  try {
    return recordSchema.parse(JSON.parse(text));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${file} is not a slop record (${why.split("\n")[0]}). Delete it to start the count again.`,
    );
  }
}

/** Runs `write` holding the record's own lock, in the folder of `file` (mode 0700). */
async function underLock<T>(file: string, write: (record: SlopRecord) => T): Promise<T> {
  const folder = dirname(file);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(folder, () => write(readSlop(file)), { waitMs: REVIEWS_LOCK_WAIT_MS });
}

function save(file: string, record: SlopRecord): SlopRecord {
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
  return record;
}

/**
 * Records one closed plan at `atMs`. An earlier record of the same plan is replaced, so the lead
 * may run it twice. The newest `SLOP_PLANS_KEPT` plans stay. Throws `LockBusyError` when the lock
 * stays held past `REVIEWS_LOCK_WAIT_MS`.
 */
export async function recordSlop(
  file: string,
  closed: Omit<SlopPlan, "at">,
  atMs: number,
): Promise<SlopRecord> {
  return await underLock(file, (record) =>
    save(file, {
      auditedAt: record.auditedAt,
      plans: [
        ...record.plans.filter((one) => one.plan !== closed.plan),
        { ...closed, at: new Date(atMs).toISOString() },
      ].slice(-SLOP_PLANS_KEPT),
    }),
  );
}

/**
 * Starts the count again after an audit at `atMs`. With no `areas`, every plan is audited. With
 * areas, only those: a plan whose areas are all audited leaves the count, and one with areas
 * left stays, with those. A plan that named no area stays until an audit of everything.
 */
export async function recordAudit(
  file: string,
  areas: readonly string[],
  atMs: number,
): Promise<SlopRecord> {
  return await underLock(file, (record) => {
    const audited = new Set(areas);
    const plans =
      audited.size === 0
        ? []
        : record.plans.flatMap((one) => {
            const left = one.areas.filter((area) => !audited.has(area));
            if (one.areas.length > 0 && left.length === 0) return [];
            return [{ ...one, areas: left }];
          });
    return save(file, { auditedAt: new Date(atMs).toISOString(), plans });
  });
}

/** What `workflow slop status` says, and prints as JSON with `--json`. */
export interface SlopStatus {
  /** When the last audit was recorded; null: never. */
  since: string | null;
  plans: SlopPlan[];
  bypassed: number;
  drifted: number;
  areas: string[];
  due: boolean;
  /** Why an audit is due, in words; null when it is not. */
  why: string | null;
}

/** `n` and its noun: `1 plan`, `2 plans`; `plural` for a noun that does not just add an s. */
function counted(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/**
 * Whether a slop audit is due: the plans closed since the last audit reach `everyPlans` (0 turns
 * that count off), or the newest plan recorded left a bypassed home or a drifted copy.
 */
export function slopStatus(record: SlopRecord, everyPlans: number): SlopStatus {
  const { plans } = record;
  const newest = plans.reduce<SlopPlan | null>(
    (latest, one) => (latest === null || one.at >= latest.at ? one : latest),
    null,
  );
  const reasons: string[] = [];
  if (everyPlans > 0 && plans.length >= everyPlans) {
    reasons.push(
      `${counted(plans.length, "plan")} closed since the last audit (every ${everyPlans})`,
    );
  }
  if (newest !== null && newest.bypassed + newest.drifted > 0) {
    reasons.push(
      `plan ${newest.plan} left ${counted(newest.bypassed, "bypassed home")} and ${counted(newest.drifted, "drifted copy", "drifted copies")}`,
    );
  }
  return {
    since: record.auditedAt,
    plans,
    bypassed: plans.reduce((sum, one) => sum + one.bypassed, 0),
    drifted: plans.reduce((sum, one) => sum + one.drifted, 0),
    areas: [...new Set(plans.flatMap((one) => one.areas))].sort(),
    due: reasons.length > 0,
    why: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/** The status as a person reads it; `everyPlans` says whether the count is off. */
export function slopStatusLines(status: SlopStatus, everyPlans: number): string[] {
  const cadence = everyPlans === 0 ? "off" : `every ${everyPlans} plans`;
  const lines = [
    status.due
      ? `Slop audit: due — ${status.why}`
      : `Slop audit: not due (${counted(status.plans.length, "plan")} since the last audit; cadence ${cadence})`,
    `Last audit: ${status.since ?? "never"}`,
    `Since then: ${status.bypassed} bypassed, ${status.drifted} drifted`,
  ];
  if (status.plans.length > 0) {
    const listed = cappedHookList(
      status.plans,
      (one) => `${one.plan} (${one.bypassed} bypassed, ${one.drifted} drifted)`,
      `${COMMAND} workflow slop status --json`,
    );
    lines.push(`Plans: ${listed}`);
  }
  if (status.areas.length > 0) lines.push(`Areas: ${status.areas.join(", ")}`);
  return lines;
}
