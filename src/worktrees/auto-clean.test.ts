/**
 * The background clean of finished worktrees (D48): `runAutoClean` against real git repos in
 * temp folders (a bare "origin" and a clone), with the machine's facts given (no Docker, no
 * processes, the sessions a test names), so nothing here reads the host. The hooks that start
 * it are tested beside them (`worktree-leftovers.test.ts`, `after-merge.test.ts`); the told
 * line is checked here end to end, through the session-start hook.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { worktreeLeftoversHook } from "../hooks/specs";
import {
  hookEnv,
  makeClone,
  makeRepo,
  recordingStarter,
  runHook,
  writeClaudeFile,
} from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir, withGitVersion } from "../testing/temp";
import { appendLogLine, LOG_MAX_BYTES } from "../update/state";
import { type AutoCleanDeps, runAutoClean } from "./auto-clean";
import { autoCleanArgv, autoCleanEntry } from "./auto-start";
import {
  AUTO_CLEAN_INTERVAL_MS,
  autoCleanFiles,
  autoCleanLog,
  hourlyDue,
  markTold,
  type RepoRecord,
  readRepoRecord,
  readTold,
  recordRun,
  recordStart,
  TOLD_NAMES_MAX,
  toldLine,
  untold,
} from "./auto-state";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A lock that is free: closing it is counted. */
function freeLock() {
  const lock = {
    closed: 0,
    close: () => {
      lock.closed += 1;
    },
  };
  return lock;
}

interface Project {
  add: (name: string) => string;
  env: Record<string, string>;
  repo: string;
  /** Puts the work of a worktree on the base the way a squash merge does: under a commit of its own. */
  squash: (worktree: string) => void;
}

/** A clone with a project file, a throwaway home, and worktrees made beside it. */
function project(config: Record<string, unknown> = { worktrees: { base: "main" } }): Project {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  const env = hookEnv();
  return {
    add: (name) => {
      const folder = join(repo, "..", `app-wt-${name}`);
      git(repo, "worktree", "add", "-q", "-b", name, folder, "origin/main");
      return folder;
    },
    env,
    repo,
    squash: (worktree) => {
      writeFileSync(join(worktree, "feature.ts"), "export const feature = 1;\n");
      git(worktree, "add", "feature.ts");
      git(worktree, "commit", "-q", "-m", "the feature");
      writeFileSync(join(repo, "feature.ts"), "export const feature = 1;\n");
      writeFileSync(join(repo, "CHANGELOG.md"), "- the feature (#7)\n");
      git(repo, "add", "feature.ts", "CHANGELOG.md");
      git(repo, "commit", "-q", "-m", "the feature (#7)");
      git(repo, "push", "-q", "origin", "main");
    },
  };
}

/**
 * The run's dependencies: no containers, no programs, no sessions; a free lock; and a clock
 * two hours ahead, so a worktree made a moment ago counts as left alone for an hour.
 */
function deps(
  env: Record<string, string>,
  over: Partial<AutoCleanDeps> = {},
  at = Date.now() + 2 * HOUR,
): AutoCleanDeps {
  return {
    env,
    facts: { containers: [], programs: [], sessions: [] },
    hold: async () => freeLock(),
    now: () => at,
    paths: cliPaths(env),
    ...over,
  };
}

/** The repo's record, read from the file as written. */
function recorded(env: Record<string, string>, repo: string): RepoRecord {
  const file = autoCleanFiles(cliPaths(env).stateDir, repo).result;
  return JSON.parse(readFileSync(file, "utf8")) as RepoRecord;
}

/** The run's told mark for `repo`, read from the file as written (0: none). */
function toldMark(env: Record<string, string>, repo: string): number {
  const file = autoCleanFiles(cliPaths(env).stateDir, repo).told;
  if (!existsSync(file)) return 0;
  return (JSON.parse(readFileSync(file, "utf8")) as { seq: number }).seq;
}

const logLines = (env: Record<string, string>): string[] =>
  readFileSync(autoCleanLog(cliPaths(env).stateDir), "utf8")
    .trimEnd()
    .split("\n");

const sessionStart = (cwd: string) => ({
  hook_event_name: "SessionStart",
  session_id: "11111111-2222-3333-4444-555555555555",
  cwd,
  source: "startup",
});

describe("the background clean removes what is finished, and keeps the rest", () => {
  test("a squash-merged worktree with no session is removed; the next session start says so once", async () => {
    const { add, env, repo, squash } = project();
    const done = add("feature");
    squash(done);
    const lock = freeLock();

    expect(await runAutoClean(repo, "session", deps(env, { hold: async () => lock }))).toBe(
      "cleaned",
    );

    // The folder and the branch went, and the lock was let go.
    expect(existsSync(done)).toBe(false);
    expect(git(repo, "branch", "--list", "feature")).toBe("");
    expect(lock.closed).toBe(1);
    // What it recorded: the folder, the branch, and why it was finished.
    const record = recorded(env, repo);
    expect(record.base).toBe("main");
    expect(record.repo).toBe(repo);
    expect(record.seq).toBe(1);
    expect(toldMark(env, repo)).toBe(0);
    expect(record.removed).toEqual([
      {
        branch: "feature",
        name: "app-wt-feature",
        path: done,
        why: "merging it into main changes nothing",
      },
    ]);
    // One log line for the run.
    const lines = logLines(env);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ .+ \(session\): removed 1 \(app-wt-feature\); kept 0$/,
    );

    // The next attended session start of this repo says it once ...
    const told = await runHook(
      worktreeLeftoversHook,
      sessionStart(repo),
      env,
      recordingStarter().start,
    );
    expect(told).toEqual({
      stdout: JSON.stringify({
        systemMessage: `${COMMAND} removed 1 finished worktree: app-wt-feature (work on main)`,
      }),
    });
    // ... and then it is told: the second start is silent, and the removal is marked.
    expect(
      await runHook(worktreeLeftoversHook, sessionStart(repo), env, recordingStarter().start),
    ).toEqual({});
    expect(toldMark(env, repo)).toBe(1);
  });

  test("a removal git could not finish is named in the log, never counted as removed", async () => {
    const { add, env, repo, squash } = project();
    const done = add("done");
    squash(done);
    // A git that does everything but delete a folder it moved aside: the one failure a clean
    // cannot see coming, and the one a person must be able to find in the log.
    const real = Bun.which("git") ?? "/usr/bin/git";
    const dir = tempDir("git-remove-fails");
    const fake = join(dir, "git");
    writeFileSync(
      fake,
      `#!/bin/sh\nif [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then echo "the folder is in use" >&2; exit 1; fi\nexec "${real}" "$@"\n`,
    );
    chmodSync(fake, 0o755);
    const failing = { ...env, PATH: `${dir}:${env.PATH ?? ""}` };

    expect(await runAutoClean(repo, "merge", deps(failing))).toBe("cleaned");

    // The folder was moved aside, and the log names where it is now; it is not counted as
    // removed, nor as a worktree the verdict kept.
    expect(existsSync(done)).toBe(false);
    const record = recorded(failing, repo);
    expect(record.removed).toEqual([]);
    expect(record.kept).toEqual([]);
    const [line] = logLines(failing);
    expect(line).toContain("could not finish removing 1 (moved ");
    expect(line).toContain("app-wt-done-removing-");
    expect(line).toContain("then could not remove it");
    expect(line).toEndWith("kept 0");
  });

  test("a commit that is not on the base keeps the worktree", async () => {
    const { add, env, repo } = project();
    const ahead = add("ahead");
    writeFileSync(join(ahead, "wip.ts"), "export const wip = 1;\n");
    git(ahead, "add", "wip.ts");
    git(ahead, "commit", "-q", "-m", "work nobody merged");

    expect(await runAutoClean(repo, "session", deps(env))).toBe("cleaned");

    expect(existsSync(ahead)).toBe(true);
    expect(git(repo, "branch", "--list", "ahead")).toContain("ahead");
    const record = recorded(env, repo);
    expect(record.removed).toEqual([]);
    expect(record.kept).toEqual([
      { name: "app-wt-ahead", path: ahead, why: "1 commit not on main" },
    ]);
    expect(logLines(env)[0]).toEndWith("removed 0; kept 1");
  });

  test("uncommitted changes, a git lock, and a running session each keep their worktree", async () => {
    const { add, env, repo, squash } = project();
    const done = add("done");
    squash(done);
    const dirty = add("dirty");
    writeFileSync(join(dirty, "notes.txt"), "mine\n");
    const locked = add("locked");
    git(repo, "worktree", "lock", "--reason", "claude session 4242", locked);
    const busy = add("busy");
    const sessions = [{ cwd: join(busy, "src"), name: "build it", pid: 4242, sessionId: "abc" }];

    expect(
      await runAutoClean(
        repo,
        "session",
        deps(env, { facts: { containers: [], programs: [], sessions } }),
      ),
    ).toBe("cleaned");

    // Only the finished one went.
    expect(existsSync(done)).toBe(false);
    for (const kept of [dirty, locked, busy]) expect(existsSync(kept)).toBe(true);
    const record = recorded(env, repo);
    expect(record.removed.map((one) => one.name)).toEqual(["app-wt-done"]);
    expect(
      [...record.kept]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((one) => [one.name, one.why]),
    ).toEqual([
      ["app-wt-busy", 'Claude session "build it" works in it'],
      ["app-wt-dirty", "uncommitted changes"],
      ["app-wt-locked", "locked with `git worktree lock`"],
    ]);
  });

  test("the folder of the session that started the clean is kept, even with no record of it yet", async () => {
    const { add, env, repo, squash } = project();
    const resumed = add("resumed");
    squash(resumed);

    expect(await runAutoClean(repo, "session", deps(env, { keep: join(resumed, "src") }))).toBe(
      "cleaned",
    );

    expect(existsSync(resumed)).toBe(true);
    expect(recorded(env, repo).kept[0]?.why).toBe(
      'Claude session "the session that started the clean" works in it',
    );
  });

  test("a worktree the verdict is not certain of stays: programs or Docker unlisted, a program in it, a git too old to replay", async () => {
    const { add, env, repo, squash } = project();
    const done = add("done");
    squash(done);
    const at = Date.now() + 2 * HOUR;
    const facts = { containers: [], programs: [], sessions: [] };
    const attempt = async (over: Partial<AutoCleanDeps>, plus = 0) =>
      await runAutoClean(repo, "merge", deps(env, over, at + plus * MINUTE));

    // Unknown is not "none": the programs, or Docker, did not answer.
    await attempt({ facts: { ...facts, programs: "unknown" } });
    expect(recorded(env, repo).kept[0]?.why).toContain("the running programs could not be listed");
    await attempt({ facts: { ...facts, containers: "unknown" } }, 1);
    expect(recorded(env, repo).kept[0]?.why).toContain("Docker did not answer");
    // A program that works in the folder.
    await attempt({ facts: { ...facts, programs: [{ cwd: done, path: null, pid: 99_999 }] } }, 2);
    expect(recorded(env, repo).kept[0]?.why).toStartWith("a program runs from its files");
    // A git too old to replay the branch onto the base cannot see a squash merge.
    await attempt({ env: withGitVersion(env, "2.30.0") }, 3);
    expect(recorded(env, repo).kept[0]?.why).toContain("git 2.30.0 is too old");
    expect(existsSync(done)).toBe(true);

    // All of it answered: now it goes.
    await attempt({}, 4);
    expect(existsSync(done)).toBe(false);
  });

  test("with the lock busy, nothing happens: no removal, no record, no log", async () => {
    const { add, env, repo, squash } = project();
    const done = add("done");
    squash(done);

    expect(await runAutoClean(repo, "merge", deps(env, { hold: async () => null }))).toBe("busy");

    expect(existsSync(done)).toBe(true);
    const files = autoCleanFiles(cliPaths(env).stateDir, repo);
    expect(existsSync(files.result)).toBe(false);
    expect(existsSync(files.log)).toBe(false);
  });

  test("`worktrees.autoClean: false` stops it: nothing is removed, and the log says why", async () => {
    const { add, env, repo, squash } = project({ worktrees: { base: "main", autoClean: false } });
    const done = add("done");
    squash(done);

    expect(await runAutoClean(repo, "merge", deps(env))).toBe("off");

    expect(existsSync(done)).toBe(true);
    expect(logLines(env)).toHaveLength(1);
    expect(logLines(env)[0]).toContain("worktrees.autoClean is false; nothing done");
  });

  test("a project file that needs a newer plugin is an error line, never a removal", async () => {
    const { add, env, repo, squash } = project({ requires: ">=99.0", worktrees: { base: "main" } });
    const done = add("done");
    squash(done);

    expect(await runAutoClean(repo, "session", deps(env))).toBe("failed");

    expect(existsSync(done)).toBe(true);
    expect(logLines(env)[0]).toContain("(session): error:");
  });

  test("a repo whose base cannot be fetched or read is an error line, and the lock is let go", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    const env = hookEnv();
    const lock = freeLock();

    expect(await runAutoClean(repo, "session", deps(env, { hold: async () => lock }))).toBe(
      "failed",
    );

    expect(lock.closed).toBe(1);
    const lines = logLines(env);
    expect(lines[0]).toContain("could not fetch origin/main");
    expect(lines[1]).toContain("error: origin/main is not known here");
  });

  test("it works in the main checkout only", async () => {
    const { add, env } = project();
    const linked = add("linked");

    expect(await runAutoClean(linked, "session", deps(env))).toBe("failed");

    expect(logLines(env)[0]).toContain("not the main checkout");
  });
});

describe("the hourly limit", () => {
  test("a session-start run within the hour of the last stops; a merge run does not; after the hour it runs", async () => {
    const { add, env, repo, squash } = project();
    const start = Date.now() + 2 * HOUR;

    expect(await runAutoClean(repo, "session", deps(env, {}, start))).toBe("cleaned");
    const first = add("first");
    squash(first);

    // Ten minutes later: the limit holds, and nothing is removed.
    expect(await runAutoClean(repo, "session", deps(env, {}, start + 10 * MINUTE))).toBe("recent");
    expect(existsSync(first)).toBe(true);
    // A merge is the news itself: it does not wait for the hour.
    expect(await runAutoClean(repo, "merge", deps(env, {}, start + 11 * MINUTE))).toBe("cleaned");
    expect(existsSync(first)).toBe(false);

    // An hour after that run began, a session start cleans again.
    const second = add("second");
    git(second, "commit", "-q", "--allow-empty", "-m", "unmerged");
    expect(await runAutoClean(repo, "session", deps(env, {}, start + 11 * MINUTE + HOUR))).toBe(
      "cleaned",
    );
  });

  test("hourlyDue: none, 59 minutes, an hour, and a clock moved back", () => {
    const record = (lastRunAt: number): RepoRecord => ({
      base: "main",
      kept: [],
      lastRunAt,
      removed: [],
      repo: "/x",
      seq: 0,
    });
    const now = 1_000_000_000_000;
    expect(hourlyDue(null, now)).toBe(true);
    expect(hourlyDue(record(now - 59 * MINUTE), now)).toBe(false);
    expect(hourlyDue(record(now - AUTO_CLEAN_INTERVAL_MS), now)).toBe(true);
    expect(hourlyDue(record(now + 2 * HOUR), now)).toBe(true);
  });
});

describe("what a person is told", () => {
  const record = (names: string[]): RepoRecord => ({
    base: "main",
    kept: [],
    lastRunAt: 1,
    removed: names.map((name) => ({ branch: name, name, path: `/x/${name}`, why: "w" })),
    repo: "/x",
    seq: 1,
  });

  test("the line: one, a few, and past the names it spells out", () => {
    expect(toldLine(record(["a"]))).toBe(
      `${COMMAND} removed 1 finished worktree: a (work on main)`,
    );
    expect(toldLine(record(["a", "b", "c"]))).toBe(
      `${COMMAND} removed 3 finished worktrees: a, b, c (work on main)`,
    );
    const many = Array.from({ length: TOLD_NAMES_MAX + 3 }, (_, index) => `w${String(index)}`);
    expect(toldLine(record(many))).toBe(
      `${COMMAND} removed ${String(many.length)} finished worktrees: ${many.slice(0, TOLD_NAMES_MAX).join(", ")} and 3 more (work on main)`,
    );
  });

  test("removals no one was told about add up; a told set is replaced", () => {
    const files = autoCleanFiles(tempDir("auto-state"), "/x");
    const removed = (name: string) => ({ branch: name, name, path: `/x/${name}`, why: "w" });
    recordRun(files, "/x", { base: "main", kept: [], now: 10, removed: [removed("a")] });
    recordRun(files, "/x", { base: "main", kept: [], now: 20, removed: [removed("b")] });
    // A run that removed nothing leaves them alone.
    recordRun(files, "/x", { base: "main", kept: [], now: 30, removed: [] });
    const both = readRepoRecord(files);
    expect(both?.removed.map((one) => one.name)).toEqual(["a", "b"]);
    expect(both?.lastRunAt).toBe(30);
    expect(both?.seq).toBe(2);
    expect(untold(both, readTold(files))).not.toBeNull();

    markTold(files, 2);
    expect(untold(readRepoRecord(files), readTold(files))).toBeNull();
    recordRun(files, "/x", { base: "main", kept: [], now: 40, removed: [removed("c")] });
    expect(readRepoRecord(files)?.removed.map((one) => one.name)).toEqual(["c"]);
    expect(readRepoRecord(files)?.seq).toBe(3);
  });

  test("a clean that finished after the session read the removals is not marked told", () => {
    const files = autoCleanFiles(tempDir("auto-state"), "/x");
    const removed = (name: string) => ({ branch: name, name, path: `/x/${name}`, why: "w" });
    recordRun(files, "/x", { base: "main", kept: [], now: 10, removed: [removed("a")] });
    const seen = readRepoRecord(files);
    // Between the read and the mark, another clean removed one more.
    recordRun(files, "/x", { base: "main", kept: [], now: 20, removed: [removed("b")] });
    markTold(files, seen?.seq ?? -1);
    expect(untold(readRepoRecord(files), readTold(files))).not.toBeNull();
    expect(readRepoRecord(files)?.removed.map((one) => one.name)).toEqual(["a", "b"]);
  });

  test("recordStart keeps what was removed, and counts the hour from the start", () => {
    const files = autoCleanFiles(tempDir("auto-state"), "/x");
    recordStart(files, "/x", 5);
    expect(readRepoRecord(files)).toEqual({
      base: "",
      kept: [],
      lastRunAt: 5,
      removed: [],
      repo: "/x",
      seq: 0,
    });
    expect(untold(readRepoRecord(files), readTold(files))).toBeNull();

    // A run removed one; a later run starts (and may die): the removal is still untold.
    const removed = { branch: "a", name: "a", path: "/x/a", why: "w" };
    recordRun(files, "/x", { base: "main", kept: [], now: 10, removed: [removed] });
    recordStart(files, "/x", 20);
    expect(readRepoRecord(files)?.lastRunAt).toBe(20);
    expect(readRepoRecord(files)?.removed).toEqual([removed]);
    expect(readRepoRecord(files)?.seq).toBe(1);
  });

  test("a file that is not the record is no record: the clean and the hooks go on", () => {
    const dir = tempDir("auto-state");
    const files = autoCleanFiles(dir, "/x");
    mkdirSync(dirname(files.result), { recursive: true });
    writeFileSync(files.result, "{ not json");
    expect(readRepoRecord(files)).toBeNull();
    writeFileSync(files.result, JSON.stringify({ repos: { "/x": { base: 1 } } }));
    expect(readRepoRecord(files)).toBeNull();
    // The next run writes a good file over it.
    recordStart(files, "/x", 5);
    expect(readRepoRecord(files)?.lastRunAt).toBe(5);
  });
});

describe("the log is kept small", () => {
  test("past the size rule the newer half stays, from a whole line", () => {
    const log = autoCleanLog(tempDir("auto-log"));
    const line = `${"x".repeat(1000)}`;
    for (let index = 0; index < Math.ceil(LOG_MAX_BYTES / 1000) + 5; index++) {
      appendLogLine(log, `${String(index)} ${line}`, 0);
    }
    appendLogLine(log, "last", 0);
    expect(statSync(log).size).toBeLessThan(LOG_MAX_BYTES);
    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    expect(lines.at(-1)).toBe("1970-01-01T00:00:00Z last");
    // A cut line never starts mid-way: each starts with the stamp.
    for (const one of lines) expect(one).toStartWith("1970-01-01T00:00:00Z ");
  });
});

describe("how the hooks start it", () => {
  test("the entry is the bundle beside a hook's own, or the source when run from source", () => {
    expect(autoCleanEntry("/p/plugin/dist")).toBe("/p/plugin/dist/worktrees-clean.js");
    expect(autoCleanEntry("/r/src/worktrees")).toBe("/r/src/entries/worktrees-clean.ts");
  });

  test("the command line: this bun, the two flags, the entry, the repo, why, and the session's folder", () => {
    expect(
      autoCleanArgv(
        "/bin/bun",
        "/p/dist/worktrees-clean.js",
        "/p",
        "/r/app",
        "merge",
        "/r/app-wt-a",
      ),
    ).toEqual([
      "/bin/bun",
      "--no-env-file",
      "--config=/p/bunfig.toml",
      "/p/dist/worktrees-clean.js",
      "/r/app",
      "merge",
      "/r/app-wt-a",
    ]);
  });

  test("the entry refuses what it was not told: exit 2 and one line, nothing run", () => {
    const entry = join(import.meta.dir, "..", "entries", "worktrees-clean.ts");
    const guard = subprocessGuard();
    const ask = (...args: string[]) => {
      const home = hookEnv();
      return Bun.spawnSync([process.execPath, ...guard.args, entry, ...args], {
        env: { ...home, ...guard.env },
        stdout: "pipe",
        stderr: "pipe",
      });
    };
    const none = ask();
    expect(none.exitCode).toBe(2);
    expect(none.stderr.toString()).toContain("expected <repo> <merge|session>");
    const wrong = ask(tempDir("not-a-repo"), "tomorrow");
    expect(wrong.exitCode).toBe(2);
  });
});
