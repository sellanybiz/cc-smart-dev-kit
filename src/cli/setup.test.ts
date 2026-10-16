/**
 * `setup` with a terminal: the auto-mode question, `--yes`, and the order of the
 * questions. Run in this process with a fake machine whose terminal answers what the
 * test says (`src/testing/fake-machine.ts`); git is the real one, on a temp project.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restore } from "../setup/restore";
import { capturePrinted, printed, world } from "../testing/fake-machine";
import { git, tempDir } from "../testing/temp";

capturePrinted();

const RULE = "In my-app: never touch the production database.";
const QUESTION = "Write these auto-mode entries?";

/** A git project with one commit and a `.claude/cc-smart-dev-kit.json`. */
function project(config: unknown): string {
  const dir = tempDir("project");
  git(dir, "init", "-q");
  git(dir, "commit", "--allow-empty", "-q", "-m", "first");
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "cc-smart-dev-kit.json"), JSON.stringify(config));
  return dir;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("setup on a terminal: the auto-mode entries", () => {
  test("asked; yes: added after the person's own entries, owned; restore takes out only ours", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true });
    const settings = readJson(w.paths.settingsFile);
    settings.autoMode = { environment: ["$defaults", "Mine: github.com/example-org"] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup({ project: repo })).toBe(0);
    expect(w.questions).toEqual([QUESTION]);
    expect(printed).toContain(
      `~ ~/.claude/settings.json: autoMode.environment: added ${JSON.stringify(RULE)}`,
    );
    expect(readJson(w.paths.settingsFile).autoMode).toEqual({
      environment: ["$defaults", "Mine: github.com/example-org", RULE],
    });
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).autoMode).toEqual({
      environment: ["$defaults", "Mine: github.com/example-org"],
    });
  });

  test("--yes on a terminal: shown, not asked, written; a second run changes nothing", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true });
    expect(await w.setup({ project: repo, yes: true })).toBe(0);
    expect(w.questions).toEqual([]);
    expect(printed).toContain(`  + ${JSON.stringify(RULE)}`);
    expect(readJson(w.paths.settingsFile).autoMode).toEqual({
      environment: ["$defaults", RULE],
    });
    printed.length = 0;
    expect(await w.setup({ project: repo })).toBe(0);
    expect(printed[0]).toBe("Nothing to change. Setup is up to date.");
    expect(printed.join("\n")).not.toContain("Auto mode");
    expect(printed.join("\n")).not.toContain("Done.");
  });

  test("the person says no: left out, and the rest of setup is done", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true, answer: false });
    expect(await w.setup({ project: repo })).toBe(0);
    expect(printed).toContain("  auto-mode entries left out (you said no)");
    expect(readJson(w.paths.settingsFile).autoMode).toBeUndefined();
    expect(
      readJson(w.paths.settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate,
    ).toBe(true);
  });

  test("the project changes its rules: the next setup shows and makes exactly that change", async () => {
    const repo = project({ autoMode: [RULE, "In my-app: old rule."] });
    const w = world({ git: true });
    await w.setup({ project: repo, yes: true });
    writeFileSync(
      join(repo, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({ autoMode: [RULE, "In my-app: new rule."] }),
    );
    printed.length = 0;
    await w.setup({ project: repo, yes: true });
    expect(printed).toContain('  + "In my-app: new rule."');
    expect(printed).toContain('  - "In my-app: old rule."');
    expect(readJson(w.paths.settingsFile).autoMode.environment).toEqual([
      "$defaults",
      RULE,
      "In my-app: new rule.",
    ]);
  });
});

describe("setup and tmux: the one managed line", () => {
  test("tmux installed: the line goes into ~/.tmux.conf, the person's own lines kept, and a running server gets the command printed", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ bins: { tmux: "exit 0" }, git: true });
    writeFileSync(w.paths.tmuxConfFile, "set -g mouse on\n");
    expect(await w.setup({ project: repo, yes: true })).toBe(0);
    expect(printed).toContain("~ ~/.tmux.conf: added set -g allow-passthrough all");
    expect(printed).toContain(
      "  tmux is running: run `tmux set -g allow-passthrough all` to apply the line now (a restart works too)",
    );
    expect(readFileSync(w.paths.tmuxConfFile, "utf8")).toBe(
      "set -g mouse on\nset -g allow-passthrough all\n",
    );
    // A second run changes nothing, and says so.
    printed.length = 0;
    expect(await w.setup({ project: repo, yes: true })).toBe(0);
    expect(printed[0]).toBe("Nothing to change. Setup is up to date.");
    expect(printed.join("\n")).not.toContain("tmux.conf");
    // restore takes exactly that line out and keeps the person's own.
    restore(w.paths.stateDir);
    expect(readFileSync(w.paths.tmuxConfFile, "utf8")).toBe("set -g mouse on\n");
  });

  test("no tmux: nothing is written, and nothing is said about it", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true });
    expect(await w.setup({ project: repo, yes: true })).toBe(0);
    expect(printed.join("\n")).not.toContain("tmux");
    expect(existsSync(w.paths.tmuxConfFile)).toBe(false);
  });

  test("a line the person already wrote themselves is left alone: setup claims nothing, and restore keeps it", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ bins: { tmux: "exit 1" }, git: true }); // no server running
    writeFileSync(w.paths.tmuxConfFile, "set -g allow-passthrough all\n");
    expect(await w.setup({ project: repo, yes: true })).toBe(0);
    expect(printed.join("\n")).not.toContain("tmux is running");
    restore(w.paths.stateDir);
    expect(readFileSync(w.paths.tmuxConfFile, "utf8")).toBe("set -g allow-passthrough all\n");
  });

  test("a dry run reports the line and the running server, and writes nothing", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ bins: { tmux: "exit 0" }, git: true });
    expect(await w.setup({ project: repo, dryRun: true })).toBe(0);
    expect(printed).toContain("+ ~/.tmux.conf: added set -g allow-passthrough all");
    expect(printed).toContain(
      "  tmux is running: run `tmux set -g allow-passthrough all` to apply the line now (a restart works too)",
    );
    expect(existsSync(w.paths.tmuxConfFile)).toBe(false);
  });
});

describe("setup in a worktree: where the entries come from", () => {
  test("the worktree's own file: the question names it, and says plainly that it differs from the main checkout's", async () => {
    const repo = project({ autoMode: [RULE] });
    const worktree = join(tempDir("wt"), "feature");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    mkdirSync(join(worktree, ".claude"), { recursive: true });
    writeFileSync(
      join(worktree, ".claude", "cc-smart-dev-kit.json"),
      JSON.stringify({ autoMode: ["In my-app: a rule only this branch has."] }),
    );
    const w = world({ git: true });
    await w.setup({ project: worktree });
    expect(printed.slice(0, 4)).toEqual([
      `Auto mode: trust rules from ${worktree}/.claude/cc-smart-dev-kit.json ("autoMode"), for autoMode.environment in ~/.claude/settings.json:`,
      `  This worktree's file is not the same as the main checkout's (${repo}/.claude/cc-smart-dev-kit.json). The rules below come from this worktree's file.`,
      '  + "$defaults"',
      '  + "In my-app: a rule only this branch has."',
    ]);
  });

  test("a worktree with no file of its own: the main checkout's file is named, and nothing more is said", async () => {
    const repo = project({ autoMode: [RULE] });
    const worktree = join(tempDir("wt"), "plain");
    git(repo, "worktree", "add", "-q", "-b", "plain", worktree);
    const w = world({ git: true });
    await w.setup({ project: worktree });
    expect(printed[0]).toBe(
      `Auto mode: trust rules from ${repo}/.claude/cc-smart-dev-kit.json ("autoMode"), for autoMode.environment in ~/.claude/settings.json:`,
    );
    expect(printed[1]).toBe('  + "$defaults"');
  });
});

describe("every question comes first", () => {
  test("both questions are asked before anything runs; a no to Warp keeps the yes to the auto-mode entries", async () => {
    const repo = project({ autoMode: [RULE] });
    const order: string[] = [];
    const w = world({
      git: true,
      answer: (question) => {
        order.push(`asked: ${question}`);
        return question === QUESTION;
      },
      bins: { gpg: 'echo "gpg ran" >&2; exit 1' },
    });
    expect(await w.setup({ project: repo, warp: true })).toBe(1);
    // Nothing of Warp's ran (gpg is the first thing it would run, staging the key).
    expect(w.calls()).toBe("");
    expect(order).toEqual([`asked: ${QUESTION}`, "asked: Run these commands now?"]);
    expect(readJson(w.paths.settingsFile).autoMode).toEqual({ environment: ["$defaults", RULE] });
    expect(printed).toContain("! Warp: these commands were not run (you said no).");
  });
  test("the status-line question joins the same pass: auto mode, status line, Warp, all before anything runs", async () => {
    const repo = project({ autoMode: [RULE] });
    const order: string[] = [];
    const w = world({
      git: true,
      statuslineAnswered: false,
      answer: (question) => {
        order.push(`asked: ${question}`);
        return question !== "Run these commands now?";
      },
      bins: { gpg: 'echo "gpg ran" >&2; exit 1' },
    });
    expect(await w.setup({ project: repo, warp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(order).toEqual([
      `asked: ${QUESTION}`,
      "asked: Show cc-smart-dev-kit's status line in Claude Code (plan usage, a warning from 85 %, and any gateway fallback)?",
      "asked: Run these commands now?",
    ]);
    // The yes to the status line stands; the no to Warp takes only Warp out.
    const settings = readJson(w.paths.settingsFile);
    expect(settings.statusLine.command).toEndWith("/.local/bin/cc-smart-dev-kit statusline");
    expect(settings.autoMode).toEqual({ environment: ["$defaults", RULE] });
  });
});
