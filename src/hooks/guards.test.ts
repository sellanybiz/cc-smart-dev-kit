/** The main-folder guard. */
import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, runHook, wireProjectHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { editsMainFolder, mainFolderRefusal } from "./main-folder-guard";
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
        "Not in one yet: `EnterWorktree` with the task name as its `name` makes one, or resumes an existing one — use dashes, since a `/` becomes `+`.",
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
    wireProjectHook(repo, "PreToolUse", "Edit|Write|NotebookEdit");
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
