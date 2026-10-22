/**
 * The translation from the server's answers to the pages' shapes, and the page's requests:
 * every expected value is written by hand. A fact the server does not send stays unknown.
 */
import { describe, expect, test } from "bun:test";
import {
  crewOf,
  guardAsksOf,
  healthOf,
  NotSetUpError,
  needsOf,
  overviewOf,
  projectsOf,
  workOf,
} from "./adapt";
import { CSRF_HEADER, getJson, PortalRequestError, postAction } from "./http";
import type {
  CrewAnswer,
  CrewSummary,
  HealthAnswer,
  NeedsAnswer,
  OverviewAnswer,
  RouterFacts,
  WorkAnswer,
} from "./wire";

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

const CREW: CrewSummary = {
  base: { ref: "main", sha: "a".repeat(40) },
  branch: "crew/b6c",
  createdAt: "2026-10-22T10:00:00.000Z",
  effort: "high",
  id: "crew-1",
  kind: "ui",
  lastLine: null,
  leadName: "LEAD my-app plan",
  leadSessionId: "lead-1",
  memoryMb: 512,
  model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
  name: "C my-app B6c slots",
  phase: "B6c",
  plan: "plan.md",
  pr: null,
  question: null,
  shortId: "abc123",
  slug: "slots",
  state: "working",
  stateSince: "2026-10-22T10:05:00.000Z",
  updatedAt: "2026-10-22T10:06:00.000Z",
  waitingFor: null,
  worktree: "/home/user/my-app/.claude/worktrees/b6c",
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
  test("the Overview: the router's facts, the chains, and the running crew counted", () => {
    const answer: OverviewAnswer = {
      backends: [],
      configured: true,
      dashboardUrl: null,
      error: null,
      fallbacks: [],
      jobs: { budgetGb: 8, heldGb: 2, waiting: 1 },
      limits: [],
      limitsRead: true,
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
    const work: WorkAnswer = {
      crew: [CREW, { ...CREW, id: "crew-2", state: "done" }],
      lead: null,
      note: null,
      repo: "/home/user/my-app",
      sessions: [],
    };
    const data = overviewOf(answer, work);
    expect(data.crewRunning).toBe(1);
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
    // Claude Code writes its usage down nowhere: no window is made up.
    expect(data.usage).toEqual([]);
    expect(() =>
      overviewOf({ ...answer, configured: false, error: "the gateway is not set up" }, null),
    ).toThrow(NotSetUpError);
  });

  test("Health: no socket fact is invented", () => {
    const answer: HealthAnswer = {
      backends: [],
      configured: true,
      error: null,
      fallbacks: [],
      limits: [],
      log: { lines: [{ level: "WARN", text: "a backend failed", time: "10:00:00" }], note: null },
      router: ROUTER,
    };
    const data = healthOf(answer);
    expect(data.socket).toBe(null);
    expect(data.log).toEqual([{ level: "WARN", text: "a backend failed", time: "10:00:00" }]);
  });

  test("Work: the lead's crew, and a session with no end marker is open, not working", () => {
    const data = workOf({
      crew: [CREW],
      lead: {
        createdAt: "2026-10-22T09:00:00.000Z",
        crew: [CREW],
        cwd: "/home/user/my-app",
        name: "LEAD my-app plan",
        pausedAgents: [],
        plan: "plan.md",
        sessionId: "lead-1",
        tag: "my-app",
        updatedAt: "2026-10-22T10:00:00.000Z",
      },
      note: null,
      repo: "/home/user/my-app",
      sessions: [
        {
          branch: "main",
          endedCleanly: false,
          folder: "/home/user/my-app",
          id: "s1",
          lastWrite: 0,
          name: null,
        },
        { branch: null, endedCleanly: true, folder: null, id: "s2", lastWrite: 0, name: "notes" },
      ],
    });
    expect(data.leads[0]?.crew[0]?.state).toBe("working");
    expect(data.leads).toHaveLength(1);
    expect(data.leads[0]?.crew[0]?.repo).toBe("/home/user/my-app");
    expect(data.others.map((one) => [one.sessionId, one.state, one.model])).toEqual([
      ["s1", "open", null],
      ["s2", "idle", null],
    ]);
  });

  test("Work: a crew session of another lead is shown under that lead's own name", () => {
    const data = workOf({
      crew: [{ ...CREW, id: "crew-9", leadName: "LEAD my-app old", leadSessionId: "lead-0" }],
      lead: null,
      note: null,
      repo: "/home/user/my-app",
      sessions: [],
    });
    expect(data.leads.map((group) => [group.lead.name, group.crew.map((one) => one.id)])).toEqual([
      ["LEAD my-app old", ["crew-9"]],
    ]);
  });

  test("a crew page: the verdict in words, the diff in totals, the open question", () => {
    const answer: CrewAnswer = {
      brief: null,
      crew: {
        ...CREW,
        question: {
          askedAt: "2026-10-22T10:07:00.000Z",
          options: ["yes", "no"],
          question: "Ship?",
          recommended: 1,
        },
      },
      diff: { deletions: 3, error: null, files: 2, insertions: 40, outsideBrief: [] },
      events: [
        {
          at: "2026-10-22T10:01:00.000Z",
          note: null,
          sha: null,
          state: "working",
          text: "started",
          type: "step",
        },
      ],
      mergeCheck: { kind: "refused", number: 7, reason: "no review recorded" },
      report: null,
      reviews: [],
    };
    const data = crewOf(answer);
    expect(data.brief).toBe("");
    expect(data.diffTotals).toEqual({ deletions: 3, error: null, files: 2, insertions: 40 });
    expect(data.mergeCheck).toEqual({
      allowed: false,
      delta: null,
      limits: null,
      reason: "no review recorded",
      review: null,
      reviewed: null,
    });
    expect(data.questions.map((one) => one.question)).toEqual(["Ship?"]);
    expect(crewOf({ ...answer, mergeCheck: { kind: "silent" } }).mergeCheck).toBe(null);
  });

  test("Needs you: a question, a session's prompt, a held update, a breaker, newest first", () => {
    const answer: NeedsAnswer = {
      breaker: {
        held: 4,
        since: "2026-10-22T10:03:00.000Z",
        slot: "cc-smart-dev-kit-fable",
        targets: [{ status: 429, target: "omniroute:kimi-k3", until: "2026-10-22T10:10:00.000Z" }],
      },
      crew: [
        {
          askedAt: "2026-10-22T10:05:00.000Z",
          crew: { id: "crew-1", name: "C my-app B6c slots", shortId: "abc123", state: "blocked" },
          options: ["a", "b"],
          question: "Which?",
          recommended: 2,
        },
      ],
      doctor: { at: null, failures: [] },
      permissions: [
        {
          asker: "git-guard",
          at: Date.parse("2026-10-22T10:04:00.000Z"),
          kind: null,
          project: "my-app",
          session: "s1",
          tool: "Bash",
        },
      ],
      update: { at: "2026-10-22T10:01:00.000Z", from: "1.0.0", notes: [], version: "2.0.0" },
    };
    const data = needsOf(answer, "1.1.0");
    expect(data.items.map((item) => item.kind)).toEqual([
      "question",
      "permission",
      "breaker",
      "update",
    ]);
    const breaker = data.items.find((item) => item.kind === "breaker");
    // How many wait right now is not in the answer: unknown, never 0.
    expect(breaker?.kind === "breaker" ? breaker.breaker.heldNow : "missing").toBe(null);
    const permission = data.items.find((item) => item.kind === "permission");
    expect(permission?.kind === "permission" ? permission.crew : "missing").toBe(null);
  });

  test("the guard log: the range kept here, one series per guard, newest first", () => {
    const now = Date.UTC(2026, 9, 22, 12, 0, 0);
    const page = guardAsksOf(
      {
        asks: [
          {
            at: now - 10 * 60_000,
            hook: "git-guard",
            reason: "a push",
            session: "s1",
            tool: "Bash",
          },
          {
            at: now - 5 * 60_000,
            hook: "git-guard",
            reason: "a push",
            session: "s1",
            tool: "Bash",
          },
          {
            at: now - 2 * 86_400_000,
            hook: "merge-guard",
            reason: "old",
            session: "s2",
            tool: "Bash",
          },
        ],
        byHook: { "git-guard": 2, "merge-guard": 1 },
        kept: 3,
        skipped: 0,
      },
      { cursor: null, range: "1h" },
      now,
    );
    expect(page.rows.map((row) => row.at)).toEqual([now - 5 * 60_000, now - 10 * 60_000]);
    expect(page.guards).toEqual(["git-guard", "merge-guard"]);
    expect(page.sessions).toEqual(["s1"]);
    expect(page.buckets.series.map((one) => [one.key, one.points.length])).toEqual([
      ["git-guard", 2],
    ]);
  });

  test("projects: unknown counts stay unknown", () => {
    const rows = projectsOf({
      current: {
        answers: null,
        error: null,
        filesHash: null,
        name: "my-app",
        plan: null,
        planError: null,
        root: "/home/user/my-app",
        set: true,
      },
      note: null,
      projects: [{ configFile: null, name: "my-app", root: "/home/user/my-app", set: true }],
    });
    expect(rows).toEqual([
      {
        id: "/home/user/my-app",
        lastUsed: null,
        name: "my-app",
        path: "/home/user/my-app",
        setUp: true,
        worktrees: null,
      },
    ]);
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
