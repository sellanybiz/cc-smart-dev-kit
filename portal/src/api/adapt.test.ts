/**
 * The translation from the server's answers to the pages' shapes, and the page's requests:
 * every expected value is written by hand. A fact the server does not send stays unknown.
 */
import { describe, expect, test } from "bun:test";
import {
  branchVerdictOf,
  flowOf,
  guardAsksOf,
  healthOf,
  jobsOf,
  machineOf,
  NotSetUpError,
  overviewOf,
  projectOf,
  projectsOf,
  projectWorkflowOf,
  proposeValueText,
  workflowValueText,
} from "./adapt";
import { GUARD_PAGE_SIZE, guardQuery, liveClient } from "./client";
import { CSRF_HEADER, getJson, PortalRequestError, postAction } from "./http";
import type { SettingsRow } from "./types";
import type {
  FlowAnswer,
  HealthAnswer,
  JobsAnswer,
  MachineAnswer,
  OverviewAnswer,
  ProjectCardData,
  ProjectSummary,
  ProjectWorkflowAnswer,
  RouterFacts,
} from "./wire";

const CARD: ProjectCardData = {
  answers: {
    base: "main",
    bases: { "feature/": "release" },
    guards: { guardMainFolder: true, jobRoute: false, sessionNames: true },
    protectedBranches: ["main"],
    workflow: { autoMerge: false },
  },
  error: null,
  filesHash: "f00d",
  name: "my-app",
  plan: {
    changed: true,
    diff: ["+ {"],
    file: "/home/user/code/my-app/.claude/cc-smart-dev-kit.json",
    localSettings: {
      adds: [],
      changed: false,
      file: "/home/user/code/my-app/.claude/settings.local.json",
      lines: [],
      removes: [],
      text: "",
    },
    notes: [],
    settings: {
      adds: [],
      changed: false,
      file: "/home/user/code/my-app/.claude/settings.json",
      lines: [],
      removes: [],
      text: "{}",
    },
    text: "{}\n",
  },
  planError: null,
  root: "/home/user/code/my-app",
  set: true,
};

const SUMMARY: ProjectSummary = {
  configFile: "/home/user/code/my-app/.claude/cc-smart-dev-kit.json",
  current: true,
  id: "a1f0",
  lastUsed: "2026-10-20T10:00:00.000Z",
  name: "my-app",
  root: "/home/user/code/my-app",
  set: true,
  source: "sessions",
  uncommitted: true,
  worktrees: 3,
};

const ROUTER: RouterFacts = {
  breakers: {},
  cooling: [["omniroute:minimax-m3", 30]],
  fallbacks: 2,
  port: 20_199,
  recent: [
    {
      at: 10,
      ms: 120,
      nextTarget: true,
      slot: "cc-smart-dev-kit-worker",
      status: 200,
      target: "omniroute:glm-5.3",
    },
  ],
  requests: 9,
  up: true,
  uptimeSec: 60,
  why: null,
};

const SLOTS_ROW = {
  breaker: true,
  fallback: true,
  info: "",
  kept: null,
  key: "cc-smart-dev-kit-worker",
  kind: "affordable",
  mode: "custom" as const,
  name: "worker",
  note: "",
  role: "affordable",
  stamp: "0123456789abcdef",
  targets: [{ from: "omniroute", restingFor: null, target: "omniroute:glm-5.3", tested: false }],
};

describe("the adapters", () => {
  test("Health: the port holder in doctor's words, and none where the machine runs no service", () => {
    const holder = {
      check: { ok: true as const, text: "the router's socket holds 127.0.0.1:20999" },
      kind: "systemd" as const,
      name: "cc-smart-dev-kit-router.socket",
      state: "open" as const,
    };
    const answer: HealthAnswer = {
      backends: [],
      configured: true,
      error: null,
      fallbacks: [],
      limits: [],
      log: { lines: [{ level: "WARN", text: "a backend failed", time: "10:00:00" }], note: null },
      portHolder: holder,
      router: ROUTER,
    };
    const data = healthOf(answer);
    expect(data.socket).toEqual(holder);
    expect(healthOf({ ...answer, portHolder: null }).socket).toBe(null);
    expect(data.log).toEqual([{ level: "WARN", text: "a backend failed", time: "10:00:00" }]);
  });

  test("the guard log: the server's page as it is, and its buckets as one series per guard", () => {
    const page = guardAsksOf({
      asks: [
        { at: 3_000, hook: "git-guard", reason: "a push", session: "s1", tool: "Bash" },
        { at: 2_000, hook: "merge-guard", reason: "old", session: "s2", tool: "Bash" },
      ],
      bucketMs: 1_000,
      buckets: [
        { at: 3_000, byHook: { "git-guard": 1 } },
        { at: 1_000, byHook: { "git-guard": 4, "merge-guard": 2 } },
        { at: 2_000, byHook: { "merge-guard": 1 } },
      ],
      byHook: { "git-guard": 5, "merge-guard": 3 },
      guards: ["git-guard", "merge-guard"],
      kept: 8,
      next: "2000.1",
      range: "1h",
      sessions: ["s1", "s2"],
      skipped: 0,
    });
    // Nothing is filtered, sorted or cut here: the server did that.
    expect(page.rows.map((row) => row.at)).toEqual([3_000, 2_000]);
    expect(page.next).toBe("2000.1");
    expect(page.kept).toBe(8);
    expect(page.guards).toEqual(["git-guard", "merge-guard"]);
    expect(page.sessions).toEqual(["s1", "s2"]);
    expect(page.buckets).toEqual({
      bucketMs: 1_000,
      series: [
        {
          key: "git-guard",
          points: [
            { count: 4, t: 1_000 },
            { count: 0, t: 2_000 },
            { count: 1, t: 3_000 },
          ],
        },
        {
          key: "merge-guard",
          points: [
            { count: 2, t: 1_000 },
            { count: 1, t: 2_000 },
            { count: 0, t: 3_000 },
          ],
        },
      ],
    });
  });

  test("the guard log's request: the range, the cursor, the page size and the filters", () => {
    expect(guardQuery({ cursor: null, range: "7d" }).toString()).toBe(
      `limit=${GUARD_PAGE_SIZE}&range=7d`,
    );
    expect(
      guardQuery({
        cursor: "1792663440000.2",
        guard: "git-guard",
        range: "1h",
        session: "s1",
      }).toString(),
    ).toBe(`limit=${GUARD_PAGE_SIZE}&range=1h&cursor=1792663440000.2&hook=git-guard&session=s1`);
  });

  test("projects: every field from the wire, unknown counts stay unknown, the note travels", () => {
    const list = projectsOf({
      current: CARD,
      note: "Only 2 projects: the other session records are older than 90 days.",
      projects: [
        SUMMARY,
        {
          ...SUMMARY,
          current: false,
          id: "b7c1",
          lastUsed: null,
          name: "api-service",
          root: "/home/user/code/api-service",
          set: false,
          source: "added",
          uncommitted: null,
          worktrees: null,
        },
      ],
    });
    expect(list).toEqual({
      note: "Only 2 projects: the other session records are older than 90 days.",
      rows: [
        {
          current: true,
          id: "a1f0",
          lastUsed: "2026-10-20T10:00:00.000Z",
          name: "my-app",
          path: "/home/user/code/my-app",
          setUp: true,
          source: "sessions",
          uncommitted: true,
          worktrees: 3,
        },
        {
          current: false,
          id: "b7c1",
          lastUsed: null,
          name: "api-service",
          path: "/home/user/code/api-service",
          setUp: false,
          source: "added",
          uncommitted: null,
          worktrees: null,
        },
      ],
    });
  });

  test("a merge verdict, in the page's words: each kind has its tone and its reason", () => {
    expect(
      branchVerdictOf({ detail: null, kind: "allowed", reason: "reviewed at abc123" }),
    ).toEqual({
      kind: "allowed",
      label: "allowed",
      reason: "reviewed at abc123",
      tone: "ok",
    });
    expect(
      branchVerdictOf({ detail: null, kind: "refused", number: 4, reason: "no review recorded" }),
    ).toEqual({
      kind: "refused",
      label: "refused",
      reason: "no review recorded",
      tone: "warn",
    });
    expect(branchVerdictOf({ kind: "late", number: 4, what: "the review record" })).toEqual({
      kind: "late",
      label: "ran late",
      reason: "the review record",
      tone: "warn",
    });
    expect(branchVerdictOf({ kind: "unread", number: null, what: "gh is not installed" })).toEqual({
      kind: "unread",
      label: "not read",
      reason: "gh is not installed",
      tone: "info",
    });
    expect(branchVerdictOf({ kind: "silent" })).toEqual({
      kind: "silent",
      label: "no verdict",
      reason: null,
      tone: "info",
    });
  });

  test("a project that is not set up has no answers of its own, but its card keeps the defaults", () => {
    const data = projectOf({
      branches: [],
      branchesNote: "gh is not installed: the pull requests could not be read.",
      card: { ...CARD, set: false },
      checkedAt: "2026-10-20T10:05:00.000Z",
      project: { ...SUMMARY, set: false },
    });
    expect(data.answers).toBe(null);
    expect(data.setup.answers?.base).toBe("main");
    expect(data.branchesNote).toBe("gh is not installed: the pull requests could not be read.");
  });
});

describe("the page's requests", () => {
  test("a GET is same-origin JSON, and a refusal says so in words", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const ok = await getJson<{ a: number }>(async (input, init) => {
      calls.push({ init, input });
      return Response.json({ a: 1 });
    }, "/api/facts");
    expect(ok).toEqual({ a: 1 });
    expect(calls[0]?.input).toBe("/api/facts");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    const refused = getJson(async () => new Response("Forbidden", { status: 403 }), "/api/slots");
    await expect(refused).rejects.toThrow("The portal refused Reading /api/slots (403)");
    const failed = getJson(
      async () => Response.json({ error: "range must be one of 1h" }, { status: 400 }),
      "/api/flow",
    );
    await expect(failed).rejects.toThrow("Reading /api/flow failed: range must be one of 1h");
    const gone = getJson(async () => {
      throw new TypeError("Failed to fetch");
    }, "/api/work");
    await expect(gone).rejects.toBeInstanceOf(PortalRequestError);
  });

  test("an action is a POST with the page's CSRF value; its own refusal is a result", async () => {
    const sent: { input: string; init: RequestInit | undefined }[] = [];
    const result = await postAction(
      async (input, init) => {
        sent.push({ init, input });
        return Response.json({ lines: ["Pick a slot."], ok: false }, { status: 400 });
      },
      "slot.save",
      { slot: "worker" },
      "token-1",
    );
    expect(result).toEqual({ lines: ["Pick a slot."], ok: false });
    expect(sent[0]?.input).toBe("/api/slot.save");
    expect(sent[0]?.init?.method).toBe("POST");
    expect(new Headers(sent[0]?.init?.headers).get(CSRF_HEADER)).toBe("token-1");
    expect(sent[0]?.init?.body).toBe(JSON.stringify({ slot: "worker" }));
    // No CSRF value on the page: nothing is sent.
    await expect(postAction(async () => Response.json({}), "slot.save", {}, null)).rejects.toThrow(
      "no CSRF value",
    );
    // The door's refusal is not a result.
    await expect(
      postAction(async () => new Response("Forbidden", { status: 403 }), "slot.save", {}, "t"),
    ).rejects.toThrow("(403)");
  });
});

describe("the B6d facts", () => {
  const HOUR = 3_600_000;
  const T0 = Date.UTC(2026, 9, 23, 0, 0, 0);

  test("Machine: Claude Code, Bun, the MCP servers and doctor's time, as the server read them", () => {
    const answer = {
      autoMode: null,
      browser: {
        guide: { intro: "", notes: [], steps: [] },
        notes: [],
        state: {
          extensionInstalled: false,
          fileUrls: null,
          profile: false,
          profileDirName: "",
          tokenSet: false,
        },
      },
      bun: { minimum: "1.4.3", ok: true, version: "1.4.5" },
      claudeCode: {
        liveCheck: { claudeCode: "2.1.309", passedAt: "2026-10-20T08:00:00.000Z", plugin: "1.0.0" },
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
          key: { pool: false, refusedByHand: false, source: "portal", state: "gateway" },
          route: {
            address: "http://127.0.0.1:20128/v1",
            kind: "backend",
            model: "glm/flash",
            provider: "openai-compatible",
            refusedByHand: false,
            source: "portal",
            target: "omniroute:glm/flash",
          },
        },
        file: "~/.claude-mem/settings.json",
        handKeys: [],
        minVersion: "13.29.0",
        version: "13.40.0",
      },
      companions: [],
      doctor: {
        at: 1_000,
        checks: [{ group: "gateway", ok: false, fix: "run setup", text: "down" }],
      },
      gatewayKey: "none",
      jobs: null,
      mcp: [{ name: "playwright", runsWhat: null, state: "ours" }],
      omniroute: {
        backend: null,
        install: null,
        newestVersion: null,
        previous: null,
        registryError: null,
        state: "unknown",
        unit: null,
      },
      project: {} as MachineAnswer["project"],
      updates: { heldSince: null, installed: null, last: null, newest: null, summary: "" },
    } satisfies MachineAnswer;
    const facts = {
      platform: "linux" as const,
      portalPort: 20_101,
      router: null,
      version: "1.1.0",
    };
    const data = machineOf(answer, facts);
    expect(data.claudeCode).toEqual(answer.claudeCode);
    expect(data.claudeMem).toEqual(answer.claudeMem);
    expect(data.gatewayKey).toBe("none");
    expect(data.bun).toEqual({ minimum: "1.4.3", ok: true, version: "1.4.5" });
    expect(data.autoMode).toBe(null);
    expect(data.mcp).toEqual([{ name: "playwright", runsWhat: null, state: "ours" }]);
    expect(data.doctorAt).toBe(1_000);
    expect(data.doctor).toEqual([
      { fix: "run setup", mark: "fail", section: "gateway", text: "down" },
    ]);
    expect(machineOf({ ...answer, doctor: null }, facts).doctorAt).toBe(null);
  });

  test("the heavy jobs: the route, the slot in use, who holds it and who waits travel", () => {
    const held = {
      command: "tsc --noEmit",
      folder: "/home/user/my-app",
      kind: "tsc",
      pid: 41,
      since: "2026-10-26T10:00:00.000Z",
      slot: true,
      user: "host-a",
    };
    const answer: JobsAnswer = {
      route: { on: true, project: null, source: "personal" },
      stores: [
        {
          held: [held, { ...held, exclusive: "image", pid: 42, slot: false }],
          slots: 1,
          used: 1,
          waiting: [{ ...held, pid: 43, since: null }],
          where: "machine",
        },
      ],
    };
    const data = jobsOf(answer);
    expect(Object.keys(data).sort()).toEqual(["route", "stores"]);
    expect(data.route).toEqual({ on: true, project: null, source: "personal" });
    const [store] = data.stores;
    expect([store?.slots, store?.used]).toEqual([1, 1]);
    expect(store?.held.map((job) => [job.pid, job.slot, job.exclusive])).toEqual([
      [41, true, undefined],
      [42, false, true],
    ]);
    expect(store?.held[0]?.since).toBe(Date.parse("2026-10-26T10:00:00.000Z"));
    expect(store?.waiting[0]?.since).toBe(null);
  });

  test("Flow: 24 hours drawn per hour, 7 days per 6 hours, from the server's hours", () => {
    const hours = Array.from({ length: 12 }, (_, index) => ({
      launches: index,
      promptMs: index * 1_000,
      prompts: index === 0 ? 0 : 1,
      replies: index,
      t: T0 + index * HOUR,
    }));
    const answer = {
      from: T0,
      note: null,
      range: "1d",
      report: { hours } as unknown as FlowAnswer["report"],
      to: T0 + 12 * HOUR,
    } satisfies FlowAnswer;
    const day = flowOf(answer, "24h");
    expect(day.buckets.bucketMs).toBe(HOUR);
    expect(day.buckets.points[3]).toEqual({ blockedMs: 3_000, launches: 3, t: T0 + 3 * HOUR });
    expect(day.buckets.points).toHaveLength(12);
    const week = flowOf(answer, "7d");
    expect(week.buckets.bucketMs).toBe(6 * HOUR);
    // Hours 0-5 and 6-11, each summed: 0+1+2+3+4+5 and 6+7+8+9+10+11.
    expect(week.buckets.points).toEqual([
      { blockedMs: 15_000, launches: 15, t: T0 },
      { blockedMs: 51_000, launches: 51, t: T0 + 6 * HOUR },
    ]);
  });
});

describe("the flow report that did not run (B6e)", () => {});

describe("a project's Workflow card (D57)", () => {
  /** Two rows as `/api/settings` sends them: the portal's own folder's values, the specs. */
  const SPECS: SettingsRow[] = [
    {
      card: "flow",
      help: "Commit each finished, reviewed step without asking.",
      id: "set-commit",
      key: "autoCommit",
      kind: "boolean",
      label: "Auto commit",
      readOnly: false,
      source: "personal",
      value: false,
      where: "personal",
      why: null,
    },
    {
      card: "switches",
      help: "Show the kit's status line.",
      id: "set-status",
      key: "switches.statusLine",
      kind: "boolean",
      label: "Status line",
      readOnly: false,
      source: "default",
      value: true,
      where: "personal",
      why: null,
    },
    {
      card: "switches",
      help: "Name each session after its branch.",
      id: "set-names",
      key: "switches.sessionNames",
      kind: "boolean",
      label: "Session names",
      readOnly: true,
      source: "default",
      value: false,
      where: "project",
      why: "this project has no .claude/cc-smart-dev-kit.json yet",
    },
  ];
  const ANSWER: ProjectWorkflowAnswer = {
    base: "main",
    gh: "in",
    note: null,
    settings: [
      { key: "switches.sessionNames", source: "project", value: true },
      { key: "autoCommit", source: "project", value: true },
    ],
  };

  test("without a gh login every control is read-only; the card says why once", () => {
    for (const gh of ["missing", "out"] as const) {
      const data = projectWorkflowOf({ ...ANSWER, gh }, SPECS);
      expect(data.gh).toBe(gh);
      expect(data.rows.map((row) => [row.readOnly, row.why])).toEqual([
        [true, null],
        [true, null],
      ]);
    }
  });

  test("the live client reads both answers, and fails when the rows' words cannot be read", async () => {
    const stream = { connection: () => () => {}, on: () => () => {}, stop: () => {} };
    const settings = { autoMerge: null, clashes: [], error: null, projectNote: null, rows: SPECS };
    const asked: string[] = [];
    const world = (settingsStatus: number) => ({
      fetch: async (path: string) => {
        asked.push(path);
        if (path === "/api/settings") {
          return new Response(
            JSON.stringify(settingsStatus === 200 ? settings : { error: "boom" }),
            {
              status: settingsStatus,
            },
          );
        }
        return new Response(JSON.stringify(ANSWER), { status: 200 });
      },
      stream,
    });
    const data = await liveClient(world(200)).projectWorkflow("a1/f0");
    expect(asked.sort()).toEqual(["/api/projects/a1%2Ff0/workflow", "/api/settings"]);
    expect(data.rows.map((row) => row.key)).toEqual(["autoCommit", "switches.sessionNames"]);
    await expect(liveClient(world(500)).projectWorkflow("a1f0")).rejects.toThrow("boom");
  });

  test("a note and no settings stays a note", () => {
    const data = projectWorkflowOf(
      { base: null, gh: "in", note: "no worktrees.base", settings: [] },
      SPECS,
    );
    expect(data).toEqual({ base: null, gh: "in", note: "no worktrees.base", others: [], rows: [] });
  });

  test("a value as the command takes it: a word, a number, a list with commas", () => {
    expect(proposeValueText(true)).toBe("true");
    expect(proposeValueText(false)).toBe("false");
    expect(proposeValueText(85)).toBe("85");
    expect(proposeValueText("draft")).toBe("draft");
    expect(proposeValueText(["needs-you", "failed"])).toBe("needs-you,failed");
  });

  test("a value as the card shows it", () => {
    expect(workflowValueText(true)).toBe("on");
    expect(workflowValueText(false)).toBe("off");
    expect(workflowValueText(20)).toBe("20");
    expect(workflowValueText("my-app")).toBe("my-app");
    expect(workflowValueText(["a", "b"])).toBe("a, b");
    expect(workflowValueText([])).toBe("nothing");
    expect(workflowValueText(null)).toBe("not set");
    // The words `workflow show` prints for an unset key that something stands in for.
    expect(workflowValueText(null, "(the main checkout's folder name)")).toBe(
      "(the main checkout's folder name)",
    );
    expect(workflowValueText("my-app", "(the main checkout's folder name)")).toBe("my-app");
  });
});

test("the Overview: the router's facts, the chains, and the plan window", () => {
  const answer: OverviewAnswer = {
    backends: [],
    configured: true,
    dashboardUrl: null,
    error: null,
    fallbacks: [],
    fiveHour: { percent: 61, resetsAt: "2026-10-23T14:00:00.000Z" },
    jobs: { slots: 3, used: 1, waiting: 1 },
    limits: [],
    limitsRead: true,
    requests: { perMinute: 21.6, sinceRouterStart: 892 },
    router: ROUTER,
    slots: [SLOTS_ROW],
    switches: {
      gateway: true,
      judge: false,
      judgeUntested: false,
      models: false,
      settingsBaseUrl: null,
      warnings: [],
    },
    warnings: [],
  };
  const data = overviewOf(answer);
  expect(data.health.cooling).toEqual({ "omniroute:minimax-m3": 30 });
  expect(data.health.slots).toEqual({ "cc-smart-dev-kit-worker": ["omniroute:glm-5.3"] });
  expect(data.health.recent).toEqual([
    {
      at: 10,
      ms: 120,
      next: true,
      slot: "cc-smart-dev-kit-worker",
      status: 200,
      target: "omniroute:glm-5.3",
    },
  ]);
  // The status line's own reading, with its reset as a time; the switches as the server says.
  expect(data.fiveHour).toEqual({ percent: 61, resetsAt: Date.UTC(2026, 9, 23, 14, 0, 0) });
  expect(data.switches.gateway).toBe(true);
  expect(overviewOf({ ...answer, fiveHour: null }).fiveHour).toBe(null);
  expect(() =>
    overviewOf({ ...answer, configured: false, error: "the gateway is not set up" }),
  ).toThrow(NotSetUpError);
});
