/** The commands the hooks brought: `session-name`, and `doctor`'s options. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const SESSION = "11111111-2222-3333-4444-555555555555";

function cli(args: string[]) {
  const home = tempDir("cmd-home");
  const guard = subprocessGuard();
  const result = Bun.spawnSync(["bun", ...guard.args, CLI, ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, ...guard.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    home,
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("anymodel session-name", () => {
  test("records the name the session chose, cleaned", () => {
    const run = cli(["session-name", SESSION, "Fix", "the", "login\tpage"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      'This session will be named "Fix the login page" from the next prompt.\n',
    );
    expect(readFileSync(join(run.home, "anymodel-session-names", `${SESSION}.name`), "utf8")).toBe(
      "Fix the login page",
    );
  });

  test("no name: usage, exit 2; a bad id: the reason, exit 1", () => {
    const usage = cli(["session-name", SESSION]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr).toStartWith("Usage: anymodel session-name <session id> <name>");
    const bad = cli(["session-name", "../x", "name"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toBe('anymodel: "../x" is not a session id\n');
  });
});

test("doctor refuses an option it does not know", () => {
  const run = cli(["doctor", "--lively"]);
  expect(run.exitCode).toBe(2);
  expect(run.stderr).toStartWith("Unknown option: --lively");
});
