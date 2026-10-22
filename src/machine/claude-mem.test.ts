/**
 * D23: claude-mem's two start blocks, off on every machine. The plan and its write are
 * tested here; `setup`, `doctor` and `restore` have their own tests.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { restore } from "../setup/restore";
import { tempDir } from "../testing/temp";
import { applyClaudeMem, claudeMemPlan, readStartBlocks } from "./claude-mem";

const WORK_STATE = "CLAUDE_MEM_WORK_STATE_ENABLED";
const MEMORY = "CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED";

/** claude-mem's settings.json as 13.40.0 seeds it on its first run (the keys that matter). */
const SEEDED = {
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_WORK_STATE_ENABLED: "true",
  CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "true",
};

interface Options {
  /** The installed claude-mem version. null: the version is not a version number. */
  version?: string | null;
  /** false: claude-mem is not installed. */
  installed?: boolean;
  /** claude-mem's settings.json; left out: the file does not exist. */
  settings?: unknown;
  /** An affordable scout in gateway.json. */
  gateway?: boolean;
}

function machine(options: Options = {}) {
  const home = tempDir("claude-mem");
  const configDir = join(home, ".claude");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  if (options.installed !== false) {
    const installPath = join(home, "plugins", "claude-mem");
    mkdirSync(installPath, { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "claude-mem@thedotmack": [
            {
              scope: "user",
              installPath,
              version: options.version === undefined ? "13.40.0" : options.version,
            },
          ],
        },
      }),
    );
  }
  if (options.settings !== undefined) {
    mkdirSync(dirname(paths.claudeMemSettingsFile), { recursive: true });
    writeFileSync(paths.claudeMemSettingsFile, JSON.stringify(options.settings, null, 2), {
      mode: 0o600,
    });
  }
  if (options.gateway === true) {
    mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
    writeFileSync(
      paths.gatewayConfigFile,
      JSON.stringify({
        version: 1,
        backends: {
          omniroute: { apiKey: "sk-test-000000000000", baseUrl: "http://127.0.0.1:18434" },
        },
        slots: { "cc-smart-dev-kit-scout": ["omniroute:ollama-cloud/model"] },
      }),
      { mode: 0o600 },
    );
  }
  const plan = () => claudeMemPlan(paths);
  return { home, paths, plan };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** The two retired quota-fallback keys every plan takes out while they are setup's. */
const RETIRED = [["CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER"], ["CLAUDE_MEM_QUOTA_FALLBACK_MODEL"]];

describe("D23: claude-mem's two start blocks, planned on their own", () => {
  test("D23: installed with no gateway: both blocks are planned off, and the task tools come on", () => {
    const w = machine({ settings: SEEDED });
    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [
          [[WORK_STATE], "false"],
          [[MEMORY], "false"],
        ],
        provider: null,
        notes: [],
        todoTools: true,
      },
    });
  });

  test("D23: claude-mem's settings file does not exist yet: both keys are planned", () => {
    const w = machine();
    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [
          [[WORK_STATE], "false"],
          [[MEMORY], "false"],
        ],
        provider: null,
        notes: [],
        todoTools: true,
      },
    });
  });

  test("D23: claude-mem is not installed: nothing is planned", () => {
    expect(machine({ installed: false, settings: SEEDED }).plan()).toEqual({ notInstalled: true });
  });

  test("D23: older than 13.36.0: both keys are still planned, because an unknown key is harmless", () => {
    const w = machine({ version: "13.35.0", settings: SEEDED });
    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [
          [[WORK_STATE], "false"],
          [[MEMORY], "false"],
        ],
        provider: null,
        notes: [],
        todoTools: true,
      },
    });
  });

  test('D23: claude-mem\'s own defaults ("true" and "") count as unchosen, so setup turns them off', () => {
    const w = machine({ settings: { ...SEEDED, [WORK_STATE]: "", [MEMORY]: "true" } });
    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [
          [[WORK_STATE], "false"],
          [[MEMORY], "false"],
        ],
        provider: null,
        notes: [],
        todoTools: true,
      },
    });
  });

  test("D23: a value the person wrote is kept, and named in a ! line", () => {
    const w = machine({ settings: { ...SEEDED, [MEMORY]: "0" } });
    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [[[WORK_STATE], "false"]],
        provider: null,
        notes: [
          '! claude-mem settings left alone: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED is "0" in ~/.claude-mem/settings.json (your choice)',
        ],
        todoTools: true,
      },
    });
  });

  test('D23: a value setup wrote and the person changed back to "true" is kept, and named', () => {
    const w = machine({ settings: SEEDED });
    const first = w.plan();
    if (!("plan" in first)) throw new Error("expected a plan");
    expect(applyClaudeMem(w.paths, first.plan, false).changes).toHaveLength(2);
    const written = readJson(w.paths.claudeMemSettingsFile);
    expect(written[WORK_STATE]).toBe("false");
    expect(written[MEMORY]).toBe("false");

    // The person turns work state back on: the README's own way back.
    written[WORK_STATE] = "true";
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(written, null, 2));

    expect(w.plan()).toEqual({
      plan: {
        remove: RETIRED,
        startBlocks: [[[MEMORY], "false"]],
        provider: null,
        notes: [
          '! claude-mem settings left alone: CLAUDE_MEM_WORK_STATE_ENABLED is "true" in ~/.claude-mem/settings.json (your choice)',
        ],
        todoTools: false,
      },
    });
    const second = w.plan();
    if (!("plan" in second)) throw new Error("expected a plan");
    expect(applyClaudeMem(w.paths, second.plan, false).changes).toEqual([]);
    expect(readJson(w.paths.claudeMemSettingsFile)[WORK_STATE]).toBe("true");
  });

  test("D23: a second plan after its write changes nothing", () => {
    const w = machine({ settings: SEEDED });
    const first = w.plan();
    if (!("plan" in first)) throw new Error("expected a plan");
    applyClaudeMem(w.paths, first.plan, false);
    const again = w.plan();
    if (!("plan" in again)) throw new Error("expected a plan");
    expect(applyClaudeMem(w.paths, again.plan, true).changes).toEqual([]);
  });

  test("D23: the scout's provider keys are planned exactly as before, beside the two blocks", () => {
    const w = machine({ settings: SEEDED, gateway: true });
    const planned = w.plan();
    if (!("plan" in planned)) throw new Error("expected a plan");
    expect(planned.plan.startBlocks).toEqual([
      [[WORK_STATE], "false"],
      [[MEMORY], "false"],
    ]);
    expect(planned.plan.provider).toEqual({
      target: {
        backend: "omniroute",
        baseUrl: "http://127.0.0.1:18434/v1",
        model: "ollama-cloud/model",
        apiKey: "sk-test-000000000000",
      },
      set: [
        [["CLAUDE_MEM_PROVIDER"], "openai-compatible"],
        [["CLAUDE_MEM_OPENAI_COMPAT_PRESET"], "custom"],
        [["CLAUDE_MEM_OPENAI_COMPAT_BASE_URL"], "http://127.0.0.1:18434/v1"],
        [["CLAUDE_MEM_OPENAI_COMPAT_MODEL"], "ollama-cloud/model"],
        [["CLAUDE_MEM_OPENAI_COMPAT_API_KEY"], "sk-test-000000000000"],
      ],
    });
    expect(planned.plan.notes).toEqual([]);
    expect(planned.plan.todoTools).toBe(true);
  });

  test("D23: setup writes both keys through applyManagedJson, mode 600; restore takes them back", () => {
    const w = machine({ settings: SEEDED });
    const planned = w.plan();
    if (!("plan" in planned)) throw new Error("expected a plan");
    expect(applyClaudeMem(w.paths, planned.plan, false).changes).toEqual([
      { path: [WORK_STATE], before: "true", after: "false" },
      { path: [MEMORY], before: "true", after: "false" },
    ]);
    expect(statSync(w.paths.claudeMemSettingsFile).mode & 0o777).toBe(0o600);
    expect(readJson(w.paths.claudeMemSettingsFile)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_PROVIDER: "claude",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
      [WORK_STATE]: "false",
      [MEMORY]: "false",
    });

    restore(w.paths.stateDir);
    // The keys go; claude-mem falls back to its own defaults ("true") for both.
    expect(readJson(w.paths.claudeMemSettingsFile)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_PROVIDER: "claude",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
    });
  });

  test("D23: an old file holding only claude-mem's env form is left alone, with the note", () => {
    const w = machine({ settings: { env: SEEDED } });
    const planned = w.plan();
    if (!("note" in planned)) throw new Error("expected a note");
    expect(planned.note).toBe(
      "! claude-mem settings left alone: ~/.claude-mem/settings.json is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then run cc-smart-dev-kit setup again.",
    );
  });
});

describe("D23: what doctor reads", () => {
  test("D23: who set each value, and claude-mem's own default is named as such", () => {
    const w = machine({
      settings: { ...SEEDED, [MEMORY]: "0" },
    });
    const first = w.plan();
    if (!("plan" in first)) throw new Error("expected a plan");
    applyClaudeMem(w.paths, first.plan, false);
    // The person turns work state back on; memory instructions were theirs already.
    const written = readJson(w.paths.claudeMemSettingsFile);
    written[WORK_STATE] = "true";
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(written, null, 2));

    expect(readStartBlocks(w.paths)).toEqual([
      { key: WORK_STATE, value: "true", by: "person" },
      { key: MEMORY, value: "0", by: "person" },
    ]);
  });

  test("D23: both keys from claude-mem's defaults: nobody set them", () => {
    const w = machine({ settings: SEEDED });
    expect(readStartBlocks(w.paths)).toEqual([
      { key: WORK_STATE, value: "true", by: "default" },
      { key: MEMORY, value: "true", by: "default" },
    ]);
  });

  test("D23: both keys set by setup: setup", () => {
    const w = machine({ settings: SEEDED });
    const planned = w.plan();
    if (!("plan" in planned)) throw new Error("expected a plan");
    applyClaudeMem(w.paths, planned.plan, false);
    expect(readStartBlocks(w.paths)).toEqual([
      { key: WORK_STATE, value: "false", by: "setup" },
      { key: MEMORY, value: "false", by: "setup" },
    ]);
  });

  test("D23: claude-mem not installed: nothing to read; an unreadable file is a problem", () => {
    expect(readStartBlocks(machine({ installed: false, settings: SEEDED }).paths)).toBeNull();
    const w = machine({ settings: SEEDED });
    writeFileSync(w.paths.claudeMemSettingsFile, "{not json");
    expect(readStartBlocks(w.paths)).toEqual({
      problem:
        "~/.claude-mem/settings.json cannot be read (it is not valid JSON, or not a JSON object). Fix it by hand, then run cc-smart-dev-kit setup again.",
    });
  });
});
