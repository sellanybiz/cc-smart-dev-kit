/**
 * MD-13: the plugin's subagent status line. The input is the shape Claude Code 2.1.308 sent a
 * probe plugin's `subagentStatusLine` offline (fake Anthropic, throwaway HOME; the contract's
 * row), written here by hand: `columns` and one `tasks` entry per visible subagent.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCHER_IN_SHELL } from "../setup/launcher";
import {
  rowContent,
  runSubagentStatusline,
  slotOf,
  statusTasks,
  subagentRows,
} from "./subagent-statusline";

/** The probe's own input, as 2.1.308 handed it over. */
const INPUT = {
  columns: 194,
  cwd: "/home/user/my-app",
  prompt_id: "c97bec62-e8dc-495a-9207-9b8bee4f5fdf",
  session_id: "bb515960-3848-4a93-b7fe-e09c16f90755",
  tasks: [
    {
      agentType: "general-purpose",
      contextWindowSize: 1000000,
      cwd: "/home/user/my-app",
      description: "proof agent",
      effort: "high",
      id: "a54a3667034e503a8",
      label: "proof agent",
      model: "claude-sonnet-5-5",
      startTime: 1792694466912,
      status: "running",
      tokenCount: 0,
      tokenSamples: [0, 0, 0],
      type: "local_agent",
    },
    {
      agentType: "cc-smart-dev-kit:reviewer",
      description: "Review the diff",
      effort: "xhigh",
      id: "b1",
      label: "Review the diff",
      model: "claude-opus-5-5",
      startTime: 1792694467912,
      status: "running",
      tokenCount: 1200,
      tokenSamples: [1200],
      type: "local_agent",
    },
  ],
  transcript_path: "/home/user/.claude/projects/-home-user-my-app/session.jsonl",
};

/** A task as the row builder reads it. */
function task(over: Partial<Parameters<typeof rowContent>[0]> = {}) {
  return {
    agentType: "general-purpose",
    effort: "high",
    id: "a1",
    label: "proof agent",
    model: "claude-sonnet-5-5",
    ...over,
  };
}

describe("MD-13: the subagent status line", () => {
  it("a row is the agent, then slot → model → effort, from the model's Claude family", () => {
    expect(rowContent(task())).toBe("proof agent · worker → claude-sonnet-5-5 → high");
    expect(rowContent(task({ model: "claude-opus-5-5", effort: "xhigh" }))).toBe(
      "proof agent · opus → claude-opus-5-5 → xhigh",
    );
    expect(rowContent(task({ model: "claude-haiku-4-5" }))).toBe(
      "proof agent · scout → claude-haiku-4-5 → high",
    );
    expect(rowContent(task({ model: "claude-fable-5-1" }))).toBe(
      "proof agent · fable → claude-fable-5-1 → high",
    );
  });

  it("what the row cannot know yet says so, and a model no slot answers shows ?", () => {
    expect(rowContent(task({ label: null }))).toBe("worker → claude-sonnet-5-5 → high");
    expect(rowContent(task({ effort: null }))).toBe(
      "proof agent · worker → claude-sonnet-5-5 → default effort",
    );
    expect(rowContent(task({ model: null }))).toBe(
      "proof agent · ? → model not resolved yet → high",
    );
    // A model id no Claude family answers (`familySlotFor`): never a slot guessed.
    expect(rowContent(task({ model: "glm-5.3-flash", effort: "max" }))).toBe(
      "proof agent · ? → glm-5.3-flash → max",
    );
    expect(slotOf("claude-sonnet-5-5")).toBe("worker");
    expect(slotOf("claude-opus-5-5[1m]")).toBe("opus");
    expect(slotOf("glm-5.3-flash")).toBeNull();
    expect(slotOf(null)).toBeNull();
  });

  it("no control character reaches the terminal, and the row fits its columns", () => {
    expect(rowContent(task({ label: "two\nwords\u001b[31m" }))).toBe(
      "two words [31m · worker → claude-sonnet-5-5 → high",
    );
    const long = rowContent(task({ label: "x".repeat(200) }), 30);
    expect(long.length).toBe(30);
    expect(long).toEndWith("…");
    // A width too small for a body still leaves a row a person can read, and it fits.
    expect(rowContent(task(), 1)).toBe("proof agent · worke…");
    expect(Bun.stringWidth(rowContent(task(), 1))).toBe(20);
  });

  it("the probe's own input makes one row per task, both with their route", () => {
    expect(statusTasks(INPUT).map((one) => one.id)).toEqual(["a54a3667034e503a8", "b1"]);
    expect(subagentRows(INPUT)).toEqual([
      { content: "proof agent · worker → claude-sonnet-5-5 → high", id: "a54a3667034e503a8" },
      { content: "Review the diff · opus → claude-opus-5-5 → xhigh", id: "b1" },
    ]);
  });

  it("a broken or empty input prints nothing and exits 0", async () => {
    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logged.push(String(args[0]));
    try {
      expect(await runSubagentStatusline(async () => "{not json")).toBe(0);
      expect(await runSubagentStatusline(async () => "")).toBe(0);
      expect(await runSubagentStatusline(async () => JSON.stringify({ tasks: "no" }))).toBe(0);
    } finally {
      console.log = original;
    }
    expect(logged).toEqual([]);
  });

  it("the command prints one JSON line per row", async () => {
    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logged.push(String(args[0]));
    try {
      expect(await runSubagentStatusline(async () => JSON.stringify(INPUT))).toBe(0);
    } finally {
      console.log = original;
    }
    expect(logged).toEqual([
      '{"content":"proof agent · worker → claude-sonnet-5-5 → high","id":"a54a3667034e503a8"}',
      '{"content":"Review the diff · opus → claude-opus-5-5 → xhigh","id":"b1"}',
    ]);
  });

  it("the plugin's settings.json names the launcher, the one path a plugin command can use", () => {
    // `${CLAUDE_PLUGIN_ROOT}` is not expanded in a plugin's settings.json command (proved on
    // 2.1.308: the literal string ran, exit 127), so the launcher is the stable command.
    const file = join(import.meta.dir, "..", "..", "plugin", "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8")) as {
      subagentStatusLine?: { command?: string; type?: string };
    };
    expect(settings.subagentStatusLine).toEqual({
      command: `${LAUNCHER_IN_SHELL} subagent-statusline`,
      type: "command",
    });
  });
});
