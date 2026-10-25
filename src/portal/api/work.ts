/**
 * The JSON API's work answers: the Work view, one crew session's page, "Needs you", the guard
 * log, the worktrees, the flow report, and the request history (H1's reader, read-only).
 *
 * Every fact comes from the plugin's own readers — the crew store, the flow report, the
 * worktree scan, the guard's ask log, the review record and the merge check — so a page can
 * never disagree with the command that writes the same state. Nothing here changes anything.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupTitle } from "../../cli/check";
import type { CliPaths } from "../../cli/paths";
import { findCrew, stateSince } from "../../crew/board";
import { diffAgainstBase, outsideBrief } from "../../crew/diff";
import { leadGone } from "../../crew/lifecycle";
import { RUNNING_STATES } from "../../crew/places";
import {
  type CrewEvent,
  type CrewRecord,
  crewBriefFile,
  type LeadRecord,
  listAllCrew,
  listAllLeads,
  openQuestionIndex,
  readCrewEvents,
  readReport,
} from "../../crew/store";
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
import { currentBreakers, parseLimitState } from "../../gateway/limit-state";
import { oneLine } from "../../gateway/plain-text";
import { readSafetyChecks, safetyCheckWindow } from "../../gateway/safety-checks-read";
import { askLogFile } from "../../hooks/ask-log";
import { locateCheckoutAsync } from "../../project/resolve";
import { savedSessions } from "../../sessions/command";
import { readFinishedSessions } from "../../sessions/finished";
import { FLOW_DAYS_KEPT, OPEN_WAIT_MAX_AGE_MS, type OpenWait } from "../../sessions/flow";
import type { SavedSession } from "../../sessions/saved-sessions";
import {
  type MergeVerdict as CheckVerdict,
  checkBranch,
  type MergeWorld,
} from "../../workflow/merge-check";
import { readReviews, reviewsFile } from "../../workflow/reviews";
import { routerFacts, shownDetail } from "../facts";
import { openWaitsOffLoop, readFlowOffLoop } from "../flow-read";
import { type PageDataDeps, updateFacts } from "../page-data";
import { readWorktreesOffLoop } from "../worktrees-read";
import { readPortalAgentsForPage } from "./agents-read";
import { readCleanupForPage } from "./cleanup-read";
import {
  type BreakerNeed,
  type CrewAnswer,
  type CrewMemoryPoint,
  type CrewNeed,
  type CrewReport,
  type CrewReview,
  type CrewStepItem,
  type CrewSummary,
  type DoctorFailure,
  type FlowAnswer,
  type GuardAskItem,
  type GuardAsksAnswer,
  HISTORY_RANGES,
  type HistoryAnswer,
  type HistoryRange,
  type HistoryRequest,
  type LeadSummary,
  type NeedsAnswer,
  type PermissionWait,
  type RequestsAnswer,
  type SessionSummary,
  type WorkAnswer,
  type WorktreesAnswer,
} from "./types";

/** How many events a crew page's timeline shows: the newest of them. */
export const CREW_PAGE_EVENTS = 200;

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

/** How many memory readings a crew session's summary carries: its newest, for a sparkline. */
export const SUMMARY_MEMORY_POINTS = 60;

/**
 * One crew session as a summary: no transcript, no prompt, no key. `events` is the repository's
 * whole log, oldest first; the board's readers take one crew session's own, newest first.
 */
function crewSummary(
  record: CrewRecord,
  events: readonly CrewEvent[],
  nowMs: number,
  gone = false,
): CrewSummary {
  // The one open-question rule every reader shares (`openQuestionIndex`): a question the crew
  // session left behind at its end needs no answer, so this page and the Needs page agree.
  const openIndex = openQuestionIndex(record);
  const open = openIndex === null ? undefined : record.questions[openIndex];
  const own = events.filter((event) => event.crew === record.id).reverse();
  // The board's own rule for its last line (`lastSaid`): never the "created" line, never empty.
  const said = own.find(
    (event) => event.type !== "created" && event.text !== null && event.text.trim() !== "",
  );
  return {
    base: record.base,
    branch: record.branch,
    createdAt: record.createdAt,
    effort: record.effort,
    files: record.files,
    id: record.id,
    kind: record.kind,
    lastEvent:
      said === undefined || said.text === null
        ? null
        : { at: said.at, text: said.text, type: said.type },
    lastLine: record.lastLine,
    leadGone: gone,
    leadName: record.leadName,
    leadSessionId: record.leadSessionId,
    memory: memoryOf(record, events, nowMs).slice(-SUMMARY_MEMORY_POINTS),
    memoryMb: record.memoryMb,
    model: record.model,
    name: record.name,
    phase: record.phase,
    plan: record.plan,
    pr: record.pr,
    question:
      open === undefined
        ? null
        : {
            askedAt: open.askedAt,
            options: open.options,
            question: open.question,
            recommended: open.recommended,
          },
    repo: record.repo,
    shortId: record.shortId,
    slug: record.slug,
    state: record.state,
    stateSince: stateSince(record, own),
    updatedAt: record.updatedAt,
    waitingFor: record.waitingFor ?? null,
    waitsFor: record.waitsFor,
    worktree: record.worktree,
  };
}

/** Why a thrown thing happened, in one line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One repository's crew events, read once per answer: a store that cannot be read is no events. */
function eventsByRepo(paths: CliPaths, records: readonly CrewRecord[]): Map<string, CrewEvent[]> {
  const byRepo = new Map<string, CrewEvent[]>();
  for (const repo of new Set(records.map((record) => record.repo))) {
    try {
      byRepo.set(repo, readCrewEvents(paths.stateDir, repo).events);
    } catch {
      // One repository's log cannot be read: its crew sessions still show, without events.
      byRepo.set(repo, []);
    }
  }
  return byRepo;
}

/**
 * `/api/work`: every lead on the machine, its crew nested, and the other sessions of the
 * folder the portal runs in.
 *
 * **The crew data is the machine's** (`listAllCrew`, `listAllLeads`): the portal usually runs
 * from the home folder, which is no git project, and reading that folder's store showed no
 * crew session at all. A crew record names its repository, so every summary and every lead
 * carries its own (`repo`), and a page — or an action — never has to guess which one it is.
 */
export async function workAnswer(deps: PageDataDeps): Promise<WorkAnswer> {
  const paths = deps.action.portal.paths;
  const now = deps.action.portal.now();
  let note: null | string = null;
  let records: CrewRecord[] = [];
  let leadRecords: LeadRecord[] = [];
  try {
    records = [...listAllCrew(paths.stateDir).records].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  } catch (error) {
    note = `the crew store could not be read: ${reasonOf(error)}`;
  }
  try {
    leadRecords = [...listAllLeads(paths.stateDir).records].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
    );
  } catch (error) {
    note = note ?? `the crew store could not be read: ${reasonOf(error)}`;
  }
  const agents = await readPortalAgentsForPage(deps.action.portal, deps.action.cwd);
  const finished = readFinishedSessions(paths, { agents: () => agents.sessions, now });
  const events = eventsByRepo(paths, records);
  const crew = records.map((record) =>
    crewSummary(
      record,
      events.get(record.repo) ?? [],
      now,
      leadGone(
        leadRecords.find(
          (lead) => lead.repo === record.repo && lead.sessionId === record.leadSessionId,
        ) ?? null,
        agents.crew,
        now,
      ),
    ),
  );
  const leads = leadRecords.map(
    (lead): LeadSummary => ({
      crew: crew.filter((one) => one.leadSessionId === lead.sessionId),
      createdAt: lead.createdAt,
      cwd: lead.cwd,
      name: lead.name,
      pausedAgents: lead.pausedAgents ?? [],
      plan: lead.plan,
      repo: lead.repo,
      sessionId: lead.sessionId,
      tag: lead.tag,
      updatedAt: lead.updatedAt,
    }),
  );
  // The other sessions are the project of the folder the portal runs in, when it has one: a
  // session record is kept under its project's folder, and there is no list of every project.
  const found = await repoOf(deps);
  let folderNote: null | string = null;
  let sessions: SessionSummary[] = [];
  let waitsError: null | string = null;
  if (found.kind === "repo") {
    const { repo } = found;
    // The crew sessions' and leads' own sessions, by their full ids: a saved session that is
    // one of them is not "another session" on the Work page.
    const crewSessionIds = new Set<string>(
      records.flatMap((record) => (record.sessionId === null ? [] : [record.sessionId])),
    );
    const leadIds = new Set<string>(leadRecords.map((one) => one.sessionId));
    const others = savedSessions(
      join(paths.claudeConfigDir, "projects"),
      repo,
      now - WORK_SESSIONS_MS,
    ).filter((session) => !crewSessionIds.has(session.id) && !leadIds.has(session.id));
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
    // The crew data still shows; only the other sessions need a project. The portal's normal
    // start is the home folder, which is no project, so this line is quiet, never a warning.
    folderNote =
      "this folder is not in a git project, so the other Claude Code sessions of a project are not listed; the crew sessions of every repository are";
  } else {
    // A folder that could not be read is a failure: it stays a warning on the page.
    note = note ?? found.why;
  }
  return {
    crew,
    finishedSessions: finished.sessions,
    finishedSessionsError: finished.error,
    folderNote,
    leads,
    note,
    repo: found.kind === "repo" ? found.repo : null,
    sessions,
    waitsError,
  };
}

/** A merge verdict, in the API's own shape (the command's kinds). One home for every page. */
export function mergeVerdictOf(verdict: CheckVerdict): CrewAnswer["mergeCheck"] {
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
    case "silent":
      return { kind: "silent" };
    case "unread":
      return { kind: "unread", number: verdict.number, what: verdict.what };
    case "late":
      return { kind: "late", number: verdict.number, what: verdict.what };
  }
}

/**
 * `/api/crew/<id>`: one crew session's page, or why it cannot be named.
 *
 * **The record is found on the machine** (`listAllCrew`), and everything the page shows is
 * read from **its own repository** (`record.repo`), never from the portal's folder: the portal
 * usually runs from the home folder, where this repository has no store at all.
 */
export async function crewAnswerFor(
  deps: PageDataDeps,
  ref: string,
): Promise<CrewAnswer | { error: string }> {
  const paths = deps.action.portal.paths;
  let records: CrewRecord[];
  try {
    records = listAllCrew(paths.stateDir).records;
  } catch (error) {
    return { error: reasonOf(error) };
  }
  const named = findCrew(records, ref, "status");
  if ("refusal" in named) {
    // The lookup is the machine's, so a name no record has says so; an ambiguous name keeps the
    // command's own words (they list each record it means). The first line is `findCrew`'s
    // "none" sentence (`src/crew/board.ts`), whose "of this repository" would be wrong here.
    const [first] = named.refusal.lines;
    if (first?.startsWith("crew status: no crew session of this repository") === true) {
      return { error: `No crew session on this machine is "${ref}": the Work page lists them.` };
    }
    return { error: named.refusal.lines.join(" ") };
  }
  const record = named.record;
  const repo = record.repo;
  const allEvents = readCrewEvents(paths.stateDir, repo).events;
  const events = allEvents
    .filter((event) => event.crew === record.id)
    .slice(-CREW_PAGE_EVENTS)
    .map(
      (event): CrewStepItem => ({
        at: event.at,
        note: event.note ?? null,
        sha: event.sha ?? null,
        state: event.state,
        text: event.text,
        type: event.type,
      }),
    );
  let brief: null | string = null;
  try {
    brief = readFileSync(crewBriefFile(paths.stateDir, repo, record.id), "utf8");
  } catch {
    // No brief (a queued crew session, or one whose files were removed): the page says so.
  }
  let diff: CrewAnswer["diff"] = {
    byFile: [],
    deletions: 0,
    error: null,
    files: 0,
    insertions: 0,
    outsideBrief: [],
  };
  if (record.base === null) {
    diff = { ...diff, error: "it has not started, so it has no base to compare with" };
  } else {
    try {
      const facts = diffAgainstBase(record.worktree, record.base.sha, deps.action.portal.env);
      diff = {
        byFile: facts.byFile,
        deletions: facts.deletions,
        error: null,
        files: facts.files,
        insertions: facts.insertions,
        outsideBrief: outsideBrief(facts.paths, record.files),
      };
    } catch (error) {
      diff = {
        ...diff,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const reviews: CrewReview[] = Object.entries(readReviews(reviewsFile(paths.stateDir, repo)))
    .filter(([, entry]) => entry.branches?.includes(record.branch) === true)
    .map(([sha, entry]) => ({ at: entry.at, by: entry.by, sha }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const agents = await readPortalAgentsForPage(deps.action.portal, deps.action.cwd);
  const lead =
    listAllLeads(paths.stateDir).records.find(
      (one) => one.repo === record.repo && one.sessionId === record.leadSessionId,
    ) ?? null;
  const gone = leadGone(lead, agents.crew, deps.action.portal.now());
  const mergeCheck = await mergeCheckOf(
    deps,
    repo,
    record.branch,
    record.base?.ref ?? record.baseRef,
  );
  return {
    brief,
    crew: crewSummary(record, allEvents, deps.action.portal.now(), gone),
    diff,
    events,
    memory: memoryOf(record, allEvents, deps.action.portal.now()),
    mergeCheck,
    report: reportOf(record.reportPath),
    reviews,
  };
}

/**
 * A crew session's memory over time, oldest first: each reading its own log kept (the watch
 * writes one when a session ends), then — only while its session still runs — the record's
 * memory as it is now, at this answer's time. An ended session's last reading is history, not
 * a reading now, so its series is the log's own.
 */
function memoryOf(
  record: CrewRecord,
  events: readonly CrewEvent[],
  nowMs: number,
): CrewMemoryPoint[] {
  const kept: CrewMemoryPoint[] = events.flatMap((event) => {
    if (event.crew !== record.id || typeof event.memoryMb !== "number") return [];
    return [{ at: event.at, mb: event.memoryMb }];
  });
  kept.sort((a, b) => a.at.localeCompare(b.at));
  const running = (RUNNING_STATES as readonly string[]).includes(record.state);
  if (running && record.memoryMb !== null) {
    kept.push({ at: new Date(nowMs).toISOString(), mb: record.memoryMb });
  }
  return kept;
}

/** The report file, read through the store's own schema; null when there is none. */
function reportOf(file: null | string): CrewReport | null {
  if (file === null) return null;
  try {
    return readReport(file);
  } catch {
    return null;
  }
}

/**
 * The merge check for a crew session's branch against its base (D22's gate, D17b's record),
 * awaited: every child on the path is `Bun.spawn`, so a page never blocks the server. The
 * base is the one its record started from; a record that has not started yet names its
 * `baseRef`, with no git call to find a base.
 */
async function mergeCheckOf(
  deps: PageDataDeps,
  repo: string,
  branch: string,
  base: null | string,
): Promise<CrewAnswer["mergeCheck"]> {
  try {
    // The checkout of the record's own repository, never the portal's folder.
    const checkout = await locateCheckoutAsync(repo, {
      env: deps.action.portal.env,
    });
    if (checkout === null) {
      return { kind: "unread", number: null, what: "this folder is not in a git project" };
    }
    if (base === null) {
      return { kind: "unread", number: null, what: "the base branch its record names" };
    }
    const world: MergeWorld = {
      checkout,
      env: deps.action.portal.env,
      folder: repo,
      paths: deps.action.portal.paths,
      timeFor: (limitMs) => limitMs,
    };
    return mergeVerdictOf(await checkBranch(world, { base, branch }));
  } catch (error) {
    return {
      kind: "unread",
      number: null,
      what: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The command that opens a crew session's terminal again, as `crew end` prints it; null with no short id. */
function attachCommand(record: CrewRecord): null | string {
  return record.shortId === null ? null : `claude attach ${record.shortId}`;
}

/**
 * One permission prompt as "Needs you" sends it, matched to the crew session that runs in that
 * session (its `sessionId`, the full id Claude Code writes). Only a crew session gets the
 * command that opens its terminal: `claude attach` opens a background session, and another
 * session's is opened by its own terminal, not by this page. A wait whose session no record
 * names is the person's own session: no crew, no command.
 */
export function permissionWaitOf(wait: OpenWait, records: readonly CrewRecord[]): PermissionWait {
  const record = records.find((one) => one.sessionId === wait.session);
  return {
    asker: wait.asker,
    attach: record === undefined ? null : attachCommand(record),
    at: wait.at,
    crew:
      record === undefined ? null : { id: record.id, name: record.name, shortId: record.shortId },
    kind: wait.kind,
    project: wait.project,
    session: wait.session,
    tool: wait.tool,
  };
}

/** `/api/needs`: everything that waits on the person (D52). */
export async function needsAnswer(deps: PageDataDeps): Promise<NeedsAnswer> {
  const paths = deps.action.portal.paths;
  const now = deps.action.portal.now();
  // Every crew session on the machine, read once: the questions, and the session of each
  // permission prompt, are matched against the same records. The portal usually runs from a
  // folder that is no git project, so this folder's store would say nothing.
  let records: CrewRecord[] = [];
  try {
    records = listAllCrew(paths.stateDir).records;
  } catch {
    // A store that cannot be read is doctor's to report; the rest of "Needs you" still shows.
  }
  const crew: CrewNeed[] = [];
  for (const record of records) {
    const index = openQuestionIndex(record);
    const question = index === null ? undefined : record.questions[index];
    if (question === undefined) continue;
    crew.push({
      askedAt: question.askedAt,
      crew: {
        id: record.id,
        name: record.name,
        shortId: record.shortId,
        state: record.state,
      },
      options: question.options,
      question: question.question,
      recommended: question.recommended,
    });
  }
  const waits = await openWaitsOffLoop(deps.action.portal, OPEN_WAIT_MAX_AGE_MS);
  const permissions: PermissionWait[] =
    "open" in waits ? waits.open.map((wait) => permissionWaitOf(wait, records)) : [];
  const cleanup = await readCleanupForPage(deps.action.portal, deps.action.cwd);
  const doctor = await deps.doctor();
  const update = updateFacts(deps.action).held;
  return {
    breakers: await breakersOf(deps, now),
    crew,
    doctor: {
      at: doctor?.at ?? null,
      failures: (doctor?.checks ?? []).flatMap((check): DoctorFailure[] =>
        check.ok
          ? []
          : [
              {
                fix: check.fix,
                section: check.group === undefined ? null : groupTitle(check.group),
                text: check.text,
              },
            ],
      ),
    },
    permissions,
    permissionsError: "error" in waits ? waits.error : null,
    stopped: cleanup.stopped,
    stoppedError: cleanup.error,
    update,
  };
}

/**
 * Every breaker open now, from the state file the router writes, with the router's own live
 * count of the requests it holds right now. A router that does not answer (or no gateway config
 * names one) leaves `heldNow` null: the answer never guesses a number.
 */
async function breakersOf(deps: PageDataDeps, now: number): Promise<BreakerNeed[]> {
  let text: string;
  try {
    text = readFileSync(deps.action.portal.paths.gatewayStateFile, "utf8");
  } catch {
    return [];
  }
  const state = parseLimitState(text);
  if (state === null) return [];
  const open = currentBreakers(state, now);
  // Nothing open: the router is not asked at all, so a healthy machine pays no probe.
  if (open.length === 0) return [];
  const router =
    "config" in deps.found ? await routerFacts(deps.action.portal, deps.found.config.port) : null;
  const live = router?.up === true ? router.breakers : null;
  return open.map(([slot, record]) => ({
    held: record.held,
    // The router answered: a slot it does not list holds nothing right now. Only a router
    // that did not answer leaves the count unknown.
    heldNow: live === null ? null : (live[slot]?.heldNow ?? 0),
    since: new Date(record.since).toISOString(),
    slot,
    targets: record.targets.map((target) => ({
      status: target.status,
      target: target.target,
      until: new Date(target.until).toISOString(),
    })),
  }));
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
