/**
 * `worker start --continue <old worker>`: the hand-off. A new worker of the same phase, cut
 * from the old worker's head, with the old brief and the old worker's report, and the next
 * number in its name. The old worker is stopped, not removed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, tempDir } from "../testing/temp";
import { LEAD_SESSION, workerWorld } from "../testing/worker-world";
import { runWorker } from "./command";
import {
  createWorker,
  listWorkers,
  type WorkerRecord,
  workerBriefFile,
  workerReportFile,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "W my-app B6b portal-live";

/** The next worker's own random suffix (a real start draws a new one every time). */
const NEXT = { randomSuffix: () => "9f8e7d" };

/** A world with a lead and one worker that handed off, owning `files`. */
async function handoffWorld(files: string[] = []) {
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
  git(world.repo, "worktree", "add", "-q", "-b", "wk/B6b-portal-live", worktree);
  const head = git(worktree, "rev-parse", "HEAD").trim();
  await createWorker(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "wk/B6b-portal-live",
      effort: "high",
      files,
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
      state: "handoff",
      waitsFor: [],
      worktree,
    },
    T0,
  );
  // The old worker's brief and its hand-off report.
  const { writeStoreFile } = await import("./store");
  writeStoreFile(
    workerBriefFile(world.paths.stateDir, world.repo, ID),
    "# B6b\n\nBuild the live stream.\n\n---\n\n## Your frame (written by `cc-smart-dev-kit worker start`)\n\n- You are the worker `W my-app B6b portal-live`.\n",
  );
  const { writeReport } = await import("./store");
  await writeReport(world.paths.stateDir, world.repo, ID, {
    base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
    branch: { name: "wk/B6b-portal-live", sha: head },
    changed: { deletions: 0, files: 2, insertions: 40 },
    checks: [],
    docs: ["docs/design.md"],
    needsLead: ["the version bump"],
    open: ["the live stream still needs its page"],
    outsideBrief: [],
    phase: "B6b",
    pr: null,
    question: null,
    review: null,
    status: "handoff",
    tests: { full: null, targeted: [] },
    version: 1,
  });
  return { ...world, head };
}

/** The worker of `phase`/`slug`, by its name. */
function workerNamed(records: WorkerRecord[], name: string): WorkerRecord | undefined {
  return records.find((one) => one.name === name);
}

describe("worker start --continue", () => {
  test("D25: the hand-off — the same phase, cut from the old head, with the next number", async () => {
    const world = await handoffWorld();
    const code = await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out[0]).toStartWith("started W my-app B6b portal-live 2 (");
    const records = listWorkers(world.paths.stateDir, world.repo).records;
    const next = workerNamed(records, "W my-app B6b portal-live 2");
    expect(next).toBeDefined();
    expect(next?.branch).toBe("wk/B6b-portal-live-2");
    expect(next?.worktree).toBe(join(world.repo, ".claude", "worktrees", "wk-B6b-portal-live-2"));
    expect(next?.base).toEqual({ ref: "wk/B6b-portal-live", sha: world.head });
    expect(next?.phase).toBe("B6b");
    expect(next?.slug).toBe("portal-live");
  });

  test("D25: the new worker's brief is the old brief and the old worker's report", async () => {
    const world = await handoffWorld();
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const records = listWorkers(world.paths.stateDir, world.repo).records;
    const next = workerNamed(records, "W my-app B6b portal-live 2");
    const brief = readFileSync(
      workerBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("Build the live stream.");
    expect(brief).toContain("What B6b left behind");
    expect(brief).toContain("the live stream still needs its page");
    expect(brief).toContain("What only the lead may do: the version bump.");
    // The frame is written again, for the new worker.
    expect(brief).toContain("You are the worker `W my-app B6b portal-live 2`");
  });

  test("D25: the old worker is stopped, not removed", async () => {
    const world = await handoffWorld();
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(world.claudeCalls()).toContainEqual(["stop", "aaaa1111"]);
    const records = listWorkers(world.paths.stateDir, world.repo).records;
    expect(workerNamed(records, NAME)).toBeDefined();
    // Its record stays `handoff` — the store's own word for "handed off to a next worker, and
    // ended" — and its branch and its worktree stay, for `worker rm`.
    expect(workerNamed(records, NAME)?.state).toBe("handoff");
    expect(world.out).toContain(
      "W my-app B6b portal-live: session stopped — it handed off; its branch and its record stay",
    );
  });

  test("D25: a worker that did not hand off cannot be continued", async () => {
    const world = await handoffWorld();
    const { updateWorker } = await import("./store");
    await updateWorker(world.paths.stateDir, world.repo, ID, { state: "working" }, T0);
    const code = await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(code).toBe(1);
    expect(world.err[0]).toContain("only a worker that handed off");
    expect(listWorkers(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("D25: a worker the store does not know cannot be continued", async () => {
    const world = await handoffWorld();
    const code = await runWorker(["start", "B6b", "--continue", "W my-app B6c other"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("W my-app B6c other");
  });

  test("D25: a continuation of another phase is refused", async () => {
    const world = await handoffWorld();
    const code = await runWorker(["start", "B6c", "--continue", NAME], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("works on phase B6b");
  });

  test("D25: the brief is not needed for a continuation", async () => {
    const world = await handoffWorld();
    const code = await runWorker(
      ["start", "B6b", "--continue", NAME, "--brief", join(tempDir("brief"), "b.md")],
      world.ctx(NEXT),
    );
    expect(code).toBe(0);
  });

  test("D25: the next worker's id keeps the one scheme: phase, slug, six hex", async () => {
    const world = await handoffWorld();
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = workerNamed(
      listWorkers(world.paths.stateDir, world.repo).records,
      "W my-app B6b portal-live 2",
    );
    expect(next?.id).toBe("B6b-portal-live-9f8e7d");
  });

  test("D25: the chain is recorded on the next worker, never worked out from names", async () => {
    const world = await handoffWorld();
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const records = listWorkers(world.paths.stateDir, world.repo).records;
    const next = workerNamed(records, "W my-app B6b portal-live 2");
    expect(next?.continues).toBe(ID);
    // The first worker continues no one.
    expect(workerNamed(records, NAME)?.continues).toBeUndefined();
    expect(next?.waitsFor).toEqual([]);
  });

  test("D25: the next worker owns the files the old one owned, and its frame says so", async () => {
    const world = await handoffWorld(["src/a.ts", "src/b.ts"]);
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = workerNamed(
      listWorkers(world.paths.stateDir, world.repo).records,
      "W my-app B6b portal-live 2",
    );
    expect(next?.files).toEqual(["src/a.ts", "src/b.ts"]);
    const brief = readFileSync(
      workerBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("The files this phase owns: `src/a.ts`, `src/b.ts`.");
  });

  test("D25: a slug that ends in a number is not mistaken for a second worker", async () => {
    const world = await handoffWorld();
    // A first worker whose slug is `step-2`: its branch ends in `-2`, as a next worker's would.
    const { updateWorker } = await import("./store");
    await updateWorker(
      world.paths.stateDir,
      world.repo,
      ID,
      { branch: "wk/B6b-step-2", slug: "step-2" },
      T0,
    );
    git(world.repo, "branch", "-m", "wk/B6b-portal-live", "wk/B6b-step-2");
    expect(await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    world.err.length = 0;
    // A second --continue is still refused, by the recorded chain.
    const again = await runWorker(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(again).toBe(1);
    expect(world.err[0]).toContain("has its next worker already");
  });

  test("D25: a hand-off has one next worker; a second --continue is refused", async () => {
    const world = await handoffWorld();
    expect(await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    world.err.length = 0;
    const code = await runWorker(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      "worker start: W my-app B6b portal-live has its next worker already: W my-app B6b portal-live 2, working",
    );
    expect(listWorkers(world.paths.stateDir, world.repo).records).toHaveLength(2);
  });

  test("D25: a next worker that failed leaves the way free, with the next number after it", async () => {
    const world = await handoffWorld();
    // The first try at a next worker fails at once (claude refuses), and is taken back.
    expect(
      await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT, { FAKE_BG: "fail" })),
    ).toBe(1);
    world.out.length = 0;
    world.err.length = 0;
    const code = await runWorker(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // The failed record counts for the number: the new worker is the third, never the second.
    expect(world.out[0]).toStartWith("started W my-app B6b portal-live 3 (");
  });

  test("D25: an old worker whose report cannot be read is not continued", async () => {
    const world = await handoffWorld();
    writeFileSync(workerReportFile(world.paths.stateDir, world.repo, ID), "{ not json");
    const code = await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(code).toBe(1);
    expect(world.err[0]).toContain(`the report of ${NAME} cannot be read`);
    expect(listWorkers(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("D25: the old worker's own words are in the next brief", async () => {
    const world = await handoffWorld();
    const { writeReport } = await import("./store");
    await writeReport(world.paths.stateDir, world.repo, ID, {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      branch: { name: "wk/B6b-portal-live", sha: world.head },
      changed: { deletions: 0, files: 2, insertions: 40 },
      checks: [],
      docs: [],
      needsLead: [],
      open: [],
      outsideBrief: [],
      phase: "B6b",
      pr: null,
      question: null,
      review: null,
      status: "handoff",
      summary: "The stream opens; the page is next.",
      tests: { full: null, targeted: [] },
      version: 1,
    });
    await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = workerNamed(
      listWorkers(world.paths.stateDir, world.repo).records,
      "W my-app B6b portal-live 2",
    );
    const brief = readFileSync(
      workerBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("Its own words:\n\nThe stream opens; the page is next.");
  });

  test("D25: a third worker's brief carries the second's report, and the first's text once", async () => {
    const world = await handoffWorld();
    expect(await runWorker(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    const second = workerNamed(
      listWorkers(world.paths.stateDir, world.repo).records,
      "W my-app B6b portal-live 2",
    );
    // The second worker hands off too.
    const { updateWorker, writeReport } = await import("./store");
    await updateWorker(
      world.paths.stateDir,
      world.repo,
      second?.id ?? "",
      { state: "handoff" },
      T0,
    );
    await writeReport(world.paths.stateDir, world.repo, second?.id ?? "", {
      base: { ref: "wk/B6b-portal-live", sha: world.head },
      branch: { name: "wk/B6b-portal-live-2", sha: world.head },
      changed: { deletions: 0, files: 1, insertions: 5 },
      checks: [],
      docs: [],
      needsLead: [],
      open: ["the page"],
      outsideBrief: [],
      phase: "B6b",
      pr: null,
      question: null,
      review: null,
      status: "handoff",
      tests: { full: null, targeted: [] },
      version: 1,
    });
    expect(
      await runWorker(
        ["start", "B6b", "--continue", "W my-app B6b portal-live 2"],
        world.ctx({ randomSuffix: () => "0a1b2c" }),
      ),
    ).toBe(0);
    const third = workerNamed(
      listWorkers(world.paths.stateDir, world.repo).records,
      "W my-app B6b portal-live 3",
    );
    const brief = readFileSync(
      workerBriefFile(world.paths.stateDir, world.repo, third?.id ?? ""),
      "utf8",
    );
    expect(brief.split("Build the live stream.").length - 1).toBe(1);
    expect(brief.split("## Your frame (written by").length - 1).toBe(1);
    expect(brief).toContain("What is still open: the page.");
    expect(third?.branch).toBe("wk/B6b-portal-live-3");
  });
});
