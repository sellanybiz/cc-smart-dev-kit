import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import type { ScopeHandle } from "./limits";
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

/**
 * A job in a systemd scope (`limits.ts`): the signals go to the process group AND through the
 * scope, and the job is over only once the scope is empty too. The scope here is a fake that
 * records its signals; the real one is proved by `live-systemd.test.ts`.
 */
describe("spawnAndWait in a scope", () => {
  /** A fake scope: `empty` says what `isEmpty` answers; `alsoStops` runs on each kill. */
  function fakeScope(
    options: { empty?: () => boolean; alsoStops?: (s: NodeJS.Signals) => void } = {},
  ) {
    const kills: NodeJS.Signals[] = [];
    const scope: ScopeHandle = {
      kill: (signal) => {
        kills.push(signal);
        options.alsoStops?.(signal);
      },
      isEmpty: options.empty ?? (() => true),
    };
    return { kills, scope };
  }

  test("an exit code passes through, and a scope that is empty is never signalled", async () => {
    for (const code of [0, 1, 130]) {
      const { kills, scope } = fakeScope();
      const end = await spawnAndWait(["sh", "-c", `exit ${code}`], new EventEmitter(), undefined, {
        scope,
      });
      expect(end).toEqual({ code, leftovers: false, sentOn: false, signal: null });
      expect(kills).toEqual([]);
    }
  });

  test("a job the kernel killed ends with 137 and its signal, with nobody's stop claimed", async () => {
    const { scope } = fakeScope();
    const end = await spawnAndWait(["sh", "-c", "kill -KILL $$"], new EventEmitter(), undefined, {
      scope,
    });
    expect(end).toEqual({ code: 137, leftovers: false, sentOn: false, signal: "SIGKILL" });
  });

  /** The job: counts each INT it gets, and ends when `stop` appears. */
  const counting = (pidFile: string, counted: string, stop: string) =>
    `trap 'echo x >> "${counted}"' INT; echo $$ > "${pidFile}"; while [ ! -e "${stop}" ]; do sleep 0.05; done`;
  /** A scope whose kill reaches `pidFile`'s process some milliseconds later, as `systemctl kill` did live. */
  const deliveringScope = (pidFile: string) =>
    fakeScope({
      // A shell merges two signals that arrive together into one trap run; these do not, so a
      // second delivery would count.
      alsoStops: (signal) => {
        setTimeout(() => process.kill(Number(readFileSync(pidFile, "utf8")), signal), 150);
      },
    });

  // A signal sent to both the group and the scope would run a tool's INT handler twice, and a
  // tool that reads a second Ctrl+C as "force quit" would quit. The wrapper forwards to the
  // process group only.
  test("one forwarded signal reaches the job once, and the scope is not signalled", async () => {
    const dir = tempDir("scope-once");
    const [pidFile, counted, stop] = ["pid", "count", "stop"].map((name) => join(dir, name)) as [
      string,
      string,
      string,
    ];
    const { kills, scope } = deliveringScope(pidFile);
    const signals = new EventEmitter();
    const running = spawnAndWait(
      ["sh", "-c", counting(pidFile, counted, stop)],
      signals,
      undefined,
      {
        scope,
      },
    );
    await waitForPid(pidFile);
    signals.emit("SIGINT");
    await Bun.sleep(400); // a second delivery, if there were one, has long arrived
    writeFileSync(stop, "");
    expect(await running).toMatchObject({ code: 0, leftovers: false });
    expect(kills).toEqual([]);
    expect(readFileSync(counted, "utf8")).toBe("x\n");
  });

  // A nested `job run` runs inside the outer job, so the outer scope holds its processes too, and
  // its own wrapper forwards to its own group. A scope kill from the outer wrapper would reach
  // the nested job a second time.
  test("a nested job run gets one forwarded signal once: the outer wrapper has a scope", async () => {
    const dir = tempDir("scope-nested");
    const [pidFile, counted, stop, relay] = ["pid", "count", "stop", "relay"].map((name) =>
      join(dir, name),
    ) as [string, string, string, string];
    // The outer scope holds the nested job: its kill reaches it.
    const { kills, scope } = deliveringScope(pidFile);
    const outerSignals = new EventEmitter();
    const nestedSignals = new EventEmitter();
    // The nested wrapper (no scope) runs the counting job in a group of its own.
    const nested = spawnAndWait(["sh", "-c", counting(pidFile, counted, stop)], nestedSignals);
    // The outer job holds the nested wrapper: it gets the group's INT and the wrapper catches it.
    const outer = spawnAndWait(
      ["sh", "-c", `trap 'touch "${relay}"' INT; while [ ! -e "${stop}" ]; do sleep 0.05; done`],
      outerSignals,
      undefined,
      { scope },
    );
    await waitForPid(pidFile);
    outerSignals.emit("SIGINT");
    // The INT the outer wrapper sent to its group reaches the nested wrapper, which forwards it.
    expect(await until(() => existsSync(relay), 5_000)).toBe(true);
    nestedSignals.emit("SIGINT");
    await Bun.sleep(400);
    writeFileSync(stop, "");
    await Promise.all([outer, nested]);
    expect(kills).toEqual([]);
    expect(readFileSync(counted, "utf8")).toBe("x\n");
  });

  test("a process that left the group is stopped through the scope, and the job waits for it", async () => {
    // `setsid` puts the worker in a session of its own: no signal to the job's group reaches it.
    const dir = tempDir("scope-leftover");
    const pidFile = join(dir, "worker");
    const worker = () => Number(readFileSync(pidFile, "utf8"));
    const { kills, scope } = fakeScope({
      empty: () => existsSync(pidFile) && !isRunning(worker()),
      alsoStops: (signal) => {
        if (existsSync(pidFile)) process.kill(worker(), signal);
      },
    });
    const said: string[] = [];
    const end = await spawnAndWait(
      ["sh", "-c", `setsid sleep 30 & echo $! > "${pidFile}"`],
      new EventEmitter(),
      (line) => said.push(line),
      { scope, leftoverGraceMs: 100, killWaitMs: 2_000 },
    );
    expect(end).toEqual({ code: 0, leftovers: true, sentOn: false, signal: null });
    expect(kills[0]).toBe("SIGTERM");
    expect(isRunning(worker())).toBe(false);
    expect(said).toEqual(["the job left processes running: stopping them, so its memory is free"]);
  });

  test("a scope that never empties: SIGTERM, then SIGKILL, then it gives up with a line", async () => {
    const { kills, scope } = fakeScope({ empty: () => false });
    const said: string[] = [];
    const end = await spawnAndWait(
      ["sh", "-c", "exit 0"],
      new EventEmitter(),
      (line) => said.push(line),
      { scope, leftoverGraceMs: 50, killWaitMs: 100 },
    );
    expect(end).toEqual({ code: 0, leftovers: true, sentOn: false, signal: null });
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(said).toEqual([
      "the job left processes running: stopping them, so its memory is free",
      "some of the job's processes still run: its memory is given back anyway",
    ]);
  });

  test("no scope: the group alone, as before", async () => {
    const end = await spawnAndWait(["sh", "-c", "exit 4"], new EventEmitter(), undefined, {
      scope: null,
    });
    expect(end.code).toBe(4);
  });
});

/** Polls `check` until it holds or `ms` pass. */
async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(20);
  }
  return check();
}

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
