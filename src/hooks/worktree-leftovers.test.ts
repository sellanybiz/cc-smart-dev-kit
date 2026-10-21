import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hookEnv, makeClone, runHook, writeClaudeFile, writeSessionRecord } from "../testing/hooks";
import { git } from "../testing/temp";
import { worktreeLeftoversHook } from "./specs";
import { leftoversNote } from "./worktree-leftovers";

/** Makes git's own files of a worktree look an hour and a half old. */
function makeIdle(worktree: string): void {
  const admin = resolve(
    worktree,
    readFileSync(join(worktree, ".git"), "utf8")
      .trim()
      .replace(/^gitdir:\s*/, ""),
  );
  const old = new Date(Date.now() - 90 * 60_000);
  for (const file of ["index", "HEAD", join("logs", "HEAD")]) {
    try {
      utimesSync(join(admin, file), old, old);
    } catch {
      // Not every worktree has every file.
    }
  }
}

function project() {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {
    worktrees: { base: "main" },
  });
  const add = (name: string) => {
    const folder = join(repo, "..", `app-wt-${name}`);
    git(repo, "worktree", "add", "-q", "-b", name, folder, "origin/main");
    return resolve(folder);
  };
  return { repo, add };
}

const start = (cwd: string) => ({
  hook_event_name: "SessionStart",
  session_id: "11111111-2222-3333-4444-555555555555",
  cwd,
  source: "startup",
});

describe("worktree-leftovers", () => {
  test("names the finished ones and the gone ones; keeps every other kind", async () => {
    const { repo, add } = project();
    const env = hookEnv();
    const done = add("done");
    const fresh = add("fresh"); // touched just now
    const dirty = add("dirty");
    const ahead = add("ahead");
    const used = add("used");
    const local = add("local");
    const gone = add("gone");
    // An ignored file only this worktree holds: removing it would lose it.
    writeFileSync(join(repo, ".git", "info", "exclude"), "*.key\n");
    writeFileSync(join(local, "deploy.key"), "secret\n");
    writeFileSync(join(dirty, "x.txt"), "x\n");
    writeFileSync(join(ahead, "y.txt"), "y\n");
    git(ahead, "add", "y.txt");
    git(ahead, "commit", "-q", "-m", "work");
    writeSessionRecord(env, { sessionId: "s", cwd: used, name: "busy" });
    for (const folder of [done, dirty, ahead, used, local]) makeIdle(folder);
    rmSync(gone, { recursive: true, force: true });
    void fresh;

    const result = await runHook(worktreeLeftoversHook, start(repo), env);
    expect(result).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: [
            "1 finished worktree is left in this repo: app-wt-done. Each has every commit on origin/main, nothing uncommitted, no running session, and no git use for an hour. Tell the user, and when they agree, clear them in the main checkout with `cc-smart-dev-kit worktrees --clean` — it judges each one again, Docker containers and running programs included, before it removes anything.",
            `1 worktree is still listed, but its folder is gone: ${gone}. \`git worktree prune\` in the main checkout forgets it.`,
          ].join("\n"),
        },
      }),
    });
  });

  test("nothing to say: silent", async () => {
    const { repo, add } = project();
    add("fresh");
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
    expect(leftoversNote("main", [], [])).toBeNull();
  });

  test("without worktrees in cc-smart-dev-kit.json: silent, even with finished worktrees", async () => {
    const { repo } = makeClone();
    const folder = join(repo, "..", "wt");
    git(repo, "worktree", "add", "-q", "-b", "wt", folder, "origin/main");
    makeIdle(folder);
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
  });

  test("cc-smart-dev-kit.json needs a newer plugin: one line", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    const result = await runHook(worktreeLeftoversHook, start(repo), hookEnv());
    const text: string = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
    expect(text.split("\n")).toHaveLength(1);
    expect(text).toStartWith("cc-smart-dev-kit: ");
    expect(text).toEndWith("run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit");
  });
});
