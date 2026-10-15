/**
 * The git guard (`git-guard.ts`). Each group has commands that MUST be asked about and
 * look-alikes that MUST pass: a guard that asks about `git push origin fix/devtools` gets
 * switched off. Every expected answer is written by hand.
 *
 * Most tests read the questions directly (`guardQuestions`); the hook itself, with
 * `ownHooks` and anymodel.json, is tested at the end and in `matrix.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { hookEnv, makeRepo, runHook, wireProjectHook, writeClaudeFile } from "../testing/hooks";
import { cleanGitEnv, git } from "../testing/temp";
import { DEFAULT_PROTECTED_BRANCHES, guardQuestions, runsGit } from "./git-guard";
import { gitGuardHook } from "./specs";

// Folders made once for this file (the preload removes only tempDir() folders after each test).
let base = "";
let neutral = ""; // no git repo: `git push` there has no current branch
let onDev = ""; // a repo with `dev` checked out
let onFeature = ""; // a repo with `fix/devtools` checked out

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "anymodel-guard-")));
  neutral = join(base, "plain");
  onDev = join(base, "on-dev");
  onFeature = join(base, "on-feature");
  mkdirSync(neutral);
  mkdirSync(onDev);
  mkdirSync(onFeature);
  git(onDev, "init", "-q", "-b", "dev");
  git(onFeature, "init", "-q", "-b", "fix/devtools");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const OPTIONS = { protectedBranches: ["dev", "main"], sharedStash: true };

/** The one question string the hook would ask, or undefined when it asks nothing. */
function guard(command: string, cwd: string = neutral, sharedStash = true): string | undefined {
  const questions = guardQuestions(command, cwd, { ...OPTIONS, sharedStash, env: cleanGitEnv() });
  return questions.length === 0 ? undefined : questions.join("\n");
}

describe("a force-push asks", () => {
  it.each([
    ["git push --force"],
    ["git push -f origin fix/x"],
    ["git push origin fix/x --force"],
    ["git push --force-with-lease"],
    ["git push --force-with-lease=fix/x:abc123 origin fix/x"],
    ["git push --force-if-includes origin fix/x"],
    ["git push -uf origin fix/x"], // -f hidden in a group of short options
    ["git push origin +fix/x"], // a `+` refspec forces too
    ["git push origin +HEAD:fix/x"],
    ["git -C ../other-folder push --force"],
    ["git add .; git commit -m x; git push -f"], // PowerShell chain
    ["git -c user.name=x push --force"], // git's own options before the subcommand
    ["GIT_TRACE=1 git push -f"],
    ["env GIT_TRACE=1 git push -f"],
    ["sudo git push -f"],
    ["git.exe push -f"], // PowerShell
    ['& "C:\\Program Files\\Git\\cmd\\git.exe" push -f'],
    ["git push \\\n  --force"], // bash: the line goes on
    ["git push `\n  --force"], // PowerShell: the line goes on
    ["if ($?) { git push -f }"], // PowerShell block
  ])("%j", (command) => {
    expect(guard(command)).toContain("force-push");
  });

  it.each([
    ["git push origin fix/x"],
    ["git push -u origin fix/devtools"],
    ["git push --follow-tags origin fix/x"],
    ["git push -o ci.skip origin fix/x"],
    ['git commit -m "never git push --force"'],
    ["git commit -m \"$(cat <<'EOF'\nfix\n\ngit push --force is banned\nEOF\n)\""],
    ["git fetch --force"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("a push to a protected branch asks", () => {
  it.each([
    ["git push origin dev", "dev"],
    ["git push origin main", "main"],
    ["git push -u origin dev", "dev"],
    ["git push origin HEAD:main", "main"],
    ["git push origin HEAD:refs/heads/dev", "dev"],
    ["git push origin refs/heads/main", "main"],
    ["git push origin fix/x:dev", "dev"],
    ["git push origin :main", "main"], // deleting main is a push to main
    ["git push origin --delete dev", "dev"],
    ["git switch main; git push origin main", "main"], // PowerShell chain
  ])("%j", (command, branch) => {
    expect(guard(command)).toContain(`straight to \`${branch}\``);
  });

  it.each([["git push --all"], ["git push --mirror origin"]])("%j", (command) => {
    expect(guard(command)).toContain("pushes every branch");
  });

  it("asks about both when a force-push goes to a protected branch", () => {
    const answer = guard("git push --force origin dev");
    expect(answer).toContain("force-push");
    expect(answer).toContain("straight to `dev`");
  });

  it.each([
    ["git push origin fix/devtools"],
    ["git push -u origin feat/main-menu"],
    ["git push origin refs/heads/fix/dev"],
    ["git push origin dev:fix/from-dev"], // sends a local `dev` to a branch named fix/…
    ["git push origin develop"],
    ["git push --tags"],
    ["git pull origin dev"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("asks only about the branches the project protects: by default main alone", () => {
    expect(DEFAULT_PROTECTED_BRANCHES).toEqual(["main"]);
    const only = (command: string) =>
      guardQuestions(command, neutral, {
        protectedBranches: DEFAULT_PROTECTED_BRANCHES,
        sharedStash: false,
        env: cleanGitEnv(),
      });
    expect(only("git push origin dev")).toEqual([]);
    expect(only("git push origin main")).toEqual([
      "This pushes straight to `main`, a protected branch: work usually reaches it through a pull request. Approve only if you meant to push there.",
    ]);
  });

  describe("without a named branch, the checked-out one is sent", () => {
    it.each([
      ["git push"],
      ["git push origin"],
      ["git push -u origin HEAD"],
      ["git push origin @"],
    ])("%j from a folder on dev", (command) => {
      expect(guard(command, onDev)).toContain("straight to `dev`");
    });

    it.each([
      ["git push"],
      ["git push origin"],
      ["git push -u origin HEAD"],
      ["git push origin @"],
    ])("%j from a folder on fix/devtools passes", (command) => {
      expect(guard(command, onFeature)).toBeUndefined();
    });

    it("follows `git -C <folder>`", () => {
      expect(guard(`git -C "${onDev}" push`, onFeature)).toContain("straight to `dev`");
      expect(guard(`git -C "${onFeature}" push`, onDev)).toBeUndefined();
    });

    it("cannot tell outside a repo, and then asks nothing", () => {
      expect(guard("git push", neutral)).toBeUndefined();
    });
  });
});

describe("git reset --hard asks", () => {
  it.each([
    ["git reset --hard"],
    ["git reset --hard origin/dev"],
    ["git fetch; git reset --hard origin/dev"],
  ])("%j", (command) => {
    expect(guard(command)).toContain("`git reset --hard`");
  });

  it.each([
    ["git reset --soft HEAD~1"],
    ["git reset HEAD file.ts"],
    ["git reset --mixed HEAD~1"],
    ['git commit -m "no git reset --hard here"'],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("git clean -f asks", () => {
  it.each([
    ["git clean -f"],
    ["git clean -fd"],
    ["git clean -xfd"],
    ["git clean --force -d"],
    ["git clean -d -f"],
  ])("%j", (command) => {
    expect(guard(command)).toContain("`git clean -f`");
  });

  it.each([
    ["git clean -n"],
    ["git clean -nd"],
    ["git clean --dry-run -d"],
    ["git clean -fdn"], // forced, but a dry run: it deletes nothing
    ["git clean"], // git itself refuses without -f
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("the shared stash, for a project that works in worktrees", () => {
  it.each([
    ["git stash"],
    ["git stash pop"],
    ["git stash -u"],
    ["git stash push"],
    ["git stash push -u"],
    ["git stash push -- src/a.ts"],
    ["git add -A; git stash"],
    ["git stash save"],
    ["git stash save -u"],
  ])("%j asks", (command) => {
    expect(guard(command)).toContain("shared by every worktree");
  });

  it.each([
    ["git stash push -u -m wip-audit-1"],
    ["git stash push --message wip-audit-1"],
    ["git stash -u -m wip-audit-1"],
    ["git stash list"],
    ["git stash apply 3f2a9c1d"],
    ["git stash drop stash@{1}"],
    ["git stash show -p"],
    ["git stash save wip-audit-1"],
    ['git commit -m "do not git stash"'],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("asks nothing about the stash when the project does not work in worktrees", () => {
    expect(guard("git stash pop", neutral, false)).toBeUndefined();
  });
});

describe("a heredoc or here-string body is data, whatever its last line ends in", () => {
  it.each([
    [
      "backtick",
      "git commit -F - <<'EOF'\nfix\n\ngit push --force is gone\nRun `bun run test`\nEOF",
    ],
    ["backslash", "git commit -F - <<'EOF'\nfix\n\ngit reset --hard is gone\nSee C:\\work\\\nEOF"],
    [
      "PowerShell here-string, backtick, with an apostrophe",
      "git commit -m @'\nIt's fixed\ngit stash pop is gone\nRun `bun run test`\n'@",
    ],
  ])("lets a body ending in a %s through", (_name, command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("still reads a real command after such a body", () => {
    expect(guard("cat <<'EOF'\nSee C:\\work\\\nEOF\ngit push --force")).toContain("force-push");
  });
});

describe("a cd earlier on the line moves the folder a push is judged in", () => {
  const into = [
    ["cd", (to: string) => `cd "${to}" && git push`],
    ["chdir", (to: string) => `chdir "${to}" && git push`],
    ["pushd", (to: string) => `pushd "${to}" && git push`],
    ["Set-Location", (to: string) => `Set-Location "${to}"; git push`],
    ["Set-Location -Path", (to: string) => `Set-Location -Path "${to}"; git push`],
    ["sl", (to: string) => `sl "${to}"; git push`],
    ["cd /d", (to: string) => `cd /d "${to}" && git push`],
  ] as const;

  it.each(into)("%s into a repo on dev, from a feature branch, asks", (_name, line) => {
    expect(guard(line(onDev), onFeature)).toContain("straight to `dev`");
  });

  it.each(into)("%s into a feature branch, from dev, passes", (_name, line) => {
    expect(guard(line(onFeature), onDev)).toBeUndefined();
  });

  it("follows a relative path from the session's folder", () => {
    expect(guard(`cd ../${basename(onDev)} && git push`, onFeature)).toContain("`dev`");
    expect(guard(`cd ../${basename(onFeature)} && git push`, onDev)).toBeUndefined();
  });

  it("follows each cd in turn", () => {
    expect(guard(`cd "${onDev}" && cd "${onFeature}" && git push`, onFeature)).toBeUndefined();
    expect(guard(`cd "${onFeature}" && cd "${onDev}" && git push`, onFeature)).toContain("`dev`");
  });

  it("does not move the folder of a push before the cd", () => {
    expect(guard(`git push; cd "${onDev}"`, onFeature)).toBeUndefined();
  });

  it.each([
    ["cd - && git push"],
    ["cd $env:DIR; git push"],
    ["cd ~/x && git push"],
    ["cd; git push"],
  ])("cannot follow %j, and asks nothing", (command) => {
    expect(guard(command, onDev)).toBeUndefined();
  });
});

describe("a shell wrapper's inner command is read", () => {
  it.each([
    ['bash -c "git push --force"', "force-push"],
    ["sh -c 'git push -f origin fix/x'", "force-push"],
    ['cmd /c "git reset --hard"', "git reset --hard"],
    ['powershell -Command "git push origin dev"', "straight to `dev`"],
    ['pwsh -c "git stash pop"', "shared by every worktree"],
    ['iex "git clean -fd"', "git clean -f"],
    ['Invoke-Expression "git branch -D fix/x"', "git branch -D"],
    ['eval "git push -f"', "force-push"],
    ["bash -c \"bash -c 'git push -f'\"", "force-push"],
  ])("asks about %j", (command, fragment) => {
    expect(guard(command)).toContain(fragment);
  });

  it("follows a cd inside the wrapper, and one before it", () => {
    expect(guard(`bash -c "cd ../${basename(onDev)} && git push"`, onFeature)).toContain("`dev`");
    expect(guard(`cd "${onDev}" && bash -c "git push"`, onFeature)).toContain("`dev`");
  });

  it.each([
    ['bash -c "echo hi"'],
    ["bash script.sh"],
    ['bash -c "git status"'],
    ['echo "bash -c git push -f"'],
    ["bash -c 'git commit -m \"x; git push -f\"'"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("a command that discards changes asks", () => {
  it.each([
    ["git checkout -- src/a.ts"],
    ["git checkout -- ."],
    ["git checkout ."],
    ["git checkout HEAD -- src/a.ts"],
    ["git checkout fix/x -- src/a.ts"],
    ["git checkout main ."],
    ["git checkout -f"],
    ["git checkout --force fix/x"],
    ["git switch -f fix/x"],
    ["git switch --force fix/x"],
    ["git switch --discard-changes fix/x"],
    ["git switch -fc fix/new"],
    ["git restore src/a.ts"],
    ["git restore ."],
    ["git restore --source=HEAD~1 src/a.ts"],
    ["git restore --staged --worktree src/a.ts"],
    ["git restore -SW src/a.ts"],
    ["git -C ../other restore ."],
  ])("%j", (command) => {
    expect(guard(command)).toContain("overwrites files in this folder");
  });

  it.each([
    ["git checkout fix/x"],
    ["git checkout -b fix/new"],
    ["git checkout -B fix/new origin/dev"],
    ["git checkout --track origin/fix/x"],
    ["git checkout -"],
    ["git checkout --"],
    ["git switch fix/x"],
    ["git switch -c fix/new"],
    ["git switch -C fix/new origin/dev"],
    ["git switch --create fix/force"],
    ["git switch --detach HEAD~1"],
    ["git restore --staged src/a.ts"],
    ["git restore -S src/a.ts"],
    ["git restore --source=HEAD~1 --staged src/a.ts"],
    ['git commit -m "git checkout -- ."'],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("git branch -D asks", () => {
  it.each([
    ["git branch -D fix/x"],
    ["git branch -d -f fix/x"],
    ["git branch -df fix/x"],
    ["git branch --delete --force fix/x"],
  ])("%j", (command) => {
    expect(guard(command)).toContain("`git branch -D`");
  });

  it.each([
    ["git branch -d fix/merged"],
    ["git branch fix/new"],
    ["git branch -a"],
    ["git branch -m fix/old fix/new"],
    ["git branch --force fix/x origin/dev"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("a shell keyword or a wrapper before the command is stepped over", () => {
  it.each([
    ["if true; then git push -f; fi"],
    ["if git push -f; then echo ok; fi"], // the condition runs too
    ["while true; do git push -f; break; done"],
    ["until false; do git push -f; done"],
    ["! git push -f"],
    ["timeout 60 git push -f"],
    ["timeout -s KILL 30 git push -f"],
    ["timeout --foreground 60s git push -f"],
    ["env -i git push -f"],
    ["env -u PATH -C /tmp git push -f"],
    ["env -i FOO=bar git push -f"],
    ["nice git push -f"],
    ["nice -n 5 git push -f"],
    ["sudo -u me git push -f"],
    ["sudo -u me -H git push -f"],
    ["exec -a a-name git push -f"],
    ["command -p git push -f"],
    ["stdbuf -o0 git push -f"],
    ["stdbuf -i0 -o0 -e0 git push -f"],
    ["ionice -c2 -n7 git push -f"],
    ["xargs git push -f"],
    ["xargs -0 -n 1 git push -f"],
    ["xargs -I{} git push -f"],
  ])("asks about %j", (command) => {
    expect(guard(command)).toContain("force-push");
  });

  it.each([
    ["command -v git"],
    ["command -V git"],
    ["nice -n 5 echo hi"],
    ["timeout 60 git status"],
    ["sudo -u me git log"],
    ["env -i git fetch"],
    ["xargs echo git"],
    ['bash -c "echo timeout 60 git push -f"'],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("finds a branch -D inside a loop, and a keyword with no command after it", () => {
    expect(guard("for b in a; do git branch -D z; done")).toContain("`git branch -D`");
    expect(guard("if git branch -D z; then echo ok; fi")).toContain("`git branch -D`");
    expect(guard("while true; do git branch -D z; done")).toContain("`git branch -D`");
    expect(guard("! git branch -D z")).toContain("`git branch -D`");
    expect(guard("then")).toBeUndefined();
    expect(guard("done")).toBeUndefined();
  });
});

describe("a long option abbreviated as git accepts it asks", () => {
  it.each([
    ["git push --forc"],
    ["git push --force-w"],
    ["git push --force-with-l origin fix/x"],
    ["git push --force-if-i origin fix/x"],
    ["git push --mirr"],
    ["git reset --ha"],
    ["git reset --har origin/dev"],
    ["git clean --forc"],
    ["git checkout --forc fix/x"],
    ["git switch --discard fix/x"],
    ["git switch --force fix/x"],
    ["git branch --dele --forc fix/x"],
    ["git branch --del --forc fix/x"],
    ["git worktree remove --forc ../wt"],
  ])("%j", (command) => {
    expect(guard(command)).toBeDefined();
  });

  it("a dry run with an abbreviated option still sends nothing", () => {
    expect(guard("git push --dr --forc")).toBeUndefined();
    expect(guard("git clean --dr -f")).toBeUndefined();
    expect(guard("git push --dry --forc")).toBeUndefined();
  });

  it.each([
    ["git push --tags"],
    ["git push --follow-tags origin fix/x"],
    ["git reset --soft HEAD~1"],
    ["git switch --detach HEAD~1"],
    ["git branch --format '%(refname)'"],
    ["git clean --dry-run -d"],
    ["git checkout --track origin/fix/x"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });
});

describe("a shell that reads its script from standard input is read", () => {
  it.each([
    ["sh <<'EOF'\ngit push -f\nEOF"],
    ["bash -s <<'EOF'\ngit push -f\nEOF"],
    ["zsh <<EOF\ngit push -f\nEOF"],
    ['sh <<< "git push -f"'],
    ['sh <<< "git push -f" && echo done'],
    ['echo "git push -f" | sh'],
    ["printf 'git push -f\\n' | bash"],
    ['echo "cd /tmp && git push -f" | dash'],
    ["bash -ce 'git push -f'"],
    ["sh -ec 'git push -f'"],
    ["bash -c 'git push -f'"], // -c was already read
  ])("asks about %j", (command) => {
    expect(guard(command)).toContain("force-push");
  });

  it("reads the here-doc body of a shell as its script", () => {
    expect(guard("bash <<'EOF'\ngit reset --hard\nEOF")).toContain("`git reset --hard`");
    expect(guard("sh <<'EOF'\ngit branch -D fix/x\nEOF")).toContain("`git branch -D`");
    expect(guard("bash -s <<'EOF'\ngit clean -fd\nEOF")).toContain("`git clean -f`");
    expect(guard("sh -s <<'EOF'\ngit stash clear\nEOF")).toContain("`git stash clear`");
    // Two commands in one body: each is read on its own.
    expect(guard("sh <<'EOF'\necho hi\ngit push -f\nEOF")).toContain("force-push");
    expect(guard("sh <<'EOF'\necho git push -f\nEOF")).toBeUndefined();
  });

  it.each([
    ["sh script.sh"],
    ["bash -c 'git status'"],
    ["sh -c 'echo hi' | sh"],
    ["echo hi | sh"],
    ["printf 'hi\\n' | sh"],
    ["cat script.sh | sh"],
    ["cat <<'EOF'\ngit push -f\nEOF"], // `cat`'s here-doc is data, and cat is no shell
    ["git commit -F - <<'EOF'\nfix\n\ngit push -f\nEOF"],
    ["sh -c 'git log' <<'EOF'\necho hi\nEOF"], // -c's script is the word, not the body
    ["bash script.sh <<'EOF'\ngit push -f\nEOF"], // a script file: the body is its stdin
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("runsGit sees git behind a wrapper, a keyword and a piped shell", () => {
    expect(runsGit("timeout 60 git status")).toBe(true);
    expect(runsGit("if true; then git status; fi")).toBe(true);
    expect(runsGit('echo "git status" | sh')).toBe(true);
    expect(runsGit("sudo -u me git status")).toBe(true);
    expect(runsGit("command -v git")).toBe(false);
    expect(runsGit("nice -n 5 echo hi")).toBe(false);
  });
});

describe("more work-destroying forms ask", () => {
  it.each([
    ["git stash clear"],
    ["git stash drop"],
    ["git stash drop -q"],
    ["git worktree remove -f ../other"],
    ["git worktree remove --force ../other"],
    ["git push origin :fix/x"],
    ["git push origin +:fix/x"],
    ["git push -d origin fix/x"],
    ["git push --delete origin fix/x"],
    ["git push --dele origin fix/x"],
  ])("%j", (command) => {
    expect(guard(command)).toBeDefined();
  });

  it.each([
    ["git stash drop stash@{1}"],
    ["git stash drop -q stash@{1}"],
    ["git worktree remove ../other"],
    ["git worktree list"],
    ["git worktree add ../other fix/x"],
    ["git stash list"],
    ["git push origin fix/x"],
    ["git push origin fix/x:fix/y"],
    ["git branch -d fix/merged"],
  ])("lets %j through", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("stash clear and an unnamed drop ask also when the project has no worktrees", () => {
    expect(guard("git stash clear", neutral, false)).toContain("`git stash clear`");
    expect(guard("git stash drop", neutral, false)).toContain("no stash named");
  });

  it("a named drop and a tagged push do not ask in a project without worktrees", () => {
    expect(guard("git stash drop stash@{0}", neutral, false)).toBeUndefined();
    expect(guard("git stash push -u -m wip", neutral, false)).toBeUndefined();
  });

  it("says which branch a remote delete would remove", () => {
    expect(guard("git push origin :fix/x")).toContain("deletes `fix/x` on the remote");
    expect(guard("git push -d origin fix/x")).toContain("deletes `fix/x` on the remote");
  });
});

describe("harmless forms do not ask", () => {
  it.each([
    ["git push --dry-run"],
    ["git push -n"],
    ["git push -n origin dev"],
    ["git push --dry-run --force"],
    ["git status # git push --force"],
    ['echo "$((1+2))"; git status'],
  ])("%j", (command) => {
    expect(guard(command)).toBeUndefined();
  });

  it.each([
    ['echo "$(git push --force)"'],
    ['x="$(git push -f origin fix/x)" && echo done'],
    ['echo "oops; git push -f'], // an unclosed quote is read blind
    ["echo a#b; git push -f"],
  ])("but %j still asks", (command) => {
    expect(guard(command)).toContain("force-push");
  });

  it("asks each question once, even when the line is read two ways", () => {
    expect(
      guardQuestions("git push -f \\\n origin fix/x", neutral, { ...OPTIONS, env: cleanGitEnv() }),
    ).toHaveLength(1);
  });
});

describe("runsGit: what the guard asks about when it cannot read anymodel.json", () => {
  it.each([
    ["git status", true],
    ["cd x && git log", true],
    ['bash -c "git fetch"', true],
    ["ls -la", false],
    ['echo "git push"', false],
  ])("%j: %j", (command, expected) => {
    expect(runsGit(command)).toBe(expected);
  });
});

describe("the hook", () => {
  const input = (cwd: string, command: string) => ({
    hook_event_name: "PreToolUse",
    session_id: "s1",
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });

  it("asks, as a PreToolUse decision, in a project with anymodel.json", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { protectedBranches: ["release"] });
    const result = await runHook(gitGuardHook, input(repo, "git push origin release"), hookEnv());
    expect(result).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            "This pushes straight to `release`, a protected branch: work usually reaches it through a pull request. Approve only if you meant to push there.",
        },
      }),
    });
  });

  it("stays silent without anymodel.json, whatever the command", async () => {
    const repo = makeRepo();
    expect(await runHook(gitGuardHook, input(repo, "git push -f origin main"), hookEnv())).toEqual(
      {},
    );
  });

  it("stays silent when anymodel.json lists it in ownHooks (the project runs its own copy)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { ownHooks: ["git-guard"] });
    wireProjectHook(repo, "PreToolUse", "Bash|PowerShell");
    expect(await runHook(gitGuardHook, input(repo, "git push -f"), hookEnv())).toEqual({});
  });

  it("still asks when a project hook on Bash is not listed in ownHooks (a logger must not silence it)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { ownHooks: ["session-name"] });
    wireProjectHook(repo, "PreToolUse", "Bash|PowerShell");
    wireProjectHook(repo, "PreToolUse", "Bash", "settings.local.json");
    const result = await runHook(gitGuardHook, input(repo, "git push -f"), hookEnv());
    expect(result.stdout).toContain('"permissionDecision":"ask"');
  });
});
