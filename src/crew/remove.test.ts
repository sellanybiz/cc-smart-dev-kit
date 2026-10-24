/**
 * `crew rm` moves the removed crew session's conversation out of Claude Code's `/resume` list
 * (AR1), only after `claude rm` succeeded, and deletes the archives past `crew.archiveDays`. The
 * same steps run when the watch removes a merged crew session (`runCrewRm`). A real git repo, the
 * store and Claude Code's projects folder in temp folders, the fake `claude` of the board world.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { boardWorld, NOW } from "../testing/board-world";
import { git } from "../testing/temp";
import { ARCHIVE_MANIFEST, crewArchiveDir, DAY_MS } from "./archive";
import { runCrew } from "./command";
import { readCrew, writeLead } from "./store";
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
