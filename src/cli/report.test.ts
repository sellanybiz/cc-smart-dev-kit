/**
 * `cc-smart-dev-kit report`: the options, the printed report and the JSON. The measures
 * themselves are `src/sessions/flow.test.ts`; here the expected lines are written by hand from
 * the format the command promises.
 */
import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowReport, SessionFlow } from "../sessions/flow";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { duration, formatFlow, reportOptions, runReport } from "./report";

const NOW = Date.UTC(2026, 9, 21, 18, 0, 0);
const SINCE = NOW - 7 * 24 * 3_600_000;
const PROJECT = "-home-user-my-app";
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const SECRET = "the private launch plan";

/** The session the formatter test prints, by hand. */
const SESSION_FLOW: SessionFlow = {
  activeMs: 241_000,
  agents: {
    launches: 4,
    launchesParallel: 2,
    mostAtOnce: 3,
    parallelRatio: 0.5,
    replies: 4,
    repliesParallel: 1,
  },
  autoModeBlocks: { classifier: 1, "Merge Without Review": 1 },
  background: { byOrigin: { human: 1, task_notification: 1 }, count: 2, totalMs: 1_500_000 },
  compactions: {
    byTrigger: { auto: 1, manual: 1 },
    count: 2,
    tokens: { post: 26_000, pre: 181_000 },
  },
  cwd: "/home/user/my-app",
  firstAt: Date.UTC(2026, 9, 21, 9),
  idle: { count: 1, totalMs: 2_700_000 },
  lastAt: Date.UTC(2026, 9, 21, 17, 5),
  merges: { byAsker: { "merge-guard": 1 }, byReason: { "review-missing": 1 }, count: 1 },
  project: PROJECT,
  prompts: {
    byAsker: {
      "Claude Code": { count: 2, ms: 180_000 },
      "merge-guard": { count: 1, ms: 300_000 },
    },
    count: 3,
    longestMs: 300_000,
    totalMs: 480_000,
  },
  questions: { askUserQuestion: 2, exitPlanMode: 0 },
  session: SESSION,
  skipped: 2,
};

/** The report the formatter test prints, by hand. */
function reportOne(): FlowReport {
  return {
    missing: [],
    open: [
      {
        asker: "merge-guard",
        at: NOW - 5 * 60_000,
        cwd: "/home/user/my-app",
        kind: "review-missing",
        project: PROJECT,
        session: SESSION,
        tool: "Bash",
      },
    ],
    sessions: [SESSION_FLOW],
    sinceMs: SINCE,
    skipped: { askLog: 1, records: 2 },
    totals: {
      activeMs: 241_000,
      agents: {
        launches: 4,
        launchesParallel: 2,
        mostAtOnce: 3,
        parallelRatio: 0.5,
        replies: 4,
        repliesParallel: 1,
      },
      autoModeBlocks: { classifier: 1, "Merge Without Review": 1 },
      background: { byOrigin: { human: 1, task_notification: 1 }, count: 2, totalMs: 1_500_000 },
      compactions: {
        byTrigger: { auto: 1, manual: 1 },
        count: 2,
        tokens: { post: 26_000, pre: 181_000 },
      },
      idle: { count: 1, totalMs: 2_700_000 },
      merges: { byAsker: { "merge-guard": 1 }, byReason: { "review-missing": 1 }, count: 1 },
      prompts: {
        byAsker: {
          "Claude Code": { count: 2, ms: 180_000 },
          "merge-guard": { count: 1, ms: 300_000 },
        },
        count: 3,
        longestMs: 300_000,
        totalMs: 480_000,
      },
      questions: { askUserQuestion: 2, exitPlanMode: 0 },
      sessions: 1,
      skipped: 2,
    },
    untilMs: NOW,
  };
}

describe("the report's options", () => {
  it("defaults to seven days, and takes hours or days, a project, a session and --json", () => {
    expect(reportOptions([])).toEqual({ hours: 168, json: false, project: null, session: null });
    expect(reportOptions(["--hours", "3"])).toEqual({
      hours: 3,
      json: false,
      project: null,
      session: null,
    });
    expect(reportOptions(["--days", "2", "--json"])).toEqual({
      hours: 48,
      json: true,
      project: null,
      session: null,
    });
    expect(reportOptions(["--project", "my-app", "--session", "aaaaaaaa"])).toEqual({
      hours: 168,
      json: false,
      project: "my-app",
      session: "aaaaaaaa",
    });
  });

  it("refuses both windows, a window past eight days, and a wrong option", () => {
    expect(reportOptions(["--hours", "1", "--days", "1"])).toEqual({
      error: "--hours and --days name the same window: give one",
    });
    expect(reportOptions(["--hours", "0"])).toEqual({
      error: '--hours wants a number above 0, not "0"',
    });
    expect(reportOptions(["--days", "x"])).toEqual({
      error: '--days wants a number above 0, not "x"',
    });
    expect(reportOptions(["--days", "9"])).toEqual({
      error: "the window is at most 8 days (the report's cache keeps 8)",
    });
    expect(reportOptions(["--hours"])).toEqual({ error: "Unknown option: --hours" });
    expect(reportOptions(["--weeks", "1"])).toEqual({ error: "Unknown option: --weeks" });
  });
});

describe("the printed report", () => {
  it("prints every measure, the totals, the causes and the calls waiting now", () => {
    expect(formatFlow(reportOne(), 168, "/home/user/.claude/projects", "/home/user", "UTC")).toBe(
      [
        "cc-smart-dev-kit report: the last 7 days, from ~/.claude/projects (read only; no message text)",
        "",
        "Waiting on you now: 1 call",
        "  ~/my-app  session aaaaaaaa  merge-guard asked for Bash (review-missing), 5 min ago",
        "",
        "~/my-app  session aaaaaaaa  (last active 2026-10-21 17:05)",
        "  active time: 4 min (the turns Claude Code timed)",
        "  agents: 4 launches in 4 replies; 1 with 2 or more (2 of 4 launches in parallel, 50 %); most at once 3",
        "  blocked on prompts: 3 prompts, 8 min in all, longest 5 min — merge-guard 1 (5 min), Claude Code 2 (3 min) (an upper bound: from the tool call's line to the person's answer)",
        "  questions: 2 questions (AskUserQuestion 2)",
        "  waiting on background work: 2 waits, 25 min (human 1, task_notification 1)",
        "  idle until the person wrote: 1 wait, 45 min",
        "  compactions: 2 (auto 1, manual 1; 181000 tokens in, 26000 out)",
        "  auto-mode blocks: 2 (classifier 1, Merge Without Review 1)",
        "  merges that asked: 1 (merge-guard 1); by reason: review-missing 1",
        "",
        "Totals over 1 session:",
        "  active time: 4 min (the turns Claude Code timed)",
        "  agents: 4 launches in 4 replies; 1 with 2 or more (2 of 4 launches in parallel, 50 %); most at once 3",
        "  blocked on prompts: 3 prompts, 8 min in all, longest 5 min — merge-guard 1 (5 min), Claude Code 2 (3 min) (an upper bound: from the tool call's line to the person's answer)",
        "  questions: 2 questions (AskUserQuestion 2)",
        "  waiting on background work: 2 waits, 25 min (human 1, task_notification 1)",
        "  idle until the person wrote: 1 wait, 45 min",
        "  compactions: 2 (auto 1, manual 1; 181000 tokens in, 26000 out)",
        "  auto-mode blocks: 2 (classifier 1, Merge Without Review 1)",
        "  merges that asked: 1 (merge-guard 1); by reason: review-missing 1",
        "",
        "Prompts by cause: merge-guard 1 (5 min), Claude Code 2 (3 min)",
        "",
        "Records skipped: 2 (and 1 ask-log line)",
      ].join("\n"),
    );
  });

  it("says what the version did not record, and that no session ran", () => {
    const report = reportOne();
    report.sessions = [];
    report.open = [];
    report.missing = ["prompts: no permission decisions were recorded by this version"];
    const text = formatFlow(report, 24, "/home/user/.claude/projects", "/home/user", "UTC");
    expect(text).toBe(
      [
        "cc-smart-dev-kit report: the last 1 day, from ~/.claude/projects (read only; no message text)",
        "",
        "No session ran in that window.",
        "",
        "Records skipped: 2 (and 1 ask-log line)",
        "What this version did not record:",
        "  prompts: no permission decisions were recorded by this version",
      ].join("\n"),
    );
    // A session with no turn durations and no permission decisions says so, not zero.
    const bare: SessionFlow = {
      ...SESSION_FLOW,
      activeMs: null,
      background: null,
      idle: null,
      prompts: null,
      skipped: 0,
    };
    const one = reportOne();
    one.sessions = [bare];
    one.totals.sessions = 1;
    one.open = [];
    one.skipped = { askLog: 0, records: 0 };
    const lines = formatFlow(one, 168, "/home/user/.claude/projects", "/home/user", "UTC").split(
      "\n",
    );
    expect(lines.slice(2, 6)).toEqual([
      "~/my-app  session aaaaaaaa  (last active 2026-10-21 17:05)",
      "  active time: not recorded by this version",
      "  agents: 4 launches in 4 replies; 1 with 2 or more (2 of 4 launches in parallel, 50 %); most at once 3",
      "  blocked on prompts: not recorded by this version",
    ]);
    expect(lines).toContain("  waiting on background work: not recorded by this version");
    expect(lines).toContain("  idle until the person wrote: not recorded by this version");
    // A compaction whose boundary recorded no tokens says so, and never prints a zero.
    one.sessions = [
      {
        ...SESSION_FLOW,
        compactions: { byTrigger: { auto: 1 }, count: 1, tokens: null },
      },
    ];
    expect(formatFlow(one, 168, "/home/user/.claude/projects", "/home/user", "UTC")).toContain(
      "  compactions: 1 (auto 1; the tokens were not recorded by this version)",
    );
  });

  it("formats a span as seconds, minutes, or hours and minutes", () => {
    expect(duration(0)).toBe("0 s");
    expect(duration(45_000)).toBe("45 s");
    expect(duration(60_000)).toBe("1 min");
    expect(duration(3_600_000)).toBe("1 h");
    expect(duration(4_320_000)).toBe("1 h 12 min");
    expect(duration(7_200_000)).toBe("2 h");
  });
});

/** A world with a `CliPaths` and one transcript; the home folder is the temp folder. */
function world(lines: (cwd: string) => string[]): {
  paths: ReturnType<typeof cliPaths>;
  sessionFile: string;
} {
  const root = tempDir("report");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(root, ".claude"), HOME: root });
  const folder = join(paths.claudeConfigDir, "projects", PROJECT);
  mkdirSync(folder, { recursive: true });
  const sessionFile = join(folder, `${SESSION}.jsonl`);
  writeFileSync(sessionFile, `${lines(join(root, "my-app")).join("\n")}\n`);
  return { paths, sessionFile };
}

/** One assistant line from a session in `cwd`. */
function assistant(cwd: string, id: string, ts: number, blocks: Record<string, unknown>[]): string {
  return JSON.stringify({
    cwd,
    message: { content: blocks, id },
    timestamp: new Date(ts).toISOString(),
    type: "assistant",
  });
}

/** Runs the command with its output captured. */
function run(
  paths: ReturnType<typeof cliPaths>,
  args: string[],
): { code: number; err: string; out: string } {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err.push(parts.join(" "));
  });
  try {
    return { code: runReport(paths, args, NOW), err: err.join("\n"), out: out.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("cc-smart-dev-kit report", () => {
  it("prints the report of the projects folder, and never a word of a message", () => {
    const { paths } = world((cwd) => [
      assistant(cwd, "r1", NOW - 30 * 60_000, [
        { id: "t1", input: {}, name: "Agent", type: "tool_use" },
        { text: SECRET, type: "text" },
      ]),
    ]);
    const result = run(paths, ["--hours", "1"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.split("\n").slice(0, 4)).toEqual([
      "cc-smart-dev-kit report: the last 1 h, from ~/.claude/projects (read only; no message text)",
      "",
      "~/my-app  session aaaaaaaa  (last active 2026-10-21 17:30)",
      "  active time: not recorded by this version",
    ]);
    expect(result.out).not.toContain(SECRET);
    expect(result.out).toContain("Records skipped: 0");
  });

  it("--json prints the whole report", () => {
    const { paths } = world((cwd) => [
      assistant(cwd, "r1", NOW - 60_000, [
        { id: "t1", input: {}, name: "Agent", type: "tool_use" },
      ]),
    ]);
    const result = run(paths, ["--days", "7", "--json"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as FlowReport;
    expect(report.sinceMs).toBe(SINCE);
    expect(report.untilMs).toBe(NOW);
    expect(report.sessions.map((session) => [session.session, session.agents.launches])).toEqual([
      [SESSION, 1],
    ]);
    expect(report.totals.agents.launches).toBe(1);
    expect(report.skipped).toEqual({ askLog: 0, records: 0 });
  });

  it("a wrong option exits 2 with one line and the usage", () => {
    const { paths } = world((cwd) => [assistant(cwd, "r1", NOW - 60_000, [])]);
    const result = run(paths, ["--days", "1", "--hours", "2"]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toStartWith(
      "--hours and --days name the same window: give one\n\nUsage: cc-smart-dev-kit report",
    );
  });

  it("--project and --session narrow the report", () => {
    const { paths } = world((cwd) => [assistant(cwd, "r1", NOW - 60_000, [])]);
    expect(run(paths, ["--project", "other"]).out).toContain("No session ran in that window.");
    expect(run(paths, ["--session", "nope"]).out).toContain("No session ran in that window.");
    expect(run(paths, ["--session", "aaaaaaaa"]).out).toContain("session aaaaaaaa");
  });
});
