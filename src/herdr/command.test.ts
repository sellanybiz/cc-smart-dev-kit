import { expect, test } from "bun:test";
import { cliPaths } from "../cli/paths";
import { createOut } from "../cli/ui/out";
import { tempDir } from "../testing/temp";
import { type HerdrContext, runHerdr } from "./command";
import type { HcRunner } from "./hc";

function setup(overrides: Partial<HerdrContext> = {}) {
  const lines: string[] = [];
  const calls: string[][] = [];
  const runner: HcRunner = (args) => {
    calls.push(args);
    const verb = args[0];
    if (verb === "--version") return { exitCode: 0, stderr: "", stdout: "hc 0.1.20" };
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify(
        verb === "ls"
          ? { terminals: [] }
          : verb === "server"
            ? { core: { id: "core", name: "local" }, version: "0.1.20" }
            : {
                address: "t2",
                name: "kit-one",
                state: "live",
                labels: { "kit.lead": "core/t1" },
                status: { app: "claude-code", state: "idle" },
                turn: 3,
              },
      ),
    };
  };
  const dir = tempDir();
  const paths = cliPaths({ HOME: dir, CLAUDE_CONFIG_DIR: dir });
  const out = createOut(
    { color: false, unicode: true, width: 200, rich: false },
    { line: (s) => lines.push(s), raw: (s) => lines.push(s) },
  );
  const ctx: HerdrContext = {
    paths,
    cwd: dir,
    env: { HOME: dir },
    nowMs: 123,
    now: () => 123,
    sleep: async () => {},
    out,
    runner,
    identity: () => ({ core: "core", address: "t1", leadId: "core/t1" }),
    ...overrides,
  };
  return { ctx, lines, calls };
}
test("list prints count and ownership filter, json stays structured", async () => {
  const { ctx, lines, calls } = setup();
  expect(await runHerdr(["list"], ctx)).toBe(0);
  expect(lines[0]).toContain("live kit sessions: 0 (0 blocked)");
  expect(calls).toContainEqual(["ls", "--json", "--label", "kit.lead=core/t1"]);
});
test("send tries idle and never uses force", async () => {
  const { ctx, calls } = setup();
  expect(await runHerdr(["send", "t2", "hello"], ctx)).toBe(0);
  expect(calls).toContainEqual([
    "send",
    "--json",
    "--if",
    "idle",
    "--",
    "t2",
    '<kit-report from="lead">hello</kit-report>',
  ]);
});
test("start refuses premium models before launch", async () => {
  const { ctx, calls } = setup();
  expect(
    await runHerdr(
      ["start", "--model", "fable", "--effort", "high", "--mode", "manual", "--", "secret"],
      ctx,
    ),
  ).toBe(1);
  expect(calls.some((a) => a[0] === "run")).toBe(false);
});
test("answer refuses stale prompts and text without typing", async () => {
  const { ctx, calls } = setup();
  expect(
    await runHerdr(
      ["answer", "t2", "--expect", "question", "--expect-turn", "3", "--option", "1"],
      ctx,
    ),
  ).toBe(1);
  expect(calls.some((a) => a[0] === "keys")).toBe(false);
});
