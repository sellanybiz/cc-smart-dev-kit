import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { git, tempDir } from "../testing/temp";
import { CcSmartDevKitConfigError, CcSmartDevKitVersionError } from "./config";
import { locateCheckout, ownHooksOf, resolveProject } from "./resolve";

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

function writeCcSmartDevKitJson(folder: string, content: string): string {
  mkdirSync(join(folder, ".claude"), { recursive: true });
  const file = join(folder, ".claude", "cc-smart-dev-kit.json");
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
      configFile: null,
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
      configFile: null,
    });
  });

  test("a folder outside git gives null", () => {
    expect(resolveProject(tempDir("nogit"))).toBeNull();
  });

  test("no cc-smart-dev-kit.json gives config null", () => {
    expect(resolveProject(makeRepo())?.config).toBeNull();
  });

  test("a valid cc-smart-dev-kit.json is read with every field", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(
      repo,
      JSON.stringify({
        requires: ">=1.2",
        worktrees: {
          base: "dev",
          prefix: "app-wt-",
          setup: ["bun", "install"],
          guardMainFolder: true,
        },
        protectedBranches: ["main", "release"],
        sessionNames: true,
        instructions: true,
        autoMode: ["In my-app: never touch production."],
        ownHooks: ["git-guard", "after-merge"],
      }),
    );
    expect(resolveProject(repo, { pluginVersion: "1.3.0" })?.config).toEqual({
      requires: ">=1.2",
      worktrees: {
        base: "dev",
        prefix: "app-wt-",
        setup: ["bun", "install"],
        guardMainFolder: true,
      },
      protectedBranches: ["main", "release"],
      sessionNames: true,
      instructions: true,
      autoMode: ["In my-app: never touch production."],
      ownHooks: ["git-guard", "after-merge"],
    });
  });

  test.each([
    [{ protectedBranches: [] }, "protectedBranches:"],
    [{ protectedBranches: [""] }, "protectedBranches.0:"],
    [{ sessionNames: "yes" }, "sessionNames:"],
    [{ ownHooks: ["git-gaurd"] }, "ownHooks.0:"],
    [{ ownHooks: ["worktree-create"] }, "ownHooks.0:"],
    [{ ownHooks: "git-guard" }, "ownHooks:"],
    [
      { worktrees: { base: "dev", prefix: "x-", guardMainFolder: 1 } },
      "worktrees.guardMainFolder:",
    ],
  ])("the hook fields are checked: %j names %j", (content, field) => {
    const repo = makeRepo();
    const file = writeCcSmartDevKitJson(repo, JSON.stringify(content));
    expect(() => resolveProject(repo)).toThrow(`Invalid ${file}: ${field}`);
  });

  test("a worktree without its own cc-smart-dev-kit.json falls back to the main checkout's", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, JSON.stringify({ instructions: true }));
    const worktree = join(repo, "..", "wt-fallback");
    git(repo, "worktree", "add", "-q", "-b", "fallback", worktree);
    expect(resolveProject(worktree)?.config).toEqual({ instructions: true });
    expect(resolveProject(worktree)?.configFile).toBe(
      join(repo, ".claude", "cc-smart-dev-kit.json"),
    );
  });

  test("a worktree's own cc-smart-dev-kit.json wins over the main checkout's", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, JSON.stringify({ instructions: true }));
    const worktree = join(repo, "..", "wt-own");
    git(repo, "worktree", "add", "-q", "-b", "own", worktree);
    writeCcSmartDevKitJson(worktree, JSON.stringify({ instructions: false }));
    expect(resolveProject(worktree)?.config).toEqual({ instructions: false });
    expect(resolveProject(worktree)?.configFile).toBe(
      join(worktree, ".claude", "cc-smart-dev-kit.json"),
    );
  });

  test("an invalid cc-smart-dev-kit.json throws an error that names the file and the field", () => {
    const repo = makeRepo();
    const file = writeCcSmartDevKitJson(
      repo,
      JSON.stringify({ worktrees: { base: 5, prefix: "x-" } }),
    );
    expect(() => resolveProject(repo)).toThrow(CcSmartDevKitConfigError);
    expect(() => resolveProject(repo)).toThrow(`Invalid ${file}: worktrees.base:`);
  });

  test("an unknown field in cc-smart-dev-kit.json is named", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, JSON.stringify({ worktree: { base: "dev", prefix: "x-" } }));
    expect(() => resolveProject(repo)).toThrow("worktree: unknown field");
  });

  test("a plugin too old for `requires`: the update message, even with a field it does not know", () => {
    const repo = makeRepo();
    const file = writeCcSmartDevKitJson(
      repo,
      JSON.stringify({ requires: ">=1.2", fieldFromTheFuture: true, instructions: true }),
    );
    expect(() => resolveProject(repo, { pluginVersion: "1.1.0" })).toThrow(
      CcSmartDevKitVersionError,
    );
    expect(() => resolveProject(repo, { pluginVersion: "1.1.0" })).toThrow(
      `${file}: this project needs cc-smart-dev-kit >=1.2; you have 1.1.0; run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`,
    );
  });

  test("a plugin new enough for `requires`: then an unknown field is an error", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, JSON.stringify({ requires: "^1.2", fieldFromTheFuture: true }));
    expect(() => resolveProject(repo, { pluginVersion: "1.4.0" })).toThrow(
      "fieldFromTheFuture: unknown field",
    );
    let error: unknown;
    try {
      resolveProject(repo, { pluginVersion: "1.4.0" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CcSmartDevKitConfigError);
    expect(error).not.toBeInstanceOf(CcSmartDevKitVersionError);
  });

  test("`requires` that is not a version range is a field error", () => {
    const repo = makeRepo();
    const file = writeCcSmartDevKitJson(repo, JSON.stringify({ requires: "banana" }));
    expect(() => resolveProject(repo, { pluginVersion: "1.0.0" })).toThrow(
      `Invalid ${file}: requires: not a valid version range`,
    );
  });

  test("by default, `requires` is checked against this build's version", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, JSON.stringify({ requires: `>${VERSION}` }));
    expect(() => resolveProject(repo)).toThrow(`you have ${VERSION};`);
    writeCcSmartDevKitJson(repo, JSON.stringify({ requires: `>=${VERSION}` }));
    expect(resolveProject(repo)?.config).toEqual({ requires: `>=${VERSION}` });
  });

  test("cc-smart-dev-kit.json that is not JSON throws an error that names the file", () => {
    const repo = makeRepo();
    const file = writeCcSmartDevKitJson(repo, "{ not json");
    expect(() => resolveProject(repo)).toThrow(`Invalid ${file}: not valid JSON`);
  });

  test("locateCheckout finds the checkout without reading cc-smart-dev-kit.json, even a broken one", () => {
    const repo = makeRepo();
    writeCcSmartDevKitJson(repo, "{ not json");
    expect(locateCheckout(repo)).toEqual({
      root: repo,
      commonDir: join(repo, ".git"),
      isWorktree: false,
      mainCheckout: repo,
    });
    expect(locateCheckout(tempDir("nogit"))).toBeNull();
  });

  test("ownHooksOf reads only ownHooks, from the file loadProjectConfig reads", () => {
    const repo = makeRepo();
    const checkout = () => {
      const found = locateCheckout(repo);
      if (found === null) throw new Error("no checkout");
      return found;
    };
    expect(ownHooksOf(checkout())).toEqual([]);
    // Too new and with a field this plugin does not know: the list is still read.
    writeCcSmartDevKitJson(
      repo,
      JSON.stringify({ requires: ">=99", future: 1, ownHooks: ["git-guard", 5] }),
    );
    expect(ownHooksOf(checkout())).toEqual(["git-guard"]);
    writeCcSmartDevKitJson(repo, "{ not json");
    expect(ownHooksOf(checkout())).toEqual([]);
    writeCcSmartDevKitJson(repo, JSON.stringify({ ownHooks: ["message-guard"] }));
    const worktree = join(repo, "..", "wt-own-hooks");
    git(repo, "worktree", "add", "-q", "-b", "own-hooks", worktree);
    const inWorktree = locateCheckout(worktree);
    if (inWorktree === null) throw new Error("no checkout");
    expect(ownHooksOf(inWorktree)).toEqual(["message-guard"]);
    writeCcSmartDevKitJson(worktree, JSON.stringify({ sessionNames: true }));
    expect(ownHooksOf(inWorktree)).toEqual([]);
  });

  test("a missing folder throws instead of guessing", () => {
    expect(() => resolveProject(join(tempDir("gone"), "missing"))).toThrow("is not a folder");
  });
});

/**
 * A fake git first on PATH: it answers the commands in `answers` (by the first argument)
 * with a shell snippet, and passes every other command to the real git.
 */
function fakeGitEnv(answers: Record<string, string>): Record<string, string | undefined> {
  const realGit = Bun.which("git");
  if (!realGit) throw new Error("git is not on PATH");
  const dir = tempDir("fake-git");
  const cases = Object.entries(answers)
    .map(([first, body]) => `  ${first}) ${body} ;;`)
    .join("\n");
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\ncase "$1" in\n${cases}\n  *) exec ${JSON.stringify(realGit)} "$@" ;;\nesac\n`,
  );
  chmodSync(join(dir, "git"), 0o755);
  return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
}

describe("resolveProject: git problems give clear errors", () => {
  test("the main checkout was moved or deleted: a clear error, not a raw ENOENT", () => {
    const repo = makeRepo();
    const worktree = join(repo, "..", "wt-moved");
    git(repo, "worktree", "add", "-q", "-b", "moved", worktree);
    const gone = join(tempDir("gone"), "main");
    const env = fakeGitEnv({
      worktree: `printf 'worktree %s\\nHEAD 0000\\nbranch refs/heads/main\\n\\n' ${JSON.stringify(gone)}; exit 0`,
    });
    expect(() => resolveProject(worktree, { env })).toThrow(
      `The main checkout of the repo at ${worktree} is missing: ${gone} was moved or deleted. ` +
        'If you moved it, run "git worktree repair" in its new folder.',
    );
  });

  test("git older than 2.31 prints --path-format back: 'git 2.31 or newer is needed'", () => {
    const repo = makeRepo();
    const env = fakeGitEnv({
      "--version": "echo 'git version 2.30.2'; exit 0",
      "rev-parse": `printf -- '--path-format=absolute\\n%s\\n%s/.git\\n.git\\n' ${JSON.stringify(repo)} ${JSON.stringify(repo)}; exit 0`,
    });
    expect(() => resolveProject(repo, { env })).toThrow(
      "git 2.31 or newer is needed; you have git 2.30.2. Update git.",
    );
  });

  test("git older than 2.31 that fails rev-parse: the same message, not null", () => {
    const repo = makeRepo();
    const env = fakeGitEnv({
      "--version": "echo 'git version 2.25.1'; exit 0",
      "rev-parse": "echo 'fatal: unknown option' >&2; exit 129",
    });
    expect(() => resolveProject(repo, { env })).toThrow("git 2.31 or newer is needed");
  });

  test("a new enough git outside a repo: still null", () => {
    const env = fakeGitEnv({ "--version": "echo 'git version 2.31.0'; exit 0" });
    expect(resolveProject(tempDir("nogit"), { env })).toBeNull();
  });
});
