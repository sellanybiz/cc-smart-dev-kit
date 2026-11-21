/**
 * The Projects page's server half (B8): the list of repositories read from Claude Code's own
 * session records, one project's page with its branches and the merge guard's verdict, and
 * the `project.*` actions that name a project by id.
 *
 * A temp HOME holds Claude Code's session records, the repos are real temp checkouts, and
 * every `gh` answer is an injected runner: no test reaches GitHub, the real `~/.claude`, or a
 * blocking child. The one deadline and the one-minute cache move on the portal's own clock.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../../cli/paths";
import { projectFolderName } from "../../sessions/saved-sessions";
import { type FakeWorkflow, fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import {
  commitConfig,
  makeRepo,
  writeClaudeFile,
  writePersonalWorkflow,
} from "../../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import type { GhRunner } from "../../workflow/merge-check";
import { ACTION_NAMES, type ActionContext, portalOmnirouteContext, runAction } from "../actions";
import type { PageDataDeps } from "../page-data";
import { workflowAdapter } from "../workflow-adapter";
import {
  addProjectRoot,
  forgetGhLogin,
  forgetProjectBranches,
  forgetProjectsList,
  ghLoginOf,
  NO_SESSION_RECORDS,
  PROJECT_GH_LOGIN_CACHE_MS,
  PROJECT_GIT_AT_ONCE,
  PROJECT_VERDICTS_AT_ONCE,
  type ProjectsWorld,
  projectBranches,
  projectsList,
  projectWorkflowAnswerFor,
  readAddedProjects,
} from "./projects";
import { answerApi } from "./routes";
import { testPortalContext } from "./test-context";
import type { ProjectSummary } from "./types";

/** One session's time: every list assertion names a hand-written time, never `Date.now()`. */
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const HOUR = 3_600_000;

/** A project's id as the contract says it: 12 hex of sha256 of its root. */
function expectedId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

/**
 * A PATH with the real git, and (when asked) a gh that only has to exist. `gitLog`: a git that
 * writes its arguments to that file before running the real one, so a test counts the scans.
 * `gitHold`: a file the git waits for first, so a test sees how many children start at once.
 */
function binPath(withGh: boolean, gitLog?: string, gitHold?: string): string {
  const bin = join(tempDir("projects-bin"), "bin");
  mkdirSync(bin);
  const gitPath = Bun.which("git") ?? "/usr/bin/git";
  if (gitLog === undefined && gitHold === undefined) {
    symlinkSync(gitPath, join(bin, "git"));
  } else {
    const script = join(bin, "git");
    const log = gitLog === undefined ? "" : `printf '%s\\n' "$*" >> "${gitLog}"\n`;
    const hold = gitHold === undefined ? "" : `while [ ! -f "${gitHold}" ]; do sleep 0.05; done\n`;
    writeFileSync(script, `#!/bin/sh\n${log}${hold}exec "${gitPath}" "$@"\n`);
    chmodSync(script, 0o755);
  }
  if (withGh) {
    // `repo view` answers the repository, as a logged-in gh does; every other call prints nothing.
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\nif [ "$1" = "repo" ]; then echo "example-org/app"; fi\nexit 0\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
  }
  return bin;
}

/** Every git call the logged PATH saw, oldest first (none before the first call). */
function gitCalls(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** The environment the portal reads: a temp HOME, and only the programs a test allows. */
function worldEnv(
  home: string,
  withGh: boolean,
  gitLog?: string,
  gitHold?: string,
): Record<string, string> {
  return {
    ...cleanGitEnv(),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    HOME: home,
    PATH: binPath(withGh, gitLog, gitHold),
  };
}

interface TestWorld {
  action: ActionContext;
  cwd: string;
  deps: PageDataDeps;
  env: Record<string, string>;
  home: string;
  now: () => number;
  paths: CliPaths;
  projects: ProjectsWorld;
  workflow: FakeWorkflow;
}

/** Everything one test reads: a temp HOME and portal folder, and the portal's own context. */
function testWorld(
  options: {
    clock?: () => number;
    gh?: boolean;
    gitHold?: string;
    gitLog?: string;
    withGh?: GhRunner;
  } = {},
): TestWorld {
  const home = tempDir("projects-home");
  const cwd = tempDir("projects-cwd");
  const env = worldEnv(home, options.gh === true, options.gitLog, options.gitHold);
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const now = options.clock ?? (() => Date.now());
  const ctx = testPortalContext(paths, env, now);
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  const deps: PageDataDeps = {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: { error: "this test reads no gateway config" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
  const projects: ProjectsWorld = {
    cwd,
    env,
    now,
    paths,
    ...(options.withGh === undefined ? {} : { gh: options.withGh }),
  };
  return { action, cwd, deps, env, home, now, paths, projects, workflow };
}

/** One saved Claude Code session that last worked in `folder`, written at `atMs`. */
function sessionRecord(projectsDir: string, folder: string, id: string, atMs: number): void {
  const dir = join(projectsDir, projectFolderName(folder));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ cwd: folder, type: "user" })}\n`);
  utimesSync(file, atMs / 1000, atMs / 1000);
}

/** A repo with its project file committed on `main`, pointed at by `origin/main`. */
function committedRepo(name: string, config: unknown = {}): string {
  const repo = makeRepo(name);
  commitConfig(repo, config, ["main"]);
  return repo;
}

/** A repo whose committed policy lets its plain integration base merge by itself. */
function mergeableRepo(name: string): string {
  const repo = makeRepo(name);
  commitConfig(
    repo,
    {
      workflow: { allowMerge: true, reviewBeforePush: false },
      worktrees: { base: "integration" },
    },
    ["main", "integration"],
  );
  return repo;
}

/**
 * A gh runner for `numbers` open pull requests into `integration`, each one green and allowed
 * to merge; `onCall` sees every call (to count them, or to slow them down).
 */
function mergeableRunner(numbers: number[], onCall?: (args: string[]) => Promise<void>): GhRunner {
  return async (args) => {
    if (onCall !== undefined) await onCall(args);
    // The stacked questions of the merge check: it carries its own head alone, nothing is below it.
    if (args[0] === "pr" && args[1] === "view" && args.includes("commits")) {
      return JSON.stringify({ commits: [{ oid: "c".repeat(40) }] });
    }
    if (args[0] === "pr" && args[1] === "list" && args.includes("number,headRefOid")) return "[]";
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify(
        numbers.map((number) => ({
          baseRefName: "integration",
          headRefName: `feat/${number}`,
          isDraft: false,
          number,
          title: `Add ${number}`,
        })),
      );
    }
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({
        baseRefName: "integration",
        headRefName: `feat/${args[2]}`,
        headRefOid: "c".repeat(40),
        number: Number(args[2]),
      });
    }
    if (args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({ defaultBranchRef: { name: "main" } });
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return JSON.stringify([{ bucket: "pass", name: "ci" }]);
    }
    return null;
  };
}

/** The form's own answers: everything the Project card sends, and nothing else. */
function formAnswers(): Record<string, unknown> {
  return {
    base: "main",
    bases: {},
    guards: { guardMainFolder: false, jobRoute: false, sessionNames: false },
    protectedBranches: ["main"],
  };
}

/** The one project `root` in the list, or a failure naming what was found instead. */
async function projectOf(world: ProjectsWorld, root: string): Promise<ProjectSummary> {
  const found = (await projectsList(world)).projects.find((one) => one.root === root);
  if (found === undefined) throw new Error(`the list holds no project at ${root}`);
  return found;
}

beforeEach(() => {
  // The kept branch answers and the kept list are the server's memory: a test starts from none.
  forgetProjectBranches();
  forgetProjectsList();
});

describe("the projects list (B8)", () => {
  test("one row per repository: a worktree is folded into its main checkout, newest use first", async () => {
    const w = testWorld();
    const alpha = committedRepo("alpha");
    const beta = makeRepo("beta");
    const gamma = makeRepo("gamma");
    mkdirSync(join(gamma, ".claude"), { recursive: true });
    writeFileSync(join(gamma, ".claude", "cc-smart-dev-kit.json"), "{}\n");
    const worktree = join(tempDir("projects-wt"), "wt");
    git(alpha, "worktree", "add", "-q", "-b", "wt", worktree);
    sessionRecord(w.paths.projectsDir, beta, "s-beta", T0);
    sessionRecord(w.paths.projectsDir, worktree, "s-wt", T0 + HOUR);
    sessionRecord(w.paths.projectsDir, gamma, "s-gamma", T0 + 2 * HOUR);

    const list = await projectsList({ ...w.projects, cwd: alpha });
    expect(list.note).toBe(null);
    // Newest use first; the worktree's session names alpha, so alpha is one row with its time.
    expect(list.projects.map((one) => one.root)).toEqual([gamma, alpha, beta]);
    const [g, a, b] = list.projects;
    expect(a).toEqual({
      configFile: join(alpha, ".claude", "cc-smart-dev-kit.json"),
      current: true,
      id: expectedId(alpha),
      lastUsed: new Date(T0 + HOUR).toISOString(),
      name: "alpha",
      root: alpha,
      set: true,
      source: "sessions",
      uncommitted: false,
      worktrees: 1,
    });
    expect(b).toEqual({
      configFile: null,
      current: false,
      id: expectedId(beta),
      lastUsed: new Date(T0).toISOString(),
      name: "beta",
      root: beta,
      set: false,
      source: "sessions",
      uncommitted: false,
      worktrees: 0,
    });
    // An untracked project file is not what the merge gate reads yet.
    expect(g).toMatchObject({
      configFile: join(gamma, ".claude", "cc-smart-dev-kit.json"),
      current: false,
      id: expectedId(gamma),
      lastUsed: new Date(T0 + 2 * HOUR).toISOString(),
      name: "gamma",
      root: gamma,
      set: true,
      source: "sessions",
      uncommitted: true,
    });

    // The folder the portal runs in a WORKTREE of belongs to that project too.
    const fromWorktree = await projectsList({ ...w.projects, cwd: worktree });
    expect(fromWorktree.projects.find((one) => one.root === alpha)?.current).toBe(true);
  });

  test("the scan runs at most PROJECT_GIT_AT_ONCE git children at once", async () => {
    const release = join(tempDir("projects-release"), "release");
    const log = join(tempDir("projects-git-log"), "git.log");
    const w = testWorld({ clock: () => T0, gitHold: release, gitLog: log });
    const repos = Array.from({ length: PROJECT_GIT_AT_ONCE + 4 }, (_, index) =>
      makeRepo(`repo-${index}`),
    );
    for (const [index, repo] of repos.entries()) {
      sessionRecord(w.paths.projectsDir, repo, `s-${index}`, T0);
    }

    // Every git call waits for the release file: until it is written, exactly the cap may
    // start, and not one more.
    const scanning = projectsList(w.projects);
    try {
      const until = Date.now() + 10_000;
      while (gitCalls(log).length < PROJECT_GIT_AT_ONCE && Date.now() < until) {
        await Bun.sleep(10);
      }
      expect(gitCalls(log)).toHaveLength(PROJECT_GIT_AT_ONCE);
      await Bun.sleep(100);
      expect(gitCalls(log)).toHaveLength(PROJECT_GIT_AT_ONCE);
    } finally {
      // Written even when an assertion fails, so no git child of this test stays blocked.
      writeFileSync(release, "");
    }
    const list = await scanning;
    expect(list.projects.map((one) => one.root).sort()).toEqual([...repos].sort());
  });

  test("no session records: the note says why, and the added folders are rows even so", async () => {
    const w = testWorld();
    const alpha = committedRepo("alpha");
    const gone = join(w.home, "gone");
    const plain = tempDir("projects-plain");
    expect(await addProjectRoot(w.paths, alpha)).toEqual({ added: true, roots: [alpha] });
    expect((await addProjectRoot(w.paths, alpha)).added).toBe(false);
    await addProjectRoot(w.paths, gone);
    await addProjectRoot(w.paths, plain);
    expect(readAddedProjects(w.paths)).toEqual([alpha, gone, plain]);

    const list = await projectsList(w.projects);
    expect(list.note).toBe(NO_SESSION_RECORDS);
    // A folder that is gone, and one that is not in git, are skipped: one row is left.
    expect(list.projects).toEqual([
      {
        configFile: join(alpha, ".claude", "cc-smart-dev-kit.json"),
        current: false,
        id: expectedId(alpha),
        lastUsed: null,
        name: "alpha",
        root: alpha,
        set: true,
        source: "added",
        uncommitted: false,
        worktrees: 0,
      },
    ]);
  });
});

describe("the projects list is kept briefly (B8)", () => {
  test("two reads within ten seconds are one scan, two at once share it, and past it reads scan again", async () => {
    let clock = T0;
    const log = join(tempDir("projects-git-log"), "git.log");
    const w = testWorld({ clock: () => clock, gitLog: log });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);

    const first = await projectsList(w.projects);
    const scanned = gitCalls(log).length;
    expect(scanned).toBeGreaterThan(0);

    // Inside the ten seconds: the kept answer, and no git child at all.
    clock += 9_000;
    expect(await projectsList(w.projects)).toEqual(first);
    expect(gitCalls(log)).toHaveLength(scanned);

    // Two looks at once past the keep share the one scan their first look starts.
    clock += 50_000;
    const [one, two] = await Promise.all([projectsList(w.projects), projectsList(w.projects)]);
    expect(two).toEqual(one);
    expect(gitCalls(log)).toHaveLength(2 * scanned);

    // Past the keep, the next look is a fresh scan.
    clock += 11_000;
    await projectsList(w.projects);
    expect(gitCalls(log)).toHaveLength(3 * scanned);
  });

  test("a project added on the page shows at once, not ten seconds later", async () => {
    const w = testWorld({ clock: () => T0 });
    expect(await projectsList(w.projects)).toEqual({ note: NO_SESSION_RECORDS, projects: [] });

    const repo = committedRepo("alpha");
    const added = await runAction("project.add", { folder: repo }, w.action);
    expect(added.ok).toBe(true);

    expect((await projectsList(w.projects)).projects.map((one) => one.root)).toEqual([repo]);
  });

  test("a project file written on the page drops the kept list, so the next look scans again", async () => {
    const log = join(tempDir("projects-git-log"), "git.log");
    const w = testWorld({ clock: () => T0, gitLog: log });
    const repo = makeRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    const id = (await projectOf(w.projects, repo)).id;
    const scanned = gitCalls(log).length;

    // The preview finds the project in the kept list: its own checkout is read, but the list is
    // not scanned again (a scan always lists the project's worktrees).
    const preview = await runAction(
      "project.preview",
      { answers: formAnswers(), project: id },
      w.action,
    );
    expect(preview.ok).toBe(true);
    const afterPreview = gitCalls(log).length;
    expect(
      gitCalls(log)
        .slice(scanned)
        .some((call) => call.startsWith("worktree list")),
    ).toBe(false);
    const write = await runAction(
      "project.write",
      { answers: formAnswers(), confirm: true, previewHash: preview.filesHash, project: id },
      w.action,
    );
    expect(write.ok).toBe(true);

    // The write dropped the kept list: the page's next look scans the list again, at once.
    await projectOf(w.projects, repo);
    expect(
      gitCalls(log)
        .slice(afterPreview)
        .some((call) => call.startsWith("worktree list")),
    ).toBe(true);
  });
});

describe("the projects list folds one repository (B8)", () => {
  test("a folder reached through a symlink is the same repository: one row", async () => {
    const w = testWorld({ clock: () => T0 });
    const repo = committedRepo("alpha");
    const link = join(tempDir("projects-link"), "alpha-link");
    symlinkSync(repo, link);
    sessionRecord(w.paths.projectsDir, repo, "s-real", T0);
    sessionRecord(w.paths.projectsDir, link, "s-link", T0 + HOUR);

    const list = await projectsList(w.projects);
    expect(list.projects).toHaveLength(1);
    // The row is the main checkout's real path, and its newest use is the symlink's session's.
    expect(list.projects[0]).toMatchObject({
      id: expectedId(repo),
      lastUsed: new Date(T0 + HOUR).toISOString(),
      root: repo,
    });
  });

  test("a committed project file changed on disk is uncommitted", async () => {
    let clock = T0;
    const w = testWorld({ clock: () => clock });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    expect((await projectOf(w.projects, repo)).uncommitted).toBe(false);

    writeFileSync(
      join(repo, ".claude", "cc-smart-dev-kit.json"),
      '{"workflow":{"allowMerge":true}}\n',
    );
    // Past the list's own keep, so the page reads the working copy again.
    clock += 11_000;
    expect((await projectOf(w.projects, repo)).uncommitted).toBe(true);
  });
});

describe("/api/projects/<id> (B8)", () => {
  test("an unknown id is a 404 with a plain line, never a path from the request", async () => {
    const w = testWorld({ clock: () => T0 });
    const answer = await answerApi(w.deps, new URL("http://127.0.0.1/api/projects/no-such-id"));
    expect(answer?.status).toBe(404);
    expect((answer?.body as { error: string } | undefined)?.error).toContain(
      'no project has the id "no-such-id"',
    );
  });

  test("past the one deadline a verdict is late, and the note says the time ran out", async () => {
    let clock = T0;
    const w = testWorld({ clock: () => clock, gh: true });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    let lists = 0;
    const run: GhRunner = async (args) => {
      // The answer eats the whole page's deadline before it arrives.
      clock += 9_000;
      if (args[0] === "pr" && args[1] === "list") {
        lists += 1;
        return JSON.stringify([
          {
            baseRefName: "main",
            headRefName: "feat/x",
            isDraft: true,
            number: 7,
            title: "Add x",
          },
        ]);
      }
      return null;
    };
    const world = { ...w.projects, gh: run };
    const answer = await projectBranches(world, await projectOf(world, repo));
    expect(answer.branches[0]?.verdict).toEqual({
      kind: "late",
      number: null,
      what: "the pull request this command names",
    });
    expect(answer.note).toBe("the time to read every verdict ran out, so some are not read yet");
    // A late answer is not kept: the next look reads again at once, not a minute later.
    clock += 1_000;
    await projectBranches(world, await projectOf(world, repo));
    expect(lists).toBe(2);
  });

  test("two looks at once share one read", async () => {
    const w = testWorld({ clock: () => T0, gh: true });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    let lists = 0;
    const run: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        lists += 1;
        return "[]";
      }
      return null;
    };
    const world = { ...w.projects, gh: run };
    const project = await projectOf(world, repo);
    const [one, two] = await Promise.all([
      projectBranches(world, project),
      projectBranches(world, project),
    ]);
    expect(lists).toBe(1);
    expect(two).toEqual(one);
  });

  test("three open pull requests ask gh repo view once for the page", async () => {
    const w = testWorld({ clock: () => T0, gh: true });
    const repo = mergeableRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    const asked: string[][] = [];
    const run = mergeableRunner([7, 8, 9], async (args) => {
      asked.push(args);
    });
    const world = { ...w.projects, gh: run };
    const answer = await projectBranches(world, await projectOf(world, repo));
    expect(answer.note).toBe(null);
    // Every row is there, in gh's own order, each with its own verdict.
    expect(answer.branches.map((one) => [one.number, one.verdict.kind])).toEqual([
      [7, "allowed"],
      [8, "allowed"],
      [9, "allowed"],
    ]);
    // One default branch for the page, and one view per pull request (and, for the stacked
    // question, one more view of its commits and one list of the open heads).
    expect(asked.filter((one) => one[0] === "repo" && one[1] === "view")).toHaveLength(1);
    const views = asked.filter((one) => one[0] === "pr" && one[1] === "view");
    expect(views.filter((one) => !one.includes("commits"))).toHaveLength(3);
    expect(views.filter((one) => one.includes("commits"))).toHaveLength(3);
  });

  test("the pull request verdicts run together, at most PROJECT_VERDICTS_AT_ONCE at a time", async () => {
    const w = testWorld({ clock: () => T0, gh: true });
    const repo = mergeableRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    let inFlight = 0;
    let mostAtOnce = 0;
    const run = mergeableRunner([1, 2, 3, 4, 5, 6], async () => {
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await Bun.sleep(10);
      inFlight -= 1;
    });
    const world = { ...w.projects, gh: run };
    const answer = await projectBranches(world, await projectOf(world, repo));
    expect(answer.branches).toHaveLength(6);
    expect(answer.branches.every((one) => one.verdict.kind === "allowed")).toBe(true);
    // More than one at a time (they overlap), and never more than the cap.
    expect(mostAtOnce).toBeGreaterThan(1);
    expect(mostAtOnce).toBe(PROJECT_VERDICTS_AT_ONCE);
  });

  test("a pull request the deadline cut short is late, not unread", async () => {
    let clock = T0;
    const w = testWorld({ clock: () => clock, gh: true });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    const run: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([
          {
            baseRefName: "main",
            headRefName: "feat/x",
            isDraft: true,
            number: 7,
            title: "Add x",
          },
        ]);
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "view") {
        // The view itself eats the page's whole deadline and answers nothing.
        clock += 9_000;
        return null;
      }
      return null;
    };
    const world = { ...w.projects, gh: run };
    const answer = await projectBranches(world, await projectOf(world, repo));
    expect(answer.branches[0]?.verdict).toEqual({
      kind: "late",
      number: null,
      what: "the pull request this command names",
    });
    expect(answer.note).toContain("the time to read every verdict ran out");
  });

  test("the branches are kept for 60 s, and read again after it", async () => {
    let clock = T0;
    const w = testWorld({ clock: () => clock, gh: true });
    const repo = committedRepo("alpha");
    sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);
    let lists = 0;
    const run: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        lists += 1;
        return "[]";
      }
      return null;
    };
    const world = { ...w.projects, gh: run };
    const project = await projectOf(world, repo);
    const first = await projectBranches(world, project);
    expect(first).toEqual({ branches: [], checkedAt: new Date(T0).toISOString(), note: null });
    expect(lists).toBe(1);

    clock += 59_000;
    const kept = await projectBranches(world, project);
    expect(lists).toBe(1);
    expect(kept).toEqual(first);

    clock += 2_000;
    const fresh = await projectBranches(world, project);
    expect(lists).toBe(2);
    expect(fresh.checkedAt).toBe(new Date(T0 + 61_000).toISOString());
  });
});

describe("the project actions (B8)", () => {
  test("project.add is one of the actions the page may send, in the list's sorted order", () => {
    expect([...ACTION_NAMES]).toContain("project.add");
    expect([...ACTION_NAMES]).toEqual([...ACTION_NAMES].sort());
  });

  test("project.write with an unknown id refuses in words, and writes nothing", async () => {
    const w = testWorld();
    const answer = await runAction(
      "project.write",
      { answers: formAnswers(), confirm: true, project: "no-such-id" },
      w.action,
    );
    expect(answer.ok).toBe(false);
    expect(answer.lines[0]).toContain('No project of the list has the id "no-such-id"');
    expect(w.workflow.calls.applyProjectInit).toEqual([]);
    expect(w.workflow.calls.planProjectInit).toEqual([]);
  });

  test("preview and write with a listed id target that project's root, not the portal's folder", async () => {
    const w = testWorld();
    const alpha = committedRepo("alpha");
    const beta = committedRepo("beta");
    sessionRecord(w.paths.projectsDir, alpha, "s-a", T0);
    sessionRecord(w.paths.projectsDir, beta, "s-b", T0 + 1_000);
    const betaId = (await projectOf(w.projects, beta)).id;

    const preview = await runAction(
      "project.preview",
      { answers: formAnswers(), project: betaId },
      w.action,
    );
    expect(preview.ok).toBe(true);
    expect(w.workflow.calls.planProjectInit[0]?.root).toBe(beta);
    expect(preview.preview?.file).toBe(join(beta, ".claude", "cc-smart-dev-kit.json"));
    expect(preview.preview?.file).not.toContain(alpha);

    const hash = preview.filesHash;
    expect(typeof hash).toBe("string");
    const write = await runAction(
      "project.write",
      { answers: formAnswers(), confirm: true, previewHash: hash, project: betaId },
      w.action,
    );
    expect(write.ok).toBe(true);
    expect(w.workflow.calls.applyProjectInit).toHaveLength(1);
    expect(w.workflow.calls.applyProjectInit[0]?.plan.file).toBe(
      join(beta, ".claude", "cc-smart-dev-kit.json"),
    );
  });

  test("a project field that is not a string is refused, and nothing is read or written", async () => {
    const w = testWorld();
    for (const value of [7, null, { id: "no-such-id" }]) {
      for (const name of ["project.preview", "project.write"] as const) {
        const answer = await runAction(
          name,
          { answers: formAnswers(), confirm: true, project: value },
          w.action,
        );
        expect(answer.ok).toBe(false);
        expect(answer.lines).toEqual([
          "The project must be named by its id, as a string; nothing was read or written.",
        ]);
      }
    }
    expect(w.workflow.calls.planProjectInit).toEqual([]);
    expect(w.workflow.calls.applyProjectInit).toEqual([]);
  });

  test("no project field still means the folder the portal runs in", async () => {
    const w = testWorld();
    const answer = await runAction("project.preview", { answers: formAnswers() }, w.action);
    expect(answer.ok).toBe(false);
    expect(answer.lines).toEqual(["this folder is not inside a git project"]);
  });

  test("project.add refuses what is not a folder in git, and adds a worktree's main checkout", async () => {
    const w = testWorld();
    const repo = makeRepo("alpha");

    const relative = await runAction("project.add", { folder: "some/where" }, w.action);
    expect(relative.ok).toBe(false);
    expect(relative.lines[0]).toContain("is not an absolute path");
    const missing = await runAction("project.add", { folder: join(w.home, "gone") }, w.action);
    expect(missing.ok).toBe(false);
    expect(missing.lines[0]).toContain("is not a folder on this machine");
    const plain = tempDir("projects-plain");
    const notGit = await runAction("project.add", { folder: plain }, w.action);
    expect(notGit.ok).toBe(false);
    expect(notGit.lines[0]).toContain("not inside a git checkout");
    // Every refusal wrote nothing.
    expect(existsSync(w.paths.portalProjectsFile)).toBe(false);

    const worktree = join(tempDir("projects-wt"), "wt");
    git(repo, "worktree", "add", "-q", "-b", "wt", worktree);
    const added = await runAction("project.add", { folder: worktree }, w.action);
    expect(added.ok).toBe(true);
    expect(added.lines).toEqual([`Added ${repo} to the projects list.`]);
    expect(readAddedProjects(w.paths)).toEqual([repo]);
    expect(JSON.parse(readFileSync(w.paths.portalProjectsFile, "utf8"))).toEqual({
      roots: [repo],
      version: 1,
    });

    const again = await runAction("project.add", { folder: repo }, w.action);
    expect(again.ok).toBe(true);
    expect(again.lines).toEqual([`${repo} is already in the projects list.`]);
    expect(readAddedProjects(w.paths)).toEqual([repo]);
  });
});

// ── A project's workflow settings (D57) ─────────────────────────────────────────

/** One project's workflow answer through the **real** workflow module, never the test's fake. */
async function workflowAnswer(
  w: TestWorld,
  repo: string,
): Promise<Awaited<ReturnType<typeof projectWorkflowAnswerFor>>> {
  return await projectWorkflowAnswerFor({ ...w.deps, workflow: workflowAdapter }, expectedId(repo));
}

describe("a project's workflow settings (D57)", () => {
  test("the person's own file is the source of a value the project does not set", async () => {
    const w = testWorld();
    const repo = committedRepo("personal-app", {
      requires: ">=0.1",
      worktrees: { base: "main" },
    });
    await addProjectRoot(w.paths, repo);
    writePersonalWorkflow(w.env, { openPr: "ready" });
    forgetGhLogin();
    forgetProjectsList();

    const answer = await workflowAnswer(w, repo);
    if ("error" in answer) throw new Error(answer.error);
    expect(answer.settings.find((one) => one.key === "openPr")).toEqual({
      key: "openPr",
      source: "personal",
      value: "ready",
    });
  });

  test("the answer is the base's file, not a change this checkout has not committed", async () => {
    const w = testWorld();
    const repo = committedRepo("uncommitted-app", {
      requires: ">=0.1",
      worktrees: { base: "main" },
    });
    await addProjectRoot(w.paths, repo);
    // A value edited in the working copy and never committed: the base does not have it, and a
    // proposal would change the base — so the card must not show it as the project's policy.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      requires: ">=0.1",
      workflow: { allowCommit: true },
      worktrees: { base: "main" },
    });
    forgetGhLogin();
    forgetProjectsList();

    const answer = await workflowAnswer(w, repo);
    if ("error" in answer) throw new Error(answer.error);
    expect(answer.note).toBeNull();
    expect(answer.settings.find((one) => one.key === "allowCommit")).toEqual({
      key: "allowCommit",
      source: "default",
      value: false,
    });
  });

  test("a project file that cannot be read is a note, and no settings", async () => {
    const w = testWorld();
    const repo = makeRepo("broken-app");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    await addProjectRoot(w.paths, repo);
    forgetGhLogin();
    forgetProjectsList();

    const answer = await workflowAnswer(w, repo);
    if ("error" in answer) throw new Error(answer.error);
    expect(answer.settings).toEqual([]);
    expect(answer.note).toContain("not valid JSON");
  });

  test("no project file: a note, and no base or settings — never a default it has not got", async () => {
    const w = testWorld();
    const repo = makeRepo("not-set-up");
    await addProjectRoot(w.paths, repo);
    forgetGhLogin();
    forgetProjectsList();

    const answer = await workflowAnswer(w, repo);
    expect(answer).toEqual({
      base: null,
      gh: "missing",
      note: `${repo} has no .claude/cc-smart-dev-kit.json yet: set it up with \`cc-smart-dev-kit project init\` there.`,
      settings: [],
    });
  });

  test("the route answers an unknown id with 404 and a known one with the settings", async () => {
    const w = testWorld();
    const repo = committedRepo("routed-app", {
      requires: ">=0.1",
      worktrees: { base: "main" },
    });
    await addProjectRoot(w.paths, repo);
    forgetGhLogin();
    forgetProjectsList();

    const unknown = await answerApi(
      w.deps,
      new URL("http://127.0.0.1:1/api/projects/nothing/workflow"),
    );
    expect(unknown).toEqual({
      body: { error: 'no project has the id "nothing"; the list on /api/projects names them' },
      status: 404,
    });
    const known = await answerApi(
      w.deps,
      new URL(`http://127.0.0.1:1/api/projects/${expectedId(repo)}/workflow`),
    );
    if (known === null) throw new Error("the workflow route answered nothing");
    expect(known.status).toBe(200);
    expect((known.body as { base: null | string }).base).toBe("main");
  });

  test("a path that names no project under the workflow route is refused, not guessed", async () => {
    const w = testWorld();
    for (const path of ["/api/projects/a/b/workflow", "/api/projects//workflow"]) {
      const answer = await answerApi(w.deps, new URL(`http://127.0.0.1:1${path}`));
      expect(answer).toEqual({ body: { error: "name a project" }, status: 400 });
    }
  });

  test("gh is asked once a minute, and again after it", async () => {
    let clock = T0;
    let asked = 0;
    const w = testWorld({
      clock: () => clock,
      gh: true,
      withGh: async () => {
        asked += 1;
        return "test-user";
      },
    });
    const repo = committedRepo("gh-cache", { requires: ">=0.1", worktrees: { base: "main" } });
    await addProjectRoot(w.paths, repo);
    forgetGhLogin();
    forgetProjectsList();

    expect(await ghLoginOf(w.projects, repo)).toBe("in");
    expect(await ghLoginOf(w.projects, repo)).toBe("in");
    expect(asked).toBe(1);
    clock = T0 + PROJECT_GH_LOGIN_CACHE_MS;
    expect(await ghLoginOf(w.projects, repo)).toBe("in");
    expect(asked).toBe(2);
  });

  test("gh not logged in is its own word; a broken personal file is a note, not defaults", async () => {
    const w = testWorld({ gh: true, withGh: async () => null });
    const repo = committedRepo("gh-out", { requires: ">=0.1", worktrees: { base: "main" } });
    await addProjectRoot(w.paths, repo);
    forgetGhLogin();
    forgetProjectsList();
    expect(await ghLoginOf(w.projects, repo)).toBe("out");

    mkdirSync(dirname(w.paths.workflowConfigFile), { recursive: true });
    writeFileSync(w.paths.workflowConfigFile, "{ not json");
    const answer = await workflowAnswer(w, repo);
    if ("error" in answer) throw new Error(answer.error);
    expect(answer.settings).toEqual([]);
    expect(answer.note).toContain("not valid JSON");
    expect(answer.base).toBe("main");
  });
});

test("an open pull request with the merge guard's own verdict", async () => {
  const w = testWorld({ clock: () => T0, gh: true });
  const repo = makeRepo("alpha");
  // A plain integration base, so the policy may merge into it by itself; no review gate.
  commitConfig(
    repo,
    {
      workflow: { allowMerge: true, reviewBeforePush: false },
      worktrees: { base: "integration" },
    },
    ["main", "integration"],
  );
  sessionRecord(w.paths.projectsDir, repo, "s-alpha", T0);

  const asked: string[][] = [];
  const run: GhRunner = async (args) => {
    asked.push(args);
    if (args[0] === "pr" && args[1] === "view" && args.includes("commits")) {
      return JSON.stringify({ commits: [{ oid: "c".repeat(40) }] });
    }
    if (args[0] === "pr" && args[1] === "list" && args.includes("number,headRefOid")) return "[]";
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([
        {
          baseRefName: "integration",
          headRefName: "feat/x",
          isDraft: false,
          number: 7,
          title: "Add x",
        },
      ]);
    }
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({
        baseRefName: "integration",
        headRefName: "feat/x",
        headRefOid: "c".repeat(40),
        number: 7,
      });
    }
    if (args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({ defaultBranchRef: { name: "main" } });
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return JSON.stringify([{ bucket: "pass", name: "ci" }]);
    }
    return null;
  };
  const world = { ...w.projects, gh: run };
  const answer = await projectBranches(world, await projectOf(world, repo));
  expect(answer.note).toBe(null);
  expect(answer.branches).toEqual([
    {
      base: "integration",
      branch: "feat/x",
      draft: false,
      kind: "pr",
      number: 7,
      title: "Add x",
      verdict: {
        detail: {
          allowance: null,
          delta: null,
          limits: { files: 10, lines: 200, percent: 20 },
          review: null,
          reviewed: null,
        },
        kind: "allowed",
        reason: "its required checks are green, and reviewBeforePush is off",
      },
    },
  ]);
  // The page's own list was asked once (it reuses its branch read); the other list is the
  // merge check's, of the open heads.
  const lists = asked.filter((one) => one[1] === "list" && !one.includes("number,headRefOid"));
  expect(lists).toHaveLength(1);
});
