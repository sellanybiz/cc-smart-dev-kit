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
import { GUARD_BUDGET_ENV } from "./merge-guard";
import { mergeGuardHook } from "./specs";

/** The commit the fake gh reports as the pull request's head. */
const HEAD = "a".repeat(40);

const CONFIG = {
  requires: ">=0.4",
  worktrees: { base: "dev" },
  workflow: { autoMerge: true },
};

/**
 * A fake `gh` in a fresh folder, first on PATH: it logs every call and answers from files.
 *
 * It reads its arguments the way gh does — a flag it does not know for that call is an error
 * — so the guard's own argv is checked, not only the answer it gets: `gh repo view --repo x`
 * fails here exactly as it fails live ("unknown flag: --repo", gh 2.102.0), and no test can
 * pass on a call the real gh would refuse. An answer file named `<call>-<word>.json`
 * (`view-5.json`) answers for that pull request, `<call>.json` for any other. `<call>.err`,
 * when written, is printed on stderr with exit 1: how a failing gh is tested. A file named
 * `slow` makes every call hang, for the guard's deadline.
 */
function fakeGh(answers: Record<string, string>): string {
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
# A file named 'slow' in the fake's folder makes every call hang: only the caller's own
# deadline can stop it (read on /dev/zero never reaches a line break).
if [ -f '${dir}/slow' ]; then read x < /dev/zero; fi
answer=
allowed=
case "$1 $2" in
  "pr view") answer=view; allowed="--repo --json"; shift 2 ;;
  "repo view") answer=repo; allowed="--json"; shift 2 ;;
  "pr checks") answer=checks; allowed="--repo --required --json"; shift 2 ;;
  "alias list") answer="alias list"; allowed=""; shift 2 ;;
  *) echo "fake gh: unknown call: $1 $2" >&2; exit 1 ;;
esac
if [ -f '${dir}/'"$answer.err" ]; then
  while IFS= read -r line; do printf '%s\\n' "$line" >&2; done < '${dir}/'"$answer.err"
  exit 1
fi
positional=
while [ $# -gt 0 ]; do
  arg="$1"; shift
  name="$arg"
  case "$arg" in --*=*) name="\${arg%%=*}" ;; esac
  case "$arg" in
    -*) case " $allowed " in *" $name "*) ;; *) echo "fake gh: unknown flag: $name" >&2; exit 1 ;; esac ;;
    *) positional="\${positional:-$arg}"; continue ;;
  esac
  case "$name" in --repo|--json) [ "$arg" = "$name" ] && shift ;; esac
done
for suffix in "-$positional" ""; do
  if [ -f '${dir}/'"$answer$suffix.json" ]; then
    while IFS= read -r line; do printf '%s\\n' "$line"; done < '${dir}/'"$answer$suffix.json"
    exit 0
  fi
done
echo "fake gh: no answer for $answer" >&2
exit 1
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  // git, and only git: the frame looks the project up with it. No other real tool is reached.
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("this test needs git");
  symlinkSync(realGit, join(dir, "git"));
  return dir;
}

/** The policy is off, read from the project's file committed on `origin/dev`. */
const OFF_IN_PROJECT =
  'autoMerge is off (project, committed on origin/dev): turn it on in .claude/cc-smart-dev-kit.json ("workflow": {"autoMerge": true}), commit it to dev and push';

/** The policy is off because nothing turns it on: the built-in default. */
const OFF_BY_DEFAULT =
  'autoMerge is off (default): turn it on in .claude/cc-smart-dev-kit.json ("workflow": {"autoMerge": true}), commit it to dev and push';

/** The origin remote every `ready` repo has:the project's own repository, compared case-insensitively. */
const ORIGIN = "git@github.com:Example-Org/App.git";

/**
 * The JSON the guard's fake gh answers with, one shape per call. A key may name one pull
 * request instead (`"view-5"`: what `gh pr view 5` answers; the fake reads it that way).
 */
function answers(over: Record<string, string> = {}): Record<string, string> {
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

/**
 * A recorded review for `sha`, written by hand into the state folder of `env`, as the
 * review-record hook writes one: by the agent `by` (the plugin's reviewer by default).
 */
function recordReviewHere(
  env: Record<string, string>,
  repo: string,
  sha: string,
  by = "cc-smart-dev-kit:reviewer",
): void {
  const file = join(
    cliPaths(env).stateDir,
    "reviews",
    `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ [sha]: { at: "2026-10-16T10:00:00.000Z", by: [by] } }, null, 2)}\n`,
  );
}

/**
 * Commits the project's file in `repo` and points `origin/<branch>` at that commit for every
 * branch named: the policy as committed on a pull request's base is what the guard reads
 * (`resolveGate`), never the working copy. A plain ref, no fetch: the guard fetches nothing.
 */
function commitConfig(repo: string, config: unknown, branches: Iterable<string>): void {
  writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
  git(repo, "add", ".claude/cc-smart-dev-kit.json");
  git(repo, "commit", "-q", "-m", "the project's policy");
  for (const branch of branches) git(repo, "update-ref", `refs/remotes/origin/${branch}`, "HEAD");
}

/** Every branch a fixture's policy and answers name: each gets an `origin/<branch>` ref. */
function branchesOf(config: unknown, over: Record<string, string>): Set<string> {
  const branches = new Set(["main"]);
  const worktrees = (config as { worktrees?: { base?: string; bases?: Record<string, string> } })
    .worktrees;
  if (worktrees?.base !== undefined) branches.add(worktrees.base);
  for (const target of Object.values(worktrees?.bases ?? {})) branches.add(target);
  for (const [name, json] of Object.entries(answers(over))) {
    if (!name.startsWith("view") || json === "") continue;
    const base = (JSON.parse(json) as { baseRefName?: unknown }).baseRefName;
    if (typeof base === "string") branches.add(base);
  }
  return branches;
}

/** The input Claude Code sends for one Bash command. */
function input(cwd: string, command: string, tool = "Bash"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: "11111111-2222-3333-4444-555555555555",
    cwd,
    tool_name: tool,
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

/**
 * A repo that opted in, with a fake gh beside it and every answer already right: the
 * project's file committed, and `origin/<branch>` at that commit for every branch the policy
 * and the answers name. `withOrigin`: give it an `origin` remote naming `ORIGIN`, which a
 * merge that carries `--repo` is compared against (a repo without one cannot be compared,
 * and such a merge asks).
 */
function ready(
  config: unknown = CONFIG,
  over: Record<string, string> = {},
  withoutGh = false,
  withOrigin = false,
): { env: Record<string, string>; gh: string; repo: string } {
  const repo = makeRepo();
  if (withOrigin) git(repo, "remote", "add", "origin", ORIGIN);
  commitConfig(repo, config, branchesOf(config, over));
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

  test("a merge naming this project's own repository: judged, with gh repo view's own form", async () => {
    // `gh pr -R owner/repo merge 5` puts `--repo` before the subcommand: it is `gh pr`'s own
    // flag. The repository is this project's `origin`, so the policy applies to it — and
    // `gh repo view` takes the repository as an ARGUMENT (`gh repo view --repo x` fails with
    // "unknown flag: --repo"), which the fake gh enforces.
    const { env, gh, repo } = ready(CONFIG, undefined, false, true);
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr -R Example-Org/App merge 7"), env),
    ).toEqual({});
    expect(ghCalls(gh)).toEqual([
      "pr view 7 --repo Example-Org/App --json number,baseRefName,headRefOid",
      "repo view Example-Org/App --json defaultBranchRef",
      "pr checks 7 --required --repo Example-Org/App --json name,bucket",
    ]);
  });

  test("the same, written HOST/OWNER/REPO or with --repo=: the same repository", async () => {
    const withHost = ready(CONFIG, undefined, false, true);
    recordReviewHere(withHost.env, withHost.repo, HEAD);
    expect(
      await runHook(
        mergeGuardHook,
        input(withHost.repo, "gh pr --repo=github.com/example-org/app merge 7"),
        withHost.env,
      ),
    ).toEqual({});
    expect(ghCalls(withHost.gh)).toEqual([
      "pr view 7 --repo github.com/example-org/app --json number,baseRefName,headRefOid",
      "repo view github.com/example-org/app --json defaultBranchRef",
      "pr checks 7 --required --repo github.com/example-org/app --json name,bucket",
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
      stdout: willNotMerge("this pull request", OFF_IN_PROJECT),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("no workflow at all: autoMerge is off by default", async () => {
    const { env, repo } = ready({
      requires: ">=0.4",
      worktrees: { base: "dev" },
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge("this pull request", OFF_BY_DEFAULT),
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
      { ...CONFIG, worktrees: { base: "main" } },
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
      worktrees: { base: "dev", bases: { "release/": "dev" } },
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
        "the head commit aaaaaaa has no recorded review (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)",
      ),
    });
  });

  test("another commit's record is not this one's", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, "b".repeat(40));
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "the head commit aaaaaaa has no recorded review (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)",
      ),
    });
  });

  test("an armed merge (--auto) is judged the same way", async () => {
    const { env, repo } = ready({ ...CONFIG, workflow: { autoMerge: false } });
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge --auto 7"), env)).toEqual({
      stdout: willNotMerge("this pull request", OFF_IN_PROJECT),
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

  test.each([
    "gh api repos/example-org/app/pulls/7",
    "gh api graphql -f query='{ viewer { login } }'",
    "gh pr -R example-org/app view 7",
    "gh alias list",
  ])("%j: silent, and gh is not called", async (command) => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("a merge that names another repository asks, whatever the policy says", () => {
  test("a --repo that is not this project's own: asks, and reads nothing with gh", async () => {
    const { env, gh, repo } = ready(CONFIG, undefined, false, true);
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge -R example-org/other 7"), env),
    ).toEqual({
      stdout: willNotMerge(
        "#7",
        "the command names the repository example-org/other, and the autoMerge policy covers only this project's own repository (example-org/app)",
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("with no origin remote to compare against: asks, and says so", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge --repo example-org/app 7"), env),
    ).toEqual({
      stdout: willNotMerge(
        "#7",
        "the command names the repository example-org/app, and cc-smart-dev-kit could not read this project's own (`git remote get-url origin`), so it cannot tell whether they are the same one",
      ),
    });
  });
});

describe("every merge in the command is judged", () => {
  test("the first is allowed, the second refused: asks, naming the second", async () => {
    const { env, gh, repo } = ready(CONFIG, {
      "view-5": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 5 }),
      "view-6": JSON.stringify({ baseRefName: "feature/x", headRefOid: HEAD, number: 6 }),
    });
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge 5 && gh pr merge 6"), env),
    ).toEqual({
      stdout: willNotMerge(
        "#6",
        "the pull request's base is feature/x, not the project's integration base dev",
      ),
    });
    // #5 was judged whole (the default branch is read once: it is one repository), then #6
    // was read and refused before its checks.
    expect(ghCalls(gh)).toEqual([
      "pr view 5 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 5 --required --json name,bucket",
      "pr view 6 --json number,baseRefName,headRefOid",
    ]);
  });

  test("both allowed: silent, and both were read", async () => {
    const { env, gh, repo } = ready(CONFIG, {
      "view-5": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 5 }),
      "view-6": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 6 }),
      "checks-5": JSON.stringify([{ bucket: "pass", name: "build" }]),
      "checks-6": JSON.stringify([{ bucket: "pass", name: "build" }]),
    });
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge 5 && gh pr merge 6"), env),
    ).toEqual({});
    expect(ghCalls(gh)).toEqual([
      "pr view 5 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 5 --required --json name,bucket",
      "pr view 6 --json number,baseRefName,headRefOid",
      "pr checks 6 --required --json name,bucket",
    ]);
  });

  test("the first refused, the second allowed: asks, naming the first", async () => {
    const { env, repo } = ready(CONFIG, {
      "view-5": JSON.stringify({ baseRefName: "feature/x", headRefOid: HEAD, number: 5 }),
      "view-6": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 6 }),
    });
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge 6 || gh pr merge 5"), env),
    ).toEqual({
      stdout: willNotMerge(
        "#5",
        "the pull request's base is feature/x, not the project's integration base dev",
      ),
    });
  });
});

describe("a gh api merge is never judged: it asks with the reason", () => {
  test.each([
    "gh api -X PUT repos/example-org/app/pulls/7/merge",
    "gh api --method=PUT repos/example-org/app/pulls/7/merge",
    "gh api -XPUT repos/example-org/app/pulls/7/merge",
    "gh api repos/example-org/app/pulls/7/merge -X PUT",
    "gh api -X PUT https://api.github.com/repos/example-org/app/pulls/7/merge",
  ])("%j: asks, and reads nothing with gh", async (command) => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: willNotMerge("#7", "it merges with `gh api`, a form this guard does not judge"),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a quoted path with gh's own placeholders: asks, and names the pull request it can", async () => {
    const { env, repo } = ready();
    expect(
      await runHook(
        mergeGuardHook,
        input(repo, 'gh api -X PUT "repos/{owner}/{repo}/pulls/7/merge"'),
        env,
      ),
    ).toEqual({
      stdout: willNotMerge("#7", "it merges with `gh api`, a form this guard does not judge"),
    });
  });

  test("an UNQUOTED path with placeholders in Bash: one word, so it names the pull request", async () => {
    // In bash a brace groups commands only as a word of its own: `repos/{owner}/…` is one word.
    const { env, repo } = ready();
    expect(
      await runHook(
        mergeGuardHook,
        input(repo, "gh api -X PUT repos/{owner}/{repo}/pulls/7/merge"),
        env,
      ),
    ).toEqual({
      stdout: willNotMerge("#7", "it merges with `gh api`, a form this guard does not judge"),
    });
  });

  test("an UNQUOTED path with placeholders in PowerShell: cut short, so it asks", async () => {
    // In PowerShell every brace ends a command (a script block), so `repos/{owner}/…` reaches
    // the guard as `repos/`: a path it cannot read must ask.
    const { env, repo } = ready();
    expect(
      await runHook(
        mergeGuardHook,
        input(repo, "gh api -X PUT repos/{owner}/{repo}/pulls/7/merge", "PowerShell"),
        env,
      ),
    ).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "the `gh api` path is cut short (gh's `{owner}`-style placeholders are read as parts of the command line), so this guard cannot tell which API path it reaches",
      ),
    });
  });

  test.each([
    [
      "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
      "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge",
    ],
    [
      "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
      "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge",
    ],
    [
      "gh api graphql -F query=@merge.graphql",
      "the GraphQL query is read from a file or built by the shell, so this guard cannot read it",
    ],
    [
      'gh api graphql -f query="$(cat merge.graphql)"',
      "the GraphQL query is read from a file or built by the shell, so this guard cannot read it",
    ],
    [
      "gh api graphql --input body.json",
      "the GraphQL request is read from a file or standard input, so this guard cannot read the query",
    ],
  ])("%j: asks", async (command, reason) => {
    const { env, gh, repo } = ready();
    // A GraphQL merge names no pull request this could look up: the question says "this one".
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: willNotMerge("this pull request", reason),
    });
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("a gh alias is judged like what it expands to", () => {
  const ALIASES = "co: pr checkout\nm: pr merge\n";

  test("an alias for `pr merge`: judged like `gh pr merge`", async () => {
    const { env, gh, repo } = ready(CONFIG, { "alias list": ALIASES });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh m 7"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([
      "alias list",
      "pr view 7 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 7 --required --json name,bucket",
    ]);
  });

  test("an alias for a `gh api` merge: asks with the api reason", async () => {
    const { env, repo } = ready(CONFIG, {
      "alias list": "a: api -X PUT repos/example-org/app/pulls/7/merge\n",
    });
    expect(await runHook(mergeGuardHook, input(repo, "gh a"), env)).toEqual({
      stdout: willNotMerge("#7", "it merges with `gh api`, a form this guard does not judge"),
    });
  });

  test("a shell alias: asks, because only the shell can read what it runs", async () => {
    const { env, gh, repo } = ready(CONFIG, { "alias list": "m: '!gh pr merge 7'\n" });
    expect(await runHook(mergeGuardHook, input(repo, "gh m 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "`gh m` is a shell alias, so what it runs cannot be read",
      ),
    });
    expect(ghCalls(gh)).toEqual(["alias list"]);
  });

  test("an alias that merges nothing: silent", async () => {
    const { env, gh, repo } = ready(CONFIG, { "alias list": ALIASES });
    expect(await runHook(mergeGuardHook, input(repo, "gh xz 7"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual(["alias list"]);
  });

  test("a built-in gh command is never looked up in the aliases", async () => {
    // `co` is gh's own alias for `pr checkout` (gh 2.102.0): a command, not the person's.
    const { env, gh, repo } = ready(CONFIG, { "alias list": ALIASES });
    expect(await runHook(mergeGuardHook, input(repo, "gh co 7"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a word that is neither a gh command nor an alias, its words saying merge: asks", async () => {
    const { env, repo } = ready(CONFIG, { "alias list": ALIASES });
    expect(await runHook(mergeGuardHook, input(repo, "gh dash merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "`gh dash` is no gh command or alias, and its words name a merge, which this guard does not judge",
      ),
    });
  });

  test("the same word with nothing about a merge: silent (an extension is left alone)", async () => {
    const { env, gh, repo } = ready(CONFIG, { "alias list": ALIASES });
    expect(await runHook(mergeGuardHook, input(repo, "gh dash list"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual(["alias list"]);
  });

  test("an alias list gh cannot list: asks, because gh <word> may merge", async () => {
    // The fake has no `alias list` answer at all: gh exits 1, as a broken gh does.
    const { env, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, "gh m 7"), env)).toEqual({
      stdout: couldNotCheck("gh could not read its aliases"),
    });
  });

  test("no aliases configured at all: an empty list, not a failure", async () => {
    const { env, gh, repo } = ready();
    writeFileSync(join(gh, "alias list.err"), "no aliases configured\n");
    expect(await runHook(mergeGuardHook, input(repo, "gh dash list"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual(["alias list"]);
  });
});

describe("a merge whose checkout, branch or repository is not certain", () => {
  test.each([
    [
      "cd ../other && gh pr merge 7",
      "an earlier `cd` in the same command changes the folder it runs in",
    ],
    [
      "pushd ../other && gh pr merge 7",
      "an earlier `pushd` in the same command changes the folder it runs in",
    ],
    [
      "git -C ../other status && gh pr merge 7",
      "an earlier `git -C` in the same command runs in another folder",
    ],
    [
      "git switch feature && gh pr merge 7",
      "an earlier `git switch` in the same command may change the branch it merges from",
    ],
    [
      "git checkout feature && gh pr merge 7",
      "an earlier `git checkout` in the same command may change the branch it merges from",
    ],
    // The merge's own prefix sets it: the same rule, worded as an earlier step (every word
    // of every step is looked at, the merge's own included).
    [
      "GH_REPO=example-org/other gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "env -i gh pr merge 7",
      "the merge runs through `env`, so which environment gh sees is not certain",
    ],
    [
      'bash -c "cd ../other && gh pr merge 7"',
      "an earlier `cd` in the same command changes the folder it runs in",
    ],
  ])("%j: asks, and reads nothing with gh", async (command, reason) => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: willNotMerge("#7", reason),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a cd AFTER the merge changes nothing: the merge still runs in this checkout", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7 && cd ../other"), env)).toEqual(
      {},
    );
  });
});

describe("gh's own flags before the command word", () => {
  test("`gh -R <own repo> pr merge 7`: the same repository, judged", async () => {
    // Live on gh 2.102.0: `gh -R owner/repo pr list …` exits 0 — cobra strips the flag to find
    // the subcommand, which then parses it.
    const { env, gh, repo } = ready(CONFIG, undefined, false, true);
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh -R Example-Org/App pr merge 7"), env),
    ).toEqual({});
    expect(ghCalls(gh)).toEqual([
      "pr view 7 --repo Example-Org/App --json number,baseRefName,headRefOid",
      "repo view Example-Org/App --json defaultBranchRef",
      "pr checks 7 --required --repo Example-Org/App --json name,bucket",
    ]);
  });

  test.each([
    ["gh -R example-org/other pr merge 7", "example-org/other"],
    ["gh --repo=example-org/other pr merge 7", "example-org/other"],
    ["gh --repo example-org/other pr merge 7", "example-org/other"],
    ["gh -Rexample-org/other pr merge 7", "example-org/other"],
  ])("%j: another repository asks, and reads nothing", async (command, named) => {
    const { env, gh, repo } = ready(CONFIG, undefined, false, true);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        `the command names the repository ${named}, and the autoMerge policy covers only this project's own repository (example-org/app)`,
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("an unknown flag before the command, then a merge: asks", async () => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, "gh --admin=true pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "the command carries `--admin=true` before the gh command, which this guard does not know",
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("the same flag, and no merge after it: silent (nothing to judge)", async () => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, "gh --admin=true pr list"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("an earlier step that moves what gh works on", () => {
  test.each([
    [
      "export GH_REPO=example-org/other && gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "GH_REPO=example-org/other; gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "export GH_HOST=ghe.example && gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "$env:GH_REPO='example-org/other'; gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "set GH_REPO=example-org/other && gh pr merge 7",
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
    [
      "gh pr checkout 7 && gh pr merge 7",
      "an earlier `gh pr checkout` in the same command changes the branch gh works on",
    ],
    [
      "gh co 7 && gh pr merge 7",
      "an earlier `gh co` in the same command changes the branch gh works on",
    ],
    [
      "gh repo set-default example-org/other && gh pr merge 7",
      "an earlier `gh repo set-default` in the same command changes the repository gh works on",
    ],
    [
      'bash -c "export GH_REPO=example-org/other && gh pr merge 7"',
      "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain",
    ],
  ])("%j: asks, and reads nothing with gh", async (command, reason) => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: willNotMerge("#7", reason),
    });
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("a merge run by another program", () => {
  test.each([
    ["sudo gh pr merge 7", "the merge runs under `sudo`, with another user's login and gh config"],
    [
      "sudo -u me gh pr merge 7",
      "the merge runs under `sudo`, with another user's login and gh config",
    ],
    [
      "doas -u me gh pr merge 7",
      "the merge runs under `doas`, with another user's login and gh config",
    ],
    [
      "su -c 'gh pr merge 7'",
      "the merge runs from `su`, whose command and environment come from outside the line",
    ],
    [
      "seq 7 8 | xargs -n1 gh pr merge",
      "the merge runs from `xargs`, whose arguments come from outside the line",
    ],
    [
      "xargs -I{} gh pr merge {}",
      "the merge runs from `xargs`, whose arguments come from outside the line",
    ],
    [
      "parallel gh pr merge ::: 7 8",
      "the merge runs from `parallel`, whose arguments come from outside the line",
    ],
    [
      "find . -name x -exec gh pr merge 7 \\;",
      "the merge runs from `find -exec`, once for each match",
    ],
    ["watch -n 5 gh pr merge 7", "the merge runs from `watch`, over and over"],
  ])("%j: asks, and reads nothing with gh", async (command, reason) => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    const result = await runHook(mergeGuardHook, input(repo, command), env);
    // The pull request it can name is the one the words hold; where the runner feeds the
    // arguments there is none ("this pull request").
    const said = JSON.parse(result.stdout ?? "{}").hookSpecificOutput
      .permissionDecisionReason as string;
    expect(said).toContain(reason);
    expect(said).toStartWith("cc-smart-dev-kit will not merge ");
    expect(ghCalls(gh)).toEqual([]);
  });

  test("`sudo -u me git push -f`: not a merge, and the git guard's business", async () => {
    const { env, gh, repo } = ready();
    expect(await runHook(mergeGuardHook, input(repo, "sudo -u me git push -f"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });

  test("in PowerShell, `xargs -I{}` is cut at its braces, and still asks", async () => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    const command = "xargs -I{} gh pr merge {}";
    const result = await runHook(mergeGuardHook, input(repo, command, "PowerShell"), env);
    const said = JSON.parse(result.stdout ?? "{}").hookSpecificOutput
      .permissionDecisionReason as string;
    expect(said).toContain(
      "an earlier `xargs` in the same command may feed the merge its arguments from outside the line",
    );
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("the merge reader's bypasses of the 0.6.0 audit: each spelling asks about --admin", () => {
  /** The reason the guard gives for `command` run by `tool`, or undefined when it is silent. */
  async function reason(command: string, tool = "Bash"): Promise<string | undefined> {
    const { env, repo } = ready();
    const result = await runHook(mergeGuardHook, input(repo, command, tool), env);
    return result.stdout === undefined
      ? undefined
      : (JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string);
  }

  test("HK-2: a merge inside an unquoted here-doc body is read", async () => {
    expect(await reason("cat <<EOF\n$(gh pr merge --admin 7)\nEOF")).toContain("--admin");
    expect(await reason("cat <<'EOF'\n$(gh pr merge --admin 7)\nEOF")).toBeUndefined();
  });

  test("HK-3: a PowerShell line is read with PowerShell's quoting", async () => {
    const paths = 'cd "C:\\a\\"; gh pr merge --admin 7; cd "C:\\b\\"';
    expect(await reason(paths, "PowerShell")).toContain("--admin");
    expect(await reason("<# x #> gh pr merge --admin 7", "PowerShell")).toContain("--admin");
  });

  test("HK-5: a line that ends in `\\` is read both joined and not", async () => {
    // In PowerShell, and at the end of a Windows path, the backslash joins nothing.
    const command = "cd C:\\repo\\\ngh pr merge --admin 7";
    expect(await reason(command, "PowerShell")).toContain("--admin");
    expect(await reason(command)).toContain("--admin");
  });

  test("HK hunch 6: the merge inside a queued `job run` line is read", async () => {
    const queued = `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind test -- bash -c 'bun test && gh pr merge --admin 7'`;
    expect(await reason(queued)).toContain("--admin");
  });
});

describe("the guard's own deadline", () => {
  test("no time left for the first call: asks in time, and runs nothing", async () => {
    // A test sets the budget (`GUARD_BUDGET_ENV`); a hook never does. Below the margin there
    // is no time for any call at all, so the guard must ask — never overrun the hook's 30 s.
    // The first read is the policy committed on the base (local git, before any gh call).
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    const result = await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), {
      ...env,
      [GUARD_BUDGET_ENV]: "1000",
    });
    expect(result).toEqual({
      stdout: ask(
        "cc-smart-dev-kit could not check this merge in time: reading the policy committed on dev would have taken longer than the guard's own budget allows. Approve the merge yourself if it is right.",
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a gh call that hangs: stopped at its own slice, and the merge asks", async () => {
    const { env, gh, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    // Every call hangs (`read` on /dev/zero never returns). The budget leaves the first call
    // about a third of a second, so the guard answers quickly instead of waiting 10 s a call.
    writeFileSync(join(gh, "slow"), "");
    const started = Date.now();
    const result = await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), {
      ...env,
      [GUARD_BUDGET_ENV]: "2400",
    });
    const took = Date.now() - started;
    expect(result.stdout).toContain(
      "cc-smart-dev-kit could not check this merge: gh could not read",
    );
    expect(took).toBeLessThan(4_000);
  });

  test("the same command inside the default budget: judged as always", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });
});

describe("a merge with --admin always asks, whatever the policy says", () => {
  /** What `gh pr view 5` and `gh pr view 6` answer: both go into the integration base. */
  const FIVE_AND_SIX = {
    "view-5": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 5 }),
    "view-6": JSON.stringify({ baseRefName: "dev", headRefOid: HEAD, number: 6 }),
  };

  /** The question an `--admin` merge gets, `which` naming its pull request as the command does. */
  function adminAsks(which: string): string {
    return willNotMerge(
      "this pull request",
      `the command merges ${which} with \`--admin\`, which uses administrator rights to merge past the repository's branch protection (its required reviews, a code-owner approval among them, its required checks and its merge queue), so you decide each one`,
    );
  }

  test("every auto-merge condition met: the same merge without --admin is silent, with it asks", async () => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX);
    recordReviewHere(env, repo, HEAD);
    // The control: this merge is one the policy allows by itself.
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 5 --merge"), env)).toEqual({});
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge 5 --merge --admin"), env),
    ).toEqual({ stdout: adminAsks("#5") });
    // Only the allowed merge read anything: the --admin one asked from the line alone.
    expect(ghCalls(gh)).toEqual([
      "pr view 5 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 5 --required --json name,bucket",
    ]);
  });

  test.each([
    ["gh pr merge 5 --merge --admin=true", "#5"],
    ["gh pr merge 5 --admin=false", "#5"],
    ["gh pr merge --admin 5 --squash", "#5"],
    ["gh pr merge --admin", "the current branch's pull request"],
    ["gh pr merge fix/login --admin", "`fix/login`"],
    [
      "gh pr merge https://github.com/example-org/app/pull/5 --admin",
      "`https://github.com/example-org/app/pull/5`",
    ],
    ["gh pr merge 5 --body 'ship it' --admin", "#5"],
    ["gh pr merge --auto --admin 5", "#5"],
    ["bash -c 'gh pr merge 5 --admin'", "#5"],
    ["timeout 60 gh pr merge 5 --admin", "#5"],
  ])("%j: asks, naming %s, and reads nothing with gh", async (command, which) => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({
      stdout: adminAsks(which),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("this project's own repository named with -R before the command: still asks", async () => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX, false, true);
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh -R Example-Org/App pr merge 5 --admin"), env),
    ).toEqual({ stdout: adminAsks("#5") });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("two merges, only the second with --admin: asks, naming the second", async () => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX);
    recordReviewHere(env, repo, HEAD);
    expect(
      await runHook(mergeGuardHook, input(repo, "gh pr merge 5 && gh pr merge 6 --admin"), env),
    ).toEqual({ stdout: adminAsks("#6") });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("PowerShell: the same question", async () => {
    const { env, repo } = ready(CONFIG, FIVE_AND_SIX);
    recordReviewHere(env, repo, HEAD);
    const powershell = {
      ...input(repo, "gh.exe pr merge 5 --admin; Write-Output done"),
      tool_name: "PowerShell",
    };
    expect(await runHook(mergeGuardHook, powershell, env)).toEqual({ stdout: adminAsks("#5") });
  });

  test("an alias whose expansion carries --admin: asks once the alias is read", async () => {
    const { env, gh, repo } = ready(CONFIG, {
      ...FIVE_AND_SIX,
      "alias list": "ma: pr merge --admin\n",
    });
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh ma 5"), env)).toEqual({
      stdout: adminAsks("#5"),
    });
    expect(ghCalls(gh)).toEqual(["alias list"]);
  });

  test("autoMerge off: the question names --admin, not only the policy", async () => {
    const { env, gh, repo } = ready({ ...CONFIG, workflow: { autoMerge: false } }, FIVE_AND_SIX);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 5 --admin"), env)).toEqual({
      stdout: adminAsks("#5"),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("a project that never opted in: still silent (the plugin stays invisible)", async () => {
    const repo = makeRepo();
    const gh = fakeGh(answers(FIVE_AND_SIX));
    const env = envWithGh(gh);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 5 --admin"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });

  test.each([
    // A flag's value is never a flag: gh reads `--admin` here as the subject, as `-t`'s value
    // and after `--` as a word, so these are ordinary merges, judged as always.
    "gh pr merge 5 --subject --admin",
    "gh pr merge 5 -t --admin",
    "gh pr merge 5 --merge -- --admin",
    // The value-taking flag the parser already knew: its value is not the pull request.
    `gh pr merge 5 --match-head-commit ${HEAD} --merge`,
  ])("%j: no --admin, so judged as always: silent when allowed", async (command) => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([
      "pr view 5 --json number,baseRefName,headRefOid",
      "repo view --json defaultBranchRef",
      "pr checks 5 --required --json name,bucket",
    ]);
  });

  test.each([
    "gh pr view 5 --admin",
    "gh pr merge 5 --disable-auto --admin",
    'echo "gh pr merge 5 --admin"',
  ])("%j: no merge, so silent, and gh is not called", async (command) => {
    const { env, gh, repo } = ready(CONFIG, FIVE_AND_SIX);
    expect(await runHook(mergeGuardHook, input(repo, command), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });
});

describe("the review gate is read as committed on the pull request's base (CM-1)", () => {
  /** A worktree of `repo` whose own copy of the project's file says `config`, uncommitted. */
  function worktreeSaying(repo: string, config: unknown): string {
    const worktree = join(repo, "..", "app-wt-session");
    git(repo, "worktree", "add", "-q", "-b", "session-branch", worktree);
    writeClaudeFile(worktree, "cc-smart-dev-kit.json", config);
    return worktree;
  }

  /** The reason the guard asked with, or null when it was silent. */
  async function reasonFor(env: Record<string, string>, cwd: string): Promise<string | null> {
    const result = await runHook(mergeGuardHook, input(cwd, "gh pr merge 7"), env);
    if (result.stdout === undefined) return null;
    return JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
  }

  const NO_REVIEW =
    "the head commit aaaaaaa has no recorded review (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)";

  test("CM-1: a worktree's own uncommitted config cannot switch the review gate off", async () => {
    const { env, repo } = ready();
    const worktree = worktreeSaying(repo, {
      ...CONFIG,
      workflow: { autoMerge: true, reviewBeforePush: false },
    });
    expect(await runHook(mergeGuardHook, input(worktree, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge("#7", NO_REVIEW),
    });
  });

  test("CM-1: a worktree's own uncommitted autoMerge does not turn the gate on", async () => {
    const { env, gh, repo } = ready({ ...CONFIG, workflow: { autoMerge: false } });
    recordReviewHere(env, repo, HEAD);
    const worktree = worktreeSaying(repo, CONFIG);
    expect(await runHook(mergeGuardHook, input(worktree, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge("this pull request", OFF_IN_PROJECT),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("CM-1: a worktree's own reviewAgents cannot make another agent's record count", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD, "general-purpose");
    const worktree = worktreeSaying(repo, {
      ...CONFIG,
      workflow: { autoMerge: true, reviewAgents: ["general-purpose"] },
    });
    expect(await runHook(mergeGuardHook, input(worktree, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge("#7", NO_REVIEW),
    });
  });

  test("CM-1: an uncommitted change in the main checkout itself counts for nothing either", async () => {
    const { env, repo } = ready();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...CONFIG,
      workflow: { autoMerge: true, reviewBeforePush: false },
    });
    expect(await reasonFor(env, repo)).toBe(
      `cc-smart-dev-kit will not merge #7 by itself: ${NO_REVIEW}. Approve the merge yourself if you meant it.`,
    );
  });

  test("CM-1: the committed reviewAgents decides whose record counts", async () => {
    const { env, repo } = ready({
      ...CONFIG,
      workflow: { autoMerge: true, reviewAgents: ["fresh-eyes"] },
    });
    recordReviewHere(env, repo, HEAD, "fresh-eyes");
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });

  test("HK-6: another plugin's reviewer recorded the commit: asks", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD, "other-plugin:reviewer");
    expect(await reasonFor(env, repo)).toContain("has no recorded review");
  });

  test("CM-1: a record the person made by hand counts whatever the list", async () => {
    const { env, repo } = ready();
    recordReviewHere(env, repo, HEAD, "workflow review-done");
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });

  test("CM-1: a policy change counts once it is committed on the base", async () => {
    const { env, repo } = ready();
    commitConfig(repo, { ...CONFIG, workflow: { autoMerge: true, reviewBeforePush: false } }, [
      "dev",
    ]);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
  });

  test("CM-1: no origin/<base> to read the policy from: asks, naming it, and reads nothing with gh", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const gh = fakeGh(answers());
    const env = envWithGh(gh);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "the merge policy committed on dev cannot be read: origin/dev is not known in this repository (no origin, or the branch was never fetched); a policy counts once it is committed, pushed and fetched",
      ),
    });
    expect(ghCalls(gh)).toEqual([]);
  });

  test("CM-1: a base with no committed project file: asks", async () => {
    const repo = makeRepo();
    git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    const gh = fakeGh(answers());
    const env = envWithGh(gh);
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "this pull request",
        "the merge policy committed on dev cannot be read: origin/dev has no .claude/cc-smart-dev-kit.json committed; a policy counts once it is committed, pushed and fetched",
      ),
    });
  });

  test("CM-1: a committed file that needs a newer plugin: asks, naming it", async () => {
    const { env, repo } = ready({ ...CONFIG, requires: ">=99" });
    // The working copy is usable; only the committed one is too new.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await reasonFor(env, repo)).toStartWith(
      "cc-smart-dev-kit will not merge this pull request by itself: the merge policy committed on dev cannot be read: origin/dev:.claude/cc-smart-dev-kit.json: this project needs cc-smart-dev-kit >=99",
    );
  });

  test("D20: a committed base file that still holds a retired engine field: asks, naming the field", async () => {
    const { env, repo } = ready({ ...CONFIG, worktrees: { base: "dev", prefix: "app-wt-" } });
    // The working copy is clean; only the committed policy still holds the field.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await reasonFor(env, repo)).toStartWith(
      "cc-smart-dev-kit will not merge this pull request by itself: the merge policy committed on dev cannot be read: Invalid origin/dev:.claude/cc-smart-dev-kit.json: worktrees.prefix is no longer supported: remove it — Claude Code's own worktrees need none. `cc-smart-dev-kit project init` removes it (README § Worktrees).",
    );
  });

  test("CM-1: the pull request's own base is read: a base whose committed file is missing asks", async () => {
    const { env, repo } = ready(CONFIG, {
      view: JSON.stringify({ baseRefName: "feature/x", headRefOid: HEAD, number: 7 }),
    });
    // feature/x has a ref, but at the first commit, before the project's file.
    git(repo, "update-ref", "refs/remotes/origin/feature/x", "HEAD~1");
    recordReviewHere(env, repo, HEAD);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({
      stdout: willNotMerge(
        "#7",
        "the merge policy committed on feature/x cannot be read: origin/feature/x has no .claude/cc-smart-dev-kit.json committed; a policy counts once it is committed, pushed and fetched",
      ),
    });
  });

  test("CM-1: the base's committed file lists merge-guard in ownHooks: the project's copy answers", async () => {
    const { env, gh, repo } = ready({ ...CONFIG, ownHooks: ["merge-guard"] });
    // The working copy does not list it: the committed policy decides.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", CONFIG);
    expect(await runHook(mergeGuardHook, input(repo, "gh pr merge 7"), env)).toEqual({});
    expect(ghCalls(gh)).toEqual([]);
  });
});
