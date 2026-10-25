/**
 * The run records (`runs.ts`, `runs-history.ts`): what a plan's folder keeps of each crew run, how
 * the store's writers feed it, and what `crew history` reads back. Every plan, store and repo is
 * a temp folder; the times are fixed by hand, so every expected value is written out.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CrewWorld,
  crewWorld,
  LEAD_SESSION,
  SESSION_PID,
  writeSessionRecord,
} from "../testing/crew-world";
import { tempDir } from "../testing/temp";
import { runCrew } from "./command";
import {
  briefHash,
  findPlanFile,
  livePlanFolder,
  planBriefFile,
  planFileOfLead,
  type RunRecord,
  readRunFile,
  readRuns,
  runFile,
} from "./runs";
import {
  addCrewQuestion,
  answerCrewQuestion,
  CREW_STORE_VERSION,
  createCrew,
  type HandBackReport,
  listLeads,
  type NewCrew,
  noteCrewRun,
  recordCrewReport,
  setRunFailureWriter,
  updateCrew,
  writeLead,
} from "./store";

const MIN = 60_000;
const T0 = Date.parse("2026-10-25T10:00:00.000Z");
const SHA = "a".repeat(40);
const LEAD_ONE = { name: "LEAD my-app master-plan", sessionId: "lead-one" };
const LEAD_TWO = { name: "LEAD my-app master-plan 2", sessionId: "lead-two" };

/** A plan file in a temp plans folder, and the repo and state folders beside it. */
function planWorld() {
  const root = tempDir("plan-world");
  const plans = join(root, "plans");
  mkdirSync(plans, { recursive: true });
  const planFile = join(plans, "2026-10-21-master-plan.md");
  writeFileSync(planFile, "# the plan\n");
  return { plans, planFile, repo: join(root, "repo"), state: join(root, "state") };
}

/** A crew session as `crew start` records it, with the run record on when `planFile` is given. */
function newCrew(repo: string, planFile: null | string, id = "PL1-runs-aaaaaa"): NewCrew {
  return {
    base: null,
    baseRef: "release-1.2.1",
    branch: `crew/${id.split("-").slice(0, 2).join("-")}`,
    briefSource: { path: "/briefs/PL1-runs.md", sha256: briefHash("the brief") },
    continues: null,
    effort: "high",
    files: [],
    id,
    kind: "build",
    lastLine: null,
    leadName: LEAD_ONE.name,
    leadSessionId: LEAD_ONE.sessionId,
    memoryMb: null,
    model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
    name: `C my-app master-plan ${id}`,
    permissionMode: "auto",
    phase: id.split("-")[0] ?? "PL1",
    plan: "master-plan",
    planFile,
    pr: null,
    questions: [],
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: id.split("-")[1] ?? "runs",
    state: "queued",
    waitsFor: [],
    worktree: `${repo}/.claude/worktrees/crew-${id}`,
  };
}

function report(status: HandBackReport["status"] = "done"): HandBackReport {
  return {
    base: { ref: "release-1.2.1", sha: SHA },
    branch: { name: "crew/PL1-runs", sha: "b".repeat(40) },
    changed: { deletions: 1, files: 2, insertions: 30 },
    checks: [
      { name: "lint", note: null, ok: true },
      { name: "typecheck", note: "one error", ok: false },
    ],
    docs: [],
    needsLead: [],
    open: [],
    outsideBrief: [],
    phase: "PL1",
    pr: null,
    question: null,
    review: {
      agent: "cc-smart-dev-kit:reviewer",
      effort: "high",
      findings: [],
      model: "sonnet",
      sha: "b".repeat(40),
    },
    status,
    tests: {
      full: { command: "bun test", failed: 1, ok: false, passed: 99 },
      targeted: [{ command: "bun test src/crew", failed: 0, ok: true, passed: 10 }],
    },
    version: CREW_STORE_VERSION,
  };
}

/** Runs `crew <argv>` in the world and returns what it printed. */
async function run(world: CrewWorld, argv: string[]) {
  world.out.length = 0;
  world.err.length = 0;
  const code = await runCrew(argv, world.ctx());
  return { code, err: [...world.err], out: [...world.out] };
}

/** The run record of `id`, read from the plan's folder. */
function runOf(planFile: string, id = "PL1-runs-aaaaaa"): RunRecord {
  const run = readRunFile(runFile(planFile, id));
  if (run === null) throw new Error(`no run record for ${id}`);
  return run;
}

describe("where a plan's briefs and runs live", () => {
  test("the folder is the plan's file without .md, and a brief is named as the crew branch", () => {
    expect(planBriefFile("/plans/2026-10-21-master-plan.md", "PL1", "plan-folder-runs")).toBe(
      "/plans/2026-10-21-master-plan/briefs/PL1-plan-folder-runs.md",
    );
    expect(runFile("/plans/2026-10-21-master-plan.md", "PL1-x-1")).toBe(
      "/plans/2026-10-21-master-plan/runs/PL1-x-1.json",
    );
  });

  test("an archived plan's folder is found beside its old place", () => {
    const { plans, planFile } = planWorld();
    mkdirSync(join(plans, "2026-10-21-master-plan", "runs"), { recursive: true });
    expect(livePlanFolder(planFile)).toBe(join(plans, "2026-10-21-master-plan"));
    mkdirSync(join(plans, "archive"), { recursive: true });
    renameSync(planFile, join(plans, "archive", "2026-10-21-master-plan.md"));
    renameSync(
      join(plans, "2026-10-21-master-plan"),
      join(plans, "archive", "2026-10-21-master-plan"),
    );
    expect(livePlanFolder(planFile)).toBe(join(plans, "archive", "2026-10-21-master-plan"));
  });

  test("a plan is found by its slug when exactly one file matches", () => {
    const { plans, planFile } = planWorld();
    expect(findPlanFile("master-plan", [plans])).toEqual({ file: planFile, ok: true });
    expect(findPlanFile("other", [plans])).toEqual({ matches: [], ok: false, reason: "none" });
    writeFileSync(join(plans, "2026-10-25-master-plan.md"), "again\n");
    const several = findPlanFile("master-plan", [plans]);
    expect(several.ok).toBe(false);
    expect(!several.ok && several.reason).toBe("several");
  });

  test("the archive folder of a plans folder is searched too", () => {
    const { plans } = planWorld();
    mkdirSync(join(plans, "archive"), { recursive: true });
    writeFileSync(join(plans, "archive", "2026-09-01-old-plan.md"), "old\n");
    expect(findPlanFile("old-plan", [plans])).toEqual({
      file: join(plans, "archive", "2026-09-01-old-plan.md"),
      ok: true,
    });
  });

  test("a lead's plan file: its own, else an earlier lead of the same plan, else the lookup", () => {
    const none = () => ({ matches: [], ok: false as const, reason: "none" as const });
    expect(planFileOfLead({ plan: "p", planFile: "/a.md" }, [], none)).toEqual({
      file: "/a.md",
      ok: true,
    });
    expect(
      planFileOfLead(
        { plan: "p" },
        [
          { plan: "q", planFile: "/q.md" },
          { plan: "p", planFile: "/p.md" },
        ],
        none,
      ),
    ).toEqual({ file: "/p.md", ok: true });
    expect(planFileOfLead({ plan: "p" }, [], none).ok).toBe(false);
  });
});

describe("the record of a run", () => {
  test("at the start: who, what, on which model, from which brief, under which lead", async () => {
    const { planFile, repo, state } = planWorld();
    await createCrew(state, newCrew(repo, planFile), T0);
    const run = runOf(planFile);
    expect(run.id).toBe("PL1-runs-aaaaaa");
    expect(run.phase).toBe("PL1");
    expect(run.slug).toBe("runs");
    expect(run.kind).toBe("build");
    expect(run.model).toEqual({ named: "sonnet", resolved: "claude-sonnet-5-5", slot: null });
    expect(run.effort).toBe("high");
    expect(run.baseRef).toBe("release-1.2.1");
    expect(run.branch).toBe("crew/PL1-runs");
    expect(run.brief).toEqual({
      path: "/briefs/PL1-runs.md",
      sha256: "ec3f4a4cd18a80ef0278399034b7262590a4c80ed67cadddb91c6e8769e387b9",
    });
    expect(run.lead).toEqual(LEAD_ONE);
    expect(run.events.map((one) => [one.kind, one.state])).toEqual([["created", "queued"]]);
    expect(run.times.createdAt).toBe("2026-10-25T10:00:00.000Z");
    expect(run.times.startedAt).toBeNull();
  });

  test("a crew session with no plan file leaves no run record and no folder", async () => {
    const { plans, repo, state } = planWorld();
    await createCrew(state, newCrew(repo, null), T0);
    await updateCrew(state, repo, "PL1-runs-aaaaaa", { state: "starting" }, T0 + MIN);
    expect(readdirSync(plans)).toEqual(["2026-10-21-master-plan.md"]);
  });

  test("a resume under a second session id adds it; the same id twice adds nothing", async () => {
    const { planFile, repo, state } = planWorld();
    await createCrew(state, newCrew(repo, planFile), T0);
    const id = "PL1-runs-aaaaaa";
    await updateCrew(
      state,
      repo,
      id,
      {
        sessionId: "session-1",
        shortId: "s1s1s1s1",
        startedAt: "2026-10-25T10:01:00.000Z",
        state: "starting",
      },
      T0 + MIN,
    );
    await updateCrew(state, repo, id, { state: "working" }, T0 + 2 * MIN);
    await updateCrew(
      state,
      repo,
      id,
      { sessionId: "session-2", shortId: "s2s2s2s2" },
      T0 + 30 * MIN,
    );
    await updateCrew(
      state,
      repo,
      id,
      { sessionId: "session-2", shortId: "s2s2s2s2" },
      T0 + 31 * MIN,
    );
    expect(runOf(planFile).sessions.map((one) => [one.sessionId, one.at])).toEqual([
      ["session-1", "2026-10-25T10:01:00.000Z"],
      ["session-2", "2026-10-25T10:30:00.000Z"],
    ]);
  });

  test("a pause keeps its reason and its length; the working time leaves it out", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await updateCrew(
      state,
      repo,
      id,
      { sessionId: "s", shortId: "s", startedAt: "2026-10-25T10:10:00.000Z", state: "starting" },
      T0 + 10 * MIN,
    );
    await updateCrew(state, repo, id, { state: "working" }, T0 + 11 * MIN);
    await updateCrew(
      state,
      repo,
      id,
      {
        state: "paused",
        waitingFor: { kind: "claude-limit", model: "claude-opus-5-5", resetsAt: null },
      },
      T0 + 20 * MIN,
    );
    await updateCrew(state, repo, id, { state: "working" }, T0 + 30 * MIN);
    await recordCrewReport(state, repo, id, report(), T0 + 60 * MIN);
    const { times } = runOf(planFile);
    expect(times.pauses).toEqual([
      { from: "2026-10-25T10:20:00.000Z", reason: "claude-limit", to: "2026-10-25T10:30:00.000Z" },
    ]);
    expect(times.pausedMs).toBe(10 * MIN);
    expect(times.queuedMs).toBe(10 * MIN);
    expect(times.finishedAt).toBe("2026-10-25T11:00:00.000Z");
    // Wall: recorded to finished. Working: started to finished, without the ten paused minutes.
    expect(times.wallMs).toBe(60 * MIN);
    expect(times.workingMs).toBe(40 * MIN);
  });

  test("a run that works again after it reported has not finished; when it ends again, that is the end", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await updateCrew(
      state,
      repo,
      id,
      { startedAt: "2026-10-25T10:00:00.000Z", state: "working" },
      T0 + MIN,
    );
    await updateCrew(state, repo, id, { state: "done" }, T0 + 30 * MIN);
    expect(runOf(planFile).times.finishedAt).toBe("2026-10-25T10:30:00.000Z");
    await updateCrew(state, repo, id, { state: "working" }, T0 + 40 * MIN);
    expect(runOf(planFile).times.finishedAt).toBeNull();
    expect(runOf(planFile).times.workingMs).toBeNull();
    await updateCrew(state, repo, id, { state: "done" }, T0 + 70 * MIN);
    const { times } = runOf(planFile);
    expect(times.finishedAt).toBe("2026-10-25T11:10:00.000Z");
    expect(times.workingMs).toBe(70 * MIN);
  });

  test("a question and its answer, each with the time and the lead who answered", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await addCrewQuestion(
      state,
      repo,
      id,
      { options: ["a", "b"], question: "Which one?\nMore text", recommended: 1 },
      T0 + 5 * MIN,
    );
    await answerCrewQuestion(state, repo, id, 0, "Take b", T0 + 9 * MIN, "working", null, LEAD_TWO);
    const events = runOf(planFile).events.filter((one) =>
      ["question", "answer"].includes(one.kind),
    );
    expect(events.map((one) => [one.kind, one.at, one.text, one.by])).toEqual([
      ["question", "2026-10-25T10:05:00.000Z", "Which one?", null],
      ["answer", "2026-10-25T10:09:00.000Z", "Take b", LEAD_TWO],
    ]);
  });

  test("a report records its status, the tests, the checks and the review", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await recordCrewReport(state, repo, id, report(), T0 + MIN, 184_000);
    const event = runOf(planFile).events.find((one) => one.kind === "report");
    expect(event?.text).toBe("done");
    // The context its last reply used, when the report's caller read the transcript.
    expect(runOf(planFile).contextTokens).toBe(184_000);
    expect(event?.detail).toEqual({
      checksFailed: 1,
      review: { agent: "cc-smart-dev-kit:reviewer", effort: "high", model: "sonnet" },
      sha: "b".repeat(40),
      status: "done",
      testsFailed: 1,
      testsPassed: 109,
      wholeSuite: false,
    });
  });

  test("a merge and a removal name the lead that made them, and the record stays", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await recordCrewReport(state, repo, id, report(), T0 + MIN);
    await updateCrew(
      state,
      repo,
      id,
      {
        mergeProof: { head: "b".repeat(40), leadCommit: "c".repeat(40), leadRef: "release-1.2.1" },
        state: "merged",
      },
      T0 + 5 * MIN,
      "the lead merged its branch",
      null,
      LEAD_TWO,
    );
    await updateCrew(
      state,
      repo,
      id,
      { state: "removed" },
      T0 + 6 * MIN,
      "removed",
      null,
      LEAD_TWO,
    );
    const run = runOf(planFile);
    const merged = run.events.find((one) => one.kind === "merged");
    expect(merged?.by).toEqual(LEAD_TWO);
    expect(merged?.detail).toEqual({
      commit: "c".repeat(40),
      head: "b".repeat(40),
      leadRef: "release-1.2.1",
    });
    expect(run.events.find((one) => one.kind === "removed")?.by).toEqual(LEAD_TWO);
    expect(run.times.mergedAt).toBe("2026-10-25T10:05:00.000Z");
    expect(run.times.removedAt).toBe("2026-10-25T10:06:00.000Z");
    expect(run.state).toBe("removed");
  });

  test("an act with no lead named falls back to the lead the crew session belongs to", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await updateCrew(state, repo, id, { state: "removed" }, T0 + MIN);
    expect(runOf(planFile).events.find((one) => one.kind === "removed")?.by).toEqual(LEAD_ONE);
  });

  test("a continuation is its own run, linked both ways", async () => {
    const { planFile, repo, state } = planWorld();
    await createCrew(state, newCrew(repo, planFile), T0);
    await updateCrew(state, repo, "PL1-runs-aaaaaa", { state: "handoff" }, T0 + MIN);
    await createCrew(
      state,
      { ...newCrew(repo, planFile, "PL1-runs-bbbbbb"), continues: "PL1-runs-aaaaaa" },
      T0 + 2 * MIN,
    );
    expect(runOf(planFile, "PL1-runs-aaaaaa").continuedBy).toBe("PL1-runs-bbbbbb");
    expect(runOf(planFile, "PL1-runs-bbbbbb").continues).toBe("PL1-runs-aaaaaa");
    expect(readRuns(planFile).runs.map((one) => one.id)).toEqual([
      "PL1-runs-aaaaaa",
      "PL1-runs-bbbbbb",
    ]);
  });

  test("the plan archived with its folder: later changes land in the archive", async () => {
    const { plans, planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    mkdirSync(join(plans, "archive"), { recursive: true });
    renameSync(planFile, join(plans, "archive", "2026-10-21-master-plan.md"));
    renameSync(
      join(plans, "2026-10-21-master-plan"),
      join(plans, "archive", "2026-10-21-master-plan"),
    );
    await updateCrew(state, repo, id, { state: "removed" }, T0 + MIN);
    expect(existsSync(join(plans, "2026-10-21-master-plan"))).toBe(false);
    const run = readRunFile(join(plans, "archive", "2026-10-21-master-plan", "runs", `${id}.json`));
    expect(run?.events.map((one) => one.kind)).toEqual(["created", "removed"]);
    expect(readRuns(planFile).runs).toHaveLength(1);
  });

  test("two writers at once: no change is lost", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    const asks = Array.from({ length: 8 }, (_, n) =>
      addCrewQuestion(
        state,
        repo,
        id,
        { options: ["a", "b"], question: `Question ${n}`, recommended: null },
        T0 + n * MIN,
      ),
    );
    await Promise.all(asks);
    const questions = runOf(planFile).events.filter((one) => one.kind === "question");
    expect(questions.map((one) => one.text).sort()).toEqual(
      Array.from({ length: 8 }, (_, n) => `Question ${n}`),
    );
  });

  test("a note (MC1's model change) is kept as an event", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    await noteCrewRun(state, repo, id, T0 + MIN, {
      by: LEAD_ONE,
      detail: { from: "sonnet", to: "opus" },
      text: "model changed",
    });
    const note = runOf(planFile).events.find((one) => one.kind === "note");
    expect(note?.detail).toEqual({ from: "sonnet", to: "opus" });
    expect(note?.by).toEqual(LEAD_ONE);
  });

  test("a run record that cannot be written never undoes the change, and says so", async () => {
    const { planFile, repo, state } = planWorld();
    const id = "PL1-runs-aaaaaa";
    await createCrew(state, newCrew(repo, planFile), T0);
    writeFileSync(runFile(planFile, id), "{ not json");
    const said: string[] = [];
    const before = setRunFailureWriter((line) => said.push(line));
    try {
      const after = await updateCrew(state, repo, id, { state: "starting" }, T0 + MIN);
      expect(after.state).toBe("starting");
    } finally {
      setRunFailureWriter(before);
    }
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      "the run record of C my-app master-plan PL1-runs-aaaaaa was not written",
    );
    expect(said[0]).toContain("not valid JSON");
  });
});

describe("crew history", () => {
  /** A world with a lead that holds a plan file, and two recorded runs. */
  async function historyWorld() {
    const world = crewWorld();
    const plans = join(tempDir("plans"), "plans");
    mkdirSync(plans, { recursive: true });
    const planFile = join(plans, "2026-10-21-master-plan.md");
    writeFileSync(planFile, "# the plan\n");
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: LEAD_ONE.name,
        plan: "master-plan",
        planFile,
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "my-app",
      },
      T0,
    );
    const id = "PL1-runs-aaaaaa";
    await createCrew(world.paths.stateDir, newCrew(world.repo, planFile), T0);
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      id,
      {
        sessionId: "session-1",
        shortId: "s1s1s1s1",
        startedAt: "2026-10-25T10:10:00.000Z",
        state: "starting",
      },
      T0 + 10 * MIN,
    );
    await recordCrewReport(world.paths.stateDir, world.repo, id, report(), T0 + 100 * MIN);
    return { ...world, planFile, plans };
  }

  test("one line per run: phase, sessions, model and effort, started, finished, took, status", async () => {
    const world = await historyWorld();
    const lines = await run(world, ["history"]);
    expect(lines.out).toEqual([
      "2026-10-21-master-plan · " +
        join(world.plans, "2026-10-21-master-plan").replace(world.paths.home, "~"),
      "PL1    · runs · 1 session s1s1s1s1 · sonnet → claude-sonnet-5-5 high · started 2026-10-25 10:10 · finished 2026-10-25 11:40 · took 1 h 30 min · done",
    ]);
  });

  test("a phase filter, and --json", async () => {
    const world = await historyWorld();
    expect((await run(world, ["history", "ZZ9"])).out).toEqual([
      "No crew run of phase ZZ9 is recorded for 2026-10-21-master-plan.",
    ]);
    const json = JSON.parse((await run(world, ["history", "PL1", "--json"])).out.join("\n"));
    expect(json).toHaveLength(1);
    expect(json[0].sessions[0].sessionId).toBe("session-1");
  });

  test("it reads the runs after the plan is archived, by its stem", async () => {
    const world = await historyWorld();
    mkdirSync(join(world.plans, "archive"), { recursive: true });
    renameSync(world.planFile, join(world.plans, "archive", "2026-10-21-master-plan.md"));
    renameSync(
      join(world.plans, "2026-10-21-master-plan"),
      join(world.plans, "archive", "2026-10-21-master-plan"),
    );
    const ran = await run(world, ["history", "--plan", "2026-10-21-master-plan"]);
    expect(ran.code).toBe(0);
    expect(ran.out[1]).toContain("PL1");
  });

  test("--backfill writes the runs of the store that have no record, once, and says what it could not know", async () => {
    const world = await historyWorld();
    // An older run: its crew record has no plan file, so nothing recorded it as it happened.
    await createCrew(
      world.paths.stateDir,
      { ...newCrew(world.repo, null, "OLD1-past-cccccc"), plan: "master-plan" },
      T0 - 60 * MIN,
    );
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      "OLD1-past-cccccc",
      { state: "removed" },
      T0 - 30 * MIN,
    );
    const first = await run(world, ["history", "--backfill"]);
    expect(first.out[0]).toContain("backfill: wrote 1 run record for 2026-10-21-master-plan");
    expect(first.out[0]).toContain("OLD1-past-cccccc");
    expect(first.out[1]).toContain("it could not know: earlier Claude session ids");
    const past = readRunFile(runFile(world.planFile, "OLD1-past-cccccc"));
    expect(past?.backfilled).toHaveLength(3);
    expect(past?.events.map((one) => one.kind)).toEqual(["created", "removed"]);
    const second = await run(world, ["history", "--backfill"]);
    expect(second.out[0]).toBe("backfill: nothing to write for 2026-10-21-master-plan");
  });

  test("a mistake: no plan known, an unknown option, a bad phase", async () => {
    const world = crewWorld();
    expect((await run(world, ["history"])).code).toBe(1);
    expect((await run(world, ["history", "--nope"])).code).toBe(2);
    expect((await run(world, ["history", "not a phase"])).code).toBe(2);
  });
});

describe("the lead's plan file", () => {
  test("crew lead records --plan-file; a second lead of the same plan takes it over", async () => {
    const world = crewWorld();
    const plans = join(tempDir("plans"), "plans");
    mkdirSync(plans, { recursive: true });
    const planFile = join(plans, "2026-10-21-master-plan.md");
    writeFileSync(planFile, "# the plan\n");
    const first = await run(world, ["lead", "--plan", "master-plan", "--plan-file", planFile]);
    expect(first.code).toBe(0);
    expect(first.out[0]).toContain("plan file ");
    expect(listLeads(world.paths.stateDir, world.repo).records[0]?.planFile).toBe(planFile);
    // The second lead is a new session: it names the plan, not the file.
    writeSessionRecord(
      world.paths,
      SESSION_PID,
      "e22fabc6-5555-6666-7777-888888888888",
      world.repo,
    );
    const second = await run(world, ["lead", "--plan", "master-plan"]);
    expect(second.code).toBe(0);
    const leads = listLeads(world.paths.stateDir, world.repo).records;
    expect(leads.map((one) => one.planFile)).toEqual([planFile, planFile]);
  });

  test("a missing plan file is refused", async () => {
    const world = crewWorld();
    const ran = await run(world, ["lead", "--plan", "p", "--plan-file", "/nowhere/p.md"]);
    expect(ran.code).toBe(2);
    expect(ran.err.join("\n")).toContain("is no existing .md file");
  });

  test("crew lead is used by the history above; runCrew is the command", () => {
    expect(typeof runCrew).toBe("function");
  });
});
