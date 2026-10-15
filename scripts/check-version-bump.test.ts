import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../src/testing/temp";
import { checkVersionBump } from "./check-version-bump";

const SCRIPT = join(import.meta.dir, "check-version-bump.ts");

function write(repo: string, file: string, content: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
}

const manifest = (version: string) => `${JSON.stringify({ name: "cc", version })}\n`;

/** A repo whose `main` has a plugin at 1.0.0, and a branch `feature` checked out from it. */
function makeRepo(): string {
  const repo = tempDir("bump");
  git(repo, "init", "-q", "-b", "main");
  write(repo, "plugin/.claude-plugin/plugin.json", manifest("1.0.0"));
  write(repo, "plugin/dist/cli.js", "console.log(1);\n");
  write(repo, "README.md", "hello\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}

function commit(repo: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "change");
}

const check = (repo: string) => checkVersionBump("main", { cwd: repo, env: cleanGitEnv() });

describe("check-version-bump", () => {
  test("a changed plugin file with the same version fails, naming the file", () => {
    const repo = makeRepo();
    commit(repo, { "plugin/dist/cli.js": "console.log(2);\n" });
    expect(check(repo)).toEqual({
      ok: false,
      message:
        "These files under plugin/ changed, but the version is still 1.0.0:\n" +
        "  plugin/dist/cli.js\n" +
        'Raise "version" in plugin/.claude-plugin/plugin.json (the release skill), then run: bun run build',
    });
  });

  test("a changed plugin file with a bumped version passes", () => {
    const repo = makeRepo();
    commit(repo, {
      "plugin/dist/cli.js": "console.log(2);\n",
      "plugin/.claude-plugin/plugin.json": manifest("1.1.0"),
    });
    expect(check(repo)).toEqual({
      ok: true,
      message: "plugin/ changed, and the version went up: 1.0.0 -> 1.1.0.",
    });
  });

  test("a change outside plugin/ passes", () => {
    const repo = makeRepo();
    commit(repo, { "README.md": "changed\n", "src/x.ts": "export {};\n" });
    expect(check(repo)).toEqual({ ok: true, message: "Nothing under plugin/ changed." });
  });

  test("a lower version fails: a rollback needs a higher version", () => {
    const repo = makeRepo();
    commit(repo, { "plugin/.claude-plugin/plugin.json": manifest("0.9.0") });
    expect(check(repo)).toEqual({
      ok: false,
      message: "The version went down, 1.0.0 -> 0.9.0. A rollback needs a higher version.",
    });
  });

  test("a commit that landed on the base later does not count", () => {
    const repo = makeRepo();
    commit(repo, { "README.md": "feature\n" });
    git(repo, "checkout", "-q", "main");
    commit(repo, { "plugin/dist/cli.js": "console.log(3);\n" });
    git(repo, "checkout", "-q", "feature");
    expect(check(repo).ok).toBe(true);
  });

  test("the command: exit 1 with the message on stderr, exit 2 without a base ref", () => {
    const repo = makeRepo();
    commit(repo, { "plugin/hooks/hooks.json": "{}\n" });
    const run = (...args: string[]) =>
      Bun.spawnSync(["bun", SCRIPT, ...args], {
        cwd: repo,
        env: cleanGitEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });
    const failed = run("main");
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.toString()).toContain("  plugin/hooks/hooks.json\n");
    expect(run().exitCode).toBe(2);
  });
});
