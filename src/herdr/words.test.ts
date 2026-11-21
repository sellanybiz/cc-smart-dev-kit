import { expect, test } from "bun:test";
import {
  BASE_FOLLOWUP_REFUSAL,
  BRIEF_AND_WORDS,
  cliModeFlag,
  HERDR_USAGE,
  MODE_ORDER,
  normalizeMode,
  PLAN_EXCLUSION,
  parseHerdrArgs,
} from "./words";

test("the modes, and the words a mode goes by", () => {
  expect(MODE_ORDER).toEqual(["plan", "default", "acceptEdits", "auto", "dontAsk"]);
  expect(normalizeMode("manual")).toBe("default");
  expect(normalizeMode("default")).toBe("default");
  expect(normalizeMode("bypassPermissions")).toBeNull();
  expect(cliModeFlag("default")).toBe("manual");
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
  // 4.10.1: the relay is gone; a child's question is the person's.
  const answer = parseHerdrArgs([
    "answer",
    "t7",
    "--expect",
    "q",
    "--expect-turn",
    "0",
    "--option",
    "2",
  ]);
  expect(answer).toHaveProperty("error");
  if ("error" in answer) expect(answer.error).toStartWith("Choose a herdr verb.\nUsage:");
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

test("start --plan: the slug is kept, and it excludes --task, --independent and --on", () => {
  const start = ["start", "--model", "sonnet", "--effort", "high", "--mode", "manual"];
  expect(parseHerdrArgs([...start, "--plan", "alpha", "--", "go"])).toEqual({
    verb: "start",
    model: "sonnet",
    effort: "high",
    mode: "default",
    independent: false,
    asked: false,
    brief: "go",
    plan: "alpha",
  });
  for (const extra of [["--task", "#7"], ["--independent"], ["--on", "remote"]]) {
    const parsed = parseHerdrArgs([...start, "--plan", "alpha", ...extra, "--", "go"]);
    expect(parsed).toHaveProperty("error");
    if ("error" in parsed)
      expect(parsed.error).toStartWith(
        "--plan cannot be combined with --task, --independent or --on.",
      );
  }
  expect(parseHerdrArgs([...start, "--plan", " ", "--", "go"])).toHaveProperty("error");
});

test("start --followup: repeated --issue is kept in order, and every exclusion is refused", () => {
  const start = ["start", "--model", "sonnet", "--effort", "high", "--mode", "manual"];
  expect(parseHerdrArgs([...start, "--followup", "--", "fix it"])).toEqual({
    verb: "start",
    model: "sonnet",
    effort: "high",
    mode: "default",
    independent: false,
    asked: false,
    brief: "fix it",
    followup: true,
    issues: [],
  });
  expect(
    parseHerdrArgs([
      ...start,
      "--followup",
      "--issue",
      "12",
      "--issue=7",
      "--issue",
      "12",
      "--",
      "x",
    ]),
  ).toMatchObject({ followup: true, issues: ["12", "7"] });
  for (const extra of [
    ["--plan", "alpha"],
    ["--task", "#7"],
    ["--independent"],
    ["--on", "remote"],
  ]) {
    const parsed = parseHerdrArgs([...start, "--followup", ...extra, "--", "go"]);
    expect(parsed).toHaveProperty("error");
    if ("error" in parsed)
      expect(parsed.error).toStartWith(
        "--followup cannot be combined with --plan, --task, --independent or --on.",
      );
  }
  for (const bad of ["0", "-1", "07", "1.5", "abc", "#3"]) {
    const parsed = parseHerdrArgs([...start, "--followup", "--issue", bad, "--", "go"]);
    expect(parsed).toHaveProperty("error");
    if ("error" in parsed) expect(parsed.error).toStartWith("Use an issue number such as 12.");
  }
  const lone = parseHerdrArgs([...start, "--issue", "3", "--", "go"]);
  expect(lone).toHaveProperty("error");
  if ("error" in lone) expect(lone.error).toStartWith("--issue belongs to --followup.");
  expect(parseHerdrArgs([...start, "--followup", "--followup", "--", "go"])).toHaveProperty(
    "error",
  );
});

test("plans takes --json, --wait and a --timeout that belongs to --wait", () => {
  expect(parseHerdrArgs(["plans"])).toEqual({ verb: "plans", json: false, wait: false });
  expect(parseHerdrArgs(["plans", "--json", "--wait", "--timeout", "30"])).toEqual({
    verb: "plans",
    json: true,
    wait: true,
    timeoutMs: 30_000,
  });
  for (const bad of [
    ["--timeout", "30"],
    ["--wait", "--timeout", "0"],
    ["--wait", "--timeout", "x"],
    ["extra"],
  ])
    expect(parseHerdrArgs(["plans", ...bad])).toHaveProperty("error");
});

test("the usage names --plan and plans", () => {
  const parsed = parseHerdrArgs(["plans", "extra"]);
  if (!("error" in parsed)) throw new Error("expected an error");
  expect(parsed.error).toContain("herdr plans [--json] [--wait] [--timeout <seconds>]");
  expect(HERDR_USAGE).toContain("[--task <#n> | --plan <slug> | --followup [--issue <n>]…]");
});

test("plans --release names one plan and stands alone", () => {
  expect(parseHerdrArgs(["plans", "--release", "alpha"])).toEqual({
    verb: "plans",
    json: false,
    wait: false,
    release: "alpha",
  });
  for (const bad of [
    ["--release"],
    ["--release", " "],
    ["--release", "alpha", "--wait"],
    ["--release", "alpha", "--json"],
  ])
    expect(parseHerdrArgs(["plans", ...bad])).toHaveProperty("error");
});

test("plans --reserve names one plan and stands alone", () => {
  expect(parseHerdrArgs(["plans", "--reserve", "alpha"])).toEqual({
    verb: "plans",
    json: false,
    wait: false,
    reserve: "alpha",
  });
  for (const bad of [
    ["--reserve"],
    ["--reserve", " "],
    ["--reserve", "alpha", "--wait"],
    ["--reserve", "alpha", "--json"],
    ["--reserve", "alpha", "--release", "beta"],
    ["--reserve", "alpha", "--timeout", "30"],
  ])
    expect(parseHerdrArgs(["plans", ...bad])).toHaveProperty("error");
  expect(HERDR_USAGE).toContain("plans --reserve <plan>");
});

test("the --plan exclusion has one text, in the parser and in the early refusal", () => {
  const parsed = parseHerdrArgs([
    "start",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--mode",
    "manual",
    "--plan",
    "alpha",
    "--task",
    "#7",
    "--",
    "go",
  ]);
  if (!("error" in parsed)) throw new Error("expected an error");
  expect(parsed.error).toStartWith(PLAN_EXCLUSION);
});

test("start --base keeps the ref, and a follow-up child cannot take one", () => {
  const start = ["start", "--model", "sonnet", "--effort", "high", "--mode", "manual"];
  expect(parseHerdrArgs([...start, "--base", "plan-branch", "--", "go"])).toMatchObject({
    verb: "start",
    base: "plan-branch",
    brief: "go",
  });
  expect(
    parseHerdrArgs([...start, "--base=origin/feat", "--task", "#7", "--", "go"]),
  ).toMatchObject({ base: "origin/feat", task: "#7" });
  expect(parseHerdrArgs([...start, "--", "go"])).not.toHaveProperty("base");
  for (const [extra, why] of [
    [["--base", "x", "--followup"], BASE_FOLLOWUP_REFUSAL],
    [["--base", " "], "--base needs a value."],
    [["--base", "-x"], "--base needs a branch, a tag or a commit, not an option."],
  ] as const) {
    const parsed = parseHerdrArgs([...start, ...extra, "--", "go"]);
    expect(parsed).toHaveProperty("error");
    if ("error" in parsed) expect(parsed.error).toStartWith(why);
  }
});

test("start --brief-file takes the place of the words after --, and never both", () => {
  const start = ["start", "--model", "sonnet", "--effort", "high", "--mode", "manual"];
  const expected = {
    verb: "start",
    model: "sonnet",
    effort: "high",
    mode: "default",
    independent: false,
    asked: false,
    brief: "",
    briefFile: "brief.md",
  } as const;
  expect(parseHerdrArgs([...start, "--brief-file", "brief.md"])).toEqual(expected);
  expect(parseHerdrArgs([...start, "--brief-file=brief.md", "--"])).toEqual(expected);
  const both = parseHerdrArgs([...start, "--brief-file", "brief.md", "--", "words"]);
  if (!("error" in both)) throw new Error("expected an error");
  expect(both.error).toStartWith(BRIEF_AND_WORDS);
  // Without the file, the old rule stays word for word.
  const bare = parseHerdrArgs(start);
  if (!("error" in bare)) throw new Error("expected an error");
  expect(bare.error).toStartWith("Put -- before the brief.");
  expect(parseHerdrArgs([...start, "--brief-file", " "])).toHaveProperty("error");
  expect(parseHerdrArgs([...start, "--brief-file", "a", "--brief-file", "b"])).toHaveProperty(
    "error",
  );
});

test("send --brief-file takes the message from a file, and never beside words", () => {
  expect(parseHerdrArgs(["send", "t7", "--brief-file", "msg.md"])).toEqual({
    verb: "send",
    target: "t7",
    text: "",
    briefFile: "msg.md",
  });
  for (const args of [
    ["send", "t7", "words", "--brief-file", "msg.md"],
    ["send", "--brief-file", "msg.md"],
    ["send", "t7", "--brief-file"],
  ]) {
    const parsed = parseHerdrArgs(args);
    expect(parsed).toHaveProperty("error");
    if ("error" in parsed) expect(parsed.error).toContain("Usage:");
  }
  expect(HERDR_USAGE).toContain("send <terminal> (<text> | --brief-file <path>)");
  expect(HERDR_USAGE).toContain("[--base <ref>]");
  expect(HERDR_USAGE).toContain("(-- <brief> | --brief-file <path>)");
});
