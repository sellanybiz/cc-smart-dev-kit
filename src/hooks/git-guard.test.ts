/**
 * The git guard (`git-guard.ts`). Each group has commands that MUST be asked about and
 * look-alikes that MUST pass: a guard that asks about `git push origin fix/devtools` gets
 * switched off. Every expected answer is written by hand.
 *
 * Most tests read the questions directly (`guardQuestions`); the hook itself, with
 * `ownHooks` and cc-smart-dev-kit.json, is tested at the end and in `matrix.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import type { Dialect } from "../shell/command";
import {
  commitConfig,
  hookEnv,
  makeRepo,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writePersonalWorkflow,
} from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { DEFAULT_PROTECTED_BRANCHES, guardQuestions, runsGit } from "./git-guard";
import { gitGuardHook } from "./specs";

// Folders made once for this file (the preload removes only tempDir() folders after each test).
let base = "";
let neutral = ""; // no git repo: `git push` there has no current branch
let onDev = ""; // a repo with `dev` checked out
let onFeature = ""; // a repo with `fix/devtools` checked out

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-guard-")));
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

/** `autoPush` on: a push asks only when it is a force-push or reaches a protected branch. */
const AUTO_PUSH_ON = () => null;

const OPTIONS = {
  protectedBranches: ["dev", "main"],
  autoPushAsk: AUTO_PUSH_ON,
  sharedStash: true,
};

/**
 * The one question string the hook would ask, or undefined when it asks nothing. `dialect`:
 * the tool's (`Bash` or `PowerShell`); not given, the guard reads the line both ways.
 */
function guard(
  command: string,
  cwd: string = neutral,
  sharedStash = true,
  dialect?: Dialect,
): string | undefined {
  const env = cleanGitEnv();
  const questions = guardQuestions(command, cwd, { ...OPTIONS, sharedStash, env, dialect });
  return questions.length === 0 ? undefined : questions.join("\n");
}

describe("a force-push asks", () => {
  it.each([
    ["git push --force"],
    ["A+=1 git push --force"],
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

describe("F2a-1: a push behind a wrapper, a shell, an alias, send-pack or a computed program", () => {
  it.each([
    ["setsid git push --force origin fix/x"],
    ["flock /tmp/l git push --force origin fix/x"],
    ["unbuffer git push --force origin fix/x"],
    ["chrt -f 50 git push --force origin fix/x"],
    ["taskset -c 0-3 git push --force origin fix/x"],
    ["script -qc 'git push -f origin fix/x'"],
    ["ksh -c 'git push -f origin fix/x'"],
    ["mksh -c 'git push -f origin fix/x'"],
    ["fish -c 'git push -f origin fix/x'"],
    ["busybox sh -c 'git push -f origin fix/x'"],
    ["git send-pack --force origin fix/x"],
    ["git -c alias.p=push p --force origin fix/x"],
    ["git -c alias.s=send-pack s --force origin fix/x"],
  ])("%j asks", (command) => {
    expect(guard(command)).toContain("force-push");
  });

  it("send-pack and an alias reach a protected branch", () => {
    expect(guard("git send-pack origin dev")).toContain("straight to `dev`");
    expect(guard("git -c alias.p=push p origin dev")).toContain("straight to `dev`");
  });

  it.each([["$(which git) push --force origin main"], ["GIT=git; $GIT push origin HEAD"]])(
    "a computed program whose words name a push asks: %j",
    (command) => {
      expect(guard(command)).toContain("cannot tell whether it pushes");
    },
  );

  it("a computed program with no push word passes, and so does a plain `echo push`", () => {
    expect(guard("$(which git) status")).toBeUndefined();
    expect(guard("echo push")).toBeUndefined();
  });
});

describe("F2a-3: PowerShell Start-Process runs what it is given", () => {
  it.each([
    "Start-Process -FilePath git -ArgumentList 'push -f origin fix/x'",
    "Start-Process git 'push -f origin fix/x'",
    "Start-Process -FilePath git -ArgumentList 'push origin dev'",
  ])("%j asks", (command) => {
    expect(guard(command, neutral, true, "powershell")).toBeDefined();
  });

  it("a Start-Process that runs no git passes", () => {
    expect(guard("Start-Process notepad 'notes.txt'", neutral, true, "powershell")).toBeUndefined();
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
        autoPushAsk: AUTO_PUSH_ON,
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

  // `&>` attached to the option: the option is still `--hard`. Read as the Bash tool reads it:
  // PowerShell's reading splits at the `&` anyway.
  it.each([["git reset --hard&>/dev/null"], ["git reset --hard&>>log"]])("bash: %j", (command) => {
    expect(guard(command, neutral, true, "bash")).toContain("`git reset --hard`");
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
  ])("lets a body ending in a %s through", (_name, command) => {
    expect(guard(command)).toBeUndefined();
  });

  it("lets a PowerShell here-string through in the PowerShell tool, an apostrophe and a backtick in it", () => {
    const command = "git commit -m @'\nIt's fixed\ngit stash pop is gone\nRun `bun run test`\n'@";
    expect(guard(command, neutral, true, "powershell")).toBeUndefined();
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
    // The finding of the GI1 review: runners the shell reader did not know.
    ["watch git push -f"],
    ["watch -n 5 'git push -f'"],
    ["find . -exec git push -f \\;"],
    ["find . -maxdepth 0 -execdir git push -f {} +"],
    ["find . -exec true \\; -exec git push -f \\;"],
    ["su -c 'git push -f' me"],
    ["su - me -c 'git push -f'"],
    ["parallel git push -f ::: a b"],
    ["parallel -j2 'git push -f {}' ::: a b"],
    ["sudo watch git push -f"],
    // The review of the follow-up: the spellings that still hid the inner program.
    ["watch -q 3 git push -f"],
    // The second review: a -d with an attached value, arguments after `:::`, a third unknown option.
    ["watch -dq git push -f"],
    ["watch -dn git push -f"],
    ["parallel git push ::: -f"],
    ["parallel bash -c ::: 'git push -f'"],
    ["parallel eval ::: 'git push -f'"],
    ["parallel --tmpdir /tmp --wd . --ssh ssh git push -f ::: a"],
    ["watch --equexit 3 git push -f"],
    ["watch --int 5 git push -f"],
    ["parallel -u git push -f ::: a"],
    ["parallel -C , 'git push -f' ::: a"],
    ["parallel --delay 1 git push -f ::: a"],
    ["parallel ::: 'git push -f'"],
    ["find . -maxdepth 0 -exec flock + git push -f \\;"],
    ["su -- me -c 'git push -f'"],
    ["su --session-command 'git push -f' me"],
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
    ["watch git status"],
    ["find . -name x -exec echo git push \\;"],
    ["su -c 'git status' me"],
    ["parallel echo git push ::: a"],
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

describe("runsGit: what the guard asks about when it cannot read cc-smart-dev-kit.json", () => {
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

  it("asks, as a PreToolUse decision, in a project with cc-smart-dev-kit.json", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { protectedBranches: ["release"] });
    const env = hookEnv();
    writePersonalWorkflow(env, { autoPush: true });
    const result = await runHook(gitGuardHook, input(repo, "git push origin release"), env);
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

  it("stays silent without cc-smart-dev-kit.json, whatever the command", async () => {
    const repo = makeRepo();
    expect(await runHook(gitGuardHook, input(repo, "git push -f origin main"), hookEnv())).toEqual(
      {},
    );
  });

  it("stays silent when cc-smart-dev-kit.json lists it in ownHooks (the project runs its own copy)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard"] });
    wireProjectHook(repo, "PreToolUse", "Bash|PowerShell");
    expect(await runHook(gitGuardHook, input(repo, "git push -f"), hookEnv())).toEqual({});
  });

  it("still asks when a project hook on Bash is not listed in ownHooks (a logger must not silence it)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["session-name"] });
    wireProjectHook(repo, "PreToolUse", "Bash|PowerShell");
    wireProjectHook(repo, "PreToolUse", "Bash", "settings.local.json");
    const result = await runHook(gitGuardHook, input(repo, "git push -f"), hookEnv());
    expect(result.stdout).toContain('"permissionDecision":"ask"');
  });
});

/** Every hook in `hooks.json` gets 10 s; the guard must answer well within that. */
const GUARD_TIME_LIMIT_MS = 3_000;

/** The force-push question's own words. */
const FORCE = "This is a force-push";

describe("the guard bypasses of the 0.6.0 audit: each spelling asks", () => {
  const asks = (command: string, dialect?: Dialect) => guard(command, neutral, true, dialect);

  it("HK-2: a command inside an unquoted here-doc body is read", () => {
    expect(asks("cat <<EOF\n$(git push --force origin x)\nEOF")).toContain(FORCE);
    expect(asks("git commit -F - <<EOF\nfix: `git reset --hard`\nEOF")).toContain("reset --hard");
    // With no closing line bash still expands the body, to the end of the text.
    expect(asks("cat <<EOF\n$(git push --force origin x)")).toContain(FORCE);
    // A quoted word, in any of its spellings, keeps the body text.
    expect(asks("cat <<'EOF'\n$(git push --force origin x)\nEOF")).toBeUndefined();
    expect(asks('cat <<"EOF"\n$(git push --force origin x)\nEOF')).toBeUndefined();
    expect(asks("cat <<\\EOF\n$(git push --force origin x)\nEOF")).toBeUndefined();
    expect(asks('cat <<E"O"F\n$(git push --force origin x)\nEOF')).toBeUndefined();
  });

  it("HK-3: a PowerShell line is read with PowerShell's quoting", () => {
    // A backslash is a plain character in PowerShell, so each path ends at its quote.
    const paths = 'cd "C:\\a\\"; git push --force origin x; cd "C:\\b\\"';
    expect(asks(paths, "powershell")).toContain(FORCE);
    // `<# … #>` is a block comment; the command after it runs.
    expect(asks("<# tidy up #> git push --force origin x", "powershell")).toContain(FORCE);
    // A typographic quote closes a string in PowerShell.
    const typographic = "echo 'a\u2018 ; git push --force origin x ; \u2018b'";
    expect(asks(typographic, "powershell")).toContain(FORCE);
    // `@"…"@` expands its `$( … )`; `@'…'@` does not.
    expect(asks('echo @"\n$(git push --force origin x)\n"@', "powershell")).toContain(FORCE);
    expect(asks("echo @'\n$(git push --force origin x)\n'@", "powershell")).toBeUndefined();
    // Not told the tool, the guard reads both ways: PowerShell's reading finds it.
    expect(asks(paths)).toContain(FORCE);
  });

  it("HK-4: a brace inside a word does not cut the line", () => {
    expect(asks("git push origin HEAD@{0}:main")).toContain("straight to `main`");
    expect(asks("f(){ git push --force origin x; }; f")).toContain(FORCE);
  });

  it("HK-7: git's own options that take a value, and one the guard does not know", () => {
    expect(asks("git --config-env x.y=HOME push --force origin x")).toContain(FORCE);
    expect(asks("git --config-env=x.y=HOME push --force origin x")).toContain(FORCE);
    expect(asks("git --attr-source HEAD push --force origin x")).toContain(FORCE);
    expect(asks("git --future-option some-value push --force origin x")).toContain(FORCE);
    expect(asks("git --no-pager -P push --force origin x")).toContain(FORCE);
    // git only prints, and runs no subcommand.
    expect(asks("git --version push --force")).toBeUndefined();
    expect(asks("git --exec-path push --force")).toBeUndefined();
  });

  it("HK-8: a program name spelled with an escape or an ANSI-C quote", () => {
    expect(asks("g\\it push --force origin x")).toContain(FORCE);
    expect(asks("$'git' push --force origin x")).toContain(FORCE);
    expect(asks("$'\\x67it' push --force origin x")).toContain(FORCE);
    expect(asks("git push origin ma\\in")).toContain("straight to `main`");
  });

  it("HK-9: `bash -c --` and `env -S`", () => {
    expect(asks("bash -c -- 'git push --force origin x'")).toContain(FORCE);
    expect(asks("bash -c -e 'git push --force origin x'")).toContain(FORCE);
    expect(asks("bash -O extglob -c 'git push --force origin x'")).toContain(FORCE);
    expect(asks("env -S 'git push --force origin x'")).toContain(FORCE);
    expect(asks("env -S'git push --force origin x'")).toContain(FORCE);
    expect(asks("env --split-string='git push --force' origin x")).toContain(FORCE);
    expect(asks("env -iS 'GIT_TRACE=1 git push --force origin x'")).toContain(FORCE);
  });

  it("HK-10: doas runs the command after it", () => {
    expect(asks("doas git push --force origin x")).toContain(FORCE);
    expect(asks("doas -u me git push --force origin x")).toContain(FORCE);
  });

  it("a backtick substitution, an arithmetic expansion and an escaped space before a #", () => {
    expect(asks("echo `git push --force origin x`")).toContain(FORCE);
    expect(asks('echo "`git push --force origin x`"')).toContain(FORCE);
    expect(asks("echo $(( $(git push --force origin x) ))")).toContain(FORCE);
    expect(asks("echo \\ #; git push --force origin x")).toContain(FORCE);
    expect(asks("echo $(true)#; git push --force origin x")).toContain(FORCE);
    // A PowerShell here-string means nothing to bash: its `$( … )` runs there.
    expect(asks('echo @"\n$(git push --force origin x)\n"@', "bash")).toContain(FORCE);
  });

  it("a redirection is never a refspec, before the program or after it", () => {
    expect(asks("2>/dev/null git push --force origin x")).toContain(FORCE);
    expect(guard("git push origin 2>&1", onDev)).toContain("straight to `dev`");
    expect(guard("git push origin > /dev/null", onDev)).toContain("straight to `dev`");
    expect(asks("git push origin main>log")).toContain("straight to `main`");
  });

  it("a CRLF line, and a line that goes on with CRLF, are read", () => {
    expect(asks("git status\r\ngit push --force origin x\r\n")).toContain(FORCE);
    expect(asks("git push \\\r\n  --force origin x")).toContain(FORCE);
  });

  it("HK: `claude plugin eval` is not the shell's eval", () => {
    expect(asks("claude plugin eval . --eval-dir evals/cases")).toBeUndefined();
    expect(asks("claude plugin eval 'git push --force origin x'")).toBeUndefined();
    // The shell's own eval still runs the line it is given.
    expect(asks('eval "git push --force origin x"')).toContain(FORCE);
  });

  it("job run's queued command is read", () => {
    const queued = `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind test -- bash -c 'bun test && git push --force origin x'`;
    expect(asks(queued)).toContain(FORCE);
  });
});

describe("a push sends what git would send", () => {
  /** A repo on `branch`, with each `key value` set in its own git config. */
  function repoOn(branch: string, config: [string, string][] = []): string {
    const dir = tempDir("guard-push");
    git(dir, "init", "-q", "-b", branch);
    for (const [key, value] of config) git(dir, "config", key, value);
    return dir;
  }

  it("HK hunch 7: with push.default=upstream, a bare push goes to the branch it tracks", () => {
    const repo = repoOn("feature", [
      ["push.default", "upstream"],
      ["branch.feature.remote", "origin"],
      ["branch.feature.merge", "refs/heads/main"],
    ]);
    expect(guard("git push", repo)).toContain("straight to `main`");
    expect(guard("git push origin", repo)).toContain("straight to `main`");
    // `HEAD` is the branch's own name, whatever push.default says.
    expect(guard("git push origin HEAD", repo)).toBeUndefined();
  });

  it("a push.default set on the line counts, and one read from the environment asks", () => {
    const repo = repoOn("feature", [["branch.feature.merge", "refs/heads/main"]]);
    expect(guard("git push", repo)).toBeUndefined();
    expect(guard("git -c push.default=upstream push", repo)).toContain("straight to `main`");
    expect(guard("git --config-env push.default=MODE push", repo)).toContain("straight to `");
  });

  it("push.default=matching and the matching refspec `:` send every branch both sides have", () => {
    const matching = repoOn("feature", [["push.default", "matching"]]);
    expect(guard("git push", matching)).toContain("straight to `");
    expect(guard("git push origin :", onFeature)).toContain("straight to `");
    expect(guard("git push", repoOn("feature", [["push.default", "nothing"]]))).toBeUndefined();
  });

  it("a remote's own push refspecs are what a bare push sends", () => {
    const forced = repoOn("feature", [["remote.origin.push", "+refs/heads/*:refs/heads/*"]]);
    const answer = guard("git push", forced);
    expect(answer).toContain(FORCE);
    expect(answer).toContain("straight to `");
    const narrow = repoOn("feature", [
      ["remote.origin.push", "refs/heads/feature:refs/heads/review"],
    ]);
    expect(guard("git push", narrow)).toBeUndefined();
  });

  it("HK improvement 7: a wildcard refspec that reaches a protected branch asks", () => {
    expect(guard("git push origin 'refs/heads/*:refs/heads/*'")).toContain("straight to `");
    expect(guard("git push origin '*:*'")).toContain("straight to `");
    expect(guard("git push origin 'refs/heads/fix-*:refs/heads/fix-*'")).toBeUndefined();
  });

  it("reads git once a folder, however many pushes the line has", () => {
    const line = Array.from({ length: 200 }, () => "git push").join("; ");
    const started = Date.now();
    expect(guard(line, onFeature)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(GUARD_TIME_LIMIT_MS);
  });
});

describe("a 64 KB command line is read within the guard's time", () => {
  const SIZE = 64 * 1024;
  const fill = (piece: string) => piece.repeat(Math.ceil(SIZE / piece.length)).slice(0, SIZE);
  it.each([
    ["a long commit message", `git commit -m "${fill("word; git push --force ")}"`],
    ["many commands", fill("git status; ")],
    ["many here-docs", fill("cat <<A ")],
    ["deep arithmetic", `echo ${"$((".repeat(SIZE / 6)}1${"))".repeat(SIZE / 6)}`],
    ["nested quotes and substitutions", fill("\"$(echo `a` 'b')\" ")],
    ["many PowerShell comments", fill("<# x #> ")],
    ["an unclosed quote", `echo "${fill("a; b ")}`],
  ])("%s", (_name, command) => {
    const started = Date.now();
    guard(command);
    expect(Date.now() - started).toBeLessThan(GUARD_TIME_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------------------
// D15: `autoPush` off is enforced.
// ---------------------------------------------------------------------------------------

/** The project's file as committed on `origin/dev`, the integration base. */
const BASE_CONFIG = { requires: ">=0.4", worktrees: { base: "dev" } };

/** A repo whose `origin/dev` holds `config`, and the hook's environment. */
function policyRepo(config: unknown = BASE_CONFIG): { env: Record<string, string>; repo: string } {
  const repo = makeRepo();
  commitConfig(repo, config, ["dev"]);
  return { env: hookEnv(), repo };
}

/** The hook's decision and reason for one command, or null when it was silent. */
async function pushAnswer(
  env: Record<string, string>,
  repo: string,
  command: string,
  tool = "Bash",
): Promise<{ decision: string; reason: string } | null> {
  const result = await runHook(
    gitGuardHook,
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: repo,
      tool_name: tool,
      tool_input: { command },
    },
    env,
  );
  if (result.stdout === undefined) return null;
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  return { decision: output.permissionDecision, reason: output.permissionDecisionReason };
}

/** What the guard says when `autoPush` is off, read from the project's committed file on `dev`. */
const AUTO_PUSH_OFF =
  'This push leaves the machine, and autoPush is off (default), so a push is yours to approve: turn it on for yourself with `cc-smart-dev-kit workflow set autoPush true`, or for the project in .claude/cc-smart-dev-kit.json ("workflow": {"autoPush": true}), committed to dev and pushed. Approve it yourself if you meant it.';

describe("D15: autoPush off asks before any git push", () => {
  it("D15: off (the default) asks for a feature-branch push, naming the setting and the fix", async () => {
    const { env, repo } = policyRepo();
    expect(await pushAnswer(env, repo, "git push origin fix/x")).toEqual({
      decision: "ask",
      reason: AUTO_PUSH_OFF,
    });
  });

  it("D15: every spelling of a push asks: bare, -C, a shell string, a chain, PowerShell", async () => {
    const { env, repo } = policyRepo();
    for (const [command, tool] of [
      ["git push", "Bash"],
      ["git push -u origin HEAD", "Bash"],
      ["git -C ../other push", "Bash"],
      ["bash -c 'git push origin fix/x'", "Bash"],
      ["cd sub && git commit -m x && git push", "Bash"],
      ["env GIT_TRACE=1 git push origin fix/x", "Bash"],
      ["git push origin fix/x; git status", "PowerShell"],
    ] as const) {
      const answer = await pushAnswer(env, repo, command, tool);
      expect([command, answer?.decision]).toEqual([command, "ask"]);
      expect(answer?.reason).toContain("autoPush is off");
    }
  });

  it("D15: what sends nothing, and what is no push, stays silent", async () => {
    const { env, repo } = policyRepo();
    for (const command of [
      "git push --dry-run origin fix/x",
      "git push -n",
      "git status",
      "git commit -m 'git push later'",
      'echo "git push"',
      "git fetch origin",
    ]) {
      expect([command, await pushAnswer(env, repo, command)]).toEqual([command, null]);
    }
  });

  it("D15: on (committed on the base) is silent for a feature branch, and main still asks", async () => {
    const { env, repo } = policyRepo({ ...BASE_CONFIG, workflow: { autoPush: true } });
    expect(await pushAnswer(env, repo, "git push origin fix/x")).toBeNull();
    // A bare push from a feature branch sends that branch, and from main it asks for main.
    expect((await pushAnswer(env, repo, "git push"))?.reason).toContain("straight to `main`");
    git(repo, "switch", "-q", "-c", "fix/x");
    expect(await pushAnswer(env, repo, "git push")).toBeNull();
    const main = await pushAnswer(env, repo, "git push origin main");
    expect(main?.reason).toBe(
      "This pushes straight to `main`, a protected branch: work usually reaches it through a pull request. Approve only if you meant to push there.",
    );
    expect((await pushAnswer(env, repo, "git push -f origin fix/x"))?.reason).toStartWith(
      "This is a force-push",
    );
  });

  it("D15: off and a force-push are both asked, in one answer", async () => {
    const { env, repo } = policyRepo();
    const answer = await pushAnswer(env, repo, "git push --force origin fix/x");
    expect(answer?.reason).toContain("This is a force-push");
    expect(answer?.reason).toContain(AUTO_PUSH_OFF);
  });

  it("D15: the person's own workflow file turns it on", async () => {
    const { env, repo } = policyRepo();
    writePersonalWorkflow(env, { autoPush: true });
    expect(await pushAnswer(env, repo, "git push origin fix/x")).toBeNull();
  });

  it("D15: a worktree's uncommitted autoPush: true counts for nothing", async () => {
    const { env, repo } = policyRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...BASE_CONFIG,
      workflow: { autoPush: true },
    });
    expect((await pushAnswer(env, repo, "git push origin fix/x"))?.reason).toBe(AUTO_PUSH_OFF);
    // Nor does a worktree of the repo with its own file.
    const worktree = join(repo, "..", "app-wt-session");
    git(repo, "worktree", "add", "-q", "-b", "session-branch", worktree);
    writeClaudeFile(worktree, "cc-smart-dev-kit.json", {
      ...BASE_CONFIG,
      workflow: { autoPush: true },
    });
    expect((await pushAnswer(env, worktree, "git push origin fix/x"))?.reason).toBe(AUTO_PUSH_OFF);
  });

  it("D15: a policy that cannot be read asks, with the reason", async () => {
    const lost = policyRepo({ ...BASE_CONFIG, worktrees: { base: "nowhere" } });
    git(lost.repo, "update-ref", "-d", "refs/remotes/origin/nowhere");
    expect((await pushAnswer(lost.env, lost.repo, "git push origin fix/x"))?.reason).toStartWith(
      "cc-smart-dev-kit cannot tell whether this push is allowed: the push policy committed on nowhere cannot be read",
    );
    const { env, repo } = policyRepo();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect((await pushAnswer(env, repo, "git push origin fix/x"))?.reason).toStartWith(
      "cc-smart-dev-kit cannot tell whether this push is allowed: the workflow settings cannot be read",
    );
  });

  it("D15: a project with no integration base reads the default and the person's own file", async () => {
    const { env, repo } = policyRepo({ requires: ">=0.4" });
    expect((await pushAnswer(env, repo, "git push origin fix/x"))?.reason).toContain(
      "committed to the integration base (worktrees.base) and pushed",
    );
    writePersonalWorkflow(env, { autoPush: true });
    expect(await pushAnswer(env, repo, "git push origin fix/x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The hook's question before each command that destroys work.
// ---------------------------------------------------------------------------------------

/** Each command that destroys work, and the question the hook asks, written by hand. */
const WORK_COMMANDS = [
  [
    "git checkout -- src/a.ts",
    "`git checkout` here overwrites files in this folder with another version, and any uncommitted change in them is lost for good. Approve only if you want them gone; a WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.",
  ],
  [
    "git restore src/a.ts",
    "`git restore` here overwrites files in this folder with another version, and any uncommitted change in them is lost for good. Approve only if you want them gone; a WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.",
  ],
  [
    "git switch -f dev",
    "`git switch` here overwrites files in this folder with another version, and any uncommitted change in them is lost for good. Approve only if you want them gone; a WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.",
  ],
  [
    "git worktree remove --force ../app-wt-other",
    "`git worktree remove --force` deletes a worktree even when it holds uncommitted or untracked work, and git cannot bring that back. Look in it first.",
  ],
  [
    "git branch -D fix/x",
    "`git branch -D` deletes a branch even if it was never merged: its commits are then only in the reflog. `git branch -d` deletes a merged branch, and does not ask.",
  ],
  [
    "git reset --hard",
    "`git reset --hard` throws away every uncommitted change in this folder, for good. Approve only if you want them gone; a WIP commit keeps the work first.",
  ],
  [
    "git reset --merge HEAD~1",
    "`git reset --merge` throws away changes that are staged but not committed: a staged change to a tracked file goes back to the target version, and a staged new file is deleted from the folder (measured). Your working files are kept: it refuses rather than overwrite one whose working copy differs from the target, including a file with both staged and unstaged changes (measured on git 2.53). Approve only if you want the staged work gone; a WIP commit keeps it first.",
  ],
  [
    "git clean -f",
    "`git clean -f` deletes untracked files for good: git cannot bring them back. `git clean -n` shows what it would delete, without deleting.",
  ],
  [
    "git stash clear",
    "`git stash clear` throws away every stash for good: git cannot bring them back. `git stash list` shows what they hold, `git stash show -p` one of them.",
  ],
  [
    "git stash drop",
    "`git stash drop` with no stash named drops the newest one, whoever made it. `git stash list` shows them; `git stash drop stash@{n}` drops the one you mean.",
  ],
  [
    "git stash",
    "The git stash is shared by every worktree of this repo, so a bare `git stash` or `git stash pop` can take or restore another session's work. A WIP commit is safer; or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.",
  ],
  [
    "git stash pop",
    "The git stash is shared by every worktree of this repo, so a bare `git stash` or `git stash pop` can take or restore another session's work. A WIP commit is safer; or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.",
  ],
] as const;

describe("the hook asks before a command that destroys work", () => {
  it("each command gets exactly its question", async () => {
    const { env, repo } = policyRepo();
    for (const [command, ask] of WORK_COMMANDS) {
      expect([command, await pushAnswer(env, repo, command)]).toEqual([
        command,
        { decision: "ask", reason: ask },
      ]);
    }
  });

  it("a bare stash is silent in the main checkout when the project does not work in worktrees", async () => {
    const { env, repo } = policyRepo({ requires: ">=0.4" });
    for (const command of ["git stash", "git stash pop"]) {
      expect([command, await pushAnswer(env, repo, command)]).toEqual([command, null]);
    }
  });

  it("a bare stash asks in a linked worktree, even with no worktrees key", async () => {
    // Builders in linked worktrees of one repo share its stash list, so one builder's
    // `git stash pop` can take another's work.
    const { env, repo } = policyRepo({ requires: ">=0.4" });
    const linked = join(dirname(repo), "app-linked");
    git(repo, "worktree", "add", "-q", "-b", "fix/linked", linked);
    const ask =
      "The git stash is shared by every worktree of this repo, so a bare `git stash` or `git stash pop` can take or restore another session's work. A WIP commit is safer; or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.";
    for (const command of ["git stash", "git stash pop"]) {
      expect([command, await pushAnswer(env, linked, command)]).toEqual([
        command,
        { decision: "ask", reason: ask },
      ]);
    }
  });

  it("the tagged stash form, a named drop and a read stay silent", async () => {
    const { env, repo } = policyRepo();
    for (const command of [
      "git stash push -u -m my-tag",
      "git stash apply 1234567",
      "git stash drop stash@{0}",
      "git stash list",
    ]) {
      expect([command, await pushAnswer(env, repo, command)]).toEqual([command, null]);
    }
  });

  it("a too-new project file asks: the guard fails closed", async () => {
    const { env, repo } = policyRepo({ requires: ">=99" });
    expect((await pushAnswer(env, repo, "git commit -m x"))?.decision).toBe("ask");
  });

  it("a project whose ownHooks lists git-guard answers with its own copy", async () => {
    const { env, repo } = policyRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard"] });
    expect(await pushAnswer(env, repo, "git reset --hard")).toBeNull();
  });

  it("CC8: git reset --keep loses no working file, so it asks nobody", async () => {
    // Measured on git 2.53: --keep never overwrites a working file (it refuses instead), and a
    // staged change becomes unstaged when the target does not touch the file. It does reset
    // the index, so a version staged and not also in the working file is dropped, but no
    // working file is lost, so there is no question to put to a person.
    const { env, repo } = policyRepo();
    for (const command of ["git reset --keep HEAD~1", "git reset --keep", "git reset --ke HEAD"]) {
      expect([command, await pushAnswer(env, repo, command)]).toEqual([command, null]);
    }
  });

  it("CC8: with the tool unknown, the guard reads both dialects", async () => {
    // PowerShell reads its own curly quotes (“ ”) as quoting; Bash does not. Not told the tool,
    // the guard reads the line both ways, and sees the reset.
    const { env, repo } = policyRepo();
    expect(await pushAnswer(env, repo, "git reset “--hard”", "SomeTool")).toEqual({
      decision: "ask",
      reason:
        "`git reset --hard` throws away every uncommitted change in this folder, for good. Approve only if you want them gone; a WIP commit keeps the work first.",
    });
  });
});
