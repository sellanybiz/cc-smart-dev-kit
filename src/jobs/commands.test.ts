import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { type FakeLimitOptions, fakeControllersFile, fakeLimitFacts } from "../testing/limit-facts";
import { tempDir } from "../testing/temp";
import { limitsFor, runJobCommand } from "./commands";
import { jobsPaths, readLimitSettings } from "./config";
import { holderText } from "./queue";
import { type JobContext, openStores } from "./status";

/**
 * A world whose machine is not Linux by default: the limits stay off and say nothing, so a test
 * that runs a real child never starts `systemd-run` on the host. A test about the limits passes
 * its own facts, and the fake answers every systemd call itself.
 */
function world(limits: FakeLimitOptions = { platform: "darwin" }) {
  const home = tempDir("jobs-command");
  const lines: string[] = [];
  const fake = fakeLimitFacts(limits);
  const ctx: JobContext = {
    paths: cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }),
    cwd: home,
    execArgv: ["--no-env-file"],
    limits: fake.facts,
    say: (s) => lines.push(s),
    print: (s) => lines.push(s),
  };
  return { ctx, lines, calls: fake.calls };
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
// A light run beside a command the judge does not know: that command may be the heavy work, so
// the line keeps its slot (it took one before the judge, and must still).
test("a light run beside an unknown command in a shell string takes a slot", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "a.test.ts"), "");
  // `ls` is no glue and not a heavy kind: the reader does not know it, and it ends with 0 in any
  // folder (`git status` fails outside a repository). `true` is glue.
  const line = `${vitest} run a.test.ts && ls`;
  expect(await runJobCommand(["run", "--kind", "build", "--", "sh", "-c", line], ctx)).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
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

// `job hook <name>` is the script's question; its answers are tested in hook-command.test.ts. A
// name the folder holds no script for is answered without git.
test("job hook answers through the job command, and always ends with 0", async () => {
  const { ctx, lines } = world();
  expect(await runJobCommand(["hook", "not-a-hook"], ctx)).toBe(0);
  expect(lines).toEqual(["direct"]);
});

// `job run --hook`: a git hook from the kit's hooks folder, which `job hook` already judged heavy.
// commit-msg gets git's message file as its one word, which the named-file rule read as a light
// run, so the hook never took a slot.
test("--hook takes the slot even when its words name one existing file", async () => {
  const { ctx } = world();
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "COMMIT_EDITMSG"), "a message\n");
  expect(
    await runJobCommand(
      ["run", "--hook", "--kind", "test:run", "--", vitest, "run", "COMMIT_EDITMSG"],
      ctx,
    ),
  ).toBe(0);
  expect(existsSync(stateDirOf(ctx))).toBe(true);
});

/** A world whose jobs state folder cannot be made: a file stands where the folder goes. */
function brokenStore() {
  const made = world();
  const stateDir = stateDirOf(made.ctx);
  mkdirSync(join(stateDir, ".."), { recursive: true });
  writeFileSync(stateDir, "not a folder");
  return made;
}

const DIRECT = "; the git hook runs without the queue.";

test("--hook runs the hook at once when the queue's store is broken, with one line", async () => {
  const { ctx, lines } = brokenStore();
  const run = ["run", "--hook", "--kind", "test:run", "--", "sh", "-c", "exit 3"];
  expect(await runJobCommand(run, ctx)).toBe(3);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("[cc-smart-dev-kit job] ");
  expect(lines[0]).toEndWith(DIRECT);
});

// The store opens, then breaks while the hook waits for its slot: the queue throws inside the
// run, before the hook starts.
test("--hook runs the hook at once when the queue breaks while it takes the slot", async () => {
  const { ctx, lines } = world();
  const stateDir = stateDirOf(ctx);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "leases"), "not a folder");
  const run = ["run", "--hook", "--kind", "test:run", "--", "sh", "-c", "exit 6"];
  expect(await runJobCommand(run, ctx)).toBe(6);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("[cc-smart-dev-kit job] ");
  expect(lines[0]).toEndWith(DIRECT);
});

test("without --hook a broken store still fails, and the command never runs", async () => {
  const { ctx } = brokenStore();
  const marker = join(ctx.cwd, "ran");
  const run = ["run", "--kind", "test:run", "--", "sh", "-c", `touch '${marker}'`];
  expect(await runJobCommand(run, ctx)).toBe(2);
  expect(existsSync(marker)).toBe(false);
});

// ---- the CPU and memory limits ----

const configFileOf = (ctx: JobContext) => jobsPaths(ctx.paths.home).configFile;
const PREFIX = "[cc-smart-dev-kit job] ";

test("set cpu and set memory write one key each and print the caps", async () => {
  const { ctx, lines } = world({ platform: "linux" });
  expect(await runJobCommand(["set", "cpu", "70"], ctx)).toBe(0);
  expect(lines.at(-1)).toBe(`Heavy-job caps: CPU 70%, memory 90% (${configFileOf(ctx)})`);
  expect(await runJobCommand(["set", "memory", "100"], ctx)).toBe(0);
  expect(lines.at(-1)).toBe(`Heavy-job caps: CPU 70%, memory 100% (${configFileOf(ctx)})`);
  expect(readLimitSettings(ctx.paths.home)).toMatchObject({
    ok: true,
    settings: { cpuPercent: 70, memoryPercent: 100 },
  });
  expect(await runJobCommand(["set", "cpu", "10"], ctx)).toBe(0);
  expect(await runJobCommand(["set", "cpu", "100"], ctx)).toBe(0);
});

test("set cpu and set memory refuse a value outside 10 to 100, and write nothing", async () => {
  const { ctx, lines } = world();
  for (const key of ["cpu", "memory"]) {
    for (const value of ["9", "101", "0", "-5", "1.5", "NaN", "", "abc"]) {
      expect(await runJobCommand(["set", key, value], ctx)).toBe(2);
    }
    expect(await runJobCommand(["set", key], ctx)).toBe(2);
    expect(await runJobCommand(["set", key, "50", "60"], ctx)).toBe(2);
  }
  expect(lines.every((line) => line.includes("set cpu <n>"))).toBe(true);
  expect(existsSync(configFileOf(ctx))).toBe(false);
});

test("set max stays as it was, beside the new keys", async () => {
  const { ctx } = world();
  expect(await runJobCommand(["set", "max", "3"], ctx)).toBe(0);
  expect(await runJobCommand(["set", "cpu", "60"], ctx)).toBe(0);
  expect(JSON.parse(readFileSync(configFileOf(ctx), "utf8"))).toEqual({
    maxConcurrent: 3,
    cpuPercent: 60,
  });
  expect(await runJobCommand(["set", "speed", "3"], ctx)).toBe(2);
});

test("status shows the caps", async () => {
  const { ctx, lines } = world({ platform: "linux" });
  expect(await runJobCommand(["set", "memory", "80"], ctx)).toBe(0);
  lines.length = 0;
  expect(await runJobCommand(["status"], ctx)).toBe(0);
  expect(lines.join("\n")).toContain(
    `Heavy-job limit: 1 (default). Heavy-job caps: CPU 90%, memory 80% (${configFileOf(ctx)})`,
  );
});

// Where the limits cannot apply the job still runs, with its own exit code, and says why once.
test("a job still runs when the limits cannot apply, and the line names the reason", async () => {
  const { ctx, lines } = world({ platform: "linux", files: { [fakeControllersFile()]: null } });
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "sh", "-c", "exit 7"], ctx)).toBe(7);
  expect(lines).toEqual([
    `${PREFIX}this job runs without CPU and memory limits: no systemd user manager with cgroup v2 here (its controllers file is missing)`,
  ]);
});

test("a bad cpuPercent runs the job without limits, names the key, and never stops the queue", async () => {
  const { ctx, lines, calls } = world({ platform: "linux" });
  mkdirSync(join(configFileOf(ctx), ".."), { recursive: true });
  writeFileSync(configFileOf(ctx), '{"cpuPercent":500}');
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "sh", "-c", "exit 7"], ctx)).toBe(7);
  expect(lines).toEqual([
    `${PREFIX}this job runs without CPU and memory limits: ${configFileOf(ctx)}: cpuPercent must be an integer from 10 to 100 (fix: correct it in that file (a whole number from 10 to 100), or remove it and run cc-smart-dev-kit job set cpu <n>)`,
  ]);
  expect(calls).toEqual([]); // nothing was asked of systemd
  // The queue is intact: the lease was taken and given back, and the queue setting still works.
  expect(await openStores(ctx).machine.held()).toEqual([]);
  expect(await runJobCommand(["set", "max", "4"], ctx)).toBe(0);
});

test("a probe that fails runs the job plain, with one line, and only the probes were asked", async () => {
  const { ctx, lines, calls } = world({ platform: "linux", systemd: () => "failed" });
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "sh", "-c", "exit 5"], ctx)).toBe(5);
  expect(lines).toEqual([
    `${PREFIX}this job runs without CPU and memory limits: systemd could not start a scope here (no user session bus?)`,
  ]);
  expect(calls.map((call) => call[0])).toEqual(["systemd-run", "systemd-run", "systemd-run"]);
});

test("not Linux: the job runs, nothing is said, systemd is never asked", async () => {
  const { ctx, lines, calls } = world({ platform: "win32" });
  expect(await runJobCommand(["run", "--kind", "tsc", "--", "sh", "-c", "exit 2"], ctx)).toBe(2);
  expect(lines).toEqual([]);
  expect(calls).toEqual([]);
});

test("a light run and a print-only run never ask for limits", async () => {
  const { ctx, calls } = world({ platform: "linux" });
  const vitest = fakeTool(ctx.cwd, "vitest");
  writeFileSync(join(ctx.cwd, "file.test.ts"), "");
  expect(
    await runJobCommand(["run", "--kind", "test:run", "--", vitest, "run", "file.test.ts"], ctx),
  ).toBe(0);
  const tsc = fakeTool(ctx.cwd, "tsc");
  expect(await runJobCommand(["run", "--kind", "tsc", "--", tsc, "--version"], ctx)).toBe(0);
  expect(calls).toEqual([]);
});

test("a git hook with a bad limit still runs, with the one line, and not as a failed queue", async () => {
  const { ctx, lines } = world({ platform: "linux" });
  mkdirSync(join(configFileOf(ctx), ".."), { recursive: true });
  writeFileSync(configFileOf(ctx), '{"memoryPercent":"all"}');
  const run = ["run", "--hook", "--kind", "test:run", "--", "sh", "-c", "exit 3"];
  expect(await runJobCommand(run, ctx)).toBe(3);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("memoryPercent must be an integer from 10 to 100");
  expect(lines[0]).not.toEndWith(DIRECT);
});

// The wiring `jobRun` hands to `runJob`: this machine's facts, the settings as they are now, and
// `maxConcurrent` for the memory line. (The scope it starts is proved by the opt-in live test.)
describe("the limits a queued job gets", () => {
  const job = { kind: "tsc", command: ["tsc"], pid: 9, startedAt: 5 } as const;

  test("on a working machine: the probe, the slice's properties, then the job's scope", () => {
    const { ctx, calls } = world({ platform: "linux", cpus: 4 });
    expect(limitsFor(ctx)(job).on).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("CPUQuota=360%");
  });

  test("the settings are read at the launch: a cap set after the job queued applies", async () => {
    const { ctx, calls } = world({ platform: "linux", cpus: 4 });
    await runJobCommand(["set", "cpu", "50"], ctx);
    limitsFor(ctx)(job);
    expect(calls[1]).toContain("CPUQuota=200%");
  });

  test("the memory line knows whether the heavy jobs share the cap", async () => {
    const eventsFile = `/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cc.slice/cc-smart.slice/cc-smart-dev.slice/cc-smart-dev-kit.slice/cc-smart-dev-kit-jobs.slice/memory.events`;
    for (const [slots, words] of [
      [1, "this job reached"],
      [3, "the heavy jobs together reached"],
    ] as const) {
      const world1 = fakeLimitFacts({
        files: { [eventsFile]: "oom 0\noom_kill 0\n" },
        systemdText: () => "ActiveState=failed\nResult=oom-kill\n",
      });
      const ctx = { ...world().ctx, limits: world1.facts };
      await runJobCommand(["set", "max", String(slots)], ctx);
      const start = limitsFor(ctx)(job);
      if (!start.on) throw new Error("limits off");
      world1.files.set(eventsFile, "oom 1\noom_kill 1\n");
      expect(start.memoryLine({ code: 137, signal: "SIGKILL", sentOn: false })).toContain(words);
    }
  });
});

test("--hook runs the hook at once for a kind the project no longer has", async () => {
  const { ctx, lines } = world();
  const run = ["run", "--hook", "--kind", "gone", "--", "sh", "-c", "exit 4"];
  expect(await runJobCommand(run, ctx)).toBe(4);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith('[cc-smart-dev-kit job] unknown kind "gone": one of ');
  expect(lines[0]).toEndWith(DIRECT);
  expect(existsSync(stateDirOf(ctx))).toBe(false);
});

test("--hook runs the hook at once when an option cannot be read", async () => {
  const { ctx, lines } = world();
  const run = ["run", "--hook", "--soon", "--", "sh", "-c", "exit 5"];
  expect(await runJobCommand(run, ctx)).toBe(5);
  expect(lines).toEqual([`[cc-smart-dev-kit job] unknown option: --soon${DIRECT}`]);
});
