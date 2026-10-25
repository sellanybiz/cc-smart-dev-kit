/**
 * The portal server's JSON API, as the page receives it: one mirror of the kit's
 * `src/portal/api/types.ts`, type for type and by the same names.
 *
 * Why a copy and not an import: the server's file imports the kit's own modules (Bun, zod,
 * the gateway), which this Next.js app neither has nor may bundle. So the shapes are written
 * out here, with no import at all, and the kit's test `src/portal/api/wire-mirror.test.ts`
 * fails when the two drift: every type the server exports must be here under its name, and
 * each pair must be assignable both ways (field for field, at every depth). Change the server's
 * shape and this file in the same commit.
 *
 * One value is left `unknown` on purpose: a project's whole `workflow` object inside the
 * Project card's answers, which no page reads field by field. The types that hold it are
 * checked one way only (the server's value fits this one, with the same fields).
 *
 * Pages do not read these types directly: `adapt.ts` turns each answer into the shape its page
 * draws (`types.ts`), in one place.
 */

// ── Small shared shapes ────────────────────────────────────────────────────────────────

/** `NodeJS.Platform`: the platform the portal runs on. */
export type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

/** `src/portal/facts.ts` › `PortalFacts`. */
export interface PortalFacts {
  platform: Platform;
  portalPort: number;
  router: null | { port: number; up: boolean };
  version: string;
}

/** `GET /api/facts`. */
export type FactsAnswer = PortalFacts;

/** A page whose screen needs the gateway, on a machine that has none. */
export interface NotSetUp {
  configured: boolean;
  error: null | string;
}

/** `src/cli/check.ts` › `CheckGroup`: the groups of `doctor`'s report. */
export type CheckGroup =
  | "plugin"
  | "updates"
  | "companions"
  | "mcp"
  | "browser"
  | "alerts"
  | "project"
  | "gateway"
  | "live";

/** `src/cli/check.ts` › `Check`: a line that passed (or a note), or a failure with its fix. */
export type DoctorCheck =
  | { text: string; group?: CheckGroup; ok: true; info?: boolean; warn?: boolean; fix?: string }
  | {
      text: string;
      group?: CheckGroup;
      ok: false;
      info?: undefined;
      warn?: undefined;
      fix: string;
    };

/** `src/update/state.ts` › `LastCheck`. */
export interface LastCheck {
  at: string;
  result: "checking" | "up-to-date" | "updated" | "skipped" | "unreachable" | "failed";
  detail: string;
  since?: string;
}

export interface ApiError {
  error: string;
}

// ── The router ─────────────────────────────────────────────────────────────────────────

/** `src/portal/facts.ts` › `RecentEntry`: one routed request, metadata only. */
export interface RecentEntry {
  at: number;
  ms: number;
  nextTarget: boolean;
  slot: null | string;
  status: number;
  target: string;
}

export interface OpenBreaker {
  held: number;
  heldNow: number;
  since: number;
  targets: { status: null | number; target: string; until: number }[];
}

export interface RouterFacts {
  breakers: Record<string, OpenBreaker>;
  cooling: [string, number][];
  fallbacks: number;
  port: number;
  recent: RecentEntry[];
  requests: number;
  up: boolean;
  uptimeSec: number;
  why: null | string;
}

export interface LogLine {
  level: "ERROR" | "INFO" | "WARN";
  text: string;
  time: string;
}

export interface LimitRow {
  claim: string;
  model: string;
  resets: null | string;
}

export interface FallbackRow {
  slot: string;
  model: string;
  target: string;
  since: string;
}

export interface ModelRow {
  backend: string;
  context: string;
  id: string;
  plan: boolean;
}

export interface BackendRow {
  ms: null | number;
  models: ModelRow[];
  name: string;
  state: "answers" | "failed" | "unlisted";
  url: string;
  why: null | string;
}

export interface SwitchFacts {
  models: boolean;
  gateway: boolean;
  judge: boolean;
  judgeUntested: boolean;
  settingsBaseUrl: null | string;
  warnings: string[];
}

// ── Slots ──────────────────────────────────────────────────────────────────────────────

export interface SlotTarget {
  effort?: string;
  target: string;
  from: string;
  restingFor: null | number;
  tested: boolean;
}

export interface SlotRow {
  breaker: boolean;
  fallback: boolean;
  info: string;
  kept: null | { fallback: boolean; targets: SlotTarget[] };
  key: string;
  kind: string;
  mode: "claude" | "custom";
  name: string;
  note: string;
  role: string;
  stamp: string;
  targets: SlotTarget[];
}

// ── The page answers ───────────────────────────────────────────────────────────────────

/** `src/portal/facts.ts` › `PlanWindow`: one window of the plan's usage, as the status line recorded it. */
export interface PlanWindow {
  percent: number;
  resetsAt: null | string;
}

/** `src/portal/views.ts` › `OverviewRequests`: the history's model requests, not the router's. */
export interface OverviewRequests {
  perMinute: null | number;
  sinceRouterStart: null | number;
}

export interface OverviewAnswer extends NotSetUp {
  backends: BackendRow[];
  dashboardUrl: null | string;
  fallbacks: FallbackRow[];
  fiveHour: null | PlanWindow;
  jobs: { budgetGb: number; heldGb: number; waiting: number };
  limits: LimitRow[];
  limitsRead: boolean;
  requests: OverviewRequests;
  router: RouterFacts;
  slots: SlotRow[];
  switches: SwitchFacts;
  warnings: LogLine[];
}

export interface SlotsAnswer extends NotSetUp {
  backendNotes: string[];
  breakers: Record<string, OpenBreaker>;
  chains: Record<string, string[]>;
  effortLevels: string[];
  fallback: Record<string, boolean>;
  models: ModelRow[];
  slots: SlotRow[];
  switches: SwitchFacts;
  tested: Record<string, string>;
}

/** `src/portal/facts.ts` › `PortHolder`: what holds the router's port, in doctor's words. */
export interface PortHolder {
  check: DoctorCheck;
  kind: "scheduled-task" | "systemd";
  name: string;
  state: "open" | "other" | "start-limit";
}

export interface HealthAnswer extends NotSetUp {
  backends: BackendRow[];
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  log: { lines: LogLine[]; note: null | string };
  portHolder: null | PortHolder;
  router: RouterFacts;
}

export interface MachineUpdate {
  heldSince: null | string;
  installed: null | string;
  last: LastCheck | null;
  newest: null | string;
  summary: string;
}

export interface UpdateAnswer extends MachineUpdate {
  held: null | { at: string; from: null | string; notes: string[]; version: string };
}

export interface CompanionRow {
  command: null | string;
  detail: string;
  id: string;
  state: string;
  enableArgv: null | string[];
  title: string;
}

export interface GlobalInstall {
  kind: "bun" | "npm";
  folder: string;
  manager: string;
  version: string;
}

export interface OmnirouteRow {
  backend: null | string;
  install: GlobalInstall | null;
  newestVersion: null | string;
  previous: null | { at: string; version: string };
  registryError: null | string;
  state: "behind" | "ok" | "unknown";
  unit: null | string;
}

export interface BrowserCardData {
  guide: {
    intro: string;
    notes: string[];
    steps: { detail?: string; done: boolean | null; text: string }[];
  };
  notes: string[];
  state: {
    extensionInstalled: boolean;
    fileUrls: boolean | null;
    profile: boolean;
    profileDirName: string;
    tokenSet: boolean;
  };
}

export interface WarpRow {
  detail: string;
  installed: boolean;
}

/** `src/project/init.ts` › `SettingsFilePlan`. */
export interface SettingsFilePlan {
  file: string;
  text: string;
  changed: boolean;
  adds: string[];
  removes: string[];
  lines: string[];
}

/** `src/project/init.ts` › `ProjectInitPlan`. */
export interface ProjectInitPlan {
  file: string;
  text: string;
  changed: boolean;
  diff: string[];
  settings: SettingsFilePlan;
  localSettings: SettingsFilePlan;
  notes: string[];
}

/** `src/project/init.ts` › `ProjectInitAnswers`; `workflow` is opaque here (see the header). */
export interface ProjectInitAnswers {
  base: string;
  bases: Record<string, string>;
  protectedBranches: string[];
  /** The project's own fast check, when its file has one; the form does not show it. */
  checks?: { fast: string } | null;
  guards: { guardMainFolder: boolean; sessionNames: boolean; jobRoute: boolean };
  workflow: unknown;
}

export interface ProjectCardData {
  answers: ProjectInitAnswers | null;
  error: null | string;
  name: null | string;
  plan: ProjectInitPlan | null;
  planError: null | string;
  filesHash: null | string;
  root: null | string;
  set: boolean;
}

/** `src/portal/facts.ts` › `BunFacts`: the Bun the portal runs on, against the kit's minimum. */
export interface BunFacts {
  minimum: string;
  ok: boolean;
  version: string;
}

/** `src/portal/facts.ts` › `ClaudeCodeFacts`: its version, and the last `doctor --live` proof. */
export interface ClaudeCodeFacts {
  liveCheck: null | { claudeCode: string; passedAt: string; plugin: string };
  version: null | string;
  why: null | string;
}

/** `src/portal/facts.ts` › `McpServerRow`: one of the kit's MCP servers, as `mcp status` reads it. */
export interface McpServerRow {
  name: string;
  runsWhat: null | string;
  state: "foreign" | "missing" | "ours" | "unknown" | "unreadable";
}

/** `src/machine/claude-mem-choices.ts` › `ClaudeMemSource`: who put a claude-mem value there. */
export type ClaudeMemSource = "default" | "hand" | "portal" | "setup";

/** `src/machine/claude-mem-choices.ts` › `ClaudeMemCurrent`: claude-mem's values now. */
export interface ClaudeMemCurrent {
  route: {
    kind: "backend" | "claude" | "other";
    provider: string;
    target: null | string;
    model: null | string;
    address: null | string;
    source: ClaudeMemSource;
    refusedByHand: boolean;
  };
  key: {
    state: "gateway" | "none" | "other";
    pool: boolean;
    source: ClaudeMemSource;
    refusedByHand: boolean;
  };
  fallback: {
    provider: string;
    model: null | string;
    claudeModel: null | string;
    idle: null | string;
    target: null | string;
    source: ClaudeMemSource;
    refusedByHand: boolean;
  };
}

/** `src/machine/claude-mem-choices.ts` › `ClaudeMemFacts`: the claude-mem card. Never the key. */
export interface ClaudeMemFacts {
  file: string;
  version: null | string;
  minVersion: string;
  blocked: null | { fix: null | string; text: string };
  current: null | ClaudeMemCurrent;
  backends: null | string[];
  handKeys: string[];
}

export interface MachineAnswer {
  bun: BunFacts;
  claudeCode: ClaudeCodeFacts;
  claudeMem: ClaudeMemFacts;
  /** The gateway's own OmniRoute key: whether one is set, never the key (PK1). */
  gatewayKey: "none" | "not-set-up" | "set" | "unreadable";
  mcp: McpServerRow[];
  autoMode: null | {
    added: string[];
    differsFrom: null | string;
    from: string;
    hash: string;
    removed: string[];
    settings: string;
  };
  browser: BrowserCardData;
  companions: CompanionRow[];
  configError?: string;
  doctor: { at: number; checks: DoctorCheck[] } | null;
  jobs: null | { error: string; lines: string[] };
  omniroute: OmnirouteRow;
  project: ProjectCardData;
  updates: MachineUpdate;
  warp: WarpRow;
}

// ── Settings ───────────────────────────────────────────────────────────────────────────

/** `src/workflow/schema.ts` › `WorkflowKey`. */
export type WorkflowKey =
  | "autoCommit"
  | "autoPush"
  | "openPr"
  | "autoMerge"
  | "mergeMethod"
  | "deleteBranch"
  | "reviewBeforePush"
  | "reviewAgents"
  | "fixesAfterReview.lines"
  | "fixesAfterReview.files"
  | "fixesAfterReview.percent"
  | "clearWorktreeAfterMerge"
  | "issues.enabled"
  | "issues.allowPublic"
  | "issues.foundLabel"
  | "issues.fixedLabel"
  | "issues.readyLabel"
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | "crew.enabled"
  | "crew.keep"
  | "crew.idleStopMinutes"
  | "crew.max"
  | "crew.maxOpus"
  | "crew.memoryGb"
  | "crew.loadPerCore"
  | "crew.perLead"
  | "crew.perLeadOpus"
  | "crew.usagePercent"
  | "crew.quietMinutes"
  | "crew.handoffPercent"
  | "crew.handoffTokens"
  | "crew.softHours"
  | "crew.maxHours"
  | "crew.archiveDays"
  | "crew.tag"
  | "switches.statusLine"
  | "switches.sessionNames"
  | "switches.jobRoute"
  | "switches.updateHold";

/** `src/portal/settings.ts` › `SettingsRow`. */
export interface SettingsRow {
  card: "alerts" | "crew" | "flow" | "switches";
  unit?: "%";
  choices?: readonly { label: string; value: string }[];
  help: string;
  id: string;
  key: WorkflowKey;
  kind: "boolean" | "events" | "number" | "segment";
  label: string;
  where: "personal" | "project";
  readOnly: boolean;
  source: "project" | "personal" | "default";
  value: unknown;
  why: null | string;
}

export interface SettingsData {
  autoMerge: null | { allowed: boolean; base: null | string };
  error: null | string;
  projectNote: null | string;
  rows: SettingsRow[];
  clashes: { setting: "autoMerge" | "autoPush" | "openPr"; line: string; fix: string }[];
}

export type SettingsAnswer = SettingsData;

export interface ProjectSummary {
  id: string;
  configFile: null | string;
  name: string;
  root: string;
  set: boolean;
  uncommitted: boolean | null;
  lastUsed: null | string;
  worktrees: null | number;
  source: "added" | "sessions";
  current: boolean;
}

export interface ProjectsAnswer {
  current: ProjectCardData;
  projects: ProjectSummary[];
  note: null | string;
}

export interface ProjectBranch {
  base: null | string;
  branch: string;
  draft: boolean;
  kind: "crew" | "pr";
  number: null | number;
  title: null | string;
  verdict: MergeVerdict;
}

export interface ProjectAnswer {
  branches: ProjectBranch[];
  branchesNote: null | string;
  card: ProjectCardData;
  checkedAt: string;
  project: ProjectSummary;
}

/** One workflow setting of a project: its value now, and where that value comes from. */
export interface ProjectWorkflowSetting {
  /** One of `WORKFLOW_KEYS` (`src/workflow/schema.ts`): the page labels it. */
  key: string;
  source: "project" | "personal" | "default";
  /** Only for a null `crew.tag` or `crew.maxOpus`: what `workflow show` prints in its place. */
  unsetWords?: string;
  value: unknown;
}

/** What a `gh` on this machine can do now (`src/workflow/propose.ts` › `ghLoginState`). */
export type GhLoginState = "in" | "missing" | "out";

/** `GET /api/projects/<id>/workflow` (D57): every setting, the base, and gh's state. */
export interface ProjectWorkflowAnswer {
  base: null | string;
  gh: GhLoginState;
  /** Why the settings could not be read; null when they were. */
  note: null | string;
  /** Every setting the project's file can hold, in the schema's order. Empty when `note` says why. */
  settings: ProjectWorkflowSetting[];
}

/** What a project's gateway address means (`src/gateway/project-state.ts`). */
export type ProjectGatewayStateName = "default" | "off" | "on" | "other" | "unknown";

/** Which settings file a project's gateway state comes from; `none` when no file sets it. */
export type ProjectGatewaySource = "machine" | "none" | "personal" | "team";

/** One stretch of the settings chain, decided, in `gateway project status`' own words. */
export interface ProjectGatewayDecision {
  /** The file that decides, in words: "nothing in this project" for none. */
  from: string;
  profile: null | string;
  source: ProjectGatewaySource;
  state: ProjectGatewayStateName;
  /** The decision in words; another gateway's address is masked. */
  words: string;
}

/** One settings file the reader looked at, in the order Claude Code applies them. */
export interface ProjectGatewayFile {
  holds: string;
  kind: "machine" | "personal" | "team";
  /** With the home folder as `~`. */
  path: string;
  problem: boolean;
}

/** One slot of a project's profile, over the machine's chain. */
export interface ProjectProfileSlot {
  fallback: boolean;
  key: string;
  /** The machine's chain in use; null while Claude answers the slot on the machine. */
  machine: null | string[];
  name: string;
  /** The profile's own chain, `"claude"`, or null (the machine's chain applies). */
  own: "claude" | null | string[];
}

/** The profile a project's address names, slot by slot. */
export interface ProjectProfile {
  /** False when the config holds no such profile: its requests answer as plain Claude. */
  exists: boolean;
  name: string;
  slots: ProjectProfileSlot[];
}

/** One file's three states: null where the command would write, else its refusal. */
export interface ProjectGatewayWrites {
  default: null | string;
  off: null | string;
  on: null | string;
}

/** What `gateway project` would refuse before it writes, per file (its own planner). */
export interface ProjectGatewayRefusals {
  personal: ProjectGatewayWrites;
  team: ProjectGatewayWrites;
}

/** A line the Gateway card shows beside the state. */
export interface ProjectGatewayNote {
  text: string;
  tone: "bad" | "info" | "warn";
}

/** `GET /api/projects/<id>/gateway` (GP4b): the project's own state, what its sessions get, its profile. */
export interface ProjectGatewayAnswer {
  choice: ProjectGatewayDecision;
  configured: boolean;
  effective: ProjectGatewayDecision;
  files: ProjectGatewayFile[];
  notes: ProjectGatewayNote[];
  /** True when git tracks the personal file; null when git could not tell. */
  personalTracked: boolean | null;
  /** What the command would refuse, per file and state; null where it writes. */
  refusals: ProjectGatewayRefusals;
  profile: null | ProjectProfile;
  profiles: string[];
  /** Whether the project is in a git checkout. */
  writable: boolean;
}

// ── Work, crew, needs ──────────────────────────────────────────────────────────────────

export interface CrewSummary {
  base: null | { ref: string; sha: string };
  branch: string;
  createdAt: string;
  effort: string;
  files: string[];
  id: string;
  kind: string;
  lastEvent: null | { at: string; text: string; type: string };
  lastLine: null | string;
  leadGone: boolean;
  leadName: string;
  leadSessionId: string;
  memory: CrewMemoryPoint[];
  memoryMb: null | number;
  model: { named: string; resolved: string; slot: null | string; tier: null | string };
  name: string;
  phase: string;
  plan: string;
  pr: null | number;
  question: null | {
    askedAt: string;
    options: string[];
    question: string;
    recommended: null | number;
  };
  repo: string;
  shortId: null | string;
  slug: string;
  state: string;
  stateSince: string;
  updatedAt: string;
  waitingFor: null | {
    kind: string;
    model?: string;
    resetsAt?: null | string;
    since?: string;
    slot?: string;
  };
  waitsFor: string[];
  worktree: string;
}

export interface LeadSummary {
  crew: CrewSummary[];
  createdAt: string;
  cwd: string;
  name: string;
  pausedAgents: string[];
  plan: string;
  repo: string;
  sessionId: string;
  tag: string;
  updatedAt: string;
}

export interface SessionSummary {
  branch: null | string;
  folder: null | string;
  id: string;
  lastWrite: number;
  model: null | string;
  name: null | string;
  state: "ended" | "idle" | "waiting" | "working";
}

export interface FinishedSession {
  id: string;
  sessionId: string;
  name: string;
  folder: string;
  state: "done" | "stopped";
  finishedAt: number;
  ageMs: number;
}

export interface CrewDiscardFacts {
  head: string;
  archiveRef: string;
  token: string;
  unmergedCommits: { count: number | null; subjects: string[] };
  changedFiles: string[];
  ignoredFiles: string[];
  lines: string[];
  question: string;
}

export interface StoppedCrewItem {
  discard: { facts: CrewDiscardFacts | null; error: string | null };
  crew: { id: string; name: string; shortId: null | string; state: string };
  repo: string;
  since: string;
  days: number;
  unmergedCommits: null | number;
  line: string;
}

export interface WorkAnswer {
  finishedSessions: FinishedSession[];
  finishedSessionsError: string | null;
  crew: CrewSummary[];
  leads: LeadSummary[];
  folderNote: null | string;
  note: null | string;
  repo: null | string;
  sessions: SessionSummary[];
  waitsError: null | string;
}

export interface CrewStepItem {
  at: string;
  note: null | string;
  sha: null | string;
  state: string;
  text: null | string;
  type: string;
}

export interface TestRun {
  command: string;
  failed: number;
  ok: boolean;
  passed: number;
  [key: string]: unknown;
}

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

export interface CrewReview {
  at: string;
  by: string[];
  sha: string;
}

export type MergeVerdict =
  | { detail: MergeDetail | null; kind: "allowed"; reason: string }
  | { detail: MergeDetail | null; kind: "refused"; number: null | number; reason: string }
  | { kind: "silent" }
  | { kind: "unread"; number: null | number; what: string }
  | { kind: "late"; number: null | number; what: string };

/** `src/workflow/merge-check.ts` › `MergeDetail`: the review gate's own numbers behind a verdict. */
export interface MergeDetail {
  allowance: null | { files: number; lines: number };
  delta: null | { binary: number; files: number; lines: number };
  limits: null | { files: number; lines: number; percent: number };
  review: null | string;
  reviewed: null | { binary: number; files: number; lines: number };
}

/** `src/crew/diff.ts` › `DiffFile`: one file of the diff; a binary file has null counts. */
export interface DiffFile {
  added: null | number;
  deleted: null | number;
  path: string;
}

/** `src/portal/api/types.ts` › `CrewMemoryPoint`: one memory reading of a crew session. */
export interface CrewMemoryPoint {
  at: string;
  mb: number;
}

export interface CrewAnswer {
  brief: null | string;
  crew: CrewSummary;
  diff: {
    byFile: DiffFile[];
    deletions: number;
    error: null | string;
    files: number;
    insertions: number;
    outsideBrief: string[];
  };
  events: CrewStepItem[];
  memory: CrewMemoryPoint[];
  mergeCheck: MergeVerdict;
  report: CrewReport | null;
  reviews: CrewReview[];
}

export interface GuardAskItem {
  at: number;
  hook: string;
  reason: string;
  session: string;
  tool: string;
}

/** `src/hooks/ask-log.ts` › `GuardAsk`: the same fields as a guard-log row. */
export type GuardAsk = GuardAskItem;

export interface GuardAsksAnswer {
  asks: GuardAskItem[];
  bucketMs: number;
  buckets: { at: number; byHook: Record<string, number> }[];
  byHook: Record<string, number>;
  guards: string[];
  kept: number;
  next: null | string;
  range: string;
  sessions: string[];
  skipped: number;
}

export interface PermissionWait {
  asker: string;
  attach: null | string;
  at: number;
  crew: null | { id: string; name: string; shortId: null | string };
  kind: null | string;
  project: string;
  session: string;
  tool: string;
}

export interface CrewNeed {
  askedAt: string;
  crew: { id: string; name: string; shortId: null | string; state: string };
  options: string[];
  question: string;
  recommended: null | number;
}

export interface BreakerNeed {
  held: number;
  heldNow: null | number;
  since: string;
  slot: string;
  targets: { status: null | number; target: string; until: string }[];
}

export interface DoctorFailure {
  fix: null | string;
  section: null | string;
  text: string;
}

export interface NeedsAnswer {
  stopped: StoppedCrewItem[];
  stoppedError: string | null;
  breakers: BreakerNeed[];
  crew: CrewNeed[];
  doctor: { at: null | number; failures: DoctorFailure[] };
  permissions: PermissionWait[];
  permissionsError: null | string;
  update: null | { at: string; from: null | string; notes: string[]; version: string };
}

export interface WorktreeItem {
  branch: null | string;
  kind: "finished" | "gone" | "kept" | "main";
  head: string;
  idleMinutes: null | number;
  path: string;
  why: null | string;
}

export interface WorktreeAutoClean {
  base: string;
  lastRunAt: string;
  removed: { branch: null | string; name: string; path: string; why: string }[];
}

export interface WorktreesAnswer {
  autoClean: null | WorktreeAutoClean;
  base: string;
  from: "config" | "default" | "origin";
  note: null | string;
  worktrees: WorktreeItem[];
}

// ── The heavy-job queue ────────────────────────────────────────────────────────────────

export interface JobHolderItem {
  command: string;
  exclusive?: string;
  folder: string;
  gb: number;
  kind: string;
  pid: number;
  since: null | string;
  user: string;
  unknown?: true;
}

export interface JobWeightState {
  value: null | number;
  why?: string;
}

export interface JobWeightsState {
  cpu: JobWeightState;
  io: JobWeightState;
}

export interface JobsAnswer {
  budgetGb: number;
  freeGb: null | number;
  keptGb: number;
  memoryGb: number;
  stores: {
    budgetGb: number;
    freeGb: number;
    held: JobHolderItem[];
    note?: string;
    waiting: JobHolderItem[];
    where: string;
  }[];
  weights: JobWeightsState;
}

// ── The request history (H1) ───────────────────────────────────────────────────────────

export type HistoryRange = "1h" | "4h" | "1d" | "7d" | "14d" | "30d" | "90d";
export type HistoryBy = "target" | "slot" | "model" | "session";

/** `src/gateway/history-read.ts` › `HistoryFilters`: each exact, `status` the one word. */
export interface HistoryFilters {
  model?: string;
  /** The profile a request's path named (`…/p/<profile>`, owner D29). */
  profile?: string;
  session?: string;
  slot?: string;
  status?: "error";
  target?: string;
}

export interface HistoryPoint {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  errors: number;
  inputTokens: number;
  p50Ms: number;
  p95Ms: number;
  outputTokens: number;
  requests: number;
  t: number;
  /** Rows that reported tokens and no price: in `requests`, never in `costUsd`. */
  unpriced: number;
}

export interface HistorySeries {
  key: string;
  points: HistoryPoint[];
}

/** `src/portal/api/types.ts` › `SafetyChecks`: auto mode's checks, counted apart (F6). */
export interface SafetyChecks {
  checks: null | number;
  days: number;
}

/** `GET /api/history?range=…&by=…&…`: one series per key, every bucket of the window. */
export interface HistoryAnswer {
  available: boolean;
  by: HistoryBy;
  bucketMs: number;
  from: number;
  note: null | string;
  range: HistoryRange;
  safetyChecks: SafetyChecks;
  series: HistorySeries[];
  to: number;
}

export interface HistoryKeys {
  models: string[];
  sessions: string[];
  slots: string[];
  targets: string[];
}

export type HistoryKeysAnswer = HistoryKeys;

/** One row of the recent-requests table: metadata only. */
export interface HistoryRequest {
  at: number;
  costUsd: null | number;
  held: boolean;
  latencyMs: number;
  model: string;
  nextTarget: null | string;
  session: null | string;
  slot: null | string;
  status: number;
  target: string;
  tokens: { cacheRead: number; cacheWrite: number; input: number; output: number };
}

/** `GET /api/requests?…&cursor=`: the recent requests, newest first. */
export interface RequestsAnswer {
  available: boolean;
  cursor: null | string;
  note: null | string;
  requests: HistoryRequest[];
}

// ── The flow report ────────────────────────────────────────────────────────────────────

export interface AskerCount {
  count: number;
  ms: number;
}

interface FlowCounts {
  activeMs: number | null;
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
  compactions: {
    count: number;
    byTrigger: Record<string, number>;
    tokens: null | { post: number; pre: number };
  };
  autoModeBlocks: Record<string, number>;
  merges: { count: number; byAsker: Record<string, number>; byReason: Record<string, number> };
  skipped: number;
}

export interface FlowReport {
  sinceMs: number;
  untilMs: number;
  sessions: ({
    project: string;
    session: string;
    cwd: null | string;
    firstAt: number | null;
    lastAt: number | null;
  } & FlowCounts)[];
  totals: { sessions: number } & FlowCounts;
  open: {
    project: string;
    session: string;
    cwd: null | string;
    at: number;
    asker: string;
    kind: null | string;
    tool: string;
  }[];
  skipped: { askLog: number; records: number };
  missing: string[];
  /** The window hour by hour, oldest first: every hour, an empty one too. */
  hours: { launches: number; promptMs: number; prompts: number; replies: number; t: number }[];
}

export interface FlowAnswer {
  from: number;
  note: null | string;
  range: HistoryRange;
  report: FlowReport;
  to: number;
}

// ── Actions ────────────────────────────────────────────────────────────────────────────

/** `src/portal/actions.ts` › `ACTION_NAMES`: every action a page may POST. */
export const ACTION_NAMES = [
  "automode.apply",
  "browser.setup",
  "browser.token",
  "claudemem.fallback",
  "claudemem.follow",
  "claudemem.key",
  "claudemem.route",
  "claudemem.takeover",
  "companion.enable",
  "crew.answer",
  "crew.resume",
  "crew.rm",
  "crew.stop",
  "doctor.run",
  "gateway.key.make",
  "gateway.key.save",
  "omniroute.rollback",
  "omniroute.update",
  "project.add",
  "project.gateway.profile",
  "project.gateway.set",
  "project.preview",
  "project.workflow.propose",
  "project.write",
  "router.restart",
  "sessions.rm",
  "slot.breaker",
  "slot.check",
  "slot.effort",
  "slot.fallback",
  "slot.mode",
  "slot.save",
  "slot.test",
  "switch",
  "update.check",
  "update.install",
  "workflow.set",
  "worktrees.clean",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

/** What one action found: its lines, and the extras a few actions add. */
export interface ActionResult {
  ok: boolean;
  lines: string[];
  tone?: "info" | "warn";
  preview?: ProjectInitPlan;
  filesHash?: string;
  results?: { detail: string; target: string; verdict: "bad" | "blocked" | "good" }[];
  /** `project.workflow.propose` only: the pull request it opened, for the card's own link. */
  url?: string;
}

// ── The live stream ────────────────────────────────────────────────────────────────────

/** `src/gateway/limit-state.ts` › the state file's records. */
export interface LimitRecord {
  claim: string | null;
  resetsAt: number | null;
  seenAt: number;
}

export interface FallbackRecord {
  lastAt: number;
  model: string;
  resetsAt: number | null;
  since: number;
  target: string;
}

export interface BreakerRecord {
  held: number;
  lastAt: number;
  since: number;
  targets: { status: number | null; target: string; until: number }[];
}

export interface LiveState {
  breakers: Record<string, BreakerRecord>;
  fallbacks: Record<string, FallbackRecord>;
  limits: Record<string, LimitRecord>;
  seenClaude: Record<string, number>;
}

/** `src/crew/store.ts` › `CrewEvent`: one line of a crew store's events log. */
export interface CrewEvent {
  version: number;
  at: string;
  type: string;
  crew: string;
  name: string;
  lead: string | null;
  state: string;
  text: string | null;
  sha?: string | null | undefined;
  note?: string | null | undefined;
  memoryMb?: number | null | undefined;
  pair?: string | undefined;
  tell?: { [key: string]: unknown; kind: string; to: string[] } | null | undefined;
}

export type ActionEvent = { action: string; line: string } | ({ action: string } & ActionResult);

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

export type LiveEventName = keyof LiveEvents;
