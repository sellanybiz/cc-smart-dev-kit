/**
 * The general instructions' line budget: `plugin/instructions/core.md` fails this check
 * past 135 lines, and warns once above 125.
 *
 * That file is loaded into every Claude Code session on every machine that has the plugin,
 * so its size is paid on every turn, by everyone. The budget is a line count, because a
 * line is one rule a reader keeps in mind. Over the limit, trim it — or move a part into a
 * skill, which loads only when it is used (`plugin/skills/`, `docs/design.md` §
 * Instructions, skills and agents).
 *
 * The warning line is the file's size after its last trim (1.1.0: 190 lines down to 125),
 * so the next rule that adds lines warns, and the fail line leaves ten lines of room.
 *
 *   bun scripts/check-core-lines.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CORE_MD = "plugin/instructions/core.md";
/** Over this, the check fails. */
export const CORE_LINES_MAX = 135;
/** Above this, the check warns and still passes. */
export const CORE_LINES_WARN = 125;

export interface CoreLinesResult {
  /** The lines the file holds. */
  lines: number;
  /** One line, for the passing, the warning and the failing case alike. */
  message: string;
  ok: boolean;
}

/**
 * The lines a reader counts: an empty file has none, and a trailing newline ends the last
 * line rather than adding one.
 */
export function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

export function checkCoreLines(text: string): CoreLinesResult {
  const lines = countLines(text);
  if (lines > CORE_LINES_MAX) {
    return {
      lines,
      message:
        `${CORE_MD} is ${lines} lines, over its ${CORE_LINES_MAX}-line budget. ` +
        "It is loaded into every session on every machine: trim it, or move a section into a skill.",
      ok: false,
    };
  }
  if (lines > CORE_LINES_WARN) {
    return {
      lines,
      message:
        `${CORE_MD} is ${lines} lines, over ${CORE_LINES_WARN} and close to its ` +
        `${CORE_LINES_MAX}-line budget. Trim it before it reaches the limit.`,
      ok: true,
    };
  }
  return {
    lines,
    message: `${CORE_MD}: ${lines} lines (warn above ${CORE_LINES_WARN}, fail above ${CORE_LINES_MAX}).`,
    ok: true,
  };
}

if (import.meta.main) {
  const file = join(import.meta.dir, "..", CORE_MD);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(
      `Cannot read ${CORE_MD}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const result = checkCoreLines(text);
  if (result.ok) console.log(result.message);
  else {
    console.error(result.message);
    process.exitCode = 1;
  }
}
