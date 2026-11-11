import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { restore } from "../setup/restore";
import { capturePrinted, changeLines, printed, world } from "../testing/fake-machine";

capturePrinted();
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("setup: project plans", () => {
  test("writes an owned key, repeats without changes, and restore removes it", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).plansDirectory).toBe(".claude/plans");
    expect(printed).toContain('  ~ ~/.claude/settings.json: plansDirectory: (none) -> ".claude/plans"');
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(changeLines()).toEqual([]);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).plansDirectory).toBeUndefined();
  });

  test("dry run shows the key without writing settings or ownership", async () => {
    const w = world();
    const before = readFileSync(w.paths.settingsFile, "utf8");
    expect(await w.setup({ dryRun: true })).toBe(0);
    expect(printed).toContain('  ~ ~/.claude/settings.json: plansDirectory: (none) -> ".claude/plans"');
    expect(readFileSync(w.paths.settingsFile, "utf8")).toBe(before);
  });

  test.each(["personal-plans", ".claude/plans", "C:\\plans"])("keeps a personal value %s and continues other writes", async (value) => {
    const w = world();
    writeFileSync(w.paths.settingsFile, JSON.stringify({ ...readJson(w.paths.settingsFile), plansDirectory: value }));
    expect(await w.setup()).toBe(0);
    expect(readJson(w.paths.settingsFile).plansDirectory).toBe(value);
    expect(readJson(w.paths.settingsFile).remoteControlAtStartup).toBe(true);
    expect(printed.some((line) => line.startsWith("  · ") && line.includes("plansDirectory"))).toBe(true);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).plansDirectory).toBe(value);
  });

  test("keeps a changed owned value while updating the other settings", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    writeFileSync(w.paths.settingsFile, JSON.stringify({ ...readJson(w.paths.settingsFile), plansDirectory: "my-plans" }));
    printed.length = 0;
    expect(await w.setup()).toBe(0);
    expect(printed.some((line) => line.startsWith("  · ") && line.includes("plansDirectory"))).toBe(true);
    restore(w.paths.stateDir);
    expect(readJson(w.paths.settingsFile).plansDirectory).toBe("my-plans");
  });
});
