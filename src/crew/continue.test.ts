/**
 * `crew start --continue <old crew session>`: the hand-off. A new crew session of the same phase, cut
 * from the old crew session's head, with the old brief and the old crew session's report, and the next
 * number in its name. The old crew session is stopped, not removed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { runCrew } from "./command";
import {
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewReportFile,
  listCrew,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
const NAME = "C my-app B6b portal-live";

/** The next crew session's own random suffix (a real start draws a new one every time). */
const NEXT = { randomSuffix: () => "9f8e7d" };

/** A world with a lead and one crew session that handed off, owning `files`. */
async function handoffWorld(files: string[] = []) {
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
  git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree);
  const head = git(worktree, "rev-parse", "HEAD").trim();
  await createCrew(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
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
  // The old crew session's brief and its hand-off report.
  const { writeStoreFile } = await import("./store");
  writeStoreFile(
    crewBriefFile(world.paths.stateDir, world.repo, ID),
    "# B6b\n\nBuild the live stream.\n\n---\n\n## Your frame (written by `cc-smart-dev-kit crew start`)\n\n- You are the crew session `C my-app B6b portal-live`.\n",
  );
  const { writeReport } = await import("./store");
  await writeReport(world.paths.stateDir, world.repo, ID, {
    base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
    branch: { name: "crew/B6b-portal-live", sha: head },
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

/** The crew session of `phase`/`slug`, by its name. */
function crewNamed(records: CrewRecord[], name: string): CrewRecord | undefined {
  return records.find((one) => one.name === name);
}

describe("crew start --continue", () => {
  test("D25: the hand-off — the same phase, cut from the old head, with the next number", async () => {
    const world = await handoffWorld();
    const code = await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    expect(world.out[0]).toStartWith("started C my-app master-plan B6b portal-live 2 (");
    const records = listCrew(world.paths.stateDir, world.repo).records;
    const next = crewNamed(records, "C my-app master-plan B6b portal-live 2");
    expect(next).toBeDefined();
    expect(next?.branch).toBe("crew/B6b-portal-live-2");
    expect(next?.worktree).toBe(join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live-2"));
    // The base is recorded as the commit: the old branch's name can go (`crew rm`) or move.
    expect(next?.base).toEqual({ ref: world.head, sha: world.head });
    expect(next?.phase).toBe("B6b");
    expect(next?.slug).toBe("portal-live");
  });

  test("D25: the new crew session's brief is the old brief and the old crew session's report", async () => {
    const world = await handoffWorld();
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const records = listCrew(world.paths.stateDir, world.repo).records;
    const next = crewNamed(records, "C my-app master-plan B6b portal-live 2");
    const brief = readFileSync(
      crewBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("Build the live stream.");
    expect(brief).toContain("What B6b left behind");
    expect(brief).toContain("the live stream still needs its page");
    expect(brief).toContain("What only the lead may do: the version bump.");
    // The frame is written again, for the new crew session.
    expect(brief).toContain("You are the crew session `C my-app master-plan B6b portal-live 2`");
  });

  test("D25: the old crew session is stopped, not removed", async () => {
    const world = await handoffWorld();
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(world.claudeCalls()).toContainEqual(["stop", "aaaa1111"]);
    const records = listCrew(world.paths.stateDir, world.repo).records;
    expect(crewNamed(records, NAME)).toBeDefined();
    // Its record stays `handoff` — the store's own word for "handed off to a next crew session, and
    // ended" — and its branch and its worktree stay, for `crew rm`.
    expect(crewNamed(records, NAME)?.state).toBe("handoff");
    expect(world.out).toContain(
      "C my-app B6b portal-live: session stopped — it handed off; its branch and its record stay",
    );
  });

  test("CL2: stopped, done and failed work can be continued without changing the old outcome", async () => {
    for (const state of ["stopped", "done", "failed"] as const) {
      const world = await handoffWorld();
      const { updateCrew } = await import("./store");
      await updateCrew(world.paths.stateDir, world.repo, ID, { state }, T0);
      expect(await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
      expect(crewNamed(listCrew(world.paths.stateDir, world.repo).records, NAME)?.state).toBe(
        state,
      );
    }
  });

  test("D25: a crew session that did not hand off cannot be continued", async () => {
    const world = await handoffWorld();
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, ID, { state: "working" }, T0);
    const code = await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(code).toBe(1);
    expect(world.err[0]).toContain("only a crew session that handed off");
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("D25: a crew session the store does not know cannot be continued", async () => {
    const world = await handoffWorld();
    const code = await runCrew(["start", "B6b", "--continue", "C my-app B6c other"], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("C my-app B6c other");
  });

  test("D25: a continuation of another phase is refused", async () => {
    const world = await handoffWorld();
    const code = await runCrew(["start", "B6c", "--continue", NAME], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("works on phase B6b");
  });

  test("D25: the brief is not needed for a continuation", async () => {
    const world = await handoffWorld();
    const code = await runCrew(
      ["start", "B6b", "--continue", NAME, "--brief", join(tempDir("brief"), "b.md")],
      world.ctx(NEXT),
    );
    expect(code).toBe(0);
  });

  test("D25: the next crew session's id keeps the one scheme: phase, slug, six hex", async () => {
    const world = await handoffWorld();
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 2",
    );
    expect(next?.id).toBe("B6b-portal-live-9f8e7d");
  });

  test("D25: the chain is recorded on the next crew session, never worked out from names", async () => {
    const world = await handoffWorld();
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const records = listCrew(world.paths.stateDir, world.repo).records;
    const next = crewNamed(records, "C my-app master-plan B6b portal-live 2");
    expect(next?.continues).toBe(ID);
    // The first crew session continues no one.
    expect(crewNamed(records, NAME)?.continues).toBeUndefined();
    expect(next?.waitsFor).toEqual([]);
  });

  test("D25: the next crew session owns the files the old one owned, and its frame says so", async () => {
    const world = await handoffWorld(["src/a.ts", "src/b.ts"]);
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 2",
    );
    expect(next?.files).toEqual(["src/a.ts", "src/b.ts"]);
    const brief = readFileSync(
      crewBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("The files this phase owns: `src/a.ts`, `src/b.ts`.");
  });

  test("D25: a slug that ends in a number is not mistaken for a second crew session", async () => {
    const world = await handoffWorld();
    // A first crew session whose slug is `step-2`: its branch ends in `-2`, as a next crew session's would.
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      ID,
      { branch: "crew/B6b-step-2", slug: "step-2" },
      T0,
    );
    git(world.repo, "branch", "-m", "crew/B6b-portal-live", "crew/B6b-step-2");
    expect(await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    world.err.length = 0;
    // A second --continue is still refused, by the recorded chain.
    const again = await runCrew(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(again).toBe(1);
    expect(world.err[0]).toContain("has its next crew session already");
  });

  test("D25: a hand-off has one next crew session; a second --continue is refused", async () => {
    const world = await handoffWorld();
    expect(await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    world.err.length = 0;
    const code = await runCrew(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toBe(
      "crew start: C my-app B6b portal-live has its next crew session already: C my-app master-plan B6b portal-live 2, starting",
    );
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(2);
  });

  test("D25: a next crew session that failed leaves the way free, with the next number after it", async () => {
    const world = await handoffWorld();
    // The first try at a next crew session fails at once (claude refuses), and is taken back.
    expect(
      await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT, { FAKE_BG: "fail" })),
    ).toBe(1);
    world.out.length = 0;
    world.err.length = 0;
    const code = await runCrew(
      ["start", "B6b", "--continue", NAME],
      world.ctx({ randomSuffix: () => "0a1b2c" }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    // The failed record counts for the number: the new crew session is the third, never the second.
    expect(world.out[0]).toStartWith("started C my-app master-plan B6b portal-live 3 (");
  });

  test("D25: an old crew session whose report cannot be read is not continued", async () => {
    const world = await handoffWorld();
    writeFileSync(crewReportFile(world.paths.stateDir, world.repo, ID), "{ not json");
    const code = await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    expect(code).toBe(1);
    expect(world.err[0]).toContain(`the report of ${NAME} cannot be read`);
    expect(listCrew(world.paths.stateDir, world.repo).records).toHaveLength(1);
  });

  test("D25: the old crew session's own words are in the next brief", async () => {
    const world = await handoffWorld();
    const { writeReport } = await import("./store");
    await writeReport(world.paths.stateDir, world.repo, ID, {
      base: { ref: "main", sha: git(world.repo, "rev-parse", "HEAD").trim() },
      branch: { name: "crew/B6b-portal-live", sha: world.head },
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
    await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT));
    const next = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 2",
    );
    const brief = readFileSync(
      crewBriefFile(world.paths.stateDir, world.repo, next?.id ?? ""),
      "utf8",
    );
    expect(brief).toContain("Its own words:\n\nThe stream opens; the page is next.");
  });

  test("D25: a third crew session's brief carries the second's report, and the first's text once", async () => {
    const world = await handoffWorld();
    expect(await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    const second = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 2",
    );
    // The second crew session hands off too.
    const { updateCrew, writeReport } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, second?.id ?? "", { state: "handoff" }, T0);
    await writeReport(world.paths.stateDir, world.repo, second?.id ?? "", {
      base: { ref: "crew/B6b-portal-live", sha: world.head },
      branch: { name: "crew/B6b-portal-live-2", sha: world.head },
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
      await runCrew(
        ["start", "B6b", "--continue", "C my-app master-plan B6b portal-live 2"],
        world.ctx({ randomSuffix: () => "0a1b2c" }),
      ),
    ).toBe(0);
    const third = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 3",
    );
    const brief = readFileSync(
      crewBriefFile(world.paths.stateDir, world.repo, third?.id ?? ""),
      "utf8",
    );
    expect(brief.split("Build the live stream.").length - 1).toBe(1);
    expect(brief.split("## Your frame (written by").length - 1).toBe(1);
    expect(brief).toContain("What is still open: the page.");
    expect(third?.branch).toBe("crew/B6b-portal-live-3");
  });
});

describe("NM1: a continuation keeps the commit it starts from", () => {
  /** A queued continuation: it waits for a phase that never merges, so it keeps the base it was planned with. */
  async function queuedContinuation() {
    const world = await handoffWorld();
    const { updateCrew } = await import("./store");
    await updateCrew(world.paths.stateDir, world.repo, ID, { waitsFor: ["Z9"] }, T0);
    expect(await runCrew(["start", "B6b", "--continue", NAME], world.ctx(NEXT))).toBe(0);
    const next = crewNamed(
      listCrew(world.paths.stateDir, world.repo).records,
      "C my-app master-plan B6b portal-live 2",
    );
    expect(next?.state).toBe("queued");
    return { next: next as CrewRecord, world };
  }

  test("it stores the commit, so `crew rm` of the old record cannot take its base away", async () => {
    const { next, world } = await queuedContinuation();
    expect(next.baseRef).toBe(world.head);
    const { updateCrew } = await import("./store");
    expect(await runCrew(["rm", ID], world.ctx())).toBe(0);
    expect(git(world.repo, "branch", "--list", "crew/B6b-portal-live").trim()).toBe("");
    // The old branch is gone, and the continuation still starts, from the commit.
    const { startQueued } = await import("./start");
    const { defaultResolved } = await import("../testing/fake-workflow");
    // The phase it waited for is merged now: only the base is left to resolve.
    await updateCrew(world.paths.stateDir, world.repo, next.id, { waitsFor: [] }, T0);
    await startQueued({ ...next, waitsFor: [] }, world.ctx(NEXT), defaultResolved());
    const after = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === next.id,
    );
    expect(after?.state).toBe("starting");
    expect(after?.base?.sha).toBe(world.head);
  });

  test("a record from before the change, with only a branch name, still starts", async () => {
    const { next, world } = await queuedContinuation();
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      next.id,
      { baseRef: "crew/B6b-portal-live" },
      T0,
    );
    const legacy = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === next.id,
    ) as CrewRecord;
    const { startQueued } = await import("./start");
    const { defaultResolved } = await import("../testing/fake-workflow");
    await updateCrew(world.paths.stateDir, world.repo, next.id, { waitsFor: [] }, T0);
    await startQueued({ ...legacy, waitsFor: [] }, world.ctx(NEXT), defaultResolved());
    const after = listCrew(world.paths.stateDir, world.repo).records.find(
      (one) => one.id === next.id,
    );
    expect(after?.state).toBe("starting");
    expect(after?.base).toEqual({ ref: "crew/B6b-portal-live", sha: world.head });
  });
});
