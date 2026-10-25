/**
 * `crew watch` (`watch.ts`): the lead's window on its crew. One line per change, the
 * queued crew sessions started when a place frees, and the crew ended per D35 (a crew session never
 * outlives its work).
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { recordUsageWindow } from "../cli/usage-window";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { projectFolderName } from "../sessions/saved-sessions";
import { currentHolder } from "../setup/lock";
import { crewWorld, LEAD_SESSION, OTHER_SESSION, writeSessionRecord } from "../testing/crew-world";
import { git } from "../testing/temp";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { resolveWorkflow } from "../workflow/resolve";
import { runCrew } from "./command";
import type { CrewContext } from "./context";
import {
  appendCrewEvent,
  type CrewRecord,
  createCrew,
  crewMcpFile,
  crewSettingsFile,
  crewStoreDir,
  eventsEndOffset,
  keepWatchLease,
  listCrew,
  readCrew,
  readWatchLease,
  readWatchState,
  takeWatchLease,
  updateCrew,
  type WatchLease,
  type WatchState,
  watchLeaseFile,
  writeLead,
  writeStoreFile,
  writeWatchState,
} from "./store";
import type { GatewayNow } from "./wait";
import { eventLine, PARKED_PASS_MS, WatchEnd, type WatchScope, watchPass } from "./watch";

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
 * removal signals this test's own child, never a process the test did not start. `crew` is the
 * crew id its environment carries (`CC_SMART_DEV_KIT_CREW`, which everything a crew session
 * starts inherits); null starts one that carries none, as a person's dev server does. The
 * environment is built here, not inherited, so the session that runs the suite cannot leak its
 * own marker in.
 */
async function startProgram(cwd: string, crew: null | string): Promise<Bun.Subprocess> {
  const child = Bun.spawn(["sh", "-c", "exec sleep 60"], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      ...(crew === null ? {} : { CC_SMART_DEV_KIT_CREW: crew }),
    },
    stderr: "ignore",
    stdout: "ignore",
  });
  // Until the child has run `sleep`, /proc shows the environment it was forked with — the
  // suite's own — and a removal that read it then would judge the wrong program.
  for (let tries = 0; tries < 400; tries += 1) {
    try {
      if (readFileSync(`/proc/${String(child.pid)}/cmdline`, "utf8").includes("sleep")) break;
    } catch {
      break;
    }
    await Bun.sleep(5);
  }
  return child;
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

  /** Set the crew session's transcript to be last written `minutes` before the tests' clock. */
  function writeTranscriptAgo(world: Awaited<ReturnType<typeof leadWorld>>, minutes: number): void {
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    mkdirSync(worktree, { recursive: true });
    const folder = join(world.paths.projectsDir, projectFolderName(worktree));
    mkdirSync(folder, { recursive: true });
    const transcript = join(folder, "aaaa1111-2222-3333-4444-555555555555.jsonl");
    writeFileSync(transcript, "{}\n");
    const at = new Date(T0 - minutes * 60_000);
    utimesSync(transcript, at, at);
  }

  test("WN1: a quiet stretch is said once, again at 3x the quiet minutes, then not again", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    const pass = async (minutes: number): Promise<string[]> => {
      writeTranscriptAgo(world, minutes);
      world.out.length = 0;
      await runCrew(["watch", "--once", "--timeout", "0"], ctx);
      return [...world.out];
    };
    // `crew.quietMinutes` is 20: the first line at 21 minutes, the long step at 60.
    expect(await pass(21)).toEqual([
      "C my-app B6b portal-live: quiet — nothing written for 21 minutes",
    ]);
    for (const minutes of [22, 23, 40, 59]) expect(await pass(minutes)).toEqual([]);
    expect(await pass(60)).toEqual([
      "C my-app B6b portal-live: quiet — nothing written for 60 minutes",
    ]);
    for (const minutes of [61, 90, 300]) expect(await pass(minutes)).toEqual([]);
  });

  test("WN1: a write ends a quiet stretch, and a second stretch is said", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    const pass = async (minutes: number): Promise<string[]> => {
      writeTranscriptAgo(world, minutes);
      world.out.length = 0;
      await runCrew(["watch", "--once", "--timeout", "0"], ctx);
      return [...world.out];
    };
    expect(await pass(25)).toEqual([
      "C my-app B6b portal-live: quiet — nothing written for 25 minutes",
    ]);
    expect(await pass(26)).toEqual([]);
    // The crew session writes again: the stretch is over.
    expect(await pass(1)).toEqual([]);
    // A new stretch starts later.
    expect(await pass(30)).toEqual([
      "C my-app B6b portal-live: quiet — nothing written for 30 minutes",
    ]);
    expect(await pass(31)).toEqual([]);
  });

  test("WN1: a wait the person answered is said once as going again, then nothing while it works", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const waiting = world.ctx(
      {},
      {
        FAKE_AGENTS_JSON: agentsJson([
          agentRowOf({ state: "blocked", status: "waiting", waitingFor: "permission prompt" }),
        ]),
      },
    );
    await runCrew(["watch", "--once", "--timeout", "0"], waiting);
    expect(world.out).toEqual(["C my-app B6b portal-live: needs you — permission prompt"]);
    world.out.length = 0;
    // Still waiting: nothing more.
    await runCrew(["watch", "--once", "--timeout", "0"], waiting);
    expect(world.out).toEqual([]);
    // The person answered: agent view says it works again.
    const going = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], going);
    expect(world.out).toEqual(["C my-app B6b portal-live: going again — the wait is answered"]);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], going);
    expect(world.out).toEqual([]);
  });

  test("WN1: a quiet stretch first seen past 3x is said once, as the long one", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    writeTranscriptAgo(world, 90);
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual(["C my-app B6b portal-live: quiet — nothing written for 90 minutes"]);
    world.out.length = 0;
    writeTranscriptAgo(world, 120);
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
  });

  test("WN1: a watch state from before the key (the alert's whole line) says nothing again", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    writeTranscriptAgo(world, 25);
    // The state an older watch wrote: the line it said, minutes included.
    writeWatchState(world.paths.stateDir, world.repo, LEAD_SESSION, {
      noted: true,
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: { [ID]: "C my-app B6b portal-live: quiet — nothing written for 24 minutes" },
    });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
  });

  test("WN1: a wait begun before the key is still said going again when it ends", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    writeWatchState(world.paths.stateDir, world.repo, LEAD_SESSION, {
      noted: true,
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: { [ID]: "C my-app B6b portal-live: needs you — permission prompt" },
    });
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: going again — the wait is answered"]);
  });

  test("WN1: a start-time wait of a starting record is said going again too", async () => {
    const world = await leadWorld();
    await addCrew(world, "starting");
    const waiting = world.ctx(
      {},
      {
        FAKE_AGENTS_JSON: agentsJson([
          agentRowOf({ state: "blocked", status: "waiting", waitingFor: "trust prompt" }),
        ]),
      },
    );
    await runCrew(["watch", "--once", "--timeout", "0"], waiting);
    expect(world.out).toEqual(["C my-app B6b portal-live: needs you — trust prompt"]);
    world.out.length = 0;
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) }),
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: going again — the wait is answered"]);
  });

  test("WN1: a session that was never waiting is not said going again", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const going = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], going);
    await runCrew(["watch", "--once", "--timeout", "0"], going);
    expect(world.out).toEqual([]);
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

  test("RX1: a stop the watch made for an idle blocked session is not the lead's call: the merge removes it", async () => {
    const world = await leadWorld();
    await addCrew(world, "blocked");
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, ID, {}, T0 - 30 * 60_000, "asked");
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(listCrew(world.paths.stateDir, world.repo).records[0]).toMatchObject({
      state: "stopped",
      stoppedByWatch: true,
    });
    // The lead never stopped it; it merges the branch without answering.
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    world.out.length = 0;

    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());

    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("removed");
    expect(record?.mergedWhileStopped).toBeUndefined();
    expect(record?.stoppedByWatch).toBeUndefined();
    expect(existsSync(worktree)).toBe(false);
    expect(world.out[0]).toBe(
      "C my-app B6b portal-live: merged — the lead merged its branch; the watch removes it",
    );
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

  test("H2: a real worktree-list failure during auto-removal is one line and the watch continues", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "merged");
    git(world.repo, "worktree", "add", "-b", record.branch, record.worktree);
    // No proof lookup is needed for a legacy merged record. Fail the actual list subprocess
    // used by crew rm, not branchMerged, and count it so this cannot pass on an unrelated path.
    const log = join(world.bin, "git-list.log");
    const realGit = Bun.which("git");
    expect(realGit).not.toBeNull();
    const fakeGit = join(world.bin, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nif [ "$1 $2" = "worktree list" ]; then\n  count=0\n  if [ -f "$LIST_LOG" ]; then while IFS= read -r line; do count=$((count + 1)); done < "$LIST_LOG"; fi\n  printf 'list\\n' >> "$LIST_LOG"\n  if [ "$count" = 1 ]; then printf 'injected list failure\\n' >&2; exit 1; fi\nfi\nexec "$REAL_GIT" "$@"\n`,
    );
    chmodSync(fakeGit, 0o755);
    // A later record proves the pass goes on after the refused removal.
    const later = await addCrew(world, "failed", {
      id: "later-1a2b3c",
      name: "C my-app later check",
      branch: "crew/later",
      sessionId: "bbbb1111-2222-3333-4444-555555555555",
      shortId: "bbbb1111",
    });
    const ctx = world.ctx(
      {},
      {
        REAL_GIT: realGit ?? "",
        LIST_LOG: log,
        FAKE_AGENTS_JSON: agentsJson([
          agentRowOf({ id: later.shortId, sessionId: later.sessionId }),
        ]),
      },
    );
    const scope = {
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved: resolveWorkflow(world.paths, null),
    };
    const first = await watchPass(
      {
        noted: true,
        offset: eventsEndOffset(world.paths.stateDir, world.repo),
        said: {},
        parkedAt: T0,
      },
      ctx,
      scope,
    );
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "crew rm: git worktree list failed: injected list failure",
      "C my-app later check: its session stopped — it failed; the record stays failed",
    ]);
    expect(readFileSync(log, "utf8")).toBe("list\nlist\n");
    expect(world.claudeCalls()).toContainEqual(["stop", "bbbb1111"]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("merged");
    expect(existsSync(record.worktree)).toBe(true);
    world.out.length = 0;
    await watchPass(first.state, ctx, scope);
    expect(world.out).toEqual([]);
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
    await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    // What `removeWorktree` leaves when git cannot remove the folder it moved aside: the lead's
    // `crew rm` stopped there, and the record is still `done`.
    const parked = `${worktree}-removing-1761300000000`;
    git(world.repo, "worktree", "move", worktree, parked);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    // Marked merged, then removed with `crew rm`'s own steps: the parked folder goes first.
    expect(existsSync(parked)).toBe(false);
    expect(git(world.repo, "worktree", "list")).not.toContain("-removing-");
    expect(git(world.repo, "branch", "--list", "crew/B6b-portal-live")).toBe("");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("removed");
    expect(record?.mergedBeforeRemoval).toBe(true);
  });

  test("D62: the watch finishes a stopped record's moved-aside folder and leaves the record to the lead", async () => {
    const world = await leadWorld();
    await addCrew(world, "stopped");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    const parked = `${worktree}-removing-1761300000000`;
    git(world.repo, "worktree", "move", worktree, parked);
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    // The folder was the lead's own removal, left half done: it is finished. The record is
    // marked merged and stays for the lead's `crew rm` (D62).
    expect(existsSync(parked)).toBe(false);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
    expect(record?.mergedWhileStopped).toBe(true);
    expect(record?.mergeProof).toEqual({
      head: git(world.repo, "rev-parse", "main^2").trim(),
      leadRef: "main",
      leadCommit: git(world.repo, "rev-parse", "main").trim(),
    });
  });

  test("D62: the watch finishes a removal that stopped halfway with no record at all", async () => {
    const world = await leadWorld();
    // No crew record names this folder, and the repository has no remote: the base it is
    // judged against is the local branch `worktrees` would use (`main`).
    const worktree = join(world.repo, ".claude", "worktrees", "crew-ghost");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/ghost", worktree);
    writeFileSync(join(worktree, "ghost.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "ghost work");
    const parked = `${worktree}-removing-1761300000000`;
    git(world.repo, "worktree", "move", worktree, parked);
    // The removal had deleted a tracked file of it before it stopped.
    rmSync(join(parked, "README.md"));
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    expect(existsSync(parked)).toBe(false);
    expect(git(world.repo, "worktree", "list")).not.toContain("-removing-");
    // Its commit is safe on the branch the folder stood on.
    expect(git(world.repo, "log", "--format=%s", "-1", "crew/ghost").trim()).toBe("ghost work");
  });

  test("D62: the watch finishes a leftover folder git no longer lists, and says so once", async () => {
    const world = await leadWorld();
    const folder = join(world.repo, ".claude", "worktrees", "crew-ghost-removing-1761300000000");
    mkdirSync(join(folder, "docs"), { recursive: true });
    writeFileSync(join(folder, "docs", "guide.md"), "left\n");
    const before = new Date(1761300000000 - 60_000);
    utimesSync(join(folder, "docs", "guide.md"), before, before);
    const ctx = world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(existsSync(folder)).toBe(false);
    expect(world.out).toEqual([
      `removed ${folder} (left by a removal that stopped halfway; git no longer lists it)`,
    ]);
  });

  test("D62: the watch looks for moved-aside folders every few minutes, not on every pass", async () => {
    const world = await leadWorld();
    let clock = T0;
    const ctx = world.ctx({
      now: () => clock,
      scanFacts: { containers: [], programs: [], sessions: [] },
    });
    const leftover = (name: string): string => {
      const folder = join(world.repo, ".claude", "worktrees", `${name}-removing-1761300000000`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "left.txt"), "left\n");
      const before = new Date(1761300000000 - 60_000);
      utimesSync(join(folder, "left.txt"), before, before);
      return folder;
    };
    const first = leftover("crew-one");
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(existsSync(first)).toBe(false);
    // A minute later: too soon to look again, however many passes there are.
    const second = leftover("crew-two");
    clock = T0 + 60_000;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(existsSync(second)).toBe(true);
    // Past the interval: it looks, and finishes it.
    clock = T0 + PARKED_PASS_MS + 1;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(existsSync(second)).toBe(false);
  });

  test("D62: the watch leaves a moved-aside folder alone while something is uncommitted in it", async () => {
    const world = await leadWorld();
    const worktree = join(world.repo, ".claude", "worktrees", "crew-ghost");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/ghost", worktree);
    const parked = `${worktree}-removing-1761300000000`;
    git(world.repo, "worktree", "move", worktree, parked);
    writeFileSync(join(parked, "mine.txt"), "someone's notes\n");
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    // Said nothing, removed nothing: the next pass judges it again.
    expect(world.out).toEqual([]);
    expect(existsSync(join(parked, "mine.txt"))).toBe(true);
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
    // It carries the session's marker, as everything the session's Bash started does.
    const check = await startProgram(worktree, ID);
    try {
      const ctx = world.ctx({
        scanFacts: {
          containers: [],
          programs: [{ parentPid: 1, path: join(worktree, "check.sh"), pid: check.pid }],
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
    // The person's dev server: it carries no marker, however long it has been there — this one
    // started before the session's turn ended.
    const server = await startProgram(worktree, null);
    try {
      const ctx = world.ctx({
        scanFacts: {
          containers: [],
          programs: [
            {
              cwd: worktree,
              path: "/usr/bin/bun dev",
              pid: server.pid,
              startedAt: T0 - 60_000,
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

  test("M6/L9: refusal retries throttle stop and unlock, and say refusal before each detail once", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "done");
    git(world.repo, "worktree", "add", "-b", record.branch, record.worktree);
    writeFileSync(join(record.worktree, "done.txt"), "done\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "work");
    git(world.repo, "merge", "--no-ff", "-m", "merge", record.branch);
    git(world.repo, "worktree", "lock", "--reason", "claude session test", record.worktree);
    const realGit = Bun.which("git");
    const log = join(world.bin, "unlocks.log");
    const fakeGit = join(world.bin, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nif [ "$1 $2" = "worktree unlock" ]; then printf 'unlock\\n' >> "$UNLOCK_LOG"; fi\nexec "$REAL_GIT" "$@"\n`,
    );
    chmodSync(fakeGit, 0o755);
    let clock = T0;
    const ctx = world.ctx(
      {
        now: () => clock,
        scanFacts: {
          containers: [{ name: "db", sources: [record.worktree] }],
          programs: [],
          sessions: [],
        },
      },
      {
        REAL_GIT: realGit ?? "",
        UNLOCK_LOG: log,
        FAKE_STOP: "fail",
        FAKE_AGENTS_JSON: agentsJson([agentRowOf()]),
      },
    );
    const scope = {
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved: resolveWorkflow(world.paths, null),
    };
    let state: WatchState = {
      noted: true,
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: {},
      parkedAt: T0,
    };
    const pass = async () => {
      world.out.length = 0;
      const result = await watchPass(state, ctx, scope);
      state = result.state;
    };
    const counts = (expected: number) => {
      expect(world.claudeCalls().filter((call) => call[0] === "stop")).toHaveLength(expected);
      expect(readFileSync(log, "utf8")).toBe("unlock\n".repeat(expected));
    };
    await pass();
    counts(1);
    expect(world.out.slice(0, 3)).toEqual([
      'crew rm: .claude/worktrees/crew-B6b-portal-live is kept: Docker container "db" uses its files',
      "note: claude stop aaaa1111 failed (exit 1): no such session; going on, the check below stops the removal if anything still works in its worktree",
      "Fix: clear that, then run crew rm again; it never forces",
    ]);
    clock += 1;
    await pass();
    counts(1);
    expect(world.out).toEqual([]);
    clock = T0 + PARKED_PASS_MS;
    await pass();
    counts(2);
    expect(world.out).toEqual([]);
    // A changed HEAD retries without waiting for the timer, even on an already merged record.
    git(record.worktree, "commit", "--allow-empty", "-m", "new head");
    clock += 1;
    await pass();
    counts(3);
    expect(world.out).toEqual([]);
    // A changed status retries too. Use the same HEAD and no time advance.
    writeFileSync(join(record.worktree, "notes.txt"), "mine\n");
    await pass();
    counts(3); // Dirty work refuses before stop/unlock, proving this retry stays harmless.
    expect(world.out).toEqual([
      `crew rm: ${record.worktree} has changes that are not committed (or git cannot read it)`,
      "Fix: commit or discard them there, then run crew rm again; it never forces",
    ]);
    rmSync(join(record.worktree, "notes.txt"));
    await pass();
    counts(4);
    expect(world.out).toEqual([
      'crew rm: .claude/worktrees/crew-B6b-portal-live is kept: Docker container "db" uses its files',
    ]);
    expect(world.err).toEqual([]);
    expect(existsSync(record.worktree)).toBe(true);
  });

  test("L12: historical stopped-to-merged evidence keeps a legacy record for its lead", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "stopped");
    git(world.repo, "worktree", "add", "-b", record.branch, record.worktree);
    writeFileSync(join(record.worktree, "done.txt"), "done\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "work");
    git(world.repo, "merge", "--no-ff", "-m", "merge", record.branch);
    // Simulate the old writer: it left the transition in events, but not the new field.
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "merged" },
      T0,
      "the lead merged its branch; it was stopped",
    );
    const { crewFile } = await import("./store");
    const file = crewFile(world.paths.stateDir, world.repo, record.id);
    const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete old.mergedWhileStopped;
    writeFileSync(file, JSON.stringify(old));
    const ctx = world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("merged");
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.mergedWhileStopped).toBe(true);
    expect(existsSync(record.worktree)).toBe(true);
    expect(world.claudeCalls().some((call) => call[0] === "stop" || call[0] === "rm")).toBe(false);
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    expect(existsSync(record.worktree)).toBe(true);
  });

  test("L12: a historical stop followed by a resume does not block merged removal", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "stopped");
    git(world.repo, "worktree", "add", "-b", record.branch, record.worktree);
    writeFileSync(join(record.worktree, "done.txt"), "done\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-m", "work");
    git(world.repo, "merge", "--no-ff", "-m", "merge", record.branch);
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "working" },
      T0,
      "resumed",
    );
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { state: "merged" },
      T0,
      "merged",
    );
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("removed");
    expect(existsSync(record.worktree)).toBe(false);
    expect(world.claudeCalls()).toContainEqual(["rm", "aaaa1111"]);
  });

  test("a merged record with a deleted branch is removed on the next pass", async () => {
    const world = await leadWorld();
    await addCrew(world, "merged", { shortId: null });
    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } }),
    );
    expect(listCrew(world.paths.stateDir, world.repo).records[0]?.state).toBe("removed");
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

  test("D35: a merged one with a queued continuation is kept until that continuation merges", async () => {
    const world = await leadWorld();
    const original = await addCrew(world, "done");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    // A phase it waits for keeps the continuation queued: a queue that could start it would start
    // it here, and the fake `claude` has no session to give it (it would fail, which releases the
    // original, RX1).
    await addCrew(world, "working", {
      branch: "crew/Z9-hold",
      id: "Z9-hold-1a2b3c",
      name: "C my-app Z9 hold",
      phase: "Z9",
      sessionId: null,
      shortId: null,
      slug: "hold",
      worktree: join(world.repo, ".claude", "worktrees", "crew-Z9-hold"),
    });
    const continuation = await addCrew(world, "queued", {
      base: null,
      branch: "crew/B6b-portal-live-2",
      continues: original.id,
      id: "B6b-portal-live-2-1a2b3c",
      name: "C my-app B6b portal-live 2",
      sessionId: null,
      shortId: null,
      waitsFor: ["Z9"],
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live-2"),
    });
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: agentsJson([agentRowOf()]) });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — waiting for its continuation C my-app B6b portal-live 2 to merge",
    );
    const kept = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === original.id,
    );
    expect(kept?.state).toBe("merged");
    expect(existsSync(worktree)).toBe(true);
    // The waiting line is said once.
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).not.toContain("waiting for its continuation");
    // Starting is not enough: the original stays until the continuation merges.
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
    expect(readCrew(world.paths.stateDir, world.repo, original.id)?.state).toBe("merged");
    expect(existsSync(worktree)).toBe(true);
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      continuation.id,
      { state: "merged" },
      T0 + 2000,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(readCrew(world.paths.stateDir, world.repo, original.id)?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test.each(["removed", "discarded", "failed"])(
    "RX1: a continuation that is %s before it started releases its merged original",
    async (ended) => {
      const world = await leadWorld();
      const original = await addCrew(world, "done");
      const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
      git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
      writeFileSync(join(worktree, "done.txt"), "x\n");
      git(worktree, "add", ".");
      git(worktree, "commit", "-q", "-m", "the phase");
      git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
      // Queued, so it has no branch and no worktree; then removed (or failed) before it started.
      await addCrew(world, ended, {
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

      expect(world.out.join("\n")).not.toContain("waiting for its continuation");
      expect(readCrew(world.paths.stateDir, world.repo, original.id)?.state).toBe("removed");
      expect(existsSync(worktree)).toBe(false);
    },
  );

  test("a handed-off ancestor stays while its continuation has unmerged work", async () => {
    const world = await leadWorld();
    const original = await addCrew(world, "handoff");
    const worktree = original.worktree;
    git(world.repo, "worktree", "add", "-q", "-b", original.branch, worktree);
    writeFileSync(join(worktree, "part-one.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "part one");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", original.branch);
    await addCrew(world, "working", {
      branch: "crew/next",
      continues: original.id,
      id: "next-1a2b3c",
      name: "C my-app B6b next",
      worktree: join(world.repo, ".claude", "worktrees", "crew-next"),
    });
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(readCrew(world.paths.stateDir, world.repo, original.id)?.state).toBe("merged");
    expect(existsSync(worktree)).toBe(true);
    expect(world.out).toContain(
      "C my-app B6b portal-live: merged — waiting for its continuation C my-app B6b next to merge",
    );
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

  test("H3: a three-level continuation waits for its last merge, then every record uses the first base", async () => {
    const world = await leadWorld();
    const leadFolder = join(world.repo, ".claude", "worktrees", "lead-other");
    git(world.repo, "worktree", "add", "-b", "lead-other", leadFolder);
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
    const chain: CrewRecord[] = [];
    const heads: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const previous = chain.at(-1);
      const branch = `crew/chain-${index}`;
      const worktree = join(world.repo, ".claude", "worktrees", `crew-chain-${index}`);
      const record = await addCrew(world, index === 2 ? "done" : "handoff", {
        id: `chain-${index}-1a2b3c`,
        name: `C my-app chain ${index}`,
        branch,
        worktree,
        shortId: `cccc000${index}`,
        sessionId: `cccc000${index}-2222-3333-4444-555555555555`,
        ...(previous === undefined
          ? {}
          : {
              base: { ref: previous.branch, sha: heads[index - 1] ?? "" },
              baseRef: previous.branch,
              continues: previous.id,
            }),
      });
      git(world.repo, "worktree", "add", "-b", branch, worktree, previous?.branch ?? "main");
      writeFileSync(join(worktree, `part-${index}.txt`), `part ${index}\n`);
      git(worktree, "add", ".");
      git(worktree, "commit", "-m", `part ${index}`);
      heads.push(git(worktree, "rev-parse", "HEAD").trim());
      chain.push(record);
    }
    git(world.repo, "merge", "--no-ff", "-m", "first two parts", "crew/chain-1");
    const ctx = world.ctx({ scanFacts: { containers: [], programs: [], sessions: [] } });
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    for (const record of chain.slice(0, 2)) {
      expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("merged");
      expect(existsSync(record.worktree)).toBe(true);
      expect(world.out).toContain(
        `${record.name}: merged — waiting for its continuation C my-app chain 2 to merge`,
      );
    }
    expect(readCrew(world.paths.stateDir, world.repo, chain[2]?.id ?? "")?.state).toBe("done");
    git(world.repo, "merge", "--no-ff", "-m", "last part", "crew/chain-2");
    const received = git(world.repo, "rev-parse", "main").trim();
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    for (const [index, record] of chain.entries()) {
      const stored = readCrew(world.paths.stateDir, world.repo, record.id);
      expect(stored?.state).toBe("removed");
      expect(stored?.mergedBeforeRemoval).toBe(true);
      expect(stored?.mergeProof).toMatchObject({ head: heads[index], leadRef: "main" });
      if (index === 2) expect(stored?.mergeProof?.leadCommit).toBe(received);
      expect(existsSync(record.worktree)).toBe(false);
      expect(git(world.repo, "branch", "--list", record.branch)).toBe("");
      expect(world.claudeCalls()).toContainEqual(["rm", record.shortId ?? ""]);
    }
    expect(git(leadFolder, "log", "--format=%s", "-1").trim()).toBe("first");
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

  test("FX1: a done report with an own review says review ✓, not review ✗", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const { recordCrewReport } = await import("./store");
    const sha = git(world.repo, "rev-parse", "HEAD").trim();
    const { file } = await recordCrewReport(
      world.paths.stateDir,
      world.repo,
      ID,
      {
        base: { ref: "main", sha },
        branch: { name: "crew/B6b-portal-live", sha },
        changed: { deletions: 0, files: 0, insertions: 0 },
        checks: [],
        docs: [],
        needsLead: [],
        open: [],
        outsideBrief: [],
        ownReview: { findings: [], reason: "the brief asked for no second opinion" },
        phase: "B6b",
        pr: null,
        question: null,
        review: null,
        status: "done",
        tests: { full: null, targeted: [] },
        version: 1,
      },
      T0,
    );
    await runCrew(["watch", "--once", "--timeout", "0"], world.ctx());
    expect(world.out).toEqual([`C my-app B6b portal-live: done · review ✓ · report ${file}`]);
  });

  test("D62: a stopped crew session is marked merged, so its dependents start, and never removed by the watch", async () => {
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
    // The mark is said, with who removes it: stopping it was the lead's call, and so is this.
    expect(world.out).toEqual([
      "C my-app B6b portal-live: merged — the lead merged its branch; it was stopped, so `crew rm` removes it",
    ]);
    // Later passes remove nothing, however often they look, and say nothing more.
    world.out.length = 0;
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(world.out).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("merged");
    expect(record?.mergedWhileStopped).toBe(true);
    expect(existsSync(worktree)).toBe(true);
    // The lead's own `crew rm` still removes it.
    expect(await runCrew(["rm", record?.id ?? ""], ctx)).toBe(0);
    expect(listCrew(world.paths.stateDir, world.repo).records[0]?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  });

  test("D62: a phase that waits for a stopped crew session starts once the lead merged it", async () => {
    const world = await leadWorld();
    world.writeConfig({ max: 4 });
    await addCrew(world, "stopped");
    const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
    git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
    writeFileSync(join(worktree, "done.txt"), "x\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "the phase");
    await queuedCrew(world, {
      branch: "crew/B6c-next",
      id: "B6c-next-1a2b3c",
      name: "C my-app B6c next",
      phase: "B6c",
      slug: "next",
      waitsFor: ["B6b"],
      worktree: join(world.repo, ".claude", "worktrees", "crew-B6c-next"),
    });
    const ctx = world.ctx();
    // Not merged yet: the dependent waits.
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    const stateOf = (id: string) =>
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === id)?.state;
    expect(stateOf("B6c-next-1a2b3c")).toBe("queued");
    // The lead merges: the stopped crew session is marked merged, and what waited starts.
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", "crew/B6b-portal-live");
    await runCrew(["watch", "--once", "--timeout", "0"], ctx);
    expect(stateOf(ID)).toBe("merged");
    expect(stateOf("B6c-next-1a2b3c")).toBe("starting");
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

  test("reminds once a day about stopped unmerged sessions without removing them", async () => {
    const world = await leadWorld();
    const stopped = await addCrew(world, "working");
    git(world.repo, "worktree", "add", "-b", stopped.branch, stopped.worktree);
    writeFileSync(join(stopped.worktree, "unmerged.txt"), "unmerged work\n");
    git(stopped.worktree, "add", ".");
    git(stopped.worktree, "commit", "-m", "unmerged work");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      stopped.id,
      { state: "stopped" },
      T0 - 2 * 86_400_000,
    );
    const scope: WatchScope = {
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved: resolveWorkflow(world.paths, null),
    };
    const first = await watchPass(
      { offset: eventsEndOffset(world.paths.stateDir, world.repo), said: {}, noted: true },
      world.ctx({ now: () => T0 }),
      scope,
    );
    expect(world.out).toEqual([
      `${NAME}: stopped 2 days ago; 1 unmerged commit — crew resume "${NAME}", crew start B6b --continue "${NAME}", or crew rm "${NAME}"`,
    ]);
    expect(first.state.stoppedRemindedAt?.[stopped.id]).toBe(T0);
    world.out.length = 0;
    const second = await watchPass(first.state, world.ctx({ now: () => T0 + 60_000 }), scope);
    expect(world.out).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, stopped.id)?.state).toBe("stopped");
    expect(existsSync(stopped.worktree)).toBe(true);
    expect(world.claudeCalls().filter((call) => call[0] === "rm")).toEqual([]);
    await watchPass(second.state, world.ctx({ now: () => T0 + 86_400_000 }), scope);
    expect(world.out.join("\n")).toContain("crew resume");
  });

  test.each(["stopped", "done", "failed"])(
    "does not remind about old %s work after a continuation under another lead",
    async (state) => {
      const world = await leadWorld();
      const original = await addCrew(world, "working");
      git(world.repo, "worktree", "add", "-b", original.branch, original.worktree);
      writeFileSync(join(original.worktree, "unmerged.txt"), "unmerged work\n");
      git(original.worktree, "add", ".");
      git(original.worktree, "commit", "-m", "unmerged work");
      await updateCrew(
        world.paths.stateDir,
        world.repo,
        original.id,
        { state },
        T0 - 2 * 86_400_000,
      );
      await addCrew(world, "working", {
        id: "continued-1a2b3c",
        branch: "crew/continued",
        name: "C my-app B6b continued",
        leadSessionId: OTHER_SESSION,
        continues: original.id,
      });
      const pass = await watchPass(
        { offset: eventsEndOffset(world.paths.stateDir, world.repo), said: {}, noted: true },
        world.ctx({}, { FAKE_AGENTS_JSON: "[]" }),
        {
          leadSessionId: LEAD_SESSION,
          mergeInto: world.repo,
          repo: world.repo,
          resolved: resolveWorkflow(world.paths, null),
        },
      );
      expect(world.out).toEqual([]);
      expect(pass.state.stoppedRemindedAt?.[original.id]).toBeUndefined();
      expect(readCrew(world.paths.stateDir, world.repo, original.id)?.state).toBe(state);
    },
  );

  test("a throttled stopped reminder skips its synchronous merge-tree check", async () => {
    const world = await leadWorld();
    const stopped = await addCrew(world, "working");
    git(world.repo, "worktree", "add", "-b", stopped.branch, stopped.worktree);
    writeFileSync(join(stopped.worktree, "unmerged.txt"), "unmerged work\n");
    git(stopped.worktree, "add", ".");
    git(stopped.worktree, "commit", "-m", "unmerged work");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      stopped.id,
      { state: "stopped" },
      T0 - 2 * 86_400_000,
    );
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("test requires git");
    const log = join(world.bin, "merge-tree.log");
    writeFileSync(log, "");
    const fakeGit = join(world.bin, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nif [ "$1" = "merge-tree" ]; then printf 'replay\\n' >> "$MERGE_LOG"; fi\nexec "$REAL_GIT" "$@"\n`,
    );
    chmodSync(fakeGit, 0o755);
    const ctx = world.ctx({}, { FAKE_AGENTS_JSON: "[]", REAL_GIT: realGit, MERGE_LOG: log });
    const scope: WatchScope = {
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved: resolveWorkflow(world.paths, null),
    };
    const state: WatchState = {
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: {},
      noted: true,
      parkedAt: T0,
      stoppedRemindedAt: { [stopped.id]: T0 - 60_000 },
    };
    const throttled = await watchPass(state, ctx, scope);
    // The ordinary merge detection still runs once; no second replay for the hidden reminder.
    expect(readFileSync(log, "utf8")).toBe("replay\n");
    expect(world.out).toEqual([]);
    writeFileSync(log, "");
    await watchPass(throttled.state, { ...ctx, now: () => T0 + 86_400_000 }, scope);
    expect(readFileSync(log, "utf8")).toBe("replay\nreplay\n");
    expect(world.out.join("\n")).toContain("crew resume");
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
        "--",
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

  test("WF1: a resume that starts a copy: the record follows it, and the next pass does not mark it stopped", async () => {
    // The live case (2026-10-25): the record held c7186986, Claude Code opened d7a54fc8, the
    // record kept the old id, and ten seconds later the watch read the old row as stopped.
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world, {
      sessionId: "c7186986-0000-1111-2222-333333333333",
      shortId: "c7186986",
    });
    const copy = {
      id: "a1b2c3d4",
      pid: 4242,
      sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
      state: "working",
    };
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    // Its old session has no process; the resume starts a copy, which agent view lists.
    const old = { id: "c7186986", sessionId: "c7186986-0000-1111-2222-333333333333" };
    const first = await watchPass(
      fresh(world),
      world.ctx(
        { now: () => T0 },
        {
          FAKE_AGENTS_JSON: JSON.stringify([{ ...old, state: "done" }, copy]),
          FAKE_RESUME: "copy",
        },
      ),
      scope,
    );
    expect(world.out).toEqual([
      `${NAME}: working — the wait is over; it was resumed as session a1b2c3d4 (a copy of c7186986)`,
    ]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
      shortId: "a1b2c3d4",
      state: "working",
    });
    // Ten seconds later agent view says the old session is stopped: it is not this record's any more.
    const second = await watchPass(
      first.state,
      world.ctx(
        { now: () => T0 + 10_000 },
        { FAKE_AGENTS_JSON: JSON.stringify([{ ...old, state: "stopped" }, copy]) },
      ),
      scope,
    );
    expect(second.lines).toBe(0);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("working");
  });

  test("WF1: a resume that prints no session id is one line; it stays paused, and the watch does not try again", async () => {
    const world = await leadWorld();
    const resolved = resolvedOf(world);
    const record = await pausedCrew(world);
    const ctx = world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "[]", FAKE_BG: "noline" });
    const scope: WatchScope = {
      gateway: () => Promise.resolve(facts()),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved,
    };
    const done = await watchPass(fresh(world), ctx, scope);
    expect(world.out).toEqual([
      `${NAME}: not resumed — claude --bg --resume ${record.sessionId} printed no line backgrounded · <id>, so the session it started is not known; see claude agents before you resume it again; the watch leaves it paused: ${COMMAND} crew resume "${NAME}" brings it back`,
    ]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
    // A second try could start a second unnamed session: the next pass leaves it alone.
    const again = await watchPass(
      done.state,
      world.ctx({ now: () => T0 + 60_000 }, { FAKE_AGENTS_JSON: "[]", FAKE_BG: "noline" }),
      scope,
    );
    expect(again.lines).toBe(0);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
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

/**
 * WF1: one acting watch per lead. Seen live on 2026-10-25: 13 watches whose monitor had ended
 * (parent pid 1), up to 30 hours old, up to 5 for one lead, each starting, resuming and stopping
 * crew sessions and writing the same state file.
 */
describe("WF1: one acting watch per lead", () => {
  /** A step of the crew session in the log: news a watch that acts would say. */
  async function step(world: Awaited<ReturnType<typeof leadWorld>>, text: string): Promise<void> {
    await appendCrewEvent(
      world.paths.stateDir,
      world.repo,
      { crew: ID, lead: LEAD_SESSION, name: NAME, state: "working", text, type: "step" },
      T0,
    );
  }

  /**
   * A context whose `sleep` runs `between` once — what happens while the watch waits for its next
   * pass — and refuses a second wait, so a watch that does not end fails the test, never hangs it.
   */
  function waiting(
    world: Awaited<ReturnType<typeof leadWorld>>,
    between: () => Promise<void>,
    change: Partial<CrewContext> = {},
  ): CrewContext {
    let waits = 0;
    return world.ctx({
      ...change,
      sleep: async () => {
        waits += 1;
        if (waits > 1) throw new Error("the watch went on to a third pass");
        await between();
      },
    });
  }

  /** A lease another watch of this test's own process holds: alive, with a token of its own. */
  function newer(token = "the-newer-watch"): WatchLease {
    return { ...currentHolder(), at: T0, token };
  }

  /** A lease whose process is gone: a pid that ran and ended. */
  function deadLease(): WatchLease {
    const ended = Bun.spawnSync(["true"]);
    return { ...currentHolder(), at: T0, pid: ended.pid, token: "a-watch-that-died" };
  }

  test("a newer watch takes over: the older one says so once and ends before it acts", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const offset = () => readWatchState(world.paths.stateDir, world.repo, LEAD_SESSION)?.offset;
    let written: number | undefined;
    const ctx = waiting(world, async () => {
      // Its first pass held the lease and wrote its state. Then a restarted monitor's watch
      // takes the lease, and news arrives.
      written = offset();
      await takeWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION, newer());
      await step(world, "tests-green");
    });
    expect(await runCrew(["watch", "--once", "--timeout", "60"], ctx)).toBe(0);
    // It ended before its next pass: the step it would have said is left to the newer watch, and
    // it wrote no state after it lost the lease.
    expect(world.out).toEqual([
      `crew watch: a newer watch of this lead runs (pid ${process.pid}); this one ends`,
    ]);
    expect(written).toBeGreaterThan(0);
    expect(offset()).toBe(written);
    expect(readWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION)?.token).toBe(
      "the-newer-watch",
    );
  });

  test("a watch takes the lease when it starts, whoever holds it: the newest wins", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    await takeWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION, newer("an-older-watch"));
    await step(world, "tests-red");
    expect(await runCrew(["watch", "--once", "--timeout", "0"], world.ctx())).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: tests-red"]);
    const held = readWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION);
    expect(held?.pid).toBe(process.pid);
    expect(held?.token).not.toBe("an-older-watch");
  });

  test("a lease whose watch died is free: the watch takes it back and goes on", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const ctx = waiting(world, async () => {
      await takeWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION, deadLease());
      await step(world, "committed");
    });
    expect(await runCrew(["watch", "--once", "--timeout", "60"], ctx)).toBe(0);
    expect(world.out).toEqual(["C my-app B6b portal-live: committed"]);
    expect(readWatchLease(world.paths.stateDir, world.repo, LEAD_SESSION)?.pid).toBe(process.pid);
  });

  test("a watch whose parent is gone ends, before it acts", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    let parent = 4100;
    const ctx = waiting(
      world,
      async () => {
        // Claude Code ended the monitor's shell: the watch was re-parented.
        parent = 1;
        await step(world, "tests-green");
      },
      { parentPid: () => parent },
    );
    expect(await runCrew(["watch", "--once", "--timeout", "60"], ctx)).toBe(0);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual(["crew watch: the process that started it ended; this watch ends"]);
  });

  test("a watch whose stdout is closed ends, before it acts", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    let closed = false;
    const ctx = waiting(
      world,
      async () => {
        closed = true;
        await step(world, "tests-green");
      },
      { outputClosed: () => closed },
    );
    expect(await runCrew(["watch", "--once", "--timeout", "60"], ctx)).toBe(0);
    expect(world.out).toEqual([]);
    expect(world.err).toEqual(["crew watch: nobody reads its output any more; this watch ends"]);
  });

  // A file mode does not stop root, so this test means nothing there.
  test.skipIf(process.getuid?.() === 0)(
    "a lease it cannot read ends the watch as a failed pass does: one line, exit 1",
    async () => {
      const world = await leadWorld();
      await addCrew(world, "working");
      const file = watchLeaseFile(world.paths.stateDir, world.repo, LEAD_SESSION);
      const ctx = waiting(world, async () => {
        chmodSync(file, 0o000);
        await step(world, "tests-green");
      });
      let code: number;
      try {
        code = await runCrew(["watch", "--once", "--timeout", "60"], ctx);
      } finally {
        chmodSync(file, 0o600);
      }
      expect(code).toBe(1);
      expect(world.out).toEqual([]);
      expect(world.err).toHaveLength(1);
      expect(world.err[0]).toStartWith("crew watch: EACCES");
    },
  );

  test("two leads never share a lease", async () => {
    const world = await leadWorld();
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
    await addCrew(world, "working");
    // The other lead's watch holds its own lease, alive: this lead's watch acts all the same.
    await takeWatchLease(world.paths.stateDir, world.repo, OTHER_SESSION, newer("other-lead"));
    const ctx = waiting(world, async () => {
      await takeWatchLease(world.paths.stateDir, world.repo, OTHER_SESSION, newer("other-again"));
      await step(world, "tests-green");
    });
    expect(await runCrew(["watch", "--once", "--timeout", "60", "--lead", LEAD_SESSION], ctx)).toBe(
      0,
    );
    expect(world.out).toEqual(["C my-app B6b portal-live: tests-green"]);
    expect(watchLeaseFile(world.paths.stateDir, world.repo, LEAD_SESSION)).not.toBe(
      watchLeaseFile(world.paths.stateDir, world.repo, OTHER_SESSION),
    );
    expect(readWatchLease(world.paths.stateDir, world.repo, OTHER_SESSION)?.token).toBe(
      "other-again",
    );
  });

  test("a pass whose watch lost the lease before its resumes resumes nothing", async () => {
    const world = await leadWorld();
    const record = await addCrew(world, "paused", {
      lastPause: { backoffMs: 0, since: "2026-10-21T09:50:00.000Z" },
      waitingFor: { kind: "unknown", since: "2026-10-21T09:50:00.000Z" },
    });
    mkdirSync(record.worktree, { recursive: true });
    writeStoreFile(crewSettingsFile(world.paths.stateDir, world.repo, record.id), "{}\n");
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("the world's repo is not a checkout");
    const scope: WatchScope = {
      gateway: () => Promise.resolve({ breakers: {}, inUse: null, limits: {}, requests: 10 }),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      // A newer watch took the lease while this pass ran: the check before the resume says so.
      goesOn: () => Promise.reject(new WatchEnd("print", "a newer watch of this lead runs")),
      resolved: resolveWorkflow(world.paths, loadProjectConfig(checkout).config),
    };
    const state: WatchState = {
      noted: true,
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: {},
    };
    await expect(
      watchPass(state, world.ctx({ now: () => T0 }, { FAKE_AGENTS_JSON: "[]" }), scope),
    ).rejects.toBeInstanceOf(WatchEnd);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
  });

  test("a pass that may not act now starts no queued crew session; one that may, does", async () => {
    const world = await leadWorld();
    await queuedCrew(world);
    const checkout = locateCheckout(world.repo, { env: world.ctx().env });
    if (checkout === null) throw new Error("the world's repo is not a checkout");
    const scope = (acts: boolean): WatchScope => ({
      goesOn: () => Promise.resolve(acts),
      leadSessionId: LEAD_SESSION,
      mergeInto: world.repo,
      repo: world.repo,
      resolved: resolveWorkflow(world.paths, loadProjectConfig(checkout).config),
    });
    const state: WatchState = {
      noted: true,
      offset: eventsEndOffset(world.paths.stateDir, world.repo),
      said: {},
    };
    const queued = () =>
      listCrew(world.paths.stateDir, world.repo).records.find((one) => one.id === QUEUED_ID)?.state;
    await watchPass(state, world.ctx(), scope(false));
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    expect(queued()).toBe("queued");
    await watchPass(state, world.ctx(), scope(true));
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    expect(queued()).toBe("starting");
  });

  test("a store too busy to answer skips a pass; the watch goes on, and says the news after", async () => {
    const world = await leadWorld();
    await addCrew(world, "working");
    const lock = join(crewStoreDir(world.paths.stateDir, world.repo), "lock");
    let waits = 0;
    const ctx = world.ctx({
      sleep: async () => {
        waits += 1;
        if (waits === 1) {
          // News, then another writer holds the store's lock past the watch's wait.
          await step(world, "tests-green");
          writeFileSync(
            lock,
            JSON.stringify({ ...currentHolder(), time: Date.now(), token: "another-writer" }),
          );
        } else if (waits === 2) {
          rmSync(lock);
        } else {
          throw new Error("the watch went on to a fourth pass");
        }
      },
    });
    expect(await runCrew(["watch", "--once", "--timeout", "60"], ctx)).toBe(0);
    // The busy pass said nothing and ended nothing; the next one said the news.
    expect(world.err).toEqual([]);
    expect(world.out).toEqual(["C my-app B6b portal-live: tests-green"]);
    expect(waits).toBe(2);
  }, 15_000);
});

describe("WF1: the lease in the store", () => {
  test("held by its own token; taken back from a watch that died; never from a live one", async () => {
    const world = await leadWorld();
    const { stateDir } = world.paths;
    const mine: WatchLease = { ...currentHolder(), at: T0, token: "mine" };
    const theirs: WatchLease = { ...currentHolder(), at: T0, token: "theirs" };
    // No lease yet: free, so it is taken.
    expect(await keepWatchLease(stateDir, world.repo, LEAD_SESSION, mine)).toEqual({ held: true });
    expect(await keepWatchLease(stateDir, world.repo, LEAD_SESSION, mine)).toEqual({ held: true });
    await takeWatchLease(stateDir, world.repo, LEAD_SESSION, theirs);
    const lost = await keepWatchLease(stateDir, world.repo, LEAD_SESSION, mine);
    expect(lost.held).toBe(false);
    expect(lost.held ? null : lost.holder.token).toBe("theirs");
    const ended = Bun.spawnSync(["true"]);
    await takeWatchLease(stateDir, world.repo, LEAD_SESSION, { ...theirs, pid: ended.pid });
    expect(await keepWatchLease(stateDir, world.repo, LEAD_SESSION, mine)).toEqual({ held: true });
    expect(readWatchLease(stateDir, world.repo, LEAD_SESSION)?.token).toBe("mine");
  });

  test("a lease file that cannot be read is free", async () => {
    const world = await leadWorld();
    const { stateDir } = world.paths;
    writeStoreFile(watchLeaseFile(stateDir, world.repo, LEAD_SESSION), "{ half a file");
    expect(readWatchLease(stateDir, world.repo, LEAD_SESSION)).toBeNull();
    const mine: WatchLease = { ...currentHolder(), at: T0, token: "mine" };
    expect(await keepWatchLease(stateDir, world.repo, LEAD_SESSION, mine)).toEqual({ held: true });
  });
});
