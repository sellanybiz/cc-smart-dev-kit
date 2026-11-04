import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isObject } from "../setup/managed-json";

const PLUGIN = join(import.meta.dir, "..", "..", "plugin");

test("every skill and agent has valid YAML frontmatter with a name and description", () => {
  const files = [
    ...new Bun.Glob("skills/*/SKILL.md").scanSync(PLUGIN),
    ...new Bun.Glob("agents/*.md").scanSync(PLUGIN),
  ].sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const text = readFileSync(join(PLUGIN, file), "utf8").replaceAll("\r\n", "\n");
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    expect(match, `${file}: frontmatter delimiters`).not.toBeNull();
    const data = Bun.YAML.parse(match?.[1] ?? "");
    if (!isObject(data)) throw new Error(`${file}: frontmatter must be an object`);
    for (const key of ["name", "description"]) {
      const value = data[key];
      expect(typeof value, `${file}: ${key}`).toBe("string");
      expect(typeof value === "string" && value.trim().length > 0, `${file}: ${key}`).toBe(true);
    }
  }
});
