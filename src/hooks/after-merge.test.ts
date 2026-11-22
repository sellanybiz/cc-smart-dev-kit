import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { escapeRegex } from "../regex-escape";
import { RUNNER_PROGRAM_NAMES } from "../shell/command";
import { projectKey } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { createTask, reservePlan, updateTask } from "../tasks/work/store";
import type { Who } from "../tasks/work/types";
import {
  hookEnv,
  makeClone,
  recordingStarter,
  runHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { sessionProcessIdentity } from "../testing/session-record";
import { git, tempDir } from "../testing/temp";
import {
  clearWorktreeNote,
  mergeOutcome,
  mergesPullRequest,
  mergeTargetOf,
  type PullRequestView,
  parsePullRequestView,
  pullRequestMerges,
  pullRequestOpenings,
  sameRepository,
} from "./after-merge";
import { GUARD_BUDGET_ENV } from "./budget";
import { afterMergeHook } from "./specs";

const POINTING_REFUSAL =
  "this command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain";

describe("GH_REPO and GH_HOST point gh elsewhere", () => {
  const refusals = (command: string, dialect: "bash" | "powershell") =>
    pullRequestMerges(command, null, dialect).map((one) => one.refusal);

  // PowerShell names the variable in any case, so `$env:gh_repo` is `GH_REPO`.
  test.each([
    "$env:GH_REPO='o/r'; gh pr merge 5",
    "$env:gh_repo='o/r'; gh pr merge 5",
    "$ENV:Gh_Host='x'; gh pr merge 5",
    "$env:gh_host = 'x'; gh pr merge 5",
  ])("on a PowerShell line, %j is seen", (command) => {
    expect(refusals(command, "powershell")).toEqual([POINTING_REFUSAL]);
  });

  // Bash is case-sensitive: `gh_repo` is another variable, which gh ignores.
  test.each([
    "gh_repo=x gh pr merge 5",
    "export gh_host=x && gh pr merge 5",
    "Gh_Repo=o/r gh pr merge 5",
  ])("on a bash line, %j is not seen", (command) => {
    expect(refusals(command, "bash")).toEqual([null]);
  });

  test("on a bash line the exact names are still seen", () => {
    expect(refusals("GH_REPO=o/r gh pr merge 5", "bash")).toEqual([POINTING_REFUSAL]);
  });
});

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
    // The command moves the merge: the folder, the branch, or gh's own repository. One reason,
    // true for an earlier step and for the merge's own prefix, `=` or `+=` (append) alike.
    for (const command of [
      "export GH_REPO=o/r && gh pr merge 5",
      "GH_REPO=o/r gh pr merge 5",
      "GH_REPO+=o/r gh pr merge 5",
      "GH_HOST=example.com gh pr merge 5",
      "GH_HOST+=example.com gh pr merge 5",
    ])
      expect(refusal(command)).toEqual([POINTING_REFUSAL]);
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

  test("a merge a runner runs names no pull request: the note is skipped, not guessed (the review of the runner follow-up)", () => {
    const target = (command: string) => mergeTargetOf(pullRequestMerges(command));
    // The shell reader reads the command a runner runs; the merge reader must still refuse it
    // as the runner's, not judge it as if the words on the line were what merges.
    for (const command of [
      "su -c 'gh pr merge 5' other",
      'su - me -c "gh pr merge 5"',
      "parallel gh pr merge ::: 5 6",
      "parallel 'gh pr merge {}' ::: 5 6",
      "find . -name x -exec gh pr merge 17 \\;",
      "watch -n 5 gh pr merge 16",
    ]) {
      const calls = pullRequestMerges(command).filter((one) => !one.disarms);
      expect([command, calls.length > 0 && calls.every((one) => one.refusal !== null)]).toEqual([
        command,
        true,
      ]);
    }
    // su and parallel feed the command from outside the line: no pull request at all.
    expect(target("su -c 'gh pr merge 5' other")).toBeNull();
    expect(target("parallel gh pr merge ::: 5 6")).toBeNull();
    expect(target("parallel 'gh pr merge {}' ::: 5 6")).toBeNull();
  });

  test("every runner the shell reader knows has a merge refusal here (the two lists agree)", () => {
    // `isRunnerProgram` (src/shell/command.ts) and the RUNNERS table here are two lists; a
    // runner in only the first would have its merges judged as the line's own: looser.
    const merging: Record<string, string> = {
      find: "find . -exec gh pr merge 5 \\;",
      parallel: "parallel gh pr merge ::: 5",
      su: "su -c 'gh pr merge 5' me",
      watch: "watch gh pr merge 5",
    };
    expect(Object.keys(merging).sort()).toEqual([...RUNNER_PROGRAM_NAMES].sort());
    for (const command of Object.values(merging)) {
      const calls = pullRequestMerges(command).filter((one) => !one.disarms);
      expect([command, calls.length > 0 && calls.every((one) => one.refusal !== null)]).toEqual([
        command,
        true,
      ]);
    }
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

describe("a merge call, read", () => {
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
    base: "dev",
    failed: false,
    now,
    pr,
    sameRepo: true,
    seen: false,
    target: { ref: null },
    worktree: { branch: "fix/a", path: "/code/app-wt-fix-a" },
  };

  test("merged from this worktree into the base: clear it, and a merge into the base", () => {
    expect(mergeOutcome(base)).toEqual({
      clear: { path: "/code/app-wt-fix-a", branch: "fix/a" },
      intoBase: pr,
    });
  });

  test("another branch's pull request, by number: a merge into the base only", () => {
    const other = { ...pr, head: "fix/b" };
    expect(mergeOutcome({ ...base, pr: other, target: { ref: "9" } })).toEqual({
      clear: null,
      intoBase: other,
    });
  });

  test("into another branch, seen before, or long ago: no merge into the base", () => {
    expect(mergeOutcome({ ...base, pr: { ...pr, base: "main" } }).intoBase).toBeNull();
    expect(mergeOutcome({ ...base, seen: true }).intoBase).toBeNull();
    expect(
      mergeOutcome({ ...base, pr: { ...pr, mergedAt: "2026-01-01T10:00:00Z" } }).intoBase,
    ).toBeNull();
  });

  test("not merged, another repo, or a failed command gh cannot vouch for: nothing", () => {
    const none = { clear: null, intoBase: null };
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

  function project(bases?: Record<string, string>, workflow?: Record<string, unknown>) {
    const { repo } = makeClone();
    git(repo, "remote", "set-url", "origin", "git@github.com:example-org/app.git");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", ...(bases === undefined ? {} : { bases }) },
      ...(workflow === undefined ? {} : { workflow }),
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

  test("after merging its own branch from a worktree: the clear note only, never a message for other sessions", async () => {
    const { worktree } = project();
    const env = fakeGh(merged);
    const first = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh pr merge --squash"),
      env,
    );
    expect(first).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: clearWorktreeNote(worktree, "fix/a", true),
        },
      }),
    });
    expect(readFileSync(env.GH_LOG ?? "", "utf8")).toBe(
      "pr view --json number,title,baseRefName,headRefName,state,url,mergedAt\n",
    );
    const again = await runHook(afterMergeHook, ran(worktree, "gh pr merge --squash"), env);
    expect(again.stdout).toContain("Clear the worktree now");
    expect(first.stdout).not.toContain("SendMessage");
    expect(again.stdout).not.toContain("SendMessage");
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

    // The same pull request again starts no second clean.
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

  test("the note says exactly this", () => {
    // Never ExitWorktree "remove": Claude Code refuses it once the branch merged the base.
    expect(clearWorktreeNote("/code/my-app/.claude/worktrees/fix-a", "worktree-fix-a", true)).toBe(
      [
        "That merged the pull request of this worktree's branch, worktree-fix-a. Clear the worktree now, unless the user wants more work on this branch:",
        "1. Stop the dev servers and Monitors this session started in it (TaskStop).",
        '2. ExitWorktree with action "keep": the session goes back to the folder it started in.',
        '3. Run cc-smart-dev-kit worktrees --remove "/code/my-app/.claude/worktrees/fix-a" with run_in_background: it removes the worktree only when it is finished, and says why when it keeps it.',
        "If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), the session stands in it and cannot remove it: tell the user it is finished, and that it goes when this session ends. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.",
      ].join("\n"),
    );
  });

  test("with clearWorktreeAfterMerge off the note asks the person and clears nothing", () => {
    expect(clearWorktreeNote("/code/my-app/.claude/worktrees/fix-a", "worktree-fix-a", false)).toBe(
      [
        "That merged the pull request of this worktree's branch, worktree-fix-a. This worktree looks finished, but the clearWorktreeAfterMerge setting is off: tell the user in one line, give them these steps, and let them decide. Do not clear it yourself.",
        "1. Stop the dev servers and Monitors this session started in it (TaskStop).",
        '2. ExitWorktree with action "keep": the session goes back to the folder it started in.',
        '3. Run cc-smart-dev-kit worktrees --remove "/code/my-app/.claude/worktrees/fix-a" with run_in_background: it removes the worktree only when it is finished, and says why when it keeps it.',
      ].join("\n"),
    );
  });

  describe("the hook reads clearWorktreeAfterMerge", () => {
    const noteOf = async (env: Record<string, string>, worktree: string): Promise<string> => {
      const result = await runHook(afterMergeHook, ran(worktree, "gh pr merge --squash"), env);
      return JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
    };

    test("on by default", async () => {
      const { worktree } = project();
      expect(await noteOf(fakeGh(merged), worktree)).toBe(
        clearWorktreeNote(worktree, "fix/a", true),
      );
    });

    test("off in the project file", async () => {
      const { worktree } = project(undefined, { clearWorktreeAfterMerge: false });
      expect(await noteOf(fakeGh(merged), worktree)).toBe(
        clearWorktreeNote(worktree, "fix/a", false),
      );
    });

    test("off in the person's own file", async () => {
      const { worktree } = project();
      const env = fakeGh(merged);
      const file = cliPaths(env).workflowConfigFile;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ clearWorktreeAfterMerge: false }));
      expect(await noteOf(env, worktree)).toBe(clearWorktreeNote(worktree, "fix/a", false));
    });

    test("a broken personal file: the folder is kept, the person decides", async () => {
      const { worktree } = project();
      const env = fakeGh(merged);
      const file = cliPaths(env).workflowConfigFile;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{ not json");
      expect(await noteOf(env, worktree)).toBe(clearWorktreeNote(worktree, "fix/a", false));
    });
  });

  describe("a lead that keeps its worktree for another open plan", () => {
    const SESSION = "11111111-2222-3333-4444-555555555555";
    /** The Claude process the hook sees as its caller: the test's own parent. */
    const ME: Who = {
      sessionId: SESSION,
      pid: process.ppid,
      procStart: sessionProcessIdentity(process.ppid).procStart ?? null,
    };
    const OTHER: Who = { sessionId: "other-session", pid: 999_999, procStart: "1" };

    /** The hook's project, its environment, and the task store open for writing. */
    function lead(workflow?: Record<string, unknown>) {
      const { repo, worktree } = project(undefined, workflow);
      const env = fakeGh(merged);
      writeSessionRecord(env, {
        sessionId: SESSION,
        cwd: worktree,
        name: "lead",
        pid: process.ppid,
      });
      const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
      const key = projectKey(repo);
      const plan = (slug: string, by: Who) => {
        const made = createTask(
          db,
          { project: key, subject: slug, kind: "plan", plan: slug, files: [`src/${slug}/`] },
          by,
          1,
        );
        if (!made.ok) throw new Error(made.why);
        return made.value;
      };
      return { db, env, key, plan, worktree };
    }

    const noteIn = async (env: Record<string, string>, worktree: string) =>
      runHook(afterMergeHook, ran(worktree, "gh pr merge --squash"), env);
    const contextOf = (result: { stdout?: string }): string =>
      JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;

    test("a plan the lead queued: one line says the worktree is kept", async () => {
      const w = lead();
      w.plan("alpha", ME);
      w.db.close();
      expect(contextOf(await noteIn(w.env, w.worktree))).toBe(
        "Kept: plan alpha is still open here.",
      );
    });

    test("a plan handed to a child counts, and several are named", async () => {
      const w = lead();
      w.plan("alpha", ME);
      w.plan("beta", ME);
      const reserved = reservePlan(w.db, {
        project: w.key,
        plan: "alpha",
        who: ME,
        holder: "child",
        ignore: [],
        caseFold: false,
        now: 5,
      });
      if (!reserved.ok) throw new Error(reserved.why);
      w.db.close();
      expect(contextOf(await noteIn(w.env, w.worktree))).toBe(
        "Kept: plans alpha, beta are still open here.",
      );
    });

    test("the setting that turns the clearing off changes nothing: the plan is still kept", async () => {
      const w = lead({ clearWorktreeAfterMerge: false });
      w.plan("alpha", ME);
      w.db.close();
      expect(contextOf(await noteIn(w.env, w.worktree))).toBe(
        "Kept: plan alpha is still open here.",
      );
    });

    test("no other open plan: the clear note, as before", async () => {
      const w = lead();
      // Another session's plan, and a plan of the lead's that is already closed.
      w.plan("theirs", OTHER);
      const mine = w.plan("finished", ME);
      const closed = updateTask(w.db, mine.id, { status: "done" }, ME, 2);
      if (!closed.ok) throw new Error(closed.why);
      w.db.close();
      expect(contextOf(await noteIn(w.env, w.worktree))).toBe(
        clearWorktreeNote(w.worktree, "fix/a", true),
      );
    });

    test("the plan the session builds itself and has in flight is not another plan", async () => {
      const w = lead();
      const own = w.plan("alpha", ME);
      const started = updateTask(w.db, own.id, { status: "in_progress" }, ME, 2);
      if (!started.ok) throw new Error(started.why);
      w.db.close();
      expect(contextOf(await noteIn(w.env, w.worktree))).toBe(
        clearWorktreeNote(w.worktree, "fix/a", true),
      );
    });

    test("a store the hook cannot read leaves the clear note, with one stderr line", async () => {
      const w = lead();
      w.db.close();
      writeFileSync(workDbFile(cliPaths(w.env)), "not a database");
      const result = await noteIn(w.env, w.worktree);
      expect(contextOf(result)).toBe(clearWorktreeNote(w.worktree, "fix/a", true));
      expect(result.stderr).toStartWith("cc-smart-dev-kit after-merge: ");
    });
  });

  /** The note the hook gave after `gh pr merge --squash` in the worktree. */
  async function noteAfterMerge(cwd: string, env: Record<string, string>): Promise<string> {
    const result = await runHook(afterMergeHook, ran(cwd, "gh pr merge --squash"), env);
    return JSON.parse(result.stdout ?? "{}").hookSpecificOutput?.additionalContext ?? "";
  }

  test("HK-1: the note leaves with keep, then removes with the plugin's check; never remove or discard_changes", async () => {
    const { worktree } = project();
    const note = await noteAfterMerge(join(worktree, "src"), fakeGh(merged));
    expect(note).toContain("Clear the worktree now");
    const keep = note.indexOf('ExitWorktree with action "keep"');
    expect(keep).toBeGreaterThan(-1);
    expect(note.indexOf('worktrees --remove "')).toBeGreaterThan(keep);
    expect(note).not.toContain('action "remove"');
    expect(note).not.toContain("discard_changes");
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
    const result = await runHook(
      afterMergeHook,
      ran(join(worktree, "src"), "gh pr -R example-org/app merge --squash"),
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toBe(
      clearWorktreeNote(worktree, "fix/a", true),
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
        `^cc-smart-dev-kit: ${escapeRegex(file)}: this project needs cc-smart-dev-kit >=99; you have [0-9.]+; run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit$`,
      ),
    );
    expect(await runHook(afterMergeHook, ran(repo, "ls"), fakeGh(merged))).toEqual({});
  });
});

describe("IX1: the merge reader reads gh's flags and a query the way gh and the shell do", () => {
  test("IX1-2: `gh api -X=POST …/pulls` opens a pull request, as `-X POST` does", () => {
    for (const command of [
      "gh api -X=POST repos/o/r/pulls -f title=t",
      "gh api -X POST repos/o/r/pulls -f title=t",
      "gh api -XPOST repos/o/r/pulls -f title=t",
    ]) {
      expect([command, pullRequestOpenings(command, null, "bash").length]).toEqual([command, 1]);
    }
    // `=GET` is GET: a list, no opening.
    expect(pullRequestOpenings("gh api -X=GET repos/o/r/pulls", null, "bash")).toEqual([]);
  });

  test("IX1-2: a bare `$Q` for a query is a refusal, like `$(…)`", () => {
    for (const command of [
      'gh api graphql -f query="$Q"',
      "gh api graphql -F query=$Q",
      'gh api graphql -f query="mutation { $M }"',
    ]) {
      const calls = pullRequestMerges(command, null, "bash");
      expect([command, calls.length, calls[0]?.refusal]).toEqual([
        command,
        1,
        "the GraphQL query is read from a file or built by the shell, so this guard cannot read it",
      ]);
    }
    expect(
      pullRequestMerges("gh api graphql -f query='{ viewer { login } }'", null, "bash"),
    ).toEqual([]);
  });
});

describe("IX3: the merge reader asks the shell reader which words the shell fills in", () => {
  const SHELL_REFUSAL =
    "the GraphQL query is read from a file or built by the shell, so this guard cannot read it";
  const READ_QUERY =
    'gh api graphql -f query=\'query($n: Int!) { repository(owner: "o", name: "r") { issue(number: $n) { title } } }\' -F n=5';

  test("a GraphQL read with its own $n in single quotes is no merge and no opening", () => {
    for (const dialect of ["bash", "powershell"] as const) {
      expect(pullRequestMerges(READ_QUERY, null, dialect)).toEqual([]);
      expect(pullRequestOpenings(READ_QUERY, null, dialect)).toEqual([]);
    }
  });

  test("a literal query with variables is still judged by what it names", () => {
    const merge =
      "gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }'";
    expect(pullRequestMerges(merge, null, "bash").map((one) => one.refusal)).toEqual([
      "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge",
    ]);
    const open =
      "gh api graphql -f query='mutation($r: ID!) { createPullRequest(input: {repositoryId: $r, draft: true}) { clientMutationId } }'";
    expect(pullRequestOpenings(open, null, "bash").map((one) => one.draft)).toEqual([true]);
  });

  test.each([
    'gh api graphql -f query="$Q"',
    'gh api graphql -f query="query { viewer { login } } $(cat q)"',
    'gh api graphql -f query="`cat q`"',
    "gh api graphql -F query=$Q",
    'gh api graphql -f query="query($n: Int!) { a(number: $n) { b } }" -F n=5',
    "bash -c 'gh api graphql -f query=\"$Q\"'",
    `bash -c "gh api graphql -f 'query=mutation { mergePullRequest(input: {pullRequestId: \\"$ID\\"}) { x } }'"`,
    "bash <<EOF\ngh api graphql -f query='$Q'\nEOF",
  ])("%s is still a query the guard cannot read: the shell fills it in", (command) => {
    const calls = pullRequestMerges(command, null, "bash");
    expect([command, calls.length, calls[0]?.refusal]).toEqual([command, 1, SHELL_REFUSAL]);
  });

  test("a quoted here-doc script and an escaped \\$ are read as written", () => {
    expect(
      pullRequestMerges("bash <<'EOF'\ngh api graphql -f query='$Q'\nEOF", null, "bash"),
    ).toEqual([]);
    expect(pullRequestMerges("gh api graphql -f query=\\$Q", null, "bash")).toEqual([]);
  });

  test("a `$` the line reader cuts off from what follows is a query it cannot read", () => {
    for (const [command, dialect] of [
      ["gh api graphql -f query=$\\\nQ", "bash"],
      ['gh api graphql -f query="$\\\nQ"', "bash"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, read by the reader under test.
      ["gh api graphql -f query=${env:Q}", "powershell"],
    ] as const) {
      const calls = pullRequestMerges(command, null, dialect);
      expect([command, calls.map((one) => one.refusal)]).toEqual([command, [SHELL_REFUSAL]]);
    }
  });

  test("words a wrapper splits out of a string of its own are read by their text", () => {
    // `env -S` expands `${Q}` itself: no quote of this line says what the query becomes.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, read by the reader under test.
    const calls = pullRequestMerges("env -S 'gh api graphql -f query=${Q}'", null, "bash");
    expect(calls.map((one) => one.refusal)).toEqual([SHELL_REFUSAL]);
  });

  test("a query from a file or standard input stays unreadable", () => {
    for (const command of ["gh api graphql -f query=@q.graphql", "gh api graphql --input q.json"]) {
      expect(pullRequestMerges(command, null, "bash")).toHaveLength(1);
    }
  });

  test("PowerShell: '$n' is text and \"$n\" is filled in", () => {
    expect(
      pullRequestMerges("gh api graphql -f query='query($n: Int!) { x }'", null, "powershell"),
    ).toEqual([]);
    expect(
      pullRequestMerges('gh api graphql -f query="query($n) { x }"', null, "powershell"),
    ).toHaveLength(1);
  });

  test("gh's aliases are case-sensitive: the word is looked up as typed", () => {
    const aliases = new Map([["m", "pr merge"]]);
    expect(pullRequestMerges("gh m 5", aliases, "bash")).toHaveLength(1);
    // `gh M` is not the alias `m`: no gh command, no alias, and no merge in its words.
    expect(pullRequestMerges("gh M 5", aliases, "bash")).toEqual([]);
    // gh's own commands are found in any case.
    expect(pullRequestMerges("gh PR merge 5", aliases, "bash")).toHaveLength(1);
  });
});
