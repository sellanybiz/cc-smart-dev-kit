import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TASK_TOOL } from "./words";

/**
 * Every module of `src/tasks` and `src/herdr` (tests left out) whose code types a task tool's
 * name instead of building it from `TASK_TOOL`, as `<file>: <name>`. Read from Bun's own
 * transpile of each file, which has no comments: a name left in it is in a string or a template.
 */
function bareToolNames(): string[] {
  const src = join(import.meta.dir, "..");
  const names = Object.values(TASK_TOOL).map((name) => ({
    name,
    word: new RegExp(`\\b${name}\\b`),
  }));
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const found: string[] = [];
  for (const folder of ["tasks", "herdr"]) {
    for (const file of new Bun.Glob("**/*.ts").scanSync(join(src, folder))) {
      const path = `${folder}/${file}`;
      if (file.endsWith(".test.ts") || path === "tasks/words.ts") continue;
      const code = transpiler.transformSync(readFileSync(join(src, path), "utf8"));
      for (const { name, word } of names) if (word.test(code)) found.push(`${path}: ${name}`);
    }
  }
  return found;
}

test("tasks and herdr build every task tool name from TASK_TOOL", () => {
  expect(bareToolNames()).toEqual([]);
});
