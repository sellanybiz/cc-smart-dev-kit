/**
 * The launch record (`agent-launches.ts`): each line's `effort` and `word` fields, an old line
 * that carries only `reason`, and de-duplication by tool call AND launch index — a Workflow's
 * launches share one `tool_use_id`.
 */
import { describe, expect, it } from "bun:test";
import {
  type AgentLaunch,
  formatAgentLaunches,
  parseAgentLaunch,
  reasonParts,
} from "./agent-launches";

function launch(fields: Partial<AgentLaunch>): AgentLaunch {
  return {
    at: 1,
    effort: "xhigh",
    family: "opus",
    launchIndex: 0,
    model: "claude-opus-5-5",
    project: "/home/user/my-app",
    reason: "opus:xhigh",
    session: "s1",
    subagentType: "Reviewer",
    toolUseId: "toolu_1",
    word: null,
    ...fields,
  };
}

describe("G2: a reason string, taken apart in one place", () => {
  it("G2: the effort and the word of every shape a reason has had", () => {
    expect(reasonParts("opus:xhigh:security")).toEqual({ effort: "xhigh", word: "security" });
    expect(reasonParts("opus:max")).toEqual({ effort: "max", word: null });
    expect(reasonParts("opus:auto")).toEqual({ effort: "auto", word: null });
    expect(reasonParts("opus:session-effort")).toEqual({ effort: "session-effort", word: null });
    expect(reasonParts("opus:session-effort:ui")).toEqual({
      effort: "session-effort",
      word: "ui",
    });
    expect(reasonParts("fable:plan")).toEqual({ effort: null, word: "plan" });
    expect(reasonParts("opus:unreadable")).toEqual({ effort: null, word: "unreadable" });
    // Before D11 an opus line was `opus:<word>`, and before that a bare word.
    expect(reasonParts("opus:security")).toEqual({ effort: null, word: "security" });
    expect(reasonParts("review")).toEqual({ effort: null, word: "review" });
  });
});

describe("G2: a line of the record", () => {
  it("G2: an old line with only `reason` still reads, its effort and word from the reason", () => {
    const old = JSON.stringify({
      at: 5,
      family: "opus",
      model: "claude-opus-5-5",
      project: "/home/user/my-app",
      reason: "opus:xhigh:security",
      session: "s1",
      subagentType: "Reviewer",
      toolUseId: "toolu_9",
    });
    expect(parseAgentLaunch(old)).toEqual({
      at: 5,
      effort: "xhigh",
      family: "opus",
      launchIndex: 0,
      model: "claude-opus-5-5",
      project: "/home/user/my-app",
      reason: "opus:xhigh:security",
      session: "s1",
      subagentType: "Reviewer",
      toolUseId: "toolu_9",
      word: "security",
    });
  });

  it("G2: a new line's own fields win over its reason", () => {
    const line = JSON.stringify(
      launch({ effort: "max", launchIndex: 2, reason: "fable:plan", word: "plan" }),
    );
    expect(parseAgentLaunch(line)?.effort).toBe("max");
    expect(parseAgentLaunch(line)?.word).toBe("plan");
    expect(parseAgentLaunch(line)?.launchIndex).toBe(2);
  });

  it("G2: a launch index that is not a whole number at or above 0 reads as 0", () => {
    for (const bad of [-1, 1.5, "2", null]) {
      const line = JSON.stringify({ ...launch({}), launchIndex: bad });
      expect(parseAgentLaunch(line)?.launchIndex).toBe(0);
    }
  });
});

describe("G2: `cc-smart-dev-kit usage` counts by the fields", () => {
  it("G2: `opus:xhigh:security` counts by its effort AND its word", () => {
    const lines = formatAgentLaunches([
      launch({ effort: "xhigh", reason: "opus:xhigh:security", word: "security" }),
      launch({ effort: "xhigh", reason: "opus:xhigh" }),
      launch({ effort: "max", family: "fable", reason: "fable:plan", word: "plan" }),
      // An old line: no effort recorded.
      launch({ effort: null, family: "fable", reason: "fable:build", word: "build" }),
    ]);
    expect(lines).toEqual([
      "",
      "Opus / Fable launches: 4 (Opus 2, Fable 2); effort: xhigh 2, effort not recorded 1, max 1; why: build 1, no word 1, plan 1, security 1",
    ]);
  });
});
