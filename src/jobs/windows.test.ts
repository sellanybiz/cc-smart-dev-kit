/**
 * The Windows side of the queue (`windows.ts`): a process's start time through PowerShell
 * (one call per check, `win:<ticks>`), the fail-safe that keeps a holder nobody can judge,
 * the platform-aware reader the lease store uses, and ending a job's process tree with
 * `taskkill`. No test starts PowerShell, `taskkill` or a real Windows process: the facts
 * are fakes, and the only real children are `sleep`s on this machine.
 */
import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { processStartTime } from "../setup/lock";
import {
  endJobTree,
  leaseHolder,
  processIsGone,
  startTimeReader,
  WINDOWS_START_PREFIX,
  type WindowsFacts,
  windowsStartTicks,
  windowsStartTime,
} from "./windows";

/** The one PowerShell call a Windows start time is: written here by hand, as the contract. */
const START_TIME_SCRIPT = (pid: number) =>
  `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`;

/** A fake Windows: what PowerShell answers, and `taskkill`'s exit code. */
function facts(answers: Record<number, string> | string | null, taskkillCode = 0) {
  const asked: string[] = [];
  const killed: number[] = [];
  const windows: WindowsFacts = {
    powershell: (script) => {
      asked.push(script);
      if (typeof answers !== "object" || answers === null) return answers;
      return answers[pidIn(script)] ?? null;
    },
    taskkill: (pid) => {
      killed.push(pid);
      return taskkillCode;
    },
  };
  return { windows, asked, killed };
}

/** The pid a start-time script asks about. */
function pidIn(script: string): number {
  const match = /-Id (\d+)/.exec(script);
  if (match?.[1] === undefined) throw new Error(`no pid in ${script}`);
  return Number(match[1]);
}

/** A live child of this test process. */
function liveChild() {
  const child = Bun.spawn(["sleep", "30"]);
  return { pid: child.pid, stop: () => child.kill("SIGKILL"), ended: child.exited };
}

/** A child that has already ended: its pid means nothing any more. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

/** Waits until `pid` is gone, or gives up: a killed process ends in its own time. */
async function waitForGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    if (processIsGone(pid)) return true;
    await Bun.sleep(10);
  }
  return false;
}

describe("a process's start time on Windows", () => {
  test("asks PowerShell once, and marks the answer as Windows'", () => {
    const { windows, asked } = facts({ 4242: "133700000000000000\n" });
    expect(windowsStartTime(4242, undefined, windows)).toBe(
      `${WINDOWS_START_PREFIX}133700000000000000`,
    );
    expect(asked).toEqual([START_TIME_SCRIPT(4242)]);
  });

  test("the same process reads the same; another process on that pid, another value", () => {
    const recorded = windowsStartTime(42, undefined, facts({ 42: "1000" }).windows);
    expect(recorded).toBe(`${WINDOWS_START_PREFIX}1000`);
    expect(windowsStartTime(42, recorded ?? undefined, facts({ 42: "1000" }).windows)).toBe(
      recorded,
    );
    // The pid was reused: the process that holds it now started at another time.
    expect(windowsStartTime(42, recorded ?? undefined, facts({ 42: "2000" }).windows)).toBe(
      `${WINDOWS_START_PREFIX}2000`,
    );
  });

  test("an answer that is not a number is no answer", () => {
    for (const answer of ["", "  \n", "Access is denied.", "-5", "12 34"]) {
      expect(windowsStartTicks(4242, facts(answer).windows)).toBeNull();
    }
  });

  // The fail-safe: a holder nobody can judge stays. A job waits; it never runs on top of
  // memory someone may still hold.
  test("PowerShell that cannot answer keeps the holder: the recorded value comes back", () => {
    for (const answers of [
      null,
      "",
      "Get-Process : Cannot find a process with the identifier 4242.",
    ]) {
      const { windows } = facts(answers);
      expect(windowsStartTime(4242, `${WINDOWS_START_PREFIX}1000`, windows)).toBe(
        `${WINDOWS_START_PREFIX}1000`,
      );
    }
    // Nothing recorded: nothing to hand back, and the touch window judges it (store.ts).
    expect(windowsStartTime(4242, undefined, facts(null).windows)).toBeNull();
  });

  test("a value another system wrote cannot be compared here: it counts as alive", () => {
    const { windows, asked } = facts({ 4242: "1000" });
    for (const like of ["proc:12345", "ps:Mon Oct 12 09:05:00 2026"]) {
      expect(windowsStartTime(4242, like, windows)).toBe(like);
    }
    expect(asked).toEqual([]); // and no PowerShell call is wasted on it
  });
});

describe("the reader the lease store uses", () => {
  test("Linux and macOS keep /proc and ps", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(startTimeReader(platform)(process.pid)).toBe(processStartTime(process.pid));
    }
    if (process.platform === "linux") {
      expect(startTimeReader("linux")(process.pid)).toStartWith("proc:");
    }
  });

  test("Windows reads PowerShell", () => {
    const { windows, asked } = facts({ 4242: "1000" });
    expect(startTimeReader("win32", windows)(4242)).toBe(`${WINDOWS_START_PREFIX}1000`);
    expect(asked).toEqual([START_TIME_SCRIPT(4242)]);
  });
});

describe("what a lease records as its holder", () => {
  test("Windows records the start time it read", () => {
    const { windows, asked } = facts({ [process.pid]: "1000" });
    const holder = leaseHolder("win32", windows);
    expect(holder.pid).toBe(process.pid);
    expect(holder.host).toBe(hostname());
    expect(holder.startTime).toBe(`${WINDOWS_START_PREFIX}1000`);
    expect(asked).toEqual([START_TIME_SCRIPT(process.pid)]);
  });

  test("Linux and macOS keep the plugin's own holder", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const { windows, asked } = facts({});
      const holder = leaseHolder(platform, windows);
      expect(holder.pid).toBe(process.pid);
      expect(holder.startTime).toBe(processStartTime(process.pid));
      expect(asked).toEqual([]); // no PowerShell call off Windows
    }
  });
});

describe("ending a job's process tree", () => {
  test("taskkill does it: the job's pid, and Node's fallback is not used", () => {
    const child = liveChild();
    try {
      const { windows, killed } = facts(null, 0);
      endJobTree(child.pid, windows);
      expect(killed).toEqual([child.pid]);
      expect(processIsGone(child.pid)).toBe(false); // the fake killed nothing
    } finally {
      child.stop();
    }
  });

  test("128 (the process was already gone) is an answer too: no fallback", () => {
    const child = liveChild();
    try {
      const { windows, killed } = facts(null, 128);
      endJobTree(child.pid, windows);
      expect(killed).toEqual([child.pid]);
      expect(processIsGone(child.pid)).toBe(false);
    } finally {
      child.stop();
    }
  });

  test("no taskkill at all: Node's own way ends the first process", async () => {
    const child = liveChild();
    const { windows, killed } = facts(null, -1);
    endJobTree(child.pid, windows);
    expect(killed).toEqual([child.pid]);
    await child.ended;
    expect(await waitForGone(child.pid)).toBe(true);
  });

  test("a pid that is already gone is not an error", async () => {
    const { windows } = facts(null, -1);
    const gone = await deadPid();
    expect(() => endJobTree(gone, windows)).not.toThrow();
  });
});

describe("whether a process is gone", () => {
  test("a live process is there; the same pid after it ended is gone", async () => {
    const child = liveChild();
    expect(processIsGone(child.pid)).toBe(false);
    child.stop();
    await child.ended;
    expect(await waitForGone(child.pid)).toBe(true);
  });

  test("this process is there", () => {
    expect(processIsGone(process.pid)).toBe(false);
  });
});
