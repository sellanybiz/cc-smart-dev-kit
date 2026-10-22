/**
 * The board: `worker list`, `worker status`, `worker kinds` and `worker attach`. A real git repo
 * in a temp folder, the store in a temp state folder, the machine's facts given, and a fake
 * `claude` on PATH (`src/testing/board-world.ts`). No test starts a real Claude session.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND } from "../build-info/names";
import { WORKER_KIND_NAMES, WORKER_KINDS } from "../models/launch-policy";
import { boardWorld, MINUTE, NOW } from "../testing/board-world";
import { git, tempDir } from "../testing/temp";
import { LEAD_SESSION } from "../testing/worker-world";
import { repoKey } from "../workflow/reviews";
import { runWorker } from "./command";
import {
  addWorkerQuestion,
  appendWorkerEvent,
  updateWorker,
  workerEventsFile,
  workerFile,
} from "./store";

const SLOT_MODEL = {
  named: "sonnet",
  resolved: "omniroute:glm-5.1",
  slot: "cc-smart-dev-kit-worker",
  tier: null,
};
const OPUS_MODEL = { named: "opus", resolved: "opus", slot: null, tier: "opus" };

describe("worker list", () => {
  test("newest first; the state is since its last change, not since the last write to the record", async () => {
    const world = await boardWorld();
    const stateDir = world.paths.stateDir;
    const first = await world.addWorker({ effort: "max", memoryMb: 512, model: SLOT_MODEL });
    // Blocked 5 minutes ago; since then only its line and its memory were written.
    await updateWorker(
      stateDir,
      world.repo,
      first.id,
      { state: "blocked" },
      NOW - 5 * MINUTE,
      "waiting for the lead",
    );
    await updateWorker(
      stateDir,
      world.repo,
      first.id,
      { lastLine: "running the full suite", memoryMb: 640 },
      NOW - MINUTE,
    );
    // A step the worker noted is the last thing it said; it wins over the line of its last turn.
    await appendWorkerEvent(
      stateDir,
      world.repo,
      {
        lead: LEAD_SESSION,
        name: first.name,
        state: "blocked",
        text: "tests green",
        type: "step",
        worker: first.id,
      },
      NOW - 2 * MINUTE,
    );
    await world.addWorker({
      atMs: NOW - 180 * MINUTE,
      effort: "xhigh",
      kind: "security",
      lastLine: "Hand-back sent.",
      model: OPUS_MODEL,
      phase: "B2",
      slug: "api",
      state: "done",
    });

    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "W my-app B1 help — blocked, 5 min ago",
      "  B1 · build · sonnet → omniroute:glm-5.1 (slot cc-smart-dev-kit-worker) · max",
      "  wk/B1-help · memory 640 MB · lead LEAD my-app master-plan",
      "  last: tests green",
      "",
      "W my-app B2 api — done, 3 h ago",
      "  B2 · security · opus · xhigh",
      "  wk/B2-api · memory - · lead LEAD my-app master-plan",
      "  last: Hand-back sent.",
    ]);
  });

  test("a queued worker says what holds it: the phases it waits for first, then the cap", async () => {
    const world = await boardWorld();
    world.writeConfig({ max: 1 });
    await world.addWorker();
    await world.addWorker({
      atMs: NOW - 5 * MINUTE,
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    await world.addWorker({
      atMs: NOW - 2 * MINUTE,
      phase: "B3",
      shortId: null,
      slug: "more",
      state: "queued",
      waitsFor: ["B1"],
      worktree: false,
    });
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "W my-app B3 more — queued, 2 min ago",
      "  B3 · build · sonnet · high",
      "  wk/B3-more · memory - · lead LEAD my-app master-plan",
      "  held: waits for B1 (working); it starts when each is merged",
      "",
      "W my-app B2 api — queued, 5 min ago",
      "  B2 · build · sonnet · high",
      "  wk/B2-api · memory - · lead LEAD my-app master-plan",
      "  held: 1 of 1 running; it starts when one finishes",
      "",
      "W my-app B1 help — working, 12 min ago",
      "  B1 · build · sonnet · high",
      "  wk/B1-help · memory - · lead LEAD my-app master-plan",
    ]);
  });

  test("the opus cap holds an opus worker back while a sonnet worker would start", async () => {
    const world = await boardWorld();
    world.writeConfig({ maxOpus: 1 });
    await world.addWorker({ effort: "xhigh", kind: "security", model: OPUS_MODEL });
    await world.addWorker({
      atMs: NOW - 5 * MINUTE,
      effort: "xhigh",
      kind: "ui",
      model: OPUS_MODEL,
      phase: "B2",
      shortId: null,
      slug: "ui",
      state: "queued",
      worktree: false,
    });
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.out).toContain(
      "  held: 1 of 1 opus workers running; it starts when one of them finishes",
    );
  });

  test("with a place free it is the memory that holds it, or only its lead's watch", async () => {
    const world = await boardWorld();
    await world.addWorker({
      shortId: null,
      state: "queued",
      worktree: false,
    });
    expect(await runWorker(["list"], world.ctx({ freeMemoryGb: () => Promise.resolve(1.5) }))).toBe(
      0,
    );
    expect(world.out[3]).toBe(
      "  held: 1.5 GB free, a worker needs 2 GB; it starts when memory frees",
    );

    world.out.length = 0;
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.out[3]).toBe("  held: a place is free; its lead's watch starts it");
  });

  test("another repository's workers are left out, and `--all` brings them in with their folder", async () => {
    const world = await boardWorld();
    await world.addWorker();
    await world.addWorker({
      atMs: NOW - 5 * MINUTE,
      name: "W other P1 x",
      phase: "P1",
      repo: "/home/user/other-app",
      slug: "x",
    });
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "W my-app B1 help — working, 12 min ago",
      "  B1 · build · sonnet · high",
      "  wk/B1-help · memory - · lead LEAD my-app master-plan",
    ]);

    world.out.length = 0;
    expect(await runWorker(["list", "--all"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "W other P1 x — working, 5 min ago",
      "  P1 · build · sonnet · high",
      "  wk/P1-x · memory - · lead LEAD my-app master-plan · /home/user/other-app",
      "",
      "W my-app B1 help — working, 12 min ago",
      "  B1 · build · sonnet · high",
      `  wk/B1-help · memory - · lead LEAD my-app master-plan · ${world.repo}`,
    ]);
  });

  test("`--all` keeps each repository's events apart, also when two workers share an id", async () => {
    const world = await boardWorld();
    const mine = await world.addWorker();
    await updateWorker(
      world.paths.stateDir,
      world.repo,
      mine.id,
      { state: "blocked" },
      NOW - 5 * MINUTE,
      "waiting for the lead",
    );
    // The same id in another repository's store, still working since it was recorded.
    await world.addWorker({ repo: "/home/user/other-app", atMs: NOW - 90 * MINUTE });
    expect(await runWorker(["list", "--all"], world.ctx())).toBe(0);
    const blocks = world.out.join("\n").split("\n\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toStartWith("W my-app B1 help — blocked, 5 min ago");
    expect(blocks[1]).toStartWith("W my-app B1 help — working, 1 h ago");
  });

  test("`--json` prints the records, newest first, as one JSON list and nothing else", async () => {
    const world = await boardWorld();
    await world.addWorker({ atMs: NOW - 60 * MINUTE, phase: "B0", slug: "old" });
    await world.addWorker({ memoryMb: 256, state: "done" });
    expect(await runWorker(["list", "--json"], world.ctx())).toBe(0);
    expect(world.out).toHaveLength(1);
    const records = JSON.parse(world.out[0] ?? "") as Array<Record<string, unknown>>;
    expect(records.map((one) => one.id)).toEqual(["B1-help-1a2b3c", "B0-old-1a2b3c"]);
    expect(records[0]).toMatchObject({
      branch: "wk/B1-help",
      memoryMb: 256,
      name: "W my-app B1 help",
      repo: world.repo,
      state: "done",
      version: 1,
    });
  });

  test("an empty board says so, in text and as JSON", async () => {
    const world = await boardWorld();
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(await runWorker(["list", "--all"], world.ctx())).toBe(0);
    expect(await runWorker(["list", "--json"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      `No workers in ${world.repo}.`,
      "No workers on this machine.",
      "[]",
    ]);
  });

  test("a record that cannot be read is named on stderr, and the rest of the board still prints", async () => {
    const world = await boardWorld();
    await world.addWorker();
    const broken = workerFile(world.paths.stateDir, world.repo, "broken");
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(broken, "{not json");
    expect(await runWorker(["list"], world.ctx())).toBe(0);
    expect(world.out[0]).toBe("W my-app B1 help — working, 12 min ago");
    expect(world.err).toHaveLength(1);
    expect(world.err[0]).toStartWith(`worker list: Invalid ${broken}: not valid JSON`);
  });

  test("a store that cannot be read is one line and exit 1, never a stack trace", async () => {
    const world = await boardWorld();
    await world.addWorker();
    // The events log is a folder: reading it fails with the system's own words.
    const log = workerEventsFile(world.paths.stateDir, world.repo);
    rmSync(log);
    mkdirSync(log);
    for (const argv of [["list"], ["status", "B1-help-1a2b3c"]]) {
      world.err.length = 0;
      expect(await runWorker(argv, world.ctx())).toBe(1);
      expect(world.err).toHaveLength(1);
      expect(world.err[0]).toStartWith(`worker ${argv[0]}: `);
      expect(world.err[0]).toContain("EISDIR");
    }
    expect(world.out).toEqual([]);
  });

  test("the memory is read only for a board that has a queued worker", async () => {
    const world = await boardWorld();
    await world.addWorker();
    let reads = 0;
    const counting = {
      freeMemoryGb: () => {
        reads += 1;
        return Promise.resolve(64);
      },
    };
    expect(await runWorker(["list"], world.ctx(counting))).toBe(0);
    expect(reads).toBe(0);
    await world.addWorker({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    expect(await runWorker(["list"], world.ctx(counting))).toBe(0);
    expect(reads).toBe(1);
  });

  test("outside a git project the board needs `--all`", async () => {
    const world = await boardWorld();
    const elsewhere = tempDir("elsewhere");
    expect(await runWorker(["list"], world.ctx({ cwd: elsewhere }))).toBe(1);
    expect(world.err).toEqual([
      "worker list: this folder is not in a git project",
      "Fix: run it in the project's folder, or add --all",
    ]);
    world.err.length = 0;
    expect(await runWorker(["list", "--all"], world.ctx({ cwd: elsewhere }))).toBe(0);
    expect(world.err).toEqual([]);
  });

  test("a mistake is exit 2 with the line that says where the help is", async () => {
    const world = await boardWorld();
    expect(await runWorker(["list", "--nope"], world.ctx())).toBe(2);
    expect(await runWorker(["list", "extra"], world.ctx())).toBe(2);
    expect(await runWorker(["list", "--all=1"], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      `Unknown option: --nope\nSee: ${COMMAND} worker list --help`,
      `Unknown argument: extra\nSee: ${COMMAND} worker list --help`,
      `--all takes no value\nSee: ${COMMAND} worker list --help`,
    ]);
  });
});

describe("worker status", () => {
  test("one worker in full: the record, its paths, the question it waits on, its last events", async () => {
    const world = await boardWorld();
    const stateDir = world.paths.stateDir;
    const record = await world.addWorker({
      effort: "max",
      files: ["src/a.ts", "src/b.ts"],
      lastLine: "running the full suite",
      memoryMb: 512,
      model: SLOT_MODEL,
      waitsFor: ["B0"],
    });
    await updateWorker(
      stateDir,
      world.repo,
      record.id,
      { state: "blocked" },
      NOW - 5 * MINUTE,
      "waiting for the lead",
    );
    await updateWorker(
      stateDir,
      world.repo,
      record.id,
      { pr: 12, reportPath: "/x/report.json" },
      NOW - 4 * MINUTE,
    );
    await addWorkerQuestion(
      stateDir,
      world.repo,
      record.id,
      { options: ["one", "two"], question: "Which cap should it use?", recommended: 2 },
      NOW - 3 * MINUTE,
    );
    const sha = git(world.repo, "rev-parse", "--short=7", "HEAD").trim();
    const files = `~/.claude/cc-smart-dev-kit/workers/${repoKey(world.repo)}/files/B1-help-1a2b3c`;

    expect(await runWorker(["status", "W my-app B1 help"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "W my-app B1 help (B1-help-1a2b3c)",
      "state     blocked, 5 min ago",
      "kind      build",
      "model     sonnet → omniroute:glm-5.1 (slot cc-smart-dev-kit-worker)",
      "effort    max",
      "phase     B1 of master-plan",
      "waits for B0",
      "files     src/a.ts, src/b.ts",
      `branch    wk/B1-help, cut from main at ${sha}`,
      `worktree  ${world.repo}/.claude/worktrees/wk-B1-help`,
      "session   a1b2c3d4 (a1b2c3d4-0000-1111-2222-333333333333)",
      "lead      LEAD my-app master-plan",
      "pr        #12",
      "memory    512 MB",
      "last      running the full suite",
      `brief     ${files}/brief.md`,
      "report    /x/report.json",
      "question  asked 3 min ago: Which cap should it use?",
      "          1) one",
      "          2) two (recommended)",
      "recent events:",
      "  2026-10-21T09:48:00.000Z  created   working",
      "  2026-10-21T09:55:00.000Z  state     blocked  waiting for the lead",
      "  2026-10-21T09:57:00.000Z  question  blocked  Which cap should it use?",
    ]);
  });

  test("a worker not started yet: no session, no report, no question, no line", async () => {
    const world = await boardWorld();
    await world.addWorker({
      atMs: NOW - 5 * MINUTE,
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    expect(await runWorker(["status", "B2-api-1a2b3c"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "W my-app B2 api (B2-api-1a2b3c)",
      "state     queued, 5 min ago",
      "kind      build",
      "model     sonnet",
      "effort    high",
      "phase     B2 of master-plan",
      "branch    wk/B2-api, to be cut from main",
      `worktree  ${world.repo}/.claude/worktrees/wk-B2-api`,
      "session   none yet",
      "lead      LEAD my-app master-plan",
      "memory    -",
      `brief     ~/.claude/cc-smart-dev-kit/workers/${repoKey(world.repo)}/files/B2-api-1a2b3c/brief.md`,
      "report    none yet",
      "question  none open",
      "recent events:",
      "  2026-10-21T09:55:00.000Z  created   queued",
    ]);
  });

  test("a worker is found by its name, its id, its short id or its session id", async () => {
    const world = await boardWorld();
    await world.addWorker();
    for (const ref of [
      "W my-app B1 help",
      "W my-app B1 help [a1b2c3d4]",
      "B1-help-1a2b3c",
      "a1b2c3d4",
      "a1b2c3d4-0000-1111-2222-333333333333",
    ]) {
      world.out.length = 0;
      expect(await runWorker(["status", ref], world.ctx())).toBe(0);
      expect(world.out[0]).toBe("W my-app B1 help (B1-help-1a2b3c)");
    }
  });

  test("a name that matches two workers is refused, and both are named", async () => {
    const world = await boardWorld();
    await world.addWorker({ atMs: NOW - 30 * MINUTE, state: "removed", suffix: "aaaaaa" });
    await world.addWorker({
      atMs: NOW - 20 * MINUTE,
      slug: "again",
      name: "W my-app B1 help",
      suffix: "bbbbbb",
    });
    expect(await runWorker(["status", "W my-app B1 help"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      'worker status: "W my-app B1 help" is two workers',
      "  B1-help-aaaaaa  W my-app B1 help  removed",
      "  B1-again-bbbbbb  W my-app B1 help  working",
      "Fix: name one by its id",
    ]);
  });

  test("a name nobody has, no name at all, and more than one word", async () => {
    const world = await boardWorld();
    await world.addWorker();
    expect(await runWorker(["status", "W my-app B9 nope"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      'worker status: no worker of this repository is "W my-app B9 nope"',
      `Fix: ${COMMAND} worker list shows them, and --all those of every repository`,
    ]);
    world.err.length = 0;
    expect(await runWorker(["status"], world.ctx())).toBe(2);
    expect(await runWorker(["status", "W", "my-app"], world.ctx())).toBe(2);
    expect(world.err).toEqual([
      `Say which worker: worker status <name|id>\nSee: ${COMMAND} worker status --help`,
      `Unknown argument: my-app (put a name with spaces in quotes)\nSee: ${COMMAND} worker status --help`,
    ]);
  });
});

describe("worker kinds", () => {
  test("the table of WORKER_KINDS, a row each, with the effort on Claude and on an affordable slot", async () => {
    const world = await boardWorld();
    expect(await runWorker(["kinds"], world.ctx())).toBe(0);
    expect(world.out).toHaveLength(WORKER_KIND_NAMES.length + 1);
    expect(world.out[0]).toBe("kind          model   effort on Claude  effort on a slot  for");
    expect(world.out[1]).toBe(
      "build         sonnet  high              max               routine building",
    );
    expect(world.out[4]).toBe(
      "security      opus    xhigh             xhigh             code that touches security",
    );
    // Every row is the table's own: the kind, the model, both efforts and what it is for.
    for (const [index, kind] of WORKER_KIND_NAMES.entries()) {
      const policy = WORKER_KINDS[kind];
      const cells = (world.out[index + 1] ?? "").split(/ {2,}/);
      expect(cells).toEqual([
        kind,
        policy.model,
        policy.effort,
        policy.affordableEffort,
        policy.about,
      ]);
    }
  });
});

describe("worker attach", () => {
  test("prints the command and does not run it: it needs a terminal", async () => {
    const world = await boardWorld();
    await world.addWorker();
    expect(await runWorker(["attach", "W my-app B1 help"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "claude attach a1b2c3d4",
      "Run it in a terminal to open W my-app B1 help there; Ctrl+Z drops back to your shell, and the session keeps running.",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a worker with no session has nothing to attach to", async () => {
    const world = await boardWorld();
    await world.addWorker({ shortId: null, state: "queued", worktree: false });
    expect(await runWorker(["attach", "B1-help-1a2b3c"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker attach: W my-app B1 help has no session yet (it is queued)",
      `Fix: ${COMMAND} worker list shows when it starts`,
    ]);
  });
});
