import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { claudeDefaultsMarkerFile } from "../gateway/claude-defaults";
import { DEFAULT_PORT } from "../gateway/config";
import { applyModelPickerStep } from "../gateway/model-picker-step";
import { applyManagedJson, ownedRecords } from "../setup/managed-json";
import { realTarget } from "../setup/write";
import { capturePrinted, printed, world } from "../testing/fake-machine";

capturePrinted();
const PORT = 47123;
const ADDRESS = `http://127.0.0.1:${PORT}`;
const KEY = "ANTHROPIC_DEFAULT_FABLE_MODEL";
function machine(address = ADDRESS, owned = true) {
  const w = world();
  mkdirSync(dirname(w.paths.gatewayConfigFile), { recursive: true });
  writeFileSync(
    w.paths.gatewayConfigFile,
    JSON.stringify({
      version: 1,
      port: PORT,
      backends: {},
      slots: {},
      aliases: {},
      timeouts: { firstByteMs: 1000 },
    }),
    { mode: 0o600 },
  );
  mkdirSync(w.paths.stateDir, { recursive: true });
  writeFileSync(claudeDefaultsMarkerFile(w.paths.stateDir), "done\n");
  if (owned)
    applyManagedJson({
      file: w.paths.settingsFile,
      stateDir: w.paths.stateDir,
      set: [[["env", "ANTHROPIC_BASE_URL"], address]],
    });
  else {
    const value = JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));
    value.env = { ANTHROPIC_BASE_URL: address };
    writeFileSync(w.paths.settingsFile, JSON.stringify(value));
  }
  return w;
}
const settings = (w: ReturnType<typeof world>) =>
  JSON.parse(readFileSync(w.paths.settingsFile, "utf8"));

describe("setup refreshes the model menu without switching the gateway", () => {
  test("an owned active address gains an owned menu, and a second setup is unchanged", async () => {
    const w = machine();
    expect(await w.setup()).toBe(0);
    expect(settings(w).env.ANTHROPIC_BASE_URL).toBe(ADDRESS);
    expect(settings(w).modelPicker.options).toHaveLength(4);
    expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.settingsFile))).toContainEqual({
      path: ["modelPicker"],
      value: settings(w).modelPicker,
    });
    expect(await w.setup()).toBe(0);
    expect(settings(w).env[KEY]).toBeUndefined();
  });
  test("dry-run reports the addition without writing it", async () => {
    const w = machine();
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(settings(w).env[KEY]).toBeUndefined();
    expect(printed.join("\n")).toContain("modelPicker");
  });
  for (const [label, address, owned] of [
    ["off", "https://api.anthropic.com", true],
    ["another router", "http://127.0.0.1:47124", true],
    ["foreign address", ADDRESS, false],
  ] as const) {
    test(`${label} stays as it is`, async () => {
      const w = machine(address, owned);
      expect(await w.setup()).toBe(0);
      expect(settings(w).env.ANTHROPIC_BASE_URL).toBe(address);
      expect(settings(w).modelPicker).toBeUndefined();
      expect(settings(w).env[KEY]).toBeUndefined();
    });
  }
  test("a foreign Fable pin value is kept and named as information", async () => {
    const w = machine();
    const value = settings(w);
    value.env[KEY] = "claude-fable-5-1";
    writeFileSync(w.paths.settingsFile, JSON.stringify(value));
    expect(await w.setup()).toBe(0);
    expect(settings(w).env[KEY]).toBe("claude-fable-5-1");
    expect(printed.join("\n")).toContain(`env.${KEY}`);
  });
  test("a Fable pin key still ours is retired", async () => {
    const w = machine();
    applyManagedJson({
      file: w.paths.settingsFile,
      stateDir: w.paths.stateDir,
      set: [[["env", KEY], "claude-fable-5-1"]],
    });
    expect(await w.setup()).toBe(0);
    expect(settings(w).env[KEY]).toBeUndefined();
  });
});

test("the standalone refresh reports broken settings without throwing", () => {
  const w = machine();
  writeFileSync(w.paths.settingsFile, "{ broken");
  expect(applyModelPickerStep(w.paths, false)[0]).toContain(
    "! gateway model menu was not refreshed",
  );
});

test("an unfinished defaults step skips the pin refresh in preview and real setup", async () => {
  const w = machine();
  rmSync(claudeDefaultsMarkerFile(w.paths.stateDir));
  writeFileSync(w.paths.gatewayConfigFile, "{ broken");
  expect(await w.setup({ dryRun: true })).toBe(0);
  expect(printed.join("\n")).not.toContain("gateway model menu was not refreshed");
  expect(await w.setup()).toBe(0);
  expect(printed.join("\n")).not.toContain("gateway model menu was not refreshed");
});

test("removed by hand, setup again leaves the menu removed", async () => {
  const w = machine();
  expect(await w.setup()).toBe(0);
  const value = settings(w);
  delete value.modelPicker;
  writeFileSync(w.paths.settingsFile, JSON.stringify(value));
  expect(await w.setup()).toBe(0);
  expect(settings(w).modelPicker).toBeUndefined();
  expect(printed.join("\n")).toContain("modelPicker: set, changed or removed by you; left alone");
});

test("menu refresh retires the family pin, not older slot alias keys", () => {
  const w = machine();
  applyManagedJson({
    file: w.paths.settingsFile,
    stateDir: w.paths.stateDir,
    set: [
      [["env", "ANTHROPIC_DEFAULT_HAIKU_MODEL"], "old-scout"],
      [["env", KEY], "claude-fable-5-2"],
    ],
  });
  applyModelPickerStep(w.paths, false);
  expect(settings(w).env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("old-scout");
  expect(settings(w).env[KEY]).toBeUndefined();
});

describe("an owned menu left behind while the gateway is off", () => {
  const MENU = { replaceBuiltInOptions: true, options: [{ model: "sonnet", label: "Sonnet" }] };
  test("setup removes the kit's unchanged menu", async () => {
    const w = machine("https://api.anthropic.com");
    applyManagedJson({
      file: w.paths.settingsFile,
      stateDir: w.paths.stateDir,
      set: [[["modelPicker"], MENU]],
    });
    expect(await w.setup()).toBe(0);
    expect(settings(w).modelPicker).toBeUndefined();
    expect(printed.join("\n")).toContain(
      "modelPicker: your settings do not route through the kit's router; menu removed",
    );
  });
  test("a dry run names the removal and keeps the menu", () => {
    const w = machine("https://api.anthropic.com");
    applyManagedJson({
      file: w.paths.settingsFile,
      stateDir: w.paths.stateDir,
      set: [[["modelPicker"], MENU]],
    });
    expect(applyModelPickerStep(w.paths, true)).toEqual([
      "~ modelPicker: your settings do not route through the kit's router; menu removed",
    ]);
    expect(settings(w).modelPicker).toEqual(MENU);
  });
  test("a menu the person set stays", async () => {
    const w = machine("https://api.anthropic.com");
    const value = settings(w);
    value.modelPicker = MENU;
    writeFileSync(w.paths.settingsFile, JSON.stringify(value));
    expect(await w.setup()).toBe(0);
    expect(settings(w).modelPicker).toEqual(MENU);
  });
});

test("setup writes the menu without gateway.json for our default router address", async () => {
  const w = machine(`http://127.0.0.1:${DEFAULT_PORT}`);
  rmSync(w.paths.gatewayConfigFile);
  expect(await w.setup()).toBe(0);
  expect(settings(w).modelPicker.options).toHaveLength(4);
});
test("broken config keeps the successful pin retirement lines", () => {
  const w = machine();
  applyManagedJson({
    file: w.paths.settingsFile,
    stateDir: w.paths.stateDir,
    set: [[["env", KEY], "claude-fable-5-2"]],
  });
  writeFileSync(w.paths.gatewayConfigFile, "{ broken");
  const lines = applyModelPickerStep(w.paths, false);
  expect(lines[0]).toBe(`~ env.${KEY}: retired gateway key removed`);
  expect(lines.at(-1)).toContain("! gateway model menu was not refreshed");
});
