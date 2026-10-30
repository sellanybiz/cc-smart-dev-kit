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
import { resumePlace, resumeSession } from "./answer";
import { crewArchiveDir, DAY_MS, restoreConversation, sweepCrewConversations } from "./archive";
import { boardLines } from "./board";
import { releaseCrewSession, restoreReleasedWorktree } from "./release";
import { crewRemovalLockDir, runCrewRm } from "./remove";
import {
  type CrewRecord,
  claimResume,
  crewFile,
  eventsEndOffset,
  RESUME_CLAIM_MS,
  readCrew,
  updateCrew,
  type WatchState,
} from "./store";
import { transcriptFile } from "./transcript";
import { PARKED_PASS_MS, watchPass } from "./watch";

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
    why: `${record.worktree} exists already; inspect it first`,
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
    fix: `Fix: commit them on ${record.branch}, or move them out of ${record.worktree}; the watch then releases it by itself`,
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

test("D69: a hand-off whose session is still in agent view is stopped, then released", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "handoff" });
  const { scope, state } = watchOf(world);
  const first = await watchPass(state, world.ctx({}, agentsWith("idle")), scope);
  expect(world.claudeVerbs()).toEqual(["agents", "stop"]);
  expect(world.out).toEqual([
    "C my-app B1 help: session stopped — it handed off; its branch and its record stay",
  ]);
  expect(existsSync(record.worktree)).toBe(true);
  await watchPass(first.state, world.ctx({}, agentsWith("stopped")), scope);
  expect(existsSync(record.worktree)).toBe(false);
  expect(stored(world, record).state).toBe("handoff");
});

test("D69: a claude rm that fails leaves the record released; the watch runs it again", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  commitIn(record, "result");
  const { scope, state } = watchOf(world);
  const stopped = agentsWith("stopped");
  const first = await watchPass(state, world.ctx({}, { ...stopped, FAKE_RM: "fail" }), scope);
  expect(existsSync(record.worktree)).toBe(false);
  const released = stored(world, record);
  expect(released.released).toBeDefined();
  expect(released.sessionEndedAt).toBeUndefined();
  expect(git(world.repo, "show", `${record.branch}:result`).trim()).toBe("kept");
  // Still resumable: a resume makes the worktree again.
  expect(resumePlace(released).ok).toBe(true);
  expect(world.out).toEqual([
    `C my-app B1 help: not released yet — claude rm ${SHORT_ID} failed (exit 1): could not delete\nFix: nothing to do; the worktree is gone, ${record.branch} is kept, and the watch tries claude rm ${SHORT_ID} again by itself (or run it by hand)`,
    `C my-app B1 help: the worktree is gone; claude rm ${SHORT_ID} failed (exit 1): could not delete`,
  ]);
  const rms = () => world.claudeVerbs().filter((verb) => verb === "rm").length;
  const failing = { ...stopped, FAKE_RM: "fail" };
  // The folder went, so the next pass tries again; the same refusal is not said twice.
  const second = await watchPass(first.state, world.ctx({}, failing), scope);
  expect(rms()).toBe(2);
  expect(world.out).toHaveLength(2);
  // Nothing changed since: not again before the interval.
  const third = await watchPass(second.state, world.ctx({}, failing), scope);
  expect(rms()).toBe(2);
  const ctx = world.ctx({}, stopped);
  await watchPass(third.state, { ...ctx, now: () => ctx.now() + PARKED_PASS_MS }, scope);
  expect(rms()).toBe(3);
  expect(stored(world, record).sessionEndedAt).toBeDefined();
  expect(world.out.at(-1)).toBe(
    `C my-app B1 help: released: its agent-view rows are removed now; branch ${record.branch} kept`,
  );
});

test("D69: a released crew session whose branch is not merged can still be discarded", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  commitIn(record, "result");
  expect(await releaseCrewSession(record, world.ctx())).toEqual({ ok: true });
  expect(existsSync(record.worktree)).toBe(false);
  // Plain removal still refuses the unmerged commit.
  expect(await runCrewRm(record.id, world.ctx())).toBe(1);
  expect(await runCrewRm(record.id, world.ctx(), { discard: true, yes: true })).toBe(0);
  const after = stored(world, record);
  expect(after.state).toBe("discarded");
  expect(existsSync(record.worktree)).toBe(false);
  expect(git(world.repo, "branch", "--list", record.branch).trim()).toBe("");
  const ref = after.archive?.ref ?? "";
  expect(git(world.repo, "show", `${ref}:result`).trim()).toBe("kept");
  expect(world.out).toContain(
    `made .claude/worktrees/${record.worktree.split("/").at(-1)} again on ${record.branch}, to discard it`,
  );
});

test("D69: an expired resume claim does not hold a release; a live one does", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  const ctx = world.ctx();
  await claimResume(world.paths.stateDir, world.repo, record.id, ["done"], "live", ctx.now());
  expect(await releaseCrewSession(stored(world, record), ctx)).toEqual({
    ok: false,
    why: "a resume of C my-app B1 help is starting",
    fix: "Fix: nothing to do; the watch tries the release again once the resume is over",
  });
  expect(existsSync(record.worktree)).toBe(true);
  const later = { ...ctx, now: () => ctx.now() + RESUME_CLAIM_MS };
  expect(await releaseCrewSession(stored(world, record), later)).toEqual({ ok: true });
  expect(existsSync(record.worktree)).toBe(false);
});

test("D69: a sweep never takes back a conversation a resume holds a claim on", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  const sessionId = `${SHORT_ID}-0000-1111-2222-333333333333`;
  const transcript = transcriptFile(world.paths.projectsDir, record.worktree, sessionId);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '{"type":"user"}\n');
  utimesSync(transcript, (NOW - 60_000) / 1000, (NOW - 60_000) / 1000);
  await releaseCrewSession(record, world.ctx());
  await sweepCrewConversations(world.paths, {}, NOW + 8 * DAY_MS);
  expect(existsSync(transcript)).toBe(false);
  // A resume's own order: the claim, then the conversation back; a sweep runs between it and the launch.
  const at = NOW + 8 * DAY_MS;
  expect(
    await claimResume(world.paths.stateDir, world.repo, record.id, ["stopped"], "resume", at),
  ).toBe(true);
  expect(await restoreConversation(world.paths, stored(world, record))).toEqual({ ok: true });
  await sweepCrewConversations(world.paths, {}, at + 60_000);
  expect(readFileSync(transcript, "utf8")).toBe('{"type":"user"}\n');
  // A resume that started nothing gives the claim up: the next sweep moves it again.
  await sweepCrewConversations(world.paths, {}, at + RESUME_CLAIM_MS);
  expect(existsSync(transcript)).toBe(false);
});

test("D69: a merged record left for the lead's crew rm is released; that crew rm still ends it", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "stopped" });
  commitIn(record, "result");
  git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", record.branch);
  const { scope, state } = watchOf(world);
  const first = await watchPass(state, world.ctx({}, agentsWith("stopped")), scope);
  const after = stored(world, record);
  expect(after.state).toBe("merged");
  expect(after.mergedWhileStopped).toBe(true);
  expect(after.released).toBeDefined();
  expect(existsSync(record.worktree)).toBe(false);
  expect(git(world.repo, "branch", "--list", record.branch).trim()).not.toBe("");
  expect(world.out).toEqual([
    "C my-app B1 help: merged — the lead merged its branch; it was stopped, so `crew rm` removes it",
    `C my-app B1 help: released: worktree and agent-view rows removed; branch ${record.branch} kept`,
  ]);
  // Later passes say nothing more; the lead's own crew rm deletes the branch and ends it.
  await watchPass(first.state, world.ctx(), scope);
  expect(world.out).toHaveLength(2);
  expect(await runCrewRm(record.id, world.ctx())).toBe(0);
  expect(stored(world, record).state).toBe("removed");
  expect(git(world.repo, "branch", "--list", record.branch).trim()).toBe("");
});

test("D69: a merged record its chain holds is released while it waits", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "handoff" });
  commitIn(record, "result");
  git(world.repo, "merge", "--no-ff", "-q", "-m", "merge", record.branch);
  await world.addCrew({ state: "working", slug: "help-2", continues: record.id, shortId: null });
  const { scope, state } = watchOf(world);
  await watchPass(state, world.ctx(), scope);
  expect(stored(world, record).state).toBe("merged");
  expect(stored(world, record).released).toBeDefined();
  expect(existsSync(record.worktree)).toBe(false);
  expect(git(world.repo, "branch", "--list", record.branch).trim()).not.toBe("");
});

test("D69: a record whose worktree went before its claude rm is released while agent view keeps its row", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "failed" });
  git(world.repo, "worktree", "remove", "--force", record.worktree);
  const { scope, state } = watchOf(world);
  // No row, no worktree: nothing to do, so nothing runs.
  await watchPass(state, world.ctx(), scope);
  expect(world.claudeVerbs()).toEqual(["agents"]);
  await watchPass(state, world.ctx({}, agentsWith("stopped")), scope);
  expect(world.claudeVerbs()).toContain("rm");
  expect(stored(world, record).released).toBeDefined();
  expect(stored(world, record).sessionEndedAt).toBeDefined();
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
  const kept = world.out.filter((line) => line.includes("not released yet"));
  expect(kept).toEqual([
    `${record.name}: not released yet — ${record.worktree} has changes that are not committed (or git cannot read it)\nFix: commit or discard them there; the watch then releases it by itself; it never forces`,
  ]);
  const second = await watchPass(first.state, world.ctx(), scope);
  expect(world.out.filter((line) => line.includes("not released yet"))).toHaveLength(1);
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

test("D69: a gone lead's merged crew session that waits for its crew rm is listed too", async () => {
  // No watch of a gone lead releases it, and nothing else would take its row away.
  const world = await boardWorld();
  const record = await world.addCrew({ state: "merged" });
  await updateCrew(world.paths.stateDir, world.repo, record.id, { mergedWhileStopped: true }, NOW);
  const ctx = world.ctx();
  await releasableCrewSessions(ctx);
  expect(
    (await releasableCrewSessions({ ...ctx, now: () => ctx.now() + 86_400_001 })).map(
      (one) => one.id,
    ),
  ).toEqual([record.id]);
});

test("D69: a gone lead's released record is listed again only while agent view keeps its row", async () => {
  const world = await boardWorld();
  const record = await world.addCrew({ state: "done" });
  await updateCrew(world.paths.stateDir, world.repo, record.id, { released: { at: "x" } }, NOW);
  const listed = async (env: Record<string, string>) => {
    const ctx = world.ctx({}, env);
    await releasableCrewSessions(ctx);
    const later = { ...ctx, now: () => ctx.now() + 86_400_001 };
    return (await releasableCrewSessions(later)).map((one) => one.id);
  };
  expect(await listed({})).toEqual([]);
  expect(await listed(agentsWith("stopped"))).toEqual([record.id]);
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
