import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { runJobCommand } from "./commands";
import { jobsPaths } from "./config";
import { holderText } from "./queue";
import { type JobContext, openStores } from "./status";

function world() {
  const home = tempDir("jobs-command");
  const lines: string[] = [];
  const ctx: JobContext = {
    paths: cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }),
    cwd: home,
    execArgv: ["--no-env-file"],
    say: (s) => lines.push(s),
    print: (s) => lines.push(s),
  };
  return { ctx, lines };
}
test("plain child keeps its exit code and old machine settings are never read", async () => {
  const { ctx } = world();
  const dir = join(ctx.paths.home, ".config", "cc-smart-dev-kit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "jobs.json"), "{");
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "sh", "-c", "exit 7"], ctx)).toBe(7);
  expect(await openStores(ctx).machine.held()).toEqual([]);
});
test("named files skip the queue entirely", async () => {
  const { ctx } = world();
  writeFileSync(join(ctx.cwd, "file.ts"), "");
  expect(await runJobCommand(["run", "--kind", "test:run", "--", "true", "file.ts"], ctx)).toBe(0);
  expect(existsSync(jobsPaths(ctx.paths.home).stateDir)).toBe(false);
});
test("named files start while a heavy slot is occupied", async () => {
  const { ctx } = world();
  const store = openStores(ctx).machine;
  const lease = await store.tryTake(
    true,
    holderText({
      checkout: ctx.cwd,
      kind: "build",
      person: "host",
      pid: process.pid,
      since: 0,
      slot: true,
      v: 1,
      what: "build",
    }),
  );
  writeFileSync(join(ctx.cwd, "file.ts"), "");
  try {
    expect(await runJobCommand(["run", "--kind", "test:run", "--", "true", "file.ts"], ctx)).toBe(
      0,
    );
    expect(await store.held()).toHaveLength(1);
    expect(await store.waiting()).toEqual([]);
  } finally {
    lease?.release();
  }
});
test("print-only runs skip the store", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "true", "--version"], ctx)).toBe(0);
  expect(existsSync(jobsPaths(ctx.paths.home).stateDir)).toBe(false);
});
test("removed set and gb options are rejected", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["set", "max-jobs", "2"], ctx)).toBe(2);
  expect(await runJobCommand(["run", "--kind", "tsc", "--gb", "2", "--", "true"], ctx)).toBe(2);
});
test("bad kind and missing command never launch", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["run", "--kind", "absent", "--", "true"], ctx)).toBe(2);
  expect(await runJobCommand(["run", "--kind", "tsc", "--"], ctx)).toBe(2);
});
