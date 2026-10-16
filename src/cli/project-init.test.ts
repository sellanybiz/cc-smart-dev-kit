/** `cc-smart-dev-kit project init`: the flags, the defaults from the repo, and the run. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  askedAnswers,
  defaultAnswers,
  defaultBranchOf,
  detectFacts,
  type ProjectInitContext,
  type ProjectInitRunner,
  type ProjectInitTerminal,
  parseFlags,
  protectedFromGithub,
  realRunner,
  runProjectInit,
  setupFromLockfile,
  shownBases,
  shownWorkflow,
  workflowFromFlags,
} from "./project-init";

function context(
  root: string,
  overrides: Partial<ProjectInitContext> = {},
): { context: ProjectInitContext; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    context: {
      root,
      env: {},
      stateDir: tempDir("project-init-state"),
      home: tempDir("project-init-home"),
      terminal: null,
      print: (line) => lines.push(line),
      error: (line) => errors.push(line),
      ...overrides,
    },
  };
}

/** A runner whose git answers are the test's, and whose `gh` is the test's or absent. */
function runner(
  answers: Record<string, string>,
  gh: ProjectInitRunner["gh"] = null,
): ProjectInitRunner {
  return {
    git: (_cwd, args) => {
      const key = args.join(" ");
      const out = answers[key];
      return out === undefined
        ? { ok: false, out: "", err: "not found" }
        : { ok: true, out, err: "" };
    },
    gh,
  };
}

describe("the flags", () => {
  test("every flag, and the value each takes", () => {
    const parsed = parseFlags([
      "--dry-run",
      "--yes",
      "--base",
      "dev",
      "--prefix",
      "app-wt-",
      "--setup",
      "bun install",
      "--bases",
      "hotfix/=main,release/=main",
      "--protected",
      "main,dev",
      "--guard-main-folder",
      "--session-names",
      "--job-route",
      "--engine",
      "own",
      "--workflow",
      "openPr=draft,autoCommit=true",
    ]);
    expect(parsed).toEqual({
      flags: {
        dryRun: true,
        yes: true,
        base: "dev",
        prefix: "app-wt-",
        setup: ["bun", "install"],
        bases: { "hotfix/": "main", "release/": "main" },
        protectedBranches: ["main", "dev"],
        guardMainFolder: true,
        sessionNames: true,
        jobRoute: true,
        engine: "own",
        workflow: ["openPr=draft", "autoCommit=true"],
      },
    });
  });

  test("--no-setup writes no setup command", () => {
    expect(parseFlags(["--no-setup"])).toEqual({
      flags: { dryRun: false, yes: false, setup: null },
    });
  });

  test("an unknown flag, a missing value, and a wrong engine: one error each", () => {
    expect(parseFlags(["--base"])).toEqual({ error: "--base needs a value" });
    expect(parseFlags(["--engine", "solo"])).toEqual({ error: '--engine is "plugin" or "own"' });
    expect(parseFlags(["--bases", "hotfix"])).toEqual({
      error: '--bases: "hotfix" is not prefix=base',
    });
    expect(parseFlags(["--fast"])).toEqual({ error: "Unknown option: --fast" });
  });

  test("the workflow words become the policy the schema holds", () => {
    expect(workflowFromFlags(["openPr=draft", "alerts.events=finished failed"])).toEqual({
      openPr: "draft",
      alerts: { events: ["finished", "failed"] },
    });
    expect(() => workflowFromFlags(["autoMerge=maybe"])).toThrow("autoMerge is true or false");
    expect(() => workflowFromFlags(["switches.statusLine=true"])).toThrow(
      "unknown setting switches.statusLine",
    );
  });

  test("a policy is shown as one line, and read back", () => {
    expect(shownWorkflow({ openPr: "draft", alerts: { sound: true } })).toBe(
      "openPr=draft,alerts.sound=true",
    );
    expect(shownBases({ "hotfix/": "main" })).toBe("hotfix/=main");
  });
});

describe("the defaults from the repo", () => {
  test("the default branch comes from origin/HEAD; a git that cannot answer leaves main", () => {
    const root = tempDir("project-init");
    const known = runner({ "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/dev" });
    expect(detectFacts(known, root).defaultBranch).toBe("dev");
    expect(detectFacts(runner({}), root).defaultBranch).toBe("main");
  });

  describe("the base branch is one the repo really has", () => {
    /** A real repo with these local branches, the first one checked out. */
    function repoWith(branches: string[], originHead?: string): string {
      const repo = join(tempDir("project-init-repo"), "repo");
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", branches[0] ?? "main");
      writeFileSync(join(repo, "README.md"), "hello\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-q", "-m", "first");
      for (const branch of branches.slice(1)) git(repo, "branch", branch);
      if (originHead !== undefined) {
        git(repo, "update-ref", `refs/remotes/origin/${originHead}`, "HEAD");
        git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${originHead}`);
      }
      return repo;
    }

    test("origin/HEAD wins; otherwise the branches the repo has", () => {
      // The bug this was written for: a repo whose only branch is `dev` was offered `main`, a
      // branch that is not in it, and the form and the plan then named it. Real repos and real
      // git: the fake runner cannot answer a question about what a repo holds.
      const gitRunner = () => realRunner(cleanGitEnv());
      expect(defaultBranchOf(gitRunner(), repoWith(["main", "dev"], "dev"))).toBe("dev");

      // One local branch: that one, whatever it is called.
      expect(defaultBranchOf(gitRunner(), repoWith(["dev"]))).toBe("dev");
      expect(defaultBranchOf(gitRunner(), repoWith(["trunk"]))).toBe("trunk");

      // Several, no origin/HEAD: `main`, then `master`, then the branch that is checked out.
      expect(defaultBranchOf(gitRunner(), repoWith(["dev", "main"]))).toBe("main");
      expect(defaultBranchOf(gitRunner(), repoWith(["dev", "master"]))).toBe("master");
      expect(defaultBranchOf(gitRunner(), repoWith(["dev", "work"]))).toBe("dev");
    });

    test("a repo with one branch is set up around that branch", () => {
      // The other end of the same bug: `project init`'s own answers name the base and the
      // protected branches, so a wrong base put a branch that is not in the repo into both.
      const only = repoWith(["dev"]);
      const facts = detectFacts(realRunner(cleanGitEnv()), only);
      const answers = defaultAnswers(null, facts, { dryRun: false, yes: false }, only);
      expect(answers.base).toBe("dev");
      expect(answers.protectedBranches).toEqual(["dev"]);
    });
  });

  test("the setup command comes from the lockfile", () => {
    const root = tempDir("project-init");
    expect(setupFromLockfile(root)).toBeNull();
    writeFileSync(join(root, "package-lock.json"), "{}");
    expect(setupFromLockfile(root)).toEqual(["npm", "ci"]);
    writeFileSync(join(root, "bun.lock"), "");
    expect(setupFromLockfile(root)).toEqual(["bun", "install"]);
    const pnpm = tempDir("project-init");
    writeFileSync(join(pnpm, "pnpm-lock.yaml"), "");
    expect(setupFromLockfile(pnpm)).toEqual(["pnpm", "install"]);
    const yarn = tempDir("project-init");
    writeFileSync(join(yarn, "yarn.lock"), "");
    expect(setupFromLockfile(yarn)).toEqual(["yarn"]);
  });

  test("GitHub's protected branches are read with gh, and quietly skipped without it", () => {
    const origin = "git@github.com:example-org/my-app.git";
    const gh: ProjectInitRunner["gh"] = (args) => {
      expect(args).toEqual([
        "api",
        "repos/example-org/my-app/rulesets?per_page=100",
        "--jq",
        '.[] | select(.target == "branch") | .conditions.ref_name.include[]?',
      ]);
      return { ok: true, out: "refs/heads/main\nrefs/heads/staging\n", err: "" };
    };
    const root = tempDir("project-init");
    const withGh = runner({ "remote get-url origin": origin }, gh);
    expect(protectedFromGithub(withGh, root)).toEqual(["main", "staging"]);
    // No gh at all, no remote, and a gh that fails: no names, and no error.
    expect(protectedFromGithub(runner({ "remote get-url origin": origin }), root)).toEqual([]);
    expect(protectedFromGithub(runner({}, gh), root)).toEqual([]);
    expect(
      protectedFromGithub(
        runner({ "remote get-url origin": origin }, () => ({
          ok: false,
          out: "",
          err: "no login",
        })),
        root,
      ),
    ).toEqual([]);
  });

  test("a flag wins, then the project's own file, then the repo", () => {
    const root = tempDir("project-init");
    const facts = { defaultBranch: "main", setup: ["npm", "ci"], protectedFromGithub: ["release"] };
    const flags = { dryRun: false, yes: false };
    const fromRepo = defaultAnswers(null, facts, flags, root);
    expect(fromRepo.base).toBe("main");
    expect(fromRepo.prefix).toBe(`${root.split("/").at(-1) ?? ""}-wt-`);
    expect(fromRepo.setup).toEqual(["npm", "ci"]);
    expect(fromRepo.bases).toEqual({ "hotfix/": "main", "release/": "main" });
    expect(fromRepo.protectedBranches).toEqual(["main", "release"]);
    expect(fromRepo.guards).toEqual({
      guardMainFolder: true,
      sessionNames: true,
      jobRoute: false,
    });
    expect(fromRepo.engine).toBe("plugin");
    expect(fromRepo.workflow).toEqual({});

    const existing = {
      worktrees: { base: "dev", prefix: "my-wt-", setup: ["pnpm", "install"], engine: "own" },
      protectedBranches: ["dev"],
      sessionNames: false,
      jobs: { route: true },
      workflow: { autoCommit: true },
    };
    const fromFile = defaultAnswers(existing, facts, flags, root);
    expect(fromFile.base).toBe("dev");
    expect(fromFile.prefix).toBe("my-wt-");
    expect(fromFile.setup).toEqual(["pnpm", "install"]);
    expect(fromFile.protectedBranches).toEqual(["dev"]);
    expect(fromFile.guards).toEqual({
      guardMainFolder: true,
      sessionNames: false,
      jobRoute: true,
    });
    expect(fromFile.engine).toBe("own");
    expect(fromFile.workflow).toEqual({ autoCommit: true });

    const withFlags = defaultAnswers(
      existing,
      facts,
      {
        dryRun: false,
        yes: true,
        base: "integration",
        prefix: "w-",
        setup: ["yarn"],
        bases: { "release/": "main" },
        protectedBranches: ["integration"],
        guardMainFolder: false,
        sessionNames: true,
        jobRoute: false,
        engine: "plugin",
        workflow: ["openPr=ready"],
      },
      root,
    );
    expect(withFlags.base).toBe("integration");
    expect(withFlags.prefix).toBe("w-");
    expect(withFlags.setup).toEqual(["yarn"]);
    expect(withFlags.bases).toEqual({ "release/": "main" });
    expect(withFlags.protectedBranches).toEqual(["integration"]);
    expect(withFlags.guards).toEqual({
      guardMainFolder: false,
      sessionNames: true,
      jobRoute: false,
    });
    expect(withFlags.engine).toBe("plugin");
    expect(withFlags.workflow).toEqual({ openPr: "ready" });
  });
});

describe("the questions on a terminal", () => {
  test("pressing enter on every question keeps every default", () => {
    const asked: string[] = [];
    const terminal: ProjectInitTerminal = {
      confirm: (question) => {
        asked.push(question);
        return true;
      },
      text: (question, fallback) => {
        asked.push(question);
        return fallback;
      },
    };
    const before = defaultAnswers(
      null,
      { defaultBranch: "main", setup: null, protectedFromGithub: [] },
      { dryRun: false, yes: false },
      "/code/my-app",
    );
    expect(askedAnswers(terminal, before)).toEqual(before);
    expect(asked).toContain("The branch a new worktree starts from");
    expect(asked).toContain(
      "Refuse edits in the main checkout itself, so every change goes in a worktree? (yes/no)",
    );
    expect(asked).toContain(
      'Who makes this project\'s worktrees: "plugin" (cc-smart-dev-kit\'s engine) or "own" (your own)?',
    );
  });

  test("the answers replace the defaults, and an empty one means none", () => {
    const answers: Record<string, string> = {
      "The branch a new worktree starts from": "dev",
      "The folder-name prefix of a worktree beside the repo": "app-wt-",
      'The command run inside a new worktree (words, like "bun install"; empty: none)': "",
      "Bases for other branch prefixes, as prefix=base,prefix=base (empty: none)": "release/=main",
      "The branches the git guard asks about before a push (comma separated)": "",
      "Name each session after its task? (yes/no)": "no",
      'Who makes this project\'s worktrees: "plugin" (cc-smart-dev-kit\'s engine) or "own" (your own)?':
        "own",
      "Send heavy commands (type checks, test runs, builds) through the machine's job queue? (yes/no)":
        "yes",
    };
    const terminal: ProjectInitTerminal = {
      confirm: () => true,
      text: (question, fallback) => answers[question] ?? fallback,
    };
    const before = defaultAnswers(
      null,
      { defaultBranch: "main", setup: null, protectedFromGithub: [] },
      { dryRun: false, yes: false },
      "/code/my-app",
    );
    const after = askedAnswers(terminal, before);
    expect(after.base).toBe("dev");
    expect(after.prefix).toBe("app-wt-");
    expect(after.setup).toBeNull();
    expect(after.bases).toEqual({ "release/": "main" });
    expect(after.protectedBranches).toEqual([]);
    expect(after.guards.sessionNames).toBe(false);
    expect(after.guards.jobRoute).toBe(true);
    expect(after.engine).toBe("own");
  });
});

describe("the run", () => {
  test("no terminal and no --yes: the plan, and nothing written", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit([], run.context, runner({}))).toBe(0);
    expect(run.lines[0]).toBe(`${join(repo, ".claude", "cc-smart-dev-kit.json")} will hold:`);
    expect(run.lines).toContain("Nothing was written: run this on a terminal, or add --yes.");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
  });

  test("--yes writes both files, and says to commit them", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      runProjectInit(
        ["--yes", "--base", "dev", "--prefix", "app-wt-", "--bases", "hotfix/=main"],
        run.context,
        runner({}, () => ({ ok: false, out: "", err: "" })),
      ),
    ).toBe(0);
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      worktrees: { base: string; prefix: string; bases: Record<string, string> };
      requires: string;
    };
    expect(written.worktrees.base).toBe("dev");
    expect(written.worktrees.prefix).toBe("app-wt-");
    expect(written.worktrees.bases).toEqual({ "hotfix/": "main" });
    expect(
      (
        JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8")) as {
          hooks: Record<string, unknown>;
        }
      ).hooks.WorktreeCreate,
    ).toBeDefined();
    expect(run.lines.at(-1)).toBe(
      `The file asks for cc-smart-dev-kit ${written.requires}: every teammate needs that plugin version or newer.`,
    );
  });

  test("--dry-run prints the plan and writes nothing, also with --yes", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--dry-run", "--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain("A dry run: nothing was written.");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("an existing file: --yes keeps every field the flags do not set", () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const run = context(repo);
    runProjectInit(["--yes", "--base", "dev"], run.context, runner({}));
    const first = readFileSync(file, "utf8");
    const before = JSON.parse(first) as Record<string, unknown>;
    // A field a person added by hand stays, and the flags' answers do not touch it.
    writeFileSync(file, `${JSON.stringify({ ...before, autoMode: ["one rule"] }, null, 2)}\n`);
    const again = context(repo);
    expect(runProjectInit(["--yes"], again.context, runner({}))).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after.autoMode).toEqual(["one rule"]);
    expect((after.worktrees as { base: string }).base).toBe("dev");
    expect((after.protectedBranches as string[]).includes("dev")).toBe(true);
  });

  test("the questions, answered on a terminal, are what gets written", () => {
    const repo = makeRepo();
    const asked: string[] = [];
    const run = context(repo, {
      terminal: {
        confirm: (question) => {
          asked.push(question);
          return true;
        },
        text: (question, fallback) => {
          asked.push(question);
          return question === "The branch a new worktree starts from" ? "integration" : fallback;
        },
      },
    });
    expect(runProjectInit([], run.context, runner({}))).toBe(0);
    expect(
      (
        JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8")) as {
          worktrees: { base: string };
        }
      ).worktrees.base,
    ).toBe("integration");
    expect(asked).toContain("Write these two files?");
  });

  test("a no to the last question leaves both files alone", () => {
    const repo = makeRepo();
    const run = context(repo, {
      terminal: { confirm: () => false, text: (_question, fallback) => fallback },
    });
    expect(runProjectInit([], run.context, runner({}))).toBe(0);
    expect(run.lines.at(-1)).toBe("Left alone.");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("engine own: the project's file only, no hook lines", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--yes", "--engine", "own"], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
    expect(
      (
        JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8")) as {
          worktrees: { engine: string };
        }
      ).worktrees.engine,
    ).toBe("own");
    expect(run.lines).toContain(
      '! engine "own": no cc-smart-dev-kit hook lines are added to .claude/settings.json — your own engine makes this project\'s worktrees; `cc-smart-dev-kit doctor` expects none',
    );
  });

  test("a flag cc-smart-dev-kit does not know: exit 2, nothing written", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--yes", "--fast"], run.context, runner({}))).toBe(2);
    expect(run.errors[0]).toContain("Unknown option: --fast");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("--help prints the flags and writes nothing", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--help"], run.context, runner({}))).toBe(0);
    expect(run.lines[0]).toContain("Usage: cc-smart-dev-kit project init");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });
});

describe("the command itself, as Claude Code runs it", () => {
  test("`--help` works outside a git project, and writes nothing", () => {
    const home = tempDir("init-cli-home");
    const guard = subprocessGuard();
    const result = Bun.spawnSync(
      [
        process.execPath,
        ...guard.args,
        join(import.meta.dir, "..", "entries", "cli.ts"),
        "project",
        "init",
        "--help",
      ],
      {
        cwd: tempDir("init-cli-cwd"),
        env: { ...hookEnv(), HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ...guard.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toStartWith("Usage: cc-smart-dev-kit project init");
    expect(result.stderr.toString()).toBe("");
  });

  test("`--yes` in a real repo writes both files, in this HOME's state folder", () => {
    const home = tempDir("init-cli-home");
    const repo = makeRepo();
    const guard = subprocessGuard();
    const result = Bun.spawnSync(
      [
        process.execPath,
        ...guard.args,
        join(import.meta.dir, "..", "entries", "cli.ts"),
        "project",
        "init",
        "--yes",
      ],
      {
        cwd: repo,
        env: { ...hookEnv(), HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ...guard.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Commit both files with the project.");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
    // The backups went to this HOME's state folder, never the real one.
    expect(existsSync(join(home, ".claude", "cc-smart-dev-kit", "backups"))).toBe(true);
  });
});
