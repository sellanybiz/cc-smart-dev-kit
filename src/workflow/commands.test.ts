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
import { COMMAND } from "../build-info/names";
import { cliPaths, tildify } from "../cli/paths";
import { hookEnv, makeClone, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { runWorkflow, type WorkflowContext } from "./commands";
import { personalWorkflowFile } from "./resolve";
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
 * The `!` line `openPr draft` gets while `autoPush` is off (D16): the clash every `set` of
 * `openPr` prints after the write, in these tests' default settings.
 */
const OPEN_PR_DRAFT_CLASH = `! openPr opens a pull request, but autoPush is off: the git guard asks before the push that pull request needs, so it waits for you every time. Fix: turn autoPush on (\`${COMMAND} workflow set autoPush true\`), or set openPr off (\`${COMMAND} workflow set openPr off\`).`;

describe("workflow show", () => {
  test("nothing set: every value with the built-in default as where it came from", async () => {
    const run = context(tempDir("not-git"));
    expect(await runWorkflow(["show"], run.context)).toBe(0);
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
      "reviewAgents = cc-smart-dev-kit:reviewer (default)",
      "fixesAfterReview.lines = 200 (default)",
      "fixesAfterReview.files = 10 (default)",
      "fixesAfterReview.percent = 20 (default)",
      "clearWorktreeAfterMerge = false (default)",
      "alerts.events = needs-you, question, finished, failed (default)",
      "alerts.sound = false (default)",
      "alerts.usagePercent = 85 (default)",
      "crew.enabled = false (default)",
      "crew.idleStopMinutes = 10 (default)",
      "crew.max = 6 (default)",
      "crew.maxOpus = 2 (default)",
      "crew.memoryGb = 2 (default)",
      "crew.quietMinutes = 20 (default)",
      "crew.handoffPercent = 70 (default)",
      "crew.softHours = 2 (default)",
      "crew.maxHours = 4 (default)",
      "crew.tag = (the main checkout's folder name) (default)",
      "switches.statusLine = false (default)",
      "switches.sessionNames = false (default)",
      "switches.jobRoute = false (default)",
      "switches.updateHold = false (default)",
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
      workflow: { autoMerge: true, openPr: "draft" },
    });
    mkdirSync(dirname(personalWorkflowFile(cliPaths(env))), { recursive: true });
    writeFileSync(
      personalWorkflowFile(cliPaths(env)),
      `${JSON.stringify({ openPr: "ready", alerts: { sound: true } }, null, 2)}\n`,
    );
    const run = context(repo, env);
    expect(await runWorkflow([], run.context)).toBe(0);
    expect(run.lines).toContain("openPr = draft (project)");
    expect(run.lines).toContain("alerts.sound = true (personal)");
    expect(run.lines).toContain("autoMerge = true (project)");
    expect(run.lines).toContain("switches.sessionNames = true (project)");
    expect(run.lines).toContain("switches.jobRoute = true (project)");
    expect(run.lines).not.toContain(
      "no project settings here: this folder is not in a git project",
    );
  });

  test("D16: settings that cannot work together are shown, each once, with its fix", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { autoMerge: true, openPr: "draft" },
    });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    const clashes = run.lines.filter((line) => line.startsWith("! "));
    expect(clashes).toEqual([
      OPEN_PR_DRAFT_CLASH,
      `! openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens. Fix: set openPr ready (\`${COMMAND} workflow set openPr ready\`) so the pull request can merge, or turn autoMerge off (\`${COMMAND} workflow set autoMerge false\`).`,
    ]);
  });

  test("a broken personal file: one line on stderr, exit 1", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, `${JSON.stringify({ autoCommit: "yes" }, null, 2)}\n`);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["show"], run.context)).toBe(1);
    expect(run.lines).toEqual([]);
    expect(run.errors).toEqual([
      `Invalid ${paths.workflowConfigFile}: autoCommit: Invalid input: expected boolean, received string`,
    ]);
  });
});

describe("workflow set and unset", () => {
  test("a policy value goes into the person's own file, 0600", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "autoCommit", "true"], run.context)).toBe(0);
    const file = cliPaths(env).workflowConfigFile;
    expect(run.lines).toEqual([`+ ~/.config/cc-smart-dev-kit/workflow.json: autoCommit = true`]);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify({ autoCommit: true }, null, 2)}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("D16: a write that leaves a clash names it after the write, with the fix", async () => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ autoPush: true }, null, 2)}\n`);
    // A setting that works with the others names no clash.
    const fine = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "openPr", "ready"], fine.context)).toBe(0);
    expect(fine.lines).toEqual(["~ ~/.config/cc-smart-dev-kit/workflow.json: openPr = ready"]);
    // Taking autoPush away leaves openPr waiting for a person: the clash comes with the write.
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "autoPush", "false"], off.context)).toBe(0);
    expect(off.lines).toEqual([
      "~ ~/.config/cc-smart-dev-kit/workflow.json: autoPush = false",
      OPEN_PR_DRAFT_CLASH,
    ]);
  });

  test("a second value keeps the first, and the file's own indentation", async () => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `{\n    "autoCommit": true\n}\n`);
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "alerts.sound", "true"], run.context)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      `{\n    "autoCommit": true,\n    "alerts": {\n        "sound": true\n    }\n}\n`,
    );
    expect(run.lines).toEqual(["~ ~/.config/cc-smart-dev-kit/workflow.json: alerts.sound = true"]);
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
    await runWorkflow(["set", "alerts.events", "finished"], run.context);
    const off = context(tempDir("not-git"), env);
    expect(await runWorkflow(["unset", "alerts.events"], off.context)).toBe(0);
    expect(off.lines).toEqual(["- ~/.config/cc-smart-dev-kit/workflow.json: alerts.events unset"]);
    const shown = context(tempDir("not-git"), env);
    await runWorkflow(["show"], shown.context);
    expect(shown.lines).toContain(
      "alerts.events = needs-you, question, finished, failed (default)",
    );
  });

  test("a list of events is read from one quoted word", async () => {
    const env = hookEnv();
    const run = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "alerts.events", "needs-you,finished"], run.context)).toBe(0);
    expect(readFileSync(cliPaths(env).workflowConfigFile, "utf8")).toBe(
      `${JSON.stringify({ alerts: { events: ["needs-you", "finished"] } }, null, 2)}\n`,
    );
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
    expect(await runWorkflow(["set", "autoCommit", "true", "--project"], run.context)).toBe(0);
    expect(run.lines).toEqual([`~ ${file}: autoCommit = true`]);
    // The indent (four spaces here) stays; a one-line object is written out, as any JSON writer does.
    expect(readFileSync(file, "utf8")).toBe(
      [
        "{",
        '    "worktrees": {',
        '        "base": "main",',
        '        "guardMainFolder": true',
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

  test("D20: --project on a file that still holds a retired engine field: refused, naming it, nothing written", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", setup: ["bun", "install"] },
    });
    const before = readFileSync(file, "utf8");
    const run = context(repo, env);
    expect(await runWorkflow(["set", "autoCommit", "true", "--project"], run.context)).toBe(1);
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
    expect(run.lines).toEqual([`~ ${file}: switches.jobRoute = true`]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...SETTINGS, jobs: { route: true } });
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
  });

  test("--project with no .claude/cc-smart-dev-kit.json says to run project init", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    const run = context(repo, env);
    expect(await runWorkflow(["set", "autoCommit", "true", "--project"], run.context)).toBe(1);
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
    expect(await runWorkflow(["set", "alerts.events", "finished", "failed"], run.context)).toBe(2);
    expect(run.errors[0]).toContain("set needs one value");
    const none = context(tempDir("not-git"), env);
    expect(await runWorkflow(["set", "autoCommit"], none.context)).toBe(2);
    expect(none.errors[0]).toContain("set needs one value");
  });

  test("an unknown workflow command: exit 2", async () => {
    const run = context(tempDir("not-git"));
    expect(await runWorkflow(["write", "autoCommit", "true"], run.context)).toBe(2);
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
    ["set", "autoMerge", ["true"]],
    ["set", "reviewBeforePush", ["false"]],
    ["set", "reviewAgents", ["general-purpose"]],
    ["unset", "reviewBeforePush", []],
    ["set", "fixesAfterReview.lines", ["0"]],
    ["set", "fixesAfterReview.files", ["50"]],
    ["unset", "fixesAfterReview.percent", []],
  ] as const)(
    "CM-1: workflow %s %s refuses inside Claude Code, in both files",
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
          `cc-smart-dev-kit workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} is part of the merge guard's review gate, which only you change. Run it in your own terminal; for the project's policy, change .claude/cc-smart-dev-kit.json there, commit it to the base and push it — the merge guard reads only the committed file.`,
        ]);
      }
      expect(existsSync(cliPaths(env).workflowConfigFile)).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(before);
    },
  );

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

  test("D34: the crew sessions' switch is not part of the gate: set in both files, shown with its source", async () => {
    const env = { ...hookEnv(), CLAUDECODE: "1" };
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", SETTINGS);
    const mine = context(repo, env);
    expect(await runWorkflow(["set", "crew.max", "2"], mine.context)).toBe(0);
    expect(mine.lines).toEqual(["+ ~/.config/cc-smart-dev-kit/workflow.json: crew.max = 2"]);
    const theirs = context(repo, env);
    expect(await runWorkflow(["set", "crew.enabled", "true", "--project"], theirs.context)).toBe(0);
    expect(theirs.lines).toEqual([`~ ${file}: crew.enabled = true`]);
    expect(JSON.parse(readFileSync(file, "utf8")).workflow).toEqual({ crew: { enabled: true } });
    const show = context(repo, env);
    await runWorkflow(["show"], show.context);
    expect(show.lines).toContain("crew.enabled = true (project)");
    expect(show.lines).toContain("crew.max = 2 (personal)");
    // Not a gate key: no gate line names it.
    expect(show.lines.filter((line) => line.startsWith("gate crew sessions."))).toEqual([]);
  });

  test("CM-1: show prints the gate as the merge guard reads it, from the committed file", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    committed(repo, {
      ...SETTINGS,
      workflow: { autoMerge: true, fixesAfterReview: { lines: 50 } },
    });
    // This checkout's own copy says otherwise: the guard does not read it.
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ...SETTINGS,
      workflow: { autoMerge: false, fixesAfterReview: { lines: 0 }, reviewBeforePush: false },
    });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines).toContain("autoMerge = false (project)");
    expect(run.lines).toContain("fixesAfterReview.lines = 0 (project)");
    const gate = run.lines.filter((line) => line.startsWith("gate"));
    expect(gate).toEqual([
      "gate: what the merge guard judges with, from origin/main:.claude/cc-smart-dev-kit.json as committed (this checkout's own copy does not count)",
      "gate autoMerge = true (project, committed on origin/main)",
      "gate reviewBeforePush = true (default)",
      "gate reviewAgents = cc-smart-dev-kit:reviewer (default)",
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
      "gate: the merge guard cannot read the policy committed on main (origin/main is not known in this repository (no origin, or the branch was never fetched)), so it asks before every merge",
    ]);
  });

  test("show without a worktrees.base: the gate is each pull request's base", async () => {
    const env = hookEnv();
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { requires: ">=0.1" });
    const run = context(repo, env);
    expect(await runWorkflow(["show"], run.context)).toBe(0);
    expect(run.lines.filter((line) => line.startsWith("gate"))).toEqual([
      "gate: this project names no worktrees.base, so the merge guard reads the policy committed on each pull request's base",
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
          by: ["cc-smart-dev-kit:reviewer"],
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
