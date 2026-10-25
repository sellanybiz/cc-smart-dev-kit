/**
 * `cc-smart-dev-kit crew report …`: what a crew session gives its lead when its phase ends, and the
 * question it asks its lead while it works (D36).
 *
 * **Two commands in one:**
 *
 * - `--status done|blocked|failed|handoff --file <file|->` — the hand-back report. The command
 *   fills the mechanical facts itself, so the crew session never has to look them up: the branch and
 *   its head, the base it started from, the diff counted against that base, the files it
 *   changed that its brief did not name, the review the record holds for its branch, and its
 *   pull request. The crew session gives the rest — the tests, the other checks, the review's
 *   findings, the docs, what only the lead may do, and what is still open — and the command
 *   checks that against the store's report shape before it writes anything. **The file may be
 *   JSON** (the model's part in the store's shape, checked field by field) **or plain prose**
 *   (kept as the report's summary, for the lead to read); with no file the model part is empty.
 * - `--question "<the question>" --option "<a>" --option "<b>" [--recommend <n>]` — a question
 *   for the lead (D36). It is recorded, and the crew session goes on with everything the question
 *   does not block; the crew session's state does not move. `--status blocked` says the crew session has
 *   nothing left to do, and then the report must name the question it waits on.
 *
 * **A crew session never asks the person.** A question goes to the lead, which answers it or asks
 * the person.
 */
import { z } from "zod";
import { reviewsFile, reviewsOn } from "../workflow/reviews";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { DiffError, type DiffFacts, diffAgainstBase, outsideBrief } from "./diff";
import { headSha } from "./step";
import { addCrewQuestion, type CrewRecord, type HandBackReport, recordCrewReport } from "./store";
import {
  openTasks,
  readSessionTasks,
  type SessionTask,
  sessionTasksDir,
  taskListId,
} from "./tasks";

/** The statuses a report can end a phase with (`REPORT_STATUSES`). */
export const REPORT_STATUS_NAMES = ["done", "blocked", "failed", "handoff"] as const;

/** One of `REPORT_STATUS_NAMES`. */
export type ReportStatusName = (typeof REPORT_STATUS_NAMES)[number];

/** True when `value` names a status a report can have. */
export function isReportStatus(value: string): value is ReportStatusName {
  return (REPORT_STATUS_NAMES as readonly string[]).includes(value);
}

/** One test run a crew reports. */
const testRunFields = z.looseObject({
  command: z.string().min(1),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  ok: z.boolean(),
});

/** One check a crew session ran (the type check, the lint, a check it could not run). */
const checkFields = z.looseObject({
  name: z.string().min(1),
  ok: z.boolean(),
  note: z.string().nullable(),
});

/**
 * The review a crew reports, without the commit it read: the commit comes from the review
 * record, which is the only place that says a review really happened (D17).
 */
const modelReviewFields = z.looseObject({
  agent: z.string().min(1),
  model: z.string().min(1),
  effort: z.string().min(1),
  findings: z.array(z.looseObject({ finding: z.string().min(1), fix: z.string().min(1) })),
});

/**
 * The part of the report the **model** writes: what only the crew session knows. Everything else —
 * the branch, the base, the counts, the files outside the brief, the review's commit, the pull
 * request — the command fills.
 */
export const modelReportSchema = z.looseObject({
  tests: z
    .looseObject({
      targeted: z.array(testRunFields).default([]),
      full: testRunFields.nullable().default(null),
    })
    .default({ targeted: [], full: null }),
  checks: z.array(checkFields).default([]),
  review: modelReviewFields.nullable().default(null),
  docs: z.array(z.string().min(1)).default([]),
  needsLead: z.array(z.string().min(1)).default([]),
  open: z.array(z.string().min(1)).default([]),
  question: z.string().nullable().default(null),
});

/** The part of the report the model writes. */
export type ModelReport = z.infer<typeof modelReportSchema>;

/**
 * The model's part of the report, read from what the crew session wrote: **JSON** in the store's
 * shape (checked field by field), or **plain prose** (kept as the report's summary, for the
 * lead to read). Empty text is an empty model part.
 */
export function modelPartOf(
  raw: string,
): { error: string } | { summary: null | string; part: ModelReport } {
  if (raw.trim() === "") {
    return { part: modelReportSchema.parse({}), summary: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: prose, kept as the summary.
    return { part: modelReportSchema.parse({}), summary: raw.trim() };
  }
  const model = modelReportSchema.safeParse(parsed);
  if (!model.success) {
    return {
      error: `the report does not read as the report shape: ${model.error.issues
        .map((issue) => `${issue.path.join(".") || "the report"}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  return { part: model.data, summary: null };
}

/** What `crew report` was asked, already checked to be well formed. */
export interface ReportArgs {
  /** The status the phase ends with; null when the crew session only asks a question. */
  status: null | ReportStatusName;
  /** The file the model's part is in, or `-` for stdin; null when the crew session only asks. */
  file: null | string;
  /** The question the crew session asks; null when it reports. */
  question: null | string;
  /** The choices the crew session offers; empty when it reports. */
  options: string[];
  /** The option the crew session recommends (counted from 1); null when it recommends none. */
  recommend: null | number;
}

/** A refusal with its line and the exit code. */
export class ReportRefusal extends Error {
  constructor(
    readonly lines: string[],
    readonly code: 1 | 2,
  ) {
    super(lines.join("\n"));
  }
}

/** The refusal of `crew report`, with a fix line when there is one. */
function refusal(line: string, fix?: string, code: 1 | 2 = 1): ReportRefusal {
  const lines = [`crew report: ${line}`];
  if (fix !== undefined) lines.push(`Fix: ${fix}`);
  return new ReportRefusal(lines, code);
}

/**
 * The mechanical facts of a report: the branch and its head, the base, the diff counted against
 * that base, the files outside the brief, the review the record holds, and the pull request.
 */
export interface ReportFacts {
  base: { ref: string; sha: string };
  branch: { name: string; sha: string };
  changed: { deletions: number; files: number; insertions: number };
  outsideBrief: string[];
  pr: null | number;
  /** The commit the review record holds for this branch; null when it holds none. */
  reviewSha: null | string;
}

/**
 * The facts the command reads itself. The head and the diff are read in the crew session's own
 * worktree (where its branch is checked out); the base and the brief's files come from the
 * crew session's record; the review comes from the review record (D17). The refusal says why when the
 * head cannot be read: a report with no commit to name is no report.
 */
export function reportFacts(
  record: CrewRecord,
  base: { ref: string; sha: string },
  repo: string,
  ctx: CrewContext,
  reviewAgents: readonly string[],
): ReportFacts {
  const head = headSha(record, ctx);
  if (head === null) {
    throw refusal(
      `the head of ${record.branch} cannot be read in ${record.worktree}`,
      "run it in the crew session's own worktree, with the branch checked out",
    );
  }
  let diff: DiffFacts;
  try {
    diff = diffAgainstBase(record.worktree, base.sha, ctx.env);
  } catch (error) {
    if (!(error instanceof DiffError)) throw error;
    throw refusal(
      error.message,
      "the report counts the diff against the base the crew session started from",
    );
  }
  const reviews = reviewsOn(reviewsFile(ctx.paths.stateDir, repo), record.branch, reviewAgents);
  return {
    base: { ref: base.ref, sha: base.sha },
    branch: { name: record.branch, sha: head },
    changed: { deletions: diff.deletions, files: diff.files, insertions: diff.insertions },
    outsideBrief: outsideBrief(diff.paths, record.files),
    pr: record.pr,
    reviewSha: reviews[0]?.sha ?? null,
  };
}

/**
 * The note a `done` report leaves when there is no task list to check: a session that could not
 * have one (no session id recorded, or no folder ever made), and one whose folder cannot be
 * read. The report goes through either way — the gate never invents a list.
 */
function noTaskListLine(why: string): string {
  return `note: ${why}; nothing was checked before the report`;
}

/**
 * `--status done` waits until the crew session's task list is finished (D23). The list is the
 * session's own (`taskListId`: `CLAUDE_CODE_TASK_LIST_ID`, else its session id), and a task
 * still `pending` or `in_progress` refuses the report **with the tasks named**, so the crew
 * session finishes each one, or deletes it and says why in its report (a deleted task's file is
 * gone, so a reason written in the task would vanish with it). Every other
 * status is never held: a `handoff`, `blocked` or `failed` report exists precisely because the
 * phase could not be finished.
 */
function doneReportGate(
  record: CrewRecord,
  ctx: CrewContext,
): { line: string | null } | { refused: ReportRefusal } {
  const listId = taskListId(ctx.env, record.sessionId);
  const read = readSessionTasks(ctx.paths.claudeConfigDir, listId);
  if (read.state === "none") {
    return { line: noTaskListLine("no task list was found for this session") };
  }
  if (read.state === "unreadable") {
    return {
      line: noTaskListLine(
        `the task list in ${sessionTasksDir(ctx.paths.claudeConfigDir, listId)} cannot be read`,
      ),
    };
  }
  const open = openTasks(read.tasks);
  if (open.length === 0) return { line: null };
  return {
    refused: refusal(
      `the task list still has ${open.length} open ${open.length === 1 ? "task" : "tasks"}: ${open.map(taskLine).join(", ")}`,
      "Finish or remove each open task first (TaskUpdate status completed, or status deleted for one that no longer applies, and say why under `open` in your report)",
    ),
  };
}

/** One open task as the refusal names it: its number, its subject, and where it stands. */
function taskLine(task: SessionTask): string {
  return task.subject === ""
    ? `#${task.id} (${task.status})`
    : `#${task.id} "${task.subject}" (${task.status})`;
}

/** The crew session's own question it has not been answered yet, the newest first. */
function openQuestion(record: CrewRecord): null | string {
  for (let index = record.questions.length - 1; index >= 0; index -= 1) {
    const asked = record.questions[index];
    if (asked?.answer === null) return asked.question;
  }
  return null;
}

/**
 * The report the command writes: the model's part, the mechanical facts, and the status. The
 * review's commit comes from the review record: a crew session that claims a review the record does
 * not hold is refused, so the lead's gate (D22) never has to doubt it.
 *
 * **Only a `blocked` report carries a question** — the one it waits on: the crew session's own, or
 * else the newest it asked that has no answer. A `done` report with an old open question in it
 * would tell the lead the crew session is blocked.
 */
export function buildReport(
  model: ModelReport,
  facts: ReportFacts,
  status: ReportStatusName,
  record: CrewRecord,
  summary: null | string = null,
): HandBackReport {
  if (model.review !== null && facts.reviewSha === null) {
    throw refusal(
      "the review record holds no review of this branch, so the report cannot claim one",
      "record the review (workflow review-done), or report no review",
    );
  }
  const review = model.review === null ? null : { ...model.review, sha: facts.reviewSha ?? "" };
  return {
    base: facts.base,
    branch: facts.branch,
    changed: facts.changed,
    checks: model.checks,
    docs: model.docs,
    needsLead: model.needsLead,
    open: model.open,
    outsideBrief: facts.outsideBrief,
    phase: record.phase,
    pr: facts.pr,
    question: status === "blocked" ? (model.question ?? openQuestion(record)) : null,
    review,
    status,
    summary,
    tests: model.tests,
    version: 1,
  };
}

/** Prints a refusal and gives its exit code. */
function say(ctx: CrewContext, refused: ReportRefusal): number {
  for (const line of refused.lines) ctx.error(line);
  return refused.code;
}

/** Records the question a crew session asks its lead (D36); the crew session's state does not move. */
async function askQuestion(
  args: ReportArgs & { question: string },
  record: CrewRecord,
  repo: string,
  ctx: CrewContext,
): Promise<number> {
  if (args.options.length < 2) {
    return say(
      ctx,
      refusal(
        "a question needs two options at least, so the lead can answer it",
        `--option "<choice>" --option "<choice>"`,
        2,
      ),
    );
  }
  if (args.recommend !== null && (args.recommend < 1 || args.recommend > args.options.length)) {
    return say(
      ctx,
      refusal(
        `the question recommends option ${args.recommend}, and it has ${args.options.length}`,
        "--recommend is the number of one of the options",
        2,
      ),
    );
  }
  try {
    await addCrewQuestion(
      ctx.paths.stateDir,
      repo,
      record.id,
      { options: args.options, question: args.question, recommended: args.recommend },
      ctx.now(),
    );
  } catch (error) {
    ctx.error(`crew report: the store could not record the question: ${reasonOf(error)}`);
    return 1;
  }
  ctx.print(`question recorded · ${args.question}`);
  return 0;
}

/** What the crew session wrote for its report: the file, stdin, or nothing; or the refusal. */
async function readPart(
  args: ReportArgs,
  ctx: CrewContext,
): Promise<{ raw: string } | { refused: ReportRefusal }> {
  if (args.file === null) return { raw: "" };
  if (args.file === "-") return { raw: await ctx.readStdin() };
  const file = Bun.file(args.file);
  if (!(await file.exists())) {
    return { refused: refusal(`the file ${args.file} cannot be read`) };
  }
  return { raw: await file.text() };
}

/** `crew report`; the exit code. */
export async function runCrewReport(args: ReportArgs, ctx: CrewContext): Promise<number> {
  const self = readCrewSelf(ctx, "crew report");
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  const { record, repo, resolved } = self.self;
  if (args.question !== null)
    return await askQuestion({ ...args, question: args.question }, record, repo, ctx);
  if (args.status === null) {
    return say(
      ctx,
      refusal("say how the phase ends: --status done|blocked|failed|handoff", "--status done", 2),
    );
  }
  if (record.base === null) {
    return say(
      ctx,
      refusal("this crew session never started, so it has no base to report against"),
    );
  }
  // A done report waits for the list (D23); every other status is never held.
  if (args.status === "done") {
    const gate = doneReportGate(record, ctx);
    if ("refused" in gate) return say(ctx, gate.refused);
    if (gate.line !== null) ctx.print(gate.line);
  }
  const read = await readPart(args, ctx);
  if ("refused" in read) return say(ctx, read.refused);
  const model = modelPartOf(read.raw);
  if ("error" in model) {
    return say(
      ctx,
      refusal(
        model.error,
        "the report is JSON: the tests, the checks, the review, the docs, what the lead must do, and what is open",
      ),
    );
  }
  let report: HandBackReport;
  try {
    const facts = reportFacts(record, record.base, repo, ctx, resolved.reviewAgents.value);
    report = buildReport(model.part, facts, args.status, record, model.summary);
  } catch (error) {
    if (!(error instanceof ReportRefusal)) throw error;
    return say(ctx, error);
  }
  try {
    const written = await recordCrewReport(ctx.paths.stateDir, repo, record.id, report, ctx.now());
    ctx.print(`report ${report.status} · ${written.file}`);
    return 0;
  } catch (error) {
    ctx.error(`crew report: the store could not record the report: ${reasonOf(error)}`);
    return 1;
  }
}
