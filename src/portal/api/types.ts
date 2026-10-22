/**
 * The portal's JSON API: every read-only answer a page fetches, and the shapes they carry.
 *
 * These are the names the portal UI is built against: `portal/src/api/wire.ts` mirrors every
 * type this file exports, by the same name, and `wire-mirror.test.ts` fails when the two
 * drift. The routes: `GET /api/facts`, `/api/overview`, `/api/slots`, `/api/health`,
 * `/api/machine`, `/api/settings`, `/api/projects`, `/api/work`, `/api/crew/<id>`,
 * `/api/flow`, `/api/needs`, `/api/guard-asks`, `/api/worktrees`, `/api/update`, `/api/jobs`,
 * `/api/history`, `/api/history/keys` and `/api/requests`; the live stream `GET /events`
 * (`LiveEvents`). Every one is a GET through the door and changes nothing; the pages that act
 * use `POST /api/<action>` (`ActionName`, `src/portal/actions.ts`).
 *
 * Answers hold what the server-rendered pages hold — the same fact readers, the same words —
 * and never a key, an address with a credential, a prompt or an answer
 * (`.claude/rules/portal.md` § A key never reaches a page).
 */

import type { Check as DoctorCheck } from "../../cli/doctor";
import type { CrewEvent } from "../../crew/store";
import {
  HISTORY_RANGE_MS,
  type HistoryBy,
  type HistoryFilters,
  type HistoryKeys,
  type HistoryPoint,
  type HistoryRange,
  type HistorySeries,
} from "../../gateway/history-read";
import type { BreakerRecord, FallbackRecord, LimitRecord } from "../../gateway/limit-state";
import type { GuardAsk } from "../../hooks/ask-log";
import type { JobsAnswer } from "../../jobs/status";
import type { FlowReport } from "../../sessions/flow";
import type { LastCheck } from "../../update/state";
import type { ActionName, ActionResult } from "../actions";
import type {
  BackendRow,
  FallbackRow,
  LimitRow,
  LogLine,
  ModelRow,
  OpenBreaker,
  PortalFacts,
  ProjectCardData,
  RecentEntry,
  RouterFacts,
  SettingsData,
  SlotRow,
  SlotTarget,
  SwitchFacts,
} from "../facts";
import type { HealthData, MachineData, OverviewData, SlotsData } from "../views";

export type {
  ActionName,
  ActionResult,
  BackendRow,
  BreakerRecord,
  CrewEvent,
  DoctorCheck,
  FallbackRecord,
  FallbackRow,
  FlowReport,
  GuardAsk,
  HistoryKeys,
  JobsAnswer,
  LastCheck,
  LimitRecord,
  LimitRow,
  LogLine,
  ModelRow,
  OpenBreaker,
  PortalFacts,
  ProjectCardData,
  RecentEntry,
  RouterFacts,
  SettingsData,
  SlotRow,
  SlotTarget,
  SwitchFacts,
};

/** `GET /api/facts`: the frame's facts — the version, this portal's port, the router. */
export type FactsAnswer = PortalFacts;

/** A page whose screen needs the gateway, on a machine that has none. */
export interface NotSetUp {
  /** True when the gateway is set up and readable. */
  configured: boolean;
  /** Why it is not: the missing file, or the file's own error. Null when it is. */
  error: null | string;
}

/**
 * `GET /api/overview`: the Overview page. `jobs` is the queue at a glance (D52); the whole
 * queue is `/api/jobs`.
 */
export interface OverviewAnswer extends NotSetUp, OverviewData {
  jobs: { budgetGb: number; heldGb: number; waiting: number };
}

/** `GET /api/slots`: the Slots page, with the switches the page draws. */
export interface SlotsAnswer extends NotSetUp, SlotsData {
  switches: SwitchFacts;
}

/** `GET /api/health`: the Health page. */
export interface HealthAnswer extends NotSetUp, HealthData {}

/** The update card, on Machine and on its own. */
export interface UpdateAnswer {
  /** A new major version held for the person's word (D33); null when there is none. */
  held: null | { at: string; from: null | string; notes: string[]; version: string };
  /** When background updates were put on hold; null when they are not. */
  heldSince: null | string;
  installed: null | string;
  last: MachineUpdate["last"];
  newest: null | string;
  summary: string;
}

/** The last background check, as the update files keep it (the Machine page's own shape). */
export type MachineUpdate = MachineData["updates"];

/** `GET /api/machine`: the Machine page. Needs no gateway config. */
export interface MachineAnswer extends MachineData {}

/** `GET /api/settings`: the Settings page. Needs no gateway config. */
export interface SettingsAnswer extends SettingsData {}

/** One project, as a row in `/api/projects`. */
export interface ProjectSummary {
  configFile: null | string;
  name: null | string;
  root: null | string;
  /** True: `.claude/cc-smart-dev-kit.json` is there. */
  set: boolean;
}

/** `GET /api/projects`: the project the portal runs in, and the rows of its page (B8). */
export interface ProjectsAnswer {
  /** The project whose folder the portal was started in: the Machine card's data. */
  current: ProjectCardData;
  /**
   * One row per repository a person works in. Until B8 lists every repository from the
   * session records, this holds the current project alone, and `note` says so.
   */
  projects: ProjectSummary[];
  note: null | string;
}

/** A crew session, as the Work view and a crew page show it. */
export interface CrewSummary {
  base: null | { ref: string; sha: string };
  branch: string;
  createdAt: string;
  effort: string;
  id: string;
  kind: string;
  /** What it said at the end of its last turn; null before the first. */
  lastLine: null | string;
  leadName: string;
  /** The lead session that started it. */
  leadSessionId: string;
  memoryMb: null | number;
  model: { named: string; resolved: string; slot: null | string; tier: null | string };
  name: string;
  phase: string;
  plan: string;
  pr: null | number;
  /** The newest question with no answer: what it waits on you for (D36). */
  question: null | {
    askedAt: string;
    options: string[];
    question: string;
    /** The 1-based option the crew session recommends; null for none. */
    recommended: null | number;
  };
  shortId: null | string;
  slug: string;
  state: string;
  /** When this state began (the newest state event's time, ISO 8601). */
  stateSince: string;
  updatedAt: string;
  /** What it waits for while paused; null otherwise. */
  waitingFor: null | {
    kind: string;
    model?: string;
    resetsAt?: null | string;
    since?: string;
    slot?: string;
  };
  worktree: string;
}

/** The lead of this repository, with its crew nested. */
export interface LeadSummary {
  /** The crew sessions it leads, newest first. */
  crew: CrewSummary[];
  createdAt: string;
  cwd: string;
  name: string;
  pausedAgents: string[];
  plan: string;
  sessionId: string;
  tag: string;
  updatedAt: string;
}

/** One Claude Code session that is not a crew session. */
export interface SessionSummary {
  branch: null | string;
  /** True: Claude Code wrote its end marker (a clean close, or `/exit`). */
  endedCleanly: boolean;
  folder: null | string;
  id: string;
  /** When its file was last written (milliseconds since the epoch). */
  lastWrite: number;
  name: null | string;
}

/** `GET /api/work`: the lead, its crew nested, and the other sessions. */
export interface WorkAnswer {
  /** Every crew session of this repository, newest first. */
  crew: CrewSummary[];
  lead: null | LeadSummary;
  note: null | string;
  /** The repository (its main checkout); null outside a git project. */
  repo: null | string;
  sessions: SessionSummary[];
}

/** One event of a crew session's log, for the page's step timeline. */
export interface CrewStepItem {
  at: string;
  /** What the crew session said at its step, in its own words; null when it said nothing. */
  note: null | string;
  sha: null | string;
  /** Its state after the event. */
  state: string;
  /** One short line: the step, the report's status, why it failed. */
  text: null | string;
  type: string;
}

/** The hand-back report, as its file keeps it. */
export interface CrewReport {
  base: { ref: string; sha: string };
  branch: { name: string; sha: string };
  changed: { deletions: number; files: number; insertions: number };
  checks: { name: string; note: null | string; ok: boolean }[];
  docs: string[];
  needsLead: string[];
  open: string[];
  outsideBrief: string[];
  phase: string;
  pr: null | number;
  question: null | string;
  review: null | {
    agent: string;
    effort: string;
    findings: { finding: string; fix: string }[];
    model: string;
    sha: string;
  };
  status: string;
  summary?: string | null | undefined;
  tests: { full: null | TestRun; targeted: TestRun[] };
}

/** One test command a report ran: the command, and how many tests passed and failed. */
export interface TestRun {
  command: string;
  failed: number;
  ok: boolean;
  passed: number;
  [key: string]: unknown;
}

/** A review recorded on the crew session's branch (the record `workflow review-done` writes). */
export interface CrewReview {
  at: string;
  /** The writers that recorded it (`workflow review-done`, a reviewer agent). */
  by: string[];
  sha: string;
}

/** The merge check's verdict, in the command's own kinds (`workflow merge-check`). */
export type MergeVerdict =
  | { kind: "allowed"; reason: string }
  | { kind: "refused"; number: null | number; reason: string }
  | { kind: "silent" }
  | { kind: "unread"; number: null | number; what: string }
  | { kind: "late"; number: null | number; what: string };

/** `GET /api/crew/<id>`: one crew session's page (D52). */
export interface CrewAnswer {
  /** Its brief's text; null when the file is gone or was never written. */
  brief: null | string;
  crew: CrewSummary;
  /** Its branch against its base; `error` says why git could not give it. */
  diff: {
    deletions: number;
    error: null | string;
    files: number;
    insertions: number;
    outsideBrief: string[];
  };
  /** Its log's newest events last; at most `CREW_PAGE_EVENTS`. */
  events: CrewStepItem[];
  mergeCheck: MergeVerdict;
  report: CrewReport | null;
  /** Every review recorded on its branch, newest first. */
  reviews: CrewReview[];
}

/** One ask the guard log recorded (already masked when it was written). */
export interface GuardAskItem {
  /** Milliseconds since the epoch. */
  at: number;
  hook: string;
  /** The question: one line, short, with anything that looks like a key masked. */
  reason: string;
  session: string;
  tool: string;
}

/** `GET /api/guard-asks`: the guard log, filtered, with its totals for the chart. */
export interface GuardAsksAnswer {
  asks: GuardAskItem[];
  /** The hooks that asked, with how many times, across the whole kept log. */
  byHook: Record<string, number>;
  /** How many asks the filter kept, and how many lines the file held that could not be read. */
  kept: number;
  skipped: number;
}

/** Why the person is needed, from the flow report: a permission prompt or a question. */
export interface PermissionWait {
  asker: string;
  /** Milliseconds since the epoch. */
  at: number;
  kind: null | string;
  project: string;
  session: string;
  tool: string;
}

/** A crew session's open question, for "Needs you". */
export interface CrewNeed {
  askedAt: string;
  crew: { id: string; name: string; shortId: null | string; state: string };
  options: string[];
  question: string;
  recommended: null | number;
}

/** An open breaker: a slot whose every target is limited or down. */
export interface BreakerNeed {
  held: number;
  since: string;
  slot: string;
  targets: { status: null | number; target: string; until: string }[];
}

/** A doctor failure with the line that fixes it (doctor's own words). */
export interface DoctorFailure {
  text: string;
}

/** `GET /api/needs`: everything that waits on the person (D52). */
export interface NeedsAnswer {
  breaker: null | BreakerNeed;
  crew: CrewNeed[];
  doctor: { at: null | number; failures: DoctorFailure[] };
  permissions: PermissionWait[];
  /** A held major update (D33); null when there is none. */
  update: null | { at: string; from: null | string; notes: string[]; version: string };
}

/** One worktree, as `/api/worktrees` lists it. */
export interface WorktreeItem {
  branch: null | string;
  /** `main`, a folder that is gone, finished, or kept with its reason. */
  kind: "finished" | "gone" | "kept" | "main";
  /** The commit it is on. */
  head: string;
  path: string;
  /** Why it is kept; null when it is finished or the main checkout. */
  why: null | string;
}

/** `GET /api/worktrees`: every worktree's verdict against `base`, with no fetch (origin as it is). */
export interface WorktreesAnswer {
  base: string;
  /** Where the base came from: the project's file, the remote's default, or the fallback. */
  from: "config" | "default" | "origin";
  /** A line about the machine's own facts when they could not be read (Docker, programs). */
  note: null | string;
  worktrees: WorktreeItem[];
}

/**
 * The history's own names come from its reader (`src/gateway/history-read.ts`): one home for
 * the ranges, their milliseconds, the groupings, the filters and a bucket's fields.
 */
export type { HistoryBy, HistoryFilters, HistoryPoint, HistoryRange, HistorySeries };
export { HISTORY_RANGE_MS as HISTORY_RANGES };

/** One row of the recent-requests table (D51, phase H1). Metadata only. */
export interface HistoryRequest {
  at: number;
  costUsd: null | number;
  /** True: the breaker held it. */
  held: boolean;
  latencyMs: number;
  model: string;
  /** The next target that answered, or tried to; null when the first one did. */
  nextTarget: null | string;
  session: null | string;
  slot: null | string;
  status: number;
  target: string;
  tokens: { cacheRead: number; cacheWrite: number; input: number; output: number };
}

/**
 * `GET /api/history?range=…&by=…&…`: requests over time, one series per key (D51, phase H1).
 * A bucket is `HistoryPoint` from the reader, and every bucket of the window is there.
 */
export interface HistoryAnswer {
  /** True: the request reader answered (H1); every answer the route serves sets it. */
  available: boolean;
  by: HistoryBy;
  /** One bucket per step: 1 min, 5 min, 15 min, 1 h, 2 h, 6 h, 1 day, by the range. */
  bucketMs: number;
  /** The window's start, milliseconds since the epoch. */
  from: number;
  /** A line about an empty answer (no request logged yet), or null. */
  note: null | string;
  range: HistoryRange;
  series: HistorySeries[];
  to: number;
}

/** `GET /api/requests?…&cursor=`: the recent requests, paged (D51, phase H1). */
export interface RequestsAnswer {
  available: boolean;
  /** The cursor for the next page; null at the end. */
  cursor: null | string;
  note: null | string;
  requests: HistoryRequest[];
}

/** `GET /api/history/keys?range=…`: the values each filter can take in that range. */
export type HistoryKeysAnswer = HistoryKeys;

/** `GET /api/flow?range=…`: the flow report for the window (one reader: `src/sessions/flow.ts`). */
export interface FlowAnswer {
  from: number;
  note: null | string;
  range: HistoryRange;
  report: FlowReport;
  to: number;
}

/** Every JSON answer the API gives: one shape per route. */
export interface ApiError {
  error: string;
}

/** `gateway-state.json` as the live stream's `state` event sends it (`limit-state.ts`). */
export interface LiveState {
  breakers: Record<string, BreakerRecord>;
  fallbacks: Record<string, FallbackRecord>;
  limits: Record<string, LimitRecord>;
  /** Claude model id → the last time the router saw Claude Code send it (milliseconds). */
  seenClaude: Record<string, number>;
}

/**
 * The `action` event: a line an action printed while it runs (`line`), or its result, the same
 * value its POST answers with. `action` names which one, so a page shows only its own.
 */
export type ActionEvent = { action: string; line: string } | ({ action: string } & ActionResult);

/**
 * Every event `GET /events` sends, and its `data`. A page fetches its facts from `/api/…` and
 * fetches again when an event says they changed; `reset` (a new run of the portal, or a gap
 * older than the replay buffer) means every page fetches again, and `closing` that this
 * portal is going away for a new version.
 */
export interface LiveEvents {
  action: ActionEvent;
  closing: { at: number };
  crew: CrewEvent;
  doctor: null | { at: number; checks: DoctorCheck[] };
  "guard-ask": GuardAsk;
  hello: { at: number; boot: string };
  jobs: ApiError | JobsAnswer;
  ping: { at: number };
  recent: RecentEntry;
  reset: { boot: string };
  state: LiveState;
  update: { last: LastCheck | null };
}

/** An event's name. */
export type LiveEventName = keyof LiveEvents;

/** What publishes to the stream: an event's name and exactly its data. */
export type LivePublish = <K extends LiveEventName>(event: K, data: LiveEvents[K]) => void;
