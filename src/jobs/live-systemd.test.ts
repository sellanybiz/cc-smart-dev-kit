/**
 * The limits against the REAL systemd user manager of this machine: opt-in, skipped unless
 * `CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`. Everything else in the tests fakes systemd; these check what
 * the fakes assume: where a slice and a scope live under /sys/fs/cgroup, that the properties
 * reach the kernel's files, that a scope's kill and its `cgroup.events` work, that a CPU burner
 * is held to its quota, and that a job over the memory cap is killed and named.
 *
 * They start throwaway units in a throwaway slice (`amlive<random>-jobs.slice`), never the real
 * `<command>-jobs.slice`, and stop and revert every one of them at the end (`afterAll` fails the
 * run when anything is left behind). Run it once, on a machine you can spare a minute on:
 *
 *   CC_SMART_DEV_KIT_LIVE_SYSTEMD=1 bun test src/jobs/live-systemd.test.ts
 *
 * Not covered here, because it cannot be made on demand: a job that stalls below the cap and is
 * stopped by systemd-oomd. That is proved by hand (docs/jobs.md § Limits).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
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
  userSliceCgroup,
} from "./limits";

const LIVE = process.env.CC_SMART_DEV_KIT_LIVE_SYSTEMD === "1";
const uid = process.getuid?.() ?? -1;
const prefix = `amlive${crypto.randomUUID().slice(0, 6)}`;
const SLICE = `${prefix}-jobs.slice`;
const PARENT = `${prefix}.slice`;
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
  systemctl("stop", SLICE, PARENT);
  systemctl("revert", SLICE, PARENT);
  const left = systemctl("list-units", "--all", "--plain", "--no-legend", `${prefix}*`).out;
  if (left !== "") throw new Error(`live test units left behind: ${left}`);
  for (const unit of [SLICE, PARENT]) {
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
    const running = spawnAndWait(start.argv, new EventEmitter(), undefined, { scope: start.scope });
    expect(await until(() => existsSync(markFile) && existsSync(cgroupFile), 10_000)).toBe(true);
    expect(read(`${sliceDir}/cpu.max`)).toBe(`${50 * machineCpus(facts) * 1000} 100000`);
    expect(read(`${sliceDir}/cpu.weight`)).toBe("20");
    expect(read(`${sliceDir}/memory.swap.max`)).toBe("0");
    expect(read(`${sliceDir}/memory.high`)).toBe("max");
    expect(liveSlice(facts, { cpuPercent: 50, memoryPercent: 50 }, SLICE)).toEqual({
      state: "applied",
    });
    expect(read(markFile)).toBe("900");
    expect(read(cgroupFile)).toContain(`${userSliceCgroup(uid, SLICE)}/${prefix}-jobs-live-`);
    expect(await running).toMatchObject({ code: 0, leftovers: false, signal: null });
    // A lower limit at the next launch is written at once (a runtime property outlives a job).
    limited(settings(100, 100), ["true"]);
    expect(read(`${sliceDir}/cpu.max`)).toBe("max 100000");
  }, 60_000);

  test("exit codes 0, 1 and 130 pass through, and a kill ends with 137", async () => {
    for (const code of [0, 1, 130]) {
      const start = limited(settings(90, 90), ["sh", "-c", `exit ${code}`]);
      const end = await spawnAndWait(start.argv, new EventEmitter(), undefined, {
        scope: start.scope,
      });
      expect(end).toEqual({ code, leftovers: false, sentOn: false, signal: null });
    }
    const start = limited(settings(90, 90), ["sh", "-c", "kill -KILL $$"]);
    const end = await spawnAndWait(start.argv, new EventEmitter(), undefined, {
      scope: start.scope,
    });
    expect(end).toMatchObject({ code: 137, signal: "SIGKILL", sentOn: false });
  }, 60_000);

  test("the job's words reach it as written: systemd-run reads $VAR and $$, so each $ is escaped", async () => {
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
    await spawnAndWait(start.argv, new EventEmitter(), undefined, { scope: start.scope });
    expect(read(out)).toBe(`${words.join("|")}|`);
  }, 30_000);

  test("a signal reaches the job through its group and its scope, and the scope ends empty", async () => {
    const start = limited(settings(90, 90), ["sleep", "30"]);
    const signals = new EventEmitter();
    const running = spawnAndWait(start.argv, signals, undefined, { scope: start.scope });
    await Bun.sleep(500);
    signals.emit("SIGTERM");
    expect(await running).toMatchObject({ code: 143, sentOn: true, signal: "SIGTERM" });
    expect(start.scope?.isEmpty()).toBe(true);
  }, 30_000);

  test("a process that left the job's group is stopped through the scope", async () => {
    const pidFile = join(tempDir("live-leftover"), "worker");
    const start = limited(settings(90, 90), [
      "sh",
      "-c",
      `setsid sleep 60 & echo $! > "${pidFile}"`,
    ]);
    const said: string[] = [];
    const end = await spawnAndWait(start.argv, new EventEmitter(), (line) => said.push(line), {
      scope: start.scope,
      leftoverGraceMs: 300,
      killWaitMs: 5_000,
    });
    expect(end).toMatchObject({ code: 0, leftovers: true });
    const worker = Number(read(pidFile));
    // Killed, and given up to its reaper: a zombie that is still listed has no memory left.
    expect(await until(() => isGone(worker), 5_000)).toBe(true);
    expect(said[0]).toBe("the job left processes running: stopping them, so its memory is free");
    expect(start.scope?.isEmpty()).toBe(true);
  }, 30_000);

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
    await spawnAndWait(start.argv, new EventEmitter(), undefined, { scope: start.scope });
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
    const said: string[] = [];
    const end = await spawnAndWait(start.argv, new EventEmitter(), (line) => said.push(line), {
      scope: start.scope,
    });
    const line = start.memoryLine(end);
    console.log(`live: exit ${String(end.code)}; line: ${String(line)}`);
    expect(end.code).toBe(137);
    expect(line).toStartWith("killed for memory: this job reached the memory cap (");
    expect(line).toEndWith("(exit code 137)");
  }, 60_000);
});
