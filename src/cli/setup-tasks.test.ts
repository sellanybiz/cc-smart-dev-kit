import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyManagedJson } from "../setup/managed-json";
import { restore } from "../setup/restore";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { capturePrinted, printed, world } from "../testing/fake-machine";
import { hookEnv, makeRepo } from "../testing/hooks";
import { checkLine, taskStoreChecks, taskToolsCheck } from "./doctor";
import { projectTaskChecks } from "./project-checks";

capturePrinted();

test("no terminal leaves trust out even with --yes, and says so", async () => {
  const w = world({ answer: null });
  await w.setup({ yes: true });
  const settings = JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));
  expect(settings.permissions.allow).toBeUndefined();
  expect(settings.permissions.deny).toEqual([
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
    "TodoWrite",
  ]);
  expect(printed).toContain(
    "  · task tools allow rule left out: trust rules need a person at a terminal",
  );
});

test("dry run leaves task settings and ownership untouched", async () => {
  const w = world({ answer: true });
  const before = readFileSync(w.paths.settingsFile, "utf8");
  await w.setup({ dryRun: true });
  expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
  expect(existsSync(workDbFile(w.paths))).toBe(false);
});

test("restore keeps personal permissions and values and withdraws setup's old opt-in", async () => {
  const w = world({ answer: true });
  const original = JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));
  writeFileSync(
    w.paths.settingsFile,
    JSON.stringify({ ...original, permissions: { deny: ["TodoWrite"], allow: ["Read"] } }),
  );
  mkdirSync(dirname(w.paths.claudeMemSettingsFile), { recursive: true });
  // claude-mem 15.5.0 seeds every default into a file it makes, work state "true" among them.
  writeFileSync(
    w.paths.claudeMemSettingsFile,
    JSON.stringify({ CLAUDE_MEM_WORK_STATE_ENABLED: "true" }),
  );
  applyManagedJson({
    file: w.paths.settingsFile,
    stateDir: w.paths.stateDir,
    set: [[["env", "CLAUDE_CODE_ENABLE_TODO_TOOLS"], "1"]],
  });
  const workState = () =>
    JSON.parse(readFileSync(w.paths.claudeMemSettingsFile, "utf8")).CLAUDE_MEM_WORK_STATE_ENABLED;
  await w.setup();
  expect(
    JSON.parse(readFileSync(w.paths.settingsFile, "utf8")).env?.CLAUDE_CODE_ENABLE_TODO_TOOLS,
  ).toBeUndefined();
  // Nobody chose the seeded "true": setup turns work state off.
  expect(workState()).toBe("false");
  // The person turns it back on after setup: that "true" is theirs, and a later setup keeps it.
  writeFileSync(
    w.paths.claudeMemSettingsFile,
    JSON.stringify({
      ...JSON.parse(readFileSync(w.paths.claudeMemSettingsFile, "utf8")),
      CLAUDE_MEM_WORK_STATE_ENABLED: "true",
    }),
  );
  await w.setup();
  expect(workState()).toBe("true");
  restore(w.paths.stateDir);
  expect(JSON.parse(readFileSync(w.paths.settingsFile, "utf8"))).toEqual({
    ...original,
    permissions: { deny: ["TodoWrite"], allow: ["Read"] },
  });
  expect(JSON.parse(readFileSync(w.paths.claudeMemSettingsFile, "utf8"))).toEqual({
    CLAUDE_MEM_WORK_STATE_ENABLED: "true",
  });
});

test("doctor warns for a newer store and reports damaged files", () => {
  const w = world();
  const file = workDbFile(w.paths);
  const db = openWorkDb(file, { mode: "write" });
  db.sqlite.run("PRAGMA user_version = 4");
  db.close();
  expect(taskStoreChecks(w.paths)).toEqual([
    {
      ok: true,
      warn: true,
      text: "task work store: schema 4 is newer than 3",
      fix: "cc-smart-dev-kit update",
    },
    { ok: true, text: "task work store: integrity check is ok" },
  ]);
  writeFileSync(file, "broken database");
  expect(taskStoreChecks(w.paths)).toEqual([
    {
      ok: false,
      text: "task work store cannot be read: file is not a database",
      fix: "move ~/.claude/cc-smart-dev-kit/tasks/work.db aside, with its -wal and -shm files; the next task call starts an empty store (project task files are in git and stay)",
    },
  ]);
});

test("doctor checks existing store schema and integrity without writing", () => {
  const w = world();
  const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
  db.close();
  expect(taskStoreChecks(w.paths)).toEqual([
    { ok: true, text: "task work store: schema 3 is current" },
    { ok: true, text: "task work store: integrity check is ok" },
  ]);
});

test("doctor says when the release branch is missing locally", async () => {
  const repo = makeRepo();
  const dir = join(repo, ".claude", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(repo, ".claude", "cc-smart-dev-kit.json"),
    JSON.stringify({ tasks: { releaseBranch: "release" } }),
  );
  expect(await projectTaskChecks(repo, hookEnv())).toEqual([
    {
      ok: true,
      info: true,
      text: "project tasks: release branch release is not available locally; missed releases were not checked",
    },
    { ok: true, text: "project tasks: no findings" },
  ]);
});

test("doctor counts broken project files with their fix", async () => {
  const repo = makeRepo();
  const dir = join(repo, ".claude", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "T-abcd-broken.md"), "not a task");
  expect(await projectTaskChecks(repo, hookEnv())).toEqual([
    { ok: false, text: "project tasks: 1 broken-file", fix: "run `cc-smart-dev-kit task check`" },
  ]);
});

test("doctor leaves project tasks out outside git", async () => {
  const w = world();
  expect(await projectTaskChecks(w.home, {})).toEqual([]);
});

test("doctor does not create a work store", () => {
  const w = world();
  expect(taskStoreChecks(w.paths)).toEqual([
    { ok: true, info: true, text: "task work store: not made yet" },
  ]);
});

test("doctor checks task tool permissions", () => {
  const w = world();
  expect(checkLine(taskToolsCheck(w.paths))).toBe(
    "✗ task tools: missing allow rule mcp__cc-smart-dev-kit-tasks__*; missing deny rules TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite Fix: cc-smart-dev-kit setup",
  );
});

test("setup replaces the built-in task list and asks before trusting task tools", async () => {
  const w = world({ answer: true });
  await w.setup();
  const settings = JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));
  expect(settings.permissions.allow).toEqual(["mcp__cc-smart-dev-kit-tasks__*"]);
  expect(settings.permissions.deny).toEqual([
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
    "TodoWrite",
  ]);
  expect(settings.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBeUndefined();
  expect(w.questions).toContain("Allow the kit's task tools?");
  expect(checkLine(taskToolsCheck(w.paths))).toBe(
    "✓ task tools: the kit's tools are allowed and the built-in task lists are hidden",
  );
  expect(
    JSON.parse(readFileSync(w.paths.claudeMemSettingsFile, "utf8")).CLAUDE_MEM_WORK_STATE_ENABLED,
  ).toBe("false");
});
