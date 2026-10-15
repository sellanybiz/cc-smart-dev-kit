import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from ".";
import { parseRepository, readBuildInfo } from "./manifest";

describe("parseRepository", () => {
  test.each([
    ["https://github.com/example-org/cc-agentic", "example-org/cc-agentic"],
    ["https://github.com/example-org/cc-agentic.git", "example-org/cc-agentic"],
    ["https://git.example.com/example-org/cc-agentic/", "example-org/cc-agentic"],
    ["git@github.com:example-org/cc-agentic.git", "example-org/cc-agentic"],
    ["example-org/cc-agentic", "example-org/cc-agentic"],
  ])("%p gives %p", (url, expected) => {
    expect(parseRepository(url)).toBe(expected);
  });

  test.each(["", "cc-agentic", "https://github.com/only-owner", "https://host/a/b/c"])(
    "%p throws",
    (url) => {
      expect(() => parseRepository(url)).toThrow("Cannot read <owner>/<name>");
    },
  );
});

describe("the baked build info", () => {
  test("matches plugin.json, read now", () => {
    const manifest = join(import.meta.dir, "..", "..", "plugin", ".claude-plugin", "plugin.json");
    expect({ version: VERSION, repo: MARKETPLACE_SOURCE }).toEqual(readBuildInfo(manifest));
    expect(MARKETPLACE_SOURCE).toMatch(/^[^/\s]+\/[^/\s]+$/);
  });
});
