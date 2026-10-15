import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, runHook, wireProjectHook, writeClaudeFile } from "../testing/hooks";
import { git } from "../testing/temp";
import { subagentStopHook, worktreeRemoveHook } from "./specs";
import { subagentWorktreeOf } from "./worktree-remove";

const SESSION = "11111111-2222-3333-4444-555555555555";

/** A worktree on a new branch at `<repo>/.claude/worktrees/<name>`, as the default shape makes it. */
function addWorktree(repo: string, name: string): string {
  const folder = join(repo, ".claude", "worktrees", name);
  git(repo, "worktree", "add", "-q", "-b", `worktree-${name}`, folder);
  return folder;
}

/** WorktreeRemove, run the way Claude Code runs it: from inside the worktree. */
function remove(folder: string, env = hookEnv(), cwd = folder) {
  return runHook(
    worktreeRemoveHook,
    { hook_event_name: "WorktreeRemove", session_id: SESSION, cwd, worktree_path: folder },
    env,
  );
}

const hasBranch = (repo: string, branch: string) =>
  git(repo, "branch", "--list", branch).trim() !== "";

describe("WorktreeRemove", () => {
  test("a clean worktree: the folder and its branch go, exit 0", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "done");
    expect(await remove(folder)).toEqual({
      stderr: `removed ${folder}; deleted branch worktree-done`,
    });
    expect(existsSync(folder)).toBe(false);
    expect(hasBranch(repo, "worktree-done")).toBe(false);
  });

  test("uncommitted work: kept, exit 1, and the reason", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "busy");
    writeFileSync(join(folder, "new.txt"), "work\n");
    expect(await remove(folder)).toEqual({
      exitCode: 1,
      stderr: `worktree kept: it has uncommitted changes or untracked files. Commit them first, or remove it yourself: git worktree remove --force ${folder}`,
    });
    expect(existsSync(join(folder, "new.txt"))).toBe(true);
  });

  test("a commit on no other branch: the folder goes, the branch stays", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "ahead");
    writeFileSync(join(folder, "a.txt"), "a\n");
    git(folder, "add", "a.txt");
    git(folder, "commit", "-q", "-m", "work");
    expect(await remove(folder)).toEqual({
      stderr: `removed ${folder}; kept branch worktree-ahead: 1 commit on it is on no other branch`,
    });
    expect(hasBranch(repo, "worktree-ahead")).toBe(true);
  });

  test("a folder that is already gone: forgotten, exit 0", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "gone");
    rmSync(folder, { recursive: true, force: true });
    // Claude Code runs the hook inside the worktree; that folder is gone too, so run it from the repo.
    const result = await remove(folder, hookEnv(), repo);
    expect(result).toEqual({
      stderr: `forgot ${folder}: its folder was gone; deleted branch worktree-gone`,
    });
    expect(git(repo, "worktree", "list")).not.toContain("gone");
  });

  test("the cwd is gone and so is the worktree: nothing to do, exit 0", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "vanished");
    rmSync(folder, { recursive: true, force: true });
    expect(await remove(folder)).toEqual({});
  });

  test("the main checkout: refused", async () => {
    const repo = makeRepo();
    expect(await remove(repo)).toEqual({
      exitCode: 1,
      stderr: `worktree kept: ${repo} is the main checkout`,
    });
  });

  test("a folder that is not a worktree of this repo: refused", async () => {
    const repo = makeRepo();
    const other = makeRepo("other");
    expect(await remove(other, hookEnv(), repo)).toEqual({
      exitCode: 1,
      stderr: `worktree kept: ${other} is not a worktree of this repo`,
    });
  });

  test("a locked worktree: kept, exit 1", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, "locked");
    git(repo, "worktree", "lock", folder);
    const result = await remove(folder);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `worktree kept: ${folder} is locked (\`git worktree unlock ${folder}\` once it is safe)`,
    );
  });

  test("a worktree with another one inside it: kept", async () => {
    const repo = makeRepo();
    const outer = join(repo, "..", "outer");
    git(repo, "worktree", "add", "-q", "-b", "outer", outer);
    const inner = join(outer, ".claude", "worktrees", "inner");
    git(repo, "worktree", "add", "-q", "-b", "inner", inner);
    expect(await remove(outer)).toEqual({
      exitCode: 1,
      stderr: `worktree kept: another worktree lives inside it: ${inner}`,
    });
  });

  test("the project wires its own WorktreeRemove: no output, exit 0, nothing removed", async () => {
    const repo = makeRepo();
    wireProjectHook(repo, "WorktreeRemove");
    const folder = addWorktree(repo, "theirs");
    expect(await remove(folder)).toEqual({});
    expect(existsSync(folder)).toBe(true);
  });

  test("anymodel.json needs a newer plugin: kept, exit 1, the update command", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { requires: ">=99" });
    const folder = addWorktree(repo, "versioned");
    const result = await remove(folder);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("this project needs anymodel >=99");
    expect(result.stderr).toEndWith("run claude plugin update anymodel@anymodel");
    expect(existsSync(folder)).toBe(true);
  });
});

describe("SubagentStop", () => {
  const AGENT = "a0b1c2d3e4f5a6b7c";

  function stop(cwd: string, agentId = AGENT, env = hookEnv()) {
    return runHook(
      subagentStopHook,
      {
        hook_event_name: "SubagentStop",
        session_id: SESSION,
        cwd,
        agent_id: agentId,
        agent_type: "general-purpose",
      },
      env,
    );
  }

  test("finds the subagent's own worktree from its cwd", () => {
    expect(subagentWorktreeOf(`/r/.claude/worktrees/agent-${AGENT}/src`, AGENT)).toBe(
      `/r/.claude/worktrees/agent-${AGENT}`,
    );
    expect(subagentWorktreeOf("/r/src", AGENT)).toBeNull();
    expect(subagentWorktreeOf(`/r/.claude/worktrees/agent-${AGENT}`, "other")).toBeNull();
    expect(subagentWorktreeOf(`/r/.claude/worktrees/agent-${AGENT}`, ".*")).toBeNull();
  });

  test("a subagent that changed nothing: its worktree and branch go, exit 0", async () => {
    const repo = makeRepo();
    const folder = addWorktree(repo, `agent-${AGENT}`);
    expect(await stop(folder)).toEqual({
      stderr: `removed ${folder}; deleted branch worktree-agent-${AGENT}`,
    });
    expect(existsSync(folder)).toBe(false);
  });

  test("an edit, or a commit of its own: everything stays, silently", async () => {
    const repo = makeRepo();
    const edited = addWorktree(repo, `agent-${AGENT}`);
    writeFileSync(join(edited, "x.txt"), "x\n");
    expect(await stop(edited)).toEqual({});
    expect(existsSync(edited)).toBe(true);

    const other = "f0e1d2c3b4a59687f";
    const committed = addWorktree(repo, `agent-${other}`);
    writeFileSync(join(committed, "y.txt"), "y\n");
    git(committed, "add", "y.txt");
    git(committed, "commit", "-q", "-m", "work");
    expect(await stop(committed, other)).toEqual({});
    expect(existsSync(committed)).toBe(true);
  });

  test("a subagent that worked in its session's folder: nothing to do", async () => {
    expect(await stop(makeRepo())).toEqual({});
  });

  test("the project makes its own worktrees (its WorktreeCreate): left to the project", async () => {
    const repo = makeRepo();
    wireProjectHook(repo, "WorktreeCreate");
    const folder = addWorktree(repo, `agent-${AGENT}`);
    expect(await stop(folder)).toEqual({});
    expect(existsSync(folder)).toBe(true);
  });
});
