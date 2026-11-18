import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../testing/temp";
import { callerOf, claimGone, sessionEnded } from "./identity";

test("identity re-reads a live record after clear and worktree move", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "sessions"));
  const file = join(dir, "sessions", "10.json");
  const stat = (pid: number) =>
    `${pid} (process) S ${pid === 20 ? 10 : 1} ${Array(17).fill("0").join(" ")} 100`;
  writeFileSync(
    file,
    JSON.stringify({ pid: 10, sessionId: "old", cwd: "/old", name: "Name", procStart: "100" }),
  );
  const facts = {
    claudeConfigDir: dir,
    pid: 20,
    platform: "linux" as const,
    readStat: stat,
    running: () => true,
    env: {},
  };
  expect(callerOf(facts)?.sessionId).toBe("old");
  writeFileSync(
    file,
    JSON.stringify({ pid: 10, sessionId: "new", cwd: "/new", name: "Name", procStart: "100" }),
  );
  expect(callerOf(facts)?.sessionId).toBe("new");
  expect(callerOf(facts)?.cwd).toBe("/new");
  expect(
    callerOf({
      ...facts,
      readStat: () => null,
      running: () => false,
      env: { CLAUDE_CODE_SESSION_ID: "fallback" },
      cwd: dir,
    })?.sessionId,
  ).toBe("fallback");
});

test("an unrelated session's broken record never blanks the caller; the caller's own still throws", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "sessions"));
  // Process 20 (the caller) runs under process 10, the Claude process that has the record.
  const stat = (pid: number) =>
    `${pid} (process) S ${pid === 20 ? 10 : 1} ${Array(17).fill("0").join(" ")} 100`;
  const own = join(dir, "sessions", "10.json");
  writeFileSync(
    own,
    JSON.stringify({ pid: 10, sessionId: "mine", cwd: "/work", name: "Name", procStart: "100" }),
  );
  // Another running session's record, caught mid-write.
  writeFileSync(join(dir, "sessions", "77.json"), '{"pid": 77, "sessionId": "oth');
  const facts = {
    claudeConfigDir: dir,
    pid: 20,
    platform: "linux" as const,
    readStat: stat,
    running: () => true,
    env: {},
  };
  expect(callerOf(facts)?.sessionId).toBe("mine");
  // Again, now through the remembered process: still unaffected.
  expect(callerOf(facts)?.sessionId).toBe("mine");
  writeFileSync(own, "{not json");
  expect(() => callerOf(facts)).toThrow("the record of running session 10 in");
});

test("the caller's own broken record throws on the first walk too, with no remembered process", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "sessions"));
  writeFileSync(join(dir, "sessions", "10.json"), "{not json");
  // A healthy record of another session beside it changes nothing.
  writeFileSync(
    join(dir, "sessions", "77.json"),
    JSON.stringify({ pid: 77, sessionId: "other", cwd: "/work", name: "Name", procStart: "100" }),
  );
  expect(() =>
    callerOf({
      claudeConfigDir: dir,
      pid: 20,
      platform: "linux",
      readStat: (pid) =>
        `${pid} (process) S ${pid === 20 ? 10 : 1} ${Array(17).fill("0").join(" ")} 100`,
      running: () => true,
      env: {},
    }),
  ).toThrow("the record of running session 10 in");
});

test("claimGone: only a proved end; a running process that cannot be proved either way is not gone", () => {
  const stat = (start: string) => () => `7 (claude) S 1 ${Array(17).fill("0").join(" ")} ${start}`;
  const claim = { pid: 7, procStart: "100", sessionId: "s" };
  // The pid no longer runs: gone, on any platform.
  expect(claimGone(claim, { running: () => false, platform: "linux" })).toBe(true);
  expect(claimGone(claim, { running: () => false, platform: "darwin" })).toBe(true);
  // Linux: the pid runs with another start time (a reused pid): gone.
  expect(claimGone(claim, { running: () => true, platform: "linux", readStat: stat("200") })).toBe(
    true,
  );
  // The same start time: not gone.
  expect(claimGone(claim, { running: () => true, platform: "linux", readStat: stat("100") })).toBe(
    false,
  );
  // No start time on the claim, or `/proc` unreadable: not proved, so not gone.
  expect(
    claimGone(
      { ...claim, procStart: null },
      { running: () => true, platform: "linux", readStat: stat("200") },
    ),
  ).toBe(false);
  expect(claimGone(claim, { running: () => true, platform: "linux", readStat: () => null })).toBe(
    false,
  );
  // Off Linux a running pid is never proved gone.
  expect(claimGone(claim, { running: () => true, platform: "darwin" })).toBe(false);
});

/** A Claude config folder with one session record per `[pid, sessionId]`, and the pids that run. */
function sessionsFolder(records: [number, string][], running: number[]) {
  const dir = tempDir();
  mkdirSync(join(dir, "sessions"));
  for (const [pid, sessionId] of records)
    writeFileSync(
      join(dir, "sessions", `${pid}.json`),
      JSON.stringify({ pid, sessionId, cwd: "/x", name: "n" }),
    );
  return {
    claudeConfigDir: dir,
    platform: "darwin" as const,
    running: (pid: number) => running.includes(pid),
  };
}

test("sessionEnded: the process is gone and no running session carries the id", () => {
  const claim = { pid: 5, procStart: null, sessionId: "child" };
  // Nothing runs: the session is over.
  expect(sessionEnded(claim, sessionsFolder([], []))).toBe(true);
  // Another session runs: not the claim's.
  expect(sessionEnded(claim, sessionsFolder([[9, "other"]], [9]))).toBe(true);
  // The same session id in a new process (a reopened session): the process is gone, the session is not.
  expect(sessionEnded(claim, sessionsFolder([[77, "child"]], [77]))).toBe(false);
  // A record of a process that no longer runs counts for nothing.
  expect(sessionEnded(claim, sessionsFolder([[77, "child"]], []))).toBe(true);
  // A claim whose process still runs is not ended at all.
  expect(sessionEnded(claim, sessionsFolder([], [5]))).toBe(false);
});

test("sessionEnded: a record that cannot be read is not an end, and no session id means the process alone", () => {
  const claim = { pid: 5, procStart: null, sessionId: "child" };
  const folder = sessionsFolder([], [77]);
  // A running process whose record is not valid JSON: its session id cannot be known.
  writeFileSync(join(folder.claudeConfigDir, "sessions", "77.json"), "{ not json");
  expect(sessionEnded(claim, folder)).toBe(false);
  // The records are read only after the process is proved gone, and never for a null session id.
  const reads: string[] = [];
  const sessions = (dir: string) => {
    reads.push(dir);
    throw new Error("must not be read");
  };
  expect(sessionEnded({ ...claim, sessionId: null }, { ...folder, sessions })).toBe(true);
  expect(sessionEnded(claim, { ...folder, running: () => true, sessions })).toBe(false);
  expect(reads).toEqual([]);
});
