/**
 * The pure part of "Needs you", a flow wait matched to the crew session that runs it — and the
 * Work answer from a folder that is no git project: the crew store is the machine's, so the
 * crew sessions and leads of every repository are shown, each with its own repository.
 *
 * Every value is written by hand; the record comes from the store's own schema, so a field the
 * schema would refuse cannot slip in. No portal is started.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../../cli/paths";
import {
  addCrewQuestion,
  type CrewRecord,
  createCrew,
  crewRecordSchema,
  crewStoreDir,
  leadFile,
  type NewCrew,
  updateCrew,
  writeLead,
} from "../../crew/store";
import { localDay } from "../../gateway/safety-checks";
import type { OpenWait } from "../../sessions/flow";
import { projectFolderName } from "../../sessions/saved-sessions";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { makeRepo } from "../../testing/hooks";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "../actions";
import { PAGE_READ_FRESH_MS } from "../cli-child";
import type { PageDataDeps } from "../page-data";
import { forgetAgentLists, readPortalAgents } from "./agents-read";
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
    { which: () => null },
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

function finishedAgent(w: ReturnType<typeof world>, state = "done") {
  const bin = tempDir("portal-agent");
  const binary = join(bin, "claude");
  const rows = [
    {
      id: "abcd1234",
      sessionId: "finished-session",
      name: "background task",
      cwd: w.repoB,
      kind: "background",
      state,
    },
  ];
  writeFileSync(
    binary,
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(rows))});\n`,
  );
  chmodSync(binary, 0o755);
  w.deps.action.portal.which = (name) => (name === "claude" ? binary : null);
  const job = join(w.paths.claudeConfigDir, "jobs", "abcd1234");
  mkdirSync(job, { recursive: true });
  writeFileSync(
    join(job, "state.json"),
    JSON.stringify({
      sessionId: "finished-session",
      state,
      updatedAt: "2026-10-21T12:00:00.000Z",
      lastTerminalAt: "2026-10-21T12:00:00.000Z",
    }),
  );
  return binary;
}

function cleanupPlugin(w: ReturnType<typeof world>, answer: unknown) {
  const folder = tempDir("cleanup-plugin");
  mkdirSync(join(folder, "dist"));
  writeFileSync(join(folder, "bunfig.toml"), "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `console.log(${JSON.stringify(JSON.stringify(answer))});`,
  );
  w.deps.action.portal.pluginFolder = () => ({ folder });
}

describe("cleanup data for the portal", () => {
  test("Needs reads the shared stopped item from the CLI child, with no removal", async () => {
    const w = world();
    const stopped = {
      crew: { id: "crew-stopped", name: "C my-app stopped", shortId: "aaaa1234", state: "stopped" },
      repo: w.repoB,
      since: "2026-10-21T12:00:00.000Z",
      days: 2,
      unmergedCommits: 3,
      line: "shared stopped reminder",
      discard: { facts: null, error: "no archive preview in this fixture" },
    };
    cleanupPlugin(w, { stopped: [stopped], error: null });
    const answer = await needsAnswer(w.deps);
    expect(answer.stopped).toEqual([stopped]);
    expect(answer.stoppedError).toBeNull();
  });

  test("Needs preserves the shared discard words, file facts and confirmation token exactly", async () => {
    const w = world();
    const facts = {
      head: "b".repeat(40),
      archiveRef: "refs/crew-discarded/crew/stopped",
      token: "a".repeat(64),
      unmergedCommits: { count: 1, subjects: ["work"] },
      changedFiles: ["untracked.txt"],
      ignoredFiles: ["small.txt"],
      lines: ["shared confirmation words", "shared recovery instructions"],
      question: "shared archive question",
    };
    cleanupPlugin(w, {
      stopped: [
        {
          crew: { id: "crew-stopped", name: "C my-app stopped", shortId: null, state: "stopped" },
          repo: w.repoB,
          since: "2026-10-21T12:00:00.000Z",
          days: 2,
          unmergedCommits: 1,
          line: "shared reminder",
          discard: { facts, error: null },
        },
      ],
      error: null,
    });
    expect((await needsAnswer(w.deps)).stopped[0]?.discard).toEqual({ facts, error: null });
  });

  test("Needs reports an unreadable cleanup answer, never an apparently empty healthy list", async () => {
    const w = world();
    cleanupPlugin(w, { stopped: [{ crew: { id: "broken" } }], error: null });
    const answer = await needsAnswer(w.deps);
    expect(answer.stopped).toEqual([]);
    expect(answer.stoppedError).toContain("answer");
  });

  test("Work uses the finished sessions builder across repositories, without a gateway", async () => {
    const w = world();
    finishedAgent(w);
    const answer = await workAnswer(w.deps);
    expect(answer.finishedSessions).toEqual([
      {
        id: "abcd1234",
        sessionId: "finished-session",
        name: "background task",
        folder: w.repoB,
        state: "done",
        finishedAt: Date.UTC(2026, 9, 21, 12),
        ageMs: 172800000,
      },
    ]);
    expect(answer.finishedSessionsError).toBeNull();
    // Stored ownership by full session id excludes a renamed crew session too.
    await createCrew(
      w.paths.stateDir,
      { ...newCrew(w.repoA, "renamed-crew", "lead-a"), sessionId: "finished-session" },
      NOW,
    );
    expect((await workAnswer(w.deps)).finishedSessions).toEqual([]);
  });

  test("a broken crew record or unknown agent view never offers a finished session", async () => {
    const w = world();
    const binary = finishedAgent(w);
    const dir = join(crewStoreDir(w.paths.stateDir, w.repoA), "crew");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "{");
    const broken = await workAnswer(w.deps);
    expect(broken.finishedSessions).toEqual([]);
    expect(broken.finishedSessionsError).toContain("crew");
    writeFileSync(binary, `#!${process.execPath}\nconsole.log("not JSON");`);
    const fresh = world();
    fresh.deps.action.portal.which = () => binary;
    const unknown = await workAnswer(fresh.deps);
    expect(unknown.finishedSessions).toEqual([]);
    expect(unknown.finishedSessionsError).toContain("agent");
  });

  test("leadGone uses both ended and persisted absence causes, and GET never observes or writes", async () => {
    const w = world();
    const binary = finishedAgent(w);
    const lead = await writeLead(
      w.paths.stateDir,
      {
        cwd: w.repoA,
        name: "LEAD my-app plan",
        plan: "plan",
        repo: w.repoA,
        sessionId: "lead-a",
        tag: "a",
      },
      NOW,
    );
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-old", "lead-a"), NOW);
    const file = leadFile(w.paths.stateDir, w.repoA, lead.sessionId);
    writeFileSync(file, JSON.stringify({ ...lead, endedAt: "2026-10-21T12:00:00.000Z" }));
    expect((await workAnswer(w.deps)).crew[0]?.leadGone).toBe(true);
    writeFileSync(
      file,
      JSON.stringify({ ...lead, sessionUnknownSince: "2026-10-21T12:00:00.000Z" }),
    );
    const before = readFileSync(file, "utf8");
    expect((await workAnswer(w.deps)).crew[0]?.leadGone).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(before);
    // Each answer of the fake agent list is a new look: the page's short memory is dropped
    // (`shortCache`; the next test pins that it exists).
    const nextLook = () => forgetAgentLists(w.deps.action.portal);
    writeFileSync(binary, `#!${process.execPath}\nconsole.log("not JSON");`);
    nextLook();
    expect((await workAnswer(w.deps)).crew[0]?.leadGone).toBe(false);
    writeFileSync(binary, `#!${process.execPath}\nconsole.log('[{"state":"done"}]');`);
    nextLook();
    expect((await workAnswer(w.deps)).crew[0]?.leadGone).toBe(false);
    writeFileSync(
      binary,
      `#!${process.execPath}\nconsole.log('[{"id":"lead-a","sessionId":"lead-a"}]');`,
    );
    nextLook();
    expect((await workAnswer(w.deps)).crew[0]?.leadGone).toBe(false);
    writeFileSync(binary, `#!${process.execPath}\nconsole.log("[]");`);
    nextLook();
    const page = await crewAnswerFor(w.deps, "crew-old");
    if ("error" in page) throw new Error(page.error);
    expect(page.crew.leadGone).toBe(true);
  });
});

/** One saved, titled Claude Code session that last worked in `folder`, written at `atMs`. */
function savedSession(paths: CliPaths, folder: string, id: string, atMs: number): void {
  const dir = join(paths.claudeConfigDir, "projects", projectFolderName(folder));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(
    file,
    `${JSON.stringify({ cwd: folder, type: "user" })}\n${JSON.stringify({ aiTitle: `title ${id}`, type: "ai-title" })}\n`,
  );
  utimesSync(file, atMs / 1000, atMs / 1000);
}

describe("the other sessions on the Work page", () => {
  test("a crew session's earlier copies are not another session", async () => {
    const w = world();
    const first = "aaaa1111-0000-4000-8000-000000000000";
    const resumed = "bbbb2222-0000-4000-8000-000000000000";
    const stranger = "cccc3333-0000-4000-8000-000000000000";
    await createCrew(
      w.paths.stateDir,
      { ...newCrew(w.repoA, "crew-A-1", "lead-a"), sessionId: first, shortId: "aaaa1111" },
      NOW - 5_000,
    );
    // A resume is a copy with a new id: the record moves on and keeps the first one.
    await updateCrew(
      w.paths.stateDir,
      w.repoA,
      "crew-A-1",
      { sessionId: resumed, shortId: "bbbb2222" },
      NOW - 4_000,
    );
    // A crew session that has no session yet adds no id to the set.
    await createCrew(w.paths.stateDir, newCrew(w.repoA, "crew-A-2", "lead-a"), NOW - 3_000);
    for (const id of [first, resumed, stranger]) savedSession(w.paths, w.repoA, id, NOW - 1_000);
    const deps = { ...w.deps, action: { ...w.deps.action, cwd: w.repoA } };
    const answer = await workAnswer(deps);
    expect(answer.sessions.map((session) => session.id)).toEqual([stranger]);
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

describe("a page read starts one child inside the cache window (RX3)", () => {
  /** A `claude` that logs each start, then runs `body`; the count of starts comes back. */
  function countingClaude(w: ReturnType<typeof world>, body: string): () => number {
    const bin = tempDir("portal-count-agent");
    const binary = join(bin, "claude");
    const log = join(bin, "starts");
    writeFileSync(
      binary,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, "x");\n${body}\n`,
    );
    chmodSync(binary, 0o755);
    w.deps.action.portal.which = (name) => (name === "claude" ? binary : null);
    return () => (existsSync(log) ? readFileSync(log, "utf8").length : 0);
  }

  /** A cleanup child that logs each start and answers no stopped session. */
  function countingCleanup(w: ReturnType<typeof world>): () => number {
    const folder = tempDir("count-cleanup-plugin");
    mkdirSync(join(folder, "dist"));
    writeFileSync(join(folder, "bunfig.toml"), "");
    const log = join(folder, "starts");
    writeFileSync(
      join(folder, "dist", "cli.js"),
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\nconsole.log('{"stopped":[],"error":null}');`,
    );
    w.deps.action.portal.pluginFolder = () => ({ folder });
    // Needs starts other children of the same bundle (the flow report): only cleanup counts.
    return () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line.startsWith("crew cleanup")).length
        : 0;
  }

  test("two overlapping and one later read of /api/needs start one cleanup child", async () => {
    const w = world();
    const starts = countingCleanup(w);
    await Promise.all([needsAnswer(w.deps), needsAnswer(w.deps)]);
    await needsAnswer(w.deps);
    expect(starts()).toBe(1);
    // Past the window, the next read asks again.
    w.deps.action.portal.now = () => NOW + PAGE_READ_FRESH_MS;
    await needsAnswer(w.deps);
    expect(starts()).toBe(2);
  });

  test("two overlapping and one later read of /api/work start one agent-list child", async () => {
    const w = world();
    const starts = countingClaude(w, 'console.log("[]");');
    await Promise.all([workAnswer(w.deps), workAnswer(w.deps)]);
    await workAnswer(w.deps);
    expect(starts()).toBe(1);
    w.deps.action.portal.now = () => NOW + PAGE_READ_FRESH_MS;
    await workAnswer(w.deps);
    expect(starts()).toBe(2);
  });

  test("an action, whatever it answers, forgets what a page read kept", async () => {
    const w = world();
    const starts = countingCleanup(w);
    await needsAnswer(w.deps);
    await runAction("no.such.action", {}, w.deps.action);
    await needsAnswer(w.deps);
    expect(starts()).toBe(2);
  });

  test("a removal's own read is never the page's: the agent list is asked every time", async () => {
    const w = world();
    const starts = countingClaude(w, 'console.log("[]");');
    await workAnswer(w.deps);
    await readPortalAgents(w.deps.action.portal, w.deps.action.cwd);
    await readPortalAgents(w.deps.action.portal, w.deps.action.cwd);
    expect(starts()).toBe(3);
  });

  test("a failed read is shown and not kept: the next look asks again", async () => {
    const w = world();
    const starts = countingClaude(w, "process.exit(3);");
    await workAnswer(w.deps);
    await workAnswer(w.deps);
    expect(starts()).toBe(2);
  });
});
