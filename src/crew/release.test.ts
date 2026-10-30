import { expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runSessions, type SessionsDeps } from "../sessions/command";
import { releasableCrewSessions } from "../sessions/finished";
import { withLock } from "../setup/lock";
import { type BoardWorld, boardWorld, NOW } from "../testing/board-world";
import { LEAD_SESSION, SHORT_ID } from "../testing/crew-world";
import { git } from "../testing/temp";
import { resolveWorkflow } from "../workflow/resolve";
import { resumeSession } from "./answer";
import { crewArchiveDir, DAY_MS, sweepCrewConversations } from "./archive";
import { boardLines } from "./board";
import { releaseCrewSession, restoreReleasedWorktree } from "./release";
import { crewRemovalLockDir, runCrewRm } from "./remove";
import {
  type CrewRecord,
  crewFile,
  eventsEndOffset,
  readCrew,
  updateCrew,
  type WatchState,
} from "./store";
import { transcriptFile } from "./transcript";
import { watchPass } from "./watch";

/** The record as the store holds it now; a test fails here when it is gone. */
function stored(world: BoardWorld, record: CrewRecord): CrewRecord {
  const found = readCrew(world.paths.stateDir, world.repo, record.id);
  if (found === null) throw new Error(`${record.id} is not in the store`);
  return found;
}

/** One commit on the crew session's branch, made in its worktree. */
function commitIn(record: CrewRecord, name: string): void {
  writeFileSync(join(record.worktree, name), "kept\n");
  git(record.worktree, "add", name);
  git(record.worktree, "commit", "-qm", name);
}

/** The watch of the world's lead, from the end of the events so far. */
function watchOf(world: BoardWorld) {
  const scope = {
    leadSessionId: LEAD_SESSION,
    mergeInto: world.repo,
    repo: world.repo,
    resolved: resolveWorkflow(world.paths, null),
  };
  const state: WatchState = {
    offset: eventsEndOffset(world.paths.stateDir, world.repo),
    said: {},
    parkedAt: Date.now(),
    removals: {},
  };
  return { scope, state };
}

/** Agent view with the world's crew session in it, in `state`. */
function agentsWith(state: string): { FAKE_AGENTS_JSON: string } {
  return {
    FAKE_AGENTS_JSON: JSON.stringify([
      {
        id: SHORT_ID,
        sessionId: `${SHORT_ID}-0000-1111-2222-333333333333`,
        cwd: "/w",
        kind: "background",
        state,
        status: "idle",
        pid: 4242,
      },
    ]),
  };
}

test("release keeps unmerged commits and state, removes the worktree and every session", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  commitIn(record, "result");
  expect(await releaseCrewSession(record, world.ctx())).toEqual({ ok: true });
  expect(existsSync(record.worktree)).toBe(false);
  expect(git(world.repo, "show", `${record.branch}:result`).trim()).toBe("kept");
  const after = stored(world, record);
  expect(after.state).toBe("done");
  expect(after.released?.at).toBe("2026-10-21T10:00:00.000Z");
  expect(after.sessionEndedAt).toBe("2026-10-21T10:00:00.000Z");
  expect(world.claudeVerbs()).toContain("rm");
});

test("dirty work refuses without changing the store or stopping a session", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  writeFileSync(join(record.worktree, "uncommitted"), "keep");
  const result = await releaseCrewSession(record, world.ctx());
  expect(result.ok).toBe(false);
  expect(existsSync(join(record.worktree, "uncommitted"))).toBe(true);
  expect(stored(world, record)).toEqual(record);
  expect(world.claudeVerbs()).not.toContain("stop");
  expect(world.claudeVerbs()).not.toContain("rm");
});

test("restore makes the same worktree on the kept branch", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  commitIn(record, "result");
  await releaseCrewSession(record, world.ctx());
  expect(await restoreReleasedWorktree(stored(world, record), world.ctx())).toEqual({
    ok: true,
    remade: true,
  });
  expect(git(record.worktree, "branch", "--show-current").trim()).toBe(record.branch);
  expect(existsSync(join(record.worktree, "result"))).toBe(true);
  expect(stored(world, record).released).toBeUndefined();
});

test("a restore that cannot write the store takes its worktree back; the next one works", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  await releaseCrewSession(record, world.ctx());
  const released = stored(world, record);
  const folder = dirname(crewFile(world.paths.stateDir, world.repo, record.id));
  chmodSync(folder, 0o555);
  try {
    const result = await restoreReleasedWorktree(released, world.ctx());
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.why).toContain("the worktree was taken back");
  } finally {
    chmodSync(folder, 0o755);
  }
  expect(existsSync(record.worktree)).toBe(false);
  expect(stored(world, record).released).toEqual(released.released);
  expect(await restoreReleasedWorktree(released, world.ctx())).toEqual({ ok: true, remade: true });
  expect(existsSync(record.worktree)).toBe(true);
});

test("a restore waits for no release: it refuses while one holds the lock, then reads the record again", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  await releaseCrewSession(record, world.ctx());
  const released = stored(world, record);
  const lock = crewRemovalLockDir(world.paths.stateDir, world.repo, record.id);
  const busy = await withLock(lock, () => restoreReleasedWorktree(released, world.ctx()));
  expect(busy).toEqual({
    ok: false,
    why: `${record.name} is being released or removed right now; try again in a moment`,
  });
  expect(existsSync(record.worktree)).toBe(false);
  // A caller's old copy says released; the store, read under the lock, decides.
  expect(await restoreReleasedWorktree(released, world.ctx())).toEqual({ ok: true, remade: true });
  expect(await restoreReleasedWorktree(released, world.ctx())).toEqual({ ok: true, remade: false });
});

test("a folder already at a released worktree's path is never replaced", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  await releaseCrewSession(record, world.ctx());
  git(world.repo, "worktree", "add", "-q", "--detach", record.worktree, "HEAD");
  const result = await restoreReleasedWorktree(stored(world, record), world.ctx());
  expect(result).toEqual({
    ok: false,
    why: `${record.worktree} exists already; inspect it before resuming`,
  });
  expect(stored(world, record).released).toBeDefined();
});

test("a released record stays on the board, resumes, and a later rm deletes its branch", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  await releaseCrewSession(record, world.ctx());
  const released = stored(world, record);
  expect(
    boardLines(released, [], { held: null, home: world.home, now: Date.now(), showRepo: false }),
  ).toContain(`  released — branch ${record.branch} kept`);
  expect((await resumeSession(world.ctx(), released, "continue")).ok).toBe(true);
  expect(existsSync(record.worktree)).toBe(true);
  // The resumed session is told its folder is new, and to install what it needs first.
  const resumed = world.claudeCalls().find((call) => call[0] === "--bg");
  // The fake logs one line per line of an argument, so the prompt is read back joined.
  expect(resumed?.join("\n")).toContain(
    "Your worktree was made again on your kept branch. Install its dependencies before running anything.\ncontinue",
  );
  await updateCrew(world.paths.stateDir, world.repo, record.id, { state: "done" }, Date.now());
  expect(await releaseCrewSession(stored(world, record), world.ctx())).toEqual({ ok: true });
  expect(await runCrewRm(record.id, world.ctx())).toBe(0);
  expect(stored(world, record).state).toBe("removed");
  expect(git(world.repo, "branch", "--list", record.branch).trim()).toBe("");
});

test("release removes earlier agent rows as well as its current row", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  const earlier = { sessionId: "bbbbbbbb-1111-2222-3333-444444444444", shortId: "bbbbbbbb" };
  const withEarlier = await updateCrew(
    world.paths.stateDir,
    world.repo,
    record.id,
    { earlierSessions: [earlier] },
    Date.now(),
  );
  expect(await releaseCrewSession(withEarlier, world.ctx())).toEqual({ ok: true });
  expect(world.claudeCalls().filter((call) => call[0] === "rm")).toEqual([
    ["rm", SHORT_ID],
    ["rm", "bbbbbbbb"],
  ]);
});

test("ignored personal files refuse without stopping or writing", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  writeFileSync(join(record.worktree, ".gitignore"), "private.txt\n");
  git(record.worktree, "add", ".gitignore");
  git(record.worktree, "commit", "-qm", "ignore private file");
  writeFileSync(join(record.worktree, "private.txt"), "keep this");
  expect(await releaseCrewSession(record, world.ctx())).toEqual({
    ok: false,
    why: "local files git does not keep: private.txt",
  });
  expect(world.claudeCalls()).toEqual([["agents", "--json", "--all"]]);
  expect(stored(world, record)).toEqual(record);
});

test("a person's lock refuses before stopping anything", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  git(world.repo, "worktree", "lock", "--reason", "keep this work", record.worktree);
  expect((await releaseCrewSession(record, world.ctx())).ok).toBe(false);
  expect(world.claudeVerbs()).toEqual([]);
  expect(stored(world, record)).toEqual(record);
});

test("blocked sessions are not released: D35 keeps the running question until an idle stop", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "blocked" });
  expect((await releaseCrewSession(record, world.ctx())).ok).toBe(false);
  expect(existsSync(record.worktree)).toBe(true);
});

test("D69: the watch releases an over session with no process at once", async () => {
  for (const state of ["done", "handoff", "failed", "stopped"]) {
    const world = await boardWorld();
    const record = await world.addCrew({ state });
    commitIn(record, "result");
    const { scope, state: watch } = watchOf(world);
    await watchPass(watch, world.ctx(), scope);
    expect(existsSync(record.worktree)).toBe(false);
    expect(stored(world, record).released).toBeDefined();
    expect(git(world.repo, "show", `${record.branch}:result`).trim()).toBe("kept");
    expect(world.out).toEqual([
      `C my-app B1 help: released: worktree and agent-view rows removed; branch ${record.branch} kept`,
    ]);
  }
});

test("D69: a done session still in agent view is stopped first, then released", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  const { scope, state } = watchOf(world);
  const first = await watchPass(state, world.ctx({}, agentsWith("done")), scope);
  expect(world.claudeVerbs()).toEqual(["agents", "stop"]);
  expect(existsSync(record.worktree)).toBe(true);
  await watchPass(first.state, world.ctx({}, agentsWith("stopped")), scope);
  expect(existsSync(record.worktree)).toBe(false);
  expect(world.claudeVerbs()).toContain("rm");
});

test("D69: an agent view that cannot be read releases nothing", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  const { scope, state } = watchOf(world);
  await watchPass(state, world.ctx({}, { FAKE_AGENTS_JSON: "{" }), scope);
  expect(existsSync(record.worktree)).toBe(true);
  expect(stored(world, record).released).toBeUndefined();
});

test("D69: a refusal is said once with its fix, and tried again when the folder changes", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  writeFileSync(join(record.worktree, "dirty"), "keep");
  const { scope, state } = watchOf(world);
  const first = await watchPass(state, world.ctx(), scope);
  const kept = world.out.filter((line) => line.includes("its worktree stays"));
  expect(kept).toHaveLength(1);
  expect(kept[0]).toContain(`Fix: commit what it names on ${record.branch}`);
  const second = await watchPass(first.state, world.ctx(), scope);
  expect(world.out.filter((line) => line.includes("its worktree stays"))).toHaveLength(1);
  git(record.worktree, "add", "dirty");
  git(record.worktree, "commit", "-qm", "dirty");
  await watchPass(second.state, world.ctx(), scope);
  expect(existsSync(record.worktree)).toBe(false);
});

test("an unknown lead is kept until absence has been observed for a day", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  const ctx = world.ctx();
  expect(await releasableCrewSessions(ctx)).toEqual([]);
  expect(
    (await releasableCrewSessions({ ...ctx, now: () => ctx.now() + 86_400_001 })).map(
      (one) => one.id,
    ),
  ).toEqual([record.id]);
});

test("D69: sessions --finished --remove releases a gone lead's finished crew session", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  commitIn(record, "result");
  const day = 86_400_001;
  const out: string[] = [];
  const deps = (at: number): SessionsDeps => ({
    agents: () => [],
    command: "kit",
    crew: { ...world.ctx(), now: () => at },
    now: at,
    platform: "linux",
    runClaude: () => 0,
    sleep: async () => {},
    spawnDetached: () => {
      throw new Error("must not open a terminal");
    },
    uptimeSeconds: 1,
    which: () => null,
  });
  const run = async (at: number) => {
    const log = spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")));
    const stdout = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk).trimEnd());
      return true;
    });
    try {
      return await runSessions(
        world.paths,
        { dryRun: false, finished: true, open: false, remove: true, yes: true },
        deps(at),
        world.repo,
      );
    } finally {
      log.mockRestore();
      stdout.mockRestore();
    }
  };
  // The first look only notes that the lead is gone: a lead away for less than a day is kept.
  expect(await run(NOW)).toBe(0);
  expect(existsSync(record.worktree)).toBe(true);
  expect(await run(NOW + day)).toBe(0);
  expect(out.join("\n")).toContain("Finished crew sessions whose lead is gone");
  expect(out.join("\n")).toContain(
    `${record.name} — release worktree and agent-view rows; keep branch ${record.branch}`,
  );
  expect(existsSync(record.worktree)).toBe(false);
  expect(stored(world, record).released).toBeDefined();
  expect(git(world.repo, "show", `${record.branch}:result`).trim()).toBe("kept");
  expect(world.claudeCalls()).toContainEqual(["rm", SHORT_ID]);
});

test("D69: released, archived eight days later, then resumed: the conversation and worktree come back", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  commitIn(record, "result");
  const sessionId = `${SHORT_ID}-0000-1111-2222-333333333333`;
  const transcript = transcriptFile(world.paths.projectsDir, record.worktree, sessionId);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '{"type":"user"}\n');
  utimesSync(transcript, (NOW - 60_000) / 1000, (NOW - 60_000) / 1000);
  await releaseCrewSession(record, world.ctx());
  // Seven days in /resume, then the archive.
  await sweepCrewConversations(world.paths, {}, NOW + 6 * DAY_MS);
  expect(existsSync(transcript)).toBe(true);
  await sweepCrewConversations(world.paths, {}, NOW + 8 * DAY_MS);
  expect(existsSync(transcript)).toBe(false);
  expect(await resumeSession(world.ctx(), stored(world, record), "continue")).toMatchObject({
    ok: true,
  });
  expect(readFileSync(transcript, "utf8")).toBe('{"type":"user"}\n');
  expect(existsSync(join(record.worktree, "result"))).toBe(true);
  expect(existsSync(crewArchiveDir(world.paths.stateDir, world.repo, record.id))).toBe(false);
});
