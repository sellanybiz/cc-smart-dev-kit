/** `cc-smart-dev-kit workflow`: what `show` prints, and where `set` and `unset` write. */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_UPDATE_COMMAND, VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { cliPaths, tildify } from "../cli/paths";
import { taskContext } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { createTask } from "../tasks/work/store";
import { hookEnv, makeClone, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { runWorkflow, WORKFLOW_USAGE, type WorkflowContext } from "./commands";
import { personalWorkflowFile } from "./resolve";
import { APPEND_ONLY_RULE, MERGE_FILES_RULE, WORKFLOW_KEYS } from "./schema";
import { writePersonalSetting, writeProjectSetting } from "./write";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

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
  worktrees: { base: "main" },
  protectedBranches: ["main"],
  sessionNames: true,
};

/**
 * The `!` line `openPr draft` gets while `allowPush` is off (D16): the clash every `set` of
 * `openPr` prints after the write, in these tests' default settings.
 */
const OPEN_PR_DRAFT_CLASH = `! openPr opens a pull request, but allowPush is off: a session does not push, and that pull request needs the push, so it waits for you every time. Fix: turn allowPush on (\`${COMMAND} workflow set allowPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`).`;

describe("workflow show", () => {
  test("nothing set: every value with the built-in default as where it came from", async () => {
    const run = context(tempDir("not-git"));
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      "your own defaults: ~/.config/cc-smart-dev-kit/workflow.json; a project's .claude/cc-smart-dev-kit.json wins field by field",
      "allowCommit = false (default)",
      "allowPush = false (default)",
      "openPr = off (default)",
      "allowMerge = false (default)",
      "mergeMethod = merge (default)",
      "deleteBranch = false (default)",
      "reviewBeforePush = true (default)",
      "reviewAgents = cc-smart-dev-kit:senior-engineer (default)",
      "fixesAfterReview.lines = 200 (default)",
      "fixesAfterReview.files = 10 (default)",
      "fixesAfterReview.percent = 20 (default)",
      "clearWorktreeAfterMerge = true (default)",
      "issues.enabled = true (default)",
      "issues.allowPublic = false (default)",
      "issues.foundLabel = kit:found (default)",
      "issues.fixedLabel = fixed-unreleased (default)",
      "issues.readyLabel = kit:ready (default)",
      "alerts.usagePercent = 85 (default)",
      "slopAudit.everyPlans = 5 (default)",
      "plans.maxPhases = 10 (default)",
      "plans.runMode = ask (default)",
      "plans.mergeFiles = (nothing) (default)",
      "plans.appendOnly = (nothing) (default)",
      "switches.statusLine = false (default)",
      "switches.sessionNames = false (default)",
      "switches.jobRoute = false (default)",
      "switches.updateHold = false (default)",
      "switches.leadHint = true (default)",
      "review-done = no (this folder is not in a git project)",
      "no project settings here: this folder is not in a git project",
    ]);
  });

  test("a project's file and the person's: each value says where it came from", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      jobs: { route: true },
      workflow: { allowMerge: true, openPr: "draft" },
    });
    mkdirSync(dirname(personalWorkflowFile(cliPaths(env))), { recursive: true });
    writeFileSync(
      personalWorkflowFile(cliPaths(env)),
      `${JSON.stringify({ openPr: "ready", alerts: { sound: true } }, null, 2)}\n`,
    );
    const run = context(repo, env);
    expect(await runWorkflow([], run.context)).toBe(0);
    expect(run.lines).toContain("openPr = draft (project)");
    expect(run.lines.join("\n")).not.toContain("alerts.sound");
    expect(run.lines).toContain("allowMerge = true (project)");
    expect(run.lines).toContain("switches.sessionNames = true (project)");
    expect(run.lines).toContain("switches.jobRoute = true (project)");
    expect(run.lines).not.toContain(
      "no project settings here: this folder is not in a git project",
    );
  });

  test("plans.maxPhases shows with its source: personal, then the project's over it", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    mkdirSync(dirname(personalWorkflowFile(cliPaths(env))), { recursive: true });
    writeFileSync(
      personalWorkflowFile(cliPaths(env)),
      `${JSON.stringify({ plans: { maxPhases: 15 } }, null, 2)}\n`,
    );
    const own = context(repo, env);
    expect(await runWorkflow(["show"], own.context)).toBe(0);
    expect(own.lines).toContain("plans.maxPhases = 15 (personal)");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { maxPhases: 6 } },
    });
    const both = context(repo, env);
    expect(await runWorkflow(["show"], both.context)).toBe(0);
    expect(both.lines).toContain("plans.maxPhases = 6 (project)");
  });

  test("D16: settings that cannot work together are shown, each once, with its fix", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowMerge: true, openPr: "draft" },
    });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    const clashes = run.lines.filter((line) => line.startsWith("! "));
    expect(clashes).toEqual([
      OPEN_PR_DRAFT_CLASH,
      `! openPr is draft and allowMerge is on: a draft pull request is never merged, so allowMerge never acts on the pull request a session opens. Fix: set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn allowMerge off (\`${COMMAND} workflow set allowMerge false\`).`,
    ]);
  });

  test("a broken personal file: one line on stderr, exit 1", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, `${JSON.stringify({ allowCommit: "yes" }, null, 2)}\n`);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["show"], run.context)).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `Invalid ${paths.workflowConfigFile}: allowCommit: Invalid input: expected boolean, received string`,
    ]);
  });
});

describe("workflow set and unset", () => {
  test("a policy value goes into the person's own file, 0600", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "allowCommit", "true"], run.context)).toBe(0);
    const file = cliPaths(env).workflowConfigFile;
    expect(run.lines).toEqual([`+ ~/.config/cc-smart-dev-kit/workflow.json: allowCommit = true`]);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify({ allowCommit: true }, null, 2)}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("D16: a write that leaves a clash names it after the write, with the fix", async () => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ allowPush: true }, null, 2)}\n`);
    // A setting that works with the others names no clash.
    const fine = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "openPr", "ready"], fine.context)).toBe(0);
    expect(fine.lines).toEqual(["~ ~/.config/cc-smart-dev-kit/workflow.json: openPr = ready"]);
    // Taking allowPush away leaves openPr waiting for a person: the clash comes with the write.
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "allowPush", "false"], off.context)).toBe(0);
    expect(off.lines).toEqual([
      "~ ~/.config/cc-smart-dev-kit/workflow.json: allowPush = false",
      OPEN_PR_DRAFT_CLASH,
    ]);
  });

  test("a second value keeps the first, and the file's own indentation", async () => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `{\n    "allowCommit": true\n}\n`);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "alerts.usagePercent", "70"], run.context)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n    "allowCommit": true,\n    "alerts": {\n        "usagePercent": 70\n    }\n}\n`,
    );
    expect(run.lines).toEqual([
      "~ ~/.config/cc-smart-dev-kit/workflow.json: alerts.usagePercent = 70",
    ]);
  });

  test("plans.maxPhases: set writes the number, unset brings the default back", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "plans.maxPhases", "12"], run.context)).toBe(0);
    expect(run.lines).toEqual(["+ ~/.config/cc-smart-dev-kit/workflow.json: plans.maxPhases = 12"]);
    expect(readFileSync(cliPaths(env).workflowConfigFile, "utf8")).toBe(
      `${JSON.stringify({ plans: { maxPhases: 12 } }, null, 2)}\n`,
    );
    const shown = context(tempDir("not-git"), env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain("plans.maxPhases = 12 (personal)");
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "plans.maxPhases"], off.context)).toBe(0);
    const back = context(tempDir("not-git"), env);
    await runWorkflow(["show"], back.context);
    expect(back.lines).toContain("plans.maxPhases = 10 (default)");
  });

  test("plans.maxPhases: a value outside 1-50, a fraction or a word is refused, nothing written", async () => {
    const env = hookEnv();
    for (const bad of ["0", "51", "1.5", "lots"]) {
      const run = context(tempDir("not-git"), env);
      expect(await runWorkflow(["set", "plans.maxPhases", bad], run.context)).toBe(2);
      expect(run.lines).toEqual([]);
      expect(run.errors).toHaveLength(1);
      expect(run.errors[0]).toStartWith("plans.maxPhases is a whole number 1-50\n");
    }
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  test("plans.maxPhases: --project writes the project's file and raises requires to 4.8", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(await runWorkflow(["set", "plans.maxPhases", "7", "--project"], run.context)).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...SETTINGS,
      requires: ">=4.8",
      workflow: { plans: { maxPhases: 7 } },
    });
    const bad = context(repo, env);
    expect(await runWorkflow(["set", "plans.maxPhases", "51", "--project"], bad.context)).toBe(2);
    expect(JSON.parse(readFileSync(file, "utf8")).workflow).toEqual({ plans: { maxPhases: 7 } });
  });

  test("the same value again writes nothing", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    await runWorkflow(["set", "openPr", "draft"], run.context);
    const again = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "openPr", "draft"], again.context)).toBe(0);
    expect(again.lines).toEqual([
      "= ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft (already set)",
      // The clash is still there: it is about the settings, not about this write (D16).
      OPEN_PR_DRAFT_CLASH,
    ]);
  });

  test("unset takes the value out, and the default holds again", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    await runWorkflow(["set", "alerts.usagePercent", "70"], run.context);
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "alerts.usagePercent"], off.context)).toBe(0);
    expect(off.lines).toEqual([
      "- ~/.config/cc-smart-dev-kit/workflow.json: alerts.usagePercent unset",
    ]);
    const shown = context(tempDir("not-git"), env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain("alerts.usagePercent = 85 (default)");
  });

  test("retired notification settings are refused without creating a file", async () => {
    const env = hookEnv();
    for (const key of ["alerts.events", "alerts.sound"]) {
      const run = context(tempDir("not-git"), env);
      expect(await runWorkflow(["set", key, "true"], run.context)).toBe(2);
      expect(run.errors[0]).toContain("Unknown setting");
    }
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  test("--project writes the project's file, keeping its other fields and its indentation", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    writeFileSync(
      file,
      `{\n    "worktrees": { "base": "main", "guardMainFolder": true },\n    "autoMode": ["one rule"]\n}\n`,
    );
    const run = context(repo, env);
    expect(await runWorkflow(["set", "deleteBranch", "true", "--project"], run.context)).toBe(0);
    expect(run.lines).toEqual([`~ ${file}: deleteBranch = true`]);
    // The indent (four spaces here) stays, and so does every line the change does not touch: the
    // one-line object and the one-line array stay as they were.
    expect(readFileSync(file, "utf8")).toBe(
      [
        "{",
        '    "worktrees": { "base": "main", "guardMainFolder": true },',
        '    "autoMode": ["one rule"],',
        '    "workflow": {',
        '        "deleteBranch": true',
        "    }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("D20: --project on a file that still holds a retired engine field: refused, naming it, nothing written", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", setup: ["bun", "install"] },
    });
    const before = readFileSync(file, "utf8");
    const run = context(repo, env);
    expect(await runWorkflow(["set", "allowCommit", "true", "--project"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `Invalid ${file}: worktrees.setup is no longer supported: remove it — Claude Code's own worktrees need none. \`cc-smart-dev-kit project init\` removes it (README § Worktrees).`,
    ]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("a project switch is written as the field the project already reads", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "true", "--project"], run.context)).toBe(
      0,
    );
    expect(run.lines).toEqual([
      `~ ${file}: switches.jobRoute = true; requires ">=0.1" -> ">=0.5.2" (the file's fields need it)`,
    ]);
    // SETTINGS' `>=0.1` is below the lowest plugin that reads any file (0.5.2): a write mends it.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...SETTINGS,
      requires: ">=0.5.2",
      jobs: { route: true },
    });
    const off = context(repo, env);
    expect(await runWorkflow(["unset", "switches.sessionNames", "--project"], off.context)).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after.sessionNames).toBeUndefined();
    expect(after.worktrees).toEqual(SETTINGS.worktrees);
  });

  test("a project switch asked for without --project says where it lives", async () => {
    const env = hookEnv();
    const run = context(makeRepo(), env);
    expect(await runWorkflow(["set", "switches.sessionNames", "true"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      "switches.sessionNames is the project's setting (sessionNames in .claude/cc-smart-dev-kit.json): run it with --project inside the project",
    ]);
  });

  // `switches.jobRoute` has two homes: the person's machine-wide default (no --project), and
  // the project's `jobs.route` (--project), which wins.
  test("switches.jobRoute without --project is the person's default for every project", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const outside = tempDir("not-git");
    const set = context(outside, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "true"], set.context)).toBe(0);
    expect(set.lines).toEqual([
      `+ ${tildify(personalWorkflowFile(paths), paths.home)}: switches.jobRoute = true`,
    ]);
    expect(JSON.parse(readFileSync(personalWorkflowFile(paths), "utf8"))).toEqual({
      switches: { jobRoute: true },
    });
    // Anywhere, with no project at all: its value, and that it is the person's.
    const show = context(outside, env);
    expect(await runWorkflow(["show"], show.context)).toBe(0);
    expect(show.lines).toContain("switches.jobRoute = true (personal)");
    // A project that says nothing about the route follows it.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const inProject = context(repo, env);
    expect(await runWorkflow(["show"], inProject.context)).toBe(0);
    expect(inProject.lines).toContain("switches.jobRoute = true (personal)");
    // The same value again writes nothing.
    const again = context(outside, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "true"], again.context)).toBe(0);
    expect(again.lines).toEqual([
      `= ${tildify(personalWorkflowFile(paths), paths.home)}: switches.jobRoute = true (already set)`,
    ]);
  });

  test("the project's jobs.route wins over the person's default, in both directions", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const mine = context(repo, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "true"], mine.context)).toBe(0);
    // The project turns it off: its value, and it says so.
    const off = context(repo, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "false", "--project"], off.context)).toBe(
      0,
    );
    const showOff = context(repo, env);
    await runWorkflow(["show"], showOff.context);
    expect(showOff.lines).toContain("switches.jobRoute = false (project)");
    // Both homes hold their own value: the person's file keeps true.
    expect(JSON.parse(readFileSync(personalWorkflowFile(paths), "utf8"))).toEqual({
      switches: { jobRoute: true },
    });
    expect((JSON.parse(readFileSync(file, "utf8")) as { jobs: unknown }).jobs).toEqual({
      route: false,
    });
    // The other way: the person says false, the project says true.
    const quiet = context(repo, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "false"], quiet.context)).toBe(0);
    const on = context(repo, env);
    expect(await runWorkflow(["set", "switches.jobRoute", "true", "--project"], on.context)).toBe(
      0,
    );
    const showOn = context(repo, env);
    await runWorkflow(["show"], showOn.context);
    expect(showOn.lines).toContain("switches.jobRoute = true (project)");
    // The project lets go: the person's default shows through again.
    const unset = context(repo, env);
    expect(await runWorkflow(["unset", "switches.jobRoute", "--project"], unset.context)).toBe(0);
    const showMine = context(repo, env);
    await runWorkflow(["show"], showMine.context);
    expect(showMine.lines).toContain("switches.jobRoute = false (personal)");
  });

  test("unset switches.jobRoute takes the person's default out, and the file stays valid", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const outside = tempDir("not-git");
    await runWorkflow(["set", "switches.jobRoute", "true"], context(outside, env).context);
    await runWorkflow(["set", "allowCommit", "true"], context(outside, env).context);
    const run = context(outside, env);
    expect(await runWorkflow(["unset", "switches.jobRoute"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      `- ${tildify(personalWorkflowFile(paths), paths.home)}: switches.jobRoute unset`,
    ]);
    // The empty group goes with it; the other setting stays.
    expect(JSON.parse(readFileSync(personalWorkflowFile(paths), "utf8"))).toEqual({
      allowCommit: true,
    });
    const show = context(outside, env);
    await runWorkflow(["show"], show.context);
    expect(show.lines).toContain("switches.jobRoute = false (default)");
  });

  test("switches.jobRoute takes true or false only, and writes nothing otherwise", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "switches.jobRoute", "maybe"], run.context)).toBe(2);
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toStartWith("switches.jobRoute is true or false\n");
    expect(existsSync(personalWorkflowFile(paths))).toBe(false);
  });

  test("a hand-written switches group the person's file may not hold is named, not used", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(personalWorkflowFile(paths)), { recursive: true });
    writeFileSync(
      personalWorkflowFile(paths),
      `${JSON.stringify({ switches: { sessionNames: true } })}\n`,
    );
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["show"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `Invalid ${personalWorkflowFile(paths)}: sessionNames: unknown field`,
    ]);
  });

  test("a personal switch asked for with --project says where it lives", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(
      await runWorkflow(["set", "switches.updateHold", "true", "--project"], run.context),
    ).toBe(1);
    expect(run.errors).toEqual([
      "switches.updateHold is your own setting, not the project's: run it without --project (the update hold is per person, per machine)",
    ]);
    const lead = context(repo, env);
    expect(
      await runWorkflow(["set", "switches.leadHint", "false", "--project"], lead.context),
    ).toBe(1);
    expect(lead.errors).toEqual([
      "switches.leadHint is your own setting, not the project's: run it without --project (the lead-model hint is per person, per machine)",
    ]);
  });

  test("the lead hint switch is a field in the person's own file, on until it says false", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "switches.leadHint", "false"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "+ ~/.config/cc-smart-dev-kit/workflow.json: switches.leadHint = false",
    ]);
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({
      switches: { leadHint: false },
    });
    const shown = context(tempDir("not-git"), env);
    expect(await runWorkflow(["show"], shown.context)).toBe(0);
    expect(shown.lines).toContain("switches.leadHint = false (personal)");
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "switches.leadHint"], off.context)).toBe(0);
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({});
  });

  test("--project with no .claude/cc-smart-dev-kit.json says to run project init", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(await runWorkflow(["set", "allowCommit", "true", "--project"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `${repo} has no .claude/cc-smart-dev-kit.json: run \`cc-smart-dev-kit project init\` there first, or set this in your own defaults (without --project)`,
    ]);
  });

  test("the status line switch writes Claude Code's own key", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "switches.statusLine", "true"], run.context)).toBe(0);
    const settings = JSON.parse(readFileSync(paths.settingsFile, "utf8")) as {
      statusLine?: { command?: string; type?: string };
    };
    expect(settings.statusLine?.command).toBe(`${paths.binDir}/cc-smart-dev-kit statusline`);
    expect(settings.statusLine?.type).toBe("command");
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "switches.statusLine"], off.context)).toBe(0);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({});
  });

  test("a status line someone else set is never overwritten", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      `${JSON.stringify({ statusLine: { command: "mine", type: "command" } }, null, 2)}\n`,
    );
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "switches.statusLine", "true"], run.context)).toBe(1);
    expect(run.errors[0]).toContain('statusLine is {"command":"mine","type":"command"}');
    expect(run.errors[0]).toContain("cc-smart-dev-kit does not overwrite it");
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({
      statusLine: { command: "mine", type: "command" },
    });
  });

  test("unsetting a status line that is not cc-smart-dev-kit's leaves it", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      `${JSON.stringify({ statusLine: { command: "mine" } }, null, 2)}\n`,
    );
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "switches.statusLine"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "= ~/.claude/settings.json: the cc-smart-dev-kit status line is not on (not owned by cc-smart-dev-kit; left alone)",
    ]);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8"))).toEqual({
      statusLine: { command: "mine" },
    });
  });

  test("the update hold switch is the file behind `update --hold`", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "switches.updateHold", "true"], run.context)).toBe(0);
    expect(existsSync(join(paths.stateDir, "update-hold"))).toBe(true);
    expect(run.lines).toEqual([
      "+ ~/.claude/cc-smart-dev-kit/update-hold: background updates are on hold",
    ]);
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "switches.updateHold"], off.context)).toBe(0);
    expect(existsSync(join(paths.stateDir, "update-hold"))).toBe(false);
  });

  test("an unknown setting, and a value of the wrong kind: exit 2, nothing written", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "autoMergeSoon", "true"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("Unknown setting: autoMergeSoon");
    expect(await runWorkflow(["set", "openPr", "maybe"], run.context)).toBe(2);
    expect(run.errors[1]).toContain("openPr is one of off, draft, ready");
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  test("set with two values, and set with none: exit 2", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "alerts.usagePercent", "70", "failed"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("set needs one value");
    const none = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "allowCommit"], none.context)).toBe(2);
    expect(none.errors[0]).toContain("set needs one value");
  });

  test("an unknown workflow command: exit 2", async () => {
    const run = context(tempDir("not-git"));
    expect(await runWorkflow(["write", "allowCommit", "true"], run.context)).toBe(2);
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

  test("HEAD is recorded: the file holds the full sha, 0600, and says so", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const head = git(repo, "rev-parse", "HEAD").trim();
    const run = context(repo, env);
    expect(await runWorkflow(["review-done"], run.context)).toBe(0);
    const file = recordFile(env, repo);
    expect(run.lines).toEqual([
      `+ ${tildify(file, env.HOME ?? "")}: the review of ${head.slice(0, 7)} is recorded`,
    ]);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object)).toEqual([head]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("show says whether the commit here has one", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const head = git(repo, "rev-parse", "HEAD").trim();
    const before = context(repo, env);
    await runWorkflow(["show"], before.context);
    expect(before.lines).toContain(`review-done = no (HEAD ${head.slice(0, 7)})`);
    await runWorkflow(["review-done"], context(repo, env).context);
    const after = context(repo, env);
    await runWorkflow(["show"], after.context);
    expect(after.lines).toContain(`review-done = yes (HEAD ${head.slice(0, 7)})`);
    expect(after.lines).not.toContain(`review-done = no (HEAD ${head.slice(0, 7)})`);
  });

  test("--sha records an earlier commit; a second call says it was already recorded", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const first = git(repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(repo, "second.txt"), "second\n");
    git(repo, "add", "second.txt");
    git(repo, "commit", "-q", "-m", "second");
    const run = context(repo, env);
    expect(await runWorkflow(["review-done", "--sha", first.slice(0, 7)], run.context)).toBe(0);
    expect(run.lines[0]).toContain(`the review of ${first.slice(0, 7)} is recorded`);
    const again = context(repo, env);
    expect(await runWorkflow(["review-done", "--sha", first], again.context)).toBe(0);
    expect(again.lines[0]).toContain("was already recorded");
    // HEAD itself (the second commit) is not recorded: only the commit asked for.
    const shown = context(repo, env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines.some((line) => line.startsWith("review-done = no (HEAD "))).toBe(true);
  });

  test("a commit nothing names: exit 1, nothing written", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(await runWorkflow(["review-done", "--sha", "no-such-commit"], run.context)).toBe(1);
    expect(run.errors[0]).toContain("no-such-commit is not a commit in this repository");
    expect(existsSync(recordFile(env, repo))).toBe(false);
  });

  test("a broken project file does not stop a review from being recorded", async () => {
    // The record says a commit was reviewed. It does not depend on the project's policy, so a
    // `cc-smart-dev-kit.json` that cannot be read must not keep it from being written — the
    // merge guard reads the record, and every guard that cannot read the file fails closed
    // until it is fixed.
    const env = hookEnv();
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{not json\n");
    const head = git(repo, "rev-parse", "HEAD").trim();
    const run = context(repo, env);
    expect(await runWorkflow(["review-done"], run.context)).toBe(0);
    expect(run.lines[0]).toContain(`the review of ${head.slice(0, 7)} is recorded`);
    expect(existsSync(recordFile(env, repo))).toBe(true);
  });

  test("outside a git project, and with a bad flag: nothing is written", async () => {
    const outside = context(tempDir("not-git"));
    expect(await runWorkflow(["review-done"], outside.context)).toBe(1);
    expect(outside.errors[0]).toContain("this folder is not in a git project");
    const env = hookEnv();
    const repo = makeRepo();
    const bad = context(repo, env);
    expect(await runWorkflow(["review-done", "--sha"], bad.context)).toBe(2);
    expect(bad.errors[0]).toContain("--sha needs a commit");
    const unknown = context(repo, env);
    expect(await runWorkflow(["review-done", "--now"], unknown.context)).toBe(2);
    expect(unknown.errors[0]).toContain("Unknown option: --now");
  });

  test("inside Claude Code it refuses: the review agent's own return records the review", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, { ...env, CLAUDECODE: "1" });
    expect(await runWorkflow(["review-done"], run.context)).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors[0]).toBe(
      "cc-smart-dev-kit workflow review-done cannot run inside a Claude Code session: the review record is written by the review-record hook when a review agent (workflow setting reviewAgents) returns, so a record is never the session's own word. Run it in your own terminal to record one by hand.",
    );
    expect(existsSync(recordFile(env, repo))).toBe(false);
  });

  test("a worktree records into the repository's own file", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const worktree = join(repo, "..", "app-wt-review");
    git(repo, "worktree", "add", "-q", "-b", "review-branch", worktree);
    const head = git(worktree, "rev-parse", "HEAD").trim();
    const run = context(worktree, env);
    expect(await runWorkflow(["review-done"], run.context)).toBe(0);
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
    writePersonalSetting(paths, "allowPush", true);
    expect(writePersonalSetting(paths, "openPr", "ready")).toBe(
      "~ ~/.config/cc-smart-dev-kit/workflow.json: openPr = ready",
    );
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({
      allowPush: true,
      openPr: "ready",
    });
  });

  test("writing a value the schema refuses leaves the file alone", () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    writePersonalSetting(paths, "allowPush", true);
    expect(() => writePersonalSetting(paths, "alerts.usagePercent", 0)).toThrow(
      `Invalid ${paths.workflowConfigFile}: alerts.usagePercent:`,
    );
    expect(JSON.parse(readFileSync(paths.workflowConfigFile, "utf8"))).toEqual({ allowPush: true });
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
    expect(writePersonalSetting(paths, "allowCommit", undefined)).toBe(
      "= ~/.config/cc-smart-dev-kit/workflow.json: allowCommit was not set",
    );
  });
});

describe("the command itself, as Claude Code runs it", () => {
  test("workflow set writes the person's file under this HOME", async () => {
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
      `+ ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft\n${OPEN_PR_DRAFT_CLASH}\n`,
    );
    expect(
      JSON.parse(readFileSync(join(home, ".config", "cc-smart-dev-kit", "workflow.json"), "utf8")),
    ).toEqual({
      openPr: "draft",
    });
  });
});

describe("the review gate (CM-1)", () => {
  /** Commits the project's file and points `origin/main` at it: the policy the guard reads. */
  function committed(repo: string, config: unknown): string {
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
    git(repo, "add", ".claude/cc-smart-dev-kit.json");
    git(repo, "commit", "-q", "-m", "the project's policy");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    return file;
  }

  test.each([
    ["allowMerge", "true"],
    ["reviewBeforePush", "false"],
    ["reviewAgents", "general-purpose"],
    ["fixesAfterReview.lines", "0"],
    ["fixesAfterReview.files", "50"],
  ] as const)(
    "workflow set %s works inside Claude Code: it writes the person's own file, and unset removes it",
    async (key, value) => {
      const env = hookEnv();
      const repo = makeRepo();
      writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
      const inside = { ...env, CLAUDECODE: "1" };
      const run = context(repo, inside);
      expect(await runWorkflow(["set", key, value], run.context)).toBe(0);
      expect(run.errors).toEqual([]);
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(true);
      const removed = context(repo, inside);
      expect(await runWorkflow(["unset", key], removed.context)).toBe(0);
      expect(removed.errors).toEqual([]);
    },
  );

  test.each([
    ["set", "issues.enabled", ["true"]],
    ["set", "issues.allowPublic", ["true"]],
    ["unset", "issues.enabled", []],
  ] as const)(
    "D67: workflow %s %s refuses inside Claude Code, in both files: a session does not open its own way out",
    async (sub, key, value) => {
      const env = hookEnv();
      const repo = makeRepo();
      const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
      const before = readFileSync(file, "utf8");
      for (const where of [[], ["--project"]]) {
        const run = context(repo, { ...env, CLAUDECODE: "1" });
        expect(await runWorkflow([sub, key, ...value, ...where], run.context)).toBe(1);
        expect(run.lines).toEqual([]);
        expect(run.errors).toEqual([
          `cc-smart-dev-kit workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} lets text leave this machine for GitHub, which only you switch. Run it in your own terminal; for the project's policy, change .claude/cc-smart-dev-kit.json there, commit it to the base and push it — the kit reads only the committed file. \`workflow propose\` opens a pull request you review instead.`,
        ]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(before);
    },
  );

  test.each([
    ["set", "plans.maxPhases", ["50"]],
    ["unset", "plans.maxPhases", []],
  ] as const)(
    "workflow %s %s refuses inside Claude Code, in both files: a session does not lift its own phase cap",
    async (sub, key, value) => {
      const env = hookEnv();
      const repo = makeRepo();
      const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
      const before = readFileSync(file, "utf8");
      for (const where of [[], ["--project"]]) {
        const run = context(repo, { ...env, CLAUDECODE: "1" });
        expect(await runWorkflow([sub, key, ...value, ...where], run.context)).toBe(1);
        expect(run.lines).toEqual([]);
        expect(run.errors).toEqual([
          `cc-smart-dev-kit workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} is the limit the task tools hold this session to, so only you change it. Run it in your own terminal. \`workflow propose\` opens a pull request you review instead.`,
        ]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(before);
    },
  );

  test("workflow set plans.maxPhases still works in the person's own terminal", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(await runWorkflow(["set", "plans.maxPhases", "12"], run.context)).toBe(0);
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(true);
  });

  test.each([
    [
      "set",
      "issues.readyLabel",
      ["ready"],
      "names the label that marks a GitHub issue a person chose (D67), whose text the kit then never rewrites; only you choose it",
    ],
    [
      "unset",
      "issues.readyLabel",
      [],
      "names the label that marks a GitHub issue a person chose (D67), whose text the kit then never rewrites; only you choose it",
    ],
  ] as const)(
    "IX2-2: workflow %s %s refuses inside Claude Code, in both files: a session does not pick what counts as ready",
    async (sub, key, value, reason) => {
      const env = hookEnv();
      const repo = makeRepo();
      const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
      const before = readFileSync(file, "utf8");
      for (const where of [[], ["--project"]]) {
        const run = context(repo, { ...env, CLAUDECODE: "1" });
        expect(await runWorkflow([sub, key, ...value, ...where], run.context)).toBe(1);
        expect(run.lines).toEqual([]);
        expect(run.errors).toEqual([
          `cc-smart-dev-kit workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} ${reason}. Run it in your own terminal; for the project's policy, change .claude/cc-smart-dev-kit.json there, commit it to the base and push it — the kit reads only the committed file. \`workflow propose\` opens a pull request you review instead.`,
        ]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(before);
    },
  );

  test("D67: outside Claude Code the switch is set in the person's file and shown with its source", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(await runWorkflow(["set", "issues.enabled", "true"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "+ ~/.config/cc-smart-dev-kit/workflow.json: issues.enabled = true",
    ]);
    const shown = context(repo, env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain("issues.enabled = true (personal)");
    expect(shown.lines).toContain("issues.allowPublic = false (default)");
  });

  test("D67: a label is checked when it is typed", async () => {
    const run = context(tempDir("not-git"));
    expect(await runWorkflow(["set", "issues.readyLabel", "a,b"], run.context)).toBe(2);
    expect(run.errors[0]).toContain(
      "issues.readyLabel is a label name of 1-50 characters on one line, with no comma",
    );
    const ok = context(tempDir("not-git"));
    expect(await runWorkflow(["set", "issues.readyLabel", "ready-to-build"], ok.context)).toBe(0);
  });

  test.each([
    ["set", "issues.watch", ["true"]],
    ["unset", "issues.watch", []],
    ["set", "issues.watchMinutes", ["30"]],
  ] as const)(
    "2.0 removed the issue watch: workflow %s %s is an unknown setting, in and out of Claude Code",
    async (sub, key, value) => {
      const env = hookEnv();
      for (const extra of [{}, { CLAUDECODE: "1" }]) {
        const run = context(tempDir("not-git"), { ...env, ...extra });
        expect(await runWorkflow([sub, key, ...value], run.context)).toBe(2);
        expect(run.lines).toEqual([]);
        expect(run.errors).toEqual([
          `Unknown setting: ${key}. The settings are: allowCommit, allowPush, openPr, allowMerge, mergeMethod, deleteBranch, reviewBeforePush, reviewAgents, fixesAfterReview.lines, fixesAfterReview.files, fixesAfterReview.percent, clearWorktreeAfterMerge, issues.enabled, issues.allowPublic, issues.foundLabel, issues.fixedLabel, issues.readyLabel, alerts.usagePercent, slopAudit.everyPlans, plans.maxPhases, plans.runMode, plans.mergeFiles, plans.appendOnly, switches.statusLine, switches.sessionNames, switches.jobRoute, switches.updateHold, switches.leadHint`,
        ]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
    },
  );

  test("GI4: set refuses a label that is another issue label, and writes nothing", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "issues.fixedLabel", "kit:ready"], run.context)).toBe(1);
    expect(run.errors[0]).toContain("issues.fixedLabel and issues.readyLabel are both kit:ready");
    expect(existsSync(personalWorkflowFile(cliPaths(env)))).toBe(false);
  });

  test("a setting outside the gate still works inside Claude Code", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), { ...env, CLAUDECODE: "1" });
    expect(await runWorkflow(["set", "openPr", "draft"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "+ ~/.config/cc-smart-dev-kit/workflow.json: openPr = draft",
      // D16: the write leaves two settings that cannot work together, and says so.
      OPEN_PR_DRAFT_CLASH,
    ]);
  });

  test("CM-1: show prints the gate as merge-check reads it, from the committed file", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    committed(repo, {
      ...SETTINGS,
      workflow: { allowMerge: true, fixesAfterReview: { lines: 50 } },
    });
    // This checkout's own copy says otherwise: the guard does not read it.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowMerge: false, fixesAfterReview: { lines: 0 }, reviewBeforePush: false },
    });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain("allowMerge = false (project)");
    expect(run.lines).toContain("fixesAfterReview.lines = 0 (project)");
    const gate = run.lines.filter((line) => line.startsWith("gate"));
    expect(gate).toEqual([
      "gate: what merge-check judges with, from origin/main:.claude/cc-smart-dev-kit.json as committed (this checkout's own copy does not count)",
      "gate allowMerge = true (project, committed on origin/main)",
      "gate reviewBeforePush = true (default)",
      "gate reviewAgents = cc-smart-dev-kit:senior-engineer (default)",
      "gate fixesAfterReview.lines = 50 (project, committed on origin/main)",
      "gate fixesAfterReview.files = 10 (default)",
      "gate fixesAfterReview.percent = 20 (default)",
      "gate fixesAfterReview in force: 50 lines in 10 files, or 20% of the reviewed change, whichever is more",
    ]);
  });

  test("CM-1: show says when the committed policy cannot be read", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines.filter((line) => line.startsWith("gate"))).toEqual([
      "gate: merge-check cannot read the policy committed on main (origin/main is not known in this repository (no origin, or the branch was never fetched)), so it allows no merge",
    ]);
  });

  test("show without a worktrees.base: the gate is each pull request's base", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=0.1" });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines.filter((line) => line.startsWith("gate"))).toEqual([
      "gate: this project names no worktrees.base, so merge-check reads the policy committed on each pull request's base",
    ]);
  });

  test("CM-1: review-done = yes only for a record the gate's own list trusts", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    committed(repo, SETTINGS);
    const head = git(repo, "rev-parse", "HEAD").trim();
    const record = join(
      cliPaths(env).stateDir,
      "reviews",
      `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
    );
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(
      record,
      JSON.stringify({ [head]: { at: "2026-10-16T10:00:00.000Z", by: ["general-purpose"] } }),
    );
    const run = context(repo, env);
    await runWorkflow(["show"], run.context);
    expect(run.lines).toContain(`review-done = no (HEAD ${head.slice(0, 7)})`);
  });

  test("review-done records the person, by hand", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const head = git(repo, "rev-parse", "HEAD").trim();
    await runWorkflow(["review-done"], context(repo, env).context);
    const record = join(
      cliPaths(env).stateDir,
      "reviews",
      `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
    );
    expect(JSON.parse(readFileSync(record, "utf8"))[head].by).toEqual(["workflow review-done"]);
  });
});

// ---------------------------------------------------------------------------------------
// D17/D22: `workflow merge-check --branch` prints the merge guard's own review verdict.
// The cases run in a real clone of a bare origin, so `readCover` really measures the fixes.
// ---------------------------------------------------------------------------------------

/** `n` lines `<tag> 1` … `<tag> n`, each ending in a newline. */
function numbered(n: number, tag: string): string {
  return Array.from({ length: n }, (_, index) => `${tag} ${index + 1}\n`).join("");
}

/** Writes each file, commits everything, and returns the new commit. */
function commitFiles(repo: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
}

/** The review record of `repo` in `env`: `sha` reviewed by the plugin's reviewer on `branch`. */
function recordReview(
  env: Record<string, string>,
  repo: string,
  sha: string,
  branch: string,
): void {
  const file = join(
    cliPaths(env).stateDir,
    "reviews",
    `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        [sha]: {
          at: "2026-10-21T10:00:00.000Z",
          by: ["cc-smart-dev-kit:senior-engineer"],
          branches: [branch],
        },
      },
      null,
      2,
    )}\n`,
  );
}

/** A clone whose `main` carries the policy, on a `feat` branch with 100 reviewed lines. */
function branchWorld(): { repo: string; env: Record<string, string>; reviewed: string } {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
  git(repo, "add", ".claude/cc-smart-dev-kit.json");
  git(repo, "commit", "-q", "-m", "the project's policy");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "checkout", "-q", "-b", "feat");
  const reviewed = commitFiles(
    repo,
    { "src/a.txt": numbered(60, "a"), "src/b.txt": numbered(40, "b") },
    "reviewed",
  );
  return { repo, env: hookEnv(), reviewed };
}

/** `env` with only git on PATH: a test reaches no real gh, and so no network. */
function envWithoutGh(env: Record<string, string>): Record<string, string> {
  const bin = tempDir("no-gh");
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("this test needs git");
  symlinkSync(realGit, join(bin, "git"));
  return { ...env, PATH: bin };
}

describe("workflow merge-check", () => {
  test("D17: --branch allows a reviewed branch with its small fixes", async () => {
    const { repo, env, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    const head = commitFiles(repo, { "src/a.txt": numbered(65, "a") }, "fix");
    const run = context(repo, env);
    expect(
      await runWorkflow(["merge-check", "--branch", "feat", "--base", "main"], run.context),
    ).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      `branch feat: allowed — the review of ${reviewed.slice(0, 7)} covers ${head.slice(0, 7)}, with the fixes after it within the limits`,
    ]);
  });

  test("D17: --branch asks about a rewrite, naming the counts and the limit (the guard's words)", async () => {
    const { repo, env, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    rmSync(join(repo, "src/a.txt"));
    rmSync(join(repo, "src/b.txt"));
    commitFiles(repo, { "src/c.txt": numbered(500, "c") }, "rewrite");
    const run = context(repo, env);
    expect(
      await runWorkflow(["merge-check", "--branch", "feat", "--base", "main"], run.context),
    ).toBe(1);
    expect(run.lines).toEqual([
      `branch feat: asks — 600 lines in 3 files changed after the review of ${reviewed.slice(0, 7)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)`,
    ]);
  });

  test("D17: a review of the exact head is allowed, and says so", async () => {
    const { repo, env, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    const run = context(repo, env);
    expect(
      await runWorkflow(["merge-check", "--branch", "feat", "--base", "main"], run.context),
    ).toBe(0);
    expect(run.lines).toEqual([
      `branch feat: allowed — the review of ${reviewed.slice(0, 7)} is of ${reviewed.slice(0, 7)} itself`,
    ]);
  });

  test("a branch that is not in this checkout asks with the reason", async () => {
    const { repo, env } = branchWorld();
    const run = context(repo, env);
    expect(
      await runWorkflow(["merge-check", "--branch", "nowhere", "--base", "main"], run.context),
    ).toBe(1);
    expect(run.lines).toEqual(["branch nowhere: asks — branch nowhere is not in this checkout"]);
  });

  test("a pull request with no gh on PATH asks, and says gh is not installed", async () => {
    const { repo, env } = branchWorld();
    const run = context(repo, envWithoutGh(env));
    expect(await runWorkflow(["merge-check", "7"], run.context)).toBe(1);
    expect(run.lines).toEqual([
      "#7: asks — cc-smart-dev-kit could not check this merge: gh is not installed. Approve the merge yourself if it is right.",
    ]);
  });

  test("--asked is a known option: a pull request with it still asks when gh is not there", async () => {
    const { repo, env } = branchWorld();
    const run = context(repo, envWithoutGh(env));
    expect(await runWorkflow(["merge-check", "7", "--asked"], run.context)).toBe(1);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      "#7: asks — cc-smart-dev-kit could not check this merge: gh is not installed. Approve the merge yourself if it is right.",
    ]);
  });

  test("several pull requests share one list of the open ones, and each pull request's commits are read once", async () => {
    const { repo, env } = branchWorld();
    // The policy the check reads is the one committed on origin/main: merging by itself is on.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { allowMerge: true, reviewBeforePush: false },
    });
    git(repo, "add", ".claude/cc-smart-dev-kit.json");
    git(repo, "commit", "-q", "-m", "merge by itself");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    const bin = tempDir("fake-gh");
    const log = join(bin, "calls.log");
    const head = "a".repeat(40);
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${log}"`,
        'case "$1 $2" in',
        `  "pr view") echo '{"baseRefName":"main","headRefName":"feat","headRefOid":"${head}","number":'"$3"'}' ;;`,
        `  "repo view") echo '{"defaultBranchRef":{"name":"main"}}' ;;`,
        `  "pr list") echo '[{"baseRefName":"main","headRefName":"other","headRefOid":"${"c".repeat(40)}","isCrossRepository":false,"number":9}]' ;;`,
        `  "pr checks") echo '[{"bucket":"pass","name":"ci"}]' ;;`,
        // Each head's own commits: the two share none, so neither is stacked.
        `  api*) case "$2" in *compare/main...${head}*) printf "1\\n${head}\\n" ;; *) printf "1\\n${"c".repeat(40)}\\n" ;; esac ;;`,
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const run = context(repo, { ...env, PATH: `${bin}:${env.PATH ?? ""}` });
    expect(await runWorkflow(["merge-check", "7", "8"], run.context)).toBe(0);
    expect(run.lines).toHaveLength(2);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.filter((line) => line.startsWith("pr list --state open"))).toHaveLength(1);
    // The head both pull requests share is read once, and #9's commits once.
    expect(calls.filter((line) => line.startsWith("api "))).toHaveLength(2);
  });

  test("the usage text names --asked and says what it sets aside", () => {
    expect(WORKFLOW_USAGE).toContain(
      "merge-check [<pr>… | <pr> --asked | --branch <b> --base <base>]",
    );
    expect(WORKFLOW_USAGE).toContain("sets aside allowMerge and nothing else");
    expect(WORKFLOW_USAGE).toContain("the verdict says the merge rests on the person's yes");
    expect(WORKFLOW_USAGE).toContain("--asked takes exactly one pull request");
    expect(WORKFLOW_USAGE).toContain("not stacked on another open pull request");
  });

  test("the usage mistakes: a pair of flags, numbers, or both refused", async () => {
    const { repo, env } = branchWorld();
    for (const [argv, why] of [
      [["merge-check"], "merge-check needs a pull request number, or --branch with --base"],
      [["merge-check", "--branch", "feat"], "merge-check needs both --branch and --base"],
      [
        ["merge-check", "--branch", "feat", "--base", "main", "7"],
        "merge-check takes pull request numbers, or --branch with --base, not both",
      ],
      [["merge-check", "fix/login"], "Not a pull request number: fix/login"],
      [["merge-check", "7", "--since", "yesterday"], "Unknown option: --since"],
      [
        ["merge-check", "--asked"],
        "merge-check needs a pull request number, or --branch with --base",
      ],
      [
        ["merge-check", "7", "8", "--asked"],
        "--asked is one person's yes to one merge: give it exactly one pull request, not 2",
      ],
      [
        ["merge-check", "--asked", "7", "7"],
        "--asked is one person's yes to one merge: give it exactly one pull request, not 2",
      ],
      [
        ["merge-check", "--branch", "feat", "--base", "main", "--asked"],
        "--asked is for a pull request: a local branch has no allowMerge to set aside",
      ],
    ]) {
      const run = context(repo, env);
      expect(await runWorkflow(argv as string[], run.context)).toBe(2);
      expect(run.errors[0]).toStartWith(`${why}\n\n`);
      expect(run.lines).toEqual([]);
    }
  });

  test("a project without the file: exit 1, and says there is no policy", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(await runWorkflow(["merge-check", "7"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `cc-smart-dev-kit workflow merge-check: ${repo} has no .claude/cc-smart-dev-kit.json, so there is no merge policy to check`,
    ]);
  });
});

describe("workflow propose: the arguments", () => {
  test("a setting, a value or --unset, a folder and JSON; anything else is refused before a run", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    for (const [argv, why] of [
      [["propose"], "propose needs a setting"],
      [
        ["propose", "worktree.base", "main"],
        `Unknown setting: worktree.base. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
      ],
      [["propose", "allowCommit"], "propose needs one value, or --unset"],
      [
        ["propose", "openPr", "draft", "ready"],
        'propose needs one value (quote a list, like "needs-you, question"), or --unset',
      ],
      [
        ["propose", "allowCommit", "true", "--unset"],
        "propose takes a value, or --unset, not both",
      ],
      [["propose", "allowCommit", "true", "--folder"], "--folder needs the project's folder"],
      [["propose", "allowCommit", "true", "--yes"], "Unknown option: --yes"],
      [["propose", "allowCommit", "yes"], "allowCommit is true or false"],
    ] as [string[], string][]) {
      const run = context(repo, env);
      expect(await runWorkflow(argv, run.context)).toBe(2);
      expect(run.errors[0]).toStartWith(`${why}\n\n`);
      expect(run.lines).toEqual([]);
    }
  });
});

describe("plans.runMode and plans.mergeFiles", () => {
  test("runMode: set writes the person's file, show says personal, unset brings ask back", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "plans.runMode", "lead-children"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "+ ~/.config/cc-smart-dev-kit/workflow.json: plans.runMode = lead-children",
    ]);
    expect(readFileSync(cliPaths(env).workflowConfigFile, "utf8")).toBe(
      `${JSON.stringify({ plans: { runMode: "lead-children" } }, null, 2)}\n`,
    );
    const shown = context(tempDir("not-git"), env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain("plans.runMode = lead-children (personal)");
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "plans.runMode"], off.context)).toBe(0);
    const back = context(tempDir("not-git"), env);
    await runWorkflow(["show"], back.context);
    expect(back.lines).toContain("plans.runMode = ask (default)");
  });

  test("runMode: another word is refused with the four, and nothing is written", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "plans.runMode", "children"], run.context)).toBe(2);
    expect(run.errors[0]).toStartWith(
      "plans.runMode is one of ask, solo, lead-children, coordinator\n\n",
    );
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  test("runMode with --project is refused: it is the person's own, and the project file stays", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const before = readFileSync(file, "utf8");
    for (const [sub, value] of [
      ["set", ["solo"]],
      ["unset", []],
    ] as const) {
      const run = context(repo, env);
      expect(await runWorkflow([sub, "plans.runMode", ...value, "--project"], run.context)).toBe(1);
      expect(run.lines).toEqual([]);
      expect(run.errors).toEqual([
        "plans.runMode is your own setting, not the project's: run it without --project (a committed value would spend every teammate's usage)",
      ]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("runMode: propose has nothing to propose, and names the command that sets it", async () => {
    const repo = makeRepo();
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["propose", "plans.runMode", "solo"], run.context)).toBe(1);
    expect(run.errors).toEqual([
      `plans.runMode is your own setting, not the project's, so there is nothing to propose: a committed value would spend every teammate's usage — change it with \`${COMMAND} workflow set plans.runMode <value>\`.`,
    ]);
  });

  test.each([
    [
      "set",
      "plans.runMode",
      ["solo"],
      `${COMMAND} workflow set plans.runMode cannot run inside a Claude Code session: plans.runMode decides how many sessions spend your usage on queued plans, so only you choose it. Run this in your own terminal: ${COMMAND} workflow set plans.runMode <ask|solo|lead-children|coordinator>`,
    ],
    [
      "unset",
      "plans.runMode",
      [],
      `${COMMAND} workflow unset plans.runMode cannot run inside a Claude Code session: plans.runMode decides how many sessions spend your usage on queued plans, so only you choose it. Run this in your own terminal: ${COMMAND} workflow unset plans.runMode`,
    ],
    [
      "set",
      "plans.mergeFiles",
      ["CHANGELOG.md"],
      `${COMMAND} workflow set plans.mergeFiles cannot run inside a Claude Code session: plans.mergeFiles names the paths the plans' overlap check leaves out, so a session that could widen it would lift its own check; the kit reads only the copy committed on origin/<worktrees.base>. Run it in your own terminal with --project and commit it to the base. \`workflow propose\` opens a pull request you review instead.`,
    ],
    [
      "unset",
      "plans.mergeFiles",
      [],
      `${COMMAND} workflow unset plans.mergeFiles cannot run inside a Claude Code session: plans.mergeFiles names the paths the plans' overlap check leaves out, so a session that could widen it would lift its own check; the kit reads only the copy committed on origin/<worktrees.base>. Run it in your own terminal with --project and commit it to the base. \`workflow propose\` opens a pull request you review instead.`,
    ],
    [
      "set",
      "plans.appendOnly",
      ["db/migrations/"],
      `${COMMAND} workflow set plans.appendOnly cannot run inside a Claude Code session: plans.appendOnly names the folders where the plans' overlap check compares files only, so a session that could widen it would lift its own check; the kit reads only the copy committed on origin/<worktrees.base>. Run it in your own terminal with --project and commit it to the base. \`workflow propose\` opens a pull request you review instead.`,
    ],
    [
      "unset",
      "plans.appendOnly",
      [],
      `${COMMAND} workflow unset plans.appendOnly cannot run inside a Claude Code session: plans.appendOnly names the folders where the plans' overlap check compares files only, so a session that could widen it would lift its own check; the kit reads only the copy committed on origin/<worktrees.base>. Run it in your own terminal with --project and commit it to the base. \`workflow propose\` opens a pull request you review instead.`,
    ],
  ] as const)(
    "workflow %s %s refuses inside Claude Code, in both files, and writes nothing",
    async (sub, key, value, message) => {
      const env = hookEnv();
      const repo = makeRepo();
      const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
      const before = readFileSync(file, "utf8");
      for (const where of [[], ["--project"]]) {
        const run = context(repo, { ...env, CLAUDECODE: "1" });
        expect(await runWorkflow([sub, key, ...value, ...where], run.context)).toBe(1);
        expect(run.lines).toEqual([]);
        expect(run.errors).toEqual([message]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(before);
    },
  );

  test("mergeFiles and appendOnly without --project are refused: they are the project's, read as committed", async () => {
    const env = hookEnv();
    for (const [sub, key, value] of [
      ["set", "plans.mergeFiles", ["CHANGELOG.md"]],
      ["unset", "plans.mergeFiles", []],
      ["set", "plans.appendOnly", ["db/migrations/"]],
      ["unset", "plans.appendOnly", []],
    ] as const) {
      const run = context(tempDir("not-git"), env);
      expect(await runWorkflow([sub, key, ...value], run.context)).toBe(1);
      expect(run.lines).toEqual([]);
      expect(run.errors).toEqual([
        `${key} is the project's setting, not yours: run it with --project inside the project, and commit it to the base (it counts only as committed on origin/<worktrees.base>)`,
      ]);
    }
    expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
  });

  // The same floor logic as mergeFiles: this build meets 6.3 (the list is written) or says to update.
  test("appendOnly: --project writes the folders and raises requires to 6.3, or on an older build says to update; a bare name is refused", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const before = readFileSync(file, "utf8");
    const bare = context(repo, env);
    expect(
      await runWorkflow(["set", "plans.appendOnly", "db/migrations", "--project"], bare.context),
    ).toBe(2);
    expect(bare.errors[0]).toStartWith(`${APPEND_ONLY_RULE}; `);
    expect(readFileSync(file, "utf8")).toBe(before);
    const run = context(repo, env);
    const code = await runWorkflow(
      ["set", "plans.appendOnly", "./db/migrations/", "--project"],
      run.context,
    );
    if (Bun.semver.order(VERSION, "6.3.0") < 0) {
      expect(code).toBe(1);
      expect(run.errors).toEqual([
        `${file}: this project needs cc-smart-dev-kit >=6.3; you have ${VERSION}; run ${PLUGIN_UPDATE_COMMAND}`,
      ]);
      expect(readFileSync(file, "utf8")).toBe(before);
      return;
    }
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...SETTINGS,
      requires: ">=6.3",
      workflow: { plans: { appendOnly: ["db/migrations/"] } },
    });
  });

  test("show: the committed appendOnly is what the plan tools read, not the working copy's", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      requires: ">=6.3",
      workflow: { plans: { appendOnly: ["db/migrations/"] } },
    });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "policy");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      requires: ">=6.3",
      workflow: { plans: { appendOnly: ["src/"] } },
    });
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain("plans.appendOnly = src/ (project)");
    expect(run.lines).toContain(
      "plans.appendOnly as the plan tools read it, from origin/main:.claude/cc-smart-dev-kit.json = db/migrations/",
    );
  });

  test("mergeFiles: a bad path is refused with the rule, nothing written", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const before = readFileSync(file, "utf8");
    for (const bad of ["../x", "/abs", ".", "a, .."]) {
      const run = context(repo, hookEnv());
      expect(await runWorkflow(["set", "plans.mergeFiles", bad, "--project"], run.context)).toBe(2);
      expect(run.errors[0]).toStartWith(`${MERGE_FILES_RULE}; `);
      expect(run.lines).toEqual([]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  // `--project` raises `requires` to the 5.2 floor, and the write checks the file it is about to
  // write against the running version. So this build either meets the floor (5.2.0 and later:
  // the list is written) or tells the person to update and writes nothing. One test, both cases.
  test("mergeFiles: --project writes the normalised list and raises requires to 5.2, or on an older build says to update", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const before = readFileSync(file, "utf8");
    const run = context(repo, env);
    const code = await runWorkflow(
      ["set", "plans.mergeFiles", "./plugin/dist\\, CHANGELOG.md", "--project"],
      run.context,
    );
    if (Bun.semver.order(VERSION, "5.2.0") < 0) {
      expect(code).toBe(1);
      expect(run.lines).toEqual([]);
      expect(run.errors).toEqual([
        `${file}: this project needs cc-smart-dev-kit >=5.2; you have ${VERSION}; run ${PLUGIN_UPDATE_COMMAND}`,
      ]);
      expect(readFileSync(file, "utf8")).toBe(before);
      return;
    }
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...SETTINGS,
      requires: ">=5.2",
      workflow: { plans: { mergeFiles: ["plugin/dist/", "CHANGELOG.md"] } },
    });
    const off = context(repo, env);
    expect(await runWorkflow(["unset", "plans.mergeFiles", "--project"], off.context)).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).workflow).toBeUndefined();
  });

  test("show: the working copy's list and the committed one it counts, side by side", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { mergeFiles: ["CHANGELOG.md"] } },
    });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "policy");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    // A session widens its own copy; only the committed list counts.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { mergeFiles: ["src/", "plugin/"] } },
    });
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain("plans.mergeFiles = src/, plugin/ (project)");
    expect(run.lines).toContain(
      "plans.mergeFiles as the plan tools read it, from origin/main:.claude/cc-smart-dev-kit.json = CHANGELOG.md",
    );
  });

  test("show: a bare folder in the committed list is left out of the line, with the fix", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { mergeFiles: ["docs", "CHANGELOG.md"] } },
    });
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "guide.md"), "x\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "policy");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain(
      "plans.mergeFiles as the plan tools read it, from origin/main:.claude/cc-smart-dev-kit.json = CHANGELOG.md (plans.mergeFiles on origin/main leaves out docs until fixed (docs is a folder: write it docs/))",
    );
  });

  test("show: with no origin/<base> the plan tools see nothing, and the line says why", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { mergeFiles: ["CHANGELOG.md"] } },
    });
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain(
      "plans.mergeFiles as the plan tools read it, from origin/main:.claude/cc-smart-dev-kit.json = (nothing) (origin/main is not known in this repository (no origin, or the branch was never fetched))",
    );
    expect(run.lines).toContain(
      "plans.appendOnly as the plan tools read it, from origin/main:.claude/cc-smart-dev-kit.json = (nothing) (origin/main is not known in this repository (no origin, or the branch was never fetched))",
    );
  });

  test("a project file that sets runMode makes show say so instead of using it", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { plans: { runMode: "coordinator" } },
    });
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain("plans.runMode = ask (default)");
    expect(run.lines.at(-1)).toContain(
      "workflow.plans.runMode is your own setting, not the project's",
    );
  });
});

describe("slopAudit.everyPlans through set, unset and show", () => {
  test("set writes the number, show says where it came from, unset brings the default back", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "slopAudit.everyPlans", "0"], run.context)).toBe(0);
    expect(JSON.parse(readFileSync(personalWorkflowFile(cliPaths(env)), "utf8"))).toEqual({
      slopAudit: { everyPlans: 0 },
    });
    const shown = context(tempDir("not-git"), env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain("slopAudit.everyPlans = 0 (personal)");
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "slopAudit.everyPlans"], off.context)).toBe(0);
    const again = context(tempDir("not-git"), env);
    await runWorkflow(["show"], again.context);
    expect(again.lines).toContain("slopAudit.everyPlans = 5 (default)");
  });

  test("the project's value wins over the person's", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { slopAudit: { everyPlans: 2 } },
    });
    writePersonalSetting(cliPaths(env), "slopAudit.everyPlans", 9);
    const run = context(repo, env);
    await runWorkflow(["show"], run.context);
    expect(run.lines).toContain("slopAudit.everyPlans = 2 (project)");
  });

  test("a value that is not a whole number from 0 is refused, nothing written", async () => {
    const env = hookEnv();
    for (const bad of ["-1", "2.5", "often"]) {
      const run = context(tempDir("not-git"), env);
      expect(await runWorkflow(["set", "slopAudit.everyPlans", bad], run.context)).toBe(2);
      expect(run.errors[0]).toStartWith("slopAudit.everyPlans is a whole number, 0 or more");
    }
    expect(existsSync(personalWorkflowFile(cliPaths(env)))).toBe(false);
  });
});

describe("workflow claims", () => {
  /** A clone whose main holds a claim and its home, on a branch that defines the name again. */
  function cloneWithBranch(): string {
    const { repo } = makeClone();
    mkdirSync(join(repo, "docs"));
    writeFileSync(
      join(repo, "docs/prices.md"),
      "# Prices\n\nThe one home for prices is `formatPrice`.\n",
    );
    writeFileSync(join(repo, "prices.ts"), "export function formatPrice() {}\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "claim");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "checkout", "-q", "-b", "feature");
    writeFileSync(
      join(repo, "cart.ts"),
      "const total = 1;\nexport const formatPrice = (n) => n;\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "second copy");
    return repo;
  }

  test("the default base is the merge base with origin's default branch", async () => {
    const run = context(cloneWithBranch(), hookEnv());
    expect(await runWorkflow(["claims"], run.context)).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      "Claims (1):",
      "  docs/prices.md:3 — the one home — names: formatPrice",
      "Re-defined in this diff (1):",
      "  cart.ts:2 defines formatPrice, which docs/prices.md:3 calls its one home",
    ]);
  });

  test("a local branch named origin/main does not move the default base", async () => {
    const repo = cloneWithBranch();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    git(repo, "branch", "origin/main", "HEAD");
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["claims"], run.context)).toBe(0);
    expect(run.lines.slice(-2)).toEqual([
      "Re-defined in this diff (1):",
      "  cart.ts:2 defines formatPrice, which docs/prices.md:3 calls its one home",
    ]);
  });

  test("--json prints the claims, the hits and why no diff was read, and nothing else", async () => {
    const run = context(cloneWithBranch(), hookEnv());
    expect(await runWorkflow(["claims", "--json"], run.context)).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(JSON.parse(run.lines[0] ?? "")).toEqual({
      claims: [{ file: "docs/prices.md", line: 3, phrase: "the one home", names: ["formatPrice"] }],
      hits: [
        {
          file: "cart.ts",
          line: 2,
          name: "formatPrice",
          claim: { file: "docs/prices.md", line: 3 },
        },
      ],
      diffWhy: null,
    });
  });

  test("--json with no default branch known carries the reason", async () => {
    const run = context(makeRepo(), hookEnv());
    expect(await runWorkflow(["claims", "--json"], run.context)).toBe(0);
    expect(JSON.parse(run.lines.join("\n"))).toEqual({
      claims: [],
      hits: [],
      diffWhy:
        "the default branch is unknown: pass --base <ref>, or run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
    });
  });

  test("--base names the start: HEAD against itself re-defines nothing", async () => {
    const run = context(cloneWithBranch(), hookEnv());
    expect(await runWorkflow(["claims", "--base", "HEAD"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "Claims (1):",
      "  docs/prices.md:3 — the one home — names: formatPrice",
      "Re-defined in this diff (0):",
    ]);
  });

  test("no default branch known: the claims are listed and the line says why no diff was read", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "NOTES.md"), "Single source of truth.\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "note");
    const run = context(repo, hookEnv());
    expect(await runWorkflow(["claims"], run.context)).toBe(0);
    expect(run.lines).toEqual([
      "Claims (1):",
      "  NOTES.md:1 — single source of truth — names: none",
      "No diff was read: the default branch is unknown: pass --base <ref>, or run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
    ]);
  });

  test("a base that is no commit is one error line, exit 1", async () => {
    const run = context(cloneWithBranch(), hookEnv());
    expect(await runWorkflow(["claims", "--base", "no-such-ref"], run.context)).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `${COMMAND} workflow claims: no-such-ref is not a commit in this repository`,
    ]);
  });

  test("outside git it says so and exits 0", async () => {
    const run = context(tempDir("not-git"), hookEnv());
    expect(await runWorkflow(["claims"], run.context)).toBe(0);
    expect(run.lines).toEqual(["No claims read: this folder is not in a git project"]);
    const json = context(tempDir("not-git"), hookEnv());
    expect(await runWorkflow(["claims", "--json"], json.context)).toBe(0);
    expect(JSON.parse(json.lines.join("\n"))).toEqual({
      claims: [],
      hits: [],
      diffWhy: "this folder is not in a git project",
    });
  });

  test("a wrong option or a stray word is exit 2 with the usage", async () => {
    for (const argv of [
      ["claims", "--nope"],
      ["claims", "extra"],
      ["claims", "--base"],
    ]) {
      const run = context(makeRepo(), hookEnv());
      expect(await runWorkflow(argv, run.context)).toBe(2);
      expect(run.errors[0]).toContain("Usage:");
    }
  });
});

describe("workflow slop", () => {
  const LEAD = { sessionId: "lead", pid: 1, procStart: "1" };

  /** A repo with plan `alpha` (code in two areas, and a prose file) in the task store of `env`. */
  function repoWithPlan(
    env: Record<string, string>,
    files = ["src/workflow/claims.ts", "src/workflow/slop.ts", "README.md", "scripts/build/run.ts"],
  ): string {
    const repo = makeRepo();
    const tasks = taskContext(repo, env);
    if (!tasks.ok) throw new Error(tasks.why);
    const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
    try {
      const made = createTask(
        db,
        {
          project: tasks.project,
          subject: "Alpha",
          kind: "plan",
          plan: "alpha",
          files,
        },
        LEAD,
        1,
      );
      if (!made.ok) throw new Error(made.why);
    } finally {
      db.close();
    }
    return repo;
  }

  function slopFileOf(env: Record<string, string>, repo: string): string {
    return join(
      cliPaths(env).stateDir,
      "slop",
      `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`,
    );
  }

  const RECORD = ["slop", "record", "--plan", "alpha", "--bypassed", "1", "--drifted", "0"];
  const CLEAN = ["slop", "record", "--plan", "alpha", "--bypassed", "0", "--drifted", "0"];

  test("record takes the areas from the plan's own file list, then prints the status", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    const run = context(repo, env);
    expect(await runWorkflow(RECORD, run.context)).toBe(0);
    const file = slopFileOf(env, repo);
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      `+ ${tildify(file, env.HOME ?? "")}: plan alpha recorded (1 bypassed, 0 drifted)`,
      "Slop audit: due — plan alpha left 1 bypassed home and 0 drifted copies",
      "Last audit: never",
      "Not audited yet: 1 bypassed, 0 drifted",
      "Plans: alpha (1 bypassed, 0 drifted)",
      "Areas: scripts/build, src/workflow",
    ]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a clean plan that touched only prose is not counted; one with a finding is", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env, ["README.md", "docs/design/workflow.md"]);
    const clean = context(repo, env);
    expect(await runWorkflow(CLEAN, clean.context)).toBe(0);
    expect(clean.lines).toEqual([
      "· plan alpha touched no code area and left no finding: not counted",
      "Slop audit: not due (0 plans not audited yet; cadence every 5 plans, next at 5)",
      "Last audit: never",
      "Not audited yet: 0 bypassed, 0 drifted",
    ]);
    expect(existsSync(slopFileOf(env, repo))).toBe(false);
    const found = context(repo, env);
    expect(await runWorkflow(RECORD, found.context)).toBe(0);
    expect(found.lines[0]).toBe(
      `+ ${tildify(slopFileOf(env, repo), env.HOME ?? "")}: plan alpha recorded (1 bypassed, 0 drifted)`,
    );
  });

  test("the project's merge files are no area", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      requires: ">=6.6",
      workflow: { plans: { mergeFiles: ["scripts/build/"] } },
    });
    const run = context(repo, env);
    expect(await runWorkflow(RECORD, run.context)).toBe(0);
    expect(run.lines.at(-1)).toBe("Areas: src/workflow");
  });

  test("a second record of the same plan replaces the first, and #n names the plan too", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    await runWorkflow(RECORD, context(repo, env).context);
    const again = context(repo, env);
    const byNumber = ["slop", "record", "--plan", "#1", "--bypassed", "0", "--drifted", "0"];
    expect(await runWorkflow(byNumber, again.context)).toBe(0);
    expect(again.lines.slice(1)).toEqual([
      "Slop audit: not due (1 plan not audited yet; cadence every 5 plans, next at 5)",
      "Last audit: never",
      "Not audited yet: 0 bypassed, 0 drifted",
      "Plans: alpha (0 bypassed, 0 drifted)",
      "Areas: scripts/build, src/workflow",
    ]);
  });

  test("an unknown plan is refused with the fix, and nothing is written", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    const run = context(repo, env);
    const unknown = ["slop", "record", "--plan", "nope", "--bypassed", "0", "--drifted", "0"];
    expect(await runWorkflow(unknown, run.context)).toBe(1);
    expect(run.errors).toEqual([
      `${COMMAND} workflow slop record: plan "nope" is not in this project's task store. Use the slug of the plan task, as the task list shows it (task_list, scope plan).`,
    ]);
    expect(existsSync(slopFileOf(env, repo))).toBe(false);
  });

  test("a #n that names a task, not a plan, is refused as one, and nothing is written", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    const tasks = taskContext(repo, env);
    if (!tasks.ok) throw new Error(tasks.why);
    const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
    try {
      createTask(db, { project: tasks.project, subject: "Loose" }, LEAD, 2);
    } finally {
      db.close();
    }
    const run = context(repo, env);
    const task = ["slop", "record", "--plan", "#2", "--bypassed", "0", "--drifted", "0"];
    expect(await runWorkflow(task, run.context)).toBe(1);
    expect(run.errors).toEqual([
      `${COMMAND} workflow slop record: #2 is a task, not a plan. Use the slug of the plan task, as the task list shows it (task_list, scope plan).`,
    ]);
    expect(existsSync(slopFileOf(env, repo))).toBe(false);
  });

  test("a count past the bound is refused with the rule, and nothing is written", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    const run = context(repo, env);
    const huge = ["slop", "record", "--plan", "alpha", "--bypassed", "99999999999999999999"];
    expect(await runWorkflow([...huge, "--drifted", "0"], run.context)).toBe(2);
    expect(run.errors[0]).toStartWith(
      "slop record needs --plan <slug>, --bypassed <n> and --drifted <n>, each count a whole number from 0 to 1000\n\nUsage:",
    );
    expect(existsSync(slopFileOf(env, repo))).toBe(false);
  });

  test("a task store that cannot be read is the command's own error line", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const store = workDbFile(cliPaths(env));
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, "not a database, but long enough to look like a file to open");
    const run = context(repo, env);
    expect(await runWorkflow(RECORD, run.context)).toBe(1);
    expect(run.errors).toEqual([
      `${COMMAND} workflow slop record: the task store cannot be read: file is not a database`,
    ]);
  });

  test("a project with no task store yet refuses the same way", async () => {
    const run = context(makeRepo(), hookEnv());
    expect(await runWorkflow(RECORD, run.context)).toBe(1);
    expect(run.errors[0]).toContain('plan "alpha" is not in this project\'s task store');
  });

  test("status --json is the contract, and the cadence comes from the setting", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    writePersonalSetting(cliPaths(env), "slopAudit.everyPlans", 1);
    await runWorkflow(CLEAN, context(repo, env).context);
    const run = context(repo, env);
    expect(await runWorkflow(["slop", "status", "--json"], run.context)).toBe(0);
    const status = JSON.parse(run.lines.join("\n")) as Record<string, unknown>;
    expect(Object.keys(status)).toEqual([
      "since",
      "unaudited",
      "plans",
      "bypassed",
      "drifted",
      "areas",
      "due",
      "why",
    ]);
    expect(status).toMatchObject({
      since: null,
      unaudited: 1,
      bypassed: 0,
      drifted: 0,
      areas: ["scripts/build", "src/workflow"],
      due: true,
      why: "1 plan closed and not audited yet (every 1)",
    });
  });

  test("everyPlans 0 turns the count off: a clean plan is not due", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    writePersonalSetting(cliPaths(env), "slopAudit.everyPlans", 0);
    const run = context(repo, env);
    await runWorkflow(CLEAN, run.context);
    expect(run.lines[1]).toBe("Slop audit: not due (1 plan not audited yet; cadence off)");
  });

  test("audited starts the count again, for every area or the named ones", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    await runWorkflow(RECORD, context(repo, env).context);
    const part = context(repo, env);
    const named = ["slop", "audited", "--area", "src/workflow/"];
    expect(await runWorkflow(named, part.context)).toBe(0);
    expect(part.lines[0]).toEndWith(": audit recorded for src/workflow (0 plans cleared)");
    expect(part.lines.at(-1)).toBe("Areas: scripts/build");
    const all = context(repo, env);
    expect(await runWorkflow(["slop", "audited"], all.context)).toBe(0);
    expect(all.lines[0]).toEndWith(": audit recorded for every area (1 plan cleared)");
    expect(all.lines.slice(1, 3)).toEqual([
      "Slop audit: not due (0 plans not audited yet; cadence every 5 plans, next at 5)",
      expect.stringMatching(/^Last audit: \d{4}-\d\d-\d\dT/),
    ]);
  });

  test("audited --area of a parent folder, typed with ./, clears the plan and says so", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    await runWorkflow(RECORD, context(repo, env).context);
    const run = context(repo, env);
    const named = ["slop", "audited", "--area", "./src", "--area", "scripts"];
    expect(await runWorkflow(named, run.context)).toBe(0);
    expect(run.lines[0]).toEndWith(": audit recorded for src, scripts (1 plan cleared)");
    expect(run.lines[1]).toBe(
      "Slop audit: not due (0 plans not audited yet; cadence every 5 plans, next at 5)",
    );
  });

  test("audited --area in another case clears the plan when the checkout ignores case", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    git(repo, "config", "core.ignorecase", "true");
    await runWorkflow(RECORD, context(repo, env).context);
    const run = context(repo, env);
    const named = ["slop", "audited", "--area", "SRC", "--area", "Scripts"];
    expect(await runWorkflow(named, run.context)).toBe(0);
    expect(run.lines[0]).toEndWith(": audit recorded for SRC, Scripts (1 plan cleared)");
  });

  test("audited --area . is refused, and the error says how to record an audit of everything", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    for (const area of [".", "./"]) {
      const run = context(repo, env);
      expect(await runWorkflow(["slop", "audited", "--area", area], run.context)).toBe(2);
      expect(run.errors[0]).toStartWith(
        `--area "${area}" names the whole repository: after an audit of everything, run ${COMMAND} workflow slop audited with no --area\n\nUsage:`,
      );
    }
  });

  test("audited --area that clears no plan says so on a ! line", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    await runWorkflow(RECORD, context(repo, env).context);
    const run = context(repo, env);
    expect(await runWorkflow(["slop", "audited", "--area", "lib"], run.context)).toBe(0);
    expect(run.lines.slice(0, 2)).toEqual([
      `+ ${tildify(slopFileOf(env, repo), env.HOME ?? "")}: audit recorded for lib (0 plans cleared)`,
      `! No plan cleared: no plan in the count has all its areas at or under lib. Name the areas the status lists, or run ${COMMAND} workflow slop audited with no --area after an audit of everything.`,
    ]);
  });

  test("a record file that is not one is named, with the fix, and left alone", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    const file = slopFileOf(env, repo);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "nope");
    const run = context(repo, env);
    expect(await runWorkflow(["slop", "status"], run.context)).toBe(1);
    expect(run.errors[0]).toContain(`${file} is not a slop record`);
    expect(run.errors[0]).toContain("Delete it to start the count again.");
    expect(readFileSync(file, "utf8")).toBe("nope");
  });

  test("wrong arguments are exit 2 with the usage; outside git is exit 1", async () => {
    const env = hookEnv();
    const repo = repoWithPlan(env);
    for (const argv of [
      ["slop"],
      ["slop", "later"],
      ["slop", "record", "--plan", "alpha"],
      ["slop", "record", "--plan", "alpha", "--bypassed", "x", "--drifted", "0"],
      ["slop", "record", "--plan", "alpha", "--bypassed", "-1", "--drifted", "0"],
      ["slop", "record", "--plan", "alpha", "--bypassed", "1001", "--drifted", "0"],
      ["slop", "record", "--plan", "alpha", "--bypassed", "0", "--drifted", "99999999999999999999"],
      ["slop", "status", "--nope"],
      ["slop", "audited", "--area"],
      ["slop", "audited", "--area", "/"],
      ["slop", "audited", "--area", "../elsewhere"],
    ]) {
      const run = context(repo, env);
      expect(await runWorkflow(argv, run.context)).toBe(2);
      expect(run.errors[0]).toContain("Usage:");
    }
    const outside = context(tempDir("not-git"), env);
    expect(await runWorkflow(["slop", "status"], outside.context)).toBe(1);
    expect(outside.errors).toEqual([
      `${COMMAND} workflow slop status: this folder is not in a git project`,
    ]);
  });
});
