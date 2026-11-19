import { describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import {
  FAKE_UID,
  fakeControllersFile,
  fakeLimitFacts,
  fakeSliceDir,
} from "../testing/limit-facts";
import type { LimitRead } from "./config";
import {
  cpuListCount,
  cpuQuota,
  JOBS_SLICE,
  type LimitedStart,
  type LimitJob,
  liveSlice,
  machineCpus,
  probeArgv,
  runSystemd,
  SYSTEMD_TIMEOUT_MS,
  scopeHandle,
  scopeKillArgv,
  sliceChain,
  slicePropertyArgvs,
  startLimits,
  systemdWord,
  unitName,
  userManagerCgroup,
  userSliceCgroup,
} from "./limits";

const good = (cpuPercent = 90, memoryPercent = 90): LimitRead => ({
  ok: true,
  settings: { cpuPercent, memoryPercent },
  source: "default",
});
const job: LimitJob = {
  kind: "tsc",
  command: ["tsc", "--noEmit"],
  pid: 42,
  startedAt: 1_000_000,
};
const UNIT = unitName(JOBS_SLICE, "tsc", 42, 1_000_000);
const MEMINFO = "MemTotal:       32768000 kB\nMemFree:  100 kB\n";

function on(start: LimitedStart) {
  if (!start.on) throw new Error(`limits are off: ${start.line}`);
  return start;
}

describe("where a slice lives", () => {
  test("a dash nests a slice: every level is its own folder", () => {
    expect(sliceChain("cc-smart-dev-kit-jobs.slice")).toEqual([
      "cc.slice",
      "cc-smart.slice",
      "cc-smart-dev.slice",
      "cc-smart-dev-kit.slice",
      "cc-smart-dev-kit-jobs.slice",
    ]);
    expect(userSliceCgroup(1000, "a-b.slice")).toBe(
      "/user.slice/user-1000.slice/user@1000.service/a.slice/a-b.slice",
    );
  });

  test("the jobs' slice is built from the command's name", () => {
    expect(JOBS_SLICE).toBe("cc-smart-dev-kit-jobs.slice");
  });
});

describe("how many CPUs a quota is relative to", () => {
  test("a cpuset list is counted", () => {
    expect(cpuListCount("0-11")).toBe(12);
    expect(cpuListCount("0-3,8,10-11\n")).toBe(7);
    expect(cpuListCount("5")).toBe(1);
    expect(cpuListCount("")).toBeNull();
    expect(cpuListCount("3-1")).toBeNull();
    expect(cpuListCount("a")).toBeNull();
  });

  test("the user manager's own cpuset wins, then the nearest one above it", () => {
    const manager = `/sys/fs/cgroup${userManagerCgroup(FAKE_UID)}/cpuset.cpus.effective`;
    const { facts } = fakeLimitFacts({ files: { [manager]: "0-3" } });
    expect(machineCpus(facts)).toBe(4);
    const above = fakeLimitFacts({
      files: { "/sys/fs/cgroup/user.slice/cpuset.cpus.effective": "0-5" },
    });
    expect(machineCpus(above.facts)).toBe(6);
  });

  test("no cpuset anywhere: the CPU count, never availableParallelism", () => {
    expect(machineCpus(fakeLimitFacts({ cpus: 8 }).facts)).toBe(8);
    expect(machineCpus(fakeLimitFacts({ uid: null, cpus: 3 }).facts)).toBe(3);
  });
});

describe("the slice's properties", () => {
  test("90% of 12 CPUs, 90% of memory: every property, with the watchdog's duration apart", () => {
    expect(slicePropertyArgvs(JOBS_SLICE, { cpuPercent: 90, memoryPercent: 90 }, 12)).toEqual({
      main: [
        "systemctl",
        "--user",
        "set-property",
        "--runtime",
        "cc-smart-dev-kit-jobs.slice",
        "CPUQuota=1080%",
        "CPUWeight=20",
        "MemoryMax=90%",
        "MemorySwapMax=0",
        "MemoryHigh=infinity",
        "ManagedOOMMemoryPressure=kill",
        "ManagedOOMMemoryPressureLimit=40%",
      ],
      duration: [
        "systemctl",
        "--user",
        "set-property",
        "--runtime",
        "cc-smart-dev-kit-jobs.slice",
        "ManagedOOMMemoryPressureDurationSec=10s",
      ],
    });
  });

  test("100% CPU writes an empty CPUQuota (it unsets), 100% memory keeps swap at 0", () => {
    const { main } = slicePropertyArgvs(JOBS_SLICE, { cpuPercent: 100, memoryPercent: 100 }, 12);
    expect(main).toContain("CPUQuota=");
    expect(main).toContain("MemoryMax=100%");
    expect(main).toContain("MemorySwapMax=0");
    expect(main).toContain("MemoryHigh=infinity");
    expect(cpuQuota(100, 12)).toBe("");
    expect(cpuQuota(10, 4)).toBe("40%");
  });

  test("the probe tests the switches the job runs with", () => {
    expect(probeArgv(JOBS_SLICE, true)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=cc-smart-dev-kit-jobs.slice",
      "-p",
      "OOMPolicy=kill",
      "--",
      "true",
    ]);
    expect(probeArgv(JOBS_SLICE, false)).not.toContain("OOMPolicy=kill");
  });

  test("a unit name carries the slice, the kind, the pid and the start time", () => {
    expect(unitName(JOBS_SLICE, "test:run", 42, 36 * 36)).toBe(
      "cc-smart-dev-kit-jobs-test-run-42-100.scope",
    );
    expect(unitName(JOBS_SLICE, "", 7, 0)).toBe("cc-smart-dev-kit-jobs-job-7-0.scope");
  });
});

describe("a limited start", () => {
  test("probe, then both set-property calls, then the job in its own scope with the kill mark", () => {
    const { facts, calls } = fakeLimitFacts();
    const start = on(startLimits(facts, good(), job, 1));
    expect(calls.map((call) => `${call[0]} ${call[1]} ${call[2]}`)).toEqual([
      "systemd-run --user --scope",
      "systemctl --user set-property",
      "systemctl --user set-property",
    ]);
    expect(calls[0]).toEqual(probeArgv(JOBS_SLICE, true));
    expect(calls[1]).toContain("CPUQuota=1080%");
    expect(calls[2]).toContain("ManagedOOMMemoryPressureDurationSec=10s");
    expect(start.argv).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=cc-smart-dev-kit-jobs.slice",
      "-p",
      "OOMPolicy=kill",
      `--unit=${UNIT}`,
      "--",
      "choom",
      "-n",
      "900",
      "--",
      "tsc",
      "--noEmit",
    ]);
  });

  // `systemd-run --scope` expands `$VAR`, `${VAR}` and `$$` in the command it is given (proved
  // live). The job must get its words as written, so each `$` is doubled: systemd's own escape.
  test("every dollar sign of the job's words is escaped for systemd-run, and only those", () => {
    expect(systemdWord("plain")).toBe("plain");
    expect(systemdWord("$HOME")).toBe("$$HOME");
    // A template literal's placeholder, written in parts so no linter reads it as a mistake.
    const placeholder = ["$", "{x}"].join("");
    expect(systemdWord(`a${placeholder}b$$`)).toBe(`a$${placeholder}b$$$$`);
    const { facts } = fakeLimitFacts();
    const start = on(
      startLimits(
        facts,
        good(),
        { ...job, command: ["bun", "-e", `${placeholder} + $$`, "%h"] },
        1,
      ),
    );
    expect(start.argv.slice(-3)).toEqual(["-e", `$${placeholder} + $$$$`, "%h"]);
    // The words of choom and systemd-run are not the job's, and carry no dollar sign.
    expect(start.argv.slice(0, -4).join(" ")).not.toContain("$");
  });

  test("no choom: the limits still apply, with no kill mark", () => {
    const { facts } = fakeLimitFacts({ programs: ["systemd-run"] });
    const start = on(startLimits(facts, good(), job, 1));
    expect(start.argv.slice(-4)).toEqual([`--unit=${UNIT}`, "--", "tsc", "--noEmit"]);
    expect(start.argv).not.toContain("choom");
  });

  test("a systemd without OOMPolicy on a scope: the probe without it, and the job without it", () => {
    const { facts, calls } = fakeLimitFacts({
      systemd: (argv) => (argv.includes("OOMPolicy=kill") ? "failed" : "ok"),
    });
    const start = on(startLimits(facts, good(), job, 1));
    expect(calls.slice(0, 2)).toEqual([probeArgv(JOBS_SLICE, true), probeArgv(JOBS_SLICE, false)]);
    expect(start.argv).not.toContain("OOMPolicy=kill");
  });

  test("a systemd older than 257 refuses the duration: the job still runs with the rest", () => {
    const { facts } = fakeLimitFacts({
      systemd: (argv) =>
        argv.some((word) => word.startsWith("ManagedOOMMemoryPressureDurationSec"))
          ? "failed"
          : "ok",
    });
    expect(startLimits(facts, good(), job, 1).on).toBe(true);
  });

  test("the CPU count comes from the user manager's cpuset, not from the process", () => {
    const manager = `/sys/fs/cgroup${userManagerCgroup(FAKE_UID)}/cpuset.cpus.effective`;
    const { facts, calls } = fakeLimitFacts({ cpus: 99, files: { [manager]: "0-3" } });
    startLimits(facts, good(50), job, 1);
    expect(calls[1]).toContain("CPUQuota=200%");
  });

  test("a lower limit is written at the next launch, a 100 writes the reset values", () => {
    const { facts, calls } = fakeLimitFacts();
    startLimits(facts, good(100, 100), job, 1);
    expect(calls[1]).toContain("CPUQuota=");
    expect(calls[1]).toContain("MemoryMax=100%");
  });
});

describe("when the limits cannot apply, the job still runs, and the first failing check says why", () => {
  const offLine = (start: LimitedStart) => (start.on ? null : start.line);

  test("not Linux: off, nothing said, nothing called", () => {
    for (const platform of ["darwin", "win32"] as const) {
      const { facts, calls } = fakeLimitFacts({ platform });
      expect(startLimits(facts, good(), job, 1)).toEqual({ on: false, line: null });
      expect(calls).toEqual([]);
    }
  });

  test("a bad setting: off, with a line that names the key and its fix", () => {
    const { facts, calls } = fakeLimitFacts();
    const bad: LimitRead = {
      ok: false,
      keys: ["cpuPercent"],
      message: "/h/heavy-jobs.json: cpuPercent must be an integer from 10 to 100",
    };
    expect(offLine(startLimits(facts, bad, job, 1))).toBe(
      "this job runs without CPU and memory limits: /h/heavy-jobs.json: cpuPercent must be an integer from 10 to 100 (fix: correct it in that file (a whole number from 10 to 100), or remove it and run cc-smart-dev-kit job set cpu <n>)",
    );
    expect(calls).toEqual([]);
    const both: LimitRead = { ok: false, keys: ["cpuPercent", "memoryPercent"], message: "m" };
    expect(offLine(startLimits(facts, both, job, 1))).toContain(
      "cc-smart-dev-kit job set cpu <n> and cc-smart-dev-kit job set memory <n>",
    );
  });

  test("a file that cannot be read has no key to fix", () => {
    const { facts } = fakeLimitFacts();
    expect(offLine(startLimits(facts, { ok: false, keys: [], message: "f: no" }, job, 1))).toBe(
      "this job runs without CPU and memory limits: f: no",
    );
  });

  test("no user manager files (the controllers file is absent): named, nothing called", () => {
    const { facts, calls } = fakeLimitFacts({ files: { [fakeControllersFile()]: null } });
    expect(offLine(startLimits(facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: no systemd user manager with cgroup v2 here (its controllers file is missing)",
    );
    expect(calls).toEqual([]);
  });

  test("no user id (a container without one): off", () => {
    const { facts } = fakeLimitFacts({ uid: null });
    expect(startLimits(facts, good(), job, 1).on).toBe(false);
  });

  test("a controller that is not delegated is named", () => {
    for (const [text, named] of [
      ["memory pids\n", '"cpu"'],
      ["cpu pids\n", '"memory"'],
      ["pids\n", '"cpu" or "memory"'],
    ] as const) {
      const { facts, calls } = fakeLimitFacts({ files: { [fakeControllersFile()]: text } });
      expect(offLine(startLimits(facts, good(), job, 1))).toBe(
        `this job runs without CPU and memory limits: the systemd user manager has no delegated ${named} controller`,
      );
      expect(calls).toEqual([]);
    }
  });

  test("no systemd-run on the PATH", () => {
    const { facts, calls } = fakeLimitFacts({ programs: ["choom"] });
    expect(offLine(startLimits(facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: systemd-run is not installed",
    );
    expect(calls).toEqual([]);
  });

  test("the probe fails both ways: off, and set-property is never called", () => {
    const { facts, calls } = fakeLimitFacts({
      systemd: (argv) => (argv[0] === "systemd-run" ? "failed" : "ok"),
    });
    expect(offLine(startLimits(facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: systemd could not start a scope here (no user session bus?)",
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call[0] === "systemd-run")).toBe(true);
  });

  test("a hung user bus: one probe only, the timeout named", () => {
    const { facts, calls } = fakeLimitFacts({ systemd: () => "timeout" });
    expect(offLine(startLimits(facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: systemd did not answer within 10 s",
    );
    expect(calls).toHaveLength(1);
  });

  test("set-property fails: off, with one line; a timeout there is named", () => {
    const refused = fakeLimitFacts({
      systemd: (argv) => (argv[1] === "--user" && argv[2] === "set-property" ? "failed" : "ok"),
    });
    expect(offLine(startLimits(refused.facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: systemd refused to set the limits on cc-smart-dev-kit-jobs.slice",
    );
    const hung = fakeLimitFacts({
      systemd: (argv) => (argv[2] === "set-property" ? "timeout" : "ok"),
    });
    expect(offLine(startLimits(hung.facts, good(), job, 1))).toContain(
      "did not answer within 10 s",
    );
  });

  test("a probe is first: set-property is not called when the controllers fail", () => {
    const { calls, facts } = fakeLimitFacts({ files: { [fakeControllersFile()]: "pids" } });
    startLimits(facts, good(), job, 1);
    expect(calls).toEqual([]);
  });

  test("it never throws: a facts object that breaks turns the limits off with its message", () => {
    const { facts } = fakeLimitFacts();
    const broken = {
      ...facts,
      systemd: () => {
        throw new Error("the bus exploded");
      },
    };
    expect(offLine(startLimits(broken, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: the bus exploded",
    );
  });
});

describe("the job's scope", () => {
  test("a signal goes through systemctl kill, never stop", () => {
    const { facts, calls } = fakeLimitFacts();
    const scope = scopeHandle(facts, UNIT);
    scope?.kill("SIGTERM");
    expect(calls).toEqual([["systemctl", "--user", "kill", "--signal=SIGTERM", UNIT]]);
    expect(scopeKillArgv(UNIT, "SIGKILL")).toEqual([
      "systemctl",
      "--user",
      "kill",
      "--signal=SIGKILL",
      UNIT,
    ]);
    expect(calls.flat()).not.toContain("stop");
  });

  test("empty is `populated 0` in cgroup.events at the chained path, or the cgroup gone", () => {
    const events = `${fakeSliceDir()}/${UNIT}/cgroup.events`;
    const world = fakeLimitFacts();
    const scope = scopeHandle(world.facts, UNIT);
    expect(scope?.isEmpty()).toBe(true); // gone: --collect removed it
    world.files.set(events, "populated 1\nfrozen 0\n");
    expect(scope?.isEmpty()).toBe(false);
    world.files.set(events, "populated 0\nfrozen 0\n");
    expect(scope?.isEmpty()).toBe(true);
  });

  test("no user id: no scope handle", () => {
    expect(scopeHandle(fakeLimitFacts({ uid: null }).facts, UNIT)).toBeNull();
  });
});

describe("a job stopped for memory says why, and never after exit 0", () => {
  const eventsFile = `${fakeSliceDir()}/memory.events`;
  const pressureFile = `${fakeSliceDir()}/memory.pressure`;
  const events = (oom: number, kills: number) =>
    `low 0\nhigh 0\nmax 0\noom ${oom}\noom_kill ${kills}\n`;
  const pressure = (avg10: number) => `some avg10=${avg10} avg60=1.00 avg300=0.10 total=5\n`;
  const exit1 = { code: 1, signal: null, sentOn: false } as const;
  const killed = { code: 137, signal: "SIGKILL", sentOn: false } as const;

  function run(
    options: { jobSlots?: number; programs?: string[]; files?: Record<string, string> } = {},
  ) {
    const world = fakeLimitFacts({
      programs: options.programs ?? ["systemd-run", "choom"],
      files: { [eventsFile]: events(0, 0), "/proc/meminfo": MEMINFO, ...options.files },
    });
    const start = on(startLimits(world.facts, good(), job, options.jobSlots ?? 1));
    return { world, start };
  }

  test("exit 0: nothing, even when the slice's counts rose (another job's kill)", () => {
    const { world, start } = run();
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine({ code: 0, signal: null, sentOn: false })).toBeNull();
  });

  test("the cap: the slice's own oom count rose; exit 1 is enough, 137 is not needed", () => {
    const { world, start } = run();
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine(exit1)).toBe(
      "killed for memory: this job reached the memory cap (28.1 GB, 90% of this machine's memory). Run it again when fewer heavy jobs run, or raise the cap with: cc-smart-dev-kit job set memory <n> (exit code 1)",
    );
  });

  test("the cap with max above one is the heavy jobs' together", () => {
    const { world, start } = run({ jobSlots: 3 });
    world.files.set(eventsFile, events(2, 2));
    expect(start.memoryLine(killed)).toContain(
      "killed for memory: the heavy jobs together reached the memory cap (28.1 GB, 90%",
    );
  });

  test("the machine ran out: only oom_kill rose; the kill mark is named when it was set", () => {
    const { world, start } = run();
    world.files.set(eventsFile, events(0, 1));
    expect(start.memoryLine(killed)).toBe(
      "killed for memory: the whole machine ran out of memory, and the kernel's OOM killer stopped this job first (its kill mark). Run it again when fewer heavy jobs run, or lower the cap so the jobs leave more for the machine, with: cc-smart-dev-kit job set memory <n> (exit code 137)",
    );
    const bare = run({ programs: ["systemd-run"] });
    bare.world.files.set(eventsFile, events(0, 1));
    expect(bare.start.memoryLine(killed)).not.toContain("kill mark");
  });

  test("oom cannot be read: the cap or the machine, said as unknown", () => {
    const { world, start } = run({ files: { [eventsFile]: "oom_kill 0\n" } });
    world.files.set(eventsFile, "oom_kill 1\n");
    expect(start.memoryLine(exit1)).toStartWith("killed for memory (the jobs' cap of");
  });

  test("the slice's events cannot be read at all: nothing said", () => {
    const { world, start } = run();
    world.files.delete(eventsFile);
    expect(start.memoryLine(exit1)).toBeNull();
  });

  test("a stall below the cap: a SIGKILL nobody here sent, the slice above the watchdog's limit", () => {
    const { world, start } = run();
    world.files.set(pressureFile, pressure(71.5));
    expect(start.memoryLine(killed)).toBe(
      "stopped for memory: this job stalled on memory below the cap (28.1 GB, 90% of this machine's memory), and the watchdog (systemd-oomd) stops a stalled job after 10s. Run it again when fewer heavy jobs run, or lower the cap so the jobs leave more for the machine, with: cc-smart-dev-kit job set memory <n> (exit code 137)",
    );
  });

  test("no stall line without the three proofs", () => {
    const { world, start } = run();
    world.files.set(pressureFile, pressure(10));
    expect(start.memoryLine(killed)).toBeNull(); // pressure below the limit
    world.files.set(pressureFile, pressure(80));
    expect(start.memoryLine(exit1)).toBeNull(); // no SIGKILL
    expect(start.memoryLine({ ...killed, sentOn: true })).toBeNull(); // our own stop
    world.files.delete(pressureFile);
    expect(start.memoryLine(killed)).toBeNull(); // no pressure file
  });

  test("no /proc/meminfo: the percent alone", () => {
    const { world, start } = run({ files: {} });
    world.files.delete("/proc/meminfo");
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine(exit1)).toContain("(90% of this machine's memory)");
  });

  test("nothing rose, no stall: nothing said", () => {
    const { start } = run();
    expect(start.memoryLine(exit1)).toBeNull();
  });
});

describe("what the jobs' slice carries now", () => {
  const files = (cpuMax: string | null, memoryMax: string | null) => ({
    [`${fakeSliceDir()}/cpu.max`]: cpuMax,
    [`${fakeSliceDir()}/memory.max`]: memoryMax,
    "/proc/meminfo": MEMINFO,
  });

  test("no cgroup yet: absent", () => {
    expect(liveSlice(fakeLimitFacts().facts, { cpuPercent: 90, memoryPercent: 90 })).toEqual({
      state: "absent",
    });
  });

  test("the values a launch writes: applied", () => {
    const bytes = String(Math.round(32768000 * 1024 * 0.9));
    const { facts } = fakeLimitFacts({ files: files("1080000 100000", bytes) as never });
    expect(liveSlice(facts, { cpuPercent: 90, memoryPercent: 90 })).toEqual({ state: "applied" });
  });

  test("100% CPU is `max`, and the memory within a page of the share", () => {
    const bytes = String(Math.round(32768000 * 1024 * 0.5) + 4096);
    const { facts } = fakeLimitFacts({ files: files("max 100000", bytes) as never });
    expect(liveSlice(facts, { cpuPercent: 100, memoryPercent: 50 })).toEqual({ state: "applied" });
  });

  test("values that do not match are reported as they are", () => {
    const { facts } = fakeLimitFacts({ files: files("max 100000", "max") as never });
    expect(liveSlice(facts, { cpuPercent: 90, memoryPercent: 90 })).toEqual({
      state: "different",
      cpuMax: "max 100000",
      memoryMax: "max",
    });
  });
});

describe("one timeout for every systemd call", () => {
  /** A fake `spawnSync`: records what it was given and answers with `answer`. */
  function fakeSpawn(answer: { status?: number | null; error?: Error }) {
    const seen: { program: string; args: readonly string[]; options: unknown }[] = [];
    const spawn = ((program: string, args: readonly string[], options: unknown) => {
      seen.push({ program, args, options });
      return { status: null, ...answer };
    }) as unknown as typeof spawnSync;
    return { seen, spawn };
  }

  test("the call carries the timeout, and its exit code is the answer", () => {
    const ok = fakeSpawn({ status: 0 });
    expect(runSystemd(["systemctl", "--user", "show"], ok.spawn)).toBe("ok");
    expect(ok.seen[0]).toEqual({
      program: "systemctl",
      args: ["--user", "show"],
      options: { stdio: "ignore", timeout: SYSTEMD_TIMEOUT_MS },
    });
    expect(runSystemd(["x"], fakeSpawn({ status: 1 }).spawn)).toBe("failed");
    expect(SYSTEMD_TIMEOUT_MS).toBe(10_000);
  });

  test("a call that timed out is a timeout, not a failure", () => {
    const error = Object.assign(new Error("spawnSync systemctl ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(runSystemd(["systemctl"], fakeSpawn({ error }).spawn)).toBe("timeout");
  });

  test("a program that cannot start, or no argv, is a failure", () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    expect(runSystemd(["nope"], fakeSpawn({ error }).spawn)).toBe("failed");
    expect(runSystemd([])).toBe("failed");
  });
});
