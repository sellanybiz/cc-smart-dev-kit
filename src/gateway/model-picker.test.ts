import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyManagedJson } from "../setup/managed-json";
import { restore } from "../setup/restore";
import { tempDir } from "../testing/temp";
import { emptyConfig } from "./config";
import { pickerFor } from "./model-picker";
import { writePicker } from "./model-picker-step";
import { turnOff, turnOn } from "./settings";
import { shortTargetName } from "./target-label";

const claudeRows = [
  { model: "opus", label: "Opus", description: "Claude's newest Opus" },
  { model: "sonnet", label: "Sonnet", description: "Claude's newest Sonnet" },
  { model: "haiku", label: "Haiku", description: "Claude's newest Haiku" },
  { model: "fable", label: "Fable", description: "Claude's newest Fable" },
];
test("alias rows on Claude; backend first on every routed family; profile overrides", () => {
  const config = emptyConfig();
  expect(pickerFor(config)).toEqual({ replaceBuiltInOptions: true, options: claudeRows });
  config.slots = {
    "cc-smart-dev-kit-scout": ["omniroute:vendor/small"],
    "cc-smart-dev-kit-worker": ["omniroute:codex/gpt-6.1-sol"],
    "cc-smart-dev-kit-opus": ["omniroute:vendor/large", "claude-opus-5-5"],
    "cc-smart-dev-kit-fable": ["claude-fable-5-2"],
  };
  expect(pickerFor(config).options).toEqual([
    { model: "opus", label: "Opus", description: "answered by large (opus slot)" },
    { model: "sonnet", label: "Sonnet", description: "answered by gpt-6.1-sol (worker slot)" },
    { model: "haiku", label: "Haiku", description: "answered by small (scout slot)" },
    { model: "fable", label: "Fable", description: "answered by claude-fable-5-2 (fable slot)" },
  ]);
  config.profiles = { plain: { slots: { "cc-smart-dev-kit-opus": [] } } };
  expect(pickerFor(config, "plain").options[0]).toEqual(claudeRows[0]);
  expect(shortTargetName("omniroute:codex/gpt-6.1-sol")).toBe("gpt-6.1-sol");
  expect(shortTargetName("claude-opus-5-5")).toBe("claude-opus-5-5");
});

test("on writes, refresh updates, off removes; owned pin retires", () => {
  const dir = tempDir("picker");
  const file = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  const config = emptyConfig();
  applyManagedJson({
    file,
    stateDir,
    set: [[["env", "ANTHROPIC_DEFAULT_FABLE_MODEL"], "claude-fable-5-2"]],
  });
  turnOn({ settingsFile: file, stateDir, port: 47123, config });
  let data = JSON.parse(readFileSync(file, "utf8"));
  expect(data.modelPicker).toEqual({ replaceBuiltInOptions: true, options: claudeRows });
  expect(data.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBeUndefined();
  config.slots["cc-smart-dev-kit-worker"] = ["omniroute:codex/gpt-6.1-sol"];
  writePicker({ file, stateDir, config });
  data = JSON.parse(readFileSync(file, "utf8"));
  expect(data.modelPicker.options[1].description).toBe("answered by gpt-6.1-sol (worker slot)");
  turnOff({ settingsFile: file, stateDir });
  expect(JSON.parse(readFileSync(file, "utf8")).modelPicker).toBeUndefined();
});

for (const kind of ["foreign", "changed", "removed"] as const) {
  test(`refresh and on leave a ${kind} picker alone`, () => {
    const dir = tempDir("picker-choice");
    const file = join(dir, "settings.json");
    const stateDir = join(dir, "state");
    const config = emptyConfig();
    if (kind !== "foreign") writePicker({ file, stateDir, config });
    writeFileSync(file, JSON.stringify(kind === "removed" ? {} : { modelPicker: { options: [] } }));
    const before = readFileSync(file, "utf8");
    const result = writePicker({ file, stateDir, config });
    expect(result.skipped).toContainEqual({
      path: ["modelPicker"],
      reason: "set, changed or removed by you; left alone",
    });
    expect(readFileSync(file, "utf8")).toBe(before);
    turnOn({ settingsFile: file, stateDir, port: 47123, config });
    expect(JSON.parse(readFileSync(file, "utf8")).modelPicker).toEqual(
      kind === "removed" ? undefined : { options: [] },
    );
  });
}

for (const command of ["off", "restore"] as const) {
  for (const owned of [true, false]) {
    test(`${command} retires only an owned pin; foreign values stay`, () => {
      const dir = tempDir("pin-retirement");
      const file = join(dir, "settings.json");
      const stateDir = join(dir, "state");
      if (owned)
        applyManagedJson({
          file,
          stateDir,
          set: [[["env", "ANTHROPIC_DEFAULT_FABLE_MODEL"], "claude-fable-5-2"]],
        });
      else
        writeFileSync(
          file,
          JSON.stringify({ env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1" } }),
        );
      if (command === "off") turnOff({ settingsFile: file, stateDir });
      else restore(stateDir);
      expect(
        (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}).env
          ?.ANTHROPIC_DEFAULT_FABLE_MODEL,
      ).toBe(owned ? undefined : "claude-fable-5-1");
    });
  }
}

test("restore removes the owned menu and keeps a changed menu", () => {
  const dir = tempDir("picker-restore");
  const file = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  writeFileSync(file, "{}");
  writePicker({ file, stateDir, config: emptyConfig() });
  restore(stateDir);
  expect(JSON.parse(readFileSync(file, "utf8")).modelPicker).toBeUndefined();
  writePicker({ file, stateDir, config: emptyConfig() });
  writeFileSync(file, JSON.stringify({ modelPicker: { options: [] } }));
  restore(stateDir);
  expect(JSON.parse(readFileSync(file, "utf8")).modelPicker).toEqual({ options: [] });
});

test("a different Claude family first is named, and an unknown profile is plain Claude", () => {
  const config = emptyConfig();
  config.slots["cc-smart-dev-kit-opus"] = ["claude-sonnet-5-5"];
  expect(pickerFor(config).options.find((row) => row.model === "opus")).toEqual({
    model: "opus",
    label: "Opus",
    description: "answered by claude-sonnet-5-5 (opus slot)",
  });
  expect(pickerFor(config, "missing")).toEqual({
    replaceBuiltInOptions: true,
    options: claudeRows,
  });
});

test("explicit same-family pins and colon-bearing backend models name their target", () => {
  const config = emptyConfig();
  config.slots = {
    "cc-smart-dev-kit-opus": ["claude-opus-4-1"],
    "cc-smart-dev-kit-worker": ["omniroute:ollama/qwen2.5-coder:32b"],
  };
  expect(pickerFor(config).options[0]).toEqual({
    model: "opus",
    label: "Opus",
    description: "answered by claude-opus-4-1 (opus slot)",
  });
  expect(pickerFor(config).options[1]).toEqual({
    model: "sonnet",
    label: "Sonnet",
    description: "answered by qwen2.5-coder:32b (worker slot)",
  });
});
