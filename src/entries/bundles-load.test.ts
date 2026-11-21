/**
 * Every built bundle loads. A bundle is the file a machine runs, and its load order is not the
 * source's: a dynamic `import()` in a module a bundle reaches makes Bun wrap zod in lazy
 * initialisers, and a library that calls zod at the top level (the MCP SDK) then crashes at
 * load (`new ZodLazy`, `src/tasks/bundle.test.ts`). The source tests never see that, so each
 * entry is built with the build's own options (`scripts/build-entry.ts`, the one list of
 * entries) and started as a process, the way a machine starts it.
 *
 * Every entry runs its main on import, so "it loads" is shown by what its main does with no
 * input: the exit code and, where it says anything, the words. A load crash exits 1 with a
 * stack trace, which no row below expects. Nothing a bundle starts here can reach the machine:
 * a temp HOME, no tool on PATH, the live-router port guard, and no server left running.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { buildEntry, entryPoints } from "../../scripts/build-entry";
import { routerPaths } from "../gateway/paths";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";

/** How long one bundle gets to answer. Every one answers in well under a second. */
const RUN_LIMIT_MS = 15_000;

interface Expectation {
  /** What the bundle gets on its command line. */
  args?: string[];
  /** The exit code its main ends with when it gets no input. */
  code: number;
  /** Words its main prints (stdout and stderr together), when it prints any. */
  said?: RegExp;
  /** Prepares the temp HOME before the run; the function it returns undoes it. */
  setup?: (home: string) => () => void;
}

/** A hook's frame given no input: it says so and exits 0, never failing a person's work. */
const HOOK: Expectation = { code: 0, said: /the hook input is not JSON/ };

/**
 * What each bundle that is not a plain hook does with no input. A bundle with no row is read
 * as a hook, so a new entry that is not one fails here until it is given its row.
 */
const OTHERS: Record<string, Expectation> = {
  // The hook that never speaks on input it cannot read.
  "job-route": { code: 0 },
  // Not a program: it exports the config parsers and runs nothing.
  "config-check": { code: 0 },
  // Prints help with no command.
  cli: { code: 0, said: /Usage: .* <command>/ },
  // Reads its input, finds none, and prints nothing.
  "playwright-output": { code: 0 },
  // A server with no way to stay out of a port, so it is given a bad option and refuses it.
  portal: { args: ["--bogus"], code: 2, said: /Unknown option: --bogus/ },
  // Serves on the port in its config. The port is one the test holds, so it starts, finds
  // the port taken and exits: no router is left running.
  router: {
    code: 1,
    said: /Failed to start server/,
    setup: (home) => {
      const held = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
      const { gatewayConfigFile } = routerPaths({ HOME: home });
      mkdirSync(dirname(gatewayConfigFile), { recursive: true });
      writeFileSync(gatewayConfigFile, JSON.stringify({ port: held.port }));
      chmodSync(gatewayConfigFile, 0o600);
      return () => void held.stop(true);
    },
  },
  // A stdio server: its input ends at once, and it ends.
  "tasks-mcp": { code: 0 },
  // `--background` is the check in this process, where a plain run starts a detached one.
  "update-check": { args: ["--background"], code: 0 },
  "worktrees-clean": { code: 2, said: /worktrees clean: expected <repo>/ },
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanups.splice(0)) undo();
});

describe("every built bundle loads and runs its main", () => {
  const entries = entryPoints();

  test("each row names an entry that exists", () => {
    const names = entries.map((entry) => basename(entry, ".ts"));
    expect(Object.keys(OTHERS).filter((name) => !names.includes(name))).toEqual([]);
  });

  test.each(entries.map((entry) => [basename(entry, ".ts"), entry] as const))(
    "%s",
    async (name, entry) => {
      const want = OTHERS[name] ?? HOOK;
      const built = tempDir("bundle");
      await buildEntry(entry, built);

      const home = tempDir("bundle-home");
      if (want.setup !== undefined) cleanups.push(want.setup(home));
      const guard = subprocessGuard();
      const child = Bun.spawn(
        [process.execPath, ...guard.args, join(built, `${name}.js`), ...(want.args ?? [])],
        {
          cwd: home,
          env: {
            ...cleanGitEnv(),
            ...guard.env,
            HOME: home,
            CLAUDE_CONFIG_DIR: join(home, ".claude"),
            // A folder with nothing in it: no real gh, git or claude to run by accident.
            PATH: tempDir("bundle-path"),
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const timer = setTimeout(() => child.kill(), RUN_LIMIT_MS);
      const code = await child.exited;
      clearTimeout(timer);
      const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`;

      expect({ code, output }).toMatchObject({
        code: want.code,
        output: expect.stringMatching(want.said ?? /^/),
      });
    },
  );
});
