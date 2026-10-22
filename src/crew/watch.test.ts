/**
 * `crew watch` (`watch.ts`): the lead's window on its crew. One line per change, the
 * queued crew sessions started when a place frees, and the crew ended per D35 (a crew session never
 * outlives its work).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFolderName } from "../sessions/saved-sessions";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import {
  appendCrewEvent,
  type CrewRecord,
  createCrew,
  listCrew,
  readWatchState,
  writeLead,
} from "./store";

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

  test("D35: a crew session whose turn ended is stopped, and the line says so", async () => {
    const world = await leadWorld();
    await addCrew(world, "done");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: stopped — its turn ended"]);
    const calls = world.claudeCalls();
    expect(calls).toContainEqual(["stop", "aaaa1111"]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("stopped");
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

  test("D35: a branch the lead merged is marked merged, and the line says who removes it", async () => {
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
      "C my-app B6b portal-live: merged — the lead merged its branch; `crew rm` removes it",
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
  });

  test("D35: a branch the lead squash-merged is marked merged too", async () => {
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
      "C my-app B6b portal-live: merged — the lead merged its branch; `crew rm` removes it",
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
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

  test("D35: the merge is looked for in the lead's own folder, where it merges", async () => {
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
    expect(world.out).toEqual([
      "C my-app B6b portal-live: merged — the lead merged its branch; `crew rm` removes it",
    ]);
    // The main checkout is still on main, which does not hold the branch: it is the lead's
    // folder that was asked.
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

  test("D35: a branch merged after the crew session was stopped is still marked merged", async () => {
    const world = await leadWorld();
    await addCrew(world, "stopped");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — the lead merged its branch; `crew rm` removes it",
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
  });

  test("D25: a queued crew session starts when a place frees, and its start is one line", async () => {
    const world = await leadWorld();
    world.writeConfig({ max: 1 });
    await queuedCrew(world);
    const code = await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // One line, from the state event the launch writes: not the launcher's line as well.
    expect(world.out).toEqual(["C my-app B6b portal-live: working — started (a1b2c3d4)"]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
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
    expect(world.out).toContain("C my-app B6b portal-live: working — started (a1b2c3d4)");
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
