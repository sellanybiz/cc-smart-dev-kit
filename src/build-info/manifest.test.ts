import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from ".";
import { parseRepository, readBuildInfo } from "./manifest";

describe("parseRepository", () => {
  test.each([
    ["https://github.com/example-org/anymodel", "example-org/anymodel"],
    ["https://github.com/example-org/anymodel.git", "example-org/anymodel"],
    ["https://git.example.com/example-org/anymodel/", "example-org/anymodel"],
    ["git@github.com:example-org/anymodel.git", "example-org/anymodel"],
    ["example-org/anymodel", "example-org/anymodel"],
  ])("%p gives %p", (url, expected) => {
    expect(parseRepository(url)).toBe(expected);
  });

  test.each(["", "anymodel", "https://github.com/only-owner", "https://host/a/b/c"])(
    "%p throws",
    (url) => {
      expect(() => parseRepository(url)).toThrow("Cannot read <owner>/<name>");
    },
  );
});

describe("the router bundle", () => {
  test("holds no version and no repository: a version bump leaves it as it is", () => {
    // A changed router.js makes `gateway setup` restart the router on every machine, so
    // only a real router change may change it. The version is baked by build-info's index;
    // the router imports the names from build-info/names instead.
    const root = join(import.meta.dir, "..", "..");
    const manifest = JSON.parse(
      readFileSync(join(root, "plugin", ".claude-plugin", "plugin.json"), "utf8"),
    ) as { repository: string; version: string };
    const router = readFileSync(join(root, "plugin", "dist", "router.js"), "utf8");
    expect(router).not.toContain(`"${manifest.version}"`);
    expect(router).not.toContain(parseRepository(manifest.repository));
    expect(router).not.toContain('"repo"');
    expect(router).not.toContain("repo:");
    // It does hold the command name it prints, from build-info/names.
    expect(router).toContain('var COMMAND = "anymodel";');
  });
});

describe("the baked build info", () => {
  test("matches plugin.json, read now", () => {
    const manifest = join(import.meta.dir, "..", "..", "plugin", ".claude-plugin", "plugin.json");
    expect({ version: VERSION, repo: MARKETPLACE_SOURCE }).toEqual(readBuildInfo(manifest));
    expect(MARKETPLACE_SOURCE).toMatch(/^[^/\s]+\/[^/\s]+$/);
  });
});
