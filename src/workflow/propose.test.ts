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
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { type CliPaths, cliPaths } from "../cli/paths";
import {
  hookEnv,
  makeClone,
  makeRepo,
  writeClaudeFile,
  writePersonalWorkflow,
} from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { runWorkflow, type WorkflowContext } from "./commands";
import { ghLoginState, proposeWorkflow } from "./propose";
import { isProjectKey, WORKFLOW_KEYS } from "./schema";
import { writeProjectSetting } from "./write";

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
  /** The environment every run gets: a temp HOME, and `bin` as the whole PATH. */
  env: Record<string, string>;
  /** The fake `gh`'s log: one line of arguments per call. */
  ghLog: () => string[];
  origin: string;
  paths: CliPaths;
  repo: string;
  /** One `workflow` run, in `repo` unless `cwd` says another folder. */
  run: (
    args: string[],
    env?: Record<string, string>,
    cwd?: string,
  ) => Promise<{
    errors: string[];
    lines: string[];
    status: number;
  }>;
}

/**
 * A `git` that does what another proposal would, once, just before `worktree add` runs — the
 * race the flow's name check cannot see: `branch` makes the branch the add is about to make,
 * `folder` makes the folder it is about to use. Everything else is the real git.
 */
function racingGit(real: string, bin: string, race: "branch" | "folder" | "old-branch"): string {
  const mark = join(bin, "raced");
  // `worktree add -b <branch> <path> <start>`: $4 is the branch, $5 the folder.
  if (race === "old-branch") {
    // Git before 2.35 says it with a capital, and the add is refused without making anything.
    return `#!/bin/sh
if [ "$1" = "worktree" ] && [ "$2" = "add" ] && [ ! -e "${mark}" ]; then
  touch "${mark}"
  "${real}" branch "$4" origin/main >/dev/null 2>&1
  echo "fatal: A branch named '$4' already exists." >&2
  exit 128
fi
exec "${real}" "$@"
`;
  }
  const act =
    race === "branch"
      ? `"${real}" branch "$4" origin/main >/dev/null 2>&1`
      : `mkdir -p "$5" && echo "another run's file" > "$5/file"`;
  return `#!/bin/sh
if [ "$1" = "worktree" ] && [ "$2" = "add" ] && [ ! -e "${mark}" ]; then
  touch "${mark}"
  ${act}
fi
exec "${real}" "$@"
`;
}

/**
 * A project with `.claude/cc-smart-dev-kit.json` committed and pushed, a bare origin, and a
 * fake `gh` in a bin folder that is the whole `PATH` (with a link to the real git): a test's
 * `gh` answer is `mode`, and nothing of the host's is reached. `file: "local"` leaves the
 * project's file in the checkout only, never committed or pushed.
 */
function world(
  options: {
    file?: "committed" | "local";
    gh?: "create-fails" | "create-hangs" | "create-no-url" | "in" | "missing" | "out";
    race?: "branch" | "folder" | "old-branch";
  } = {},
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
  // The fake scripts below use these three, and `bin` is the whole PATH: they are linked in.
  for (const tool of ["mkdir", "sleep", "touch"]) {
    const found = Bun.which(tool);
    if (found !== null) symlinkSync(found, join(bin, tool));
  }
  const realGit = Bun.which("git") ?? "/usr/bin/git";
  if (options.race === undefined) {
    symlinkSync(realGit, join(bin, "git"));
  } else {
    writeFileSync(join(bin, "git"), racingGit(realGit, bin, options.race));
    chmodSync(join(bin, "git"), 0o755);
  }
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
    ${prAnswer(options.gh)} ;;
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
    env,
    // One text per `gh` call: a call's arguments, which may run over several lines (a body).
    ghLog: () =>
      readFileSync(ghLog, "utf8")
        .split("---CALL---")
        .map((call) => call.trim())
        .filter((call) => call !== ""),
    origin,
    paths,
    repo,
    run: async (args, over = {}, cwd = repo) => {
      const lines: string[] = [];
      const errors: string[] = [];
      const context: WorkflowContext = {
        cwd,
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

/** What the fake `gh` does for `pr create`: it answers, is refused, or never answers in time. */
function prAnswer(mode: string | undefined): string {
  if (mode === "create-fails") {
    return 'echo "a pull request already exists for this branch" >&2; exit 1';
  }
  // `exec`: the sleep is the process the timeout ends, so no child holds the pipes open.
  if (mode === "create-hangs") return "exec sleep 5";
  // gh answers, but with no pull request URL in it.
  if (mode === "create-no-url") return "echo created; exit 0";
  return 'echo "https://github.com/example-org/app/pull/42"; exit 0';
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
      `+ ${branch} (.claude/worktrees/${branch.replace(/^worktree-/, "")}), cut from origin/main and pushed`,
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
      `pr create --base main --head ${branch} --title workflow: autoCommit (unset) → true --body Updated by \`${COMMAND} workflow propose\`: the project's workflow setting autoCommit, from (unset) to true.
It counts once this pull request is merged into main: the merge guard reads the review gate from the file committed on the base, and a session's own checkout never counts.`,
    ]);
    // The commit is the person's, with a message naming the setting and both values.
    expect(git(w.repo, "log", "-1", "--format=%s", branch).trim()).toBe(
      "workflow: autoCommit (unset) → true",
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
    expect(git(w.repo, "log", "-1", "--format=%s", branch).trim()).toBe(
      "workflow: autoCommit true → (unset)",
    );
  });

  test("--json answers the pull request in one line", async () => {
    const w = world();
    const run = await w.run(["propose", "openPr", "draft", "--json"]);
    const branch = "worktree-workflow-openPr-20261023";
    expect(run.status).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(JSON.parse(run.lines[0] ?? "")).toEqual({
      branch,
      from: null,
      setting: "openPr",
      to: "draft",
      url: "https://github.com/example-org/app/pull/42",
      worktree: join(w.repo, ".claude/worktrees", "workflow-openPr-20261023"),
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
      `cc-smart-dev-kit workflow propose cannot run in a crew session: it pushes a branch and opens a pull request, and a crew session never proposes a workflow change (D24). Nobody is at the machine to answer this question, so the call is refused. Ask your lead with \`${COMMAND} crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\`, and go on with the rest of your phase.`,
    ]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(w.ghLog()).toEqual([]);
  });

  test("a switch that lives in the person's own file is refused first: no fetch, no gh, no branch", async () => {
    const w = world();
    for (const argv of [
      ["propose", "crew.max", "4"],
      ["propose", "switches.statusLine", "true"],
      ["propose", "switches.updateHold", "--unset"],
    ]) {
      const run = await w.run(argv);
      const key = argv[1];
      expect(run.status).toBe(1);
      expect(run.errors).toEqual([
        `${key} is your own setting, not the project's, so there is nothing to propose: it is per person, per machine — change it with \`${COMMAND} workflow set ${key} <value>\`.`,
      ]);
    }
    expect(w.ghLog()).toEqual([]);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("isProjectKey is what the writer accepts: a key the project's file cannot hold is exactly one it refuses", () => {
    // One home for the rule (`schema.ts`), held equal to `write.ts` for every switch: the two
    // can never drift apart, or `propose` would refuse what `set --project` takes, or the
    // reverse.
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    for (const key of WORKFLOW_KEYS.filter((one) => one.startsWith("switches."))) {
      let refused = false;
      try {
        writeProjectSetting(repo, key, true, env);
      } catch (error) {
        refused =
          error instanceof Error && /is your own setting, not the project's/.test(error.message);
      }
      expect(refused).toBe(!isProjectKey(key));
    }
    expect(WORKFLOW_KEYS.filter((one) => !isProjectKey(one))).toEqual([
      "crew.max",
      "crew.maxOpus",
      "crew.memoryGb",
      "crew.loadPerCore",
      "crew.perLead",
      "crew.perLeadOpus",
      "crew.usagePercent",
      "switches.statusLine",
      "switches.updateHold",
    ]);
  });

  test("the person's own defaults never reach the pull request: a from is the project's value, or unset", async () => {
    const w = world();
    writePersonalWorkflow(w.env, { autoCommit: true });
    const run = await w.run(["propose", "autoCommit", "false"]);
    expect(run.status).toBe(0);
    expect(
      git(w.repo, "log", "-1", "--format=%s", "worktree-workflow-autoCommit-20261023").trim(),
    ).toBe("workflow: autoCommit (unset) → false");
    expect(w.ghLog()[1]).toContain("from (unset) to false");
    expect(w.ghLog()[1]).not.toContain("from true");
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
    const run = await w.run(["propose", "crew.handoffTokens", "500000"]);
    expect(run.status).toBe(0);
    const file = fileOn(w.repo, "worktree-workflow-crew-handoffTokens-20261023");
    expect(file.requires).toBe(">=1.2");
    expect(file.workflow).toEqual({ crew: { handoffTokens: 500000 } });
  });

  test("a branch name already taken: the next free name is used", async () => {
    const w = world();
    git(w.repo, "branch", "worktree-workflow-autoCommit-20261023");
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(
      "+ worktree-workflow-autoCommit-20261023-2 (.claude/worktrees/workflow-autoCommit-20261023-2), cut from origin/main and pushed",
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
    expect(existsSync(join(w.repo, ".claude/worktrees/workflow-autoCommit-20261023"))).toBe(false);
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

describe("workflow propose: names, folders and a gh that does not answer", () => {
  test("a name a teammate already pushed: the next free name, from origin", async () => {
    const w = world();
    // A teammate's proposal, pushed the same day under the name this run would pick.
    git(w.repo, "push", "-q", "origin", "main:refs/heads/worktree-workflow-autoCommit-20261023");
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(
      "+ worktree-workflow-autoCommit-20261023-2 (.claude/worktrees/workflow-autoCommit-20261023-2), cut from origin/main and pushed",
    );
  });

  test("a branch another proposal made between the check and the add: the next name, and that branch stays", async () => {
    const w = world({ race: "branch" });
    const other = "worktree-workflow-autoCommit-20261023";
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toContain(`${other}-2`);
    // The other run's branch is untouched: it still points where it did.
    expect(git(w.repo, "rev-parse", "--verify", other).trim()).toBe(
      git(w.repo, "rev-parse", "origin/main").trim(),
    );
  });

  test("a folder another proposal made between the check and the add: the branch this run made goes, and the folder stays", async () => {
    const w = world({ race: "folder" });
    const other = "worktree-workflow-autoCommit-20261023";
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toContain(`${other}-2`);
    // Git made this run's branch before it found the folder; it is taken back.
    expect(branchesIn(w.repo, other)).toEqual([]);
    // The folder is the other run's, and is never removed.
    expect(
      readFileSync(join(w.repo, ".claude/worktrees/workflow-autoCommit-20261023", "file"), "utf8"),
    ).toBe("another run's file\n");
  });

  test("older git's capitalised 'A branch named': the other run's branch is still left alone", async () => {
    const w = world({ race: "old-branch" });
    const other = "worktree-workflow-autoCommit-20261023";
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toContain(`${other}-2`);
    // The branch the other run made is untouched: it still points where it did.
    expect(git(w.repo, "rev-parse", "--verify", other).trim()).toBe(
      git(w.repo, "rev-parse", "origin/main").trim(),
    );
  });

  test("a gh that opens nothing it can name: refused, and the pushed branch is taken back too", async () => {
    const w = world({ gh: "create-no-url" });
    const branch = "worktree-workflow-autoCommit-20261023";
    const run = await w.run(["propose", "autoCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain(
      "gh pr create failed: gh printed no pull request URL (created)",
    );
    expect(run.errors[0]).toContain("nothing was left behind");
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
    expect(git(w.origin, "branch", "--list", branch).trim()).toBe("");
  });

  test("--folder is found from the folder the command runs in, and the person's checkout stays as it was", async () => {
    const w = world();
    const before = readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8");
    const elsewhere = join(tempDir("propose-elsewhere"), "project");
    symlinkSync(w.repo, elsewhere);
    const run = await w.run(
      ["propose", "autoCommit", "true", "--folder", "project"],
      {},
      dirname(elsewhere),
    );
    expect(run.status).toBe(0);
    expect(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8")).toBe(before);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([
      "worktree-workflow-autoCommit-20261023",
    ]);
  });

  test("gh pr create that does not answer in time: the branch and the possible pull request are left alone", async () => {
    const w = world({ gh: "create-hangs" });
    const branch = "worktree-workflow-autoCommit-20261023";
    const lines: string[] = [];
    const errors: string[] = [];
    const status = await proposeWorkflow(
      {
        createTimeoutMs: 300,
        env: w.env,
        folder: w.repo,
        now: () => NOW,
        paths: w.paths,
        print: (line) => lines.push(line),
        error: (line) => errors.push(line),
      },
      "autoCommit",
      true,
      { json: false },
    );
    expect(status).toBe(1);
    expect(errors[0]).toContain("gh pr create did not answer in time");
    expect(errors[0]).toContain(`the pull request may be open: look at ${w.repo}'s pull requests`);
    // Not taken back: GitHub may have made the pull request just before the call ended.
    expect(git(w.origin, "branch", "--list", branch)).toContain(branch);
    expect(git(w.repo, "worktree", "list", "--porcelain")).toContain(branch);
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
