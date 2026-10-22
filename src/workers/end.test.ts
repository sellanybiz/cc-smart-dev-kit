/**
 * The end of a worker: `worker stop`, `worker rm` and `worker resume`. A real git repo with a
 * real worktree and branch, the store in a temp state folder, a fake `claude` on PATH that
 * refuses `rm` while the worktree is still there — as the real one does (proved live, L1a.1) —
 * and the machine's facts given (`src/testing/board-world.ts`). No real Claude session runs.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { boardWorld, MINUTE, NOW, QUIET_MACHINE } from "../testing/board-world";
import { git } from "../testing/temp";
import { runWorker } from "./command";
import { readWorker, readWorkerEvents, writeLead } from "./store";

/** The session `claude agents` lists, so a failed stop is a real failure and not a gone session. */
const LISTED = JSON.stringify([
  { id: "a1b2c3d4", sessionId: "a1b2c3d4-0000-1111-2222-333333333333" },
]);

/** The worker B1 "help"'s branch and worktree, as `boardWorld().addWorker` makes them. */
function places(repo: string) {
  return {
    branch: "wk/B1-help",
    worktree: join(repo, ".claude", "worktrees", "wk-B1-help"),
  };
}

/** One commit of the worker's own, in its worktree. */
function commitWork(worktree: string): void {
  writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "work");
}

/** The lead merges the worker's branch into its own, as D24 has it. */
function leadMerges(repo: string, branch: string): void {
  git(repo, "merge", "--no-ff", "-m", "merge the worker", branch);
}

describe("worker stop", () => {
  test("stops that one session, keeps the conversation, and the store says stopped", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    expect(await runWorker(["stop", "W my-app B1 help"], world.ctx())).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
    expect(world.out).toEqual([
      "stopped W my-app B1 help (a1b2c3d4); the conversation is kept, and `claude attach a1b2c3d4` opens it again",
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "stopped",
      text: "stopped by the lead",
      type: "state",
    });
  });

  test("a worker that ended with an outcome keeps it: only its process is stopped", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({ state: "done" });
    expect(await runWorker(["stop", record.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
    expect(world.out).toEqual([
      "stopped W my-app B1 help (a1b2c3d4); the conversation is kept, and `claude attach a1b2c3d4` opens it again; it stays done",
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "done",
    });
  });

  test("a session Claude Code no longer lists is stopped all the same, and the line says so", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    expect(await runWorker(["stop", record.id], world.ctx({}, { FAKE_STOP: "gone" }))).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["agents", "--json", "--all"],
    ]);
    expect(world.out).toEqual([
      "stopped W my-app B1 help (a1b2c3d4); its session was gone already",
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)?.text).toBe(
      "its session was gone already",
    );
  });

  test("a stop that really fails (the session is listed) says so and changes nothing", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    expect(
      await runWorker(
        ["stop", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: LISTED, FAKE_STOP: "fail" }),
      ),
    ).toBe(1);
    expect(world.err).toEqual([
      "worker stop: claude stop a1b2c3d4 failed (exit 1): could not stop",
      `Fix: claude stop a1b2c3d4 by hand, or ${COMMAND} worker list to see it`,
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("a stopped worker is not stopped twice", async () => {
    const world = await boardWorld();
    await world.addWorker({ state: "stopped" });
    expect(await runWorker(["stop", "B1-help-1a2b3c"], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "W my-app B1 help is stopped already; `claude attach a1b2c3d4` opens it again",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a worker with no session, one already removed, a name nobody has", async () => {
    const world = await boardWorld();
    await world.addWorker({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    await world.addWorker({ phase: "B3", slug: "gone", state: "removed", worktree: false });
    expect(await runWorker(["stop", "B2-api-1a2b3c"], world.ctx())).toBe(1);
    expect(await runWorker(["stop", "B3-gone-1a2b3c"], world.ctx())).toBe(1);
    expect(await runWorker(["stop", "W my-app B9 nope"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker stop: W my-app B2 api has no session yet (it is queued)",
      `Fix: ${COMMAND} worker list shows when it starts`,
      "worker stop: W my-app B3 gone is removed; it has no session left",
      'worker stop: no worker of this repository is "W my-app B9 nope"',
      `Fix: ${COMMAND} worker list shows them, and --all those of every repository`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a name that matches two workers stops neither", async () => {
    const world = await boardWorld();
    await world.addWorker({ atMs: NOW - 30 * MINUTE, state: "removed", suffix: "aaaaaa" });
    await world.addWorker({
      atMs: NOW - 20 * MINUTE,
      slug: "again",
      name: "W my-app B1 help",
      suffix: "bbbbbb",
    });
    expect(await runWorker(["stop", "W my-app B1 help"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      'worker stop: "W my-app B1 help" is two workers',
      "  B1-help-aaaaaa  W my-app B1 help  removed",
      "  B1-again-bbbbbb  W my-app B1 help  working",
      "Fix: name one by its id",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a worker's own session never stops, removes or resumes a worker", async () => {
    const world = await boardWorld();
    await world.addWorker();
    const asWorker = { CC_SMART_DEV_KIT_WORKER: "B2-api-aaaaaa" };
    for (const command of ["stop", "rm", "resume"]) {
      expect(await runWorker([command, "B1-help-1a2b3c"], world.ctx({}, asWorker))).toBe(1);
    }
    expect(world.err.filter((line) => line.startsWith("worker "))).toEqual([
      "worker stop: this session is the worker B2-api-aaaaaa, and a worker never stops, removes or resumes workers",
      "worker rm: this session is the worker B2-api-aaaaaa, and a worker never stops, removes or resumes workers",
      "worker resume: this session is the worker B2-api-aaaaaa, and a worker never stops, removes or resumes workers",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });
});

describe("worker rm: the lead must have merged the branch (D24)", () => {
  test("before the merge it is refused, with the count and where the lead merges; nothing is touched", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    // Uncommitted work too: the merge is what is asked first.
    writeFileSync(join(worktree, "notes.md"), "mine\n");

    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `worker rm: ${branch} has 1 commit that main does not have`,
      `Fix: the lead merges it first (git merge ${branch}, in ${world.repo}), then run worker rm again`,
    ]);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "branch", "--list", branch)).not.toBe("");
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("the lead's own folder is the branch it merges into, wherever the main checkout is", async () => {
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
    const record = await world.addWorker({ leadSessionId: "f00dfeed-0000-1111-2222-333333333333" });
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    // Merged into the main checkout's branch: the lead's folder is on another branch.
    leadMerges(world.repo, branch);

    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `worker rm: ${branch} has 1 commit that lead-work does not have`,
      `Fix: the lead merges it first (git merge ${branch}, in ${leadFolder}), then run worker rm again`,
    ]);
  });

  test("a lead whose folder is gone: the ref the worker was cut from stands in", async () => {
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
    const record = await world.addWorker({ leadSessionId: "dead0000-0000-1111-2222-333333333333" });
    commitWork(places(world.repo).worktree);
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker rm: wk/B1-help has 1 commit that main does not have",
      `Fix: the lead merges it first (git merge wk/B1-help, in ${world.repo}), then run worker rm again`,
    ]);
  });

  test("after the merge: stop, unlock, remove the worktree and branch, and only then claude rm", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    leadMerges(world.repo, branch);
    // Claude Code locks the worktree of a session it started, and leaves the lock behind.
    git(
      world.repo,
      "worktree",
      "lock",
      "--reason",
      "claude session wk-B1-help (pid 4242 start 99)",
      worktree,
    );

    expect(await runWorker(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      "unlocked .claude/worktrees/wk-B1-help",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed W my-app B1 help",
    ]);
    // In this order. The fake `claude rm` refuses a worktree that is still there.
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["rm", "a1b2c3d4"],
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "removed",
      text: "removed",
      type: "state",
    });
  });

  test("a branch the lead squash-merged is merged too: its work is on the lead's branch", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    git(world.repo, "merge", "--squash", branch);
    git(world.repo, "commit", "-m", "the worker's phase, squashed");

    expect(await runWorker(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.err).toEqual([]);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed W my-app B1 help",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a squash merge that missed a later commit of the worker is refused, and nothing is touched", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    commitWork(worktree);
    git(world.repo, "merge", "--squash", branch);
    git(world.repo, "commit", "-m", "the worker's phase, squashed");
    // The worker went on after the lead squashed: that work is on no other branch.
    writeFileSync(join(worktree, "more.ts"), "export const y = 2;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "more");

    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err[0]).toStartWith(`worker rm: ${branch} has `);
    expect(world.out).toEqual([]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "branch", "--list", branch)).not.toBe("");
  });

  test("a worktree with uncommitted work is refused before anything is touched", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { worktree } = places(world.repo);
    writeFileSync(join(worktree, "notes.md"), "mine, not committed\n");

    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `worker rm: ${worktree} has changes that are not committed (or git cannot read it)`,
      "Fix: commit or discard them there, then run worker rm again; it never forces",
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
  });

  test("a lock a person took is refused before anything is touched, and left alone", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { worktree } = places(world.repo);
    git(world.repo, "worktree", "lock", "--reason", "on the backup drive", worktree);

    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker rm: .claude/worktrees/wk-B1-help is locked (on the backup drive), and not by Claude Code",
      `Fix: release it yourself if you mean to remove the worker: git worktree unlock ${worktree}; worker rm unlocks only Claude Code's own lock`,
    ]);
    expect(world.claudeCalls()).toEqual([]);
    expect(existsSync(worktree)).toBe(true);
    expect(git(world.repo, "worktree", "list", "--porcelain")).toContain(
      "locked on the backup drive",
    );
  });

  test("the kit's own verdict keeps what it keeps, with its own reason: a program in the worktree", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { worktree } = places(world.repo);
    expect(
      await runWorker(
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
      "worker rm: .claude/worktrees/wk-B1-help is kept: a program runs from its files: bun",
      "Fix: clear that, then run worker rm again; it never forces",
    ]);
    expect(existsSync(worktree)).toBe(true);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });

  test("a file git does not keep would be lost with the worktree, so it stays", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { worktree } = places(world.repo);
    writeFileSync(join(worktree, ".env.local"), "SECRET=1\n");
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker rm: .claude/worktrees/wk-B1-help is kept: local files git does not keep: .env.local",
      "Fix: clear that, then run worker rm again; it never forces",
    ]);
    expect(existsSync(worktree)).toBe(true);
  });

  test("`claude rm` fails: the store says so, the worktree is gone, and a second run finishes it", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);

    expect(
      await runWorker(
        ["rm", record.id],
        world.ctx({}, { FAKE_RM: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(1);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `removed ${worktree}`,
      `deleted branch ${branch}`,
    ]);
    expect(world.err).toEqual([
      "worker rm: claude rm a1b2c3d4 failed (exit 1): could not delete",
      "  the worktree is gone already, and so is the branch; run claude rm a1b2c3d4 by hand, then worker rm again",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      text: "the worktree is gone and so is the branch; claude rm a1b2c3d4 failed (exit 1): could not delete",
      type: "step",
    });

    // The cause is fixed: the second run has only the session and the record left.
    world.out.length = 0;
    world.err.length = 0;
    expect(await runWorker(["rm", record.id], world.ctx({}, { FAKE_WORKTREE: worktree }))).toBe(0);
    expect(world.out).toEqual(["removed session a1b2c3d4", "removed W my-app B1 help"]);
    expect(world.claudeCalls()).toEqual([
      ["stop", "a1b2c3d4"],
      ["rm", "a1b2c3d4"],
      ["rm", "a1b2c3d4"],
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a branch that stays (another worktree holds it) is said, not claimed gone", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    // The worktree is already gone, but a second one has the branch checked out: git keeps it.
    git(world.repo, "worktree", "remove", "--force", worktree);
    const other = join(world.repo, ".claude", "worktrees", "other");
    git(world.repo, "worktree", "add", other, branch);
    expect(await runWorker(["rm", record.id], world.ctx({}, { FAKE_RM: "fail" }))).toBe(1);
    expect(world.out[1]).toStartWith(`kept branch ${branch}: `);
    expect(world.err).toEqual([
      "worker rm: claude rm a1b2c3d4 failed (exit 1): could not delete",
      "  the worktree is gone already; run claude rm a1b2c3d4 by hand, then worker rm again",
    ]);
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)?.text).toBe(
      "the worktree is gone; claude rm a1b2c3d4 failed (exit 1): could not delete",
    );
  });

  test("a stop that fails does not block a removal the verdict clears; it is said on stderr", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({ state: "done" });
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    expect(
      await runWorker(
        ["rm", record.id],
        world.ctx({}, { FAKE_AGENTS_JSON: LISTED, FAKE_STOP: "fail", FAKE_WORKTREE: worktree }),
      ),
    ).toBe(0);
    expect(world.err).toEqual([
      "note: claude stop a1b2c3d4 failed (exit 1): could not stop; going on, the check below stops the removal if anything still works in its worktree",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a worktree a person already removed: the branch and the session still go", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { branch, worktree } = places(world.repo);
    leadMerges(world.repo, branch);
    git(world.repo, "worktree", "remove", "--force", worktree);
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(0);
    expect(world.out).toEqual([
      "stopped session a1b2c3d4",
      `deleted branch ${branch}`,
      "removed session a1b2c3d4",
      "removed W my-app B1 help",
    ]);
    expect(git(world.repo, "branch", "--list", branch)).toBe("");
  });

  test("a folder git does not list is not a worktree: it is left alone, and said, never called gone", async () => {
    const world = await boardWorld();
    const record = await world.addWorker();
    const { worktree } = places(world.repo);
    git(world.repo, "worktree", "remove", "--force", worktree);
    mkdirSync(worktree);
    // The main checkout is clean, so the folder (inside it, ignored) shows no change.
    git(world.repo, "add", "-A");
    git(world.repo, "commit", "-m", "the project's file");
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker rm: .claude/worktrees/wk-B1-help is still there, and git does not list it as a worktree",
      "Fix: remove that folder yourself, then run worker rm again; worker rm never deletes what git does not know",
    ]);
    expect(existsSync(worktree)).toBe(true);
    expect(world.claudeCalls()).toEqual([["stop", "a1b2c3d4"]]);
  });

  test("a queued worker has no worktree and no session: it is removed at once", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({
      phase: "B2",
      shortId: null,
      slug: "api",
      state: "queued",
      worktree: false,
    });
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([]);
    expect(world.out).toEqual([
      "removed W my-app B2 api; it had not started, so nothing else went",
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "removed",
    });
  });

  test("a worker already removed is refused", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({ state: "removed", worktree: false });
    expect(await runWorker(["rm", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual(["worker rm: W my-app B1 help is removed already"]);
    expect(world.claudeCalls()).toEqual([]);
  });
});

describe("worker resume", () => {
  test("respawns that ONE session, never --all, and the store says working again", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({ state: "stopped" });
    expect(await runWorker(["resume", "W my-app B1 help"], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([["respawn", "a1b2c3d4"]]);
    expect(world.claudeCalls().flat()).not.toContain("--all");
    expect(world.out).toEqual(["resumed W my-app B1 help (a1b2c3d4)"]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "working",
    });
    expect(readWorkerEvents(world.paths.stateDir, world.repo).events.at(-1)).toMatchObject({
      state: "working",
      text: "resumed by the lead",
    });
  });

  test("a worker that ended with an outcome can be resumed too; one that works is only respawned", async () => {
    const world = await boardWorld();
    const done = await world.addWorker({ state: "done" });
    const working = await world.addWorker({
      atMs: NOW - 5 * MINUTE,
      phase: "B2",
      shortId: "b2c3d4e5",
      slug: "api",
    });
    expect(await runWorker(["resume", done.id], world.ctx())).toBe(0);
    expect(await runWorker(["resume", working.id], world.ctx())).toBe(0);
    expect(world.claudeCalls()).toEqual([
      ["respawn", "a1b2c3d4"],
      ["respawn", "b2c3d4e5"],
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, done.id)).toMatchObject({
      state: "working",
    });
    // No state change, no state event.
    expect(
      readWorkerEvents(world.paths.stateDir, world.repo).events.filter(
        (one) => one.worker === working.id && one.type === "state",
      ),
    ).toEqual([]);
  });

  test("a removed worker is refused, and so is a merged one", async () => {
    const world = await boardWorld();
    await world.addWorker({ phase: "B2", slug: "gone", state: "removed", worktree: false });
    await world.addWorker({ phase: "B3", slug: "done", state: "merged", worktree: false });
    expect(await runWorker(["resume", "B2-gone-1a2b3c"], world.ctx())).toBe(1);
    expect(await runWorker(["resume", "B3-done-1a2b3c"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker resume: W my-app B2 gone is removed; there is nothing to bring back",
      "worker resume: W my-app B3 done is merged; its work belongs to the lead's branch now",
    ]);
    expect(world.claudeCalls()).toEqual([]);
  });

  test("a worker with no session has nothing to resume", async () => {
    const world = await boardWorld();
    await world.addWorker({ shortId: null, state: "queued", worktree: false });
    expect(await runWorker(["resume", "B1-help-1a2b3c"], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      "worker resume: W my-app B1 help has no session yet (it is queued)",
      `Fix: ${COMMAND} worker list shows when it starts`,
    ]);
  });

  test("a respawn that fails says so and changes nothing", async () => {
    const world = await boardWorld();
    const record = await world.addWorker({ state: "stopped" });
    expect(await runWorker(["resume", record.id], world.ctx({}, { FAKE_RESPAWN: "fail" }))).toBe(1);
    expect(world.err).toEqual([
      "worker resume: claude respawn a1b2c3d4 failed (exit 1): could not respawn",
      `Fix: claude respawn a1b2c3d4 by hand, or ${COMMAND} worker list to see it`,
    ]);
    expect(await readWorker(world.paths.stateDir, world.repo, record.id)).toMatchObject({
      state: "stopped",
    });
  });
});
