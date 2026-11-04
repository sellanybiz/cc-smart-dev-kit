/** `doctor`'s line for the user-level `Notification` hook setup writes for agent view. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_ID, VERSION } from "../build-info";
import { applyClaudeMem, claudeMemPlan, TODO_TOOLS_KEY } from "../machine/claude-mem";
import { applyManagedJson } from "../setup/managed-json";
import { applyTaskPermissions } from "../setup/task-tools";
import { hookEnv } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import {
  checkLine,
  checkPlugin,
  checkPortal,
  checkUserNotifyHook,
  claudeMemChecks,
  countChecks,
  doctorReport,
  doctorVerdict,
  groupSummary,
  oldTodoToolsKeyCheck,
  taskToolsCheck,
} from "./doctor";
import { type CliPaths, cliPaths } from "./paths";

const COMMAND = '"$HOME/.local/bin/cc-smart-dev-kit" hook notify';
const SETTINGS = "~/.claude/settings.json";

/** The line doctor prints for a settings file holding `hooks`, written by hand. */
function line(hooks: unknown): string {
  const env = hookEnv();
  const paths = cliPaths(env);
  if (hooks !== undefined) {
    writeFileSync(paths.settingsFile, `${JSON.stringify({ hooks }, null, 2)}\n`);
  }
  return checkLine(checkUserNotifyHook(paths));
}

describe("doctor: agent view's notification hook", () => {
  test("missing: ✗, and the command to run", () => {
    expect(line(undefined)).toBe(
      `✗ agent view's notification hook is missing from ${SETTINGS}, so agent view's alerts never arrive Fix: cc-smart-dev-kit setup`,
    );
  });

  test("a hook with the matcher that runs something else: ✗, and the command to run", () => {
    expect(
      line({ Notification: [{ matcher: "agent_needs_input|agent_completed", hooks: [] }] }),
    ).toBe(
      `✗ agent view's notification hook in ${SETTINGS} does not run ${COMMAND}, so agent view's alerts never reach the notifier Fix: cc-smart-dev-kit setup`,
    );
  });

  test("a person-edited managed entry: · information, never a failure", () => {
    expect(
      line({
        Notification: [
          {
            matcher: "agent_needs_input|agent_completed",
            hooks: [{ type: "command", command: `${COMMAND} 2>>log`, timeout: 30 }],
          },
        ],
      }),
    ).toBe(
      `· agent view's notification hook in ${SETTINGS} was edited since setup wrote it; it still runs ${COMMAND}, and cc-smart-dev-kit leaves it alone`,
    );
  });

  test("the managed entry: ✓, with the command", () => {
    expect(
      line({
        Notification: [
          {
            matcher: "agent_needs_input|agent_completed",
            hooks: [{ type: "command", command: COMMAND, timeout: 10 }],
          },
        ],
      }),
    ).toBe(`✓ agent view's notification hook is set in ${SETTINGS}: ${COMMAND}`);
  });
});

describe("doctor: the portal (D10)", () => {
  test("running this version: ✓, with its address, its version and its pid", () => {
    expect(checkLine(checkPortal({ kind: "ours", pid: 3, version: VERSION }))).toBe(
      `✓ the portal is running at http://127.0.0.1:20150/ (version ${VERSION}, process 3)`,
    );
  });

  test("an older version: !, and what brings it forward", () => {
    expect(checkLine(checkPortal({ kind: "ours", pid: 3, version: "0.6.0" }))).toBe(
      `! the portal is running at http://127.0.0.1:20150/ (version 0.6.0, process 3); the next Claude Code session restarts it onto ${VERSION}`,
    );
  });

  test("a newer version than this install: ✓, and it is left as it is", () => {
    expect(checkLine(checkPortal({ kind: "ours", pid: 3, version: "9.9.9" }))).toBe(
      `✓ the portal is running at http://127.0.0.1:20150/ (version 9.9.9, process 3), newer than this install (${VERSION}); it is left as it is`,
    );
  });

  test("not running: · information, never a failure", () => {
    expect(checkLine(checkPortal({ kind: "free" }))).toBe(
      "· the portal is not running; it starts with the next Claude Code session, or now: cc-smart-dev-kit portal",
    );
  });

  test("another program holds the port: ✗, because the portal cannot start there", () => {
    expect(checkLine(checkPortal({ kind: "other" }))).toBe(
      "✗ another program holds 127.0.0.1:20150, so the portal cannot start Fix: stop that program, then run: cc-smart-dev-kit portal",
    );
  });
});

describe("doctor: claude-mem's start blocks (D68)", () => {
  const WORK_STATE = "CLAUDE_MEM_WORK_STATE_ENABLED";
  const MEMORY = "CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED";
  const SHORT = "~/.claude-mem/settings.json";
  const SEEDED = {
    CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
    CLAUDE_MEM_PROVIDER: "claude",
    [WORK_STATE]: "",
    [MEMORY]: "true",
  };

  /** A temp home with claude-mem installed, and its settings file when `settings` is given. */
  function world(settings?: unknown, installed = true) {
    const home = tempDir("doctor-claude-mem");
    const configDir = join(home, ".claude");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
    if (installed) {
      const installPath = join(home, "plugins", "claude-mem");
      mkdirSync(installPath, { recursive: true });
      writeFileSync(
        paths.installedPluginsFile,
        JSON.stringify({
          version: 2,
          plugins: {
            "claude-mem@thedotmack": [{ scope: "user", installPath, version: "13.40.0" }],
          },
        }),
      );
    }
    if (settings !== undefined) {
      mkdirSync(join(home, ".claude-mem"), { recursive: true });
      writeFileSync(paths.claudeMemSettingsFile, JSON.stringify(settings, null, 2), {
        mode: 0o600,
      });
    }
    return { home, paths };
  }

  /** What setup writes: the memory-use block off, and the task-tools key owned. */
  function afterSetup(paths: ReturnType<typeof world>["paths"]) {
    const planned = claudeMemPlan(paths);
    if (!("plan" in planned)) throw new Error("expected a plan");
    applyClaudeMem(paths, planned.plan, false);
    applyTaskPermissions(paths, true, false);
    applyManagedJson({
      file: paths.settingsFile,
      stateDir: paths.stateDir,
      set: [[["env", TODO_TOOLS_KEY], "1"]],
    });
  }

  const lines = (paths: ReturnType<typeof world>["paths"]) =>
    claudeMemChecks(paths)
      .filter((check) => !check.text.startsWith("claude-mem's My Work auto-refresh"))
      .map(checkLine);

  test("D68: task tools are checked without claude-mem", () => {
    const w = world(undefined, false);
    expect(checkLine(taskToolsCheck(w.paths))).toBe(
      "✗ task tools: missing allow rule mcp__cc-smart-dev-kit-tasks__*; missing deny rules TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite Fix: cc-smart-dev-kit setup",
    );
  });

  test("D68: old setup's false and default memory-use report both reasons in order", () => {
    const w = world(SEEDED);
    applyManagedJson({
      file: w.paths.claudeMemSettingsFile,
      stateDir: w.paths.stateDir,
      set: [[[WORK_STATE], "false"]],
      unchosen: () => true,
    });
    expect(lines(w.paths)).toEqual([
      `✗ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is on (claude-mem's default). The memory-use block must be off so the kit owns instruction routing; it still points at work_state_write Fix: cc-smart-dev-kit setup`,
    ]);
  });

  test("D68: not installed: no line", () => {
    expect(lines(world(SEEDED, false).paths)).toEqual([]);
  });

  test("D68: claude-mem's defaults: ✗ with setup as the command to run", () => {
    expect(lines(world(SEEDED).paths)).toEqual([
      `✗ claude-mem's start blocks in ${SHORT}: work state is on (claude-mem's default), memory-use block is on (claude-mem's default). The memory-use block must be off so the kit owns instruction routing; it still points at work_state_write. Work state must be off so the kit owns the task list Fix: cc-smart-dev-kit setup`,
    ]);
  });

  test("D68: setup set memory-use and the task tools: ✓ each, naming setup", () => {
    const w = world(SEEDED);
    afterSetup(w.paths);
    expect(lines(w.paths)).toEqual([
      `✓ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
  });

  test("F4: a settings file saved with a byte-order mark reads like any other: setup's key is seen", () => {
    // An editor on Windows saves UTF-8 with a byte order mark, which `JSON.parse` refuses.
    // Setup reads the file through `readUserJson` and sees the key, so doctor must too — or
    // it says the key is missing while setup says it is there.
    const w = world(SEEDED);
    afterSetup(w.paths);
    writeFileSync(w.paths.settingsFile, `\uFEFF${readFileSync(w.paths.settingsFile, "utf8")}`);
    expect(lines(w.paths)).toEqual([
      `✓ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
  });

  test("D68: a person's own value is information, never a failure", () => {
    const w = world(SEEDED);
    afterSetup(w.paths);
    const file = w.paths.claudeMemSettingsFile;
    const settings = JSON.parse(readFileSync(file, "utf8"));
    settings[WORK_STATE] = "true";
    writeFileSync(file, JSON.stringify(settings, null, 2));
    expect(lines(w.paths)).toEqual([
      `· claude-mem's start blocks in ${SHORT}: work state is on (your choice), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
  });

  test("D75: both start blocks off from setup pass, with no task-tools key at all", () => {
    const w = world(SEEDED);
    const planned = claudeMemPlan(w.paths);
    if (!("plan" in planned)) throw new Error("expected a plan");
    // Only claude-mem's keys written: the start-block line does not read the task tools.
    applyClaudeMem(w.paths, planned.plan, false);
    expect(lines(w.paths)).toEqual([
      `✓ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
  });

  test("D75: a task-tools value the person set leaves the start-block line as it was", () => {
    const w = world(SEEDED);
    afterSetup(w.paths);
    const settings = JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));
    settings.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "0";
    writeFileSync(w.paths.settingsFile, JSON.stringify(settings, null, 2));
    expect(lines(w.paths)).toEqual([
      `✓ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
  });

  test("D75: allow and deny entries in place (also behind a BOM); without them ✗ with setup", () => {
    const w = world(SEEDED);
    afterSetup(w.paths);
    const on = "✓ task tools: the kit's tools are allowed and the built-in task lists are hidden";
    expect(checkLine(taskToolsCheck(w.paths))).toBe(on);
    writeFileSync(w.paths.settingsFile, `﻿${readFileSync(w.paths.settingsFile, "utf8")}`);
    expect(checkLine(taskToolsCheck(w.paths))).toBe(on);
    writeFileSync(
      w.paths.settingsFile,
      JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "0" } }),
    );
    expect(checkLine(taskToolsCheck(w.paths))).toBe(
      "✗ task tools: missing allow rule mcp__cc-smart-dev-kit-tasks__*; missing deny rules TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite Fix: cc-smart-dev-kit setup",
    );
    const oldKey = oldTodoToolsKeyCheck(w.paths);
    expect(oldKey === null ? null : checkLine(oldKey)).toBe(
      "· ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS is yours and no longer used; it can go, the kit's own task list replaced Claude Code's",
    );
    writeFileSync(w.paths.settingsFile, "{}");
    expect(oldTodoToolsKeyCheck(w.paths)).toBeNull();
    writeFileSync(
      w.paths.settingsFile,
      JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "0" } }),
    );
    applyManagedJson({
      file: w.paths.settingsFile,
      stateDir: w.paths.stateDir,
      set: [[["env", TODO_TOOLS_KEY], "0"]],
      unchosen: () => true,
    });
    expect(checkLine(taskToolsCheck(w.paths))).toBe(
      "✗ task tools: missing allow rule mcp__cc-smart-dev-kit-tasks__*; missing deny rules TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite Fix: cc-smart-dev-kit setup",
    );
  });

  test("D75: work state off from setup passes; a person's own on is information", () => {
    const w = world(SEEDED);
    afterSetup(w.paths);
    applyManagedJson({
      file: w.paths.claudeMemSettingsFile,
      stateDir: w.paths.stateDir,
      set: [[[WORK_STATE], "false"]],
      unchosen: () => true,
    });
    expect(lines(w.paths)).toEqual([
      `✓ claude-mem's start blocks in ${SHORT}: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)`,
    ]);
    const settings = JSON.parse(readFileSync(w.paths.claudeMemSettingsFile, "utf8"));
    settings[WORK_STATE] = "true";
    settings[MEMORY] = "true";
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(settings));
    expect(lines(w.paths)).toEqual([
      `· claude-mem's start blocks in ${SHORT}: work state is on (your choice), memory-use block is on (your choice)`,
    ]);
  });

  test("My Work auto-refresh reports its default, explicit off, and nested settings", () => {
    const enabled =
      '· claude-mem\'s My Work auto-refresh is on (default). It can run logged-in agents outside the note-taker route shown by the kit. To turn it off: set CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH to "false" in ~/.claude-mem/settings.json';
    const disabled =
      "· claude-mem's My Work auto-refresh is off in ~/.claude-mem/settings.json; it will not launch logged-in agents outside the note-taker route";
    expect(claudeMemChecks(world(SEEDED).paths).map(checkLine)).toContain(enabled);
    for (const value of ["false", false]) {
      expect(
        claudeMemChecks(world({ ...SEEDED, CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH: value }).paths).map(
          checkLine,
        ),
      ).toContain(disabled);
      expect(
        claudeMemChecks(
          world({ env: { ...SEEDED, CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH: value } }).paths,
        ).map(checkLine),
      ).toContain(disabled);
    }
    expect(
      claudeMemChecks(world({ ...SEEDED, CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH: "true" }).paths).map(
        checkLine,
      ),
    ).toContain(enabled.replace("on (default)", "on"));
  });

  test("D68: an unreadable settings file is a warning, never a failure", () => {
    const w = world(SEEDED);
    writeFileSync(w.paths.claudeMemSettingsFile, "{not json");
    expect(lines(w.paths)).toEqual([
      `! ${SHORT} cannot be read (it is not valid JSON, or not a JSON object). Fix it by hand, then run cc-smart-dev-kit setup again.`,
    ]);
  });
});

/**
 * `doctor`'s own line for this plugin: installed AND turned on.
 *
 * The checks are tested here one at a time, with paths built from a temp home; the whole
 * report, printed by the real command in a world of its own, is `cli.test.ts`.
 */

/**
 * A temp home with this plugin installed, and the user settings saying `enabled`:
 * `true` on, `false` off, `undefined` no entry at all (what an install from before Claude
 * Code wrote one leaves).
 */
function world(enabled: boolean | undefined, version = "0.5.0"): CliPaths {
  const paths = cliPaths({ HOME: tempDir("doctor-home") });
  const installPath = join(paths.claudeConfigDir, "plugins", "cache", PLUGIN_ID, version);
  mkdirSync(installPath, { recursive: true });
  mkdirSync(dirname(paths.installedPluginsFile), { recursive: true });
  writeFileSync(
    paths.installedPluginsFile,
    JSON.stringify({ plugins: { [PLUGIN_ID]: [{ scope: "user", installPath, version }] } }),
  );
  if (enabled !== undefined) {
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(paths.settingsFile, JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: enabled } }));
  }
  return paths;
}

describe("doctor's line for this plugin", () => {
  test("CM-4: an installed plugin the user settings turn off is a failure, with what to run", () => {
    // A turned-off plugin loads nothing: no hook, no skill, no command runs, while doctor
    // said ✓ and the person was left wondering why none of it worked.
    const check = checkPlugin(world(false));
    expect(check.ok).toBe(false);
    expect(check.info).toBeUndefined();
    expect(check.text).toBe(
      `${PLUGIN_ID} 0.5.0 is installed, but the user settings turn it off: none of its hooks, skills or commands run`,
    );
    expect(check.fix).toBe(`claude plugin enable ${PLUGIN_ID}`);
  });

  test("CM-4: a settings file with no entry for it is the same failure", () => {
    const check = checkPlugin(world(undefined));
    expect(check.ok).toBe(false);
    expect(check.fix).toBe(`claude plugin enable ${PLUGIN_ID}`);
  });

  test("green when the settings turn it on", () => {
    const paths = world(true);
    const check = checkPlugin(paths);
    expect(check.ok).toBe(true);
    expect(check.text).toBe(
      `${PLUGIN_ID} 0.5.0 is installed at ~/.claude/plugins/cache/${PLUGIN_ID}/0.5.0`,
    );
  });

  test("not installed at all still says so, and never claims it is off", () => {
    const paths = cliPaths({ HOME: tempDir("doctor-home") });
    const check = checkPlugin(paths);
    expect(check.ok).toBe(false);
    expect(check.text).toBe(`the ${PLUGIN_ID} plugin is not installed`);
    expect(check.fix).toBe(`claude plugin install ${PLUGIN_ID}`);
  });
});

describe("the report's words: a group's line, the verdict, the JSON", () => {
  const passed = { ok: true, text: "passed" } as const;
  const note = { info: true, ok: true, text: "a note" } as const;
  const warning = { ok: true, text: "a warning", warn: true } as const;
  const failed = { fix: "run this", ok: false, text: "failed" } as const;

  test("a group says what it holds in words, the worst first", () => {
    expect(groupSummary(countChecks([passed, passed, note]))).toBe("2 passed, 1 note");
    expect(groupSummary(countChecks([failed, warning, warning, passed]))).toBe(
      "1 to fix, 2 warnings, 1 passed",
    );
    expect(groupSummary(countChecks([note, note]))).toBe("2 notes");
  });

  test("the verdict: a failure names the count and the next step; a warning says nothing is broken", () => {
    expect(doctorVerdict(countChecks([passed, passed, note]))).toEqual({
      mark: "ok",
      text: "Everything works: 2 checks passed.",
    });
    expect(doctorVerdict(countChecks([passed, warning]))).toEqual({
      mark: "warn",
      text: "Nothing to fix: 1 passed, and 1 warning to read above.",
    });
    expect(doctorVerdict(countChecks([failed, failed, passed, warning]))).toEqual({
      mark: "fail",
      text: "2 to fix, 1 passed, 1 warning. Run each Fix: line above, then: cc-smart-dev-kit doctor",
    });
  });

  test("a failure's line carries its fix; a pass has none", () => {
    expect(checkLine(failed)).toBe("✗ failed Fix: run this");
    expect(checkLine(note)).toBe("· a note");
  });

  test("the JSON: an empty group is left out, a group's status is its worst line", () => {
    const report = doctorReport([
      { checks: [passed, note], group: "plugin" },
      { checks: [], group: "mcp" },
      { checks: [note, warning, failed], group: "gateway" },
    ]);
    expect(report).toMatchObject({
      counts: { fail: 1, info: 2, ok: 1, warn: 1 },
      format: 1,
      ok: false,
    });
    expect(report.groups).toEqual([
      {
        checks: [
          { status: "ok", text: "passed" },
          { status: "info", text: "a note" },
        ],
        id: "plugin",
        status: "ok",
        title: "The plugin",
      },
      {
        checks: [
          { status: "info", text: "a note" },
          { status: "warn", text: "a warning" },
          { fix: "run this", status: "fail", text: "failed" },
        ],
        id: "gateway",
        status: "fail",
        title: "Gateway",
      },
    ]);
  });
});
