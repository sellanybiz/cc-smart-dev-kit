import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { marketplaceSource } from "./marketplace-access";

function known(content: unknown): string {
  const file = join(tempDir("known"), "known_marketplaces.json");
  writeFileSync(file, JSON.stringify(content));
  return file;
}

describe("marketplaceSource", () => {
  test("github: SSH first, then HTTPS", () => {
    const file = known({ mkt: { source: { source: "github", repo: "example-org/tools" } } });
    expect(marketplaceSource(file, "mkt", {})).toEqual({
      kind: "git",
      urls: ["git@github.com:example-org/tools.git", "https://github.com/example-org/tools.git"],
    });
  });

  test("github with CLAUDE_CODE_PLUGIN_PREFER_HTTPS: HTTPS first", () => {
    const file = known({ mkt: { source: { source: "github", repo: "example-org/tools" } } });
    expect(marketplaceSource(file, "mkt", { CLAUDE_CODE_PLUGIN_PREFER_HTTPS: "1" })).toEqual({
      kind: "git",
      urls: ["https://github.com/example-org/tools.git", "git@github.com:example-org/tools.git"],
    });
  });

  test("git: the URL as it is, on any host", () => {
    const file = known({
      mkt: { source: { source: "git", url: "ssh://git@git.example.com/team/tools.git" } },
    });
    expect(marketplaceSource(file, "mkt", {})).toEqual({
      kind: "git",
      urls: ["ssh://git@git.example.com/team/tools.git"],
    });
  });

  test("url and directory sources", () => {
    const file = known({
      web: { source: { source: "url", url: "https://example.com/marketplace.json" } },
      dir: { source: { source: "directory", path: "/opt/marketplace" } },
    });
    expect(marketplaceSource(file, "web", {})).toEqual({
      kind: "http",
      url: "https://example.com/marketplace.json",
    });
    expect(marketplaceSource(file, "dir", {})).toEqual({ kind: "local", path: "/opt/marketplace" });
  });

  test("an unknown source type is named", () => {
    const file = known({ mkt: { source: { source: "npm", package: "x" } } });
    expect(marketplaceSource(file, "mkt", {})).toEqual({ kind: "unknown", type: "npm" });
  });

  test("not in the file, or no file: missing", () => {
    expect(marketplaceSource(known({}), "mkt", {})).toEqual({ kind: "missing" });
    expect(marketplaceSource(join(tempDir("known"), "none.json"), "mkt", {})).toEqual({
      kind: "missing",
    });
  });
});
