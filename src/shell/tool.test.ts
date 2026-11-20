/**
 * The tool reader (`tool.ts`): the whole-word test of a rule's arguments. Every expected value
 * is written by hand. The reader's cases (`npx`, `bun x`, the package managers, `ruleMatches`)
 * are pinned in `src/jobs/classify.test.ts`, which uses it.
 */
import { describe, expect, test } from "bun:test";
import { argsHold } from "./tool";

describe("argsHold: the one whole-word test of a rule's sub and flags", () => {
  test("flags are whole words, a flag may carry =value", () => {
    expect(argsHold(["--prod"], { flags: ["--prod"] })).toBe(true);
    expect(argsHold(["--prod=1"], { flags: ["--prod"] })).toBe(true);
    expect(argsHold(["--production"], { flags: ["--prod"] })).toBe(false);
    expect(argsHold(["--prod"], { flags: ["--prod", "--yes"] })).toBe(false);
  });

  test("sub words are the first words that are no option, in order", () => {
    expect(argsHold(["--quiet", "deploy", "--x", "web"], { sub: ["deploy", "web"] })).toBe(true);
    expect(argsHold(["web", "deploy"], { sub: ["deploy", "web"] })).toBe(false);
    expect(argsHold(["status", "deploy"], { sub: ["deploy"] })).toBe(false);
    expect(argsHold(["--", "prod"], { sub: ["prod"] })).toBe(true);
  });

  test("a valued option's value is no sub word", () => {
    expect(argsHold(["--app", "web", "deploy"], { sub: ["deploy"] })).toBe(false);
    expect(argsHold(["--app", "web", "deploy"], { sub: ["deploy"], valued: ["--app"] })).toBe(true);
  });

  test("nothing required holds for any arguments", () => {
    expect(argsHold([], {})).toBe(true);
    expect(argsHold(["x"], {})).toBe(true);
  });
});
