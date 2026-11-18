/**
 * `cc-smart-dev-kit job hook <name>` (`hook-command.ts`): the one line the git hook script
 * reads. Real git in temp repos; every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitHookWorld, writeFileIn } from "../testing/git-hook-world";
import { cleanGitEnv } from "../testing/temp";
import { hookAnswer, runHookCommand } from "./hook-command";

const ENV = cleanGitEnv();

/** Runs the command in `cwd` and returns what it printed, said and exited with. */
function runIt(args: string[], cwd: string): { code: number; printed: string[]; said: string[] } {
  const printed: string[] = [];
  const said: string[] = [];
  const code = runHookCommand(args, {
    cwd,
    print: (line) => printed.push(line),
    say: (line) => said.push(line),
  });
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
});
