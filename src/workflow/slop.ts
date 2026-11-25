/**
 * The slop record (`cc-smart-dev-kit workflow slop`): how many plans closed on this machine and
 * are not yet covered by a slop audit, how many bypassed homes and drifted copies their reviews
 * found, the areas of code they touched, and when an audit is due.
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import { plural } from "../cli/ui/out";
import { cappedHookList } from "../hooks/capped-list";
import { atomicWrite } from "../setup/write";
import { settledBy } from "../tasks/work/queries";
import { BUILD_OUTPUT_FOLDERS, HISTORY_FOLDERS, PROSE_FILE } from "./claims";
import { repoKey, underRecordLock } from "./reviews";

/** How many plans one repository's record keeps: the newest, older ones dropped. */
export const SLOP_PLANS_KEPT = 50;

/** The most bypassed homes or drifted copies one plan may record: a larger count is a typo. */
export const SLOP_COUNT_MAX = 1000;

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
  /**
   * How many plans closed that no audit has cleared yet: the count the cadence reads. It is kept
   * apart from `plans`, which keeps only the newest `SLOP_PLANS_KEPT`.
   */
  unaudited: number;
  /** The plans no audit has cleared yet, oldest first. */
  plans: SlopPlan[];
}

const count = z.number().int().min(0);

// `z.object`, not a strict one: a field a newer version adds is read past, so a session of an
// older version keeps the count instead of calling the file broken.
const recordSchema = z.object({
  auditedAt: z.string().nullable(),
  unaudited: count,
  plans: z.array(
    z.object({
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
 * trailing `/` and a deeper path both count as the folder they sit in), each once, sorted. A path
 * every plan touches (`plans.mergeFiles`, judged by the overlap check's own rule, `settledBy`,
 * without case when the checkout ignores case) and build output (`BUILD_OUTPUT_FOLDERS`) are no
 * area: an audit there would read what no plan wrote by hand. Nor are a prose file (`PROSE_FILE`)
 * and the kit's plan and research folders (`HISTORY_FOLDERS`), which the claims skip too: a slop
 * audit reads code.
 */
export function areasOf(
  paths: readonly string[],
  mergeFiles: readonly string[],
  caseFold = false,
): string[] {
  const fold = (path: string) => (caseFold ? path.toLowerCase() : path);
  const settled = [...mergeFiles, ...HISTORY_FOLDERS.map((folder) => `${folder}/`)].map(fold);
  const areas = new Set<string>();
  for (const path of paths) {
    if (settledBy(settled, fold(path)) || PROSE_FILE.test(path)) continue;
    const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.some((segment) => BUILD_OUTPUT_FOLDERS.includes(segment))) continue;
    const area = segments.slice(0, 2).join("/");
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { auditedAt: null, unaudited: 0, plans: [] };
    }
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

function save(file: string, record: SlopRecord): SlopRecord {
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
  return record;
}

/**
 * Records one closed plan at `atMs`. An earlier record of the same plan is replaced, so the lead
 * may run it twice; only a plan new to the record adds one to `unaudited`. The newest
 * `SLOP_PLANS_KEPT` plans stay. Throws `LockBusyError` when the lock stays held past
 * `REVIEWS_LOCK_WAIT_MS`.
 */
export async function recordSlop(
  file: string,
  closed: Omit<SlopPlan, "at">,
  atMs: number,
): Promise<SlopRecord> {
  return await underRecordLock(file, () => {
    const record = readSlop(file);
    const known = record.plans.some((one) => one.plan === closed.plan);
    return save(file, {
      auditedAt: record.auditedAt,
      unaudited: record.unaudited + (known ? 0 : 1),
      plans: [
        ...record.plans.filter((one) => one.plan !== closed.plan),
        { ...closed, at: new Date(atMs).toISOString() },
      ].slice(-SLOP_PLANS_KEPT),
    });
  });
}

/** What an audit changed: the record it left, and how many plans it took out of the count. */
export interface AuditResult {
  record: SlopRecord;
  cleared: number;
}

/**
 * Records an audit at `atMs`. With no `paths`, every plan is audited and the count starts again.
 * With paths (repository paths, no trailing `/`), an area is cleared when it is one of them or
 * lies under one (`settledBy`, without case when `caseFold`, as `areasOf` made it): a plan whose
 * areas are all cleared leaves the count, one with areas left stays with those, and a plan that
 * named no area stays until an audit of everything.
 */
export async function recordAudit(
  file: string,
  paths: readonly string[],
  atMs: number,
  caseFold = false,
): Promise<AuditResult> {
  return await underRecordLock(file, () => {
    const before = readSlop(file);
    const auditedAt = new Date(atMs).toISOString();
    if (paths.length === 0) {
      return {
        record: save(file, { auditedAt, unaudited: 0, plans: [] }),
        cleared: before.unaudited,
      };
    }
    const fold = (path: string) => (caseFold ? path.toLowerCase() : path);
    const audited = paths.map((path) => fold(`${path}/`));
    const covered = (area: string) => settledBy(audited, fold(`${area}/`));
    const plans = before.plans.flatMap((one) => {
      const left = one.areas.filter((area) => !covered(area));
      if (one.areas.length > 0 && left.length === 0) return [];
      return [{ ...one, areas: left }];
    });
    const cleared = before.plans.length - plans.length;
    return {
      record: save(file, { auditedAt, unaudited: before.unaudited - cleared, plans }),
      cleared,
    };
  });
}

/** What `workflow slop status` says, and prints as JSON with `--json`. */
export interface SlopStatus {
  /** When the last audit was recorded; null: never. */
  since: string | null;
  /** How many plans closed that no audit has cleared yet. */
  unaudited: number;
  /** The newest of those plans, at most `SLOP_PLANS_KEPT`. */
  plans: SlopPlan[];
  bypassed: number;
  drifted: number;
  areas: string[];
  due: boolean;
  /** Why an audit is due, in words; null when it is not. */
  why: string | null;
}

/**
 * Whether a slop audit is due: the plans no audit has cleared reach a multiple of `everyPlans`
 * (5, 10, 15…, so a declined offer comes back `everyPlans` plans later; 0 turns that count off),
 * or the plan just recorded left a bypassed home or a drifted copy. Either counts only when that
 * plan closed after the last audit: an audit of some areas takes plans out of the record, and what
 * is left must not make the audit due again before the next plan closes.
 */
export function slopStatus(record: SlopRecord, everyPlans: number): SlopStatus {
  const { plans, unaudited } = record;
  const newest = plans.reduce<SlopPlan | null>(
    (latest, one) => (latest === null || one.at >= latest.at ? one : latest),
    null,
  );
  const fresh = newest !== null && (record.auditedAt === null || newest.at > record.auditedAt);
  const reasons: string[] = [];
  if (fresh && everyPlans > 0 && unaudited % everyPlans === 0) {
    reasons.push(
      `${plural(unaudited, "plan", "plans")} closed and not audited yet (every ${everyPlans})`,
    );
  }
  if (fresh && newest.bypassed + newest.drifted > 0) {
    reasons.push(
      `plan ${newest.plan} left ${plural(newest.bypassed, "bypassed home", "bypassed homes")} and ${plural(newest.drifted, "drifted copy", "drifted copies")}`,
    );
  }
  return {
    since: record.auditedAt,
    unaudited,
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
  const cadence =
    everyPlans === 0
      ? "off"
      : `every ${everyPlans} plans, next at ${(Math.floor(status.unaudited / everyPlans) + 1) * everyPlans}`;
  const lines = [
    status.due
      ? `Slop audit: due — ${status.why}`
      : `Slop audit: not due (${plural(status.unaudited, "plan", "plans")} not audited yet; cadence ${cadence})`,
    `Last audit: ${status.since ?? "never"}`,
    `Not audited yet: ${status.bypassed} bypassed, ${status.drifted} drifted`,
  ];
  const rest = `${COMMAND} workflow slop status --json`;
  if (status.plans.length > 0) {
    const listed = cappedHookList(
      status.plans,
      (one) => `${one.plan} (${one.bypassed} bypassed, ${one.drifted} drifted)`,
      rest,
    );
    lines.push(`Plans: ${listed}`);
  }
  if (status.areas.length > 0) lines.push(`Areas: ${status.areas.join(", ")}`);
  const unscoped = status.plans.filter((one) => one.areas.length === 0);
  if (unscoped.length > 0) {
    lines.push(
      `No area: ${cappedHookList(unscoped, (one) => one.plan, rest)}. Only an audit with no --area clears a plan that named no area.`,
    );
  }
  const unlisted = status.unaudited - status.plans.length;
  if (unlisted > 0) {
    lines.push(
      `Not listed: ${plural(unlisted, "plan", "plans")} past the ${SLOP_PLANS_KEPT} kept. Only ${COMMAND} workflow slop audited with no --area clears them.`,
    );
  }
  return lines;
}
