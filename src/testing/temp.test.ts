/**
 * `cleanGitEnv`: a test run from a session sees the same clean machine as CI. `gitAt`: a commit
 * gets the date the test names, not the wall clock's.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cleanGitEnv, git, gitAt, tempDir } from "./temp";

const SET = ["BASH_DEFAULT_TIMEOUT_MS", "BASH_MAX_TIMEOUT_MS", "GIT_DIR", "CLAUDE_PROJECT_DIR"];
const before = new Map(SET.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of before) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("cleanGitEnv", () => {
  test("drops the session's own Bash timeouts, git's variables and Claude's", () => {
    process.env.BASH_DEFAULT_TIMEOUT_MS = "1800000";
    process.env.BASH_MAX_TIMEOUT_MS = "3600000";
    process.env.GIT_DIR = "/somewhere/.git";
    process.env.CLAUDE_PROJECT_DIR = "/somewhere";
    const env = cleanGitEnv();
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBeUndefined();
    expect(env.BASH_MAX_TIMEOUT_MS).toBeUndefined();
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.CLAUDE_PROJECT_DIR).toBeUndefined();
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  });
});

describe("gitAt", () => {
  test("a commit it makes carries the given author and committer date", () => {
    const repo = tempDir();
    git(repo, "init", "-q");
    gitAt("2020-01-01T10:00:00Z", repo, "commit", "-q", "--allow-empty", "-m", "dated");
    expect(git(repo, "log", "-1", "--format=%aI %cI").trim()).toBe(
      "2020-01-01T10:00:00Z 2020-01-01T10:00:00Z",
    );
  });

  test("a git failure throws with git's own message, as git() does", () => {
    expect(() => gitAt("2020-01-01T10:00:00Z", tempDir(), "rev-parse", "HEAD")).toThrow(
      "git rev-parse HEAD failed",
    );
  });
});
