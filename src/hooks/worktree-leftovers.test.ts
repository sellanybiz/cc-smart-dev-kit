import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  hookEnv,
  makeClone,
  recordingStarter,
  runHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { git } from "../testing/temp";
import { autoCleanFiles, recordRun, recordStart } from "../worktrees/auto-state";
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

describe("the main checkout's own notes (WA1)", () => {
  /** A project with no linked worktree: the main checkout is the only one. */
  function bare(): string {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    return repo;
  }

  const contextOf = (result: { stdout?: string }): string =>
    JSON.parse(result.stdout ?? "{}").hookSpecificOutput?.additionalContext ?? "";

  test("on another branch: one line, naming both branches", async () => {
    const repo = bare();
    git(repo, "checkout", "-q", "-b", "feature/x");
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      "The main checkout is on `feature/x`, not `main`: a new worktree starts from its HEAD, so switch it to `main` first.",
    );
  });

  test("behind origin/<base>: one line, with the count git already has (no fetch)", async () => {
    const repo = bare();
    git(repo, "checkout", "-q", "-b", "ahead");
    writeFileSync(join(repo, "next.txt"), "next\n");
    git(repo, "add", "next.txt");
    git(repo, "commit", "-q", "-m", "next");
    const tip = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "update-ref", "refs/remotes/origin/main", tip);
    git(repo, "checkout", "-q", "main");
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      "The main checkout is 1 commit behind origin/main: fast-forward it there (`git merge --ff-only origin/main`) before starting a new worktree.",
    );
  });

  test("in the middle of a merge: one line", async () => {
    const repo = bare();
    writeFileSync(join(repo, ".git", "MERGE_HEAD"), `${git(repo, "rev-parse", "HEAD").trim()}\n`);
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      "The main checkout is in the middle of a merge: finish it or abort it before starting a new worktree.",
    );
  });

  test("a guarded main checkout: each line names the person's command, never a step for the session", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
    });
    git(repo, "checkout", "-q", "-b", "ahead");
    writeFileSync(join(repo, "next.txt"), "next\n");
    git(repo, "add", "next.txt");
    git(repo, "commit", "-q", "-m", "next");
    git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "HEAD").trim());
    git(repo, "checkout", "-q", "-b", "feature/x", "HEAD~1");
    writeFileSync(join(repo, ".git", "MERGE_HEAD"), `${git(repo, "rev-parse", "HEAD").trim()}\n`);
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      [
        "The main checkout is in the middle of a merge: ask the person to finish it or abort it before starting a new worktree.",
        "The main checkout is on `feature/x`, not `main`: a new worktree starts from its HEAD, so ask the person to run `git switch main` in the main checkout first.",
        "The main checkout's `main` is 1 commit behind origin/main: after the switch, ask the person to run `git merge --ff-only origin/main` in the main checkout before starting a new worktree.",
      ].join("\n"),
    );
  });

  test("on another branch that is behind while the base is current: no fast-forward line for that branch", async () => {
    const repo = bare();
    writeFileSync(join(repo, "next.txt"), "next\n");
    git(repo, "add", "next.txt");
    git(repo, "commit", "-q", "-m", "next");
    git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "HEAD").trim());
    git(repo, "checkout", "-q", "-b", "feature/old", "HEAD~1");
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      "The main checkout is on `feature/old`, not `main`: a new worktree starts from its HEAD, so switch it to `main` first.",
    );
  });

  test("on the base, up to date, nothing in progress: silent", async () => {
    expect(await runHook(worktreeLeftoversHook, start(bare()), hookEnv())).toEqual({});
  });

  test("`claude -p` has nobody to tell: no main-folder line", async () => {
    const repo = bare();
    git(repo, "checkout", "-q", "-b", "feature/x");
    expect(
      await runHook(worktreeLeftoversHook, start(repo), {
        ...hookEnv(),
        CLAUDE_CODE_SESSION_ATTENDED: "0",
      }),
    ).toEqual({});
  });
});

describe("worktree-leftovers starts the background clean (D48)", () => {
  /** A project with one worktree, so there is something to clean. */
  function withOne(config: Record<string, unknown> = { worktrees: { base: "main" } }) {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
    const folder = join(repo, "..", "app-wt-one");
    git(repo, "worktree", "add", "-q", "-b", "one", folder, "origin/main");
    makeIdle(folder);
    return { folder, repo };
  }

  test("it asks for one detached process and returns at once: nothing ran, nothing was removed", async () => {
    const { folder, repo } = withOne();
    const env = hookEnv();
    const { start: starter, started } = recordingStarter();

    const result = await runHook(worktreeLeftoversHook, start(repo), env, starter);

    // The spawn was asked for, once, with the repo and why; the process runs in the home
    // folder, and the git variables of the session's repo are not passed to it.
    expect(started).toHaveLength(1);
    const [asked] = started;
    expect(asked?.argv[0]).toBe(process.execPath);
    expect(asked?.argv.slice(1)).toEqual([
      "--no-env-file",
      `--config=${join(import.meta.dir, "..", "..", "plugin", "bunfig.toml")}`,
      join(import.meta.dir, "..", "entries", "worktrees-clean.ts"),
      repo,
      "session",
      repo,
    ]);
    expect(asked?.options.cwd).toBe(env.HOME);
    expect(
      Object.keys(asked?.options.env ?? {}).filter((key) => key.startsWith("GIT_DIR")),
    ).toEqual([]);
    // Nothing ran in the hook's own process: the finished worktree is still there, and the
    // answer is the note as before.
    expect(existsSync(folder)).toBe(true);
    expect(result.stdout).toContain("1 finished worktree is left in this repo: app-wt-one");
  });

  test("at most once an hour per repo", async () => {
    const { repo } = withOne();
    const env = hookEnv();
    const files = autoCleanFiles(cliPaths(env).stateDir, repo);
    const askedAfter = async () => {
      const { start: starter, started } = recordingStarter();
      await runHook(worktreeLeftoversHook, start(repo), env, starter);
      return started.length;
    };

    // A clean began ten minutes ago: not yet.
    recordStart(files, repo, Date.now() - 10 * 60_000);
    expect(await askedAfter()).toBe(0);
    // An hour and a minute ago: it starts again.
    recordStart(files, repo, Date.now() - 61 * 60_000);
    expect(await askedAfter()).toBe(1);
  });

  test("never in `claude -p`; and its removals are not told there, so the next attended start tells them", async () => {
    const { repo } = withOne();
    const env = hookEnv();
    const files = autoCleanFiles(cliPaths(env).stateDir, repo);
    recordRun(files, repo, {
      base: "main",
      kept: [],
      now: Date.now() - 2 * 60 * 60_000,
      removed: [
        { branch: "old", name: "app-wt-old", path: join(repo, "..", "app-wt-old"), why: "w" },
      ],
    });
    const quiet = { ...env, CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const { start: starter, started } = recordingStarter();

    const unattended = await runHook(worktreeLeftoversHook, start(repo), quiet, starter);

    expect(started).toHaveLength(0);
    expect(unattended.stdout ?? "").not.toContain("removed");
    // A person starts a session next: the line is still there to say.
    const attended = await runHook(
      worktreeLeftoversHook,
      start(repo),
      env,
      recordingStarter().start,
    );
    expect(JSON.parse(attended.stdout ?? "{}").systemMessage).toBe(
      "cc-smart-dev-kit removed 1 finished worktree: app-wt-old (work on main)",
    );
  });

  test("`worktrees.autoClean: false` starts nothing", async () => {
    const { repo } = withOne({ worktrees: { base: "main", autoClean: false } });
    const { start: starter, started } = recordingStarter();

    await runHook(worktreeLeftoversHook, start(repo), hookEnv(), starter);

    expect(started).toHaveLength(0);
  });

  test("with no linked worktree there is nothing to clean: nothing starts", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    const { start: starter, started } = recordingStarter();

    await runHook(worktreeLeftoversHook, start(repo), hookEnv(), starter);

    expect(started).toHaveLength(0);
  });

  test("a worktree the last clean kept is named with its reason; the told line and the note share one answer", async () => {
    const { folder, repo } = withOne();
    const env = hookEnv();
    const files = autoCleanFiles(cliPaths(env).stateDir, repo);
    recordRun(files, repo, {
      base: "main",
      kept: [{ name: "app-wt-one", path: folder, why: "a program runs from its files: vite" }],
      now: Date.now() - 2 * 60 * 60_000,
      removed: [
        { branch: "old", name: "app-wt-old", path: join(repo, "..", "app-wt-old"), why: "w" },
      ],
    });

    const result = await runHook(worktreeLeftoversHook, start(repo), env, recordingStarter().start);

    const out = JSON.parse(result.stdout ?? "{}");
    expect(out.systemMessage).toBe(
      "cc-smart-dev-kit removed 1 finished worktree: app-wt-old (work on main)",
    );
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toStartWith(
      "1 finished worktree is left in this repo: app-wt-one (kept by the last clean: a program runs from its files: vite). ",
    );
  });
});
