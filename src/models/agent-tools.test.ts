/**
 * The plugin's agents inherit every tool of the session, its MCP servers' tools too, and deny only
 * what their role forbids (`docs/design/instructions.md` § Instructions, skills and agents). A
 * fixed `tools:` list would cut a project's own servers out of every agent again.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS = join(import.meta.dir, "..", "..", "plugin", "agents");

const READ_ONLY = ["Edit", "Write", "NotebookEdit", "AskUserQuestion"];

/** Each agent's deny list, written by hand; null when the agent denies nothing. */
const DENIED: Record<string, null | string[]> = {
  auditor: READ_ONLY,
  // A builder builds its one phase: it never asks the person and never starts agents (2.0).
  builder: ["AskUserQuestion", "Agent"],
  // Generates the scenarios that can break a plan or a change; it never fixes one.
  "edge-case-hunter": READ_ONLY,
  // Answers one research question from current sources; it reports and changes nothing (2.2.0).
  researcher: READ_ONLY,
  "rules-maintainer": ["AskUserQuestion"],
  // Every tool, always (the owner, 2.2.0): it reviews, and a consult may fix or build. Its text
  // keeps a review's findings ahead of any fix.
  "senior-engineer": null,
  "ui-verifier": READ_ONLY,
};

/** The frontmatter's lines, between the first two `---` lines. */
function frontmatter(file: string): string[] {
  const lines = readFileSync(join(AGENTS, file), "utf8").replaceAll("\r\n", "\n").split("\n");
  return lines.slice(1, lines.indexOf("---", 1));
}

/** The items of one list key (`key:` then `  - item` lines); null when the key is not there. */
function listOf(lines: string[], key: string): null | string[] {
  const start = lines.indexOf(`${key}:`);
  if (start === -1) return null;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  - ")) break;
    items.push(line.slice(4));
  }
  return items;
}

describe("the plugin's agents: the session's tools, less what the role forbids", () => {
  test("every agent file is one this test knows", () => {
    const names = readdirSync(AGENTS)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .sort();
    expect(names).toEqual(Object.keys(DENIED).sort());
  });

  for (const [name, denied] of Object.entries(DENIED)) {
    test(`${name}: no tools list, and its deny list`, () => {
      const lines = frontmatter(`${name}.md`);
      expect(lines.some((line) => line.startsWith("tools:"))).toBe(false);
      expect(listOf(lines, "disallowedTools")).toEqual(denied);
    });
  }
});
