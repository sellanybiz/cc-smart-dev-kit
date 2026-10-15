import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { git, tempDir } from "../testing/temp";
import { CcConfigError, CcVersionError } from "./config";
import { resolveProject } from "./resolve";

/** A repo with one commit, so `git worktree add` works. */
function makeRepo(): string {
  const repo = join(tempDir("repo"), "main");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "first");
  return repo;
}

function writeCcJson(folder: string, content: string): string {
  mkdirSync(join(folder, ".claude"), { recursive: true });
  const file = join(folder, ".claude", "cc.json");
  writeFileSync(file, content);
  return file;
}

describe("resolveProject", () => {
  test("the main checkout, from its root and from a subfolder", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    const expected = {
      root: repo,
      commonDir: join(repo, ".git"),
      isWorktree: false,
      mainCheckout: repo,
      config: null,
    };
    expect(resolveProject(repo)).toEqual(expected);
    expect(resolveProject(join(repo, "src", "deep"))).toEqual(expected);
  });

  test("a linked worktree: its own root, the shared .git, the main checkout", () => {
    const repo = makeRepo();
    const worktree = join(repo, "..", "wt-feature");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    expect(resolveProject(worktree)).toEqual({
      root: worktree,
      commonDir: join(repo, ".git"),
      isWorktree: true,
      mainCheckout: repo,
      config: null,
    });
  });

  test("a folder outside git gives null", () => {
    expect(resolveProject(tempDir("nogit"))).toBeNull();
  });

  test("no cc.json gives config null", () => {
    expect(resolveProject(makeRepo())?.config).toBeNull();
  });

  test("a valid cc.json is read with every field", () => {
    const repo = makeRepo();
    writeCcJson(
      repo,
      JSON.stringify({
        requires: ">=1.2",
        worktrees: { base: "dev", prefix: "app-wt-", setup: ["bun", "install"] },
        instructions: true,
        autoMode: ["In my-app: never touch production."],
      }),
    );
    expect(resolveProject(repo, { pluginVersion: "1.3.0" })?.config).toEqual({
      requires: ">=1.2",
      worktrees: { base: "dev", prefix: "app-wt-", setup: ["bun", "install"] },
      instructions: true,
      autoMode: ["In my-app: never touch production."],
    });
  });

  test("a worktree without its own cc.json falls back to the main checkout's", () => {
    const repo = makeRepo();
    writeCcJson(repo, JSON.stringify({ instructions: true }));
    const worktree = join(repo, "..", "wt-fallback");
    git(repo, "worktree", "add", "-q", "-b", "fallback", worktree);
    expect(resolveProject(worktree)?.config).toEqual({ instructions: true });
  });

  test("a worktree's own cc.json wins over the main checkout's", () => {
    const repo = makeRepo();
    writeCcJson(repo, JSON.stringify({ instructions: true }));
    const worktree = join(repo, "..", "wt-own");
    git(repo, "worktree", "add", "-q", "-b", "own", worktree);
    writeCcJson(worktree, JSON.stringify({ instructions: false }));
    expect(resolveProject(worktree)?.config).toEqual({ instructions: false });
  });

  test("an invalid cc.json throws an error that names the file and the field", () => {
    const repo = makeRepo();
    const file = writeCcJson(repo, JSON.stringify({ worktrees: { base: 5, prefix: "x-" } }));
    expect(() => resolveProject(repo)).toThrow(CcConfigError);
    expect(() => resolveProject(repo)).toThrow(`Invalid ${file}: worktrees.base:`);
  });

  test("an unknown field in cc.json is named", () => {
    const repo = makeRepo();
    writeCcJson(repo, JSON.stringify({ worktree: { base: "dev", prefix: "x-" } }));
    expect(() => resolveProject(repo)).toThrow("worktree: unknown field");
  });

  test("a plugin too old for `requires`: the update message, even with a field it does not know", () => {
    const repo = makeRepo();
    const file = writeCcJson(
      repo,
      JSON.stringify({ requires: ">=1.2", fieldFromTheFuture: true, instructions: true }),
    );
    expect(() => resolveProject(repo, { pluginVersion: "1.1.0" })).toThrow(CcVersionError);
    expect(() => resolveProject(repo, { pluginVersion: "1.1.0" })).toThrow(
      `${file}: this project needs cc-agentic >=1.2; you have 1.1.0; run claude plugin update cc@cc-agentic`,
    );
  });

  test("a plugin new enough for `requires`: then an unknown field is an error", () => {
    const repo = makeRepo();
    writeCcJson(repo, JSON.stringify({ requires: "^1.2", fieldFromTheFuture: true }));
    expect(() => resolveProject(repo, { pluginVersion: "1.4.0" })).toThrow(
      "fieldFromTheFuture: unknown field",
    );
    let error: unknown;
    try {
      resolveProject(repo, { pluginVersion: "1.4.0" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CcConfigError);
    expect(error).not.toBeInstanceOf(CcVersionError);
  });

  test("`requires` that is not a version range is a field error", () => {
    const repo = makeRepo();
    const file = writeCcJson(repo, JSON.stringify({ requires: "banana" }));
    expect(() => resolveProject(repo, { pluginVersion: "1.0.0" })).toThrow(
      `Invalid ${file}: requires: not a valid version range`,
    );
  });

  test("by default, `requires` is checked against this build's version", () => {
    const repo = makeRepo();
    writeCcJson(repo, JSON.stringify({ requires: `>${VERSION}` }));
    expect(() => resolveProject(repo)).toThrow(`you have ${VERSION};`);
    writeCcJson(repo, JSON.stringify({ requires: `>=${VERSION}` }));
    expect(resolveProject(repo)?.config).toEqual({ requires: `>=${VERSION}` });
  });

  test("cc.json that is not JSON throws an error that names the file", () => {
    const repo = makeRepo();
    const file = writeCcJson(repo, "{ not json");
    expect(() => resolveProject(repo)).toThrow(`Invalid ${file}: not valid JSON`);
  });

  test("a missing folder throws instead of guessing", () => {
    expect(() => resolveProject(join(tempDir("gone"), "missing"))).toThrow("is not a folder");
  });
});
