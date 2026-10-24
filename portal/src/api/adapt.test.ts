/**
 * The translation from the server's answers to the pages' shapes, and the page's requests:
 * every expected value is written by hand. A fact the server does not send stays unknown.
 */
import { describe, expect, test } from "bun:test";
import {
  branchVerdictOf,
  crewOf,
  flowOf,
  guardAsksOf,
  healthOf,
  jobsOf,
  machineOf,
  mergeCheckOf,
  NotSetUpError,
  needsOf,
  overviewOf,
  projectOf,
  projectsOf,
  projectWorkflowOf,
  proposeValueText,
  workflowValueText,
  workOf,
  worktreesOf,
} from "./adapt";
import { GUARD_PAGE_SIZE, guardQuery, liveClient } from "./client";
import { CSRF_HEADER, getJson, PortalRequestError, postAction } from "./http";
import type { SettingsRow } from "./types";
import type {
  CrewAnswer,
  CrewSummary,
  FlowAnswer,
  HealthAnswer,
  JobsAnswer,
  MachineAnswer,
  NeedsAnswer,
  OverviewAnswer,
  ProjectAnswer,
  ProjectCardData,
  ProjectSummary,
  ProjectWorkflowAnswer,
  RouterFacts,
  WorkAnswer,
  WorktreesAnswer,
} from "./wire";

const WORKTREES_EMPTY: WorktreesAnswer = {
  autoClean: null,
  base: "main",
  from: "default",
  note: null,
  worktrees: [],
};

const CARD: ProjectCardData = {
  answers: {
    base: "main",
    bases: { "crew/": "release" },
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

const CREW: CrewSummary = {
  base: { ref: "main", sha: "a".repeat(40) },
  branch: "crew/b6c",
  createdAt: "2026-10-22T10:00:00.000Z",
  effort: "high",
  files: ["portal/src/**", "README.md"],
  id: "crew-1",
  kind: "ui",
  lastEvent: { at: "2026-10-22T10:04:00.000Z", text: "tests-green", type: "step" },
  lastLine: null,
  leadName: "LEAD my-app plan",
  leadSessionId: "lead-1",
  memory: [
    { at: "2026-10-22T10:01:00.000Z", mb: 480 },
    { at: "2026-10-22T10:06:00.000Z", mb: 512 },
  ],
  memoryMb: 512,
  model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
  name: "C my-app B6c slots",
  phase: "B6c",
  plan: "plan.md",
  pr: null,
  question: null,
  repo: "/home/user/my-app",
  shortId: "abc123",
  slug: "slots",
  state: "working",
  stateSince: "2026-10-22T10:05:00.000Z",
  updatedAt: "2026-10-22T10:06:00.000Z",
  waitingFor: null,
  waitsFor: [],
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
      fiveHour: { percent: 61, resetsAt: "2026-10-23T14:00:00.000Z" },
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
      folderNote: null,
      leads: [],
      note: null,
      repo: "/home/user/my-app",
      waitsError: null,
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
    // The status line's own reading, with its reset as a time; the switches as the server says.
    expect(data.fiveHour).toEqual({ percent: 61, resetsAt: Date.UTC(2026, 9, 23, 14, 0, 0) });
    expect(data.switches.gateway).toBe(true);
    expect(overviewOf({ ...answer, fiveHour: null }, work).fiveHour).toBe(null);
    expect(() =>
      overviewOf({ ...answer, configured: false, error: "the gateway is not set up" }, null),
    ).toThrow(NotSetUpError);
  });

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

  test("Work: the lead's crew, and each other session's state and model as the server read them", () => {
    const data = workOf({
      crew: [CREW],
      leads: [
        {
          createdAt: "2026-10-22T09:00:00.000Z",
          crew: [CREW],
          cwd: "/home/user/my-app",
          name: "LEAD my-app plan",
          pausedAgents: [],
          plan: "plan.md",
          repo: "/home/user/my-app",
          sessionId: "lead-1",
          tag: "my-app",
          updatedAt: "2026-10-22T10:00:00.000Z",
        },
      ],
      folderNote: null,
      note: null,
      repo: "/home/user/my-app",
      waitsError: null,
      sessions: [
        {
          branch: "main",
          folder: "/home/user/my-app",
          id: "s1",
          lastWrite: 0,
          model: "glm-5.3-flash",
          name: null,
          state: "waiting",
        },
        {
          branch: null,
          folder: null,
          id: "s2",
          lastWrite: 0,
          model: null,
          name: "notes",
          state: "ended",
        },
      ],
    });
    expect(data.leads[0]?.crew[0]?.state).toBe("working");
    // The files it owns, its newest step, and its memory line come from its summary.
    expect(data.leads[0]?.crew[0]?.files).toEqual(["portal/src/**", "README.md"]);
    expect(data.leads[0]?.lastStep["crew-1"]?.text).toBe("tests-green");
    expect(data.memory["crew-1"]).toEqual([
      { at: Date.UTC(2026, 9, 22, 10, 1, 0), mb: 480 },
      { at: Date.UTC(2026, 9, 22, 10, 6, 0), mb: 512 },
    ]);
    expect(data.leads).toHaveLength(1);
    expect(data.leads[0]?.crew[0]?.repo).toBe("/home/user/my-app");
    expect(data.others.map((one) => [one.sessionId, one.state, one.model])).toEqual([
      ["s1", "waiting", "glm-5.3-flash"],
      ["s2", "ended", null],
    ]);
  });

  test("Work: a crew session of another lead is shown under that lead's own name", () => {
    const data = workOf({
      crew: [{ ...CREW, id: "crew-9", leadName: "LEAD my-app old", leadSessionId: "lead-0" }],
      folderNote: null,
      leads: [],
      note: null,
      repo: "/home/user/my-app",
      waitsError: null,
      sessions: [],
    });
    expect(data.leads.map((group) => [group.lead.name, group.crew.map((one) => one.id)])).toEqual([
      ["LEAD my-app old", ["crew-9"]],
    ]);
  });

  test("Work: the normal-start line is quiet, and a store that could not be read stays a warning", () => {
    // An empty list must say why. A folder that is no project is the portal's normal start
    // (the home folder), so its line goes in `folderNote`; a store that could not be read is
    // a failure and stays in `note`.
    const quiet = workOf({
      crew: [],
      folderNote:
        "this folder is not in a git project, so the other Claude Code sessions of a project are not listed; the crew sessions of every repository are",
      leads: [],
      note: null,
      repo: null,
      sessions: [],
      waitsError: null,
    });
    expect(quiet.folderNote).toContain("not in a git project");
    expect(quiet.note).toBe(null);
    expect(quiet.leads).toEqual([]);
    const broken = workOf({
      crew: [],
      folderNote: null,
      leads: [],
      note: "the crew store could not be read: EACCES: permission denied",
      repo: null,
      sessions: [],
      waitsError: null,
    });
    expect(broken.note).toContain("could not be read");
    expect(broken.folderNote).toBe(null);
  });

  test("a crew page: the verdict in full, the diff per file, memory, reviews, the question", () => {
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
      diff: {
        byFile: [
          { added: 30, deleted: 3, path: "src/a.ts" },
          { added: null, deleted: null, path: "assets/logo.png" },
        ],
        deletions: 3,
        error: null,
        files: 2,
        insertions: 40,
        outsideBrief: [],
      },
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
      memory: [
        { at: "2026-10-22T10:01:00.000Z", mb: 300 },
        { at: "2026-10-22T10:06:00.000Z", mb: 512 },
      ],
      mergeCheck: {
        detail: {
          allowance: { files: 5, lines: 61 },
          delta: { binary: 0, files: 2, lines: 74 },
          limits: { files: 5, lines: 50, percent: 10 },
          review: "4f2a9c1",
          reviewed: { binary: 1, files: 9, lines: 612 },
        },
        kind: "refused",
        number: 7,
        reason: "the change after the review is over the limit",
      },
      report: null,
      reviews: [{ at: "2026-10-22T10:05:00.000Z", by: ["reviewer"], sha: "4f2a9c1" }],
    };
    const data = crewOf(answer);
    expect(data.brief).toBe("");
    expect(data.diffTotals).toEqual({ deletions: 3, error: null, files: 2, insertions: 40 });
    // A binary file has no line counts: unknown, never 0.
    expect(data.diff).toEqual([
      { added: 30, path: "src/a.ts", removed: 3 },
      { added: null, path: "assets/logo.png", removed: null },
    ]);
    expect(data.memory).toEqual([
      { at: Date.parse("2026-10-22T10:01:00.000Z"), mb: 300 },
      { at: Date.parse("2026-10-22T10:06:00.000Z"), mb: 512 },
    ]);
    expect(data.mergeCheck).toEqual({
      allowance: { files: 5, lines: 61 },
      allowed: false,
      delta: { binary: 0, files: 2, lines: 74 },
      kind: "refused",
      limits: { files: 5, lines: 50, percent: 10 },
      pr: 7,
      reason: "the change after the review is over the limit",
      review: "4f2a9c1",
      reviewed: { binary: 1, files: 9, lines: 612 },
    });
    expect(data.reviews).toEqual([
      { at: "2026-10-22T10:05:00.000Z", by: ["reviewer"], sha: "4f2a9c1" },
    ]);
    expect(data.questions.map((one) => one.question)).toEqual(["Ship?"]);
    expect(crewOf({ ...answer, mergeCheck: { kind: "silent" } }).mergeCheck).toBe(null);
  });

  test("the merge verdict: allowed with no detail, and one the guard could not read", () => {
    expect(mergeCheckOf({ detail: null, kind: "allowed", reason: "reviewed at the head" })).toEqual(
      {
        allowance: null,
        allowed: true,
        delta: null,
        kind: "allowed",
        limits: null,
        pr: null,
        reason: "reviewed at the head",
        review: null,
        reviewed: null,
      },
    );
    expect(mergeCheckOf({ kind: "unread", number: 3, what: "gh is not signed in" })).toEqual({
      allowance: null,
      allowed: false,
      delta: null,
      kind: "unread",
      limits: null,
      pr: 3,
      reason: "gh is not signed in",
      review: null,
      reviewed: null,
    });
  });

  test("Needs you: every open breaker, doctor's fix, the attach command, newest first", () => {
    const answer: NeedsAnswer = {
      breakers: [
        {
          held: 4,
          heldNow: 2,
          since: "2026-10-22T10:03:00.000Z",
          slot: "cc-smart-dev-kit-fable",
          targets: [
            { status: 429, target: "omniroute:kimi-k3", until: "2026-10-22T10:10:00.000Z" },
          ],
        },
        {
          held: 1,
          heldNow: null,
          since: "2026-10-22T09:00:00.000Z",
          slot: "cc-smart-dev-kit-worker",
          targets: [],
        },
      ],
      crew: [
        {
          askedAt: "2026-10-22T10:05:00.000Z",
          crew: { id: "crew-1", name: "C my-app B6c slots", shortId: "abc123", state: "blocked" },
          options: ["a", "b"],
          question: "Which?",
          recommended: 2,
        },
      ],
      doctor: {
        at: Date.parse("2026-10-22T08:00:00.000Z"),
        failures: [
          { fix: "cc-smart-dev-kit setup", section: "mcp", text: "a server is missing" },
          { fix: null, section: null, text: "something else" },
        ],
      },
      permissionsError: null,
      permissions: [
        {
          asker: "git-guard",
          at: Date.parse("2026-10-22T10:04:00.000Z"),
          attach: "claude attach abc123",
          crew: { id: "crew-1", name: "C my-app B6c slots", shortId: "abc123" },
          kind: null,
          project: "my-app",
          session: "abc123-full-session-id",
          tool: "Bash",
        },
        {
          asker: "claude",
          at: Date.parse("2026-10-22T10:02:00.000Z"),
          attach: null,
          crew: null,
          kind: "a file write",
          project: "my-app",
          session: "s9",
          tool: "Write",
        },
      ],
      update: { at: "2026-10-22T10:01:00.000Z", from: "1.0.0", notes: [], version: "2.0.0" },
    };
    const data = needsOf(answer, "1.1.0");
    expect(data.items.map((item) => item.id)).toEqual([
      "question-crew-1-2026-10-22T10:05:00.000Z",
      "permission-abc123-full-session-id-1792663440000",
      "breaker-cc-smart-dev-kit-fable",
      "permission-s9-1792663320000",
      "update-2.0.0",
      "breaker-cc-smart-dev-kit-worker",
      "doctor-0",
      "doctor-1",
    ]);
    const breakers = data.items.flatMap((item) => (item.kind === "breaker" ? [item] : []));
    // How many wait right now is the router's; when it does not say, unknown, never 0.
    expect(breakers.map((item) => [item.breaker.heldNow, item.command])).toEqual([
      [2, "cc-smart-dev-kit gateway slot fable claude"],
      [null, "cc-smart-dev-kit gateway slot worker claude"],
    ]);
    const doctor = data.items.flatMap((item) => (item.kind === "doctor" ? [item] : []));
    expect(doctor.map((item) => [item.section, item.text, item.fix, item.since])).toEqual([
      ["mcp", "a server is missing", "cc-smart-dev-kit setup", "2026-10-22T08:00:00.000Z"],
      ["", "something else", null, "2026-10-22T08:00:00.000Z"],
    ]);
    const waits = data.items.flatMap((item) => (item.kind === "permission" ? [item] : []));
    // The server names the crew session and its attach command; a session it does not name has
    // no command (a session in its own terminal cannot be attached), never one made up here.
    expect(waits.map((item) => [item.crew?.id ?? null, item.attach])).toEqual([
      ["crew-1", "claude attach abc123"],
      [null, null],
    ]);
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

  test("worktrees: idle time and auto-clean's last run, the main checkout left out", () => {
    const data = worktreesOf(
      {
        autoClean: {
          base: "main",
          lastRunAt: "2026-10-22T09:00:00.000Z",
          removed: [
            {
              branch: "crew/a",
              name: "a",
              path: "/home/user/my-app/.claude/worktrees/a",
              why: "its pull request is merged",
            },
          ],
        },
        base: "main",
        from: "config",
        note: null,
        worktrees: [
          {
            branch: "main",
            head: "a1",
            idleMinutes: null,
            kind: "main",
            path: "/home/user/my-app",
            why: null,
          },
          {
            branch: "crew/b",
            head: "b1",
            idleMinutes: 42,
            kind: "kept",
            path: "/home/user/my-app/.claude/worktrees/b",
            why: "uncommitted changes",
          },
          {
            branch: "crew/c",
            head: "c1",
            idleMinutes: 300,
            kind: "finished",
            path: "/home/user/my-app/.claude/worktrees/c",
            why: "merged into main",
          },
        ],
      },
      "my-app",
    );
    expect(data.rows.map((row) => [row.branch, row.idleMinutes, row.verdict])).toEqual([
      ["crew/b", 42, { finished: false, held: false, why: "uncommitted changes" }],
      ["crew/c", 300, { finished: true, note: "merged into main" }],
    ]);
    expect(data.autoClean?.removed.map((one) => one.name)).toEqual(["a"]);
    expect(worktreesOf({ ...WORKTREES_EMPTY, autoClean: null }, "my-app").autoClean).toBe(null);
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

  test("a project's page: its row, its branches, its card; settings only for the current one", () => {
    const answer: ProjectAnswer = {
      branches: [
        {
          base: "main",
          branch: "feature/login",
          draft: false,
          kind: "pr",
          number: 12,
          title: "Add the login page",
          verdict: { detail: null, kind: "allowed", reason: "reviewed at abc123" },
        },
        {
          base: null,
          branch: "crew/B2-api",
          draft: true,
          kind: "crew",
          number: null,
          title: null,
          verdict: { kind: "silent" },
        },
      ],
      branchesNote: null,
      card: CARD,
      checkedAt: "2026-10-20T10:05:00.000Z",
      project: SUMMARY,
    };
    const data = projectOf(answer);
    expect(data.project.id).toBe("a1f0");
    // The card's answers lose the opaque workflow object: the page draws four fields.
    expect(data.answers).toEqual({
      base: "main",
      bases: { "crew/": "release" },
      guards: { guardMainFolder: true, jobRoute: false, sessionNames: true },
      protectedBranches: ["main"],
    });
    expect(data.setup).toEqual({ answers: data.answers, error: null, planError: null });
    expect(data.branches.map((one) => [one.branch, one.kind, one.verdict.label])).toEqual([
      ["feature/login", "pr", "allowed"],
      ["crew/B2-api", "crew", "no verdict"],
    ]);
    expect(data.branchesNote).toBe(null);
    expect(data.checkedAt).toBe("2026-10-20T10:05:00.000Z");
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
      warp: { detail: "", installed: false },
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

  test("the heavy jobs: the CPU and I/O weights travel, or why one is not set", () => {
    const answer: JobsAnswer = {
      budgetGb: 8,
      freeGb: 12,
      keptGb: 4,
      memoryGb: 32,
      stores: [],
      weights: { cpu: { value: 20 }, io: { value: null, why: "the io controller is off" } },
    };
    expect(jobsOf(answer).weights).toEqual({
      cpu: { value: 20 },
      io: { value: null, why: "the io controller is off" },
    });
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

describe("the flow report that did not run (B6e)", () => {
  test("Needs you says the permission prompts are missing, and why", () => {
    const data = needsOf(
      {
        breakers: [],
        crew: [],
        doctor: { at: null, failures: [] },
        permissions: [],
        permissionsError: "the flow report did not run (exit 3): no bun",
        update: null,
      },
      "1.1.0",
    );
    expect(data).toEqual({
      items: [],
      note: "Permission prompts could not be read: the flow report did not run (exit 3): no bun",
    });
  });

  test("Work says no session can show a wait, and why; none when the report ran", () => {
    const answer = {
      crew: [],
      folderNote: null,
      leads: [],
      note: null,
      repo: "/home/user/my-app",
      sessions: [],
    };
    expect(workOf({ ...answer, waitsError: "the plugin is not installed" }).waitsNote).toBe(
      "No session can show that it waits on a prompt: the plugin is not installed",
    );
    expect(workOf({ ...answer, waitsError: null }).waitsNote).toBe(null);
  });
});

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
      { key: "crew.tag", source: "default", value: null },
    ],
  };

  test("each setting takes its row's words and control, with the project's value and source", () => {
    const data = projectWorkflowOf(ANSWER, SPECS);
    expect(data.base).toBe("main");
    expect(data.gh).toBe("in");
    expect(data.note).toBe(null);
    // The rows keep the specs' order (the groups' order on Settings), not the answer's; a
    // setting the project's file cannot hold (the status line) is not on the card.
    expect(
      data.rows.map((row) => [row.key, row.label, row.value, row.source, row.where, row.readOnly]),
    ).toEqual([
      ["autoCommit", "Auto commit", true, "project", "project", false],
      ["switches.sessionNames", "Session names", true, "project", "project", false],
    ]);
    // The portal folder's own reason for a read-only row is not this project's.
    expect(data.rows[1]?.why).toBe(null);
    // A setting with no row of its own is still shown, with its value.
    expect(data.others).toEqual([{ key: "crew.tag", source: "default", value: null }]);
  });

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
  });
});
