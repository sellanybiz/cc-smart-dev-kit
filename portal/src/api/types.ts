/**
 * The shapes the portal's pages draw. The server's own answers are in `wire.ts` (one mirror of
 * the kit's API types, checked by the kit's tests); `adapt.ts` turns each answer into these,
 * in one place. A shape here that is the server's own is an alias of it; one the server does
 * not send in full yet names the fields it lacks, which are `null` (the page says it does not
 * know) until a later phase sends them. The mock client (`mock.ts`) answers in these shapes.
 *
 * Times are milliseconds since the epoch unless the source keeps ISO text (the crew store).
 */

import type {
  BackendRow,
  CrewReport,
  CrewReview,
  HistoryAnswer,
  HistoryRequest,
  ModelRow,
  OpenBreaker,
  RequestsAnswer,
  RouterFacts,
  SlotRow,
  SlotsAnswer,
  SlotTarget,
  SwitchFacts,
  HistoryPoint as WireHistoryPoint,
} from "./wire";

export type { BackendRow, ModelRow, OpenBreaker, RouterFacts, SlotRow, SlotTarget, SwitchFacts };

// ── The shell ──────────────────────────────────────────────────────────────────────────

/** `src/portal/facts.ts` › `PortalFacts`. */
export interface PortalFacts {
  platform: string;
  portalPort: number;
  /** Null when there is no gateway config to name a router. */
  router: null | { port: number; up: boolean };
  version: string;
}

/** The live stream's state, as the header shows it (planned: B6b, `GET /events`). */
export type Connection = "live" | "reconnecting";

// ── The router ─────────────────────────────────────────────────────────────────────────

/** One routed request, as the activity feed draws it (the router's `recent`). Metadata only. */
export interface RecentRequest {
  at: number;
  /** The slot's short name, or null for a request no slot took (an explicit target). */
  slot: null | string;
  /** The target that answered, as the config spells it. */
  target: string;
  status: number;
  ms: number;
  /** True when a target before it failed or rested, so the next one answered. */
  next: boolean;
}

/** The router's health, as the route board reads it (`adapt.ts` › `overviewOf`). */
export interface RouterHealth {
  breakers: Record<string, OpenBreaker>;
  /** Target → seconds it still rests. */
  cooling: Record<string, number>;
  fallbacks: number;
  ok: true;
  port: number;
  recent: RecentRequest[];
  requests: number;
  slots: Record<string, string[]>;
  uptimeSec: number;
}

/**
 * The ranges the request history answers, and the bucket each one is drawn in: 1 min, 5 min,
 * 15 min, 1 h, 2 h, 6 h and 1 day (`HISTORY_RANGES` in `src/lib/history.ts` holds the widths).
 */
export type HistoryRange = "1h" | "4h" | "1d" | "7d" | "14d" | "30d" | "90d";

/** What a history series is keyed by. */
export type HistoryBy = "target" | "slot" | "model" | "session";

/**
 * The filters every chart and table takes, kept in the page's address so a view can be shared
 * and reloaded: `slot=…&target=…&model=…&session=…&status=error`.
 */
export interface HistoryFilter {
  slot?: string;
  target?: string;
  model?: string;
  session?: string;
  /** `status=error`: count failed requests only. */
  errorsOnly?: boolean;
}

/** One bucket of one series: H1's own shape (`src/gateway/history-read.ts`). */
export type HistoryPoint = WireHistoryPoint;

/** `GET /api/history?range=…&by=…`: the server's answer, as it is. */
export type History = HistoryAnswer;

/** What a history chart draws: the range, its buckets and the series (the guard log has these too). */
export type ChartHistory = Pick<History, "bucketMs" | "range" | "series">;

/** The values a filter can take (`GET /api/history/keys`); a session's name and project are not sent yet. */
export interface HistoryKeys {
  slots: string[];
  targets: string[];
  models: string[];
  sessions: { id: string; name: null | string; project: null | string }[];
}

/** One routed request, as the request log keeps it: the server's row, metadata only. */
export type RequestRow = HistoryRequest;

/** One page of `GET /api/requests?…&cursor=`: the server's answer, newest first. */
export type RequestPage = RequestsAnswer;

export interface RequestQuery extends HistoryFilter {
  range: HistoryRange;
  cursor: null | string;
}

export interface HistoryQuery extends HistoryFilter {
  range: HistoryRange;
  by: HistoryBy;
}

/** `src/portal/facts.ts` › `LogLine`. */
export interface LogLine {
  level: "ERROR" | "INFO" | "WARN";
  text: string;
  time: string;
}

/** `src/portal/facts.ts` › `LimitRow`. */
export interface LimitRow {
  claim: string;
  model: string;
  resets: null | string;
}

/** `src/portal/facts.ts` › `FallbackRow`. */
export interface FallbackRow {
  slot: string;
  model: string;
  target: string;
  since: string;
}

// ── Slots ──────────────────────────────────────────────────────────────────────────────

/** The Slots page draws the server's own answer (`GET /api/slots`). */
export type SlotsData = SlotsAnswer;

// ── Usage ──────────────────────────────────────────────────────────────────────────────

/**
 * Claude's own replies in one window, from `src/cli/usage.ts` › `SessionUsage` (main and
 * subagent replies by model), with the limit the router last saw in that window (`LimitRow`).
 * Claude Code's plan percentages are written down nowhere, so no page shows one.
 */
export interface UsageWindow {
  /** `5h` or `7d`. */
  window: "5h" | "7d";
  /** Replies written by a `claude-…` model. */
  claudeReplies: number;
  /** Of those, on an Opus or Fable model. */
  premiumReplies: number;
  limit: LimitRow | null;
}

// ── Overview ───────────────────────────────────────────────────────────────────────────

export interface OverviewData {
  health: RouterHealth;
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  usage: UsageWindow[];
  /** Crew sessions in a running state (`starting`, `working`, `blocked`, `paused`, `quiet`). */
  crewRunning: number;
  /** The heavy-job queue in one line: GB held of the budget, and jobs waiting. */
  jobs: { heldGb: number; budgetGb: number; waiting: number };
}

// ── Work: the crew store ───────────────────────────────────────────────────────────────

/** `src/crew/store.ts` › `CREW_STATES`. */
export type CrewState =
  | "queued"
  | "starting"
  | "working"
  | "blocked"
  | "paused"
  | "quiet"
  | "done"
  | "failed"
  | "stopped"
  | "handoff"
  | "merged"
  | "removed";

/** `src/crew/store.ts` › `WaitingFor`. */
export type WaitingFor =
  | { kind: "slot"; since: string; slot: string }
  | { kind: "claude-limit"; model: string; resetsAt: null | string };

/** `src/crew/store.ts` › `CrewRecord` (the fields a page reads). */
export interface CrewRecord {
  id: string;
  /** `C <tag> <phase> <slug>` (`crewName`, `src/crew/names.ts`). */
  name: string;
  sessionId: null | string;
  shortId: null | string;
  leadSessionId: string;
  leadName: string;
  repo: string;
  plan: string;
  phase: string;
  slug: string;
  /** `src/models/launch-policy.ts` › `CREW_KINDS`. */
  kind: string;
  model: { named: string; slot: null | string; resolved: string; tier: null | string };
  effort: string;
  permissionMode: string;
  worktree: string;
  branch: string;
  baseRef: string;
  waitsFor: string[];
  files: string[];
  /** A `CrewState`, or a word a newer kit wrote (shown as itself). */
  state: string;
  lastLine: null | string;
  pr: null | number;
  memoryMb: null | number;
  waitingFor?: WaitingFor;
  startedAt?: null | string;
  createdAt: string;
  updatedAt: string;
}

/** `src/crew/store.ts` › `LeadRecord`. */
export interface LeadRecord {
  sessionId: string;
  /** `LEAD <tag> <plan>` (`leadName`). */
  name: string;
  repo: string;
  plan: string;
  tag: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

/** `src/crew/store.ts` › `CrewEvent` (the fields a page reads). */
export interface CrewEvent {
  at: string;
  type: string;
  crew: string;
  name: string;
  lead: null | string;
  state: string;
  text: null | string;
  note?: null | string;
}

/**
 * A Claude session that is not a lead and not a crew session (planned: B6b's Work data hub,
 * from Claude Code's saved sessions, `src/sessions/`).
 */
export interface OtherSession {
  sessionId: string;
  name: null | string;
  project: string;
  branch: null | string;
  /** Null when its record does not say. */
  model: null | string;
  /** `open`: Claude Code has not written its end marker (it runs, or it stopped hard). */
  state: "working" | "waiting" | "idle" | "open";
  /** ISO 8601: when it last wrote. */
  lastAt: string;
}

export interface WorkData {
  leads: { lead: LeadRecord; crew: CrewRecord[]; lastStep: Record<string, CrewEvent> }[];
  others: OtherSession[];
  /** Crew id → its memory over time, from the events log's `memoryMb` (`CrewEvent`). */
  memory: Record<string, { at: number; mb: number }[]>;
}

// ── Flow: `src/sessions/flow.ts` ───────────────────────────────────────────────────────

/** `src/sessions/flow.ts` › `AskerCount`. */
export interface AskerCount {
  count: number;
  ms: number;
}

/** `src/sessions/flow.ts` › `OpenWait`. */
export interface OpenWait {
  project: string;
  session: string;
  cwd: null | string;
  at: number;
  asker: string;
  kind: null | string;
  tool: string;
}

/** `src/sessions/flow.ts` › `FlowReport` (the totals a page reads; `sessions` kept short). */
export interface FlowReport {
  sinceMs: number;
  untilMs: number;
  sessions: {
    project: string;
    session: string;
    activeMs: null | number;
    agents: { launches: number; parallelRatio: number; mostAtOnce: number };
    prompts: null | { count: number; totalMs: number };
  }[];
  totals: {
    sessions: number;
    activeMs: null | number;
    agents: {
      launches: number;
      replies: number;
      repliesParallel: number;
      launchesParallel: number;
      parallelRatio: number;
      mostAtOnce: number;
    };
    prompts: null | {
      count: number;
      totalMs: number;
      longestMs: number;
      byAsker: Record<string, AskerCount>;
    };
    questions: { askUserQuestion: number; exitPlanMode: number };
    background: null | { count: number; totalMs: number; byOrigin: Record<string, number> };
    idle: null | { count: number; totalMs: number };
    compactions: { count: number; byTrigger: Record<string, number> };
    autoModeBlocks: Record<string, number>;
    merges: { count: number; byAsker: Record<string, number>; byReason: Record<string, number> };
  };
  open: OpenWait[];
  missing: string[];
  /** Why the report covers less than the range asked (it keeps 8 days); null when it covers it. */
  note?: null | string;
  /**
   * The window over time (planned: from the report's hourly cache buckets, `src/sessions/flow.ts`
   * › `FLOW_DAYS_KEPT`): launches and the time blocked on prompts per bucket.
   */
  buckets: { bucketMs: number; points: { t: number; launches: number; blockedMs: number }[] };
}

export type FlowWindow = "24h" | "7d";

// ── Health ─────────────────────────────────────────────────────────────────────────────

/** The router's socket unit (`src/gateway/service.ts`): planned as a fact for B6d. */
export interface SocketFacts {
  unit: null | string;
  listening: boolean;
}

export interface HealthData {
  router: RouterFacts;
  /** Null until the server sends the socket unit's facts. */
  socket: null | SocketFacts;
  backends: BackendRow[];
  breakers: Record<string, OpenBreaker>;
  /** The journal's own order, oldest first (`routerLog`); the page shows it newest first. */
  log: LogLine[];
}

// ── Machine ────────────────────────────────────────────────────────────────────────────

/** `src/portal/facts.ts` › `CompanionRow`. */
export interface CompanionRow {
  command: null | string;
  detail: string;
  id: string;
  state: string;
  enableArgv: null | string[];
  title: string;
}

/** `src/omniroute/install.ts` › `GlobalInstall`. */
export interface GlobalInstall {
  kind: "bun" | "npm";
  folder: string;
  manager: string;
  version: string;
}

/** `src/portal/facts.ts` › `OmnirouteRow`. */
export interface OmnirouteRow {
  backend: null | string;
  install: GlobalInstall | null;
  newestVersion: null | string;
  previous: null | { at: string; version: string };
  registryError: null | string;
  state: "behind" | "ok" | "unknown";
  unit: null | string;
}

/** `src/mcp/status.ts` › `McpServerStatus`. */
export interface McpServerStatus {
  name: string;
  state: "ours" | "foreign" | "missing" | "unreadable" | "unknown";
  runsWhat: null | string;
}

/** `src/browser/setup.ts` › `BrowserSetupState`. */
export interface BrowserSetupState {
  extensionInstalled: boolean;
  fileUrls: boolean | null;
  profile: boolean;
  profileDirName: string;
  tokenSet: boolean;
}

/** `src/browser/setup.ts` › `BrowserGuideStep`. */
export interface BrowserGuideStep {
  detail?: string;
  done: boolean | null;
  text: string;
}

/** `src/portal/facts.ts` › `BrowserCardData`. */
export interface BrowserCardData {
  guide: { intro: string; notes: string[]; steps: BrowserGuideStep[] };
  notes: string[];
  state: BrowserSetupState;
}

/** `src/portal/facts.ts` › `WarpRow`. */
export interface WarpRow {
  detail: string;
  installed: boolean;
}

/** One `doctor` line (`src/cli/doctor.ts`): its mark and its words. */
export interface DoctorLine {
  mark: "ok" | "warn" | "fail" | "info";
  section: string;
  text: string;
}

export interface MachineData {
  facts: PortalFacts;
  /**
   * Claude Code's version, and the one the kit was last proved on (`.claude-code-version`).
   * Null until the server sends it, as are `bun` and `mcp`.
   */
  claudeCode: null | { version: null | string; tested: string };
  bun: null | string;
  companions: CompanionRow[];
  mcp: null | McpServerStatus[];
  browser: BrowserCardData;
  omniroute: OmnirouteRow;
  warp: WarpRow;
  doctor: DoctorLine[];
}

// ── Settings ───────────────────────────────────────────────────────────────────────────

/** `src/workflow/resolve.ts` › `WorkflowSource`. */
export type WorkflowSource = "project" | "personal" | "default";

/** `src/portal/settings.ts` › `SettingKind`. */
export type SettingKind = "boolean" | "events" | "number" | "segment";

/** `src/portal/settings.ts` › `SettingsRow` (`SettingSpec` with its value and source). */
export interface SettingsRow {
  card: "alerts" | "flow" | "switches";
  choices?: readonly { label: string; value: string }[];
  help: string;
  id: string;
  key: string;
  kind: SettingKind;
  label: string;
  where: "personal" | "project";
  readOnly: boolean;
  source: WorkflowSource;
  value: unknown;
  why: null | string;
}

/** `src/portal/facts.ts` › `SettingsData`. */
export interface SettingsData {
  autoMerge: null | { allowed: boolean; base: null | string };
  error: null | string;
  projectNote: null | string;
  rows: SettingsRow[];
}

/**
 * One git project on this machine (planned: B8, from the session records; a folder that is
 * gone or not git is left out).
 */
export interface ProjectListRow {
  id: string;
  name: string;
  path: string;
  /** `.claude/cc-smart-dev-kit.json` is there. */
  setUp: boolean;
  /** ISO 8601: the newest session in it; null until B8 lists every repository. */
  lastUsed: null | string;
  worktrees: null | number;
}

/** `src/project/init.ts` › `ProjectInitAnswers` (the form's fields). */
export interface ProjectInitAnswers {
  base: string;
  bases: Record<string, string>;
  protectedBranches: string[];
  guards: { guardMainFolder: boolean; sessionNames: boolean; jobRoute: boolean };
}

/** A project's page (planned: B8): its row, its settings and its form's first answers. */
export interface ProjectData {
  project: ProjectListRow;
  settings: SettingsData;
  answers: ProjectInitAnswers | null;
  /** True while the main checkout's file differs from `origin/<base>`; null when not known. */
  uncommitted: null | boolean;
}

// ── The heavy-job queue (planned: `GET /api/jobs` and the `jobs` event) ───────────────

/** One job in a store: held (it runs) or waiting. `since` is ms since the epoch (`src/jobs/queue.ts`). */
export interface JobEntry {
  gb: number;
  kind: string;
  command: string;
  folder: string;
  user: string;
  /** Null for a record the queue could not read. */
  since: null | number;
  pid: number;
}

/** One memory store the queue shares out: the machine, or a container (`where`). */
export interface JobStore {
  where: "machine" | (string & {});
  freeGb: number;
  budgetGb: number;
  held: (JobEntry & { exclusive?: boolean })[];
  waiting: JobEntry[];
  note?: string;
}

/** `GET /api/jobs`, and the `jobs` event's data: the same shape. */
export interface JobsData {
  memoryGb: number;
  /** Null where the machine does not say (macOS). */
  freeGb: null | number;
  budgetGb: number;
  keptGb: number;
  stores: JobStore[];
}

// ── Needs you (owner decision D52; planned: `GET /api/needs`) ─────────────────────────

/** Who an item is about: a crew session, by its id and its name. */
export interface CrewRef {
  id: string;
  name: string;
  shortId: null | string;
}

/** `src/crew/store.ts` › `CrewQuestion`: one question a crew session asked its lead. */
export interface CrewQuestion {
  question: string;
  options: string[];
  /** The recommended option, counted from 1; null when none is. */
  recommended: null | number;
  askedAt: string;
  answeredAt: null | string;
  answer: null | string;
}

/** `src/update/state.ts` › `HeldMajor`: a major version found and held for the person (D33). */
export interface HeldMajor {
  version: string;
  from: null | string;
  at: string;
  notes: string[];
}

/** One thing that waits for the person. `since` is ISO 8601. */
export type NeedsItem =
  | { kind: "question"; id: string; since: string; crew: CrewRef; ask: CrewQuestion }
  | {
      kind: "permission";
      id: string;
      since: string;
      /** The crew session it is, or null for one of the person's own sessions. */
      crew: null | CrewRef;
      /** Who asked (a guard, or Claude Code), the session, and the project it is in. */
      asker: string;
      session: string;
      project: string;
      /** The command that opens the waiting session in a terminal: `claude attach <id>`. */
      attach: string;
      /** The tool the prompt is about, and its one line. */
      tool: string;
      detail: string;
    }
  | { kind: "update"; id: string; since: string; held: HeldMajor; installed: string }
  | {
      kind: "doctor";
      id: string;
      since: string;
      section: string;
      text: string;
      /** doctor's own `Fix:` line; null when it has none. */
      fix: null | string;
    }
  | {
      kind: "breaker";
      id: string;
      since: string;
      /** The slot's key. */
      slot: string;
      /** `heldNow` is null when the answer does not say how many wait right now. */
      breaker: Omit<OpenBreaker, "heldNow"> & { heldNow: null | number };
      /** The command that gives the slot another target. */
      command: string;
    };

export interface NeedsData {
  items: NeedsItem[];
}

// ── A crew session's page (D52; planned: `GET /api/crew/<id>`) ────────────────────────

/** The hand-back report, as the server sends it (`src/crew/store.ts` › `HandBackReport`). */
export type HandBackReport = CrewReport;

/** Lines and files: a change, as `src/workflow/review-cover.ts` › `Cover` counts it. */
export interface ChangeCount {
  lines: number;
  files: number;
}

/**
 * The merge guard's verdict on the branch (D17b, `workflow merge-check`): allowed, refused with
 * its reason, or not known (`unread`: the guard could not read it; `late`: the pull request
 * merged before it was judged), with the counts against the limit (`FixLimits`).
 */
export interface MergeCheck {
  kind: "allowed" | "refused" | "unread" | "late";
  allowed: boolean;
  /** The pull request the verdict is about; null when it does not name one. */
  pr: null | number;
  /** In words, the counts and the limit; null when it is allowed with nothing to say. */
  reason: null | string;
  /** The commit the last review covered; null when no review is recorded. */
  review: null | string;
  /** The change since that review. */
  delta: null | ChangeCount;
  /** The change that review covered. */
  reviewed: null | ChangeCount;
  /** Null when the verdict does not say. */
  limits: null | { lines: number; files: number; percent: number };
  /** What may still change after the review and stay covered (the gate's own count); null when it does not say. */
  allowance: null | { lines: number; files: number };
}

/** One file of the diff against the base; `added` and `removed` are null for a binary file. */
export interface DiffFile {
  path: string;
  added: null | number;
  removed: null | number;
}

/** One review recorded for the branch (`src/workflow/reviews.ts`): when, by whom, at which commit. */
export type CrewReviewRecord = CrewReview;

export interface CrewDetail {
  record: CrewRecord;
  lead: LeadRecord;
  /** The brief, as Markdown: the page renders it as React elements, never as raw HTML. */
  brief: string;
  /** Its events, oldest first (`src/crew/store.ts` › `CrewEvent`). */
  events: CrewEvent[];
  questions: CrewQuestion[];
  report: null | HandBackReport;
  diff: DiffFile[];
  /** The branch against its base, in totals; `error` says why git could not give them. */
  diffTotals: null | { deletions: number; error: null | string; files: number; insertions: number };
  mergeCheck: null | MergeCheck;
  /** Its memory over time, oldest first; empty when nothing was measured. */
  memory: { at: number; mb: number }[];
  /** The reviews recorded for its branch, oldest first. */
  reviews: CrewReviewRecord[];
}

// ── Guard log (D52; planned: `GET /api/guard-asks?…`) ─────────────────────────────────

/** `src/hooks/ask-log.ts` › `GuardAsk`: one line of `guard-asks.jsonl`, already masked. */
export interface GuardAsk {
  at: number;
  hook: string;
  session: string;
  tool: string;
  reason: string;
}

export interface GuardQuery {
  range: HistoryRange;
  guard?: string;
  session?: string;
  /** The server's cursor of the page to read; null for the newest page. */
  cursor: null | string;
}

/**
 * One page of the guard log, newest first, cut by the server, and the asks per guard over the
 * whole range (not the page).
 */
export interface GuardAsksPage {
  rows: GuardAsk[];
  /** The cursor of the next (older) page; null on the last one. */
  next: null | string;
  /** Asks the filters kept across the whole range. */
  kept: number;
  /** Every guard and every session the range holds, for the filters. */
  guards: string[];
  sessions: string[];
  buckets: { bucketMs: number; series: { key: string; points: { t: number; count: number }[] }[] };
}

// ── Worktrees and updates (D52; planned: `GET /api/worktrees`, `GET /api/update`) ─────

/** One worktree of one project, with its verdict (`src/worktrees/verdict.ts` › `Verdict`). */
export interface WorktreeRow {
  project: string;
  path: string;
  branch: null | string;
  /** Null until the server sends how long it was idle. */
  idleMinutes: null | number;
  verdict:
    | { finished: true; note: null | string }
    | { finished: false; held: boolean; why: string };
}

/** One worktree auto-clean removed, and why it counted as finished. */
export interface CleanedWorktree {
  branch: null | string;
  name: string;
  path: string;
  why: string;
}

export interface WorktreesData {
  rows: WorktreeRow[];
  /** Auto-clean's last run in this project: when, against which base, and what it removed. */
  autoClean: null | { lastRunAt: string; base: string; removed: CleanedWorktree[] };
}

/** `src/update/state.ts` › `LastCheck`. */
export interface LastCheck {
  at: string;
  result: string;
  detail: string;
}

export interface UpdateData {
  installed: string;
  /** The newest version the marketplace has; null when it could not be read. */
  newest: null | string;
  held: null | HeldMajor;
  /** True while the person holds self-updates (`switches.updateHold`). */
  hold: boolean;
  lastCheck: null | LastCheck;
}
