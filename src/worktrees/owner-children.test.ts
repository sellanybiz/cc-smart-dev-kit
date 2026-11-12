/**
 * A session that removes its own worktree (`worktrees --remove`, owner mode): its own MCP
 * servers keep working in the folder after ExitWorktree `keep`, and must not hold it. Anything
 * a shell started, anything started from a file inside, and every other session's programs
 * still do. The process trees here are fakes; nothing reads the host.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { programsInside, type RunningProgram } from "./machine-facts";
import { scanWorktrees } from "./scan";

/** pid:[4026531836], the initial pid namespace the lock proofs need. */
const INITIAL_PIDNS = "pid:[4026531836]";

/** This command's own pid in the fake tree, and its session's Claude Code process. */
const CLAUDE = 500;

function repo(): { main: string; worktree: string } {
  const root = tempDir("owner-children");
  const origin = join(root, "origin.git");
  const main = join(root, "app");
  mkdirSync(origin);
  git(origin, "init", "--bare", "--initial-branch=main");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  writeFileSync(join(main, "README.md"), "# app\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "first");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-u", "origin", "main");
  git(main, "remote", "set-head", "origin", "--auto");
  const worktree = join(root, "app-wt-fix-login");
  git(main, "worktree", "add", "-b", "fix/login", worktree);
  return { main, worktree };
}

/** The scan's verdict for the one worktree, with the given processes and mode. */
function judge(
  programs: RunningProgram[],
  options: { ownerMode: boolean; platform?: NodeJS.Platform; lock?: string },
) {
  const { main, worktree } = repo();
  if (options.lock !== undefined) git(main, "worktree", "lock", "--reason", options.lock, worktree);
  const found = scanWorktrees(main, {
    base: "main",
    claudeConfigDir: tempDir("claude"),
    env: cleanGitEnv(),
    idleLimit: 0,
    ownerMode: options.ownerMode,
    facts: {
      containers: [],
      mounts: [],
      programs: programs.map((program) => ({
        ...program,
        ...(program.cwd === "IN" ? { cwd: worktree } : {}),
        ...(program.path?.includes("IN/") ? { path: program.path.replace("IN", worktree) } : {}),
      })),
      sessions: [],
      platform: options.platform ?? "linux",
      pidNamespace: INITIAL_PIDNS,
      processIsGone: () => false,
      processStartTime: () => "proc:123",
      // This command's chain: the pid of the test process, then the session's claude.
      parentOf: (pid) => (pid === process.pid ? CLAUDE : null),
    },
  }).find((one) => one.listed.path === worktree);
  if (found === undefined) throw new Error("the worktree is missing from the scan");
  return found.state;
}

const claude: RunningProgram = { cwd: "/elsewhere", parentPid: 1, path: "claude", pid: CLAUDE };
const mcp: RunningProgram = {
  cwd: "IN",
  parentPid: CLAUDE,
  path: "/home/u/.bun/bin/bun --no-env-file /plugin/mcp.js",
  pid: 501,
};

describe("worktrees --remove: the session's own MCP servers", () => {
  test("a non-shell child of the session's claude, tied by its folder alone, is skipped", () => {
    expect(judge([claude, mcp], { ownerMode: true })).toMatchObject({ finished: true });
  });

  test("the same process holds the folder when the command is not in owner mode", () => {
    expect(judge([claude, mcp], { ownerMode: false })).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: bun",
    });
  });

  test("helpers below the MCP server are skipped too", () => {
    const helper: RunningProgram = { cwd: "IN", parentPid: 501, path: "node helper", pid: 502 };
    expect(judge([claude, mcp, helper], { ownerMode: true })).toMatchObject({ finished: true });
  });

  test("a job under a shell holds it: claude, zsh -c, sleep", () => {
    const shell: RunningProgram = {
      cwd: "/elsewhere",
      parentPid: CLAUDE,
      path: "zsh -c x",
      pid: 600,
    };
    const sleep: RunningProgram = { cwd: "IN", parentPid: 600, path: "sleep 999", pid: 601 };
    expect(judge([claude, shell, sleep], { ownerMode: true })).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: sleep",
    });
  });

  test("a login shell, or a shell below an MCP server, still counts as a shell", () => {
    const login: RunningProgram = { cwd: "IN", parentPid: CLAUDE, path: "-zsh", pid: 600 };
    expect(judge([claude, login], { ownerMode: true })).toMatchObject({ finished: false });
    const below: RunningProgram = { cwd: "IN", parentPid: 501, path: "bash -c y", pid: 602 };
    expect(judge([claude, mcp, below], { ownerMode: true })).toMatchObject({ finished: false });
  });

  test("a program started from a file inside holds it, even under an MCP server", () => {
    const server: RunningProgram = { cwd: "/elsewhere", parentPid: 1, path: "node", pid: 700 };
    const started: RunningProgram = {
      cwd: "IN",
      parentPid: 700,
      path: "node IN/server.js",
      pid: 701,
    };
    const underMcp: RunningProgram = { ...started, parentPid: 501 };
    expect(judge([claude, mcp, underMcp, server], { ownerMode: true })).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: node",
    });
  });

  test("a process of another claude holds it", () => {
    const other: RunningProgram = { cwd: "/elsewhere", parentPid: 1, path: "claude", pid: 800 };
    const theirs: RunningProgram = { cwd: "IN", parentPid: 800, path: "bun mcp", pid: 801 };
    expect(judge([claude, other, theirs], { ownerMode: true })).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: bun",
    });
  });

  test("the claude process itself holds it when it works in the folder", () => {
    expect(judge([{ ...claude, cwd: "IN" }, mcp], { ownerMode: true })).toEqual({
      finished: false,
      held: true,
      why: "a program runs from its files: claude",
    });
  });

  test("a child whose chain the listing cannot follow holds it", () => {
    const orphan: RunningProgram = { cwd: "IN", parentPid: 999, path: "bun mcp", pid: 901 };
    expect(judge([claude, orphan], { ownerMode: true })).toMatchObject({ finished: false });
  });

  test("off Linux no process is skipped", () => {
    expect(judge([claude, mcp], { ownerMode: true, platform: "darwin" })).toMatchObject({
      finished: false,
    });
  });

  test("a live session lock the caller owns names the claude process, whatever it is called", () => {
    const renamed: RunningProgram = { ...claude, path: "/x/versions/2.1.322" };
    expect(
      judge([renamed, mcp], {
        ownerMode: true,
        lock: `claude session lead (pid ${String(CLAUDE)} start 123)`,
      }),
    ).toMatchObject({ finished: true });
    // The same tree with no lock cannot name it: the program is not called claude.
    expect(judge([renamed, mcp], { ownerMode: true })).toMatchObject({ finished: false });
  });
});

describe("programsInside with an owner", () => {
  const worktree = "/work/app-wt-x";
  const tree: RunningProgram[] = [
    { cwd: "/work/app", parentPid: 1, path: "claude", pid: 10 },
    { cwd: worktree, parentPid: 10, path: "bun mcp", pid: 11 },
    { cwd: worktree, parentPid: 10, path: "/bin/bash -c dev", pid: 12 },
  ];

  test("skips the owner's MCP server and keeps the shell", () => {
    expect(programsInside(tree, worktree, false, 1, { claudePid: 10 })).toEqual(["bash"]);
  });

  test("without an owner nothing is skipped", () => {
    expect(programsInside(tree, worktree, false, 1)).toEqual(["bash", "bun"]);
  });
});
