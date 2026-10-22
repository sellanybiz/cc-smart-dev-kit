/**
 * `worker self-watch` (`self-watch.ts`): the worker's own line about its context and its time.
 * One line at the hand-off share of the context, one note when the phase runs long, one hand-off
 * when the time is up — and nothing else.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFolderName } from "../sessions/saved-sessions";
import { git } from "../testing/temp";
import { LEAD_SESSION, workerWorld } from "../testing/worker-world";
import { runWorker } from "./command";
import { adviceFor, hoursSince, type SelfThresholds } from "./self-watch";
import { createWorker, writeLead } from "./store";
import { contextPercent, contextWindowOf } from "./transcript";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "W my-app B6b portal-live";

/** The thresholds the plan set. */
const THRESHOLDS: SelfThresholds = { handoffPercent: 70, maxHours: 4, softHours: 2 };

/** A world with one worker whose transcript says `tokens` of context. */
async function workerWorldWith(tokens: number, startedHoursAgo = 0) {
  const world = workerWorld();
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
  const worktree = join(world.repo, ".claude", "worktrees", "wk-B6b-portal-live");
  // A real worktree: the worker's own monitor finds its worker by it.
  git(world.repo, "worktree", "add", "-q", "-b", "wk/B6b-portal-live", worktree);
  await createWorker(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "wk/B6b-portal-live",
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
  // The worker's own transcript, under its worktree's project folder.
  const folder = join(world.paths.projectsDir, projectFolderName(worktree));
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "aaaa1111-2222-3333-4444-555555555555.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
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

describe("the thresholds the worker watches itself against", () => {
  test("D25: the context share, the long note and the time up", () => {
    expect(adviceFor(null, 0.5, THRESHOLDS)).toBeNull();
    expect(adviceFor(null, 1.9, THRESHOLDS)).toBeNull();
    expect(adviceFor(50, 0.5, THRESHOLDS)).toBeNull();
    expect(adviceFor(70, 0.5, THRESHOLDS)?.kind).toBe("context");
    expect(adviceFor(71, 0.5, THRESHOLDS)?.line).toBe(
      "context at 71%: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
    );
    expect(adviceFor(null, 2.1, THRESHOLDS)?.kind).toBe("long");
    expect(adviceFor(null, 4.1, THRESHOLDS)?.kind).toBe("time");
    // The time up comes first: the worker must not hear two lines.
    expect(adviceFor(90, 5, THRESHOLDS)?.kind).toBe("time");
  });

  test("the window: Claude Code's own, and the 1M suffix", () => {
    expect(contextWindowOf("claude-opus-5-5")).toBe(200_000);
    expect(contextWindowOf("claude-sonnet-5-5[1m]")).toBe(1_000_000);
    // The family name a plain-Claude worker is launched with: the main hand-off trigger must
    // not be off for it.
    expect(contextWindowOf("sonnet")).toBe(200_000);
    expect(contextWindowOf("opus")).toBe(200_000);
    expect(contextWindowOf("some-backend:some-model")).toBeNull();
    expect(contextWindowOf("glm-5.3-flash")).toBeNull();
  });

  test("the share of the window", () => {
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 140_000 }, 200_000)).toBe(70);
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 0 }, 200_000)).toBeNull();
    expect(contextPercent({ changedAtMs: 0, model: null, tokens: 140_000 }, null)).toBeNull();
  });

  test("the hours since the worker started", () => {
    expect(hoursSince(T0, T0)).toBe(0);
    expect(hoursSince(T0, T0 + 3_600_000)).toBe(1);
  });
});

describe("worker self-watch", () => {
  test("D25: a worker with room to work hears nothing", async () => {
    const world = await workerWorldWith(20_000);
    const code = await runWorker(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([]);
  });

  test("D25: at the hand-off share, the worker is told to hand off", async () => {
    const world = await workerWorldWith(150_000);
    await runWorker(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
    ]);
  });

  test("D25: the same line is not said twice within a quarter of an hour", async () => {
    const world = await workerWorldWith(150_000);
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_WORKER: ID });
    await runWorker(["self-watch", "--once"], ctx);
    world.out.length = 0;
    await runWorker(["self-watch", "--once"], ctx);
    expect(world.out).toEqual([]);
  });

  test("D25: a long phase gets a note", async () => {
    const world = await workerWorldWith(20_000, 3);
    await runWorker(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(world.out).toEqual([
      '3.0 hours into this phase: it is long. Tell the lead where it stands (`cc-smart-dev-kit worker step <the step you are at> --note "<where you stand>"`), or hand off.',
    ]);
  });

  test("D35: a worker past its time cap is told to hand off", async () => {
    const world = await workerWorldWith(20_000, 5);
    await runWorker(
      ["self-watch", "--once"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_WORKER: ID }),
    );
    expect(world.out).toEqual([
      "5.0 hours into this phase: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
    ]);
  });

  test("D25: the watch repeats its line when it is ignored, and stops when the phase ends", async () => {
    const world = await workerWorldWith(150_000);
    // A clock the test drives: each round is one poll later. The worker's phase ends at round 17.
    let clock = T0;
    let rounds = 0;
    const ctx = world.ctx(
      {
        cwd: world.worktree,
        now: () => clock,
        sleep: async (ms: number) => {
          rounds += 1;
          clock += ms;
          if (rounds === 17) {
            const { updateWorker } = await import("./store");
            await updateWorker(world.paths.stateDir, world.repo, ID, { state: "done" }, clock);
          }
        },
      },
      { CC_SMART_DEV_KIT_WORKER: ID },
    );
    const code = await runWorker(["self-watch"], ctx);
    expect(code).toBe(0);
    // The line at once, and the same line again after a quarter of an hour (round 15) — not
    // on the rounds between — and then the loop ends with the phase.
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
    ]);
    expect(rounds).toBe(17);
  });

  test("D25: a worker's own monitor finds its worker by the worktree", async () => {
    const world = await workerWorldWith(150_000);
    // No `CC_SMART_DEV_KIT_WORKER`: a plugin's monitor is a process of the host, and the
    // settings' env may not reach it.
    const code = await runWorker(["self-watch", "--once"], world.ctx({ cwd: world.worktree }));
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out).toEqual([
      "context at 75%: hand off now — commit your work in progress, then run `cc-smart-dev-kit worker report --status handoff`",
    ]);
  });

  test("D25: a self-watch outside a worker is refused", async () => {
    const world = await workerWorldWith(150_000);
    // The lead's own folder is no worker's worktree, and the environment names no worker.
    const code = await runWorker(["self-watch", "--once"], world.ctx({ cwd: world.repo }));
    expect(code).toBe(1);
    expect(world.err[0]).toContain("not a worker");
  });
});
