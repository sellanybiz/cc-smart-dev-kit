/**
 * `crew watch` (`watch.ts`): the lead's window on its crew. One line per change, the
 * queued crew sessions started when a place frees, and the crew ended per D35 (a crew session never
 * outlives its work).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordUsageWindow } from "../cli/usage-window";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { projectFolderName } from "../sessions/saved-sessions";
import { crewWorld, LEAD_SESSION, OTHER_SESSION, writeSessionRecord } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { resolveWorkflow } from "../workflow/resolve";
import { runCrew } from "./command";
import {
  appendCrewEvent,
  type CrewRecord,
  createCrew,
  crewMcpFile,
  crewSettingsFile,
  eventsEndOffset,
  listCrew,
  readCrew,
  readWatchState,
  updateCrew,
  type WatchState,
  writeLead,
  writeStoreFile,
} from "./store";
import type { GatewayNow } from "./wait";
import { eventLine, type WatchScope, watchPass } from "./watch";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "C my-app B6b portal-live";

/** A world with a lead and no crew session. */
async function leadWorld() {
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
  return world;
}

/** A crew session of `state`, with the fields the watch reads. */
async function addCrew(
  world: Awaited<ReturnType<typeof leadWorld>>,
  state: string,
  changes: Partial<CrewRecord> = {},
): Promise<CrewRecord> {
  return await createCrew(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
      effort: "high",
      files: [],
      id: ID,
      kind: "build",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: NAME,
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
      ...changes,
    },
    T0,
  );
}

/** The id of the queued crew session the helper below records. */
const QUEUED_ID = "B6b-portal-live-1a2b3c";

/**
 * A crew session that waits in the queue: recorded, with its brief and settings files in the store (a
 * start writes them before it queues), no session and no base yet.
 */
async function queuedCrew(
  world: Awaited<ReturnType<typeof leadWorld>>,
  changes: Partial<CrewRecord> = {},
): Promise<CrewRecord> {
  const record = await addCrew(world, "queued", {
    base: null,
    id: QUEUED_ID,
    sessionId: null,
    shortId: null,
    ...changes,
  });
  const { writeStoreFile, crewBriefFile, crewSettingsFile } = await import("./store");
  writeStoreFile(crewBriefFile(world.paths.stateDir, world.repo, record.id), "Do the phase.\n");
  writeStoreFile(crewSettingsFile(world.paths.stateDir, world.repo, record.id), "{}\n");
  return record;
}

/** The agent view the fake `claude agents --json` prints. */
function agentsJson(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(rows);
}

/**
 * A real background program in `cwd`, as a crew session's own check outlives its turn: the
 * removal signals this test's own child, never a process the test did not start.
 */
function startProgram(cwd: string): Bun.Subprocess {
  return Bun.spawn(["sh", "-c", "sleep 60"], { cwd, stderr: "ignore", stdout: "ignore" });
}

/** One row for the crew session of the world. */
function agentRowOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "aaaa1111",
    sessionId: "aaaa1111-2222-3333-4444-555555555555",
    cwd: "/w",
    kind: "background",
    state: "working",
    status: "busy",
    pid: 4242,
    ...over,
  };
}

describe("crew watch", () => {
  test("D55: a note from another lead, a file clash and a merge are one line each", () => {
    const base = {
      at: "2026-10-21T10:00:00.000Z",
      crew: "x",
      lead: null,
      name: "LEAD my-app alpha",
      state: "working" as const,
      version: 1,
    };
    expect(
      eventLine(
        {
          ...base,
          tell: { kind: "question", to: ["LEAD my-app beta"] },
          text: "does your branch take the merge?",
          type: "lead-tell",
        },
        null,
        [],
        false,
      ),
    ).toBe("LEAD my-app alpha: question from another lead · does your branch take the merge?");
    // A clash and a merge carry their whole line, written where it happened.
    expect(
      eventLine(
        {
          ...base,
          text: "clash: C a (LEAD b) may change src/a.ts — not blocked",
          type: "clash",
        },
        null,
        [],
        false,
      ),
    ).toBe("clash: C a (LEAD b) may change src/a.ts — not blocked");
    expect(
      eventLine({ ...base, text: "LEAD b merged #7 into main", type: "merge" }, null, [], false),
    ).toBe("LEAD b merged #7 into main");
  });

  test("D25: one line per change, from the store's events log", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "tests-green",
        type: "step",
        crew: ID,
      },
      T0,
    );
    const code = await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: tests-green"]);
  });

  test("two leads of one repo: each lead's watch reads its own crew only, with no --lead", async () => {
    const world = await leadWorld();
    // A second lead of this repository, and a session record for the process above this command:
    // the monitor runs under the lead's own session, which is how the watch knows whose crew to read.
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app other-plan",
        plan: "other-plan",
        repo: world.repo,
        sessionId: OTHER_SESSION,
        tag: "my-app",
      },
      T0,
    );
    writeSessionRecord(world.paths, 700, OTHER_SESSION, world.repo);
    await addCrew(world, "working");
    await addCrew(world, "working", {
      id: "B7-api-2b3c4d",
      name: "C my-app B7 api",
      phase: "B7",
      sessionId: "b2c3d4e5-0000-1111-2222-333333333333",
      shortId: "b2c3d4e5",
      slug: "api",
      leadSessionId: OTHER_SESSION,
    });
    for (const [crew, lead, text] of [
      [ID, LEAD_SESSION, "the alpha lead's step"],
      ["B7-api-2b3c4d", OTHER_SESSION, "the beta lead's step"],
    ] as const) {
      await appendCrewEvent(
        world.paths.stateDir,
        world.repo,
        {
          crew,
          lead,
          name: crew === ID ? NAME : "C my-app B7 api",
          state: "working",
          text,
          type: "step",
        },
        T0,
      );
    }
    // The command runs under the second lead's session (pid 700 above pid 500).
    const underBeta = world.ctx({
      processes: {
        commandLineOf: (pid) => (pid === 700 ? "claude --bg" : null),
        parentOf: (pid) => ({ 300: 1, 400: 300, 500: 700, 700: 1 })[pid] ?? null,
      },
    });
    expect(await runCrew(["watch", "--once", "--timeout", "0"], underBeta)).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual(["C my-app B7 api: the beta lead's step"]);
    // And the other one under the first lead's session: its own crew only.
    world.out.length = 0;
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: the alpha lead's step"]);
  });

  test("D55: the person's line says whose word it was, and what the lead does with it", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        crew: ID,
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "stop after the guard, I only need the config change",
        type: "person",
      },
      T0,
    );
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "C my-app B6b portal-live: the person wrote · stop after the guard, I only need the config change · read its next report against the brief before the merge",
    ]);
  });

  test("D25: --once twice prints nothing the second time", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "tests-green",
        type: "step",
        crew: ID,
      },
      T0,
    );
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    world.out.length = 0;
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual([]);
    expect(
      readWatchState(world.paths.stateDir, world.repo, LEAD_SESSION)?.offset ?? 0,
    ).toBeGreaterThan(0);
  });

  test("D25: --once waits for the next change, and --timeout bounds the wait", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    // Nothing to say yet: the wait ends when the timeout is up, with no line.
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual([]);
    // A change ends it at once.
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "committed",
        type: "step",
        crew: ID,
      },
      T0,
    );
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: committed"]);
  });

  test("D25: a question is one line, and it says how to answer it", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "which port?",
        type: "question",
        crew: ID,
      },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      'C my-app B6b portal-live: question · which port? · answer it: crew answer "C my-app B6b portal-live" "<text>"',
    ]);
  });

  test("D47: a note a crew session told another is one line for the lead", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        crew: ID,
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        tell: { kind: "contract", to: ["C my-app B2 api"] },
        text: "[B6b] CONTRACT: x.ts:lookup is gone",
        type: "tell",
      },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      "C my-app B6b portal-live: told C my-app B2 api · contract · [B6b] CONTRACT: x.ts:lookup is gone",
    ]);
  });

  test("D25: a report is one line, with the review, the phases it unblocks and the report", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "working");
    // Another crew session of this lead waits for this phase.
    await createCrew(
      world.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: "crew/B6c-other",
        effort: "high",
        files: [],
        id: "B6c-other-999999",
        kind: "build",
        lastLine: null,
        leadName: "LEAD my-app master-plan",
        leadSessionId: LEAD_SESSION,
        memoryMb: null,
        model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        name: "C my-app B6c other",
        permissionMode: "auto",
        phase: "B6c",
        plan: "master-plan",
        pr: null,
        questions: [],
        repo: world.repo,
        reportPath: null,
        sessionId: null,
        shortId: null,
        slug: "other",
        state: "queued",
        waitsFor: ["B6b"],
        worktree: join(world.repo, ".claude", "worktrees", "crew-B6c-other"),
      },
      T0,
    );
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: record.name,
        state: "done",
        text: "done",
        type: "report",
        crew: record.id,
      },
      T0,
    );
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { reportPath: "/state/reports/B6b.json" },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      "C my-app B6b portal-live: done · review ✗ · unblocks B6c · report /state/reports/B6b.json",
    ]);
  });

  test("D25: a state change is its own line", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      ID,
      { state: "blocked" },
      T0,
      "it asked a question",
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual(["C my-app B6b portal-live: blocked — it asked a question"]);
  });

  test("D25: a crew session that waits for the person is one line", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const code = await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx(
        {},
        {
          FAKE_AGENTS_JSON: agentsJson([
            agentRowOf({ state: "blocked", status: "waiting", waitingFor: "permission prompt" }),
          ]),
        },
      ),
    );
    expect(code).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: needs you — permission prompt"]);
  });

  test("D25: a crew session that crashed is one line, and it no longer holds a place", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "failed" })]) }),
    );
    // One line, from the state event: the session is dead, so nothing is stopped.
    expect(world.out).toEqual(["C my-app B6b portal-live: failed — its session failed"]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("failed");
  });

  test("D35: a session the person stopped by hand is recorded stopped, and frees its place", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "stopped" })]) }),
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: stopped — its session was stopped"]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("stopped");
  });

  test("D25: a crew session whose turn ended with no report is one alert, said once", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "done" })]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual(["C my-app B6b portal-live: ended its turn with no report"]);
    // An alert, never an action; and said once while it lasts.
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
  });

  test("D25: a crew session that reported blocked and waits is no alert, whatever agent view says", async () => {
    const world = await leadWorld();
    await addCrew(world, "blocked");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "done" })]) }),
    );
    expect(world.out).toEqual([]);
  });

  test("D25: a crew session that writes nothing is one quiet line, and no action", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    // The crew session's transcript was last written two hours ago.
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    mkdirSync(worktree, { recursive: true });
    const folder = join(world.paths.projectsDir, projectFolderName(worktree));
    mkdirSync(folder, { recursive: true });
    const transcript = join(folder, "aaaa1111-2222-3333-4444-555555555555.jsonl");
    writeFileSync(transcript, "{}\n");
    const old = new Date(T0 - 2 * 3_600_000);
    utimesSync(transcript, old, old);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual([
      "C my-app B6b portal-live: quiet — nothing written for 120 minutes",
    ]);
    // An alert, never an action: no session is stopped.
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
  });

  test("D35: a crew session whose turn ended is stopped once, and the record keeps done", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([
      "C my-app B6b portal-live: its session stopped — its turn ended; the record stays done",
    ]);
    const calls = world.claudeCalls();
    expect(calls).toContainEqual(["stop", "aaaa1111"]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    // D62: `stopped` means something stopped a crew session before its phase was over; a done
    // record keeps its outcome, so the watch can still remove it once the lead merges.
    expect(record?.state).toBe("done");
    // A pass while agent view still lists the session stops it no second time, and says nothing.
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(1);
  });

  test("H101: a failed crew session's session is stopped once, and the record stays failed", async () => {
    // The crew session's own SessionStart hook marked it failed (its folder was not its
    // worktree, src/hooks/crew-role.ts): the watch is what ends its session (D35), and the
    // board must keep showing the failure, not a stop that hides it.
    const world = await leadWorld();
    await addCrew(world, "failed");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([
      "C my-app B6b portal-live: its session stopped — it failed; the record stays failed",
    ]);
    expect(world.claudeCalls()).toContainEqual(["stop", "aaaa1111"]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("failed");
    // A pass while agent view still lists the session stops it no second time, and says nothing.
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(1);
  });

  test("H101: a starting crew session that never confirms its worktree is one alert, said once", async () => {
    // Its SessionStart hook never turned the record `working`: it may have crashed, been
    // silenced by ownHooks, or run outside git. Ten minutes on, the lead hears it once.
    const world = await leadWorld();
    await addCrew(world, "starting", {
      startedAt: new Date(T0 - 10 * 60_000).toISOString(),
    });
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([
      "C my-app B6b portal-live: never confirmed its worktree — its session runs, but its own start hook has not recorded it in the worktree (it may have crashed, be silenced by ownHooks, or run outside git)",
    ]);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    // An alert, never an action: the record is left as it is, and no session is stopped.
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("starting");
  });

  test("H101: a starting crew session within the confirm window is no alert", async () => {
    const world = await leadWorld();
    await addCrew(world, "starting", { startedAt: new Date(T0 - 60_000).toISOString() });
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual([]);
  });

  test("H101: a starting crew session whose session died is failed, and it frees its place", async () => {
    // It never reached its SessionStart hook (that is where a crew session checks its folder):
    // the watch's own store-truth rule reads agent view and fails the record.
    const world = await leadWorld();
    await addCrew(world, "starting");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "failed" })]) }),
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: failed — its session failed"]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("failed");
  });

  test("D35: a session the store does not record is never stopped", async () => {
    const world = await leadWorld();
    // No crew session in the store, but agent view lists a session.
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
  });

  test("D35: a blocked crew session idle past the limit is stopped", async () => {
    const world = await leadWorld();
    await addCrew(world, "blocked");
    // The crew session's record says it was last changed 30 minutes ago.
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      ID,
      {},
      T0 - 30 * 60_000,
      "asked a question",
    );
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out[0]).toContain("stopped");
    expect(world.out[0]).toContain("blocked for 30 minutes");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("stopped");
  });

  test("D35: a branch the lead merged is removed by the watch's next pass", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    // The crew session's branch is merged into the main checkout's branch.
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — the lead merged its branch; the watch removes it",
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test("D35: a branch the lead squash-merged is removed too", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    // A squash merge leaves no ancestor: the branch's commit is not on the lead's branch.
    git(world.repo, "merge", "--squash", "-q", "crew/B6b-portal-live");
    git(world.repo, "commit", "-q", "-m", "the phase, squashed");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — the lead merged its branch; the watch removes it",
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test("D62: the watch finishes a removal that stopped halfway, its record still there", async () => {
    const world = await leadWorld();
    await addCrew(world, "stopped");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    // What `removeWorktree` leaves when git cannot remove the folder it moved aside.
    const parked = `${worktree}-removing-1234`;
    git(world.repo, "worktree", "move", worktree, parked);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    expect(existsSync(parked)).toBe(false);
    expect(git(world.repo, "worktree", "list")).not.toContain("-removing-");
    // The record is untouched: a stopped one is the lead's call (D62).
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("stopped");
  });

  test("D62: the watch finishes a removal that stopped halfway with no record at all", async () => {
    const world = await leadWorld();
    // A remote, so the watch has a base for a folder no record names.
    const origin = join(tempDir("origin"), "origin.git");
    mkdirSync(origin);
    git(origin, "init", "--bare", "--initial-branch=main", "-q");
    git(world.repo, "remote", "add", "origin", origin);
    git(world.repo, "push", "-q", "-u", "origin", "main");
    git(world.repo, "remote", "set-head", "origin", "--auto");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-ghost");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/ghost", worktree);
    const parked = `${worktree}-removing-1234`;
    git(world.repo, "worktree", "move", worktree, parked);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    expect(existsSync(parked)).toBe(false);
    expect(git(world.repo, "worktree", "list")).not.toContain("-removing-");
  });

  test("D62: a merged one whose own stopped session left a check running is removed after it is stopped", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    const check = startProgram(worktree);
    try {
      const ctx = world.ctx({
        scanFacts: {
          containers: [],
          programs: [
            {
              parentPid: 1,
              path: join(worktree, "check.sh"),
              pid: check.pid,
              // Started before the turn ended (the record's own time): this session left it.
              startedAt: T0 - 60_000,
            },
          ],
          sessions: [],
        },
      });
      await runCrew(["watch", "--once", "--timeout", "0"], ctx);
      expect(world.out).toContain(
        "C my-app B6b portal-live: stopped its own leftover programs (check.sh)",
      );
      const [record] = listCrew(world.paths.stateDir, world.repo).records;
      expect(record?.state).toBe("removed");
      expect(existsSync(worktree)).toBe(false);
    } finally {
      if (check.exitCode === null) check.kill("SIGKILL");
    }
  });

  test("D62: a merged one with a program someone else started there is kept, with one line said once", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    const server = startProgram(worktree);
    try {
      const ctx = world.ctx({
        scanFacts: {
          containers: [],
          programs: [
            {
              cwd: worktree,
              path: "/usr/bin/bun dev",
              pid: server.pid,
              // Started after the turn ended: the person's dev server, not the session's.
              startedAt: T0 + 60_000,
            },
          ],
          sessions: [],
        },
      });
      await runCrew(["watch", "--once", "--timeout", "0"], ctx);
      expect(world.out).toContain(
        "crew rm: .claude/worktrees/crew-B6b-portal-live is kept: a program runs from its files: bun",
      );
      const [record] = listCrew(world.paths.stateDir, world.repo).records;
      expect(record?.state).toBe("merged");
      expect(existsSync(worktree)).toBe(true);
      expect(server.exitCode).toBeNull();
      // The refusal is said once, not on every pass.
      world.out.length = 0;
      await runCrew(["watch", "--once", "--timeout", "0"], ctx);
      expect(world.out).toEqual([]);
    } finally {
      server.kill("SIGKILL");
    }
  });

  test("D35: a merged one with uncommitted work is kept, with one line said once", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    writeFileSync(join(worktree, "uncommitted.txt"), "y\n");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — the lead merged its branch; the watch removes it",
    );
    expect(world.out.some((line) => line.includes("changes that are not committed"))).toBe(true);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
    expect(existsSync(worktree)).toBe(true);
    world.out.length = 0;
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual([]);
  });

  test("D35: a merged one with a queued continuation is kept until that continuation starts", async () => {
    const world = await leadWorld();
    const original = await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    const continuation = await addCrew(world, "queued", {
      base: null,
      branch: "crew/B6b-portal-live-2",
      continues: original.id,
      id: "B6b-portal-live-2-1a2b3c",
      name: "C my-app B6b portal-live 2",
      sessionId: null,
      shortId: null,
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live-2"),
    });
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — waiting for its continuation C my-app B6b portal-live 2 to start",
    );
    const [kept] = listCrew(world.paths.stateDir, world.repo).records;
    expect(kept?.state).toBe("merged");
    expect(existsSync(worktree)).toBe(true);
    // The waiting line is said once.
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).not.toContain("waiting for its continuation");
    // The continuation starts: the branch was cut from it, so the original goes.
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      continuation.id,
      { state: "working" },
      T0 + 1000,
      "started",
    );
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    const [gone] = listCrew(world.paths.stateDir, world.repo).records;
    expect(gone?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test("D62: a handoff is removed once its continuation's work is merged", async () => {
    const world = await leadWorld();
    const original = await addCrew(world, "handoff");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "part-one.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "part one");
    const originalHead = git(worktree, "rev-parse", "HEAD").trim();
    // Its continuation, cut from the hand-off's branch as `crew start --continue` cuts it.
    const nextWorktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live-2");
    await addCrew(world, "working", {
      base: { ref: "crew/B6b-portal-live", sha: originalHead },
      baseRef: "crew/B6b-portal-live",
      branch: "crew/B6b-portal-live-2",
      continues: original.id,
      id: "B6b-portal-live-2-1a2b3c",
      name: "C my-app B6b portal-live 2",
      worktree: nextWorktree,
    });
    git(
      world.repo,
      "worktree",
      "add",
      "-q",
      "-b",
      "crew/B6b-portal-live-2",
      nextWorktree,
      "crew/B6b-portal-live",
    );
    writeFileSync(join(nextWorktree, "part-two.txt"), "y\n");
    git(nextWorktree, "add", ".");
    git(nextWorktree, "commit", "-q", "-m", "part two");
    const ctx = world.ctx();
    // Nothing is merged yet: the hand-off stays, and so does its branch.
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    const stateOf = (id: string) =>
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === id)?.state;
    expect(stateOf(original.id)).toBe("handoff");
    expect(existsSync(worktree)).toBe(true);
    // The lead merges the continuation: the hand-off's own commits are on the base through it.
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live-2");
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — the lead merged its branch; the watch removes it",
    );
    expect(stateOf(original.id)).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test("D35: a branch with no commit of its own is never reported merged", async () => {
    const world = await leadWorld();
    // A crew session that failed before it committed: its branch is its base, which is an ancestor of
    // the lead's branch for that reason alone.
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    await addCrew(world, "failed");
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("failed");
  });

  test("D35: the merge is looked for on the record's own base, not the lead's folder", async () => {
    const world = await leadWorld();
    // The lead works in a linked worktree on its own branch; the main checkout stays on main.
    const leadFolder = join(world.repo, ".claude", "worktrees", "lead-folder");
    git(world.repo, "worktree", "add", "-q", "-b", "lead-branch", leadFolder);
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(leadFolder, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    await addCrew(world, "done");
    await writeLead(
      world.paths.stateDir,
      {
        cwd: leadFolder,
        name: "LEAD my-app master-plan",
        plan: "master-plan",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app",
      },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    // The base is main, which does not hold the branch: the lead's folder is not the judge.
    expect(world.out).toEqual([]);
    expect(git(world.repo, "branch", "--merged", "main")).not.toContain("crew/B6b-portal-live");
  });

  test("D35: a stop that fails is said once, not on every pass", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]), FAKE_STOP: "fail" });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([
      "C my-app B6b portal-live: not stopped — claude stop aaaa1111 failed",
    ]);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    // The crew session is not recorded stopped: it still has a session to stop.
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("done");
  });

  test("D35: a session that is already stopped is not stopped again", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf({ state: "stopped" })]) }),
    );
    expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(0);
  });

  test("D25: --once waits, polling, until something changes", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const polls: number[] = [];
    const ctx = world.ctx({
      sleep: async (ms: number) => {
        polls.push(ms);
        await appendCrewEvent(
          world.paths.stateDir,
          world.repo,
          {
            lead: LEAD_SESSION,
            name: NAME,
            state: "working",
            text: "committed",
            type: "step",
            crew: ID,
          },
          T0,
        );
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(polls).toEqual([20_000]);
    expect(world.out).toEqual(["C my-app B6b portal-live: committed"]);
  });

  test("D25: a step line carries its commit and its note", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        note: "the new test fails without the fix",
        sha: "abcdef0123456789abcdef0123456789abcdef01",
        state: "working",
        text: "tests-red",
        type: "step",
        crew: ID,
      },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      "C my-app B6b portal-live: tests-red · abcdef0 · the new test fails without the fix",
    ]);
  });

  test("D22: a blocked report says what it waits on; a failed one says why", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const { recordCrewReport } = await import("./store");
    const sha = git(world.repo, "rev-parse", "HEAD").trim();
    const report = (status: "blocked" | "failed", rest: Record<string, unknown>) => ({
      base: { ref: "main", sha },
      branch: { name: "crew/B6b-portal-live", sha },
      changed: { deletions: 0, files: 0, insertions: 0 },
      checks: [],
      docs: [],
      needsLead: [],
      open: [],
      outsideBrief: [],
      phase: "B6b",
      pr: null,
      question: null,
      review: null,
      status,
      tests: { full: null, targeted: [] },
      version: 1,
      ...rest,
    });
    const { reportPath } = {
      reportPath: (
        await recordCrewReport(
          world.paths.stateDir,
          world.repo,
          ID,
          report("blocked", { question: "which port does the portal use?" }),
          T0,
        )
      ).file,
    };
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      `C my-app B6b portal-live: blocked · waits on: which port does the portal use? · report ${reportPath}`,
    ]);
    world.out.length = 0;
    await recordCrewReport(
      world.paths.stateDir,
      world.repo,
      ID,
      report("failed", { summary: "the build tool is not installed\nsecond line" }),
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      `C my-app B6b portal-live: failed · why: the build tool is not installed · report ${reportPath}`,
    ]);
  });

  test("D62: a stopped crew session is never marked merged or removed by the watch", async () => {
    const world = await leadWorld();
    await addCrew(world, "stopped");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    const ctx = world.ctx();
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    // The lead's call: neither the mark nor the removal happens, and nothing is said.
    expect(world.out).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("stopped");
    expect(existsSync(worktree)).toBe(true);
  });

  test("D25: a queued crew session starts when a place frees, and its start is one line", async () => {
    const world = await leadWorld();
    world.writeConfig({ max: 1 });
    await queuedCrew(world);
    const code = await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // One line, from the state event the launch writes: not the launcher's line as well. The
    // crew session is `starting`: its own SessionStart hook says when it is in its worktree.
    expect(world.out).toEqual(["C my-app B6b portal-live: starting — started from the queue"]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("starting");
    expect(record?.sessionId).toBe("a1b2c3d4-0000-1111-2222-333333333333");
    expect(record?.startedAt).toBe("2026-10-21T10:00:00.000Z");
    expect(record?.base?.ref).toBe("main");
    const bg = world.claudeCalls().find((call) => call[0] === "--bg");
    expect(bg?.slice(0, 4)).toEqual(["--bg", "-w", "crew-B6b-portal-live", "--name"]);
  });

  test("D37: a queued crew session stays queued, and silent, while the cap is full", async () => {
    const world = await leadWorld();
    world.writeConfig({ max: 1 });
    await addCrew(world, "working", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      shortId: "bbbb2222",
      sessionId: "bbbb2222-2222-3333-4444-555555555555",
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
    await queuedCrew(world);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx(
        {},
        {
          FAKE_AGENTS_JSON: agentsJson([
            agentRowOf({ id: "bbbb2222", sessionId: "bbbb2222-2222-3333-4444-555555555555" }),
          ]),
        },
      ),
    );
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    const queued = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === QUEUED_ID,
    );
    expect(queued?.state).toBe("queued");
  });

  test("D54: a queued opus crew session waits past 85% of the 5-hour window, and starts under it", async () => {
    const world = await leadWorld();
    recordUsageWindow(
      world.paths,
      { rate_limits: { five_hour: { resets_at: T0 / 1000 + 3600, used_percentage: 90 } } },
      T0,
    );
    await queuedCrew(world, {
      model: { named: "opus", resolved: "opus", slot: null, tier: "opus" },
    });
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === QUEUED_ID)?.state,
    ).toBe("queued");
    // The share drops under the setting: the next pass starts the same crew session.
    recordUsageWindow(
      world.paths,
      { rate_limits: { five_hour: { resets_at: T0 / 1000 + 3600, used_percentage: 80 } } },
      T0 + 1000,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([`${NAME}: starting — started from the queue`]);
    expect(
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === QUEUED_ID)?.state,
    ).toBe("starting");
  });

  test("D54: the watch keeps a queued crew session back at its lead's cap", async () => {
    const world = await leadWorld();
    world.writeConfig({ perLead: 1 });
    await addCrew(world, "working", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      shortId: "bbbb2222",
      sessionId: "bbbb2222-2222-3333-4444-555555555555",
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
    await queuedCrew(world);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx(
        {},
        {
          FAKE_AGENTS_JSON: agentsJson([
            agentRowOf({ id: "bbbb2222", sessionId: "bbbb2222-2222-3333-4444-555555555555" }),
          ]),
        },
      ),
    );
    expect(world.out).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === QUEUED_ID)?.state,
    ).toBe("queued");
  });

  /** A working crew session of another phase, holding one place. */
  async function holderCrew(world: Awaited<ReturnType<typeof leadWorld>>) {
    return await addCrew(world, "working", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      shortId: "bbbb2222",
      sessionId: "bbbb2222-2222-3333-4444-555555555555",
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
  }

  /** A step event of the lead's crew session, so a pass that says it ends a `--once`. */
  async function stepEvent(world: Awaited<ReturnType<typeof leadWorld>>): Promise<void> {
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: NAME,
        state: "working",
        text: "committed",
        type: "step",
        crew: ID,
      },
      T0,
    );
  }

  /** The state of the queued crew session of the world. */
  function queuedState(world: Awaited<ReturnType<typeof leadWorld>>): string | undefined {
    return listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === QUEUED_ID)
      ?.state;
  }

  test("D60: a cap the person lowers reaches the next pass of the same watch", async () => {
    // The watch read the workflow once, before its loop, and passed that value to every pass:
    // on 2026-10-23 the owner set `crew.max 16` (the CPU was 5x overloaded) and every lead's
    // watch went on starting queued phases up to the old 24. A cap is the person's answer to
    // what the machine can take, so each pass reads it again.
    const world = await leadWorld();
    world.writeConfig({ max: 2 });
    await holderCrew(world);
    const queued = await queuedCrew(world, { waitsFor: ["B6a"] });
    const ctx = world.ctx({
      sleep: async () => {
        // Between two passes the wait clears and the cap drops to what already runs: the
        // second pass must start nothing. On the value read once, it would start on max 2.
        world.writeConfig({ max: 1 });
        await updateCrew(world.paths.stateDir, world.repo, queued.id, { waitsFor: [] }, T0);
        await stepEvent(world);
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(queuedState(world)).toBe("queued");
    // The step is what ended it: the watch ran a second pass.
    expect(world.out).toEqual([`${NAME}: committed`]);
  });

  test("D60: a cap the person raises reaches the next pass of the same watch", async () => {
    // The other way round, and the same rule: a value that was read is never kept past a
    // successful read — the second pass starts the queued crew session on the new cap.
    const world = await leadWorld();
    world.writeConfig({ max: 1 });
    await holderCrew(world);
    const queued = await queuedCrew(world, { waitsFor: ["B6a"] });
    const ctx = world.ctx({
      sleep: async () => {
        world.writeConfig({ max: 2 });
        await updateCrew(world.paths.stateDir, world.repo, queued.id, { waitsFor: [] }, T0);
        // A line for the second pass to say either way, so the `--once` ends on it: what is
        // asserted is the start itself, not the line.
        await stepEvent(world);
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    expect(queuedState(world)).toBe("starting");
    expect(world.out).toEqual([`${NAME}: committed`, `${NAME}: starting — started from the queue`]);
  });

  test("D60: a workflow that cannot be read keeps the last good caps, and says so once", async () => {
    // A project file broken while a lead's watch runs must not stop the watch, and must not
    // quietly widen the caps either: the last good value stands for that pass, one line says
    // what happened, and a later pass that fails the same way says nothing more.
    const world = await leadWorld();
    world.writeConfig({ max: 1 });
    await holderCrew(world);
    const queued = await queuedCrew(world, { waitsFor: ["B6a"] });
    let passes = 0;
    const ctx = world.ctx({
      sleep: async () => {
        passes += 1;
        if (passes > 1) {
          await stepEvent(world);
          return;
        }
        writeFileSync(join(world.repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
        // The wait clears as well: only the cap that was read and kept holds it back now.
        await updateCrew(world.paths.stateDir, world.repo, queued.id, { waitsFor: [] }, T0);
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(world.err.length).toBe(1);
    expect(world.err[0]).toStartWith("crew watch: ");
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(queuedState(world)).toBe("queued");
    expect(world.out).toEqual([`${NAME}: committed`]);
  });

  test("D60: a failed read is said once, and a good read starts saying it again", async () => {
    // One line per run of failures: a watch whose file is broken for an hour does not repeat
    // itself on every pass, and a file that reads again clears the mark — a later failure is
    // news again, not something the watch has already said.
    const world = await leadWorld();
    world.writeConfig({ max: 2 });
    await holderCrew(world);
    await queuedCrew(world, { waitsFor: ["B6a"] });
    const configFile = join(world.repo, ".claude", "cc-smart-dev-kit.json");
    let passes = 0;
    const ctx = world.ctx({
      sleep: async () => {
        passes += 1;
        if (passes === 1) {
          writeFileSync(configFile, "{ not json");
          return;
        }
        if (passes === 2) {
          // The person fixed it: the next pass reads the workflow again and says nothing more.
          world.writeConfig({ max: 2 });
          return;
        }
        writeFileSync(configFile, "{ not json");
        await stepEvent(world);
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(world.err.length).toBe(2);
    expect(world.err[0]).toStartWith("crew watch: ");
    expect(world.err[1]).toStartWith("crew watch: ");
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(queuedState(world)).toBe("queued");
    expect(world.out).toEqual([`${NAME}: committed`]);
  });

  test("D60: the person's own switch, turned off mid-run, starts nothing", async () => {
    // `readCaller` refuses the same way for a file it cannot use and for the switch the person
    // owns (`crew.enabled` off; a session in bypass mode). Neither is a reason to start a crew
    // session on a cap nobody could read: the pass says what happened, once, and holds the queue.
    const world = await leadWorld();
    world.writeConfig({ max: 2 });
    await holderCrew(world);
    const queued = await queuedCrew(world, { waitsFor: ["B6a"] });
    let passes = 0;
    const ctx = world.ctx({
      sleep: async () => {
        passes += 1;
        if (passes > 1) {
          await stepEvent(world);
          return;
        }
        // Crew sessions are turned off, and the wait clears: only the switch holds it back now.
        world.writeConfig({ enabled: false, max: 2 });
        await updateCrew(world.paths.stateDir, world.repo, queued.id, { waitsFor: [] }, T0);
      },
    });
    expect(await runCrew(["watch", "--once"], ctx)).toBe(0);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(queuedState(world)).toBe("queued");
    expect(world.err).toEqual([
      "crew watch: crew sessions are off in this project: turn them on with workflow.crew.enabled",
      "Fix: cc-smart-dev-kit workflow set crew.enabled true --project (this project), or the same without --project (every project of yours)",
    ]);
    expect(world.out).toEqual([`${NAME}: committed`]);
  });

  test("D25: a queued crew session waits for the merge of its phase, not for its report", async () => {
    const world = await leadWorld();
    const first = await addCrew(world, "done", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      shortId: "bbbb2222",
      sessionId: "bbbb2222-2222-3333-4444-555555555555",
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
    await queuedCrew(world, { waitsFor: ["B6a"] });
    // `done` is a crew session's word; the lead has not merged it, so the next phase would branch
    // without its work.
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, first.id, { state: "merged" }, T0);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    expect(world.out).toContain("C my-app B6b portal-live: starting — started from the queue");
  });

  test("F3: a phase removed before its work was merged holds its dependent, and the lead is told once", async () => {
    const world = await leadWorld();
    // B6a's crew session was removed with nothing merged: `crew rm` removes a queued or failed
    // phase too, and that removal proves nothing about the work.
    await addCrew(world, "removed", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      sessionId: null,
      shortId: null,
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
    await queuedCrew(world, { waitsFor: ["B6a"] });

    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(world.out).toEqual([
      'C my-app B6b portal-live: still waits for B6a (C my-app B6a x was removed before its work was merged); it will not start by itself — to drop the wait: cc-smart-dev-kit crew rm "C my-app B6b portal-live", then start B6b again',
    ]);
    const queued = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === QUEUED_ID,
    );
    expect(queued?.state).toBe("queued");

    // Once, not on every pass.
    world.out.length = 0;
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual([]);
  });

  test("F3: a phase removed after the lead merged it releases the crew session that waits for it", async () => {
    const world = await leadWorld();
    const first = await addCrew(world, "merged", {
      branch: "crew/B6a-x",
      id: "B6a-x-111111",
      name: "C my-app B6a x",
      phase: "B6a",
      sessionId: null,
      shortId: null,
      slug: "x",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6a-x"),
    });
    const { updateCrew } = await import("./store");
    // `crew rm` marks it removed; the store keeps that it was merged before the removal.
    await updateCrew(world.paths.stateDir, world.repo, first.id, { state: "removed" }, T0);
    expect(
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === first.id),
    ).toMatchObject({ mergedBeforeRemoval: true, state: "removed" });
    await queuedCrew(world, { waitsFor: ["B6a"] });

    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    expect(world.out).toContain("C my-app B6b portal-live: starting — started from the queue");
  });

  test("D25: a queued next crew session of a hand-off is launched in its own numbered worktree", async () => {
    const world = await leadWorld();
    await queuedCrew(world, {
      branch: "crew/B6b-portal-live-2",
      id: "B6b-portal-live-9f8e7d",
      name: "C my-app B6b portal-live 2",
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live-2"),
    });
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    const bg = world.claudeCalls().find((call) => call[0] === "--bg");
    // The folder claude is asked to open is the record's own, never one worked out again.
    expect(bg?.slice(0, 5)).toEqual([
      "--bg",
      "-w",
      "crew-B6b-portal-live-2",
      "--name",
      "C my-app B6b portal-live 2",
    ]);
  });

  test("D25: a queued crew session whose base is gone fails, and the line says why", async () => {
    const world = await leadWorld();
    await queuedCrew(world, { baseRef: "a-branch-that-was-deleted" });
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([
      "C my-app B6b portal-live: failed — the base a-branch-that-was-deleted is no commit here",
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    const queued = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === QUEUED_ID,
    );
    expect(queued?.state).toBe("failed");
  });

  test("D25: where the monitors do not run, the watch says so once", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { DISABLE_TELEMETRY: "1" });
    expect(await runCrew(["watch", "--once", "--timeout", "0"], ctx)).toBe(0);
    expect(world.out).toContain(
      "the plugin's monitors do not run on this machine (telemetry is off), so run this watch again after each event",
    );
    // Once, not on every pass.
    world.out.length = 0;
    expect(await runCrew(["watch", "--once", "--timeout", "0"], ctx)).toBe(0);
    expect(world.out).toEqual([]);
  });

  test("D25: a watch from outside a lead's session is refused", async () => {
    const world = await leadWorld();
    const code = await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("never watches");
  });
});

describe("D42: the watch resumes a paused crew session", () => {
  const MINUTE = 60_000;
  const WORKER = "cc-smart-dev-kit-worker";
  const SLOT_WAIT = { kind: "slot", since: "2026-10-21T09:50:00.000Z", slot: WORKER } as const;

  /** The workflow settings the watch reads, as `crew watch` itself resolves them. */
  function resolvedOf(world: Awaited<ReturnType<typeof leadWorld>>): ResolvedWorkflow {
    const env = world.ctx().env;
    const checkout = locateCheckout(world.repo, { env });
    if (checkout === null) throw new Error("the world's repo is not a checkout");
    return resolveWorkflow(world.paths, loadProjectConfig(checkout).config);
  }

  /** A paused crew session of the lead, on the worker slot, waiting out its breaker. */
  async function pausedCrew(
    world: Awaited<ReturnType<typeof leadWorld>>,
    change: Partial<CrewRecord> = {},
  ): Promise<CrewRecord> {
    const record = await addCrew(world, "paused", {
      lastPause: { backoffMs: 0, since: "2026-10-21T09:50:00.000Z" },
      // The session agent view lists, so a message reaches it (the fake `claude`'s row).
      sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
      shortId: "a1b2c3d4",
      model: {
        named: "sonnet",
        resolved: "claude-sonnet-5-5",
        slot: WORKER,
        tier: null,
      },
      waitingFor: SLOT_WAIT,
      ...change,
    });
    // Its worktree is there: a resume runs in it, and one with no folder is refused. Its own
    // settings and MCP files are there too, as `crew start` writes them: a resume carries both.
    if (change.worktree === undefined) mkdirSync(record.worktree, { recursive: true });
    writeStoreFile(crewSettingsFile(world.paths.stateDir, world.repo, record.id), "{}\n");
    writeStoreFile(crewMcpFile(world.paths.stateDir, world.repo, record.id), '{"mcpServers":{}}\n');
    return record;
  }

  /** What the gateway says: ready (no breaker), or a breaker still open on the worker slot. */
  function facts(change: Partial<GatewayNow> = {}): GatewayNow {
    return { breakers: {}, inUse: null, limits: {}, requests: 10, ...change };
  }

  const openBreaker = () =>
    facts({
      breakers: {
        [WORKER]: {
          held: 1,
          lastAt: T0,
          since: T0 - 10 * MINUTE,
          targets: [{ status: 429, target: "omniroute:glm-5.3-flash", until: T0 + MINUTE }],
        },
      },
      inUse: { [WORKER]: ["omniroute:glm-5.3-flash"] },
    });

  /** One pass, with the gateway facts the test hands in and the clock it names. */
  async function pass(
    world: Awaited<ReturnType<typeof leadWorld>>,
    resolved: ResolvedWorkflow,
    gateway: GatewayNow,
    state: WatchState,
    nowMs: number = T0,
  ) {
    const scope: WatchScope = {
      gateway: () => Promise.resolve(gateway),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    return await watchPass(state, world.ctx({ now: () => nowMs }), scope);
  }

  /** The watch's state as a fresh one: at the log's end, the monitor note already said. */
  function fresh(world: Awaited<ReturnType<typeof leadWorld>>): WatchState {
    return { noted: true, offset: eventsEndOffset(world.paths.stateDir, world.repo), said: {} };
  }

  test("never while the breaker is open; then one message, and the wait cleared", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world);
    // Open: nothing happens, no line, the record stays paused.
    expect(
      (await pass(world, resolved, openBreaker(), fresh(world))).state.resumedAt,
    ).toBeUndefined();
    expect(world.out).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");

    // Closed: the watch sends the message line (only a session holds SendMessage), and the
    // record is working again, with one state event.
    const done = await pass(world, resolved, facts(), fresh(world));
    expect(done.lines).toBe(2);
    expect(world.out).toEqual([
      `SendMessage {"to":"${NAME}","message":"The wait is over: worker answers again. Go on with phase B6b, then hand it back as usual."}`,
      `${NAME}: working — the wait is over; the message to it wakes it`,
    ]);
    expect(done.state.resumedAt).toBe(T0);
    expect(done.state.routerRequests).toBe(10);
    const after = readCrew(world.paths.stateDir, world.repo, record.id);
    expect(after?.state).toBe("working");
    expect(after?.waitingFor).toBeUndefined();
    expect(after?.reportPath).toBeNull();
  });

  test("a session with no process is resumed with the text, and never as a copy", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world, {
      waitingFor: {
        kind: "claude-limit",
        model: "claude-sonnet-5-5",
        resetsAt: "2026-10-21T09:58:00.000Z",
      },
    });
    const ctx = world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "[]" });
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    const done = await watchPass(fresh(world), ctx, scope);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([
      [
        "--bg",
        "--resume",
        record.sessionId ?? "",
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--permission-mode",
        "auto",
        "--autocompact",
        "auto",
        "--strict-mcp-config",
        "--mcp-config",
        crewMcpFile(world.paths.stateDir, world.repo, record.id),
        "--settings",
        crewSettingsFile(world.paths.stateDir, world.repo, record.id),
        "The wait is over: Claude's limit reset at 09:58. Go on with phase B6b, then hand it back as usual.",
      ],
    ]);
    // Resumed in its own worktree, never the main checkout.
    expect(world.cwdCalls().at(-1)).toBe(record.worktree);
    expect(done.lines).toBe(1);
    expect(world.out).toEqual([`${NAME}: working — the wait is over; it was resumed`]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("working");
  });

  test("one first; the next 30 s later, and only after the router answered a request since", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const first = await pausedCrew(world);
    const second = await pausedCrew(world, {
      id: "B6c-api-live-9f9f9f",
      name: "C my-app B6c api-live",
      phase: "B6c",
      sessionId: "b2c3d4e5-0000-1111-2222-333333333333",
      shortId: "b2c3d4e5",
      slug: "api-live",
      waitingFor: { ...SLOT_WAIT, since: "2026-10-21T09:51:00.000Z" },
      lastPause: { backoffMs: 0, since: "2026-10-21T09:51:00.000Z" },
    });

    // The canary: the oldest wait goes.
    let done = await pass(world, resolved, facts({ requests: 10 }), fresh(world));
    expect(done.state.resumedAt).toBe(T0);
    expect(readCrew(world.paths.stateDir, world.repo, first.id)?.state).toBe("working");
    expect(readCrew(world.paths.stateDir, world.repo, second.id)?.state).toBe("paused");

    // 20 s later: too soon, even though the router answered.
    done = await pass(world, resolved, facts({ requests: 14 }), done.state, T0 + 20_000);
    expect(done.lines).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, second.id)?.state).toBe("paused");

    // 31 s later, but the router handled no request since the canary: the others stay put.
    done = await pass(world, resolved, facts({ requests: 10 }), done.state, T0 + 31_000);
    expect(done.lines).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, second.id)?.state).toBe("paused");

    // 31 s later, and the router answered: the next one goes, one line for its state event.
    done = await pass(world, resolved, facts({ requests: 11 }), done.state, T0 + 31_000);
    expect(done.lines).toBe(1);
    expect(readCrew(world.paths.stateDir, world.repo, second.id)?.state).toBe("working");
    expect(world.out).toContain(
      "C my-app B6c api-live: working — the wait is over; it was resumed",
    );
  });

  test("a limit still current: the session waits, however long its reset time has passed", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const limited = await pausedCrew(world, {
      model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
      waitingFor: {
        kind: "claude-limit",
        model: "claude-opus-5-5",
        resetsAt: "2026-10-21T10:04:00.000Z",
      },
    });
    const current = facts({
      limits: {
        "claude-opus-5-5": { claim: "five_hour", resetsAt: 1_792_623_600, seenAt: T0 },
      },
    });
    // The reset time passed, but the router still records the limit: never while it is current.
    let done = await pass(world, resolved, current, fresh(world), T0 + 5 * MINUTE);
    expect(done.lines).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, limited.id)?.state).toBe("paused");
    // The router dropped it, but the reset time plus the jitter is still ahead.
    done = await pass(world, resolved, facts(), done.state, T0 + 5 * MINUTE);
    expect(done.lines).toBe(0);
    // Both are past: it goes.
    done = await pass(world, resolved, facts(), done.state, T0 + 6 * MINUTE);
    expect(done.lines).toBe(2);
    expect(readCrew(world.paths.stateDir, world.repo, limited.id)?.state).toBe("working");
  });

  test("a re-pause's hold-off: five minutes more, whatever the gateway says", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const again = await pausedCrew(world, {
      lastPause: { backoffMs: 5 * MINUTE, since: "2026-10-21T10:00:00.000Z" },
      waitingFor: { kind: "unknown", since: "2026-10-21T10:00:00.000Z" },
    });
    let done = await pass(world, resolved, facts(), fresh(world), T0 + 4 * MINUTE);
    expect(done.lines).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, again.id)?.state).toBe("paused");
    done = await pass(world, resolved, facts(), done.state, T0 + 5 * MINUTE);
    expect(done.lines).toBe(2);
    expect(readCrew(world.paths.stateDir, world.repo, again.id)?.state).toBe("working");
  });

  test("a paused crew session with no worktree is not resumed: one line, and it stays paused", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const gone = join(world.repo, ".claude", "worktrees", "crew-B6b-gone");
    const record = await pausedCrew(world, { worktree: gone });
    const ctx = world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "[]" });
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    const done = await watchPass(fresh(world), ctx, scope);
    expect(world.out).toEqual([
      `${NAME}: not resumed — ${NAME} has no worktree at ${gone} any more`,
    ]);
    expect(done.lines).toBe(1);
    expect(done.state.resumedAt).toBeUndefined();
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
  });

  test("an agent view that cannot be read is no resume: one line, and it stays paused", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world);
    const ctx = world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "not json" });
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    const done = await watchPass(fresh(world), ctx, scope);
    expect(world.out).toEqual([
      `${NAME}: not resumed — agent view could not be read (claude agents --json), so it cannot say whether its session still runs; try again`,
    ]);
    expect(done.state.resumedAt).toBeUndefined();
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
  });

  test("a resume that claude refuses is one line, and the record stays paused", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world);
    const ctx = world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "[]", FAKE_BG: "fail" });
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    const done = await watchPass(fresh(world), ctx, scope);
    expect(world.out).toEqual([
      `${NAME}: not resumed — claude --bg --resume ${record.sessionId} failed (exit 4): something broke`,
    ]);
    expect(done.lines).toBe(1);
    expect(done.state.resumedAt).toBeUndefined();
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
  });
});
