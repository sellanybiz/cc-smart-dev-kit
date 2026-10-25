/**
 * `crew report` (`report.ts`): the hand-back report a crew session gives its lead, and the question
 * it asks (D36). The command fills the mechanical facts itself — branch and sha, the base, the
 * diff counts, the files outside the brief, the review record, the pull request — and validates
 * the model's part against the store's report shape.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeIssueGh } from "../issues/fake-github";
import { MAX_PHASE_ISSUES } from "../issues/phase-issues";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { commitConfig } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { recordReview, reviewsFile } from "../workflow/reviews";
import { runCrew } from "./command";
import {
  createCrew,
  crewReportFile,
  listCrew,
  openQuestionIndex,
  readCrewEvents,
  readReport,
  writeLead,
} from "./store";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const ID = "B6b-portal-live-1a2b3c";
/** The session id `crewWorld1` records for its crew session: the folder its task list is in. */
const SESSION_ID = "aaaa1111-2222-3333-4444-555555555555";

/**
 * One task file, as Claude Code writes it, in the crew session's task folder (or in `list`,
 * the folder `CLAUDE_CODE_TASK_LIST_ID` names). Written by hand: the report reads Claude Code's
 * files, and a test that built them with the reader would prove nothing about the shape.
 */
function taskFile(
  world: { paths: { claudeConfigDir: string } },
  n: number,
  status: string,
  list: string = SESSION_ID,
): void {
  const folder = join(world.paths.claudeConfigDir, "tasks", list);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${String(n)}.json`),
    `${JSON.stringify(
      {
        id: String(n),
        subject: `Part ${String(n)}`,
        description: "x",
        activeForm: `Doing part ${String(n)}`,
        status,
        blocks: [],
        blockedBy: [],
      },
      null,
      2,
    )}\n`,
  );
}

/** The project's policy with the crew and the issues switches on, as committed on `main`. */
const ISSUES_POLICY = {
  workflow: { crew: { enabled: true }, issues: { enabled: true } },
  worktrees: { base: "main" },
};

/** A world with one crew session that has committed something on its branch. */
async function crewWorld1(
  options: { files?: string[]; issue?: boolean; state?: "working" | "blocked" } = {},
) {
  const world = crewWorld();
  if (options.issue === true) {
    // The phase started from issue #12: the project's own GitHub repository, the switch on.
    git(world.repo, "remote", "add", "origin", "git@github.com:example-org/my-app.git");
    commitConfig(world.repo, ISSUES_POLICY, ["main"]);
  }
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
      ...(options.issue === true
        ? {
            issue: {
              author: "outsider",
              number: 12,
              repo: "example-org/my-app",
              url: "https://github.com/example-org/my-app/issues/12",
            },
          }
        : {}),
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
      sessionId: SESSION_ID,
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

/** A model part file in a temp folder, and the `crew report` arguments for a green done report. */
function doneArgs(part: string = modelPart()): string[] {
  const file = join(tempDir("report"), "part.json");
  writeFileSync(file, part);
  return ["report", "--status", "done", "--file", file];
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
      ["report", "--status", "failed", "--file", file],
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
      ["report", "--status", "failed"],
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
    expect(await runCrew(doneArgs(), ctx)).toBe(0);
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
      doneArgs(),
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
    await runCrew(doneArgs(), world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }));
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.changed.files).toBe(3);
    expect(report?.outsideBrief).toEqual(["README.md", "a file.md", "extra.ts"]);
  });

  test("a `./` in a brief's --files names the path git does", async () => {
    const world = await crewWorld1({ files: ["./README.md"] });
    await runCrew(doneArgs(), world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }));
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.outsideBrief).toEqual(["extra.ts"]);
  });

  test("D23: a done report is refused while a task is open, and each open task is named", async () => {
    const world = await crewWorld1();
    taskFile(world, 1, "completed");
    taskFile(world, 3, "pending");
    taskFile(world, 5, "in_progress");
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(1);
    expect(world.err).toEqual([
      'crew report: the task list still has 2 open tasks: #3 "Part 3" (pending), #5 "Part 5" (in_progress)',
      "Fix: Finish or remove each open task first (TaskUpdate status completed, or status deleted for one that no longer applies, and say why under `open` in your report)",
    ]);
    // Nothing was written and nothing was said: the phase is still working.
    expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))).toBeNull();
    expect(readCrewEvents(world.paths.stateDir, world.repo).events).toHaveLength(1);
    expect(listCrew(world.paths.stateDir, world.repo).records[0]?.state).toBe("working");
    expect(world.out).toEqual([]);
  });

  test("D23: one open task is named alone, and the report goes through once it is completed", async () => {
    const world = await crewWorld1();
    taskFile(world, 2, "in_progress");
    const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    expect(await runCrew(doneArgs(), ctx)).toBe(1);
    expect(world.err).toEqual([
      'crew report: the task list still has 1 open task: #2 "Part 2" (in_progress)',
      "Fix: Finish or remove each open task first (TaskUpdate status completed, or status deleted for one that no longer applies, and say why under `open` in your report)",
    ]);
    world.err.length = 0;
    taskFile(world, 2, "completed");
    expect(await runCrew(doneArgs(), ctx)).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      `report done · ${crewReportFile(world.paths.stateDir, world.repo, ID)}`,
    ]);
    expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))?.status).toBe("done");
  });

  test.each(["handoff", "failed", "blocked"] as const)(
    "D23: a %s report is never held by an open task",
    async (status) => {
      const world = await crewWorld1();
      taskFile(world, 1, "pending");
      const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
      if (status === "blocked") {
        // A blocked report names the question it waits on: its own, asked first.
        await runCrew(
          ["report", "--question", "which port?", "--option", "3210", "--option", "3211"],
          ctx,
        );
      }
      expect(await runCrew(["report", "--status", status], ctx)).toBe(0);
      expect(world.err).toEqual([]);
      expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))?.status).toBe(status);
    },
  );

  test("D23: no task list at all: the report goes through, with one note saying so", async () => {
    const world = await crewWorld1();
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
    );
    expect(code).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "note: no task list was found for this session; nothing was checked before the report",
      `report done · ${crewReportFile(world.paths.stateDir, world.repo, ID)}`,
    ]);
  });

  test("D23: an empty list after every task was removed is a finished list: no note, no hold", async () => {
    const world = await crewWorld1();
    // What a live run left after its last task was removed: no `N.json` at all.
    const folder = join(world.paths.claudeConfigDir, "tasks", SESSION_ID);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".lock"), "");
    writeFileSync(join(folder, ".highwatermark"), "2");
    expect(
      await runCrew(doneArgs(), world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID })),
    ).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      `report done · ${crewReportFile(world.paths.stateDir, world.repo, ID)}`,
    ]);
  });

  test("D23: a list the command cannot read holds nothing back, and says so", async () => {
    const world = await crewWorld1();
    // A file where the session's task folder belongs: the list cannot be read.
    mkdirSync(join(world.paths.claudeConfigDir, "tasks"), { recursive: true });
    writeFileSync(join(world.paths.claudeConfigDir, "tasks", SESSION_ID), "{}");
    expect(
      await runCrew(doneArgs(), world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID })),
    ).toBe(0);
    expect(world.out).toEqual([
      `note: the task list in ${join(world.paths.claudeConfigDir, "tasks", SESSION_ID)} cannot be read; nothing was checked before the report`,
      `report done · ${crewReportFile(world.paths.stateDir, world.repo, ID)}`,
    ]);
  });

  test("D23: CLAUDE_CODE_TASK_LIST_ID names the list the report checks, and only that one", async () => {
    const world = await crewWorld1();
    // The session's own folder holds an open task; the shared list the environment names holds
    // another. With the variable set, only the shared list counts.
    taskFile(world, 1, "pending");
    taskFile(world, 7, "in_progress", "shared-list");
    const ctx = world.ctx(
      { cwd: world.worktree },
      { CC_SMART_DEV_KIT_CREW: ID, CLAUDE_CODE_TASK_LIST_ID: "shared-list" },
    );
    expect(await runCrew(doneArgs(), ctx)).toBe(1);
    expect(world.err[0]).toBe(
      'crew report: the task list still has 1 open task: #7 "Part 7" (in_progress)',
    );
    world.err.length = 0;
    taskFile(world, 7, "completed", "shared-list");
    expect(await runCrew(doneArgs(), ctx)).toBe(0);
    expect(world.err).toEqual([]);
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

  describe("GI2: the issues a phase fixes", () => {
    const ctxOf = (world: Awaited<ReturnType<typeof crewWorld1>>) =>
      world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
    const stored = (world: Awaited<ReturnType<typeof crewWorld1>>) =>
      readReport(crewReportFile(world.paths.stateDir, world.repo, ID));

    test("a report with none has an empty list", async () => {
      const world = await crewWorld1();
      expect(await runCrew(doneArgs(), ctxOf(world))).toBe(0);
      expect(stored(world)?.issues).toEqual([]);
    });

    test("the JSON part's issues are kept", async () => {
      const world = await crewWorld1();
      expect(await runCrew(doneArgs(modelPart({ issues: [14, 12] })), ctxOf(world))).toBe(0);
      expect(stored(world)?.issues).toEqual([12, 14]);
    });

    test("--issue is repeatable and joins the JSON part's, each number once, in order", async () => {
      const world = await crewWorld1();
      const args = [...doneArgs(modelPart({ issues: [14, 15] })), "--issue", "12", "--issue", "14"];
      expect(await runCrew(args, ctxOf(world))).toBe(0);
      expect(stored(world)?.issues).toEqual([12, 14, 15]);
    });

    test.each([["abc"], ["0"], ["-3"], ["1.5"], ["99999999999999999999"]])(
      "--issue %p is not an issue number: refused, nothing written",
      async (value) => {
        const world = await crewWorld1();
        expect(await runCrew([...doneArgs(), "--issue", value], ctxOf(world))).toBe(2);
        expect(world.err[0]).toContain("--issue is the number of a GitHub issue");
        expect(stored(world)).toBeNull();
      },
    );

    test.each([[["x"]], [[0]], [[1.5]], ["12"]])(
      "the JSON part's issues %p are refused when they are not numbers",
      async (issues) => {
        const world = await crewWorld1();
        expect(await runCrew(doneArgs(modelPart({ issues })), ctxOf(world))).toBe(1);
        expect(world.err[0]).toContain("issues");
        expect(stored(world)).toBeNull();
      },
    );

    test("GI4: a phase fixes at most MAX_PHASE_ISSUES issues: more --issue repeats are refused", async () => {
      const world = await crewWorld1();
      const repeats = (count: number) =>
        Array.from({ length: count }, (_, at) => ["--issue", String(at + 1)]).flat();
      expect(await runCrew([...doneArgs(), ...repeats(MAX_PHASE_ISSUES + 1)], ctxOf(world))).toBe(
        2,
      );
      expect(world.err[0]).toContain(`--issue names at most ${MAX_PHASE_ISSUES} issues`);
      expect(stored(world)).toBeNull();
    });

    test("GI4: the JSON part's list, and the two together, stay within the cap", async () => {
      const world = await crewWorld1();
      const many = (count: number) => Array.from({ length: count }, (_, at) => at + 1);
      expect(
        await runCrew(doneArgs(modelPart({ issues: many(MAX_PHASE_ISSUES + 1) })), ctxOf(world)),
      ).toBe(1);
      expect(world.err[0]).toContain(`at most ${MAX_PHASE_ISSUES}`);
      world.err.length = 0;
      const together = [
        ...doneArgs(modelPart({ issues: many(MAX_PHASE_ISSUES) })),
        "--issue",
        "99",
      ];
      expect(await runCrew(together, ctxOf(world))).toBe(1);
      expect(world.err[0]).toContain(`at most ${MAX_PHASE_ISSUES}`);
      expect(stored(world)).toBeNull();
      world.err.length = 0;
      expect(
        await runCrew(doneArgs(modelPart({ issues: many(MAX_PHASE_ISSUES) })), ctxOf(world)),
      ).toBe(0);
      expect(stored(world)?.issues).toEqual(many(MAX_PHASE_ISSUES));
    });

    test("--issue belongs to a report, not a question", async () => {
      const world = await crewWorld1();
      const args = ["report", "--question", "q?", "--option", "a", "--option", "b", "--issue", "3"];
      expect(await runCrew(args, ctxOf(world))).toBe(2);
      expect(world.err[0]).toContain("--issue belongs to a report");
    });
  });

  describe("RG1: a done report is held for red or missing work", () => {
    const fix =
      "Fix: fix it and run the whole suite and the checks again, then report `done` with the JSON part (`crew report --status done --file -`: tests, checks, review); report `failed` or `blocked` instead when the phase cannot be finished";

    async function refused(part: Record<string, unknown>, ...lines: string[]) {
      const world = await crewWorld1();
      const code = await runCrew(
        doneArgs(modelPart(part)),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(code).toBe(1);
      expect(world.err).toEqual([...lines, fix]);
      // Nothing was written: the phase is still working.
      expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))).toBeNull();
      expect(listCrew(world.paths.stateDir, world.repo).records[0]?.state).toBe("working");
    }

    test("a failed whole suite is refused, with the command named", async () => {
      await refused(
        {
          tests: { full: { command: "bun test", failed: 3, ok: false, passed: 40 }, targeted: [] },
        },
        "crew report: a done report cannot carry red work: the whole suite failed (`bun test`: 3 failed)",
      );
    });

    test("a suite with failures is red even when its ok says true", async () => {
      await refused(
        { tests: { full: { command: "bun test", failed: 1, ok: true, passed: 40 }, targeted: [] } },
        "crew report: a done report cannot carry red work: the whole suite failed (`bun test`: 1 failed)",
      );
    });

    test("a failed targeted run is refused", async () => {
      await refused(
        {
          tests: {
            full: { command: "bun test", failed: 0, ok: true, passed: 42 },
            targeted: [{ command: "bun test src/crew", failed: 2, ok: false, passed: 5 }],
          },
        },
        "crew report: a done report cannot carry red work: a test run failed (`bun test src/crew`: 2 failed)",
      );
    });

    test("a failed check is refused, and every red item is named", async () => {
      await refused(
        {
          checks: [
            { name: "typecheck", note: null, ok: true },
            { name: "lint", note: "2 errors", ok: false },
          ],
          tests: { full: { command: "bun test", failed: 1, ok: false, passed: 4 }, targeted: [] },
        },
        "crew report: a done report cannot carry red work: the whole suite failed (`bun test`: 1 failed); the check `lint` failed (2 errors)",
      );
    });

    test("a missing review is refused", async () => {
      await refused(
        { review: null },
        "crew report: a done report needs a review: none is recorded (a reviewer's `review`, or an `ownReview` where the brief asked for no second opinion)",
      );
    });

    test("a suite that never ran is refused", async () => {
      await refused(
        { tests: { full: null, targeted: [] } },
        "crew report: a done report needs the whole suite: none is recorded (`tests.full`)",
      );
    });

    test("a report with no JSON part at all is refused (the RF2 case)", async () => {
      const world = await crewWorld1();
      const file = join(tempDir("report"), "report.md");
      writeFileSync(file, "6,509 pass, 0 fail, both validates green.\n");
      const code = await runCrew(
        ["report", "--status", "done", "--file", file],
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(code).toBe(1);
      expect(world.err[0]).toContain("a done report needs the whole suite");
      expect(world.err.join("\n")).toContain("a done report needs a review");
    });

    test("an empty list of findings with a reviewer is a clean review", async () => {
      const world = await crewWorld1();
      const part = modelPart({
        review: {
          agent: "cc-smart-dev-kit:reviewer",
          effort: "high",
          findings: [],
          model: "sonnet",
        },
      });
      const code = await runCrew(
        doneArgs(part),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(world.err).toEqual([]);
      expect(code).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.review?.findings).toEqual([]);
    });

    test("an own review, with its reason, stands where the brief asked for no second opinion", async () => {
      const world = await crewWorld1();
      const part = modelPart({
        ownReview: {
          findings: [{ finding: "a stale doc line", fix: "updated" }],
          reason: "the brief asked for no second opinion",
        },
        review: null,
      });
      const code = await runCrew(
        doneArgs(part),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(world.err).toEqual([]);
      expect(code).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.review).toBeNull();
      expect(report?.ownReview).toEqual({
        findings: [{ finding: "a stale doc line", fix: "updated" }],
        reason: "the brief asked for no second opinion",
      });
    });

    test("an own review without a reason does not read as the report shape", async () => {
      const world = await crewWorld1();
      const code = await runCrew(
        doneArgs(modelPart({ ownReview: { findings: [] }, review: null })),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(code).toBe(1);
      expect(world.err[0]).toContain("ownReview.reason");
    });

    test.each(["failed", "handoff"] as const)(
      "a %s report with a red suite and no review is never held",
      async (status) => {
        const world = await crewWorld1();
        const file = join(tempDir("report"), "part.json");
        writeFileSync(
          file,
          modelPart({
            checks: [{ name: "lint", note: null, ok: false }],
            review: null,
            tests: { full: { command: "bun test", failed: 9, ok: false, passed: 1 }, targeted: [] },
          }),
        );
        const code = await runCrew(
          ["report", "--status", status, "--file", file],
          world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
        );
        expect(world.err).toEqual([]);
        expect(code).toBe(0);
        expect(readReport(crewReportFile(world.paths.stateDir, world.repo, ID))?.status).toBe(
          status,
        );
      },
    );
  });

  describe("RG1: a new question closes the crew session's own older one", () => {
    test("two questions through the command: the first is superseded, and the blocked report names the newest", async () => {
      const world = await crewWorld1();
      const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
      const ask = (question: string) =>
        runCrew(["report", "--question", question, "--option", "a", "--option", "b"], ctx);
      expect(await ask("which port?")).toBe(0);
      expect(await ask("which port, 3210 or 3211?")).toBe(0);
      const [record] = listCrew(world.paths.stateDir, world.repo).records;
      expect(record?.questions).toHaveLength(2);
      expect(record?.questions[0]).toMatchObject({ question: "which port?", supersededBy: 1 });
      expect(record === undefined ? null : openQuestionIndex(record)).toBe(1);
      expect(await runCrew(["report", "--status", "blocked"], ctx)).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.question).toBe("which port, 3210 or 3211?");
    });

    test("a blocked report never waits on a superseded question", async () => {
      const world = await crewWorld1();
      const ctx = world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID });
      const ask = (question: string) =>
        runCrew(["report", "--question", question, "--option", "a", "--option", "b"], ctx);
      await ask("old?");
      await ask("new?");
      // The newest is answered: nothing is open, and the blocked report has no question of its
      // own to name (the old one is superseded, not open).
      const { answerCrewQuestion } = await import("./store");
      await answerCrewQuestion(world.paths.stateDir, world.repo, ID, 1, "yes", T0);
      expect(await runCrew(["report", "--status", "blocked"], ctx)).toBe(1);
      expect(world.err[0]).toContain("question");
    });
  });

  describe("RG1: nothing the crew session wrote in its JSON part is silently dropped", () => {
    test("a `summary` in the JSON part is the report's summary", async () => {
      const world = await crewWorld1();
      const code = await runCrew(
        doneArgs(modelPart({ summary: "The live stream works; both validates are green." })),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(world.err).toEqual([]);
      expect(code).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.summary).toBe("The live stream works; both validates are green.");
    });

    test("a field the report shape does not know is kept under `extra`, never over a fact", async () => {
      const world = await crewWorld1();
      const code = await runCrew(
        doneArgs(
          modelPart({
            branch: { name: "someone-else", sha: "c".repeat(40) },
            measurements: [{ width: 390, overflow: false }],
            screenshots: ["a.png"],
          }),
        ),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(world.err).toEqual([]);
      expect(code).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.extra).toEqual({
        branch: { name: "someone-else", sha: "c".repeat(40) },
        measurements: [{ width: 390, overflow: false }],
        screenshots: ["a.png"],
      });
      // The command's own facts are untouched.
      expect(report?.branch.name).toBe("crew/B6b-portal-live");
    });

    test("a report with only known fields has no `extra`", async () => {
      const world = await crewWorld1();
      expect(
        await runCrew(
          doneArgs(),
          world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
        ),
      ).toBe(0);
      const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
      expect(report?.extra).toBeUndefined();
    });

    test("tests written under a name the shape does not know are kept, and the gate still refuses the missing suite", async () => {
      const world = await crewWorld1();
      const part = JSON.parse(modelPart()) as Record<string, unknown>;
      part.tests = undefined;
      part.suite = { command: "bun test", failed: 0, ok: true, passed: 42 };
      const code = await runCrew(
        doneArgs(JSON.stringify(part)),
        world.ctx({ cwd: world.worktree }, { CC_SMART_DEV_KIT_CREW: ID }),
      );
      expect(code).toBe(1);
      expect(world.err[0]).toContain("a done report needs the whole suite");
      // The refusal names the field it does not know, so a misspelt `tests` is found at once.
      expect(world.err.join("\n")).toContain(
        "crew report: the part holds fields the report shape does not know (kept under `extra`): suite",
      );
    });
  });
});

/** `crew report` on a phase that started from an issue (GI3): one comment on the issue. */
describe("the hand-back on the issue", () => {
  const ISSUE = { author: "outsider", body: "x", events: [], labels: [], number: 12, title: "t" };
  const MARKER = (status: string) => `<!-- cc-smart-dev-kit:handback ${ID} ${status} -->`;
  const CREW_ENV = { CC_SMART_DEV_KIT_CREW: ID };

  async function issueReport(
    status: "done" | "failed" | "handoff",
    github: Partial<Parameters<typeof fakeIssueGh>[0]> = {},
    part: string = modelPart(),
  ) {
    const world = await crewWorld1({ issue: true });
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {}, ...github });
    const file = join(tempDir("report"), "part.json");
    writeFileSync(file, part);
    const code = await runCrew(
      ["report", "--status", status, "--file", file],
      world.ctx({ cwd: world.worktree, gh: fake.exec }, CREW_ENV),
    );
    const head = git(world.worktree, "rev-parse", "HEAD").trim();
    return { code, fake, head, world };
  }

  test("a done report posts one comment: status, tests, checks, review, the head commit", async () => {
    const { code, fake, head, world } = await issueReport("done");
    expect(world.err).toEqual([]);
    expect(code).toBe(0);
    const short = head.slice(0, 7);
    expect(fake.posted).toEqual([
      {
        body: `**cc-smart-dev-kit:** phase \`B6b\` reported \`done\`.

- Branch \`crew/B6b-portal-live\` at \`${short}\`: 2 files changed (+2, -0).
- Tests: \`bun test src/crew\` 12 passed, 0 failed; the whole suite \`bun test\` 42 passed, 0 failed.
- Checks: typecheck passed.
- Review: \`cc-smart-dev-kit:reviewer\` on \`opus\` at effort \`xhigh\`, read \`${short}\`; 1 finding, fixed: a leak (closed).

${MARKER("done")}
`,
        number: 12,
      },
    ]);
    // The comment goes to the project's own repository on github.com, by the number.
    expect(fake.calls.find((one) => one[1] === "comment")).toEqual([
      "issue",
      "comment",
      "12",
      "--repo",
      "github.com/example-org/my-app",
      "--body-file",
      "-",
    ]);
  });

  test("a failed test and a failed check are said, not hidden", async () => {
    const part = modelPart({
      checks: [{ name: "lint", note: "3 errors", ok: false }],
      tests: {
        full: null,
        targeted: [{ command: "bun test src/crew", failed: 2, ok: false, passed: 12 }],
      },
    });
    const { fake } = await issueReport("failed", {}, part);
    const body = fake.posted[0]?.body ?? "";
    expect(body).toContain("reported `failed`");
    expect(body).toContain("`bun test src/crew` 12 passed, 2 failed");
    expect(body).toContain("Checks: lint failed (3 errors).");
  });

  test("a hand-off says it in one line, at the commit", async () => {
    const { fake, head } = await issueReport("handoff");
    expect(fake.posted).toEqual([
      {
        body: `**cc-smart-dev-kit:** phase \`B6b\` handed off at \`${head.slice(0, 7)}\` on \`crew/B6b-portal-live\`; the next session carries on.

${MARKER("handoff")}
`,
        number: 12,
      },
    ]);
  });

  test("a report already commented on is not commented on again", async () => {
    const { code, fake } = await issueReport("done", {
      comments: { 12: [`earlier\n\n${MARKER("done")}\n`] },
    });
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
  });

  test("GI4: a stranger's copy of the marker does not silence the hand-back", async () => {
    const { code, fake } = await issueReport("done", {
      comments: { 12: [{ author: "stranger", body: `copied\n\n${MARKER("done")}\n` }] },
    });
    expect(code).toBe(0);
    expect(fake.posted).toHaveLength(1);
  });

  test("GI4: the account the kit posts as cannot be read: no comment, one line to the lead", async () => {
    const world = await crewWorld1({ issue: true });
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {} });
    const noUser: typeof fake.exec = async (args, call) =>
      args.includes("user")
        ? { code: 1, err: "gh: HTTP 500", kind: "failed", out: "" }
        : await fake.exec(args, call);
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree, gh: noUser }, CREW_ENV),
    );
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
    const line = world.out.find((one) => one.startsWith("note: the hand-back comment")) ?? "";
    expect(line).toContain("which account");
  });

  test("another session's comment on the same issue does not stop this one", async () => {
    const other = "<!-- cc-smart-dev-kit:handback B6b-other-aaaaaa done -->";
    const { fake } = await issueReport("done", { comments: { 12: [`x\n${other}\n`] } });
    expect(fake.posted).toHaveLength(1);
  });

  test("GitHub cannot be reached: one line to the lead, the report is recorded all the same", async () => {
    const world = await crewWorld1({ issue: true });
    const down = async () => ({ code: null, err: "", kind: "timeout" as const, out: "" });
    const code = await runCrew(doneArgs(), world.ctx({ cwd: world.worktree, gh: down }, CREW_ENV));
    expect(code).toBe(0);
    expect(world.err).toEqual([]);
    const line = world.out.find((one) => one.startsWith("note: the hand-back comment")) ?? "";
    expect(line).toContain("#12");
    expect(line).toContain("timed out");
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.status).toBe("done");
    expect(report?.open.some((one) => one.includes("not posted on issue #12"))).toBe(true);
    expect(world.out.some((one) => one.startsWith("report done"))).toBe(true);
  });

  test("the switch is off now: no comment, one line, the report is recorded", async () => {
    const world = await crewWorld1({ issue: true });
    commitConfig(
      world.repo,
      { workflow: { crew: { enabled: true } }, worktrees: { base: "main" } },
      ["main"],
    );
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {} });
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree, gh: fake.exec }, CREW_ENV),
    );
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
    expect(
      world.out.some(
        (one) =>
          one.startsWith("note: the hand-back comment") && one.includes("issues.enabled is off"),
      ),
    ).toBe(true);
  });

  test("a public repository without allowPublic: no comment", async () => {
    const world = await crewWorld1({ issue: true });
    const fake = fakeIssueGh({ gh: { visibility: "PUBLIC" }, issues: [ISSUE], permissions: {} });
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree, gh: fake.exec }, CREW_ENV),
    );
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
    expect(world.out.some((one) => one.includes("allowPublic"))).toBe(true);
  });

  const reviewWith = (finding: string) =>
    modelPart({
      review: {
        agent: "cc-smart-dev-kit:reviewer",
        effort: "xhigh",
        findings: [{ finding, fix: "removed" }],
        model: "opus",
        sha: "b".repeat(40),
      },
    });

  test("a secret in the words is not posted, cleaned or not: one note, and the report goes on", async () => {
    const { code, fake, world } = await issueReport(
      "done",
      {},
      reviewWith(`key ghp_${"a".repeat(36)}`),
    );
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
    const line = world.out.find((one) => one.startsWith("note: the hand-back comment")) ?? "";
    expect(line).toContain("a key or token");
    expect(line).not.toContain("ghp_");
    const report = readReport(crewReportFile(world.paths.stateDir, world.repo, ID));
    expect(report?.open.some((one) => one.includes("not posted on issue #12"))).toBe(true);
  });

  test("a secret longer than the cut to length is still found before it is cut", async () => {
    const { fake } = await issueReport(
      "done",
      {},
      reviewWith(`${"x ".repeat(160)}ghp_${"a".repeat(36)}`),
    );
    expect(fake.posted).toEqual([]);
  });

  test("a home path in the words is not posted either", async () => {
    const world = await crewWorld1({ issue: true });
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {} });
    const part = modelPart({
      tests: {
        full: { command: `cd ${world.home}/work && bun test`, failed: 0, ok: true, passed: 42 },
        targeted: [],
      },
    });
    const code = await runCrew(
      doneArgs(part),
      world.ctx({ cwd: world.worktree, gh: fake.exec }, CREW_ENV),
    );
    expect(code).toBe(0);
    expect(fake.posted).toEqual([]);
    expect(world.out.some((one) => one.includes("a home path"))).toBe(true);
  });

  test("an @mention is broken, so the comment pings nobody", async () => {
    const { fake } = await issueReport("done", {}, reviewWith("ask @octocat about it"));
    const body = fake.posted[0]?.body ?? "";
    expect(body).not.toContain("@octocat");
    expect(body).toContain("@\u200boctocat");
  });

  test("a timed-out post says the comment may have landed, not that nothing was filed", async () => {
    const world = await crewWorld1({ issue: true });
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {} });
    const flaky = async (args: string[], call: Parameters<typeof fake.exec>[1]) =>
      args[0] === "issue" && args[1] === "comment"
        ? { code: null, err: "", kind: "timeout" as const, out: "" }
        : fake.exec(args, call);
    const code = await runCrew(doneArgs(), world.ctx({ cwd: world.worktree, gh: flaky }, CREW_ENV));
    expect(code).toBe(0);
    const line = world.out.find((one) => one.startsWith("note: the hand-back comment")) ?? "";
    expect(line).toContain("the comment may have been posted");
    expect(line).not.toContain("filed");
  });

  test("a phase that did not start from an issue never calls gh", async () => {
    const world = await crewWorld1();
    const fake = fakeIssueGh({ issues: [ISSUE], permissions: {} });
    const code = await runCrew(
      doneArgs(),
      world.ctx({ cwd: world.worktree, gh: fake.exec }, CREW_ENV),
    );
    expect(code).toBe(0);
    expect(fake.calls).toEqual([]);
  });
});
