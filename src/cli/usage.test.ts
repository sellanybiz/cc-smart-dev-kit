/**
 * `anymodel usage`: a fake `projects` folder in the shape Claude Code 2.1.300 writes. The
 * fixtures hold message text; the report must never show it.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { collectUsage, formatUsage, usageOptions } from "./usage";

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
  it("counts subagents, how they were launched, replies by model, and the share on Opus", () => {
    const root = projects();
    const sessions = collectUsage(root, { project: null, sinceMs: SINCE });
    expect(sessions).toEqual([
      {
        cwd: "/home/user/my-app",
        launched: { inherited: 1, opus: 1, sonnet: 1 },
        project: "-home-user-my-app",
        replies: { "claude-opus-5-5": 3, "glm-5.3-flash": 1 },
        session: "11111111-aaaa-bbbb-cccc-000000000001",
        subagents: 3,
      },
    ]);
    const text = formatUsage(sessions, 6, root, "/home/user");
    expect(text).toBe(
      [
        `Subagents in the last 6 h, from ${root} (read only; no message text)`,
        "",
        "~/my-app  session 11111111",
        "  3 subagents, launched as: inherited 1, opus 1, sonnet 1",
        "  replies by model: claude-opus-5-5 3, glm-5.3-flash 1",
        "  on Opus: 3 of 4 replies (75%)",
        "",
        "Total: 3 subagents in 1 session; on Opus: 3 of 4 replies (75%)",
      ].join("\n"),
    );
    expect(text).not.toContain(SECRET_TEXT);
  });

  it("--hours and --project choose the window and the project", () => {
    const root = projects();
    const wide = collectUsage(root, { project: null, sinceMs: NOW - 9 * 3_600_000 });
    expect(wide.map((session) => session.project)).toEqual([
      "-home-user-my-app",
      "-home-user-other",
    ]);
    expect(collectUsage(root, { project: "my-app", sinceMs: SINCE })).toHaveLength(1);
    expect(collectUsage(root, { project: "/home/user/my-app", sinceMs: SINCE })).toHaveLength(1);
    expect(collectUsage(root, { project: "other", sinceMs: SINCE })).toEqual([]);
    expect(formatUsage([], 2, root, "/home/user")).toBe(
      `Subagents in the last 2 h, from ${root} (read only; no message text)\n\nNo subagent ran in that time.`,
    );
  });

  it("a missing projects folder is an empty report; options are checked", () => {
    expect(collectUsage(join(tempDir("usage"), "none"), { project: null, sinceMs: SINCE })).toEqual(
      [],
    );
    expect(usageOptions([])).toEqual({ hours: 6, project: null });
    expect(usageOptions(["--hours", "1.5", "--project", "my-app"])).toEqual({
      hours: 1.5,
      project: "my-app",
    });
    expect(usageOptions(["--hours", "0"])).toEqual({
      error: '--hours wants a number above 0, not "0"',
    });
    expect(usageOptions(["--days", "2"])).toEqual({ error: "Unknown option: --days" });
  });
});
