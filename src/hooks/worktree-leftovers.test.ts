import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { makeWorktreeIdle, worktreeAdmin } from "../testing/worktree-idle";
import { autoCleanFiles, recordRun, recordStart } from "../worktrees/auto-state";
import { worktreeLeftoversHook } from "./specs";
import { idleMinutesOrNull, leftoversNote } from "./worktree-leftovers";

test.each([8, 10])("caps each worktree list at eight (%i total)", (count) => {
  const trees = Array.from({ length: count }, (_, index) => ({
    path: `/repo/wt-${index + 1}`,
    head: "abc",
    branch: "topic",
    locked: false,
    prunable: false,
  }));
  const text = leftoversNote("main", trees, trees);
  expect(text).toContain(
    `${count} finished worktrees are left in this repo: wt-1, wt-2, wt-3, wt-4, wt-5, wt-6, wt-7, wt-8`,
  );
  expect(text).toContain(
    `${count} worktrees are still listed, but their folders are gone: /repo/wt-1, /repo/wt-2, /repo/wt-3, /repo/wt-4, /repo/wt-5, /repo/wt-6, /repo/wt-7, /repo/wt-8`,
  );
  expect(text).not.toContain("wt-9");
  expect(text?.split("+2 more: git worktree list --porcelain").length).toBe(count === 10 ? 3 : 1);
  expect(text).toContain("`cc-smart-dev-kit worktrees --clean`");
  expect(text).toContain("`git worktree prune`");
});

const adminOf = worktreeAdmin;
const makeIdle = (worktree: string): void => makeWorktreeIdle(worktree);

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

describe("idleMinutesOrNull", () => {
  const now = Date.parse("2020-01-01T12:00:00Z");
  const old = new Date("2020-01-01T10:00:00Z");

  function fixture() {
    const { add } = project();
    const worktree = add("idle");
    const admin = adminOf(worktree);
    for (const file of ["index", "HEAD"]) utimesSync(join(admin, file), old, old);
    const log = join(admin, "logs", "HEAD");
    const sha = git(worktree, "rev-parse", "HEAD").trim();
    const entry = (epoch: string, message = "commit: test") =>
      `${sha} ${sha} Test With Spaces <test@example.com> ${epoch} +0530\t${message}\n`;
    return { worktree, admin, log, entry };
  }

  test("rewriting the reflog file does not make an old real commit recent", () => {
    const { worktree, admin, log } = fixture();
    const committed = Bun.spawnSync(["git", "commit", "--allow-empty", "-q", "-m", "old"], {
      cwd: worktree,
      env: {
        ...cleanGitEnv(),
        GIT_AUTHOR_DATE: "2020-01-01T10:00:00Z",
        GIT_COMMITTER_DATE: "2020-01-01T10:00:00Z",
      },
    });
    expect(committed.exitCode).toBe(0);
    for (const file of ["index", "HEAD", "logs/HEAD"]) {
      utimesSync(join(admin, file), old, old);
    }
    expect(idleMinutesOrNull(worktree, now)).toBe(120);
    // `reflog expire --all` rewrites this file too, even without changing its entries.
    utimesSync(log, new Date(now), new Date(now));
    expect(idleMinutesOrNull(worktree, now)).toBe(120);
  });

  test("uses the last entry, not the newest epoch or the message's fields", () => {
    const { worktree, log, entry } = fixture();
    writeFileSync(log, entry("1577879100") + entry("1577878200", "message\t9999999999 +0000"));
    expect(idleMinutesOrNull(worktree, now)).toBe(30);
  });

  test.each(["index", "HEAD"])("a newer %s wins over the entry", (file) => {
    const { worktree, admin, log, entry } = fixture();
    writeFileSync(log, entry("1577878200"));
    const recent = new Date("2020-01-01T11:50:00Z");
    utimesSync(join(admin, file), recent, recent);
    expect(idleMinutesOrNull(worktree, now)).toBe(10);
  });

  test.each(["", "broken\n", "partial", "future", "bad epoch", "bad prefix"])(
    "%s reflog falls back to index and HEAD",
    (kind) => {
      const { worktree, log, entry } = fixture();
      const contents: Record<string, string> = {
        "": "",
        "broken\n": `${entry("1577878200")}broken\n`,
        partial: entry("1577878200").trimEnd(),
        future: entry("1577880060"),
        "bad epoch": entry("not-a-number"),
        "bad prefix": "bad prefix 1577878200 +0000\tmessage\n",
      };
      writeFileSync(log, contents[kind] ?? "");
      expect(idleMinutesOrNull(worktree, now)).toBe(120);
    },
  );

  test("missing reflog falls back; no remaining timestamps means unknown", () => {
    const { worktree, admin, log } = fixture();
    rmSync(log);
    expect(idleMinutesOrNull(worktree, now)).toBe(120);
    for (const file of ["index", "HEAD"]) rmSync(join(admin, file));
    expect(idleMinutesOrNull(worktree, now)).toBeNull();
  });

  test("reads the final complete entry in a large log with an unfinished trailing write", () => {
    const { worktree, log, entry } = fixture();
    writeFileSync(log, `${entry("1577872800").repeat(100)}${entry("1577878200")}unfinished`);
    expect(idleMinutesOrNull(worktree, now)).toBe(30);
  });

  test("a final entry larger than the tail budget is not a complete entry", () => {
    const { worktree, log, entry } = fixture();
    writeFileSync(log, entry("1577878200", "x".repeat(9000)));
    expect(idleMinutesOrNull(worktree, now)).toBe(120);
  });

  test("not a linked worktree: no .git file or a .git directory", () => {
    expect(idleMinutesOrNull(tempDir(), now)).toBeNull();
    expect(idleMinutesOrNull(makeClone().repo, now)).toBeNull();
  });
});

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

  test("never one in the middle of a bisect, however long it has been idle", async () => {
    const { repo, add } = project();
    // History on the base, so the worktree has a range to bisect.
    git(repo, "commit", "--allow-empty", "-q", "-m", "two");
    git(repo, "commit", "--allow-empty", "-q", "-m", "three");
    git(repo, "push", "-q", "origin", "main");
    const bisecting = add("bisecting");
    git(bisecting, "bisect", "start", "HEAD", "HEAD~2");
    makeIdle(bisecting);
    // `--clean` keeps it (`inProgressWhy`), so the note must not call it finished.
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
    // Once the bisect is over, the same worktree is finished.
    git(bisecting, "bisect", "reset");
    makeIdle(bisecting);
    const result = await runHook(worktreeLeftoversHook, start(repo), hookEnv());
    expect(result.stdout).toContain("1 finished worktree is left in this repo: app-wt-bisecting");
  });

  test("never a locked one", async () => {
    const { repo, add } = project();
    const env = hookEnv();
    const locked = add("locked");
    makeIdle(locked);
    git(repo, "worktree", "lock", "--reason", "claude session aaaa (pid 1 start now)", locked);
    // `--clean` never touches a locked worktree, so naming it would send the person to a
    // command that does nothing.
    expect(await runHook(worktreeLeftoversHook, start(repo), env)).toEqual({});
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

/** The line a session that starts in a guarded main checkout gets (`mainCheckoutNudge`). */
const MAIN_CHECKOUT_NUDGE =
  "This session is in the main checkout. Make the first change in a worktree: `EnterWorktree` with the task's name as its `name` (dashes, not `/`), or `claude -w <name>` from a terminal.";

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
        MAIN_CHECKOUT_NUDGE,
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

describe("the move-to-a-worktree line", () => {
  /** A project that guards its main checkout, with one worktree to start a session in. */
  function guarded(
    config: Record<string, unknown> = { worktrees: { base: "main", guardMainFolder: true } },
  ) {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
    const folder = join(repo, "..", "app-wt-topic");
    git(repo, "worktree", "add", "-q", "-b", "topic", folder, "origin/main");
    return { folder, repo };
  }

  const contextOf = (result: { stdout?: string }): string =>
    JSON.parse(result.stdout ?? "{}").hookSpecificOutput?.additionalContext ?? "";

  test("an attended session in a guarded main checkout is told once, whatever branch it is on", async () => {
    const { repo } = guarded();
    expect(contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()))).toBe(
      MAIN_CHECKOUT_NUDGE,
    );
    git(repo, "checkout", "-q", "-b", "feature/x");
    const text = contextOf(await runHook(worktreeLeftoversHook, start(repo), hookEnv()));
    expect(text.split(MAIN_CHECKOUT_NUDGE)).toHaveLength(2);
    expect(text).toStartWith("The main checkout is on `feature/x`, not `main`");
  });

  test("a folder inside the main checkout is still the main checkout", async () => {
    const { repo } = guarded();
    const sub = join(repo, "sub");
    mkdirSync(sub);
    expect(contextOf(await runHook(worktreeLeftoversHook, start(sub), hookEnv()))).toBe(
      MAIN_CHECKOUT_NUDGE,
    );
  });

  test("a session in a linked worktree gets no such line", async () => {
    const { folder } = guarded();
    expect(contextOf(await runHook(worktreeLeftoversHook, start(folder), hookEnv()))).not.toContain(
      "first change in a worktree",
    );
  });

  test("`claude -p` gets no such line", async () => {
    const { repo } = guarded();
    expect(
      await runHook(worktreeLeftoversHook, start(repo), {
        ...hookEnv(),
        CLAUDE_CODE_SESSION_ATTENDED: "0",
      }),
    ).toEqual({});
  });

  test("the guard off: no such line", async () => {
    const { repo } = guarded({ worktrees: { base: "main", guardMainFolder: false } });
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
  });

  test("no worktrees section, or no cc-smart-dev-kit.json: no such line", async () => {
    const { repo } = guarded({});
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
    rmSync(join(repo, ".claude", "cc-smart-dev-kit.json"));
    expect(await runHook(worktreeLeftoversHook, start(repo), hookEnv())).toEqual({});
  });

  test("outside git: silent", async () => {
    expect(await runHook(worktreeLeftoversHook, start(tempDir("not-git")), hookEnv())).toEqual({});
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
