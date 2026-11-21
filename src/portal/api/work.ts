import { readFileSync } from "node:fs";
import { join } from "node:path";
import { historyDbExists } from "../../gateway/history";
import {
  bucketStart,
  HISTORY_BUCKET_MS,
  HISTORY_RANGE_MS,
  type HistoryFilters,
  historySeries,
  type RecentRequestRow,
  recentRequests,
} from "../../gateway/history-read";
import { oneLine } from "../../gateway/plain-text";
import { readSafetyChecks, safetyCheckWindow } from "../../gateway/safety-checks-read";
import { askLogFile } from "../../hooks/ask-log";
import { type ListedWorktree, parseWorktreeList, runGitAsync } from "../../hooks/git";
import type { Env } from "../../hooks/run";
import { locateCheckoutAsync } from "../../project/resolve";
import { savedSessions } from "../../sessions/command";
import { readFinishedSessions } from "../../sessions/finished";
import { FLOW_DAYS_KEPT, OPEN_WAIT_MAX_AGE_MS } from "../../sessions/flow";
import type { SavedSession } from "../../sessions/saved-sessions";
import type { MergeVerdict as CheckVerdict } from "../../workflow/merge-check";
import { shownDetail } from "../facts";
import { openWaitsOffLoop, readFlowOffLoop } from "../flow-read";
import type { PageDataDeps } from "../page-data";
import { readWorktreesOffLoop } from "../worktrees-read";
import { readPortalAgentsForPage } from "./agents-read";
import {
  type FlowAnswer,
  type GuardAskItem,
  type GuardAsksAnswer,
  HISTORY_RANGES,
  type HistoryAnswer,
  type HistoryRange,
  type HistoryRequest,
  type MergeVerdict,
  type RequestsAnswer,
  type SessionSummary,
  type WorkAnswer,
  type WorktreesAnswer,
} from "./types";

/** How far back the Work view looks for the other Claude Code sessions: two days, as `sessions`. */
export const WORK_SESSIONS_MS = 2 * 86_400_000;

/**
 * A session whose file was written this recently counts as working: Claude Code appends to it
 * with every message and tool result of a turn, so a quiet file is a session between turns.
 */
export const SESSION_WORKING_MS = 2 * 60_000;

/**
 * One session's state, from what its file and the flow report say (`SessionSummary`): its end
 * marker first (a closed session waits on nothing), then an open permission prompt, then how
 * recently it wrote.
 */
export function sessionStateOf(
  session: Pick<SavedSession, "endedCleanly" | "id" | "lastWrite">,
  waiting: ReadonlySet<string>,
  now: number,
): SessionSummary["state"] {
  if (session.endedCleanly) return "ended";
  if (waiting.has(session.id)) return "waiting";
  return now - session.lastWrite <= SESSION_WORKING_MS ? "working" : "idle";
}

/** How many asks one page of the guard log answers unless the query says otherwise. */
export const GUARD_ASKS_DEFAULT = 50;

/**
 * This project's main checkout, the folder being no project, or why it could not be read. The
 * three cases are told apart: a folder that is no git project is the portal's normal start
 * (`portal.md`), a quiet line on the Work page; one that cannot be read is a failure.
 */
async function repoOf(
  deps: PageDataDeps,
): Promise<{ kind: "error"; why: string } | { kind: "none" } | { kind: "repo"; repo: string }> {
  try {
    const checkout = await locateCheckoutAsync(deps.action.cwd, {
      env: deps.action.portal.env,
    });
    if (checkout === null) return { kind: "none" };
    return { kind: "repo", repo: checkout.mainCheckout ?? checkout.root };
  } catch (error) {
    return { kind: "error", why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The worktrees git lists for a project, read without blocking the portal (as `projects.ts`
 * reads them): the sessions of one a project's own WorktreeCreate hook put outside
 * `.claude/worktrees` are this project's too. Null when git cannot list: the sessions then fall
 * back to the main checkout and the default folder, as the `sessions` command does.
 */
async function listedWorktrees(repo: string, env: Env): Promise<ListedWorktree[] | null> {
  const listed = await runGitAsync(repo, ["worktree", "list", "--porcelain"], env);
  return listed.ok ? parseWorktreeList(listed.out) : null;
}

/** Why a thrown thing happened, in one line. */
function _reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function workAnswer(deps: PageDataDeps): Promise<WorkAnswer> {
  const paths = deps.action.portal.paths;
  const now = deps.action.portal.now();
  let note: null | string = null;
  const agents = await readPortalAgentsForPage(deps.action.portal, deps.action.cwd);
  const finished = readFinishedSessions(paths, { agents: () => agents.sessions, now });
  const found = await repoOf(deps);
  let folderNote: null | string = null;
  let sessions: SessionSummary[] = [];
  let waitsError: null | string = null;
  if (found.kind === "repo") {
    const { repo } = found;
    const others = savedSessions(
      join(paths.claudeConfigDir, "projects"),
      repo,
      now - WORK_SESSIONS_MS,
      await listedWorktrees(repo, deps.action.portal.env),
    );
    // The open permission prompts, read once (the flow report's own cache), only when a session
    // could be waiting on one.
    const waits = others.some((session) => !session.endedCleanly)
      ? await openWaitsOffLoop(deps.action.portal, OPEN_WAIT_MAX_AGE_MS)
      : { open: [] };
    const waiting = new Set("open" in waits ? waits.open.map((wait) => wait.session) : []);
    sessions = others.map((session) => ({
      branch: session.branch,
      folder: session.folder,
      id: session.id,
      lastWrite: session.lastWrite,
      model: session.model,
      name: session.name,
      state: sessionStateOf(session, waiting, now),
    }));
    waitsError = "error" in waits ? waits.error : null;
  } else if (found.kind === "none") {
    folderNote = "this folder is not in a project, so its Claude Code sessions are not listed";
  } else {
    note = found.why;
  }
  return {
    finishedSessions: finished.sessions,
    finishedSessionsError: finished.error,
    folderNote,
    note,
    repo: found.kind === "repo" ? found.repo : null,
    sessions,
    waitsError,
  };
}
/** A merge verdict, in the API's own shape (the command's kinds). One home for every page. */
export function mergeVerdictOf(verdict: CheckVerdict): MergeVerdict {
  switch (verdict.kind) {
    case "allowed":
      return { detail: verdict.detail, kind: "allowed", reason: verdict.reason };
    case "refused":
      return {
        detail: verdict.detail,
        kind: "refused",
        number: verdict.number,
        reason: verdict.reason,
      };
    case "unread":
      return { kind: "unread", number: verdict.number, what: verdict.what };
    case "late":
      return { kind: "late", number: verdict.number, what: verdict.what };
  }
}

/** The filters and the page `/api/guard-asks` takes. */
export interface GuardAskQuery {
  /** The page to read: after the first `n` rows of `<at>`, among rows at or before it. */
  cursor: null | { at: number; n: number };
  hook: null | string;
  limit: number;
  q: null | string;
  range: HistoryRange;
  session: null | string;
  tool: null | string;
}

/** One hook's asks in one bucket, for the chart. */
function guardBuckets(
  rows: readonly GuardAskItem[],
  from: number,
  to: number,
  bucketMs: number,
): GuardAsksAnswer["buckets"] {
  const counts = new Map<number, Record<string, number>>();
  for (const row of rows) {
    const at = bucketStart(row.at, bucketMs);
    const bucket = counts.get(at) ?? {};
    bucket[row.hook] = (bucket[row.hook] ?? 0) + 1;
    counts.set(at, bucket);
  }
  // Every bucket of the window, an empty one as `{}`: a chart needs no filling in.
  const buckets: GuardAsksAnswer["buckets"] = [];
  const last = bucketStart(to, bucketMs);
  for (let at = bucketStart(from, bucketMs); at <= last; at += bucketMs) {
    buckets.push({ at, byHook: counts.get(at) ?? {} });
  }
  return buckets;
}

/**
 * `/api/guard-asks?range=…&cursor=…&limit=…`: the guard log over the range, filtered, newest
 * first, one page at a time. The chart, the guards and the sessions cover the whole range; the
 * page is the server's own cut of it, and `next` is the cursor of the older one.
 */
export function guardAsksAnswer(deps: PageDataDeps, query: GuardAskQuery): GuardAsksAnswer {
  const now = deps.action.portal.now();
  const from = now - HISTORY_RANGE_MS[query.range];
  const bucketMs = HISTORY_BUCKET_MS[query.range];
  let text: string;
  try {
    text = readFileSync(askLogFile(deps.action.portal.paths.stateDir), "utf8");
  } catch {
    return {
      asks: [],
      bucketMs,
      buckets: guardBuckets([], from, now, bucketMs),
      byHook: {},
      guards: [],
      kept: 0,
      next: null,
      range: query.range,
      sessions: [],
      skipped: 0,
    };
  }
  const asks: GuardAskItem[] = [];
  const byHook: Record<string, number> = {};
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      skipped += 1;
      continue;
    }
    const value = parsed as Record<string, unknown>;
    const hook = typeof value.hook === "string" ? value.hook : null;
    const at = typeof value.at === "number" ? value.at : null;
    // A time that is not a whole millisecond cannot name a page cursor (`<at>.<n>`): skipped,
    // like a line with no hook or no time.
    if (hook === null || at === null || !Number.isSafeInteger(at)) {
      skipped += 1;
      continue;
    }
    byHook[hook] = (byHook[hook] ?? 0) + 1;
    asks.push({
      at,
      hook,
      // A hand-written line can hold anything: every word is one short line, and the reason
      // goes through the same masking the frame wrote it with.
      reason: shownDetail(typeof value.reason === "string" ? value.reason : "", []),
      session: oneLine(typeof value.session === "string" ? value.session : "", 64),
      tool: oneLine(typeof value.tool === "string" ? value.tool : "", 64),
    });
  }
  // The range's rows: the guards and sessions a filter offers come from these, not the filter.
  const inRange = asks.filter((ask) => ask.at >= from && ask.at <= now);
  const guards = [...new Set(inRange.map((ask) => ask.hook))].sort();
  const sessions = [
    ...new Set(inRange.flatMap((ask) => (ask.session === "" ? [] : [ask.session]))),
  ].sort();
  const keptRows = inRange.filter(
    (ask) =>
      (query.hook === null || ask.hook === query.hook) &&
      (query.session === null || ask.session === query.session) &&
      (query.tool === null || ask.tool === query.tool) &&
      (query.q === null || ask.reason.toLowerCase().includes(query.q.toLowerCase())),
  );
  const sorted = [...keptRows].sort((a, b) => b.at - a.at);
  // The page: a cursor names a time and how many rows of it were already given, so two asks
  // that share a millisecond are never skipped and never said twice.
  let start = 0;
  const cursor = query.cursor;
  if (cursor !== null) {
    const found = sorted.findIndex((ask) => ask.at <= cursor.at);
    start = found === -1 ? sorted.length : found;
    let given = 0;
    while (given < cursor.n && sorted[start]?.at === cursor.at) {
      start += 1;
      given += 1;
    }
  }
  const page = sorted.slice(start, start + query.limit);
  const last = page[page.length - 1];
  let next: null | string = null;
  if (last !== undefined && start + query.limit < sorted.length) {
    // Rows of the last row's own time this answer (and the pages before it) already gave.
    const before = cursor !== null && cursor.at === last.at ? cursor.n : 0;
    const here = page.filter((ask) => ask.at === last.at).length;
    next = `${last.at}.${before + here}`;
  }
  return {
    asks: page,
    bucketMs,
    buckets: guardBuckets(keptRows, from, now, bucketMs),
    byHook,
    guards,
    kept: keptRows.length,
    next,
    range: query.range,
    sessions,
    skipped,
  };
}

/**
 * `/api/worktrees`: every worktree's verdict, against the project's base. The scan runs in a
 * child (`worktrees-read.ts`): it is synchronous git and machine reads, and the server's loop
 * stays free while it runs. The child is the CLI's own `worktrees --json`, so the page and the
 * command show one answer.
 */
export async function worktreesAnswer(deps: PageDataDeps): Promise<WorktreesAnswer> {
  const read = await readWorktreesOffLoop(deps.action.portal, deps.action.cwd);
  return "error" in read
    ? { autoClean: null, base: "", from: "default", note: read.error, worktrees: [] }
    : read.answer;
}

/**
 * `/api/flow?range=…`: the flow report for the window (one reader, `src/sessions/flow.ts`, run
 * off the server's loop by `flow-read.ts`), or why it could not be read.
 */
export async function flowAnswer(
  deps: PageDataDeps,
  range: HistoryRange,
): Promise<{ error: string } | FlowAnswer> {
  const wanted = HISTORY_RANGES[range];
  const kept = FLOW_DAYS_KEPT * 86_400_000;
  const read = await readFlowOffLoop(deps.action.portal, Math.min(wanted, kept));
  if ("error" in read) return read;
  const { report } = read;
  return {
    from: report.sinceMs,
    note:
      wanted > kept
        ? `the flow report keeps ${FLOW_DAYS_KEPT} days, so this answer covers ${FLOW_DAYS_KEPT} days, not ${range}`
        : null,
    range,
    report,
    to: report.untilMs,
  };
}

/** What an empty history says: a machine that never logged a request has no database. */
const NO_HISTORY_YET =
  "no request has been logged yet: the router writes one row per request, and this machine has none";

/**
 * The filters `/api/history` and `/api/requests` take, from the query's own words. An empty
 * value is no filter; `status=error` is the only status (a caller's other value is refused by
 * the route before this runs).
 */
export function historyFilters(query: URLSearchParams): HistoryFilters {
  const filters: HistoryFilters = {};
  for (const column of ["slot", "target", "model", "session"] as const) {
    const value = query.get(column);
    if (value !== null && value.trim() !== "") filters[column] = value;
  }
  if (query.get("status") === "error") filters.status = "error";
  return filters;
}

/**
 * `/api/history`: requests over time, one series per key, from the history's own reader.
 *
 * Beside the series: auto mode's safety checks, which the history leaves out on purpose. They
 * are counted by local day, so the days the range covers are read through the same reader the
 * CLI's `usage` prints (`safety-checks-read.ts`); a file that is not there is null, never 0.
 */
export function historyAnswer(
  deps: PageDataDeps,
  range: HistoryRange,
  by: HistoryAnswer["by"],
  filters: HistoryFilters = {},
): HistoryAnswer {
  const now = deps.action.portal.now();
  const file = deps.action.portal.paths.historyDbFile;
  const answer = historySeries(file, { by, filters, now, range });
  const state = readSafetyChecks(deps.action.portal.paths.safetyChecksFile);
  const checks = safetyCheckWindow(state, { nowMs: now, windowMs: HISTORY_RANGES[range] });
  return {
    available: true,
    by,
    bucketMs: answer.bucketMs,
    from: now - HISTORY_RANGES[range],
    note: historyDbExists(file) ? null : NO_HISTORY_YET,
    range,
    safetyChecks: {
      checks: state === null ? null : checks.checks,
      days: checks.days.length,
    },
    series: answer.series,
    to: now,
  };
}

/** One stored row as the recent-requests table shows it; metadata only, never a word. */
function requestOf(row: RecentRequestRow): HistoryRequest {
  return {
    at: row.at,
    costUsd: row.costUsd,
    held: row.breaker === "held",
    latencyMs: row.ms,
    model: row.model,
    nextTarget: row.nextTarget,
    session: row.session,
    slot: row.slot,
    status: row.status,
    target: row.target,
    tokens: {
      cacheRead: row.cacheReadTokens ?? 0,
      cacheWrite: row.cacheWriteTokens ?? 0,
      input: row.inputTokens ?? 0,
      output: row.outputTokens ?? 0,
    },
  };
}

/** `/api/requests`: the recent requests, newest first, paged by the cursor it answers. */
export function requestsAnswer(
  deps: PageDataDeps,
  options: { cursor?: number; filters?: HistoryFilters; from?: number; limit?: number } = {},
): RequestsAnswer {
  const file = deps.action.portal.paths.historyDbFile;
  const page = recentRequests(file, options);
  return {
    available: true,
    cursor: page.nextCursor === null ? null : String(page.nextCursor),
    note: historyDbExists(file) ? null : NO_HISTORY_YET,
    requests: page.rows.map(requestOf),
  };
}
