import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  clearWorktreeNote,
  mergeOutcome,
  mergesPullRequest,
  mergeTarget,
  type PullRequestView,
  parsePullRequestView,
  sameRepository,
  tellSessionsNote,
} from "./after-merge";
import { afterMergeHook } from "./specs";

describe("did the command merge a pull request?", () => {
  test.each([
    ["gh pr merge", true],
    ["gh pr merge 12 --squash", true],
    ["git push && gh pr merge --merge", true],
    ['bash -c "gh pr merge 3"', true],
    ['echo "$(gh pr merge 4)"', true],
    ["gh pr merge --auto --squash", false],
    ["gh pr merge 5 --disable-auto", false],
    ['echo "gh pr merge 1"', false],
    ["grep 'gh pr merge' notes.md", false],
    // A shell that reads its script from standard input runs it: a here-doc body, a
    // here-string, and the text piped into it are read as the commands they are.
    ["sh <<'EOF'\ngh pr merge 1\nEOF", true],
    ['sh <<< "gh pr merge 2"', true],
    ['echo "gh pr merge 3" | sh', true],
    ["cat <<EOF\ngh pr merge 1\nEOF", false],
    ["gh pr view 1", false],
  ])("%j: %j", (command, expected) => {
    expect(mergesPullRequest(command)).toBe(expected);
  });

  test("which pull request, and which repo", () => {
    expect(mergeTarget("gh pr merge")).toEqual({ ref: null, repo: null });
    expect(mergeTarget("gh pr merge 12 --squash")).toEqual({ ref: "12", repo: null });
    expect(mergeTarget("gh pr merge --subject x fix/a -R org/app")).toEqual({
      ref: "fix/a",
      repo: "org/app",
    });
    expect(mergeTarget("gh pr merge --repo=org/app https://github.com/org/app/pull/7")).toEqual({
      ref: "https://github.com/org/app/pull/7",
      repo: "org/app",
    });
    expect(mergeTarget("ls")).toBeNull();
  });

  test("same repository: https, ssh, an ssh alias; case does not matter", () => {
    const url = "https://github.com/Example-Org/App/pull/3";
    expect(sameRepository(url, "git@github.com:example-org/app.git")).toBe(true);
    expect(sameRepository(url, "https://github.com/example-org/app")).toBe(true);
    expect(sameRepository(url, "git@github-work:example-org/app.git")).toBe(true);
    expect(sameRepository(url, "git@github.com:example-org/other.git")).toBe(false);
  });

  test("parsePullRequestView reads gh's answer; anything else is null", () => {
    expect(
      parsePullRequestView(
        JSON.stringify({
          number: 3,
          title: "T",
          baseRefName: "main",
          headRefName: "fix/a",
          state: "MERGED",
          url: "u",
          mergedAt: "",
        }),
      ),
    ).toEqual({
      number: 3,
      title: "T",
      base: "main",
      head: "fix/a",
      state: "MERGED",
      url: "u",
      mergedAt: null,
    });
    expect(parsePullRequestView("nope")).toBeNull();
  });
});

describe("mergeOutcome", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const pr: PullRequestView = {
    number: 9,
    title: "Fix",
    base: "dev",
    head: "fix/a",
    state: "MERGED",
    url: "https://github.com/o/r/pull/9",
    mergedAt: "2026-01-01T11:58:00Z",
  };
  const base = {
    announced: false,
    base: "dev",
    failed: false,
    now,
    pr,
    sameRepo: true,
    target: { ref: null },
    worktree: { branch: "fix/a", path: "/code/app-wt-fix-a" },
  };

  test("merged from this worktree into the base: clear it, and announce", () => {
    expect(mergeOutcome(base)).toEqual({
      announce: pr,
      clear: { path: "/code/app-wt-fix-a", branch: "fix/a" },
    });
  });

  test("another branch's pull request, by number: announce only", () => {
    const other = { ...pr, head: "fix/b" };
    expect(mergeOutcome({ ...base, pr: other, target: { ref: "9" } })).toEqual({
      announce: other,
      clear: null,
    });
  });

  test("into another branch, announced before, or long ago: no announcement", () => {
    expect(mergeOutcome({ ...base, pr: { ...pr, base: "main" } }).announce).toBeNull();
    expect(mergeOutcome({ ...base, announced: true }).announce).toBeNull();
    expect(
      mergeOutcome({ ...base, pr: { ...pr, mergedAt: "2026-01-01T10:00:00Z" } }).announce,
    ).toBeNull();
  });

  test("not merged, another repo, or a failed command gh cannot vouch for: nothing", () => {
    const none = { announce: null, clear: null };
    expect(mergeOutcome({ ...base, pr: { ...pr, state: "OPEN" } })).toEqual(none);
    expect(mergeOutcome({ ...base, sameRepo: false })).toEqual(none);
    expect(mergeOutcome({ ...base, pr: null, failed: true })).toEqual(none);
  });
});

describe("the hook", () => {
  /** A fake gh first on PATH that answers `pr view` with `view`. */
  function fakeGh(view: Record<string, unknown> | null): Record<string, string> {
    const env = hookEnv();
    const bin = tempDir("fake-gh");
    const log = join(bin, "calls.log");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${log}"`,
        view === null ? "exit 1" : `cat <<'EOF'\n${JSON.stringify(view)}\nEOF`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "gh"), 0o755);
    return { ...env, PATH: `${bin}:${env.PATH ?? ""}`, GH_LOG: log };
  }

  function project() {
    const { repo } = makeClone();
    git(repo, "remote", "set-url", "origin", "git@github.com:example-org/app.git");
    writeClaudeFile(repo, "anymodel.json", { worktrees: { base: "main", prefix: "app-wt-" } });
    const worktree = join(repo, "..", "app-wt-fix-a");
    git(repo, "worktree", "add", "-q", "-b", "fix/a", worktree);
    mkdirSync(join(worktree, "src"));
    return { repo, worktree };
  }

  const ran = (cwd: string, command: string, event = "PostToolUse") => ({
    hook_event_name: event,
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });

  const merged = {
    number: 7,
    title: 'Fix "login"',
    baseRefName: "main",
    headRefName: "fix/a",
    state: "MERGED",
    url: "https://github.com/example-org/app/pull/7",
    mergedAt: new Date().toISOString(),
  };

  test("after merging its own branch from a worktree: both notes, then announced once", async () => {
    const { worktree } = project();
    const env = fakeGh(merged);
    const pr = parsePullRequestView(JSON.stringify(merged));
    if (pr === null) throw new Error("bad view");
    const first = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh pr merge --squash"),
      env,
    );
    expect(first).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `${clearWorktreeNote(worktree, "fix/a")}\n\n${tellSessionsNote(pr, "main")}`,
        },
      }),
    });
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe(
      "pr view --json number,title,baseRefName,headRefName,state,url,mergedAt\n",
    );
    const again = await runHook(afterMergeHook, ran(worktree, "gh pr merge --squash"), env);
    expect(again.stdout).toContain("Clear the worktree now");
    expect(again.stdout).not.toContain("Tell the other sessions");
  });

  test("the notes say exactly this", () => {
    const pr = parsePullRequestView(JSON.stringify(merged));
    if (pr === null) throw new Error("bad view");
    expect(tellSessionsNote(pr, "main")).toBe(
      [
        "That merged #7 into main.",
        "Tell the other sessions of this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo (not this session, not a subagent, not another project) with exactly this text:",
        "\"main now has #7 (Fix 'login'). At your next stop, once your current work is committed: git fetch origin main, then git merge origin/main, and fix any conflict. No reply needed.\"",
        "Merged several pull requests this turn? Send each session one message, naming every merged number.",
      ].join("\n"),
    );
    expect(clearWorktreeNote("/code/app-wt-fix-a", "fix/a")).toBe(
      [
        "That merged the pull request of this worktree's branch, fix/a. Clear the worktree now, unless the user wants more work on this branch:",
        'ExitWorktree with action "remove" and discard_changes true. Claude Code cannot check a worktree outside the repo, so the anymodel hook does: it removes the folder only when nothing in it is uncommitted, and the branch only when every commit on it is on another branch.',
        'If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: git worktree remove "/code/app-wt-fix-a", then git branch -d fix/a.',
      ].join("\n"),
    );
  });

  test("a command that merges nothing never asks gh", async () => {
    const { worktree } = project();
    const env = fakeGh(merged);
    expect(await runHook(afterMergeHook, ran(worktree, "git status"), env)).toEqual({});
    expect(await runHook(afterMergeHook, ran(worktree, "gh pr merge --auto"), env)).toEqual({});
    expect(() => readFileSync(env.GH_LOG ?? "", "utf8")).toThrow();
  });

  test("a failed command, and gh cannot say: nothing", async () => {
    const { worktree } = project();
    expect(
      await runHook(
        afterMergeHook,
        ran(worktree, "gh pr merge", "PostToolUseFailure"),
        fakeGh(null),
      ),
    ).toEqual({});
  });

  test("without worktrees in anymodel.json: silent", async () => {
    const { repo } = makeClone();
    expect(await runHook(afterMergeHook, ran(repo, "gh pr merge"), fakeGh(merged))).toEqual({});
  });

  test("anymodel.json needs a newer plugin: one line, only after a merge", async () => {
    const { repo } = makeClone();
    const file = writeClaudeFile(repo, "anymodel.json", { requires: ">=99" });
    const result = await runHook(afterMergeHook, ran(repo, "gh pr merge"), fakeGh(merged));
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toMatch(
      new RegExp(
        `^anymodel: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: this project needs anymodel >=99; you have [0-9.]+; run claude plugin update anymodel@anymodel$`,
      ),
    );
    expect(await runHook(afterMergeHook, ran(repo, "ls"), fakeGh(merged))).toEqual({});
  });
});
