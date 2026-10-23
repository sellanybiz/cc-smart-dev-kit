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
 * (`.claude/rules/portal.md` § The door is never relaxed).
 */

import type { Check as DoctorCheck } from "../../cli/doctor";
import type { DiffFile } from "../../crew/diff";
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
import type { JobsAnswer, JobWeightState, JobWeightsState } from "../../jobs/status";
import type {
  ClaudeMemCurrent,
  ClaudeMemFacts,
  ClaudeMemSource,
} from "../../machine/claude-mem-choices";
import type { FlowReport } from "../../sessions/flow";
import type { LastCheck } from "../../update/state";
import type { MergeDetail } from "../../workflow/merge-check";
import type { WorkflowSource } from "../../workflow/resolve";
import type { ActionName, ActionResult } from "../actions";
import type {
  BackendRow,
  BunFacts,
  ClaudeCodeFacts,
  FallbackRow,
  LimitRow,
  LogLine,
  McpServerRow,
  ModelRow,
  OpenBreaker,
  PlanWindow,
  PortalFacts,
  PortHolder,
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
  BunFacts,
  ClaudeCodeFacts,
  ClaudeMemCurrent,
  ClaudeMemFacts,
  ClaudeMemSource,
  CrewEvent,
  DiffFile,
  DoctorCheck,
  FallbackRecord,
  FallbackRow,
  FlowReport,
  GuardAsk,
  HistoryKeys,
  JobsAnswer,
  JobWeightState,
  JobWeightsState,
  LastCheck,
  LimitRecord,
  LimitRow,
  LogLine,
  McpServerRow,
  MergeDetail,
  ModelRow,
  OpenBreaker,
  PlanWindow,
  PortalFacts,
  PortHolder,
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
 * queue is `/api/jobs`. `fiveHour` is the plan's 5-hour window as the status line last
 * recorded it (null with no reading, or one from a window that is over).
 */
export interface OverviewAnswer extends NotSetUp, OverviewData {
  fiveHour: null | PlanWindow;
  jobs: { budgetGb: number; heldGb: number; waiting: number };
}

/** `GET /api/slots`: the Slots page, with the switches the page draws. */
export interface SlotsAnswer extends NotSetUp, SlotsData {
  switches: SwitchFacts;
}

/**
 * `GET /api/health`: the Health page. `portHolder` is what holds the router's port across
 * restarts, in doctor's words; null where this machine runs no service for it.
 */
export interface HealthAnswer extends NotSetUp, HealthData {
  portHolder: null | PortHolder;
}

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

/**
 * `GET /api/machine`: the Machine page. Needs no gateway config. Beside the server-rendered
 * page's facts: Claude Code's version and live proof, the Bun the portal runs on, the MCP
 * servers setup registers (`mcp status`'s own reader), and claude-mem's route, key and
 * fallback (PM1, never the key itself).
 */
export interface MachineAnswer extends MachineData {
  bun: BunFacts;
  claudeCode: ClaudeCodeFacts;
  claudeMem: ClaudeMemFacts;
  /**
   * The gateway's own OmniRoute key, as the OmniRoute card's key field shows it (PK1): `set`,
   * `none` (a config with no OmniRoute key), `not-set-up` (no gateway config at all), or
   * `unreadable` (a config that cannot be read; `configError` says why). Never the key.
   */
  gatewayKey: "none" | "not-set-up" | "set" | "unreadable";
  mcp: McpServerRow[];
}

/** `GET /api/settings`: the Settings page. Needs no gateway config. */
export interface SettingsAnswer extends SettingsData {}

/** One project, as a row in `/api/projects` (B8). */
export interface ProjectSummary {
  /**
   * The project's id: a short hash of its root. The page and the `project.*` actions name a
   * project by this id, never by a path, and the server looks the id up in its own list.
   */
  id: string;
  configFile: null | string;
  /** The root folder's own name. */
  name: string;
  /** The main checkout's root: a worktree is folded into the repository it belongs to. */
  root: string;
  /** True: `.claude/cc-smart-dev-kit.json` is there. */
  set: boolean;
  /**
   * True: the project files differ from what is committed on HEAD (or are not committed at
   * all), so the merge gate does not read them yet. False: committed. Null: git could not tell.
   */
  uncommitted: boolean | null;
  /** The newest Claude Code session record in it or its worktrees (ISO); null when none. */
  lastUsed: null | string;
  /** Its linked worktrees, the main checkout not counted; null when git could not list them. */
  worktrees: null | number;
  /** Where the row came from: Claude Code's session records, or the person's "Add a folder". */
  source: "added" | "sessions";
  /** True: the folder the portal was started in belongs to it. */
  current: boolean;
}

/** `GET /api/projects`: every project the person works in, newest use first (B8). */
export interface ProjectsAnswer {
  /** The project whose folder the portal was started in: the Machine card's data. */
  current: ProjectCardData;
  /** One row per repository, from the session records and the added folders. */
  projects: ProjectSummary[];
  /** Why the list is short or empty (no session records were found); null otherwise. */
  note: null | string;
}

/** One branch on a project's page, with the merge guard's verdict on it. */
export interface ProjectBranch {
  /** The branch it would merge into; null when it is not known. */
  base: null | string;
  branch: string;
  draft: boolean;
  /** `pr`: an open pull request. `crew`: a crew session's branch with no pull request yet. */
  kind: "crew" | "pr";
  /** The pull request's number; null for a crew branch. */
  number: null | number;
  title: null | string;
  /** `workflow merge-check`'s verdict, from its one home. */
  verdict: MergeVerdict;
}

/** `GET /api/projects/<id>`: one project's page (B8). An unknown id: 404. */
export interface ProjectAnswer {
  /** The open pull requests and crew branches, each with its verdict. */
  branches: ProjectBranch[];
  /** Why the branches could not all be read (no `gh`, the time ran out); null when they were. */
  branchesNote: null | string;
  /** The project-init card for this project's root: its settings, or the "Set up" preview. */
  card: ProjectCardData;
  /** When the verdicts were read (ISO); they are kept for about a minute. */
  checkedAt: string;
  project: ProjectSummary;
}

/** One workflow setting of a project: its value now, and where that value comes from. */
export interface ProjectWorkflowSetting {
  /**
   * One of `WORKFLOW_KEYS` (`src/workflow/schema.ts`): every setting `workflow set --project`
   * takes, the four switches included. A page labels it; the server never sends its words.
   */
  key: string;
  source: WorkflowSource;
  /** What the resolver holds for it: a boolean, a number, a string, a list, or null. */
  value: unknown;
}

/** What a `gh` on this machine can do now (`ghLoginState` in `src/workflow/propose.ts`). */
export type GhLoginState = "in" | "missing" | "out";

/**
 * `GET /api/projects/<id>/workflow` (D57): every workflow setting of this project, its value
 * and where it came from — from `resolveWorkflow`/`resolvedValueOf`, the same resolver
 * `workflow show` prints from — plus the base a change's pull request would go into and
 * whether a pull request can be opened right now. A change is `project.workflow.propose`.
 */
export interface ProjectWorkflowAnswer {
  /** The branch a change's pull request goes into (`worktrees.base`); null when it names none. */
  base: null | string;
  /** Whether `gh` can open the pull request: installed and logged in, or why not. */
  gh: GhLoginState;
  /** Why the settings could not be read; null when they were. Never a made-up value. */
  note: null | string;
  /**
   * Every setting the project's file can hold (`isProjectKey`), in the schema's order, with the
   * values of the file committed on the base. Empty when `note` says why.
   */
  settings: ProjectWorkflowSetting[];
}

/** A crew session, as the Work view and a crew page show it. */
export interface CrewSummary {
  base: null | { ref: string; sha: string };
  branch: string;
  createdAt: string;
  effort: string;
  /** The files its brief says it owns (globs). */
  files: string[];
  id: string;
  kind: string;
  /** Its newest event that said something: the step, the report's status, why it failed. */
  lastEvent: null | { at: string; text: string; type: string };
  /** What it said at the end of its last turn; null before the first. */
  lastLine: null | string;
  leadName: string;
  /** The lead session that started it. */
  leadSessionId: string;
  /** Its memory over time, oldest first: its newest `SUMMARY_MEMORY_POINTS` readings. */
  memory: CrewMemoryPoint[];
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
  /** The repository (its main checkout) the record belongs to: the store's own key. */
  repo: string;
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
  /** The phases it waits for, while it is queued. */
  waitsFor: string[];
  worktree: string;
}

/** The lead of one repository, with its crew nested. */
export interface LeadSummary {
  /** The crew sessions it leads, newest first. */
  crew: CrewSummary[];
  createdAt: string;
  cwd: string;
  name: string;
  pausedAgents: string[];
  plan: string;
  /** The repository (its main checkout) the lead belongs to. */
  repo: string;
  sessionId: string;
  tag: string;
  updatedAt: string;
}

/**
 * One Claude Code session that is not a crew session. `state`: `waiting`, a permission prompt
 * of it is open (the flow report's waits); `working`, its file was written in the last
 * `SESSION_WORKING_MS`; `ended`, Claude Code wrote its end marker (a clean close, or `/exit`);
 * `idle`, none of those (it waits for a prompt, or it was stopped hard).
 */
export interface SessionSummary {
  branch: null | string;
  folder: null | string;
  id: string;
  /** When its file was last written (milliseconds since the epoch). */
  lastWrite: number;
  /** The model of its last reply; null when its file's tail holds none. */
  model: null | string;
  name: null | string;
  state: "ended" | "idle" | "waiting" | "working";
}

/** `GET /api/work`: every lead on the machine, its crew nested, and the other sessions. */
export interface WorkAnswer {
  /**
   * Every crew session on the machine, newest first. The crew store is the machine's, so a
   * portal started in any folder shows them all; each summary names its own `repo`.
   */
  crew: CrewSummary[];
  /** Every lead on the machine, newest first; each names its own `repo` and nests its crew. */
  leads: LeadSummary[];
  /**
   * A quiet line about this portal's own folder, shown muted: it is not in a git project (the
   * portal's normal start), so the other sessions of a project are not listed; null when the
   * folder is one.
   */
  folderNote: null | string;
  /** Why the crew store or this folder's sessions could not be read; null when they were. */
  note: null | string;
  /** The repository of the folder the portal runs in; null outside a git project. */
  repo: null | string;
  sessions: SessionSummary[];
  /**
   * Why the open permission prompts could not be read (the flow report did not run); null when
   * they were. A session's state then never says `waiting`.
   */
  waitsError: null | string;
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
  | { detail: MergeDetail | null; kind: "allowed"; reason: string }
  | { detail: MergeDetail | null; kind: "refused"; number: null | number; reason: string }
  | { kind: "silent" }
  | { kind: "unread"; number: null | number; what: string }
  | { kind: "late"; number: null | number; what: string };

/** One memory reading of a crew session's own log (`src/crew/store.ts` › `CrewEvent.memoryMb`). */
export interface CrewMemoryPoint {
  /** When it was read (ISO 8601). */
  at: string;
  /** The memory its session's process held, in MB. */
  mb: number;
}

/** `GET /api/crew/<id>`: one crew session's page (D52). */
export interface CrewAnswer {
  /** Its brief's text; null when the file is gone or was never written. */
  brief: null | string;
  crew: CrewSummary;
  /** Its branch against its base; `error` says why git could not give it. */
  diff: {
    /** Every changed file, from git's own numstat; a binary file has null counts. */
    byFile: DiffFile[];
    deletions: number;
    error: null | string;
    files: number;
    insertions: number;
    outsideBrief: string[];
  };
  /** Its log's newest events last; at most `CREW_PAGE_EVENTS`. */
  events: CrewStepItem[];
  /** Its memory over time, oldest first: each reading its log kept, then the record's now. */
  memory: CrewMemoryPoint[];
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

/** `GET /api/guard-asks`: the guard log, paged, filtered, with its totals for the chart. */
export interface GuardAsksAnswer {
  /** The page, newest first. */
  asks: GuardAskItem[];
  /** The chart's step for the range, from the history's own buckets. */
  bucketMs: number;
  /** Asks per hook per bucket, over the whole filtered range (not just the page). */
  buckets: { at: number; byHook: Record<string, number> }[];
  /** The hooks that asked, with how many times, across the whole log. */
  byHook: Record<string, number>;
  /** Every hook the range holds, for the filter's select. */
  guards: string[];
  /** How many asks the filter kept across the range, and how many lines of the file could not be read. */
  kept: number;
  /** The cursor of the next (older) page; null on the last page. */
  next: null | string;
  /** The range this answer covers, as it was asked for. */
  range: string;
  /** Every session the range holds, for the filter's select. */
  sessions: string[];
  skipped: number;
}

/** Why the person is needed, from the flow report: a permission prompt or a question. */
export interface PermissionWait {
  asker: string;
  /**
   * The full command that opens the waiting session again (`claude attach <id>`), the way
   * `crew end` prints it; null when the session is not a crew session.
   */
  attach: null | string;
  /** Milliseconds since the epoch. */
  at: number;
  /** The crew session that waits, when the session is one; null for any other session. */
  crew: null | { id: string; name: string; shortId: null | string };
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
  /** Requests the breaker held since it opened. */
  held: number;
  /** Requests it holds right now, from the router's live answer; null when the router does not say. */
  heldNow: null | number;
  since: string;
  slot: string;
  targets: { status: null | number; target: string; until: string }[];
}

/** A doctor failure, with the line that fixes it and the report group it belongs to (doctor's own words). */
export interface DoctorFailure {
  /** The command that fixes it, or the one step a person takes; null when the check names none. */
  fix: null | string;
  /** The report group's title (`CHECK_GROUPS`), or null when the check names none. */
  section: null | string;
  text: string;
}

/** `GET /api/needs`: everything that waits on the person (D52). */
export interface NeedsAnswer {
  /** Every breaker open now, by slot. */
  breakers: BreakerNeed[];
  crew: CrewNeed[];
  doctor: { at: null | number; failures: DoctorFailure[] };
  permissions: PermissionWait[];
  /** Why the permission prompts could not be read (the flow report did not run); null when they were. */
  permissionsError: null | string;
  /** A held major update (D33); null when there is none. */
  update: null | { at: string; from: null | string; notes: string[]; version: string };
}

/**
 * `GET /api/worktrees`'s types come from its one builder (`src/worktrees/command.ts`): the
 * CLI's `worktrees --json` prints that answer and the portal reads it in a child
 * (`src/portal/worktrees-read.ts`), so the page and the command can never disagree.
 */
export type { WorktreeAutoClean, WorktreeItem, WorktreesAnswer } from "../../worktrees/command";

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
