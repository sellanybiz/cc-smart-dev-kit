/**
 * `crew report` (`report.ts`): the hand-back report a crew session gives its lead, and the question
 * it asks (D36). The command fills the mechanical facts itself — branch and sha, the base, the
 * diff counts, the files outside the brief, the review record, the pull request — and validates
 * the model's part against the store's report shape.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { recordReview, reviewsFile } from "../workflow/reviews";
import { runCrew } from "./command";
import {
  createCrew,
  crewReportFile,
  listCrew,
  readCrewEvents,
  readReport,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";

/** A world with one crew session that has committed something on its branch. */
async function crewWorld1(options: { files?: string[]; state?: "working" | "blocked" } = {}) {
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
  const base = git(world.repo, "rev-parse", "HEAD").trim();
  const worktree = join(world.repo, ".claude", "worktrees", "crew-B6b-portal-live");
  git(world.repo, "worktree", "add", "-q", "-b", "crew/B6b-portal-live", worktree, base);
  writeFileSync(join(worktree, "README.md"), "app\nchanged\n");
  writeFileSync(join(worktree, "extra.ts"), "export const extra = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "the phase");
  const head = git(worktree, "rev-parse", "HEAD").trim();
  await recordReview(
    reviewsFile(world.paths.stateDir, world.repo),
    head,
    "cc-smart-dev-kit:reviewer",
    T0,
    "crew/B6b-portal-live",
  );
  await createCrew(
    world.paths.stateDir,
    {
      base: { ref: "main", sha: base },
      baseRef: "main",
      branch: "crew/B6b-portal-live",
      effort: "high",
      files: options.files ?? ["README.md"],
      id: ID,
      kind: "build",
      lastLine: null,
      leadName: "LEAD my-app master-plan",
      leadSessionId: LEAD_SESSION,
      memoryMb: null,
      model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
      name: "C my-app B6b portal-live",
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
      state: options.state ?? "working",
      waitsFor: [],
      worktree,
    },
    T0,
  );
  return { ...world, base, worktree };
}

/** The model's part of a report, as the file the crew session writes. */
function modelPart(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    checks: [{ name: "typecheck", note: null, ok: true }],
    docs: ["docs/design.md"],
    needsLead: ["the version bump"],
    open: [],
    question: null,
    review: {
      agent: "cc-smart-dev-kit:reviewer",
      effort: "xhigh",
      findings: [{ finding: "a leak", fix: "closed" }],
      model: "opus",
      sha: "b".repeat(40),
    },
    tests: {
      full: { command: "bun test", failed: 0, ok: true, passed: 42 },
      targeted: [{ command: "bun test src/crew", failed: 0, ok: true, passed: 12 }],
    },
    ...extra,
  });
}

describe("crew report", () => {
  test("D22: the command fills the mechanical facts and keeps the model's part", async () => {
    const world = await crewWorld1();
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, modelPart());
    const code = await runCrew(
      ["report", "--status", "done", "--file", file],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const head = git(world.worktree, "rev-parse", "HEAD").trim();
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.status).toBe("done");
    expect(report?.phase).toBe("B6b");
    expect(report?.branch).toEqual({ name: "crew/B6b-portal-live", sha: head });
    expect(report?.base).toEqual({ ref: "main", sha: world.base });
    expect(report?.pr).toBeNull();
    expect(report?.changed).toEqual({ deletions: 0, files: 2, insertions: 2 });
    expect(report?.outsideBrief).toEqual(["extra.ts"]);
    expect(report?.docs).toEqual(["docs/design.md"]);
    expect(report?.needsLead).toEqual(["the version bump"]);
    expect(report?.tests.targeted).toHaveLength(1);
    expect(report?.tests.full?.passed).toBe(42);
    expect(report?.review?.agent).toBe("cc-smart-dev-kit:reviewer");
    // The crew session is done, and the lead sees one report event.
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("done");
    expect(record?.reportPath).toBe(crewReportFile(world.paths.stateDir, world.repo, ID));
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "report", text: "done", state: "done" });
  });

  test("D22: a report with files outside the brief names them", async () => {
    const world = await crewWorld1({ files: ["README.md", "src/**"] });
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, modelPart());
    await runCrew(
      ["report", "--status", "done", "--file", file],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.outsideBrief).toEqual(["extra.ts"]);
  });

  test("D36: a question is recorded and the status does not change", async () => {
    const world = await crewWorld1();
    const code = await runCrew(
      [
        "report",
        "--question",
        "which port does the portal use?",
        "--option",
        "3210",
        "--option",
        "3211",
        "--recommend",
        "2",
      ],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
    expect(record?.questions).toHaveLength(1);
    expect(record?.questions[0]).toMatchObject({
      question: "which port does the portal use?",
      options: ["3210", "3211"],
      recommended: 2,
      answer: null,
      answeredAt: null,
    });
    const events = readCrewEvents(world.paths.stateDir, world.repo).events;
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "question", text: "which port does the portal use?" });
  });

  test("D36: a question needs two options, and a recommendation that is one of them", async () => {
    const world = await crewWorld1();
    const one = await runCrew(
      ["report", "--question", "which port?", "--option", "3210"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(one).toBe(2);
    expect(world.err[0]).toContain("two options");
    world.err.length = 0;
    const bad = await runCrew(
      [
        "report",
        "--question",
        "which port?",
        "--option",
        "3210",
        "--option",
        "3211",
        "--recommend",
        "3",
      ],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(bad).toBe(2);
    expect(world.err[0]).toContain("recommends option 3");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.questions).toHaveLength(0);
  });

  test("D22: a report from outside a crew session is refused", async () => {
    const world = await crewWorld1();
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, modelPart());
    const code = await runCrew(["report", "--status", "done", "--file", file], world.ctx());
    expect(code).toBe(1);
    expect(world.err[0]).toContain("not a crew session");
  });

  test("D22: a report without a status is refused", async () => {
    const world = await crewWorld1();
    const code = await runCrew(
      ["report", "--file", "-"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(2);
    expect(world.err[0]).toContain("--status");
  });

  test("D22: a report whose model part does not read as the report shape is refused", async () => {
    const world = await crewWorld1();
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, JSON.stringify({ tests: { targeted: [{ command: "bun test" }] } }));
    const code = await runCrew(
      ["report", "--status", "done", "--file", file],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("the report");
    expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))).toBeNull();
    expect(readCrewEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
  });

  test("D22: a report in prose is kept as the summary, and the facts are still filled", async () => {
    const world = await crewWorld1();
    const file = join(tempDir("report"), "report.md");
    writeFileSync(file, "# B6b\n\nThe live stream works.\n");
    const code = await runCrew(
      ["report", "--status", "done", "--file", file],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.summary).toBe("# B6b\n\nThe live stream works.");
    expect(report?.changed.files).toBe(2);
    expect(report?.branch.name).toBe("crew/B6b-portal-live");
  });

  test("D22: a report with no file has no model part, and the facts are still filled", async () => {
    const world = await crewWorld1();
    const code = await runCrew(
      ["report", "--status", "done"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.summary ?? null).toBeNull();
    expect(report?.tests.targeted).toEqual([]);
    expect(report?.changed.files).toBe(2);
  });

  test("D22: a blocked report names the question it waits on", async () => {
    const world = await crewWorld1();
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, modelPart({ question: null }));
    const code = await runCrew(
      ["report", "--status", "blocked", "--file", file],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("question");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
  });

  test("D36: a blocked report waits on the question the crew session asked and nobody answered", async () => {
    const world = await crewWorld1();
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    await runCrew(
      ["report", "--question", "which port?", "--option", "3210", "--option", "3211"],
      ctx,
    );
    const code = await runCrew(["report", "--status", "blocked"], ctx);
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.status).toBe("blocked");
    expect(report?.question).toBe("which port?");
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("blocked");
  });

  test("D36: a done report is not blocked on a question that is still open", async () => {
    const world = await crewWorld1();
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    await runCrew(
      ["report", "--question", "which port?", "--option", "3210", "--option", "3211"],
      ctx,
    );
    expect(await runCrew(["report", "--status", "done"], ctx)).toBe(0);
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.question).toBeNull();
  });

  test("D22: a diff git cannot give is an error, never 'nothing changed'", async () => {
    const world = await crewWorld1();
    // The base the crew session started from is gone (a commit that was never in this repository).
    const { updateCrew } = await import("./store");
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      ID,
      { base: { ref: "main", sha: "0".repeat(40) } },
      T0,
    );
    const code = await runCrew(
      ["report", "--status", "done"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err[0]).toContain("git diff 0000000..HEAD failed");
    expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))).toBeNull();
  });

  test("D22: a path with a space is one path, counted once", async () => {
    const world = await crewWorld1({ files: ["docs/**"] });
    writeFileSync(join(world.worktree, "a file.md"), "x\n");
    git(world.worktree, "add", ".");
    git(world.worktree, "commit", "-q", "-m", "a file with a space");
    await runCrew(
      ["report", "--status", "done"],
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.changed.files).toBe(3);
    expect(report?.outsideBrief).toEqual(["README.md", "a file.md", "extra.ts"]);
  });

  test("D36: options belong to a question, and a question has no file", async () => {
    const world = await crewWorld1();
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    expect(await runCrew(["report", "--status", "done", "--option", "x"], ctx)).toBe(2);
    expect(world.err[0]).toContain("--option and --recommend belong to a question");
    world.err.length = 0;
    expect(
      await runCrew(
        ["report", "--question", "q?", "--option", "a", "--option", "b", "--file", "r.md"],
        ctx,
      ),
    ).toBe(2);
    expect(world.err[0]).toContain("A question has no file");
    world.err.length = 0;
    expect(await runCrew(["report", "--status", "done", "--question", "q?"], ctx)).toBe(2);
    expect(world.err[0]).toContain("give one, not both");
  });
});
