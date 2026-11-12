import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { agentFinished, ownsClaudeLock, parentPidFromStat, parseClaudeLock } from "./agent-lock";

test("both Claude lock forms allow a missing start", () => {
  expect(parseClaudeLock("claude agent agent-x (pid 42 start 123)")).toEqual({
    kind: "agent",
    name: "agent-x",
    pid: 42,
    start: "123",
  });
  expect(parseClaudeLock("claude session my session (pid 42)")).toEqual({
    kind: "session",
    name: "my session",
    pid: 42,
    start: null,
  });
  expect(parseClaudeLock("claude agent x (pid 0)")).toBeNull();
  expect(parseClaudeLock("other lock")).toBeNull();
});

test("parent stat parser uses the final closing parenthesis", () => {
  expect(parentPidFromStat("42 (name with ) spaces) S 7 1 2")).toBe(7);
  expect(parentPidFromStat("broken")).toBeNull();
});

test("ownership requires an ancestor and the measured numeric start", () => {
  const lock = parseClaudeLock("claude session lead (pid 42 start 123)");
  if (lock === null) throw new Error("missing fixture");
  const parentOf = (pid: number) => (pid === 9 ? 42 : null);
  expect(ownsClaudeLock(lock, 9, parentOf, () => "proc:123")).toBe(true);
  expect(ownsClaudeLock(lock, 9, parentOf, () => "proc:124")).toBe(false);
  expect(ownsClaudeLock({ ...lock, start: null }, 9, parentOf, () => "proc:123")).toBe(false);
  expect(
    ownsClaudeLock(
      lock,
      9,
      () => 9,
      () => "proc:123",
    ),
  ).toBe(false);
});

test("finished marker is cleared by revival and must name the same worktree", () => {
  const root = tempDir("agent-proof");
  const target = join(root, "worktree");
  mkdirSync(target);
  const config = join(root, "config");
  const subagents = join(config, "projects", "project", "session", "subagents");
  mkdirSync(subagents, { recursive: true });
  const meta = join(subagents, "agent-x.meta.json");
  const proof = () => agentFinished("x", target, config);
  expect(proof()).toBe(false);
  writeFileSync(meta, "broken json");
  expect(proof()).toBe(false);
  writeFileSync(meta, JSON.stringify({ worktreePath: target }));
  expect(proof()).toBe(false);
  writeFileSync(meta, JSON.stringify({ finished: false, worktreePath: target }));
  expect(proof()).toBe(false);
  writeFileSync(meta, JSON.stringify({ finished: true, worktreePath: join(root, "other") }));
  expect(proof()).toBe(false);
  writeFileSync(meta, JSON.stringify({ finished: true, worktreePath: target }));
  expect(proof()).toBe(true);
  writeFileSync(meta, JSON.stringify({ worktreePath: target, revivedAt: "2026-01-01" }));
  expect(proof()).toBe(false);
});
