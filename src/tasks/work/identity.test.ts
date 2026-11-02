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
