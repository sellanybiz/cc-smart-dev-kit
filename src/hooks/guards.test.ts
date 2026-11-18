/** The main-folder guard. */
import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookEnv, makeRepo, runHook, wireProjectHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { editsMainFolder, mainFolderRefusal, mayWriteInRepo } from "./main-folder-guard";
import { mainFolderGuardHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

function decide(decision: "ask" | "deny", reason: string) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  };
}

function deny(reason: string) {
  return decide("deny", reason);
}

describe("editsMainFolder", () => {
  test.each([
    ["/code/app/src/a.ts", true],
    ["/code/app", true],
    ["/code/app/.claude/worktrees/x/src/a.ts", false], // a worktree inside the main checkout
    ["/code/app-wt-x/src/a.ts", false], // a worktree beside it
    ["/code/other/a.ts", false],
    ["/code/app/../app-wt-x/a.ts", false],
  ])("%j: %j", (file, expected) => {
    expect(
      editsMainFolder(file, "/code/app", ["/code/app/.claude/worktrees/x", "/code/app-wt-x"]),
    ).toBe(expected);
  });
});

describe("the main-folder guard", () => {
  function guarded(guardMainFolder = true) {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder },
    });
    const worktree = join(repo, "..", "app-wt-fix");
    git(repo, "worktree", "add", "-q", "-b", "fix", worktree);
    return { repo, worktree };
  }

  const edit = (cwd: string, file: string, tool = "Edit") => ({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: tool,
    tool_input: tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file },
  });

  test("an edit in the main checkout is denied, with the way into a worktree", async () => {
    const { repo, worktree } = guarded();
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(repo, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    expect(mainFolderRefusal("/code/app")).toBe(
      [
        "This file is in the main checkout (/code/app). This project makes every change in a worktree (cc-smart-dev-kit.json `worktrees.guardMainFolder`).",
        "Already working in a worktree? Edit the same file under that worktree's folder.",
        "Not in one yet: `EnterWorktree` with the task's name as its `name` (dashes, not `/`) makes one, or resumes an existing one.",
      ].join("\n"),
    );
  });

  test.each(["Write", "NotebookEdit"])("%s too", async (tool) => {
    const { repo } = guarded();
    const result = await runHook(
      mainFolderGuardHook,
      edit(repo, join(repo, "n.ipynb"), tool),
      hookEnv(),
    );
    expect(result.stdout).toContain('"permissionDecision":"deny"');
  });

  test("an edit in a worktree, and one outside the repo, pass", async () => {
    const { worktree } = guarded();
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(worktree, "a.ts")), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(tempDir("x"), "a.ts")), hookEnv()),
    ).toEqual({});
  });

  test("off unless the project turns it on", async () => {
    const { repo } = guarded(false);
    expect(await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv())).toEqual(
      {},
    );
    const plain = makeRepo();
    expect(await runHook(mainFolderGuardHook, edit(plain, join(plain, "a.ts")), hookEnv())).toEqual(
      {},
    );
  });

  test("cc-smart-dev-kit.json lists it in ownHooks (the project runs its own copy): silent", async () => {
    const { repo } = guarded();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
      ownHooks: ["main-folder-guard"],
    });
    wireProjectHook(repo, "PreToolUse", "Edit|Write|NotebookEdit|Bash");
    expect(await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv())).toEqual(
      {},
    );
  });

  test("a retired hook name in ownHooks (serena-root): the file still reads, and the guard still denies", async () => {
    // Refused by the strict parse, this name would make the guard ASK about every edit in the
    // repo ("cannot check"); it is accepted and silences nothing.
    const { repo, worktree } = guarded();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
      ownHooks: ["serena-root"],
    });
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(repo, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
  });

  test("cc-smart-dev-kit.json needs a newer plugin: it asks before an edit in the repo, not outside", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    const inside = await runHook(mainFolderGuardHook, edit(repo, join(repo, "a.ts")), hookEnv());
    expect(inside.stdout).toContain('"permissionDecision":"ask"');
    expect(inside.stdout).toContain(
      "cc-smart-dev-kit cannot check whether this edit belongs in a worktree",
    );
    expect(inside.stdout).toContain("run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit");
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(tempDir("x"), "a.ts")), hookEnv()),
    ).toEqual({});
  });

  test("an edit through a symlinked path is still an edit of the main checkout", async () => {
    const { repo, worktree } = guarded();
    const link = join(tempDir("link"), "app");
    symlinkSync(repo, link);
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(link, "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    // A file that does not exist yet, in a folder reached through the link, is in it too.
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(link, "new", "a.ts")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    // A symlinked worktree is not the main checkout.
    const wtLink = join(tempDir("link-wt"), "app-wt-fix");
    symlinkSync(worktree, wtLink);
    expect(
      await runHook(mainFolderGuardHook, edit(worktree, join(wtLink, "a.ts")), hookEnv()),
    ).toEqual({});
  });
});

describe("mayWriteInRepo: what a crashed guard still asks about", () => {
  const input = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

  test("a write to /dev or the temp folder is none of its business, a write in the project is", () => {
    const cwd = "/code/app";
    expect(mayWriteInRepo(input("echo x > /dev/null"), cwd)).toBe(false);
    expect(mayWriteInRepo(input("make 2>/dev/null"), cwd)).toBe(false);
    expect(mayWriteInRepo(input(`echo x > ${join(tmpdir(), "out.txt")}`), cwd)).toBe(false);
    expect(mayWriteInRepo(input("git status"), cwd)).toBe(false);
    expect(mayWriteInRepo(input("echo x > a.txt"), cwd)).toBe(true);
    expect(mayWriteInRepo(input("echo x > /dev/null; git commit -m x"), cwd)).toBe(true);
  });

  test("a session that itself works in the temp folder is asked about a write there", () => {
    const cwd = join(tmpdir(), "my-project");
    expect(mayWriteInRepo(input(`echo x > ${join(cwd, "a.txt")}`), cwd)).toBe(true);
  });

  test("no known folder: it cannot tell, so it asks", () => {
    expect(mayWriteInRepo(input("echo x > /dev/null"), null)).toBe(true);
  });
});

describe("the main-folder guard: plan mode's plan file", () => {
  function guarded() {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
    });
    return repo;
  }

  const edit = (cwd: string, file: string) => ({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "Write",
    tool_input: { file_path: file },
  });

  test("with no plansDirectory the plans live outside the repo: .claude/plans is no exception", async () => {
    const repo = guarded();
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, ".claude/plans/x.md")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    const env = hookEnv();
    expect(
      await runHook(
        mainFolderGuardHook,
        edit(repo, join(env.CLAUDE_CONFIG_DIR ?? "", "plans/x.md")),
        env,
      ),
    ).toEqual({});
  });

  test("a file in the project's .claude/plans passes when that is the plansDirectory; the rest of .claude is refused", async () => {
    const repo = guarded();
    writeClaudeFile(repo, "settings.json", { plansDirectory: ".claude/plans" });
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, ".claude/plans/x.md")), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, ".claude/agents/x.md")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, ".claude/plans-x/x.md")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
  });

  test("the plansDirectory the session's settings name passes, wherever it is in the repo", async () => {
    const repo = guarded();
    writeClaudeFile(repo, "settings.json", { plansDirectory: "notes/plans" });
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, "notes/plans/x.md")), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(repo, "notes/x.md")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
  });

  test("a plan reached through a link is still the plan, and a link does not widen it", async () => {
    const repo = guarded();
    writeClaudeFile(repo, "settings.json", { plansDirectory: ".claude/plans" });
    const link = join(tempDir("link"), "app");
    symlinkSync(repo, link);
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(link, ".claude/plans/x.md")), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, edit(repo, join(link, "src/x.md")), hookEnv()),
    ).toEqual(deny(mainFolderRefusal(repo)));
  });
});

describe("the main-folder guard: Bash writes", () => {
  function guarded(guardMainFolder = true) {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder },
    });
    const inner = join(repo, ".claude", "worktrees", "w");
    git(repo, "worktree", "add", "-q", "-b", "w", inner);
    const beside = join(repo, "..", "app-wt-fix");
    git(repo, "worktree", "add", "-q", "-b", "fix", beside);
    return { repo, inner, beside };
  }

  const bash = (cwd: string, command: string) => ({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });

  const refused = (repo: string) => deny(mainFolderRefusal(repo, true));

  test("the refusal says the command writes in the main checkout, and the way into a worktree", () => {
    expect(mainFolderRefusal("/code/app", true)).toBe(
      [
        "This command writes in the main checkout (/code/app). This project makes every change in a worktree (cc-smart-dev-kit.json `worktrees.guardMainFolder`).",
        "Already working in a worktree? Run the command in that worktree's folder: `cd` into it first, or give `git -C <worktree>` to a git command.",
        "Not in one yet: `EnterWorktree` with the task's name as its `name` (dashes, not `/`) makes one, or resumes an existing one.",
      ].join("\n"),
    );
  });

  test.each([
    "echo x > a.txt",
    "echo x >> src/a.ts",
    "echo x | tee a.txt",
    "sed -i s/a/b/ README.md",
    "cp /etc/hosts hosts.txt",
    "mv README.md /tmp/readme.txt",
    "rm README.md",
    "touch new.txt",
    "mkdir -p src/new",
    "ln -s README.md link",
    "git checkout -b x",
    "git commit -m x",
    "git stash",
    "git reset --hard",
    "git pull",
    "git -C . commit -m x",
    "cd src && git commit -m x",
    "bash -c 'echo x > a.txt'",
  ])("%j in the main checkout is denied", async (command) => {
    const { repo } = guarded();
    expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual(
      refused(repo),
    );
  });

  test("the same command from inside a worktree, in either place one lives, passes", async () => {
    const { inner, beside } = guarded();
    for (const worktree of [inner, beside]) {
      for (const command of ["echo x > a.txt", "git commit -m x", "git stash", "rm README.md"]) {
        expect(await runHook(mainFolderGuardHook, bash(worktree, command), hookEnv())).toEqual({});
      }
    }
  });

  test("a cd or a -C into a worktree moves the command there, and back out again", async () => {
    const { repo, inner, beside } = guarded();
    for (const command of [
      "cd .claude/worktrees/w && echo x > a.txt",
      `cd ${beside} && git commit -m x`,
      "git -C .claude/worktrees/w commit -m x",
      `git -C ${beside} checkout -b more`,
      `git --work-tree=${inner} checkout x`,
    ]) {
      expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual({});
    }
    expect(
      await runHook(mainFolderGuardHook, bash(inner, `cd ${repo} && echo x > a.txt`), hookEnv()),
    ).toEqual(refused(repo));
    expect(
      await runHook(mainFolderGuardHook, bash(inner, `git -C ${repo} commit -m x`), hookEnv()),
    ).toEqual(refused(repo));
  });

  test("reads, listings and worktree commands pass", async () => {
    const { repo } = guarded();
    for (const command of [
      "git status",
      "git log --oneline",
      "git diff",
      "git fetch",
      "git branch",
      "git stash list",
      "git worktree add .claude/worktrees/n",
      "git worktree list",
      "git worktree remove .claude/worktrees/w",
      "echo x > /dev/null",
      "echo x > /tmp/out.txt",
      "ls -la > /dev/null 2>&1",
      "cat README.md",
      "bun test",
    ]) {
      expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual({});
    }
  });

  test("a cd inside ( … ) does not move the commands after it", async () => {
    const { repo } = guarded();
    expect(
      await runHook(
        mainFolderGuardHook,
        bash(repo, "(cd .claude/worktrees/w && make); git commit -m x"),
        hookEnv(),
      ),
    ).toEqual(refused(repo));
    expect(
      await runHook(
        mainFolderGuardHook,
        bash(repo, "(cd .claude/worktrees/w && git commit -m x)"),
        hookEnv(),
      ),
    ).toEqual({});
  });

  test("a git command that changes nothing passes: a dry run, a bare checkout", async () => {
    const { repo } = guarded();
    for (const command of ["git commit --dry-run", "git checkout", "sed -n -i '' p /tmp/f"]) {
      expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual({});
    }
    // BSD sed: the empty word is the backup suffix, the script is no file; the file is.
    expect(
      await runHook(mainFolderGuardHook, bash(repo, "sed -i '' s/x/y/ /tmp/out.txt"), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, bash(repo, "sed -i '' s/x/y/ README.md"), hookEnv()),
    ).toEqual(refused(repo));
  });

  test("a program the line works out, naming a git command that changes the checkout, asks", async () => {
    const { repo, inner } = guarded();
    for (const command of ["$GIT commit -m x", "$(which git) checkout main"]) {
      const result = await runHook(mainFolderGuardHook, bash(repo, command), hookEnv());
      expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput).toMatchObject({
        permissionDecision: "ask",
        permissionDecisionReason: expect.stringContaining("works out when it runs"),
      });
      // The same line in a worktree is fine, and so is one that names no checkout-changing word.
      expect(await runHook(mainFolderGuardHook, bash(inner, command), hookEnv())).toEqual({});
    }
    expect(await runHook(mainFolderGuardHook, bash(repo, "$GIT status"), hookEnv())).toEqual({});
    // A line that also writes a literal path in the main checkout is a plain refusal.
    expect(
      await runHook(mainFolderGuardHook, bash(repo, "$GIT commit -m x; touch a"), hookEnv()),
    ).toEqual(refused(repo));
  });

  test("a line of 64 KB is read in well under the hook's 10 seconds", async () => {
    const { repo, inner } = guarded();
    const line = "cd a && touch b;".repeat(4_096);
    expect(line.length).toBeGreaterThan(64_000);
    for (const [cwd, expected] of [
      [repo, refused(repo)],
      [inner, {}],
    ] as const) {
      const started = performance.now();
      expect(await runHook(mainFolderGuardHook, bash(cwd, line), hookEnv())).toEqual(expected);
      expect(performance.now() - started).toBeLessThan(2_000);
    }
  });

  test("a word the shell works out when the line runs passes: the guard cannot know it", async () => {
    const { repo } = guarded();
    for (const command of [
      'echo x > "$OUT"',
      "echo x > $(mktemp)",
      "cd $WORK && echo x > a.txt",
      'git -C "$WT" commit -m x',
      "rm $FILE",
    ]) {
      expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual({});
    }
  });

  test("the session's plans folder passes for a command too, the rest of .claude does not", async () => {
    const { repo } = guarded();
    writeClaudeFile(repo, "settings.json", { plansDirectory: ".claude/plans" });
    expect(
      await runHook(mainFolderGuardHook, bash(repo, "echo x > .claude/plans/p.md"), hookEnv()),
    ).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, bash(repo, "echo x > .claude/agents/r.md"), hookEnv()),
    ).toEqual(refused(repo));
    // One write in the plans folder does not excuse another in the repo.
    expect(
      await runHook(
        mainFolderGuardHook,
        bash(repo, "echo x > .claude/plans/p.md && echo y > a.txt"),
        hookEnv(),
      ),
    ).toEqual(refused(repo));
  });

  test("outside the repo passes: a temp folder, another repo, a folder that is no repo", async () => {
    const { repo } = guarded();
    const other = makeRepo("other");
    const plain = tempDir("plain");
    for (const command of [
      `echo x > ${join(plain, "a.txt")}`,
      `cd ${plain} && touch a && rm a`,
      `git -C ${other} commit --allow-empty -m x`,
      `cd ${other} && git checkout -b x`,
    ]) {
      expect(await runHook(mainFolderGuardHook, bash(repo, command), hookEnv())).toEqual({});
    }
  });

  test("off unless the project turns it on; silent in a folder that is no repo", async () => {
    const { repo } = guarded(false);
    expect(await runHook(mainFolderGuardHook, bash(repo, "echo x > a.txt"), hookEnv())).toEqual({});
    const plain = tempDir("plain");
    expect(await runHook(mainFolderGuardHook, bash(plain, "echo x > a.txt"), hookEnv())).toEqual(
      {},
    );
  });

  test("ownHooks lists it (the project runs its own copy): silent on a command too", async () => {
    const { repo } = guarded();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
      ownHooks: ["main-folder-guard"],
    });
    wireProjectHook(repo, "PreToolUse", "Edit|Write|NotebookEdit|Bash");
    expect(await runHook(mainFolderGuardHook, bash(repo, "echo x > a.txt"), hookEnv())).toEqual({});
  });

  test("cc-smart-dev-kit.json needs a newer plugin: a command that writes in the repo asks, one that writes elsewhere does not", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    for (const command of ["git commit -m x", "echo x > a.txt"]) {
      const asked = await runHook(mainFolderGuardHook, bash(repo, command), hookEnv());
      expect(asked.stdout).toContain('"permissionDecision":"ask"');
      expect(asked.stdout).toContain(
        "cc-smart-dev-kit cannot check whether this edit belongs in a worktree",
      );
    }
    expect(await runHook(mainFolderGuardHook, bash(repo, "git status"), hookEnv())).toEqual({});
    expect(
      await runHook(mainFolderGuardHook, bash(repo, `echo x > ${tempDir("x")}/a`), hookEnv()),
    ).toEqual({});
  });
});
