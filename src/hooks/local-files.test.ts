import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { scanWorktrees } from "../worktrees/scan";

function world(ignored = "supabase/.temp/\n") {
  const root = tempDir("local-files");
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, ".gitignore"), ignored);
  mkdirSync(join(main, "supabase"));
  writeFileSync(join(main, "supabase", "config.toml"), "project_id = 'example'\n");
  git(main, "add", ".gitignore", "supabase/config.toml");
  git(main, "commit", "-qm", "base");
  git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(main, "worktree", "add", "-qb", "work", worktree);
  const put = (folder: string, name: string, text: string) => {
    mkdirSync(join(folder, "supabase", ".temp"), { recursive: true });
    writeFileSync(join(folder, "supabase", ".temp", name), text);
  };
  const state = () =>
    scanWorktrees(main, {
      base: "main",
      claudeConfigDir: join(root, "claude"),
      env: cleanGitEnv(),
      idleLimit: 0,
      facts: { containers: [], mounts: [], programs: [], sessions: [] },
    }).find((one) => one.listed.path === worktree)?.state;
  return { main, worktree, put, state };
}

test("Supabase's version-check cache alone does not keep a finished worktree", () => {
  const { worktree, put, state } = world();
  put(worktree, "cli-latest", "2.120.0");
  expect(state()).toEqual({ finished: true, note: null });
});

test("an ignored logs/ folder and ignored .log files alone do not keep a finished worktree", () => {
  const { worktree, state } = world("supabase/.temp/\nlogs/\n*.log\nnotes.txt\n");
  // The shape seen live: an app's own debug logs, one folder per service.
  mkdirSync(join(worktree, "logs", "omniroute"), { recursive: true });
  writeFileSync(join(worktree, "logs", "omniroute", "2026-10-29__outbound__200.json"), "{}");
  mkdirSync(join(worktree, "server", "logs"), { recursive: true });
  writeFileSync(join(worktree, "server", "logs", "today.txt"), "a line");
  writeFileSync(join(worktree, "dev-server.log"), "a line");
  writeFileSync(join(worktree, "server", "vitest.log"), "a line");
  expect(state()).toEqual({ finished: true, note: null });
  // Anything else ignored still keeps it.
  writeFileSync(join(worktree, "notes.txt"), "keep my notes");
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: notes.txt",
  });
});

test("a directory or link named cli-latest is not a disposable version-cache file", () => {
  for (const kind of ["directory", "link"]) {
    const { worktree, state } = world();
    const cache = join(worktree, "supabase", ".temp", "cli-latest");
    mkdirSync(join(worktree, "supabase", ".temp"), { recursive: true });
    if (kind === "directory") {
      mkdirSync(cache);
      writeFileSync(join(cache, "notes"), "keep my notes");
    } else symlinkSync("../config.toml", cache);
    expect(state()).toMatchObject({ finished: false });
  }
});

test("different Supabase link state stays protected; an identical main copy is safe", () => {
  const { main, worktree, put, state } = world();
  put(main, "project-ref", "main-project");
  put(worktree, "project-ref", "other-project");
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: supabase/.temp/",
  });
  put(worktree, "project-ref", "main-project");
  expect(state()).toEqual({ finished: true, note: null });
});
