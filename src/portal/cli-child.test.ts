/**
 * The portal's one spawn of the CLI (`cli-child.ts`) and the short cache both of its readers
 * share: what the child is given (the plugin's two bun flags, the portal's own paths, no crew
 * marker), the words a failed run is shown in, and the cache's three rules.
 *
 * A temp plugin folder's `dist/cli.js` stands in for the CLI: it logs what it was given and
 * answers as `CHILD_MODE` says. No real CLI, no real git.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { testPortalContext } from "./api/test-context";
import { runCliChild, runCliChildText, shortCache } from "./cli-child";
import type { PortalContext } from "./context";

interface Run {
  args: string[];
  crew: null | string;
  config: null | string;
  cwd: string;
  dotenv: null | string;
  execArgv: string[];
  home: null | string;
}

/** A plugin folder whose fake CLI logs each run, then answers as `CHILD_MODE` says. */
function fakePlugin(): { folder: string; runs: () => Run[] } {
  const folder = tempDir("cli-child-plugin");
  const log = join(folder, "runs.log");
  mkdirSync(join(folder, "dist"), { recursive: true });
  writeFileSync(join(folder, "bunfig.toml"), "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args: process.argv.slice(2),
  config: process.env.CLAUDE_CONFIG_DIR ?? null,
  crew: process.env.CC_SMART_DEV_KIT_CREW ?? null,
  cwd: process.cwd(),
  dotenv: process.env.CLI_CHILD_DOTENV ?? null,
  execArgv: process.execArgv,
  home: process.env.HOME ?? null,
}) + "\\n");
if (process.env.CHILD_MODE === "fail") { console.error("a first line\\nthe last line says why"); process.exit(3); }
if (process.env.CHILD_MODE === "silent-fail") process.exit(4);
if (process.env.CHILD_MODE === "kill") process.kill(process.pid, "SIGKILL");
if (process.env.CHILD_MODE === "sleep") await Bun.sleep(5_000);
console.log("first line");
console.log("second line");
`,
  );
  return {
    folder,
    runs: () => {
      let text = "";
      try {
        text = readFileSync(log, "utf8");
      } catch {
        return [];
      }
      return text
        .trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Run);
    },
  };
}

/** A portal whose environment is deliberately NOT the paths it is given. */
function world(env: Record<string, string> = {}) {
  const home = tempDir("cli-child-home");
  const config = tempDir("cli-child-config");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: config, HOME: home });
  const plugin = fakePlugin();
  const ctx = testPortalContext(
    paths,
    {
      // A HOME and a crew marker the child must NOT take from the portal's environment.
      CC_SMART_DEV_KIT_CREW: "1",
      HOME: "/home/user",
      PATH: process.env.PATH ?? "",
      ...env,
    },
    () => 1_000,
    { pluginFolder: () => ({ folder: plugin.folder }) },
  );
  return { config, ctx, home, paths, plugin };
}

describe("the CLI child", () => {
  test("the plugin's two bun flags, the portal's own paths, and no crew marker, for a read", async () => {
    const w = world();
    const read = await runCliChildText(w.ctx, ["report", "--json"], { subject: "the thing" });
    expect(read).toEqual({ output: "first line\nsecond line\n" });
    expect(w.plugin.runs()).toEqual([
      {
        args: ["report", "--json"],
        config: w.config,
        crew: null,
        // The portal's own home folder, as a child with no `cwd` of its own starts in.
        cwd: realpathSync(w.home),
        dotenv: null,
        execArgv: ["--no-env-file", `--config=${join(w.plugin.folder, "bunfig.toml")}`],
        home: w.home,
      },
    ]);
  });

  test("an action's run gets the same child: the flags, the paths, no crew marker, its lines", async () => {
    const w = world();
    const seen: string[] = [];
    const run = await runCliChild(w.ctx, ["crew", "stop", "abc"], {
      cwd: null,
      onLine: (line) => seen.push(line),
    });
    expect(run).toEqual({
      error: null,
      exitCode: 0,
      lines: ["first line", "second line"],
      timedOut: false,
    });
    expect(seen).toEqual(["first line", "second line"]);
    const [only, ...rest] = w.plugin.runs();
    expect(rest).toEqual([]);
    expect(only?.args).toEqual(["crew", "stop", "abc"]);
    expect(only?.config).toBe(w.config);
    expect(only?.home).toBe(w.home);
    expect(only?.crew).toBe(null);
    expect(only?.execArgv).toEqual([
      "--no-env-file",
      `--config=${join(w.plugin.folder, "bunfig.toml")}`,
    ]);
  });

  test("a folder of the caller's own is the child's: a repository, not the portal's home", async () => {
    const w = world();
    const repo = tempDir("cli-child-repo");
    await runCliChildText(w.ctx, ["worktrees", "--json"], { cwd: repo, subject: "the thing" });
    await runCliChild(w.ctx, ["crew", "rm", "abc"], { cwd: repo });
    expect(w.plugin.runs().map((run) => run.cwd)).toEqual([realpathSync(repo), realpathSync(repo)]);
  });

  test("a project's .env is never loaded into the child (--no-env-file)", async () => {
    const w = world();
    const repo = tempDir("cli-child-dotenv");
    writeFileSync(join(repo, ".env"), "CLI_CHILD_DOTENV=from-the-project\n");
    await runCliChildText(w.ctx, ["worktrees", "--json"], { cwd: repo, subject: "the thing" });
    expect(w.plugin.runs()[0]?.dotenv).toBe(null);
  });

  test("a read that exits non-zero says its subject, its exit and its last line", async () => {
    const w = world({ CHILD_MODE: "fail" });
    expect(await runCliChildText(w.ctx, ["report"], { subject: "the flow report" })).toEqual({
      error: "the flow report did not run (exit 3): the last line says why",
    });
    // No line at all: just the exit.
    const quiet = world({ CHILD_MODE: "silent-fail" });
    expect(await runCliChildText(quiet.ctx, ["report"], { subject: "the flow report" })).toEqual({
      error: "the flow report did not run (exit 4)",
    });
  });

  test("a plugin folder that is gone: its own words, and nothing runs", async () => {
    const w = world();
    const ctx = { ...w.ctx, pluginFolder: () => ({ error: "the plugin is not installed" }) };
    expect(await runCliChildText(ctx, ["report"], { subject: "the flow report" })).toEqual({
      error: "the plugin is not installed",
    });
    expect(await runCliChild(ctx, ["crew", "stop", "abc"], { cwd: null })).toEqual({
      error: "the plugin is not installed",
      exitCode: null,
      lines: [],
      timedOut: false,
    });
    expect(w.plugin.runs()).toEqual([]);
  });

  test("a folder Bun cannot start in is a reason in the caller's words, never a throw", async () => {
    const w = world();
    const missing = join(w.home, "no-such-folder");
    const text = await runCliChildText(w.ctx, ["report"], { cwd: missing, subject: "the thing" });
    expect("error" in text ? text.error : "").toStartWith("the thing did not run: ");
    const action = await runCliChild(w.ctx, ["crew", "rm", "abc"], { cwd: missing });
    expect(action.error ?? "").toStartWith("the command did not start: ");
    expect(action.exitCode).toBe(null);
    expect(w.plugin.runs()).toEqual([]);
  });

  test("a child a signal ended says that, not a timeout; one past its time is timed out", async () => {
    // A person's `kill`, or an OOM kill: the line names the signal and does not blame slowness.
    const killed = world({ CHILD_MODE: "kill" });
    expect(await runCliChild(killed.ctx, ["crew", "rm", "abc"], { cwd: null })).toEqual({
      error: "the command was ended by a signal (SIGKILL) before it finished",
      exitCode: null,
      lines: [],
      timedOut: false,
    });
    // Past its own limit Bun ends it with SIGTERM, and that is the timeout.
    const slow = world({ CHILD_MODE: "sleep" });
    const started = performance.now();
    expect(
      await runCliChild(slow.ctx, ["crew", "rm", "abc"], { cwd: null, timeoutMs: 1_000 }),
    ).toEqual({ error: null, exitCode: null, lines: [], timedOut: true });
    expect(performance.now() - started).toBeLessThan(4_500);
  });
});

type Answer = { error: string } | { value: number };

/** A read the test finishes by hand: when it starts, and how it ends. */
function deferred() {
  let settle: (answer: Answer) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Answer>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { fail, promise, settle };
}

/** Two portals that share nothing but the clock the test moves. */
function twoPortals(clock: { now: number }): [PortalContext, PortalContext] {
  const make = () => {
    const home = tempDir("cli-child-cache");
    return testPortalContext(
      cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home }),
      { PATH: process.env.PATH ?? "" },
      () => clock.now,
    );
  };
  return [make(), make()];
}

describe("the short cache", () => {
  test("a child still on its way is shared whatever its age, and its clock starts when it arrives", async () => {
    const clock = { now: 1_000 };
    const [ctx] = twoPortals(clock);
    const cache = shortCache<string, Answer>(5_000);
    const reading = deferred();
    let starts = 0;
    const start = () => {
      starts += 1;
      return reading.promise;
    };
    const first = cache.read(ctx, "k", start);
    // A minute passes while the child is out: far more than the fresh time.
    clock.now += 60_000;
    const second = cache.read(ctx, "k", start);
    expect(second).toBe(first);
    expect(starts).toBe(1);
    reading.settle({ value: 1 });
    expect(await first).toEqual({ value: 1 });
    // It arrived at the moved clock: a read a moment short of the fresh time reuses it …
    clock.now += 4_999;
    await cache.read(ctx, "k", start);
    expect(starts).toBe(1);
    // … and one at the fresh time reads again.
    clock.now += 1;
    await cache.read(ctx, "k", () => {
      starts += 1;
      return Promise.resolve({ value: 2 });
    });
    expect(starts).toBe(2);
  });

  test("a failure is not kept: the next read starts again", async () => {
    const clock = { now: 1_000 };
    const [ctx] = twoPortals(clock);
    const cache = shortCache<string, Answer>(5_000);
    let starts = 0;
    const failing = () => {
      starts += 1;
      return Promise.resolve<Answer>({ error: "it did not run" });
    };
    expect(await cache.read(ctx, "k", failing)).toEqual({ error: "it did not run" });
    expect(await cache.read(ctx, "k", failing)).toEqual({ error: "it did not run" });
    expect(starts).toBe(2);
  });

  test("a read that throws is not kept either, and the caller still sees the throw", async () => {
    const clock = { now: 1_000 };
    const [ctx] = twoPortals(clock);
    const cache = shortCache<string, Answer>(5_000);
    const reading = deferred();
    const first = cache.read(ctx, "k", () => reading.promise);
    reading.fail(new Error("the child's pipe broke"));
    await expect(first).rejects.toThrow("the child's pipe broke");
    let starts = 0;
    await cache.read(ctx, "k", () => {
      starts += 1;
      return Promise.resolve({ value: 1 });
    });
    expect(starts).toBe(1);
  });

  test("each key and each portal has its own entry; forget drops a portal's answers", async () => {
    const clock = { now: 1_000 };
    const [one, other] = twoPortals(clock);
    const cache = shortCache<string, Answer>(5_000);
    const starts: string[] = [];
    const read = (ctx: PortalContext, key: string) =>
      cache.read(ctx, key, () => {
        starts.push(key);
        return Promise.resolve({ value: starts.length });
      });
    await read(one, "a");
    await read(one, "b");
    await read(other, "a");
    expect(starts).toEqual(["a", "b", "a"]);
    // Kept: the same key on the same portal reads nothing.
    await read(one, "a");
    expect(starts).toEqual(["a", "b", "a"]);
    // Forgotten: that portal reads again, and the other keeps its answer.
    cache.forget(one);
    await read(one, "a");
    await read(other, "a");
    expect(starts).toEqual(["a", "b", "a", "a"]);
  });
});
