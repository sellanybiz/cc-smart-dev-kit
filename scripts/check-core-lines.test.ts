/**
 * The general instructions' line budget. Every expected value is written by hand, and the
 * too-long fixture is built here, so this proves the check fails without touching the real
 * file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_LINES_MAX,
  CORE_LINES_WARN,
  CORE_MD,
  checkCoreLines,
  countLines,
} from "./check-core-lines";

/** A file of `lines` lines, ending with a newline as a written file does. */
function file(lines: number, trailingNewline = true): string {
  const text = Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join("\n");
  return trailingNewline ? `${text}\n` : text;
}

describe("check-core-lines", () => {
  test("a file inside the budget passes, saying its count", () => {
    expect(checkCoreLines(file(CORE_LINES_WARN))).toEqual({
      lines: 125,
      message: "plugin/instructions/core.md: 125 lines (warn above 125, fail above 135).",
      ok: true,
    });
  });

  test("over the warning line: one line, and it still passes", () => {
    const result = checkCoreLines(file(CORE_LINES_WARN + 1));
    expect(result.ok).toBe(true);
    expect(result.lines).toBe(126);
    expect(result.message).toBe(
      "plugin/instructions/core.md is 126 lines, over 125 and close to its 135-line budget. Trim it before it reaches the limit.",
    );
  });

  test("at the budget's last line it still passes; one line more fails", () => {
    expect(checkCoreLines(file(CORE_LINES_MAX)).ok).toBe(true);
    expect(checkCoreLines(file(CORE_LINES_MAX)).message).toBe(
      "plugin/instructions/core.md is 135 lines, over 125 and close to its 135-line budget. Trim it before it reaches the limit.",
    );
    expect(checkCoreLines(file(CORE_LINES_MAX + 1))).toEqual({
      lines: 136,
      message:
        "plugin/instructions/core.md is 136 lines, over its 135-line budget. It is loaded into every session on every machine: trim it, or move a section into a skill.",
      ok: false,
    });
  });

  test("a trailing newline ends the last line; it never adds one", () => {
    expect(countLines(file(3))).toBe(3);
    expect(countLines(file(3, false))).toBe(3);
    expect(countLines("")).toBe(0);
    expect(countLines("\n")).toBe(1);
    expect(countLines("one\n\n")).toBe(2);
  });

  test("the real file is inside its budget", () => {
    const text = readFileSync(join(import.meta.dir, "..", CORE_MD), "utf8");
    const result = checkCoreLines(text);
    // The count is not pinned (an edit inside the budget is fine); the failure is.
    expect(result.ok).toBe(true);
    expect(result.lines).toBeLessThanOrEqual(CORE_LINES_MAX);
    expect(result.message).toContain(`${CORE_MD}`);
  });
});
