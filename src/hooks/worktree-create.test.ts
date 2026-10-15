import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  hookEnv,
  makeClone,
  makeRepo,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { cleanGitEnv, git, tempDir, withSlowGit } from "../testing/temp";
import { createLockFile } from "./create-lock";
import { worktreeCreateHook } from "./specs";
import {
  addWorktree,
  badName,
  badPrefix,
  configuredFolder,
  fetchedRecently,
  isSubagentName,
  readBaseRef,
  reuseDecision,
  SETUP_MARKER,
  subagentShape,
} from "./worktree-create";

const SESSION = "11111111-2222-3333-4444-555555555555";

function create(cwd: string, name: string, env = hookEnv()) {
  return runHook(
    worktreeCreateHook,
    { hook_event_name: "WorktreeCreate", session_id: SESSION, cwd, name },
    env,
  );
}

const head = (folder: string, ref = "HEAD") => git(folder, "rev-parse", ref).trim();
const branchOf = (folder: string) => git(folder, "symbolic-ref", "--short", "HEAD").trim();

/** Turns the worktree engine on in `repo`: `worktrees` in its anymodel.json. */
function optIn(repo: string, setup?: string[]): void {
  writeClaudeFile(repo, "anymodel.json", {
    worktrees: { base: "main", prefix: "app-wt-", ...(setup === undefined ? {} : { setup }) },
  });
}

const AGENT = "agent-0a1b2c3d4e5f60718";

describe("the shapes", () => {
  test("a subagent's worktree: Claude Code's own shape", () => {
    expect(subagentShape("/repo", AGENT)).toEqual({
      folder: `/repo/.claude/worktrees/${AGENT}`,
      branch: `worktree-${AGENT}`,
    });
  });

  test("a configured worktree sits beside the main checkout, / becomes -", () => {
    expect(configuredFolder("/code/app", "app-wt-", "fix/login")).toBe("/code/app-wt-fix-login");
  });

  test.each([
    ["agent-a1b2c3d4e5f60718", true],
    ["agent-xyz", false],
    ["my-agent-a1b2", false],
  ])("subagent name %j: %j", (name, expected) => {
    expect(isSubagentName(name)).toBe(expected);
  });

  test.each([
    ["", "the worktree name is empty"],
    ["-x", 'the worktree name "-x" starts with "-"'],
    ["a/../b", 'the worktree name "a/../b" has a "." or ".." part'],
    ["a\nb", "the worktree name has a control character"],
    ["fix/login", null],
  ])("name %j: %j", (name, expected) => {
    expect(badName(name)).toBe(expected);
  });

  test("a prefix must stay part of one folder name", () => {
    expect(badPrefix("app-wt-")).toBeNull();
    expect(badPrefix("../x-")).toBe(
      'worktrees.prefix "../x-" must be part of a folder name, with no "/" or "\\"',
    );
  });

  test("worktree.baseRef: the first file that sets it wins; anything else is fresh", () => {
    const dir = tempDir("settings");
    const local = join(dir, "local.json");
    const user = join(dir, "user.json");
    writeFileSync(user, JSON.stringify({ worktree: { baseRef: "head" } }));
    expect(readBaseRef([local, user])).toBe("head");
    writeFileSync(local, JSON.stringify({ worktree: { baseRef: "fresh" } }));
    expect(readBaseRef([local, user])).toBe("fresh");
    writeFileSync(local, JSON.stringify({ worktree: { baseRef: "main" } }));
    expect(readBaseRef([local])).toBe("fresh");
  });
});

describe("a subagent's worktree: Claude Code's shape, no setup", () => {
  test("a repo without a remote: .claude/worktrees/<name> on worktree-<name>, from HEAD", async () => {
    const repo = makeRepo();
    optIn(repo);
    const result = await create(repo, AGENT);
    const folder = join(repo, ".claude", "worktrees", AGENT);
    expect(result).toEqual({ stdout: folder });
    expect(branchOf(folder)).toBe(`worktree-${AGENT}`);
    expect(head(folder)).toBe(head(repo));
  });

  test("with a remote: from origin's default branch, not the local HEAD (worktree.baseRef fresh)", async () => {
    const { repo } = makeClone();
    optIn(repo);
    writeFileSync(join(repo, "local.txt"), "not pushed\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local only");
    const result = await create(repo, "agent-01");
    const folder = join(repo, ".claude", "worktrees", "agent-01");
    expect(result).toEqual({ stdout: folder });
    expect(head(folder)).toBe(head(repo, "origin/main"));
    expect(head(folder)).not.toBe(head(repo));
  });

  test("worktree.baseRef head in the project's settings: from the local HEAD", async () => {
    const { repo } = makeClone();
    optIn(repo);
    writeFileSync(join(repo, "local.txt"), "not pushed\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local only");
    writeClaudeFile(repo, "settings.json", { worktree: { baseRef: "head" } });
    await create(repo, "agent-02");
    expect(head(join(repo, ".claude", "worktrees", "agent-02"))).toBe(head(repo));
  });

  test("an existing worktree of that name is entered again", async () => {
    const repo = makeRepo();
    optIn(repo);
    const env = hookEnv();
    const first = await create(repo, AGENT, env);
    const second = await create(repo, AGENT, env);
    expect(second).toEqual(first);
  });

  test("a folder there that is no worktree: refused, exit 1", async () => {
    const repo = makeRepo();
    optIn(repo);
    mkdirSync(join(repo, ".claude", "worktrees", AGENT), { recursive: true });
    expect(await create(repo, AGENT)).toEqual({
      exitCode: 1,
      stderr: `worktree not created: ${join(repo, ".claude", "worktrees", AGENT)} exists and is not a worktree of this repo`,
    });
  });

  test("a subagent asking from inside a session's worktree: the main checkout's .claude/worktrees", async () => {
    const { repo } = makeClone();
    optIn(repo);
    const env = hookEnv();
    const session = (await create(repo, "fix/session", env)).stdout ?? "";
    expect(session).toBe(join(dirname(repo), "app-wt-fix-session"));
    expect(await create(session, AGENT, env)).toEqual({
      stdout: join(repo, ".claude", "worktrees", AGENT),
    });
  });

  test("the project's setup does not run for a subagent", async () => {
    const log = join(tempDir("setup"), "calls.log");
    const repo = makeRepo();
    optIn(repo, ["sh", "-c", `echo ran >> "${log}"`]);
    expect(await create(repo, AGENT)).toEqual({
      stdout: join(repo, ".claude", "worktrees", AGENT),
    });
    expect(existsSync(log)).toBe(false);
  });

  test("outside git: refused, exit 1", async () => {
    const result = await create(tempDir("nogit"), AGENT);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith("worktree not created: ");
  });
});

describe(".worktreeinclude", () => {
  /** A clone whose committed .gitignore and .worktreeinclude name files only the main checkout has. */
  function withIncludes() {
    const { repo } = makeClone();
    writeFileSync(join(repo, ".gitignore"), ".env\nsecrets/\nbuild/\n");
    writeFileSync(join(repo, ".worktreeinclude"), ".env\nsecrets/key.txt\ntracked.txt\n");
    writeFileSync(join(repo, "tracked.txt"), "tracked\n");
    git(repo, "add", ".gitignore", ".worktreeinclude", "tracked.txt");
    git(repo, "commit", "-q", "-m", "ignore");
    git(repo, "push", "-q", "origin", "main");
    optIn(repo);
    writeFileSync(join(repo, ".env"), "A=1\n");
    mkdirSync(join(repo, "secrets"));
    writeFileSync(join(repo, "secrets", "key.txt"), "k\n");
    mkdirSync(join(repo, "build"));
    writeFileSync(join(repo, "build", "out.js"), "x\n");
    writeFileSync(join(repo, "tracked.txt"), "changed here\n");
    return repo;
  }

  test.each([
    ["a session's worktree", "fix/inc"],
    ["a subagent's worktree", AGENT],
  ])("%s: copies the gitignored files it names, never a tracked one", async (_kind, name) => {
    const repo = withIncludes();
    const folder = (await create(repo, name)).stdout ?? "";
    expect(folder).not.toBe("");
    expect(readFileSync(join(folder, ".env"), "utf8")).toBe("A=1\n");
    expect(readFileSync(join(folder, "secrets", "key.txt"), "utf8")).toBe("k\n");
    expect(existsSync(join(folder, "build"))).toBe(false);
    // Tracked: the worktree has the committed text, not the main checkout's change.
    expect(readFileSync(join(folder, "tracked.txt"), "utf8")).toBe("tracked\n");
  });
});

describe("a session's worktree", () => {
  function configured(setup?: string[]) {
    const { origin, repo } = makeClone();
    optIn(repo, setup);
    return { origin, repo, beside: dirname(repo) };
  }

  /** A commit on origin/main that the clone has not fetched yet. */
  function advanceOrigin(origin: string): string {
    const other = join(tempDir("other"), "other");
    git(dirname(other), "clone", "-q", origin, other);
    writeFileSync(join(other, "new.txt"), "new\n");
    git(other, "add", "new.txt");
    git(other, "commit", "-q", "-m", "newer");
    git(other, "push", "-q", "origin", "main");
    return head(other);
  }

  test("a new branch, beside the repo, from the freshly fetched origin/<base>", async () => {
    const { origin, repo, beside } = configured();
    const newest = advanceOrigin(origin);
    const result = await create(repo, "fix/login");
    const folder = join(beside, "app-wt-fix-login");
    expect(result).toEqual({ stdout: folder });
    expect(branchOf(folder)).toBe("fix/login");
    expect(head(folder)).toBe(newest);
    // It does not track the base: a plain push must not go to main.
    expect(() => git(folder, "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  test("an existing local branch is checked out, not cut again", async () => {
    const { repo, beside } = configured();
    git(repo, "branch", "fix/old");
    writeFileSync(join(repo, "x.txt"), "x\n");
    git(repo, "add", "x.txt");
    git(repo, "commit", "-q", "-m", "on main");
    git(repo, "branch", "-f", "fix/old", "HEAD");
    await create(repo, "fix/old");
    expect(head(join(beside, "app-wt-fix-old"))).toBe(head(repo, "fix/old"));
  });

  test("a failed fetch refuses a new branch: it starts only from the latest base", async () => {
    const { repo } = configured();
    git(repo, "remote", "set-url", "origin", join(tempDir("gone"), "missing.git"));
    const result = await create(repo, "fix/new");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith("worktree not created: `git fetch origin main` failed (");
    expect(result.stderr).toEndWith("): a new branch starts only from the latest main");
  });

  test("the setup command runs inside, once; its output never reaches stdout", async () => {
    const log = join(tempDir("setup"), "calls.log");
    const { repo, beside } = configured([
      "sh",
      "-c",
      `echo ran >> "${log}"; pwd >> "${log}"; echo noise`,
    ]);
    const env = hookEnv();
    const result = await create(repo, "fix/a", env);
    const folder = join(beside, "app-wt-fix-a");
    expect(result).toEqual({ stdout: folder });
    expect(readFileSync(log, "utf8")).toBe(`ran\n${folder}\n`);
    expect(
      existsSync(join(git(folder, "rev-parse", "--absolute-git-dir").trim(), SETUP_MARKER)),
    ).toBe(true);
    // Entered again: setup does not run again.
    expect(await create(repo, "fix/a", env)).toEqual({ stdout: folder });
    expect(readFileSync(log, "utf8")).toBe(`ran\n${folder}\n`);
  });

  test("a failed setup: exit 1, the worktree stays, and entering it again runs setup again", async () => {
    const flag = join(tempDir("flag"), "ok");
    const { repo, beside } = configured([
      "sh",
      "-c",
      `test -f "${flag}" || { echo broke >&2; exit 3; }`,
    ]);
    const env = hookEnv();
    const folder = join(beside, "app-wt-fix-b");
    const failed = await create(repo, "fix/b", env);
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toBe(
      `worktree not created: the setup command \`sh -c test -f "${flag}" || { echo broke >&2; exit 3; }\` exited 3 in ${folder}; the worktree stays, and entering it again runs setup again\nbroke`,
    );
    expect(existsSync(folder)).toBe(true);
    writeFileSync(flag, "");
    expect(await create(repo, "fix/b", env)).toEqual({ stdout: folder });
  });

  test("a setup command that does not exist: exit 1 with the reason", async () => {
    const { repo } = configured(["no-such-command-anymodel"]);
    const result = await create(repo, "fix/c");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith(
      "worktree not created: the setup command `no-such-command-anymodel` could not start:",
    );
  });

  test("another running session works in the worktree: refused", async () => {
    const { repo, beside } = configured();
    const env = hookEnv();
    await create(repo, "fix/shared", env);
    writeSessionRecord(env, {
      sessionId: "99999999-2222-3333-4444-555555555555",
      cwd: join(beside, "app-wt-fix-shared"),
      name: "other work",
    });
    const result = await create(repo, "fix/shared", env);
    expect(result).toEqual({
      exitCode: 1,
      stderr: `worktree not created: the running session "other work" (process ${process.pid}) works in ${join(beside, "app-wt-fix-shared")}; two sessions must not share a folder`,
    });
  });

  test("the asking session itself in it: entered again", async () => {
    const { repo, beside } = configured();
    const env = hookEnv();
    await create(repo, "fix/mine", env);
    writeSessionRecord(env, {
      sessionId: SESSION,
      cwd: join(beside, "app-wt-fix-mine"),
      name: "me",
    });
    expect(await create(repo, "fix/mine", env)).toEqual({
      stdout: join(beside, "app-wt-fix-mine"),
    });
  });

  test("the main checkout's own branch: refused", async () => {
    const { repo } = configured();
    expect(await create(repo, "main")).toEqual({
      exitCode: 1,
      stderr:
        "worktree not created: main is the main checkout's branch; name a branch of its own for this work",
    });
  });

  test("a prefix with a / is refused", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "anymodel.json", { worktrees: { base: "main", prefix: "../x-" } });
    expect((await create(repo, "fix/d")).stderr).toBe(
      'worktree not created: worktrees.prefix "../x-" must be part of a folder name, with no "/" or "\\"',
    );
  });
});

describe("a `git worktree add` that hangs", () => {
  test("gives up on a timeout, and says how to finish by hand", () => {
    const repo = makeRepo();
    const folder = join(tempDir("half-made"), "app-wt-slow");
    const env = withSlowGit(cleanGitEnv(), ["worktree", "add"]);
    expect(() =>
      addWorktree(repo, ["worktree", "add", "--quiet", folder, "fix/slow"], env, folder, 300),
    ).toThrow(
      `\`git worktree add --quiet ${folder} fix/slow\` timed out after 0.3 s, so ${folder} may be half made. ` +
        `Check that it holds nothing you need (and no work of another session), then finish: ` +
        `git worktree remove --force ${folder}, and git worktree prune`,
    );
  });

  test("a git that fails for another reason keeps its own message", () => {
    const repo = makeRepo();
    const folder = join(tempDir("no-branch"), "app-wt-missing");
    expect(() =>
      addWorktree(
        repo,
        ["worktree", "add", "--quiet", folder, "no/such-branch"],
        cleanGitEnv(),
        folder,
        5_000,
      ),
    ).toThrow(/^`git worktree add --quiet .*` failed: /);
  });
});

describe("the create lock: one creation of a branch at a time", () => {
  /** A lock file as another live process would leave it (this test's process is alive). */
  function hold(commonDir: string, branch: string, pid = process.pid): string {
    const file = createLockFile(commonDir, branch);
    writeFileSync(
      file,
      JSON.stringify({
        pid,
        startTime: null,
        session: "another-session",
        startedAt: "2026-01-01T00:00:00.000Z",
        token: "theirs",
      }),
    );
    return file;
  }

  test("a live holder refuses the create, naming its process and the file", async () => {
    const repo = makeRepo();
    optIn(repo);
    const file = hold(join(repo, ".git"), "fix/busy");
    const result = await create(repo, "fix/busy");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith("worktree not created: another anymodel process (pid ");
    expect(result.stderr).toContain("is making the worktree for this branch right now.");
    expect(result.stderr).toContain(`if that process is gone, remove ${file}`);
    expect(existsSync(join(dirname(repo), "app-wt-fix-busy"))).toBe(false);
    rmSync(file);
  });

  test("a lock whose process is gone is taken over, and the create runs", async () => {
    const { repo } = makeClone();
    optIn(repo);
    // A pid no process has (from high down, the first that is not alive).
    let dead = 0;
    for (let pid = 999_999; pid > 100_000 && dead === 0; pid--) {
      try {
        process.kill(pid, 0);
      } catch {
        dead = pid;
      }
    }
    expect(dead).toBeGreaterThan(0);
    const file = hold(join(repo, ".git"), "fix/gone", dead);
    const result = await create(repo, "fix/gone");
    expect(result).toEqual({ stdout: join(dirname(repo), "app-wt-fix-gone") });
    // Released once the create is done.
    expect(existsSync(file)).toBe(false);
  });

  test("the lock is released when the create fails too", async () => {
    const { repo } = makeClone();
    optIn(repo);
    git(repo, "remote", "set-url", "origin", join(tempDir("gone"), "missing.git"));
    const file = createLockFile(join(repo, ".git"), "fix/new");
    expect((await create(repo, "fix/new")).exitCode).toBe(1); // the fetch fails: refused
    expect(existsSync(file)).toBe(false);
  });
});

describe("the freshness of a fetch", () => {
  test("a fetch made in a linked worktree counts: it has its own FETCH_HEAD", () => {
    const { repo } = makeClone();
    const commonDir = join(repo, ".git");
    const worktree = join(tempDir("linked"), "app-wt-a");
    git(repo, "worktree", "add", "-q", "-b", "fix/a", worktree);
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const commonHead = join(commonDir, "FETCH_HEAD");
    if (existsSync(commonHead)) utimesSync(commonHead, old, old);
    expect(fetchedRecently(commonDir)).toBe(false);
    git(worktree, "fetch", "--quiet", "origin", "main");
    expect(existsSync(join(commonDir, "worktrees", "app-wt-a", "FETCH_HEAD"))).toBe(true);
    expect(fetchedRecently(commonDir)).toBe(true);
  });

  test("a fetch that is a day old, or none at all: not fresh", () => {
    const { repo } = makeClone();
    const commonDir = join(repo, ".git");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const commonHead = join(commonDir, "FETCH_HEAD");
    if (existsSync(commonHead)) utimesSync(commonHead, old, old);
    expect(fetchedRecently(commonDir)).toBe(false);
    expect(fetchedRecently(join(tempDir("no-git-dir"), ".git"))).toBe(false);
  });
});

describe("the frame", () => {
  test("no anymodel.json: exit 1 with the reason, no worktree of any shape", async () => {
    const repo = makeRepo();
    for (const name of ["fix/x", AGENT]) {
      expect(await create(repo, name)).toEqual({
        exitCode: 1,
        stderr:
          "worktree not created: this project wires the anymodel worktree hooks (anymodel hook ...), but has no .claude/anymodel.json. " +
          'Add "worktrees" to .claude/anymodel.json, or take the three anymodel hook lines out of .claude/settings.json (the anymodel README, § Worktrees)',
      });
    }
    expect(existsSync(join(repo, ".claude", "worktrees"))).toBe(false);
    expect(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test('an anymodel.json without "worktrees": exit 1 with the reason', async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    const result = await create(repo, AGENT);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith(
      'worktree not created: this project wires the anymodel worktree hooks (anymodel hook ...), but its .claude/anymodel.json has no "worktrees". ',
    );
    expect(existsSync(join(repo, ".claude", "worktrees"))).toBe(false);
  });

  test("another WorktreeCreate in the project's or the user's settings does not silence it", async () => {
    const repo = makeRepo();
    optIn(repo);
    wireProjectHook(repo, "WorktreeCreate");
    const env = hookEnv();
    writeClaudeFile(dirname(env.CLAUDE_CONFIG_DIR ?? ""), "settings.json", {
      hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: "true" }] }] },
    });
    expect(await create(repo, AGENT, env)).toEqual({
      stdout: join(repo, ".claude", "worktrees", AGENT),
    });
  });

  test("anymodel.json needs a newer plugin: exit 1 with the update command, no worktree", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "anymodel.json", { requires: ">=99" });
    const result = await create(repo, "x");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(
        `^worktree not created: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: this project needs anymodel >=99; you have [0-9.]+; run claude plugin update anymodel@anymodel$`,
      ),
    );
    expect(existsSync(join(repo, ".claude", "worktrees", "x"))).toBe(false);
  });

  test("a broken anymodel.json: exit 1, naming the file", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "anymodel.json", { worktree: {} });
    expect(await create(repo, "x")).toEqual({
      exitCode: 1,
      stderr: `worktree not created: Invalid ${file}: worktree: unknown field (a newer anymodel may be needed)`,
    });
  });

  test("a subagent's base: a repo fetched today is not fetched again (FETCH_HEAD's time)", async () => {
    const { origin, repo } = makeClone();
    optIn(repo);
    git(repo, "fetch", "-q", "origin");
    const before = head(repo, "origin/main");
    // A newer commit on origin that a fetch would bring.
    const other = join(tempDir("other"), "o");
    git(dirname(other), "clone", "-q", origin, other);
    writeFileSync(join(other, "n.txt"), "n\n");
    git(other, "add", "n.txt");
    git(other, "commit", "-q", "-m", "n");
    git(other, "push", "-q", "origin", "main");
    const folder = (await create(repo, "agent-0aa")).stdout ?? "";
    expect(head(folder)).toBe(before);
    // Fetched a day ago: fetched again, so the newer commit is the base.
    const fetchHead = join(repo, ".git", "FETCH_HEAD");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(fetchHead, old, old);
    const later = (await create(repo, "agent-0bb")).stdout ?? "";
    expect(head(later)).toBe(head(other));
  });
});

describe("reuseDecision", () => {
  const main = { path: "/code/app", head: "a", branch: "main", locked: false, prunable: false };
  const base = {
    worktrees: [main],
    branch: "fix/x",
    folder: "/code/app-wt-fix-x",
    sessions: [],
    askingSession: SESSION,
    folderExists: () => true,
  };

  test("nothing there: create", () => {
    expect(reuseDecision(base)).toEqual({ kind: "create" });
  });

  test("found by its branch in another folder: entered there", () => {
    const old = {
      path: "/code/old-name",
      head: "b",
      branch: "fix/x",
      locked: false,
      prunable: false,
    };
    expect(reuseDecision({ ...base, worktrees: [main, old] })).toEqual({
      kind: "reuse",
      folder: "/code/old-name",
    });
  });

  test("the planned folder on another branch, locked, or gone: refused", () => {
    const other = {
      path: "/code/app-wt-fix-x",
      head: "b",
      branch: "fix/y",
      locked: false,
      prunable: false,
    };
    expect(reuseDecision({ ...base, worktrees: [main, other] })).toEqual({
      kind: "refuse",
      why: "/code/app-wt-fix-x is on fix/y, not fix/x",
    });
    const locked = { ...other, branch: "fix/x", locked: true };
    expect(reuseDecision({ ...base, worktrees: [main, locked] }).kind).toBe("refuse");
    const gone = { ...other, branch: "fix/x", prunable: true };
    expect(reuseDecision({ ...base, worktrees: [main, gone] })).toEqual({
      kind: "refuse",
      why: "/code/app-wt-fix-x is still listed but its folder is gone: run `git worktree prune`, then ask again",
    });
  });

  test("the session records cannot be read: an existing worktree is refused", () => {
    const found = {
      path: "/code/app-wt-fix-x",
      head: "b",
      branch: "fix/x",
      locked: false,
      prunable: false,
    };
    expect(reuseDecision({ ...base, worktrees: [main, found], sessions: null }).kind).toBe(
      "refuse",
    );
  });
});
