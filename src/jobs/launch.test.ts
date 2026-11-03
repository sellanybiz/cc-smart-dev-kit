import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  ancestorPids,
  isInsideHeavyJob,
  parentPidFromStat,
  readProcStat,
  type StatReader,
} from "./ancestry";
import { type SignalSource, spawnAndWait } from "./launch";
import type { WindowsFacts } from "./windows";

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
  test("returns the child's exit code, and no signal", async () => {
    expect(await spawnAndWait(["sh", "-c", "exit 3"], new EventEmitter())).toEqual({
      code: 3,
      leftovers: false,
      sentOn: false,
      signal: null,
    });
  });

  test("returns 128 + n for a child killed by a signal, and names it", async () => {
    expect(await spawnAndWait(["sh", "-c", "kill -TERM $$"], new EventEmitter())).toEqual({
      code: 143,
      leftovers: false,
      sentOn: false, // nobody here sent it on: the job killed itself
      signal: "SIGTERM",
    });
  });

  test("returns 127 for a command that does not exist, and says why", async () => {
    const said: string[] = [];
    expect(
      await spawnAndWait(["cc-smart-dev-kit-no-such-command-xyz"], new EventEmitter(), (line) =>
        said.push(line),
      ),
    ).toEqual({ code: 127, leftovers: false, sentOn: false, signal: null });
    expect(said).toEqual(["could not start cc-smart-dev-kit-no-such-command-xyz: ENOENT"]);
  });

  test("sends SIGTERM on to the child, and lets go of its listeners after", async () => {
    const signals = new EventEmitter();
    const running = spawnAndWait(["sleep", "30"], signals);
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    signals.emit("SIGTERM");
    expect(await running).toEqual({ code: 143, leftovers: false, sentOn: true, signal: "SIGTERM" });
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGHUP")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  test("sends SIGHUP on", async () => {
    const signals = new EventEmitter();
    const running = spawnAndWait(["sleep", "30"], signals);
    signals.emit("SIGHUP");
    expect(await running).toEqual({ code: 129, leftovers: false, sentOn: true, signal: "SIGHUP" });
  });

  // In its own session the job no longer gets the terminal's Ctrl+C: `job run` sends it
  // on, once (a test runner reads a second one as "force quit").
  test("sends SIGINT on, once", async () => {
    const signals: EventEmitter & SignalSource = new EventEmitter();
    const running = spawnAndWait(["sleep", "30"], signals);
    expect(signals.listenerCount("SIGINT")).toBe(1);
    signals.emit("SIGINT");
    expect(await running).toEqual({ code: 130, leftovers: false, sentOn: true, signal: "SIGINT" });
  });

  test("starts the job in a process group of its own", async () => {
    const dir = tempDir("group");
    const out = join(dir, "ids");
    // ps prints the job's pid and its group: one and the same.
    const { code } = await spawnAndWait(
      ["sh", "-c", `ps -o pid=,pgid= -p $$ > "${out}"`],
      new EventEmitter(),
    );
    expect(code).toBe(0);
    const [pid, pgid] = readFileSync(out, "utf8").trim().split(/\s+/);
    expect(pgid).toBe(pid);
    expect(Number(pgid)).not.toBe(process.pid);
  });

  // A test runner's workers, a build's helpers: they hold the memory too.
  test("sends a signal to the whole group, workers too, and ends once they are gone", async () => {
    const dir = tempDir("group");
    const pidFile = join(dir, "worker");
    const signals = new EventEmitter();
    // A long grace: only the signal to the group can end this test in time.
    const running = spawnAndWait(
      ["sh", "-c", `sleep 30 & echo $! > "${pidFile}"; wait`],
      signals,
      () => undefined,
      { leftoverGraceMs: 60_000 },
    );
    const worker = await waitForPid(pidFile);
    signals.emit("SIGTERM");
    expect(await running).toEqual({ code: 143, leftovers: false, sentOn: true, signal: "SIGTERM" });
    expect(isRunning(worker)).toBe(false);
  });

  test("a job that died of the signal it was sent, and left a process behind: both facts", async () => {
    const dir = tempDir("group");
    const pidFile = join(dir, "worker");
    const signals = new EventEmitter();
    // The job's own process dies of the SIGTERM sent on to its group; the child that
    // ignores SIGTERM lives on, so the memory is only free once it is stopped too. A short
    // grace: only the leftover stop can end this test in time. The child writes its own pid
    // only once its trap is set: a SIGTERM that came sooner (a loaded machine) would end it
    // too, and there would be no leftover to stop.
    const running = spawnAndWait(
      [
        "sh",
        "-c",
        `sh -c 'trap "" TERM; echo $$ > "${pidFile}"; while :; do sleep 1; done' & exec sleep 30`,
      ],
      signals,
      () => undefined,
      { leftoverGraceMs: 100, killWaitMs: 2_000 },
    );
    const worker = await waitForPid(pidFile);
    signals.emit("SIGTERM");
    expect(await running).toEqual({ code: 143, leftovers: true, sentOn: true, signal: "SIGTERM" });
    expect(isRunning(worker)).toBe(false);
  });

  test("gives back only once the leftovers are gone: stopped after a short grace", async () => {
    const dir = tempDir("group");
    const pidFile = join(dir, "worker");
    const said: string[] = [];
    // The first process ends at once; its worker would run on for 30 s.
    const end = await spawnAndWait(
      ["sh", "-c", `sleep 30 & echo $! > "${pidFile}"`],
      new EventEmitter(),
      (line) => said.push(line),
      { leftoverGraceMs: 100, killWaitMs: 2_000 },
    );
    expect(end).toEqual({ code: 0, leftovers: true, sentOn: false, signal: null });
    expect(isRunning(Number(readFileSync(pidFile, "utf8")))).toBe(false);
    expect(said).toEqual(["the job left processes running: stopping them, so its memory is free"]);
  });
});
/** Waits for a pid file a child writes, and returns the pid. */
async function waitForPid(file: string): Promise<number> {
  for (let i = 0; i < 200; i++) {
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8").trim();
      if (text !== "") return Number(text);
    }
    await Bun.sleep(10);
  }
  throw new Error(`no pid in ${file}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows: no signals and no process groups to signal, so a stop ends the job's tree with
 * `taskkill` (`windows.ts`). That is what makes a Ctrl+C at `job run` end the job too: the
 * job is in a process group of its own and never sees the terminal's own Ctrl+C.
 */
describe("spawnAndWait on Windows", () => {
  /** A fake Windows whose `taskkill` ends the job's tree the way `taskkill /T /F` does. */
  function windows() {
    const killed: number[] = [];
    const facts: WindowsFacts = {
      powershell: () => null,
      taskkill: (pid) => {
        killed.push(pid);
        process.kill(-pid, "SIGKILL"); // the job's process group: its first process, its workers
        return 0;
      },
    };
    return { killed, facts };
  }

  test("SIGINT, SIGTERM and SIGHUP all end the job's tree, and job run ends with it", async () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const dir = tempDir("windows-job");
      const pidFile = join(dir, "pid");
      const signals = new EventEmitter();
      const { killed, facts } = windows();
      const running = spawnAndWait(
        ["sh", "-c", `echo $$ > "${pidFile}"; sleep 30`],
        signals,
        () => undefined,
        { platform: "win32", windows: facts, leftoverGraceMs: 100, killWaitMs: 2_000 },
      );
      const pid = await waitForPid(pidFile);
      signals.emit(signal);
      // 137: the job ended by SIGKILL, which is what every Windows stop is (128 + 9). The
      // sender is not named: what ended the tree is `taskkill`'s SIGKILL, not the signal
      // that arrived (`endJobTree` in windows.ts).
      expect(await running).toEqual({
        code: 137,
        leftovers: false,
        sentOn: false,
        signal: "SIGKILL",
      });
      expect(killed).toEqual([pid]);
    }
  });

  test("the job is empty once its first process is gone, even with a worker left behind", async () => {
    const dir = tempDir("windows-job");
    const pidFile = join(dir, "worker");
    const said: string[] = [];
    const { killed, facts } = windows();
    // The first process ends at once; its worker would run on for 30 s. On Windows
    // `job run` watches the job's first process: the worker is not seen (docs/windows-jobs.md).
    const end = await spawnAndWait(
      ["sh", "-c", `sleep 30 & echo $! > "${pidFile}"`],
      new EventEmitter(),
      (line) => said.push(line),
      { platform: "win32", windows: facts, leftoverGraceMs: 100, killWaitMs: 2_000 },
    );
    const worker = Number(readFileSync(pidFile, "utf8"));
    try {
      expect(end).toEqual({ code: 0, leftovers: false, sentOn: false, signal: null });
      expect(said).toEqual([]);
      expect(killed).toEqual([]);
      expect(isRunning(worker)).toBe(true);
    } finally {
      process.kill(worker, "SIGKILL");
    }
  });
});

function procTree(parents: Record<number, number>): StatReader {
  return (pid) => {
    const parent = parents[pid];
    return parent === undefined ? null : `${pid} (command) S ${parent} 1 1 0 -1`;
  };
}
