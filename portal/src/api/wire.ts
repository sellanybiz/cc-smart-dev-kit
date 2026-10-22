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

export interface OverviewAnswer extends NotSetUp {
  backends: BackendRow[];
  dashboardUrl: null | string;
  fallbacks: FallbackRow[];
  jobs: { budgetGb: number; heldGb: number; waiting: number };
  limits: LimitRow[];
  limitsRead: boolean;
  router: RouterFacts;
  slots: SlotRow[];
  switches: SwitchFacts;
  warnings: LogLine[];
}

export interface SlotsAnswer extends NotSetUp {
  backendNotes: string[];
  breakers: Record<string, OpenBreaker>;
  chains: Record<string, string[]>;
  fallback: Record<string, boolean>;
  models: ModelRow[];
  slots: SlotRow[];
  switches: SwitchFacts;
  tested: Record<string, string>;
}

export interface HealthAnswer extends NotSetUp {
  backends: BackendRow[];
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  log: { lines: LogLine[]; note: null | string };
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

export interface MachineAnswer {
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
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | "crew.enabled"
  | "crew.idleStopMinutes"
  | "crew.max"
  | "crew.maxOpus"
  | "crew.memoryGb"
  | "crew.quietMinutes"
  | "crew.handoffPercent"
  | "crew.softHours"
  | "crew.maxHours"
  | "crew.tag"
  | "switches.statusLine"
  | "switches.sessionNames"
  | "switches.jobRoute"
  | "switches.updateHold";

/** `src/portal/settings.ts` › `SettingsRow`. */
export interface SettingsRow {
  card: "alerts" | "flow" | "switches";
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

// ── Work, crew, needs ──────────────────────────────────────────────────────────────────

export interface CrewSummary {
  base: null | { ref: string; sha: string };
  branch: string;
  createdAt: string;
  effort: string;
  id: string;
  kind: string;
  lastLine: null | string;
  leadName: string;
  leadSessionId: string;
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
  worktree: string;
}

export interface LeadSummary {
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

export interface SessionSummary {
  branch: null | string;
  endedCleanly: boolean;
  folder: null | string;
  id: string;
  lastWrite: number;
  name: null | string;
}

export interface WorkAnswer {
  crew: CrewSummary[];
  lead: null | LeadSummary;
  note: null | string;
  repo: null | string;
  sessions: SessionSummary[];
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
  | { kind: "allowed"; reason: string }
  | { kind: "refused"; number: null | number; reason: string }
  | { kind: "silent" }
  | { kind: "unread"; number: null | number; what: string }
  | { kind: "late"; number: null | number; what: string };

export interface CrewAnswer {
  brief: null | string;
  crew: CrewSummary;
  diff: {
    deletions: number;
    error: null | string;
    files: number;
    insertions: number;
    outsideBrief: string[];
  };
  events: CrewStepItem[];
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
  byHook: Record<string, number>;
  kept: number;
  skipped: number;
}

export interface PermissionWait {
  asker: string;
  at: number;
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
  since: string;
  slot: string;
  targets: { status: null | number; target: string; until: string }[];
}

export interface DoctorFailure {
  text: string;
}

export interface NeedsAnswer {
  breaker: null | BreakerNeed;
  crew: CrewNeed[];
  doctor: { at: null | number; failures: DoctorFailure[] };
  permissions: PermissionWait[];
  update: null | { at: string; from: null | string; notes: string[]; version: string };
}

export interface WorktreeItem {
  branch: null | string;
  kind: "finished" | "gone" | "kept" | "main";
  head: string;
  path: string;
  why: null | string;
}

export interface WorktreesAnswer {
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
}

export interface HistorySeries {
  key: string;
  points: HistoryPoint[];
}

/** `GET /api/history?range=…&by=…&…`: one series per key, every bucket of the window. */
export interface HistoryAnswer {
  available: boolean;
  by: HistoryBy;
  bucketMs: number;
  from: number;
  note: null | string;
  range: HistoryRange;
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
  "companion.enable",
  "crew.answer",
  "crew.resume",
  "crew.rm",
  "crew.stop",
  "doctor.run",
  "omniroute.rollback",
  "omniroute.update",
  "project.add",
  "project.preview",
  "project.write",
  "router.restart",
  "slot.breaker",
  "slot.check",
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
  tone?: "info";
  preview?: ProjectInitPlan;
  filesHash?: string;
  results?: { detail: string; target: string; verdict: "bad" | "blocked" | "good" }[];
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
