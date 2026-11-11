import { expect, test } from "bun:test";
import {
  childModeAllowed,
  cliModeFlag,
  MODE_ORDER,
  modeWiderThan,
  normalizeMode,
  parseHerdrArgs,
} from "./words";

test("every mode pair", () => {
  for (const [i, lead] of MODE_ORDER.entries())
    for (const [j, child] of MODE_ORDER.entries()) {
      expect(modeWiderThan(child, lead)).toBe(j > i);
      expect(childModeAllowed(lead, child).ok).toBe(i !== 0 && j <= i);
    }
  expect(normalizeMode("manual")).toBe("default");
  expect(normalizeMode("default")).toBe("default");
  expect(normalizeMode("bypassPermissions")).toBeNull();
  expect(cliModeFlag("default")).toBe("manual");
  expect(childModeAllowed("unknown", "default")).toEqual({
    ok: false,
    why: "Unknown lead mode: ask the person.",
  });
  expect(childModeAllowed("auto", "bypassPermissions").ok).toBe(false);
});
test("every verb", () => {
  expect(
    parseHerdrArgs([
      "start",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--mode",
      "manual",
      "--cwd",
      "/repo",
      "--on",
      "remote",
      "--name",
      "child",
      "--independent",
      "--asked",
      "--",
      "--brief",
    ]),
  ).toEqual({
    verb: "start",
    model: "sonnet",
    effort: "high",
    mode: "default",
    cwd: "/repo",
    on: "remote",
    name: "child",
    independent: true,
    asked: true,
    brief: "--brief",
  });
  expect(
    parseHerdrArgs([
      "start",
      "--model",
      "opus",
      "--effort",
      "max",
      "--mode",
      "auto",
      "--task",
      "#7",
      "--",
      "do it",
    ]),
  ).toMatchObject({ verb: "start", task: "#7", brief: "do it" });
  expect(parseHerdrArgs(["list", "--all", "--json"])).toEqual({
    verb: "list",
    all: true,
    json: true,
  });
  expect(parseHerdrArgs(["send", "t7", "hello"])).toEqual({
    verb: "send",
    target: "t7",
    text: "hello",
  });
  expect(
    parseHerdrArgs(["answer", "t7", "--expect", "q", "--expect-turn", "0", "--option", "2"]),
  ).toEqual({ verb: "answer", target: "t7", expect: "q", expectTurn: 0, option: "2" });
  expect(
    parseHerdrArgs(["answer", "t7", "--expect", "q", "--expect-turn", "1", "--text", "words"]),
  ).toMatchObject({ verb: "answer", text: "words" });
  expect(parseHerdrArgs(["wait"])).toEqual({ verb: "wait", mode: "any" });
  for (const mode of ["any", "all"] as const)
    expect(parseHerdrArgs(["wait", `--${mode}`])).toEqual({ verb: "wait", mode });
  expect(parseHerdrArgs(["report", "done"])).toEqual({ verb: "report", text: "done" });
  expect(parseHerdrArgs(["adopt"])).toEqual({ verb: "adopt" });
  expect(parseHerdrArgs(["stop", "t7"])).toEqual({ verb: "stop", target: "t7" });
  expect(parseHerdrArgs(["machines"])).toEqual({ verb: "machines", action: "list" });
  expect(parseHerdrArgs(["machines", "list"])).toEqual({ verb: "machines", action: "list" });
  for (const action of ["allow", "forget", "production"] as const)
    expect(parseHerdrArgs(["machines", action, "remote"])).toEqual({
      verb: "machines",
      action,
      name: "remote",
    });
});
test("errors carry usage", () => {
  for (const args of [
    [],
    ["unknown"],
    ["list", "--all", "--all"],
    ["send", "t7"],
    ["stop", "t7", "extra"],
    ["adopt", "extra"],
    ["wait", "--any", "--all"],
    ["machines", "allow"],
    ["machines", "list", "extra"],
    ["report", ""],
    ["start", "--model", "sonnet"],
    ["start", "--model", "bad", "--effort", "high", "--mode", "auto", "--", "do"],
    ["start", "--model", "sonnet", "--effort", "low", "--mode", "auto", "--", "do"],
    ["start", "--model", "sonnet", "--effort", "high", "--mode", "bypassPermissions", "--", "do"],
    ["start", "--model", "sonnet", "--effort", "high", "--mode", "auto", "do"],
    [
      "start",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--mode",
      "auto",
      "--independent",
      "--task",
      "#1",
      "--",
      "do",
    ],
    ["answer", "t7", "--expect", "q", "--expect-turn", "-1", "--option", "1"],
    ["answer", "t7", "--expect", "q", "--expect-turn", "1", "--option", "1", "--text", "hi"],
    ["list", "--what"],
  ]) {
    const r = parseHerdrArgs(args);
    expect(r).toHaveProperty("error");
    if ("error" in r) expect(r.error).toContain("Usage:");
  }
});
