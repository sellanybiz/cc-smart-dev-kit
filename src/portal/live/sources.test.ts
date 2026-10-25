/**
 * The live stream's sources, on their own: what each poll publishes, and what it leaves alone
 * when nothing changed (B6b).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { appendCrewEvent, createCrew, crewStoreDir, type NewCrew } from "../../crew/store";
import { askLogFile } from "../../hooks/ask-log";
import type { JobsAnswer } from "../../jobs/status";
import { tempDir } from "../../testing/temp";
import { updateFiles, writeLastCheck } from "../../update/state";
import { createLiveSources } from "./sources";

/** A published event, as the test collects it. */
interface Published {
  data: unknown;
  event: string;
}

/** One repository and one crew session, for a store fixture. */
const REPO = "/home/user/my-app";
const LEAD = "11111111-1111-4111-8111-111111111111";

/** A queued crew session, as the store writes one. */
function queued(): NewCrew {
  return {
    base: null,
    baseRef: "main",
    branch: "crew/K-contracts",
    effort: "xhigh",
    files: ["src/crew/store.ts"],
    id: "crew-K-contracts",
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: "C my-app K contracts",
    permissionMode: "auto",
    phase: "K",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo: REPO,
    sessionId: null,
    shortId: null,
    slug: "contracts",
    state: "queued",
    waitsFor: [],
    worktree: `${REPO}/.claude/worktrees/crew-K-contracts`,
  };
}

/** A poller on a temp home, with a fake router and a collector. */
function world(options: { now?: () => number; recent?: () => unknown[]; routerUp?: boolean } = {}) {
  const home = tempDir("live");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const published: Published[] = [];
  let jobs: JobsAnswer = {
    budgetGb: 8,
    freeGb: 8,
    keptGb: 22,
    memoryGb: 32,
    stores: [],
    weights: { cpu: { value: 20 }, io: { value: null, why: "the io controller is not delegated" } },
  };
  const sources = createLiveSources({
    fetch: async () =>
      options.routerUp === false
        ? Response.json({ error: "down" }, { status: 503 })
        : Response.json({
            ok: true,
            port: 20_199,
            recent: (options.recent ?? (() => []))(),
            uptimeSec: 1,
          }),
    jobs: async () => jobs,
    now: options.now ?? (() => Date.now()),
    paths,
    pollMs: 3_600_000,
    publish: (event, data) => published.push({ data, event }),
    // Recorded among the events, so a test sees where the page reads were dropped.
    forgetPageReads: () => published.push({ data: null, event: "forget-page-reads" }),
    routerPort: () => (options.routerUp === false ? null : 20_199),
  });
  return {
    home,
    paths,
    published,
    setJobs: (next: JobsAnswer) => {
      jobs = next;
    },
    sources,
    /** The events of one name, in order. */
    of: (event: string) => published.filter((one) => one.event === event).map((one) => one.data),
  };
}

describe("the live stream's sources", () => {
  test("the router's recent: the first poll is a baseline, then each new request once", async () => {
    let recent: unknown[] = [
      { at: 1, ms: 5, nextTarget: false, slot: null, status: 200, target: "anthropic" },
    ];
    const world1 = world({ recent: () => recent });
    await world1.sources.pollOnce();
    expect(world1.of("recent")).toEqual([]);
    recent = [
      ...recent,
      { at: 2, ms: 7, nextTarget: true, slot: "scout", status: 429, target: "anthropic" },
    ];
    await world1.sources.pollOnce();
    expect(world1.of("recent")).toEqual([
      { at: 2, ms: 7, nextTarget: true, slot: "scout", status: 429, target: "anthropic" },
    ]);
    // The same answer again: nothing is published twice.
    await world1.sources.pollOnce();
    expect(world1.of("recent")).toHaveLength(1);
  });

  test("a router that is down publishes nothing about it", async () => {
    const world1 = world({ routerUp: false });
    await world1.sources.pollOnce();
    // The queue's own first answer is published (a page opens with it); nothing claims a router.
    expect(world1.of("recent")).toEqual([]);
    expect(world1.of("state")).toEqual([]);
    expect(world1.of("crew")).toEqual([]);
  });

  test("gateway-state: the limits, the fallbacks, the breakers and seenClaude, only on a change", async () => {
    const world1 = world({ routerUp: false });
    mkdirSync(dirname(world1.paths.gatewayStateFile), { recursive: true });
    writeFileSync(
      world1.paths.gatewayStateFile,
      JSON.stringify({ fallbacks: {}, limits: {}, seenClaude: {}, version: 1 }),
    );
    await world1.sources.pollOnce();
    const states = world1.of("state");
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ breakers: {}, fallbacks: {}, limits: {}, seenClaude: {} });
    await world1.sources.pollOnce();
    expect(world1.of("state")).toHaveLength(1);
    writeFileSync(
      world1.paths.gatewayStateFile,
      JSON.stringify({
        breakers: {
          "cc-smart-dev-kit-worker": {
            held: 2,
            lastAt: Date.now(),
            since: Date.now() - 1_000,
            targets: [{ status: 429, target: "omniroute:x", until: Date.now() + 30_000 }],
          },
        },
        fallbacks: {},
        limits: {},
        version: 1,
      }),
    );
    await world1.sources.pollOnce();
    const after = world1.of("state")[1] as { breakers: Record<string, unknown> };
    expect(Object.keys(after.breakers)).toEqual(["cc-smart-dev-kit-worker"]);
  });

  test("the guard log: the first poll is a baseline, then each new ask once, and a cut-back log starts again", async () => {
    const world1 = world({ routerUp: false });
    mkdirSync(join(world1.paths.stateDir), { recursive: true });
    const ask = (at: number) => ({
      at,
      hook: "git-guard",
      reason: "push to main",
      session: "s1",
      tool: "Bash",
    });
    writeFileSync(askLogFile(world1.paths.stateDir), `${JSON.stringify(ask(1))}\n`);
    await world1.sources.pollOnce();
    // The asks before the portal started are history, not news: the first poll only records
    // the log's place.
    expect(world1.of("guard-ask")).toEqual([]);
    writeFileSync(
      askLogFile(world1.paths.stateDir),
      `${JSON.stringify(ask(1))}\n${JSON.stringify(ask(2))}\n`,
    );
    await world1.sources.pollOnce();
    expect(world1.of("guard-ask")).toEqual([ask(2)]);
    // The frame keeps the newer half after the size limit: a smaller file is read from its start.
    writeFileSync(askLogFile(world1.paths.stateDir), `${JSON.stringify(ask(3))}\n`);
    await world1.sources.pollOnce();
    expect(world1.of("guard-ask")).toEqual([ask(2), ask(3)]);
  });

  test("the heavy-job queue: a lease that appears, then goes, is one event each time", async () => {
    const world1 = world({ routerUp: false });
    const leases = join(world1.home, ".local", "share", "cc-smart-dev-kit", "jobs", "leases");
    mkdirSync(leases, { recursive: true });
    // The first poll records the empty queue; a job arriving is the change that matters.
    await world1.sources.pollOnce();
    const before = world1.of("jobs").length;
    writeFileSync(join(leases, "job-1"), JSON.stringify({ gb: 4, v: 1 }));
    await world1.sources.pollOnce();
    expect(world1.of("jobs")).toHaveLength(before + 1);
    world1.setJobs({
      budgetGb: 8,
      freeGb: 4,
      keptGb: 22,
      memoryGb: 32,
      stores: [],
      weights: {
        cpu: { value: 20 },
        io: { value: null, why: "the io controller is not delegated" },
      },
    });
    await world1.sources.pollOnce();
    expect(world1.of("jobs")).toHaveLength(before + 1);
    writeFileSync(join(leases, "job-1"), JSON.stringify({ gb: 5, v: 1 }));
    await world1.sources.pollOnce();
    expect(world1.of("jobs")).toHaveLength(before + 2);
    // And when the lease goes, the queue is published again.
    rmSync(join(leases, "job-1"));
    await world1.sources.pollOnce();
    expect(world1.of("jobs")).toHaveLength(before + 3);
  });

  test("the crew log: the first poll is a baseline, then only the step added after it", async () => {
    const world1 = world({ routerUp: false });
    await createCrew(world1.paths.stateDir, queued(), Date.now());
    await world1.sources.pollOnce();
    // The whole history before the portal started is not sent as live events.
    expect(world1.of("crew")).toEqual([]);
    await appendCrewEvent(
      world1.paths.stateDir,
      REPO,
      {
        crew: "crew-K-contracts",
        lead: LEAD,
        name: "C my-app K contracts",
        state: "working",
        text: "step 1",
        type: "step",
      },
      Date.now(),
    );
    await world1.sources.pollOnce();
    const all = world1.of("crew") as { text: null | string; type: string }[];
    expect(all.map((one) => one.type)).toEqual(["step"]);
    expect(all[0]?.text).toBe("step 1");
    expect(crewStoreDir(world1.paths.stateDir, REPO)).toContain("crew");
  });

  test("crew news drops the kept page reads first, so the page that reloads reads fresh", async () => {
    // Needs and Work keep a heavy read for a few seconds; an event from outside the portal (a
    // `crew rm` in a terminal) that lands inside that window must not leave the old list on show.
    const world1 = world({ routerUp: false });
    await createCrew(world1.paths.stateDir, queued(), Date.now());
    await world1.sources.pollOnce();
    await appendCrewEvent(
      world1.paths.stateDir,
      REPO,
      {
        crew: "crew-K-contracts",
        lead: LEAD,
        name: "C my-app K contracts",
        state: "working",
        text: "step 1",
        type: "step",
      },
      Date.now(),
    );
    world1.published.length = 0;
    await world1.sources.pollOnce();
    expect(world1.published.map((one) => one.event)).toEqual(["forget-page-reads", "crew"]);
    // A poll with no news drops nothing.
    world1.published.length = 0;
    await world1.sources.pollOnce();
    expect(world1.published.map((one) => one.event)).not.toContain("forget-page-reads");
  });

  test("a repository that appears after the first poll publishes its own events", async () => {
    // A new project's first crew session is news: the baseline covers the store as the portal
    // found it, not a log that did not exist then.
    let clock = Date.now();
    const world1 = world({ now: () => clock, routerUp: false });
    await createCrew(world1.paths.stateDir, queued(), clock);
    await world1.sources.pollOnce();
    expect(world1.of("crew")).toEqual([]);
    await createCrew(
      world1.paths.stateDir,
      {
        ...queued(),
        branch: "crew/K-other",
        id: "crew-K-other",
        name: "C other-app K other",
        repo: "/home/user/other-app",
        worktree: "/home/user/other-app/.claude/worktrees/crew-K-other",
      },
      clock,
    );
    // The repository list is trusted for 30 s: a new repository is seen at the next walk.
    clock += 31_000;
    await world1.sources.pollOnce();
    expect(world1.of("crew").map((one) => (one as { type: string }).type)).toEqual(["created"]);
  });

  test("a guard log that appears after the first poll publishes its first ask", async () => {
    // No log at the start is no history to skip: the first ask written later is news.
    const world1 = world({ routerUp: false });
    mkdirSync(world1.paths.stateDir, { recursive: true });
    const ask = (at: number) => ({
      at,
      hook: "session-escape-guard",
      reason: "the portal's port",
      session: "s1",
      tool: "Bash",
    });
    await world1.sources.pollOnce();
    expect(world1.of("guard-ask")).toEqual([]);
    writeFileSync(askLogFile(world1.paths.stateDir), `${JSON.stringify(ask(1))}\n`);
    await world1.sources.pollOnce();
    expect(world1.of("guard-ask")).toEqual([ask(1)]);
  });

  test("the last update check: one event when its record appears or changes", async () => {
    const world1 = world({ routerUp: false });
    mkdirSync(world1.paths.stateDir, { recursive: true });
    await world1.sources.pollOnce();
    // No record and no change: nothing to say.
    expect(world1.of("update")).toEqual([]);
    writeLastCheck(updateFiles(world1.paths.stateDir), {
      at: "2026-10-22T10:00:00.000Z",
      detail: "1.1.0",
      result: "up-to-date",
    });
    await world1.sources.pollOnce();
    expect(world1.of("update")).toHaveLength(1);
    await world1.sources.pollOnce();
    expect(world1.of("update")).toHaveLength(1);
  });
});
