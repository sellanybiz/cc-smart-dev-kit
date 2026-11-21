/**
 * The one home of Claude Code's worktree names: the helpers, and a scan that no other source
 * file builds the folder by hand.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ListedWorktree } from "../hooks/git";
import {
  inDefaultFolder,
  listedNamed,
  SUBAGENT_BRANCH_PREFIX,
  SUBAGENT_NAME_PREFIX,
  WORKTREES_FOLDER_SEGMENTS,
  WORKTREES_GITIGNORE_ENTRY,
  worktreeBranch,
  worktreeFolders,
  worktreePath,
  worktreesFolder,
} from "./paths";

test("the worktrees folder and one worktree's path, from the repo's root", () => {
  expect(worktreesFolder("/r")).toBe(join("/r", ".claude", "worktrees"));
  expect(worktreePath("/r", "my-work")).toBe(join("/r", ".claude", "worktrees", "my-work"));
  expect(WORKTREES_FOLDER_SEGMENTS).toEqual([".claude", "worktrees"]);
});

test("the folder in the slash form git and .gitignore use, with its trailing slash", () => {
  expect(WORKTREES_GITIGNORE_ENTRY).toBe(".claude/worktrees/");
});

test("a worktree's branch is its name behind worktree-", () => {
  expect(worktreeBranch("my-work")).toBe("worktree-my-work");
  expect(worktreeBranch(`${SUBAGENT_NAME_PREFIX}1f`)).toBe("worktree-agent-1f");
});

test("a subagent's name and branch prefixes are the shapes Claude Code gives", () => {
  expect(SUBAGENT_NAME_PREFIX).toBe("agent-");
  expect(SUBAGENT_BRANCH_PREFIX).toBe("worktree-agent-");
});

/**
 * The two hand-built shapes: a join of the two folder names (on one line or over several), and
 * a regex that spells the folder out (`.claude[\\/]worktrees`).
 */
const BUILT_BY_HAND = [/"\.claude"\s*,\s*"worktrees"/, /\.claude\[\\\\\/\]worktrees/];

/** The source files (never a test, never paths.ts) whose text `offends`, as repo-relative paths. */
function sourcesThat(offends: (text: string) => boolean): string[] {
  const sourceRoot = join(import.meta.dir, "..");
  const offenders: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: sourceRoot })) {
    if (file.endsWith(".test.ts") || file === join("worktrees", "paths.ts")) continue;
    if (offends(readFileSync(join(sourceRoot, file), "utf8"))) {
      offenders.push(relative(join(sourceRoot, ".."), join(sourceRoot, file)));
    }
  }
  return offenders;
}

test("no source file outside paths.ts builds the worktrees folder by hand", () => {
  expect(sourcesThat((text) => BUILT_BY_HAND.some((pattern) => pattern.test(text)))).toEqual([]);
});

/**
 * The text inside the string and template literals of TypeScript source, comments skipped: a
 * comment may name the folder to explain it. (Bun's own transpiler cannot read the one file that
 * imports a macro, so the source is scanned.)
 */
function stringLiterals(source: string): string {
  let found = "";
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    const next = source[at + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", at);
      at = end < 0 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'" || char === "`") {
      let end = at + 1;
      while (end < source.length && source[end] !== char) end += source[end] === "\\" ? 2 : 1;
      found += `${source.slice(at + 1, end)}\n`;
      at = end + 1;
    } else {
      at += 1;
    }
  }
  return found;
}

/** The folder spelled out in a string, in the slash form git and `.gitignore` use. */
const FOLDER_LITERAL = /\.claude\/worktrees/;
const writesFolderLiteral = (text: string) => FOLDER_LITERAL.test(stringLiterals(text));

test("no source file outside paths.ts spells the worktrees folder in a string", () => {
  expect(sourcesThat(writesFolderLiteral)).toEqual([]);
});

test("the literal scan can fail: it names a string, and passes a comment", () => {
  expect(writesFolderLiteral('const ignore = ".claude/worktrees/";')).toBe(true);
  expect(writesFolderLiteral("const text = `see .claude/worktrees/ now`;")).toBe(true);
  expect(writesFolderLiteral("// the folder .claude/worktrees/ holds them\nconst a = 1;")).toBe(
    false,
  );
  expect(writesFolderLiteral("/** `.claude/worktrees/<name>` */\nconst a = 1;")).toBe(false);
});

test("the scan can fail: it names a file that joins the folder by hand", () => {
  expect(BUILT_BY_HAND.some((p) => p.test('join(repo, ".claude", "worktrees", name)'))).toBe(true);
  expect(BUILT_BY_HAND.some((p) => p.test('join(repo, ".claude",\n  "worktrees")'))).toBe(true);
  expect(
    BUILT_BY_HAND.some((p) => p.test(String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-1)`)),
  ).toBe(true);
  expect(BUILT_BY_HAND.some((p) => p.test('basename(common) === ".git"'))).toBe(false);
});

/** A worktree's branch name built by hand: the prefix in a template string. */
const BRANCH_BY_HAND = /`worktree-\$\{/;

test("no source file outside paths.ts builds a worktree's branch name by hand", () => {
  expect(sourcesThat((text) => BRANCH_BY_HAND.test(text))).toEqual([]);
});

test("the branch scan can fail: it names a template that builds the branch", () => {
  // The sample is source text, so its placeholder is spelled from two parts.
  const handBuilt = "const branch = `worktree-$" + "{name}`;";
  expect(BRANCH_BY_HAND.test(handBuilt)).toBe(true);
  expect(BRANCH_BY_HAND.test("worktreeBranch(name)")).toBe(false);
});

const listedWorktree = (
  path: string,
  branch: null | string,
  over: Partial<ListedWorktree> = {},
): ListedWorktree => ({
  branch,
  head: "abc",
  locked: false,
  path,
  prunable: false,
  ...over,
});

test("the folders worktrees may be in: the default one, and the parents of what git lists", () => {
  const listed = [
    listedWorktree("/r", "main"),
    listedWorktree("/r/.claude/worktrees/a", "worktree-a"),
    listedWorktree("/elsewhere/b", "feat-b"),
    listedWorktree("/elsewhere/c", "feat-c"),
  ];
  expect(worktreeFolders("/r", listed)).toEqual([
    join("/r", ".claude", "worktrees"),
    join("/elsewhere"),
  ]);
  // The first entry is the main checkout: its parent is never a worktrees folder.
  expect(worktreeFolders("/r", [listedWorktree("/work/r", "main")])).toEqual([
    join("/r", ".claude", "worktrees"),
  ]);
  expect(worktreeFolders("/r", [])).toEqual([join("/r", ".claude", "worktrees")]);
});

test("a worktree is named only by an exact match, never by a name that contains it", () => {
  const listed = [
    listedWorktree("/r", "main"),
    listedWorktree("/r/.claude/worktrees/kit-api-2", "worktree-kit-api-2"),
    listedWorktree("/elsewhere/kit-api", "feat-api"),
    listedWorktree("/elsewhere/other", "worktree-kit-api"),
    listedWorktree("/elsewhere/kit-api-3", "worktree-kit-api-3"),
  ];
  expect(listedNamed(listed, "kit-api").map((one) => one.path)).toEqual([
    "/elsewhere/kit-api",
    "/elsewhere/other",
  ]);
  expect(listedNamed(listed, "kit-api-2").map((one) => one.path)).toEqual([
    "/r/.claude/worktrees/kit-api-2",
  ]);
  expect(listedNamed(listed, "api")).toEqual([]);
});

test("a subagent's worktree, the main checkout and a gone folder are never a match", () => {
  const listed = [
    listedWorktree("/r/kit-x", "main"),
    listedWorktree("/r/.claude/worktrees/agent-123", `${SUBAGENT_BRANCH_PREFIX}123`),
    listedWorktree("/r/.claude/worktrees/kit-y", "worktree-kit-y", { prunable: true }),
  ];
  expect(listedNamed(listed, "kit-x")).toEqual([]);
  expect(listedNamed(listed, "agent-123")).toEqual([]);
  expect(listedNamed(listed, "kit-y")).toEqual([]);
});

test("a path is in the default folder only as the folder's own child, spelled the same", () => {
  expect(inDefaultFolder("/r", join("/r", ".claude", "worktrees", "kit-a"))).toBe(true);
  expect(inDefaultFolder("/r", "/elsewhere/kit-a")).toBe(false);
  expect(inDefaultFolder("/r", join("/r", ".claude", "worktrees", "x", "kit-a"))).toBe(false);
  expect(inDefaultFolder("/r", "/r")).toBe(false);
});
