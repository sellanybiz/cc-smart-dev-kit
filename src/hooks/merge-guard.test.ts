/**
 * The merge guard: what it lets through without a question, and every condition that turns
 * a merge into a question for the person.
 *
 * A fake `gh` first on PATH answers the three read-only calls (`pr view`, `repo view`,
 * `pr checks`) from JSON files, and logs every call, so a test can assert both the answer
 * and which calls the guard made. The real `git` is beside it as a symlink: the frame's
 * project lookup needs one, and nothing else on PATH is reached.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { mergeGuardHook } from "./specs";

/** The commit the fake gh reports as the pull request's head. */
const HEAD = "a".repeat(40);

const CONFIG = {
  requires: ">=0.4",
  worktrees: { base: "dev", prefix: "app-wt-" },
  workflow: { autoMerge: true },
};

/** A fake `gh` in a fresh folder, first on PATH: it logs every call and answers from files. */
function fakeGh(answers: Partial<Record<"checks" | "repo" | "view", string>>): string {
  const dir = tempDir("fake-gh");
  const log = join(dir, "gh.log");
  for (const [name, json] of Object.entries(answers)) {
    // A trailing line break: the script prints the file with the shell's own `read`, which
    // hands over a last line without one as "end of file" and would print nothing.
    writeFileSync(join(dir, `${name}.json`), `${json}\n`);
  }
  // Only shell built-ins (`echo`, `read`, `printf`): PATH holds this folder and nothing else,
  // so no real program — `gh` least of all — can be reached by accident.
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
echo "$*" >> '${log}'
case "$1 $2" in
  "pr view") answer=view ;;
  "repo view") answer=repo ;;
  "pr checks") answer=checks ;;
  *) echo "fake gh: unknown call: $*" >&2; exit 1 ;;
esac
if [ -f "${dir}/$answer.json" ]; then
  while IFS= read -r line; do printf '%s\\n' "$line"; done < "${dir}/$answer.json"
else
  echo "fake gh: no answer for $*" >&2
  exit 1
fi
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  // git, and only git: the frame looks the project up with it. No other real tool is reached.
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("this test needs git");
  symlinkSync(realGit, join(dir, "git"));
  return dir;
}

/** The JSON the guard's fake gh answers with, one shape per call. */
function answers(over: Partial<Record<"checks" | "repo" | "view", string>> = {}): {
  checks: string;
  repo: string;
  view: string;
} {
  return {
    checks: JSON.stringify([{ bucket: "pass", name: "build" }]),
    repo: JSON.stringify({ defaultBranchRef: { name: "main" } }),
    view: JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 7 }),
    ...over,
  };
}

/**
 * The hook's environment: a temp HOME, and a PATH holding the fake gh (or none) and git
 * alone. `withoutGh`: the same PATH with the fake gh taken back out.
 */
function envWithGh(gh: string | null, withoutGh = false): Record<string, string> {
  const env = hookEnv();
  const bin = withoutGh ? tempDir("no-gh") : gh;
  if (withoutGh) {
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("this test needs git");
    symlinkSync(realGit, join(bin as string, "git"));
  }
  return { ...env, PATH: bin ?? "" };
}

/** A recorded review for `sha`, written by hand into the state folder of `env`. */
function recordReviewHere(env: Record<string, string>, repo: string, sha: string): void {
  const file = join(
    cliPaths(env).stateDir,
    "reviews",
    `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ [sha]: "2026-10-16T10:00:00.000Z" }, null, 2)}\n`);
}

/** The input Claude Code sends for one Bash command. */
function input(cwd: string, command: string): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  };
}

/** The exact stdout of an `ask` decision. */
function ask(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  });
}

/** What the guard said when it could not check: gh is missing, or a call did not answer. */
function couldNotCheck(why: string): string {
  return ask(
    `cc-smart-dev-kit could not check this merge: ${why}. Approve the merge yourself if it is right.`,
  );
}

/** What the guard said when it may not merge by itself. */
function willNotMerge(which: string, reason: string): string {
  return ask(
    `cc-smart-dev-kit will not merge ${which} by itself: ${reason}. Approve the merge yourself if you meant it.`,
  );
}

/** The calls the fake gh logged, one string each. */
function ghCalls(gh: string): string[] {
  const file = join(gh, "gh.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

/** A repo that opted in, with a fake gh beside it and every answer already right. */
function ready(
  config: unknown = CONFIG,
  over: Partial<Record<"checks" | "repo" | "view", string>> = {},
  withoutGh = false,
): { env: Record<string, string>; gh: string; repo: string } {
  const repo = makeRepo();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  const gh = fakeGh(answers(over));
  const env = envWithGh(gh, withoutGh);
  return { env, gh, repo };
}

describe("the merge it lets through without a question", () => {
  test("autoMerge on, the integration base, green checks, the review recorded: silent", async () => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
    // It read all three facts, read-only.
    expect(ghCalls(gh)).toEqual([
      "pr view 7 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 7 --required --json name,bucket",
    ]);
  });

  test("a skipped required check counts as passed (GitHub's own rule)", async () => {
    const { env, repo } = ready(CONFIG, {
      checks: JSON.stringify([
        { bucket: "pass", name: "build" },
        { bucket: "skipping", name: "e2e" },
      ]),
    });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });

  test("reviewBeforePush off: no record is needed", async () => {
    const { env, repo } = ready({
      ...CONFIG,
      workflow: { autoMerge: true, reviewBeforePush: false },
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });

  test("a merge that names another repository is judged against that repository", async () => {
    const { env, gh, repo } = ready(CONFIG, { checks: "[]" });
    await runHook(mergeGuardHook, input(repo, "gh pr merge -R example-org/other 7"), env);
    expect(ghCalls(gh)).toEqual([
      "pr view 7 --repo example-org/other --json number,baseRefName,headRefOid",
      "repo view --repo example-org/other --json defaultBranchRef",
      "pr checks 7 --required --repo example-org/other --json name,bucket",
    ]);
  });

  test("the command names its pull request through a wrapper", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "timeout 60 gh pr merge 7"), env)).toEqual({});
  });

  test("a worktree of the repo: the same record, written there, allows it", async () => {
    // What `cc-smart-dev-kit workflow review-done` writes in a worktree, the guard finds: the
    // record is the repository's, and the guard reads the same one wherever it runs.
    const { env, repo } = ready();
    const worktree = join(repo, "..", "app-wt-review");
    git(repo, "worktree", "add", "-q", "-b", "review-branch", worktree);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(worktree, "gh pr merge 7"), env)).toEqual({});
  });
});

describe("every condition that asks", () => {
  test("a project that never opted in: the guard is silent (the plugin stays invisible)", async () => {
    const repo = makeRepo();
    const gh = fakeGh(answers());
    const env = envWithGh(gh);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });

  test("autoMerge off: asks with the policy, and reads nothing with gh", async () => {
    const { env, gh, repo } = ready({ ...CONFIG, workflow: { autoMerge: false } });
    const result = await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env);
    expect(result).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "autoMerge is off (project): turn it on with `cc-smart-dev-kit workflow set autoMerge true --project`",
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("no workflow at all: autoMerge is off by default", async () => {
    const { env, repo } = ready({
      requires: ">=0.4",
      worktrees: { base: "dev", prefix: "app-wt-" },
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "autoMerge is off (default): turn it on with `cc-smart-dev-kit workflow set autoMerge true --project`",
      ),
    });
  });

  test("a broken personal workflow file: asks, naming the file", async () => {
    const { env, repo } = ready();
    mkdirSync(dirname(cliPaths(env).workflowConfigFile), { recursive: true });
    writeFileSync(cliPaths(env).workflowConfigFile, "{ not json");
    const result = await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env);
    const said = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecisionReason;
    expect(said).toStartWith(
      "cc-smart-dev-kit will not merge this pull request by itself: the workflow settings cannot be read (Invalid ",
    );
    expect(said).toContain("workflow.json");
  });

  test("the base is not the integration base: asks, and reads no checks", async () => {
    const { env, gh, repo } = ready(CONFIG, {
      view: JSON.stringify({ baseRefName: "feature/x", headRefOid: HEAD, number: 7 }),
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "the pull request's base is feature/x, not the project's integration base dev",
      ),
    });
    expect(ghCalls(gh)).toEqual([
      "pr view 7 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
    ]);
  });

  test("the project names no integration base: asks", async () => {
    const { env, repo } = ready({ requires: ">=0.4", workflow: { autoMerge: true } });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "this project names no integration base (worktrees.base in .claude/cc-smart-dev-kit.json), so there is no branch cc-smart-dev-kit may merge into by itself",
      ),
    });
  });

  test("the base is the repository's default branch: asking is a release decision", async () => {
    const { env, repo } = ready(
      { ...CONFIG, worktrees: { base: "main", prefix: "app-wt-" } },
      {
        repo: JSON.stringify({ defaultBranchRef: { name: "main" } }),
        view: JSON.stringify({ baseRefName: "main", headRefOid: HEAD, number: 7 }),
      },
    );
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "main is the repository's default branch: merging there is a release, and that is your decision",
      ),
    });
  });

  test("the base feeds another branch family (worktrees.bases): asks", async () => {
    const { env, repo } = ready({
      ...CONFIG,
      worktrees: { base: "dev", prefix: "app-wt-", bases: { "release/": "dev" } },
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "dev is the target of another branch family (worktrees.bases), so it is not a plain integration base",
      ),
    });
  });

  test("a required check failed: asks, naming it", async () => {
    const { env, repo } = ready(CONFIG, {
      checks: JSON.stringify([
        { bucket: "fail", name: "build" },
        { bucket: "pass", name: "lint" },
      ]),
    });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge("#7", "its required checks are not all green: build (fail)"),
    });
  });

  test("a required check still running, and one cancelled: asks, naming both", async () => {
    const { env, repo } = ready(CONFIG, {
      checks: JSON.stringify([
        { bucket: "pending", name: "e2e" },
        { bucket: "cancel", name: "deploy" },
      ]),
    });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "its required checks are not all green: e2e (pending), deploy (cancel)",
      ),
    });
  });

  test("no required checks at all: asks — there is nothing green to trust", async () => {
    const { env, repo } = ready(CONFIG, { checks: "[]" });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "gh reports no required checks for it, so there is nothing green to trust",
      ),
    });
  });

  test("the head commit has no recorded review: asks, and says how to record it", async () => {
    const { env, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "the head commit aaaaaaa has no recorded review (reviewBeforePush is on: run the review, then `cc-smart-dev-kit workflow review-done`)",
      ),
    });
  });

  test("another commit's record is not this one's", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, "b".repeat(40));
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "the head commit aaaaaaa has no recorded review (reviewBeforePush is on: run the review, then `cc-smart-dev-kit workflow review-done`)",
      ),
    });
  });

  test("an armed merge (--auto) is judged the same way", async () => {
    const { env, repo } = ready({ ...CONFIG, workflow: { autoMerge: false } });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge --auto 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "autoMerge is off (project): turn it on with `cc-smart-dev-kit workflow set autoMerge true --project`",
      ),
    });
  });
});

describe("gh it cannot read", () => {
  test("gh is not installed: asks, and says so", async () => {
    const { env, repo } = ready(CONFIG, {}, true);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: couldNotCheck("gh is not installed"),
    });
  });

  test("gh cannot read the pull request: asks", async () => {
    const { env, repo } = ready(CONFIG, { view: "" });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: couldNotCheck("gh could not read the pull request this command names"),
    });
  });

  test("an answer that is not the shape asked for: asks", async () => {
    const { env, repo } = ready(CONFIG, { view: JSON.stringify({ number: 7 }) });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: couldNotCheck("gh could not read the pull request this command names"),
    });
  });

  test("gh cannot read the default branch: asks", async () => {
    const { env, repo } = ready(CONFIG, { repo: "" });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: couldNotCheck("gh could not read this repository's default branch"),
    });
  });

  test("gh cannot read the required checks: asks, naming the pull request", async () => {
    const { env, repo } = ready(CONFIG, { checks: "" });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: couldNotCheck("gh could not read the required checks of #7"),
    });
  });
});

describe("commands that are not a merge", () => {
  test.each([
    "git push origin main",
    "gh pr view 7",
    "gh pr checks 7",
    "gh pr merge --disable-auto 7",
    'echo "gh pr merge 7"',
    "grep -r 'gh pr merge' .",
  ])("%j: silent, and gh is not called", async (command) => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a command with no tool_input.command: silent", async () => {
    const { env, repo } = ready();
    const { tool_input: _ignored, ...rest } = input(repo, "gh pr merge 7");
    expect(await runHook(mergeGuardHook, { ...rest }, env)).toEqual({});
  });
});
