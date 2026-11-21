/**
 * `cc-smart-dev-kit usage`: a fake `projects` folder in the shape Claude Code 2.1.300 writes. The
 * fixtures hold message text; the report must never show it.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SafetyCheckState } from "../gateway/safety-checks";
import { type AgentUsage, agentUsageFile, parseAgentUsage } from "../hooks/agent-usage";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import {
  collectUsage,
  formatSafetyChecks,
  formatUsage,
  runUsage,
  usageJson,
  usageOptions,
  usdText,
} from "./usage";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const SINCE = NOW - 6 * 3_600_000;
const SECRET_TEXT = "the private plan for the launch";

/** One reply, in as many content-block lines as `blocks`. */
function reply(id: string, model: string, at: number, blocks = 1): string[] {
  return Array.from({ length: blocks }, (_, index) =>
    JSON.stringify({
      cwd: "/home/user/my-app",
      message: { content: [{ text: SECRET_TEXT, type: "text" }], id, model },
      timestamp: new Date(at).toISOString(),
      type: "assistant",
      uuid: `${id}-${index}`,
    }),
  );
}

function subagent(
  folder: string,
  name: string,
  meta: Record<string, unknown>,
  lines: string[],
  metaTime = NOW - 60_000,
): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.meta.json`), JSON.stringify(meta));
  writeFileSync(join(folder, `${name}.jsonl`), `${lines.join("\n")}\n`);
  utimesSync(join(folder, `${name}.meta.json`), metaTime / 1000, metaTime / 1000);
}

function projects(): string {
  const root = join(tempDir("usage"), "projects");
  const session = join(
    root,
    "-home-user-my-app",
    "11111111-aaaa-bbbb-cccc-000000000001",
    "subagents",
  );
  subagent(
    session,
    "agent-a1",
    { agentType: "general-purpose", description: SECRET_TEXT, model: "opus" },
    [
      JSON.stringify({ content: SECRET_TEXT, cwd: "/home/user/my-app", type: "user" }),
      ...reply("msg_1", "claude-opus-5-5", NOW - 3_600_000, 3),
      ...reply("msg_2", "claude-opus-5-5", NOW - 3_000_000),
      // Before the window: not counted.
      ...reply("msg_0", "claude-opus-5-5", NOW - 7 * 3_600_000),
      "{half a line",
    ],
  );
  subagent(session, "agent-a2", { model: "sonnet" }, [
    ...reply("msg_3", "glm-5.3-flash", NOW - 1_800_000, 2),
  ]);
  // Launched without a model: it took the session's.
  subagent(session, "agent-a3", { agentType: "Explore" }, [
    ...reply("msg_4", "claude-opus-5-5", NOW - 600_000),
  ]);
  // The main session's own transcript, beside the session folder.
  const project = join(root, "-home-user-my-app");
  writeFileSync(
    join(project, "11111111-aaaa-bbbb-cccc-000000000001.jsonl"),
    `${[
      JSON.stringify({ content: SECRET_TEXT, cwd: "/home/user/my-app", type: "user" }),
      ...reply("main_1", "claude-opus-5-5", NOW - 3_500_000, 2),
      ...reply("main_2", "glm-5.3-flash", NOW - 1_000_000),
      // A subagent's line in an older version's main file: not the main session's.
      JSON.stringify({
        isSidechain: true,
        message: { id: "side_1", model: "claude-haiku-4-5" },
        timestamp: new Date(NOW - 900_000).toISOString(),
        type: "assistant",
      }),
    ].join("\n")}\n`,
  );
  // A main session whose file last changed before the window: not read, though its lines
  // say otherwise (the file's time wins: nothing was written to it since).
  const stale = join(project, "33333333-aaaa-bbbb-cccc-000000000003.jsonl");
  writeFileSync(stale, `${reply("stale_1", "claude-opus-5-5", NOW - 600_000).join("\n")}\n`);
  utimesSync(stale, (NOW - 7 * 3_600_000) / 1000, (NOW - 7 * 3_600_000) / 1000);
  // Another project, all old: not in the window.
  const old = join(root, "-home-user-other", "22222222-aaaa-bbbb-cccc-000000000002", "subagents");
  subagent(
    old,
    "agent-b1",
    { model: "haiku" },
    reply("msg_9", "deepseek-v4.1-flash", NOW - 8 * 3_600_000),
    NOW - 8 * 3_600_000,
  );
  return root;
}

describe("usage", () => {
  it("counts the main session and its subagents apart: replies by model, launches, the share on Opus", () => {
    const root = projects();
    const sessions = collectUsage(root, { project: null, sinceMs: SINCE });
    expect(sessions).toEqual([
      {
        cwd: "/home/user/my-app",
        launched: { inherited: 1, opus: 1, sonnet: 1 },
        main: { "claude-opus-5-5": 1, "glm-5.3-flash": 1 },
        project: "-home-user-my-app",
        replies: { "claude-opus-5-5": 3, "glm-5.3-flash": 1 },
        session: "11111111-aaaa-bbbb-cccc-000000000001",
        subagents: 3,
      },
    ]);
    const text = formatUsage(sessions, 6, root, "/home/user");
    expect(text).toBe(
      [
        `Claude Code replies in the last 6 h, main sessions and subagents apart, from ${root} (read only; no message text)`,
        "",
        "~/my-app  session 11111111",
        "  main session, replies by model: claude-opus-5-5 1, glm-5.3-flash 1",
        "  3 subagents, launched as: inherited 1, opus 1, sonnet 1",
        "  subagent replies by model: claude-opus-5-5 3, glm-5.3-flash 1",
        "  subagents on Opus: 3 of 4 replies (75%)",
        "",
        "Main sessions: 1 session; replies by model: claude-opus-5-5 1, glm-5.3-flash 1",
        "Subagents: 3 in 1 session; replies by model: claude-opus-5-5 3, glm-5.3-flash 1; on Opus: 3 of 4 replies (75%)",
      ].join("\n"),
    );
    expect(text).not.toContain(SECRET_TEXT);
  });

  it("a main session with no subagent is counted too", () => {
    const root = join(tempDir("usage"), "projects");
    mkdirSync(join(root, "-home-user-site"), { recursive: true });
    writeFileSync(
      join(root, "-home-user-site", "44444444-aaaa.jsonl"),
      `${reply("m1", "claude-fable-5-1", NOW - 60_000).join("\n")}\n`,
    );
    const sessions = collectUsage(root, { project: null, sinceMs: SINCE });
    expect(formatUsage(sessions, 6, root, "/home/user").split("\n").slice(2)).toEqual([
      "~/my-app  session 44444444",
      "  main session, replies by model: claude-fable-5-1 1",
      "  subagents: none in the window",
      "",
      "Main sessions: 1 session; replies by model: claude-fable-5-1 1",
      "Subagents: 0 in 0 sessions; replies by model: none; on Opus: 0 of 0 replies (-)",
    ]);
  });

  it("--hours and --project choose the window and the project", () => {
    const root = projects();
    const wide = collectUsage(root, { project: null, sinceMs: NOW - 9 * 3_600_000 });
    // Nine hours back, the file that last changed seven hours ago is in the window.
    expect(wide.map((session) => `${session.project} ${session.session.slice(0, 8)}`)).toEqual([
      "-home-user-my-app 11111111",
      "-home-user-my-app 33333333",
      "-home-user-other 22222222",
    ]);
    expect(collectUsage(root, { project: "my-app", sinceMs: SINCE })).toHaveLength(1);
    expect(collectUsage(root, { project: "/home/user/my-app", sinceMs: SINCE })).toHaveLength(1);
    expect(collectUsage(root, { project: "other", sinceMs: SINCE })).toEqual([]);
    expect(formatUsage([], 2, root, "/home/user")).toBe(
      `Claude Code replies in the last 2 h, main sessions and subagents apart, from ${root} (read only; no message text)\n\nNo session answered in that time.`,
    );
  });

  it("a missing projects folder is an empty report; options are checked", () => {
    expect(collectUsage(join(tempDir("usage"), "none"), { project: null, sinceMs: SINCE })).toEqual(
      [],
    );
    expect(usageOptions([])).toEqual({ hours: 6, json: false, project: null });
    expect(usageOptions(["--hours", "1.5", "--project", "my-app"])).toEqual({
      hours: 1.5,
      json: false,
      project: "my-app",
    });
    expect(usageOptions(["--json"])).toEqual({ hours: 6, json: true, project: null });
    expect(usageOptions(["--hours", "0"])).toEqual({
      error: '--hours wants a number above 0, not "0"',
    });
    expect(usageOptions(["--days", "2"])).toEqual({ error: "Unknown option: --days" });
  });
});

describe("MD-7: the subagents' own records", () => {
  const SESSION_ID = "11111111-aaaa-bbbb-cccc-000000000001";

  /** One record line, written by hand in the shape `src/hooks/agent-usage.ts` writes. */
  function record(line: Record<string, unknown>): AgentUsage {
    const one = parseAgentUsage(JSON.stringify(line));
    if (one === null) throw new Error(`the record did not read: ${JSON.stringify(line)}`);
    return one;
  }

  // Two agents of the fixture's session: an Opus reply written twice and an unpriced backend
  // reply (0.0149 USD by hand), and an Explore agent whose one reply cost nothing.
  const GENERAL = record({
    agent: "a1",
    agentType: "general-purpose",
    at: NOW - 1_800_000,
    models: [
      {
        cacheRead: 2000,
        cacheWrite: 100,
        input: 1000,
        model: "claude-opus-5-5",
        output: 500,
        replies: 2,
        usd: 0.0149,
      },
      {
        cacheRead: 0,
        cacheWrite: 0,
        input: 300,
        model: "glm-5.3-flash",
        output: 100,
        replies: 1,
        usd: null,
      },
    ],
    session: SESSION_ID,
    unpriced: 1,
    usd: 0.0149,
  });
  const EXPLORE = record({
    agent: "a2",
    agentType: "Explore",
    at: NOW - 900_000,
    models: [
      {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        model: "claude-opus-5-5",
        output: 0,
        replies: 1,
        usd: 0,
      },
    ],
    session: SESSION_ID,
    unpriced: 0,
    usd: 0,
  });

  it("shows each session's agents by type and model, their tokens and their cost", () => {
    const root = projects();
    const sessions = collectUsage(root, { project: null, sinceMs: SINCE });
    const lines = formatUsage(sessions, 6, root, "/home/user", [GENERAL, EXPLORE]).split("\n");
    expect(lines.slice(7, 10)).toEqual([
      "  agents on record: 2 — by type: Explore 1, general-purpose 1",
      "  agents' replies by model: claude-opus-5-5 3, glm-5.3-flash 1; on Opus: 3 of 4 (75%)",
      "  agents' tokens: 1300 in, 600 out, 2000 cache read, 100 cache write; cost $0.0149 estimated (1 reply has no price)",
    ]);
    expect(lines.slice(-2)).toEqual([
      "",
      "Agents on record: 2 agents in 1 session; by type: Explore 1, general-purpose 1; replies by model: claude-opus-5-5 3, glm-5.3-flash 1; on Opus: 3 of 4 replies (75%); cost $0.0149 estimated (1 reply has no price)",
    ]);
  });

  it("a record whose session answered nothing yet is still counted in the totals", () => {
    const root = projects();
    const text = formatUsage([], 6, root, "/home/user", [GENERAL]);
    expect(text.split("\n").slice(-2)).toEqual([
      "",
      "Agents on record: 1 agent in 1 session; by type: general-purpose 1; replies by model: claude-opus-5-5 2, glm-5.3-flash 1; on Opus: 2 of 3 replies (67%); cost $0.0149 estimated (1 reply has no price)",
    ]);
  });

  it("--json is the same facts as one object a portal can read", () => {
    const root = projects();
    const sessions = collectUsage(root, { project: null, sinceMs: SINCE });
    expect(usageJson(sessions, [GENERAL, EXPLORE], 6)).toEqual({
      agents: [
        {
          agent: "a1",
          agentType: "general-purpose",
          at: NOW - 1_800_000,
          cacheRead: 2000,
          cacheWrite: 100,
          input: 1300,
          models: GENERAL.models,
          output: 600,
          replies: 3,
          session: SESSION_ID,
          unpriced: 1,
          usd: 0.0149,
        },
        {
          agent: "a2",
          agentType: "Explore",
          at: NOW - 900_000,
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          models: EXPLORE.models,
          output: 0,
          replies: 1,
          session: SESSION_ID,
          unpriced: 0,
          usd: 0,
        },
      ],
      format: 1,
      hours: 6,
      sessions,
      totals: {
        agentReplies: 4,
        agents: 2,
        agentTokens: { cacheRead: 2000, cacheWrite: 100, input: 1300, output: 600 },
        agentUnpriced: 1,
        agentUsd: 0.0149,
        main: { "claude-opus-5-5": 1, "glm-5.3-flash": 1 },
        replies: { "claude-opus-5-5": 3, "glm-5.3-flash": 1 },
        sessions: 1,
        subagents: 3,
      },
    });
  });

  it("--project counts only the record lines whose session it shows", () => {
    const home = tempDir("usage-run");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const project = join(paths.projectsDir, "-home-user-my-app");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "s1.jsonl"),
      `${reply("m1", "claude-opus-5-5", NOW - 60_000).join("\n")}\n`,
    );
    mkdirSync(paths.stateDir, { recursive: true });
    // The fixture's session, and one in another project whose transcript is not here.
    writeFileSync(
      agentUsageFile(paths.stateDir),
      `${[
        JSON.stringify({
          agent: "a1",
          agentType: "general-purpose",
          at: NOW - 120_000,
          models: GENERAL.models,
          session: "s1",
          unpriced: 1,
          usd: 0.0149,
        }),
        JSON.stringify({
          agent: "b1",
          agentType: "Explore",
          at: NOW - 90_000,
          models: EXPLORE.models,
          session: "s2",
          unpriced: 0,
          usd: 0,
        }),
      ].join("\n")}\n`,
    );
    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logged.push(String(args[0]));
    try {
      expect(runUsage(paths, ["--project", "my-app"], NOW)).toBe(0);
      expect(logged[0]).toContain(
        "Agents on record: 1 agent in 1 session; by type: general-purpose 1",
      );
      logged.length = 0;
      expect(runUsage(paths, ["--project", "other"], NOW)).toBe(0);
      expect(logged[0]).not.toContain("Agents on record");
    } finally {
      console.log = original;
    }
  });

  it("a cost reads at least as cents, and the micro-dollars a reply costs", () => {
    expect(usdText(0.0149)).toBe("$0.0149");
    expect(usdText(0)).toBe("$0.00");
    expect(usdText(0.5)).toBe("$0.50");
    expect(usdText(0.000001)).toBe("$0.000001");
  });
});

describe("the auto-mode safety checks the router counted", () => {
  /** One day's record, as the router's file holds it, written by hand. */
  const day = (checks: number, input: number, output: number, fallback = 0) => ({
    anthropic: { cacheRead: 0, cacheWrite: 0, checks, input, output },
    checks: checks + fallback,
    fallback: { cacheRead: 20, cacheWrite: 1, checks: fallback, input: 0, output: 0 },
  });

  it("shows today and the seven days before it, newest first, and says what it cannot know", () => {
    const state: SafetyCheckState = {
      days: {
        "2026-10-15": day(3, 1234, 7, 2),
        "2026-10-14": day(1, 90, 1),
        // Seven days back: the oldest day in the window.
        "2026-10-08": day(4, 400, 9),
        // Eight days back: not shown.
        "2026-10-07": day(9, 900, 9),
      },
      version: 1,
    };
    expect(formatSafetyChecks(state, NOW, "UTC")).toEqual([
      "",
      "Auto mode's safety checks the router counted on this machine:",
      "  today (2026-10-15): 5 checks — Anthropic 3 (1234 in, 7 out, 0 cache read, 0 cache write); your judge 2 (0 in, 0 out, 20 cache read, 1 cache write)",
      "  2026-10-14: 1 check — Anthropic 1 (90 in, 1 out, 0 cache read, 0 cache write)",
      "  2026-10-08: 4 checks — Anthropic 4 (400 in, 9 out, 0 cache read, 0 cache write)",
      "  The tokens are what each answer's `usage` reported; whether they count against a Pro, Max or Team plan's limit is not confirmed (Anthropic's docs say they do on Enterprise and API accounts).",
    ]);
  });

  it("no file, or nothing in the window: one line saying so", () => {
    const none = [
      "",
      "Auto mode's safety checks the router counted on this machine:",
      "  none in the last 8 days (the gateway must be set up, and a session must have run with auto mode on)",
    ];
    expect(formatSafetyChecks(null, NOW, "UTC")).toEqual(none);
    expect(
      formatSafetyChecks({ days: { "2026-09-01": day(2, 1, 1) }, version: 1 }, NOW, "UTC"),
    ).toEqual(none);
  });
});
