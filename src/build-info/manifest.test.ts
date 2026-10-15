import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { DEPENDENCIES, MARKETPLACE_SOURCE, VERSION } from ".";
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
    expect({ version: VERSION, repo: MARKETPLACE_SOURCE, dependencies: DEPENDENCIES }).toEqual(
      readBuildInfo(manifest),
    );
    expect(MARKETPLACE_SOURCE).toMatch(/^[^/\s]+\/[^/\s]+$/);
  });
});

describe("readBuildInfo: dependencies", () => {
  const write = (manifest: unknown) => {
    const file = join(tempDir("manifest"), "plugin.json");
    writeFileSync(file, JSON.stringify(manifest));
    return file;
  };
  const base = { version: "1.0.0", repository: "example-org/anymodel" };

  test("reads each name, marketplace and range; none means an empty list", () => {
    expect(readBuildInfo(write(base)).dependencies).toEqual([]);
    expect(
      readBuildInfo(
        write({
          ...base,
          dependencies: [
            { name: "memory", marketplace: "example-mkt", version: ">=1.2.0" },
            { name: "design", marketplace: "other-mkt" },
          ],
        }),
      ).dependencies,
    ).toEqual([
      { name: "memory", marketplace: "example-mkt", version: ">=1.2.0" },
      { name: "design", marketplace: "other-mkt" },
    ]);
  });

  test.each([
    [{ dependencies: "memory" }, '"dependencies" is not a list'],
    [{ dependencies: ["memory"] }, 'write it as { "name", "marketplace" }'],
    [{ dependencies: [{ name: "memory" }] }, 'needs a "name" and a "marketplace"'],
    [{ dependencies: [{ name: "m", marketplace: "x", version: 1 }] }, '"version" is not a string'],
  ])("%p throws", (extra, message) => {
    expect(() => readBuildInfo(write({ ...base, ...extra }))).toThrow(message);
  });
});
