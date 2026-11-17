import { expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { taskContext, taskContextAsync } from "./context";

function repoWith(config: unknown | null): string {
  const dir = realpathSync(tempDir());
  git(dir, "init", "-b", "main");
  if (config !== null) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "cc-smart-dev-kit.json"), JSON.stringify(config));
    git(dir, "add", ".");
  }
  git(dir, "commit", "--allow-empty", "-m", "initial");
  return dir;
}

test("a worktree and its main checkout share one project; files go in the worktree's own checkout", () => {
  const dir = repoWith(null);
  const wt = join(realpathSync(tempDir()), "work");
  git(dir, "worktree", "add", "-b", "test-work", wt);
  const main = taskContext(dir, cleanGitEnv());
  const work = taskContext(wt, cleanGitEnv());
  if (!main.ok || !work.ok) throw new Error("expected both to resolve");
  expect(work.project).toBe(main.project);
  expect(work.project).toMatch(/^[0-9a-f]{16}$/);
  expect(work.repo).toBe(dir);
  expect(work.checkoutRoot).toBe(wt);
  if (!work.projectTasks.ok) throw new Error("expected project tasks");
  expect(work.projectTasks).toEqual({
    ok: true,
    dir: join(wt, ".claude", "tasks"),
    staleDays: 30,
    envs: ["staging", "prod"],
  });
});

test("the project's tasks settings: folder, stale age and environments", () => {
  const dir = repoWith({ tasks: { dir: "docs/tasks", staleDays: 7, envs: ["prod"] } });
  const context = taskContext(dir, cleanGitEnv());
  if (!context.ok || !context.projectTasks.ok) throw new Error("expected project tasks");
  expect(context.projectTasks).toEqual({
    ok: true,
    dir: join(dir, "docs", "tasks"),
    staleDays: 7,
    envs: ["prod"],
  });
});

test("the release branch and old notes folders still load, and nothing reads them", () => {
  const dir = repoWith({
    tasks: { releaseBranch: "release", legacyFolders: [".claude/db-notes"] },
  });
  const context = taskContext(dir, cleanGitEnv());
  if (!context.ok || !context.projectTasks.ok) throw new Error("expected project tasks");
  expect(context.projectTasks).toEqual({
    ok: true,
    dir: join(dir, ".claude", "tasks"),
    staleDays: 30,
    envs: ["staging", "prod"],
  });
});

test("a broken project file leaves the work store usable and says why project tasks are not", () => {
  const dir = repoWith({ tasks: { folder: "x" } });
  const context = taskContext(dir, cleanGitEnv());
  if (!context.ok) throw new Error("expected the work store's project");
  expect(context.projectTasks.ok).toBe(false);
  expect(context.projectTasks.ok ? "" : context.projectTasks.why).toContain(
    "cc-smart-dev-kit.json",
  );
});

test("outside git: the folder is its own project, with no project tasks", () => {
  const dir = realpathSync(tempDir());
  const context = taskContext(dir, cleanGitEnv());
  if (!context.ok) throw new Error("expected a project");
  expect(context.repo).toBeNull();
  expect(context.checkoutRoot).toBeNull();
  expect(context.project).toMatch(/^[0-9a-f]{16}$/);
  expect(context.projectTasks).toEqual({
    ok: false,
    why: "not in a git checkout: project tasks live in a repository",
  });
});

test("a folder that is not there is an error, never a guessed project", () => {
  const context = taskContext(join(tempDir(), "gone"), cleanGitEnv());
  expect(context.ok).toBe(false);
});

test("the async twin gives the same answer, for the portal's server", async () => {
  const dir = repoWith({ tasks: { dir: "docs/tasks", staleDays: 9 } });
  const wt = join(realpathSync(tempDir()), "work");
  git(dir, "worktree", "add", "-b", "test-work", wt);
  const sync = taskContext(wt, cleanGitEnv());
  const async = await taskContextAsync(wt, cleanGitEnv());
  if (!sync.ok || !async.ok || !sync.projectTasks.ok || !async.projectTasks.ok) {
    throw new Error("expected both to resolve");
  }
  expect(async.project).toBe(sync.project);
  expect([async.repo, async.checkoutRoot]).toEqual([dir, wt]);
  expect([async.projectTasks.dir, async.projectTasks.staleDays]).toEqual([
    join(wt, "docs", "tasks"),
    9,
  ]);
  expect((await taskContextAsync(join(tempDir(), "gone"), cleanGitEnv())).ok).toBe(false);
});
