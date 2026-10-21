/**
 * The launch record (`agent-launches.ts`): each line's `effort` and `word` fields, an old line
 * that carries only `reason`, and de-duplication by tool call AND launch index — a Workflow's
 * launches share one `tool_use_id`.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  type AgentLaunch,
  appendAgentLaunch,
  appendAgentLaunches,
  formatAgentLaunches,
  parseAgentLaunch,
  RECORD_TAIL_BYTES,
  readAgentLaunches,
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

describe("G2: each launch is recorded once", () => {
  it("G2: three launches of one call, one tool_use_id: three lines, and a second run adds none", () => {
    const file = join(tempDir("launches"), "agent-launches.jsonl");
    const run = [0, 1, 2].map((launchIndex) => launch({ launchIndex }));
    appendAgentLaunches(file, run);
    appendAgentLaunches(file, run);
    // One at a time, too: the line already there is found, not only the last one.
    appendAgentLaunch(file, launch({ launchIndex: 0 }));
    expect(readAgentLaunches(file, 0).map((one) => one.launchIndex)).toEqual([0, 1, 2]);
    // Another call, or the same id in another session, is another launch.
    appendAgentLaunch(file, launch({ toolUseId: "toolu_2" }));
    appendAgentLaunch(file, launch({ session: "s2" }));
    expect(readAgentLaunches(file, 0)).toHaveLength(5);
  });

  it("G2: a line with no tool_use_id is never taken for another", () => {
    const file = join(tempDir("launches"), "agent-launches.jsonl");
    appendAgentLaunch(file, launch({ toolUseId: "" }));
    appendAgentLaunch(file, launch({ toolUseId: "" }));
    expect(readAgentLaunches(file, 0)).toHaveLength(2);
  });

  it("G2: only the record's tail is read to find a line already written", () => {
    const file = join(tempDir("launches"), "agent-launches.jsonl");
    const first = `${JSON.stringify(launch({ toolUseId: "toolu_old" }))}\n`;
    // A record longer than the tail: the first line lies before it.
    const filler = `${JSON.stringify(launch({ toolUseId: "toolu_x", session: "other" }))}\n`;
    const count = Math.ceil(RECORD_TAIL_BYTES / filler.length) + 1;
    writeFileSync(file, first + filler.repeat(count));
    appendAgentLaunch(file, launch({ toolUseId: "toolu_x", session: "other" }));
    // The tail held that line: nothing added.
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toHaveLength(count + 1);
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
