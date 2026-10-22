/**
 * The JSON API's work answers: the Work view, one crew session's page, "Needs you", the guard
 * log, the worktrees, the flow report, and the (empty until phase H1) request history.
 *
 * Every fact comes from the plugin's own readers — the crew store, the flow report, the
 * worktree scan, the guard's ask log, the review record and the merge check — so a page can
 * never disagree with the command that writes the same state. Nothing here changes anything.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openQuestionIndex } from "../../crew/answer";
import { findCrew, stateSince } from "../../crew/board";
import { diffAgainstBase, outsideBrief } from "../../crew/diff";
import {
  type CrewEvent,
  type CrewRecord,
  crewBriefFile,
  listCrew,
  listLeads,
  readCrewEvents,
  readReport,
} from "../../crew/store";
import { currentBreakers, parseLimitState } from "../../gateway/limit-state";
import { oneLine } from "../../gateway/plain-text";
import { askLogFile } from "../../hooks/ask-log";
import { locateCheckout } from "../../project/resolve";
import { savedSessions } from "../../sessions/command";
import { FLOW_DAYS_KEPT, OPEN_WAIT_MAX_AGE_MS, openWaits, readFlow } from "../../sessions/flow";
import {
  type MergeVerdict as CheckVerdict,
  checkBranch,
  type MergeWorld,
} from "../../workflow/merge-check";
import { readReviews, reviewsFile } from "../../workflow/reviews";
import { baseBranch } from "../../worktrees/command";
import { scanWorktrees } from "../../worktrees/scan";
import { shownDetail } from "../facts";
import { type PageDataDeps, updateFacts } from "../page-data";
import {
  type BreakerNeed,
  type CrewAnswer,
  type CrewNeed,
  type CrewReport,
  type CrewReview,
  type CrewStepItem,
  type CrewSummary,
  type FlowAnswer,
  type GuardAskItem,
  type GuardAsksAnswer,
  HISTORY_RANGES,
  type HistoryAnswer,
  type HistoryRange,
  type LeadSummary,
  type NeedsAnswer,
  type PermissionWait,
  type RequestsAnswer,
  type SessionSummary,
  type WorkAnswer,
  type WorktreeItem,
  type WorktreesAnswer,
} from "./types";

/** How many events a crew page's timeline shows: the newest of them. */
export const CREW_PAGE_EVENTS = 200;

/** How far back the Work view looks for the other Claude Code sessions: two days, as `sessions`. */
export const WORK_SESSIONS_MS = 2 * 86_400_000;

/** How many asks the guard log answers unless the query says otherwise. */
export const GUARD_ASKS_DEFAULT = 200;

/** This project's main checkout, or why there is none. */
function repoOf(deps: PageDataDeps): { repo: string } | { note: string } {
  try {
    const checkout = locateCheckout(deps.action.cwd, { env: deps.action.portal.env });
    if (checkout === null) {
      return { note: "this folder is not in a git project, so there is no work to show" };
    }
    return { repo: checkout.mainCheckout ?? checkout.root };
  } catch (error) {
    return { note: error instanceof Error ? error.message : String(error) };
  }
}

/** One crew session as a summary: no transcript, no prompt, no key. */
function crewSummary(record: CrewRecord, events: readonly CrewEvent[]): CrewSummary {
  const open = [...record.questions].reverse().find((question) => question.answer === null);
  return {
    base: record.base,
    branch: record.branch,
    createdAt: record.createdAt,
    effort: record.effort,
    id: record.id,
    kind: record.kind,
    lastLine: record.lastLine,
    leadName: record.leadName,
    leadSessionId: record.leadSessionId,
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
    shortId: record.shortId,
    slug: record.slug,
    state: record.state,
    stateSince: stateSince(record, events),
    updatedAt: record.updatedAt,
    waitingFor: record.waitingFor ?? null,
    worktree: record.worktree,
  };
}

/** `/api/work`: the lead, its crew nested, and the other sessions of this project. */
export function workAnswer(deps: PageDataDeps): WorkAnswer {
  const found = repoOf(deps);
  if ("note" in found) return { crew: [], lead: null, note: found.note, repo: null, sessions: [] };
  const { repo } = found;
  const events = readCrewEvents(deps.action.portal.paths.stateDir, repo).events;
  const records = listCrew(deps.action.portal.paths.stateDir, repo).records;
  const crew = records.map((record) => crewSummary(record, events));
  const leads = listLeads(deps.action.portal.paths.stateDir, repo).records;
  const newestLead = [...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lead: LeadSummary | null =
    newestLead === undefined
      ? null
      : {
          crew: crew.filter((one) => one.leadSessionId === newestLead.sessionId),
          createdAt: newestLead.createdAt,
          cwd: newestLead.cwd,
          name: newestLead.name,
          pausedAgents: newestLead.pausedAgents ?? [],
          plan: newestLead.plan,
          sessionId: newestLead.sessionId,
          tag: newestLead.tag,
          updatedAt: newestLead.updatedAt,
        };
  // The crew sessions' own sessions, by their full ids: a saved session that is one of them
  // is not "another session" on the Work page.
  const crewIds = new Set<string>(
    records.flatMap((record) => (record.sessionId === null ? [] : [record.sessionId])),
  );
  const leadIds = new Set(leads.map((one) => one.sessionId));
  const sessions: SessionSummary[] = savedSessions(
    join(deps.action.portal.paths.claudeConfigDir, "projects"),
    repo,
    deps.action.portal.now() - WORK_SESSIONS_MS,
  )
    .filter((session) => !crewIds.has(session.id) && !leadIds.has(session.id))
    .map((session) => ({
      branch: session.branch,
      endedCleanly: session.endedCleanly,
      folder: session.folder,
      id: session.id,
      lastWrite: session.lastWrite,
      name: session.name,
    }));
  return { crew, lead, note: null, repo, sessions };
}

/** A merge verdict, in the API's own shape (the command's kinds). */
function mergeVerdictOf(verdict: CheckVerdict): CrewAnswer["mergeCheck"] {
  switch (verdict.kind) {
    case "allowed":
      return { kind: "allowed", reason: verdict.reason };
    case "refused":
      return { kind: "refused", number: verdict.number, reason: verdict.reason };
    case "silent":
      return { kind: "silent" };
    case "unread":
      return { kind: "unread", number: verdict.number, what: verdict.what };
    case "late":
      return { kind: "late", number: verdict.number, what: verdict.what };
  }
}

/** `/api/crew/<id>`: one crew session's page, or why it cannot be named. */
export function crewAnswerFor(deps: PageDataDeps, ref: string): CrewAnswer | { error: string } {
  const found = repoOf(deps);
  if ("note" in found) return { error: found.note };
  const { repo } = found;
  const paths = deps.action.portal.paths;
  let records: CrewRecord[];
  try {
    records = listCrew(paths.stateDir, repo).records;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const named = findCrew(records, ref, "status");
  if ("refusal" in named) return { error: named.refusal.lines.join(" ") };
  const record = named.record;
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
  const mergeCheck = mergeCheckOf(deps, repo, record.branch, record.base?.ref ?? null);
  return {
    brief,
    crew: crewSummary(record, allEvents),
    diff,
    events,
    mergeCheck,
    report: reportOf(record.reportPath),
    reviews,
  };
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

/** The merge check for a crew session's branch against its base (D22's gate, D17b's record). */
function mergeCheckOf(
  deps: PageDataDeps,
  repo: string,
  branch: string,
  base: null | string,
): CrewAnswer["mergeCheck"] {
  try {
    const checkout = locateCheckout(deps.action.cwd, { env: deps.action.portal.env });
    if (checkout === null) {
      return { kind: "unread", number: null, what: "this folder is not in a git project" };
    }
    const world: MergeWorld = {
      checkout,
      env: deps.action.portal.env,
      folder: repo,
      paths: deps.action.portal.paths,
      timeFor: (limitMs) => limitMs,
    };
    return mergeVerdictOf(
      checkBranch(world, {
        base: base ?? baseBranch(checkout, deps.action.portal.env, repo).base,
        branch,
      }),
    );
  } catch (error) {
    return {
      kind: "unread",
      number: null,
      what: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `/api/needs`: everything that waits on the person (D52). */
export async function needsAnswer(deps: PageDataDeps): Promise<NeedsAnswer> {
  const paths = deps.action.portal.paths;
  const now = deps.action.portal.now();
  const found = repoOf(deps);
  const crew: CrewNeed[] = [];
  if ("repo" in found) {
    try {
      for (const record of listCrew(paths.stateDir, found.repo).records) {
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
    } catch {
      // A store that cannot be read is doctor's to report; the rest of "Needs you" still shows.
    }
  }
  const permissions: PermissionWait[] = openWaits(paths, {
    nowMs: now,
    project: null,
    session: null,
    sinceMs: now - OPEN_WAIT_MAX_AGE_MS,
  }).map((wait) => ({
    asker: wait.asker,
    at: wait.at,
    kind: wait.kind,
    project: wait.project,
    session: wait.session,
    tool: wait.tool,
  }));
  const doctor = await deps.doctor();
  const update = updateFacts(deps.action).held;
  return {
    breaker: breakerOf(deps, now),
    crew,
    doctor: {
      at: doctor?.at ?? null,
      failures: (doctor?.checks ?? [])
        .filter((check) => !check.ok)
        .map((check) => ({ text: check.text })),
    },
    permissions,
    update,
  };
}

/** The first open breaker, as "Needs you" shows one; null when every slot answers. */
function breakerOf(deps: PageDataDeps, now: number): BreakerNeed | null {
  let text: string;
  try {
    text = readFileSync(deps.action.portal.paths.gatewayStateFile, "utf8");
  } catch {
    return null;
  }
  const state = parseLimitState(text);
  if (state === null) return null;
  const [slot, record] = currentBreakers(state, now)[0] ?? [];
  if (slot === undefined || record === undefined) return null;
  return {
    held: record.held,
    since: new Date(record.since).toISOString(),
    slot,
    targets: record.targets.map((target) => ({
      status: target.status,
      target: target.target,
      until: new Date(target.until).toISOString(),
    })),
  };
}

/** The filters `/api/guard-asks` takes. */
export interface GuardAskQuery {
  hook: null | string;
  limit: number;
  q: null | string;
  session: null | string;
  tool: null | string;
}

/** `/api/guard-asks`: the guard log, filtered, with the totals its chart draws. */
export function guardAsksAnswer(deps: PageDataDeps, query: GuardAskQuery): GuardAsksAnswer {
  let text: string;
  try {
    text = readFileSync(askLogFile(deps.action.portal.paths.stateDir), "utf8");
  } catch {
    return { asks: [], byHook: {}, kept: 0, skipped: 0 };
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
    if (hook === null || at === null) {
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
  const kept = asks
    .filter(
      (ask) =>
        (query.hook === null || ask.hook === query.hook) &&
        (query.session === null || ask.session === query.session) &&
        (query.tool === null || ask.tool === query.tool) &&
        (query.q === null || ask.reason.toLowerCase().includes(query.q.toLowerCase())),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, query.limit);
  return { asks: kept, byHook, kept: kept.length, skipped };
}

/** `/api/worktrees`: every worktree's verdict, against the project's base. */
export function worktreesAnswer(deps: PageDataDeps): WorktreesAnswer {
  const found = repoOf(deps);
  if ("note" in found) {
    return { base: "", from: "default", note: found.note, worktrees: [] };
  }
  const { repo } = found;
  try {
    const checkout = locateCheckout(deps.action.cwd, { env: deps.action.portal.env });
    const chosen = baseBranch(checkout, deps.action.portal.env, repo);
    const judged = {
      base: chosen.base,
      claudeConfigDir: deps.action.portal.paths.claudeConfigDir,
      env: deps.action.portal.env,
      now: deps.action.portal.now(),
    };
    let note: null | string = null;
    let scanned: ReturnType<typeof scanWorktrees>;
    try {
      scanned = scanWorktrees(repo, judged);
    } catch (error) {
      // A repository with no `origin/<base>` (a local-only repo) is judged against its own
      // base branch: the same comparison, said plainly.
      const why = error instanceof Error ? error.message : String(error);
      if (!why.includes("is not known here")) {
        return { base: "", from: "default", note: why, worktrees: [] };
      }
      scanned = scanWorktrees(repo, {
        ...judged,
        against: { label: chosen.base, ref: `refs/heads/${chosen.base}` },
      });
      note = `origin/${chosen.base} is not known here, so this judges against the local ${chosen.base}`;
    }
    const worktrees: WorktreeItem[] = scanned.map((worktree) => {
      const { branch, head, path } = worktree.listed;
      if (worktree.state === "main") {
        return { branch, head, kind: "main", path, why: null };
      }
      if (worktree.state === "gone") {
        return { branch, head, kind: "gone", path, why: "its folder no longer exists" };
      }
      return worktree.state.finished
        ? { branch, head, kind: "finished", path, why: null }
        : { branch, head, kind: "kept", path, why: worktree.state.why };
    });
    return { base: chosen.base, from: chosen.from, note, worktrees };
  } catch (error) {
    return {
      base: "",
      from: "default",
      note: error instanceof Error ? error.message : String(error),
      worktrees: [],
    };
  }
}

/** `/api/flow?range=…`: the flow report for the window (one reader, `src/sessions/flow.ts`). */
export function flowAnswer(deps: PageDataDeps, range: HistoryRange): FlowAnswer {
  const now = deps.action.portal.now();
  const wanted = HISTORY_RANGES[range];
  const kept = FLOW_DAYS_KEPT * 86_400_000;
  const window = Math.min(wanted, kept);
  const report = readFlow(deps.action.portal.paths, {
    nowMs: now,
    project: null,
    session: null,
    sinceMs: now - window,
  });
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

/** The bucket each range is drawn in: 1 min, 5 min, 15 min, 1 h, 2 h, 6 h, 1 day (D51). */
export const HISTORY_BUCKET_MS: Record<HistoryRange, number> = {
  "1d": 15 * 60_000,
  "1h": 60_000,
  "4h": 5 * 60_000,
  "7d": 3_600_000,
  "14d": 2 * 3_600_000,
  "30d": 6 * 3_600_000,
  "90d": 86_400_000,
};

/** Why the history answers empty today: phase H1 writes and reads the request log. */
const HISTORY_NOT_YET =
  "the request history arrives with phase H1: the router does not write its request log yet, so there is nothing to read";

/** `/api/history`: requests over time, bucketed (empty until H1). */
export function historyAnswer(
  deps: PageDataDeps,
  range: HistoryRange,
  by: HistoryAnswer["by"],
): HistoryAnswer {
  const now = deps.action.portal.now();
  return {
    available: false,
    bucketMs: HISTORY_BUCKET_MS[range],
    buckets: [],
    by,
    from: now - HISTORY_RANGES[range],
    note: HISTORY_NOT_YET,
    range,
    to: now,
  };
}

/** `/api/requests`: the recent requests, paged (empty until H1). */
export function requestsAnswer(): RequestsAnswer {
  return {
    available: false,
    cursor: null,
    note: HISTORY_NOT_YET,
    requests: [],
  };
}
