import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { liveSessions, parseSessionRecord } from "./sessions";

test("a running session without a start identity stays live", () => {
  const config = tempDir("session-identity");
  mkdirSync(join(config, "sessions"));
  writeFileSync(
    join(config, "sessions", "300.json"),
    JSON.stringify({ pid: 300, sessionId: "legacy-lead", cwd: "/home/user/my-app" }),
  );
  expect(
    liveSessions(config, {
      platform: "linux",
      running: () => true,
      readStat: () => "300 (session name) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 11 0",
    }),
  ).toEqual([{ pid: 300, sessionId: "legacy-lead", cwd: "/home/user/my-app", name: "legacy-l" }]);
});

test("a reused pid with another procStart is not a live lead", () => {
  const config = tempDir("session-identity");
  mkdirSync(join(config, "sessions"));
  const json = JSON.stringify({
    pid: 300,
    sessionId: "old-lead",
    cwd: "/project",
    name: "lead",
    procStart: "10",
  });
  writeFileSync(join(config, "sessions", "300.json"), json);
  expect(parseSessionRecord(json)?.procStart).toBe("10");
  const facts = {
    platform: "linux" as const,
    running: () => true,
    readStat: () => "300 (session name) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 11 0",
  };
  expect(liveSessions(config, facts)).toEqual([]);
  expect(
    liveSessions(config, {
      ...facts,
      readStat: () => "300 (session name) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 10 0",
    }),
  ).toHaveLength(1);
});

test.each([
  null,
  "300 (session) S",
  "300 (session) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 invalid 0",
])("a running session stays live when its stat start cannot be read or parsed: %s", (stat) => {
  const config = tempDir("session-stat");
  mkdirSync(join(config, "sessions"));
  writeFileSync(
    join(config, "sessions", "300.json"),
    JSON.stringify({
      pid: 300,
      sessionId: "unproved-session",
      cwd: "/project",
      name: "lead",
      procStart: "10",
    }),
  );
  expect(
    liveSessions(config, { platform: "linux", running: () => true, readStat: () => stat }),
  ).toEqual([
    { pid: 300, sessionId: "unproved-session", cwd: "/project", name: "lead", procStart: "10" },
  ]);
});
