/**
 * ST-10: a JSON file a person saved with a byte order mark (U+FEFF at the start, what Notepad
 * and an older PowerShell write) reads as the JSON it holds — for every reader of such a file.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { pluginEnabled } from "../machine/companions";
import { settingsEnvValue } from "../mcp/tavily";
import { capturePrinted, printed, world } from "../testing/fake-machine";
import { tempDir } from "../testing/temp";
import { settingsEnv } from "../update/opt-out";
import { applyManagedJson, readJsonObject } from "./managed-json";
import { parseUserJson, readUserJson, withoutBom } from "./user-json";

capturePrinted();

const BOM = "﻿";

function bomFile(value: unknown): string {
  const file = join(tempDir("user-json"), "settings.json");
  writeFileSync(file, `${BOM}${JSON.stringify(value, null, 2)}\n`);
  return file;
}

describe("ST-10: a settings file saved with a byte order mark", () => {
  test("the reader skips the mark, and only a leading one", () => {
    expect(parseUserJson(`${BOM}{"a":1}`)).toEqual({ a: 1 });
    expect(parseUserJson('{"a":1}')).toEqual({ a: 1 });
    expect(withoutBom(`${BOM}x`)).toBe("x");
    expect(withoutBom(`x${BOM}`)).toBe(`x${BOM}`);
    expect(() => parseUserJson(`${BOM}{not json`)).toThrow();
    expect(readUserJson(bomFile({ b: true }))).toEqual({ b: true });
  });

  test("setup's managed keys read it, and write it back as plain JSON", () => {
    const file = bomFile({ theirs: 1 });
    expect(readJsonObject(file).data).toEqual({ theirs: 1 });
    const stateDir = join(dirname(file), "state");
    applyManagedJson({ file, stateDir, set: [[["ours"], true]] });
    expect(readFileSync(file, "utf8")).toBe('{\n  "theirs": 1,\n  "ours": true\n}\n');
  });

  test("the companions' check, the Tavily key's place and the update switches read it", () => {
    const home = tempDir("user-json-home");
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      `${BOM}${JSON.stringify({
        enabledPlugins: { "my-plugin@my-market": true },
        env: { TAVILY_API_KEY: "tvly-x", DISABLE_AUTOUPDATER: "1" },
      })}`,
    );
    expect(pluginEnabled(paths, "my-plugin@my-market")).toBe(true);
    expect(settingsEnvValue(paths.settingsFile, "TAVILY_API_KEY")).toBe("tvly-x");
    expect(settingsEnv(paths.settingsFile)).toEqual({
      TAVILY_API_KEY: "tvly-x",
      DISABLE_AUTOUPDATER: "1",
    });
  });

  test("setup on such a file: it sees the marketplace, and runs", async () => {
    const w = world();
    const text = readFileSync(w.paths.settingsFile, "utf8");
    writeFileSync(w.paths.settingsFile, `${BOM}${text}`);
    expect(await w.setup()).toBe(0);
    expect(printed.join("\n")).not.toContain("does not list the");
    expect(readFileSync(w.paths.settingsFile, "utf8").startsWith(BOM)).toBe(false);
  });
});
