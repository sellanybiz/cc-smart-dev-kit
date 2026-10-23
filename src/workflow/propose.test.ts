/**
 * `cc-smart-dev-kit workflow propose`: one workflow setting of a project, changed through a
 * pull request — a branch and a worktree cut from `origin/<base>`, the same writer `workflow
 * set --project` uses, a commit, a push and `gh pr create`.
 *
 * Every case runs in a temp repo with a bare "origin" and a fake `gh` first on `PATH`: never a
 * real remote, never the person's GitHub account. The branch name carries a fixed day, from the
 * context's clock, so each test's expected name is written by hand.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { makeClone, writeClaudeFile } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { runWorkflow, type WorkflowContext } from "./commands";
import { ghLoginState } from "./propose";

// The flow starts git and gh children: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const SETTINGS = {
  requires: ">=0.1",
  worktrees: { base: "main" },
  protectedBranches: ["main"],
};

/** The day every branch name here carries: the clock the context gives. */
const NOW = Date.parse("2026-10-23T09:00:00Z");

interface World {
  /** The bin folder that is the whole `PATH`: a fake `gh`, and a link to the real git. */
  bin: string;
  /** The fake `gh`'s log: one line of arguments per call. */
  ghLog: () => string[];
  origin: string;
  repo: string;
  run: (
    args: string[],
    env?: Record<string, string>,
  ) => Promise<{
    errors: string[];
    lines: string[];
    status: number;
  }>;
}

/**
 * A project with `.claude/cc-smart-dev-kit.json` committed and pushed, a bare origin, and a
 * fake `gh` in a bin folder that is the whole `PATH` (with a link to the real git): a test's
 * `gh` answer is `mode`, and nothing of the host's is reached. `file: "local"` leaves the
 * project's file in the checkout only, never committed or pushed.
 */
function world(
  options: { file?: "committed" | "local"; gh?: "create-fails" | "in" | "missing" | "out" } = {},
): World {
  const { origin, repo } = makeClone("app");
  if ((options.file ?? "committed") === "committed") {
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    git(repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(repo, "commit", "-q", "-m", "the project's file");
    git(repo, "push", "-q", "origin", "main");
  } else {
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
  }

  const bin = join(tempDir("propose-bin"), "bin");
  mkdirSync(bin);
  symlinkSync(Bun.which("git") ?? "/usr/bin/git", join(bin, "git"));
  const ghLog = join(bin, "gh.log");
  writeFileSync(ghLog, "");
  // `ghMissing` asks whether gh is on PATH at all: the "missing" world has no gh in its bin.
  if (options.gh !== "missing") {
    const answers =
      options.gh === "out"
        ? 'echo "not logged in" >&2\nexit 1'
        : `case "$1" in
  repo) echo "example-org/app"; exit 0 ;;
  pr)
    ${options.gh === "create-fails" ? 'echo "a pull request already exists for this branch" >&2; exit 1' : 'echo "https://github.com/example-org/app/pull/42"; exit 0'} ;;
esac
exit 0`;
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh
echo "---CALL---" >> ${JSON.stringify(ghLog)}
echo "$@" >> ${JSON.stringify(ghLog)}
${answers}
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
  }

  const home = tempDir("propose-home");
  const env: Record<string, string> = {
    ...cleanGitEnv(),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    HOME: home,
    PATH: bin,
  };
  const paths = cliPaths(env);
  return {
    bin,
    // One text per `gh` call: a call's arguments, which may run over several lines (a body).
    ghLog: () =>
      readFileSync(ghLog, "utf8")
        .split("---CALL---")
        .map((call) => call.trim())
        .filter((call) => call !== ""),
    origin,
    repo,
    run: async (args, over = {}) => {
      const lines: string[] = [];
      const errors: string[] = [];
      const context: WorkflowContext = {
        cwd: repo,
        env: { ...env, ...over },
        now: () => NOW,
        paths,
        print: (line) => lines.push(line),
        error: (line) => errors.push(line),
      };
      return { errors, lines, status: await runWorkflow(args, context) };
    },
  };
}

/** The branches this repository has locally, the given pattern's. */
function branchesIn(repo: string, pattern: string): string[] {
  return git(repo, "branch", "--list", "--format=%(refname:short)", pattern)
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

/** The file `branch` holds, parsed. */
function fileOn(repo: string, branch: string): Record<string, unknown> {
  return JSON.parse(git(repo, "show", `${branch}:.claude/cc-smart-dev-kit.json`)) as Record<
    string,
    unknown
  >;
}

describe("workflow propose: one setting through a pull request", () => {
  test("a change: a branch and worktree from origin/main, the file written, committed and pushed, the pull request opened", async () => {
    const w = world();
    const run = await w.run(["propose", "autoCommit", "true"]);

    const branch = "worktree-workflow-autoCommit-20261023";
    expect(run.status).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      `+ autoCommit = true in .claude/cc-smart-dev-kit.json`,
      `+ ${branch} (.claude/worktrees/${branch}), cut from origin/main and pushed`,
      "+ pull request into main: https://github.com/example-org/app/pull/42",
    ]);
    // The branch holds the change; the person's own checkout does not (D57).
    expect(fileOn(w.repo, branch).workflow).toEqual({ autoCommit: true });
    expect(fileOn(w.repo, "main").workflow).toBeUndefined();
    expect(JSON.parse(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8"))).toEqual(
      SETTINGS,
    );
    // The push landed on origin, and gh was asked for the pull request into the base.
    expect(git(w.origin, "branch", "--list", branch)).toContain(branch);
    expect(w.ghLog()).toEqual([
      "repo view --json nameWithOwner --jq .nameWithOwner",
      `pr create --base main --head ${branch} --title workflow: autoCommit false → true --body Updated by \`${COMMAND} workflow propose\`: the project's workflow setting autoCommit, from false to true.
It counts once this pull request is merged into main: the merge guard reads the review gate from the file committed on the base, and a session's own checkout never counts.`,
    ]);
    // The commit is the person's, with a message naming the setting and both values.
    expect(git(w.repo, "log", "-1", "--format=%s", branch).trim()).toBe(
      "workflow: autoCommit false → true",
    );
    // Nothing was left in the main checkout, and no worktree of the change is still registered.
    expect(git(w.repo, "status", "--porcelain").trim()).not.toContain("cc-smart-dev-kit.json");
    expect(git(w.repo, "worktree", "list", "--porcelain")).toContain(branch);
  });

  test("--unset removes the project's value, and the branch carries the file without it", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { autoCommit: true },
    });
    git(w.repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "autoCommit on");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "autoCommit", "--unset"]);
    const branch = "worktree-workflow-autoCommit-20261023";
    expect(run.status).toBe(0);
    expect(run.lines[0]).toBe("+ autoCommit = (unset) in .claude/cc-smart-dev-kit.json");
    expect(fileOn(w.repo, branch).workflow).toBeUndefined();
  });

  test("--json answers the pull request in one line", async () => {
    const w = world();
    const run = await w.run(["propose", "openPr", "draft", "--json"]);
    const branch = "worktree-workflow-openPr-20261023";
    expect(run.status).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(JSON.parse(run.lines[0] ?? "")).toEqual({
      branch,
      from: "off",
      setting: "openPr",
      to: "draft",
      url: "https://github.com/example-org/app/pull/42",
      worktree: join(w.repo, ".claude/worktrees", branch),
    });
  });

  test("a project with no file: refused, project init first, nothing made", async () => {
    const w = world();
    rmSync(join(w.repo, ".claude/cc-smart-dev-kit.json"));
    git(w.repo, "add", "-A");
    git(w.repo, "commit", "-q", "-m", "no file");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `${w.repo} has no .claude/cc-smart-dev-kit.json: run \`${COMMAND} project init\` there first.`,
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("a crew session never pushes or opens a pull request: refused, with the step it has", async () => {
    const w = world();
    const run = await w.run(["propose", "autoCommit", "true"], {
      CC_SMART_DEV_KIT_CREW: "P1a-x-1a2b3c",
    });
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      `cc-smart-dev-kit workflow propose cannot run in a crew session: it pushes a branch and opens a pull request, and a crew session never pushes (D24). Nobody is at the machine to answer this question, so the call is refused. Ask your lead with \`${COMMAND} crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\`, and go on with the rest of your phase.`,
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(w.ghLog()).toEqual([]);
  });

  test("a switch that lives in the person's own file: the writer refuses, and nothing is left", async () => {
    const w = world();
    const run = await w.run(["propose", "switches.statusLine", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "switches.statusLine is your own setting, not the project's: run it without --project (the status line is per person, per machine); the worktree and the branch were removed again; nothing was left behind",
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("a value only this checkout sets is not 'already set': the change goes to the base", async () => {
    // The working copy holds autoCommit true and was never committed: the base does not have it,
    // so the proposal is real, and the person's own uncommitted file is left as it was.
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { autoCommit: true },
    });

    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[0]).toBe("+ autoCommit = true in .claude/cc-smart-dev-kit.json");
    expect(fileOn(w.repo, "worktree-workflow-autoCommit-20261023").workflow).toEqual({
      autoCommit: true,
    });
    // The person's checkout still holds its own uncommitted file, untouched.
    expect(JSON.parse(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8"))).toEqual(
      { ...SETTINGS, workflow: { autoCommit: true } },
    );
    expect(git(w.repo, "status", "--porcelain").trim()).toContain("cc-smart-dev-kit.json");
  });

  test("a value already set in the project: said, and no branch or pull request", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { autoCommit: true },
    });
    git(w.repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "autoCommit on");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      "= autoCommit = true in .claude/cc-smart-dev-kit.json (already set); no branch or pull request was made.",
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(w.ghLog()).toEqual([]);
  });

  test("--unset of a value the project does not set: said, and nothing made", async () => {
    const w = world();
    const run = await w.run(["propose", "autoCommit", "--unset"]);
    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      "= autoCommit was not set in .claude/cc-smart-dev-kit.json; no branch or pull request was made.",
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("a key that needs a newer plugin raises requires in the same commit", async () => {
    const w = world();
    const run = await w.run(["propose", "crew.perLead", "5"]);
    expect(run.status).toBe(0);
    const file = fileOn(w.repo, "worktree-workflow-crew-perLead-20261023");
    expect(file.requires).toBe(">=1.1");
    expect(file.workflow).toEqual({ crew: { perLead: 5 } });
  });

  test("a branch name already taken: the next free name is used", async () => {
    const w = world();
    git(w.repo, "branch", "worktree-workflow-autoCommit-20261023");
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(
      "+ worktree-workflow-autoCommit-20261023-2 (.claude/worktrees/worktree-workflow-autoCommit-20261023-2), cut from origin/main and pushed",
    );
  });

  test("no gh: refused with the fix, and nothing made", async () => {
    const w = world({ gh: "missing" });
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      `gh is not installed, so no pull request can be opened: install GitHub's CLI from https://cli.github.com, then run \`gh auth login\`.`,
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("gh that cannot read this repository: refused with the fix, and nothing made", async () => {
    const w = world({ gh: "out" });
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "gh cannot read this repository on GitHub (it is not logged in, there is no network, or origin is not a GitHub repository): run `gh auth status` to see which, then try again.",
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("a push the remote refuses: refused with the fix, the worktree and branch removed", async () => {
    const w = world();
    mkdirSync(join(w.origin, "hooks"), { recursive: true });
    writeFileSync(
      join(w.origin, "hooks", "pre-receive"),
      "#!/bin/sh\necho 'this repository is read-only' >&2\nexit 1\n",
    );
    chmodSync(join(w.origin, "hooks", "pre-receive"), 0o755);

    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain(
      "git push -u origin worktree-workflow-autoCommit-20261023 failed:",
    );
    expect(run.errors[0]).toContain(
      "the worktree and the branch were removed again; nothing was left behind",
    );
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(
      existsSync(join(w.repo, ".claude/worktrees/worktree-workflow-autoCommit-20261023")),
    ).toBe(false);
  });

  test("a base that cannot be fetched: refused with the fix, and nothing made", async () => {
    const w = world();
    git(w.repo, "remote", "set-url", "origin", join(w.repo, "gone"));
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain("git fetch origin main failed:");
    expect(run.errors[0]).toContain("Check the network and that origin has main, then try again.");
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("gh cannot open the pull request: the push is taken back too", async () => {
    const w = world({ gh: "create-fails" });
    const run = await w.run(["propose", "autoCommit", "true"]);
    const branch = "worktree-workflow-autoCommit-20261023";
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain(
      "gh pr create failed: a pull request already exists for this branch",
    );
    expect(run.errors[0]).toContain("nothing was left behind");
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(git(w.origin, "branch", "--list", branch).trim()).toBe("");
  });

  test("the base must carry the project's file: a checkout's own copy is not enough", async () => {
    // The file is in this checkout only, never committed or pushed: origin/main has none.
    const w = world({ file: "local" });

    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "origin/main has no .claude/cc-smart-dev-kit.json: commit the project's file to main and push it first — a change counts once it is merged.",
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("inside Claude Code a review-gate key is refused; outside it every key is allowed", async () => {
    const w = world();
    const refused = await w.run(["propose", "autoMerge", "true"], { CLAUDECODE: "1" });
    expect(refused.status).toBe(1);
    expect(refused.errors).toEqual([
      `cc-smart-dev-kit workflow propose autoMerge cannot run inside a Claude Code session: autoMerge is part of the merge guard's review gate, which only you change. Run it in your own terminal (\`${COMMAND} workflow propose autoMerge <value>\`): the pull request is the gate.`,
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);

    const allowed = await w.run(["propose", "autoMerge", "true"]);
    expect(allowed.status).toBe(0);
    expect(fileOn(w.repo, "worktree-workflow-autoMerge-20261023").workflow).toEqual({
      autoMerge: true,
    });
  });
});

describe("ghLoginState", () => {
  test("in, out, and missing: a word for each, never a throw", async () => {
    const inside = world();
    expect(await ghLoginState(inside.repo, { ...cleanGitEnv(), PATH: inside.bin })).toBe("in");

    const loggedOut = world({ gh: "out" });
    expect(await ghLoginState(loggedOut.repo, { ...cleanGitEnv(), PATH: loggedOut.bin })).toBe(
      "out",
    );

    const missing = world({ gh: "missing" });
    expect(await ghLoginState(missing.repo, { ...cleanGitEnv(), PATH: missing.bin })).toBe(
      "missing",
    );
  });
});
