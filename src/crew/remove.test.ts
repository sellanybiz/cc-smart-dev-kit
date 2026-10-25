/**
 * `crew rm` moves the removed crew session's conversation out of Claude Code's `/resume` list
 * (AR1), only after `claude rm` succeeded, and deletes the archives past `crew.archiveDays`. The
 * same steps run when the watch removes a merged crew session (`runCrewRm`). A real git repo, the
 * store and Claude Code's projects folder in temp folders, the fake `claude` of the board world.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { withLock } from "../setup/lock";
import { boardWorld, NOW } from "../testing/board-world";
import { writeSessionRecord } from "../testing/crew-world";
import { git } from "../testing/temp";
import { ARCHIVE_MANIFEST, crewArchiveDir, DAY_MS } from "./archive";
import { crewArchiveRoot } from "./archive-read";
import { runCrew } from "./command";
import { archiveAfterRemoval, crewRemovalLockDir } from "./remove";
import { crewFile, readCrew, updateCrew, writeLead } from "./store";
import { transcriptFile } from "./transcript";

const SESSION = "a1b2c3d4-0000-1111-2222-333333333333";
const OTHER = "e22e0000-1111-2222-3333-444444444444";
/** Agent view still lists the session, so a failed `claude rm` is a real failure. */
const STILL_LISTED = JSON.stringify([{ id: "a1b2c3d4", state: "stopped", status: "idle" }]);

type World = Awaited<ReturnType<typeof boardWorld>>;

/** The crew session's conversation where Claude Code saves it: its transcript and its folder. */
function conversation(world: World, worktree: string): string {
  const file = transcriptFile(world.paths.projectsDir, worktree, SESSION);
  mkdirSync(join(dirname(file), SESSION, "subagents"), { recursive: true });
  writeFileSync(file, '{"type":"assistant"}\n');
  writeFileSync(join(dirname(file), SESSION, "subagents", "agent-1.jsonl"), "{}\n");
  writeFileSync(join(dirname(file), SESSION, "subagents", "agent-1.meta.json"), "{}");
  return dirname(file);
}

/** Holds the archive lock as another run would; the returned function lets it go. */
async function holdArchiveLock(stateDir: string): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  void withLock(
    crewArchiveRoot(stateDir),
    async () => {
      ready();
      await held;
    },
    { waitMs: 1000 },
  );
  await started;
  return release;
}

/** An archive of another crew session, archived `ageMs` before the world's now. */
function oldArchive(world: World, crew: string, ageMs: number): string {
  const dir = crewArchiveDir(world.paths.stateDir, world.repo, crew);
  mkdirSync(join(dir, "projects"), { recursive: true });
  writeFileSync(
    join(dir, ARCHIVE_MANIFEST),
    JSON.stringify({
      archivedAt: new Date(NOW - ageMs).toISOString(),
      crew,
      name: `C my-app ${crew}`,
      projectFolder: "-x",
      repo: world.repo,
      sessionId: OTHER,
      version: 1,
    }),
  );
  return dir;
}

describe("crew rm: the conversation leaves /resume (AR1)", () => {
  test("after claude rm, the transcript, its folder and the empty project folder move into the archive", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    const dir = crewArchiveDir(world.paths.stateDir, world.repo, record.id);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${record.worktree}`,
      "deleted branch crew/B1-help",
      "removed session a1b2c3d4",
      `archived the conversation of session a1b2c3d4 (3 files) in ${tildify(dir, world.home)}: it leaves /resume, and is deleted after 7 days`,
      "removed C my-app B1 help",
    ]);
    expect(existsSync(project)).toBe(false);
    const into = join(dir, "projects", project.split("/").at(-1) ?? "");
    expect(readdirSync(into).sort()).toEqual([SESSION, `${SESSION}.jsonl.gz`]);
    expect(readdirSync(join(into, SESSION, "subagents")).sort()).toEqual([
      "agent-1.jsonl.gz",
      "agent-1.meta.json.gz",
    ]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("removed");
  });

  test("RX1: a resumed record leaves no earlier session behind: each is claude rm'd and archived", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    // A resume (WF1) is a copy with a new id: the record takes it, and the original stays in /resume.
    const copy = "f9e8d7c6-0000-1111-2222-333333333333";
    writeFileSync(join(project, `${copy}.jsonl`), '{"type":"assistant"}\n');
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { sessionId: copy, shortId: "f9e8d7c6" },
      NOW,
    );

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(world.err).toEqual([]);
    const removed = world.claudeCalls().filter((call) => call[0] === "rm");
    expect(removed.map((call) => call[1]).sort()).toEqual(["a1b2c3d4", "f9e8d7c6"]);
    // Nothing of the crew session is left in Claude Code's projects folder.
    expect(existsSync(project)).toBe(false);
    const dir = crewArchiveDir(world.paths.stateDir, world.repo, record.id);
    const into = join(dir, "projects", project.split("/").at(-1) ?? "");
    expect(readdirSync(into).sort()).toEqual([SESSION, `${SESSION}.jsonl.gz`, `${copy}.jsonl.gz`]);
  });

  test("RX1: a record that has a short id and no session id (a failed start) still gets its claude rm", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "failed" });
    // `crew start` records `{ shortId }` alone when agent view cannot say the session id.
    const file = crewFile(world.paths.stateDir, world.repo, record.id);
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), sessionId: null }),
    );

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(world.claudeCalls().filter((call) => call[0] === "rm")).toEqual([["rm", "a1b2c3d4"]]);
  });

  test("RX1: an earlier session Claude Code no longer lists is gone already", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    const copy = "f9e8d7c6-0000-1111-2222-333333333333";
    writeFileSync(join(project, `${copy}.jsonl`), '{"type":"assistant"}\n');
    await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      { sessionId: copy, shortId: "f9e8d7c6" },
      NOW,
    );

    // Every `claude rm` fails, and agent view lists neither session: both are gone already.
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_RM: "fail", FAKE_WORKTREE: record.worktree }),
      ),
    ).toBe(0);

    expect(world.out).toContain("session a1b2c3d4 was gone already");
    expect(world.out).toContain("session f9e8d7c6 was gone already");
    expect(existsSync(project)).toBe(false);
  });

  test("RX1: a removal that runs holds the record: a second one refuses, and rolls nothing back", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "merged" });
    // The person's `crew rm --discard` is mid-way: its rollback bytes are on the record.
    const pending = {
      archivedHead: "a".repeat(40),
      head: "b".repeat(40),
      indexArchived: join(world.home, "index.new"),
      indexBackup: join(world.home, "index.bak"),
      indexPath: join(world.home, "index"),
    };
    await updateCrew(world.paths.stateDir, world.repo, record.id, { discardPending: pending }, NOW);
    const first = crewRemovalLockDir(world.paths.stateDir, world.repo, record.id);
    mkdirSync(first, { recursive: true });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    void withLock(
      first,
      async () => {
        ready();
        await held;
      },
      { waitMs: 1000 },
    );
    await started;
    let code: number;
    try {
      // The lead's watch tries the same record while the person's removal runs.
      code = await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree }));
    } finally {
      release();
    }

    expect(code).toBe(1);
    expect(world.err).toEqual([
      `crew rm: ${record.name} is being removed by another run; wait for it to end, then run crew rm again if it is still there`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      discardPending: pending,
      state: "merged",
    });
  });

  test("a failed claude rm moves nothing: Claude Code still knows the session", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx(
          {},
          { FAKE_AGENTS_JSON: STILL_LISTED, FAKE_RM: "fail", FAKE_WORKTREE: record.worktree },
        ),
      ),
    ).toBe(1);

    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
    expect(existsSync(join(project, SESSION, "subagents", "agent-1.jsonl"))).toBe(true);
    expect(existsSync(join(world.paths.stateDir, "crew-archive"))).toBe(false);
  });

  test("a lead's session is never touched", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    await writeLead(
      world.paths.stateDir,
      {
        cwd: world.repo,
        name: "LEAD my-app other-plan",
        plan: "other-plan",
        repo: world.repo,
        sessionId: SESSION,
        tag: "my-app",
      },
      NOW,
    );

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(world.err).toEqual([
      "note: the conversation of session a1b2c3d4 stays where it is: a lead, or a crew session still on the board, holds that session",
    ]);
    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
    expect(existsSync(join(world.paths.stateDir, "crew-archive"))).toBe(false);
  });

  test("a session the store does not know stays, and so does its project folder", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    writeFileSync(join(project, `${OTHER}.jsonl`), '{"type":"user"}\n');

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(readdirSync(project)).toEqual([`${OTHER}.jsonl`]);
  });

  test("a session a running Claude holds stays where it is", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    const running = { cwd: world.repo, name: "resumed", pid: 4242, sessionId: SESSION };

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx(
          { scanFacts: { containers: [], programs: [], sessions: [running] } },
          { FAKE_WORKTREE: record.worktree },
        ),
      ),
    ).toBe(0);

    expect(world.err).toEqual([
      "note: the conversation of session a1b2c3d4 stays where it is: a running Claude session holds it",
    ]);
    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
  });

  test("a session that began running after the machine's facts were read still stays", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    // The facts the removal was handed say no session runs; Claude Code's own record says one does.
    writeSessionRecord(world.paths, process.pid, SESSION, record.worktree);

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(world.err).toEqual([
      "note: the conversation of session a1b2c3d4 stays where it is: a running Claude session holds it",
    ]);
    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
  });

  test("an archive another run holds never fails the removal: both steps say so and go on", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "removed" });
    const project = conversation(world, record.worktree);
    const release = await holdArchiveLock(world.paths.stateDir);
    try {
      await archiveAfterRemoval(record, world.ctx(), { lockWaitMs: 0 });
    } finally {
      release();
    }

    expect(world.err).toHaveLength(2);
    expect(world.err[0]).toStartWith(
      "note: the conversation of session a1b2c3d4 stays in /resume: ",
    );
    expect(world.err[0]).toContain("is busy");
    expect(world.err[1]).toStartWith("note: old crew archives could not be deleted now: ");
    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
  });

  test("the archives past crew.archiveDays are deleted, and the younger ones stay", async () => {
    const world = await boardWorld();
    const old = oldArchive(world, "C9-old-1a2b3c", 8 * DAY_MS);
    const young = oldArchive(world, "C8-young-1a2b3c", 6 * DAY_MS);
    const record = await world.addCrew();

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({ now: () => NOW }, { FAKE_WORKTREE: record.worktree }),
      ),
    ).toBe(0);

    // No conversation of its own to move: only the prune speaks.
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${record.worktree}`,
      "deleted branch crew/B1-help",
      "removed session a1b2c3d4",
      "deleted the archived conversation of C my-app C9-old-1a2b3c (8 days old)",
      "removed C my-app B1 help",
    ]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  test("the project's crew.archiveDays decides", async () => {
    const world = await boardWorld();
    world.writeConfig({ archiveDays: 30 });
    git(world.repo, "add", ".");
    git(world.repo, "commit", "-q", "-m", "the kit's settings");
    const old = oldArchive(world, "C9-old-1a2b3c", 8 * DAY_MS);
    const record = await world.addCrew();
    conversation(world, record.worktree);

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({ now: () => NOW }, { FAKE_WORKTREE: record.worktree }),
      ),
    ).toBe(0);

    expect(existsSync(old)).toBe(true);
    expect(world.out).toContain(
      `archived the conversation of session a1b2c3d4 (3 files) in ${tildify(crewArchiveDir(world.paths.stateDir, world.repo, record.id), world.home)}: it leaves /resume, and is deleted after 30 days`,
    );
  });

  test("the watch's removal after a merge runs the same steps: the conversation leaves /resume", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    writeFileSync(join(record.worktree, "done.txt"), "x\n");
    git(record.worktree, "add", ".");
    git(record.worktree, "commit", "-q", "-m", "the phase");
    git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", record.branch);
    const project = conversation(world, record.worktree);
    const row = { cwd: record.worktree, id: "a1b2c3d4", kind: "background", sessionId: SESSION };

    await runCrew(
      ["watch", "--once", "--timeout", "0"],
      world.ctx({}, { FAKE_AGENTS_JSON: JSON.stringify([{ ...row, state: "done" }]) }),
    );

    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("removed");
    expect(existsSync(project)).toBe(false);
    const dir = crewArchiveDir(world.paths.stateDir, world.repo, record.id);
    expect(
      existsSync(join(dir, "projects", project.split("/").at(-1) ?? "", `${SESSION}.jsonl.gz`)),
    ).toBe(true);
  });

  test("an archive that fails says so, and the removal still ends", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const project = conversation(world, record.worktree);
    // A file where the archive's folder must go.
    const dir = crewArchiveDir(world.paths.stateDir, world.repo, record.id);
    mkdirSync(dirname(dir), { recursive: true });
    writeFileSync(dir, "x");
    utimesSync(dir, NOW / 1000, NOW / 1000);

    expect(
      await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: record.worktree })),
    ).toBe(0);

    expect(world.err.length).toBe(1);
    expect(world.err[0]).toStartWith(
      "note: the conversation of session a1b2c3d4 stays in /resume: ",
    );
    expect(world.err[0]).toEndWith(`; ${COMMAND} sessions --finished --remove moves it later`);
    expect(existsSync(join(project, `${SESSION}.jsonl`))).toBe(true);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("removed");
  });
});
