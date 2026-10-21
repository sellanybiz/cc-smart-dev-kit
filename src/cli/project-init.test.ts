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
      "--bases",
      "hotfix/=main,release/=main",
      "--protected",
      "main,dev",
      "--guard-main-folder",
      "--session-names",
      "--job-route",
      "--workflow",
      "openPr=draft,autoCommit=true",
    ]);
    expect(parsed).toEqual({
      flags: {
        dryRun: true,
        yes: true,
        base: "dev",
        bases: { "hotfix/": "main", "release/": "main" },
        protectedBranches: ["main", "dev"],
        guardMainFolder: true,
        sessionNames: true,
        jobRoute: true,
        workflow: ["openPr=draft", "autoCommit=true"],
      },
    });
  });

  test("the deprecated engine's flags are accepted and ignored, not unknown", () => {
    expect(
      parseFlags([
        "--prefix",
        "app-wt-",
        "--setup",
        "bun install",
        "--no-setup",
        "--engine",
        "own",
      ]),
    ).toEqual({
      flags: {
        dryRun: false,
        yes: false,
        deprecatedFlags: ["--prefix", "--setup", "--no-setup", "--engine"],
      },
    });
    expect(parseFlags(["--prefix"])).toEqual({ error: "--prefix needs a value" });
    expect(parseFlags(["--base"])).toEqual({ error: "--base needs a value" });
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
      const answers = defaultAnswers(null, facts, { dryRun: false, yes: false });
      expect(answers.base).toBe("dev");
      expect(answers.protectedBranches).toEqual(["dev"]);
    });
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
    const facts = { defaultBranch: "main", protectedFromGithub: ["release"] };
    const flags = { dryRun: false, yes: false };
    const fromRepo = defaultAnswers(null, facts, flags);
    expect(fromRepo.base).toBe("main");
    // The deprecated engine's fields are never offered, and never written fresh.
    expect(fromRepo).not.toHaveProperty("prefix");
    expect(fromRepo).not.toHaveProperty("setup");
    expect(fromRepo).not.toHaveProperty("engine");
    expect(fromRepo.bases).toEqual({ "hotfix/": "main", "release/": "main" });
    expect(fromRepo.protectedBranches).toEqual(["main", "release"]);
    expect(fromRepo.guards).toEqual({
      guardMainFolder: true,
      sessionNames: true,
      jobRoute: false,
    });
    expect(fromRepo.workflow).toEqual({});

    const existing = {
      worktrees: { base: "dev", prefix: "my-wt-", setup: ["pnpm", "install"], engine: "own" },
      protectedBranches: ["dev"],
      sessionNames: false,
      jobs: { route: true },
      workflow: { autoCommit: true },
    };
    const fromFile = defaultAnswers(existing, facts, flags);
    expect(fromFile.base).toBe("dev");
    expect(fromFile.protectedBranches).toEqual(["dev"]);
    expect(fromFile.guards).toEqual({
      guardMainFolder: true,
      sessionNames: false,
      jobRoute: true,
    });
    expect(fromFile.workflow).toEqual({ autoCommit: true });

    const withFlags = defaultAnswers(existing, facts, {
      dryRun: false,
      yes: true,
      base: "integration",
      bases: { "release/": "main" },
      protectedBranches: ["integration"],
      guardMainFolder: false,
      sessionNames: true,
      jobRoute: false,
      workflow: ["openPr=ready"],
    });
    expect(withFlags.base).toBe("integration");
    expect(withFlags.bases).toEqual({ "release/": "main" });
    expect(withFlags.protectedBranches).toEqual(["integration"]);
    expect(withFlags.guards).toEqual({
      guardMainFolder: false,
      sessionNames: true,
      jobRoute: false,
    });
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
      { defaultBranch: "main", protectedFromGithub: [] },
      { dryRun: false, yes: false },
    );
    expect(askedAnswers(terminal, before)).toEqual(before);
    expect(asked).toContain("The branch a new worktree starts from");
    expect(asked).toContain(
      "Refuse edits in the main checkout itself, so every change goes in a worktree? (yes/no)",
    );
    // The deprecated engine's three questions are gone.
    expect(asked.some((question) => question.includes("worktree engine"))).toBe(false);
    expect(asked.some((question) => question.includes("folder-name prefix"))).toBe(false);
    expect(asked.some((question) => question.includes("run inside a new worktree"))).toBe(false);
  });

  test("the answers replace the defaults, and an empty one means none", () => {
    const answers: Record<string, string> = {
      "The branch a new worktree starts from": "dev",
      "Bases for other branch prefixes, as prefix=base,prefix=base (empty: none)": "release/=main",
      "The branches the git guard asks about before a push (comma separated)": "",
      "Name each session after its task? (yes/no)": "no",
      "Send heavy commands (type checks, test runs, builds) through the machine's job queue? (yes/no)":
        "yes",
    };
    const terminal: ProjectInitTerminal = {
      confirm: () => true,
      text: (question, fallback) => answers[question] ?? fallback,
    };
    const before = defaultAnswers(
      null,
      { defaultBranch: "main", protectedFromGithub: [] },
      { dryRun: false, yes: false },
    );
    const after = askedAnswers(terminal, before);
    expect(after.base).toBe("dev");
    expect(after.bases).toEqual({ "release/": "main" });
    expect(after.protectedBranches).toEqual([]);
    expect(after.guards.sessionNames).toBe(false);
    expect(after.guards.jobRoute).toBe(true);
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
        ["--yes", "--base", "dev", "--bases", "hotfix/=main"],
        run.context,
        runner({}, () => ({ ok: false, out: "", err: "" })),
      ),
    ).toBe(0);
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      worktrees: Record<string, unknown>;
      requires: string;
    };
    expect(written.worktrees.base).toBe("dev");
    expect(written.worktrees.bases).toEqual({ "hotfix/": "main" });
    // No prefix, setup or engine: every project uses Claude Code's own worktrees.
    expect(written.worktrees).not.toHaveProperty("prefix");
    expect(written.worktrees).not.toHaveProperty("setup");
    expect(written.worktrees).not.toHaveProperty("engine");
    // The base is not the repo's default branch: a worktree starts from the current branch.
    expect(JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"))).toEqual({
      worktree: { baseRef: "head" },
    });
    expect(run.lines).toContain("Commit both files with the project.");
    expect(run.lines.at(-1)).toBe(
      `The file asks for cc-smart-dev-kit ${written.requires}: every teammate needs that plugin version or newer.`,
    );
  });

  test("the deprecated engine's flags write nothing, and one ! line says they are ignored", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      runProjectInit(["--yes", "--prefix", "app-wt-", "--engine", "own"], run.context, runner({})),
    ).toBe(0);
    const written = JSON.parse(
      readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"),
    ) as { worktrees: Record<string, unknown> };
    expect(written.worktrees).not.toHaveProperty("prefix");
    expect(written.worktrees).not.toHaveProperty("engine");
    expect(run.lines).toContain(
      "! --prefix, --engine are deprecated and ignored: the plugin's worktree engine retires in the next minor version, and every project uses Claude Code's own worktrees",
    );
  });

  test("--yes with the default branch as the base writes no settings file", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
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

  test("a project file's deprecated engine fields are kept, and the flags never add one", () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-", setup: ["bun", "install"] } }, null, 2)}\n`,
    );
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as {
      worktrees: Record<string, unknown>;
    };
    expect(after.worktrees.prefix).toBe("app-wt-");
    expect(after.worktrees.setup).toEqual(["bun", "install"]);
    expect(after.worktrees).not.toHaveProperty("engine");
    expect(run.lines).toContain(
      "! the project's file still sets worktrees.prefix, worktrees.setup: the worktree engine is deprecated and retires in the next minor version; `cc-smart-dev-kit doctor` names the steps to move",
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

  test("`--yes` in a real repo writes the project's file, in this HOME's state folder", () => {
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
        "--base",
        "dev",
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
