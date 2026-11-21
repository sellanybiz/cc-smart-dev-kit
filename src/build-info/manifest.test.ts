import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { DEPENDENCIES, MARKETPLACE_SOURCE, VERSION } from ".";
import { parseRepository, readBuildInfo } from "./manifest";

describe("parseRepository", () => {
  test.each([
    ["https://github.com/example-org/cc-smart-dev-kit", "example-org/cc-smart-dev-kit"],
    ["https://github.com/example-org/cc-smart-dev-kit.git", "example-org/cc-smart-dev-kit"],
    ["https://git.example.com/example-org/cc-smart-dev-kit/", "example-org/cc-smart-dev-kit"],
    ["git@github.com:example-org/cc-smart-dev-kit.git", "example-org/cc-smart-dev-kit"],
    ["example-org/cc-smart-dev-kit", "example-org/cc-smart-dev-kit"],
  ])("%p gives %p", (url, expected) => {
    expect(parseRepository(url)).toBe(expected);
  });

  test.each(["", "cc-smart-dev-kit", "https://github.com/only-owner", "https://host/a/b/c"])(
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
    expect(router).toContain('var COMMAND = "cc-smart-dev-kit";');
  });

  test("holds the router's own paths only, never the command's: a CLI path edit leaves it as it is", () => {
    // `src/cli/paths.ts` holds every path the command uses. In this bundle, one CLI path
    // added there would rewrite router.js without the router changing, and a changed
    // router.js restarts the router on every machine. The router reads its own small
    // module instead (`src/gateway/paths.ts`). This fails when an import brings the CLI
    // module back in; a stale bundle cannot hide it, because `bun run build:check` (in
    // `bun run check` and CI) fails on a stale plugin/dist first.
    const root = join(import.meta.dir, "..", "..");
    const router = readFileSync(join(root, "plugin", "dist", "router.js"), "utf8");
    // The router's own paths are there: its config, and its limit state file.
    expect(router).toContain("gateway.json");
    expect(router).toContain("gateway-state.json");
    // The CLI's paths module is not, comment and paths alike.
    expect(router).not.toContain("src/cli/paths.ts");
    expect(router).not.toContain("known_marketplaces.json");
    expect(router).not.toContain("installed_plugins.json");
    expect(router).not.toContain(".claude-mem");
  });
});

describe("the Workflow script parser", () => {
  test("acorn is in no bundle: nothing reads a Workflow script any more", () => {
    // The agent guard that parsed a script with acorn is gone (6.0.0). The marker is one of
    // acorn's own error messages. It reads the committed bundles, which `bun run build:check`
    // keeps up to date.
    const ACORN_ONLY = "Unterminated string constant";
    const dist = join(import.meta.dir, "..", "..", "plugin", "dist");
    const holding = readdirSync(dist)
      .filter((name) => name.endsWith(".js"))
      .filter((name) => readFileSync(join(dist, name), "utf8").includes(ACORN_ONLY))
      .sort();
    expect(holding).toEqual([]);
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
  const base = { version: "1.0.0", repository: "example-org/cc-smart-dev-kit" };

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
