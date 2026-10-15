import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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
import { git, tempDir } from "../testing/temp";
import { worktreeCreateHook } from "./specs";
import {
  badName,
  badPrefix,
  configuredFolder,
  defaultShape,
  isSubagentName,
  readBaseRef,
  reuseDecision,
  SETUP_MARKER,
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

describe("the shapes", () => {
  test("Claude Code's own shape: / becomes + in the folder and the branch", () => {
    expect(defaultShape("/repo", "feat/x")).toEqual({
      folder: "/repo/.claude/worktrees/feat+x",
      branch: "worktree-feat+x",
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

describe("without anymodel.json: Claude Code's default", () => {
  test("a repo without a remote: .claude/worktrees/<name> on worktree-<name>, from HEAD", async () => {
    const repo = makeRepo();
    const result = await create(repo, "feat/x");
    const folder = join(repo, ".claude", "worktrees", "feat+x");
    expect(result).toEqual({ stdout: folder });
    expect(branchOf(folder)).toBe("worktree-feat+x");
    expect(head(folder)).toBe(head(repo));
  });

  test("with a remote: from origin's default branch, not the local HEAD (worktree.baseRef fresh)", async () => {
    const { repo } = makeClone();
    writeFileSync(join(repo, "local.txt"), "not pushed\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local only");
    const result = await create(repo, "t1");
    const folder = join(repo, ".claude", "worktrees", "t1");
    expect(result).toEqual({ stdout: folder });
    expect(head(folder)).toBe(head(repo, "origin/main"));
    expect(head(folder)).not.toBe(head(repo));
  });

  test("worktree.baseRef head in the project's settings: from the local HEAD", async () => {
    const { repo } = makeClone();
    writeFileSync(join(repo, "local.txt"), "not pushed\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local only");
    writeClaudeFile(repo, "settings.json", { worktree: { baseRef: "head" } });
    await create(repo, "t2");
    expect(head(join(repo, ".claude", "worktrees", "t2"))).toBe(head(repo));
  });

  test("an existing worktree of that name is entered again", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    const first = await create(repo, "again", env);
    const second = await create(repo, "again", env);
    expect(second).toEqual(first);
  });

  test("a folder there that is no worktree: refused, exit 1", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude", "worktrees", "taken"), { recursive: true });
    expect(await create(repo, "taken")).toEqual({
      exitCode: 1,
      stderr: `worktree not created: ${join(repo, ".claude", "worktrees", "taken")} exists and is not a worktree of this repo`,
    });
  });

  test("a subagent asking from inside a worktree: the main checkout's .claude/worktrees", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    const session = (await create(repo, "session", env)).stdout ?? "";
    const result = await create(session, "agent-0a1b2c3d4e5f60718", env);
    expect(result).toEqual({
      stdout: join(repo, ".claude", "worktrees", "agent-0a1b2c3d4e5f60718"),
    });
  });

  test(".worktreeinclude: copies the gitignored files it names, never a tracked one", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitignore"), ".env\nsecrets/\nbuild/\n");
    writeFileSync(join(repo, ".worktreeinclude"), ".env\nsecrets/key.txt\ntracked.txt\n");
    writeFileSync(join(repo, "tracked.txt"), "tracked\n");
    git(repo, "add", ".gitignore", ".worktreeinclude", "tracked.txt");
    git(repo, "commit", "-q", "-m", "ignore");
    writeFileSync(join(repo, ".env"), "A=1\n");
    mkdirSync(join(repo, "secrets"));
    writeFileSync(join(repo, "secrets", "key.txt"), "k\n");
    mkdirSync(join(repo, "build"));
    writeFileSync(join(repo, "build", "out.js"), "x\n");
    writeFileSync(join(repo, "tracked.txt"), "changed here\n");
    const folder = (await create(repo, "inc")).stdout ?? "";
    expect(readFileSync(join(folder, ".env"), "utf8")).toBe("A=1\n");
    expect(readFileSync(join(folder, "secrets", "key.txt"), "utf8")).toBe("k\n");
    expect(existsSync(join(folder, "build"))).toBe(false);
    // Tracked: the worktree has the committed text, not the main checkout's change.
    expect(readFileSync(join(folder, "tracked.txt"), "utf8")).toBe("tracked\n");
  });

  test("outside git: refused, exit 1", async () => {
    const result = await create(tempDir("nogit"), "x");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith("worktree not created: ");
  });
});

describe("with worktrees in anymodel.json", () => {
  function configured(setup?: string[]) {
    const { origin, repo } = makeClone();
    writeClaudeFile(repo, "anymodel.json", {
      worktrees: { base: "main", prefix: "app-wt-", ...(setup === undefined ? {} : { setup }) },
    });
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

  test("a subagent keeps Claude Code's shape, with no setup", async () => {
    const log = join(tempDir("setup"), "calls.log");
    const { repo } = configured(["sh", "-c", `echo ran >> "${log}"`]);
    const result = await create(repo, "agent-0123456789abcdef0");
    expect(result).toEqual({
      stdout: join(repo, ".claude", "worktrees", "agent-0123456789abcdef0"),
    });
    expect(existsSync(log)).toBe(false);
  });

  test("a prefix with a / is refused", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "anymodel.json", { worktrees: { base: "main", prefix: "../x-" } });
    expect((await create(repo, "fix/d")).stderr).toBe(
      'worktree not created: worktrees.prefix "../x-" must be part of a folder name, with no "/" or "\\"',
    );
  });
});

describe("the frame", () => {
  test("the project wires its own WorktreeCreate: no output, exit 0, no worktree", async () => {
    const repo = makeRepo();
    wireProjectHook(repo, "WorktreeCreate");
    expect(await create(repo, "deferred")).toEqual({});
    expect(existsSync(join(repo, ".claude", "worktrees", "deferred"))).toBe(false);
  });

  test("the user's own settings wire a WorktreeCreate: also deferred", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    writeClaudeFile(dirname(env.CLAUDE_CONFIG_DIR ?? ""), "settings.json", {
      hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: "true" }] }] },
    });
    expect(await create(repo, "deferred", env)).toEqual({});
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

  test("the timestamp of FETCH_HEAD: a repo fetched today is not fetched again", async () => {
    const { origin, repo } = makeClone();
    git(repo, "fetch", "-q", "origin");
    const before = head(repo, "origin/main");
    // A newer commit on origin that a fetch would bring.
    const other = join(tempDir("other"), "o");
    git(dirname(other), "clone", "-q", origin, other);
    writeFileSync(join(other, "n.txt"), "n\n");
    git(other, "add", "n.txt");
    git(other, "commit", "-q", "-m", "n");
    git(other, "push", "-q", "origin", "main");
    const folder = (await create(repo, "today")).stdout ?? "";
    expect(head(folder)).toBe(before);
    // Fetched a day ago: fetched again, so the newer commit is the base.
    const fetchHead = join(repo, ".git", "FETCH_HEAD");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(fetchHead, old, old);
    const later = (await create(repo, "later")).stdout ?? "";
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
