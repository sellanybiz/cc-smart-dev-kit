/**
 * `cc-smart-dev-kit job hook <name>` (`hook-command.ts`): the one line the git hook script
 * reads. Real git in temp repos; every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitHookWorld, writeFileIn } from "../testing/git-hook-world";
import { cleanGitEnv, tempDir } from "../testing/temp";
import { hookAnswer, runHookCommand } from "./hook-command";

const ENV = cleanGitEnv();

/** Runs the command in `cwd` and returns what it printed, said and exited with. */
function runIt(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = ENV,
): { code: number; printed: string[]; said: string[] } {
  const printed: string[] = [];
  const said: string[] = [];
  const code = runHookCommand(
    args,
    { cwd, print: (line) => printed.push(line), say: (line) => said.push(line) },
    env,
  );
  return { code, printed, said };
}

describe("job hook", () => {
  test("prints queue <kind> for a heavy hook, and direct for a light one, exit 0", () => {
    const world = gitHookWorld();
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, "#!/bin/sh\nbun test\n", 0o755);
    expect(hookAnswer("pre-commit", world.repo, ENV)).toBe("queue test:run");
    writeFileIn(hook, "#!/bin/sh\nbunx biome check .\n", 0o755);
    expect(hookAnswer("pre-commit", world.repo, ENV)).toBe("direct");
  });

  test("a package script in the hook is followed into its body", () => {
    const world = gitHookWorld();
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
    );
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-push"),
      "#!/bin/sh\nbun run typecheck\n",
      0o755,
    );
    expect(hookAnswer("pre-push", world.repo, ENV)).toBe("queue tsc");
  });

  test("the project's own kind from .claude/cc-smart-dev-kit.json is used", () => {
    const world = gitHookWorld();
    mkdirSync(join(world.repo, ".claude"));
    writeFileSync(
      join(world.repo, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({
        jobs: { kinds: { checks: { match: [{ tool: "lefthook", sub: ["run"] }] } } },
      }),
    );
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-push"),
      "#!/bin/sh\nlefthook run pre-push\n",
      0o755,
    );
    expect(hookAnswer("pre-push", world.repo, ENV)).toBe("queue checks");
  });

  test("no hook, an unknown name and a missing name all answer direct", () => {
    const world = gitHookWorld();
    expect(hookAnswer("pre-commit", world.repo, ENV)).toBe("direct");
    writeFileIn(join(world.repo, ".git", "hooks", "bun-test"), "#!/bin/sh\nbun test\n", 0o755);
    expect(hookAnswer("bun-test", world.repo, ENV)).toBe("direct");
    expect(hookAnswer("../hooks/pre-commit", world.repo, ENV)).toBe("direct");
    expect(hookAnswer(undefined, world.repo, ENV)).toBe("direct");
  });

  test("the command prints exactly one line and exits 0", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    expect(runIt(["pre-commit"], world.repo)).toEqual({
      code: 0,
      printed: ["queue test:run"],
      said: [],
    });
    expect(runIt([], world.repo)).toEqual({ code: 0, printed: ["direct"], said: [] });
  });

  test("a project file that cannot be read answers direct, exit 0, with one line on stderr", () => {
    const world = gitHookWorld();
    mkdirSync(join(world.repo, ".claude"));
    writeFileSync(join(world.repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    const result = runIt(["pre-commit"], world.repo);
    expect(result.code).toBe(0);
    expect(result.printed).toEqual(["direct"]);
    expect(result.said).toHaveLength(1);
    expect(result.said[0]).toContain("the hook runs as it is");
  });

  test("a core.hooksPath in the machine's own global git config does not change the answer", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    const global = join(world.home, "gitconfig");
    writeFileSync(global, "[core]\n\thooksPath = /nowhere/hooks\n");
    const saved = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = global;
    try {
      // The command is handed the clean environment, so the process's own variable never counts.
      expect(runIt(["pre-commit"], world.repo).printed).toEqual(["queue test:run"]);
      // And the proof that it would count: handed the process's environment, the answer moves.
      expect(runIt(["pre-commit"], world.repo, process.env).printed).toEqual(["direct"]);
    } finally {
      if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved;
    }
  });

  test("the question for the hooks folder is bounded by the budget too, and a timeout there says so", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    // A `git` that answers everything but the question for the hooks folder, which it never does.
    const real = Bun.which("git") ?? "git";
    const fake = join(tempDir("hook-hang"), "bin");
    writeFileIn(
      join(fake, "git"),
      `#!/bin/sh\ncase "$*" in *--git-path*) exec sleep 30 ;; esac\nexec ${real} "$@"\n`,
      0o755,
    );
    const env = {
      ...ENV,
      PATH: `${fake}:${ENV.PATH ?? ""}`,
      CC_SMART_DEV_KIT_GUARD_BUDGET_MS: "2600",
    };
    const started = Date.now();
    const result = runIt(["pre-commit"], world.repo, env);
    // About 0.6 s of the budget is left for that call; the fixed 5 s limit would show here.
    expect(Date.now() - started).toBeLessThan(3_500);
    expect(result.code).toBe(0);
    expect(result.printed).toEqual(["direct"]);
    expect(result.said).toHaveLength(1);
    expect(result.said[0]).toContain("git did not answer in time");
    expect(result.said[0]).toContain("the hook runs as it is");
  });

  test("a git that hangs is stopped within the budget: direct, with one line, never a hung commit", () => {
    const world = gitHookWorld();
    writeFileIn(join(world.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nbun test\n", 0o755);
    // A `git` first on PATH that sleeps; `exec` so the sleeper is the process that is stopped.
    const fake = join(tempDir("hook-hang"), "bin");
    writeFileIn(join(fake, "git"), "#!/bin/sh\nexec sleep 30\n", 0o755);
    // A 2.6 s budget less the 2 s margin leaves each call about 0.6 s.
    const env = {
      ...ENV,
      PATH: `${fake}:${ENV.PATH ?? ""}`,
      CC_SMART_DEV_KIT_GUARD_BUDGET_MS: "2600",
    };
    const started = Date.now();
    const result = runIt(["pre-commit"], world.repo, env);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.code).toBe(0);
    expect(result.printed).toEqual(["direct"]);
    expect(result.said).toHaveLength(1);
  });
});
