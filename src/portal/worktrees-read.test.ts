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

/**
 * A portal whose plugin folder holds a fake CLI that logs each run and prints `ANSWER`; with
 * `sleepMs`, the child takes that long, so a test can move the clock while it runs.
 */
function world(sleepMs = 0): {
  ctx: PortalContext;
  home: string;
  runs: () => string[];
  /** Moves the clock the cache reads. */
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
await Bun.sleep(${sleepMs});
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

  test("a child still on its way is shared, and its answer's clock starts when it arrives", async () => {
    // The child takes 100 ms. The clock moves past the fresh window while it runs: a second
    // request must wait on the same child (a scan may take a minute), and the answer that
    // arrives then is fresh from its arrival, not from the spawn.
    const w = world(100);
    const first = readWorktreesOffLoop(w.ctx, w.home);
    w.tick(WORKTREES_FRESH_MS + 1);
    const second = readWorktreesOffLoop(w.ctx, w.home);
    expect(second).toBe(first);
    expect(await first).toEqual({ answer: ANSWER });
    // It arrived at the moved clock; a read a moment short of the window still reuses it.
    w.tick(WORKTREES_FRESH_MS - 1);
    await readWorktreesOffLoop(w.ctx, w.home);
    expect(w.runs()).toEqual(["run"]);
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
    // It logs each run, so a kept failure would show as one run and the test could fail.
    const log = join(folder, "runs.log");
    writeFileSync(log, "");
    writeFileSync(
      join(folder, "dist", "cli.js"),
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, "run\\n");
console.error("not a git project");
process.exit(2);
`,
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
    // A failure is not kept: the next read runs the child again, and fails the same way.
    expect(await readWorktreesOffLoop(ctx, home)).toEqual(read);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["run", "run"]);
  });

  test("a folder that is not there any more: the reason in words, never a crash", async () => {
    // A worktree a session worked in and removed: `Bun.spawn` refuses to start in a `cwd`
    // that does not exist, and the page gets a line instead of a broken request.
    const w = world();
    const read = await readWorktreesOffLoop(w.ctx, join(w.home, "no-such-worktree"));
    expect("error" in read ? read.error : "").toStartWith("the worktrees scan did not run: ");
    expect("error" in read ? read.error : "").toContain("ENOENT");
  });

  test("a child's answer that is not this portal's shape is refused, not drawn as blanks", async () => {
    // Every case a newer CLI could print: not JSON, a missing base, a worktree with no path.
    const answers = [
      "not json at all",
      JSON.stringify({
        autoClean: null,
        base: "main",
        from: "elsewhere",
        note: null,
        worktrees: [],
      }),
      JSON.stringify({
        autoClean: null,
        base: "main",
        from: "config",
        note: null,
        worktrees: [{}],
      }),
      // The last clean's record, missing the fields the page reads.
      JSON.stringify({
        autoClean: { base: 1 },
        base: "main",
        from: "config",
        note: null,
        worktrees: [],
      }),
    ];
    for (const answer of answers) {
      const folder = tempDir("plugin-worktrees-shape");
      const home = tempDir("worktrees-home-shape");
      mkdirSync(join(folder, "dist"), { recursive: true });
      writeFileSync(join(folder, "bunfig.toml"), "");
      writeFileSync(join(folder, "dist", "cli.js"), `console.log(${JSON.stringify(answer)});\n`);
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
      const ctx = testPortalContext(
        paths,
        { ...cleanGitEnv(), HOME: home, PATH: process.env.PATH ?? "" },
        () => 1_000,
        { pluginFolder: () => ({ folder }) },
      );
      expect({ answer, read: await readWorktreesOffLoop(ctx, home) }).toEqual({
        answer,
        read: { error: "the worktrees scan's answer was not one this portal reads" },
      });
    }
  });
});
