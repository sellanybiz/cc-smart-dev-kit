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
} from "../testing/hooks";
import { cleanGitEnv, git, tempDir, withSlowGit } from "../testing/temp";
import { createLockFile } from "./create-lock";
import { worktreeCreateHook } from "./specs";
import {
  addWorktree,
  badName,
  badPrefix,
  baseForBranch,
  configuredFolder,
  fetchedRecently,
  isSubagentName,
  readBaseRef,
  reuseDecision,
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

/** Turns the worktree engine on in `repo`: `worktrees` in its cc-smart-dev-kit.json. */
function optIn(repo: string): void {
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
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
    const session = join(dirname(repo), "my-app-session");
    git(repo, "worktree", "add", "-q", "-b", "fix/session", session);
    expect(await create(session, AGENT, env)).toEqual({
      stdout: join(repo, ".claude", "worktrees", AGENT),
    });
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

  test("a subagent's worktree: copies the gitignored files it names, never a tracked one", async () => {
    const repo = withIncludes();
    const folder = (await create(repo, AGENT)).stdout ?? "";
    expect(folder).not.toBe("");
    expect(readFileSync(join(folder, ".env"), "utf8")).toBe("A=1\n");
    expect(readFileSync(join(folder, "secrets", "key.txt"), "utf8")).toBe("k\n");
    expect(existsSync(join(folder, "build"))).toBe(false);
    // Tracked: the worktree has the committed text, not the main checkout's change.
    expect(readFileSync(join(folder, "tracked.txt"), "utf8")).toBe("tracked\n");
  });
});

describe("a session's worktree", () => {
  test("D20: refused: the engine that named its folder from worktrees.prefix was retired", async () => {
    const { repo } = makeClone();
    optIn(repo);
    expect(await create(repo, "fix/login")).toEqual({
      exitCode: 1,
      stderr:
        "worktree not created: the plugin's worktree engine was retired in 1.0.0, and with it the worktrees.prefix it named this folder with: take the \"cc-smart-dev-kit hook worktree-create\" line out of the project's settings (`cc-smart-dev-kit project init` does it), and Claude Code makes its own worktrees",
    });
    expect(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test("a prefix that matches nothing, and the longest prefix", () => {
    const worktrees = {
      base: "main",
      bases: { "release/": "dev", "release/hotfix/": "stable" },
    };
    expect(baseForBranch(worktrees, "release/1.0")).toBe("dev");
    expect(baseForBranch(worktrees, "release/hotfix/urgent")).toBe("stable");
    expect(baseForBranch(worktrees, "fix/login")).toBe("main");
    expect(baseForBranch({ base: "main" }, "release/1.0")).toBe("main");
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
    const file = hold(join(repo, ".git"), `worktree-${AGENT}`);
    const result = await create(repo, AGENT);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith(
      "worktree not created: another cc-smart-dev-kit process (pid ",
    );
    expect(result.stderr).toContain("is making the worktree for this branch right now.");
    expect(result.stderr).toContain(`if that process is gone, remove ${file}`);
    expect(existsSync(join(repo, ".claude", "worktrees", AGENT))).toBe(false);
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
    const file = hold(join(repo, ".git"), `worktree-${AGENT}`, dead);
    const result = await create(repo, AGENT);
    expect(result).toEqual({ stdout: join(repo, ".claude", "worktrees", AGENT) });
    // Released once the create is done.
    expect(existsSync(file)).toBe(false);
  });

  test("the lock is released when the create fails too", async () => {
    const { repo } = makeClone();
    optIn(repo);
    // A folder there that is no worktree: refused.
    mkdirSync(join(repo, ".claude", "worktrees", AGENT), { recursive: true });
    const file = createLockFile(join(repo, ".git"), `worktree-${AGENT}`);
    expect((await create(repo, AGENT)).exitCode).toBe(1);
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
  test("no cc-smart-dev-kit.json: exit 1 with the reason, no worktree of any shape", async () => {
    const repo = makeRepo();
    for (const name of ["fix/x", AGENT]) {
      expect(await create(repo, name)).toEqual({
        exitCode: 1,
        stderr:
          "worktree not created: this project wires the cc-smart-dev-kit worktree hooks (cc-smart-dev-kit hook ...), but has no .claude/cc-smart-dev-kit.json. " +
          'Add "worktrees" to .claude/cc-smart-dev-kit.json, or take the three cc-smart-dev-kit hook lines out of .claude/settings.json (the cc-smart-dev-kit README, § Worktrees)',
      });
    }
    expect(existsSync(join(repo, ".claude", "worktrees"))).toBe(false);
    expect(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test('a cc-smart-dev-kit.json without "worktrees": exit 1 with the reason', async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const result = await create(repo, AGENT);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith(
      'worktree not created: this project wires the cc-smart-dev-kit worktree hooks (cc-smart-dev-kit hook ...), but its .claude/cc-smart-dev-kit.json has no "worktrees". ',
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

  test("cc-smart-dev-kit.json needs a newer plugin: exit 1 with the update command, no worktree", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=99" });
    const result = await create(repo, "x");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(
        `^worktree not created: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: this project needs cc-smart-dev-kit >=99; you have [0-9.]+; run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit$`,
      ),
    );
    expect(existsSync(join(repo, ".claude", "worktrees", "x"))).toBe(false);
  });

  test("a broken cc-smart-dev-kit.json: exit 1, naming the file", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(await create(repo, "x")).toEqual({
      exitCode: 1,
      stderr: `worktree not created: Invalid ${file}: worktree: unknown field (a newer cc-smart-dev-kit may be needed)`,
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
