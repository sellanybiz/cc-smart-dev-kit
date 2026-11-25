/** Whether a checkout compares paths without case: git's own setting. */
import { expect, test } from "bun:test";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { ignoresCase } from "./files-check";

test("core.ignorecase decides, and a setting git cannot read compares with case", () => {
  const repo = tempDir("ignorecase");
  git(repo, "init", "-q");
  git(repo, "config", "core.ignorecase", "true");
  expect(ignoresCase(repo, cleanGitEnv())).toBe(true);
  git(repo, "config", "core.ignorecase", "false");
  expect(ignoresCase(repo, cleanGitEnv())).toBe(false);
  expect(ignoresCase(tempDir("not-git"), cleanGitEnv())).toBe(false);
});
