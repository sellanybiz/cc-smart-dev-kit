import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { scanWorktrees } from "../worktrees/scan";
import { localFiles, safeIgnoredEntry } from "./local-files";

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

function projectFile(main: string, text: string) {
  mkdirSync(join(main, ".claude"), { recursive: true });
  writeFileSync(join(main, ".claude", "cc-smart-dev-kit.json"), text);
}

test("a project's ignored cache blocks removal until it is declared rebuildable", () => {
  const { main, worktree } = world(".tool-cache/\n");
  mkdirSync(join(worktree, ".tool-cache"));
  writeFileSync(join(worktree, ".tool-cache", "data"), "cache");
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([".tool-cache/"]);
  projectFile(
    main,
    JSON.stringify({
      requires: ">=1.9",
      worktrees: { base: "main", rebuildable: [".tool-cache/"] },
    }),
  );
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([]);
});

test("project rebuildable patterns match at depth and inside a collapsed ignored folder", () => {
  const { main, worktree } = world("server/\n");
  mkdirSync(join(worktree, "server", ".tool-cache"), { recursive: true });
  writeFileSync(join(worktree, "server", ".tool-cache", "data"), "cache");
  writeFileSync(join(worktree, "server", "result.cache"), "cache");
  projectFile(
    main,
    JSON.stringify({
      requires: ">=1.9",
      worktrees: { base: "main", rebuildable: [".tool-cache/", "*.cache"] },
    }),
  );
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([]);
  writeFileSync(join(worktree, "server", "notes.txt"), "keep");
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual(["server/"]);
});

test.each([
  "{broken",
  JSON.stringify({
    requires: ">=999.0",
    worktrees: { base: "main", rebuildable: [".tool-cache/"] },
  }),
])("an unusable project file keeps the strict ignored-file rule: %s", (text) => {
  const { main, worktree } = world(".tool-cache/\n");
  mkdirSync(join(worktree, ".tool-cache"));
  writeFileSync(join(worktree, ".tool-cache", "data"), "cache");
  projectFile(main, text);
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([".tool-cache/"]);
});

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

test("an ignored next-env.d.ts, at any depth, does not keep a finished worktree", () => {
  // Next.js writes this file on every dev start and build, and says not to edit it.
  const { worktree, state } = world("supabase/.temp/\nnext-env.d.ts\nnotes.txt\n");
  writeFileSync(join(worktree, "next-env.d.ts"), '/// <reference types="next" />\n');
  mkdirSync(join(worktree, "apps", "web"), { recursive: true });
  writeFileSync(join(worktree, "apps", "web", "next-env.d.ts"), '/// <reference types="next" />\n');
  expect(state()).toEqual({ finished: true, note: null });
  // Another ignored file still keeps it.
  writeFileSync(join(worktree, "notes.txt"), "keep my notes");
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: notes.txt",
  });
});

test("a folder named next-env.d.ts is read, never taken whole by the file pattern", () => {
  const { worktree, state } = world("supabase/.temp/\nserver/\n");
  mkdirSync(join(worktree, "server", "next-env.d.ts"), { recursive: true });
  writeFileSync(join(worktree, "server", "next-env.d.ts", "notes.txt"), "keep my notes");
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: server/",
  });
});

test("a folder named like a log file is read, never taken whole by the .log pattern", () => {
  const { worktree, state } = world("supabase/.temp/\nserver/\n");
  mkdirSync(join(worktree, "server", "app.log"), { recursive: true });
  writeFileSync(join(worktree, "server", "app.log", "notes.txt"), "keep my notes");
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: server/",
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

// Fixed historical times keep setup-copy tests independent of the test runner's speed.
const SETUP_SECONDS = 1_700_000_000;

function setupTime(worktree: string) {
  const admin = git(worktree, "rev-parse", "--absolute-git-dir").trim();
  const log = join(admin, "logs", "HEAD");
  const lines = readFileSync(log, "utf8").split("\n");
  lines[0] = lines[0]?.replace(/ \d+ ([+-]\d{4})(?=\t|$)/, ` ${SETUP_SECONDS} $1`) ?? "";
  expect(lines[0]).toContain(` ${SETUP_SECONDS} +0000`);
  writeFileSync(log, lines.join("\n"));
  utimesSync(join(admin, "commondir"), SETUP_SECONDS, SETUP_SECONDS);
  return admin;
}

function includedCopy() {
  const files = world(".env.local\n");
  const admin = setupTime(files.worktree);
  writeFileSync(join(files.worktree, ".env.local"), "original copy");
  utimesSync(join(files.worktree, ".env.local"), SETUP_SECONDS + 30, SETUP_SECONDS + 30);
  writeFileSync(join(files.main, ".env.local"), "main changed later");
  return { ...files, admin };
}

test("an untouched ignored copy is safe after the main checkout's copy changes", () => {
  const { main, worktree } = includedCopy();
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([]);
  expect(safeIgnoredEntry(worktree, main, ".env.local")).toBe(true);
});

test("an ignored copy edited after setup and copy slack stays protected", () => {
  const { main, worktree } = includedCopy();
  writeFileSync(join(worktree, ".env.local"), "session edit");
  utimesSync(join(worktree, ".env.local"), SETUP_SECONDS + 121, SETUP_SECONDS + 121);
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([".env.local"]);
});

test("an old ignored file absent from main stays protected", () => {
  const { main, worktree } = includedCopy();
  rmSync(join(main, ".env.local"));
  expect(localFiles(worktree, main, cleanGitEnv())).toEqual([".env.local"]);
  expect(safeIgnoredEntry(worktree, null, ".env.local")).toBe(false);
});

test.each(["reflog", "commondir"])("setup time falls back when %s is missing", (missing) => {
  const { main, worktree, admin } = includedCopy();
  rmSync(join(admin, missing === "reflog" ? "logs/HEAD" : "commondir"));
  expect(safeIgnoredEntry(worktree, main, ".env.local")).toBe(true);
});

test("no readable setup time grants no extra permission", () => {
  const { main, worktree, admin } = includedCopy();
  writeFileSync(join(admin, "logs", "HEAD"), "malformed\n");
  rmSync(join(admin, "commondir"));
  expect(safeIgnoredEntry(worktree, main, ".env.local")).toBe(false);
});

test.each(["reflog", "commondir"])(
  "the earlier %s time wins over rewritten metadata",
  (earlier) => {
    const { main, worktree, admin } = includedCopy();
    const later = SETUP_SECONDS + 3600;
    if (earlier === "reflog") utimesSync(join(admin, "commondir"), later, later);
    else {
      const log = join(admin, "logs", "HEAD");
      writeFileSync(
        log,
        readFileSync(log, "utf8").replaceAll(String(SETUP_SECONDS), String(later)),
      );
    }
    utimesSync(join(worktree, ".env.local"), SETUP_SECONDS + 121, SETUP_SECONDS + 121);
    expect(safeIgnoredEntry(worktree, main, ".env.local")).toBe(false);
  },
);

test("folders and symbolic links do not gain timestamp permission", () => {
  const { main, worktree } = world("private/\n.env.local\n");
  setupTime(worktree);
  for (const folder of [main, worktree]) mkdirSync(join(folder, "private"));
  writeFileSync(join(main, "private", "notes"), "main");
  writeFileSync(join(worktree, "private", "notes"), "session");
  utimesSync(join(worktree, "private"), SETUP_SECONDS, SETUP_SECONDS);
  symlinkSync("private/notes", join(worktree, ".env.local"));
  writeFileSync(join(main, ".env.local"), "main");
  expect(safeIgnoredEntry(worktree, main, "private/")).toBe(false);
  expect(safeIgnoredEntry(worktree, main, ".env.local")).toBe(false);
});

test("different Supabase link state stays protected; an identical main copy is safe", () => {
  const { main, worktree, put, state } = world();
  put(main, "project-ref", "main-project");
  put(worktree, "project-ref", "other-project");
  setupTime(worktree);
  utimesSync(
    join(worktree, "supabase", ".temp", "project-ref"),
    SETUP_SECONDS + 121,
    SETUP_SECONDS + 121,
  );
  expect(state()).toMatchObject({
    finished: false,
    why: "local files git does not keep: supabase/.temp/",
  });
  put(worktree, "project-ref", "main-project");
  expect(state()).toEqual({ finished: true, note: null });
});
