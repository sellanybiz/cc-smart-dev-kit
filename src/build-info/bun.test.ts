import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bunTooOld, MIN_BUN } from "./bun";

const ROOT = join(import.meta.dir, "..", "..");

describe("bunTooOld", () => {
  test.each([
    ["1.4.2", "anymodel needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun)."],
    ["1.3.14", "anymodel needs Bun ≥ 1.4.3; this is 1.3.14 (/opt/bun/bin/bun)."],
    // A pre-release of 1.4.3 may be older than the fix.
    ["1.4.3-canary.1", "anymodel needs Bun ≥ 1.4.3; this is 1.4.3-canary.1 (/opt/bun/bin/bun)."],
  ])("%p is too old", (version, message) => {
    expect(bunTooOld(version, "/opt/bun/bin/bun")).toBe(message);
  });

  test.each(["1.4.3", "1.4.4", "1.5.0", "2.0.0", "1.4.4-canary.2"])(
    "%p is new enough",
    (version) => {
      expect(bunTooOld(version, "/opt/bun/bin/bun")).toBeNull();
    },
  );
});

describe("the one number", () => {
  test("is 1.4.3, the first Bun whose fetch honours `proxy: false`", () => {
    // Written by hand: raise it only for a new fix anymodel needs, and say which.
    expect(MIN_BUN).toBe("1.4.3");
  });

  test("package.json `engines.bun` asks for it", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      engines?: { bun?: string };
    };
    expect(manifest.engines?.bun).toBe(`>=${MIN_BUN}`);
  });

  test.each(["ci.yml", "claude-code-latest.yml"])("CI's %s runs it", (file) => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", file), "utf8");
    expect(workflow.match(/^\s*bun-version:.*$/gm)).toEqual([`          bun-version: ${MIN_BUN}`]);
  });
});
