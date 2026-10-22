/**
 * `cc-smart-dev-kit crew …` through the CLI's own entry, as its own process: the dispatch line,
 * and the real readers of the process tree. The test process is the CLI's parent, so a session
 * record under the test's pid makes the test the "Claude Code session" the CLI finds (L1a.1
 * P13's shape). A PATH of fakes: bun's folder, git's, and the fake `claude`. No real session.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { crewWorld, SHORT_ID, writeSessionRecord } from "../testing/crew-world";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { listCrew, readLead } from "./store";
import { BOARD_COMMANDS } from "./usage";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/** Runs the CLI in `cwd` with `env`; its exit code and both outputs. */
function cli(args: string[], cwd: string, env: Record<string, string>) {
  const guard = subprocessGuard();
  const run = Bun.spawnSync([process.execPath, ...guard.args, CLI, ...args], {
    cwd,
    env: { ...env, ...guard.env },
    stderr: "pipe",
    stdout: "pipe",
  });
  return { code: run.exitCode, err: run.stderr.toString(), out: run.stdout.toString() };
}

describe("crew through the CLI", () => {
  // The real process readers: /proc on Linux, ps on macOS. Windows runs it in its own CI job.
  const unix = process.platform === "linux" || process.platform === "darwin";

  test.if(unix)("crew lead, then crew start: the session found above the CLI", async () => {
    const world = crewWorld();
    world.writeConfig({ memoryGb: 0.001 });
    const sessionId = "e22fabc7-1111-2222-3333-444444444444";
    writeSessionRecord(world.paths, process.pid, sessionId, world.repo);
    const env = {
      ...cleanGitEnv(),
      FAKE_CLAUDE_LOG: join(world.bin, "calls.log"),
      FAKE_CLAUDE_STATE: join(world.bin, "state"),
      HOME: world.home,
      PATH: [
        world.bin,
        dirname(process.execPath),
        dirname(Bun.which("git") ?? "/usr/bin/git"),
      ].join(":"),
    };
    const lead = cli(["crew", "lead", "--plan", "master-plan"], world.repo, env);
    expect(lead.err).toBe("");
    expect(lead.code).toBe(0);
    expect(lead.out.split("\n")[1]).toBe("/rename LEAD my-app master-plan");
    expect(readLead(world.paths.stateDir, world.repo, sessionId)?.name).toBe(
      "LEAD my-app master-plan",
    );

    const brief = join(tempDir("brief"), "brief.md");
    writeFileSync(brief, "Do the phase.\n");
    const head = git(world.repo, "rev-parse", "--short=7", "HEAD").trim();
    const started = cli(
      ["crew", "start", "B1", "--slug", "help", "--kind", "docs", "--brief", brief],
      world.repo,
      env,
    );
    expect(started.err).toBe("");
    expect(started.code).toBe(0);
    expect(started.out).toBe(
      `started C my-app B1 help (${SHORT_ID}) · sonnet high · crew/B1-help @ ${head}\n`,
    );
    const [record] = listCrew(world.paths.stateDir, world.repo).records;
    expect(record?.state).toBe("working");
    expect(readFileSync(join(world.bin, "calls.log"), "utf8")).toContain(
      "--bg\n-w\ncrew-B1-help\n",
    );
  });

  test("crew with no command: exit 2 and the help line", () => {
    const home = tempDir("home");
    const run = cli(["crew"], home, { HOME: home, PATH: dirname(process.execPath) });
    expect(run.code).toBe(2);
    expect(run.err).toBe("Say which crew command\nSee: cc-smart-dev-kit crew --help\n");
  });

  test("the board through the CLI: kinds and `list --all` need no project; `list` does; help is per command", () => {
    const home = tempDir("home");
    const env = {
      HOME: home,
      PATH: [dirname(process.execPath), dirname(Bun.which("git") ?? "/usr/bin/git")].join(":"),
    };
    const kinds = cli(["crew", "kinds"], home, env);
    expect(kinds.code).toBe(0);
    expect(kinds.err).toBe("");
    expect(kinds.out.split("\n")[0]).toBe(
      "kind          model   effort on Claude  effort on a slot  for",
    );
    const all = cli(["crew", "list", "--all"], home, env);
    expect([all.code, all.err, all.out]).toEqual([0, "", "No crew sessions on this machine.\n"]);
    const outside = cli(["crew", "list"], home, env);
    expect(outside.code).toBe(1);
    expect(outside.err).toBe(
      "crew list: this folder is not in a git project\nFix: run it in the project's folder, or add --all\n",
    );
    const help = cli(["crew", "rm", "--help"], home, env);
    expect(help.code).toBe(0);
    expect(help.out).toStartWith(`Usage: ${COMMAND} crew rm <name|id>`);
    const mistake = cli(["crew", "stop"], home, env);
    expect(mistake.code).toBe(2);
    expect(mistake.err).toBe(
      `Say which crew session: crew stop <name|id>\nSee: ${COMMAND} crew stop --help\n`,
    );
  });

  test("crew --help: every command is named, and the fallback where the monitors do not run", () => {
    const home = tempDir("home");
    const env = { HOME: home, PATH: dirname(process.execPath) };
    const run = cli(["crew", "--help"], home, env);
    expect(run.code).toBe(0);
    for (const command of [
      "lead",
      "start",
      "step",
      "report",
      "answer",
      "watch",
      "self-watch",
      ...BOARD_COMMANDS.map((one) => one.name),
    ]) {
      expect(run.out).toContain(command);
    }
    // The fallback is named where the lead reads it: the watch's own help.
    expect(run.out).toContain("crew watch --once");
    expect(run.out).toContain("telemetry off");
  });
});
