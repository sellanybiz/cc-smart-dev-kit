/**
 * `worker step` (`step.ts`): the milestones a worker records, its own HEAD's sha, and the one
 * event each step appends. A step from outside a worker is refused (D25: only a worker reports
 * its own steps).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { git, tempDir } from "../testing/temp";
import { LEAD_SESSION, workerWorld } from "../testing/worker-world";
import { runWorker } from "./command";
import { createWorker, listWorkers, readWorkerEvents, writeLead } from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";

/** A world with one recorded worker, in `state`, with a lead. */
async function workerWorld1(state: "working" | "blocked" = "working") {
  const world = workerWorld();
  await writeLead(
    world.paths.stateDir,
    {
      cwd: world.repo,
      name: "LEAD my-app master-plan",
      plan: "master-plan",
      repo: world.repo,
      sessionId: LEAD_SESSION,
      tag: "my-app",
    },
    T0,
  );
  await createWorker(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "wk/B6b-portal-live",
      effort: "high",
      files: ["src/portal/server.ts"],
      id: ID,
      kind: "build",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: "W my-app B6b portal-live",
      permissionMode: "auto",
      phase: "B6b",
      plan: "master-plan",
      pr: null,
      questions: [],
      repo: world.repo,
      reportPath: null,
      sessionId: "aaaa1111-2222-3333-4444-555555555555",
      shortId: "aaaa1111",
      slug: "portal-live",
      state,
      waitsFor: [],
      worktree: join(world.repo, ".claude", "worktrees", "wk-B6b-portal-live"),
    },
    T0,
  );
  return world;
}

describe("worker step", () => {
  test("D25: a step records its name, the time and HEAD's sha, and appends one event", async () => {
    const world = await workerWorld1();
    const head = git(world.repo, "rev-parse", "HEAD").trim();
    const code = await runWorker(
      ["step", "tests-green", "--note", "the new test fails without the fix"],
      world.ctx({}, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([`step tests-green · ${head.slice(0, 7)}`]);
    const events = readWorkerEvents(world.paths.stateDir, world.repo).events;
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "step",
      worker: ID,
      name: "W my-app B6b portal-live",
      lead: LEAD_SESSION,
      state: "working",
      text: "tests-green",
      sha: head,
      note: "the new test fails without the fix",
    });
    expect(events[1]?.at).toBe("2026-10-21T10:00:00.000Z");
  });

  test("D25: a step from outside a worker is refused", async () => {
    const world = await workerWorld1();
    const code = await runWorker(["step", "tests-green"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "worker step: this session is not a worker, and only a worker records its own steps and reports",
    ]);
    expect(world.out).toEqual([]);
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: a step the worker does not know is refused, with the ones it knows", async () => {
    const world = await workerWorld1();
    const code = await runWorker(
      ["step", "shipped"],
      world.ctx({}, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(code).toBe(2);
    expect(world.err[0]).toContain("shipped");
    expect(world.err[0]).toContain("tests-red");
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: a step for a worker that is not recorded is refused", async () => {
    const world = await workerWorld1();
    const code = await runWorker(
      ["step", "tests-green"],
      world.ctx({}, { CC_SMART_DEV_KIT_WORKER: "B6c-other-999999" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("B6c-other-999999");
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: the worker's record keeps the worker itself; a step changes no state", async () => {
    const world = await workerWorld1();
    await runWorker(["step", "committed"], world.ctx({}, { CC_SMART_DEV_KIT_WORKER: ID }));
    const [record] = listWorkers(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
    expect(record?.updatedAt).toBe("2026-10-21T10:00:00.000Z");
  });

  test("D25: a step in a repo the worker is not in is refused", async () => {
    const world = await workerWorld1();
    const other = tempDir("other-repo");
    const code = await runWorker(
      ["step", "tests-green"],
      world.ctx({ cwd: other }, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("not in a git project");
  });
});
