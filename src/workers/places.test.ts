/** Start now or wait in the queue (`places.ts`): the phases waited for, the cap, the memory. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryFacts } from "../jobs/memory";
import { tempDir } from "../testing/temp";
import {
  freeForWorkersGb,
  onOpusTier,
  placeFor,
  RUNNING_STATES,
  runningWorkers,
  unmetWaits,
  withPlacesLock,
} from "./places";
import type { WorkerRecord } from "./store";

/** A worker record of `phase` in `state`, recorded at minute `minute`. */
function worker(phase: string, state: string, minute = 0): WorkerRecord {
  return {
    base: null,
    baseRef: "main",
    branch: `wk/${phase}-x`,
    createdAt: `2026-10-21T10:${String(minute).padStart(2, "0")}:00.000Z`,
    effort: "high",
    files: [],
    id: `${phase}-x-${minute}`,
    kind: "build",
    lastLine: null,
    leadName: "LEAD my-app plan",
    leadSessionId: "lead",
    memoryMb: null,
    model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
    name: `W my-app ${phase} x`,
    permissionMode: "auto",
    phase,
    plan: "plan",
    pr: null,
    questions: [],
    reportPath: null,
    repo: "/home/user/my-app",
    sessionId: null,
    shortId: null,
    slug: "x",
    state,
    updatedAt: "2026-10-21T10:00:00.000Z",
    version: 1,
    waitsFor: [],
    worktree: `/home/user/my-app/.claude/worktrees/wk-${phase}-x`,
  };
}

describe("the workers that hold a place", () => {
  test("starting, working, blocked, paused and quiet; never queued or finished", () => {
    expect(RUNNING_STATES).toEqual(["starting", "working", "blocked", "paused", "quiet"]);
    const all = [
      "queued",
      "starting",
      "working",
      "blocked",
      "paused",
      "quiet",
      "done",
      "failed",
      "stopped",
      "handoff",
      "merged",
      "removed",
      "a-newer-state",
    ].map((state) => worker("K", state));
    expect(runningWorkers(all).map((one) => one.state)).toEqual([
      "starting",
      "working",
      "blocked",
      "paused",
      "quiet",
    ]);
  });
});

describe("the phases a worker waits for", () => {
  test("done, merged or removed is finished; anything else, or no worker yet, is not", () => {
    const records = [
      worker("A", "done"),
      worker("B", "merged"),
      worker("C", "removed"),
      worker("D", "working"),
      worker("E", "failed"),
    ];
    expect(unmetWaits(["A", "B", "C", "D", "E", "F"], records)).toEqual([
      { phase: "D", state: "working" },
      { phase: "E", state: "failed" },
      { phase: "F", state: null },
    ]);
  });

  test("a phase's newest worker counts: a hand-off's next worker, a second try", () => {
    expect(unmetWaits(["A"], [worker("A", "handoff", 1), worker("A", "done", 2)])).toEqual([]);
    expect(unmetWaits(["A"], [worker("A", "done", 2), worker("A", "working", 3)])).toEqual([
      { phase: "A", state: "working" },
    ]);
  });
});

describe("D25: start now, or queued with the reason", () => {
  const free = {
    freeGb: 10,
    max: 6,
    maxOpus: 2,
    needGb: 2,
    opus: false,
    running: 1,
    runningOpus: 0,
    unmet: [],
  };

  test("a free place and enough memory: start", () => {
    expect(placeFor(free)).toEqual({ start: true });
    expect(placeFor({ ...free, freeGb: null })).toEqual({ start: true });
  });

  test("D37: the cap of all workers", () => {
    expect(placeFor({ ...free, running: 6 })).toEqual({
      start: false,
      why: "6 of 6 running; it starts when one finishes",
    });
  });

  test("D37: an opus worker at 2 opus running is queued while the total is under 6", () => {
    const twoOpus = { ...free, running: 3, runningOpus: 2 };
    expect(placeFor({ ...twoOpus, opus: true })).toEqual({
      start: false,
      why: "2 of 2 opus workers running; it starts when one of them finishes",
    });
    // A sonnet worker still starts then.
    expect(placeFor(twoOpus)).toEqual({ start: true });
    // And the total cap comes first: it names the cap that holds it.
    expect(placeFor({ ...twoOpus, opus: true, running: 6 })).toMatchObject({
      why: "6 of 6 running; it starts when one finishes",
    });
  });

  test("D37: the opus-tier workers among the running ones, by the tier recorded at launch", () => {
    const opus = {
      ...worker("A", "working"),
      model: { ...worker("A", "working").model, tier: "opus" },
    };
    expect(onOpusTier([opus, worker("B", "working")]).map((one) => one.phase)).toEqual(["A"]);
  });

  test("the memory", () => {
    expect(placeFor({ ...free, freeGb: 1.44 })).toEqual({
      start: false,
      why: "1.4 GB free, a worker needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...free, freeGb: -3 })).toMatchObject({
      why: "0 GB free, a worker needs 2 GB; it starts when memory frees",
    });
  });

  test("its phases first, then the cap", () => {
    const unmet = [
      { phase: "B6c", state: "working" },
      { phase: "B7", state: null },
    ];
    expect(placeFor({ ...free, running: 6, unmet })).toEqual({
      start: false,
      why: "waits for B6c (working), B7 (not started yet); it starts when each is done or merged",
    });
  });
});

describe("the machine-wide lock", () => {
  test("two decisions never overlap", async () => {
    const state = tempDir("state");
    const order: string[] = [];
    const one = withPlacesLock(state, async () => {
      order.push("first in");
      await Bun.sleep(150);
      order.push("first out");
    });
    await Bun.sleep(20);
    const two = withPlacesLock(state, () => {
      order.push("second in");
    });
    await Promise.all([one, two]);
    expect(order).toEqual(["first in", "first out", "second in"]);
  });
});

describe("the memory a new worker may use", () => {
  /**
   * Linux with `MemAvailable` of `availableKb`, no cgroup ceiling, and — when `sliceGb` is given
   * — the heavy jobs' slice using that much (`memory.current` of `cc-smart-dev-kit-heavy.slice`).
   */
  function linux(availableKb: number, sliceGb?: number): MemoryFacts {
    const files: Record<string, string> = {
      "/proc/meminfo": `MemTotal:       33554432 kB\nMemAvailable:   ${availableKb} kB\n`,
    };
    return {
      freemem: () => 0,
      platform: "linux",
      read: (path) => {
        if (
          sliceGb !== undefined &&
          path.endsWith("/cc-smart-dev-kit-heavy.slice/memory.current")
        ) {
          return String(sliceGb * 1024 ** 3);
        }
        return files[path] ?? null;
      },
      totalmem: () => 32 * 1024 ** 3,
    };
  }

  /** A heavy job's lease of `gb` in `home`'s queue, written just now by another host's process. */
  function lease(home: string, gb: number): void {
    const leases = join(home, ".local", "share", "cc-smart-dev-kit", "jobs", "leases");
    mkdirSync(leases, { recursive: true });
    writeFileSync(
      join(leases, "11111111-1111-1111-1111-111111111111.json"),
      JSON.stringify({ gb, holder: { host: "another-host", pid: 1 }, record: "{}", store: 1 }),
    );
  }

  test("the free memory, with no heavy job holding any", async () => {
    const home = tempDir("home");
    expect(await freeForWorkersGb(home, linux(3 * 1024 ** 2))).toBe(3);
  });

  test("less what heavy jobs reserved and have not used yet", async () => {
    if (process.getuid === undefined) return;
    const home = tempDir("home");
    lease(home, 3);
    // 3 GB reserved, the slice uses 1 GB of it: 2 GB of the free 5 are spoken for.
    expect(await freeForWorkersGb(home, linux(5 * 1024 ** 2, 1))).toBe(3);
    // No slice reading: used and unused cannot be told apart, so none is counted twice.
    expect(await freeForWorkersGb(home, linux(5 * 1024 ** 2))).toBe(5);
  });

  test("macOS: free memory cannot be read, so only the cap counts", async () => {
    const mac: MemoryFacts = {
      freemem: () => 0,
      platform: "darwin",
      read: () => null,
      totalmem: () => 16 * 1024 ** 3,
    };
    expect(await freeForWorkersGb(tempDir("home"), mac)).toBeNull();
  });

  test("a jobs.json that cannot be used counts no reservation", async () => {
    const home = tempDir("home");
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(join(home, ".config", "cc-smart-dev-kit", "jobs.json"), "{ not json");
    expect(await freeForWorkersGb(home, linux(4 * 1024 ** 2))).toBe(4);
  });
});
