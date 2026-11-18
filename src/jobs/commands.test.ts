import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
/** A tool in the folder's `node_modules/.bin` that does nothing and ends with 0. */
function fakeTool(folder: string, name: string): string {
  const bin = join(folder, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, name), 0o755);
  return join(bin, name);
}
const stateDirOf = (ctx: JobContext) => jobsPaths(ctx.paths.home).stateDir;

test("named files skip the queue entirely", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "file.test.ts"), "");
  expect(
    await runJobCommand(["run", "--kind", "test:run", "--", vitest, "run", "file.test.ts"], ctx),
  ).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(false);
});
// The judge reads the line the way a shell runs it: through `sh -c`, after a `cd`, in the folder
// the `cd` moves to. Read as argv words it saw `-c` and a string, took a slot and waited.
test("named files in a shell string, after a cd, skip the queue", async () => {
  const { ctx } = world();
  const app = join(ctx.cwd, "app");
  mkdirSync(app);
  const vitest = fakeTool(app, "vitest");
  writeFileSync(join(app, "a.test.ts"), "");
  const line = `cd ${app} && ${vitest} run a.test.ts`;
  expect(await runJobCommand(["run", "--kind", "test:run", "--", "sh", "-c", line], ctx)).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(false);
});
test("a run on a file that is not there is a full run and takes a slot", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  expect(
    await runJobCommand(["run", "--kind", "test:run", "--", vitest, "run", "missing.test.ts"], ctx),
  ).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
});
// The judge may only lower a run to light on a finding it can prove: a command it cannot read
// keeps its slot, whatever its words look like.
test("a command the judge cannot read takes a slot", async () => {
  const { ctx } = world();
  writeFileSync(join(ctx.cwd, "file.ts"), "");
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "true", "file.ts"], ctx)).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
});
test("a watch run is no light run: it takes a slot as it did", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "file.test.ts"), "");
  expect(
    await runJobCommand(
      ["run", "--kind", "test:run", "--", vitest, "--watch", "file.test.ts"],
      ctx,
    ),
  ).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
});
test("--exclusive opens the queue whatever the weight of the run", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "file.test.ts"), "");
  expect(
    await runJobCommand(["run", "--exclusive", "db", "--", vitest, "run", "file.test.ts"], ctx),
  ).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
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
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "file.test.ts"), "");
  try {
    expect(
      await runJobCommand(["run", "--kind", "test:run", "--", vitest, "run", "file.test.ts"], ctx),
    ).toBe(0);
    expect(await store.held()).toHaveLength(1);
    expect(await store.waiting()).toEqual([]);
  } finally {
    lease?.release();
  }
});
test("print-only runs skip the store", async () => {
  const { ctx } = world();
  const tsc = fakeTool(ctx.cwd, "tsc");
  expect(await runJobCommand(["run", "--kind", "tsc", "--", tsc, "--version"], ctx)).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(false);
});
test("removed set and gb options are rejected", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["set", "max-jobs", "2"], ctx)).toBe(2);
  expect(await runJobCommand(["run", "--kind", "tsc", "--gb", "2", "--", "true"], ctx)).toBe(2);
});
test("set max chooses a machine limit and validates bounds", async () => {
  const { ctx, lines } = world();
  expect(await runJobCommand(["set", "max", "2"], ctx)).toBe(0);
  expect(await runJobCommand(["status"], ctx)).toBe(0);
  expect(lines.join("\n")).toContain("Heavy jobs: 0 of 2 slots in use");
  expect(lines.join("\n")).toContain("heavy-jobs.json");
  for (const value of ["0", "9", "1.5", "NaN", ""]) {
    expect(await runJobCommand(["set", "max", value], ctx)).toBe(2);
  }
  expect(await runJobCommand(["set", "max", "8"], ctx)).toBe(0);
  expect(await runJobCommand(["set", "max", "1"], ctx)).toBe(0);
});
test("bad kind and missing command never launch", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["run", "--kind", "absent", "--", "true"], ctx)).toBe(2);
  expect(await runJobCommand(["run", "--kind", "tsc", "--"], ctx)).toBe(2);
});
