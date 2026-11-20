/**
 * Mock data in the real shapes (`./types.ts`), for the pages until B6b serves the real facts.
 * Every name is a placeholder (`my-app`, `/home/user`); the numbers are made up and seeded, so
 * a page looks the same on every load.
 */

import { guardAsks, jobsData, updateData, worktreesData } from "./mock-d52";
import { flowBuckets, historyFor, historyKeys, requestsFor, seeded, TRAFFIC } from "./mock-history";
import { type ProjectMocks, projectMocks } from "./mock-projects";
import { tasksPagesFor } from "./mock-tasks";
import type {
  AskerCount,
  FlowReport,
  FlowWindow,
  GuardAsksPage,
  GuardQuery,
  HealthData,
  History,
  HistoryKeys,
  HistoryQuery,
  JobsData,
  LogLine,
  MachineData,
  OpenBreaker,
  OverviewData,
  OverviewRequests,
  PortalFacts,
  ProjectData,
  ProjectList,
  ProjectTasksData,
  RecentRequest,
  RequestPage,
  RequestQuery,
  SettingsData,
  SettingsRow,
  SlotsData,
  UpdateData,
  WorkData,
  WorktreesData,
} from "./types";
import type { ActionResult } from "./wire";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function clock(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

const SLOT_KEYS = ["scout", "worker", "opus", "fable", "judge"] as const;
const key = (slot: string) => `cc-smart-dev-kit-${slot}`;

/** The chains in use, as `gateway.json` spells them. */
const CHAINS: Record<string, string[]> = {
  [key("scout")]: ["omniroute:glm-5.3-flash", "omniroute:minimax-m3", "claude-haiku-5-5"],
  [key("worker")]: ["omniroute:deepseek-v4.1-flash", "claude-sonnet-5-5"],
  [key("opus")]: ["claude-opus-5-5", "omniroute:glm-5.3", "omniroute:deepseek-v4.1"],
};

/** The effort pins the mock's chains hold: one pinned target, the rest follow Claude Code. */
const EFFORT_PINS: Record<string, Record<string, string>> = {
  [key("opus")]: { "omniroute:glm-5.3": "xhigh" },
};

/**
 * `slot.effort` in mock data: what `gateway effort` would answer. One target refuses `max`, so
 * the refused state is seen too; nothing is saved either way.
 */
function effortAct(body: Record<string, unknown>): ActionResult {
  const target = typeof body.target === "string" ? body.target : "";
  const level = typeof body.level === "string" ? body.level : "";
  if (target === "omniroute:minimax-m3" && level === "max") {
    return {
      lines: [
        `${target} refused effort max: HTTP 400: {"error":{"message":"reasoning effort max is not supported by this model"}}. Nothing was saved.`,
      ],
      ok: false,
    };
  }
  return {
    lines: [
      `Mock data: ${target} ${level === "off" ? "would follow Claude Code again" : `would be pinned to ${level}`}. The real portal runs it.`,
      "The router uses it from its next request.",
    ],
    ok: true,
  };
}

function recentRequests(now: number, count: number): RecentRequest[] {
  const random = seeded(7);
  const total = TRAFFIC.reduce((sum, t) => sum + t.weight, 0);
  const out: RecentRequest[] = [];
  // The last `count` requests, spread over about 50 minutes, with a busy stretch in the middle.
  let at = now - 4_000;
  for (let i = 0; i < count; i++) {
    const busy = i > 70 && i < 130;
    at -= Math.round((busy ? 6_000 : 18_000) * (0.3 + random()));
    let pick = random() * total;
    const traffic = TRAFFIC.find((t) => {
      pick -= t.weight;
      return pick <= 0;
    });
    if (traffic === undefined) continue;
    const failed = random() < 0.035;
    const limited = !failed && traffic.target.startsWith("omniroute:") && random() < 0.03;
    const [low, high] = traffic.ms;
    out.push({
      at,
      slot: traffic.slot,
      target: traffic.target,
      status: failed ? 502 : limited ? 429 : 200,
      ms: Math.round(low + (high - low) * random()),
      next: traffic.target === "omniroute:glm-5.3" || traffic.target === "omniroute:minimax-m3",
    });
  }
  return out;
}

const PATH = "/home/user/code";

function workData(now: number, empty: boolean): WorkData {
  return {
    folderNote: null,
    note: null,
    waitsNote: null,
    others: empty
      ? []
      : [
          {
            sessionId: "e51a9b30",
            name: "docs-site: fix the nav",
            project: "docs-site",
            branch: "fix/nav-links",
            model: "claude-sonnet-5-5",
            state: "waiting",
            lastAt: iso(now - 6 * MINUTE),
          },
        ],
  };
}

function flowReport(now: number, window: FlowWindow, empty: boolean): FlowReport {
  const span = window === "24h" ? DAY : 7 * DAY;
  const scale = window === "24h" ? 1 : 5.6;
  const n = (value: number) => (empty ? 0 : Math.round(value * scale));
  const byAsker: Record<string, AskerCount> = empty
    ? {}
    : {
        "job-route": { count: n(9), ms: n(9) * 41_000 },
        "user-away": { count: n(6), ms: n(6) * 22_000 },
        "Claude Code": { count: n(4), ms: n(4) * 63_000 },
      };
  const askCount = Object.values(byAsker).reduce((sum, a) => sum + a.count, 0);
  const askMs = Object.values(byAsker).reduce((sum, a) => sum + a.ms, 0);
  return {
    sinceMs: now - span,
    untilMs: now,
    sessions: empty
      ? []
      : [
          {
            project: "my-app",
            session: "9c3a7e5d-lead",
            activeMs: n(3.1 * HOUR),
            agents: { launches: n(46), parallelRatio: 0.72, mostAtOnce: 5 },
            prompts: { count: n(12), totalMs: n(12) * 40_000 },
          },
          {
            project: "docs-site",
            session: "e51a9b30",
            activeMs: n(1.2 * HOUR),
            agents: { launches: n(9), parallelRatio: 0.33, mostAtOnce: 2 },
            prompts: { count: n(5), totalMs: n(5) * 51_000 },
          },
          {
            project: "api-service",
            session: "f07c3d12",
            activeMs: n(0.6 * HOUR),
            agents: { launches: n(4), parallelRatio: 0, mostAtOnce: 1 },
            prompts: { count: n(4), totalMs: n(4) * 30_000 },
          },
        ],
    totals: {
      sessions: empty ? 0 : 3,
      activeMs: n(4.9 * HOUR),
      agents: {
        launches: n(59),
        replies: n(31),
        repliesParallel: n(14),
        launchesParallel: n(38),
        parallelRatio: empty ? 0 : 0.64,
        mostAtOnce: empty ? 0 : 5,
      },
      prompts: {
        count: askCount,
        totalMs: askMs,
        longestMs: empty ? 0 : 4 * MINUTE + 12_000,
        byAsker,
      },
      questions: { askUserQuestion: n(7), exitPlanMode: n(2) },
      background: { count: n(18), totalMs: n(18) * 95_000, byOrigin: { bash: n(14), agent: n(4) } },
      idle: { count: n(11), totalMs: n(11) * 7 * MINUTE },
      compactions: { count: n(2), byTrigger: { auto: n(2) } },
      autoModeBlocks: empty ? {} : { "force push": n(1), "curl | sh": n(1) },
      merges: { count: n(3), byAsker: {}, byReason: {} },
    },
    open: empty
      ? []
      : [
          {
            project: "docs-site",
            session: "e51a9b30",
            cwd: `${PATH}/docs-site`,
            at: now - 6 * MINUTE,
            asker: "job-route",
            kind: "push",
            tool: "Bash",
          },
        ],
    missing: [],
    buckets: flowBuckets(now, span, window === "24h" ? HOUR : 6 * HOUR, empty),
  };
}

/** The portal's own folder is the set-up `my-app` (the projects' current one): it sets a few rows. */
function settingsRows(): SettingsRow[] {
  const row = (
    fields: Omit<SettingsRow, "readOnly" | "why" | "source"> &
      Partial<Pick<SettingsRow, "readOnly" | "why" | "source">>,
  ): SettingsRow => ({ readOnly: false, why: null, source: "default", ...fields });
  const projectSets = { readOnly: true, source: "project" as const, why: "this project sets it" };
  return [
    row({
      card: "flow",
      help: "Let a session commit each finished, reviewed step without asking.",
      id: "set-commit",
      key: "allowCommit",
      kind: "boolean",
      label: "Allow commit",
      where: "personal",
      value: true,
      source: "personal",
    }),
    row({
      card: "flow",
      help: "Let a session push your own branch. Never main, dev or a protected branch.",
      id: "set-push",
      key: "allowPush",
      kind: "boolean",
      label: "Allow push",
      where: "personal",
      value: false,
    }),
    row({
      card: "flow",
      choices: [
        { label: "Off", value: "off" },
        { label: "Draft", value: "draft" },
        { label: "Ready", value: "ready" },
      ],
      help: "Off: never. Draft: open it as a draft the team can look at. Ready: open it ready for review.",
      id: "set-pr",
      key: "openPr",
      kind: "segment",
      label: "Open a pull request",
      where: "personal",
      value: "draft",
      source: "personal",
    }),
    row({
      card: "flow",
      help: "Let a session merge your pull request once CI has passed and the review is done.",
      id: "set-merge",
      key: "allowMerge",
      kind: "boolean",
      label: "Allow merge",
      where: "personal",
      value: false,
      ...projectSets,
    }),
    row({
      card: "flow",
      choices: [
        { label: "Merge", value: "merge" },
        { label: "Squash", value: "squash" },
        { label: "Rebase", value: "rebase" },
      ],
      help: "How a merged pull request lands on the branch it goes into.",
      id: "set-method",
      key: "mergeMethod",
      kind: "segment",
      label: "Merge method",
      where: "personal",
      value: "squash",
    }),
    row({
      card: "flow",
      help: "Remove the branch on GitHub once the pull request is merged. The worktree here stays until you clear it.",
      id: "set-del",
      key: "deleteBranch",
      kind: "boolean",
      label: "Delete the branch after merge",
      where: "personal",
      value: true,
    }),
    row({
      card: "flow",
      help: "A second read of the whole change before it leaves this computer: one premium second opinion.",
      id: "set-review",
      key: "reviewBeforePush",
      kind: "boolean",
      label: "Review before the first push",
      where: "personal",
      value: true,
    }),
    row({
      card: "flow",
      help: "Delete the worktree and its branch folder once the pull request is merged and nothing is left in it.",
      id: "set-wt",
      key: "clearWorktreeAfterMerge",
      kind: "boolean",
      label: "Clear the worktree after merge",
      where: "personal",
      value: true,
    }),
    row({
      card: "alerts",
      help: "Warn me when a usage window reaches this share of its limit.",
      id: "set-limit",
      key: "alerts.usagePercent",
      kind: "number",
      unit: "%",
      label: "Status-line usage warning at",
      where: "personal",
      value: 80,
    }),
    row({
      card: "switches",
      help: "Show the slot and the model answering in Claude Code's status line.",
      id: "set-status",
      key: "switches.statusLine",
      kind: "boolean",
      label: "Status line",
      where: "personal",
      value: true,
    }),
    row({
      card: "switches",
      help: "Name each Claude session after the branch it works on, so a window is easy to find.",
      id: "set-names",
      key: "switches.sessionNames",
      kind: "boolean",
      label: "Session names",
      where: "project",
      value: true,
      ...projectSets,
    }),
    row({
      card: "switches",
      help: "The type check, the build, the tests and the coverage run go through the queue: a few at a time, the rest wait for a free slot. A project can set its own.",
      id: "set-jobs",
      key: "switches.jobRoute",
      kind: "boolean",
      label: "Heavy jobs through the queue",
      where: "personal",
      value: true,
      ...projectSets,
    }),
    row({
      card: "switches",
      help: "No new kit version installs until you turn this off again.",
      id: "set-upd",
      key: "switches.updateHold",
      kind: "boolean",
      label: "Hold self-updates",
      where: "personal",
      value: false,
    }),
  ];
}

function logLines(now: number): LogLine[] {
  const at = (minutes: number) => clock(now - minutes * MINUTE);
  return [
    { level: "INFO", time: at(48), text: "listening on 127.0.0.1:20100" },
    {
      level: "INFO",
      time: at(31),
      text: "cc-smart-dev-kit-opus: claude-opus-5-5 answered 200 in 14.2 s",
    },
    {
      level: "WARN",
      time: at(22),
      text: "omniroute:minimax-m3 gave no event in time (only heartbeats); rests 120 s",
    },
    {
      level: "INFO",
      time: at(19),
      text: "cc-smart-dev-kit-scout: omniroute:minimax-m3 answered 200 in 3.1 s",
    },
    {
      level: "WARN",
      time: at(12),
      text: "claude-opus-5-5 hit the 5-hour window (resets 13:00): cc-smart-dev-kit-opus answers from omniroute:glm-5.3",
    },
    {
      level: "ERROR",
      time: at(7),
      text: "omniroute:deepseek-v4.1 failed: HTTP 502 from the backend",
    },
    {
      level: "INFO",
      time: at(2),
      text: "cc-smart-dev-kit-worker: omniroute:deepseek-v4.1-flash answered 200 in 6.8 s",
    },
  ];
}

export interface MockData {
  facts: PortalFacts;
  overview: OverviewData;
  history: (query: HistoryQuery) => History;
  /** The Overview's rate alone, as `/api/history/rate` answers it. */
  historyRate: OverviewRequests;
  requests: (query: RequestQuery) => RequestPage;
  keys: HistoryKeys;
  jobs: JobsData;
  guardAsks: (query: GuardQuery) => GuardAsksPage;
  worktrees: WorktreesData;
  update: UpdateData;
  work: WorkData;
  flow: Record<FlowWindow, FlowReport>;
  slots: SlotsData;
  health: HealthData;
  machine: MachineData;
  settings: SettingsData;
  projects: ProjectList;
  projectPages: Record<string, ProjectData>;
  gatewayPages: ProjectMocks["gatewayPages"];
  workflowPages: ProjectMocks["workflowPages"];
  /** Each project's tasks (D75), by project id: the Tasks tab and the project page's card. */
  tasksPages: Record<string, ProjectTasksData>;
  /** A `project.*` action's mock answer; null: the generic "sent nothing" line. */
  act: ProjectMocks["act"];
}

export function mockData(empty: boolean): MockData {
  const now = Date.now();
  const work = workData(now, empty);
  const jobs = jobsData(now, empty);
  // The model requests the history holds: fewer than the router's own count, which also counts
  // Claude Code's pings to it. One home in the mock: the Overview answer carries it, and
  // `/api/history/rate` returns it on its own.
  const historyRate = empty
    ? { perMinute: null, sinceRouterStart: null }
    : { perMinute: 21.6, sinceRouterStart: 892 };
  const recent = empty ? [] : recentRequests(now, 200);
  const breakers: Record<string, OpenBreaker> = empty
    ? {}
    : {
        [key("fable")]: {
          held: 3,
          heldNow: 1,
          since: now - 4 * MINUTE,
          targets: [
            { status: 429, target: "omniroute:kimi-k3", until: now + 50_000 },
            { status: null, target: "omniroute:glm-5.3", until: now + 95_000 },
          ],
        },
      };
  const cooling: Record<string, number> = empty ? {} : { "omniroute:minimax-m3": 118 };
  const facts: PortalFacts = {
    platform: "linux",
    portalPort: 20110,
    router: { port: 20100, up: true },
    version: "1.1.0",
  };
  const health = {
    ok: true as const,
    port: 20100,
    requests: empty ? 0 : 1307,
    fallbacks: empty ? 0 : 39,
    uptimeSec: empty ? 12 : 3 * 3600 + 17 * 60,
    cooling,
    breakers,
    slots: CHAINS,
    recent,
  };
  const log = empty ? [] : logLines(now);
  const fallbackRows = empty
    ? []
    : [
        {
          slot: "opus",
          model: "claude-opus-5-5",
          target: "omniroute:glm-5.3",
          since: clock(now - 12 * MINUTE).slice(0, 5),
        },
      ];
  const limits = empty
    ? []
    : [{ claim: "the 5-hour window", model: "claude-opus-5-5", resets: "13:00" }];

  const slotTarget = (target: string, restingFor: null | number = null, slot = "") => ({
    ...(EFFORT_PINS[key(slot)]?.[target] === undefined
      ? {}
      : { effort: EFFORT_PINS[key(slot)]?.[target] }),
    target,
    from: target.startsWith("omniroute:") ? "omniroute" : "Claude login",
    restingFor,
    tested: false,
  });
  const info: Record<string, string> = {
    scout:
      "Haiku's work: file search, greps, reading, summaries and background calls. With no chain, Haiku answers itself.",
    worker:
      "Sonnet's work: building, doc updates, tests and mechanical runs. With no chain, Sonnet answers itself.",
    opus: "Every Opus request: the main session on Opus and every opus agent. With no chain, Opus answers itself.",
    fable:
      "Every Fable request: the main session on Fable and every fable agent. With no chain, Fable answers itself.",
    judge:
      "Auto mode's safety checks. With no chain, Claude judges them. With one, its first target judges every check in Claude's place, and only a target that passed the force-push test is used. A weak judge can let a risky command through, and it reads the conversation.",
  };
  const role: Record<string, string> = {
    scout: "affordable",
    worker: "affordable",
    opus: "model",
    fable: "model",
    judge: "judge",
  };
  // Saved while Claude answers: the fable chain, and a judge chain not tested yet.
  const kept: Record<string, string[]> = {
    [key("fable")]: ["claude-fable-5", "omniroute:kimi-k3"],
    [key("judge")]: ["omniroute:glm-5.3"],
  };
  const rows = SLOT_KEYS.map((slot) => {
    const chain = empty ? [] : (CHAINS[key(slot)] ?? []);
    const saved = empty ? undefined : kept[key(slot)];
    return {
      breaker: slot !== "judge",
      fallback: slot !== "fable" && slot !== "opus",
      info: info[slot] ?? "",
      kept:
        saved === undefined
          ? null
          : { fallback: slot !== "fable", targets: saved.map((target) => slotTarget(target)) },
      key: key(slot),
      kind: chain.length === 0 ? "off" : (role[slot] ?? "model"),
      mode: chain.length === 0 ? ("claude" as const) : ("custom" as const),
      name: slot,
      note: chain.length === 0 ? "Claude: no chain in use" : "fallback on",
      role: role[slot] ?? "model",
      stamp: `mock-${slot}`,
      targets: chain.map((target) =>
        slotTarget(target, cooling[target as keyof typeof cooling] ?? null, slot),
      ),
    };
  });
  const slots: SlotsData = {
    backendNotes: [],
    breakers,
    chains: Object.fromEntries(rows.map((row) => [row.name, row.targets.map((t) => t.target)])),
    configured: true,
    effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    error: null,
    fallback: Object.fromEntries(rows.map((row) => [row.name, row.fallback])),
    models: [
      { backend: "omniroute", id: "omniroute:glm-5.3", context: "200K", plan: false },
      { backend: "omniroute", id: "omniroute:glm-5.3-flash", context: "128K", plan: false },
      { backend: "omniroute", id: "omniroute:deepseek-v4.1", context: "128K", plan: false },
      { backend: "omniroute", id: "omniroute:deepseek-v4.1-flash", context: "128K", plan: false },
      { backend: "omniroute", id: "omniroute:minimax-m3", context: "1000K", plan: false },
      { backend: "omniroute", id: "omniroute:kimi-k3", context: "256K", plan: false },
      { backend: "Claude login", id: "claude-haiku-5-5", context: "the plan's", plan: true },
      { backend: "Claude login", id: "claude-sonnet-5-5", context: "the plan's", plan: true },
      { backend: "Claude login", id: "claude-opus-5-5", context: "the plan's", plan: true },
      { backend: "Claude login", id: "claude-fable-5-2", context: "the plan's", plan: true },
    ],
    slots: rows,
    switches: {
      gateway: true,
      judge: false,
      judgeUntested: false,
      settingsBaseUrl: "http://127.0.0.1:20100",
      warnings: [],
    },
    tested: {},
  };

  const projects = projectMocks(now, empty);

  return {
    act: (action, body) =>
      action === "slot.effort" ? effortAct(body) : projects.act(action, body),
    facts,
    history: (query) => historyFor(now, query, empty),
    requests: (query) => requestsFor(now, query, empty),
    keys: historyKeys(empty),
    jobs,
    guardAsks: (query) =>
      guardAsks(
        now,
        query,
        empty,
        historyKeys(empty).sessions.map((session) => session.id),
      ),
    worktrees: worktreesData(now, empty),
    update: updateData(now),
    historyRate,
    overview: {
      health,
      fallbacks: fallbackRows,
      limits,
      fiveHour: empty ? null : { percent: 61, resetsAt: now + 127 * MINUTE },
      requests: historyRate,
      switches: slots.switches,
      jobs: {
        slots: jobs.stores[0]?.slots ?? 0,
        used: jobs.stores[0]?.used ?? 0,
        waiting: jobs.stores.reduce((sum, store) => sum + store.waiting.length, 0),
      },
    },
    work,
    flow: { "24h": flowReport(now, "24h", empty), "7d": flowReport(now, "7d", empty) },
    slots,
    health: {
      router: {
        breakers,
        cooling: Object.entries(cooling),
        recent: recent.map((entry) => ({
          at: entry.at,
          ms: entry.ms,
          nextTarget: entry.next,
          slot: entry.slot,
          status: entry.status,
          target: entry.target,
        })),
        fallbacks: health.fallbacks,
        port: 20100,
        requests: health.requests,
        up: true,
        uptimeSec: health.uptimeSec,
        why: null,
      },
      socket: {
        check: {
          ok: true,
          text: "the router's socket (cc-smart-dev-kit-router.socket) holds 127.0.0.1:20100",
        },
        kind: "systemd",
        name: "cc-smart-dev-kit-router.socket",
        state: "open",
      },
      backends: [
        {
          name: "omniroute",
          url: "http://127.0.0.1:20128/v1",
          state: "answers",
          ms: 84,
          why: null,
          models: slots.models.filter((m) => !m.plan),
        },
        {
          name: "ollama-cloud",
          url: "https://ollama.example.com/v1",
          state: "failed",
          ms: null,
          why: "HTTP 401: the key was refused",
          models: [],
        },
      ],
      breakers,
      log,
    },
    machine: {
      facts,
      autoMode: empty
        ? null
        : {
            added: ["Trust the build commands of my-app (bun run build, bun test)."],
            differsFrom: null,
            from: "/home/user/code/my-app/.claude/cc-smart-dev-kit.json",
            hash: "0123456789abcdef",
            removed: [],
            settings: "~/.claude/settings.json",
          },
      claudeCode: {
        liveCheck: {
          claudeCode: "2.1.309",
          passedAt: new Date(now - 3 * 24 * 60 * MINUTE).toISOString(),
          plugin: "1.1.0",
        },
        version: "2.1.312",
        why: null,
      },
      claudeMem: {
        backends: ["omniroute"],
        blocked: null,
        current: {
          fallback: {
            claudeModel: null,
            idle: null,
            model: null,
            provider: "claude",
            refusedByHand: false,
            source: "default",
            target: null,
          },
          key: { pool: false, refusedByHand: false, source: "setup", state: "gateway" },
          route: {
            address: "http://127.0.0.1:20128/v1",
            kind: "backend",
            model: "glm-5.3-flash",
            provider: "openai-compatible",
            refusedByHand: false,
            source: "setup",
            target: "omniroute:glm-5.3-flash",
          },
        },
        file: "~/.claude-mem/settings.json",
        handKeys: [],
        minVersion: "13.29.0",
        version: "13.40.0",
      },
      bun: { minimum: "1.4.3", ok: true, version: "1.4.5" },
      doctorAt: now - 4 * MINUTE,
      companions: [
        {
          id: "claude-mem@thedotmack",
          title: "claude-mem",
          state: "ok",
          detail: "✓ claude-mem is installed and enabled",
          command: null,
          enableArgv: null,
        },
        {
          id: "frontend-design@claude-plugins-official",
          title: "frontend-design",
          state: "off",
          detail: "! frontend-design is installed but turned off",
          command: "claude plugin enable frontend-design@claude-plugins-official",
          enableArgv: ["claude", "plugin", "enable", "frontend-design@claude-plugins-official"],
        },
      ],
      mcp: [
        { name: "playwright", state: "ours", runsWhat: null },
        { name: "sequential-thinking", state: "ours", runsWhat: null },
        { name: "shadcn", state: "ours", runsWhat: null },
        { name: "tavily-websearch", state: "missing", runsWhat: null },
      ],
      browser: {
        state: {
          extensionInstalled: true,
          fileUrls: false,
          profile: true,
          profileDirName: "claude-code",
          tokenSet: true,
        },
        notes: [],
        guide: {
          intro: 'In the Chrome window of the "claude-code" profile:',
          notes: [],
          steps: [
            {
              done: true,
              text: 'Click "Add to Chrome", then "Add extension": that installs the Playwright extension in THIS profile only.',
            },
            { done: null, text: "Pin the extension, so its icon is one click away." },
            {
              done: true,
              text: "Copy the token the extension shows, and save it with the command below.",
              detail: "cc-smart-dev-kit browser token",
            },
            {
              done: false,
              text: 'Turn on "Allow access to file URLs" in the extension\'s details.',
              detail: "chrome://extensions",
            },
          ],
        },
      },
      omniroute: {
        backend: "omniroute  http://127.0.0.1:20128/v1  ••••a1b2",
        install: {
          kind: "bun",
          folder: "/home/user/.bun/install/global/node_modules/omniroute",
          manager: "bun",
          version: "3.4.1",
        },
        newestVersion: "3.4.2",
        previous: { at: "2026-10-14", version: "3.3.9" },
        registryError: null,
        state: "behind",
        unit: "omniroute.service",
      },
      gatewayKey: empty ? "not-set-up" : "set",
      doctor: [
        {
          fix: null,
          mark: "ok",
          section: "plugin",
          text: "cc-smart-dev-kit 1.1.0 is installed and enabled",
        },
        {
          fix: null,
          mark: "ok",
          section: "gateway",
          text: "the router answers on 127.0.0.1:20100",
        },
        {
          fix: null,
          mark: "warn",
          section: "omniroute",
          text: "OmniRoute 3.4.2 is out (3 days old): cc-smart-dev-kit omniroute update",
        },
        {
          fix: "cc-smart-dev-kit setup",
          mark: "fail",
          section: "mcp",
          text: "tavily-websearch is not registered",
        },
        {
          fix: null,
          mark: "ok",
          section: "browser",
          text: "the claude-code Chrome profile has the extension and its token",
        },
      ],
    },
    settings: { allowMerge: null, error: null, projectNote: null, rows: settingsRows() },
    projects: projects.projects,
    projectPages: projects.projectPages,
    gatewayPages: projects.gatewayPages,
    workflowPages: projects.workflowPages,
    tasksPages: tasksPagesFor(projects.projects.rows, now),
  };
}
