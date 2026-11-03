import type {
  BackendRow,
  BunFacts,
  ClaudeCodeFacts,
  ClaudeMemCurrent,
  ClaudeMemFacts,
  ClaudeMemSource,
  HistoryAnswer,
  HistoryRequest,
  JobCeilingState,
  JobRouteState,
  JobWeightsState,
  MachineAnswer,
  McpServerRow,
  MergeVerdict,
  ModelRow,
  OpenBreaker,
  PortHolder,
  ProjectGatewayAnswer,
  ProjectGatewayNote,
  ProjectGatewayStateName,
  ProjectInitPlan,
  ProjectProfileSlot,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksAnswer,
  ProjectWorkTasks,
  RequestsAnswer,
  RouterFacts,
  SessionSummary,
  SlotRow,
  SlotsAnswer,
  SlotTarget,
  SwitchFacts,
  HistoryPoint as WireHistoryPoint,
  WorkTaskBlocker,
  WorkTaskLayer,
  WorkTaskNode,
  WorkTaskType,
} from "./wire";

export type {
  BackendRow,
  BunFacts,
  ClaudeCodeFacts,
  ClaudeMemCurrent,
  ClaudeMemFacts,
  ClaudeMemSource,
  JobCeilingState,
  JobRouteState,
  JobWeightsState,
  McpServerRow,
  ModelRow,
  OpenBreaker,
  PortHolder,
  ProjectGatewayNote,
  ProjectGatewayStateName,
  ProjectInitPlan,
  ProjectProfileSlot,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectWorkTasks,
  RouterFacts,
  SlotRow,
  SlotTarget,
  SwitchFacts,
  WorkTaskBlocker,
  WorkTaskLayer,
  WorkTaskNode,
  WorkTaskType,
};

/** One project's tasks (D75): its work tree and its task files, as the server answers them. */
export type ProjectTasksData = ProjectTasksAnswer;

/** One project on the Tasks tab: its row, as the project list draws it, and its tasks. */
export interface TasksProjectData {
  project: ProjectListRow;
  tasks: ProjectTasksData;
}

/** `GET /api/tasks` (D76): the Tasks tab, every project in the list's order, and its note. */
export interface TasksData {
  note: null | string;
  projects: TasksProjectData[];
}

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

// ── Overview ───────────────────────────────────────────────────────────────────────────

/**
 * The plan's 5-hour window, as Claude Code's status line last recorded it
 * (`src/cli/usage-window.ts`): the share used, and when it resets (ms; null when no time was
 * named). The 7-day windows are recorded nowhere, so no page has a number for them.
 */
export interface PlanWindow {
  percent: number;
  resetsAt: null | number;
}

export interface OverviewData {
  health: RouterHealth;
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  /** Null with no reading, or one from a window that is over. */
  fiveHour: null | PlanWindow;
  /** The gateway's three switches, as the Slots page reads them too. */
  switches: SwitchFacts;

  /** The heavy-job queue in one line: this machine's slots in use of its total, and jobs waiting. */
  jobs: { slots: number; used: number; waiting: number };
  /** The history's model requests: the rate, and the count since the router started (F4, F5). */
  requests: OverviewRequests;
}

/** `src/portal/views.ts` › `OverviewRequests`. */
export interface OverviewRequests {
  perMinute: null | number;
  sinceRouterStart: null | number;
}

export interface OtherSession {
  sessionId: string;
  name: null | string;
  project: string;
  branch: null | string;
  /** The model of its last reply; null when its file's tail holds none. */
  model: null | string;
  /**
   * `waiting`: a permission prompt of it is open; `working`: it wrote in the last two minutes;
   * `ended`: Claude Code closed it; `idle`: between turns, or stopped hard.
   */
  state: SessionSummary["state"];
  /** ISO 8601: when it last wrote. */
  lastAt: string;
}

export interface WorkData {
  /**
   * A quiet line about this portal's own folder (it is no git project, the portal's normal
   * start), shown muted: the other sessions of a project are not listed; null when it is one.
   */
  folderNote: null | string;

  note: null | string;
  others: OtherSession[];
  /** Why no session can say it waits on a prompt (the flow report did not run); null when it ran. */
  waitsNote: null | string;
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
   * The window over time, from the report's own hours (`FlowReport.hours`): launches and the
   * time blocked on prompts per bucket, an hour for 24 hours and six for 7 days.
   */
  buckets: { bucketMs: number; points: { t: number; launches: number; blockedMs: number }[] };
}

export type FlowWindow = "24h" | "7d";

// ── Health ─────────────────────────────────────────────────────────────────────────────

export interface HealthData {
  router: RouterFacts;
  /**
   * What holds the router's port across restarts (systemd's socket unit, or the Windows task),
   * in doctor's words; null where this machine runs no service for it.
   */
  socket: null | PortHolder;
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
  /** doctor's own `Fix:` line for a failure; null for any other line. */
  fix: null | string;
}

/**
 * The project's auto-mode trust rules, as `setup`'s own `+` / `-` dry run makes them; null outside
 * a project, or when it has none. The write sends back `hash`, and refuses any other change.
 */
export type AutoModeChange = MachineAnswer["autoMode"];

export interface MachineData {
  facts: PortalFacts;
  autoMode: AutoModeChange;
  /** Claude Code's version (or why it is not known), and the last `doctor --live` proof. */
  claudeCode: ClaudeCodeFacts;
  /** claude-mem's route, key and fallback, and where each came from (never the key). */
  claudeMem: ClaudeMemFacts;
  /** The Bun the portal runs on, against the kit's minimum. */
  bun: BunFacts;
  companions: CompanionRow[];
  mcp: McpServerRow[];
  browser: BrowserCardData;
  omniroute: OmnirouteRow;
  /** The gateway's own OmniRoute key, in a word: never the key (PK1). */
  gatewayKey: MachineAnswer["gatewayKey"];
  warp: WarpRow;
  doctor: DoctorLine[];
  /** When the doctor pass these lines came from ran (ms); null before the first. */
  doctorAt: null | number;
}

// ── Settings ───────────────────────────────────────────────────────────────────────────

/** `src/workflow/resolve.ts` › `WorkflowSource`. */
export type WorkflowSource = "project" | "personal" | "default";

/** `src/portal/settings.ts` › `SettingKind`. */
export type SettingKind = "boolean" | "events" | "number" | "segment";

/** `src/portal/settings.ts` › `SettingsRow` (`SettingSpec` with its value and source). */
export interface SettingsRow {
  card: "alerts" | "flow" | "switches";
  /** A number row's unit, shown after its box; absent for a plain count. */
  unit?: "%";
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

/** What a `gh` on this machine can do now (`src/workflow/propose.ts` › `ghLoginState`). */
export type GhLoginState = "in" | "missing" | "out";

/** One setting of a project that has no row of its own: shown with its value, changed elsewhere. */
export interface ProjectWorkflowValue {
  key: string;
  source: WorkflowSource;
  /** What `workflow show` prints for an unset value, when the server sent it (`unsetWords`). */
  unsetWords?: string;
  value: unknown;
}

/**
 * A project's Workflow card (D57): `/api/projects/<id>/workflow`, its settings drawn as
 * Settings → This machine draws them (each row's words and control from `/api/settings`).
 */
export interface ProjectWorkflowData {
  /** The branch a change's pull request goes into; null when the project names none. */
  base: null | string;
  gh: GhLoginState;
  /** Why the settings could not be read; null when they were. */
  note: null | string;
  /** The settings with a row of their own, in the rows' order; read-only without a gh login. */
  rows: SettingsRow[];
  /** The settings with no row of their own, in the answer's order: their value only. */
  others: ProjectWorkflowValue[];
}

/**
 * A project's Gateway card (GP4b): `/api/projects/<id>/gateway` as the server sends it — the
 * project's own choice and what its sessions get, in the command line's words, the files read,
 * the notes, and the profile its address names with its chains over the machine's.
 */
export type ProjectGatewayData = ProjectGatewayAnswer;

/** `src/portal/facts.ts` › `SettingsData`. */
export interface SettingsData {
  autoMerge: null | { allowed: boolean; base: null | string };
  error: null | string;
  projectNote: null | string;
  rows: SettingsRow[];
}

/**
 * One git project on this machine: a repository from Claude Code's session records, or a
 * folder the person added (`project.add`). A worktree is folded into its repository.
 */
export interface ProjectListRow {
  /** The server's short id for it: the page's address and the `project.*` actions name it. */
  id: string;
  name: string;
  /** The main checkout's root folder. */
  path: string;
  /** `.claude/cc-smart-dev-kit.json` is there. */
  setUp: boolean;
  /** True: the project files are not committed on HEAD yet; null when git could not tell. */
  uncommitted: boolean | null;
  /** ISO 8601: the newest session in it or its worktrees; null when it has none. */
  lastUsed: null | string;
  /** Its linked worktrees, the main checkout not counted; null when git could not list them. */
  worktrees: null | number;
  /** Where the row came from: the session records, or the person's "Add a folder". */
  source: "added" | "sessions";
  /** True: the portal was started in this project. */
  current: boolean;
}

/** The Projects tab: every project, newest use first, and why the list is short (or null). */
export interface ProjectList {
  rows: ProjectListRow[];
  note: null | string;
}

/** `src/project/init.ts` › `ProjectInitAnswers` (the form's fields). */
export interface ProjectInitAnswers {
  base: string;
  bases: Record<string, string>;
  protectedBranches: string[];
  guards: { guardMainFolder: boolean; sessionNames: boolean; jobRoute: boolean };
}

/** The merge guard's verdict on one branch, in the page's words (from `MergeVerdict`). */
export interface BranchVerdict {
  /** The command's own kind: `allowed`, `refused`, `silent`, `unread` or `late`. */
  kind: MergeVerdict["kind"];
  /** `ok`: it would merge by itself; `warn`: it is refused or ran late; `info`: no verdict. */
  tone: "info" | "ok" | "warn";
  /** The short word the table shows. */
  label: string;
  /** Why, in the guard's own words; null when it said nothing. */
  reason: null | string;
}

export interface ProjectBranchRow {
  branch: string;
  /** The branch it would merge into; null when it is not known. */
  base: null | string;
  draft: boolean;
  kind: "pr";

  number: null | number;
  title: null | string;
  verdict: BranchVerdict;
}

/**
 * The set-up card's data. The page previews again before it writes (`project.preview`), so
 * the plan and its hash come from that answer, never from a page read a while ago.
 */
export interface ProjectSetup {
  /** Why the project cannot be read at all; null when it can. */
  error: null | string;
  /** The answers the preview sends: the project's own file, or the command line's defaults. */
  answers: ProjectInitAnswers | null;
  /** Why the plan could not be made when the page was read; null when it could. */
  planError: null | string;
}

/** A project's page: its row, its own settings, its branches' verdicts and its set-up card. */
export interface ProjectData {
  project: ProjectListRow;
  /** The project's own answers when it is set up; null when it is not. */
  answers: ProjectInitAnswers | null;
  setup: ProjectSetup;
  branches: ProjectBranchRow[];
  /** Why the branches could not all be read; null when they were. */
  branchesNote: null | string;
  /** ISO 8601: when the verdicts were read (the server keeps them about a minute). */
  checkedAt: string;
}

// ── The heavy-job queue (planned: `GET /api/jobs` and the `jobs` event) ───────────────

/** One job in a store: held (it runs) or waiting. `since` is ms since the epoch (`src/jobs/queue.ts`). */
export interface JobEntry {
  kind: string;
  command: string;
  folder: string;
  user: string;
  /** Null for a record the queue could not read. */
  since: null | number;
  pid: number;
  /** Which slots it holds or waits for: a heavy one, a light one, or none (a name only, `--exclusive`). */
  lane: "heavy" | "light" | "none";
}

/** One store of slots the queue shares out: the machine, or a container (`where`). */
export interface JobStore {
  where: "machine" | (string & {});
  /** How many heavy jobs run at once here. */
  slots: number;
  /** How many of those slots are in use now. */
  used: number;
  held: (JobEntry & { exclusive?: boolean })[];
  waiting: JobEntry[];
  note?: string;
}

/** `GET /api/jobs`, and the `jobs` event's data: the same shape. */
export interface JobsData {
  /** The memory ceiling of all heavy jobs together: its size, or why none is in force. */
  ceiling: JobCeilingState;
  memoryGb: number;
  /**
   * Whether heavy Bash commands go through the queue, and where that comes from: the project's
   * `jobs.route`, the person's `switches.jobRoute`, or the default (off). The portal runs in no
   * project, so this is what a project that sets none gets.
   */
  route: JobRouteState;
  stores: JobStore[];
  /** The weights a heavy job runs with (off by default), or why one is not set. */
  weights: JobWeightsState;
}

// ── Needs you (owner decision D52; planned: `GET /api/needs`) ─────────────────────────

/** `src/update/state.ts` › `HeldMajor`: a major version found and held for the person (D33). */
export interface HeldMajor {
  version: string;
  from: null | string;
  at: string;
  notes: string[];
}

/** One thing that waits for the person. `since` is ISO 8601. */
export type NeedsItem =
  | {
      kind: "permission";
      id: string;
      since: string;
      /** Who asked (a guard, or Claude Code), the session, and the project it is in. */
      asker: string;
      session: string;
      project: string;
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
  /** Why the permission prompts are missing from the list (the flow report did not run); null when they are not. */
  note: null | string;
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
  /** Null when how long it was idle is not known. */
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
