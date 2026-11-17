/** What a shell line writes: the one reader the main-folder guard asks. Paths are POSIX. */
import { describe, expect, test } from "bun:test";
import { writeTargets } from "./writes";

const CWD = "/code/app";

/** The targets of `command` run in `/code/app`. */
function targets(command: string, cwd: string | null = CWD): string[] {
  return writeTargets(command, cwd, "bash");
}

describe("redirections", () => {
  test.each([
    ["echo x > a.txt", ["/code/app/a.txt"]],
    ["echo x >> src/a.txt", ["/code/app/src/a.txt"]],
    ["echo x >| a.txt", ["/code/app/a.txt"]],
    ["make &> build.log", ["/code/app/build.log"]],
    ["cat > /tmp/x <<'EOF'\nbody > not-a-file\nEOF", ["/tmp/x"]],
    ["cmd 2> err.log", ["/code/app/err.log"]],
    ["echo x > a.txt 2>&1", ["/code/app/a.txt"]],
  ])("%j", (command, expected) => {
    expect(targets(command)).toEqual(expected);
  });

  test("a read, a descriptor and /dev/null write nothing in the repo", () => {
    expect(targets("cat < a.txt")).toEqual([]);
    expect(targets("cmd 2>&1")).toEqual([]);
    // /dev/null is a target like any other: it is outside every repo, and the guard lets it pass.
    expect(targets("echo x > /dev/null")).toEqual(["/dev/null"]);
  });

  test("a word the shell fills in when the line runs names nothing", () => {
    expect(targets('echo x > "$OUT"')).toEqual([]);
    expect(targets("echo x > $(mktemp)")).toEqual([]);
    expect(targets("echo x > ~/notes")).toEqual([]);
    expect(targets("echo x > `pwd`/a")).toEqual([]);
  });
});

describe("the programs that change files", () => {
  test.each([
    ["tee a.txt", ["/code/app/a.txt"]],
    ["echo x | tee -a a.txt b.txt", ["/code/app/a.txt", "/code/app/b.txt"]],
    ["sed -i s/a/b/ src/a.ts", ["/code/app/src/a.ts"]],
    ["sed -i.bak s/a/b/ src/a.ts src/b.ts", ["/code/app/src/a.ts", "/code/app/src/b.ts"]],
    ["sed --in-place -e s/a/b/ a.ts", ["/code/app/a.ts"]],
    ["sed -ni -e 's/a/b/p' a.ts", ["/code/app/a.ts"]],
    ["cp a.txt b.txt", ["/code/app/b.txt"]],
    ["cp -r a b /tmp/out", ["/tmp/out"]],
    ["cp -t /tmp/out a b", ["/tmp/out"]],
    ["mv a.txt /tmp/b.txt", ["/tmp/b.txt", "/code/app/a.txt"]],
    ["rm -rf build dist", ["/code/app/build", "/code/app/dist"]],
    ["rm -- -odd", ["/code/app/-odd"]],
    ["rmdir old", ["/code/app/old"]],
    ["touch a.txt", ["/code/app/a.txt"]],
    ["touch -d yesterday a.txt", ["/code/app/a.txt"]],
    ["mkdir -p -m 755 x/y", ["/code/app/x/y"]],
    ["ln -s ../a link", ["/code/app/link"]],
    ["ln -s /etc/hosts", ["/code/app/hosts"]],
    ["ln -s a b -t /tmp", ["/tmp"]],
  ])("%j", (command, expected) => {
    expect(targets(command).sort()).toEqual([...expected].sort());
  });

  test("sed without -i, and a program it does not know, write nothing", () => {
    expect(targets("sed s/a/b/ a.txt")).toEqual([]);
    expect(targets("sed -n -e p a.txt")).toEqual([]);
    expect(targets("cat a.txt")).toEqual([]);
    expect(targets("ls -la")).toEqual([]);
    expect(targets("bun test")).toEqual([]);
    expect(targets("constructor x")).toEqual([]);
  });

  test("a word the shell fills in is left out, the rest of the command still counts", () => {
    expect(targets("rm $FILE b.txt")).toEqual(["/code/app/b.txt"]);
    expect(targets("cp a.txt $DEST")).toEqual([]);
  });

  test("a wrapper in front of the program, and a shell running the text, are read through", () => {
    expect(targets("sudo rm a.txt")).toEqual(["/code/app/a.txt"]);
    expect(targets("FOO=1 touch a.txt")).toEqual(["/code/app/a.txt"]);
    expect(targets("bash -c 'echo x > a.txt'")).toEqual(["/code/app/a.txt"]);
    expect(targets("echo $(touch inner.txt)")).toEqual(["/code/app/inner.txt"]);
  });

  test("every command of a line counts", () => {
    expect(targets("touch a && rm b; echo x > c")).toEqual([
      "/code/app/a",
      "/code/app/b",
      "/code/app/c",
    ]);
  });
});

describe("the folder a command runs in", () => {
  test("a cd earlier on the line moves the later commands", () => {
    expect(targets("cd .claude/worktrees/w && echo x > a.txt")).toEqual([
      "/code/app/.claude/worktrees/w/a.txt",
    ]);
    expect(targets("cd /tmp && touch a && cd /code/app && touch b")).toEqual([
      "/tmp/a",
      "/code/app/b",
    ]);
  });

  test("a cd it cannot follow hides relative paths, not absolute ones", () => {
    expect(targets("cd $DIR && echo x > a.txt && echo y > /tmp/b")).toEqual(["/tmp/b"]);
    expect(targets("cd - && touch a")).toEqual([]);
  });

  test("no folder known: only absolute paths count", () => {
    expect(targets("echo x > a.txt", null)).toEqual([]);
    expect(targets("echo x > /tmp/a.txt", null)).toEqual(["/tmp/a.txt"]);
  });
});

describe("git commands that change the work tree or its branch", () => {
  test.each([
    "git checkout -b x",
    "git checkout main",
    "git switch main",
    "git reset --hard HEAD~1",
    "git restore a.txt",
    "git stash",
    "git stash push -m x",
    "git stash pop",
    "git commit -m x",
    "git commit -am x",
    "git merge other",
    "git rebase main",
    "git pull",
    "git cherry-pick abc",
    "git revert abc",
    "git apply fix.patch",
    "git am fix.mbox",
    "git clean -fd",
    "git rm a.txt",
    "git mv a b",
    "git --no-pager commit -m x",
    "git -c user.name=x commit -m x",
    "FOO=1 git commit -m x",
  ])("%j changes the folder git runs in", (command) => {
    expect(targets(command)).toEqual([CWD]);
  });

  test.each([
    "git status",
    "git log --oneline",
    "git diff HEAD",
    "git show HEAD",
    "git fetch origin",
    "git branch",
    "git branch -a",
    "git worktree add .claude/worktrees/n",
    "git worktree list",
    "git worktree remove .claude/worktrees/n",
    "git stash list",
    "git stash show -p",
    "git clean -n",
    "git clean --dry-run -d",
    "git apply --check fix.patch",
    "git apply --stat fix.patch",
    "git rev-parse HEAD",
    "git --version",
  ])("%j changes nothing", (command) => {
    expect(targets(command)).toEqual([]);
  });

  test("-C and --work-tree move the repo git runs in", () => {
    expect(targets("git -C .claude/worktrees/w commit -m x")).toEqual([
      "/code/app/.claude/worktrees/w",
    ]);
    expect(targets("git -C /tmp/other commit -m x")).toEqual(["/tmp/other"]);
    expect(targets("git -C a -C b commit -m x")).toEqual(["/code/app/a/b"]);
    expect(targets("git --work-tree=/tmp/w checkout x")).toEqual(["/tmp/w"]);
    expect(targets("git --git-dir /code/app/.git --work-tree /tmp/w commit -m x")).toEqual([
      "/tmp/w",
    ]);
    expect(targets("git --git-dir=/code/app/.git commit -m x")).toEqual([CWD]);
  });

  test("a cd moves git too; a folder it cannot work out hides the command", () => {
    expect(targets("cd .claude/worktrees/w && git commit -m x")).toEqual([
      "/code/app/.claude/worktrees/w",
    ]);
    expect(targets('git -C "$WT" commit -m x')).toEqual([]);
    expect(targets("cd $WT && git commit -m x")).toEqual([]);
  });
});
