/**
 * `doctor --live` with a fake `claude` first on PATH: it never reaches a model. The fake
 * plays Claude Code's part: for `-p` it runs this repo's hook entries the way Claude Code
 * does (SessionStart, then WorktreeCreate with the prompt's name, then WorktreeRemove with
 * the folder it printed), so the check reads real hook runs from the log.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";
import {
  LIVE_NAME,
  type LiveRunner,
  liveRecordFile,
  parseClaudeVersion,
  readLiveRecord,
  runLiveCheck,
} from "./live-check";
import { cliPaths } from "./paths";

const ENTRIES = join(import.meta.dir, "..", "entries");

/** The fake claude, as a bun script. MODE: "play" runs the hooks; "nothing" runs none. */
const FAKE = `
const args = process.argv.slice(2);
const log = process.env.FAKE_CLAUDE_LOG;
if (log) require("node:fs").appendFileSync(log, JSON.stringify(args) + "\\n");
if (args[0] === "--version") { console.log("2.1.300 (Claude Code)"); process.exit(0); }
if (process.env.FAKE_CLAUDE_MODE === "nothing") { console.log("done"); process.exit(0); }
const entries = process.env.FAKE_ENTRIES;
const cwd = process.cwd();
const hook = (name, input) => {
  const r = Bun.spawnSync(["bun", ...(process.env.FAKE_GUARD_ARGS ?? "").split(" ").filter(Boolean), entries + "/" + name + ".ts"], {
    cwd, env: process.env, stdin: Buffer.from(JSON.stringify(input)), stdout: "pipe", stderr: "pipe",
  });
  return r.stdout.toString();
};
const name = /name "([^"]+)"/.exec(args.at(-1))[1];
hook("worktree-leftovers", { hook_event_name: "SessionStart", session_id: "s", cwd, source: "startup" });
const folder = hook("worktree-create", { hook_event_name: "WorktreeCreate", session_id: "s", cwd, name });
if (process.env.FAKE_CLAUDE_MODE !== "keep") {
  hook("worktree-remove", { hook_event_name: "WorktreeRemove", session_id: "s", cwd: folder, worktree_path: folder });
}
console.log("done");
`;

function fakeClaude(mode: "play" | "nothing" | "keep") {
  const home = tempDir("live-home");
  const bin = tempDir("live-bin");
  const script = join(bin, "fake-claude.js");
  writeFileSync(script, FAKE);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec bun "${script}" "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const calls = join(bin, "calls.log");
  const guard = subprocessGuard();
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
  const run: LiveRunner = (argv, { cwd, env: runEnv, timeoutMs }) => {
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
  return { env, run, calls, paths: cliPaths(env) };
}

describe("doctor --live", () => {
  test("a Claude Code that runs the hooks: every check passes, and the version is recorded", () => {
    const { env, run, calls, paths } = fakeClaude("play");
    const lines = runLiveCheck(paths, env, { pluginDir: "/plugins/anymodel", run });
    expect(
      lines.map((line) => `${line.ok ? "✓" : "✗"} ${line.text.replace(/\/[^ ]*\//g, "…/")}`),
    ).toEqual([
      "✓ live, without anymodel.json: the plugin's hooks fired (SessionStart, WorktreeCreate, WorktreeRemove)",
      `✓ live, without anymodel.json: WorktreeCreate made …/${LIVE_NAME}`,
      `✓ live, without anymodel.json: WorktreeRemove removed the folder and the branch worktree-${LIVE_NAME}`,
      "✓ live, with anymodel.json: the plugin's hooks fired (SessionStart, WorktreeCreate, WorktreeRemove)",
      `✓ live, with anymodel.json: WorktreeCreate made …/live-wt-${LIVE_NAME}`,
      `✓ live, with anymodel.json: WorktreeRemove removed the folder and the branch ${LIVE_NAME}`,
      "✓ live: passed on Claude Code 2.1.300; recorded",
    ]);
    expect(readLiveRecord(paths.stateDir)).toEqual({
      claudeCode: "2.1.300",
      plugin: VERSION,
      passedAt: expect.any(String),
    });
    // Each session: this plugin folder, the two tools only, no MCP servers, the prompt last.
    const sessions = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === "-p");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.slice(0, -1)).toEqual([
      "-p",
      "--plugin-dir",
      "/plugins/anymodel",
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "EnterWorktree,ExitWorktree",
      "--strict-mcp-config",
      "--no-session-persistence",
    ]);
  });

  test("a Claude Code that runs no hooks: each check fails, nothing is recorded", () => {
    const { env, run, paths } = fakeClaude("nothing");
    const lines = runLiveCheck(paths, env, { pluginDir: "/plugins/anymodel", run });
    expect(lines.filter((line) => !line.ok)).toHaveLength(6);
    expect(lines[0]?.text).toBe(
      "live, without anymodel.json: no SessionStart, WorktreeCreate, WorktreeRemove hook ran. claude exited 0: done",
    );
    expect(existsSync(liveRecordFile(paths.stateDir))).toBe(false);
  });

  test("a worktree that was not removed fails the removal check", () => {
    const { env, run, paths } = fakeClaude("keep");
    const lines = runLiveCheck(paths, env, { pluginDir: "/plugins/anymodel", run });
    const removal = lines.find((line) => line.text.includes("after WorktreeRemove"));
    expect(removal?.ok).toBe(false);
    expect(removal?.text).toContain("(did not run) the folder is still there, the branch");
    expect(existsSync(liveRecordFile(paths.stateDir))).toBe(false);
  });

  test("no Claude Code: one failed line", () => {
    const { env, paths } = fakeClaude("play");
    const lines = runLiveCheck(paths, env, {
      pluginDir: "/p",
      run: () => ({ exitCode: 127, output: "claude: not found" }),
    });
    expect(lines).toEqual([
      { ok: false, text: "live: `claude --version` gave no version: is Claude Code installed?" },
    ]);
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
