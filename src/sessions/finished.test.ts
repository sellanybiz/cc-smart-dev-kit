import { describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { cliPaths, tildify } from "../cli/paths";
import { crewArchiveDir } from "../crew/archive";
import { createCrew, crewFile, leadFile, type NewCrew, updateCrew, writeLead } from "../crew/store";
import { writeSessionRecord } from "../testing/crew-world";
import { tempDir } from "../testing/temp";
import { runSessions, type SessionsDeps, type SessionsOptions } from "./command";
import {
  finishedSessions,
  readFinishedSessions,
  type SessionAgentRow,
  sessionAgentRows,
  sessionTerminalAt,
} from "./finished";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const OLD = Date.parse("2026-10-23T10:00:00.000Z");
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const LEAD = "bbbbbbbb-1111-2222-3333-444444444444";
const OTHER_CREW = "f11d0000-1111-2222-3333-444444444444";
const THIRD_CREW = "f22d0000-1111-2222-3333-444444444444";
const DAY = 24 * 60 * 60 * 1000;

function agent(over: Partial<SessionAgentRow> = {}): SessionAgentRow {
  return {
    id: "aaaaaaaa",
    sessionId: SESSION,
    name: "Old session",
    cwd: "/work/my-app",
    kind: "background",
    state: "done",
    status: "busy",
    ...over,
  };
}

function world() {
  const home = tempDir("sessions-finished");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  const repo = join(home, "repo");
  mkdirSync(repo);
  const rows = [agent()];
  const removed: string[][] = [];
  const out: string[] = [];
  let asks = 0;
  const terminal = (row = rows[0] ?? agent(), over: Record<string, unknown> = {}) => {
    const file = join(paths.claudeConfigDir, "jobs", row.id, "state.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        sessionId: row.sessionId,
        state: row.state,
        createdAt: "2026-10-01T10:00:00.000Z",
        lastTerminalAt: new Date(OLD).toISOString(),
        updatedAt: new Date(OLD).toISOString(),
        ...over,
      }),
    );
    return file;
  };
  terminal();
  const deps: SessionsDeps = {
    command: "kit",
    now: NOW,
    platform: "linux",
    sleep: async () => {},
    uptimeSeconds: 1,
    which: () => null,
    spawnDetached: () => {
      throw new Error("must not open a terminal");
    },
    agents: () => rows,
    confirm: () => {
      asks++;
      return true;
    },
    runClaude: (args) => {
      removed.push(args);
      return 0;
    },
  };
  const run = async (options: Partial<SessionsOptions> = {}) => {
    const log = spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")));
    // Out writes to stdout directly; keep its plain lines while testing the same words.
    const stdout = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk).trimEnd());
      return true;
    });
    try {
      return await runSessions(
        paths,
        { finished: true, remove: false, yes: false, open: false, dryRun: false, ...options },
        deps,
        repo,
      );
    } finally {
      log.mockRestore();
      stdout.mockRestore();
    }
  };
  return { home, paths, repo, rows, removed, out, deps, terminal, run, asks: () => asks };
}

async function recordCrew(w: ReturnType<typeof world>) {
  const record: NewCrew = {
    base: null,
    baseRef: "main",
    branch: "crew/T-tests",
    effort: "high",
    files: ["src/sessions/**"],
    id: "crew-T-tests",
    kind: "build",
    lastLine: null,
    leadName: "LEAD my-app plan",
    leadSessionId: LEAD,
    memoryMb: null,
    model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
    name: "C my-app T tests",
    permissionMode: "auto",
    phase: "T",
    plan: "plan",
    pr: null,
    questions: [],
    reportPath: null,
    repo: w.repo,
    sessionId: SESSION,
    shortId: "aaaaaaaa",
    slug: "tests",
    state: "stopped",
    waitsFor: [],
    worktree: join(w.repo, ".claude", "worktrees", "crew-T-tests"),
  };
  await createCrew(w.paths.stateDir, record, OLD);
}

describe("finished session selection", () => {
  test("only done/stopped background sessions older than a full day, with no crew or lead role", () => {
    const rows = [
      agent(),
      agent({ id: "bbbbbbbb", sessionId: "stop", state: "stopped", status: null }),
      ...["working", "blocked", "waiting", "failed", "unknown"].map((state, i) =>
        agent({ id: `0000000${i}`, sessionId: state, state }),
      ),
      agent({ sessionId: "interactive", kind: "interactive" }),
      agent({ sessionId: "unknown-kind", kind: "unknown" }),
      agent({ sessionId: "wait-status", status: "waiting" }),
      agent({ sessionId: "wait-reason", waitingFor: "permission prompt" }),
      agent({ sessionId: "named-lead", name: "LEAD my-app plan" }),
      agent({ sessionId: "named-crew", name: "C my-app T tests" }),
      agent({ sessionId: "long-lead", name: "LEAD my-app a plan with spaces" }),
      agent({ sessionId: "renamed-crew", name: "A misleading new title" }),
      agent({ sessionId: "renamed-lead", name: "Also renamed" }),
      agent({ sessionId: "young" }),
      agent({ sessionId: "boundary" }),
      agent({ sessionId: "unknown-time" }),
      agent({ sessionId: "future" }),
    ];
    const selected = finishedSessions(
      rows,
      new Set(["renamed-crew", "renamed-lead"]),
      (row) =>
        ({ young: NOW - 1, boundary: NOW - 86_400_000, "unknown-time": null, future: NOW + 1 })[
          row.sessionId
        ] ?? (row.sessionId === "unknown-time" ? null : OLD),
      NOW,
    );
    expect(selected).toEqual([
      {
        id: "aaaaaaaa",
        sessionId: SESSION,
        name: "Old session",
        folder: "/work/my-app",
        state: "done",
        finishedAt: OLD,
        ageMs: 93_600_000,
      },
      {
        id: "bbbbbbbb",
        sessionId: "stop",
        name: "Old session",
        folder: "/work/my-app",
        state: "stopped",
        finishedAt: OLD,
        ageMs: 93_600_000,
      },
    ]);
  });

  test("parses the measured 2.1.310 agent view, including retained PID and busy on done", () => {
    const rows = sessionAgentRows(
      JSON.stringify([
        { ...agent(), pid: 123, startedAt: NOW - 1_000_000 },
        { id: "../../bad", state: "done" },
        null,
      ]),
    );
    expect(rows).toEqual([agent()]);
    expect(sessionAgentRows("bad")).toBeNull();
    expect(sessionAgentRows("{}")).toBeNull();
    expect(finishedSessions([agent(), agent()], new Set(), () => OLD, NOW)).toHaveLength(1);
  });

  test("age comes from matching terminal metadata, never startedAt or file mtime", () => {
    const w = world();
    const row = w.rows[0] ?? agent();
    expect(sessionTerminalAt(w.paths, row)).toBe(OLD);
    w.terminal(row, { lastTerminalAt: "2026-10-24T11:00:00.000Z" });
    expect(readFinishedSessions(w.paths, { now: NOW, agents: () => w.rows }).sessions).toEqual([]);
    w.terminal(row, { sessionId: "someone-else" });
    expect(sessionTerminalAt(w.paths, row)).toBeNull();
    w.terminal(row, { state: "working" });
    expect(sessionTerminalAt(w.paths, row)).toBeNull();
    w.terminal(row, { lastTerminalAt: null });
    expect(sessionTerminalAt(w.paths, row)).toBeNull();
    writeFileSync(w.terminal(), "bad JSON");
    expect(sessionTerminalAt(w.paths, row)).toBeNull();
    expect(sessionTerminalAt(w.paths, agent({ id: "../../elsewhere" }))).toBeNull();
  });
});

describe("finished session reader and command", () => {
  test("targeted removal takes only the named eligible ids and refuses ineligible ids", async () => {
    const w = world();
    w.rows.push(agent({ id: "bbbbbbbb", sessionId: "second", name: "Second" }));
    w.terminal(w.rows[1]);
    expect(await w.run({ remove: true, yes: true, ids: ["bbbbbbbb"] })).toBe(0);
    expect(w.removed).toEqual([["rm", "bbbbbbbb"]]);
    const bad = world();
    expect(await bad.run({ remove: true, yes: true, ids: ["cccccccc"] })).toBe(1);
    expect(bad.removed).toEqual([]);
    const invalid = world();
    expect(await invalid.run({ remove: true, yes: true, ids: ["--all"] })).toBe(2);
    expect(invalid.removed).toEqual([]);
  });
  test("lists name, folder and age with no removal and no terminal opening", async () => {
    const w = world();
    expect(await w.run()).toBe(0);
    expect(w.out).toContain("· Old session — /work/my-app — 1d 2h ago");
    expect(w.asks()).toBe(0);
    expect(w.removed).toEqual([]);
  });

  test("all stored crew sessions are excluded by session id despite a renamed title", async () => {
    const w = world();
    await recordCrew(w);
    expect(await w.run({ remove: true, yes: true })).toBe(0);
    expect(w.removed).toEqual([]);
    expect(w.out).toContain("· No finished background sessions older than one day.");
  });

  test("renamed stored leads and a crew record's lead stay out", async () => {
    const w = world();
    await writeLead(
      w.paths.stateDir,
      {
        sessionId: SESSION,
        name: "LEAD my-app plan",
        repo: w.repo,
        cwd: w.repo,
        tag: "my-app",
        plan: "plan",
      },
      OLD,
    );
    expect(await w.run({ remove: true, yes: true })).toBe(0);
    expect(w.removed).toEqual([]);
    const other = world();
    await recordCrew(other);
    other.rows[0] = agent({ id: "bbbbbbbb", sessionId: LEAD, name: "No role in this title" });
    other.terminal();
    expect(await other.run({ remove: true, yes: true })).toBe(0);
    expect(other.removed).toEqual([]);
  });

  test("broken crew or lead records fail closed; unreadable agent view never falls back to live reads", async () => {
    for (const kind of ["crew", "lead"]) {
      const w = world();
      const file =
        kind === "crew"
          ? crewFile(w.paths.stateDir, w.repo, "broken")
          : leadFile(w.paths.stateDir, w.repo, "broken");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{}");
      expect(await w.run({ remove: true, yes: true })).toBe(1);
      expect(w.removed).toEqual([]);
    }
    const w = world();
    w.deps.agents = () => null;
    expect(await w.run({ remove: true, yes: true })).toBe(1);
    expect(w.removed).toEqual([]);
  });

  test("shows the full list before asking once, then runs claude rm for each", async () => {
    const w = world();
    w.rows.push(agent({ id: "bbbbbbbb", sessionId: "second", name: "Second", state: "stopped" }));
    w.terminal(w.rows[1]);
    let asks = 0;
    w.deps.confirm = (question) => {
      asks++;
      expect(question).toBe(
        "Remove these 2 finished sessions with claude rm? A registered or locked worktree must be cleared first.",
      );
      expect(w.out.join("\n")).toContain("Second — /work/my-app — 1d 2h ago");
      return true;
    };
    expect(await w.run({ remove: true })).toBe(0);
    expect(asks).toBe(1);
    expect(w.removed).toEqual([
      ["rm", "aaaaaaaa"],
      ["rm", "bbbbbbbb"],
    ]);
    expect(w.out).toContain("· Removed 2 finished session(s).");
  });

  test("refusal removes nothing, --yes asks nothing, and a removal failure returns nonzero", async () => {
    const no = world();
    no.deps.confirm = () => false;
    expect(await no.run({ remove: true })).toBe(0);
    expect(no.removed).toEqual([]);
    const yes = world();
    expect(await yes.run({ remove: true, yes: true })).toBe(0);
    expect(yes.asks()).toBe(0);
    expect(yes.removed).toEqual([["rm", "aaaaaaaa"]]);
    const bad = world();
    bad.deps.runClaude = () => 7;
    expect(await bad.run({ remove: true, yes: true })).toBe(1);
    expect(bad.out.join("\n")).toContain("Could not remove Old session (aaaaaaaa, exit 7)");
  });

  test("a failed claude rm prints its exact error and safe next step, then attempts later sessions", async () => {
    const w = world();
    w.rows.push(agent({ id: "bbbbbbbb", sessionId: "second", name: "Second" }));
    w.terminal(w.rows[1]);
    const binary = join(w.home, "fake-claude");
    const log = join(w.home, "removals.log");
    writeFileSync(
      binary,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[3] === "aaaaaaaa") {
  console.error("worktree is still registered and locked");
  process.exit(7);
}
`,
    );
    chmodSync(binary, 0o755);
    delete w.deps.runClaude;
    w.deps.which = (name) => (name === "claude" ? binary : null);
    expect(await w.run({ remove: true, yes: true })).toBe(1);
    expect(readFileSync(log, "utf8")).toBe("rm aaaaaaaa\nrm bbbbbbbb\n");
    expect(w.out).toContain(
      "✗ Could not remove Old session (aaaaaaaa, exit 7): worktree is still registered and locked",
    );
    expect(w.out.join("\n")).toContain(
      "Check claude agents --json --all. Clear a registered or locked worktree with kit worktrees --clean from its repository's main checkout, or ExitWorktree, then retry kit sessions --finished --remove.",
    );
    expect(w.out).toContain("· Removed 1 finished session(s).");
  });

  test("rechecks immediately before every rm: resumed, waiting, renamed lead, and updated end time stay", async () => {
    for (const change of ["working", "blocked", "waiting", "lead", "time"]) {
      const w = world();
      w.deps.confirm = () => {
        if (change === "lead") w.rows[0] = agent({ name: "LEAD my-app plan" });
        else if (change === "time")
          w.terminal(undefined, { updatedAt: "2026-10-24T11:00:00.000Z" });
        else w.rows[0] = agent({ state: change });
        return true;
      };
      expect(await w.run({ remove: true })).toBe(0);
      expect(w.removed).toEqual([]);
      expect(w.out.join("\n")).toContain("it is no longer an eligible finished session");
    }
    const w = world();
    w.rows.push(agent({ id: "bbbbbbbb", sessionId: "second", name: "Second" }));
    w.terminal(w.rows[1]);
    w.deps.runClaude = (args) => {
      w.removed.push(args);
      w.rows[1] = agent({ id: "bbbbbbbb", sessionId: "second", state: "working" });
      return 0;
    };
    expect(await w.run({ remove: true, yes: true })).toBe(0);
    expect(w.removed).toEqual([["rm", "aaaaaaaa"]]);
  });
});

describe("what removed crew sessions left in /resume (AR1)", () => {
  const CREW_SESSION = "f00d0000-1111-2222-3333-444444444444";
  /** Before the record's removal (`OLD`): the conversation a crew session wrote while it ran. */
  const WRITTEN = OLD - 60 * 60 * 1000;

  /** A crew record the store marks removed (at `OLD`), and where its conversation is. */
  async function removedCrew(
    w: ReturnType<typeof world>,
    over: Partial<NewCrew> = {},
  ): Promise<{ project: string; worktree: string }> {
    const slug = over.slug ?? "tests";
    const worktree = join(w.repo, ".claude", "worktrees", `crew-T-${slug}`);
    await createCrew(
      w.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: `crew/T-${slug}`,
        effort: "high",
        files: [],
        id: `crew-T-${slug}`,
        kind: "build",
        lastLine: null,
        leadName: "LEAD my-app plan",
        leadSessionId: LEAD,
        memoryMb: null,
        model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
        name: `C my-app T ${slug}`,
        permissionMode: "auto",
        phase: "T",
        plan: "plan",
        pr: null,
        questions: [],
        reportPath: null,
        repo: w.repo,
        sessionId: CREW_SESSION,
        shortId: "f00d0000",
        slug,
        state: "removed",
        waitsFor: [],
        worktree,
        ...over,
      },
      OLD,
    );
    return {
      project: join(w.paths.projectsDir, worktree.replace(/[^A-Za-z0-9]/g, "-")),
      worktree,
    };
  }

  /** The crew session's transcript and one subagent's, written at `atMs`. */
  function conversation(project: string, session = CREW_SESSION, atMs = WRITTEN): string {
    const file = join(project, `${session}.jsonl`);
    const subagent = join(project, session, "subagents", "agent-1.jsonl");
    mkdirSync(dirname(subagent), { recursive: true });
    writeFileSync(file, '{"type":"assistant"}\n');
    writeFileSync(subagent, "{}\n");
    for (const one of [file, subagent]) utimesSync(one, atMs / 1000, atMs / 1000);
    return file;
  }

  /** An archive of another crew session, archived `ageMs` before now. */
  function archive(w: ReturnType<typeof world>, crew: string, ageMs: number): string {
    const dir = crewArchiveDir(w.paths.stateDir, w.repo, crew);
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(
      join(dir, "archive.json"),
      JSON.stringify({
        archivedAt: new Date(NOW - ageMs).toISOString(),
        crew,
        name: `C my-app ${crew}`,
        projectFolder: "-x",
        repo: w.repo,
        sessionId: SESSION,
        version: 1,
      }),
    );
    return dir;
  }

  test("lists the conversations, the empty folders and the expired archives, and moves nothing", async () => {
    const w = world();
    const { project } = await removedCrew(w);
    const transcript = conversation(project);
    const empty = await removedCrew(w, {
      id: "crew-U-empty",
      sessionId: OTHER_CREW,
      slug: "empty",
    });
    // As Claude Code leaves it: an empty `memory` folder is all there is.
    mkdirSync(join(empty.project, "memory"), { recursive: true });
    // A note Claude Code kept there is something: that folder is not empty, so it is not listed.
    const noted = await removedCrew(w, {
      id: "crew-U-noted",
      sessionId: THIRD_CREW,
      slug: "noted",
    });
    mkdirSync(join(noted.project, "memory"), { recursive: true });
    writeFileSync(join(noted.project, "memory", "MEMORY.md"), "a note\n");
    const expired = archive(w, "crew-V-old", 8 * DAY);

    expect(await w.run()).toBe(0);

    const from = w.out.indexOf("Conversations of removed crew sessions, still in /resume");
    expect(w.out.slice(from)).toEqual([
      "Conversations of removed crew sessions, still in /resume",
      "· C my-app T tests — ~/repo/.claude/worktrees/crew-T-tests — 2 files",
      "Empty project folders of removed crew sessions",
      `· ${tildify(empty.project, w.home)}`,
      "Archived crew conversations past crew.archiveDays",
      "· C my-app crew-V-old — archived 8d 0h ago",
    ]);
    expect(existsSync(transcript)).toBe(true);
    expect(existsSync(empty.project)).toBe(true);
    expect(existsSync(expired)).toBe(true);
  });

  test("--remove asks once, then moves each conversation, removes each empty folder and deletes each expired archive", async () => {
    const w = world();
    w.rows.length = 0;
    const { project } = await removedCrew(w);
    conversation(project);
    const empty = await removedCrew(w, {
      id: "crew-U-empty",
      sessionId: OTHER_CREW,
      slug: "empty",
    });
    mkdirSync(join(empty.project, "memory"), { recursive: true });
    const expired = archive(w, "crew-V-old", 8 * DAY);
    const questions: string[] = [];
    w.deps.confirm = (question) => {
      questions.push(question);
      return true;
    };

    expect(await w.run({ remove: true })).toBe(0);

    expect(questions).toEqual([
      "Move 1 conversation out of /resume into the kit's archive, remove 1 empty project folder and delete 1 archive past crew.archiveDays?",
    ]);
    expect(existsSync(project)).toBe(false);
    expect(existsSync(empty.project)).toBe(false);
    expect(existsSync(expired)).toBe(false);
    const into = join(
      crewArchiveDir(w.paths.stateDir, w.repo, "crew-T-tests"),
      "projects",
      project.split("/").at(-1) ?? "",
    );
    expect(gunzipSync(readFileSync(join(into, `${CREW_SESSION}.jsonl.gz`))).toString()).toBe(
      '{"type":"assistant"}\n',
    );
    expect(w.out.join(" ")).toContain(
      "- Moved the conversation of C my-app T tests (2 files) into",
    );
    expect(w.out).toContain("- Deleted the archived conversation of C my-app crew-V-old.");
  });

  test("a refusal moves nothing; --yes asks nothing", async () => {
    const no = world();
    no.rows.length = 0;
    const { project } = await removedCrew(no);
    const transcript = conversation(project);
    no.deps.confirm = () => false;
    expect(await no.run({ remove: true })).toBe(0);
    expect(existsSync(transcript)).toBe(true);
    expect(no.out).toContain(
      "· Nothing moved. Use kit sessions --finished --remove --yes to confirm without a terminal.",
    );

    const yes = world();
    yes.rows.length = 0;
    const moved = await removedCrew(yes);
    conversation(moved.project);
    expect(await yes.run({ remove: true, yes: true })).toBe(0);
    expect(yes.asks()).toBe(0);
    expect(existsSync(moved.project)).toBe(false);
  });

  test("never taken: a crew session still on the board, a lead's session, a running one, one resumed since", async () => {
    const w = world();
    w.rows.length = 0;
    // Still on the board: its record is stopped, not removed.
    const stopped = await removedCrew(w, { slug: "stopped", state: "stopped" });
    const stoppedFile = conversation(stopped.project);
    // A lead's session, under a removed record's name.
    const lead = await removedCrew(w, { id: "crew-T-lead", sessionId: LEAD, slug: "lead" });
    const leadFile = conversation(lead.project, LEAD);
    // Written after its record was removed: the person resumed it since.
    const resumed = await removedCrew(w, {
      id: "crew-T-resumed",
      sessionId: OTHER_CREW,
      slug: "resumed",
    });
    const resumedFile = conversation(resumed.project, OTHER_CREW, OLD + 60_000);
    // A running Claude session holds it (Claude Code's own record of this test's process).
    const running = await removedCrew(w, {
      id: "crew-T-running",
      sessionId: THIRD_CREW,
      slug: "running",
    });
    const runningFile = conversation(running.project, THIRD_CREW);
    writeSessionRecord(w.paths, process.pid, THIRD_CREW, running.worktree);

    expect(await w.run({ remove: true, yes: true })).toBe(0);

    for (const file of [stoppedFile, leadFile, resumedFile, runningFile])
      expect(`${file}: ${existsSync(file)}`).toBe(`${file}: true`);
    // Not even listed: a record on the board and a lead's session are not the sweep's to name.
    expect(w.out.filter((line) => line.includes("T stopped") || line.includes("T lead"))).toEqual(
      [],
    );
    expect(w.out).toContain(
      "· C my-app T resumed stays: it was written after its crew session was removed",
    );
    expect(w.out).toContain("· C my-app T running stays: a running Claude session holds it");
    expect(existsSync(crewArchiveDir(w.paths.stateDir, w.repo, "crew-T-stopped"))).toBe(false);
  });

  test("the removal time is the removal's own event, not the record's last write", async () => {
    const w = world();
    w.rows.length = 0;
    const REMOVED_AT = OLD - 30 * 60 * 1000;
    // A crew session the kit removed at REMOVED_AT; a later write (the 30-day prune of a discard
    // archive, say) moved the record's updatedAt past everything.
    const worktree = join(w.repo, ".claude", "worktrees", "crew-T-late");
    const project = join(w.paths.projectsDir, worktree.replace(/[^A-Za-z0-9]/g, "-"));
    await createCrew(
      w.paths.stateDir,
      {
        base: null,
        baseRef: "main",
        branch: "crew/T-late",
        effort: "high",
        files: [],
        id: "crew-T-late",
        kind: "build",
        lastLine: null,
        leadName: "LEAD my-app plan",
        leadSessionId: LEAD,
        memoryMb: null,
        model: { named: "sonnet", resolved: "claude-sonnet-5-5", slot: null, tier: null },
        name: "C my-app T late",
        permissionMode: "auto",
        phase: "T",
        plan: "plan",
        pr: null,
        questions: [],
        reportPath: null,
        repo: w.repo,
        sessionId: CREW_SESSION,
        shortId: "f00d0000",
        slug: "late",
        state: "working",
        waitsFor: [],
        worktree,
      },
      REMOVED_AT - 3_600_000,
    );
    await updateCrew(
      w.paths.stateDir,
      w.repo,
      "crew-T-late",
      { state: "removed" },
      REMOVED_AT,
      "removed",
    );
    // The person resumed the conversation after the removal, and the record was touched later still.
    const file = conversation(project, CREW_SESSION, REMOVED_AT + 10 * 60 * 1000);
    await updateCrew(w.paths.stateDir, w.repo, "crew-T-late", { lastLine: "pruned" }, OLD + DAY);

    expect(await w.run({ remove: true, yes: true })).toBe(0);

    expect(existsSync(file)).toBe(true);
    expect(w.out).toContain(
      "· C my-app T late stays: it was written after its crew session was removed",
    );
  });

  test("a conversation whose archived copy differs is kept with the reason, exit 0, every run", async () => {
    const w = world();
    w.rows.length = 0;
    const { project } = await removedCrew(w);
    const file = conversation(project);
    // An earlier move archived this file; a job wrote a different one of the same name since.
    const into = join(
      crewArchiveDir(w.paths.stateDir, w.repo, "crew-T-tests"),
      "projects",
      project.split("/").at(-1) ?? "",
    );
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, `${CREW_SESSION}.jsonl.gz`), gzipSync('{"type":"first part"}\n'));

    expect(await w.run({ remove: true, yes: true })).toBe(0);
    expect(await w.run({ remove: true, yes: true })).toBe(0);

    expect(readFileSync(file, "utf8")).toBe('{"type":"assistant"}\n');
    expect(w.out).toContain(
      `· C my-app T tests stays: ${CREW_SESSION}.jsonl differs from its archived copy, so neither is overwritten`,
    );
    expect(w.out.join("\n")).not.toContain("Could not move");
  });

  test("a session that starts running while the question is open is not moved", async () => {
    const w = world();
    w.rows.length = 0;
    const { project, worktree } = await removedCrew(w);
    const file = conversation(project);
    w.deps.confirm = () => {
      // The person resumes it in a terminal: Claude Code writes its record of a running session.
      writeSessionRecord(w.paths, process.pid, CREW_SESSION, worktree);
      return true;
    };

    expect(await w.run({ remove: true })).toBe(0);

    expect(existsSync(file)).toBe(true);
    expect(w.out).toContain("· Kept C my-app T tests: its conversation is no longer one to move.");
    expect(existsSync(crewArchiveDir(w.paths.stateDir, w.repo, "crew-T-tests"))).toBe(false);
  });

  test("a crew record it cannot read fails closed: nothing is listed or moved", async () => {
    const w = world();
    w.rows.length = 0;
    const { project } = await removedCrew(w);
    const transcript = conversation(project);
    writeFileSync(crewFile(w.paths.stateDir, w.repo, "broken"), "{}");

    expect(await w.run({ remove: true, yes: true })).toBe(1);

    expect(existsSync(transcript)).toBe(true);
    expect(w.out).toContain(
      "✗ Could not read every crew record; repair the crew store before moving them.",
    );
  });

  test("--id names finished sessions only: the crew part is left out", async () => {
    const w = world();
    const { project } = await removedCrew(w);
    const transcript = conversation(project);
    expect(await w.run({ remove: true, yes: true, ids: ["aaaaaaaa"] })).toBe(0);
    expect(existsSync(transcript)).toBe(true);
  });
});
