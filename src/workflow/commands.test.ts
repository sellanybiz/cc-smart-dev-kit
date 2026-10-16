/** `cc-smart-dev-kit workflow`: what `show` prints, and where `set` and `unset` write. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths, tildify } from "../cli/paths";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { runWorkflow, type WorkflowContext } from "./commands";
import { personalWorkflowFile } from "./resolve";
import { writePersonalSetting, writeProjectSetting } from "./write";

function context(
  cwd: string,
  env = hookEnv(),
): { context: WorkflowContext; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    context: {
      paths: cliPaths(env),
      cwd,
      env,
      print: (line) => lines.push(line),
      error: (line) => errors.push(line),
    },
  };
}

const SETTINGS = {
  requires: ">=0.1",
  worktrees: { base: "main", prefix: "app-wt-", setup: ["bun", "install"] },
  protectedBranches: ["main"],
  sessionNames: true,
};

describe("workflow show", () => {
  test("nothing set: every value with the built-in default as where it came from", () => {
    const run = context(tempDir("not-git"));
    expect(runWorkflow(["show"], run.context)).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      "your own defaults: ~/.config/cc-smart-dev-kit/workflow.json; a project's .claude/cc-smart-dev-kit.json wins field by field",
      "autoCommit = false (default)",
      "autoPush = false (default)",
      "openPr = off (default)",
      "autoMerge = false (default)",
      "mergeMethod = merge (default)",
      "deleteBranch = false (default)",
      "reviewBeforePush = true (default)",
      "clearWorktreeAfterMerge = false (default)",
      "alerts.events = needs-you, question, finished, failed (default)",
      "alerts.sound = false (default)",
      "alerts.usagePercent = 85 (default)",
      "switches.statusLine = false (default)",
      "switches.sessionNames = false (default)",
      "switches.jobRoute = false (default)",
      "switches.updateHold = false (default)",
      "review-done = no (this folder is not in a git project)",
      "no project settings here: this folder is not in a git project",
    ]);
  });

  test("a project's file and the person's: each value says where it came from", () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      jobs: { route: true },
      workflow: { autoMerge: true, openPr: "draft" },
    });
    mkdirSync(dirname(personalWorkflowFile(cliPaths(env))), { recursive: true });
    writeFileSync(
      personalWorkflowFile(cliPaths(env)),
      `${JSON.stringify({ openPr: "ready", alerts: { sound: true } }, null, 2)}\n`,
    );
    const run = context(repo, env);
    expect(runWorkflow([], run.context)).toBe(0);
    expect(run.lines).toContain("openPr = draft (project)");
    expect(run.lines).toContain("alerts.sound = true (personal)");
    expect(run.lines).toContain("autoMerge = true (project)");
    expect(run.lines).toContain("switches.sessionNames = true (project)");
    expect(run.lines).toContain("switches.jobRoute = true (project)");
    expect(run.lines).not.toContain(
      "no project settings here: this folder is not in a git project",
    );
  });

  test("a broken personal file: one line on stderr, exit 1", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, `${JSON.stringify({ autoCommit: "yes" }, null, 2)}\n`);
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["show"], run.context)).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `Invalid ${paths.workflowConfigFile}: autoCommit: Invalid input: expected boolean, received string`,
    ]);
  });
});

describe("workflow set and unset", () => {
  test("a policy value goes into the person's own file, 0600", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "autoCommit", "true"], run.context)).toBe(0);
    const file = cliPaths(env).workflowConfigFile;
    expect(run.lines).toEqual([`+ ~/.config/cc-smart-dev-kit/workflow.json: autoCommit = true`]);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify({ autoCommit: true }, null, 2)}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a second value keeps the first, and the file's own indentation", () => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `{\n    "autoCommit": true\n}\n`);
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "alerts.sound", "true"], run.context)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n    "autoCommit": true,\n    "alerts": {\n        "sound": true\n    }\n}\n`,
    );
    expect(run.lines).toEqual(["~ ~/.config/cc-smart-dev-kit/workflow.json: alerts.sound = true"]);
  });

  test("the same value again writes nothing", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    runWorkflow(["set", "openPr", "draft"], run.context);
    const again = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "openPr", "draft"], again.context)).toBe(0);
    expect(again.lines).toEqual([
      "= ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft (already set)",
    ]);
  });

  test("unset takes the value out, and the default holds again", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    runWorkflow(["set", "alerts.events", "finished"], run.context);
    const off = context(tempDir("not-git"), env);
    expect(runWorkflow(["unset", "alerts.events"], off.context)).toBe(0);
    expect(off.lines).toEqual(["- ~/.config/cc-smart-dev-kit/workflow.json: alerts.events unset"]);
    const shown = context(tempDir("not-git"), env);
    runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain(
      "alerts.events = needs-you, question, finished, failed (default)",
    );
  });

  test("a list of events is read from one quoted word", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "alerts.events", "needs-you,finished"], run.context)).toBe(0);
    expect(readFileSync(cliPaths(env).workflowConfigFile, "utf8")).toBe(
      `${JSON.stringify({ alerts: { events: ["needs-you", "finished"] } }, null, 2)}\n`,
    );
  });

  test("--project writes the project's file, keeping its other fields and its indentation", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    writeFileSync(
      file,
      `{\n    "worktrees": { "base": "main", "prefix": "app-wt-" },\n    "autoMode": ["one rule"]\n}\n`,
    );
    const run = context(repo, env);
    expect(runWorkflow(["set", "autoCommit", "true", "--project"], run.context)).toBe(0);
    expect(run.lines).toEqual([`~ ${file}: autoCommit = true`]);
    // The indent (four spaces here) stays; a one-line object is written out, as any JSON writer does.
    expect(readFileSync(file, "utf8")).toBe(
      [
        "{",
        '    "worktrees": {',
        '        "base": "main",',
        '        "prefix": "app-wt-"',
        "    },",
        '    "autoMode": [',
        '        "one rule"',
        "    ],",
        '    "workflow": {',
        '        "autoCommit": true',
        "    }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a project switch is written as the field the project already reads", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(runWorkflow(["set", "switches.jobRoute", "true", "--project"], run.context)).toBe(0);
    expect(run.lines).toEqual([`~ ${file}: switches.jobRoute = true`]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...SETTINGS, jobs: { route: true } });
    const off = context(repo, env);
    expect(runWorkflow(["unset", "switches.sessionNames", "--project"], off.context)).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after.sessionNames).toBeUndefined();
    expect(after.worktrees).toEqual(SETTINGS.worktrees);
  });

  test("a project switch asked for without --project says where it lives", () => {
    const env = hookEnv();
    const run = context(makeRepo(), env);
    expect(runWorkflow(["set", "switches.sessionNames", "true"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      "switches.sessionNames is the project's setting (sessionNames in .claude/cc-smart-dev-kit.json): run it with --project inside the project",
    ]);
  });

  test("a personal switch asked for with --project says where it lives", () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(runWorkflow(["set", "switches.updateHold", "true", "--project"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      "switches.updateHold is your own setting, not the project's: run it without --project (the update hold is per person, per machine)",
    ]);
  });

  test("--project with no .claude/cc-smart-dev-kit.json says to run project init", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(runWorkflow(["set", "autoCommit", "true", "--project"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `${repo} has no .claude/cc-smart-dev-kit.json: run \`cc-smart-dev-kit project init\` there first, or set this in your own defaults (without --project)`,
    ]);
  });

  test("the status line switch writes Claude Code's own key", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "switches.statusLine", "true"], run.context)).toBe(0);
    const settings = JSON.parse(readFileSync(paths.settingsFile, "utf8")) as {
      statusLine?: { command?: string; type?: string };
    };
    expect(settings.statusLine?.command).toBe(`${paths.binDir}/cc-smart-dev-kit statusline`);
    expect(settings.statusLine?.type).toBe("command");
    const off = context(tempDir("not-git"), env);
    expect(runWorkflow(["unset", "switches.statusLine"], off.context)).toBe(0);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({});
  });

  test("a status line someone else set is never overwritten", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      `${JSON.stringify({ statusLine: { command: "mine", type: "command" } }, null, 2)}\n`,
    );
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "switches.statusLine", "true"], run.context)).toBe(1);
    expect(run.errors[0]).toContain('statusLine is {"command":"mine","type":"command"}');
    expect(run.errors[0]).toContain("cc-smart-dev-kit does not overwrite it");
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({
      statusLine: { command: "mine", type: "command" },
    });
  });

  test("unsetting a status line that is not cc-smart-dev-kit's leaves it", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      `${JSON.stringify({ statusLine: { command: "mine" } }, null, 2)}\n`,
    );
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["unset", "switches.statusLine"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "= ~/.claude/settings.json: the cc-smart-dev-kit status line is not on (not owned by cc-smart-dev-kit; left alone)",
    ]);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({
      statusLine: { command: "mine" },
    });
  });

  test("the update hold switch is the file behind `update --hold`", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "switches.updateHold", "true"], run.context)).toBe(0);
    expect(existsSync(join(paths.stateDir, "update-hold"))).toBe(true);
    expect(run.lines).toEqual([
      "+ ~/.claude/cc-smart-dev-kit/update-hold: background updates are on hold",
    ]);
    const off = context(tempDir("not-git"), env);
    expect(runWorkflow(["unset", "switches.updateHold"], off.context)).toBe(0);
    expect(existsSync(join(paths.stateDir, "update-hold"))).toBe(false);
  });

  test("an unknown setting, and a value of the wrong kind: exit 2, nothing written", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "autoMergeSoon", "true"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("Unknown setting: autoMergeSoon");
    expect(runWorkflow(["set", "openPr", "maybe"], run.context)).toBe(2);
    expect(run.errors[1]).toContain("openPr is one of off, draft, ready");
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  test("set with two values, and set with none: exit 2", () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "alerts.events", "finished", "failed"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("set needs one value");
    const none = context(tempDir("not-git"), env);
    expect(runWorkflow(["set", "autoCommit"], none.context)).toBe(2);
    expect(none.errors[0]).toContain("set needs one value");
  });

  test("an unknown workflow command: exit 2", () => {
    const run = context(tempDir("not-git"));
    expect(runWorkflow(["write", "autoCommit", "true"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("Unknown workflow command: write");
  });
});

describe("workflow review-done", () => {
  /** The record file of a repo, named by hand the way the module names it. */
  function recordFile(env: Record<string, string>, repo: string): string {
    return join(
      cliPaths(env).stateDir,
      "reviews",
      `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
    );
  }

  test("HEAD is recorded: the file holds the full sha, 0600, and says so", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const head = git(repo, "rev-parse", "HEAD").trim();
    const run = context(repo, env);
    expect(runWorkflow(["review-done"], run.context)).toBe(0);
    const file = recordFile(env, repo);
    expect(run.lines).toEqual([
      `+ ${tildify(file, env.HOME ?? "")}: the review of ${head.slice(0, 7)} is recorded`,
    ]);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object)).toEqual([head]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("show says whether the commit here has one", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const head = git(repo, "rev-parse", "HEAD").trim();
    const before = context(repo, env);
    runWorkflow(["show"], before.context);
    expect(before.lines).toContain(`review-done = no (HEAD ${head.slice(0, 7)})`);
    runWorkflow(["review-done"], context(repo, env).context);
    const after = context(repo, env);
    runWorkflow(["show"], after.context);
    expect(after.lines).toContain(`review-done = yes (HEAD ${head.slice(0, 7)})`);
    expect(after.lines).not.toContain(`review-done = no (HEAD ${head.slice(0, 7)})`);
  });

  test("--sha records an earlier commit; a second call says it was already recorded", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const first = git(repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(repo, "second.txt"), "second\n");
    git(repo, "add", "second.txt");
    git(repo, "commit", "-q", "-m", "second");
    const run = context(repo, env);
    expect(runWorkflow(["review-done", "--sha", first.slice(0, 7)], run.context)).toBe(0);
    expect(run.lines[0]).toContain(`the review of ${first.slice(0, 7)} is recorded`);
    const again = context(repo, env);
    expect(runWorkflow(["review-done", "--sha", first], again.context)).toBe(0);
    expect(again.lines[0]).toContain("was already recorded");
    // HEAD itself (the second commit) is not recorded: only the commit asked for.
    const shown = context(repo, env);
    runWorkflow(["show"], shown.context);
    expect(shown.lines.some((line) => line.startsWith("review-done = no (HEAD "))).toBe(true);
  });

  test("a commit nothing names: exit 1, nothing written", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(runWorkflow(["review-done", "--sha", "no-such-commit"], run.context)).toBe(1);
    expect(run.errors[0]).toContain("no-such-commit is not a commit in this repository");
    expect(existsSync(recordFile(env, repo))).toBe(false);
  });

  test("outside a git project, and with a bad flag: nothing is written", () => {
    const outside = context(tempDir("not-git"));
    expect(runWorkflow(["review-done"], outside.context)).toBe(1);
    expect(outside.errors[0]).toContain("this folder is not in a git project");
    const env = hookEnv();
    const repo = makeRepo();
    const bad = context(repo, env);
    expect(runWorkflow(["review-done", "--sha"], bad.context)).toBe(2);
    expect(bad.errors[0]).toContain("--sha needs a commit");
    const unknown = context(repo, env);
    expect(runWorkflow(["review-done", "--now"], unknown.context)).toBe(2);
    expect(unknown.errors[0]).toContain("Unknown option: --now");
  });

  test("a worktree records into the repository's own file", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const worktree = join(repo, "..", "app-wt-review");
    git(repo, "worktree", "add", "-q", "-b", "review-branch", worktree);
    const head = git(worktree, "rev-parse", "HEAD").trim();
    const run = context(worktree, env);
    expect(runWorkflow(["review-done"], run.context)).toBe(0);
    expect(existsSync(recordFile(env, repo))).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(recordFile(env, repo), "utf8")) as object)).toEqual([
      head,
    ]);
  });
});

describe("the writers, called directly (the portal does this)", () => {
  test("writePersonalSetting writes one field and keeps the rest", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    writePersonalSetting(paths, "autoPush", true);
    expect(writePersonalSetting(paths, "openPr", "ready")).toBe(
      "~ ~/.config/cc-smart-dev-kit/workflow.json: openPr = ready",
    );
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({
      autoPush: true,
      openPr: "ready",
    });
  });

  test("writing a value the schema refuses leaves the file alone", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    writePersonalSetting(paths, "autoPush", true);
    expect(() => writePersonalSetting(paths, "alerts.usagePercent", 0)).toThrow(
      `Invalid ${paths.workflowConfigFile}: alerts.usagePercent:`,
    );
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({ autoPush: true });
  });

  test("writeProjectSetting keeps the file valid: a broken value writes nothing", () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    expect(() => writeProjectSetting(repo, "alerts.usagePercent", 900, env)).toThrow(
      `Invalid ${file}:`,
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SETTINGS);
  });

  test("the person's own file is theirs: a second value changes what cc-smart-dev-kit wrote", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    expect(writePersonalSetting(paths, "openPr", "draft")).toBe(
      "+ ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft",
    );
    expect(writePersonalSetting(paths, "openPr", "ready")).toBe(
      "~ ~/.config/cc-smart-dev-kit/workflow.json: openPr = ready",
    );
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({ openPr: "ready" });
  });

  test("unsetting a key that was never set says so", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    expect(writePersonalSetting(paths, "autoCommit", undefined)).toBe(
      "= ~/.config/cc-smart-dev-kit/workflow.json: autoCommit was not set",
    );
  });
});

describe("the command itself, as Claude Code runs it", () => {
  test("workflow set writes the person's file under this HOME", () => {
    // A temp HOME and a PATH: the CLI as its own process, never this machine's files.
    const home = tempDir("workflow-cli-home");
    const env = { ...hookEnv(), HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
    const guard = subprocessGuard();
    const result = Bun.spawnSync(
      [
        process.execPath,
        ...guard.args,
        join(import.meta.dir, "..", "entries", "cli.ts"),
        "workflow",
        "set",
        "openPr",
        "draft",
      ],
      {
        cwd: tempDir("workflow-cli-cwd"),
        env: { ...env, ...guard.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "+ ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft\n",
    );
    expect(
      JSON.parse(readFileSync(join(home, ".config", "cc-smart-dev-kit", "workflow.json"), "utf8")),
    ).toEqual({
      openPr: "draft",
    });
  });
});
