/**
 * The end of a crew session: `crew stop`, `crew rm` and `crew resume`. A real git repo with a
 * real worktree and branch, the store in a temp state folder, a fake `claude` on PATH that
 * refuses `rm` while the worktree is still there — as the real one does (proved live, L1a.1) —
 * and the machine's facts given (`src/testing/board-world.ts`). No real Claude session runs.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { type BoardWorld, boardWorld, MINUTE, NOW, QUIET_MACHINE } from "../testing/board-world";
import { LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { git, tempDir } from "../testing/temp";
import { repoKey } from "../workflow/reviews";
import type { RunningProgram } from "../worktrees/machine-facts";
import { parseResumeArgs, runCrew } from "./command";
import { procEnviron, stopLeftoverProcesses } from "./end";
import {
  appendCrewEvent,
  crewMcpFile,
  crewSettingsFile,
  listCrew,
  readCrew,
  readCrewEvents,
  writeLead,
} from "./store";

/** The session of another lead of the world: its paused crew sessions are not this lead's. */
const OTHER_LEAD = OTHER_SESSION;

/** The session `claude agents` lists, so a failed stop is a real failure and not a gone session. */
const LISTED = JSON.stringify([
  { id: "a1b2c3d4", sessionId: "a1b2c3d4-0000-1111-2222-333333333333" },
]);

/** The `claude --bg --resume` a record's resume runs: its launch fields, its own files, then any text. */
function resumeCall(world: BoardWorld, id: string, shortId: string, text?: string): string[] {
  return [
    "--bg",
    "--resume",
    `${shortId}-0000-1111-2222-333333333333`,
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--permission-mode",
    "auto",
    "--autocompact",
    "auto",
    "--strict-mcp-config",
    "--mcp-config",
    crewMcpFile(world.paths.stateDir, world.repo, id),
    "--settings",
    crewSettingsFile(world.paths.stateDir, world.repo, id),
    ...(text === undefined ? [] : [text]),
  ];
}

/** The crew session B1 "help"'s branch and worktree, as `boardWorld().addCrew` makes them. */
function places(repo: string) {
  return {
    branch: "crew/B1-help",
    worktree: join(repo, ".claude", "worktrees", "crew-B1-help"),
  };
}

/** One commit of the crew session's own, in its worktree. */
function commitWork(worktree: string): void {
  writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "work");
}

/** One commit of a second crew session's own, in its worktree: different work, so a replay sees a change. */
function commitOtherWork(worktree: string): void {
  writeFileSync(join(worktree, "other.ts"), "export const y = 2;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "other work");
}

/** The lead merges the crew session's branch into its own, as D24 has it. */
function leadMerges(repo: string, branch: string): void {
  git(repo, "merge", "--no-ff", "-m", "merge the crew session", branch);
}

/**
 * A real background program in `cwd`, as a crew session's own check outlives its turn: the
 * removal signals this test's own child, never a process the test did not start. `crew` is the
 * crew id its environment carries (`CC_SMART_DEV_KIT_CREW`, which every program a crew session
 * starts inherits, whoever it is reparented to); null starts one that carries none, as a
 * person's terminal or dev server does. The environment is built here, not inherited, so the
 * session that runs the suite cannot leak its own marker in.
 */
async function startProgram(
  cwd: string,
  crew: null | string,
  command = "sleep 60",
): Promise<Bun.Subprocess> {
  const child = Bun.spawn(["sh", "-c", command], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      ...(crew === null ? {} : { CC_SMART_DEV_KIT_CREW: crew }),
    },
    stderr: "ignore",
    stdout: "ignore",
  });
  // Until the child has run `sleep`, /proc shows the environment it was forked with — the
  // suite's own — and a removal that read it then would judge the wrong program.
  for (let tries = 0; tries < 400; tries += 1) {
    try {
      if (readFileSync(`/proc/${String(child.pid)}/cmdline`, "utf8").includes("sleep")) break;
    } catch {
      break;
    }
    await Bun.sleep(5);
  }
  return child;
}

/** True when `child` ended within two seconds (the removal's SIGTERM and SIGKILL are instant here). */
async function ended(child: Bun.Subprocess): Promise<boolean> {
  return await Promise.race([child.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
}

/** The moment a removal moved a leftover folder aside, in the name `removeWorktree` gives it. */
const PARKED_AT = 1761300000000;

/**
 * What a removal that failed midway leaves when git no longer lists the folder: the files git
 * could not delete, written before the move.
 */
function leftoverFolder(repo: string, name: string, files = ["docs/guide.md"]): string {
  const folder = join(repo, ".claude", "worktrees", `${name}-removing-${String(PARKED_AT)}`);
  for (const file of files) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), "left\n");
    const before = new Date(PARKED_AT - 60_000);
    utimesSync(join(folder, file), before, before);
  }
  return folder;
}

/** Agent view still lists the crew session of the board world: a failed `claude rm` is a real failure. */
const STILL_LISTED = JSON.stringify([{ id: "a1b2c3d4", state: "stopped", status: "idle" }]);
describe("crew stop", () => {
  test("stops that one session, keeps the conversation, and the store says stopped", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    expect(await runCrew(["stop", "C my-app B1 help"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
    expect(world.out).toEqual([
      "stopped C my-app B1 help (a1b2c3d4); the conversation is kept, and `claude attach a1b2c3d4` opens it again",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "stopped",
      text: "stopped by the lead",
      type: "state",
    });
  });

  test("a crew session that ended with an outcome keeps it: only its process is stopped", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    expect(await runCrew(["stop", record.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
    expect(world.out).toEqual([
      "stopped C my-app B1 help (a1b2c3d4); the conversation is kept, and `claude attach a1b2c3d4` opens it again; it stays done",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "done",
    });
  });

  test("a session Claude Code no longer lists is stopped all the same, and the line says so", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    expect(await runCrew(["stop", record.id], world.ctx({}, { FAKE_STOP: "gone" }))).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["agents", "--json", "--all"],
    ]);
    expect(world.out).toEqual([
      "stopped C my-app B1 help (a1b2c3d4); its session was gone already",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)?.text).toBe(
      "its session was gone already",
    );
  });

  test("a stop that really fails (the session is listed) says so and changes nothing", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    expect(
      await runCrew(
        ["stop", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: LISTED, FAKE_STOP: "fail" }),
      ),
    ).toBe(1);
    expect(world.err).toEqual([
      "crew stop: claude stop a1b2c3d4 failed (exit 1): could not stop",
      `Fix: claude stop a1b2c3d4 by hand, or ${COMMAND} crew list to see it`,
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("a stopped crew session is not stopped twice", async () => {
    const world = await boardWorld();
    await world.addCrew({ state: "stopped" });
    expect(await runCrew(["stop", "B1-help-1a2b3c"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "C my-app B1 help is stopped already; `claude attach a1b2c3d4` opens it again",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a crew session with no session, one already removed, a name nobody has", async () => {
    const world = await boardWorld();
    await world.addCrew({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    await world.addCrew({ phase: "B3", slug: "gone", state: "removed", worktree: false });
    expect(await runCrew(["stop", "B2-api-1a2b3c"], world.ctx())).toBe(1);
    expect(await runCrew(["stop", "B3-gone-1a2b3c"], world.ctx())).toBe(1);
    expect(await runCrew(["stop", "C my-app B9 nope"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew stop: C my-app B2 api has no session yet (it is queued)",
      `Fix: ${COMMAND} crew list shows when it starts`,
      "crew stop: C my-app B3 gone is removed; it has no session left",
      'crew stop: no crew session of this repository is "C my-app B9 nope"',
      `Fix: ${COMMAND} crew list shows them, and --all those of every repository`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a name two LIVE crew sessions share stops neither", async () => {
    const world = await boardWorld();
    await world.addCrew({ atMs: NOW - 30 * MINUTE, state: "blocked", suffix: "aaaaaa" });
    await world.addCrew({
      atMs: NOW - 20 * MINUTE,
      slug: "again",
      name: "C my-app B1 help",
      suffix: "bbbbbb",
    });
    expect(await runCrew(["stop", "C my-app B1 help"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      'crew stop: "C my-app B1 help" is two crew sessions',
      "  B1-help-aaaaaa  C my-app B1 help  blocked",
      "  B1-again-bbbbbb  C my-app B1 help  working",
      "Fix: name one by its id",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a name one live crew session and only removed ones share means the live one", async () => {
    const world = await boardWorld();
    await world.addCrew({ atMs: NOW - 30 * MINUTE, state: "removed", worktree: false });
    const live = await world.addCrew({
      atMs: NOW - 20 * MINUTE,
      slug: "again",
      name: "C my-app B1 help",
      suffix: "bbbbbb",
    });
    expect(await runCrew(["stop", "C my-app B1 help"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
    expect(world.out).toEqual([
      "stopped C my-app B1 help (a1b2c3d4); the conversation is kept, and `claude attach a1b2c3d4` opens it again",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, live.id)).toMatchObject({
      state: "stopped",
    });
  });

  test("resume finds the one live record too, never the removed one", async () => {
    const world = await boardWorld();
    await world.addCrew({ atMs: NOW - 30 * MINUTE, state: "removed", worktree: false });
    const live = await world.addCrew({
      atMs: NOW - 20 * MINUTE,
      slug: "again",
      name: "C my-app B1 help",
      state: "stopped",
      suffix: "bbbbbb",
    });
    expect(await runCrew(["resume", "C my-app B1 help"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(world, "B1-again-bbbbbb", "a1b2c3d4"),
    ]);
    expect(world.out).toEqual(["resumed C my-app B1 help (a1b2c3d4)"]);
    expect(await readCrew(world.paths.stateDir, world.repo, live.id)).toMatchObject({
      state: "working",
    });
  });

  test("crew rm finds the one live record too", async () => {
    const world = await boardWorld();
    await world.addCrew({ atMs: NOW - 30 * MINUTE, state: "removed", worktree: false });
    const live = await world.addCrew({
      atMs: NOW - 20 * MINUTE,
      shortId: null,
      slug: "again",
      name: "C my-app B1 help",
      state: "queued",
      suffix: "bbbbbb",
      worktree: false,
    });
    expect(await runCrew(["rm", "C my-app B1 help"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "removed C my-app B1 help; it had not started, so nothing else went",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, live.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a crew session's own session never stops, removes or resumes a crew session", async () => {
    const world = await boardWorld();
    await world.addCrew();
    const asCrew = { CC_SMART_DEV_KIT_CREW: "B2-api-aaaaaa" };
    for (const command of ["stop", "rm", "resume"]) {
      expect(await runCrew([command, "B1-help-1a2b3c"], world.ctx({}, asCrew))).toBe(1);
    }
    expect(world.err.filter((line) => line.startsWith("crew "))).toEqual([
      "crew stop: this session is the crew session B2-api-aaaaaa, and a crew session never stops, removes or resumes crew sessions",
      "crew rm: this session is the crew session B2-api-aaaaaa, and a crew session never stops, removes or resumes crew sessions",
      "crew resume: this session is the crew session B2-api-aaaaaa, and a crew session never stops, removes or resumes crew sessions",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });
});

describe("crew rm: the lead must have merged the branch (D24)", () => {
  test("before the merge it is refused, with the count and where the lead merges; nothing is touched", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    // Uncommitted work too: the merge is what is asked first.
    writeFileSync(join(worktree, "notes.md"), "mine\n");

    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew rm: ${branch} has 1 commit that main does not have`,
      `Fix: the lead merges it first (git merge ${branch}, in ${world.repo}), then run crew rm again`,
    ]);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "branch", "--list", branch)).not.toBe("");
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("the crew session's own base is the branch it merges into, wherever the lead's folder is", async () => {
    const world = await boardWorld();
    // A lead that works in a worktree of its own, on its own branch.
    const leadFolder = join(world.repo, ".claude", "worktrees", "lead");
    git(world.repo, "worktree", "add", "-b", "lead-work", leadFolder, "HEAD");
    await writeLead(
      world.paths.stateDir,
      {
        cwd: leadFolder,
        name: "LEAD my-app other-plan",
        plan: "other-plan",
        repo: world.repo,
        sessionId: "f00dfeed-0000-1111-2222-333333333333",
        tag: "my-app",
      },
      NOW,
    );
    const record = await world.addCrew({ leadSessionId: "f00dfeed-0000-1111-2222-333333333333" });
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    // Merged into the branch it was cut from (main), though the lead's folder is on another branch.
    leadMerges(world.repo, branch);

    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
  });

  test("a lead whose folder is gone: the ref the crew session was cut from stands in", async () => {
    const world = await boardWorld();
    await writeLead(
      world.paths.stateDir,
      {
        cwd: join(world.repo, "no-such-folder"),
        name: "LEAD my-app gone",
        plan: "gone",
        repo: world.repo,
        sessionId: "dead0000-0000-1111-2222-333333333333",
        tag: "my-app",
      },
      NOW,
    );
    const record = await world.addCrew({ leadSessionId: "dead0000-0000-1111-2222-333333333333" });
    commitWork(places(world.repo).worktree);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew rm: crew/B1-help has 1 commit that main does not have",
      `Fix: the lead merges it first (git merge crew/B1-help, in ${world.repo}), then run crew rm again`,
    ]);
  });

  test("two crew sessions of one lead, on two bases, each merged into its own base and each removed", async () => {
    const world = await boardWorld();
    const { repo } = world;
    // A second base, cut from main: the lead runs two release branches.
    git(repo, "branch", "release-1.1.3", "main");
    const mainSha = git(repo, "rev-parse", "main").trim();
    const releaseSha = git(repo, "rev-parse", "release-1.1.3").trim();
    // One crew session on each base. The lead's own folder stays on main, which holds only the first.
    const first = await world.addCrew({ base: { ref: "main", sha: mainSha }, baseRef: "main" });
    const second = await world.addCrew({
      base: { ref: "release-1.1.3", sha: releaseSha },
      baseRef: "release-1.1.3",
      phase: "B2",
      slug: "api",
      suffix: "2b3c4d",
    });
    const firstPlaces = places(repo);
    const secondPlaces = {
      branch: "crew/B2-api",
      worktree: join(repo, ".claude", "worktrees", "crew-B2-api"),
    };
    commitWork(firstPlaces.worktree);
    commitOtherWork(secondPlaces.worktree);
    leadMerges(repo, firstPlaces.branch);
    git(repo, "checkout", "release-1.1.3");
    git(repo, "merge", "--no-ff", "-m", "merge the crew session", secondPlaces.branch);
    git(repo, "checkout", "main");

    expect(
      await runCrew(["rm", first.id], world.ctx({}, { FAKE_WORKTREE: firstPlaces.worktree })),
    ).toBe(0);
    expect(
      await runCrew(["rm", second.id], world.ctx({}, { FAKE_WORKTREE: secondPlaces.worktree })),
    ).toBe(0);
    expect(existsSync(firstPlaces.worktree)).toBe(false);
    expect(existsSync(secondPlaces.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", firstPlaces.branch)).toBe("");
    expect(git(repo, "branch", "--list", secondPlaces.branch)).toBe("");
    expect(await readCrew(world.paths.stateDir, repo, first.id)).toMatchObject({
      state: "removed",
    });
    expect(await readCrew(world.paths.stateDir, repo, second.id)).toMatchObject({
      state: "removed",
    });
  });

  test("after the merge: stop, unlock, remove the worktree and branch, and only then claude rm", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    leadMerges(world.repo, branch);
    // Claude Code locks the worktree of a session it started, and leaves the lock behind.
    git(
      world.repo,
      "worktree",
      "lock",
      "--reason",
      "claude session crew-B1-help (pid 4242 start 99)",
      worktree,
    );

    expect(await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      "unlocked .claude/worktrees/crew-B1-help",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed C my-app B1 help",
    ]);
    // In this order. The fake `claude rm` refuses a worktree that is still there.
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["rm", "a1b2c3d4"],
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "removed",
      text: "removed",
      type: "state",
    });
  });

  test("a branch the lead squash-merged is merged too: its work is on the lead's branch", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    git(world.repo, "merge", "--squash", branch);
    git(world.repo, "commit", "-m", "the crew session's phase, squashed");

    expect(await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed C my-app B1 help",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a squash merge that missed a later commit of the crew session is refused, and nothing is touched", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    git(world.repo, "merge", "--squash", branch);
    git(world.repo, "commit", "-m", "the crew session's phase, squashed");
    // The crew session went on after the lead squashed: that work is on no other branch.
    writeFileSync(join(worktree, "more.ts"), "export const y = 2;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "more");

    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err[0]).toStartWith(`crew rm: ${branch} has `);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "branch", "--list", branch)).not.toBe("");
  });

  test("a worktree with uncommitted work is refused before anything is touched", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { worktree } = places(world.repo);
    writeFileSync(join(worktree, "notes.md"), "mine, not committed\n");

    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew rm: ${worktree} has changes that are not committed (or git cannot read it)`,
      "Fix: commit or discard them there, then run crew rm again; it never forces",
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("a lock a person took is refused before anything is touched, and left alone", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { worktree } = places(world.repo);
    git(world.repo, "worktree", "lock", "--reason", "on the backup drive", worktree);

    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help is locked (on the backup drive), and not by Claude Code",
      `Fix: release it yourself if you mean to remove the crew session: git worktree unlock ${worktree}; crew rm unlocks only Claude Code's own lock`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "worktree", "list", "--porcelain")).toContain(
      "locked on the backup drive",
    );
  });

  test("the kit's own verdict keeps what it keeps, with its own reason: a program in the worktree", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { worktree } = places(world.repo);
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({
          scanFacts: {
            ...QUIET_MACHINE,
            programs: [{ cwd: worktree, path: "/usr/bin/bun dev", pid: 9 }],
          },
        }),
      ),
    ).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help is kept: a program runs from its files: bun",
      "Fix: clear that, then run crew rm again; it never forces",
    ]);
    expect(existsSync(worktree)).toBe(true);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });

  test("D62: a finished session's own leftover program is stopped, and the worktree goes", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    // It carries the session's marker, as everything the session's Bash started does.
    const check = await startProgram(worktree, record.id);
    try {
      expect(
        await runCrew(
          ["rm", record.id],
          world.ctx({
            scanFacts: {
              ...QUIET_MACHINE,
              programs: [{ parentPid: 1, path: join(worktree, "check.sh"), pid: check.pid }],
            },
          }),
        ),
      ).toBe(0);
      expect(world.out).toContain("C my-app B1 help: stopped its own leftover programs (check.sh)");
      expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
        state: "removed",
      });
      expect(existsSync(worktree)).toBe(false);
      expect(await ended(check)).toBe(true);
    } finally {
      if (check.exitCode === null) check.kill("SIGKILL");
    }
  });

  test("D62: a program that is not the session's is never stopped, however long it has run", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    // A person's shell or dev server, started before the session's turn ended and still there:
    // it has no marker, so it is not the session's. Another crew session's has someone else's.
    const server = await startProgram(worktree, null);
    const sibling = await startProgram(worktree, "B2-other-9f8e7d");
    try {
      expect(
        await runCrew(
          ["rm", record.id],
          world.ctx({
            scanFacts: {
              ...QUIET_MACHINE,
              programs: [
                {
                  cwd: worktree,
                  path: "/usr/bin/bun dev",
                  pid: server.pid,
                  startedAt: NOW - 13 * MINUTE,
                },
                {
                  cwd: worktree,
                  path: "/usr/bin/bun test",
                  pid: sibling.pid,
                  startedAt: NOW - 13 * MINUTE,
                },
              ],
            },
          }),
        ),
      ).toBe(1);
      expect(world.err).toContain(
        "crew rm: .claude/worktrees/crew-B1-help is kept: a program runs from its files: bun",
      );
      expect(world.out.some((line) => line.includes("stopped its own leftover programs"))).toBe(
        false,
      );
      expect(existsSync(worktree)).toBe(true);
      expect(server.exitCode).toBeNull();
      expect(sibling.exitCode).toBeNull();
      expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
        state: "done",
      });
    } finally {
      server.kill("SIGKILL");
      sibling.kill("SIGKILL");
    }
  });

  test("D62: one program that is not the session's keeps all of them", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    const mine = await startProgram(worktree, record.id);
    const theirs = await startProgram(worktree, null);
    try {
      expect(
        await runCrew(
          ["rm", record.id],
          world.ctx({
            scanFacts: {
              ...QUIET_MACHINE,
              programs: [
                { parentPid: 1, path: join(worktree, "check.sh"), pid: mine.pid },
                { cwd: worktree, path: "/usr/bin/bun dev", pid: theirs.pid },
              ],
            },
          }),
        ),
      ).toBe(1);
      // Nothing is stopped when something there is somebody else's: half a stop helps nobody.
      expect(mine.exitCode).toBeNull();
      expect(theirs.exitCode).toBeNull();
    } finally {
      mine.kill("SIGKILL");
      theirs.kill("SIGKILL");
    }
  });

  test("D62: a live session's children are never stopped, marker or not", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    const check = await startProgram(worktree, record.id);
    try {
      // Agent view lists the session with a process: it is not finished, its children are its work.
      const live = JSON.stringify([
        {
          id: "a1b2c3d4",
          pid: 4242,
          sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
          state: "working",
        },
      ]);
      expect(
        await runCrew(
          ["rm", record.id],
          world.ctx(
            {
              scanFacts: {
                ...QUIET_MACHINE,
                programs: [{ parentPid: 4242, path: join(worktree, "check.sh"), pid: check.pid }],
              },
            },
            { FAKE_AGENTS_JSON: live },
          ),
        ),
      ).toBe(1);
      expect(world.err).toContain(
        "crew rm: .claude/worktrees/crew-B1-help is kept: a program runs from its files: check.sh",
      );
      expect(check.exitCode).toBeNull();
    } finally {
      check.kill("SIGKILL");
    }
  });

  describe("D62: what proves a program is the session's own", () => {
    /** The record, its worktree and the context a direct call needs, with `programs` running. */
    async function direct(programs: RunningProgram[], env: Record<string, string> = {}) {
      const world = await boardWorld();
      // Recorded an hour before NOW.
      const record = await world.addCrew({ atMs: NOW - 60 * MINUTE, state: "done" });
      const ctx = world.ctx({ scanFacts: { ...QUIET_MACHINE, programs } }, env);
      return { ctx, record, world };
    }
    const unreadable = () => null;

    test("an unreadable environment is never proof, whenever the program started", async () => {
      const worktree = tempDir("leftover-lifetime");
      const own = await startProgram(worktree, null);
      try {
        const { ctx, record } = await direct([
          { cwd: worktree, parentPid: 1, path: join(worktree, "check.sh"), pid: own.pid },
        ]);
        // The environment cannot be read (not Linux, or not this user's process). Whatever the
        // program's age or parent, it may be a person's editor or dev server: it stays.
        const stopped = await stopLeftoverProcesses({ ...record, worktree }, ctx, unreadable);
        expect(stopped.line).toBeNull();
        expect(own.exitCode).toBeNull();
      } finally {
        if (own.exitCode === null) own.kill("SIGKILL");
      }
    });

    test("a readable environment decides, even for a program that descends from the session", async () => {
      const worktree = tempDir("leftover-reused-pid");
      // A person's program that happens to sit under the session's pid (a reused pid): it carries
      // no id of this crew session, so the session's descent cannot make it the session's own.
      const stranger = await startProgram(worktree, null);
      try {
        const stopped = JSON.stringify([
          {
            id: "a1b2c3d4",
            pid: 4242,
            sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
            state: "stopped",
          },
        ]);
        const { ctx, record } = await direct(
          [
            {
              cwd: worktree,
              parentPid: 4242,
              path: join(worktree, "server.sh"),
              pid: stranger.pid,
            },
          ],
          { FAKE_AGENTS_JSON: stopped },
        );
        const result = await stopLeftoverProcesses({ ...record, worktree }, ctx);
        expect(result.line).toBeNull();
        expect(stranger.exitCode).toBeNull();
      } finally {
        stranger.kill("SIGKILL");
      }
    });

    test.skipIf(process.platform !== "linux")(
      "SIGKILL goes to the process that got the SIGTERM",
      async () => {
        const worktree = tempDir("leftover-sigkill");
        // It ignores SIGTERM, so only SIGKILL ends it.
        const stubborn = await startProgram(
          worktree,
          "B1-help-1a2b3c",
          "trap '' TERM; exec sleep 60",
        );
        try {
          const { ctx, record } = await direct([
            { cwd: worktree, parentPid: 1, path: join(worktree, "check.sh"), pid: stubborn.pid },
          ]);
          const stopped = await stopLeftoverProcesses({ ...record, worktree }, ctx);
          expect(stopped.line).toBe(
            "C my-app B1 help: stopped its own leftover programs (check.sh)",
          );
          expect(await ended(stubborn)).toBe(true);
        } finally {
          if (stubborn.exitCode === null) stubborn.kill("SIGKILL");
        }
      },
    );

    test("a pid another process took while this one was given time to end is not killed", async () => {
      const worktree = tempDir("leftover-pid-reused");
      const stubborn = await startProgram(
        worktree,
        "B1-help-1a2b3c",
        "trap '' TERM; exec sleep 60",
      );
      try {
        const { ctx, record } = await direct([
          { cwd: worktree, parentPid: 1, path: join(worktree, "check.sh"), pid: stubborn.pid },
        ]);
        // The first reading is the process that is signalled; the second, after the grace, is
        // somebody else's start time on the same pid.
        const reads = ["proc:100", "proc:200"];
        const startOf = () => reads.shift() ?? null;
        const stopped = await stopLeftoverProcesses(
          { ...record, worktree },
          ctx,
          procEnviron,
          startOf,
        );
        expect(stopped.line).toBe("C my-app B1 help: stopped its own leftover programs (check.sh)");
        expect(reads).toEqual([]);
        expect(stubborn.exitCode).toBeNull();
      } finally {
        stubborn.kill("SIGKILL");
      }
    });

    test("a start time that was never read is no licence for SIGKILL", async () => {
      const worktree = tempDir("leftover-start-unread");
      const stubborn = await startProgram(
        worktree,
        "B1-help-1a2b3c",
        "trap '' TERM; exec sleep 60",
      );
      try {
        const { ctx, record } = await direct([
          { cwd: worktree, parentPid: 1, path: join(worktree, "check.sh"), pid: stubborn.pid },
        ]);
        const stopped = await stopLeftoverProcesses(
          { ...record, worktree },
          ctx,
          procEnviron,
          () => null,
        );
        expect(stopped.line).toBe("C my-app B1 help: stopped its own leftover programs (check.sh)");
        expect(stubborn.exitCode).toBeNull();
      } finally {
        stubborn.kill("SIGKILL");
      }
    });
  });

  test.skipIf(process.platform !== "linux")(
    "D62: a program's environment is read from /proc, and a pid nobody has reads as unreadable",
    async () => {
      const child = await startProgram(tempDir("environ"), "B1-help-1a2b3c");
      try {
        expect(procEnviron(child.pid)?.CC_SMART_DEV_KIT_CREW).toBe("B1-help-1a2b3c");
        expect(procEnviron(999_999_999)).toBeNull();
      } finally {
        child.kill("SIGKILL");
      }
    },
  );

  test("a file git does not keep would be lost with the worktree, so it stays", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { worktree } = places(world.repo);
    writeFileSync(join(worktree, ".env.local"), "SECRET=1\n");
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help is kept: local files git does not keep: .env.local",
      "Fix: clear that, then run crew rm again; it never forces",
    ]);
    expect(existsSync(worktree)).toBe(true);
  });

  test("D62: a removal that stopped halfway is finished by crew rm", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    leadMerges(world.repo, branch);
    // What `removeWorktree` leaves when git could not remove the folder it moved aside.
    const parked = `${worktree}-removing-1234`;
    git(world.repo, "worktree", "move", worktree, parked);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(existsSync(parked)).toBe(false);
    expect(git(world.repo, "worktree", "list")).not.toContain("-removing-");
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("D62: crew rm also finishes a leftover folder no record names, and says so", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch } = places(world.repo);
    leadMerges(world.repo, branch);
    const stray = leftoverFolder(world.repo, "crew-ghost");
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(existsSync(stray)).toBe(false);
    expect(world.out).toContain(
      `removed ${stray} (left by a removal that stopped halfway; git no longer lists it)`,
    );
  });

  test("D62: a leftover of this crew session's own that stays refuses crew rm, with its reason", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done", worktree: false });
    const { worktree } = places(world.repo);
    const stray = leftoverFolder(world.repo, "crew-B1-help");
    // Something wrote in it after the removal moved it: not the removal's own, and not ours to delete.
    writeFileSync(join(stray, "mine.txt"), "someone's notes\n");
    expect(stray).toBe(`${worktree}-removing-${String(PARKED_AT)}`);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help-removing-1761300000000 is kept: files were written in it after the removal moved it: mine.txt",
      "Fix: clear that, then run crew rm again; it never forces",
    ]);
    expect(existsSync(join(stray, "mine.txt"))).toBe(true);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "done",
    });
  });

  test("`claude rm` fails: the store says so, the worktree is gone, and a second run finishes it", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: STILL_LISTED, FAKE_RM: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(1);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
    ]);
    expect(world.err).toEqual([
      "crew rm: claude rm a1b2c3d4 failed (exit 1): could not delete",
      "  the worktree is gone already, and so is the branch; run claude rm a1b2c3d4 by hand, then crew rm again",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      text: "the worktree is gone and so is the branch; claude rm a1b2c3d4 failed (exit 1): could not delete",
      type: "step",
    });

    // The cause is fixed: the second run has only the session and the record left.
    world.out.length = 0;
    world.err.length = 0;
    expect(await runCrew(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.out).toEqual(["removed session a1b2c3d4", "removed C my-app B1 help"]);
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["rm", "a1b2c3d4"],
      ["agents", "--json", "--all"],
      ["rm", "a1b2c3d4"],
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("`claude rm` of a session Claude Code no longer has: it was gone already, and the record goes", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);

    // `claude rm` fails ("No job matching") and agent view lists no such session.
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: "[]", FAKE_RM: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(0);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
      "session a1b2c3d4 was gone already",
      "removed C my-app B1 help",
    ]);
    expect(world.err).toEqual([]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("agent view unreadable: `claude rm`'s failure is real, never called gone", async () => {
    // `sessionUnknown` is the only thing that turns a failed `claude rm` into "gone already" —
    // the state this step wants. A view that cannot be read says nothing about the session, so
    // the failure stands and the record stays: dropping it on a guess would lose a session
    // Claude Code still holds.
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: "not json", FAKE_RM: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(1);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
    ]);
    expect(world.err).toEqual([
      "crew rm: claude rm a1b2c3d4 failed (exit 1): could not delete",
      "  the worktree is gone already, and so is the branch; run claude rm a1b2c3d4 by hand, then crew rm again",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });

  test("a branch that stays (another worktree holds it) is said, not claimed gone", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    // The worktree is already gone, but a second one has the branch checked out: git keeps it.
    git(world.repo, "worktree", "remove", "--force", worktree);
    const other = join(world.repo, ".claude", "worktrees", "other");
    git(world.repo, "worktree", "add", other, branch);
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: STILL_LISTED, FAKE_RM: "fail" }),
      ),
    ).toBe(1);
    expect(world.out[1]).toStartWith(`kept branch ${branch}: `);
    expect(world.err).toEqual([
      "crew rm: claude rm a1b2c3d4 failed (exit 1): could not delete",
      "  the worktree is gone already; run claude rm a1b2c3d4 by hand, then crew rm again",
    ]);
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)?.text).toBe(
      "the worktree is gone; claude rm a1b2c3d4 failed (exit 1): could not delete",
    );
  });

  test("a stop that fails does not block a removal the verdict clears; it is said on stderr", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: LISTED, FAKE_STOP: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(0);
    expect(world.err).toEqual([
      "note: claude stop a1b2c3d4 failed (exit 1): could not stop; going on, the check below stops the removal if anything still works in its worktree",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a worktree a person already removed: the branch and the session still go", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    git(world.repo, "worktree", "remove", "--force", worktree);
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed C my-app B1 help",
    ]);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
  });

  test("a folder git does not list is not a worktree: it is left alone, and said, never called gone", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { worktree } = places(world.repo);
    git(world.repo, "worktree", "remove", "--force", worktree);
    mkdirSync(worktree);
    // The main checkout is clean, so the folder (inside it, ignored) shows no change.
    git(world.repo, "add", "-A");
    git(world.repo, "commit", "-m", "the project's file");
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help is still there, and git does not list it as a worktree",
      "Fix: remove that folder yourself, then run crew rm again; crew rm never deletes what git does not know",
    ]);
    expect(existsSync(worktree)).toBe(true);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
  });

  test("a queued crew session has no worktree and no session: it is removed at once", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([]);
    expect(world.out).toEqual([
      "removed C my-app B2 api; it had not started, so nothing else went",
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a crew session already removed is refused", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "removed", worktree: false });
    expect(await runCrew(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual(["crew rm: C my-app B1 help is removed already"]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("F3: a removal keeps whether the lead had merged, so only a merged phase releases its dependents", async () => {
    const world = await boardWorld();
    // The lead merged this one: the watch recorded it `merged` before `crew rm` ran.
    const merged = await world.addCrew({ state: "merged" });
    expect(await runCrew(["rm", merged.id], world.ctx())).toBe(0);
    expect(await readCrew(world.paths.stateDir, world.repo, merged.id)).toMatchObject({
      mergedBeforeRemoval: true,
      state: "removed",
    });

    // A queued crew session removed before anything was built: no work of it was ever merged.
    const queued = await world.addCrew({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    expect(await runCrew(["rm", queued.id], world.ctx())).toBe(0);
    expect(await readCrew(world.paths.stateDir, world.repo, queued.id)).toMatchObject({
      mergedBeforeRemoval: false,
      state: "removed",
    });
  });

  test("F3: a refusal after the unlock locks the worktree again, with the same reason", async () => {
    const world = await boardWorld();
    const record = await world.addCrew();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    leadMerges(world.repo, branch);
    // Claude Code's own lock, as its session leaves it behind (L1a.1).
    git(
      world.repo,
      "worktree",
      "lock",
      "--reason",
      "claude session crew-B1-help (pid 4242 start 99)",
      worktree,
    );

    expect(
      await runCrew(
        ["rm", record.id],
        world.ctx({
          scanFacts: {
            ...QUIET_MACHINE,
            programs: [{ cwd: worktree, path: "/usr/bin/bun dev", pid: 9 }],
          },
        }),
      ),
    ).toBe(1);
    expect(world.err).toEqual([
      "crew rm: .claude/worktrees/crew-B1-help is kept: a program runs from its files: bun",
      "Fix: clear that, then run crew rm again; it never forces",
    ]);
    // It was unlocked to be judged, and locked again when the verdict kept it: the lock is what
    // keeps `worktrees --clean` and the background clean off the worktree.
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      "unlocked .claude/worktrees/crew-B1-help",
      "locked .claude/worktrees/crew-B1-help again, with the same reason",
    ]);
    expect(git(world.repo, "worktree", "list", "--porcelain")).toContain(
      "locked claude session crew-B1-help (pid 4242 start 99)",
    );
    expect(existsSync(worktree)).toBe(true);
  });
});

describe("crew resume", () => {
  test("resumes that ONE session in its worktree, with its own files, never a respawn", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(await runCrew(["resume", "C my-app B1 help"], world.ctx())).toBe(0);
    // One read of agent view (is a process still there?), then the resume in its worktree, with
    // the settings and MCP files `crew start` wrote for it.
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(world, record.id, "a1b2c3d4"),
    ]);
    // Never `claude respawn`: it does not re-apply `-w`, so the session would come back in the
    // main checkout (the bug of 2026-10-23).
    expect(world.claudeCalls().map((call) => call[0])).not.toContain("respawn");
    expect(world.cwdCalls()).toEqual([world.repo, places(world.repo).worktree]);
    expect(world.out).toEqual(["resumed C my-app B1 help (a1b2c3d4)"]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "working",
      text: "resumed by the lead",
    });
  });

  test("a crew session with no worktree is refused with one line: there is nowhere to bring it back", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped", worktree: false });
    expect(await runCrew(["resume", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew resume: C my-app B1 help has no worktree at ${places(world.repo).worktree} any more; remove it (${COMMAND} crew rm "C my-app B1 help")`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });

  test("a session that still has a process is not resumed: --bg --resume would start a copy", async () => {
    const world = await boardWorld();
    const working = await world.addCrew();
    const live = JSON.stringify([
      {
        cwd: places(world.repo).worktree,
        id: "a1b2c3d4",
        pid: 4242,
        sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
        state: "working",
      },
    ]);
    expect(await runCrew(["resume", working.id], world.ctx({}, { FAKE_AGENTS_JSON: live }))).toBe(
      0,
    );
    expect(world.out).toEqual([
      "C my-app B1 help is running already (a1b2c3d4); there is nothing to resume",
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
  });

  test("a crew session that ended with an outcome is resumed too; one with no process is", async () => {
    const world = await boardWorld();
    const done = await world.addCrew({ state: "done" });
    const working = await world.addCrew({
      atMs: NOW - 5 * MINUTE,
      phase: "B2",
      shortId: "b2c3d4e5",
      slug: "api",
    });
    expect(await runCrew(["resume", done.id], world.ctx())).toBe(0);
    expect(await runCrew(["resume", working.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(world, done.id, "a1b2c3d4"),
      ["agents", "--json", "--all"],
      resumeCall(world, working.id, "b2c3d4e5"),
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, done.id)).toMatchObject({
      state: "working",
    });
    // No state change, no state event.
    expect(
      readCrewEvents(world.paths.stateDir, world.repo).events.filter(
        (one) => one.crew === working.id && one.type === "state",
      ),
    ).toEqual([]);
  });

  test("a removed crew session is refused, and so is a merged one", async () => {
    const world = await boardWorld();
    await world.addCrew({ phase: "B2", slug: "gone", state: "removed", worktree: false });
    await world.addCrew({ phase: "B3", slug: "done", state: "merged", worktree: false });
    expect(await runCrew(["resume", "B2-gone-1a2b3c"], world.ctx())).toBe(1);
    expect(await runCrew(["resume", "B3-done-1a2b3c"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew resume: C my-app B2 gone is removed; there is nothing to bring back",
      "crew resume: C my-app B3 done is merged; its work belongs to the lead's branch now",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a crew session with no session has nothing to resume", async () => {
    const world = await boardWorld();
    await world.addCrew({ shortId: null, state: "queued", worktree: false });
    expect(await runCrew(["resume", "B1-help-1a2b3c"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "crew resume: C my-app B1 help has no session yet (it is queued)",
      `Fix: ${COMMAND} crew list shows when it starts`,
    ]);
  });

  test("an agent view that cannot be read refuses the resume rather than risking a copy", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(
      await runCrew(["resume", record.id], world.ctx({}, { FAKE_AGENTS_JSON: "not json" })),
    ).toBe(1);
    expect(world.err).toEqual([
      "crew resume: C my-app B1 help: agent view could not be read (claude agents --json), so it cannot say whether its session still runs; try again",
    ]);
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
  });

  test("a resume that claude refuses says so and changes nothing", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    expect(await runCrew(["resume", record.id], world.ctx({}, { FAKE_BG: "fail" }))).toBe(1);
    expect(world.err).toEqual([
      "crew resume: claude --bg --resume a1b2c3d4-0000-1111-2222-333333333333 failed (exit 4): something broke",
      `Fix: ${COMMAND} crew status "C my-app B1 help" shows its files; if it cannot come back, merge its branch and start the phase again`,
    ]);
    expect(await readCrew(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });
});

describe("D42: crew resume --paused", () => {
  /** A paused crew session of `lead`, waiting out its slot, paused `minutesAgo`. */
  function pausedChange(minutesAgo: number, change: Parameters<BoardWorld["addCrew"]>[0] = {}) {
    const since = new Date(NOW - minutesAgo * MINUTE).toISOString();
    return {
      lastPause: { backoffMs: 0, since },
      state: "paused",
      waitingFor: { kind: "slot" as const, since, slot: "cc-smart-dev-kit-worker" },
      ...change,
    };
  }

  test("every paused crew session of this lead, oldest wait first, and no other", async () => {
    const world = await boardWorld();
    const first = await world.addCrew({ atMs: NOW - 20 * MINUTE, ...pausedChange(20) });
    const second = await world.addCrew({
      atMs: NOW - 10 * MINUTE,
      phase: "B2",
      shortId: "b2c3d4e5",
      slug: "api",
      ...pausedChange(10),
    });
    // A working one, and a paused one of another lead: neither is touched.
    await world.addCrew({ atMs: NOW - 5 * MINUTE, phase: "B3", shortId: "c3d4e5f6", slug: "x" });
    await world.addCrew({
      atMs: NOW - 3 * MINUTE,
      leadSessionId: OTHER_LEAD,
      phase: "B4",
      shortId: "d4e5f6a7",
      slug: "y",
      ...pausedChange(3),
    });
    expect(await runCrew(["resume", "--paused"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(
        world,
        first.id,
        "a1b2c3d4",
        "The wait is over: worker answers again. Go on with phase B1, then hand it back as usual.",
      ),
      resumeCall(
        world,
        second.id,
        "b2c3d4e5",
        "The wait is over: worker answers again. Go on with phase B2, then hand it back as usual.",
      ),
    ]);
    // Each comes back in its own worktree, never in the main checkout.
    expect(world.cwdCalls()).toEqual([
      world.repo,
      places(world.repo).worktree,
      join(world.repo, ".claude", "worktrees", "crew-B2-api"),
    ]);
    expect(world.out).toEqual([
      "resumed C my-app B1 help (a1b2c3d4)",
      "resumed C my-app B2 api (b2c3d4e5)",
    ]);
    for (const record of [first, second]) {
      const saved = await readCrew(world.paths.stateDir, world.repo, record.id);
      expect(saved).toMatchObject({ state: "working" });
      // The wait goes with the pause: a record that kept it would look paused to a reader.
      expect(saved?.waitingFor).toBeUndefined();
    }
    expect(readCrewEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "working",
      text: "the wait is over; it was resumed",
    });
  });

  test("--lead names the lead whose paused crew sessions to resume", async () => {
    const world = await boardWorld();
    await world.addCrew({ ...pausedChange(5) });
    const other = await world.addCrew({
      atMs: NOW - 2 * MINUTE,
      leadSessionId: OTHER_LEAD,
      phase: "B4",
      shortId: "d4e5f6a7",
      slug: "y",
      ...pausedChange(2),
    });
    expect(await runCrew(["resume", "--paused", "--lead", OTHER_LEAD], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(
        world,
        other.id,
        "d4e5f6a7",
        "The wait is over: worker answers again. Go on with phase B4, then hand it back as usual.",
      ),
    ]);
    expect(world.out).toEqual(["resumed C my-app B4 y (d4e5f6a7)"]);
  });

  test("nothing paused: one line, nothing run", async () => {
    const world = await boardWorld();
    await world.addCrew();
    expect(await runCrew(["resume", "--paused"], world.ctx())).toBe(0);
    expect(world.out).toEqual(["no paused crew session of this lead"]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a paused crew session whose process lives is woken with a message, never copied", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ ...pausedChange(5) });
    const live = JSON.stringify([
      {
        cwd: places(world.repo).worktree,
        id: "a1b2c3d4",
        pid: 4242,
        sessionId: "a1b2c3d4-0000-1111-2222-333333333333",
        state: "working",
      },
    ]);
    expect(await runCrew(["resume", "--paused"], world.ctx({}, { FAKE_AGENTS_JSON: live }))).toBe(
      0,
    );
    expect(world.out).toEqual([
      'SendMessage {"to":"C my-app B1 help","message":"The wait is over: worker answers again. Go on with phase B1, then hand it back as usual."}',
      "C my-app B1 help is running (a1b2c3d4): send the message above",
    ]);
    // `claude --bg --resume` on a running session would start a copy beside it.
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toEqual([]);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("working");
  });

  test("a resume that claude refuses is named, the others still go, and the exit code says so", async () => {
    const world = await boardWorld();
    await world.addCrew({ ...pausedChange(20) });
    await world.addCrew({
      atMs: NOW - 10 * MINUTE,
      phase: "B2",
      shortId: "b2c3d4e5",
      slug: "api",
      ...pausedChange(10),
    });
    expect(await runCrew(["resume", "--paused"], world.ctx({}, { FAKE_BG: "fail" }))).toBe(1);
    expect(world.out).toEqual([
      "C my-app B1 help: not resumed — claude --bg --resume a1b2c3d4-0000-1111-2222-333333333333 failed (exit 4): something broke",
      "C my-app B2 api: not resumed — claude --bg --resume b2c3d4e5-0000-1111-2222-333333333333 failed (exit 4): something broke",
    ]);
    // Each stayed paused, so the next run tries again.
    expect(listCrew(world.paths.stateDir, world.repo).records.map((one) => one.state)).toEqual([
      "paused",
      "paused",
    ]);
  });

  test("a resume the store could not record is named, and the exit code says so", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ ...pausedChange(5) });
    // The store's record folder gone read-only: the session comes back, its record cannot be written.
    const recordsDir = join(world.paths.stateDir, "crew", repoKey(world.repo), "crew");
    chmodSync(recordsDir, 0o500);
    let code: number;
    try {
      code = await runCrew(["resume", "--paused"], world.ctx());
    } finally {
      chmodSync(recordsDir, 0o700);
    }
    expect(code).toBe(1);
    expect(world.out).toHaveLength(1);
    expect(world.out[0]).toStartWith(
      "C my-app B1 help: resumed, but the store could not record it:",
    );
    expect(world.claudeCalls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    expect(readCrew(world.paths.stateDir, world.repo, record.id)?.state).toBe("paused");
  });

  test("a paused crew session with no worktree is named, the others still go, and the exit code says so", async () => {
    const world = await boardWorld();
    const gone = await world.addCrew({ ...pausedChange(20), worktree: false });
    const here = await world.addCrew({
      atMs: NOW - 10 * MINUTE,
      phase: "B2",
      shortId: "b2c3d4e5",
      slug: "api",
      ...pausedChange(10),
    });
    expect(await runCrew(["resume", "--paused"], world.ctx())).toBe(1);
    expect(world.out).toEqual([
      `C my-app B1 help: not resumed — C my-app B1 help has no worktree at ${places(world.repo).worktree} any more`,
      "resumed C my-app B2 api (b2c3d4e5)",
    ]);
    expect(world.claudeCalls()).toEqual([
      ["agents", "--json", "--all"],
      resumeCall(
        world,
        here.id,
        "b2c3d4e5",
        "The wait is over: worker answers again. Go on with phase B2, then hand it back as usual.",
      ),
    ]);
    expect(readCrew(world.paths.stateDir, world.repo, gone.id)?.state).toBe("paused");
    expect(readCrew(world.paths.stateDir, world.repo, here.id)?.state).toBe("working");
  });

  test("a crew session's own session never resumes every paused one", async () => {
    const world = await boardWorld();
    await world.addCrew({ ...pausedChange(5) });
    expect(
      await runCrew(
        ["resume", "--paused"],
        world.ctx({}, { CC_SMART_DEV_KIT_CREW: "B2-api-aaaaaa" }),
      ),
    ).toBe(1);
    expect(world.err[0]).toBe(
      "crew resume: this session is the crew session B2-api-aaaaaa, and a crew session never stops, removes or resumes crew sessions",
    );
    expect(world.claudeCalls()).toEqual([]);
  });
});

describe("crew resume's arguments", () => {
  test("one crew session, or --paused for all of them of one lead", () => {
    expect(parseResumeArgs(["C my-app B1 help"])).toEqual({ ref: "C my-app B1 help" });
    expect(parseResumeArgs(["--paused"])).toEqual({ all: true, lead: null });
    expect(parseResumeArgs(["--paused", "--lead", "s-1"])).toEqual({ all: true, lead: "s-1" });
  });

  test("the mistakes: neither a name nor --paused, both, and --lead alone", () => {
    expect(parseResumeArgs([])).toEqual({
      error: "Say which crew session: crew resume <name|id>, or --paused for every paused one",
    });
    expect(parseResumeArgs(["x", "--paused"])).toEqual({
      error: "crew resume --paused takes no crew session: name one, or --paused for all of them",
    });
    expect(parseResumeArgs(["--lead", "s-1"])).toEqual({
      error: "--lead is for --paused: name that crew session, or resume every paused one",
    });
    expect(parseResumeArgs(["a", "b"])).toEqual({
      error: "Unknown argument: b (put a name with spaces in quotes)",
    });
  });
});
