/**
 * `crew answer` (`answer.ts`): the lead's answer to a crew session's question (D36). A running
 * crew session gets the line the lead sends it with; a stopped one is resumed with the answer as its
 * next prompt (`claude --bg --resume <session id> "<text>"`).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { runCrewAnswer } from "./answer";
import { runCrew } from "./command";
import {
  addCrewQuestion,
  createCrew,
  crewReportFile,
  listCrew,
  readCrewEvents,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "C my-app B6b portal-live";

/** A world with one crew session that asked a question, in `state`. */
async function askedWorld(state: "working" | "stopped" | "blocked" | "done" = "working") {
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
    },
    T0,
  );
  await addCrewQuestion(
    world.paths.stateDir,
    world.repo,
    ID,
    { options: ["3210", "3211"], question: "which port?", recommended: 1 },
    T0,
  );
  return world;
}

describe("crew answer", () => {
  test("D36: a running crew session gets the line the lead sends it with, and the answer is recorded", async () => {
    const world = await askedWorld();
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      "answered C my-app B6b portal-live: which port?",
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]).toMatchObject({
      question: "which port?",
      answer: "the port is 3210",
      answeredAt: "2026-10-21T10:00:00.000Z",
    });
  });

  test("D36: a quote or a line break in the answer is escaped, never changed", async () => {
    const world = await askedWorld();
    await runCrew(["answer", NAME, 'use "3210"\nnot 3211'], world.ctx());
    expect(world.out[1]).toBe(
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

  test("D36: a crew session that is done takes no more answers", async () => {
    const world = await askedWorld("done");
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toBe(`crew answer: ${NAME} is done, and it takes no more answers`);
  });

  test("D35: a stopped crew session is resumed with the answer as its next prompt", async () => {
    const world = await askedWorld("stopped");
    const code = await runCrew(["answer", NAME, "the port is 3210"], world.ctx());
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // One read of agent view (is the session gone?), then the resume — the exact argv.
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      ["--bg", "--resume", "aaaa1111-2222-3333-4444-555555555555", "the port is 3210"],
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
    // It is running again, so it holds a place and the watch must not stop it.
    expect(record?.state).toBe("working");
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
    expect(world.out[1]).toBe(
      'SendMessage {"to":"C my-app B6b portal-live","message":"the port is 3210"}',
    );
    // `claude --bg --resume` on a running session would start a copy beside it.
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
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
    expect(world.err[0]).toContain("C my-app B6c other");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBeNull();
  });

  test("D36: an answer to a crew session with no open question is refused", async () => {
    const world = await askedWorld();
    expect(await runCrew(["answer", NAME, "first"], world.ctx())).toBe(0);
    world.err.length = 0;
    const code = await runCrew(["answer", NAME, "second"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("no question waiting");
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

  test("D52: the person through the portal answers with no Claude Code session, even from a crew session's own env", async () => {
    const world = await askedWorld("blocked");
    // The portal is not a Claude Code session, and the session that started it may have been
    // a crew session: `asPerson` is the caller, and neither refusal applies.
    const ctx = world.ctx(
      { asPerson: true, processes: { commandLineOf: () => null, parentOf: () => null } },
      { CC_SMART_DEV_KIT_CREW: ID },
    );
    const code = await runCrewAnswer({ asPerson: true, crew: NAME, text: "the port is 3210" }, ctx);
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.answer).toBe("the port is 3210");
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
});
