/**
 * `cc-smart-dev-kit crew history [<phase>] [--plan <stem>] [--json] [--backfill]` (PL1): one line
 * per crew run of a plan, read from the run records in the plan's own folder (`runs.ts`) —
 * wherever the plan is now, in its plans folder or in `archive/`.
 *
 * `--backfill` writes the run records of runs that happened before the records existed, once,
 * from what the store still holds (the crew records, the events log and the hand-back reports),
 * and says what it could not know. It never changes a record that exists.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { type CliPaths, tildify } from "../cli/paths";
import { locateCheckout } from "../project/resolve";
import type { CrewContext } from "./context";
import { modelText } from "./display";
import {
  deriveTimes,
  findPlanFile,
  livePlanFolder,
  PLAN_ARCHIVE_DIR,
  planFolderOf,
  planStemOf,
  plansDirs,
  type RunEvent,
  type RunRecord,
  readRunFile,
  readRuns,
  runFile,
  startOf,
  writeRunFile,
} from "./runs";
import { callingSession } from "./session";
import {
  type CrewEvent,
  type CrewRecord,
  type LeadRecord,
  listCrew,
  listLeads,
  readCrewEvents,
  readReport,
} from "./store";

/** What `crew history` was asked. */
export interface HistoryArgs {
  backfill: boolean;
  json: boolean;
  phase: null | string;
  plan: null | string;
}

/** A duration in words: `1 h 30 min`, `42 min`, `35 s`; a dash when it is not known. */
export function durationText(ms: null | number): string {
  if (ms === null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A moment as `2026-10-25 06:21` (UTC), or a dash. */
function momentText(iso: null | string): string {
  if (iso === null) return "-";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toISOString().slice(0, 16).replace("T", " ");
}

/** The word for a run's outcome: how far it got. */
export function outcomeOf(run: RunRecord): string {
  if (run.times.mergedAt !== null) {
    return run.times.removedAt === null ? "merged" : "merged, removed";
  }
  if (run.times.removedAt !== null) return `removed (${run.state})`;
  return run.state;
}

/** One line of `crew history`: phase, sessions, model and effort, started, finished, took, status. */
export function historyLine(run: RunRecord, nowMs: number): string {
  const times =
    run.times.finishedAt === null
      ? deriveTimes({ ...run, startedAt: run.times.startedAt }, nowMs)
      : run.times;
  const sessions = run.sessions.map((one) => one.shortId ?? one.sessionId.slice(0, 8));
  return [
    run.phase.padEnd(6),
    `${run.slug}${run.continues === null ? "" : " (continued)"}`,
    `${sessions.length} session${sessions.length === 1 ? "" : "s"}${sessions.length === 0 ? "" : ` ${sessions.join(",")}`}`,
    `${modelText(run.model.named, run.model.resolved)} ${run.effort}`,
    `started ${momentText(times.startedAt)}`,
    `finished ${momentText(times.finishedAt)}`,
    `took ${durationText(times.workingMs)}`,
    outcomeOf(run),
  ].join(" · ");
}

/** The plan file `history` reads: `--plan`, the calling lead's, or the only plan the repository has. */
function historyPlan(
  args: HistoryArgs,
  leads: readonly LeadRecord[],
  repo: string,
  paths: CliPaths,
  callingId: null | string,
): { file: string } | { why: string } {
  const known = new Map<string, string>();
  for (const lead of leads) {
    if (typeof lead.planFile === "string" && lead.planFile !== "") {
      known.set(planStemOf(lead.planFile), lead.planFile);
    }
  }
  if (args.plan !== null) {
    const wanted = args.plan.replace(/\.md$/, "");
    const byLead = known.get(wanted);
    if (byLead !== undefined) return { file: byLead };
    const dirs = plansDirs(repo, paths);
    const stem = dirs
      .flatMap((dir) => [join(dir, `${wanted}.md`), join(dir, PLAN_ARCHIVE_DIR, `${wanted}.md`)])
      .find((file) => existsSync(file) || existsSync(planFolderOf(file)));
    if (stem !== undefined) return { file: stem };
    const found = findPlanFile(wanted, dirs);
    if (found.ok) return { file: found.file };
    return {
      why: `no plan "${args.plan}" is known here: ${found.reason === "several" ? `several files match (${found.matches.join(", ")})` : "no file or folder of that name in the plans folders"}`,
    };
  }
  const mine = leads.find((one) => one.sessionId === callingId);
  if (typeof mine?.planFile === "string" && mine.planFile !== "") return { file: mine.planFile };
  const files = [...known.values()];
  const [only] = files;
  if (files.length === 1 && only !== undefined) return { file: only };
  return {
    why:
      files.length === 0
        ? "no lead of this repository has a plan file recorded"
        : `this repository has ${files.length} plans (${[...known.keys()].join(", ")})`,
  };
}

/** True when the crew record belongs to the plan: its plan word is the stem, or ends the stem. */
function belongsTo(record: CrewRecord, planFile: string): boolean {
  const stem = planStemOf(planFile);
  if (typeof record.planFile === "string" && record.planFile !== "") {
    return planStemOf(record.planFile) === stem;
  }
  return stem === record.plan || stem.endsWith(`-${record.plan}`);
}

/** The kind of run event a store event of this state stands for. */
function kindOfState(state: string): string {
  if (state === "merged") return "merged";
  if (state === "removed") return "removed";
  return "state";
}

/** What a backfill could not know of every run it writes: said in the file and on the line. */
export const BACKFILL_UNKNOWN = [
  "earlier Claude session ids (the store keeps only the last one)",
  "which lead session answered, merged or removed",
  "why and for how long a pause lasted",
] as const;

/** A run record rebuilt from the crew record, its events and its report. */
function rebuilt(record: CrewRecord, events: readonly CrewEvent[], planFile: string): RunRecord {
  const base = startOf({ ...record, planFile }, record.createdAt);
  const runEvents: RunEvent[] = [];
  // The store keeps one report file per run, the last: only the last report event gets its facts.
  const lastReport = events.findLastIndex((one) => one.crew === record.id && one.type === "report");
  for (const [index, one] of events.entries()) {
    if (one.crew !== record.id) continue;
    if (!["created", "state", "report", "question"].includes(one.type)) continue;
    let detail: Record<string, unknown> | undefined;
    if (one.type === "report") detail = { status: one.text };
    if (one.type === "report" && index === lastReport) {
      let report: ReturnType<typeof readReport> = null;
      try {
        report = readReport(record.reportPath ?? "");
      } catch {
        // A report that cannot be read leaves the line without its details; the status stays.
        report = null;
      }
      if (report !== null) detail = { sha: report.branch.sha, status: report.status };
    }
    runEvents.push({
      at: one.at,
      by: null,
      ...(detail === undefined ? {} : { detail }),
      kind:
        one.type === "created"
          ? "created"
          : one.type === "report"
            ? "report"
            : one.type === "question"
              ? "question"
              : kindOfState(one.state),
      state: one.state,
      text: one.text,
    });
  }
  const sessions =
    record.sessionId === null
      ? []
      : [
          {
            at: record.startedAt ?? record.createdAt,
            by: null,
            sessionId: record.sessionId,
            shortId: record.shortId,
          },
        ];
  return {
    ...base,
    backfilled: [...BACKFILL_UNKNOWN],
    brief: { path: record.briefSource?.path ?? null, sha256: record.briefSource?.sha256 ?? null },
    continues: record.continues ?? null,
    events: runEvents,
    sessions,
    state: record.state,
    times: deriveTimes({
      createdAt: record.createdAt,
      events: runEvents,
      startedAt: record.startedAt ?? null,
    }),
    updatedAt: record.updatedAt,
  };
}

/**
 * Writes the run records the store can still rebuild for `planFile` (one per crew record of the
 * plan with no run file yet), and says how many and what they could not know.
 */
export function backfillRuns(planFile: string, repo: string, ctx: CrewContext): string[] {
  const { records } = listCrew(ctx.paths.stateDir, repo);
  const events = readCrewEvents(ctx.paths.stateDir, repo).events;
  const written: string[] = [];
  const broken: string[] = [];
  for (const record of records) {
    if (!belongsTo(record, planFile)) continue;
    const file = runFile(planFile, record.id);
    try {
      if (readRunFile(file) !== null) continue;
    } catch (error) {
      // A run file that cannot be read is not overwritten: it is named, and the rest goes on.
      broken.push(`${record.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    writeRunFile(file, rebuilt(record, events, planFile));
    written.push(record.id);
  }
  // A run that continues another is linked both ways, as a run recorded live is.
  for (const record of records) {
    if (!written.includes(record.id) || typeof record.continues !== "string") continue;
    try {
      const old = readRunFile(runFile(planFile, record.continues));
      if (old !== null && old.continuedBy === null) {
        writeRunFile(runFile(planFile, record.continues), { ...old, continuedBy: record.id });
      }
    } catch (error) {
      broken.push(`${record.continues}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const skipped = broken.map((one) => `backfill: left alone, it cannot be read: ${one}`);
  if (written.length === 0) {
    return [`backfill: nothing to write for ${planStemOf(planFile)}`, ...skipped];
  }
  return [
    ...skipped,
    `backfill: wrote ${written.length} run record${written.length === 1 ? "" : "s"} for ${planStemOf(planFile)} from the store (${written.join(", ")})`,
    `backfill: it could not know: ${BACKFILL_UNKNOWN.join("; ")}`,
  ];
}

/** `crew history`; the exit code. */
export async function runCrewHistory(args: HistoryArgs, ctx: CrewContext): Promise<number> {
  let repo: string;
  try {
    const checkout = locateCheckout(ctx.cwd, { env: ctx.env });
    if (checkout === null) throw new Error("this folder is not in a git project");
    repo = checkout.mainCheckout ?? checkout.root;
  } catch (error) {
    ctx.error(`crew history: ${error instanceof Error ? error.message : String(error)}`);
    ctx.error("Fix: run it in the project's folder");
    return 1;
  }
  let callingId: null | string = null;
  try {
    callingId =
      callingSession(ctx.paths.claudeConfigDir, ctx.pid, ctx.processes.parentOf, ctx.env)
        ?.sessionId ?? null;
  } catch {
    // The calling session is unknown: the plan is then named by --plan or by the repository.
    callingId = null;
  }
  const plan = historyPlan(
    args,
    listLeads(ctx.paths.stateDir, repo).records,
    repo,
    ctx.paths,
    callingId,
  );
  if ("why" in plan) {
    ctx.error(`crew history: ${plan.why}`);
    ctx.error(`Fix: ${COMMAND} crew history --plan <plan stem>`);
    return 1;
  }
  if (args.backfill) {
    try {
      for (const line of backfillRuns(plan.file, repo, ctx)) ctx.print(line);
    } catch (error) {
      ctx.error(`crew history: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  const read = readRuns(plan.file);
  for (const broken of read.broken) ctx.error(`crew history: ${broken.why}`);
  const runs = read.runs.filter((one) => args.phase === null || one.phase === args.phase);
  const code = read.broken.length === 0 ? 0 : 1;
  if (args.json) {
    ctx.print(JSON.stringify(runs, null, 2));
    return code;
  }
  if (runs.length === 0) {
    ctx.print(
      args.phase === null
        ? `No crew runs are recorded for ${planStemOf(plan.file)} yet.`
        : `No crew run of phase ${args.phase} is recorded for ${planStemOf(plan.file)}.`,
    );
    return code;
  }
  ctx.print(`${planStemOf(plan.file)} · ${tildify(livePlanFolder(plan.file), ctx.paths.home)}`);
  for (const run of runs) ctx.print(historyLine(run, ctx.now()));
  return code;
}
