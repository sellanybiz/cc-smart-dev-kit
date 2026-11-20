/**
 * The runner's fakes must behave as Claude Code does, or a script passes its tests and fails in a
 * real run. `pipeline` is the one that did: Claude Code calls each stage as
 * `stage(prevResult, originalItem, index)` (docs/claude-code-contract.md, the workflow-script row).
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { runScript } from "./script-runner";

function scriptFile(body: string): string {
  const file = join(tempDir("script-runner"), "probe.js");
  writeFileSync(file, `export const meta = { name: 'probe', description: 'a probe' }\n${body}`);
  return file;
}

describe("the runner's pipeline fake", () => {
  test("calls each stage as (prevResult, originalItem, index), the first with prev = item", async () => {
    const file = scriptFile(`
      return await pipeline(['a', 'b'],
        (prev, item, index) => ({ first: [prev, item, index] }),
        (prev, item, index) => ({ ...prev, second: [prev.first[0], item, index] }),
      )
    `);
    const { result } = await runScript(file);
    expect(result).toEqual([
      { first: ["a", "a", 0], second: ["a", "a", 0] },
      { first: ["b", "b", 1], second: ["b", "b", 1] },
    ]);
  });

  test("a later stage gets the answer of the stage before it, awaited", async () => {
    const file = scriptFile(`
      return await pipeline([1, 2],
        async (prev) => prev * 10,
        (prev) => prev + 1,
      )
    `);
    const { result } = await runScript(file);
    expect(result).toEqual([11, 21]);
  });

  test("the second argument is the item, never the index", async () => {
    const file = scriptFile("return await pipeline(['x'], (prev, second) => typeof second)");
    const { result } = await runScript(file);
    expect(result).toEqual(["string"]);
  });
});
