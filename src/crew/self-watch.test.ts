/**
 * `crew self-watch` (`self-watch.ts`): the crew session's own line about its context and its time.
 * One line at the hand-off share of the context, one note when the phase runs long, one hand-off
 * when the time is up — and nothing else.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectFolderName } from "../sessions/saved-sessions";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { runCrew } from "./command";
import { adviceFor, hoursSince, type SelfThresholds } from "./self-watch";
import {
  addCrewQuestion,
  answerCrewQuestion,
  createCrew,
  crewFile,
  listCrew,
  readAnswerWatchBeat,
  writeLead,
} from "./store";
import { contextPercent } from "./transcript";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "C my-app B6b portal-live";

/** The thresholds the plan set. */
const THRESHOLDS: SelfThresholds = { handoffPercent: 70, maxHours: 4, softHours: 2 };

/** 75 % of a 1M window: what a current Claude family's hand-off is measured against now. */
const AT_75 = 750_000;

/** A world with one crew session whose transcript says `tokens` of context, from `model`. */
async function crewWorldWith(tokens: number, startedHoursAgo = 0, model = "claude-opus-5-5") {
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
  const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
  // A real worktree: the crew session's own monitor finds its crew session by it.
  git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
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
      model: { named: "claude-opus-5-5", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
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
      state: "working",
      waitsFor: [],
      worktree,
    },
    T0 - startedHoursAgo * 3_600_000,
  );
  // The crew session's own transcript, under its worktree's project folder.
  const folder = join(world.paths.projectsDir, projectFolderName(worktree));
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "aaaa1111-2222-3333-4444-555555555555.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      message: {
        model,
        usage: {
          cache_creation_input_tokens: tokens,
          cache_read_input_tokens: 0,
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    })}\n`,
  );
  return { ...world, worktree };
}

describe("the thresholds the crew session watches itself against", () => {
  test("D25: the context share, the long note and the time up", () => {
    expect(adviceFor(null, 0.5, THRESHOLDS)).toBeNull();
    expect(adviceFor(null, 1.9, THRESHOLDS)).toBeNull();
    expect(adviceFor(50, 0.5, THRESHOLDS)).toBeNull();
    expect(adviceFor(70, 0.5, THRESHOLDS)?.kind).toBe("context");
    expect(adviceFor(71, 0.5, THRESHOLDS)?.line).toBe(
      "context at 71%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    );
    expect(adviceFor(null, 2.1, THRESHOLDS)?.kind).toBe("long");
    expect(adviceFor(null, 4.1, THRESHOLDS)?.kind).toBe("time");
    // The time up comes first: the crew session must not hear two lines.
    expect(adviceFor(90, 5, THRESHOLDS)?.kind).toBe("time");
  });

  test("the share of the window", () => {
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 140_000 }, 200_000)).toBe(70);
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 0 }, 200_000)).toBeNull();
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 140_000 }, null)).toBeNull();
  });

  test("the hours since the crew session started", () => {
    expect(hoursSince(T0, T0)).toBe(0);
    expect(hoursSince(T0, T0 + 3_600_000)).toBe(1);
  });
});

describe("crew self-watch", () => {
  test("D25: a crew session with room to work hears nothing", async () => {
    const world = await crewWorldWith(20_000);
    const code = await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([]);
  });

  test("D25: at the hand-off share, the crew session is told to hand off", async () => {
    const world = await crewWorldWith(AT_75);
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
  });

  test("CC4: the hand-off line is the real share of the real window", async () => {
    // `claude-opus-5-5` has a 1M window, so 800 000 tokens is 80 % of it — not 400 % of 200 000.
    const world = await crewWorldWith(800_000);
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.out).toEqual([
      "context at 80%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
    expect(world.err).toEqual([]);
  });

  test("CC4: Claude Code's own window wins over the kit's table", async () => {
    const world = await crewWorldWith(150_000);
    mkdirSync(world.paths.stateDir, { recursive: true });
    writeFileSync(
      join(world.paths.stateDir, "context-window.json"),
      JSON.stringify({ "claude-opus-5-5": { readAt: "2026-10-21T09:00:00.000Z", size: 200_000 } }),
    );
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    // The table would say 1M (15 %); the number Claude Code reported says 200 000.
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
  });

  test("CC4: a backend's model is measured against that backend's listed window", async () => {
    // The router answered from the worker slot's backend, so the transcript holds its bare name.
    const world = await crewWorldWith(800_000, 0, "deepseek-v4.1-flash");
    mkdirSync(dirname(world.paths.gatewayConfigFile), { recursive: true });
    writeFileSync(
      world.paths.gatewayConfigFile,
      JSON.stringify({
        backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
        slots: { "cc-smart-dev-kit-worker": ["omniroute:deepseek-v4.1-flash"] },
        version: 1,
      }),
      { mode: 0o600 },
    );
    mkdirSync(world.paths.stateDir, { recursive: true });
    writeFileSync(
      join(world.paths.stateDir, "backend-windows.json"),
      JSON.stringify({
        omniroute: {
          readAtMs: Date.parse("2026-10-21T10:00:00.000Z"),
          windows: { "deepseek-v4.1-flash": 1_000_000 },
        },
      }),
    );
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.out).toEqual([
      "context at 80%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
    expect(world.err).toEqual([]);
  });

  test("D25: the same line is not said twice within a quarter of an hour", async () => {
    const world = await crewWorldWith(AT_75);
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    await runCrew(["self-watch", "--once"], ctx);
    world.out.length = 0;
    await runCrew(["self-watch", "--once"], ctx);
    expect(world.out).toEqual([]);
  });

  test("D25: a long phase gets a note", async () => {
    const world = await crewWorldWith(20_000, 3);
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.out).toEqual([
      '3.0 hours into this phase: it is long. Tell the lead where it stands (`cc-smart-dev-kit crew step <the step you are at> --note "<where you stand>"`), or hand off.',
    ]);
  });

  test("D35: a crew session past its time cap is told to hand off", async () => {
    const world = await crewWorldWith(20_000, 5);
    await runCrew(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.out).toEqual([
      "5.0 hours into this phase: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
  });

  test("D25: the watch repeats its line when it is ignored, and stops when the phase ends", async () => {
    const world = await crewWorldWith(AT_75);
    // A clock the test drives: each round is one tick later (3 s). The phase ends 17 minutes in.
    let clock = T0;
    let ended = false;
    const ctx = world.ctx(
      {
        cwd: world.worktree,
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms;
          if (!ended && clock >= T0 + 17 * 60_000) {
            ended = true;
            const { updateCrew } = await import("./store");
            await updateCrew(world.paths.stateDir, world.repo, ID, { state: "done" }, clock);
          }
        },
      },
      { CC_SMART_DEV_KIT_CREW: ID },
    );
    const code = await runCrew(["self-watch"], ctx);
    expect(code).toBe(0);
    // The line at once, and the same line again after a quarter of an hour — not between —
    // and then the loop ends with the phase.
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
    expect(ended).toBe(true);
  });

  test("D25: a crew session's own monitor finds its crew session by the worktree", async () => {
    const world = await crewWorldWith(AT_75);
    // No `CC_SMART_DEV_KIT_CREW`: a plugin's monitor is a process of the host, and the
    // settings' env may not reach it.
    const code = await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }));
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit crew report --status handoff`",
    ]);
  });

  test("D25: a self-watch outside a crew session is refused", async () => {
    const world = await crewWorldWith(AT_75);
    // The lead's own folder is no crew session's worktree, and the environment names no crew session.
    const code = await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.repo }));
    expect(code).toBe(1);
    expect(world.err[0]).toContain("not a crew session");
  });
});

/** A world whose crew session asked one question, and the lead answered it. */
async function answeredWorld(answer = "the port is 3210") {
  const world = await crewWorldWith(20_000);
  await addCrewQuestion(
    world.paths.stateDir,
    world.repo,
    ID,
    { options: ["3210", "3211"], question: "which port?", recommended: 1 },
    T0,
  );
  await answerCrewQuestion(world.paths.stateDir, world.repo, ID, 0, answer, T0);
  return world;
}

describe("AN1: crew self-watch delivers the lead's answer", () => {
  const env = { CC_SMART_DEV_KIT_CREW: ID };

  test("an answer on record is printed as one line, once, and marked delivered", async () => {
    const world = await answeredWorld();
    const ctx = world.ctx({ cwd: world.worktree }, env);
    expect(await runCrew(["self-watch", "--once"], ctx)).toBe(0);
    expect(world.out).toEqual([
      'Your lead answers your question "which port?": "the port is 3210"',
    ]);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions[0]?.deliveredAt).toBe("2026-10-21T10:00:00.000Z");
    // A second pass finds it delivered.
    world.out.length = 0;
    await runCrew(["self-watch", "--once"], ctx);
    expect(world.out).toEqual([]);
  });

  test("a line break or a quote in the answer stays inside the one line", async () => {
    const world = await answeredWorld('use "3210"\nnot 3211');
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    expect(world.out).toEqual([
      'Your lead answers your question "which port?": "use \\"3210\\"\\nnot 3211"',
    ]);
  });

  test("a correction says it replaces the earlier answer", async () => {
    const world = await answeredWorld();
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    world.out.length = 0;
    await answerCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      0,
      "sorry, 3211",
      T0 + 5000,
      null,
      null,
      {
        correction: true,
      },
    );
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    expect(world.out).toEqual([
      'Your lead CORRECTS its earlier answer to your question "which port?": this REPLACES the earlier answer ("the port is 3210"). Follow this one instead: "sorry, 3211"',
    ]);
  });

  test("an answer from before the delivered field was sent by hand: never printed again", async () => {
    const world = await answeredWorld();
    const file = crewFile(world.paths.stateDir, world.repo, ID);
    const record = JSON.parse(readFileSync(file, "utf8"));
    delete record.questions[0].deliveredAt;
    writeFileSync(file, JSON.stringify(record));
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    expect(world.out).toEqual([]);
  });

  test("a question with no answer prints nothing", async () => {
    const world = await crewWorldWith(20_000);
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["a", "b"], question: "which?", recommended: null },
      T0,
    );
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    expect(world.out).toEqual([]);
  });

  test("the monitor writes its heartbeat, so crew answer can tell it runs", async () => {
    const world = await crewWorldWith(20_000);
    expect(readAnswerWatchBeat(world.paths.stateDir, world.repo, ID)).toBeNull();
    await runCrew(["self-watch", "--once"], world.ctx({ cwd: world.worktree }, env));
    expect(readAnswerWatchBeat(world.paths.stateDir, world.repo, ID)).toBe(T0);
  });

  test("an answer that lands while the loop runs is printed on the next tick, once; the heartbeat repeats", async () => {
    const world = await crewWorldWith(20_000);
    await addCrewQuestion(
      world.paths.stateDir,
      world.repo,
      ID,
      { options: ["3210", "3211"], question: "which port?", recommended: 1 },
      T0,
    );
    let clock = T0;
    let ticks = 0;
    const ctx = world.ctx(
      {
        cwd: world.worktree,
        now: () => clock,
        sleep: async (ms: number) => {
          ticks += 1;
          clock += ms;
          if (ticks === 3) {
            await answerCrewQuestion(world.paths.stateDir, world.repo, ID, 0, "3210", clock);
          }
          if (ticks === 40) {
            const { updateCrew } = await import("./store");
            await updateCrew(world.paths.stateDir, world.repo, ID, { state: "done" }, clock);
          }
        },
      },
      env,
    );
    expect(await runCrew(["self-watch"], ctx)).toBe(0);
    expect(world.out).toEqual(['Your lead answers your question "which port?": "3210"']);
    // 40 ticks of 3 s: the heartbeat was written again every 15 s.
    expect(readAnswerWatchBeat(world.paths.stateDir, world.repo, ID)).toBe(T0 + 105_000);
  });
});
