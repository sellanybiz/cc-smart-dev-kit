import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectKey } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { allTasks } from "../tasks/work/queries";
import { crewPhaseState } from "../tasks/work/read";
import { createTask, updateTask } from "../tasks/work/store";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { runCrew } from "./command";
import { crewMcpFile, crewSettingsFile, listCrew, updateCrew, writeLead } from "./store";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const WHO = { sessionId: null, crewId: null, pid: null, procStart: null };

async function worldWithPhase() {
  const world = crewWorld();
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
  const brief = join(world.paths.home, "brief.md");
  writeFileSync(brief, "# Build the store\n\nThe phase.\n");
  expect(
    await runCrew(
      ["start", "P1", "--slug", "store", "--kind", "build", "--brief", brief],
      world.ctx(),
    ),
  ).toBe(0);
  const record = listCrew(world.paths.stateDir, world.repo).records[0];
  if (!record) throw new Error("no crew record");
  return { ...world, record, brief };
}

test("an unwritable task store is a note, never a failed start", async () => {
  const world = crewWorld();
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
  const file = workDbFile(world.paths);
  mkdirSync(file, { recursive: true });
  const brief = join(world.paths.home, "brief.md");
  writeFileSync(brief, "# Build it\n");
  expect(
    await runCrew(
      ["start", "P1", "--slug", "store", "--kind", "build", "--brief", brief],
      world.ctx(),
    ),
  ).toBe(0);
  expect(
    world.out.filter((line) => line.startsWith("note: the phase task could not be written:")),
  ).toHaveLength(1);
});

test("every start loads the task server and allows its tools", async () => {
  const world = await worldWithPhase();
  const mcp = JSON.parse(
    readFileSync(crewMcpFile(world.paths.stateDir, world.repo, world.record.id), "utf8"),
  );
  expect(mcp.mcpServers["cc-smart-dev-kit-tasks"]).toMatchObject({ alwaysLoad: true });
  const settings = JSON.parse(
    readFileSync(crewSettingsFile(world.paths.stateDir, world.repo, world.record.id), "utf8"),
  );
  expect(settings.permissions).toEqual({ allow: ["mcp__cc-smart-dev-kit-tasks__*"] });
});

test("a start writes the plan and phase, and a queued wait becomes a phase dependency", async () => {
  const world = await worldWithPhase();
  const state = crewPhaseState(world.paths, projectKey(world.repo), world.record.id);
  expect(state.state).toBe("ready");
  if (state.state !== "ready") throw new Error("no phase task");
  expect(state.value.phase).toMatchObject({
    kind: "phase",
    subject: "Build the store",
    phase: "P1",
    description: world.brief,
  });
  expect(
    await runCrew(
      [
        "start",
        "P2",
        "--slug",
        "use",
        "--kind",
        "build",
        "--brief",
        world.brief,
        "--waits-for",
        "P1",
      ],
      world.ctx(),
    ),
  ).toBe(0);
  const db = openWorkDb(workDbFile(world.paths), { mode: "write" });
  try {
    const tasks = allTasks(db, projectKey(world.repo));
    expect(tasks.find((t) => t.kind === "plan")).toMatchObject({ subject: "plan" });
    expect(tasks.find((t) => t.phase === "P2")?.waitsFor).toEqual([
      state.value.phase?.id ?? "missing",
    ]);
  } finally {
    db.close();
  }
});

test("the list and status show done subtasks over the whole phase subtree", async () => {
  const world = await worldWithPhase();
  const db = openWorkDb(workDbFile(world.paths), { mode: "write" });
  try {
    const phase = allTasks(db, projectKey(world.repo)).find((task) => task.kind === "phase");
    if (!phase) throw new Error("no phase");
    const child = createTask(
      db,
      { project: projectKey(world.repo), parentId: phase.id, subject: "Finished" },
      WHO,
      NOW,
    );
    if (!child.ok) throw new Error(child.why);
    expect(updateTask(db, child.value.id, { status: "done" }, WHO, NOW).ok).toBe(true);
    expect(
      createTask(
        db,
        { project: projectKey(world.repo), parentId: phase.id, subject: "Still open" },
        WHO,
        NOW,
      ).ok,
    ).toBe(true);
  } finally {
    db.close();
  }
  world.out.length = 0;
  expect(await runCrew(["list"], world.ctx())).toBe(0);
  expect(world.out).toContain("  tasks: 1/2");
  world.out.length = 0;
  expect(await runCrew(["status", world.record.id], world.ctx())).toBe(0);
  expect(world.out).toContain("tasks     1/2");
});

test.each([
  ["merged", "done"],
  ["removed", "dropped"],
  ["discarded", "dropped"],
] satisfies [string, "done" | "dropped"][])(
  "%s closes the phase as %s and drops open subtasks",
  async (state, outcome) => {
    const world = await worldWithPhase();
    const db = openWorkDb(workDbFile(world.paths), { mode: "write" });
    try {
      const phase = allTasks(db, projectKey(world.repo)).find((t) => t.kind === "phase");
      if (!phase) throw new Error("no phase task");
      expect(
        createTask(
          db,
          { project: projectKey(world.repo), subject: "Finish the test", parentId: phase.id },
          WHO,
          NOW,
        ).ok,
      ).toBe(true);
    } finally {
      db.close();
    }
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      world.record.id,
      { state },
      NOW + 1,
      "ended",
    );
    const read = crewPhaseState(world.paths, projectKey(world.repo), world.record.id);
    expect(read.state).toBe("ready");
    if (read.state !== "ready") throw new Error("no phase task");
    expect(read.value.phase?.status).toBe(outcome);
    expect(read.value.openSubtasks).toEqual([]);
    expect(read.value.total).toBe(1);
  },
);
