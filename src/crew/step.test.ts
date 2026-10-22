/**
 * `crew step` (`step.ts`): the milestones a crew records, its own HEAD's sha, and the one
 * event each step appends. A step from outside a crew session is refused (D25: only a crew reports
 * its own steps).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { runCrew } from "./command";
import { createCrew, listCrew, readCrewEvents, writeLead } from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";

/** A world with one recorded crew session, in `state`, with a lead. */
async function crewWorld1(state: "working" | "blocked" = "working") {
  const world = crewWorld();
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
  await createCrew(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
      effort: "high",
      files: ["src/portal/server.ts"],
      id: ID,
      kind: "build",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: "C my-app B6b portal-live",
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
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live"),
    },
    T0,
  );
  return world;
}

describe("crew step", () => {
  test("D25: a step records its name, the time and HEAD's sha, and appends one event", async () => {
    const world = await crewWorld1();
    const head = git(world.repo, "rev-parse", "HEAD").trim();
    const code = await runCrew(
      ["step", "tests-green", "--note", "the new test fails without the fix"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([`step tests-green · ${head.slice(0, 7)}`]);
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "step",
      crew: ID,
      name: "C my-app B6b portal-live",
      lead: LEAD_SESSION,
      state: "working",
      text: "tests-green",
      sha: head,
      note: "the new test fails without the fix",
    });
    expect(events[1]?.at).toBe("2026-10-21T10:00:00.000Z");
  });

  test("D25: a step from outside a crew session is refused", async () => {
    const world = await crewWorld1();
    const code = await runCrew(["step", "tests-green"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew step: this session is not a crew session, and only a crew records its own steps and reports",
    ]);
    expect(world.out).toEqual([]);
    expect(readCrewEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: a step the crew session does not know is refused, with the ones it knows", async () => {
    const world = await crewWorld1();
    const code = await runCrew(["step", "shipped"], world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }));
    expect(code).toBe(2);
    expect(world.err[0]).toContain("shipped");
    expect(world.err[0]).toContain("tests-red");
    expect(readCrewEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: a step for a crew session that is not recorded is refused", async () => {
    const world = await crewWorld1();
    const code = await runCrew(
      ["step", "tests-green"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: "B6c-other-999999" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("B6c-other-999999");
    expect(readCrewEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D25: the crew session's record keeps the crew session itself; a step changes no state", async () => {
    const world = await crewWorld1();
    await runCrew(["step", "committed"], world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }));
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
    expect(record?.updatedAt).toBe("2026-10-21T10:00:00.000Z");
  });

  test("D25: a step in a repo the crew session is not in is refused", async () => {
    const world = await crewWorld1();
    const other = tempDir("other-repo");
    const code = await runCrew(
      ["step", "tests-green"],
      world.ctx({ cwd: other }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("not in a git project");
  });
});
