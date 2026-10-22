/**
 * Whether the plugin's monitors run here (`telemetry.ts`): telemetry off stops every monitor
 * (proved live, L1a.1), so the lead's watch is the fallback there.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { monitorsRunHere } from "./telemetry";

/** A settings file with the given `env`. */
function settingsWith(env: Record<string, string>): string {
  const file = join(tempDir("settings"), "settings.json");
  writeFileSync(file, JSON.stringify({ env }));
  return file;
}

describe("the monitors and telemetry", () => {
  test("D25: they run when nothing turns telemetry off", () => {
    expect(monitorsRunHere({}, settingsWith({}))).toBe(true);
  });

  test("D25: DISABLE_TELEMETRY in the environment stops them", () => {
    expect(monitorsRunHere({ DISABLE_TELEMETRY: "1" }, settingsWith({}))).toBe(false);
    expect(monitorsRunHere({ DISABLE_TELEMETRY: "true" }, settingsWith({}))).toBe(false);
    expect(monitorsRunHere({ DISABLE_TELEMETRY: "0" }, settingsWith({}))).toBe(true);
  });

  test("D25: the same variable in the settings' env stops them", () => {
    expect(monitorsRunHere({}, settingsWith({ DISABLE_TELEMETRY: "1" }))).toBe(false);
    expect(
      monitorsRunHere({}, settingsWith({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" })),
    ).toBe(false);
  });

  test("D25: a settings file that cannot be read counts as running", () => {
    expect(monitorsRunHere({}, join(tempDir("nothing"), "settings.json"))).toBe(true);
  });
});
