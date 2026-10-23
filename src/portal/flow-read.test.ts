import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { testPortalContext } from "./api/test-context";
import { FLOW_FRESH_MS, openWaitsOffLoop, readFlowOffLoop } from "./flow-read";

const DAY_MS = 86_400_000;

/**
 * A plugin folder whose `dist/cli.js` stands in for the CLI's `report --json`: it logs each run
 * (its arguments and the two paths it was given) and answers as `FLOW_MODE` says.
 */
function fakePlugin(): { folder: string; log: string } {
  const folder = tempDir("plugin");
  const log = join(folder, "runs.log");
  mkdirSync(join(folder, "dist"), { recursive: true });
  writeFileSync(join(folder, "bunfig.toml"), "");
  writeFileSync(
    join(folder, "dist", "cli.js"),
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), config: process.env.CLAUDE_CONFIG_DIR, home: process.env.HOME }) + "\\n");
const mode = process.env.FLOW_MODE;
if (mode === "fail") { console.error("a first line\\nthe last line says why"); process.exit(3); }
if (mode === "garbage") { console.log("not json"); process.exit(0); }
if (mode === "renamed") { console.log(JSON.stringify({ hours: [], open: [{ asked: "Claude Code", at: 5, cwd: null, kind: null, project: "p", session: "s1", tool: "Bash" }], sessions: [], sinceMs: 1, untilMs: 2 })); process.exit(0); }
if (mode === "older") { console.log(JSON.stringify({ open: [], sessions: [], sinceMs: 1, untilMs: 2 })); process.exit(0); }
if (mode === "slow") await Bun.sleep(1500);
console.log(JSON.stringify({ open: [{ asker: "Claude Code", at: 5, cwd: null, kind: null, project: "p", session: "s1", tool: "Bash" }], sessions: [], sinceMs: 1, totals: {}, untilMs: 2, hours: [] }));
`,
  );
  return { folder, log };
}

function runsOf(log: string): { args: string[]; config: string; home: string }[] {
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
    .map((line) => JSON.parse(line));
}

function world(mode: string, clock: { now: number } = { now: 1_000_000 }) {
  const home = tempDir("home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, "claude-config"), HOME: home });
  const plugin = fakePlugin();
  const ctx = testPortalContext(
    paths,
    // A HOME the child must not take: it reads the portal's own paths.
    { FLOW_MODE: mode, HOME: "/home/user", PATH: process.env.PATH ?? "" },
    () => clock.now,
    { pluginFolder: () => ({ folder: plugin.folder }) },
  );
  return { clock, ctx, home, paths, plugin };
}

describe("the flow report, off the server's loop", () => {
  test("runs the CLI's own report --json with the window in hours and the portal's own paths", async () => {
    const w = world("ok");
    const read = await readFlowOffLoop(w.ctx, DAY_MS);
    // The child's answer, as it printed it: nothing added, nothing dropped.
    expect(JSON.parse(JSON.stringify(read))).toEqual({
      report: {
        hours: [],
        open: [
          {
            asker: "Claude Code",
            at: 5,
            cwd: null,
            kind: null,
            project: "p",
            session: "s1",
            tool: "Bash",
          },
        ],
        sessions: [],
        sinceMs: 1,
        totals: {},
        untilMs: 2,
      },
    });
    expect(runsOf(w.plugin.log)).toEqual([
      {
        args: ["report", "--hours", "24", "--json"],
        config: w.paths.claudeConfigDir,
        home: w.home,
      },
    ]);
  });

  test("the open waits are the report's own", async () => {
    const w = world("ok");
    expect(await openWaitsOffLoop(w.ctx, DAY_MS)).toEqual({
      open: [
        {
          asker: "Claude Code",
          at: 5,
          cwd: null,
          kind: null,
          project: "p",
          session: "s1",
          tool: "Bash",
        },
      ],
    });
  });

  test("a report that fails says its exit and its last line", async () => {
    const w = world("fail");
    expect(await readFlowOffLoop(w.ctx, DAY_MS)).toEqual({
      error: "the flow report did not run (exit 3): the last line says why",
    });
  });

  test("an answer that is not a report is refused in words", async () => {
    const w = world("garbage");
    expect(await readFlowOffLoop(w.ctx, DAY_MS)).toEqual({
      error: "the flow report's answer was not one this portal reads",
    });
  });

  test("a report without the hours this portal draws (an older CLI) is refused, never drawn", async () => {
    const w = world("older");
    expect(await readFlowOffLoop(w.ctx, DAY_MS)).toEqual({
      error: "the flow report's answer was not one this portal reads",
    });
  });

  test("a prompt whose fields a newer CLI renamed is refused, never drawn as blanks", async () => {
    const w = world("renamed");
    expect(await readFlowOffLoop(w.ctx, DAY_MS)).toEqual({
      error: "the flow report's answer was not one this portal reads",
    });
  });

  test("no plugin folder: its own reason, and nothing runs", async () => {
    const w = world("ok");
    const ctx = { ...w.ctx, pluginFolder: () => ({ error: "the plugin is not installed" }) };
    expect(await readFlowOffLoop(ctx, DAY_MS)).toEqual({ error: "the plugin is not installed" });
    expect(runsOf(w.plugin.log)).toEqual([]);
  });

  test("requests at once share one run; a fresh answer is reused, an old one is not", async () => {
    const w = world("ok");
    const [a, b] = await Promise.all([
      readFlowOffLoop(w.ctx, DAY_MS),
      readFlowOffLoop(w.ctx, DAY_MS),
    ]);
    expect(a).toEqual(b);
    expect(runsOf(w.plugin.log)).toHaveLength(1);
    // Another window is its own run.
    await readFlowOffLoop(w.ctx, 2 * DAY_MS);
    expect(runsOf(w.plugin.log).map((run) => run.args[2])).toEqual(["24", "48"]);
    w.clock.now += FLOW_FRESH_MS - 1;
    await readFlowOffLoop(w.ctx, DAY_MS);
    expect(runsOf(w.plugin.log)).toHaveLength(2);
    w.clock.now += 1;
    await readFlowOffLoop(w.ctx, DAY_MS);
    expect(runsOf(w.plugin.log)).toHaveLength(3);
  });

  test("a failure is not kept: the next request runs again", async () => {
    const w = world("fail");
    await readFlowOffLoop(w.ctx, DAY_MS);
    await readFlowOffLoop(w.ctx, DAY_MS);
    expect(runsOf(w.plugin.log)).toHaveLength(2);
  });

  test("a slow report is shared past the fresh time, and its answer is fresh from its arrival", async () => {
    // A cold read on a big machine takes seconds. The clock moves past `FLOW_FRESH_MS` while the
    // child is out: a second request must wait on the same child (not start a second full scan
    // of the transcripts), and the answer that lands then is good for `FLOW_FRESH_MS` from
    // its arrival, not from the spawn — or it would be stale as it came and every poll would
    // start another child.
    const w = world("slow");
    const first = readFlowOffLoop(w.ctx, DAY_MS);
    w.clock.now += FLOW_FRESH_MS + 1;
    const second = readFlowOffLoop(w.ctx, DAY_MS);
    expect(second).toBe(first);
    expect("report" in (await first)).toBe(true);
    w.clock.now += FLOW_FRESH_MS - 1;
    await readFlowOffLoop(w.ctx, DAY_MS);
    expect(runsOf(w.plugin.log)).toHaveLength(1);
  });

  test("the server's loop stays free while a slow report runs", async () => {
    const w = world("slow");
    const started = performance.now();
    let firedAfter = Number.POSITIVE_INFINITY;
    setTimeout(() => {
      firedAfter = performance.now() - started;
    }, 10);
    const read = readFlowOffLoop(w.ctx, DAY_MS);
    await Bun.sleep(300);
    // A synchronous read would hold the loop for the child's 1.5 s: the timer could not fire.
    expect(firedAfter).toBeLessThan(300);
    expect("report" in (await read)).toBe(true);
  });
});
