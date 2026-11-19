import { describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import { TEST_HOST_VAR } from "../machine/host";
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
  realLimitFacts,
  runSystemd,
  runSystemdText,
  SCOPE_FEATURES,
  type ScopeFeatures,
  SYSTEMD_TIMEOUT_MS,
  scopeHandle,
  scopeKillArgv,
  sliceChain,
  slicePropertyArgvs,
  startLimits,
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
const NEWEST: ScopeFeatures = { oomPolicy: true, noExpand: true };
const OLDEST: ScopeFeatures = { oomPolicy: false, noExpand: false };
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

  test("the probe tests the switches the job runs with; only the probe is collected", () => {
    expect(probeArgv(JOBS_SLICE, NEWEST)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=cc-smart-dev-kit-jobs.slice",
      "--expand-environment=no",
      "-p",
      "OOMPolicy=kill",
      "--",
      "true",
    ]);
    expect(probeArgv(JOBS_SLICE, { oomPolicy: true, noExpand: false })).not.toContain(
      "--expand-environment=no",
    );
    expect(probeArgv(JOBS_SLICE, OLDEST)).not.toContain("OOMPolicy=kill");
    expect(SCOPE_FEATURES).toEqual([NEWEST, { oomPolicy: true, noExpand: false }, OLDEST]);
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
    expect(calls[0]).toEqual(probeArgv(JOBS_SLICE, NEWEST));
    expect(calls[1]).toContain("CPUQuota=1080%");
    expect(calls[2]).toContain("ManagedOOMMemoryPressureDurationSec=10s");
    // The job's scope is not `--collect`ed: a scope systemd failed keeps its Result.
    expect(start.argv).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--slice=cc-smart-dev-kit-jobs.slice",
      "--expand-environment=no",
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

  // From systemd 258 `systemd-run --scope` expands `$VAR`, `${VAR}` and `$$` in the command;
  // before 258 it never does. The job's words must reach it as written on every systemd, so the
  // newest probe carries `--expand-environment=no` (254), and an older systemd gets no switch it
  // would refuse: it has nothing to expand.
  describe("the job's words, as written, on every systemd", () => {
    // A template literal's placeholder, written in parts so no linter reads it as a mistake.
    const placeholder = ["$", "{x}"].join("");
    const words = ["bun", "-e", `${placeholder} + $$ + $HOME`, 'echo "exit $?"', "%h", "$(id)"];
    // Which probes this systemd accepts: only those whose switches it knows.
    const knows = (argv: readonly string[], version: number) =>
      (version >= 254 || !argv.includes("--expand-environment=no")) &&
      (version >= 253 || !argv.includes("OOMPolicy=kill"));

    for (const version of [259, 255, 254, 253, 252]) {
      test(`systemd ${version}: every dollar sign is kept, nothing is doubled`, () => {
        const { facts, calls } = fakeLimitFacts({
          systemd: (argv) => (argv[0] !== "systemd-run" || knows(argv, version) ? "ok" : "failed"),
        });
        const start = on(
          startLimits(
            facts,
            good(),
            { ...job, command: [words[0] as string, ...words.slice(1)] },
            1,
          ),
        );
        expect(start.argv.slice(-words.length)).toEqual(words);
        expect(start.argv.join(" ")).toContain("--");
        const probes = calls.filter((call) => call[0] === "systemd-run");
        // The newest first: each probe is the one before it with a switch dropped.
        expect(probes).toEqual(
          SCOPE_FEATURES.slice(0, probes.length).map((f) => probeArgv(JOBS_SLICE, f)),
        );
        expect(start.argv.includes("--expand-environment=no")).toBe(version >= 254);
        expect(start.argv.includes("OOMPolicy=kill")).toBe(version >= 253);
      });
    }
  });

  test("no choom: the limits still apply, with no kill mark", () => {
    const { facts } = fakeLimitFacts({ programs: ["systemd-run"] });
    const start = on(startLimits(facts, good(), job, 1));
    expect(start.argv.slice(-4)).toEqual([`--unit=${UNIT}`, "--", "tsc", "--noEmit"]);
    expect(start.argv).not.toContain("choom");
  });

  // A word that is not found makes `systemd-run` end with 1 ("Failed to find executable"), not
  // the 127 a shell gives. The plain path answers as it always did.
  test("a command that is not on the PATH runs plain: no probe, no call, no line", () => {
    const { facts, calls } = fakeLimitFacts({ missing: ["tsc"] });
    expect(startLimits(facts, good(), job, 1)).toEqual({ on: false, line: null });
    expect(calls).toEqual([]);
    // Without choom too: the command's own word is what is looked for.
    const bare = fakeLimitFacts({ missing: ["tsc"], programs: ["systemd-run"] });
    expect(startLimits(bare.facts, good(), job, 1)).toEqual({ on: false, line: null });
  });

  test("the first word is looked for as a person types it: a name, or a path", () => {
    const { facts } = fakeLimitFacts({ missing: ["./gone"] });
    expect(startLimits(facts, good(), { ...job, command: ["./gone", "x"] }, 1)).toEqual({
      on: false,
      line: null,
    });
    expect(startLimits(facts, good(), { ...job, command: ["./here", "x"] }, 1).on).toBe(true);
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

  test("every probe fails: off, and set-property is never called", () => {
    const { facts, calls } = fakeLimitFacts({
      systemd: (argv) => (argv[0] === "systemd-run" ? "failed" : "ok"),
    });
    expect(offLine(startLimits(facts, good(), job, 1))).toBe(
      "this job runs without CPU and memory limits: systemd could not start a scope here (no user session bus?)",
    );
    expect(calls).toHaveLength(SCOPE_FEATURES.length);
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
    expect(scope?.kill("SIGTERM")).toBe("ok");
    expect(calls).toEqual([["systemctl", "--user", "kill", "--signal=SIGTERM", UNIT]]);
    // The answer is systemd's own: a caller that forwards a signal falls back on anything but ok.
    for (const answer of ["failed", "timeout"] as const) {
      const refused = fakeLimitFacts({ systemd: () => answer });
      expect(scopeHandle(refused.facts, UNIT)?.kill("SIGINT")).toBe(answer);
    }
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
  const scopeEventsFile = `${fakeSliceDir()}/${UNIT}/memory.events`;
  const events = (oom: number, kills: number) =>
    `low 0\nhigh 0\nmax 0\noom ${oom}\noom_kill ${kills}\n`;
  const exit1 = { code: 1, signal: null, sentOn: false } as const;
  const killed = { code: 137, signal: "SIGKILL", sentOn: false } as const;
  const SHOW = ["systemctl", "--user", "show", "-p", "ActiveState", "-p", "Result", UNIT];
  const STOP = ["systemctl", "--user", "stop", "--no-block", UNIT];
  const RESET = ["systemctl", "--user", "reset-failed", UNIT];

  /** A started job; `result` is what `systemctl show` says of its scope (null: no answer). */
  function run(
    options: {
      jobSlots?: number;
      programs?: string[];
      files?: Record<string, string>;
      result?: string | null;
      /** Refuse the watchdog's duration (a systemd older than 257). */
      refuse?: string;
    } = {},
  ) {
    const world = fakeLimitFacts({
      programs: options.programs ?? ["systemd-run", "choom"],
      files: { [eventsFile]: events(0, 0), "/proc/meminfo": MEMINFO, ...options.files },
      systemd: (argv) =>
        options.refuse !== undefined && argv.some((word) => word.includes(options.refuse as string))
          ? "failed"
          : "ok",
      systemdText: () =>
        options.result === null
          ? null
          : `ActiveState=failed\nResult=${options.result ?? "success"}\n`,
    });
    const start = on(startLimits(world.facts, good(), job, options.jobSlots ?? 1));
    const before = world.calls.length;
    return { world, start, after: () => world.calls.slice(before) };
  }

  test("exit 0: nothing, and no call, even when the slice's counts rose (another job's kill)", () => {
    const { world, start, after } = run();
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine({ code: 0, signal: null, sentOn: false })).toBeNull();
    expect(after()).toEqual([]);
  });

  // The kernel's OOM killer needs no word from systemd: systemd does not always mark a scope
  // the kernel killed (proved live), so the counts are read, and Result is not asked.
  test("the cap: the slice's oom count rose; exit 1 is enough, and systemd is not asked", () => {
    const { world, start, after } = run();
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine(exit1)).toBe(
      "killed for memory: this job reached the memory cap (28.1 GB, 90% of this machine's memory). Run it again when fewer heavy jobs run, or raise the cap with: cc-smart-dev-kit job set memory <n> (exit code 1)",
    );
    expect(after()).toEqual([]);
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

  // The slice's counts move for every job in it: job B must not get job A's line. The scope's
  // own `oom_kill` count says which job the kernel killed.
  test("another job's kill moved the slice's counts: this scope's own count says it was not killed", () => {
    const { world, start, after } = run({ jobSlots: 2 });
    world.files.set(eventsFile, events(1, 1));
    world.files.set(scopeEventsFile, events(0, 0));
    expect(start.memoryLine(exit1)).toBeNull();
    expect(after()).toEqual([]); // no SIGKILL: nothing to ask systemd
    expect(start.memoryLine(killed)).toBeNull();
    expect(after()).toEqual([SHOW]);
  });

  test("this scope's own count rose: the slice's counts name the killer", () => {
    const { world, start } = run({ jobSlots: 2 });
    world.files.set(eventsFile, events(1, 1));
    world.files.set(scopeEventsFile, events(0, 1));
    expect(start.memoryLine(exit1)).toStartWith(
      "killed for memory: the heavy jobs together reached the memory cap",
    );
  });

  test("the watchdog: this scope ended with oom-kill, and the kernel killed nothing", () => {
    const { start, after } = run({ result: "oom-kill" });
    expect(start.memoryLine(killed)).toBe(
      "stopped for memory: this job stalled on memory below the cap (28.1 GB, 90% of this machine's memory), and the watchdog (systemd-oomd) stops a stalled job after 10s. Run it again when fewer heavy jobs run, or lower the cap so the jobs leave more for the machine, with: cc-smart-dev-kit job set memory <n> (exit code 137)",
    );
    expect(after()).toEqual([SHOW]);
  });

  test("the watchdog also stops a job while another job's kill moved the slice's counts", () => {
    const { world, start } = run({ jobSlots: 2, result: "oom-kill" });
    world.files.set(eventsFile, events(1, 1));
    world.files.set(scopeEventsFile, events(0, 0));
    expect(start.memoryLine(killed)).toStartWith(
      "stopped for memory: the heavy jobs together stalled on memory",
    );
  });

  test("the watchdog's number is the duration this launch wrote: none when systemd refused it", () => {
    const { start } = run({ result: "oom-kill", refuse: "ManagedOOMMemoryPressureDurationSec" });
    expect(start.memoryLine(killed)).toContain("stops a stalled job. Run it again");
    expect(start.memoryLine(killed)).not.toContain(" after ");
  });

  test("a SIGKILL that is not a stop for memory says nothing: another kill -9, or this wrapper's own", () => {
    const plain = run();
    expect(plain.start.memoryLine(killed)).toBeNull();
    expect(plain.after()).toEqual([SHOW]);
    const sentOn = run({ result: "oom-kill" });
    expect(sentOn.start.memoryLine({ ...killed, sentOn: true })).toBeNull();
    expect(sentOn.after()).toEqual([]);
  });

  test("systemd cannot say: a SIGKILL is not enough to call it the watchdog", () => {
    expect(run({ result: null }).start.memoryLine(killed)).toBeNull();
  });

  test("nothing points at memory: no systemd call at all", () => {
    const { start, after } = run();
    expect(start.memoryLine(exit1)).toBeNull();
    expect(after()).toEqual([]);
  });

  // Proved live: the job's processes are gone before systemd marks the scope failed, and a
  // read at once still says `success`. The read waits until the scope is settled.
  test("the scope is marked a few milliseconds after its last process ends: the read waits for it", () => {
    let asked = 0;
    const world = fakeLimitFacts({
      files: { [eventsFile]: events(0, 0), "/proc/meminfo": MEMINFO },
      systemdText: () =>
        ++asked < 3
          ? "ActiveState=deactivating\nResult=success\n"
          : "ActiveState=failed\nResult=oom-kill\n",
    });
    const start = on(startLimits(world.facts, good(), job, 1));
    expect(start.memoryLine(killed)).toStartWith("stopped for memory: this job stalled");
    expect(world.pauses).toEqual([50, 50]);
  });

  test("a scope that never settles: it gives up after a second, and says nothing it cannot prove", () => {
    const world = fakeLimitFacts({
      files: { [eventsFile]: events(0, 0), "/proc/meminfo": MEMINFO },
      systemdText: () => "ActiveState=active\nResult=success\n",
    });
    const start = on(startLimits(world.facts, good(), job, 1));
    expect(start.memoryLine(killed)).toBeNull();
    expect(world.pauses).toHaveLength(20);
    expect(world.pauses.reduce((sum, ms) => sum + ms, 0)).toBe(1_000);
  });

  test("the slice's events cannot be read at all, and no SIGKILL: nothing said", () => {
    const { world, start } = run();
    world.files.delete(eventsFile);
    expect(start.memoryLine(exit1)).toBeNull();
  });

  test("no /proc/meminfo: the percent alone", () => {
    const { world, start } = run({ files: {} });
    world.files.delete("/proc/meminfo");
    world.files.set(eventsFile, events(1, 1));
    expect(start.memoryLine(exit1)).toContain("(90% of this machine's memory)");
  });

  // A failed scope stays failed until it is reset, and an emptied one whose notification systemd
  // missed stays active (both seen live): every started job clears its own.
  test("release stops the emptied scope without blocking, and resets a failed one", () => {
    const { start, after } = run();
    start.release();
    expect(after()).toEqual([STOP, RESET]);
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
  function fakeSpawn(answer: { status?: number | null; error?: Error; stdout?: string }) {
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

  test("a call that prints has the same timeout, and answers null unless it ended with 0", () => {
    const ok = fakeSpawn({ status: 0, stdout: "oom-kill\n" });
    expect(runSystemdText(["systemctl", "show"], ok.spawn)).toBe("oom-kill\n");
    expect(ok.seen[0]?.options).toMatchObject({ timeout: SYSTEMD_TIMEOUT_MS, encoding: "utf8" });
    expect(runSystemdText(["x"], fakeSpawn({ status: 1, stdout: "no" }).spawn)).toBeNull();
    const error = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(runSystemdText(["x"], fakeSpawn({ error }).spawn)).toBeNull();
    expect(runSystemdText([])).toBeNull();
  });
});

// The real facts follow the test host's (`CC_SMART_DEV_KIT_TEST_HOST`, as `Machine` does), so a
// test that runs the CLI as its own process never reads the machine it runs on.
describe("the real facts under a test host", () => {
  const host = (given: object) => ({ [TEST_HOST_VAR]: JSON.stringify(given), PATH: "/nowhere" });

  test("platform and user id are the host's; only listed files are read; no oomd", () => {
    const facts = realLimitFacts(
      host({ platform: "linux", userId: 4242, existing: [import.meta.path] }),
    );
    expect(facts.platform).toBe("linux");
    expect(facts.uid).toBe(4242);
    expect(facts.read(import.meta.path)).toContain("the real facts under a test host");
    expect(facts.read("/proc/meminfo")).toBeNull(); // exists on a real Linux, not in `existing`
    expect(facts.oomdRunning()).toBe(false);
    expect(facts.hasProgram("sh")).toBe(false); // the test's PATH, not the machine's
  });

  test("another platform, and no test host at all", () => {
    expect(realLimitFacts(host({ platform: "darwin" })).platform).toBe("darwin");
    expect(realLimitFacts({}).platform).toBe(process.platform);
    expect(realLimitFacts({}).uid).toBe(process.getuid?.() ?? null);
  });
});
