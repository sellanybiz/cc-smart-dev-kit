import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeClone, recordingStarter, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  clearWorktreeNote,
  exactMergeOf,
  mergeOutcome,
  mergesPullRequest,
  mergeTargetOf,
  type PullRequestView,
  parsePullRequestView,
  pullRequestMerges,
  sameRepository,
  tellSessionsNote,
} from "./after-merge";
import { GUARD_BUDGET_ENV } from "./budget";
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
    // HK-2: bash runs the substitutions of an unquoted here-doc body; a quoted one is text.
    ["cat <<EOF\n$(gh pr merge 1)\nEOF", true],
    ["cat <<'EOF'\n$(gh pr merge 1)\nEOF", false],
    // HK-5: a trailing `\` may end a Windows path, so the line is also read unjoined.
    ["cd C:\\repo\\\ngh pr merge 5", true],
    // HK hunch 6: the line job-route queues is read through `job run`.
    [
      `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind test -- bash -c 'bun test && gh pr merge 5'`,
      true,
    ],
    ["cc-smart-dev-kit job run --kind test -- gh pr merge 5", true],
    ["gh pr view 1", false],
    // gh's own flags may come before the command word (both are live gh 2.102.0 forms).
    ["gh -R org/app pr merge 18", true],
    ["gh --repo=org/app pr merge 19", true],
    ["gh --repo org/app pr merge 19", true],
    ["gh -Rorg/app pr merge 19", true],
    ["gh --admin=true pr merge 20", true],
    ["gh -R org/app pr list --limit 1", false],
    // A merge run by a program whose arguments, repeats or identity the line does not show.
    ["seq 5 6 | xargs -n1 gh pr merge", true],
    ["xargs -I{} gh pr merge {}", true],
    ["parallel gh pr merge ::: 5 6", true],
    ["parallel 'gh pr merge {}' ::: 5 6", true],
    ["find . -name x -exec gh pr merge 17 \\;", true],
    ["find . -execdir gh pr merge 17 +", true],
    ["watch -n 5 gh pr merge 16", true],
    ["sudo gh pr merge 7", true],
    ["sudo -u me gh pr merge 7", true],
    ["doas -u me gh pr merge 7", true],
    ["su -c 'gh pr merge 7'", true],
    ["sudo -u me git push -f", false],
    ["parallel echo hi", false],
    ["find . -name '*.ts'", false],
    ["watch -n 5 git status", false],
    // A gh call that switches the branch or the repository before a later merge.
    ["gh pr checkout 11 && gh pr merge", true],
    ["gh co 12 && gh pr merge", true],
    ["gh repo set-default other/repo && gh pr merge 10", true],
    ["gh pr checkout 11", false],
  ])("%j: %j", (command, expected) => {
    expect(mergesPullRequest(command)).toBe(expected);
  });

  test("the refusal a runner, a switch or a pointing assignment gives (the guard's words)", () => {
    const refusal = (command: string) => {
      const calls = pullRequestMerges(command, new Map([["m", "pr merge"]]));
      return calls.filter((one) => !one.disarms).map((one) => one.refusal);
    };
    // The runner runs it: whatever the words say is not what merges.
    expect(refusal("seq 5 6 | xargs -n1 gh pr merge")).toEqual([
      "the merge runs from `xargs`, whose arguments come from outside the line",
    ]);
    expect(refusal("sudo gh pr merge 7")).toEqual([
      "the merge runs under `sudo`, with another user's login and gh config",
    ]);
    // An earlier step moves the merge: the folder, the branch, or gh's own repository.
    expect(refusal("export GH_REPO=o/r && gh pr merge 5")).toEqual([
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ]);
    expect(refusal("gh pr checkout 11 && gh pr merge")).toEqual([
      "an earlier `gh pr checkout` in the same command changes the branch gh works on",
    ]);
    // An alias that expands to a switch moves the merge after it, like `gh pr checkout 11`
    // (and a `pr checkout` is no merge itself, so the only call is the one after it).
    expect(
      pullRequestMerges("gh x 7 && gh pr merge", new Map([["x", "pr checkout"]])),
    ).toMatchObject([
      // The reason names what the alias really runs: the person reads the command, not `x`.
      { refusal: "an earlier `gh pr checkout` in the same command changes the branch gh works on" },
    ]);
    // An alias that expands to a merge is no switch: it merges, and moves nothing.
    expect(pullRequestMerges("gh m 7 && gh pr merge", new Map([["m", "pr merge"]]))).toMatchObject([
      { refusal: null },
      { refusal: null, target: { ref: null } },
    ]);
    // gh's own flags before the command: the repository is read, and an unknown flag asks.
    expect(pullRequestMerges("gh -R org/app pr merge 18")).toEqual([
      {
        target: { ref: "18", repo: "org/app" },
        refusal: null,
        unread: null,
        arms: false,
        disarms: false,
        admin: false,
        unknown: null,
        unknownFlag: null,
      },
    ]);
    expect(refusal("gh --admin=true pr merge 20")).toEqual([
      "the command carries `--admin=true` before the gh command, which this guard does not know",
    ]);
  });

  test.each([
    // `--admin`, with or without a value, anywhere among the merge's own flags.
    ["gh pr merge 5 --merge --admin", "5", true],
    ["gh pr merge 5 --admin=true", "5", true],
    ["gh pr merge 5 --admin=false", "5", true],
    ["gh pr merge --admin 5", "5", true],
    ["gh pr merge --admin", null, true],
    ["gh pr -R org/app merge 5 --admin", "5", true],
    // A flag's value is never a flag (gh reads the next word as the value), and after `--`
    // every word is an argument.
    ["gh pr merge 5 --subject --admin", "5", false],
    ["gh pr merge 5 -t --admin", "5", false],
    ["gh pr merge 5 --body=--admin", "5", false],
    ["gh pr merge 5 -- --admin", "5", false],
    ["gh pr merge 5 --match-head-commit abc123 --merge", "5", false],
    ["gh pr merge 5 --squash", "5", false],
  ])("%j: the pull request %j, --admin %j", (command, ref, admin) => {
    expect(
      pullRequestMerges(command).map((one) => ({ ref: one.target?.ref ?? null, admin: one.admin })),
    ).toEqual([{ ref, admin }]);
  });

  test("two merges: --admin belongs to the one that carries it", () => {
    expect(
      pullRequestMerges("gh pr merge 5 && gh pr merge 6 --admin").map((one) => one.admin),
    ).toEqual([false, true]);
  });

  test("which pull request, and which repo", () => {
    const target = (command: string) => mergeTargetOf(pullRequestMerges(command));
    expect(target("gh pr merge")).toEqual({ ref: null, repo: null });
    expect(target("gh pr merge 12 --squash")).toEqual({ ref: "12", repo: null });
    expect(target("gh pr merge --subject x fix/a -R org/app")).toEqual({
      ref: "fix/a",
      repo: "org/app",
    });
    expect(target("gh pr merge --repo=org/app https://github.com/org/app/pull/7")).toEqual({
      ref: "https://github.com/org/app/pull/7",
      repo: "org/app",
    });
    expect(target("gh pr merge -Rorg/app 7")).toEqual({ ref: "7", repo: "org/app" });
    expect(target("ls")).toBeNull();
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

describe("the exact merge (D31)", () => {
  test.each([
    // The exact form: `gh pr merge <n>` alone, with flags gh 2.102.0 has.
    "gh pr merge 7",
    "gh pr merge 7 --squash --delete-branch",
    "gh pr merge 7 --match-head-commit abc123 --merge",
    "gh pr -R org/app merge 7",
    "gh pr --repo=org/app merge 7",
    "gh -R org/app pr merge 7",
  ])("%j: the exact merge", (command) => {
    expect(exactMergeOf(command, "bash")?.target?.ref).toBe("7");
  });

  test.each([
    // Anything else on the line would skip auto mode's rule for work the guard never judged.
    "timeout 60 gh pr merge 7",
    "CI=1 gh pr merge 7",
    "gh pr merge 5 && gh pr merge 6",
    "gh pr merge 7 > merge.log",
    'bash -c "gh pr merge 7"',
    "gh m 7",
    // Not the exact form: a branch, a URL, an unknown flag, `--admin`, `--disable-auto`, and
    // an armed merge, which lands later without this check seeing a new commit.
    "gh pr merge fix/login",
    "gh pr merge https://github.com/example-org/app/pull/7",
    "gh pr merge 7 --frobnicate",
    "gh pr merge 7 -Z",
    "gh pr merge 7 --admin",
    "gh pr merge 7 --disable-auto",
    "gh pr merge 7 --auto",
  ])("%j: not the exact merge", (command) => {
    expect(exactMergeOf(command, "bash")).toBeNull();
  });

  test("the tool's dialect decides: an unknown one is never exact", () => {
    expect(exactMergeOf("gh pr merge 7", "powershell")?.target?.ref).toBe("7");
    // The guard is not told which shell runs the line: both readings count, so no allow.
    expect(exactMergeOf("gh pr merge 7")).toBeNull();
  });

  test("an unknown flag on a merge is a refusal, named, and never exact", () => {
    const [call] = pullRequestMerges("gh pr merge 7 --frobnicate", null, "bash");
    expect(call?.unknownFlag).toBe("--frobnicate");
    expect(call?.refusal).toBe(
      "the merge carries `--frobnicate`, a flag this guard does not know, so it cannot tell what it does",
    );
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
  /**
   * A fake gh first on PATH that answers `pr view` with `view`, and `alias list` with
   * `aliases` when one is given (any other call answers the view too, which is what a test
   * asserting the exact calls catches).
   */
  function fakeGh(view: Record<string, unknown> | null, aliases?: string): Record<string, string> {
    const env = hookEnv();
    const bin = tempDir("fake-gh");
    const log = join(bin, "calls.log");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${log}"`,
        ...(aliases === undefined
          ? []
          : [
              'if [ "$1 $2" = "alias list" ]; then',
              "  cat <<'ALIASES'",
              aliases.trimEnd(),
              "ALIASES",
              "  exit 0",
              "fi",
            ]),
        view === null ? "exit 1" : `cat <<'EOF'\n${JSON.stringify(view)}\nEOF`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "gh"), 0o755);
    return { ...env, PATH: `${bin}:${env.PATH ?? ""}`, GH_LOG: log };
  }

  function project(bases?: Record<string, string>) {
    const { repo } = makeClone();
    git(repo, "remote", "set-url", "origin", "git@github.com:example-org/app.git");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", ...(bases === undefined ? {} : { bases }) },
    });
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

  test("a merge into the base starts the background clean once: detached, with the repo and the session's folder (D48)", async () => {
    const { repo, worktree } = project();
    const env = fakeGh(merged);
    const { start, started } = recordingStarter();
    const input = ran(join(worktree, "src"), "gh pr merge --squash");

    await runHook(afterMergeHook, input, env, start);

    // Asked for once, as a "merge" run (it ignores the hourly limit), for the main checkout,
    // naming the folder the merging session works in. The worktree is untouched: nothing ran.
    expect(started).toHaveLength(1);
    expect(started[0]?.argv.slice(-3)).toEqual([repo, "merge", join(worktree, "src")]);
    expect(started[0]?.argv[0]).toBe(process.execPath);
    expect(started[0]?.options.cwd).toBe(env.HOME);
    expect(existsSync(worktree)).toBe(true);

    // The same pull request again is announced no more, and starts no second clean.
    await runHook(afterMergeHook, input, env, start);
    expect(started).toHaveLength(1);
  });

  test("no clean starts for a pull request into another base, for a merge gh cannot vouch for, or with autoClean off", async () => {
    const other = project();
    const { start, started } = recordingStarter();
    await runHook(
      afterMergeHook,
      ran(join(other.worktree, "src"), "gh pr merge"),
      fakeGh({ ...merged, baseRefName: "release" }),
      start,
    );
    await runHook(afterMergeHook, ran(other.worktree, "gh pr merge"), fakeGh(null), start);
    expect(started).toHaveLength(0);

    const off = project();
    writeClaudeFile(off.repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", autoClean: false },
    });
    await runHook(
      afterMergeHook,
      ran(off.worktree, "gh pr merge"),
      fakeGh({ ...merged, number: 8 }),
      start,
    );
    expect(started).toHaveLength(0);
  });

  test("the hook's message carries the caution when the project names other bases", async () => {
    // A branch there goes into `dev`, not into this merge's base (`main`).
    const { worktree } = project({ "hotfix/": "dev", "release/": "dev" });
    const env = fakeGh(merged);
    const result = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh pr merge --squash"),
      env,
    );
    const context = (
      JSON.parse(result.stdout ?? "{}") as {
        hookSpecificOutput?: { additionalContext?: string };
      }
    ).hookSpecificOutput?.additionalContext;
    expect(context).toContain(
      "One exception: a branch whose pull request goes into another base (hotfix/, release/) must NOT merge main in, because that would ship unreleased work. A branch there stays as it is.",
    );
  });

  test("with no bases, or bases that all point at the same base: no caution", () => {
    const pr = parsePullRequestView(JSON.stringify(merged));
    if (pr === null) throw new Error("bad view");
    expect(tellSessionsNote(pr, "main")).not.toContain("another base");
    expect(tellSessionsNote(pr, "main", { "hotfix/": "main" })).not.toContain("another base");
    expect(tellSessionsNote(pr, "main", { "hotfix/": "dev", "release/": "main" })).toContain(
      "another base (hotfix/) must NOT merge main in",
    );
  });

  test("the notes say exactly this", () => {
    const pr = parsePullRequestView(JSON.stringify(merged));
    if (pr === null) throw new Error("bad view");
    expect(tellSessionsNote(pr, "main")).toBe(
      [
        "That merged #7 into main.",
        "Tell the other sessions of this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo (not this session, not a subagent, not another project) with exactly this text:",
        "\"main now has #7 (Fix 'login'). At your next stop, once your current work is committed: git fetch origin main, then git merge origin/main, and fix any conflict. Never commit unfinished work just to take the merge. After the merge, run the install your project uses if the merge changed a lock file. Run the tests the merge touched. No reply needed.\"",
        "Merged several pull requests this turn? Send each session one message, naming every merged number.",
      ].join("\n"),
    );
    expect(clearWorktreeNote("/code/app-wt-fix-a", "fix/a")).toBe(
      [
        "That merged the pull request of this worktree's branch, fix/a. Clear the worktree now, unless the user wants more work on this branch:",
        'ExitWorktree with action "remove". A worktree outside .claude/worktrees/ may be refused because Claude Code cannot check it: if the refusal is only for the merged commits, check that `git status --porcelain` is empty and `git log @{u}..` shows nothing, then call it again with discard_changes true.',
        'If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: cc-smart-dev-kit worktrees --remove "/code/app-wt-fix-a" — it removes the folder and the branch only when the worktree is finished. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.',
      ].join("\n"),
    );
    // Claude Code's own worktree, inside the repo: it checks the worktree itself, so no
    // discard_changes is needed.
    expect(clearWorktreeNote("/code/my-app/.claude/worktrees/fix-a", "worktree-fix-a")).toBe(
      [
        "That merged the pull request of this worktree's branch, worktree-fix-a. Clear the worktree now, unless the user wants more work on this branch:",
        'ExitWorktree with action "remove": Claude Code checks a worktree under .claude/worktrees/ itself and says when work is left.',
        'If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: cc-smart-dev-kit worktrees --remove "/code/my-app/.claude/worktrees/fix-a" — it removes the folder and the branch only when the worktree is finished. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.',
      ].join("\n"),
    );
  });

  /** The note the hook gave after `gh pr merge --squash` in the worktree. */
  async function noteAfterMerge(cwd: string, env: Record<string, string>): Promise<string> {
    const result = await runHook(afterMergeHook, ran(cwd, "gh pr merge --squash"), env);
    return JSON.parse(result.stdout ?? "{}").hookSpecificOutput?.additionalContext ?? "";
  }

  test("HK-1: a worktree outside .claude/worktrees/: discard_changes only after the session's own check", async () => {
    const { worktree } = project();
    const note = await noteAfterMerge(join(worktree, "src"), fakeGh(merged));
    expect(note).toContain("Clear the worktree now");
    const check = note.indexOf("`git status --porcelain` is empty");
    expect(check).toBeGreaterThan(-1);
    expect(note.indexOf("discard_changes true")).toBeGreaterThan(check);
    expect(note).toContain('worktrees --remove "');
  });

  test("HK hunch 9: the hook's children share one budget, so their limits cannot add up", async () => {
    const { worktree } = project();
    // Room for every call: the whole note.
    const env: Record<string, string> = { ...fakeGh(merged), [GUARD_BUDGET_ENV]: "10000" };
    expect((await runHook(afterMergeHook, ran(worktree, "gh pr merge"), env)).stdout).toContain(
      "Clear the worktree now",
    );
    // A small budget: the note is either written from a lookup that fit, or skipped whole,
    // and gh is never given more time than the budget holds.
    const small: Record<string, string> = { ...fakeGh(merged), [GUARD_BUDGET_ENV]: "1000" };
    const answer = await runHook(afterMergeHook, ran(worktree, "gh pr merge"), small);
    const called = () => {
      try {
        return readFileSync(small.GH_LOG ?? "", "utf8");
      } catch {
        return "";
      }
    };
    expect(answer.stdout === undefined ? called() === "" : called() !== "").toBe(true);
    // A budget with nothing left at all: no child runs, and no note names a pull request.
    const none: Record<string, string> = { ...fakeGh(merged), [GUARD_BUDGET_ENV]: "200" };
    expect(await runHook(afterMergeHook, ran(worktree, "gh pr merge"), none)).toEqual({});
    expect(() => readFileSync(none.GH_LOG ?? "", "utf8")).toThrow();
  });

  test("HK hunch 9: an alias read that is given no time is never started", async () => {
    const { worktree } = project();
    const env: Record<string, string> = {
      ...fakeGh(merged, "m: pr merge"),
      [GUARD_BUDGET_ENV]: "500",
    };
    expect(await runHook(afterMergeHook, ran(worktree, "gh m 7"), env)).toEqual({});
    expect(() => readFileSync(env.GH_LOG ?? "", "utf8")).toThrow();
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

  test("a merge written `gh pr -R <repo> merge`: the same note, and --repo in the lookup", async () => {
    const { worktree } = project();
    const env = fakeGh(merged);
    const pr = parsePullRequestView(JSON.stringify(merged));
    if (pr === null) throw new Error("bad view");
    const result = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh pr -R example-org/app merge --squash"),
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toBe(
      `${clearWorktreeNote(worktree, "fix/a")}\n\n${tellSessionsNote(pr, "main")}`,
    );
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe(
      "pr view --repo example-org/app --json number,title,baseRefName,headRefName,state,url,mergedAt\n",
    );
  });

  test("a `gh api` merge: the path names the pull request, so the note is written", async () => {
    const { worktree } = project();
    const env = fakeGh(merged);
    const result = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh api -X PUT repos/example-org/app/pulls/7/merge"),
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toContain(
      "Clear the worktree now",
    );
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe(
      "pr view 7 --repo example-org/app --json number,title,baseRefName,headRefName,state,url,mergedAt\n",
    );
  });

  test("a gh alias for `pr merge`: noted like the merge it expands to", async () => {
    const { worktree } = project();
    const env = fakeGh(merged, "co: pr checkout\nm: pr merge\n");
    const result = await runHook(afterMergeHook, ran(join(worktree, "src"), "gh m --squash"), env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toContain(
      "Clear the worktree now",
    );
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe(
      "alias list\npr view --json number,title,baseRefName,headRefName,state,url,mergedAt\n",
    );
  });

  test("a form that names no pull request (a shell alias, a GraphQL merge): silent", async () => {
    const { worktree } = project();
    const env = fakeGh(merged, "m: '!gh pr merge 7'\n");
    expect(await runHook(afterMergeHook, ran(worktree, "gh m"), env)).toEqual({});
    expect(
      await runHook(
        afterMergeHook,
        ran(
          worktree,
          "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
        ),
        env,
      ),
    ).toEqual({});
    // The alias list was read (once), and no pull request was looked up.
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe("alias list\n");
  });

  test("an armed alias merge (`--auto`) is no merge yet: silent", async () => {
    const { worktree } = project();
    const env = fakeGh(merged, "m: pr merge\n");
    expect(await runHook(afterMergeHook, ran(worktree, "gh m --auto 7"), env)).toEqual({});
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe("alias list\n");
  });

  test("with the alias list unreadable: no note, and no lookup", async () => {
    const { worktree } = project();
    const env = fakeGh(merged); // no alias answer: `gh alias list` fails
    expect(await runHook(afterMergeHook, ran(worktree, "gh m 7"), env)).toEqual({});
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe("alias list\n");
  });

  test("without worktrees in cc-smart-dev-kit.json: silent", async () => {
    const { repo } = makeClone();
    expect(await runHook(afterMergeHook, ran(repo, "gh pr merge"), fakeGh(merged))).toEqual({});
  });

  test("cc-smart-dev-kit.json needs a newer plugin: one line, only after a merge", async () => {
    const { repo } = makeClone();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    const result = await runHook(afterMergeHook, ran(repo, "gh pr merge"), fakeGh(merged));
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toMatch(
      new RegExp(
        `^cc-smart-dev-kit: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: this project needs cc-smart-dev-kit >=99; you have [0-9.]+; run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit$`,
      ),
    );
    expect(await runHook(afterMergeHook, ran(repo, "ls"), fakeGh(merged))).toEqual({});
  });
});
