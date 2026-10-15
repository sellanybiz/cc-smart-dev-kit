/**
 * How a job starts and ends (`launch.ts`, `run.ts`, `ancestry.ts`): the launch mode, the
 * exact argv, exit codes, signals, the "killed for memory" line, and nesting. The real
 * systemd is never touched: the facts and the slice control are fakes, and the children
 * that do run are `sh`, `sleep` and a missing program.
 */
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  ancestorPids,
  isInsideHeavyJob,
  parentPidFromStat,
  readProcStat,
  type StatReader,
} from "./ancestry";
import { DEFAULT_KINDS, type KindSpec } from "./kinds";
import {
  ceilingArgv,
  chooseLaunch,
  exitCodeOf,
  type LaunchFacts,
  launchArgv,
  oomKills,
  probeArgv,
  type SignalSource,
  sliceMemoryMax,
  spawnAndWait,
  unitName,
} from "./launch";
import { type JobDeps, type JobRequest, runJob } from "./run";

const SLICE = "anymodel-heavy.slice";

function facts(overrides: Partial<LaunchFacts>, ok: (withOomPolicy: boolean) => boolean) {
  const probes: boolean[] = [];
  const result: LaunchFacts = {
    platform: "linux",
    hasUserRuntimeDir: true,
    hasSystemdRun: true,
    hasChoom: true,
    probeScope: (withOomPolicy) => {
      probes.push(withOomPolicy);
      return ok(withOomPolicy);
    },
    ...overrides,
  };
  return { facts: result, probes };
}

describe("chooseLaunch", () => {
  test("runs in a scope with OOMPolicy=kill when the probe with it works", () => {
    const { facts: f, probes } = facts({}, () => true);
    expect(chooseLaunch(f)).toEqual({ mode: "scope", oomPolicy: true });
    expect(probes).toEqual([true]);
  });

  test("drops OOMPolicy when systemd refuses it on a scope, but keeps the scope", () => {
    const { facts: f, probes } = facts({}, (withOomPolicy) => !withOomPolicy);
    expect(chooseLaunch(f)).toEqual({ mode: "scope", oomPolicy: false });
    expect(probes).toEqual([true, false]);
  });

  test("falls back to choom, with a reason, when no scope can be made", () => {
    const { facts: f, probes } = facts({}, () => false);
    expect(chooseLaunch(f)).toEqual({
      mode: "choom",
      note: "systemd could not start a scope here (no user session bus?): the job runs with its kill mark only, no memory group",
    });
    expect(probes).toEqual([true, false]);
  });

  test("does not probe without a user manager or systemd-run: choom only", () => {
    const noDir = facts({ hasUserRuntimeDir: false }, () => true);
    expect(chooseLaunch(noDir.facts)).toEqual({
      mode: "choom",
      note: "no systemd user manager here: the job runs with its kill mark only, no memory group",
    });
    expect(noDir.probes).toEqual([]);
    const noRun = facts({ hasSystemdRun: false }, () => true);
    expect(chooseLaunch(noRun.facts).mode).toBe("choom");
    expect(noRun.probes).toEqual([]);
  });

  test("runs plain with no choom, and plain on macOS and Windows without a word", () => {
    const noChoom = facts({ hasChoom: false }, () => true);
    expect(chooseLaunch(noChoom.facts)).toEqual({
      mode: "plain",
      note: "no `choom` here: the job runs without its kill mark",
    });
    expect(noChoom.probes).toEqual([]);
    for (const platform of ["darwin", "win32"] as const) {
      const other = facts({ platform }, () => true);
      expect(chooseLaunch(other.facts)).toEqual({ mode: "plain" });
      expect(other.probes).toEqual([]);
    }
  });
});

describe("the argv of each launch", () => {
  // startedAt 46655 is "zzz" in base 36: the unit name carries it.
  const where = { kind: "test:coverage", pid: 4242, slice: SLICE, startedAt: 46_655 };

  test("scope: systemd-run in the slice, a named unit, OOMPolicy, then choom 900", () => {
    expect(launchArgv({ mode: "scope", oomPolicy: true }, ["vitest", "run"], where)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=anymodel-heavy.slice",
      "-p",
      "OOMPolicy=kill",
      "--unit=anymodel-heavy-test-coverage-4242-zzz.scope",
      "--",
      "choom",
      "-n",
      "900",
      "--",
      "vitest",
      "run",
    ]);
  });

  test("scope without OOMPolicy leaves only that property out", () => {
    expect(
      launchArgv({ mode: "scope", oomPolicy: false }, ["tsgo"], { ...where, kind: "tsc" }),
    ).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=anymodel-heavy.slice",
      "--unit=anymodel-heavy-tsc-4242-zzz.scope",
      "--",
      "choom",
      "-n",
      "900",
      "--",
      "tsgo",
    ]);
  });

  test("choom and plain", () => {
    expect(launchArgv({ mode: "choom" }, ["tsgo", "--noEmit"], where)).toEqual([
      "choom",
      "-n",
      "900",
      "--",
      "tsgo",
      "--noEmit",
    ]);
    expect(launchArgv({ mode: "plain" }, ["tsgo", "--noEmit"], where)).toEqual([
      "tsgo",
      "--noEmit",
    ]);
  });

  test("the probe uses the same scope switches as the launch, and runs `true`", () => {
    expect(probeArgv(SLICE, true)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=anymodel-heavy.slice",
      "-p",
      "OOMPolicy=kill",
      "--",
      "true",
    ]);
    expect(probeArgv(SLICE, false)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=anymodel-heavy.slice",
      "--",
      "true",
    ]);
  });

  test("unit names carry no colon, and the start time in base 36", () => {
    expect(unitName(SLICE, "lint:typed", 7, 46_655)).toBe("anymodel-heavy-lint-typed-7-zzz.scope");
    expect(unitName("jobs.slice", "image:build", 8, 36)).toBe("jobs-image-build-8-10.scope");
    // A `job run` killed with SIGKILL can leave its scope; a new one with its pid must not
    // collide with it ("unit exists": exit 1, read as a failure).
    expect(unitName(SLICE, "tsc", 99, 1000)).not.toBe(unitName(SLICE, "tsc", 99, 1001));
  });

  test("sets the slice's ceiling with no swap", () => {
    expect(ceilingArgv(SLICE, "40G")).toEqual([
      "systemctl",
      "--user",
      "set-property",
      "--runtime",
      "anymodel-heavy.slice",
      "MemoryMax=40G",
      "MemorySwapMax=0",
    ]);
  });
});

describe("exit codes, the kill count, the ceiling", () => {
  test("passes a code through and maps a signal death to 128 + n", () => {
    expect(exitCodeOf(3, null)).toBe(3);
    expect(exitCodeOf(0, null)).toBe(0);
    expect(exitCodeOf(null, "SIGTERM")).toBe(143);
    expect(exitCodeOf(null, "SIGKILL")).toBe(137);
    expect(exitCodeOf(null, "SIGINT")).toBe(130);
  });

  test("reads oom_kill, not oom_group_kill or oom", () => {
    expect(oomKills("low 0\nhigh 0\nmax 12\noom 2\noom_kill 5\noom_group_kill 1\n")).toBe(5);
    expect(oomKills("low 0\noom_group_kill 4\n")).toBeNull();
    expect(oomKills(null)).toBeNull();
  });

  test("the slice's ceiling is the machine budget, never below the job, in whole GB", () => {
    expect(sliceMemoryMax(32, 8)).toBe("32G");
    expect(sliceMemoryMax(14, 20)).toBe("20G");
    expect(sliceMemoryMax(32.7, 2.5)).toBe("32G");
  });
});

/** A fake `/proc`: pid to parent pid. */
function procTree(parents: Record<number, number>): StatReader {
  return (pid) => {
    const parent = parents[pid];
    return parent === undefined ? null : `${String(pid)} (b (u) n) S ${String(parent)} 1 1 0 -1`;
  };
}

describe("ancestry: is this job inside another one?", () => {
  test("reads the parent after the LAST bracket, whatever the command name holds", () => {
    expect(parentPidFromStat("100 (tsgo) S 99 100 1 0")).toBe(99);
    expect(parentPidFromStat("100 (a) S 7 (b) R 5) S 42 100 1 0")).toBe(42);
    expect(parentPidFromStat("garbage")).toBeNull();
  });

  test("walks the parent chain to the top, and stops on a loop", () => {
    expect(ancestorPids(50, procTree({ 1: 0, 10: 1, 20: 10, 50: 20 }))).toEqual([20, 10, 1]);
    expect(ancestorPids(5, procTree({ 5: 6, 6: 7, 7: 6 }))).toEqual([6, 7]);
  });

  test("is nested when an ancestor holds a lease; its own lease is not nesting", async () => {
    const readStat = procTree({ 1: 0, 10: 1, 20: 10, 50: 20 });
    const ask = (holders: number[]) =>
      isInsideHeavyJob({
        holderPids: () => Promise.resolve(new Set(holders)),
        pid: 50,
        platform: "linux",
        readStat,
      });
    expect(await ask([10, 999])).toBe(true);
    expect(await ask([50, 999])).toBe(false);
  });

  test("does not look off Linux", async () => {
    let asked = false;
    const nested = await isInsideHeavyJob({
      holderPids: () => {
        asked = true;
        return Promise.resolve(new Set([10]));
      },
      pid: 50,
      platform: "darwin",
      readStat: procTree({ 50: 10, 10: 1 }),
    });
    expect(nested).toBe(false);
    expect(asked).toBe(false);
  });

  test.if(process.platform === "linux")("reads the real /proc: the parent comes first", () => {
    expect(ancestorPids(process.pid, readProcStat)[0]).toBe(process.ppid);
  });
});

describe("spawnAndWait: real children", () => {
  test("returns the child's exit code", async () => {
    expect(await spawnAndWait(["sh", "-c", "exit 3"], new EventEmitter())).toBe(3);
  });

  test("returns 128 + n for a child killed by a signal", async () => {
    expect(await spawnAndWait(["sh", "-c", "kill -TERM $$"], new EventEmitter())).toBe(143);
  });

  test("returns 127 for a command that does not exist, and says why", async () => {
    const said: string[] = [];
    expect(
      await spawnAndWait(["anymodel-no-such-command-xyz"], new EventEmitter(), (line) =>
        said.push(line),
      ),
    ).toBe(127);
    expect(said).toEqual(["could not start anymodel-no-such-command-xyz: ENOENT"]);
  });

  test("sends SIGTERM on to the child, and lets go of its listeners after", async () => {
    const signals = new EventEmitter();
    const running = spawnAndWait(["sleep", "30"], signals);
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    signals.emit("SIGTERM");
    expect(await running).toBe(143);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGHUP")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  test("sends SIGHUP on", async () => {
    const signals = new EventEmitter();
    const running = spawnAndWait(["sleep", "30"], signals);
    signals.emit("SIGHUP");
    expect(await running).toBe(129);
  });

  test("does NOT send SIGINT on (the terminal already did), and keeps waiting", async () => {
    const signals: EventEmitter & SignalSource = new EventEmitter();
    const running = spawnAndWait(["sh", "-c", "sleep 0.3; exit 5"], signals);
    expect(signals.listenerCount("SIGINT")).toBe(1);
    signals.emit("SIGINT");
    expect(await running).toBe(5);
  });
});

// ── runJob: the order of things, with a fake queue ──────────────────────────────

interface Recorder {
  events: string[];
  said: string[];
  runs: (readonly string[])[];
}

function recorder(): Recorder {
  return { events: [], runs: [], said: [] };
}

function deps(
  r: Recorder,
  overrides: Partial<JobDeps> & { oom?: [number, number]; code?: number } = {},
): JobDeps {
  const { code = 0, oom, ...rest } = overrides;
  const oomReads = oom === undefined ? [] : [...oom];
  return {
    acquire: (job, onWaiting) => {
      r.events.push(
        `acquire ${job.kind} ${job.gb} GB pid ${job.pid} in ${job.checkout}: ${job.what}`,
      );
      onWaiting("waiting: 8 GB held by host-a (tsc)");
      return Promise.resolve({ gb: job.gb, release: () => r.events.push("release") });
    },
    isNested: () => Promise.resolve(false),
    launchFacts: () => ({
      hasChoom: true,
      hasSystemdRun: true,
      hasUserRuntimeDir: true,
      platform: "linux",
      probeScope: () => {
        r.events.push("probe");
        return true;
      },
    }),
    memoryMaxFor: (size) => `${32 + size}G`,
    run: (argv) => {
      r.runs.push(argv);
      r.events.push("run");
      return Promise.resolve(code);
    },
    say: (line) => r.said.push(line),
    slice: {
      controlGroup: (slice) => `/user.slice/x/${slice}`,
      readFile: (path) => {
        r.events.push(`read ${path}`);
        const value = oomReads.shift();
        return value === undefined ? null : `oom 0\noom_kill ${value}\n`;
      },
      setMemoryMax: (slice, value) => {
        r.events.push(`set ${slice} MemoryMax=${value}`);
        return true;
      },
    },
    workersFor: (size, gbEach) => size / gbEach / 4,
    ...rest,
  };
}

function testRun(): KindSpec {
  const spec = DEFAULT_KINDS["test:run"];
  if (spec === undefined) throw new Error("no test:run kind");
  return spec;
}

const request: JobRequest = {
  checkout: "/home/user/app-wt-x",
  command: ["vitest", "run", "src/a.test.ts"],
  gb: 8,
  kind: "test:run",
  spec: testRun(),
  pid: 4242,
  slice: SLICE,
  startedAt: 46_655,
};

const tsc: Partial<JobRequest> = { command: ["tsgo"], kind: "tsc", spec: { gb: 8 } };

describe("runJob", () => {
  test("reserves, probes, sets the ceiling, runs once in the scope, then gives back", async () => {
    const r = recorder();
    expect(await runJob(request, deps(r, { code: 0, oom: [2, 2] }))).toBe(0);
    expect(r.events).toEqual([
      "acquire test:run 8 GB pid 4242 in /home/user/app-wt-x: vitest run src/a.test.ts",
      "probe",
      "set anymodel-heavy.slice MemoryMax=40G",
      "read /sys/fs/cgroup/user.slice/x/anymodel-heavy.slice/memory.events",
      "run",
      "read /sys/fs/cgroup/user.slice/x/anymodel-heavy.slice/memory.events",
      "release",
    ]);
    expect(r.runs).toEqual([
      [
        "systemd-run",
        "--user",
        "--scope",
        "--quiet",
        "--collect",
        "--slice=anymodel-heavy.slice",
        "-p",
        "OOMPolicy=kill",
        "--unit=anymodel-heavy-test-run-4242-zzz.scope",
        "--",
        "choom",
        "-n",
        "900",
        "--",
        "vitest",
        "run",
        "src/a.test.ts",
        "--maxWorkers=4",
      ],
    ]);
    expect(r.said).toEqual(["waiting: 8 GB held by host-a (tsc)"]);
  });

  test("a job that fails (exit 1) is the answer: one launch, no fallback, no retry", async () => {
    const r = recorder();
    expect(await runJob({ ...request, ...tsc }, deps(r, { code: 1 }))).toBe(1);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]?.[0]).toBe("systemd-run");
    expect(r.events.filter((event) => event === "probe")).toEqual(["probe"]);
  });

  test("says 'killed for memory' when the slice's oom_kill rose, and keeps the job's code", async () => {
    const r = recorder();
    expect(await runJob(request, deps(r, { code: 1, oom: [2, 3] }))).toBe(1);
    expect(r.said[1]).toBe(
      "killed for memory: the heavy jobs running here together went over anymodel-heavy.slice's ceiling, and the kernel stopped the largest. Run it again when fewer heavy jobs run (exit code 1).",
    );
  });

  test("says nothing about memory when the count did not move, or the job ended well", async () => {
    for (const [code, oom] of [
      [1, [3, 3]],
      [0, [2, 3]],
    ] as const) {
      const r = recorder();
      await runJob(request, deps(r, { code, oom: [...oom] }));
      expect(r.said.some((line) => line.includes("killed for memory"))).toBe(false);
    }
  });

  test("runs a nested job directly: no queue, no scope, no worker option", async () => {
    const r = recorder();
    expect(await runJob(request, deps(r, { code: 4, isNested: () => Promise.resolve(true) }))).toBe(
      4,
    );
    expect(r.events).toEqual(["run"]);
    expect(r.runs).toEqual([["vitest", "run", "src/a.test.ts"]]);
  });

  test("a print-only job (0 GB) runs plain: no probe, no ceiling change", async () => {
    const r = recorder();
    await runJob({ ...request, ...tsc, command: ["tsgo", "--version"], gb: 0 }, deps(r));
    expect(r.events).toEqual([
      "acquire tsc 0 GB pid 4242 in /home/user/app-wt-x: tsgo --version",
      "run",
      "release",
    ]);
    expect(r.runs).toEqual([["tsgo", "--version"]]);
  });

  test("launch: plain in the config starts the job as it is", async () => {
    const r = recorder();
    await runJob({ ...request, ...tsc }, deps(r, { launchFacts: () => null }));
    expect(r.runs).toEqual([["tsgo"]]);
    expect(r.events).not.toContain("probe");
  });

  test("choom mode says why, and touches no slice", async () => {
    const r = recorder();
    const noManager = deps(r, {
      launchFacts: () => ({
        hasChoom: true,
        hasSystemdRun: true,
        hasUserRuntimeDir: false,
        platform: "linux",
        probeScope: () => true,
      }),
    });
    await runJob({ ...request, ...tsc }, noManager);
    expect(r.runs).toEqual([["choom", "-n", "900", "--", "tsgo"]]);
    expect(r.events.some((event) => event.startsWith("set ") || event.startsWith("read "))).toBe(
      false,
    );
    expect(r.said).toContain(
      "no systemd user manager here: the job runs with its kill mark only, no memory group",
    );
  });

  test("still runs in the scope when the ceiling cannot be set, and says so", async () => {
    const r = recorder();
    const base = deps(r);
    await runJob(
      { ...request, ...tsc },
      { ...base, slice: { ...base.slice, setMemoryMax: () => false } },
    );
    expect(r.runs[0]?.[0]).toBe("systemd-run");
    expect(r.said).toContain(
      "could not set anymodel-heavy.slice MemoryMax=40G: the job runs without the slice's ceiling",
    );
  });

  test("adds no worker option to a shell line, where it would land in $0", async () => {
    const r = recorder();
    await runJob(
      { ...request, command: ["sh", "-c", "vitest run"] },
      deps(r, { launchFacts: () => null }),
    );
    expect(r.runs).toEqual([["sh", "-c", "vitest run"]]);
  });

  test("starts nothing when a signal came while it waited, and still gives back", async () => {
    const r = recorder();
    expect(await runJob(request, deps(r, { stopped: () => true }))).toBe(1);
    expect(r.runs).toEqual([]);
    expect(r.events.at(-1)).toBe("release");
  });

  test("gives back the reservation even when the launch throws", async () => {
    const r = recorder();
    const failing = deps(r, { run: () => Promise.reject(new Error("spawn exploded")) });
    await expect(runJob(request, failing)).rejects.toThrow("spawn exploded");
    expect(r.events.at(-1)).toBe("release");
  });
});
