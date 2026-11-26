/**
 * `parseWorktreeList` (`git.ts`): what `git worktree list --porcelain` says about each worktree,
 * the reason of a lock included; and `runGit`'s text on stdin.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  commitArgs,
  commitIn,
  parseWorktreeList,
  reflogEntryTime,
  runGit,
  runGitRaw,
  worktreeAdminDir,
} from "./git";

describe("runGit with input", () => {
  test("git reads the text on stdin byte for byte: CRLF, no last newline, non-ASCII", () => {
    const repo = tempDir("git-input");
    git(repo, "init", "-q");
    const text = '{\r\n  "name": "café"\r\n}';
    const hashed = runGit(repo, ["hash-object", "-w", "--stdin"], cleanGitEnv(), 15_000, {}, text);
    expect(hashed).toMatchObject({ ok: true, code: 0 });
    expect(runGitRaw(repo, ["cat-file", "blob", hashed.out], cleanGitEnv()).out).toBe(text);
  });
});

describe("commitArgs and commitIn", () => {
  test("a rev that names a commit gives its full id, a tag of it too; anything else gives null", () => {
    const repo = tempDir("git-commit");
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "first");
    git(repo, "tag", "-a", "-m", "tag", "v1");
    const head = git(repo, "rev-parse", "HEAD").trim();
    const ask = (rev: string) => commitIn(runGit(repo, commitArgs(rev), cleanGitEnv()));
    expect(ask("HEAD")).toBe(head);
    expect(ask("v1")).toBe(head);
    expect(ask("main:a.txt")).toBeNull();
    expect(ask("no-such-ref")).toBeNull();
  });
});

describe("parseWorktreeList", () => {
  test("a lock keeps its reason: Claude Code's own lock can be told from a person's", () => {
    const porcelain = [
      "worktree /work/app",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /work/app/.claude/worktrees/agent-B1-help",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/B1-help",
      "locked claude session agent-B1-help (pid 4242 start 99)",
      "",
      "worktree /work/usb",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "locked",
      "",
      "worktree /work/plain",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/plain",
      "",
    ].join("\n");
    const [main, claude, bare, plain] = parseWorktreeList(porcelain);
    expect(main).toEqual({
      branch: "main",
      head: "1111111111111111111111111111111111111111",
      locked: false,
      path: "/work/app",
      prunable: false,
    });
    expect(claude?.locked).toBe(true);
    expect(claude?.lockReason).toBe("claude session agent-B1-help (pid 4242 start 99)");
    // A lock with no reason is a lock all the same, with nothing said.
    expect(bare?.locked).toBe(true);
    expect(bare?.lockReason).toBeUndefined();
    expect(plain?.locked).toBe(false);
    expect(plain?.lockReason).toBeUndefined();
  });
});

describe("worktreeAdminDir", () => {
  test("an absolute gitdir, a relative one and a missing or broken .git entry", () => {
    const root = tempDir("admin-dir");
    const absolute = join(root, "absolute");
    const relative = join(root, "relative");
    const folder = join(root, "folder");
    const broken = join(root, "broken");
    for (const dir of [absolute, relative, folder, broken]) mkdirSync(dir);
    writeFileSync(join(absolute, ".git"), "gitdir: /work/app/.git/worktrees/absolute\n");
    writeFileSync(join(relative, ".git"), "gitdir:   ../app/.git/worktrees/relative\n");
    mkdirSync(join(folder, ".git"));
    writeFileSync(join(broken, ".git"), "not a gitfile\n");
    expect(worktreeAdminDir(absolute)).toBe("/work/app/.git/worktrees/absolute");
    expect(worktreeAdminDir(relative)).toBe(join(root, "app", ".git", "worktrees", "relative"));
    // A main checkout's `.git` is a folder; a gone folder has none; a broken file names nothing.
    expect(worktreeAdminDir(folder)).toBeNull();
    expect(worktreeAdminDir(join(root, "gone"))).toBeNull();
    expect(worktreeAdminDir(broken)).toBeNull();
  });
});

describe("reflogEntryTime", () => {
  const ids = `${"a".repeat(40)} ${"b".repeat(40)}`;

  test("the epoch of a well-formed entry, in milliseconds", () => {
    expect(reflogEntryTime(`${ids} A B <a@example.com> 1761300000 +0200\tcommit: work`)).toBe(
      1761300000000,
    );
  });

  test("an entry with no message has no tab, and still reads", () => {
    expect(reflogEntryTime(`${ids} A B <a@example.com> 1761300000 +0200`)).toBe(1761300000000);
  });

  test.each([
    ["no email", `${ids} A B 1761300000 +0200\tcommit: work`],
    ["no zone", `${ids} A B <a@example.com> 1761300000\tcommit: work`],
    ["no ids", "A B <a@example.com> 1761300000 +0200\tcommit: work"],
    ["empty", ""],
  ])("a malformed entry (%s) gives null", (_name, line) => {
    expect(reflogEntryTime(line)).toBeNull();
  });
});
