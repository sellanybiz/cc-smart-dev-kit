import { describe, expect, test } from "bun:test";
import type { ProjectGatewayData, ProjectProfileSlot } from "@/api/types";
import {
  gatewayDraftOf,
  gatewayRequest,
  personalFileWords,
  runningWords,
  slotApplies,
  stateTone,
} from "./gateway";

/** The command's refusal of on in a team file, as its planner words it. */
const TEAM_ON =
  "a team file never points teammates at one person's local router: on each teammate's machine, 127.0.0.1 is their own computer, so their sessions would fail or reach whatever listens on that port. Set this project's state for yourself (no --team), or put off or default in the team file.";

/** A project that sets nothing, on a machine with a gateway and two profiles. */
function answer(over: Partial<ProjectGatewayData> = {}): ProjectGatewayData {
  return {
    choice: {
      from: "nothing in this project",
      profile: null,
      source: "none",
      state: "default",
      words:
        "default: no file of this project sets a gateway address, so the machine's settings decide",
    },
    configured: true,
    effective: {
      from: "the machine's settings ~/.claude/settings.json",
      profile: null,
      source: "machine",
      state: "on",
      words: "on → http://127.0.0.1:20100",
    },
    files: [],
    notes: [],
    personalTracked: false,
    refusals: {
      personal: { default: null, off: null, on: null },
      team: { default: null, off: null, on: TEAM_ON },
    },
    profile: null,
    profiles: ["cheap", "fast"],
    writable: true,
    ...over,
  };
}

describe("the state's tone", () => {
  test("on is good, another address a warning, unknown a fault, off and default plain facts", () => {
    expect(stateTone("on")).toBe("ok");
    expect(stateTone("off")).toBe("info");
    expect(stateTone("default")).toBe("info");
    expect(stateTone("other")).toBe("warn");
    expect(stateTone("unknown")).toBe("bad");
  });
});

describe("the change form starts from the project's own choice", () => {
  test("a project that sets nothing starts at default, in the personal file", () => {
    expect(gatewayDraftOf(answer())).toEqual({ profile: null, state: "default", team: false });
  });

  test("a team file's off starts there, in the team file", () => {
    const team = answer({
      choice: { from: "the team file", profile: null, source: "team", state: "off", words: "off" },
    });
    expect(gatewayDraftOf(team)).toEqual({ profile: null, state: "off", team: true });
  });

  test("on with a profile keeps its profile", () => {
    const on = answer({
      choice: { from: "p", profile: "cheap", source: "personal", state: "on", words: "on" },
    });
    expect(gatewayDraftOf(on)).toEqual({ profile: "cheap", state: "on", team: false });
  });

  test("another address or an unknown one starts at default: there is nothing of ours to keep", () => {
    const other = answer({
      choice: { from: "p", profile: null, source: "personal", state: "other", words: "x" },
    });
    expect(gatewayDraftOf(other)).toEqual({ profile: null, state: "default", team: false });
  });
});

describe("what the form may send", () => {
  test("the project's own choice again is nothing to send", () => {
    expect(gatewayRequest(answer(), { profile: null, state: "default", team: false })).toEqual({
      kind: "same",
    });
  });

  test("a new state is the action's body, with the file and the profile", () => {
    expect(gatewayRequest(answer(), { profile: "cheap", state: "on", team: false })).toEqual({
      body: { profile: "cheap", state: "on", team: false },
      kind: "send",
    });
    expect(gatewayRequest(answer(), { profile: null, state: "off", team: true })).toEqual({
      body: { profile: null, state: "off", team: true },
      kind: "send",
    });
  });

  test("a profile goes only with on: off never carries the one the form held", () => {
    expect(gatewayRequest(answer(), { profile: "cheap", state: "off", team: false })).toEqual({
      body: { profile: null, state: "off", team: false },
      kind: "send",
    });
  });

  test("the command's own refusal for the file and the state is what the form says", () => {
    expect(gatewayRequest(answer(), { profile: null, state: "on", team: true })).toEqual({
      kind: "blocked",
      why: TEAM_ON,
    });
    const login = "apiKeyHelper is set in ~/code/my-app/.claude/settings.json: …";
    const refused = answer({
      refusals: {
        personal: { default: null, off: login, on: login },
        team: { default: null, off: login, on: TEAM_ON },
      },
    });
    expect(gatewayRequest(refused, { profile: null, state: "off", team: false })).toEqual({
      kind: "blocked",
      why: login,
    });
    expect(gatewayRequest(refused, { profile: null, state: "off", team: true })).toEqual({
      kind: "blocked",
      why: login,
    });
    // Default is still written there: the refusal is the command's, per state.
    expect(gatewayRequest(refused, { profile: null, state: "default", team: true })).toEqual({
      body: { profile: null, state: "default", team: true },
      kind: "send",
    });
  });

  test("another address or an unreadable one offers nothing until a change is chosen", () => {
    const other = answer({
      choice: { from: "p", profile: null, source: "personal", state: "other", words: "x" },
    });
    expect(gatewayRequest(other, gatewayDraftOf(other))).toEqual({ kind: "same" });
    const unknown = answer({
      choice: { from: "p", profile: null, source: "personal", state: "unknown", words: "x" },
    });
    expect(gatewayRequest(unknown, gatewayDraftOf(unknown))).toEqual({ kind: "same" });
  });

  test("a profile the config no longer has is refused before the command is asked", () => {
    expect(gatewayRequest(answer(), { profile: "gone", state: "on", team: false })).toEqual({
      kind: "blocked",
      why: 'The router has no profile "gone": choose one it has, or none.',
    });
  });
});

describe("what reaches a running session (P7)", () => {
  test("a changed address reaches it; a removed one falls to the next file that sets it", () => {
    const changed =
      "A session already running in this project switches within about a second; restart it if the file did not exist when it started.";
    expect(runningWords("on")).toBe(changed);
    expect(runningWords("off")).toBe(changed);
    expect(runningWords("default")).toBe(
      "Default removes the address. A session already running in this project follows by itself, within about a second, to the next settings file that sets it (the machine's, say); only when no file sets it does the session keep the address it had until it restarts.",
    );
  });
});

describe("the personal file's words", () => {
  test("never committed, unless git tracks it in this project", () => {
    expect(personalFileWords(answer())).toBe(
      "Only you: .claude/settings.local.json in the main checkout, never committed. Every worktree of the project reads it first; a worktree's own copy of the file sets only what this one does not.",
    );
    expect(personalFileWords(answer({ personalTracked: true }))).toBe(
      "Only you, by its name: .claude/settings.local.json in the main checkout. But git tracks it in this project, so what is written there is committed with it.",
    );
  });
});

describe("what applies to a profile's slot", () => {
  const slot = (over: Partial<ProjectProfileSlot>): ProjectProfileSlot => ({
    fallback: true,
    key: "cc-smart-dev-kit-worker",
    machine: ["omniroute:deepseek-v4"],
    name: "worker",
    own: null,
    ...over,
  });

  test("its own chain wins over the machine's", () => {
    expect(slotApplies(slot({ own: ["omniroute:glm-5"] }))).toEqual({
      chain: ["omniroute:glm-5"],
      from: "own",
    });
  });

  test("Claude in the profile wins over any machine chain", () => {
    expect(slotApplies(slot({ own: "claude" }))).toEqual({ chain: null, from: "claude" });
  });

  test("with no entry the machine's chain applies, or Claude when the machine has none", () => {
    expect(slotApplies(slot({}))).toEqual({ chain: ["omniroute:deepseek-v4"], from: "machine" });
    expect(slotApplies(slot({ machine: null }))).toEqual({ chain: null, from: "machine" });
  });
});
