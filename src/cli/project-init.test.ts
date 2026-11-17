/** `cc-smart-dev-kit project init`: the flags, the defaults from the repo, and the run. */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { parseCcSmartDevKitConfig } from "../project/config";
import { staleBlocks } from "../project/deploy-skill";
import { hookEnv, makeRepo } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { cliPaths } from "./paths";
import {
  askedAnswers,
  defaultAnswers,
  defaultBranchOf,
  defaultFastCheck,
  detectFacts,
  type ProjectInitContext,
  type ProjectInitRunner,
  parseFlags,
  protectedFromGithub,
  realRunner,
  runProjectInit,
  shownBases,
  shownWorkflow,
  workflowFromFlags,
} from "./project-init";
import { createOut, type Sink } from "./ui/out";
import { createPrompts, type Prompts } from "./ui/prompt";
import { detectTerminal, type Terminal } from "./ui/terminal";

const PLAIN: Terminal = detectTerminal({ env: {}, isTTY: false, platform: "linux" });
const RICH: Terminal = detectTerminal({ columns: 100, env: {}, isTTY: true, platform: "linux" });

/** A sink that keeps each printed line, as a person reads it. */
function lineSink(lines: string[]): Sink {
  return { line: (text) => lines.push(text), raw: (text) => lines.push(text) };
}

/**
 * Prompts on a scripted terminal: each question takes the next typed answer (null: Enter, or
 * the end of the input), and everything it shows is kept, in order.
 */
function scripted(answers: (string | null)[]): { prompts: Prompts; shown: string[] } {
  const shown: string[] = [];
  const prompts = createPrompts(PLAIN, {
    write: (text) => shown.push(text),
    readLine: (question) => {
      shown.push(`${question} `);
      return answers.shift() ?? null;
    },
  });
  return { prompts, shown };
}

/** What a run with --no-deploy-block in a project with no deploy skill reads under its plan, by hand. */
const NO_DEPLOY_SKILL_TEXT = "no deploy block found in .claude/skills: nothing to remove";
const NO_DEPLOY_SKILL = `· ${NO_DEPLOY_SKILL_TEXT}`;

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

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
      prompts: null,
      out: createOut(PLAIN, lineSink(lines)),
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

/** The same answers, every one a promise: the portal's asynchronous runner. */
function asyncRunner(
  answers: Record<string, string>,
  gh: ProjectInitRunner["gh"] = null,
): ProjectInitRunner {
  const sync = runner(answers, gh);
  return {
    git: async (cwd, args) => sync.git(cwd, args),
    gh: gh === null ? null : async (args) => gh(args),
  };
}

describe("the flags", () => {
  test("every flag, and the value each takes", async () => {
    const parsed = parseFlags([
      "--dry-run",
      "--yes",
      "--base",
      "dev",
      "--bases",
      "hotfix/=main,release/=main",
      "--protected",
      "main,dev",
      "--check",
      "bun run typecheck",
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
        check: "bun run typecheck",
        guardMainFolder: true,
        sessionNames: true,
        jobRoute: true,
        workflow: ["openPr=draft", "autoCommit=true"],
      },
    });
  });

  test("the fast check has both answers: a command, and --no-check (the last one wins)", async () => {
    expect(parseFlags(["--no-check"])).toEqual({
      flags: { dryRun: false, yes: false, check: "" },
    });
    expect(parseFlags(["--check", "bun run check", "--no-check"])).toEqual({
      flags: { dryRun: false, yes: false, check: "" },
    });
    expect(parseFlags(["--check"])).toEqual({ error: "--check needs a value" });
  });

  test.each(["--prefix", "--setup", "--no-setup", "--engine"])(
    "D20: the retired engine's flag %s is a usage mistake that says it is gone",
    (flag) => {
      expect(parseFlags(["--yes", flag, "app-wt-"])).toEqual({
        error: `${flag} is gone: the plugin's worktree engine was retired in 1.0.0, and Claude Code's own worktrees need none of its settings`,
      });
    },
  );

  test("D20: every yes/no question has its --no- flag, and the last one given wins", async () => {
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

  test("a flag that needs a value, a bad value, and an unknown flag", async () => {
    expect(parseFlags(["--base"])).toEqual({ error: "--base needs a value" });
    expect(parseFlags(["--bases", "hotfix"])).toEqual({
      error: '--bases: "hotfix" is not prefix=base (the prefix ends with "/")',
    });
    expect(parseFlags(["--fast"])).toEqual({ error: "Unknown option: --fast" });
  });

  test("the workflow words become the policy the schema holds", async () => {
    expect(workflowFromFlags(["openPr=draft", "alerts.usagePercent=90"])).toEqual({
      openPr: "draft",
      alerts: { usagePercent: 90 },
    });
    expect(() => workflowFromFlags(["autoMerge=maybe"])).toThrow("autoMerge is true or false");
    expect(() => workflowFromFlags(["switches.statusLine=true"])).toThrow(
      "unknown setting switches.statusLine",
    );
  });

  test("a policy is shown as one line, and read back", async () => {
    expect(shownWorkflow({ openPr: "draft", alerts: { usagePercent: 90 } })).toBe(
      "openPr=draft,alerts.usagePercent=90",
    );
    expect(shownBases({ "hotfix/": "main" })).toBe("hotfix/=main");
  });
});

describe("the defaults from the repo", () => {
  test("the default branch comes from origin/HEAD; a git that cannot answer leaves main", async () => {
    const root = tempDir("project-init");
    const known = runner({ "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/dev" });
    expect((await detectFacts(known, root)).defaultBranch).toBe("dev");
    expect((await detectFacts(runner({}), root)).defaultBranch).toBe("main");
  });

  test("an awaited runner (the portal's) answers exactly what a synchronous one does", async () => {
    // The portal's Project card hands the CLI's own detection an asynchronous runner
    // (`realRunnerAsync`, `Bun.spawn`): `gh api` can take seconds, and a page load must never
    // freeze on it. The reads are awaited the same way, and the facts are the same.
    const root = tempDir("project-init-async");
    const answers = { "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/dev" };
    const sync = await detectFacts(runner(answers), root);
    const awaited = await detectFacts(asyncRunner(answers), root);
    expect(awaited).toEqual(sync);
    expect(awaited.defaultBranch).toBe("dev");
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

    test("origin/HEAD wins; otherwise the branches the repo has", async () => {
      // The bug this was written for: a repo whose only branch is `dev` was offered `main`, a
      // branch that is not in it, and the form and the plan then named it. Real repos and real
      // git: the fake runner cannot answer a question about what a repo holds.
      const gitRunner = () => realRunner(cleanGitEnv());
      expect(await defaultBranchOf(gitRunner(), repoWith(["main", "dev"], "dev"))).toBe("dev");

      // One local branch: that one, whatever it is called.
      expect(await defaultBranchOf(gitRunner(), repoWith(["dev"]))).toBe("dev");
      expect(await defaultBranchOf(gitRunner(), repoWith(["trunk"]))).toBe("trunk");

      // Several, no origin/HEAD: `main`, then `master`, then the branch that is checked out.
      expect(await defaultBranchOf(gitRunner(), repoWith(["dev", "main"]))).toBe("main");
      expect(await defaultBranchOf(gitRunner(), repoWith(["dev", "master"]))).toBe("master");
      expect(await defaultBranchOf(gitRunner(), repoWith(["dev", "work"]))).toBe("dev");
    });

    test("a repo with one branch is set up around that branch", async () => {
      // The other end of the same bug: `project init`'s own answers name the base and the
      // protected branches, so a wrong base put a branch that is not in the repo into both.
      const only = repoWith(["dev"]);
      const facts = await detectFacts(realRunner(cleanGitEnv()), only);
      const answers = defaultAnswers(null, facts, { dryRun: false, yes: false });
      expect(answers.base).toBe("dev");
      expect(answers.protectedBranches).toEqual(["dev"]);
    });
  });

  test("GitHub's protected branches are read with gh, and quietly skipped without it", async () => {
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
    expect(await protectedFromGithub(withGh, root)).toEqual(["main", "staging"]);
    // No gh at all, no remote, and a gh that fails: no names, and no error.
    expect(await protectedFromGithub(runner({ "remote get-url origin": origin }), root)).toEqual(
      [],
    );
    expect(await protectedFromGithub(runner({}, gh), root)).toEqual([]);
    expect(
      await protectedFromGithub(
        runner({ "remote get-url origin": origin }, () => ({
          ok: false,
          out: "",
          err: "no login",
        })),
        root,
      ),
    ).toEqual([]);
  });

  test("the fast check comes from package.json's scripts, with the lockfile's package manager", async () => {
    const root = tempDir("project-init");
    expect(defaultFastCheck(root)).toBe(null);
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ scripts: { build: "tsc" } })}\n`);
    // A script that does not check anything is no default.
    expect(defaultFastCheck(root)).toBe(null);
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ scripts: { test: "bun test", typecheck: "tsc --noEmit" } })}\n`,
    );
    // No lockfile: npm is the one that is there with any Node.
    expect(defaultFastCheck(root)).toBe("npm run typecheck");
    writeFileSync(join(root, "bun.lock"), "");
    expect(defaultFastCheck(root)).toBe("bun run typecheck");
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ scripts: { check: "bun run typecheck && bun test" } })}\n`,
    );
    // A script named `check` is the project's own word for it: it wins over the others.
    expect(defaultFastCheck(root)).toBe("bun run check");
  });

  test("a broken package.json, or a scripts list that is not one: no default", async () => {
    const root = tempDir("project-init");
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(defaultFastCheck(root)).toBe(null);
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ scripts: ["check"] })}\n`);
    expect(defaultFastCheck(root)).toBe(null);
  });

  test("the fast check: the flag wins, then the project's file, then the repo", async () => {
    const facts = {
      defaultBranch: "main",
      protectedFromGithub: [],
      fastCheck: "bun run typecheck",
    };
    const flags = { dryRun: false, yes: false };
    expect(defaultAnswers(null, facts, flags).checks).toEqual({ fast: "bun run typecheck" });
    // The file's own answer wins over what the repo suggests.
    expect(defaultAnswers({ checks: { fast: "bun run check" } }, facts, flags).checks).toEqual({
      fast: "bun run check",
    });
    // A flag wins over both, and --no-check is a real answer: none, even over the file.
    expect(
      defaultAnswers({ checks: { fast: "bun run check" } }, facts, { ...flags, check: "bun test" })
        .checks,
    ).toEqual({ fast: "bun test" });
    expect(
      defaultAnswers({ checks: { fast: "bun run check" } }, facts, { ...flags, check: "" }).checks,
    ).toBe(null);
    // The repo suggests nothing: no check, unless the file says one.
    expect(defaultAnswers(null, { ...facts, fastCheck: null }, flags).checks).toBe(null);
  });

  test("a flag wins, then the project's own file, then the repo", async () => {
    const facts = { defaultBranch: "main", protectedFromGithub: ["release"], fastCheck: null };
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
    // A --workflow word changes only what it names: the file's own setting stays (F5-3).
    expect(withFlags.workflow).toEqual({ autoCommit: true, openPr: "ready" });
  });

  test("--workflow merges into the file's policy: a key changes only its own field (F5-3)", async () => {
    const facts = { defaultBranch: "main", protectedFromGithub: [], fastCheck: null };
    const existing = {
      worktrees: { base: "main" },
      workflow: {
        alerts: { sound: true, usagePercent: 80 },
        fixesAfterReview: { lines: 120, percent: 30 },
      },
    };
    // One flat key: the two groups the line does not name survive whole.
    const flatRaw: unknown = defaultAnswers(existing, facts, {
      dryRun: false,
      yes: true,
      workflow: ["autoPush=true"],
    }).workflow;
    expect(flatRaw).toEqual({
      alerts: { sound: true, usagePercent: 80 },
      fixesAfterReview: { lines: 120, percent: 30 },
      autoPush: true,
    });
    // One dotted key: only that field changes, its group's other fields stay.
    const dottedRaw: unknown = defaultAnswers(existing, facts, {
      dryRun: false,
      yes: true,
      workflow: ["fixesAfterReview.lines=200"],
    }).workflow;
    expect(dottedRaw).toEqual({
      alerts: { sound: true, usagePercent: 80 },
      fixesAfterReview: { lines: 200, percent: 30 },
    });
  });
});

describe("the questions on a terminal", () => {
  const DEFAULTS = defaultAnswers(
    null,
    { defaultBranch: "main", protectedFromGithub: [], fastCheck: null },
    { dryRun: false, yes: false },
  );

  test("UX-12: Enter on every question keeps every default; each question is counted, with its default", async () => {
    const { prompts, shown } = scripted([]);
    expect(askedAnswers(prompts, DEFAULTS)).toEqual(DEFAULTS);
    expect(shown).toEqual([
      "[1/8] Base branch: the branch a new worktree starts from [main] ",
      '[2/8] Bases for other branch prefixes, as prefix=base,prefix=base ("none" for none) [hotfix/=main,release/=main] ',
      '[3/8] Protected branches: the git guard asks before a push to these, comma separated ("none" for none) [main] ',
      '[4/8] The fast check a session runs before it stops: one command ("none" for none) [none] ',
      '[5/8] Workflow policy: what happens by itself after a step, as openPr=draft,autoCommit=true,alerts.usagePercent=90 ("none" for none) ',
      "[6/8] Refuse edits in the main checkout itself, so every change goes in a worktree? [Y/n] ",
      "[7/8] Name each session after its task? [Y/n] ",
      "[8/8] Send heavy commands (type checks, test runs, builds) through the machine's job queue, so they take turns? [y/N] ",
    ]);
  });

  test('the answers replace the defaults, and "none" empties a list', () => {
    const { prompts } = scripted([
      "dev",
      "release/=main",
      "none",
      "bun test src/changed",
      null,
      null,
      "no",
      "yes",
    ]);
    const after = askedAnswers(prompts, DEFAULTS);
    expect(after.base).toBe("dev");
    expect(after.bases).toEqual({ "release/": "main" });
    expect(after.protectedBranches).toEqual([]);
    expect(after.checks).toEqual({ fast: "bun test src/changed" });
    expect(after.guards).toEqual({ guardMainFolder: true, sessionNames: false, jobRoute: true });
    expect(after.workflow).toEqual({});
  });

  test('"none" on the fast check writes none: the field goes', () => {
    const { prompts } = scripted(["main", null, null, "none"]);
    expect(askedAnswers(prompts, { ...DEFAULTS, checks: { fast: "bun run check" } }).checks).toBe(
      null,
    );
  });

  test("an answer that is not understood is asked again once, with the reason", async () => {
    const { prompts, shown } = scripted([null, "release=dev", "release/=dev"]);
    expect(askedAnswers(prompts, DEFAULTS).bases).toEqual({ "release/": "dev" });
    expect(shown.slice(1, 4)).toEqual([
      '[2/8] Bases for other branch prefixes, as prefix=base,prefix=base ("none" for none) [hotfix/=main,release/=main] ',
      '! Not understood: "release=dev" is not prefix=base (the prefix ends with "/").\n',
      '[2/8] Bases for other branch prefixes, as prefix=base,prefix=base ("none" for none) [hotfix/=main,release/=main] ',
    ]);
  });
});

describe("the run", () => {
  test("no terminal and no --yes: the plan, and nothing written, with the flag that answers", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(run.lines).toEqual([
      `cc-smart-dev-kit project init: ${repo}`,
      "",
      "· .claude/cc-smart-dev-kit.json  7 to change",
      '  + protectedBranches: ["main"]',
      `  + requires: ">=0.5.2"`,
      "  + sessionNames: true",
      '  + worktrees.base: "main"',
      '  + worktrees.bases.hotfix/: "main"',
      '  + worktrees.bases.release/: "main"',
      "  + worktrees.guardMainFolder: true",
      NO_DEPLOY_SKILL,
      "",
      "· Nothing was written: run this on a terminal, or add --yes.",
    ]);
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
  });

  test("--yes writes both files, and says to commit them", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      await runProjectInit(
        ["--yes", "--no-deploy-block", "--base", "dev", "--bases", "hotfix/=main"],
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
    // The plan, then each file written, the verdict, and the next steps: commit, and the version.
    expect(run.lines).toEqual([
      `cc-smart-dev-kit project init: ${repo}`,
      "",
      "! .claude/cc-smart-dev-kit.json  6 to change, 1 warning",
      '  + protectedBranches: ["main","dev"]',
      `  + requires: "${written.requires}"`,
      "  + sessionNames: true",
      '  + worktrees.base: "dev"',
      '  + worktrees.bases.hotfix/: "main"',
      "  + worktrees.guardMainFolder: true",
      `  ! base dev is not the repo's default branch main: .claude/settings.json gets "worktree": {"baseRef": "head"}, so a new worktree starts from the branch the session is on`,
      "· .claude/settings.json          1 to change, merged with what it has",
      '  + worktree.baseRef: "head"',
      NO_DEPLOY_SKILL,
      "",
      "+ .claude/cc-smart-dev-kit.json: created",
      "+ .claude/settings.json: created",
      "",
      "✓ Done: 2 files written.",
      "",
      "Next steps:",
      "  1. Commit the files with the project:",
      "       git add .claude/cc-smart-dev-kit.json .claude/settings.json && git commit",
      `  2. Tell your teammates: the file asks for cc-smart-dev-kit ${written.requires}, so each of them needs that plugin version or newer.`,
    ]);
  });

  test("the same run in rich mode: the same words, with colour on the marks and the verdict", async () => {
    const repo = makeRepo();
    const lines: string[] = [];
    const run = context(repo, { out: createOut(RICH, lineSink(lines)) });
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(lines).toEqual([
      `\x1b[1mcc-smart-dev-kit project init: ${repo}\x1b[0m`,
      "",
      "\x1b[2m·\x1b[0m .claude/cc-smart-dev-kit.json  7 to change",
      '  \x1b[32m+\x1b[0m protectedBranches: ["main"]',
      `  \x1b[32m+\x1b[0m requires: ">=0.5.2"`,
      "  \x1b[32m+\x1b[0m sessionNames: true",
      '  \x1b[32m+\x1b[0m worktrees.base: "main"',
      '  \x1b[32m+\x1b[0m worktrees.bases.hotfix/: "main"',
      '  \x1b[32m+\x1b[0m worktrees.bases.release/: "main"',
      "  \x1b[32m+\x1b[0m worktrees.guardMainFolder: true",
      `\x1b[2m·\x1b[0m ${NO_DEPLOY_SKILL_TEXT}`,
      "",
      "\x1b[32m+\x1b[0m .claude/cc-smart-dev-kit.json: created",
      "",
      "\x1b[32m✓ Done: 1 file written.\x1b[0m",
      "",
      "Next steps:",
      // Wrapped at the terminal's 100 columns, under the step's own text.
      "  1. Commit the file with the project:",
      "       git add .claude/cc-smart-dev-kit.json && git commit",
      "  2. Tell your teammates: the file asks for cc-smart-dev-kit >=0.5.2, so each of them needs that",
      "     plugin version or newer.",
    ]);
  });

  test("D16: a policy whose settings cannot work together is named before anything is written", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      await runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft,autoMerge=true"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.lines).toContain(
      `  ! openPr opens a pull request, but autoPush is off: the git guard asks before the push that pull request needs, so it waits for you every time. Fix: turn autoPush on (\`${COMMAND} workflow set autoPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`).`,
    );
    expect(run.lines).toContain(
      `  ! openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens. Fix: set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`).`,
    );
    // The plan ran and wrote nothing: the warning is part of the plan, not of a later step.
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("D16: the person's own settings are part of the policy, so no clash is named wrongly", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ autoPush: true }, null, 2)}\n`);
    const run = context(repo, { env });
    expect(
      await runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    // autoPush is on in the person's own file: the pull request needs no push they must approve.
    expect(run.lines.filter((line) => line.includes("but autoPush is off"))).toEqual([]);
  });

  test("D16: a personal file that cannot be read does not stop the plan", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    const run = context(repo, { env });
    expect(
      await runProjectInit(
        ["--dry-run", "--base", "dev", "--workflow", "openPr=draft"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.errors).toEqual([]);
    // Nothing is known about autoPush there: the default (off) is judged, and says so.
    expect(run.lines.some((line) => line.includes("but autoPush is off"))).toBe(true);
  });

  test("D20: a retired engine flag: exit 2, the reason and the usage, nothing written", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      await runProjectInit(
        ["--yes", "--prefix", "app-wt-", "--engine", "own"],
        run.context,
        runner({}),
      ),
    ).toBe(2);
    expect(run.errors[0]).toStartWith(
      "--prefix is gone: the plugin's worktree engine was retired in 1.0.0, and Claude Code's own worktrees need none of its settings\n\nUsage: cc-smart-dev-kit project init",
    );
    expect(run.lines).toEqual([]);
    expect(existsSync(join(repo, ".claude"))).toBe(false);
  });

  test("D20: --yes with the --no- flags writes both answers as off", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      await runProjectInit(
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

  test("--yes with the default branch as the base writes no settings file", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
  });

  test("--dry-run prints the plan and writes nothing, also with --yes, and asks nothing on a terminal", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(
      await runProjectInit(["--dry-run", "--yes", "--no-deploy-block"], run.context, runner({})),
    ).toBe(0);
    expect(run.lines.slice(-3)).toEqual([
      "",
      "· A real run writes 1 file.",
      "Dry run: nothing was written.",
    ]);
    // UX-12: a terminal is not asked either; the plan is the flags' and the defaults'.
    const { prompts, shown } = scripted(["dev"]);
    const asked = context(repo, { prompts });
    expect(
      await runProjectInit(["--dry-run", "--no-deploy-block"], asked.context, runner({})),
    ).toBe(0);
    expect(shown).toEqual([]);
    expect(asked.lines[0]).toBe(`cc-smart-dev-kit project init: ${repo} (dry run)`);
    expect(asked.lines).toContain('  + worktrees.base: "main"');
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("a project file saved with a byte order mark is read, not refused (F5-2)", async () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(dirname(file), { recursive: true });
    // Notepad and an older PowerShell save UTF-8 with the mark; JSON.parse refuses it, so
    // every guard fails closed on the file. The command must read it the same way they do now.
    writeFileSync(
      file,
      `\uFEFF${JSON.stringify(
        { requires: ">=1.0", worktrees: { base: "dev" }, autoMode: ["one rule"] },
        null,
        2,
      )}\n`,
    );
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(run.errors).toEqual([]);
    // The file's own answers were read: its base stays (not the repo's default), and a field
    // the flags do not set stays too.
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      autoMode?: unknown;
      worktrees: { base: string };
    };
    expect(written.worktrees.base).toBe("dev");
    expect(written.autoMode).toEqual(["one rule"]);
    expect(() => parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file)).not.toThrow();
  });

  test("--yes with --workflow keeps the file's other workflow settings (F5-3)", async () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          requires: ">=1.0",
          worktrees: { base: "main" },
          workflow: { alerts: { usagePercent: 90 }, fixesAfterReview: { lines: 120 } },
        },
        null,
        2,
      )}\n`,
    );
    const run = context(repo);
    expect(
      await runProjectInit(
        ["--yes", "--no-deploy-block", "--workflow", "autoPush=true"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      workflow: Record<string, unknown>;
    };
    expect(written.workflow).toEqual({
      alerts: { usagePercent: 90 },
      fixesAfterReview: { lines: 120 },
      autoPush: true,
    });
    // The merged file is one the plugin's own readers accept before it is written.
    expect(() => parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file)).not.toThrow();
  });

  test("an existing file: --yes keeps every field the flags do not set", async () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const run = context(repo);
    await runProjectInit(["--yes", "--base", "dev"], run.context, runner({}));
    const first = readFileSync(file, "utf8");
    const before = JSON.parse(first) as Record<string, unknown>;
    // A field a person added by hand stays, and the flags' answers do not touch it.
    writeFileSync(file, `${JSON.stringify({ ...before, autoMode: ["one rule"] }, null, 2)}\n`);
    const again = context(repo);
    expect(await runProjectInit(["--yes"], again.context, runner({}))).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after.autoMode).toEqual(["one rule"]);
    expect((after.worktrees as { base: string }).base).toBe("dev");
    expect((after.protectedBranches as string[]).includes("dev")).toBe(true);
  });

  test("the questions, answered on a terminal, are what gets written", async () => {
    const repo = makeRepo();
    // The base, Enter on the seven others, then a yes to the write.
    const { prompts, shown } = scripted([
      "integration",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "y",
    ]);
    const run = context(repo, { prompts });
    expect(await runProjectInit(["--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(run.lines[2]).toBe("8 questions. Enter keeps the answer in [brackets].");
    expect(
      (
        JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8")) as {
          worktrees: { base: string };
        }
      ).worktrees.base,
    ).toBe("integration");
    expect(shown.at(-1)).toBe("Write these 2 files? [y/N] ");
  });

  test("a no to the last question leaves both files alone; Enter is that no", async () => {
    const repo = makeRepo();
    const { prompts, shown } = scripted([]);
    const run = context(repo, { prompts });
    expect(await runProjectInit(["--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(shown.at(-1)).toBe("Write this file? [y/N] ");
    expect(run.lines.at(-1)).toBe("· Left alone: nothing was written.");
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

  test("D20: --dry-run shows every - line the retired engine left, and writes nothing", async () => {
    const { repo, file, settings, local } = engineLeftovers();
    const before = [file, settings, local].map((one) => readFileSync(one, "utf8"));
    const run = context(repo);
    expect(
      await runProjectInit(["--dry-run", "--yes", "--no-deploy-block"], run.context, runner({})),
    ).toBe(0);
    expect(run.lines).toEqual([
      `cc-smart-dev-kit project init: ${repo} (dry run)`,
      "",
      "! .claude/cc-smart-dev-kit.json  8 to change, 1 warning",
      '  + protectedBranches: ["main"]',
      '  + requires: ">=0.5.2"',
      "  + sessionNames: true",
      '  + worktrees.bases.hotfix/: "main"',
      '  + worktrees.bases.release/: "main"',
      "  + worktrees.guardMainFolder: true",
      '  - worktrees.prefix: "app-wt-"',
      '  - worktrees.setup: ["bun","install"]',
      "  ! the plugin's worktree engine was retired in 1.0.0: worktrees.prefix, worktrees.setup and its hook lines go, because Claude Code's own worktrees need none",
      "· .claude/settings.json          1 to change, merged with what it has",
      '  - hooks.WorktreeCreate: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create',
      "· .claude/settings.local.json    1 to change, merged with what it has",
      "  - hooks.SubagentStop: cc-smart-dev-kit  hook  subagent-stop",
      NO_DEPLOY_SKILL,
      "",
      "· A real run writes 3 files.",
      "Dry run: nothing was written.",
    ]);
    expect([file, settings, local].map((one) => readFileSync(one, "utf8"))).toEqual(before);
  });

  test("D20: the same dry run on a terminal: the marks coloured, the - lines red, the verdict dim", async () => {
    const { repo } = engineLeftovers();
    const lines: string[] = [];
    const run = context(repo, { out: createOut(RICH, lineSink(lines)) });
    expect(await runProjectInit(["--dry-run", "--no-deploy-block"], run.context, runner({}))).toBe(
      0,
    );
    const add = (text: string) => `  \x1b[32m+\x1b[0m ${text}`;
    const cut = (text: string) => `  \x1b[31m-\x1b[0m ${text}`;
    expect(lines).toEqual([
      `\x1b[1mcc-smart-dev-kit project init: ${repo} (dry run)\x1b[0m`,
      "",
      "\x1b[33m!\x1b[0m .claude/cc-smart-dev-kit.json  8 to change, 1 warning",
      add('protectedBranches: ["main"]'),
      add('requires: ">=0.5.2"'),
      add("sessionNames: true"),
      add('worktrees.bases.hotfix/: "main"'),
      add('worktrees.bases.release/: "main"'),
      add("worktrees.guardMainFolder: true"),
      cut('worktrees.prefix: "app-wt-"'),
      cut('worktrees.setup: ["bun","install"]'),
      "  \x1b[33m!\x1b[0m the plugin's worktree engine was retired in 1.0.0: worktrees.prefix, worktrees.setup and its",
      "    hook lines go, because Claude Code's own worktrees need none",
      "\x1b[2m·\x1b[0m .claude/settings.json          1 to change, merged with what it has",
      cut('hooks.WorktreeCreate: "$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create'),
      "\x1b[2m·\x1b[0m .claude/settings.local.json    1 to change, merged with what it has",
      cut("hooks.SubagentStop: cc-smart-dev-kit  hook  subagent-stop"),
      `\x1b[2m·\x1b[0m ${NO_DEPLOY_SKILL_TEXT}`,
      "",
      "\x1b[2m· A real run writes 3 files.\x1b[0m",
      "Dry run: nothing was written.",
    ]);
  });

  test("D20: --yes on the retired engine's leftovers writes a file that loads, and clean settings", async () => {
    const { repo, file, settings, local } = engineLeftovers();
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
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
    // Each file, changed; and settings.local.json, each person's own, is not one to commit.
    expect(run.lines.slice(-11)).toEqual([
      "",
      "~ .claude/cc-smart-dev-kit.json: changed",
      "~ .claude/settings.json: changed",
      "~ .claude/settings.local.json: changed",
      "",
      "✓ Done: 3 files written.",
      "",
      "Next steps:",
      "  1. Commit the files with the project:",
      "       git add .claude/cc-smart-dev-kit.json .claude/settings.json && git commit",
      "  2. Tell your teammates: the file asks for cc-smart-dev-kit >=0.5.2, so each of them needs that plugin version or newer.",
    ]);
  });

  test("a flag cc-smart-dev-kit does not know: exit 2, nothing written", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--fast"], run.context, runner({}))).toBe(2);
    expect(run.errors[0]).toContain("Unknown option: --fast");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("--help prints the flags and writes nothing", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--help"], run.context, runner({}))).toBe(0);
    expect(run.lines[0]).toStartWith("Usage: cc-smart-dev-kit project init");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });
});

describe("what the file asks for", () => {
  test("running init again leaves a file that already asks for the floor alone", async () => {
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
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect((JSON.parse(readFileSync(file, "utf8")) as { requires: string }).requires).toBe(
      ">=0.5.2",
    );
    expect(run.lines.at(-1)).toBe(
      "  2. Tell your teammates: the file asks for cc-smart-dev-kit >=0.5.2, so each of them needs that plugin version or newer.",
    );
  });

  test("a file that asks for a newer plugin keeps its own range", async () => {
    const repo = makeRepo();
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ requires: ">=1.0", worktrees: { base: "main" } }, null, 2)}\n`,
    );
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect((JSON.parse(readFileSync(file, "utf8")) as { requires: string }).requires).toBe(">=1.0");
  });
});

describe("the file this command writes is one the plugin accepts", () => {
  test("CM-3: a --bases prefix without the trailing slash is refused, and nothing is written", async () => {
    // The schema refuses a prefix that does not end with "/" (it is a branch-name prefix), so
    // writing this one made every later reader — the hooks, doctor, the plugin itself — refuse
    // the project the person had just set up.
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--bases", "release=dev"], run.context, runner({}))).toBe(
      2,
    );
    expect(run.errors[0]).toContain('"release=dev" is not prefix=base');
    expect(run.errors[0]).toContain('ends with "/"');
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("CM-3: a blank answer to --base or --bases is a usage mistake", async () => {
    expect(parseFlags(["--yes", "--base", ""])).toEqual({ error: "--base needs a value" });
    expect(parseFlags(["--yes", "--bases", ""])).toEqual({ error: "--bases needs a value" });
  });

  test("CM-3: the plan is refused before the write when the plugin would refuse the file", async () => {
    // The project's own file holds a key no version of cc-smart-dev-kit knows: writing the
    // plan back would keep it, and every reader would refuse the project from then on.
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    const before = `{\n  "requires": ">=0.4",\n  "worktree": {\n    "base": "main"\n  }\n}\n`;
    writeFileSync(file, before);
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(1);
    expect(run.errors[0]).toContain(file);
    expect(run.errors[0]).toContain("worktree");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
  });
});

describe("the command itself, as Claude Code runs it", () => {
  test("`--help` works outside a git project, and writes nothing", async () => {
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

  test("`--yes` in a real repo writes the project's file, in this HOME's state folder", async () => {
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
        "--no-deploy-block",
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
    expect(result.stdout.toString()).toContain(
      "  1. Commit the files with the project:\n       git add .claude/cc-smart-dev-kit.json .claude/settings.json && git commit\n",
    );
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
    // The backups went to this HOME's state folder, never the real one.
    expect(existsSync(join(home, ".claude", "cc-smart-dev-kit", "backups"))).toBe(true);
  });
});

describe("the deploy skill", () => {
  const OWN_TEXT = "# Deploy\n\nRun the build, then ship it.\n";

  /** A repo with these skill files, as `.claude/skills/<path>`. */
  function repoWith(skills: Record<string, string>): string {
    const repo = makeRepo();
    for (const [path, text] of Object.entries(skills)) {
      const file = join(repo, ".claude", "skills", path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return repo;
  }
  const skillText = (repo: string, path: string) =>
    readFileSync(join(repo, ".claude", "skills", path), "utf8");

  test("the flags: --deploy-skill takes a path, --no-deploy-block takes none", () => {
    expect(parseFlags(["--deploy-skill", "x/SKILL.md", "--no-deploy-block"])).toEqual({
      flags: { dryRun: false, yes: false, deploySkill: "x/SKILL.md", noDeployBlock: true },
    });
    expect(parseFlags(["--deploy-skill"])).toEqual({ error: "--deploy-skill needs a value" });
  });

  test("--yes: the one deploy skill gets the block, the text stays, requires is raised", async () => {
    const repo = repoWith({ "deploy/SKILL.md": OWN_TEXT, "review/SKILL.md": "# Review\n" });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    const written = skillText(repo, "deploy/SKILL.md");
    expect(
      written.startsWith(`${OWN_TEXT}\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\n`),
    ).toBe(true);
    expect(written.endsWith("<!-- cc-smart-dev-kit:end -->\n")).toBe(true);
    expect(skillText(repo, "review/SKILL.md")).toBe("# Review\n");
    const config = JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"));
    expect(config.requires).toBe(">=5.0");
    expect(run.lines).toContain(
      "· .claude/skills/deploy/SKILL.md  9 to change in its deploy block",
    );
    expect(run.lines).toContain("~ .claude/skills/deploy/SKILL.md: changed");
    expect(run.lines).toContain("✓ Done: 2 files written.");
    expect(run.lines.join("\n")).not.toContain("no deploy skill found");
    // The skill file goes in the commit line, and its backup is in the state folder.
    expect(run.lines.join("\n")).toContain(
      "git add .claude/cc-smart-dev-kit.json .claude/skills/deploy/SKILL.md && git commit",
    );
    expect(existsSync(join(run.context.stateDir, "backups"))).toBe(true);
  });

  test("--dry-run shows the block's lines and writes no file at all", async () => {
    const repo = repoWith({ "deploy/SKILL.md": OWN_TEXT });
    const run = context(repo);
    expect(await runProjectInit(["--dry-run"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain("  + ## Deploy tasks");
    expect(run.lines).toContain("· A real run writes 2 files.");
    expect(skillText(repo, "deploy/SKILL.md")).toBe(OWN_TEXT);
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
    expect(existsSync(join(run.context.stateDir, "backups"))).toBe(false);
  });

  test("several deploy skills: one question, asked with the others; the answer picks one", async () => {
    const repo = repoWith({ "deploy-api/SKILL.md": OWN_TEXT, "deploy-web/SKILL.md": OWN_TEXT });
    // Eight Enter answers for the numbered questions, then the skill, then the final yes.
    const { prompts, shown } = scripted([...Array(8).fill(null), "2", "y"]);
    const run = context(repo, { prompts });
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    expect(shown.join("")).toContain(
      'Deploy skill: which file gets the deploy block? 1) .claude/skills/deploy-api/SKILL.md  2) .claude/skills/deploy-web/SKILL.md ("none" to skip)',
    );
    expect(skillText(repo, "deploy-api/SKILL.md")).toBe(OWN_TEXT);
    expect(skillText(repo, "deploy-web/SKILL.md")).toContain("<!-- cc-smart-dev-kit:begin -->");
  });

  test("several deploy skills, answered none: no block is written anywhere", async () => {
    const repo = repoWith({ "deploy-api/SKILL.md": OWN_TEXT, "deploy-web/SKILL.md": OWN_TEXT });
    const { prompts } = scripted([...Array(8).fill(null), null, "y"]);
    const run = context(repo, { prompts });
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    expect(skillText(repo, "deploy-api/SKILL.md")).toBe(OWN_TEXT);
    expect(skillText(repo, "deploy-web/SKILL.md")).toBe(OWN_TEXT);
  });

  test("several deploy skills and --yes: a note names them, and no skill is written", async () => {
    const repo = repoWith({ "deploy-api/SKILL.md": OWN_TEXT, "deploy-web/SKILL.md": OWN_TEXT });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain(
      "· several deploy skills found (.claude/skills/deploy-api/SKILL.md, .claude/skills/deploy-web/SKILL.md); --deploy-skill <path> names one",
    );
    expect(skillText(repo, "deploy-api/SKILL.md")).toBe(OWN_TEXT);
    expect(skillText(repo, "deploy-web/SKILL.md")).toBe(OWN_TEXT);
    // No block, so requires stays where a project with no deploy tasks has it.
    const config = JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"));
    expect(config.requires).toBe(">=0.5.2");
  });

  test("--deploy-skill names the file, whatever its folder is called", async () => {
    const repo = repoWith({ "ship/SKILL.md": OWN_TEXT, "deploy-web/SKILL.md": OWN_TEXT });
    const run = context(repo, { cwd: repo });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", ".claude/skills/ship/SKILL.md"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(skillText(repo, "ship/SKILL.md")).toContain("<!-- cc-smart-dev-kit:begin -->");
    expect(skillText(repo, "deploy-web/SKILL.md")).toBe(OWN_TEXT);
  });

  test("--deploy-skill is typed from where the person stands, not from the checkout root", async () => {
    const repo = repoWith({ "ship/SKILL.md": OWN_TEXT });
    mkdirSync(join(repo, "sub"), { recursive: true });
    const run = context(repo, { cwd: join(repo, "sub") });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", "../.claude/skills/ship/SKILL.md"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(skillText(repo, "ship/SKILL.md")).toContain("<!-- cc-smart-dev-kit:begin -->");
    // The same words from the root name nothing: a usage error, not a guess.
    const root = context(repo, { cwd: repo });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", "../.claude/skills/ship/SKILL.md"],
        root.context,
        runner({}),
      ),
    ).toBe(2);
  });

  test("--deploy-skill naming a folder is a usage error: it is not a file", async () => {
    const repo = repoWith({ "ship/SKILL.md": OWN_TEXT });
    const run = context(repo, { cwd: repo });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", ".claude/skills/ship"],
        run.context,
        runner({}),
      ),
    ).toBe(2);
    expect(run.errors[0]).toStartWith("--deploy-skill: .claude/skills/ship is not a file");
  });

  test("--deploy-skill X while another file holds the block: a note names the other, which is left alone", async () => {
    const holder = `# Ops\n\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\nold text\n<!-- cc-smart-dev-kit:end -->\n`;
    const repo = repoWith({ "ops/SKILL.md": holder, "ship/SKILL.md": OWN_TEXT });
    const run = context(repo, { cwd: repo });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", ".claude/skills/ship/SKILL.md"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.lines).toContain(
      "· the deploy block is also in .claude/skills/ops/SKILL.md: left as it is",
    );
    expect(skillText(repo, "ops/SKILL.md")).toBe(holder);
    expect(skillText(repo, "ship/SKILL.md")).toContain("<!-- cc-smart-dev-kit:begin -->");
  });

  test("--deploy-skill through a link to the file that holds the block: no note, it is the same file", async () => {
    const holder = `# Ops\n\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\nold text\n<!-- cc-smart-dev-kit:end -->\n`;
    const repo = repoWith({ "ops/SKILL.md": holder });
    symlinkSync(
      join(repo, ".claude", "skills", "ops", "SKILL.md"),
      join(repo, ".claude", "alias.md"),
    );
    const run = context(repo, { cwd: repo });
    expect(
      await runProjectInit(
        ["--yes", "--deploy-skill", ".claude/alias.md"],
        run.context,
        runner({}),
      ),
    ).toBe(0);
    expect(run.lines.join("\n")).not.toContain("is also in");
    expect(skillText(repo, "ops/SKILL.md")).toContain("## Deploy tasks\n\nSteps owed");
  });

  test("a skills folder linked in from outside the checkout is named, not reported as missing", async () => {
    const repo = repoWith({});
    const outside = tempDir("deploy-skill-outside");
    mkdirSync(join(outside, "deploy"), { recursive: true });
    writeFileSync(join(outside, "deploy", "SKILL.md"), OWN_TEXT);
    mkdirSync(join(repo, ".claude"), { recursive: true });
    symlinkSync(outside, join(repo, ".claude", "skills"));
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain("· .claude/skills is a link outside this checkout: not searched");
    expect(run.lines.join("\n")).not.toContain("no deploy skill found");
    expect(readFileSync(join(outside, "deploy", "SKILL.md"), "utf8")).toBe(OWN_TEXT);
    const remove = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], remove.context, runner({}))).toBe(
      0,
    );
    expect(remove.lines).toContain(
      "· .claude/skills is a link outside this checkout: not searched",
    );
  });

  test("one named skill, on a terminal: asked once, yes by default; a no drops only the skill write", async () => {
    const yes = repoWith({ "deploy/SKILL.md": OWN_TEXT });
    // Eight Enter answers, the skill question (Enter: yes), then the final yes.
    const asked = scripted([...Array(8).fill(null), null, "y"]);
    expect(
      await runProjectInit([], context(yes, { prompts: asked.prompts }).context, runner({})),
    ).toBe(0);
    expect(asked.shown.join("")).toContain(
      "Add the kit's deploy-task section to .claude/skills/deploy/SKILL.md? [Y/n]",
    );
    expect(skillText(yes, "deploy/SKILL.md")).toContain("<!-- cc-smart-dev-kit:begin -->");

    const no = repoWith({ "deploy/SKILL.md": OWN_TEXT });
    const declined = scripted([...Array(8).fill(null), "n", "y"]);
    const run = context(no, { prompts: declined.prompts });
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    expect(skillText(no, "deploy/SKILL.md")).toBe(OWN_TEXT);
    // The project's own file is still written, and no block means requires stays low.
    const config = JSON.parse(readFileSync(join(no, ".claude", "cc-smart-dev-kit.json"), "utf8"));
    expect(config.requires).toBe(">=0.5.2");
    expect(run.lines).toContain("✓ Done: 1 file written.");
  });

  test("an update of a block already there asks nothing about the skill", async () => {
    const old = `<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\nold\n<!-- cc-smart-dev-kit:end -->\n`;
    const repo = repoWith({ "deploy/SKILL.md": old });
    const { prompts, shown } = scripted([...Array(8).fill(null), "y"]);
    expect(await runProjectInit([], context(repo, { prompts }).context, runner({}))).toBe(0);
    expect(shown.join("")).not.toContain("Add the kit's deploy-task section");
    expect(skillText(repo, "deploy/SKILL.md")).not.toContain("\nold\n");
  });

  test("a docs skill that shows the markers in a code fence is never taken for the deploy skill", async () => {
    const docs = `# Kit blocks\n\n\`\`\`md\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\n<!-- cc-smart-dev-kit:end -->\n\`\`\`\n`;
    const repo = repoWith({ "kit-docs/SKILL.md": docs });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    // Not the deploy skill: it is left as it is, and the project, which has none, gets its own.
    expect(skillText(repo, "kit-docs/SKILL.md")).toBe(docs);
    expect(skillText(repo, "deploy/SKILL.md")).toContain("name: deploy\n");
    expect(run.lines).toContain("+ .claude/skills/deploy/SKILL.md: created");
  });

  test("--deploy-skill with a path that is not a file is a usage error", async () => {
    const repo = repoWith({});
    const run = context(repo);
    expect(
      await runProjectInit(["--yes", "--deploy-skill", "nope.md"], run.context, runner({})),
    ).toBe(2);
    expect(run.errors[0]).toStartWith("--deploy-skill: nope.md is not a file");
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("a file that already holds the block is updated in place, with no question", async () => {
    const old = `# Ops\n\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\nold text\n<!-- cc-smart-dev-kit:end -->\n\nTail.\n`;
    const repo = repoWith({ "ops/SKILL.md": old, "deploy-web/SKILL.md": OWN_TEXT });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    const written = skillText(repo, "ops/SKILL.md");
    expect(written.startsWith("# Ops\n\n<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\n")).toBe(
      true,
    );
    expect(written.endsWith("<!-- cc-smart-dev-kit:end -->\n\nTail.\n")).toBe(true);
    expect(skillText(repo, "deploy-web/SKILL.md")).toBe(OWN_TEXT);
  });

  test("--no-deploy-block takes the block out and leaves the text around it as it was", async () => {
    const repo = repoWith({ "deploy/SKILL.md": OWN_TEXT });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    const again = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], again.context, runner({}))).toBe(0);
    expect(skillText(repo, "deploy/SKILL.md")).toBe(OWN_TEXT);
    expect(again.lines).toContain("✓ Done: 1 file written.");
    // Nothing left to remove: a note, no write.
    const third = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], third.context, runner({}))).toBe(0);
    expect(third.lines).toContain("· no deploy block found in .claude/skills: nothing to remove");
    expect(skillText(repo, "deploy/SKILL.md")).toBe(OWN_TEXT);
  });

  test("a skill linked in from outside the checkout is refused by name; the rest of init is written", async () => {
    const repo = repoWith({});
    const outside = tempDir("deploy-skill-outside");
    writeFileSync(join(outside, "SKILL.md"), OWN_TEXT);
    mkdirSync(join(repo, ".claude", "skills"), { recursive: true });
    symlinkSync(outside, join(repo, ".claude", "skills", "deploy"));
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe(OWN_TEXT);
    expect(run.lines.join("\n")).toContain(
      ".claude/skills/deploy/SKILL.md is outside this checkout (a link to ",
    );
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
    expect(run.lines).toContain("✓ Done: 1 file written.");
  });

  test("a broken marker pair is named, the skill is not written, and the rest of init is", async () => {
    const broken = `${OWN_TEXT}<!-- cc-smart-dev-kit:begin -->\nhalf a block\n`;
    const repo = repoWith({ "deploy/SKILL.md": broken });
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(skillText(repo, "deploy/SKILL.md")).toBe(broken);
    expect(run.lines.join("\n")).toContain(
      ".claude/skills/deploy/SKILL.md has a broken cc-smart-dev-kit block",
    );
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(true);
  });

  test("a CRLF skill stays CRLF: insert, then remove, byte for byte", async () => {
    const crlf = OWN_TEXT.replace(/\n/g, "\r\n");
    const repo = repoWith({ "deploy/SKILL.md": crlf });
    expect(await runProjectInit(["--yes"], context(repo).context, runner({}))).toBe(0);
    const written = skillText(repo, "deploy/SKILL.md");
    expect(written.startsWith(crlf)).toBe(true);
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(
      await runProjectInit(["--yes", "--no-deploy-block"], context(repo).context, runner({})),
    ).toBe(0);
    expect(skillText(repo, "deploy/SKILL.md")).toBe(crlf);
  });

  test("a project with deploy task folders and no skill, no block wanted: requires is raised anyway", async () => {
    const repo = repoWith({});
    mkdirSync(join(repo, ".claude", "tasks", "prod"), { recursive: true });
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    const config = JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"));
    expect(config.requires).toBe(">=5.0");
    expect(run.lines).toContain("· no deploy block found in .claude/skills: nothing to remove");
    expect(existsSync(join(repo, ".claude", "skills", "deploy"))).toBe(false);
  });
});

describe("a project with no deploy skill gets one (D8)", () => {
  const NEW = ".claude/skills/deploy/SKILL.md";
  const QUESTION = `Create a deploy skill at ${NEW}, with the kit's deploy-task section? [Y/n]`;
  const newSkill = (repo: string) => join(repo, ".claude", "skills", "deploy", "SKILL.md");
  const configOf = (repo: string) =>
    JSON.parse(readFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "utf8"));

  test("on a terminal: asked once with the other questions, yes by default; the file is created", async () => {
    const repo = makeRepo();
    // Eight Enter answers, the skill question (Enter: yes), then the final yes.
    const asked = scripted([...Array(8).fill(null), null, "y"]);
    const run = context(repo, { prompts: asked.prompts });
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    const shown = asked.shown.join("");
    expect(shown).toContain(QUESTION);
    // Every question comes before the final "Write these N files?".
    expect(shown.indexOf(QUESTION)).toBeLessThan(shown.indexOf("Write these 2 files?"));
    const text = readFileSync(newSkill(repo), "utf8");
    expect(text.startsWith("---\nname: deploy\ndescription: Use when deploying this project")).toBe(
      true,
    );
    expect(text).toContain("\n## This project's deploy steps\n");
    expect(text).toContain("<!-- cc-smart-dev-kit:begin -->\n## Deploy tasks\n");
    expect(text.endsWith("<!-- cc-smart-dev-kit:end -->\n")).toBe(true);
    expect(configOf(repo).requires).toBe(">=5.0");
    expect(run.lines).toContain(`+ ${NEW}: created`);
    expect(run.lines).toContain("✓ Done: 2 files written.");
    expect(run.lines.join("\n")).toContain(
      `git add .claude/cc-smart-dev-kit.json ${NEW} && git commit`,
    );
    // A new file has nothing to back up, and `restore` never knows of it.
    expect(existsSync(join(run.context.stateDir, "changed.json"))).toBe(false);
  });

  test("a no to the question drops only the skill: no file, requires stays low, the rest is written", async () => {
    const repo = makeRepo();
    const asked = scripted([...Array(8).fill(null), "n", "y"]);
    const run = context(repo, { prompts: asked.prompts });
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "skills"))).toBe(false);
    expect(configOf(repo).requires).toBe(">=0.5.2");
    expect(run.lines).toContain("✓ Done: 1 file written.");
  });

  test("--yes creates it without asking", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(readFileSync(newSkill(repo), "utf8")).toContain("name: deploy\n");
    expect(configOf(repo).requires).toBe(">=5.0");
    expect(run.lines).toContain(`· ${NEW}  new file, 18 lines`);
    expect(run.lines).toContain("  + name: deploy");
    expect(run.lines).toContain("  + ## This project's deploy steps");
    expect(run.lines).toContain(`+ ${NEW}: created`);
    expect(run.lines).toContain("✓ Done: 2 files written.");
  });

  test("--dry-run shows the new file as + lines, counts it, and writes nothing", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--dry-run"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain(`· ${NEW}  new file, 18 lines`);
    expect(run.lines).toContain("  + ## Deploy tasks");
    expect(run.lines).toContain("· A real run writes 2 files.");
    expect(existsSync(join(repo, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(repo, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
  });

  test("no terminal and no --yes: the plan shows the file, and nothing is written", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit([], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain(`· ${NEW}  new file, 18 lines`);
    expect(run.lines).toContain("· Nothing was written: run this on a terminal, or add --yes.");
    expect(existsSync(join(repo, ".claude"))).toBe(false);
  });

  test("--no-deploy-block: no file", async () => {
    const repo = makeRepo();
    const run = context(repo);
    expect(await runProjectInit(["--yes", "--no-deploy-block"], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "skills"))).toBe(false);
    expect(run.lines).toContain("✓ Done: 1 file written.");
  });

  test("a path already there is not overwritten: a note, and init goes on", async () => {
    const repo = makeRepo();
    // A dangling link is not a skill anyone found, but it is a path that is taken.
    mkdirSync(join(repo, ".claude", "skills", "deploy"), { recursive: true });
    symlinkSync(join(repo, "missing.md"), newSkill(repo));
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain(
      `· ${NEW} already exists: not overwritten; --deploy-skill <path> names the deploy skill`,
    );
    expect(existsSync(join(repo, "missing.md"))).toBe(false);
    expect(configOf(repo).requires).toBe(">=0.5.2");
    expect(run.lines).toContain("✓ Done: 1 file written.");
  });

  test("a skills folder linked out of the checkout: nothing is created there", async () => {
    const repo = makeRepo();
    const outside = tempDir("deploy-skill-outside");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    symlinkSync(outside, join(repo, ".claude", "skills"));
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(run.lines).toContain("· .claude/skills is a link outside this checkout: not searched");
    expect(existsSync(join(outside, "deploy"))).toBe(false);
  });

  test("a project that names a deploy skill is not given a second one", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude", "skills", "ship"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "skills", "ship", "SKILL.md"),
      "---\nname: ship-deploy\ndescription: x\n---\n# Ship\n",
    );
    const run = context(repo);
    expect(await runProjectInit(["--yes"], run.context, runner({}))).toBe(0);
    expect(existsSync(join(repo, ".claude", "skills", "deploy"))).toBe(false);
    expect(readFileSync(join(repo, ".claude", "skills", "ship", "SKILL.md"), "utf8")).toContain(
      "<!-- cc-smart-dev-kit:begin -->",
    );
  });

  test("doctor's stale-block check sees what init created as current, and a second init changes nothing", async () => {
    const repo = makeRepo();
    expect(await runProjectInit(["--yes"], context(repo).context, runner({}))).toBe(0);
    expect(staleBlocks(repo)).toEqual([]);
    const again = context(repo);
    expect(await runProjectInit(["--yes"], again.context, runner({}))).toBe(0);
    expect(again.lines).toContain("✓ Nothing to change.");
  });
});
