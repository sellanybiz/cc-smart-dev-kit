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
      agentType: "cc-smart-dev-kit:senior-engineer",
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
    contextWindowSize: null as null | number,
    effort: "high",
    id: "a1",
    label: "proof agent",
    model: "claude-sonnet-5-5",
    tokenCount: null as null | number,
    ...over,
  };
}

/** A task with a context reading: 45k of a 200k window. */
function usedTask(over: Partial<Parameters<typeof rowContent>[0]> = {}) {
  return task({ contextWindowSize: 200000, tokenCount: 45000, ...over });
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
      // The first task's count is 0 (no reading yet): no context part. The second has a count
      // and no window: the count alone.
      {
        content: "Review the diff · opus → claude-opus-5-5 → xhigh · ~1k ctx",
        id: "b1",
      },
    ]);
  });

  it("the context use follows the route, from tokenCount and contextWindowSize", () => {
    expect(rowContent(usedTask())).toBe(
      "proof agent · worker → claude-sonnet-5-5 → high · ~45k/200k ctx (23%)",
    );
    expect(rowContent(usedTask({ tokenCount: 312000, contextWindowSize: 1000000 }))).toBe(
      "proof agent · worker → claude-sonnet-5-5 → high · ~312k/1M ctx (31%)",
    );
    expect(rowContent(usedTask({ label: null, tokenCount: 950, contextWindowSize: 200000 }))).toBe(
      "worker → claude-sonnet-5-5 → high · ~950/200k ctx (0%)",
    );
    // The statusTasks reader takes both fields from the input, as numbers.
    const [first] = statusTasks({
      tasks: [{ id: "a", contextWindowSize: 200000, tokenCount: 45000 }],
    });
    expect(first?.contextWindowSize).toBe(200000);
    expect(first?.tokenCount).toBe(45000);
  });

  it("a missing, zero or garbled field leaves the context part out, or only the window", () => {
    // No window: the count alone. No count (or none yet): nothing.
    expect(rowContent(usedTask({ contextWindowSize: null }))).toBe(
      "proof agent · worker → claude-sonnet-5-5 → high · ~45k ctx",
    );
    expect(rowContent(usedTask({ contextWindowSize: 0 }))).toBe(
      "proof agent · worker → claude-sonnet-5-5 → high · ~45k ctx",
    );
    const bare = "proof agent · worker → claude-sonnet-5-5 → high";
    expect(rowContent(usedTask({ tokenCount: null }))).toBe(bare);
    expect(rowContent(usedTask({ tokenCount: 0 }))).toBe(bare);
    expect(rowContent(usedTask({ tokenCount: -5 }))).toBe(bare);
    // From raw input, a string or a NaN-like value is no number at all.
    const [garbled] = statusTasks({
      tasks: [{ id: "a", contextWindowSize: "200000", tokenCount: "45000" }],
    });
    expect(garbled?.contextWindowSize).toBeNull();
    expect(garbled?.tokenCount).toBeNull();
    const [infinite] = statusTasks({
      tasks: [{ id: "a", contextWindowSize: Number.POSITIVE_INFINITY, tokenCount: null }],
    });
    expect(infinite?.contextWindowSize).toBeNull();
    expect(infinite?.tokenCount).toBeNull();
  });

  it("a narrow row keeps the context: the label shrinks first, then the context moves forward", () => {
    const tail = "worker → claude-sonnet-5-5 → high · ~45k/200k ctx (23%)";
    const label = "reviewer-agent";
    // Whole body is 72 characters: at 66 columns the label gives way, route and context stay.
    expect(rowContent(usedTask({ label }), 66)).toBe(`review… · ${tail}`);
    expect(rowContent(usedTask({ label }), 66).length).toBe(65);
    // No room for even a short label: the route and the context, whole.
    expect(rowContent(usedTask({ label }), 60)).toBe(tail);
    // Not even those fit: the context goes first, the end of the route is cut.
    expect(rowContent(usedTask({ label }), 40)).toBe("~45k/200k ctx (23%) · worker → claude-s…");
    expect(rowContent(usedTask({ label: null }), 40)).toBe(
      "~45k/200k ctx (23%) · worker → claude-s…",
    );
    // Every cut row fits its columns.
    for (const columns of [20, 30, 45, 55, 66, 72]) {
      expect(rowContent(usedTask({ label }), columns).length).toBeLessThanOrEqual(columns);
    }
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
      '{"content":"Review the diff · opus → claude-opus-5-5 → xhigh · ~1k ctx","id":"b1"}',
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
