/**
 * `cc-smart-dev-kit workflow propose`: one workflow setting of a project, changed through a
 * pull request — the base's file edited by the same step `workflow set --project` writes with,
 * a commit made by git plumbing on `origin/<base>` (no worktree, no project hook), a push to a
 * new branch and `gh pr create`.
 *
 * Every case runs in a temp repo with a bare "origin" and a fake `gh` first on `PATH`: never a
 * real remote, never the person's GitHub account. The branch name carries a fixed day, from the
 * context's clock, so each test's expected name is written by hand.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { type CliPaths, cliPaths } from "../cli/paths";
import { requiresFor } from "../project/init";
import { makeClone, writeClaudeFile, writePersonalWorkflow } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { runWorkflow, type WorkflowContext } from "./commands";
import {
  ghLoginState,
  MADE_WITHOUT_HOOKS,
  PROPOSE_WORST_CASE_MS,
  type ProposedJson,
  proposeTimeoutLine,
  proposeWorkflow,
} from "./propose";
import { editProjectSetting } from "./write";

// The flow starts git and gh children: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

/** The project's file: its `requires` is this build's, so no field a test sets raises it. */
const SETTINGS = {
  requires: requiresFor(VERSION),
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

/** What `racingGit` does to a push; everything else is the real git. */
type Race = "delete-lands" | "lands" | "taken" | "taken-twice";

/**
 * A `git` that does something to a push, and is the real git for everything else:
 * - `taken` (at the first push) and `taken-twice` (at the first two) push origin/main under the
 *   name the push is about to create, as another proposal would between the name check and the
 *   push;
 * - `lands` runs the first push and then exits 1, as a push whose ref landed and whose end failed;
 * - `delete-lands` does the same to every delete (`:<ref>`).
 */
function racingGit(real: string, bin: string, race: Race): string {
  const first = join(bin, "raced-1");
  const second = join(bin, "raced-2");
  // The push's last argument is `<sha>:refs/heads/<branch>`, or `:refs/heads/<branch>` to delete.
  const takeName = `"${real}" push -q origin "refs/remotes/origin/main:\${last#*:}" >/dev/null 2>&1`;
  const acts: Record<Race, string> = {
    "delete-lands": `case "$last" in :*) "${real}" "$@"; exit 1 ;; esac`,
    lands: `if [ ! -e "${first}" ]; then touch "${first}"; "${real}" "$@"; exit 1; fi`,
    taken: `if [ ! -e "${first}" ]; then touch "${first}"; ${takeName}; fi`,
    "taken-twice": `if [ ! -e "${second}" ]; then
    if [ -e "${first}" ]; then touch "${second}"; else touch "${first}"; fi
    ${takeName}
  fi`,
  };
  return `#!/bin/sh
for last in "$@"; do :; done
if [ "$1" = "push" ]; then
  ${acts[race]}
fi
exec "${real}" "$@"
`;
}

/** A hook of the project's own that always fails, as one that needs uninstalled packages does. */
function failingHook(repo: string, name: string): void {
  const file = join(repo, ".git", "hooks", name);
  writeFileSync(file, `#!/bin/sh\necho "lefthook: not found" >&2\nexit 127\n`);
  chmodSync(file, 0o755);
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
    gh?:
      | "create-fails"
      | "create-hangs"
      | "create-killed"
      | "create-no-url"
      | "in"
      | "missing"
      | "out";
    race?: Race;
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

/**
 * What the fake `gh` does for `pr create`: it answers, is refused, never answers in time, or is
 * killed by a signal before it answers.
 */
function prAnswer(mode: string | undefined): string {
  if (mode === "create-fails") {
    // Two lines: the refusal names only the last one.
    return 'echo "Warning: 1 uncommitted change" >&2; echo "a pull request already exists for this branch" >&2; exit 1';
  }
  // `exec`: the sleep is the process the timeout ends, so no child holds the pipes open.
  if (mode === "create-hangs") return "exec sleep 5";
  if (mode === "create-killed") return "kill -9 $$";
  // gh answers, but with no pull request URL in it.
  if (mode === "create-no-url") return "echo created; exit 0";
  return 'echo "https://github.com/example-org/app/pull/42"; exit 0';
}

/** The branches `repo` has, the given pattern's: the bare origin's are what was pushed. */
function branchesIn(repo: string, pattern: string): string[] {
  return git(repo, "branch", "--list", "--format=%(refname:short)", pattern)
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

/** The project file's text on `branch` of origin, exactly as committed. */
function textOn(origin: string, branch: string): string {
  return git(origin, "cat-file", "blob", `${branch}:.claude/cc-smart-dev-kit.json`);
}

/** The file `branch` of origin holds, parsed. */
function fileOn(origin: string, branch: string): Record<string, unknown> {
  return JSON.parse(textOn(origin, branch)) as Record<string, unknown>;
}

/** The lines a proposal of `branch` prints, the setting's line first. */
function proposedLines(setting: string, branch: string): string[] {
  return [
    `+ ${setting} in .claude/cc-smart-dev-kit.json`,
    `+ ${branch}, cut from origin/main and pushed`,
    `! ${MADE_WITHOUT_HOOKS}`,
    "+ pull request into main: https://github.com/example-org/app/pull/42",
  ];
}

describe("workflow propose: one setting through a pull request", () => {
  test("a change: a commit on origin/main by plumbing, pushed as a new branch, the pull request opened", async () => {
    const w = world();
    const run = await w.run(["propose", "allowCommit", "true"]);

    const branch = "worktree-workflow-allowCommit-20261023";
    expect(run.status).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual(proposedLines("allowCommit = true", branch));
    // The branch holds the change; the base and the person's own checkout do not (D57).
    expect(fileOn(w.origin, branch).workflow).toEqual({ allowCommit: true });
    expect(fileOn(w.origin, "main").workflow).toBeUndefined();
    expect(JSON.parse(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8"))).toEqual(
      SETTINGS,
    );
    // gh was asked for the pull request into the base, with a body that says how it was made.
    expect(w.ghLog()).toEqual([
      "repo view --json nameWithOwner --jq .nameWithOwner",
      `pr create --base main --head ${branch} --title workflow: allowCommit (unset) → true --body Updated by \`${COMMAND} workflow propose\`: the project's workflow setting allowCommit, from (unset) to true.
It counts once this pull request is merged into main: merge-check reads the review gate from the file committed on the base, and a session's own checkout never counts.
${MADE_WITHOUT_HOOKS}`,
    ]);
    // One commit on the base, the person's, with a message naming the setting and both values,
    // and the run's own id last.
    const message = git(w.origin, "log", "--format=%s%n%b", `main..${branch}`).trim();
    expect(message).toStartWith(`workflow: allowCommit (unset) → true\n${MADE_WITHOUT_HOOKS}\n`);
    expect(message.split("\n")).toHaveLength(4);
    expect(message.split("\n")[3]).toMatch(
      /^Proposal-Id: [0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
    );
    expect(git(w.origin, "rev-parse", `${branch}^`)).toBe(git(w.origin, "rev-parse", "main"));
    expect(git(w.origin, "log", "-1", "--format=%an <%ae>", branch).trim()).toBe(
      "Test <test@example.com>",
    );
    // No worktree, no local branch and no change in the person's checkout.
    expect(git(w.repo, "status", "--porcelain").trim()).toBe("");
    expect(git(w.repo, "worktree", "list", "--porcelain")).not.toContain(branch);
    expect(branchesIn(w.repo, "worktree-workflow-*")).toEqual([]);
  });

  test("the project's own failing pre-commit, post-checkout and pre-push hooks never stop it", async () => {
    const w = world();
    for (const hook of ["pre-commit", "commit-msg", "post-checkout", "pre-push"]) {
      failingHook(w.repo, hook);
    }
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(fileOn(w.origin, "worktree-workflow-allowCommit-20261023").workflow).toEqual({
      allowCommit: true,
    });
  });

  test("the blob is the writer's text byte for byte: CRLF kept, a text attribute's clean step never run", async () => {
    const w = world();
    const crlf = `{\r\n  "requires": ">=0.1",\r\n  "worktrees": { "base": "main" },\r\n  "protectedBranches": ["main"]\r\n}\r\n`;
    writeFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), crlf);
    git(w.repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "CRLF");
    // From here on git add would turn CRLF into LF: a clean step a plumbing blob never takes.
    writeFileSync(join(w.repo, ".gitattributes"), "*.json text\n");
    git(w.repo, "add", "--", ".gitattributes");
    git(w.repo, "commit", "-q", "-m", "text");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    const where = "origin/main:.claude/cc-smart-dev-kit.json";
    const written = editProjectSetting(crlf, where, "allowCommit", true).text;
    expect(written).toContain('"allowCommit": true\r\n');
    expect(textOn(w.origin, "worktree-workflow-allowCommit-20261023")).toBe(written);
  });

  test("the base file's mode is kept", async () => {
    const w = world();
    git(w.repo, "update-index", "--chmod=+x", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "executable");
    git(w.repo, "push", "-q", "origin", "main");
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    expect(
      git(
        w.origin,
        "ls-tree",
        "worktree-workflow-allowCommit-20261023",
        "--",
        ".claude/cc-smart-dev-kit.json",
      ),
    ).toStartWith("100755 blob ");
  });

  test("commit.gpgSign on: the commit is signed, which commit-tree does only when asked", async () => {
    const w = world();
    const cat = Bun.which("cat") ?? "/bin/cat";
    const gpg = join(w.bin, "fake-gpg");
    writeFileSync(
      gpg,
      `#!/bin/sh\n"${cat}" >/dev/null\necho "[GNUPG:] SIG_CREATED D 1 8 00 0 0" >&2\necho "-----BEGIN PGP SIGNATURE-----"\necho "ZmFrZQ=="\necho "-----END PGP SIGNATURE-----"\n`,
    );
    chmodSync(gpg, 0o755);
    git(w.repo, "config", "commit.gpgSign", "true");
    git(w.repo, "config", "gpg.program", gpg);
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(git(w.origin, "cat-file", "commit", "worktree-workflow-allowCommit-20261023")).toContain(
      "gpgsig -----BEGIN PGP SIGNATURE-----",
    );
  });

  test("commit.gpgSign on and git cannot sign: git's refusal is named, and nothing is pushed", async () => {
    const w = world();
    const gpg = join(w.bin, "broken-gpg");
    writeFileSync(gpg, '#!/bin/sh\necho "gpg: signing failed: No secret key" >&2\nexit 2\n');
    chmodSync(gpg, 0o755);
    git(w.repo, "config", "commit.gpgSign", "true");
    git(w.repo, "config", "gpg.program", gpg);
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toStartWith("git commit-tree failed: ");
    expect(run.errors[0]).toContain("gpg: signing failed: No secret key");
    expect(run.errors[0]).toContain(
      "and that git can sign your commits (commit.gpgSign is on), then try again. Nothing was pushed.",
    );
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  // `plans.mergeFiles` raises `requires` to the 5.2 floor, and the writer checks the file it is
  // about to write against the running version. So this build either meets the floor (the list is
  // proposed, normalised) or says to update and makes nothing. One test, both cases.
  test("plans.mergeFiles: proposed with its paths normalised, or on an older build refused with the fix and nothing made", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { ...SETTINGS, requires: ">=0.1" });
    git(w.repo, "commit", "-q", "-am", "an old requires");
    git(w.repo, "push", "-q", "origin", "main");
    const run = await w.run(["propose", "plans.mergeFiles", "./plugin/dist\\, CHANGELOG.md"]);
    if (Bun.semver.order(VERSION, "5.2.0") < 0) {
      expect(run.status).toBe(1);
      expect(run.lines).toEqual([]);
      expect(run.errors).toHaveLength(1);
      expect(run.errors[0]).toContain(
        `this project needs cc-smart-dev-kit >=5.2; you have ${VERSION}; run ${PLUGIN_UPDATE_COMMAND}`,
      );
      expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
      expect(w.ghLog().filter((call) => call.startsWith("pr create"))).toEqual([]);
      return;
    }
    const branch = "worktree-workflow-plans-mergeFiles-20261023";
    expect(run.status).toBe(0);
    expect(run.errors).toEqual([]);
    expect(fileOn(w.origin, branch).workflow).toEqual({
      plans: { mergeFiles: ["plugin/dist/", "CHANGELOG.md"] },
    });
    expect(fileOn(w.origin, branch).requires).toBe(">=5.2");
    // The raise is part of the diff, so the output and the body name it, in the words
    // `workflow set --project` prints.
    expect(run.lines[1]).toBe(
      `+ .claude/cc-smart-dev-kit.json: requires ">=0.1" -> ">=5.2" (the file's fields need it)`,
    );
    expect(w.ghLog()[1]).toContain(
      `\nIt also raises requires ">=0.1" -> ">=5.2" (the file's fields need it).\n`,
    );
    expect(fileOn(w.origin, "main").workflow).toBeUndefined();
  });

  test("--unset removes the project's value, and the branch carries the file without it", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowCommit: true },
    });
    git(w.repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "allowCommit on");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "allowCommit", "--unset"]);
    const branch = "worktree-workflow-allowCommit-20261023";
    expect(run.status).toBe(0);
    expect(run.lines[0]).toBe("+ allowCommit = (unset) in .claude/cc-smart-dev-kit.json");
    expect(fileOn(w.origin, branch).workflow).toBeUndefined();
    expect(git(w.origin, "log", "-1", "--format=%s", branch).trim()).toBe(
      "workflow: allowCommit true → (unset)",
    );
  });

  test("--json answers the pull request in one line, in the shape the portal reads", async () => {
    const w = world();
    const run = await w.run(["propose", "openPr", "draft", "--json"]);
    expect(run.status).toBe(0);
    expect(run.lines).toHaveLength(1);
    const expected: ProposedJson = {
      branch: "worktree-workflow-openPr-20261023",
      from: null,
      setting: "openPr",
      to: "draft",
      url: "https://github.com/example-org/app/pull/42",
    };
    expect(JSON.parse(run.lines[0] ?? "")).toEqual(expected);
  });

  test("a project with no file: refused, project init first, nothing made", async () => {
    const w = world();
    rmSync(join(w.repo, ".claude/cc-smart-dev-kit.json"));
    git(w.repo, "add", "-A");
    git(w.repo, "commit", "-q", "-m", "no file");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `${w.repo} has no .claude/cc-smart-dev-kit.json: run \`${COMMAND} project init\` there first.`,
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("names that are not UTF-8, at the root and in .claude/, stay as they are: the commit changes the one file", async () => {
    const w = world();
    // "café.txt" in Latin-1: the byte 0xE9 alone is not UTF-8.
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]);
    writeFileSync(Buffer.concat([Buffer.from(`${w.repo}/`), latin1]), "root\n");
    writeFileSync(Buffer.concat([Buffer.from(`${w.repo}/.claude/`), latin1]), "inside\n");
    git(w.repo, "add", "-A");
    git(w.repo, "commit", "-q", "-m", "Latin-1 names");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(
      git(
        w.origin,
        "diff-tree",
        "-r",
        "--name-only",
        "main",
        "worktree-workflow-allowCommit-20261023",
      ),
    ).toBe(".claude/cc-smart-dev-kit.json\n");
  });

  test("two runs of one proposal in one second make two commits: the other run's branch is a taken name, never this run's", async () => {
    const w = world();
    // The same identity, setting and second: without the run's own id, the same commit.
    const sameSecond = {
      GIT_AUTHOR_DATE: "2026-10-23T09:00:00Z",
      GIT_COMMITTER_DATE: "2026-10-23T09:00:00Z",
    };
    const other = "worktree-workflow-allowCommit-20261023";
    expect((await w.run(["propose", "allowCommit", "true"], sameSecond)).status).toBe(0);
    const theirs = git(w.origin, "rev-parse", other);
    // This run's name check misses the other branch, as it would just before the other push.
    const realGit = Bun.which("git") ?? "/usr/bin/git";
    const mark = join(w.bin, "listed");
    rmSync(join(w.bin, "git"));
    writeFileSync(
      join(w.bin, "git"),
      `#!/bin/sh
if [ "$1" = "ls-remote" ] && [ "$2" = "--heads" ] && [ ! -e "${mark}" ]; then
  touch "${mark}"
  exit 0
fi
exec "${realGit}" "$@"
`,
    );
    chmodSync(join(w.bin, "git"), 0o755);

    const run = await w.run(["propose", "allowCommit", "true"], sameSecond);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(`+ ${other}-2, cut from origin/main and pushed`);
    // This run's commit is its own; the other run's branch still holds the other commit.
    expect(git(w.origin, "rev-parse", `${other}-2`)).not.toBe(theirs);
    expect(git(w.origin, "rev-parse", other)).toBe(theirs);
  });

  test("two names taken in a row while the run pushes: said as taken names, not as a push you may not make", async () => {
    const w = world({ race: "taken-twice" });
    const name = "worktree-workflow-allowCommit-20261023";
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      `the branch names ${name} and ${name}-2 were both taken on origin while this proposal ran: other proposals of allowCommit are being pushed now. Nothing was pushed; run it again in a moment.`,
    ]);
  });

  test("every name of the day taken: said with what to do, and nothing pushed", async () => {
    const w = world();
    const name = "worktree-workflow-allowCommit-20261023";
    git(w.repo, "branch", name);
    for (let count = 2; count <= 50; count += 1) git(w.repo, "branch", `${name}-${count}`);
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      `all 50 branch names for allowCommit today (${name} to ${name}-50) are taken, here or on origin: delete the proposal branches you no longer need, then run it again. Nothing was pushed.`,
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("the git calls a run makes, in order: the worst case counts each one", async () => {
    const w = world();
    const realGit = Bun.which("git") ?? "/usr/bin/git";
    const log = join(w.bin, "git.log");
    rmSync(join(w.bin, "git"));
    writeFileSync(join(w.bin, "git"), `#!/bin/sh\necho "$1" >> "${log}"\nexec "${realGit}" "$@"\n`);
    chmodSync(join(w.bin, "git"), 0o755);
    expect((await w.run(["propose", "allowCommit", "true"])).status).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      // Finding the checkout, and the fetch.
      "rev-parse",
      "fetch",
      // The base's commit, and the committed file's three reads.
      "rev-parse",
      "rev-parse",
      "rev-parse",
      "cat-file",
      // The blob, and a listing and a mktree for each of the two tree levels.
      "hash-object",
      "ls-tree",
      "ls-tree",
      "mktree",
      "mktree",
      "config",
      "commit-tree",
      // Where the push goes, then one name pick: its branches, then this repository's.
      "remote",
      "ls-remote",
      "for-each-ref",
      "push",
    ]);
    // From the limits, by hand: two checkout reads of 5 s; the fetch 60 s; gh 10 s; the commit
    // 120 s; two name picks and pushes of 60 + 120 s; gh pr create 60 s; the take-back's delete
    // 120 s; thirteen quick calls of 10 s (the twelve above, and the second pick's branch list); 30 s.
    expect(PROPOSE_WORST_CASE_MS).toBe(
      10_000 + 60_000 + 10_000 + 120_000 + 360_000 + 60_000 + 120_000 + 130_000 + 30_000,
    );
  });

  test("a fetch that moves origin/main mid-run: the title's old value and the commit's parent come from the one commit read first", async () => {
    const w = world();
    const first = git(w.repo, "rev-parse", "origin/main").trim();
    // A commit with allowCommit false, made here and never pushed: where another process's fetch
    // could move origin/main to while this run reads it.
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowCommit: false },
    });
    git(w.repo, "commit", "-q", "-am", "allowCommit off");
    const moved = git(w.repo, "rev-parse", "HEAD").trim();
    const realGit = Bun.which("git") ?? "/usr/bin/git";
    const marks = {
      fetched: join(w.bin, "fetched"),
      moved: join(w.bin, "moved"),
      once: join(w.bin, "once"),
    };
    rmSync(join(w.bin, "git"));
    // At the second `rev-parse` after the fetch, origin/main moves: after a run has picked its
    // one commit, and before it reads anything of it.
    writeFileSync(
      join(w.bin, "git"),
      `#!/bin/sh
[ "$1" = "fetch" ] && touch "${marks.fetched}"
if [ "$1" = "rev-parse" ] && [ -e "${marks.fetched}" ] && [ ! -e "${marks.moved}" ]; then
  if [ -e "${marks.once}" ]; then
    touch "${marks.moved}"
    "${realGit}" update-ref refs/remotes/origin/main ${moved}
  else
    touch "${marks.once}"
  fi
fi
exec "${realGit}" "$@"
`,
    );
    chmodSync(join(w.bin, "git"), 0o755);

    const run = await w.run(["propose", "allowCommit", "true"]);
    const branch = "worktree-workflow-allowCommit-20261023";
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(git(w.origin, "rev-parse", `${branch}^`).trim()).toBe(first);
    expect(git(w.origin, "log", "-1", "--format=%s", branch).trim()).toBe(
      "workflow: allowCommit (unset) → true",
    );
  });

  test("the person's own defaults never reach the pull request: a from is the project's value, or unset", async () => {
    const w = world();
    writePersonalWorkflow(w.env, { allowCommit: true });
    const run = await w.run(["propose", "allowCommit", "false"]);
    expect(run.status).toBe(0);
    expect(
      git(w.origin, "log", "-1", "--format=%s", "worktree-workflow-allowCommit-20261023").trim(),
    ).toBe("workflow: allowCommit (unset) → false");
    expect(w.ghLog()[1]).toContain("from (unset) to false");
    expect(w.ghLog()[1]).not.toContain("from true");
  });

  test("a value only this checkout sets is not 'already set': the change goes to the base", async () => {
    // The working copy holds allowCommit true and was never committed: the base does not have it,
    // so the proposal is real, and the person's own uncommitted file is left as it was.
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowCommit: true },
    });

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[0]).toBe("+ allowCommit = true in .claude/cc-smart-dev-kit.json");
    expect(fileOn(w.origin, "worktree-workflow-allowCommit-20261023").workflow).toEqual({
      allowCommit: true,
    });
    // The person's checkout still holds its own uncommitted file, untouched.
    expect(JSON.parse(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8"))).toEqual(
      { ...SETTINGS, workflow: { allowCommit: true } },
    );
    expect(git(w.repo, "status", "--porcelain").trim()).toContain("cc-smart-dev-kit.json");
  });

  test("a value already set in the project: said, and no branch or pull request", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowCommit: true },
    });
    git(w.repo, "add", "--", ".claude/cc-smart-dev-kit.json");
    git(w.repo, "commit", "-q", "-m", "allowCommit on");
    git(w.repo, "push", "-q", "origin", "main");

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      "= allowCommit = true in .claude/cc-smart-dev-kit.json (already set); no branch or pull request was made.",
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
    expect(w.ghLog()).toEqual([]);
  });

  test("--unset of a value the project does not set: said, and nothing made", async () => {
    const w = world();
    const run = await w.run(["propose", "allowCommit", "--unset"]);
    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      "= allowCommit was not set in .claude/cc-smart-dev-kit.json; no branch or pull request was made.",
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("a name a local branch holds: the next free name is used", async () => {
    const w = world();
    git(w.repo, "branch", "worktree-workflow-allowCommit-20261023");
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(
      "+ worktree-workflow-allowCommit-20261023-2, cut from origin/main and pushed",
    );
  });

  test("no gh: refused with the fix, and nothing made", async () => {
    const w = world({ gh: "missing" });
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      `gh is not installed, so no pull request can be opened: install GitHub's CLI from https://cli.github.com, then run \`gh auth login\`.`,
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("gh that cannot read this repository: refused with the fix, and nothing made", async () => {
    const w = world({ gh: "out" });
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "gh cannot read this repository on GitHub (it is not logged in, there is no network, or origin is not a GitHub repository): run `gh auth status` to see which, then try again.",
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("a push the remote refuses: refused in git's words, and the leased delete says nothing was left", async () => {
    const w = world();
    mkdirSync(join(w.origin, "hooks"), { recursive: true });
    writeFileSync(
      join(w.origin, "hooks", "pre-receive"),
      "#!/bin/sh\necho 'this repository is read-only' >&2\nexit 1\n",
    );
    chmodSync(join(w.origin, "hooks", "pre-receive"), 0o755);

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "git push origin worktree-workflow-allowCommit-20261023 failed: [remote rejected] (pre-receive hook declined). Check that you may push to this repository, then try again; nothing was left behind",
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("a push that landed and then exited non-zero: its porcelain line says it landed, and the pull request opens", async () => {
    const w = world({ race: "lands" });
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([
      "worktree-workflow-allowCommit-20261023",
    ]);
  });

  test("a take-back whose delete landed and then exited non-zero: said as deleted", async () => {
    const w = world({ gh: "create-fails", race: "delete-lands" });
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toEndWith(
      "; the pushed branch was deleted from origin again; nothing was left behind",
    );
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("a push URL apart from the fetch URL: the take-back deletes where the push went", async () => {
    const w = world({ gh: "create-fails" });
    const pushTo = join(tempDir("propose-push-url"), "push.git");
    git(dirname(pushTo), "init", "-q", "--bare", pushTo);
    git(w.repo, "config", "remote.origin.pushurl", pushTo);
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toEndWith(
      "; the pushed branch was deleted from origin again; nothing was left behind",
    );
    expect(branchesIn(pushTo, "worktree-workflow-*")).toEqual([]);
  });

  test("a push URL apart from the fetch URL: names taken there and not on the fetch side are skipped", async () => {
    const w = world();
    const name = "worktree-workflow-allowCommit-20261023";
    const pushTo = join(tempDir("propose-push-names"), "push.git");
    git(dirname(pushTo), "init", "-q", "--bare", pushTo);
    for (const taken of [name, `${name}-2`]) {
      git(w.repo, "push", "-q", pushTo, `refs/remotes/origin/main:refs/heads/${taken}`);
    }
    git(w.repo, "config", "remote.origin.pushurl", pushTo);
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(`+ ${name}-3, cut from origin/main and pushed`);
    expect(branchesIn(pushTo, "worktree-workflow-*")).toEqual([name, `${name}-2`, `${name}-3`]);
  });

  test("a base that cannot be fetched: refused with the fix, and nothing made", async () => {
    const w = world();
    git(w.repo, "remote", "set-url", "origin", join(w.repo, "gone"));
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain("git fetch origin main failed:");
    expect(run.errors[0]).toContain("Check the network and that origin has main, then try again.");
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("gh cannot open the pull request: the push is taken back too", async () => {
    const w = world({ gh: "create-fails" });
    const run = await w.run(["propose", "allowCommit", "true"]);
    const branch = "worktree-workflow-allowCommit-20261023";
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain(
      "gh pr create failed: a pull request already exists for this branch. Check that gh",
    );
    expect(run.errors[0]).not.toContain("uncommitted change");
    expect(run.errors[0]).toEndWith(
      "; the pushed branch was deleted from origin again; nothing was left behind",
    );
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
    expect(git(w.origin, "branch", "--list", branch).trim()).toBe("");
  });

  test("the base must carry the project's file: a checkout's own copy is not enough", async () => {
    // The file is in this checkout only, never committed or pushed: origin/main has none.
    const w = world({ file: "local" });

    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors).toEqual([
      "origin/main has no .claude/cc-smart-dev-kit.json: commit the project's file to main and push it first — a change counts once it is merged.",
    ]);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
  });

  test("a review-gate key is proposed inside Claude Code like any other key", async () => {
    const w = world();
    const run = await w.run(["propose", "allowMerge", "true"], { CLAUDECODE: "1" });
    expect(run.status).toBe(0);
    expect(fileOn(w.origin, "worktree-workflow-allowMerge-20261023").workflow).toEqual({
      allowMerge: true,
    });
  });
});

describe("workflow propose: names, folders and a gh that does not answer", () => {
  test("a name a teammate already pushed: the next free name, from origin", async () => {
    const w = world();
    // A teammate's proposal, pushed the same day under the name this run would pick.
    git(w.repo, "push", "-q", "origin", "main:refs/heads/worktree-workflow-allowCommit-20261023");
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(
      "+ worktree-workflow-allowCommit-20261023-2, cut from origin/main and pushed",
    );
  });

  test("a name another proposal pushed between the check and the push: the lease refuses it, the next name is used, and that branch stays", async () => {
    const w = world({ race: "taken" });
    const other = "worktree-workflow-allowCommit-20261023";
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.lines[1]).toBe(`+ ${other}-2, cut from origin/main and pushed`);
    // The other run's branch is untouched: it still points where it did.
    expect(git(w.origin, "rev-parse", "--verify", other)).toBe(git(w.origin, "rev-parse", "main"));
    expect(fileOn(w.origin, `${other}-2`).workflow).toEqual({ allowCommit: true });
  });

  test("a gh that opens nothing it can name: refused, and the pushed branch is taken back too", async () => {
    const w = world({ gh: "create-no-url" });
    const branch = "worktree-workflow-allowCommit-20261023";
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toContain(
      "gh pr create failed: gh printed no pull request URL (created)",
    );
    expect(run.errors[0]).toContain("nothing was left behind");
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([]);
    expect(git(w.origin, "branch", "--list", branch).trim()).toBe("");
  });

  test("--folder is found from the folder the command runs in, and the person's checkout stays as it was", async () => {
    const w = world();
    const before = readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8");
    const elsewhere = join(tempDir("propose-elsewhere"), "project");
    symlinkSync(w.repo, elsewhere);
    const run = await w.run(
      ["propose", "allowCommit", "true", "--folder", "project"],
      {},
      dirname(elsewhere),
    );
    expect(run.status).toBe(0);
    expect(readFileSync(join(w.repo, ".claude/cc-smart-dev-kit.json"), "utf8")).toBe(before);
    expect(branchesIn(w.origin, "worktree-workflow-*")).toEqual([
      "worktree-workflow-allowCommit-20261023",
    ]);
  });

  test("gh pr create that does not answer in time: the branch and the possible pull request are left alone", async () => {
    const w = world({ gh: "create-hangs" });
    const branch = "worktree-workflow-allowCommit-20261023";
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
      "allowCommit",
      true,
      { json: false },
    );
    expect(status).toBe(1);
    expect(errors[0]).toEndWith(`The branch ${branch} is pushed.`);
    expect(errors[0]).toContain(`the pull request may be open: look at ${w.repo}'s pull requests`);
    // Not taken back: GitHub may have made the pull request just before the call ended.
    expect(git(w.origin, "branch", "--list", branch)).toContain(branch);
  });

  test("gh pr create killed by a signal: the branch is left alone, as after a timeout", async () => {
    const w = world({ gh: "create-killed" });
    const branch = "worktree-workflow-allowCommit-20261023";
    const run = await w.run(["propose", "allowCommit", "true"]);
    expect(run.status).toBe(1);
    expect(run.errors[0]).toStartWith(
      `gh pr create was stopped by SIGKILL, so the pull request may be open: look at ${w.repo}'s pull requests`,
    );
    expect(run.errors[0]).toEndWith(`The branch ${branch} is pushed.`);
    // gh may have made the pull request before it died: the pushed branch is its head.
    expect(git(w.origin, "branch", "--list", branch)).toContain(branch);
  });
});

describe("proposeTimeoutLine", () => {
  test("names the branch a run may have pushed, and no worktree, since none is made", () => {
    expect(proposeTimeoutLine("plans.mergeFiles")).toBe(
      "workflow propose did not answer in time, so it may have pushed a branch (worktree-workflow-plans-mergeFiles-…) or opened the pull request: look at the project's pull requests and its branches on origin before running it again.",
    );
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
