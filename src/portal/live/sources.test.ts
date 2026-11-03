/**
 * The live stream's sources, on their own: what each poll publishes, and what it leaves alone
 * when nothing changed (B6b).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../../cli/paths";
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

/** A poller on a temp home, with a fake router and a collector. */
function world(options: { now?: () => number; recent?: () => unknown[]; routerUp?: boolean } = {}) {
  const home = tempDir("live");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const published: Published[] = [];
  let jobs: JobsAnswer = {
    route: { on: false, project: null, source: "default" },
    stores: [],
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
    writeFileSync(join(leases, "job-1"), JSON.stringify({ gb: 1, v: 1 }));
    await world1.sources.pollOnce();
    expect(world1.of("jobs")).toHaveLength(before + 1);
    world1.setJobs({
      route: { on: false, project: null, source: "default" },
      stores: [],
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
