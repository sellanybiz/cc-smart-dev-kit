/**
 * The pure part of "Needs you", a flow wait matched to the crew session that runs it — and the
 * Work answer from a folder that is no git project: the crew store is the machine's, so the
 * crew sessions and leads of every repository are shown, each with its own repository.
 *
 * Every value is written by hand; the record comes from the store's own schema, so a field the
 * schema would refuse cannot slip in. No portal is started.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../../cli/paths";
import {
  addCrewQuestion,
  type CrewRecord,
  createCrew,
  crewRecordSchema,
  type NewCrew,
  updateCrew,
  writeLead,
} from "../../crew/store";
import { localDay } from "../../gateway/safety-checks";
import type { OpenWait } from "../../sessions/flow";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { makeRepo } from "../../testing/hooks";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext } from "../actions";
import type { PageDataDeps } from "../page-data";
import { testPortalContext } from "./test-context";
import { crewAnswerFor, historyAnswer, needsAnswer, permissionWaitOf, workAnswer } from "./work";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

/** One crew record, through the store's own schema. */
function crewRecord(id: string, sessionId: null | string, shortId: null | string): CrewRecord {
  return crewRecordSchema.parse({
    base: null,
    baseRef: "main",
    branch: "crew/F-guards",
    createdAt: "2026-10-23T10:00:00.000Z",
    effort: "high",
    files: [],
    id,
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: "11111111-1111-4111-8111-111111111111",
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: `C my-app F guards`,
    permissionMode: "auto",
    phase: "F",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo: "/home/user/my-app",
    sessionId,
    shortId,
    slug: "guards",
    state: "working",
    updatedAt: "2026-10-23T10:00:00.000Z",
    version: 1,
    waitsFor: [],
    worktree: "/home/user/my-app/.claude/worktrees/crew-F-guards",
  });
}

/** One permission prompt the flow report found, in a session `session`. */
function waitIn(session: string): OpenWait {
  return {
    asker: "git-guard",
    at: Date.UTC(2026, 9, 23, 12, 0, 0),
    cwd: "/home/user/my-app",
    kind: "merge-guard",
    project: "my-app",
    session,
    tool: "Bash",
  };
}

describe("permissionWaitOf", () => {
  test("a wait in a crew session's own session names it, and the command that opens it", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", "abcd1234");
    expect(permissionWaitOf(waitIn("abcd1234-0000-4000-8000-000000000000"), [record])).toEqual({
      asker: "git-guard",
      attach: "claude attach abcd1234",
      at: Date.UTC(2026, 9, 23, 12, 0, 0),
      crew: { id: "crew-F-guards", name: "C my-app F guards", shortId: "abcd1234" },
      kind: "merge-guard",
      project: "my-app",
      session: "abcd1234-0000-4000-8000-000000000000",
      tool: "Bash",
    });
  });

  test("any other session has no crew and no attach command", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", "abcd1234");
    expect(permissionWaitOf(waitIn("eeee5555-0000-4000-8000-000000000000"), [record])).toEqual({
      asker: "git-guard",
      attach: null,
      at: Date.UTC(2026, 9, 23, 12, 0, 0),
      crew: null,
      kind: "merge-guard",
      project: "my-app",
      session: "eeee5555-0000-4000-8000-000000000000",
      tool: "Bash",
    });
  });

  test("a crew session with no short id is named, but has no command to offer", () => {
    const record = crewRecord("crew-F-guards", "abcd1234-0000-4000-8000-000000000000", null);
    const wait = permissionWaitOf(waitIn("abcd1234-0000-4000-8000-000000000000"), [record]);
    expect(wait.crew).toEqual({ id: "crew-F-guards", name: "C my-app F guards", shortId: null });
    expect(wait.attach).toBe(null);
  });
});

/** One queued crew record of `repo`, as the store writes one. */
function newCrew(repo: string, id: string, leadSessionId: string): NewCrew {
  return {
    base: null,
    baseRef: "main",
    branch: `crew/${id}`,
    effort: "high",
    files: [],
    id,
    kind: "schema",
    lastLine: null,
    leadName: `LEAD ${id}`,
    leadSessionId,
    memoryMb: null,
    model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
    name: `C my-app ${id}`,
    permissionMode: "auto",
    phase: "P",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: "x",
    state: "queued",
    waitsFor: [],
    worktree: join(repo, ".claude", "worktrees", id),
  };
}

/** A folder that is no git project (the portal's normal one), two repositories, and the API's deps. */
function world() {
  const home = tempDir("work-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const ctx = testPortalContext(
    paths,
    {
      ...cleanGitEnv(),
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: home,
      PATH: process.env.PATH ?? "",
    },
    () => NOW,
  );
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  const deps: PageDataDeps = {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: { error: "this test reads no gateway config" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
  return { deps, home, paths, repoA: makeRepo("work-a"), repoB: makeRepo("work-b") };
}

describe("auto mode's safety checks beside the history (F6)", () => {
  /**
   * A file the router wrote, holding `checks` checks today and `oldChecks` three local days
   * back. The days are keyed by `localDay` with no zone — as the router keys them and the
   * portal reads them — so the same zone is used on both sides, whatever the test machine is.
   */
  function seedChecks(paths: CliPaths, checks: number, oldChecks = 0): void {
    const side = (count: number) => ({
      cacheRead: 0,
      cacheWrite: 0,
      checks: count,
      input: 0,
      output: 0,
    });
    const day = (count: number) => ({ anthropic: side(count), checks: count, fallback: side(0) });
    mkdirSync(dirname(paths.safetyChecksFile), { recursive: true });
    writeFileSync(
      paths.safetyChecksFile,
      JSON.stringify({
        days: {
          [localDay(NOW)]: day(checks),
          [localDay(NOW - 3 * 24 * 3_600_000)]: day(oldChecks),
        },
        version: 1,
      }),
    );
  }

  test("the count of the local days the range covers travels with the history", () => {
    const w = world();
    seedChecks(w.paths, 9, 100);
    // One hour, one day: today's nine checks, and not the hundred of three days back.
    expect(historyAnswer(w.deps, "1h", "target").safetyChecks).toEqual({ checks: 9, days: 1 });
    // A day reaches back past one midnight but not three days: still today's day alone. The
    // days are the ones the count covers, not the width of the range.
    expect(historyAnswer(w.deps, "1d", "target").safetyChecks).toEqual({ checks: 9, days: 1 });
    // A week holds both counted days, and adds them.
    expect(historyAnswer(w.deps, "7d", "target").safetyChecks).toEqual({ checks: 109, days: 2 });
    // No request was ever logged in this temp HOME: the checks still travel, and it says so.
    const hour = historyAnswer(w.deps, "1h", "target");
    expect(hour.available).toBe(true);
    expect(hour.note).toContain("no request has been logged yet");
  });

  test("no file counted anything yet: the count is unknown, never 0", () => {
    const w = world();
    expect(historyAnswer(w.deps, "1d", "target").safetyChecks).toEqual({ checks: null, days: 0 });
  });
});

describe("Work from a folder that is no git project", () => {
  test("the crew sessions and leads of every repository are shown, each with its own repository", async () => {
    const w = world();
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-A-1", "lead-a"), NOW - 2_000);
    await writeLead(
      w.paths.stateDir,
      {
        cwd: w.repoA,
        name: "LEAD a plan",
        plan: "plan-a",
        repo: w.repoA,
        sessionId: "lead-a",
        tag: "a",
      },
      NOW - 3_000,
    );
    await createCrew(w.paths.stateDir, newCrew(w.repoB, "crew-B-1", "lead-b"), NOW - 1_000);
    await writeLead(
      w.paths.stateDir,
      {
        cwd: w.repoB,
        name: "LEAD b plan",
        plan: "plan-b",
        repo: w.repoB,
        sessionId: "lead-b",
        tag: "b",
      },
      NOW - 1_500,
    );
    const answer = await workAnswer(w.deps);
    // This folder is no project, so no other session is listed — the crew data still is. The
    // line is the quiet one (`folderNote`): the portal's normal start is the home folder, and
    // `note` is kept for a store or a folder that could not be read.
    expect(answer.repo).toBe(null);
    expect(answer.note).toBe(null);
    expect(answer.folderNote).toContain("not in a git project");
    expect(answer.sessions).toEqual([]);
    expect(answer.crew.map((one) => [one.id, one.repo])).toEqual([
      ["crew-B-1", w.repoB],
      ["crew-A-1", w.repoA],
    ]);
    expect(
      answer.leads.map((lead) => [lead.sessionId, lead.repo, lead.crew.map((crew) => crew.id)]),
    ).toEqual([
      ["lead-b", w.repoB, ["crew-B-1"]],
      ["lead-a", w.repoA, ["crew-A-1"]],
    ]);
  });

  test("one crew session's page is read from its own repository, wherever the portal runs", async () => {
    const w = world();
    await createCrew(w.paths.stateDir, newCrew(w.repoB, "crew-B-1", "lead-b"), NOW);
    const answer = await crewAnswerFor(w.deps, "crew-B-1");
    if ("error" in answer) throw new Error(answer.error);
    expect(answer.crew.id).toBe("crew-B-1");
    expect(answer.crew.repo).toBe(w.repoB);
    // No brief was given, and its events are its own store's (the created line).
    expect(answer.brief).toBe(null);
    expect(answer.events.map((event) => event.type)).toEqual(["created"]);
  });

  test("a crew page for an id no record has says the search was the machine's", async () => {
    const w = world();
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-A-1", "lead-a"), NOW);
    const answer = await crewAnswerFor(w.deps, "crew-ghost");
    expect(answer).toEqual({
      error: 'No crew session on this machine is "crew-ghost": the Work page lists them.',
    });
  });

  test("Needs you lists the open questions of every repository's crew sessions", async () => {
    const w = world();
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-A-1", "lead-a"), NOW);
    await addCrewQuestion(
      w.paths.stateDir,
      w.repoA,
      "crew-A-1",
      { options: ["a", "b"], question: "which base?", recommended: 1 },
      NOW,
    );
    await createCrew(w.paths.stateDir, newCrew(w.repoB, "crew-B-1", "lead-b"), NOW);
    await addCrewQuestion(
      w.paths.stateDir,
      w.repoB,
      "crew-B-1",
      { options: ["c", "d"], question: "which port?", recommended: null },
      NOW,
    );
    const answer = await needsAnswer(w.deps);
    expect(answer.crew.map((need) => [need.crew.id, need.question])).toEqual([
      ["crew-A-1", "which base?"],
      ["crew-B-1", "which port?"],
    ]);
  });

  test("a finished crew session's question is no Need, and its page says none", async () => {
    const w = world();
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-A-1", "lead-a"), NOW);
    await addCrewQuestion(
      w.paths.stateDir,
      w.repoA,
      "crew-A-1",
      { options: ["a", "b"], question: "which base?", recommended: 1 },
      NOW,
    );
    // The crew session handed off, and the lead merged its branch: the question was never
    // answered, and it needs no answer now.
    await updateCrew(w.paths.stateDir, w.repoA, "crew-A-1", { state: "merged" }, NOW + 1000);
    expect((await needsAnswer(w.deps)).crew).toEqual([]);
    const page = await crewAnswerFor(w.deps, "crew-A-1");
    if (!("crew" in page)) throw new Error("the crew page did not find the record");
    expect(page.crew.question).toBeNull();
  });
});
