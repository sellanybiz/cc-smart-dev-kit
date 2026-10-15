/**
 * `doctor --live` with a fake `claude` first on PATH: it never reaches a model. The fake
 * plays Claude Code's part for `-p`: the plugin's SessionStart hook; then the worktree,
 * made by the project's own WorktreeCreate hook when its `.claude/settings.json` wires one
 * (run with `sh -c`, as Claude Code runs a command string), else by Claude Code itself
 * (`.claude/worktrees/<name>`); the plugin's git guard before a Bash call in that worktree;
 * then the removal, by the project's WorktreeRemove hook, else by Claude Code. So the check
 * reads real hook runs from the log. The test HOME holds a launcher that runs this repo's CLI.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";
import {
  LIVE_NAME,
  type LiveDeps,
  type LiveRunner,
  liveHookCommand,
  liveRecordFile,
  parseClaudeVersion,
  readLiveRecord,
  runLiveCheck,
} from "./live-check";
import { cliPaths } from "./paths";

const ENTRIES = join(import.meta.dir, "..", "entries");

/**
 * The fake claude, as a bun script. FAKE_CLAUDE_MODE: "play" does it all; "nothing" runs no
 * hook and makes no worktree; "keep" removes nothing; "stay" never enters the worktree.
 */
const FAKE = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE;
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") { console.log("2.1.300 (Claude Code)"); process.exit(0); }
if (mode === "nothing") { console.log("done"); process.exit(0); }
const cwd = process.cwd();
const env = process.env;
const guardArgs = (env.FAKE_GUARD_ARGS ?? "").split(" ").filter(Boolean);
const spawn = (argv, at, input) => Bun.spawnSync(argv, {
  cwd: at, env, stdin: Buffer.from(JSON.stringify(input ?? {})), stdout: "pipe", stderr: "pipe",
});
const plugin = (name, input, at) => spawn(["bun", ...guardArgs, env.FAKE_ENTRIES + "/" + name + ".ts"], at, input);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(cwd + "/.claude/settings.json", "utf8")); } catch {}
const project = (event, input, at) => {
  const handler = settings.hooks?.[event]?.[0]?.hooks?.[0];
  if (!handler) return null;
  const r = spawn(["sh", "-c", handler.command], at, input);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const git = (at, ...a) => spawn(["git", ...a], at);
const name = /name "([^"]+)"/.exec(args.at(-1))[1];
plugin("worktree-leftovers", { hook_event_name: "SessionStart", session_id: "s", cwd, source: "startup" }, cwd);
let folder;
const made = project("WorktreeCreate", { hook_event_name: "WorktreeCreate", session_id: "s", cwd, name }, cwd);
if (made === null) {
  folder = cwd + "/.claude/worktrees/" + name;
  git(cwd, "worktree", "add", "-q", "-b", "worktree-" + name, folder);
} else if (made.code !== 0) {
  console.log("WorktreeCreate failed: " + made.err);
  process.exit(1);
} else {
  folder = made.out;
}
const at = mode === "stay" ? cwd : folder;
plugin("git-guard", { hook_event_name: "PreToolUse", session_id: "s", cwd: at, tool_name: "Bash", tool_input: { command: "git status" } }, at);
if (mode !== "keep") {
  const removed = project("WorktreeRemove", { hook_event_name: "WorktreeRemove", session_id: "s", cwd: folder, worktree_path: folder }, folder);
  if (removed === null) {
    git(cwd, "worktree", "remove", folder);
    git(cwd, "branch", "-D", "worktree-" + name);
  }
}
console.log("done");
`;

function fakeClaude(mode: "play" | "nothing" | "keep" | "stay") {
  const home = tempDir("live-home");
  const bin = tempDir("live-bin");
  const script = join(bin, "fake-claude.js");
  writeFileSync(script, FAKE);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec bun "${script}" "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const guard = subprocessGuard();
  // The launcher a project's hooks run: here, this repo's CLI.
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(
    join(home, ".local", "bin", "anymodel"),
    `#!/bin/sh\nexec bun ${guard.args.join(" ")} "${join(ENTRIES, "cli.ts")}" "$@"\n`,
  );
  chmodSync(join(home, ".local", "bin", "anymodel"), 0o755);
  const calls = join(bin, "calls.log");
  const env: Record<string, string> = {
    ...cleanGitEnv(),
    ...guard.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_CLAUDE_MODE: mode,
    FAKE_CLAUDE_LOG: calls,
    FAKE_ENTRIES: ENTRIES,
    FAKE_GUARD_ARGS: guard.args.join(" "),
  };
  // The settings the live check wrote into the temp repo, as they were when a session ran
  // there: the check removes the temp folder, so they are read on the way past.
  const settings: string[] = [];
  const run: LiveRunner = (argv, { cwd, env: runEnv, timeoutMs }) => {
    if (argv[0] === "claude") {
      const written = join(cwd, ".claude", "settings.json");
      if (existsSync(written)) settings.push(readFileSync(written, "utf8"));
    }
    const result = Bun.spawnSync(argv, {
      cwd,
      env: runEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };
  // What production passes: this plugin under test, never the installed launcher. Here that
  // is this repo's CLI, through the launcher file the fake HOME holds.
  const deps: LiveDeps = {
    pluginDir: "/plugins/anymodel",
    hookCommand: (name) => `${join(home, ".local", "bin", "anymodel")} hook ${name}`,
    run,
  };
  return { env, run, calls, settings, paths: cliPaths(env), deps };
}

const shown = (lines: Array<{ ok: boolean; text: string }>) =>
  lines.map((line) => `${line.ok ? "✓" : "✗"} ${line.text.replace(/\/[^ ]*\//g, "…/")}`);

describe("doctor --live", () => {
  test("a Claude Code that runs the hooks: every check passes, and the version is recorded", () => {
    const { env, calls, settings, paths, deps } = fakeClaude("play");
    const lines = runLiveCheck(paths, env, deps);
    expect(shown(lines)).toEqual([
      "✓ live, Claude Code's worktrees: the hooks fired (SessionStart, PreToolUse)",
      "✓ live, Claude Code's worktrees: the git guard read the command line (it parsed git) before the Bash call",
      `✓ live, Claude Code's worktrees: no WorktreeCreate hook ran; Claude Code made …/${LIVE_NAME}, and the session worked there`,
      `✓ live, Claude Code's worktrees: ExitWorktree removed the folder and the branch worktree-${LIVE_NAME}`,
      "✓ live, the worktree engine: the hooks fired (SessionStart, WorktreeCreate, PreToolUse, WorktreeRemove)",
      "✓ live, the worktree engine: the git guard read the command line (it parsed git) before the Bash call",
      `✓ live, the worktree engine: WorktreeCreate made …/live-wt-${LIVE_NAME}, and the session worked there`,
      `✓ live, the worktree engine: WorktreeRemove removed the folder and the branch ${LIVE_NAME}`,
      "✓ live: passed on Claude Code 2.1.300; recorded",
    ]);
    expect(readLiveRecord(paths.stateDir)).toEqual({
      claudeCode: "2.1.300",
      plugin: VERSION,
      passedAt: expect.any(String),
    });
    // The engine's repo was wired to the plugin under test (deps.hookCommand), not to the
    // installed launcher: the settings file holds that command, and no "$HOME" launcher.
    expect(settings).toHaveLength(1);
    const wired = JSON.parse(settings[0] ?? "{}") as {
      hooks?: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
    };
    const commands = Object.values(wired.hooks ?? {}).map((groups) => groups[0]?.hooks[0]);
    expect(commands.map((handler) => handler?.command)).toEqual([
      deps.hookCommand("worktree-create"),
      deps.hookCommand("worktree-remove"),
      deps.hookCommand("subagent-stop"),
    ]);
    expect(commands.map((handler) => handler?.timeout)).toEqual([600, 60, 60]);
    expect(settings[0]).not.toContain("$HOME");
    // Each session: this plugin folder, three tools, permission for exactly the calls it
    // makes (no mode that skips the checks), no MCP servers, the prompt last.
    const sessions = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === "-p");
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.slice(0, -1)).toEqual([
        "-p",
        "--plugin-dir",
        "/plugins/anymodel",
        "--tools",
        "EnterWorktree,ExitWorktree,Bash",
        "--allowedTools",
        "EnterWorktree,ExitWorktree,Bash(git status:*)",
        "--strict-mcp-config",
        "--no-session-persistence",
      ]);
    }
  });

  test("a Claude Code that runs no hooks and makes no worktree: each check fails, nothing is recorded", () => {
    const { env, paths, deps } = fakeClaude("nothing");
    const lines = runLiveCheck(paths, env, deps);
    expect(lines.filter((line) => !line.ok)).toHaveLength(8);
    expect(lines[0]?.text).toBe(
      "live, Claude Code's worktrees: no SessionStart, PreToolUse hook ran. claude exited 0: done",
    );
    expect(shown(lines)[1]).toBe(
      "✗ live, Claude Code's worktrees: the git guard never ran: its log names no git program. claude exited 0: done",
    );
    expect(shown(lines)[3]).toBe(
      `✗ live, Claude Code's worktrees: after ExitWorktree (the session never worked in it) the folder is gone, the branch is gone`,
    );
    expect(existsSync(liveRecordFile(paths.stateDir))).toBe(false);
  });

  test("a session that never entered the worktree fails the 'worked there' checks", () => {
    const { env, paths, deps } = fakeClaude("stay");
    const lines = shown(runLiveCheck(paths, env, deps));
    expect(lines[2]).toBe(
      `✗ live, Claude Code's worktrees: the git guard ran in …/plain; expected Claude Code's own …/${LIVE_NAME}`,
    );
    expect(lines[6]).toStartWith(
      `✗ live, the worktree engine: WorktreeCreate gave …/live-wt-${LIVE_NAME}, the git guard ran in …/configured; expected`,
    );
  });

  test("a worktree that was not removed fails the removal checks", () => {
    const { env, paths, deps } = fakeClaude("keep");
    const lines = shown(runLiveCheck(paths, env, deps));
    expect(lines[3]).toBe(
      `✗ live, Claude Code's worktrees: after ExitWorktree the folder is still there, the branch worktree-${LIVE_NAME} is still there`,
    );
    expect(lines[7]).toBe(
      `✗ live, the worktree engine: after WorktreeRemove (did not run) the folder is still there, the branch ${LIVE_NAME} is still there`,
    );
    expect(existsSync(liveRecordFile(paths.stateDir))).toBe(false);
  });

  test("no Claude Code: one failed line", () => {
    const { env, paths, deps } = fakeClaude("play");
    const lines = runLiveCheck(paths, env, {
      ...deps,
      run: () => ({ exitCode: 127, output: "claude: not found" }),
    });
    expect(lines).toEqual([
      { ok: false, text: "live: `claude --version` gave no version: is Claude Code installed?" },
    ]);
  });

  test("liveHookCommand: the plugin under test, quoted for sh", () => {
    const command = liveHookCommand("/plugins/anymodel's copy", "/usr/local/bin/bun");
    expect(command("worktree-create")).toBe(
      "'/usr/local/bin/bun' '/plugins/anymodel'\\''s copy/dist/cli.js' hook worktree-create",
    );
    // Run through a real /bin/sh with a fake plugin folder: the quoting holds.
    const dir = tempDir("live-command");
    const plugin = join(dir, "plugin");
    mkdirSync(join(plugin, "dist"), { recursive: true });
    const said = join(dir, "said");
    writeFileSync(
      join(plugin, "dist", "cli.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(said)}, process.argv.slice(2).join(" "));\n`,
    );
    const result = Bun.spawnSync([
      "/bin/sh",
      "-c",
      liveHookCommand(plugin, process.execPath)("worktree-remove"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(said, "utf8")).toBe("hook worktree-remove");
  });

  test("parseClaudeVersion", () => {
    expect(parseClaudeVersion("2.1.300 (Claude Code)\n")).toBe("2.1.300");
    expect(parseClaudeVersion("nope")).toBeNull();
  });

  test("a broken record reads as none", () => {
    const dir = tempDir("state");
    writeFileSync(liveRecordFile(dir), "{ broken");
    expect(readLiveRecord(dir)).toBeNull();
  });
});
