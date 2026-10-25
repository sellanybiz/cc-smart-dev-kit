/**
 * `crew answer` (`answer.ts`): the lead's answer to a crew session's question (D36). A running
 * crew session gets the line the lead sends it with; a stopped one is resumed with the answer as its
 * next prompt (`claude --bg --resume <session id> "<text>"`).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { resumeArgs, runCrewAnswer } from "./answer";
import { runCrew } from "./command";
import {
  addCrewQuestion,
  answerCrewQuestion,
  createCrew,
  crewMcpFile,
  crewReportFile,
  crewSettingsFile,
  listCrew,
  markAnswerDelivered,
  openQuestionIndex,
  readCrewEvents,
  updateCrew,
  writeAnswerWatchBeat,
  writeLead,
  writeStoreFile,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "C my-app B6b portal-live";

/** The crew session's worktree and its own two files, as the world records them. */
function worktreeOf(world: ReturnType<typeof crewWorld>): string {
  return join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
}

/** The record's own files, as `crew start` writes them: a resume carries both. */
function filesOf(world: ReturnType<typeof crewWorld>): { mcp: string; settings: string } {
  return {
    mcp: crewMcpFile(world.paths.stateDir, world.repo, ID),
    settings: crewSettingsFile(world.paths.stateDir, world.repo, ID),
  };
}

/** A world with one crew session that asked a question, in `state`. */
async function askedWorld(
  state: "working" | "stopped" | "blocked" | "done" = "working",
  asks = true,
) {
  const world = crewWorld();
  const worktree = worktreeOf(world);
  mkdirSync(worktree, { recursive: true });
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
      worktree,
    },
    T0,
  );
  if (asks) {
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port?", recommended: 1 },
      T0,
    );
  }
  // Its own files, as `crew start` writes them: a resume carries them.
  writeStoreFile(crewSettingsFile(world.paths.stateDir, world.repo, ID), "{}\n");
  writeStoreFile(crewMcpFile(world.paths.stateDir, world.repo, ID), '{"mcpServers":{}}\n');
  return world;
}

describe("crew answer", () => {
  test("D36: a running crew session gets the line the lead sends it with, and the answer is recorded", async () => {
    const world = await askedWorld();
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // No heartbeat from the crew session's monitor: the answer is only recorded, and the lead
    // keeps the line it sends it with.
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "recorded, not delivered: no heartbeat from its monitor, so send it yourself:",
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]).toMatchObject({
      question: "which port?",
      answer: "the port is 3210",
      answeredAt: "2026-10-21T10:00:00.000Z",
      deliveredAt: null,
    });
  });

  test("AN1: a monitor that is alive delivers the answer: the command says delivered, and prints no SendMessage line", async () => {
    const world = await askedWorld();
    // The monitor beat 5 s ago.
    writeAnswerWatchBeat(world.paths.stateDir, world.repo, ID, T0 - 5000);
    // The command waits for the monitor; the monitor claims the answer while it waits.
    const ctx = world.ctx({
      sleep: async () => {
        await markAnswerDelivered(world.paths.stateDir, world.repo, ID, 0, T0 + 1000);
      },
    });
    expect(await runCrew(["answer", NAME, "the port is 3210"], ctx)).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "delivered: its monitor gave it to the session",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.deliveredAt).toBe("2026-10-21T10:00:01.000Z");
  });

  test("AN1: a monitor that is alive but has not passed it on in time: recorded, and the lead keeps the line", async () => {
    const world = await askedWorld();
    writeAnswerWatchBeat(world.paths.stateDir, world.repo, ID, T0 - 5000);
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "recorded, not delivered yet: its monitor is running but did not pass it on within 10 s; if the session stays silent, send it yourself (it then arrives twice):",
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    ]);
  });

  test("AN1: a heartbeat that is old counts as no monitor: recorded only, with the age", async () => {
    const world = await askedWorld();
    writeAnswerWatchBeat(world.paths.stateDir, world.repo, ID, T0 - 125_000);
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "recorded, not delivered: its monitor's last heartbeat was 125 s ago, so send it yourself:",
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    ]);
  });

  test("AN1: a second answer is a correction: the first is kept as superseded, the new one says it replaces it", async () => {
    const world = await askedWorld();
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    // The session heard the first one (sent by hand, then marked by its monitor).
    await markAnswerDelivered(world.paths.stateDir, world.repo, ID, 0, T0);
    world.out.length = 0;
    expect(await runCrew(["answer", NAME, "sorry, 3211"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "corrected the answer to C my-app B6b portal-live: which port?",
      "recorded, not delivered: no heartbeat from its monitor, so send it yourself:",
      'SendMessage {"to":"C my-app B6b portal-live","message":"Your lead CORRECTS its earlier answer to your question \\"which port?\\": this REPLACES the earlier answer (\\"the port is 3210\\"). Follow this one instead:\\nsorry, 3211"}',
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]).toMatchObject({
      answer: "sorry, 3211",
      deliveredAt: null,
      superseded: [
        {
          answer: "the port is 3210",
          answeredAt: "2026-10-21T10:00:00.000Z",
          deliveredAt: "2026-10-21T10:00:00.000Z",
        },
      ],
    });
  });

  test("AN1: a correction of an answer the session never heard says nothing of replacing it", async () => {
    const world = await askedWorld();
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    world.out.length = 0;
    expect(await runCrew(["answer", NAME, "sorry, 3211"], world.ctx())).toBe(0);
    expect(world.out[2]).toBe(
      'SendMessage {"to":"C my-app B6b portal-live","message":"sorry, 3211"}',
    );
  });

  test("AN1: the person's click with no monitor running is told no SendMessage line: they cannot send it", async () => {
    const world = await askedWorld("blocked");
    const ctx = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    expect(await runCrew(["answer", "--as-person", "--", NAME, "3210"], ctx)).toBe(0);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "recorded, not delivered: no heartbeat from its monitor, so it hears the answer when its monitor next runs, or when its lead sends it",
    ]);
  });

  test("AN1: a correction through a live monitor is delivered the same way", async () => {
    const world = await askedWorld();
    writeAnswerWatchBeat(world.paths.stateDir, world.repo, ID, T0 - 5000);
    await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    await markAnswerDelivered(world.paths.stateDir, world.repo, ID, 0, T0);
    world.out.length = 0;
    const ctx = world.ctx({
      sleep: async () => {
        await markAnswerDelivered(world.paths.stateDir, world.repo, ID, 0, T0 + 1000);
      },
    });
    expect(await runCrew(["answer", NAME, "sorry, 3211"], ctx)).toBe(0);
    expect(world.out).toEqual([
      "corrected the answer to C my-app B6b portal-live: which port?",
      "delivered: its monitor gave the session your correction, which replaces your earlier answer",
    ]);
  });

  test("AN1: a question closed by the phase's end takes no correction", async () => {
    const world = await askedWorld();
    await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    await updateCrew(world.paths.stateDir, world.repo, ID, { state: "done" }, T0 + 1000);
    world.err.length = 0;
    expect(await runCrew(["answer", NAME, "sorry, 3211"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME} is finished (done), so its answer cannot be corrected`,
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
    expect(record?.questions[0]?.superseded).toBeUndefined();
  });

  test("AN1: a stopped crew session is resumed with the correction as its prompt, and the record says delivered", async () => {
    const world = await askedWorld("stopped");
    // The first answer was recorded while it ran; it stopped before it read it.
    await answerCrewQuestion(world.paths.stateDir, world.repo, ID, 0, "the port is 3210", T0);
    await markAnswerDelivered(world.paths.stateDir, world.repo, ID, 0, T0);
    expect(await runCrew(["answer", NAME, "sorry, 3211"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    const resume = world.claudeCalls().find((call) => call[0] === "--bg");
    // The fake logs one argument per line, so a prompt with a line break is read back joined.
    expect(resume?.slice(resume.indexOf("--", 3) + 1).join("\n")).toBe(
      'Your lead CORRECTS its earlier answer to your question "which port?": this REPLACES the earlier answer ("the port is 3210"). Follow this one instead:\nsorry, 3211',
    );
    expect(world.out).toEqual([`answered ${NAME}: resumed with your correction · which port?`]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]).toMatchObject({
      answer: "sorry, 3211",
      deliveredAt: "2026-10-21T10:00:00.000Z",
    });
    expect(record?.state).toBe("working");
  });

  test("AN1: a stopped crew session resumed with its first answer is delivered in the same write", async () => {
    const world = await askedWorld("stopped");
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.deliveredAt).toBe("2026-10-21T10:00:00.000Z");
  });

  test("D36: a quote or a line break in the answer is escaped, never changed", async () => {
    const world = await askedWorld();
    await runCrew(["answer", NAME, 'use "3210"\nnot 3211'], world.ctx());
    expect(world.out[2]).toBe(
      'SendMessage {"to":"C my-app B6b portal-live","message":"use \\"3210\\"\\nnot 3211"}',
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe('use "3210"\nnot 3211');
  });

  test("D35: a blocked crew session that gets its answer is working again, so the watch never stops it", async () => {
    const world = await askedWorld("blocked");
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events.at(-1)).toMatchObject({
      state: "working",
      text: "an answer brought it back",
      type: "state",
    });
  });

  test("D36: an answer that starts with two dashes is given after a bare --", async () => {
    const world = await askedWorld();
    // Without the separator the text would be read as an option.
    expect(await runCrew(["answer", NAME, "--fast please"], world.ctx())).toBe(2);
    world.err.length = 0;
    expect(await runCrew(["answer", NAME, "--", "--fast please"], world.ctx())).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("--fast please");
  });

  test("D36: a crew session that was working keeps its state when it is answered", async () => {
    const world = await askedWorld("working");
    await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    // `created` and the question; the answer alone is no event.
    expect(events.map((one) => one.type)).toEqual(["created", "question"]);
  });

  test("D35: a crew session that ended its phase and was stopped is not resumed by an answer", async () => {
    const world = await askedWorld("stopped");
    const reportFile = crewReportFile(world.paths.stateDir, world.repo, ID);
    const { updateCrew, writeReport } = await import("./store");
    await writeReport(world.paths.stateDir, world.repo, ID, {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      branch: { name: "crew/B6b-portal-live", sha: git(world.repo, "rev-parse", "HEAD").trim() },
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
      status: "done",
      tests: { full: null, targeted: [] },
      version: 1,
    });
    await updateCrew(world.paths.stateDir, world.repo, ID, { reportPath: reportFile }, T0);
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      `crew answer: ${NAME} ended its phase and was stopped, and it takes no more answers`,
    );
    expect(world.claudeCalls()).toEqual([]);
  });

  test("D36: a crew session that is done takes no more answers, and its question needs none", async () => {
    const world = await askedWorld("done");
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      `crew answer: ${NAME} is finished (done), so its question needs no answer`,
    );
  });

  test("D35: a stopped crew session is resumed with the answer as its next prompt, in its worktree, with its own files", async () => {
    const world = await askedWorld("stopped");
    const { mcp, settings } = filesOf(world);
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // One read of agent view (is the session gone?), then the resume — the exact argv, in the
    // crew session's own worktree and never the main checkout, and the record's own settings and
    // MCP files, so the resumed session is still this crew session and still lean.
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      [
        "--bg",
        "--resume",
        "aaaa1111-2222-3333-4444-555555555555",
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
        mcp,
        "--settings",
        settings,
        "--",
        "the port is 3210",
      ],
    ]);
    expect(world.cwdCalls()).toEqual([world.repo, worktreeOf(world)]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
    // It is running again, so it holds a place and the watch must not stop it.
    expect(record?.state).toBe("working");
  });

  test("WF1: a resume under the same id keeps the record's session", async () => {
    const world = await askedWorld("stopped");
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    // The same short id and no copy note: the same session goes on, and agent view is not read again.
    expect(world.claudeCalls().map((call) => call[0])).toEqual(["agents", "--bg"]);
    expect(world.out).toEqual([`answered ${NAME}: resumed with your answer · which port?`]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({
      sessionId: "aaaa1111-2222-3333-4444-555555555555",
      shortId: "aaaa1111",
      state: "working",
    });
  });

  test("WF1: a resume that starts a copy: the record takes its new id in the same write as working", async () => {
    // The live case (2026-10-25): the record held c7186986, the resume opened d7a54fc8, and the
    // record kept the old id — so the watch read the old session's row as stopped.
    const world = await askedWorld("stopped");
    const view = JSON.stringify([
      { id: "aaaa1111", sessionId: "aaaa1111-2222-3333-4444-555555555555", state: "stopped" },
      {
        id: "a1b2c3d4",
        pid: 4242,
        sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
        state: "working",
      },
    ]);
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_AGENTS_JSON: view, FAKE_RESUME: "copy" }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // Agent view before (is it gone?), the resume, and agent view again for the copy's row.
    expect(world.claudeCalls().map((call) => call[0])).toEqual(["agents", "--bg", "agents"]);
    expect(world.out).toEqual([
      `answered ${NAME}: resumed with your answer as session a1b2c3d4 (a copy of aaaa1111) · which port?`,
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({
      sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
      shortId: "a1b2c3d4",
      state: "working",
    });
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
    // One state event: the ids came in the write that made it working.
    const states = readCrewEvents(world.paths.stateDir, world.repo).events.filter(
      (one) => one.type === "state",
    );
    expect(states.map((one) => [one.state, one.text])).toEqual([
      ["working", "an answer brought it back"],
    ]);
  });

  test("WF1: a resume that prints no session id is said with why; the record stays as it was", async () => {
    const world = await askedWorld("stopped");
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_BG: "noline" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew answer: claude --bg --resume aaaa1111-2222-3333-4444-555555555555 printed no line backgrounded · <id>, so the session it started is not known; see claude agents before you resume it again",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({ shortId: "aaaa1111", state: "stopped" });
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("WF1: a copy note that names another id than the line is not guessed at", async () => {
    const world = await askedWorld("stopped");
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_COPY_AS: "b2c3d4e5", FAKE_RESUME: "copy" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew answer: claude --bg --resume aaaa1111-2222-3333-4444-555555555555 said it started a copy as b2c3d4e5, but printed backgrounded · a1b2c3d4; see claude agents before you resume it again",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({ shortId: "aaaa1111", state: "stopped" });
  });

  test("WF1: a resume that does not answer in time may have started one: said, the record as it was", async () => {
    const world = await askedWorld("stopped");
    const real = world.ctx().runProgram;
    const ctx = world.ctx({
      runProgram: (argv, options) =>
        argv.includes("--resume")
          ? { error: null, exitCode: null, stderr: "", stdout: "", timedOut: true }
          : real(argv, options),
    });
    expect(await runCrew(["answer", NAME, "the port is 3210"], ctx)).toBe(1);
    expect(world.err).toEqual([
      "crew answer: claude --bg --resume aaaa1111-2222-3333-4444-555555555555 did not answer in time; see claude agents before you resume it again",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({ shortId: "aaaa1111", state: "stopped" });
    expect(record?.questions[0]?.answer).toBeNull();
    // It may have started a session: its claim stays until it is over, so a second resume waits.
    expect(record?.resumeClaim).toBeDefined();
  });

  test("WF1: a copy agent view does not list is said, with the copy's id to stop", async () => {
    const world = await askedWorld("stopped");
    const view = JSON.stringify([
      { id: "aaaa1111", sessionId: "aaaa1111-2222-3333-4444-555555555555", state: "stopped" },
    ]);
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_AGENTS_JSON: view, FAKE_RESUME: "copy" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew answer: session a1b2c3d4 started, but claude agents does not list it; see claude agents, and stop it (claude stop a1b2c3d4) before you resume it again",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record).toMatchObject({ shortId: "aaaa1111", state: "stopped" });
  });

  test("D35: a stopped crew session whose agent view cannot be read is not resumed: it could be running", async () => {
    const world = await askedWorld("stopped");
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_AGENTS_JSON: "not json" }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME}: agent view could not be read (claude agents --json), so it cannot say whether its session still runs; try again`,
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("D35: a stopped crew session whose settings file is gone is not resumed: it would be no crew session", async () => {
    const world = await askedWorld("stopped");
    const { settings } = filesOf(world);
    rmSync(settings);
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME} has no settings file any more (${settings}), so a resume would come back as a plain session`,
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
  });

  test("D35: a stopped crew session with no worktree is refused with one line: nothing to resume in", async () => {
    const world = await askedWorld("stopped");
    rmSync(worktreeOf(world), { recursive: true });
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME} has no worktree at ${worktreeOf(world)} any more`,
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("D35: a stopped record whose session still runs is sent the message, never a copy", async () => {
    const world = await askedWorld("stopped");
    const live = JSON.stringify([
      {
        cwd: "/w",
        id: "aaaa1111",
        kind: "background",
        pid: 4242,
        sessionId: "aaaa1111-2222-3333-4444-555555555555",
        state: "working",
      },
    ]);
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { FAKE_AGENTS_JSON: live }),
    );
    expect(code).toBe(0);
    expect(world.out[2]).toBe(
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    );
    // `claude --bg --resume` on a running session would start a copy beside it.
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
  });

  test("FU2: a resume text that starts with `-` goes after `--`, so claude reads it as the prompt", () => {
    // `claude -p "-1 is wrong: use 2"` answers `error: unknown option '-1 is wrong: use 2'`;
    // with `--` before it the fake Anthropic's log held the text as the prompt (2.1.309).
    const args = resumeArgs(
      {
        effort: "high",
        model: "sonnet",
        permissionMode: "auto",
        sessionId: "aaaa1111-2222-3333-4444-555555555555",
      },
      { mcpFile: "/home/user/mcp.json", settingsFile: "/home/user/settings.json" },
      "-1 is wrong: use 2",
    );
    expect(args.slice(-3)).toEqual(["/home/user/settings.json", "--", "-1 is wrong: use 2"]);
  });

  test("FU2: a resume with no text carries no `--`", () => {
    const args = resumeArgs(
      {
        effort: "high",
        model: "sonnet",
        permissionMode: "auto",
        sessionId: "aaaa1111-2222-3333-4444-555555555555",
      },
      { mcpFile: null, settingsFile: "/home/user/settings.json" },
      null,
    );
    expect(args.at(-1)).toBe("/home/user/settings.json");
  });

  test("D36: a question and its answer, through the two commands", async () => {
    const world = await askedWorld("working");
    // A second question, asked the way a crew session asks it.
    const asked = await runCrew(
      [
        "report",
        "--question",
        "keep the old field?",
        "--option",
        "yes",
        "--option",
        "no",
        "--recommend",
        "2",
      ],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(asked).toBe(0);
    // The lead answers the newest question that has no answer: the second one.
    expect(await runCrew(["answer", NAME, "no, drop it"], world.ctx())).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions.map((one) => one.answer)).toEqual([null, "no, drop it"]);
    expect(record?.questions[1]?.recommended).toBe(2);
  });

  test("D36: an answer to a crew session that is not recorded is refused", async () => {
    const world = await askedWorld();
    const code = await runCrew(["answer", "C my-app B6c other", "hello"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      'crew answer: no crew session of this repository is "C my-app B6c other"',
      `Fix: ${COMMAND} crew list shows them, and --all those of every repository`,
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("D36: a name one live crew session and only removed ones share means the live one", async () => {
    const world = await askedWorld("stopped");
    // A removed crew session the lead stopped and removed under the same name, earlier.
    const shortId = "bbbb2222";
    await createCrew(
      world.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: "crew/B6b-other",
        effort: "high",
        files: [],
        id: "B6b-other-cccccc",
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
        sessionId: `${shortId}-0000-1111-2222-333333333333`,
        shortId,
        slug: "other",
        state: "removed",
        waitsFor: [],
        worktree: join(world.repo, ".claude", "worktrees", "crew-B6b-other"),
      },
      T0 - 60_000,
    );
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(0);
    const answer = world.claudeCalls().find((call) => call[0] === "--bg");
    // The live record's session is the one resumed, never the removed one's.
    expect(answer?.[2]).toBe("aaaa1111-2222-3333-4444-555555555555");
  });

  test("D36: an answer to a crew session that never asked is refused", async () => {
    const world = await askedWorld("working", false);
    const code = await runCrew(["answer", NAME, "first"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      `crew answer: ${NAME} has no question waiting for an answer (it never asked one)`,
    );
  });

  test("D36: an answer from inside a crew session is refused", async () => {
    const world = await askedWorld();
    const code = await runCrew(
      ["answer", NAME, "the port is 3210"],
      world.ctx({}, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("never answers");
  });

  test("D36: an answer with no text is refused", async () => {
    const world = await askedWorld();
    const code = await runCrew(["answer", NAME], world.ctx());
    expect(code).toBe(2);
    expect(world.err[0]).toContain("Say the answer");
  });

  test("D52: the person through the portal answers with no Claude Code session", async () => {
    const world = await askedWorld("blocked");
    // The portal's child is not a Claude Code session (`--as-person`), and it clears the crew
    // environment of the session that started the portal (`src/portal/cli-child.ts`).
    const ctx = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    const code = await runCrewAnswer({ asPerson: true, crew: NAME, text: "the port is 3210" }, ctx);
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
  });

  test("D52: a crew session that gives --as-person itself is still refused", async () => {
    // The flag says "no session runs this", never "a crew session may answer another": the
    // crew-session refusal is what stops a crew session answering for the person.
    const world = await askedWorld("blocked");
    const ctx = world.ctx(
      { processes: { commandLineOf: () => null, parentOf: () => null } },
      {
        CC_SMART_DEV_KIT_CREW: ID,
      },
    );
    const code = await runCrew(["answer", "--as-person", "--", NAME, "the port is 3210"], ctx);
    expect(code).toBe(1);
    expect(world.err[0]).toContain("a crew session never answers");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe(null);
  });

  test("D52: the portal's own child answers with `--as-person`, with no session above it", async () => {
    // The portal runs `crew answer --as-person -- <id> <text>` in a child
    // (`src/portal/cli-child.ts`); the child has no Claude Code session above it.
    const world = await askedWorld("blocked");
    const ctx = world.ctx({ processes: { commandLineOf: () => null, parentOf: () => null } });
    const code = await runCrew(["answer", "--as-person", "--", NAME, "-- 3210 it is"], ctx);
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      "recorded, not delivered: no heartbeat from its monitor, so it hears the answer when its monitor next runs, or when its lead sends it",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("-- 3210 it is");
  });

  test("D52: without asPerson, no Claude Code session still refuses the answer", async () => {
    const world = await askedWorld("blocked");
    const ctx = world.ctx({
      processes: { commandLineOf: () => null, parentOf: () => null },
    });
    const code = await runCrewAnswer({ crew: NAME, text: "the port is 3210" }, ctx);
    expect(code).toBe(1);
    expect(world.err[0]).toContain("no Claude Code session runs this command");
  });

  test("D52: --as-person from a session in bypass mode is refused: the flag is the portal's", async () => {
    // The flag says "no Claude Code session runs this", never "skip the session check": a lead
    // in bypass mode gives it itself, and the session above this command is still found.
    const world = await askedWorld("blocked");
    const ctx = world.ctx({
      processes: {
        commandLineOf: () => "claude --dangerously-skip-permissions",
        parentOf: (pid) => ({ 300: 1, 400: 300, 500: 400 })[pid] ?? null,
      },
    });
    const code = await runCrew(["answer", "--as-person", "--", NAME, "the port is 3210"], ctx);
    expect(code).toBe(1);
    expect(world.err).toEqual([
      "crew answer: --as-person is the portal's: a Claude Code session runs this command",
      "Fix: run it without --as-person",
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe(null);
  });

  test("D52: a lead in bypass mode is refused without the flag, with the bypass reason", async () => {
    // The check the flag used to skip is still the one that answers a lead in bypass mode.
    const world = await askedWorld("blocked");
    const ctx = world.ctx({
      processes: {
        commandLineOf: () => "claude --permission-mode bypassPermissions",
        parentOf: (pid) => ({ 300: 1, 400: 300, 500: 400 })[pid] ?? null,
      },
    });
    expect(await runCrew(["answer", NAME, "the port is 3210"], ctx)).toBe(1);
    expect(world.err[0]).toBe(
      "crew answer: this session was started in bypassPermissions mode, and a lead there acts on every crew session's message with no question",
    );
  });
});

describe("a finished crew session's question is never open", () => {
  /** The one question's open index of a record the store holds in `state`. */
  async function indexIn(
    world: Awaited<ReturnType<typeof askedWorld>>,
    state: string,
  ): Promise<null | number> {
    await updateCrew(world.paths.stateDir, world.repo, ID, { state }, T0 + 1000, "moved");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    return record === undefined ? null : openQuestionIndex(record);
  }

  test("open on a working record, and closed on a merged, a handoff, a done, a failed and a removed one", async () => {
    const world = await askedWorld("working");
    expect(await indexIn(world, "working")).toBe(0);
    for (const state of ["merged", "handoff", "done", "failed", "removed"]) {
      expect([state, await indexIn(world, state)]).toEqual([state, null]);
    }
  });

  test("open on a stopped record: D35's answer resumes it with the question still waiting", async () => {
    const world = await askedWorld("stopped");
    expect(await indexIn(world, "stopped")).toBe(0);
  });

  test("crew answer on a merged record says the session is finished, in one line", async () => {
    const world = await askedWorld("working");
    await updateCrew(world.paths.stateDir, world.repo, ID, { state: "merged" }, T0 + 1000);
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME} is finished (merged), so its question needs no answer`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("crew answer on a handoff record says the same", async () => {
    const world = await askedWorld("working");
    await updateCrew(world.paths.stateDir, world.repo, ID, { state: "handoff" }, T0 + 1000);
    expect(await runCrew(["answer", NAME, "the port is 3210"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew answer: ${NAME} is finished (handoff), so its question needs no answer`,
    ]);
  });
});

describe("RG1: crew answer after a supersede", () => {
  test("the answer goes to the newest question, and the superseded one stays unanswered", async () => {
    const world = await askedWorld("working");
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port, exactly?", recommended: null },
      T0 + 1000,
    );
    const code = await runCrew(["answer", NAME, "3211"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out[0]).toBe(`answered ${NAME}: which port, exactly?`);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]).toMatchObject({ answer: null, supersededBy: 1 });
    expect(record?.questions[1]).toMatchObject({ answer: "3211" });
  });

  test("IN1: a second answer corrects the newest question, never the superseded one", async () => {
    const world = await askedWorld("working");
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port, exactly?", recommended: null },
      T0 + 1000,
    );
    expect(await runCrew(["answer", NAME, "3211"], world.ctx())).toBe(0);
    world.out.length = 0;
    expect(await runCrew(["answer", NAME, "3211 again"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out[0]).toBe(`corrected the answer to ${NAME}: which port, exactly?`);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    // The old question stays closed and unanswered; the newest holds the correction and the first answer.
    expect(record?.questions[0]).toMatchObject({ answer: null, supersededBy: 1 });
    expect(record?.questions[0]?.superseded).toBeUndefined();
    expect(record?.questions[1]).toMatchObject({
      answer: "3211 again",
      deliveredAt: null,
      superseded: [{ answer: "3211" }],
    });
  });

  test("IN1: the correction is no answer to the superseded question: it asks nothing of the old one", async () => {
    const world = await askedWorld("working");
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port, exactly?", recommended: null },
      T0 + 1000,
    );
    await runCrew(["answer", NAME, "3211"], world.ctx());
    await runCrew(["answer", NAME, "3211 again"], world.ctx());
    // A stale reader that still holds the old index is refused, with or without the correction flag.
    for (const correction of [false, true]) {
      await expect(
        answerCrewQuestion(world.paths.stateDir, world.repo, ID, 0, "late", T0 + 5000, null, null, {
          correction,
        }),
      ).rejects.toThrow("was superseded by question 1");
    }
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("a finished session with a superseded question left says its answer cannot be corrected", async () => {
    const world = await askedWorld("working");
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port, exactly?", recommended: null },
      T0 + 1000,
    );
    await answerCrewQuestion(world.paths.stateDir, world.repo, ID, 1, "3211", T0 + 2000);
    await updateCrew(world.paths.stateDir, world.repo, ID, { state: "merged" }, T0 + 3000);
    expect(await runCrew(["answer", NAME, "late"], world.ctx())).toBe(1);
    // The old question was superseded, never left open: the line is not the "needs no answer" one
    // (RG1), and the newest question's answer is the one a finished phase cannot correct (AN1).
    expect(world.err).toEqual([
      `crew answer: ${NAME} is finished (merged), so its answer cannot be corrected`,
    ]);
  });
});
