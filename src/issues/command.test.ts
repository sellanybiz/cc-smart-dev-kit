/**
 * `issue file` as a command: the arguments, the one line it prints, its exit codes, and the real
 * `gh` executor against fake `gh` scripts on PATH (a missing gh, a logged-out one, a slow one).
 * Nothing here reaches GitHub.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { fakeGh } from "../testing/fake-gh";
import { commitConfig, makeRepo, writePersonalWorkflow } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { GH_WRITE_TIMEOUT_MS, runGh } from "../workflow/merge-check";
import { type IssueContext, ISSUE_USAGE, runIssue } from "./command";

function setup(enabled = true) {
  const repo = makeRepo("my-app");
  git(repo, "remote", "add", "origin", "git@github.com:example-org/my-app.git");
  commitConfig(repo, { worktrees: { base: "main" } }, ["main"]);
  const home = tempDir("issue-cmd-home");
  const env = { ...cleanGitEnv(), CLAUDE_CONFIG_DIR: `${home}/.claude`, HOME: home };
  if (enabled) writePersonalWorkflow(env, { issues: { enabled: true } });
  const gh = fakeGh();
  const lines: string[] = [];
  const errors: string[] = [];
  let stdin = "body from stdin";
  const context: IssueContext = {
    cwd: repo,
    env,
    error: (line) => errors.push(line),
    gh: gh.exec,
    paths: cliPaths(env),
    print: (line) => lines.push(line),
    readStdin: async () => stdin,
  };
  return { context, errors, gh, lines, repo, setStdin: (text: string) => (stdin = text) };
}

const ARGS = ["file", "--title", "A finding", "--body-file", "-", "--fingerprint", "k1"];

describe("issue file: the command", () => {
  test("filed: one line, exit 0, the body read from stdin", async () => {
    const run = setup();
    expect(await runIssue(ARGS, run.context)).toBe(0);
    expect(run.lines).toEqual(["filed #1 https://github.com/example-org/my-app/issues/1"]);
    expect(run.errors).toEqual([]);
    expect(run.gh.issues[0]?.body).toContain("body from stdin");
  });

  test("again: updated, still one issue", async () => {
    const run = setup();
    await runIssue(ARGS, run.context);
    expect(await runIssue(ARGS, run.context)).toBe(0);
    expect(run.lines.at(-1)).toBe("updated #1 https://github.com/example-org/my-app/issues/1");
    expect(run.gh.issues).toHaveLength(1);
  });

  test("a body file, a repeated --label and the --opt=value form", async () => {
    const run = setup();
    writeFileSync(join(run.repo, "body.md"), "from a file");
    const argv = [
      "file",
      "--title=T",
      "--body-file=body.md",
      "--fingerprint=k2",
      "--label",
      "a",
      "--label",
      "b",
    ];
    expect(await runIssue(argv, run.context)).toBe(0);
    expect(run.gh.issues[0]?.labels).toEqual(["kit:found", "a", "b"]);
    expect(run.gh.issues[0]?.body).toContain("from a file");
  });

  test("off: refused on stdout in the one-line form, exit 1, with how to turn it on", async () => {
    const run = setup(false);
    expect(await runIssue(ARGS, run.context)).toBe(1);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toStartWith("refused: issues.enabled is off (default)");
    expect(run.lines[0]).toContain("workflow set issues.enabled true");
    expect(run.gh.calls).toEqual([]);
  });

  test.each([
    [[], "issue needs a command"],
    [["close"], "Unknown issue command: close"],
    [["file", "--title", "t"], "--body-file is needed, once"],
    [["file", "--title", "t", "--body-file", "-", "--fingerprint"], "--fingerprint needs a value"],
    [["file", "--nope"], "Unknown option: --nope"],
    [
      ["file", "--title", "a", "--title", "b", "--body-file", "-", "--fingerprint", "k"],
      "--title is needed, once",
    ],
  ])("usage error %p: exit 2, nothing printed on stdout", async (argv, said) => {
    const run = setup();
    expect(await runIssue(argv, run.context)).toBe(2);
    expect(run.lines).toEqual([]);
    expect(run.errors[0]).toContain(said);
    expect(run.errors[0]).toContain(ISSUE_USAGE);
  });

  test("a body file that is not there: exit 2", async () => {
    const run = setup();
    const argv = ["file", "--title", "t", "--body-file", "missing.md", "--fingerprint", "k"];
    expect(await runIssue(argv, run.context)).toBe(2);
    expect(run.errors[0]).toContain("Cannot read the body");
  });
});

describe.skipIf(process.platform === "win32")("the real gh executor", () => {
  /** A PATH of one fake `gh` that runs `script`, then the system's own basics. */
  function withGh(script: string): Record<string, string> {
    const bin = tempDir("fake-gh-bin");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    return { ...cleanGitEnv(), PATH: `${bin}${delimiter}/usr/bin${delimiter}/bin` };
  }
  const call = (env: Record<string, string>, timeoutMs = 5_000, input?: string) => ({
    env,
    folder: tempDir("gh-folder"),
    timeoutMs,
    ...(input === undefined ? {} : { input }),
  });

  test("no gh on PATH: missing", async () => {
    const empty = tempDir("no-gh");
    const result = await runGh(["--version"], call({ ...cleanGitEnv(), PATH: empty }));
    expect(result.kind).toBe("missing");
  });

  test("an exit 0 is ok, with stdout and the stdin it was given", async () => {
    const env = withGh('cat; echo " $*"');
    const result = await runGh(["issue", "list"], call(env, 5_000, "hello"));
    expect(result).toMatchObject({ code: 0, kind: "ok", out: "hello issue list\n" });
  });

  test("logged out: a failed exit, with gh's own words", async () => {
    const env = withGh(
      'echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4',
    );
    const result = await runGh(["auth", "status"], call(env));
    expect(result).toMatchObject({ code: 4, kind: "failed" });
    expect(result.err).toContain("gh auth login");
  });

  test("slow: the time runs out", async () => {
    const env = withGh("exec sleep 30");
    const result = await runGh(["issue", "create"], call(env, 300));
    expect(result.kind).toBe("timeout");
  });

  test("a write is given more time than a read", () => {
    expect(GH_WRITE_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});
