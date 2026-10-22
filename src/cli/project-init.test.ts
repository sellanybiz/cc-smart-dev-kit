/** `cc-smart-dev-kit project init`: the flags, the defaults from the repo, and the run. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { parseCcSmartDevKitConfig } from "../project/config";
import { hookEnv, makeRepo } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
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
      // A temp HOME and config folder: D16's clash warning reads the person's own
      // `workflow.json` through them, never this machine's.
      env: hookEnv(),
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

  test.each(["--prefix", "--setup", "--no-setup", "--engine"])(
    "D20: the retired engine's flag %s is a usage mistake that says it is gone",
    (flag) => {
      expect(parseFlags(["--yes", flag, "app-wt-"])).toEqual({
        error: `${flag} is gone: the plugin's worktree engine was retired in 1.0.0, and Claude Code's own worktrees need none of its settings`,
      });
    },
  );

  test("D20: every yes/no question has its --no- flag, and the last one given wins", () => {
    expect(parseFlags(["--no-guard-main-folder", "--no-session-names", "--no-job-route"])).toEqual({
      flags: {
        dryRun: false,
        yes: false,
        guardMainFolder: false,
        sessionNames: false,
        jobRoute: false,
      },
    });
    expect(parseFlags(["--no-session-names", "--session-names"])).toEqual({
      flags: { dryRun: false, yes: false, sessionNames: true },
    });
  });

  test("a flag that needs a value, a bad value, and an unknown flag", () => {
    expect(parseFlags(["--base"])).toEqual({ error: "--base needs a value" });
    expect(parseFlags(["--bases", "hotfix"])).toEqual({
      error: '--bases: "hotfix" is not prefix=base (the prefix ends with "/")',
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
    expect(fromRepo.bases).toEqual({ "hotfix/": "main", "release/": "main" });
    expect(fromRepo.protectedBranches).toEqual(["main", "release"]);
    expect(fromRepo.guards).toEqual({
      guardMainFolder: true,
      sessionNames: true,
      jobRoute: false,
    });
    expect(fromRepo.workflow).toEqual({});

    const existing = {
      worktrees: { base: "dev" },
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

  test("D16: a policy whose settings cannot work together is named before anything is written", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft,autoMerge=true"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.lines).toContain(
      `! openPr opens a pull request, but autoPush is off: the git guard asks before the push that pull request needs, so it waits for you every time. Fix: turn autoPush on (\`${COMMAND} workflow set autoPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`).`,
    );
    expect(run.lines).toContain(
      `! openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens. Fix: set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`).`,
    );
    // The plan ran and wrote nothing: the warning is part of the plan, not of a later step.
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("D16: the person's own settings are part of the policy, so no clash is named wrongly", () => {
    const repo = makeRepo();
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ autoPush: true }, null, 2)}\n`);
    const run = context(repo, { env });
    expect(
      runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    // autoPush is on in the person's own file: the pull request needs no push they must approve.
    expect(run.lines.filter((line) => line.includes("but autoPush is off"))).toEqual([]);
  });

  test("D16: a personal file that cannot be read does not stop the plan", () => {
    const repo = makeRepo();
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const run = context(repo, { env });
    expect(
      runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.errors).toEqual([]);
    // Nothing is known about autoPush there: the default (off) is judged, and says so.
    expect(run.lines.some((line) => line.includes("but autoPush is off"))).toBe(true);
  });

  test("D20: a retired engine flag: exit 2, the reason and the usage, nothing written", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      runProjectInit(["--yes", "--prefix", "app-wt-", "--engine", "own"], run.context, runner({})),
    ).toBe(2);
    expect(run.errors[0]).toStartWith(
      "--prefix is gone: the plugin's worktree engine was retired in 1.0.0, and Claude Code's own worktrees need none of its settings\n\nUsage: cc-smart-dev-kit project init",
    );
    expect(run.lines).toEqual([]);
    expect(existsSync(join(repo, ".claude"))).toBe(false);
  });

  test("D20: --yes with the --no- flags writes both answers as off", () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      runProjectInit(
        ["--yes", "--no-guard-main-folder", "--no-session-names"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    const written = JSON.parse(
      readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"),
    ) as { worktrees: Record<string, unknown>; sessionNames?: boolean };
    expect(written.worktrees).not.toHaveProperty("guardMainFolder");
    expect(written).not.toHaveProperty("sessionNames");
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
    expect(asked).toContain("Write these files?");
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

  /** A project the retired engine left behind: its fields, and its lines in both settings files. */
  function engineLeftovers(): { repo: string; file: string; settings: string; local: string } {
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    writeFileSync(
      file,
      `${JSON.stringify({ worktrees: { base: "main", prefix: "app-wt-", setup: ["bun", "install"] } }, null, 2)}\n`,
    );
    const settings = join(repo, ".claude", "settings.json");
    writeFileSync(
      settings,
      `${JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create', timeout: 600 }] }], Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }] } }, null, 2)}\n`,
    );
    const local = join(repo, ".claude", "settings.local.json");
    writeFileSync(
      local,
      `${JSON.stringify({ hooks: { SubagentStop: [{ hooks: [{ type: "command", command: "cc-smart-dev-kit  hook  subagent-stop" }] }] } })}\n`,
    );
    return { repo, file, settings, local };
  }

  test("D20: --dry-run shows every - line the retired engine left, and writes nothing", () => {
    const { repo, file, settings, local } = engineLeftovers();
    const before = [file, settings, local].map((one) => readFileSync(one, "utf8"));
    const run = context(repo);
    expect(runProjectInit(["--dry-run", "--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toEqual([
      `${file} will hold:`,
      '  + protectedBranches: ["main"]',
      '  + requires: ">=0.5.2"',
      "  + sessionNames: true",
      '  + worktrees.bases.hotfix/: "main"',
      '  + worktrees.bases.release/: "main"',
      "  + worktrees.guardMainFolder: true",
      '  - worktrees.prefix: "app-wt-"',
      '  - worktrees.setup: ["bun","install"]',
      `${settings} also changes, merged with what it has:`,
      '  - hooks.WorktreeCreate: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create',
      `${local} also changes, merged with what it has:`,
      "  - hooks.SubagentStop: cc-smart-dev-kit  hook  subagent-stop",
      "! the plugin's worktree engine was retired in 1.0.0: worktrees.prefix, worktrees.setup and its hook lines go, because Claude Code's own worktrees need none",
      "A dry run: nothing was written.",
    ]);
    expect([file, settings, local].map((one) => readFileSync(one, "utf8"))).toEqual(before);
  });

  test("D20: --yes on the retired engine's leftovers writes a file that loads, and clean settings", () => {
    const { repo, file, settings, local } = engineLeftovers();
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    // The file the hooks read loads again: the same parse every hook runs.
    expect(parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file)).toEqual({
      requires: ">=0.5.2",
      worktrees: {
        base: "main",
        guardMainFolder: true,
        bases: { "hotfix/": "main", "release/": "main" },
      },
      protectedBranches: ["main"],
      sessionNames: true,
    });
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }] },
    });
    expect(readFileSync(local, "utf8")).toBe("{}\n");
    expect(run.lines).toContain(`~ ${file}`);
    expect(run.lines).toContain(`~ ${settings}`);
    expect(run.lines).toContain(`~ ${local}`);
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

describe("what the file asks for", () => {
  test("running init again leaves a file that already asks for the floor alone", () => {
    // The floor is the plugin that made `worktrees.prefix` optional (0.5.2): a file without
    // that field is refused by every older plugin, so the file asks for 0.5.2 or newer.
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ requires: ">=0.5.2", worktrees: { base: "main" } }, null, 2)}\n`,
    );
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect((JSON.parse(readFileSync(file, "utf8")) as { requires: string }).requires).toBe(
      ">=0.5.2",
    );
    expect(run.lines.at(-1)).toBe(
      "The file asks for cc-smart-dev-kit >=0.5.2: every teammate needs that plugin version or newer.",
    );
  });

  test("a file that asks for a newer plugin keeps its own range", () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ requires: ">=1.0", worktrees: { base: "main" } }, null, 2)}\n`,
    );
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect((JSON.parse(readFileSync(file, "utf8")) as { requires: string }).requires).toBe(">=1.0");
  });
});

describe("the file this command writes is one the plugin accepts", () => {
  test("CM-3: a --bases prefix without the trailing slash is refused, and nothing is written", () => {
    // The schema refuses a prefix that does not end with "/" (it is a branch-name prefix), so
    // writing this one made every later reader — the hooks, doctor, the plugin itself — refuse
    // the project the person had just set up.
    const repo = makeRepo();
    const run = context(repo);
    expect(runProjectInit(["--yes", "--bases", "release=dev"], run.context, runner({}))).toBe(2);
    expect(run.errors[0]).toContain('"release=dev" is not prefix=base');
    expect(run.errors[0]).toContain('ends with "/"');
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("CM-3: a blank answer to --base or --bases is a usage mistake", () => {
    expect(parseFlags(["--yes", "--base", ""])).toEqual({ error: "--base needs a value" });
    expect(parseFlags(["--yes", "--bases", ""])).toEqual({ error: "--bases needs a value" });
  });

  test("CM-3: the plan is refused before the write when the plugin would refuse the file", () => {
    // The project's own file holds a key no version of cc-smart-dev-kit knows: writing the
    // plan back would keep it, and every reader would refuse the project from then on.
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const before = `{\n  "requires": ">=0.4",\n  "worktree": {\n    "base": "main"\n  }\n}\n`;
    writeFileSync(file, before);
    const run = context(repo);
    expect(runProjectInit(["--yes"], run.context, runner({}))).toBe(1);
    expect(run.errors[0]).toContain(file);
    expect(run.errors[0]).toContain("worktree");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
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
