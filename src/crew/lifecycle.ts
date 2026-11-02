/** Shared stopped-session needs, lead presence and the watch's durable merge proof. */
import { runGit } from "../hooks/git";
import { liveSessions, type SessionRecord, sessionIdentityProved } from "../hooks/sessions";
import { workOnRef } from "../worktrees/scan";
import { isLiveRow } from "./agents";
import type { AgentRow } from "./claude";
import type { CrewContext } from "./context";
import { commitsNotOn, GIT_TIMEOUT_MS, leadRef, mergedIntoBase } from "./end";
import {
  type CrewEvent,
  type CrewRecord,
  type LeadRecord,
  setLeadPresence,
  watchIsAlive,
} from "./store";

/**
 * The states whose session is over, so the kit releases its worktree and agent-view rows while
 * its branch stays (D69). `merged` is released only while its removal is held (for the lead, D62,
 * or for a chain): otherwise the watch removes it whole. `blocked` is not one: its question is
 * live until an idle stop (D35).
 */
export const RELEASE_STATES: readonly string[] = ["done", "handoff", "failed", "stopped", "merged"];

/** A stopped-session reminder's spacing, and the grace period for an unknown lead session. */
export const STOPPED_REMINDER_MS = 24 * 60 * 60_000;

/** The watch and board allow a missing session one minute to return. */
export const CREW_MISSING_GRACE_MS = 60_000;

/** Display and reconciliation share the live-row and grace rule. */
export function crewNotRunning(
  record: CrewRecord,
  rows: readonly AgentRow[] | null,
  now: number,
  since = Date.parse(record.updatedAt),
): boolean {
  if (
    rows === null ||
    record.sessionId === null ||
    !["starting", "working", "blocked"].includes(record.state)
  )
    return false;
  const row =
    rows.find((one) => one.sessionId === record.sessionId || one.id === record.shortId) ?? null;
  return !isLiveRow(row) && Number.isFinite(since) && now - since >= CREW_MISSING_GRACE_MS;
}

export interface StoppedCrewNeed {
  since: string;
  days: number;
  unmergedCommits: null | number;
  line: string;
}

/**
 * The one rule for a continuation that still holds its predecessor (RX1): a failed, removed or
 * discarded successor releases it. A successor removed before it started has no branch to merge,
 * so waiting for its merge would never end. The stopped-session reminder and the watch's removal of
 * a merged original both ask this.
 */
export function holdsItsPredecessor(continuation: CrewRecord): boolean {
  return !["failed", "removed", "discarded"].includes(continuation.state);
}

/** One active successor owns this phase; a failed or removed successor releases it. */
export function activeContinuationOf(
  record: CrewRecord,
  records: readonly CrewRecord[],
): CrewRecord | undefined {
  return records.find((one) => one.continues === record.id && holdsItsPredecessor(one));
}

/**
 * The same old, unmerged stopped-session item for the watch and the portal. Events may be in
 * either order. `events` may be a function: the log only grows, so a caller that reads it hands in
 * the read, and it runs only for a record the need can apply to (RX1).
 */
export function stoppedCrewNeed(
  record: CrewRecord,
  events: readonly CrewEvent[] | (() => readonly CrewEvent[]),
  ctx: CrewContext,
  records: readonly CrewRecord[] = [],
): StoppedCrewNeed | null {
  if (
    !["stopped", "done", "failed"].includes(record.state) ||
    activeContinuationOf(record, records) !== undefined
  )
    return null;
  const transitions = (typeof events === "function" ? events() : events)
    .filter(
      (event) => event.crew === record.id && ["state", "created", "report"].includes(event.type),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let previous: string | undefined;
  let since = record.updatedAt;
  for (const event of transitions) {
    if (event.state === record.state && previous !== record.state) since = event.at;
    previous = event.state;
  }
  const age = ctx.now() - Date.parse(since);
  if (!Number.isFinite(age) || age <= STOPPED_REMINDER_MS) return null;
  const merged = mergedIntoBase(record, ctx);
  if (merged === "ancestor" || merged === "replay") return null;
  const lead = leadRef(record, ctx);
  const unmergedCommits =
    "why" in lead ? null : commitsNotOn(record.repo, lead, record.branch, ctx.env);
  const days = Math.floor(age / STOPPED_REMINDER_MS);
  const line = `${record.name}: stopped ${days} day${days === 1 ? "" : "s"} ago; ${unmergedCommits ?? "unknown"} unmerged commit${unmergedCommits === 1 ? "" : "s"} — crew resume "${record.name}", crew start ${record.phase} --continue "${record.name}", or crew rm "${record.name}"`;
  return { since, days, unmergedCommits, line };
}

/** A durable proof is usable only for the exact crew head the watch proved. */
export function validMergeProof(record: CrewRecord, ctx: CrewContext): boolean {
  if (record.mergeProof === undefined) return false;
  const head = runGit(
    record.repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!head.ok || head.out !== record.mergeProof.head) return false;
  const commit = runGit(
    record.repo,
    ["cat-file", "-t", record.mergeProof.leadCommit],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!commit.ok || commit.out !== "commit") return false;
  // Upgrade proofs captured before refs were retained, while their commit still exists.
  const proofRef = `refs/crew-merge-proofs/${record.mergeProof.leadCommit}`;
  const saved = runGit(
    record.repo,
    ["update-ref", proofRef, record.mergeProof.leadCommit, ""],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (saved.ok) return true;
  const existing = runGit(
    record.repo,
    ["rev-parse", "--verify", proofRef],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  return existing.ok && existing.out === record.mergeProof.leadCommit;
}

/** Capture a merge against immutable commits, not two refs that may move between calls. */
export function mergeProof(record: CrewRecord, ctx: CrewContext): CrewRecord["mergeProof"] {
  const lead = leadRef(record, ctx);
  if ("why" in lead) return undefined;
  const head = runGit(
    record.repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!head.ok || record.base === null || head.out === record.base.sha) return undefined;
  // `workOnRef` takes commits, so a concurrent change of either branch cannot forge this proof.
  const result = workOnRef(record.repo, lead.sha, head.out, ctx.env);
  if (result !== "ancestor" && result !== "replay") return undefined;
  // A rewritten lead can lose its merge commit to GC. Create-only and content-addressed:
  // no proof overwrites another and the lead commit (plus its ancestors) stays reachable.
  const proofRef = `refs/crew-merge-proofs/${lead.sha}`;
  const saved = runGit(
    record.repo,
    ["update-ref", proofRef, lead.sha, ""],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!saved.ok) {
    const existing = runGit(
      record.repo,
      ["rev-parse", "--verify", proofRef],
      ctx.env,
      GIT_TIMEOUT_MS,
    );
    if (!existing.ok || existing.out !== lead.sha) return undefined;
  }
  return { head: head.out, leadRef: lead.label, leadCommit: lead.sha };
}

type LeadPresenceContext = Pick<CrewContext, "paths" | "sessions" | "watchAlive">;

/** One snapshot for commands that must never adopt on an unreadable source. */
export function sessionSnapshot(ctx: LeadPresenceContext): readonly SessionRecord[] {
  return ctx.sessions?.() ?? liveSessions(ctx.paths.claudeConfigDir);
}

/** Adoption rewrites crew ownership to the current id; earlier ids own events, not crew. */
export function isOpenCrewOfLead(record: CrewRecord, lead: LeadRecord): boolean {
  return (
    record.leadSessionId === lead.sessionId &&
    !["merged", "removed", "discarded"].includes(record.state)
  );
}

export interface LeadRunningReason {
  line: string;
  fix: string;
}

/** All three sources must prove absence before a lead can be adopted. */
export function leadRunningReason(
  lead: LeadRecord,
  rows: readonly AgentRow[] | null,
  sessions: readonly SessionRecord[],
  ctx: LeadPresenceContext,
): LeadRunningReason | null {
  const session = sessions.find((one) => one.sessionId === lead.sessionId);
  if (session !== undefined) {
    return sessionIdentityProved(session)
      ? {
          line: "a live session record has a proved identity",
          fix: "end that lead with crew lead --end in its session, then retry here",
        }
      : {
          line: `a session record for pid ${session.pid} has an unproved identity`,
          fix: `when that session is really gone, retry once pid ${session.pid} has ended, or after a restart`,
        };
  }
  if (
    ctx.watchAlive?.(lead.repo, lead.sessionId) ??
    watchIsAlive(ctx.paths.stateDir, lead.repo, lead.sessionId)
  )
    return {
      line: "its watch holds the lease",
      fix: "stop that watch, or wait for it to end, then retry here",
    };
  if (rows === null) throw new Error("the agent view cannot be read; retry crew lead");
  return rowsOfLead(rows, lead).some((row) => isLiveRow(row))
    ? {
        line: "the agent view lists it as live",
        fix: "stop it in the agent view or run crew lead --end in it, then retry here",
      }
    : null;
}

/** Boolean contract retained for the board, watch and cleanup callers. */
export function leadRunning(
  lead: LeadRecord,
  rows: readonly AgentRow[] | null,
  sessions: readonly SessionRecord[],
  ctx: LeadPresenceContext,
): boolean {
  return leadRunningReason(lead, rows, sessions, ctx) !== null;
}

/** The rows agent view lists for the session of `lead`. */
function rowsOfLead(rows: readonly AgentRow[], lead: LeadRecord): AgentRow[] {
  return rows.filter(
    (row) => row.sessionId === lead.sessionId || row.id === lead.sessionId.slice(0, 8),
  );
}

/** Observe all leads in one agent-view read; callers share the same persisted absence clock. */
export async function observeLeadPresence(
  stateDir: string,
  leads: readonly LeadRecord[],
  rows: readonly AgentRow[] | null,
  now: number,
  ctx: CrewContext,
): Promise<LeadRecord[]> {
  if (rows === null) return [...leads];
  let sessions: readonly SessionRecord[] = [];
  try {
    sessions = sessionSnapshot(ctx);
  } catch {
    return [...leads];
  }
  const observed: LeadRecord[] = [];
  for (const lead of leads) {
    const known = leadRunning(lead, rows, sessions, ctx);
    observed.push((await setLeadPresence(stateDir, lead.repo, lead.sessionId, known, now)) ?? lead);
  }
  return observed;
}

/** The one lead-gone rule; an unreadable agent view never proves absence. */
export function leadGone(
  lead: LeadRecord | null,
  rows: readonly AgentRow[] | null,
  now: number,
  ctx: LeadPresenceContext,
): boolean {
  if (lead === null) return false;
  if (lead.endedAt != null) return true;
  try {
    if (leadRunning(lead, rows, sessionSnapshot(ctx), ctx)) return false;
  } catch {
    // An unreadable source cannot authorize cleanup or mark a lead gone.
    return false;
  }
  const since = Date.parse(lead.sessionUnknownSince ?? "");
  return Number.isFinite(since) && now - since > STOPPED_REMINDER_MS;
}
