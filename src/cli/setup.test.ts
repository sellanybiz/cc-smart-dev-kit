/**
 * `setup` with a terminal: the auto-mode question, `--yes`, and the order of the
 * questions. Run in this process with a fake machine whose terminal answers what the
 * test says (`src/testing/fake-machine.ts`); git is the real one, on a temp project.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMcpRecords, recordMcpServer } from "../mcp/records";
import { serenaLeftoverPaths } from "../mcp/retired";
import { restore } from "../setup/restore";
import { readChanged, writeManagedFile } from "../setup/write";
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

  test("--dry-run on a terminal: the entries as changes, the no-terminal note left out, nothing asked or written", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true });
    const before = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup({ project: repo, dryRun: true })).toBe(0);
    expect(printed).toContain(
      `~ ~/.claude/settings.json: autoMode.environment: added ${JSON.stringify(RULE)}`,
    );
    // A terminal is there: the note a run without one prints stays out.
    expect(printed.join("\n")).not.toContain("left out");
    expect(w.questions).toEqual([]);
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
    expect(printed).toContain("Dry run: nothing was written or run.");
  });

  test("the person says no: left out, and the rest of setup is done", async () => {
    const repo = project({ autoMode: [RULE] });
    const w = world({ git: true, answer: false });
    expect(await w.setup({ project: repo })).toBe(0);
    expect(printed).toContain("  auto-mode entries left out (you said no)");
    expect(readJson(w.paths.settingsFile).autoMode).toBeUndefined();
    expect(
      readJson(w.paths.settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate,
    ).toBe(false);
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

describe("setup manages agent view's notification hook", () => {
  const MATCHER = "agent_needs_input|agent_completed";
  const COMMAND = '"$HOME/.local/bin/cc-smart-dev-kit" hook notify';
  // What a manual test left behind: the plugin's shim and bundle, from its version folder.
  const HAND_NOTIFY =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
    '"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh" --missing=quiet "${CLAUDE_PLUGIN_ROOT}/dist/notify.js"';
  const MANAGED = {
    matcher: MATCHER,
    hooks: [{ type: "command", command: COMMAND, timeout: 10 }],
  };

  test("written once, in the person's own settings; a second setup changes nothing; restore removes it", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(printed).toContain(
      `~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook (${COMMAND})`,
    );
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([MANAGED]);

    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(printed[0]).toBe("Nothing to change. Setup is up to date.");
    expect(printed.join("\n")).not.toContain("agent view");
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([MANAGED]);

    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).hooks).toBeUndefined();
  });

  test("a hand-written entry that runs the plugin's dist/notify.js is replaced in place, not doubled", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const hand = {
      matcher: MATCHER,
      hooks: [{ type: "command", command: HAND_NOTIFY, timeout: 10 }],
    };
    settings.hooks = { Notification: [hand] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(printed).toContain(
      `~ ~/.claude/settings.json: hooks.Notification: replaced the hand-written notify hook with the managed one (${COMMAND})`,
    );
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([MANAGED]);
    // Restore removes the managed entry and does not bring the replaced hand entry back:
    // its version folder may be gone, and the person can restore the file's backup by hand.
    // The list itself stays: it was in the person's file before setup touched it.
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).hooks).toEqual({ Notification: [] });
  });

  test("a version folder's notify.js named by its cache path: replaced too", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const hand = {
      matcher: MATCHER,
      hooks: [
        {
          type: "command",
          command:
            '"$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/0.5.2/dist/notify.js"',
          timeout: 10,
        },
      ],
    };
    settings.hooks = { Notification: [hand] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([MANAGED]);
  });

  test("a hand entry that also runs a logger is never replaced: kept whole, ours added beside it", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const mixed = {
      matcher: MATCHER,
      hooks: [
        { type: "command", command: HAND_NOTIFY, timeout: 10 },
        { type: "command", command: "./my-logger.sh" },
      ],
    };
    settings.hooks = { Notification: [mixed] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([mixed, MANAGED]);
  });

  test("another program's notify bundle, and the person's own hook: kept whole, ours added beside them", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const personal = {
      matcher: MATCHER,
      hooks: [{ type: "command", command: "node /home/user/my-notifier/dist/notify.js" }],
    };
    const foreign = {
      matcher: MATCHER,
      hooks: [{ type: "command", command: "./my-notify.sh" }],
    };
    settings.hooks = { Notification: [personal, foreign] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([personal, foreign, MANAGED]);
  });

  test("our command plus a logger: the person's edited copy, left whole and never doubled", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const mixed = {
      matcher: MATCHER,
      hooks: [
        { type: "command", command: `${COMMAND} 2>>log` },
        { type: "command", command: "./my-logger.sh" },
      ],
    };
    settings.hooks = { Notification: [mixed] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(
      printed.filter((line) =>
        line.includes("hooks.Notification: a hook with this matcher was edited"),
      ),
    ).toHaveLength(1);
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([mixed]);
  });

  test("a person-edited managed entry: setup leaves it, adds none, and says so once", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const edited = {
      matcher: MATCHER,
      hooks: [{ type: "command", command: `${COMMAND} 2>>log`, timeout: 30 }],
    };
    settings.hooks = { Notification: [edited] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(printed).toContain(
      `  ~/.claude/settings.json: hooks.Notification: a hook with this matcher was edited since setup wrote it (${COMMAND}); it stays, and no second one was added`,
    );
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([edited]);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).hooks.Notification).toEqual([edited]);
  });

  test("the person's own hooks stay: another event, and a Notification hook of their own", async () => {
    const w = world();
    const settings = readJson(w.paths.settingsFile);
    const own = {
      matcher: "permission_prompt",
      hooks: [{ type: "command", command: "./mine.sh" }],
    };
    const stop = { hooks: [{ type: "command", command: "./stop.sh", timeout: 5 }] };
    settings.hooks = { Notification: [own], Stop: [stop] };
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).hooks).toEqual({
      Notification: [own, MANAGED],
      Stop: [stop],
    });
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).hooks).toEqual({ Notification: [own], Stop: [stop] });
  });

  test("--dry-run shows the entry and writes nothing", async () => {
    const w = world();
    const before = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(printed).toContain(
      `~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook (${COMMAND})`,
    );
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
    expect(printed).toContain("Dry run: nothing was written or run.");
  });
});

describe("setup takes back what an older setup left for Serena", () => {
  /**
   * What an older setup left: `serena` in Claude Code's own config, naming its context file —
   * recorded as setup's own when `ours` — the context as a tracked whole file, and the
   * serena-root records.
   */
  function olderSerena(w: ReturnType<typeof world>, ours: boolean) {
    const where = serenaLeftoverPaths(w.paths);
    const json = JSON.stringify({
      args: ["serena", "start-mcp-server", "--context", where.contextFile],
      command: "uvx",
    });
    writeFileSync(
      w.paths.userConfigFile,
      JSON.stringify({ mcpServers: { serena: JSON.parse(json) } }),
    );
    if (ours) recordMcpServer(w.paths.stateDir, "serena", json, "2026-10-01T00:00:00.000Z");
    writeManagedFile(where.contextFile, "single_project: false\n", {
      kind: "whole-file",
      newFileMode: 0o644,
      stateDir: w.paths.stateDir,
    });
    mkdirSync(where.recordDir, { recursive: true });
    writeFileSync(join(where.recordDir, "11111111-2222-3333-4444-555555555555.txt"), "unknown");
    return where;
  }

  const CONTEXT_REMOVED =
    "- ~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml: removed (Serena's context; Serena is retired in 0.6.0)";
  const FOLDER_REMOVED =
    "- ~/.local/share/cc-smart-dev-kit/serena/: removed (Serena's folder, empty now)";
  const RECORDS_REMOVED =
    "- ~/.claude/cc-smart-dev-kit/serena-root/: removed (the serena-root hook's records; Serena is retired in 0.6.0)";
  const KEPT =
    "  ~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml: left in place: serena still starts Serena with it";

  test("its own registration through `claude mcp remove`, then the context file and the records", async () => {
    const w = world();
    const where = olderSerena(w, true);
    expect(await w.setup()).toBe(0);
    expect(w.mcpCalls()).toContain("claude mcp remove serena --scope user");
    expect(printed).toContain("- MCP server serena removed from your user config");
    expect(printed).toContain(CONTEXT_REMOVED);
    expect(printed).toContain(FOLDER_REMOVED);
    expect(printed).toContain(RECORDS_REMOVED);
    expect(readMcpRecords(w.paths.stateDir).serena).toBeUndefined();
    expect(existsSync(where.folder)).toBe(false);
    expect(existsSync(where.recordDir)).toBe(false);
    expect(readChanged(w.paths.stateDir)[where.contextFile]).toBeUndefined();
  });

  test("a serena of the person's own: no command runs, and the file it starts with stays", async () => {
    const w = world();
    const where = olderSerena(w, false);
    expect(await w.setup()).toBe(0);
    expect(w.mcpCalls().filter((call) => call.includes("serena"))).toEqual([]);
    expect(printed).toContain(KEPT);
    expect(printed).not.toContain(CONTEXT_REMOVED);
    expect(existsSync(where.contextFile)).toBe(true);
    // The plugin's own records go all the same: nothing of the person's reads them.
    expect(printed).toContain(RECORDS_REMOVED);
    expect(existsSync(where.recordDir)).toBe(false);
  });

  test("a `claude mcp remove` that fails: the registration, its record and the file it names all stay; exit 1", async () => {
    const w = world({
      bins: {
        claude: [
          'case "$*" in "mcp remove serena --scope user") echo "remove failed" >&2; exit 1 ;; esac',
          "exit 0",
        ].join("\n"),
      },
    });
    const where = olderSerena(w, true);
    expect(await w.setup()).toBe(1);
    expect(printed).toContain("! $ claude mcp remove serena --scope user failed (remove failed)");
    expect(printed).toContain(KEPT);
    expect(existsSync(where.contextFile)).toBe(true);
    expect(readMcpRecords(w.paths.stateDir).serena).toBeDefined();
  });

  test("--dry-run: each step is shown, and nothing is run or removed", async () => {
    const w = world();
    const where = olderSerena(w, true);
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(printed).toContain("$ claude mcp remove serena --scope user");
    expect(printed).toContain(CONTEXT_REMOVED);
    expect(printed).toContain(FOLDER_REMOVED);
    expect(printed).toContain(RECORDS_REMOVED);
    expect(printed).toContain("Dry run: nothing was written or run.");
    expect(w.mcpCalls()).toEqual([]);
    expect(existsSync(where.contextFile)).toBe(true);
    expect(existsSync(where.recordDir)).toBe(true);
    expect(readMcpRecords(w.paths.stateDir).serena).toBeDefined();
  });
});
