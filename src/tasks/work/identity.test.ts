import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../testing/temp";
import { callerOf } from "./identity";

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
