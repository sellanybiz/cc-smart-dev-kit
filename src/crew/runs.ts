/**
 * A plan's own folder, and the record of each crew run that lives in it (PL1).
 *
 *   <plans dir>/<plan stem>.md                          the plan file
 *   <plans dir>/<plan stem>/briefs/<PHASE>-<slug>.md    the briefs, named as the crew branch
 *   <plans dir>/<plan stem>/runs/<crew id>.json          one record per crew run
 *   <plans dir>/archive/<plan stem>/…                    the same folder after the plan is archived
 *
 * **Where the plan is.** The lead record holds `planFile` (`crew lead --plan-file`, or one
 * unique `<plans dir>/*-<plan slug>.md`, `findPlanFile`); the crew record copies it when the
 * run starts, so a lead that hands over to another lead, and a `crew rm` months later, find
 * the same folder. A plan archived since is found beside its old place (`livePlanFolder`).
 *
 * **The run record.** One JSON file per run (a continuation is its own run, linked both ways),
 * so two leads never write one file and a merge conflict stays impossible. It is written by the
 * store's own writers (`store.ts`), in the same hold of the store's lock as the change and its
 * event: there is no second log and no second code path that decides what happened. It holds
 * the facts a run starts with, every Claude Code session id it ran under, and its milestones
 * (`RunEvent`), each naming the lead session that made it; the times are derived from those
 * (`deriveTimes`) and written beside them so a person can read the file.
 *
 * **Never deleted.** `crew rm` and the clean-up of finished work leave it. It moves with its
 * plan to the archive, and `crew history` reads it there. A crew session's own worktree has no
 * plan folder: the file is written at the absolute place the lead record gave.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import { atomicWrite } from "../setup/write";
import { describeIssues } from "../zod-issues";
import type { CrewEvent, CrewRecord, HandBackReport, LeadRecord } from "./store";

/** The folders of a plan's own folder. */
export const BRIEFS_DIR = "briefs";
export const RUNS_DIR = "runs";
/** The folder of a plans directory the finished plans move to. */
export const PLAN_ARCHIVE_DIR = "archive";

/** The schema version of a run record. */
export const RUN_VERSION = 1;

const text = z.string().min(1);
const actor = z.looseObject({ name: text, sessionId: text });

/** Who made a change: a lead session, by its id and its name. */
export type RunActor = z.infer<typeof actor>;

// -- Where things are ---------------------------------------------------------------------------

/** The plan's own folder: its file's path without `.md`. */
export function planFolderOf(planFile: string): string {
  return planFile.replace(/\.md$/, "");
}

/** The plan's stem: the file's name without `.md`. */
export function planStemOf(planFile: string): string {
  return basename(planFile, ".md");
}

/**
 * The plan's folder as it is now: where its file says, or — when the plan was archived since —
 * `<plans dir>/archive/<stem>`. A plan with neither yet gets the first (the folder is made when
 * the first brief or run lands in it).
 */
export function livePlanFolder(planFile: string): string {
  const folder = planFolderOf(planFile);
  if (existsSync(folder)) return folder;
  const archived = join(dirname(folder), PLAN_ARCHIVE_DIR, basename(folder));
  if (!existsSync(planFile) && (existsSync(archived) || existsSync(`${archived}.md`))) {
    return archived;
  }
  return folder;
}

/** A phase's brief inside the plan's folder: named as the crew branch, `<PHASE>-<slug>.md`. */
export function planBriefFile(planFile: string, phase: string, slug: string): string {
  return join(livePlanFolder(planFile), BRIEFS_DIR, `${phase}-${slug}.md`);
}

/** The run record of crew run `id`. */
export function runFile(planFile: string, id: string): string {
  return join(livePlanFolder(planFile), RUNS_DIR, `${id}.json`);
}

/** The plans directories a plan may be found in: the repository's, and the person's own. */
export function plansDirs(repo: string, paths: Pick<CliPaths, "claudeConfigDir">): string[] {
  return [join(repo, ".claude", "plans"), join(paths.claudeConfigDir, "plans")];
}

/** Why `findPlanFile` found no file. */
export type PlanLookup =
  | { file: string; ok: true }
  | { ok: false; reason: "none" | "several"; matches: string[] };

/**
 * The plan file of plan `slug`: the one `<plans dir>/<YYYY-MM-DD>-<slug>.md` (or `<slug>.md`) in
 * the plans directories and the `archive/` folder of each. Exactly one match or none: two files
 * are two plans, and a guess would put a run record in the wrong one.
 */
export function findPlanFile(slug: string, dirs: readonly string[]): PlanLookup {
  const name = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}-)?${escapeRegExp(slug)}\\.md$`);
  const matches: string[] = [];
  for (const dir of dirs) {
    for (const folder of [dir, join(dir, PLAN_ARCHIVE_DIR)]) {
      let names: string[];
      try {
        names = readdirSync(folder);
      } catch {
        // No such folder: this place holds no plan.
        continue;
      }
      for (const one of names.sort()) if (name.test(one)) matches.push(join(folder, one));
    }
  }
  const [file] = matches;
  if (matches.length === 1 && file !== undefined) return { file, ok: true };
  return { matches, ok: false, reason: matches.length === 0 ? "none" : "several" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The plan file of a lead: its own field, else the same plan's earlier lead, else the lookup. */
export function planFileOfLead(
  lead: Pick<LeadRecord, "plan" | "planFile">,
  others: readonly Pick<LeadRecord, "plan" | "planFile">[],
  lookup: () => PlanLookup,
): PlanLookup {
  if (typeof lead.planFile === "string" && lead.planFile !== "") {
    return { file: lead.planFile, ok: true };
  }
  const earlier = others.find(
    (one) => one.plan === lead.plan && typeof one.planFile === "string" && one.planFile !== "",
  );
  if (earlier?.planFile) return { file: earlier.planFile, ok: true };
  return lookup();
}

/** The sha-256 of a brief's text, in hex. */
export function briefHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// -- The record ---------------------------------------------------------------------------------

/** What happened, in the words the file keeps. */
export const RUN_EVENT_KINDS = [
  "created",
  "state",
  "session",
  "question",
  "answer",
  "report",
  "merged",
  "removed",
  "note",
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

const runEventSchema = z.looseObject({
  at: text,
  /** A kind this kit knows, or a newer kit's word, kept as it is. */
  kind: text,
  /** The lead session that made the change; null when the crew session or the kit did. */
  by: actor.nullable(),
  /** The crew session's state after it. */
  state: text,
  text: z.string().nullable(),
  /** Facts that belong to the kind only (the report's status, the merge's commit, …). */
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type RunEvent = z.infer<typeof runEventSchema>;

const runTimesSchema = z.looseObject({
  createdAt: text,
  /** When its session began; null while it waits in the queue. */
  startedAt: text.nullable(),
  /** When its work ended (done, failed, or handed off); null while it runs. */
  finishedAt: text.nullable(),
  mergedAt: text.nullable(),
  removedAt: text.nullable(),
  /** createdAt → finishedAt, in ms; null until it finishes. */
  wallMs: z.number().nullable(),
  /** startedAt → finishedAt without the pauses, in ms; null until it finishes. */
  workingMs: z.number().nullable(),
  queuedMs: z.number().nullable(),
  pausedMs: z.number(),
  pauses: z.array(z.looseObject({ from: text, to: text.nullable(), reason: text })),
});
export type RunTimes = z.infer<typeof runTimesSchema>;

/** The run record's file. Loose: a newer kit's fields are kept when this kit writes it again. */
export const runRecordSchema = z.looseObject({
  version: z.number().int().min(1),
  id: text,
  name: text,
  plan: text,
  phase: text,
  slug: text,
  kind: text,
  model: z.looseObject({
    named: text,
    resolved: text,
    slot: z.string().nullable(),
  }),
  effort: text,
  branch: text,
  baseRef: text,
  base: z.looseObject({ ref: text, sha: text }).nullable(),
  /** The brief the run started from: its path (null for stdin) and the hash of its text. */
  brief: z.looseObject({ path: z.string().nullable(), sha256: z.string().nullable() }),
  /** The lead that started it. */
  lead: actor,
  /** The run this one continues, and the run that continued this one. */
  continues: z.string().nullable(),
  continuedBy: z.string().nullable(),
  /** Every Claude Code session id it ran under: the start, and each resume. */
  sessions: z.array(
    z.looseObject({
      at: text,
      by: actor.nullable(),
      sessionId: text,
      shortId: z.string().nullable(),
    }),
  ),
  /** Where it is now. */
  state: text,
  events: z.array(runEventSchema),
  times: runTimesSchema,
  /** The context its last reply used, in tokens, when the transcript gave it. */
  contextTokens: z.number().int().min(0).nullable().optional(),
  /** What a backfill could not know; absent for a run recorded as it happened. */
  backfilled: z.array(text).optional(),
  createdAt: text,
  updatedAt: text,
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/** Everything a store write tells the record. */
export interface RunChange {
  /** The crew record before the change; null for the first write. */
  before: CrewRecord | null;
  after: CrewRecord;
  /** The time of the change (ISO 8601). */
  at: string;
  /** The lead that made it, when the writer knows; else the record's own lead for a lead's act. */
  by?: RunActor | null | undefined;
  /** A hand-back report the change brings. */
  report?: HandBackReport | undefined;
  /** What the store's event line says, for the reason of a state change. */
  event?: Pick<CrewEvent, "text"> | null | undefined;
  /** The context the last reply used, in tokens, when the caller read it. */
  contextTokens?: number | null | undefined;
}

/** What a lead's act is, when its writer gave no name: the lead the crew session belongs to. */
function leadOf(record: CrewRecord): RunActor {
  return { name: record.leadName, sessionId: record.leadSessionId };
}

/** The first line of a text, cut short: an answer or a question in one line. */
function oneLine(value: string, max = 160): string {
  const line = value.split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The events one change makes. */
function eventsOf(change: RunChange): RunEvent[] {
  const { after, at, before, report } = change;
  const lead = change.by === undefined ? leadOf(after) : change.by;
  const base = { at, state: after.state };
  const events: RunEvent[] = [];
  if (before === null) {
    events.push({ ...base, by: change.by ?? leadOf(after), kind: "created", text: null });
  } else if (before.state !== after.state) {
    const reason = change.event?.text ?? null;
    if (after.state === "merged") {
      events.push({
        ...base,
        by: lead,
        detail: {
          commit: after.mergeProof?.leadCommit ?? null,
          head: after.mergeProof?.head ?? null,
          leadRef: after.mergeProof?.leadRef ?? null,
        },
        kind: "merged",
        text: reason,
      });
    } else if (after.state === "removed") {
      events.push({
        ...base,
        by: lead,
        detail: { mergedBeforeRemoval: after.mergedBeforeRemoval ?? false },
        kind: "removed",
        text: reason,
      });
    } else {
      events.push({
        ...base,
        by: after.state === "discarded" ? lead : null,
        ...(after.state === "paused" && after.waitingFor !== undefined
          ? { detail: { waitingFor: after.waitingFor } }
          : {}),
        kind: "state",
        text: reason,
      });
    }
  }
  if (after.sessionId !== null && after.sessionId !== before?.sessionId) {
    events.push({
      ...base,
      by: null,
      detail: { sessionId: after.sessionId, shortId: after.shortId },
      kind: "session",
      text: null,
    });
  }
  const askedBefore = before?.questions.length ?? 0;
  for (const [index, asked] of after.questions.entries()) {
    if (index >= askedBefore) {
      events.push({
        ...base,
        by: null,
        detail: { index },
        kind: "question",
        text: oneLine(asked.question),
      });
    }
    if (asked.answer !== null && before?.questions[index]?.answer === null) {
      events.push({
        ...base,
        by: lead,
        detail: { index },
        kind: "answer",
        text: oneLine(asked.answer),
      });
    }
  }
  if (report !== undefined) {
    events.push({
      ...base,
      by: null,
      detail: {
        checksFailed: report.checks.filter((one) => !one.ok).length,
        review:
          report.review === null
            ? null
            : {
                agent: report.review.agent,
                effort: report.review.effort,
                model: report.review.model,
              },
        sha: report.branch.sha,
        status: report.status,
        testsFailed:
          report.tests.targeted.reduce((sum, one) => sum + one.failed, 0) +
          (report.tests.full?.failed ?? 0),
        testsPassed:
          report.tests.targeted.reduce((sum, one) => sum + one.passed, 0) +
          (report.tests.full?.passed ?? 0),
        wholeSuite: report.tests.full === null ? null : report.tests.full.ok,
      },
      kind: "report",
      text: report.status,
    });
  }
  return events;
}

const END_OF_WORK = ["done", "failed", "handoff"];

/**
 * The times a run's events say. Wall time runs from the record to the end of the work, working
 * time from the session's start to that end without the pauses; a run still going has neither.
 * A pause still open at `nowMs` counts to it.
 */
export function deriveTimes(
  run: Pick<RunRecord, "createdAt" | "events"> & { startedAt: null | string },
  nowMs: null | number = null,
): RunTimes {
  // The work ended at the last event that says so (a run answered after it reported, and ended
  // again, ended the second time); a state change after it that is no end (it works again) means
  // it has not ended.
  const lastEnd = run.events.findLastIndex(
    (one) => END_OF_WORK.includes(one.state) && one.kind !== "created",
  );
  const runsAgain = run.events
    .slice(lastEnd + 1)
    .some((one) => one.kind === "state" && !["stopped", "handoff"].includes(one.state));
  const finishedAt = lastEnd === -1 || runsAgain ? null : (run.events[lastEnd]?.at ?? null);
  const mergedAt = run.events.find((one) => one.kind === "merged")?.at ?? null;
  const removedAt = run.events.find((one) => one.kind === "removed")?.at ?? null;
  const startedAt =
    run.startedAt ??
    run.events.find((one) => one.kind === "state" && !["queued", "failed"].includes(one.state))
      ?.at ??
    null;
  const pauses: RunTimes["pauses"] = [];
  let open: null | { from: string; reason: string } = null;
  for (const one of run.events) {
    if (one.kind !== "state" && one.kind !== "merged" && one.kind !== "removed") continue;
    if (open !== null && one.state !== "paused") {
      pauses.push({ ...open, to: one.at });
      open = null;
    }
    if (open === null && one.state === "paused") {
      const waiting = one.detail?.waitingFor;
      const kind =
        typeof waiting === "object" && waiting !== null && "kind" in waiting
          ? String((waiting as { kind: unknown }).kind)
          : "unknown";
      open = { from: one.at, reason: kind };
    }
  }
  if (open !== null) pauses.push({ ...open, to: null });
  const endMs = finishedAt === null ? nowMs : Date.parse(finishedAt);
  const startMs = startedAt === null ? null : Date.parse(startedAt);
  let pausedMs = 0;
  for (const pause of pauses) {
    const from = Date.parse(pause.from);
    const to = pause.to === null ? endMs : Date.parse(pause.to);
    if (to === null || Number.isNaN(from) || Number.isNaN(to)) continue;
    const clippedFrom = startMs === null ? from : Math.max(from, startMs);
    const clippedTo = endMs === null ? to : Math.min(to, endMs);
    if (clippedTo > clippedFrom) pausedMs += clippedTo - clippedFrom;
  }
  const createdMs = Date.parse(run.createdAt);
  const finishedMs = finishedAt === null ? null : Date.parse(finishedAt);
  return {
    createdAt: run.createdAt,
    finishedAt,
    mergedAt,
    pausedMs,
    pauses,
    queuedMs: startMs === null ? null : Math.max(0, startMs - createdMs),
    removedAt,
    startedAt,
    wallMs: finishedMs === null ? null : Math.max(0, finishedMs - createdMs),
    workingMs:
      finishedMs === null || startMs === null ? null : Math.max(0, finishedMs - startMs - pausedMs),
  };
}

/** The first record of a run, from the crew record that began it. */
export function startOf(after: CrewRecord, at: string): RunRecord {
  const source = after.briefSource;
  return {
    base: after.base ?? null,
    baseRef: after.baseRef,
    branch: after.branch,
    brief: { path: source?.path ?? null, sha256: source?.sha256 ?? null },
    continuedBy: null,
    continues: after.continues ?? null,
    createdAt: at,
    effort: after.effort,
    events: [],
    id: after.id,
    kind: after.kind,
    lead: leadOf(after),
    model: { named: after.model.named, resolved: after.model.resolved, slot: after.model.slot },
    name: after.name,
    phase: after.phase,
    plan: after.plan,
    sessions: [],
    slug: after.slug,
    state: after.state,
    times: deriveTimes({ createdAt: at, events: [], startedAt: null }),
    updatedAt: at,
    version: RUN_VERSION,
  };
}

/**
 * The run record after a change: the previous one (or the first) with the change's events, its
 * sessions, and the times derived again. Pure; the caller writes it.
 */
export function nextRun(previous: RunRecord | null, change: RunChange): RunRecord {
  const { after, at } = change;
  const run = previous ?? startOf(after, change.before === null ? at : after.createdAt);
  const events = eventsOf(change);
  const sessions = [...run.sessions];
  for (const one of events) {
    if (one.kind !== "session") continue;
    const sessionId = String(one.detail?.sessionId ?? "");
    if (sessionId === "" || sessions.some((known) => known.sessionId === sessionId)) continue;
    const shortId = one.detail?.shortId;
    sessions.push({
      at: one.at,
      by: one.by,
      sessionId,
      shortId: typeof shortId === "string" ? shortId : null,
    });
  }
  const all = [...run.events, ...events];
  const startedAt = after.startedAt ?? run.times.startedAt;
  return {
    ...run,
    // Fields a record gets after its first write: the model and base when a queued run starts.
    base: after.base ?? run.base,
    brief:
      after.briefSource === undefined
        ? run.brief
        : { path: after.briefSource.path, sha256: after.briefSource.sha256 },
    ...(change.contextTokens === undefined || change.contextTokens === null
      ? {}
      : { contextTokens: change.contextTokens }),
    events: all,
    sessions,
    state: after.state,
    times: deriveTimes({ createdAt: run.createdAt, events: all, startedAt }),
    updatedAt: at,
    version: Math.max(run.version, RUN_VERSION),
  };
}

// -- The writer ---------------------------------------------------------------------------------

/** Reads a run record; null when there is none. Throws, naming the file, when it is broken. */
export function readRunFile(file: string): RunRecord | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : error}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid ${file}: not valid JSON (${error instanceof Error ? error.message : error})`,
    );
  }
  const parsed = runRecordSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  return parsed.data;
}

/** Writes a run record whole: its folder made, the file replaced atomically (a plan file's mode). */
export function writeRunFile(file: string, run: RunRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(run, null, 2)}\n`, 0o644);
}

/**
 * Records one change of a crew record in its run record. The store calls it inside its own hold
 * of the lock, so two writers (the watch and the CLI) never read the same file at once. Nothing
 * happens for a crew record with no plan file: its run is not recorded. A change that makes no
 * event and no session adds nothing and writes nothing.
 */
export function recordRun(change: RunChange): void {
  const planFile = change.after.planFile;
  if (typeof planFile !== "string" || planFile === "") return;
  const file = runFile(planFile, change.after.id);
  const previous = readRunFile(file);
  if (previous !== null && eventsOf(change).length === 0 && change.contextTokens == null) return;
  writeRunFile(file, nextRun(previous, change));
  const continues = change.after.continues;
  if (change.before === null && typeof continues === "string") {
    linkContinuation(planFile, continues, change.after.id, change.at);
  }
}

/** Marks the run `oldId` as continued by `newId`: the link both ways. */
function linkContinuation(planFile: string, oldId: string, newId: string, at: string): void {
  const file = runFile(planFile, oldId);
  const old = readRunFile(file);
  if (old === null || old.continuedBy === newId) return;
  writeRunFile(file, { ...old, continuedBy: newId, updatedAt: at });
}

/**
 * A line the run record keeps that is not a state change: the model of a running crew session
 * changed (MC1 calls this when it lands), or a note a later phase adds. Under the store's lock
 * like every other write (`noteCrewRun`, `store.ts`).
 */
export function recordRunNote(
  record: CrewRecord,
  at: string,
  note: { by?: RunActor | null; detail?: Record<string, unknown>; text: string },
): void {
  const planFile = record.planFile;
  if (typeof planFile !== "string" || planFile === "") return;
  const file = runFile(planFile, record.id);
  const previous = readRunFile(file);
  if (previous === null) return;
  const events = [
    ...previous.events,
    {
      at,
      by: note.by ?? null,
      ...(note.detail === undefined ? {} : { detail: note.detail }),
      kind: "note",
      state: record.state,
      text: note.text,
    },
  ];
  writeRunFile(file, {
    ...previous,
    events,
    times: deriveTimes({
      createdAt: previous.createdAt,
      events,
      startedAt: previous.times.startedAt,
    }),
    updatedAt: at,
  });
}

// -- Reading ------------------------------------------------------------------------------------

/** Every run record in a plan's folder, oldest first; the broken files named. */
export function readRuns(planFile: string): {
  broken: Array<{ file: string; why: string }>;
  runs: RunRecord[];
} {
  const folder = join(livePlanFolder(planFile), RUNS_DIR);
  const result: { broken: Array<{ file: string; why: string }>; runs: RunRecord[] } = {
    broken: [],
    runs: [],
  };
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    // No runs folder yet: nothing has run for this plan.
    return result;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const file = join(folder, name);
    try {
      const run = readRunFile(file);
      if (run !== null) result.runs.push(run);
    } catch (error) {
      result.broken.push({ file, why: error instanceof Error ? error.message : String(error) });
    }
  }
  result.runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return result;
}
