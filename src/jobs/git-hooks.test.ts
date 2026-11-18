/**
 * Which hook a commit really runs, and whether it is heavy (`git-hooks.ts`): real git in temp
 * repos, never the real home. Every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitHookWorld, writeFileIn } from "../testing/git-hook-world";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { runWeight } from "./classify";
import { HOOK_NAMES, hookDecision, hooksPlace, MAX_HOOK_BYTES, TIMED_OUT } from "./git-hooks";
import { DEFAULT_KINDS } from "./kinds";
import { packageScripts } from "./package-scripts";
import { diskWeightSource } from "./weight-source";

const ENV = cleanGitEnv();

describe("the hook list", () => {
  test("holds every hook the folder covers, and never the two that change git's behaviour", () => {
    expect(HOOK_NAMES).toContain("pre-commit");
    expect(HOOK_NAMES).toContain("pre-push");
    expect(HOOK_NAMES).toContain("pre-merge-commit");
    expect(HOOK_NAMES).toContain("update");
    expect(HOOK_NAMES).toContain("post-update");
    expect(HOOK_NAMES).not.toContain("push-to-checkout");
    expect(HOOK_NAMES).not.toContain("proc-receive");
    expect(new Set(HOOK_NAMES).size).toBe(HOOK_NAMES.length);
  });
});

describe("hooksPlace", () => {
  const hooksOf = (repo: string) => join(repo, ".git", "hooks");

  test("is the repo's own hooks folder, and ignores the pair that names the kit's folder", () => {
    const world = gitHookWorld();
    const place = { folder: hooksOf(world.repo), top: world.repo };
    expect(hooksPlace(world.repo, world.routedEnv())).toEqual(place);
    expect(hooksPlace(world.repo, ENV)).toEqual(place);
  });

  test("follows the repo's own core.hooksPath, a relative one too, from a subfolder", () => {
    const world = gitHookWorld();
    git(world.repo, "config", "core.hooksPath", "hooks");
    const deep = join(world.repo, "sub", "deep");
    mkdirSync(deep, { recursive: true });
    // A relative path is read from the root of the work tree, wherever git runs.
    expect(hooksPlace(world.repo, world.routedEnv())).toEqual({
      folder: join(world.repo, "hooks"),
      top: world.repo,
    });
    expect(hooksPlace(deep, world.routedEnv())).toEqual({
      folder: join(world.repo, "hooks"),
      top: world.repo,
    });
    git(world.repo, "config", "core.hooksPath", "/elsewhere/hooks");
    expect(hooksPlace(deep, world.routedEnv())).toEqual({
      folder: "/elsewhere/hooks",
      top: world.repo,
    });
  });

  test("a linked worktree shares the main checkout's hooks folder, and runs its hooks at its own top", () => {
    const world = gitHookWorld();
    const linked = join(tempDir("git-hooks-linked"), "wt");
    git(world.repo, "worktree", "add", "-q", "-b", "other", linked);
    expect(hooksPlace(linked, world.routedEnv())).toEqual({
      folder: hooksOf(world.repo),
      top: linked,
    });
  });

  test("where there is no work tree (a bare repo, the git folder) the top is the asking folder", () => {
    const world = gitHookWorld();
    const bare = join(tempDir("git-hooks-bare"), "origin.git");
    git(world.repo, "init", "-q", "--bare", bare);
    expect(hooksPlace(bare, ENV)).toEqual({ folder: join(bare, "hooks"), top: bare });
    const gitDir = join(world.repo, ".git");
    expect(hooksPlace(gitDir, ENV)).toEqual({ folder: hooksOf(world.repo), top: gitDir });
  });

  test("with no time left it never starts git, and a git slower than its limit is stopped: timed out, not null", () => {
    const world = gitHookWorld();
    const bin = join(tempDir("git-hooks-fake-git"), "bin");
    const marker = join(bin, "..", "started");
    // A `git` first on PATH that records that it was started, then sleeps.
    writeFileIn(join(bin, "git"), `#!/bin/sh\necho started >> "${marker}"\nexec sleep 30\n`, 0o755);
    const env = { ...ENV, PATH: `${bin}:${ENV.PATH ?? ""}` };
    expect(hooksPlace(world.repo, env, 0)).toBe(TIMED_OUT);
    expect(hooksPlace(world.repo, env, -50)).toBe(TIMED_OUT);
    expect(existsSync(marker)).toBe(false);
    expect(hooksPlace(world.repo, env, 300)).toBe(TIMED_OUT);
    expect(existsSync(marker)).toBe(true);
  });

  test("is null outside a repo", () => {
    const world = gitHookWorld();
    expect(hooksPlace(join(world.home, "nowhere"), ENV)).toBeNull();
  });
});

describe("hookDecision", () => {
  test("a heavy hook in .git/hooks is queued under its kind; a light one runs direct", () => {
    const world = gitHookWorld();
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, "#!/bin/sh\nbun test\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "test:run",
    });
    writeFileIn(hook, "#!/bin/sh\nbunx biome check .\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
  });

  test("a hook that runs a heavy command among others is heavy (any-heavy)", () => {
    const world = gitHookWorld();
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-push"),
      "#!/bin/sh\nset -e\necho start\nbunx biome check .\nbun test\necho done\n",
      0o755,
    );
    expect(hookDecision("pre-push", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "test:run",
    });
  });

  test("a package script inside the hook is read by its body", () => {
    const world = gitHookWorld();
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "biome check ." } }),
    );
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, "#!/bin/sh\nbun run typecheck\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "tsc",
    });
    writeFileIn(hook, "#!/bin/sh\nbun run lint\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
  });

  test("a hook that is not there is none", () => {
    const world = gitHookWorld();
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe("none");
    // A folder named like a hook is no hook.
    mkdirSync(join(world.repo, ".git", "hooks", "pre-push"), { recursive: true });
    expect(hookDecision("pre-push", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe("none");
  });

  test("with no time left for git the answer is timed-out, and git is never started", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    const bin = join(tempDir("git-hooks-fake-git"), "bin");
    const marker = join(bin, "..", "started");
    writeFileIn(join(bin, "git"), `#!/bin/sh\necho started >> "${marker}"\nexit 1\n`, 0o755);
    const env = { ...ENV, PATH: `${bin}:${ENV.PATH ?? ""}` };
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, env, 0)).toBe(
      "timed-out",
    );
    expect(existsSync(marker)).toBe(false);
    // With time, the same call asks git (this fake says no) and finds no repo: a plain none.
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, env, 5000)).toBe(
      "none",
    );
    expect(existsSync(marker)).toBe(true);
  });

  test("outside a repo there is nothing to run", () => {
    const world = gitHookWorld();
    const outside = join(world.home, "nowhere");
    mkdirSync(outside);
    expect(hookDecision("pre-commit", outside, DEFAULT_KINDS, packageScripts, ENV)).toBe("none");
  });

  test("a hook in a core.hooksPath folder is found from a subfolder", () => {
    const world = gitHookWorld();
    git(world.repo, "config", "core.hooksPath", "hooks");
    writeFileIn(join(world.repo, "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    const deep = join(world.repo, "sub", "deep");
    mkdirSync(deep, { recursive: true });
    expect(
      hookDecision("pre-commit", deep, DEFAULT_KINDS, packageScripts, world.routedEnv()),
    ).toEqual({
      queue: "test:run",
    });
  });

  test("husky v9: the stub is the file git runs, and .husky/<name> (even a plain file) is read", () => {
    const world = gitHookWorld();
    git(world.repo, "config", "core.hooksPath", ".husky/_");
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
    );
    const stub = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';
    writeFileIn(join(world.repo, ".husky", "_", "pre-commit"), stub, 0o755);
    writeFileIn(join(world.repo, ".husky", "_", "post-commit"), stub, 0o755);
    // Not executable: husky runs it through `sh`, so git never needs the bit.
    writeFileIn(join(world.repo, ".husky", "pre-commit"), "bun run typecheck\n", 0o644);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "tsc",
    });
    // The stub holds no `tsc`: reading it instead would answer "direct".
    // A stub with no `.husky/<name>` behind it is no hook.
    expect(hookDecision("post-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "none",
    );
  });

  test("a binary, an oversized or an unreadable hook runs direct", () => {
    const world = gitHookWorld();
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, "bun test\n\u0000\u0001binary", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
    writeFileIn(hook, `bun test\n${"#".repeat(MAX_HOOK_BYTES)}\n`, 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
    // A link to nothing: `isFile` is false, so it is no hook at all.
    symlinkSync(join(world.repo, "missing"), join(world.repo, ".git", "hooks", "commit-msg"));
    expect(hookDecision("commit-msg", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe("none");
  });

  test("a hook the project's own kind names is queued under that kind", () => {
    const world = gitHookWorld();
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-push"),
      "#!/bin/sh\nlefthook run pre-push\n",
      0o755,
    );
    const kinds = {
      ...DEFAULT_KINDS,
      checks: { match: [{ tool: "lefthook", sub: ["run"] }] },
    };
    expect(hookDecision("pre-push", world.repo, kinds, packageScripts, ENV)).toEqual({
      queue: "checks",
    });
    expect(hookDecision("pre-push", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe("direct");
  });

  // The hook lefthook writes (`lefthook install`), cut to the lines that matter and rendered for
  // `pre-push` with no rc file, no `LefthookPath` and no extension. Template:
  // https://raw.githubusercontent.com/evilmartians/lefthook/master/internal/templates/hook.tmpl
  // (fetched 2026-11-18). The word `run` is not the program's argument anywhere but in the
  // last line, where the program is the function `call_lefthook`: lefthook itself is only ever
  // run as `lefthook -h` and `lefthook "$@"`.
  const LEFTHOOK_HOOK = [
    "#!/bin/sh",
    "",
    'if [ "$LEFTHOOK" = "0" ]; then',
    "  exit 0",
    "fi",
    "",
    "call_lefthook()",
    "{",
    '  if test -n "$LEFTHOOK_BIN"',
    "  then",
    '    "$LEFTHOOK_BIN" "$@"',
    "  elif lefthook -h >/dev/null 2>&1",
    "  then",
    '    lefthook "$@"',
    "  else",
    '    dir="$(git rev-parse --show-toplevel)"',
    '    if test -f "$dir/node_modules/lefthook/bin/index.js"',
    "    then",
    '      "$dir/node_modules/lefthook/bin/index.js" "$@"',
    "    elif pnpm lefthook -h >/dev/null 2>&1",
    "    then",
    '      pnpm lefthook "$@"',
    "    else",
    '      echo "Can\'t find lefthook in PATH"',
    "    fi",
    "  fi",
    "}",
    "",
    'call_lefthook run "pre-push" "$@"',
    "",
  ].join("\n");

  test("lefthook's generated hook is queued by a kind that names the tool, not `lefthook run`", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-push"), LEFTHOOK_HOOK, 0o755);
    const named = (match: { tool: string; sub?: string[] }) => ({
      ...DEFAULT_KINDS,
      checks: { match: [match] },
    });
    const ask = (kinds: ReturnType<typeof named>) =>
      hookDecision("pre-push", world.repo, kinds, packageScripts, ENV);
    expect(ask(named({ tool: "lefthook" }))).toEqual({ queue: "checks" });
    // `lefthook run` never appears as a command of that file, so this kind does not match it.
    expect(ask(named({ tool: "lefthook", sub: ["run"] }))).toBe("direct");
    expect(ask(DEFAULT_KINDS as ReturnType<typeof named>)).toBe("direct");
  });

  // docs/jobs.md § Git hooks: the kind it shows, word for word.
  test("the documented lefthook kind queues the hook and leaves a typed install or help light", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-push"), LEFTHOOK_HOOK, 0o755);
    const kinds = {
      ...DEFAULT_KINDS,
      lefthook: { match: [{ tool: "lefthook" }], printOnly: ["-h", "--help", "install"] },
    };
    expect(hookDecision("pre-push", world.repo, kinds, packageScripts, ENV)).toEqual({
      queue: "lefthook",
    });
    const weigh = (line: string) => runWeight(line, kinds, diskWeightSource(world.repo));
    expect(weigh("lefthook install")).toEqual({ weight: "light" });
    expect(weigh("lefthook -h")).toEqual({ weight: "light" });
    expect(weigh("lefthook run pre-push")).toEqual({ weight: "heavy", kind: "lefthook" });
  });

  // `job run --hook` takes the slot for a hook; a hook that queues itself would then wait, inside
  // that slot, for its own parent's slot.
  test("a hook that already queues itself runs direct, in its own text and through a script", () => {
    const world = gitHookWorld();
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "cc-smart-dev-kit job run --kind tsc -- tsc --noEmit",
          plain: "tsc --noEmit",
        },
      }),
    );
    writeFileIn(hook, "#!/bin/sh\ncc-smart-dev-kit job run --kind test:run -- bun test\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
    writeFileIn(hook, "#!/bin/sh\nbun run typecheck\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toBe(
      "direct",
    );
    // The same script name with a plain body is still heavy.
    writeFileIn(hook, "#!/bin/sh\nbun run plain\n", 0o755);
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "tsc",
    });
  });

  // Git runs a hook at the top of the work tree, so a package script in it is the root's.
  test("the hook is judged at the top of the work tree, whichever folder the call starts in", () => {
    const world = gitHookWorld();
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    const web = join(world.repo, "web");
    mkdirSync(web);
    writeFileSync(join(web, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nbun run test\n",
      0o755,
    );
    expect(hookDecision("pre-commit", world.repo, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "test:run",
    });
    expect(hookDecision("pre-commit", web, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "test:run",
    });
  });

  test("a bare repo has no work tree: its hook is read from the folder the call starts in", () => {
    const world = gitHookWorld();
    const bare = join(tempDir("git-hooks-bare"), "origin.git");
    git(world.repo, "init", "-q", "--bare", bare);
    writeFileSync(join(bare, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    writeFileIn(join(bare, "hooks", "pre-receive"), "#!/bin/sh\nbun run test\n", 0o755);
    expect(hookDecision("pre-receive", bare, DEFAULT_KINDS, packageScripts, ENV)).toEqual({
      queue: "test:run",
    });
  });
});
