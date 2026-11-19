/**
 * The limits against the REAL systemd user manager of this machine: opt-in, skipped unless
 * `CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`. Everything else in the tests fakes systemd; these check what
 * the fakes assume: where a slice and a scope live under /sys/fs/cgroup, that the properties
 * reach the kernel's files, that a scope's kill and its `cgroup.events` work, that a CPU burner
 * is held to its quota, and that a job over the memory cap is killed and named.
 *
 * They start throwaway units in a throwaway slice (`amlive<random>_jobs.slice`), never the real
 * `<command>_jobs.slice`, and stop and revert every one of them at the end (`afterAll` fails the
 * run when anything is left behind). Run it once, on a machine you can spare a minute on:
 *
 *   CC_SMART_DEV_KIT_LIVE_SYSTEMD=1 bun test src/jobs/live-systemd.test.ts
 *
 * The stall case sets a `MemoryHigh` below `MemoryMax` on the throwaway slice itself (the limits
 * never write one), because a job under the real limits is killed at the cap, never stalled.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import type { LimitRead } from "./config";
import { spawnAndWait } from "./launch";
import {
  JOBS_SLICE,
  liveSlice,
  machineCpus,
  realLimitFacts,
  startLimits,
  userManagerCgroup,
  userSliceCgroup,
} from "./limits";

const LIVE = process.env.CC_SMART_DEV_KIT_LIVE_SYSTEMD === "1";
const uid = process.getuid?.() ?? -1;
const prefix = `amlive${crypto.randomUUID().slice(0, 6)}`;
const SLICE = `${prefix}_jobs.slice`;
// A top-level sibling with the default weight, for the yield test: it has no dash either.
const SIBLING = `${prefix}_sibling.slice`;
const facts = realLimitFacts();
const sliceDir = `/sys/fs/cgroup${userSliceCgroup(uid, SLICE)}`;

function systemctl(...args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(["systemctl", "--user", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  return { code: result.exitCode ?? 1, out: result.stdout.toString().trim() };
}

const read = (path: string) => readFileSync(path, "utf8").trim();

/** True when `pid` is gone, or is a zombie that holds no memory and awaits its reaper. */
function isGone(pid: number): boolean {
  try {
    return /^\d+ \(.*\) Z /.test(readFileSync(`/proc/${String(pid)}/stat`, "utf8"));
  } catch {
    return true;
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

const settings = (cpuPercent: number, memoryPercent: number): LimitRead => ({
  ok: true,
  settings: { cpuPercent, memoryPercent },
  source: "default",
});

let jobCount = 0;
/** The limits for one job in the throwaway slice: the probe and `set-property` really run. */
function limited(
  limit: LimitRead,
  command: [string, ...string[]],
  slots = 1,
): Extract<ReturnType<typeof startLimits>, { on: true }> {
  jobCount += 1;
  const start = startLimits(
    facts,
    limit,
    { kind: "live", command, pid: process.pid, startedAt: Date.now() + jobCount },
    slots,
    SLICE,
  );
  if (!start.on) throw new Error(`the limits are off here: ${start.line ?? "no reason given"}`);
  return start;
}

/**
 * Runs a started job the way `runJob` does: the memory line is read first, then the job's scope
 * is released (a failed scope stays until it is reset; `release` clears it).
 */
async function ran(
  start: ReturnType<typeof limited>,
  options: {
    signals?: EventEmitter;
    say?: (line: string) => void;
    spawn?: { leftoverGraceMs?: number; killWaitMs?: number };
  } = {},
) {
  const end = await spawnAndWait(start.argv, options.signals ?? new EventEmitter(), options.say, {
    scope: start.scope,
    ...options.spawn,
  });
  const line = start.memoryLine(end);
  start.release();
  return { end, line };
}

afterAll(() => {
  if (!LIVE) return;
  // Stop what is left (a failed test may leave a scope), then drop every runtime property.
  const scopes = systemctl(
    "list-units",
    "--all",
    "--plain",
    "--no-legend",
    "--type=scope",
    `${prefix}*`,
  )
    .out.split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name.endsWith(".scope"));
  for (const scope of scopes) systemctl("kill", "--signal=SIGKILL", scope);
  systemctl("stop", SLICE, SIBLING);
  systemctl("revert", SLICE, SIBLING);
  const left = systemctl("list-units", "--all", "--plain", "--no-legend", `${prefix}*`).out;
  if (left !== "") throw new Error(`live test units left behind: ${left}`);
  for (const unit of [SLICE, SIBLING]) {
    const dropIns = `/run/user/${String(uid)}/systemd/user.control/${unit}.d`;
    if (existsSync(dropIns)) throw new Error(`live test drop-ins left behind: ${dropIns}`);
  }
});

describe.if(LIVE)("the real systemd user manager (CC_SMART_DEV_KIT_LIVE_SYSTEMD=1)", () => {
  test("the throwaway slice is never the real one", () => {
    expect(SLICE).not.toBe(JOBS_SLICE);
    expect(facts.platform).toBe("linux");
  });

  test("every property reaches the kernel's files, and the job runs in its scope with the kill mark", async () => {
    const dir = tempDir("live-props");
    const markFile = join(dir, "oom_score_adj");
    const cgroupFile = join(dir, "cgroup");
    const limit = settings(50, 50);
    const start = limited(limit, [
      "sh",
      "-c",
      `cat /proc/self/oom_score_adj > "${markFile}"; cat /proc/self/cgroup > "${cgroupFile}"; sleep 4`,
    ]);
    const running = ran(start);
    expect(await until(() => existsSync(markFile) && existsSync(cgroupFile), 10_000)).toBe(true);
    expect(read(`${sliceDir}/cpu.max`)).toBe(`${50 * machineCpus(facts) * 1000} 100000`);
    expect(read(`${sliceDir}/cpu.weight`)).toBe("20");
    expect(read(`${sliceDir}/memory.swap.max`)).toBe("0");
    expect(read(`${sliceDir}/memory.high`)).toBe("max");
    expect(liveSlice(facts, { cpuPercent: 50, memoryPercent: 50 }, SLICE)).toEqual({
      state: "applied",
    });
    expect(read(markFile)).toBe("900");
    expect(read(cgroupFile)).toContain(`${userSliceCgroup(uid, SLICE)}/${prefix}_jobs-live-`);
    expect((await running).end).toMatchObject({ code: 0, leftovers: false, signal: null });
    // A lower limit at the next launch is written at once (a runtime property outlives a job).
    limited(settings(100, 100), ["true"]);
    expect(read(`${sliceDir}/cpu.max`)).toBe("max 100000");
  }, 60_000);

  test("exit codes 0, 1 and 130 pass through, and a kill ends with 137", async () => {
    for (const code of [0, 1, 130]) {
      const start = limited(settings(90, 90), ["sh", "-c", `exit ${code}`]);
      const { end } = await ran(start);
      expect(end).toEqual({ code, leftovers: false, sentOn: false, signal: null });
    }
    const start = limited(settings(90, 90), ["sh", "-c", "kill -KILL $$"]);
    const { end, line } = await ran(start);
    expect(end).toMatchObject({ code: 137, signal: "SIGKILL", sentOn: false });
    // Not a stop for memory: a plain kill -9 says nothing.
    expect(line).toBeNull();
  }, 60_000);

  test("the job's words reach it as written (--expand-environment=no)", async () => {
    const out = join(tempDir("live-words"), "words");
    // Written in parts: a placeholder in a plain string would look like a mistake to a linter.
    const placeholder = ["$", "{HOME}"].join("");
    const words = ["$HOME", placeholder, "$$", "100%", "%h"];
    const start = limited(settings(90, 90), [
      "sh",
      "-c",
      'printf "%s|" "$@" > "$0"',
      out,
      ...words,
    ]);
    await ran(start);
    expect(read(out)).toBe(`${words.join("|")}|`);
  }, 30_000);

  test("a signal reaches the job through its group and its scope, and the scope ends empty", async () => {
    const start = limited(settings(90, 90), ["sleep", "30"]);
    const signals = new EventEmitter();
    const running = ran(start, { signals });
    await Bun.sleep(500);
    signals.emit("SIGTERM");
    expect((await running).end).toMatchObject({ code: 143, sentOn: true, signal: "SIGTERM" });
    expect(start.scope?.isEmpty()).toBe(true);
  }, 30_000);

  // Every member of the job's group is in its scope, so a signal sent to both would reach the job
  // twice, and a tool that reads a second Ctrl+C as "force quit" would quit. Counted live.
  test("one forwarded SIGINT reaches the job exactly once", async () => {
    const dir = tempDir("live-once");
    const [ready, counted, stop] = ["ready", "count", "stop"].map((name) => join(dir, name));
    const start = limited(settings(90, 90), [
      "sh",
      "-c",
      `trap 'echo x >> "${counted}"' INT; echo up > "${ready}"; while [ ! -e "${stop}" ]; do sleep 0.1; done`,
    ]);
    const signals = new EventEmitter();
    const running = ran(start, { signals });
    expect(await until(() => existsSync(ready as string), 10_000)).toBe(true);
    signals.emit("SIGINT");
    await Bun.sleep(1_000);
    writeFileSync(stop as string, "");
    expect((await running).end).toMatchObject({ code: 0, leftovers: false });
    expect(read(counted as string)).toBe("x");
  }, 30_000);

  test("a process that left the job's group is stopped through the scope", async () => {
    const pidFile = join(tempDir("live-leftover"), "worker");
    const start = limited(settings(90, 90), [
      "sh",
      "-c",
      `setsid sleep 60 & echo $! > "${pidFile}"`,
    ]);
    const said: string[] = [];
    const { end } = await ran(start, {
      say: (line) => said.push(line),
      spawn: { leftoverGraceMs: 300, killWaitMs: 5_000 },
    });
    expect(end).toMatchObject({ code: 0, leftovers: true });
    const worker = Number(read(pidFile));
    // Killed, and given up to its reaper: a zombie that is still listed has no memory left.
    expect(await until(() => isGone(worker), 5_000)).toBe(true);
    expect(said[0]).toBe("the job left processes running: stopping them, so its memory is free");
    expect(start.scope?.isEmpty()).toBe(true);
  }, 30_000);

  // `CPUWeight` only counts against siblings in the same parent. The jobs' slice has no dash in
  // its name, so it sits directly under the user manager beside every other top-level slice; a
  // dashed name nested it five levels deep with no sibling, and the weight did nothing (2001 ms
  // against 2002 ms). Two burners are pinned to one CPU: one in the jobs' slice (weight 20), one
  // in a top-level sibling with the default weight (100). The jobs get about 20/120.
  test("the jobs yield the CPU to a sibling slice with the default weight", async () => {
    expect(sliceDir).toBe(`/sys/fs/cgroup${userManagerCgroup(uid)}/${SLICE}`);
    const seconds = 4;
    const burn = [
      "taskset",
      "-c",
      "0",
      "timeout",
      String(seconds),
      "sh",
      "-c",
      "while :; do :; done",
    ];
    const start = limited(settings(100, 90), burn as [string, ...string[]]);
    const usage = (dir: string) => Number(/^usage_usec (\d+)/m.exec(read(`${dir}/cpu.stat`))?.[1]);
    const siblingDir = `/sys/fs/cgroup${userManagerCgroup(uid)}/${SIBLING}`;
    const sibling = Bun.spawn(
      ["systemd-run", "--user", "--scope", "--quiet", `--slice=${SIBLING}`, "--", ...burn],
      { stdout: "ignore", stderr: "inherit" },
    );
    const jobsBefore = usage(sliceDir);
    await ran(start);
    await sibling.exited;
    const jobs = usage(sliceDir) - jobsBefore;
    const others = usage(siblingDir);
    const share = jobs / (jobs + others);
    console.log(
      `live: jobs slice share ${share.toFixed(2)} (jobs ${jobs} us, sibling ${others} us)`,
    );
    expect(others).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.3);
  }, 60_000);

  test("a CPU burner is held to its quota", async () => {
    // 10% of the machine's CPUs; four busy loops would take four CPUs without the quota.
    const quotaCpus = (10 * machineCpus(facts)) / 100;
    const start = limited(settings(10, 90), [
      "sh",
      "-c",
      "for i in 1 2 3 4; do timeout 5 sh -c 'while :; do :; done' & done; wait",
    ]);
    const usage = () => Number(/^usage_usec (\d+)/m.exec(read(`${sliceDir}/cpu.stat`))?.[1]);
    const before = usage();
    const began = Date.now();
    await ran(start);
    const cpuSeconds = (usage() - before) / 1_000_000;
    const used = cpuSeconds / ((Date.now() - began) / 1000);
    console.log(`live: quota ${quotaCpus} CPUs, used ${used.toFixed(2)} CPUs`);
    expect(used).toBeLessThanOrEqual(quotaCpus * 1.3 + 0.1);
    expect(used).toBeGreaterThan(Math.min(quotaCpus, 4) * 0.3);
  }, 60_000);

  test("an eater past the cap is killed with 137, and the line names the cap", async () => {
    // 1% of the machine's memory: a few hundred MB, however big the machine is.
    const start = limited(settings(90, 1), [
      process.execPath,
      "-e",
      // About 16 MB more each round, touched so it is really used.
      "const a = []; for (;;) a.push(Buffer.alloc(16 * 1024 * 1024, 1));",
    ]);
    const { end, line } = await ran(start);
    console.log(`live: exit ${String(end.code)}; line: ${String(line)}`);
    expect(end.code).toBe(137);
    expect(line).toStartWith("killed for memory: this job reached the memory cap (");
    expect(line).toEndWith("(exit code 137)");
  }, 60_000);

  // The watchdog. The limits write `MemoryHigh=infinity`, which kills at the cap and never
  // stalls; to make a job stall on demand this test, and only this test, sets a `MemoryHigh`
  // below `MemoryMax` on the throwaway slice after the launch wrote its own. The eater then
  // sticks below the cap, `memory.pressure` stays high, and systemd-oomd stops its scope. oomd
  // picks its victim by page-scan activity: a Python `bytearray` has some, a Bun `Buffer` of the
  // same size has none (tried live: never killed), so the eater is Python.
  test.if(Bun.which("python3") !== null)(
    "a job that stalls on memory is stopped by systemd-oomd, and the line says the watchdog did it",
    async () => {
      const start = limited(settings(90, 90), [
        "python3",
        "-c",
        'import time; b = bytearray(b"x" * (400 * 1024 * 1024)); time.sleep(600)',
      ]);
      expect(
        systemctl("set-property", "--runtime", SLICE, "MemoryHigh=200M", "MemoryMax=300M").code,
      ).toBe(0);
      const began = Date.now();
      const { end, line } = await ran(start);
      console.log(
        `live: stalled job stopped after ${Math.round((Date.now() - began) / 1000)} s; exit ${String(end.code)}; line: ${String(line)}`,
      );
      expect(end).toMatchObject({ code: 137, signal: "SIGKILL", sentOn: false });
      expect(line).toStartWith("stopped for memory: this job stalled on memory below the cap (");
      expect(line).toContain("the watchdog (systemd-oomd) stops a stalled job after 10s");
    },
    120_000,
  );

  // A `job run` killed with SIGKILL never releases its scope. A failed scope it left is cleared by
  // the next launch, and a scope that is running is not touched.
  test.if(Bun.which("python3") !== null)(
    "the next launch clears a failed scope a killed job run left, and not a running one",
    async () => {
      const stale = `${prefix}_jobs-stale-1.scope`;
      const running = `${prefix}_jobs-running-1.scope`;
      const run = (unit: string, ...extra: string[]) =>
        Bun.spawn(
          [
            "systemd-run",
            "--user",
            "--scope",
            "--quiet",
            `--slice=${SLICE}`,
            `--unit=${unit}`,
            ...extra,
          ],
          { stdout: "ignore", stderr: "ignore" },
        );
      const alive = run(running, "--", "sleep", "60");
      const failing = run(
        stale,
        "-p",
        "MemoryMax=50M",
        "-p",
        "MemorySwapMax=0",
        "-p",
        "OOMPolicy=kill",
        "--",
        "python3",
        "-c",
        'b = bytearray(b"x" * (300 * 1024 * 1024))',
      );
      await failing.exited;
      const state = (unit: string) => systemctl("show", "-p", "ActiveState", "--value", unit).out;
      expect(await until(() => state(stale) === "failed", 5_000)).toBe(true);
      const start = limited(settings(90, 90), ["true"]);
      start.release();
      expect(await until(() => state(stale) !== "failed", 5_000)).toBe(true);
      expect(state(running)).toBe("active");
      systemctl("kill", "--signal=SIGKILL", running);
      await alive.exited;
    },
    30_000,
  );

  // The last test: every job above released its scope, so none is left in the user manager.
  test("no unit of a finished job is left in the user manager", async () => {
    const scopes = () =>
      systemctl("list-units", "--all", "--plain", "--no-legend", "--type=scope", `${prefix}*`).out;
    expect(await until(() => scopes() === "", 10_000)).toBe(true);
  }, 30_000);
});
