/**
 * `packageScripts` (`package-scripts.ts`): the `scripts` names of a folder's `package.json`,
 * read from the machine, and null for anything the classifier must treat as "no file".
 * Every expectation is written by hand; each file lives in a temp folder.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { packageScripts } from "./package-scripts";

/** A temp folder holding `package.json` with exactly `text`. */
function folderWith(text: string): string {
  const folder = tempDir("package-scripts");
  writeFileSync(join(folder, "package.json"), text);
  return folder;
}

describe("packageScripts", () => {
  test("gives the names in scripts, and an empty set when there is no scripts key", () => {
    expect([
      ...(packageScripts(folderWith('{"scripts":{"tsc":"tsgo","build":"x"}}')) ?? []),
    ]).toEqual(["tsc", "build"]);
    // A project with no scripts defines no script: a name is the package's tool there.
    expect(packageScripts(folderWith('{"name":"app"}'))).toEqual(new Set());
    expect(packageScripts(folderWith('{"scripts":{}}'))).toEqual(new Set());
  });

  test("gives null when there is no package.json, or no folder", () => {
    expect(packageScripts(tempDir("package-scripts-none"))).toBeNull();
    expect(packageScripts(join(tempDir("package-scripts-gone"), "missing"))).toBeNull();
  });

  test("gives null for a file it cannot use: broken JSON, or scripts that is no object", () => {
    for (const text of [
      "",
      "not json",
      "null",
      '"a string"',
      '{"scripts":"tsc"}',
      '{"scripts":null}',
      '{"scripts":["tsc"]}',
    ]) {
      expect([text, packageScripts(folderWith(text))]).toEqual([text, null]);
    }
  });

  test("a package.json that is a folder is no package.json", () => {
    const folder = tempDir("package-scripts-dir");
    mkdirSync(join(folder, "package.json"));
    expect(packageScripts(folder)).toBeNull();
  });
});
