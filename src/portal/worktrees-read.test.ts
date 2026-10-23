/**
 * The worktrees read off the server's loop (`worktrees-read.ts`): the CLI's own
 * `worktrees --json` in a child, one child shared by the requests that ask at once, the answer
 * kept for `WORKTREES_FRESH_MS`, a failure not kept, and an action that changes worktrees
 * dropping the kept answer.
 *
 * A temp plugin folder's `dist/cli.js` stands in for the CLI: it logs each run and prints one
 * answer. No real git, no real repository.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { cleanGitEnv, tempDir } from "../testing/temp";
import type { WorktreesAnswer } from "../worktrees/command";
import { testPortalContext } from "./api/test-context";
import type { PortalContext } from "./context";
import { forgetWorktrees, readWorktreesOffLoop, WORKTREES_FRESH_MS } from "./worktrees-read";

const ANSWER: WorktreesAnswer = {
  autoClean: null,
  base: "main",
  from: "config",
  note: null,
  worktrees: [],
};

/** A portal whose plugin folder holds a fake CLI that logs each run and prints `ANSWER`. */
function world(): {
  ctx: PortalContext;
  home: string;
  runs: () => string[];
  /** Moves the clock the cache reads, past the kept answer's life. */
  tick: (ms: number) => void;
} {
  const folder = tempDir("plugin-worktrees");
  const home = tempDir("worktrees-home");
  mkdirSync(join(folder, "dist"), { recursive: true });
  writeFileSync(join(folder, "bunfig.toml"), "");
  const log = join(folder, "runs.log");
  writeFileSync(log, "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, "run\\n");
console.log(JSON.stringify(${JSON.stringify(ANSWER)}));
`,
  );
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  let now = 1_000;
  const ctx = testPortalContext(
    paths,
    { ...cleanGitEnv(), HOME: home, PATH: process.env.PATH ?? "" },
    () => now,
    { pluginFolder: () => ({ folder }) },
  );
  return {
    ctx,
    home,
    runs: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter((one) => one !== ""),
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("the worktrees read off the loop", () => {
  test("requests at once share one child, and the answer is kept for its fresh time", async () => {
    const w = world();
    const [first, second] = await Promise.all([
      readWorktreesOffLoop(w.ctx, w.home),
      readWorktreesOffLoop(w.ctx, w.home),
    ]);
    expect(first).toEqual({ answer: ANSWER });
    expect(second).toEqual({ answer: ANSWER });
    expect(w.runs()).toEqual(["run"]);
    // Within the fresh time the kept answer answers again, with no second child.
    await readWorktreesOffLoop(w.ctx, w.home);
    expect(w.runs()).toEqual(["run"]);
    // Past it, the read scans again.
    w.tick(WORKTREES_FRESH_MS + 1);
    await readWorktreesOffLoop(w.ctx, w.home);
    expect(w.runs()).toEqual(["run", "run"]);
  });

  test("an action that changes worktrees drops the kept answer", async () => {
    const w = world();
    await readWorktreesOffLoop(w.ctx, w.home);
    forgetWorktrees(w.ctx);
    await readWorktreesOffLoop(w.ctx, w.home);
    expect(w.runs()).toEqual(["run", "run"]);
  });

  test("a child that fails answers with its reason, and the failure is not kept", async () => {
    const folder = tempDir("plugin-worktrees-broken");
    const home = tempDir("worktrees-home-broken");
    mkdirSync(join(folder, "dist"), { recursive: true });
    writeFileSync(join(folder, "bunfig.toml"), "");
    writeFileSync(
      join(folder, "dist", "cli.js"),
      'console.error("not a git project");\nprocess.exit(2);\n',
    );
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const ctx = testPortalContext(
      paths,
      { ...cleanGitEnv(), HOME: home, PATH: process.env.PATH ?? "" },
      () => 1_000,
      { pluginFolder: () => ({ folder }) },
    );
    const read = await readWorktreesOffLoop(ctx, home);
    expect(read).toEqual({ error: "the worktrees scan did not run (exit 2): not a git project" });
    // A failure is not kept: the next read runs the child again (and fails the same way).
    expect(await readWorktreesOffLoop(ctx, home)).toEqual(read);
  });
});
