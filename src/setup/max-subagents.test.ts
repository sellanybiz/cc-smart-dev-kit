import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { ownedRecords } from "./managed-json";
import {
  applyMaxSubagents,
  DEFAULT_MAX_SUBAGENTS,
  MAX_SUBAGENTS_ENV,
  MAX_SUBAGENTS_FLAG,
  parseMaxSubagents,
  planMaxSubagents,
} from "./max-subagents";
import { restore } from "./restore";

const ENV = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";
const KEY = ["env", ENV];
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
function world(content?: unknown) {
  const dir = tempDir("max-subagents");
  const settingsFile = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  if (content !== undefined) writeFileSync(settingsFile, JSON.stringify(content));
  return { dir, settingsFile, stateDir };
}

describe("max subagents", () => {
  test("exports the default and CLI names", () => {
    expect(DEFAULT_MAX_SUBAGENTS).toBe(10);
    expect(MAX_SUBAGENTS_ENV).toBe(ENV);
    expect(MAX_SUBAGENTS_FLAG).toBe("--max-subagents");
  });

  test.each(["1", "10", "100"])("parses %s", (input) => {
    expect(parseMaxSubagents(input)).toBe(Number(input));
  });

  test.each([undefined, "", "0", "101", "-1", "1.5", "1e1", " 10", "10x", "NaN"])(
    "refuses invalid input %s with a fix",
    (input) => {
      expect(() => parseMaxSubagents(input)).toThrow(
        "--max-subagents needs a whole number from 1 to 100; run: cc-smart-dev-kit setup --max-subagents 10",
      );
    },
  );

  test("plans without writes, then adds one owned string key with a backup", () => {
    const w = world({ model: "opus" });
    const before = readFileSync(w.settingsFile, "utf8");
    expect(planMaxSubagents(w)).toEqual({
      set: [[KEY, "10"]],
      note: "max subagents: 10 (set by cc-smart-dev-kit); to change it, run: cc-smart-dev-kit setup --max-subagents <n> (1–100)",
    });
    expect(existsSync(w.stateDir)).toBe(false);
    const dry = applyMaxSubagents({ ...w, dryRun: true });
    expect(dry.written).toBe(false);
    expect(dry.changes).toEqual([{ path: KEY, before: undefined, after: "10" }]);
    expect(dry.note).toBe(
      "would set max subagents: 10; to change it, run: cc-smart-dev-kit setup --max-subagents <n> (1–100)",
    );
    expect(readFileSync(w.settingsFile, "utf8")).toBe(before);
    expect(existsSync(w.stateDir)).toBe(false);
    const real = applyMaxSubagents(w);
    expect(real.written).toBe(true);
    expect(real.backup).not.toBeNull();
    expect(read(w.settingsFile)).toEqual({ model: "opus", env: { [ENV]: "10" } });
    expect(ownedRecords(w.stateDir, w.settingsFile)).toEqual([{ path: KEY, value: "10" }]);
    expect(applyMaxSubagents(w).changes).toEqual([]);
    expect(applyMaxSubagents(w).note).toBeNull();
    restore(w.stateDir);
    expect(read(w.settingsFile)).toEqual({ model: "opus" });
  });

  test("creates a missing file; restore removes it", () => {
    const w = world();
    applyMaxSubagents(w);
    restore(w.stateDir);
    expect(existsSync(w.settingsFile)).toBe(false);
  });

  test("updates an owned value with the option", () => {
    const w = world({ env: { OTHER: "kept" } });
    applyMaxSubagents(w);
    expect(applyMaxSubagents({ ...w, maxSubagents: 25 }).written).toBe(true);
    expect(read(w.settingsFile).env).toEqual({ OTHER: "kept", [ENV]: "25" });
    restore(w.stateDir);
    expect(read(w.settingsFile)).toEqual({ env: { OTHER: "kept" } });
  });

  test.each(["10", "30", 5, null])("keeps an unowned value %s, even with an option", (value) => {
    const w = world({ env: { [ENV]: value } });
    const result = applyMaxSubagents({ ...w, maxSubagents: 40 });
    expect(result.note).toBe(
      `max subagents: your own ${ENV} in ${w.settingsFile} is kept; change it by hand to use another value`,
    );
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([]);
    expect(existsSync(w.stateDir)).toBe(false);
    expect(read(w.settingsFile)).toEqual({ env: { [ENV]: value } });
  });

  test.each(["22", undefined])("keeps a person's edit or deletion after setup: %s", (value) => {
    const w = world({ env: { OTHER: "kept" } });
    applyMaxSubagents(w);
    writeFileSync(
      w.settingsFile,
      JSON.stringify({ env: { OTHER: "kept", ...(value === undefined ? {} : { [ENV]: value }) } }),
    );
    const before = readFileSync(w.settingsFile, "utf8");
    expect(applyMaxSubagents(w).written).toBe(false);
    expect(applyMaxSubagents(w).note).toContain("your own");
    restore(w.stateDir);
    expect(readFileSync(w.settingsFile, "utf8")).toBe(before);
  });

  test("follows symlink ownership", () => {
    const w = world({});
    const link = join(w.dir, "linked.json");
    symlinkSync(w.settingsFile, link);
    applyMaxSubagents({ ...w, settingsFile: link });
    expect(applyMaxSubagents(w).note).toBeNull();
  });

  test.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid programmatic value %s before writes",
    (maxSubagents) => {
      const w = world();
      expect(() => applyMaxSubagents({ ...w, maxSubagents })).toThrow("whole number from 1 to 100");
      expect(existsSync(w.settingsFile)).toBe(false);
      expect(existsSync(w.stateDir)).toBe(false);
    },
  );

  test("fails loudly on invalid settings without writes", () => {
    const w = world();
    writeFileSync(w.settingsFile, "{bad");
    expect(() => planMaxSubagents(w)).toThrow();
    expect(existsSync(w.stateDir)).toBe(false);
  });
});
