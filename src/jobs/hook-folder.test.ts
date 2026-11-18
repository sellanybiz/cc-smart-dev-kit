/**
 * The kit's git hooks folder (`hook-folder.ts`): the script against real git, the folder's
 * write, its state and its refresh. Real git in temp repos, a fake launcher that records its
 * calls, a temp home. Every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  type GitHookWorld,
  gitHookWorld,
  runIn,
  stageFile,
  writeFileIn,
} from "../testing/git-hook-world";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { HOOK_NAMES } from "./git-hooks";
import {
  gitHooksState,
  HOOK_FILE_MODE,
  hookLauncher,
  hookScript,
  installGitHooksFolder,
  refreshGitHooksFolder,
} from "./hook-folder";

/** A hook that writes `marker` into `<repo>/<file>` (and exits `code`). */
function markerHook(file: string, code = 0): string {
  return `#!/bin/sh\necho ran >> "${file}"\nexit ${code}\n`;
}

/** A world with the kit's folder installed and a launcher that answers `answer`. */
function installed(answer: string | null, exit = 0): GitHookWorld {
  const world = gitHookWorld();
  world.install();
  world.fakeLauncher({ answer, exit });
  return world;
}

describe("the folder", () => {
  test("holds one script per hook name, all the same text, all executable", () => {
    const world = gitHookWorld();
    expect(installGitHooksFolder(world.paths)).toEqual({
      files: HOOK_NAMES.length,
      outcome: "created",
    });
    const folder = world.paths.gitHooksFolder;
    expect(folder).toBe(join(world.home, ".local", "share", "cc-smart-dev-kit", "git-hooks"));
    const text = hookScript(join(world.home, ".local", "bin", "cc-smart-dev-kit"));
    for (const name of HOOK_NAMES) {
      expect(readFileSync(join(folder, name), "utf8")).toBe(text);
      expect(statSync(join(folder, name)).mode & 0o777).toBe(0o755);
    }
    // Only the hook names and the kit's own mark: never `push-to-checkout` or `proc-receive`.
    expect(readdirSync(folder).sort()).toEqual([...HOOK_NAMES, ".cc-smart-dev-kit-owned"].sort());
    expect(installGitHooksFolder(world.paths)).toEqual({
      files: HOOK_NAMES.length,
      outcome: "unchanged",
    });
  });

  test("a dry run writes nothing", () => {
    const world = gitHookWorld();
    expect(installGitHooksFolder(world.paths, { dryRun: true })).toEqual({
      files: HOOK_NAMES.length,
      outcome: "created",
    });
    expect(existsSync(world.paths.gitHooksFolder)).toBe(false);
    expect(existsSync(world.paths.stateDir)).toBe(false);
  });

  test("a folder whose scripts lost their execute bit is rewritten", () => {
    const world = gitHookWorld();
    installGitHooksFolder(world.paths);
    chmodSync(join(world.paths.gitHooksFolder, "pre-commit"), 0o644);
    expect(installGitHooksFolder(world.paths).outcome).toBe("updated");
    expect(statSync(join(world.paths.gitHooksFolder, "pre-commit")).mode & 0o777).toBe(
      HOOK_FILE_MODE,
    );
  });

  test("the launcher's path is baked in, quoted: a home with a space and an apostrophe works", () => {
    const parent = tempDir("git-hooks-quote");
    const home = join(parent, "it's a home");
    mkdirSync(home);
    const paths = cliPaths({ HOME: home });
    installGitHooksFolder(paths);
    const text = readFileSync(join(paths.gitHooksFolder, "pre-commit"), "utf8");
    expect(text).toContain(`launcher='${parent}/it'\\''s a home/.local/bin/cc-smart-dev-kit'\n`);
    expect(hookLauncher(paths)).toBe(join(home, ".local", "bin", "cc-smart-dev-kit"));
    // And it runs: a launcher at that path answers `queue x`, and `job run` runs the real hook.
    const world = gitHookWorld();
    const marker = join(world.repo, "marker");
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), markerHook(marker), 0o755);
    writeFileIn(
      hookLauncher(paths),
      '#!/bin/sh\n[ "$2" = hook ] && echo "queue x" && exit 0\nshift 4; shift; exec "$@"\n',
      0o755,
    );
    const ran = runIn(world.repo, [join(paths.gitHooksFolder, "pre-commit")], cleanGitEnv());
    expect(ran.code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
  });
});

describe("the script, run by real git", () => {
  test("a heavy hook goes through the launcher's `job run`, with the real file after --", () => {
    const world = installed("queue test:run");
    const marker = join(world.repo, "marker");
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, markerHook(marker), 0o755);
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"]).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(world.calls()).toEqual(["job hook pre-commit", `job run --kind test:run -- ${hook}`]);
  });

  test("a light hook runs direct: no `job run`", () => {
    const world = installed("direct");
    const marker = join(world.repo, "marker");
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), markerHook(marker), 0o755);
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"]).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(world.calls()).toEqual(["job hook pre-commit"]);
  });

  test("the hook's own exit code stops the commit, as it does without the kit", () => {
    const world = installed("direct");
    const marker = join(world.repo, "marker");
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), markerHook(marker, 1), 0o755);
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"]).code).toBe(1);
    expect(git(world.repo, "log", "--format=%s")).toBe("first\n");
  });

  test("a launcher that fails, answers garbage or is missing never blocks: the hook runs as it is", () => {
    const hookIn = (world: GitHookWorld) => {
      const marker = join(world.repo, "marker");
      writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), markerHook(marker, 7), 0o755);
      return marker;
    };
    // `job hook` exits 1 while it prints a queue answer: the answer is not trusted.
    const failing = installed("queue test:run", 1);
    const marker = hookIn(failing);
    const ran = runIn(
      failing.repo,
      [join(failing.paths.gitHooksFolder, "pre-commit")],
      failing.routedEnv(),
    );
    // The real hook's own code (7) comes back.
    expect(ran.code).toBe(7);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(failing.calls()).toEqual(["job hook pre-commit"]);
    // Answers that are not `direct` or `queue <kind>`: all run direct.
    for (const answer of [
      "queue",
      "queue ",
      "queue a b",
      "rm -rf /",
      "queue a\nqueue b",
      "queue $(id)",
    ]) {
      const world = installed(answer);
      hookIn(world);
      const result = runIn(
        world.repo,
        [join(world.paths.gitHooksFolder, "pre-commit")],
        world.routedEnv(),
      );
      expect(result.code).toBe(7);
      expect(world.calls()).toEqual(["job hook pre-commit"]);
    }
    // No launcher at all.
    const bare = gitHookWorld();
    bare.install();
    hookIn(bare);
    expect(
      runIn(bare.repo, [join(bare.paths.gitHooksFolder, "pre-commit")], bare.routedEnv()).code,
    ).toBe(7);
  });

  test("no hook: git goes on, and the launcher is never started", () => {
    const world = installed("queue test:run");
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"]).code).toBe(0);
    expect(world.calls()).toEqual([]);
  });

  test("a hook that is not executable: git's own hint, exit 0, nothing run", () => {
    const world = installed("queue test:run");
    const marker = join(world.repo, "marker");
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, markerHook(marker), 0o644);
    stageFile(world.repo);
    const result = world.run(world.repo, ["commit", "-q", "-m", "two"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain(
      `hint: The '${hook}' hook was ignored because it's not set as executable.`,
    );
    expect(existsSync(marker)).toBe(false);
    expect(world.calls()).toEqual([]);
  });

  test("the repo's own core.hooksPath (relative) is the folder that is read, from a subfolder", () => {
    const world = installed("queue test:run");
    git(world.repo, "config", "core.hooksPath", "hooks");
    const marker = join(world.repo, "marker");
    const hook = join(world.repo, "hooks", "pre-commit");
    writeFileIn(hook, markerHook(marker), 0o755);
    stageFile(world.repo);
    const deep = join(world.repo, "sub", "deep");
    mkdirSync(deep, { recursive: true });
    expect(world.run(deep, ["commit", "-q", "-m", "two"]).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(world.calls()).toEqual(["job hook pre-commit", `job run --kind test:run -- ${hook}`]);
  });

  test("husky v9: the stub runs, not .husky/<name>; a stub with no .husky/<name> never starts the launcher", () => {
    const world = installed("queue tsc");
    git(world.repo, "config", "core.hooksPath", ".husky/_");
    const marker = join(world.repo, "marker");
    // What husky v9 writes for each name: a stub that runs `.husky/<name>` through `sh`.
    const stub = (name: string) =>
      `#!/usr/bin/env sh\necho "stub ${name}" >> "${marker}"\n[ -f ".husky/${name}" ] && sh -e ".husky/${name}"\nexit 0\n`;
    writeFileIn(join(world.repo, ".husky", "_", "pre-commit"), stub("pre-commit"), 0o755);
    writeFileIn(join(world.repo, ".husky", "_", "post-commit"), stub("post-commit"), 0o755);
    // The person's hook: not executable, as husky v9 leaves it.
    writeFileIn(join(world.repo, ".husky", "pre-commit"), 'echo "body" >> "marker"\n', 0o644);
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"]).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("stub pre-commit\nbody\n");
    // The queue ran the STUB (the file in the real hooks folder), never `.husky/pre-commit`.
    expect(world.calls()).toEqual([
      "job hook pre-commit",
      `job run --kind tsc -- ${join(world.repo, ".husky", "_", "pre-commit")}`,
    ]);
    // post-commit has a stub and no `.husky/post-commit`: no launcher call, no stub run.
    expect(world.calls().some((call) => call.includes("post-commit"))).toBe(false);
    expect(readFileSync(marker, "utf8")).not.toContain("stub post-commit");
  });

  test("husky v9 with HUSKY=0: the stub runs direct, and the launcher is never asked", () => {
    const world = installed("queue tsc");
    git(world.repo, "config", "core.hooksPath", ".husky/_");
    const marker = join(world.repo, "marker");
    writeFileIn(
      join(world.repo, ".husky", "_", "pre-commit"),
      `#!/usr/bin/env sh\n[ "$HUSKY" = 0 ] && exit 0\necho "stub" >> "${marker}"\n`,
      0o755,
    );
    writeFileIn(join(world.repo, ".husky", "pre-commit"), "bun run typecheck\n", 0o644);
    stageFile(world.repo);
    const off = world.run(world.repo, ["commit", "-q", "-m", "two"], {
      ...world.routedEnv(),
      HUSKY: "0",
    });
    expect(off.code).toBe(0);
    expect(world.calls()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  test("pre-push: the refs on stdin reach the real hook, queued or direct, through a real push", () => {
    for (const answer of ["queue test:run", "direct"]) {
      const world = installed(answer);
      const remote = tempDir("git-hooks-remote");
      git(remote, "init", "-q", "--bare");
      git(world.repo, "remote", "add", "origin", remote);
      const seen = join(world.repo, "stdin.txt");
      writeFileIn(
        join(world.repo, ".git", "hooks", "pre-push"),
        `#!/bin/sh\ncat > "${seen}"\necho "$1 $2" > "${seen}.args"\n`,
        0o755,
      );
      const branch = git(world.repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
      const head = git(world.repo, "rev-parse", "HEAD").trim();
      const pushed = world.run(world.repo, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
      expect(pushed.code).toBe(0);
      expect(readFileSync(seen, "utf8")).toBe(
        `HEAD ${head} refs/heads/${branch} ${"0".repeat(head.length)}\n`,
      );
      expect(readFileSync(`${seen}.args`, "utf8")).toBe(`origin ${remote}\n`);
    }
  });

  test("stdin passes through a direct hook run by hand", () => {
    const world = installed("direct");
    const seen = join(world.repo, "stdin.txt");
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-push"),
      `#!/bin/sh\ncat > "${seen}"\n`,
      0o755,
    );
    const result = runIn(
      world.repo,
      [join(world.paths.gitHooksFolder, "pre-push"), "origin", "url"],
      world.routedEnv(),
      "a b c d\n",
    );
    expect(result.code).toBe(0);
    expect(readFileSync(seen, "utf8")).toBe("a b c d\n");
  });

  test("git without the pair never meets the folder: the repo's own hook runs alone", () => {
    const world = installed("queue test:run");
    const marker = join(world.repo, "marker");
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), markerHook(marker), 0o755);
    stageFile(world.repo);
    expect(world.run(world.repo, ["commit", "-q", "-m", "two"], cleanGitEnv()).code).toBe(0);
    expect(world.calls()).toEqual([]);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
  });
});

describe("gitHooksState", () => {
  test("missing, ok, and each problem named", () => {
    const world = gitHookWorld();
    expect(gitHooksState(world.paths)).toEqual({ kind: "missing" });
    installGitHooksFolder(world.paths);
    expect(gitHooksState(world.paths)).toEqual({ kind: "ok" });
    const folder = world.paths.gitHooksFolder;
    chmodSync(join(folder, "pre-commit"), 0o644);
    writeFileSync(join(folder, "pre-push"), "#!/bin/sh\n# an older version\n");
    chmodSync(join(folder, "pre-push"), 0o755);
    writeFileSync(join(folder, "push-to-checkout"), "#!/bin/sh\n");
    rmSync(join(folder, "commit-msg"));
    // The hook names in the list's order, then any file that should not be there.
    expect(gitHooksState(world.paths)).toEqual({
      kind: "problems",
      problems: [
        "pre-commit is not executable",
        "commit-msg is missing",
        "pre-push is from another version",
        "push-to-checkout should not be there",
      ],
    });
  });
});

describe("refreshGitHooksFolder", () => {
  /** A world with the folder written, then one script made stale. */
  function stale(version: string): GitHookWorld {
    const world = gitHookWorld();
    installGitHooksFolder(world.paths);
    writeFileIn(join(world.paths.gitHooksFolder, "pre-commit"), "#!/bin/sh\n# older\n", 0o755);
    // Claude Code's record of the installed plugin version.
    writeFileIn(
      world.paths.installedPluginsFile,
      JSON.stringify({
        plugins: {
          "cc-smart-dev-kit@cc-smart-dev-kit": [{ scope: "user", installPath: "/x", version }],
        },
      }),
    );
    return world;
  }

  test("rewrites a stale folder setup wrote, from the installed version's session only", async () => {
    const world = stale("2.0.0");
    expect(await refreshGitHooksFolder(world.paths, "1.0.0")).toBe(false);
    expect(gitHooksState(world.paths).kind).toBe("problems");
    expect(await refreshGitHooksFolder(world.paths, "2.0.0")).toBe(true);
    expect(gitHooksState(world.paths)).toEqual({ kind: "ok" });
    expect(await refreshGitHooksFolder(world.paths, "2.0.0")).toBe(false);
  });

  test("never creates the folder, and never touches one setup did not write", async () => {
    const world = gitHookWorld();
    writeFileIn(
      world.paths.installedPluginsFile,
      JSON.stringify({
        plugins: {
          "cc-smart-dev-kit@cc-smart-dev-kit": [
            { scope: "user", installPath: "/x", version: "2.0.0" },
          ],
        },
      }),
    );
    expect(await refreshGitHooksFolder(world.paths, "2.0.0")).toBe(false);
    expect(existsSync(world.paths.gitHooksFolder)).toBe(false);
    // A folder at that path the person made: no record, so no rewrite.
    writeFileIn(join(world.paths.gitHooksFolder, "pre-commit"), "#!/bin/sh\nmine\n", 0o755);
    expect(await refreshGitHooksFolder(world.paths, "2.0.0")).toBe(false);
    expect(readFileSync(join(world.paths.gitHooksFolder, "pre-commit"), "utf8")).toBe(
      "#!/bin/sh\nmine\n",
    );
  });

  test("with no record of the installed version it does nothing", async () => {
    const world = gitHookWorld();
    installGitHooksFolder(world.paths);
    writeFileIn(join(world.paths.gitHooksFolder, "pre-commit"), "#!/bin/sh\n# older\n", 0o755);
    expect(await refreshGitHooksFolder(world.paths, "2.0.0")).toBe(false);
  });
});
