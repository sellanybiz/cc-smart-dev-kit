/** Start now or wait in the queue (`places.ts`): the phases waited for, the cap, the memory. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryFacts } from "../jobs/memory";
import { tempDir } from "../testing/temp";
import {
  freeForCrewGb,
  onOpusTier,
  placeFor,
  RUNNING_STATES,
  runningCrew,
  runningForLead,
  unmetWaits,
  withPlacesLock,
} from "./places";
import type { CrewRecord } from "./store";

/** A crew record of `phase` in `state`, recorded at minute `minute`. */
function crew(phase: string, state: string, minute = 0): CrewRecord {
  return {
    base: null,
    baseRef: "main",
    branch: `crew/${phase}-x`,
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
    name: `C my-app ${phase} x`,
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
    worktree: `/home/user/my-app/.claude/worktrees/crew-${phase}-x`,
  };
}

describe("the crew that hold a place", () => {
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
    ].map((state) => crew("K", state));
    expect(runningCrew(all).map((one) => one.state)).toEqual([
      "starting",
      "working",
      "blocked",
      "paused",
      "quiet",
    ]);
  });
});

describe("the phases a crew session waits for", () => {
  test("merged, and a removal after the merge, is finished; done, an unmerged removal and anything else is not", () => {
    const records = [
      crew("A", "done"),
      crew("B", "merged"),
      { ...crew("C", "removed"), mergedBeforeRemoval: true },
      crew("D", "working"),
      crew("E", "failed"),
      crew("F", "removed"),
    ];
    const unmergedF = {
      phase: "F",
      state: "removed",
      removedUnmerged: { id: "F-x-0", name: "C my-app F x" },
    };
    expect(unmetWaits(["A", "B", "C", "D", "E", "F", "G"], records)).toEqual([
      { phase: "A", state: "done" },
      { phase: "D", state: "working" },
      { phase: "E", state: "failed" },
      unmergedF,
      { phase: "G", state: null },
    ]);
  });

  test("F3: a removed crew session releases its dependents only when it was merged before the removal", () => {
    const merged = { ...crew("A", "removed"), mergedBeforeRemoval: true };
    expect(unmetWaits(["A"], [merged])).toEqual([]);
    // Removed before its work was merged: the dependent would branch without the work it waits for.
    const unmerged = { ...crew("B", "removed"), mergedBeforeRemoval: false };
    const waiting = {
      phase: "B",
      state: "removed",
      removedUnmerged: { id: "B-x-0", name: "C my-app B x" },
    };
    expect(unmetWaits(["B"], [unmerged])).toEqual([waiting]);
    // A record an older kit wrote carries no fact either way: no proof of a merge, so it still waits.
    expect(unmetWaits(["B"], [crew("B", "removed")])).toEqual([waiting]);
  });

  test("a phase's newest crew session counts: a hand-off's next crew session, a second try", () => {
    expect(unmetWaits(["A"], [crew("A", "handoff", 1), crew("A", "merged", 2)])).toEqual([]);
    expect(unmetWaits(["A"], [crew("A", "merged", 2), crew("A", "working", 3)])).toEqual([
      { phase: "A", state: "working" },
    ]);
  });
});

describe("D25: start now, or queued with the reason", () => {
  const free = {
    freeGb: 10,
    leadRunning: 0,
    leadRunningOpus: 0,
    max: 24,
    maxOpus: null,
    needGb: 2,
    opus: false,
    opusFallback: false,
    perLead: 4,
    perLeadOpus: 2,
    running: 1,
    runningOpus: 0,
    unmet: [],
    usageHoldPercent: 85,
    usagePercent: null,
  };

  test("a free place and enough memory: start", () => {
    expect(placeFor(free)).toEqual({ start: true });
    expect(placeFor({ ...free, freeGb: null })).toEqual({ start: true });
  });

  test("D54: a lead's own cap, across every repository of the machine", () => {
    expect(placeFor({ ...free, leadRunning: 4 })).toEqual({
      start: false,
      why: "its lead has 4 of 4 crew sessions running; it starts when one of them finishes",
    });
    // Another lead's crew sessions do not count: four running in all, one of them this lead's.
    expect(placeFor({ ...free, running: 4, leadRunning: 1 })).toEqual({ start: true });
  });

  test("D54: a lead's opus cap holds only a new opus crew session", () => {
    const atIt = { ...free, leadRunning: 3, leadRunningOpus: 2 };
    expect(placeFor({ ...atIt, opus: true })).toEqual({
      start: false,
      why: "its lead has 2 of 2 opus crew sessions running; it starts when one of them finishes",
    });
    expect(placeFor(atIt)).toEqual({ start: true });
    // Its lead's opus cap comes first: it names the cap that holds it.
    expect(placeFor({ ...atIt, opus: true, leadRunning: 4 })).toMatchObject({
      why: "its lead has 4 of 4 crew sessions running; it starts when one of them finishes",
    });
  });

  test("D54: the machine's safety ceiling", () => {
    expect(placeFor({ ...free, running: 24 })).toEqual({
      start: false,
      why: "24 of 24 crew sessions running on this machine; it starts when one finishes",
    });
    // Under the ceiling, a lead's caps are what hold its crew sessions.
    expect(placeFor({ ...free, running: 23, leadRunning: 1 })).toEqual({ start: true });
  });

  test("D54: the optional machine-wide opus ceiling: unset counts nothing", () => {
    const many = { ...free, leadRunning: 1, leadRunningOpus: 1, running: 5, runningOpus: 4 };
    expect(placeFor({ ...many, opus: true })).toEqual({ start: true });
    expect(placeFor({ ...many, opus: true, maxOpus: 4 })).toEqual({
      start: false,
      why: "4 of 4 opus crew sessions running on this machine; it starts when one of them finishes",
    });
    expect(placeFor({ ...many, maxOpus: 4 })).toEqual({ start: true });
  });

  test("D37: the opus-tier crew sessions among the running ones, by the tier recorded at launch", () => {
    const opus = {
      ...crew("A", "working"),
      model: { ...crew("A", "working").model, tier: "opus" },
    };
    expect(onOpusTier([opus, crew("B", "working")]).map((one) => one.phase)).toEqual(["A"]);
  });

  test("the memory", () => {
    expect(placeFor({ ...free, freeGb: 1.44 })).toEqual({
      start: false,
      why: "1.4 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...free, freeGb: -3 })).toMatchObject({
      why: "0 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
  });

  test("D54: past 85% of the 5-hour window, a new opus crew session waits", () => {
    const past = { ...free, opus: true, usagePercent: 87 };
    expect(placeFor(past)).toEqual({
      start: false,
      why: "the 5-hour usage window is at 87%, past 85%; it starts when the window resets, or when the opus slot has a fallback chain",
    });
    // At the share exactly, it starts: past it holds.
    expect(placeFor({ ...past, usagePercent: 85 })).toEqual({ start: true });
    // A sonnet crew session still starts past it.
    expect(placeFor({ ...past, opus: false })).toEqual({ start: true });
    // A window that cannot be read never holds.
    expect(placeFor({ ...past, usagePercent: null })).toEqual({ start: true });
    // The gateway's opus slot with its fallback chain on lifts the guard.
    expect(placeFor({ ...past, opusFallback: true })).toEqual({ start: true });
  });

  test("D54: its phases first, then the lead's caps, the ceiling, the memory, and the window", () => {
    const unmet = [
      { phase: "B6c", state: "working" },
      { phase: "B7", state: null },
    ];
    expect(placeFor({ ...free, leadRunning: 4, unmet })).toEqual({
      start: false,
      why: "waits for B6c (working), B7 (not started yet); it starts when each is merged",
    });
    const opus = { ...free, opus: true, leadRunning: 1, leadRunningOpus: 1, running: 24 };
    expect(placeFor(opus)).toMatchObject({
      why: "24 of 24 crew sessions running on this machine; it starts when one finishes",
    });
    expect(placeFor({ ...opus, running: 2, freeGb: 0 })).toMatchObject({
      why: "0 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...opus, running: 2, freeGb: 10, usagePercent: 90 })).toMatchObject({
      why: "the 5-hour usage window is at 90%, past 85%; it starts when the window resets, or when the opus slot has a fallback chain",
    });
  });
});

describe("D54: a lead's crew sessions, across every repository's store", () => {
  // The store's schema requires `leadSessionId`, so a record from disk that lacks it is
  // reported broken and counted nowhere. This is the function's own contract for a hand-built
  // record: it counts toward the machine's ceiling and never against a lead's cap.
  test("only the lead's own count; a record with no lead field belongs to no lead", () => {
    const mine = crew("A", "working");
    const theirs = { ...crew("B", "working"), leadSessionId: "another-lead" };
    const old = { ...crew("C", "working") } as Partial<CrewRecord>;
    delete old.leadSessionId;
    const records = [mine, theirs, old as CrewRecord];
    expect(runningForLead(records, "lead").map((one) => one.phase)).toEqual(["A"]);
    // The machine's ceiling still counts every one that holds a place.
    expect(runningCrew(records).map((one) => one.phase)).toEqual(["A", "B", "C"]);
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

describe("the memory a new crew session may use", () => {
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
    expect(await freeForCrewGb(home, linux(3 * 1024 ** 2))).toBe(3);
  });

  test("less what heavy jobs reserved and have not used yet", async () => {
    if (process.getuid === undefined) return;
    const home = tempDir("home");
    lease(home, 3);
    // 3 GB reserved, the slice uses 1 GB of it: 2 GB of the free 5 are spoken for.
    expect(await freeForCrewGb(home, linux(5 * 1024 ** 2, 1))).toBe(3);
    // No slice reading: used and unused cannot be told apart, so none is counted twice.
    expect(await freeForCrewGb(home, linux(5 * 1024 ** 2))).toBe(5);
  });

  test("macOS: free memory cannot be read, so only the cap counts", async () => {
    const mac: MemoryFacts = {
      freemem: () => 0,
      platform: "darwin",
      read: () => null,
      totalmem: () => 16 * 1024 ** 3,
    };
    expect(await freeForCrewGb(tempDir("home"), mac)).toBeNull();
  });

  test("a jobs.json that cannot be used counts no reservation", async () => {
    const home = tempDir("home");
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(join(home, ".config", "cc-smart-dev-kit", "jobs.json"), "{ not json");
    expect(await freeForCrewGb(home, linux(4 * 1024 ** 2))).toBe(4);
  });
});
