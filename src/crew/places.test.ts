/** Start now or wait in the queue (`places.ts`): the phases waited for, the cap, the memory. */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryFacts } from "../jobs/memory";
import type { LoadFacts } from "../machine/load";
import { locateCheckout } from "../project/resolve";
import { type CrewWorld, crewWorld, LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { defaultResolved } from "../testing/fake-workflow";
import { cleanGitEnv, tempDir } from "../testing/temp";
import {
  freeForCrewGb,
  onOpusTier,
  placeFor,
  placeForLeadStart,
  placeInputOf,
  RUNNING_STATES,
  runningCrew,
  runningForLead,
  unmetWaits,
  withPlacesLock,
} from "./places";
import { type CrewRecord, createCrew, type NewCrew, writeLead } from "./store";

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

describe("D72: the shared place input", () => {
  test("a resume excludes itself once, while another live claim holds a place", () => {
    const paused = crew("A1", "paused");
    const stopped = crew("B2", "stopped");
    const claimed = {
      ...crew("C3", "stopped"),
      resumeClaim: { at: "2026-10-21T10:00:00.000Z", token: "resume-token" },
    };
    const input = (exclude: CrewRecord) =>
      placeInputOf(
        [paused, stopped, claimed],
        "lead",
        defaultResolved().crew,
        { opusFallback: false, percent: null },
        {
          continuation: false,
          opus: false,
          unmet: [],
          nowMs: Date.parse("2026-10-21T10:00:10.000Z"),
          exclude,
        },
      );
    expect(input(paused).running).toBe(1);
    expect(input(paused).leadRunning).toBe(1);
    expect(input(stopped).running).toBe(2);
    expect(placeFor({ ...input(paused), max: 2 })).toEqual({ start: true });
    expect(placeFor({ ...input(stopped), max: 2 })).toEqual({
      start: false,
      hold: "machine",
      why: "2 of 2 crew sessions running on this machine; it starts when one finishes",
    });
  });

  test("another repository's latest launch holds the gap, but the lead guard's input ignores it", () => {
    const other = {
      ...crew("A1", "stopped"),
      repo: "/home/user/other-app",
      launchedAt: "2026-10-21T10:00:00.000Z",
    };
    const input = placeInputOf(
      [other],
      "lead",
      defaultResolved().crew,
      { opusFallback: false, percent: null },
      {
        continuation: false,
        opus: false,
        unmet: [],
        nowMs: Date.parse("2026-10-21T10:00:10.000Z"),
      },
    );
    expect(placeFor(input)).toEqual({
      start: false,
      hold: "spacing",
      why: "the last crew launch on this machine was 10 s ago; launches are 60 s apart; it starts in 50 s",
    });
    const guard = placeInputOf(
      [other],
      "lead",
      defaultResolved().crew,
      { opusFallback: false, percent: null },
      {
        continuation: false,
        opus: false,
        unmet: [],
        nowMs: Date.parse("2026-10-21T10:00:10.000Z"),
        ignoreGap: true,
      },
    );
    expect(placeFor(guard)).toEqual({ start: true });
  });

  test("a launch time later than now (the clock was set back) is left out of the gap", () => {
    const ahead = { ...crew("A1", "stopped"), launchedAt: "2026-10-21T11:00:00.000Z" };
    const earlier = { ...crew("B2", "stopped"), launchedAt: "2026-10-21T09:58:00.000Z" };
    const input = placeInputOf(
      [ahead, earlier],
      "lead",
      defaultResolved().crew,
      { opusFallback: false, percent: null },
      {
        continuation: false,
        opus: false,
        unmet: [],
        nowMs: Date.parse("2026-10-21T10:00:10.000Z"),
      },
    );
    expect(input.lastLaunchMs).toBe(Date.parse("2026-10-21T09:58:00.000Z"));
    expect(placeFor(input)).toEqual({ start: true });
  });

  test("a failed start without launchedAt still contributes its startedAt to the gap", () => {
    const failed = { ...crew("A1", "failed"), startedAt: "2026-10-21T10:00:00.000Z" };
    const input = placeInputOf(
      [failed],
      "lead",
      defaultResolved().crew,
      { opusFallback: false, percent: null },
      {
        continuation: false,
        opus: false,
        unmet: [],
        nowMs: Date.parse("2026-10-21T10:00:10.000Z"),
      },
    );
    expect(input.lastLaunchMs).toBe(1792576800000);
    expect(placeFor(input)).toEqual({
      start: false,
      hold: "spacing",
      why: "the last crew launch on this machine was 10 s ago; launches are 60 s apart; it starts in 50 s",
    });
  });
});

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
    expect(unmetWaits(["A", "B", "C", "D", "E", "F", "G"], records)).toEqual([
      { phase: "A", state: "done" },
      { phase: "D", state: "working" },
      { phase: "E", state: "failed" },
      { phase: "F", state: "removed" },
      { phase: "G", state: null },
    ]);
  });

  test("F3: a removed crew session releases its dependents only when it was merged before the removal", () => {
    const merged = { ...crew("A", "removed"), mergedBeforeRemoval: true };
    expect(unmetWaits(["A"], [merged])).toEqual([]);
    // Removed before its work was merged: the dependent would branch without the work it waits for.
    const unmerged = { ...crew("B", "removed"), mergedBeforeRemoval: false };
    const waiting = { phase: "B", state: "removed" };
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
    continuation: false,
    freeGb: 10,
    leadRunning: 0,
    leadRunningOpus: 0,
    load: null as null | { cores: number; oneMinute: number },
    loadPerCore: 3,
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

  test("D72: launches, including continuations, wait for the machine's gap", () => {
    const recent = { ...free, nowMs: 72_000, lastLaunchMs: 60_000, startGapSeconds: 60 };
    const held = {
      start: false,
      hold: "spacing",
      why: "the last crew launch on this machine was 12 s ago; launches are 60 s apart; it starts in 48 s",
    } as const;
    expect(placeFor(recent)).toEqual(held);
    expect(placeFor({ ...recent, continuation: true })).toEqual(held);
    expect(placeFor({ ...recent, nowMs: 120_000 })).toEqual({ start: true });
  });

  test("a free place and enough memory: start", () => {
    expect(placeFor(free)).toEqual({ start: true });
    expect(placeFor({ ...free, freeGb: null })).toEqual({ start: true });
  });

  test("D54: a lead's own cap, across every repository of the machine", () => {
    expect(placeFor({ ...free, leadRunning: 4 })).toEqual({
      start: false,
      hold: "lead",
      why: "its lead has 4 of 4 crew sessions running; it starts when one of them finishes",
    });
    // Another lead's crew sessions do not count: four running in all, one of them this lead's.
    expect(placeFor({ ...free, running: 4, leadRunning: 1 })).toEqual({ start: true });
  });

  test("D54: a lead's opus cap holds only a new opus crew session", () => {
    const atIt = { ...free, leadRunning: 3, leadRunningOpus: 2 };
    expect(placeFor({ ...atIt, opus: true })).toEqual({
      start: false,
      hold: "lead-opus",
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
      hold: "machine",
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
      hold: "machine-opus",
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
      hold: "memory",
      why: "1.4 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...free, freeGb: -3 })).toMatchObject({
      why: "0 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
  });

  test("the load: a start waits while the 1-minute average is past loadPerCore for each core", () => {
    const busy = { ...free, load: { cores: 16, oneMinute: 85 } };
    expect(placeFor(busy)).toEqual({
      start: false,
      hold: "load",
      why: "the load is 85 on 16 cores, past 48 (3 for each core); it starts when the load falls",
    });
    // At the limit exactly it starts: past it holds.
    expect(placeFor({ ...busy, load: { cores: 16, oneMinute: 48 } })).toEqual({ start: true });
    expect(placeFor({ ...busy, load: { cores: 16, oneMinute: 12.3 } })).toEqual({ start: true });
    // A fractional load reads with one decimal; the limit follows the setting.
    expect(placeFor({ ...busy, load: { cores: 4, oneMinute: 7.26 }, loadPerCore: 1.5 })).toEqual({
      start: false,
      hold: "load",
      why: "the load is 7.3 on 4 cores, past 6 (1.5 for each core); it starts when the load falls",
    });
    // No load average (native Windows): the hold does not apply.
    expect(placeFor({ ...busy, load: null })).toEqual({ start: true });
    // The memory is named before the load, the load before the usage window.
    expect(placeFor({ ...busy, freeGb: 0 })).toMatchObject({
      why: "0 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...busy, opus: true, usagePercent: 90 })).toMatchObject({
      why: expect.stringContaining("the load is 85"),
    });
  });

  test("D70: a hand-off's next crew session is not held by the load; every other hold still applies", () => {
    const busy = { ...free, continuation: true, load: { cores: 16, oneMinute: 88.1 } };
    expect(placeFor(busy)).toEqual({ start: true });
    // A new phase at the same load still waits.
    expect(placeFor({ ...busy, continuation: false })).toEqual({
      start: false,
      hold: "load",
      why: "the load is 88.1 on 16 cores, past 48 (3 for each core); it starts when the load falls",
    });
    expect(placeFor({ ...busy, freeGb: 1 })).toEqual({
      start: false,
      hold: "memory",
      why: "1 GB free, a crew session needs 2 GB; it starts when memory frees",
    });
    expect(placeFor({ ...busy, running: 24 })).toEqual({
      start: false,
      hold: "machine",
      why: "24 of 24 crew sessions running on this machine; it starts when one finishes",
    });
    expect(placeFor({ ...busy, leadRunning: 4 })).toEqual({
      start: false,
      hold: "lead",
      why: "its lead has 4 of 4 crew sessions running; it starts when one of them finishes",
    });
    expect(placeFor({ ...busy, opus: true, usagePercent: 90 })).toEqual({
      start: false,
      hold: "usage",
      why: "the 5-hour usage window is at 90%, past 85%; it starts when the window resets, or when the opus slot has a fallback chain",
    });
    expect(placeFor({ ...busy, unmet: [{ phase: "B", state: "working" }] })).toEqual({
      start: false,
      hold: "phases",
      why: "waits for B (working); it starts when each is merged",
    });
  });

  test("D54: past 85% of the 5-hour window, a new opus crew session waits", () => {
    const past = { ...free, opus: true, usagePercent: 87 };
    expect(placeFor(past)).toEqual({
      start: false,
      hold: "usage",
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
      hold: "phases",
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

/** A calm Linux machine: a load of 1 on 8 cores, far under any limit. */
function calm(): LoadFacts {
  return { cores: () => 8, loadavg: () => [1, 1, 1], platform: "linux" };
}

/** Linux with `MemAvailable` of `availableKb` and no cgroup ceiling. */
function linux(availableKb: number): MemoryFacts {
  const files: Record<string, string> = {
    "/proc/meminfo": `MemTotal:       33554432 kB\nMemAvailable:   ${availableKb} kB\n`,
  };
  return {
    freemem: () => 0,
    platform: "linux",
    read: (path) => files[path] ?? null,
    totalmem: () => 32 * 1024 ** 3,
  };
}

describe("the memory a new crew session may use", () => {
  // The queue counts jobs, not gigabytes: a running heavy job reserves nothing, so what it uses
  // is already gone from the free memory, and the free memory is the whole answer.
  test("the free memory now, as the job queue reads it", () => {
    expect(freeForCrewGb(linux(3 * 1024 ** 2))).toBe(3);
  });

  test("a cgroup ceiling below the machine counts, as it does for the job queue", () => {
    const files: Record<string, string> = {
      "/proc/meminfo": "MemTotal: 33554432 kB\nMemAvailable: 33554432 kB\n",
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": `${8 * 1024 ** 3}\n`,
      "/sys/fs/cgroup/memory.current": `${6 * 1024 ** 3}\n`,
    };
    const limited: MemoryFacts = {
      freemem: () => 0,
      platform: "linux",
      read: (path) => files[path] ?? null,
      totalmem: () => 32 * 1024 ** 3,
    };
    expect(freeForCrewGb(limited)).toBe(2);
  });

  test("macOS: free memory cannot be read, so only the cap counts", () => {
    const mac: MemoryFacts = {
      freemem: () => 0,
      platform: "darwin",
      read: () => null,
      totalmem: () => 16 * 1024 ** 3,
    };
    expect(freeForCrewGb(mac)).toBeNull();
  });
});

describe("D59: would a crew start from this lead queue now", () => {
  const NOW = Date.parse("2026-10-21T10:00:00.000Z");

  /** A record as `createCrew` takes it: the `crew` builder without the store's own stamps. */
  function fresh(one: CrewRecord): NewCrew {
    const { createdAt, updatedAt, version, ...rest } = one;
    return rest;
  }

  /** A real project with a recorded lead, its crew caps as the test's file sets them. */
  async function leadWorld(crew: Record<string, unknown> = {}) {
    const world = crewWorld();
    // The switch is the project's, the limits are the person's own (D71).
    const { enabled, ...limits } = crew;
    if (enabled !== undefined) world.writeConfig({ enabled });
    world.writePersonal({ memoryGb: 1, ...limits });
    const checkout = locateCheckout(world.repo, { env: cleanGitEnv() });
    if (checkout === null) throw new Error("the test repository has no checkout");
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app plan",
        plan: "plan",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app",
      },
      NOW,
    );
    return { checkout, world };
  }

  /** A crew session of this lead in the store, in `state`; `change` overrides any field. */
  async function stored(
    world: CrewWorld,
    phase: string,
    state: string,
    change: Partial<NewCrew> = {},
  ): Promise<void> {
    await createCrew(
      world.paths.stateDir,
      {
        ...fresh(crew(phase, state)),
        leadSessionId: LEAD_SESSION,
        repo: world.repo,
        ...change,
      },
      NOW,
    );
  }

  /** What a start from this lead would do now, with 8 GB free unless the test says otherwise. */
  async function startNow(
    made: Awaited<ReturnType<typeof leadWorld>>,
    opus = false,
    memory: MemoryFacts = linux(8 * 1024 ** 2),
    load: LoadFacts = calm(),
  ) {
    return await placeForLeadStart({
      checkout: made.checkout,
      leadSessionId: LEAD_SESSION,
      load,
      memory,
      nowMs: NOW,
      opus,
      paths: made.world.paths,
    });
  }

  /** A crew session on the opus tier: what `perLeadOpus` and `maxOpus` count (D54). */
  const ON_OPUS: Partial<NewCrew> = {
    model: { named: "opus", resolved: "opus", slot: null, tier: "opus" },
  };

  test("this lead's perLead is full", async () => {
    const made = await leadWorld({ perLead: 1 });
    await stored(made.world, "B1", "working");
    expect(await startNow(made)).toEqual({
      start: false,
      hold: "lead",
      why: "its lead has 1 of 1 crew sessions running; it starts when one of them finishes",
    });
  });

  test("the machine's max is full, by another lead's crew sessions", async () => {
    const made = await leadWorld({ max: 1 });
    await stored(made.world, "B1", "working", { leadSessionId: OTHER_SESSION });
    expect(await startNow(made)).toEqual({
      start: false,
      hold: "machine",
      why: "1 of 1 crew sessions running on this machine; it starts when one finishes",
    });
  });

  test("only an opus place is short, so only an opus launch waits", async () => {
    const made = await leadWorld({ perLead: 4, perLeadOpus: 1 });
    await stored(made.world, "B1", "working", ON_OPUS);
    expect(await startNow(made, true)).toEqual({
      start: false,
      hold: "lead-opus",
      why: "its lead has 1 of 1 opus crew sessions running; it starts when one of them finishes",
    });
    // The same store, for a launch that would not spend the opus tier: a place is free.
    expect(await startNow(made)).toEqual({ start: true });
  });

  test("a free place: the start would go now", async () => {
    const made = await leadWorld();
    expect(await startNow(made)).toEqual({ start: true });
  });

  test("phases that wait only for a merge are no cap", async () => {
    const made = await leadWorld();
    // B1 finished its work and waits for the lead's merge; B2 waits in the queue for B1. Neither
    // is a cap on a new start: `--waits-for` is a merge, not a place.
    await stored(made.world, "B1", "done");
    await stored(made.world, "B2", "queued", { waitsFor: ["B1"] });
    expect(await startNow(made)).toEqual({ start: true });
  });

  test("the memory a crew session needs is read when nothing else holds", async () => {
    const made = await leadWorld({ memoryGb: 8 });
    expect(await startNow(made, false, linux(3 * 1024 ** 2))).toEqual({
      start: false,
      hold: "memory",
      why: "3 GB free, a crew session needs 8 GB; it starts when memory frees",
    });
  });

  test("the load of the machine holds a start, and a machine with no load average does not", async () => {
    const made = await leadWorld({ loadPerCore: 2 });
    const load = (oneMinute: number, platform: NodeJS.Platform = "linux"): LoadFacts => ({
      cores: () => 8,
      loadavg: () => [oneMinute, 0, 0],
      platform,
    });
    expect(await startNow(made, false, undefined, load(40))).toEqual({
      start: false,
      hold: "load",
      why: "the load is 40 on 8 cores, past 16 (2 for each core); it starts when the load falls",
    });
    expect(await startNow(made, false, undefined, load(15))).toEqual({ start: true });
    expect(await startNow(made, false, undefined, load(40, "win32"))).toEqual({ start: true });
  });

  test("caps it cannot read: null, and the caller lets the launch through", async () => {
    const made = await leadWorld();
    writeFileSync(join(made.world.repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    expect(await startNow(made)).toBeNull();
  });

  test("crew sessions off here: no start would queue", async () => {
    const made = await leadWorld({ enabled: false });
    expect(await startNow(made)).toBeNull();
  });
});
