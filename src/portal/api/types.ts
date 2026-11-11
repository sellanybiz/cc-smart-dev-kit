import type { Check as DoctorCheck } from "../../cli/doctor";
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
import type {
  ClaudeMemCurrent,
  ClaudeMemFacts,
  ClaudeMemSource,
} from "../../machine/claude-mem-choices";
import type { FinishedSession } from "../../sessions/finished";
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
  DoctorCheck,
  FallbackRecord,
  FallbackRow,
  FinishedSession,
  FlowReport,
  GuardAsk,
  HistoryKeys,
  JobsAnswer,
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
  jobs: { slots: number; used: number; waiting: number };
}

/** `GET /api/slots`: the Slots page, its switches and each backend target's optional effort pin. */
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

  kind: "pr";

  number: null | number;
  title: null | string;
  /** `workflow merge-check`'s verdict, from its one home. */
  verdict: MergeVerdict;
}

/** `GET /api/projects/<id>`: one project's page (B8). An unknown id: 404. */
export interface ProjectAnswer {
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

  unsetWords?: string;
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

/** What a project's gateway address means (`GatewayStateName`, `src/gateway/project-state.ts`). */
export type ProjectGatewayStateName = "default" | "off" | "on" | "other" | "unknown";

/** Which settings file a project's gateway state comes from; `none` when no file sets it. */
export type ProjectGatewaySource = "machine" | "none" | "personal" | "team";

/**
 * One stretch of a project's settings chain, decided (`GatewayDecision`), in the command line's
 * own words: `gateway project status` prints the same two lines. No raw address: one that is
 * neither Anthropic's nor the router's is masked in `words` (`shownValue`), as the command
 * prints it.
 */
export interface ProjectGatewayDecision {
  /** The file that decides, in words (`projectSourceWords`): "nothing in this project" for none. */
  from: string;
  /** The profile a router address names; null when it names none. */
  profile: null | string;
  source: ProjectGatewaySource;
  state: ProjectGatewayStateName;
  /** The decision in words (`decisionWords`). */
  words: string;
}

/** One settings file the reader looked at, in the order Claude Code applies them. */
export interface ProjectGatewayFile {
  /** What it holds, in words: "sets nothing", the decision it makes, or why it cannot be read. */
  holds: string;
  kind: "machine" | "personal" | "team";
  /** Its path, with the home folder as `~`. */
  path: string;
  /** True when it cannot be read: the chain stops there as `unknown`. */
  problem: boolean;
}

/** One slot of a project's profile, over the machine's chain (`profileSlotChain`). */
export interface ProjectProfileSlot {
  /** The slot's fallback switch in this profile (`fallbackOn` of the profile's view). */
  fallback: boolean;
  key: string;
  /** The machine's chain in use for the slot; null while Claude answers it on the machine. */
  machine: null | string[];
  /** The slot's short name (`scout`), as the Slots page names it. */
  name: string;
  /**
   * The profile's own entry: its chain, `"claude"` (plain Claude in this profile whatever the
   * machine has), or null when it names none (the machine's chain applies).
   */
  own: "claude" | null | string[];
}

/** The profile a project's address names, with its chains slot by slot over the machine's. */
export interface ProjectProfile {
  /** False when the config holds no such profile: the router answers its requests as plain Claude. */
  exists: boolean;
  name: string;
  /** Every slot the Slots page lists, in its order, then any other slot the profile names. */
  slots: ProjectProfileSlot[];
}

/** One file's three states: null where the command would write, else its refusal in its words. */
export interface ProjectGatewayWrites {
  default: null | string;
  off: null | string;
  on: null | string;
}

/**
 * What `gateway project <state> [--team]` would refuse before it writes, from its own planner
 * (`planProjectChange`) over the same state: the card offers only what the command takes. A
 * router that does not answer, and a profile, are checked when it runs.
 */
export interface ProjectGatewayRefusals {
  personal: ProjectGatewayWrites;
  team: ProjectGatewayWrites;
}

/** A line the Gateway card shows beside the state: a fact, a warning, or a fault. */
export interface ProjectGatewayNote {
  text: string;
  tone: "bad" | "info" | "warn";
}

/**
 * `GET /api/projects/<id>/gateway` (GP4b): the project's own gateway state and what a session
 * started in its folder effectively gets, from the one reader (`projectGatewayStateAsync`), with
 * the profile the address names and its chains over the machine's. A change is
 * `project.gateway.set` or `project.gateway.profile`, each the CLI's own command in a child.
 */
export interface ProjectGatewayAnswer {
  /** What the project's own files choose: its personal file, then its team file. */
  choice: ProjectGatewayDecision;
  /** True when this machine's gateway config is there and readable: `on` needs it. */
  configured: boolean;
  /** What a session started in the project's folder gets, the machine's settings counted. */
  effective: ProjectGatewayDecision;
  /** Every settings file read, in the chain's order. */
  files: ProjectGatewayFile[];
  /** The facts and the faults, in words. */
  notes: ProjectGatewayNote[];
  /**
   * True when git tracks the personal file, so what is written there is committed with the
   * project; null when git could not tell (or there is no checkout).
   */
  personalTracked: boolean | null;
  /** What the command would refuse, per file and state, before it writes anything. */
  refusals: ProjectGatewayRefusals;
  /** The profile the effective address names; null when it names none. */
  profile: null | ProjectProfile;
  /** The profiles the config holds, sorted. */
  profiles: string[];
  /** Whether the project is in a git checkout: without one there is no personal file to write. */
  writable: boolean;
}

/** A work task's status in the kit's store (`src/tasks/work/types.ts` › `WorkStatus`). */
export type WorkTaskStatus = "done" | "dropped" | "in_progress" | "pending";

/** Where a task sits (D76): Plan › Phase › Task › Subtask (`src/tasks/work/types.ts` › `WorkLayer`). */
export type WorkTaskLayer = "phase" | "plan" | "task";

/** Blocking holds its parent while open; non-blocking holds nothing (D76, `WorkType`). */
export type WorkTaskType = "blocking" | "non-blocking";

/** One task another waits for: its number, its subject and its state now, closed ones too. */
export interface WorkTaskBlocker {
  ref: string;
  status: WorkTaskStatus;
  subject: string;
}

/** A phase's steps (`phase-steps.ts`): its blocking work done, of its blocking work. */
export interface WorkTaskSteps {
  done: number;
  total: number;
}

/** One work task in the Tasks tab's tree (`src/tasks/work/tree.ts` › `TaskTreeNode`). */
export interface WorkTaskNode {
  session: null | string;
  parentId: null | string;
  claim: "live" | "dead" | "none";
  notes: number;
  events: number;
  /** The subagent that works on it (its id or name), as the main session set it; null when none. */
  agent: null | string;
  /** The commit its work started from; null when none was set. */
  base: null | string;
  /** Open, and one of `blockedBy` is still open: it cannot start or be done yet. */
  blocked: boolean;
  /** The tasks it waits for, in number order, closed ones too. */
  blockedBy: WorkTaskBlocker[];
  /** The branch its work is on; null when none was set. */
  branch: null | string;
  children: WorkTaskNode[];
  /** Its whole subtree: how many tasks are closed (done or dropped), of how many. */
  closed: number;
  id: string;

  kind: "phase" | "plan" | "task";
  /** Its kind is its layer; legacy nested tasks still read as tasks. */
  layer: WorkTaskLayer;
  phase: null | string;
  plan: null | string;
  /** `#12`: the project's own number for it. */
  ref: string;
  status: WorkTaskStatus;
  /** A phase's steps; null for a plan or a task, and for a phase the store could not count. */
  steps: null | WorkTaskSteps;
  subject: string;
  total: number;
  type: WorkTaskType;
  /** When it last changed (ISO 8601). */
  updatedAt: string;
  /** The worktree its work is in (an absolute path); null when none was set. */
  worktree: null | string;
}

/** One open project task file (`src/tasks/project/format.ts`), as the Tasks tab lists it. */
export interface ProjectTaskRow {
  /** When it was written (`YYYY-MM-DD`). */
  created: string;
  /** Its file, relative to the main checkout. */
  file: string;
  /** What a person must take care with: `needs-yes`, `twice-safe`, `spends-money`, … */
  flags: string[];
  /** `T-` and six letters or digits. */
  id: string;
  kind: "database" | "follow-up" | "production" | "teammate";
  /** Open past the project's `tasks.staleDays`. */
  stale: boolean;
  title: string;
  weight: "after-deploy" | "blocks-release" | "owner" | null;
  when: "any" | "next-release" | "now" | null;
}

/** The kit's work store for one project: its tasks as a tree, or why there are none to show. */
export type ProjectWorkTasks =
  | {
      /** Tasks left out past the answer's cap. */
      more: number;
      /** A closed task stays in the tree this many days after its last change. */
      recentDays: number;
      state: "ready";
      tasks: WorkTaskNode[];
    }
  | { state: "none" }
  | { state: "unreadable"; why: string };

/** The project's task files in its main checkout, or why they cannot be read. */
export type ProjectTaskFiles =
  | {
      /** Files that do not read as a task: `task check` names each one. */
      broken: number;
      /** Closed tasks in `archive/`. */
      closed: number;
      /** The task folder, relative to the main checkout. */
      dir: string;
      /** The project's `tasks.staleDays`. */
      staleDays: number;
      state: "ready";
      /** The open ones: what blocks a release first, then by when, then the oldest. */
      tasks: ProjectTaskRow[];
    }
  | { state: "unavailable"; why: string };

/**
 * `GET /api/projects/<id>/tasks` (D75): one project's tasks, as the Tasks tab and its project
 * page draw them. The kit's work store for the project (every worktree shares one list) and the
 * project's own task files in its main checkout. Read-only: a task changes through the task
 * tools or `cc-smart-dev-kit task`.
 */
export interface ProjectTasksAnswer {
  files: ProjectTaskFiles;
  work: ProjectWorkTasks;
}

/** One project on the Tasks tab: the project as the list names it, and its tasks. */
export interface TasksProject {
  project: ProjectSummary;
  tasks: ProjectTasksAnswer;
}

/**
 * `GET /api/tasks` (D76): the Tasks tab. Every project of `/api/projects`, in its order (newest
 * use first), each with the answer `projects/<id>/tasks` gives, and the list's own note.
 */
export interface TasksAnswer {
  /** Why the list is short or empty; null otherwise. */
  note: null | string;
  projects: TasksProject[];
}

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

export interface WorkAnswer {
  /** Finished unowned background sessions, from the sessions command's shared reader. Never removed automatically. */
  finishedSessions: FinishedSession[];
  /** Unknown agent view or broken ownership records: no candidate is offered. */
  finishedSessionsError: string | null;

  /**
   * A quiet line about this portal's own folder, shown muted: it is not in a git project (the
   * portal's normal start), so the other sessions of a project are not listed; null when the
   * folder is one.
   */
  folderNote: null | string;

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

/** The merge check's verdict, in the command's own kinds (`workflow merge-check`). */
export type MergeVerdict =
  | { detail: MergeDetail | null; kind: "allowed"; reason: string }
  | { detail: MergeDetail | null; kind: "refused"; number: null | number; reason: string }
  | { kind: "silent" }
  | { kind: "unread"; number: null | number; what: string }
  | { kind: "late"; number: null | number; what: string };

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
 * Auto mode's safety checks, which the request history leaves out on purpose (`docs/gateway.md`
 * § The safety-check counts). The router counts them by local day in `safety-checks.json`, read
 * through the same reader the CLI's `usage` prints (`safety-checks-read.ts`, F6).
 */
export interface SafetyChecks {
  /** Every check of the local days the range covers. Null when the file is not there. */
  checks: null | number;
  /**
   * Those days: how many the window covers that the file still holds (it keeps
   * `SAFETY_CHECK_DAYS`), so a longer range says how far back the count reaches.
   */
  days: number;
}

/**
 * `GET /api/history?range=…&by=…&…`: requests over time, one series per key (D51, phase H1).
 * A bucket is `HistoryPoint` from the reader, and every bucket of the window is there.
 *
 * `safetyChecks` travels here because this is the one answer that already knows the range the
 * Usage page asks with, and the checks are counted by local day over exactly that window (F6).
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
  safetyChecks: SafetyChecks;
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
  doctor: null | { at: number; checks: DoctorCheck[] };
  "guard-ask": GuardAsk;
  hello: { at: number; boot: string };
  jobs: ApiError | JobsAnswer;
  ping: { at: number };
  recent: RecentEntry;
  reset: { boot: string };
  state: LiveState;
  /** The kit's work store changed (`src/portal/live/sources.ts`): read the tasks again. */
  tasks: { at: number };
  update: { last: LastCheck | null };
}

/** An event's name. */
export type LiveEventName = keyof LiveEvents;

/** What publishes to the stream: an event's name and exactly its data. */
export type LivePublish = <K extends LiveEventName>(event: K, data: LiveEvents[K]) => void;

/** GET /api/tasks/<id>: the complete stored task and its notes and history. */
export interface TaskDetailAnswer {
  task: import("../../tasks/work/types").WorkTask;
  notes: import("../../tasks/work/types").WorkNote[];
  events: import("../../tasks/work/types").WorkEvent[];
}
