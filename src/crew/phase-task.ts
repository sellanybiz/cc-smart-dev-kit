/** The crew's link to the kit's phase tasks. Store trouble never prevents crew work. */
import { readFileSync } from "node:fs";
import { projectKey } from "../tasks/context";
import { openWorkDb, type WorkDb, workDbFile } from "../tasks/work/db";
import { callerOf } from "../tasks/work/identity";
import { allTasks } from "../tasks/work/queries";
import { phaseProgressByCrew } from "../tasks/work/read";
import { ensurePhaseTask, ensurePlanTask, systemClose } from "../tasks/work/store";
import { SUBJECT_LIMIT, type Who } from "../tasks/work/types";
import type { CrewContext } from "./context";
import type { CrewRecord } from "./store";

/**
 * One store read for the whole board, including boards spanning repositories: `closed/total`
 * per crew session, keyed `<project>:<crew id>`. A store it cannot read is one stderr note, and
 * the board shows no counts.
 */
export function phaseProgress(
  stateDir: string,
  records: readonly CrewRecord[],
): Map<string, string> {
  const result = new Map<string, string>();
  const read = phaseProgressByCrew(
    { stateDir },
    records.map((record) => projectKey(record.repo)),
  );
  if (read.state === "unreadable")
    process.stderr.write(`note: phase progress cannot be read: ${read.why}\n`);
  if (read.state === "ready")
    for (const [key, count] of read.value) result.set(key, `${count.closed}/${count.total}`);
  return result;
}

const UNKNOWN: Who = { sessionId: null, crewId: null, pid: null, procStart: null };

function title(record: CrewRecord): string {
  if (!record.briefSource?.path) return record.phase;
  try {
    return (
      /^#\s+(.+)$/m
        .exec(readFileSync(record.briefSource?.path, "utf8"))?.[1]
        ?.trim()
        .slice(0, SUBJECT_LIMIT) || record.phase
    );
  } catch {
    // The start already handles an unreadable brief; a task still has its phase word.
    return record.phase;
  }
}

/** Called for both a new record (queued too) and its actual launch. */
export function writePhaseTask(record: CrewRecord, ctx: CrewContext): void {
  let db: WorkDb | undefined;
  try {
    db = openWorkDb(workDbFile(ctx.paths), { mode: "write" });
    const project = projectKey(record.repo);
    const who = callerOf({ env: ctx.env, claudeConfigDir: ctx.paths.claudeConfigDir }) ?? UNKNOWN;
    const plan = ensurePlanTask(
      db,
      { project, plan: record.plan, subject: record.plan },
      who,
      ctx.now(),
    );
    if (!plan.ok) throw new Error(plan.why);
    const phases = new Set(
      allTasks(db, project)
        .filter((t) => t.kind === "phase" && t.plan === record.plan)
        .map((t) => t.phase),
    );
    const missing = record.waitsFor.filter((phase) => !phases.has(phase));
    const result = ensurePhaseTask(
      db,
      {
        project,
        plan: record.plan,
        phase: record.phase,
        subject: title(record),
        description: record.briefSource?.path ?? "",
        crewId: record.id,
        waitsForPhases: record.waitsFor.filter((phase) => phases.has(phase)),
      },
      who,
      ctx.now(),
    );
    if (!result.ok) throw new Error(result.why);
    if (missing.length)
      ctx.print(`note: phase task dependencies skipped: no task yet for ${missing.join(", ")}`);
  } catch (error) {
    ctx.print(
      `note: the phase task could not be written: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    db?.close();
  }
}

/** State transitions use this once, after the crew store has saved the outcome. */
export function closePhaseTask(
  stateDir: string,
  record: CrewRecord,
  outcome: "done" | "dropped",
  reason: string,
  now: number,
  error: (line: string) => void,
): void {
  let db: WorkDb | undefined;
  try {
    db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
    const phase = allTasks(db, projectKey(record.repo)).find(
      (t) => t.kind === "phase" && t.crewId === record.id,
    );
    if (!phase || phase.status === "done" || phase.status === "dropped") return;
    const result = systemClose(db, phase.id, outcome, reason, UNKNOWN, now);
    if (!result.ok) throw new Error(result.why);
  } catch (cause) {
    error(
      `note: the phase task could not be closed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  } finally {
    db?.close();
  }
}
