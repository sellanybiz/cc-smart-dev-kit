/**
 * The eval harness's loader: the parts join back to the exact text, each fits under Claude
 * Code's 10,000-character cap on one hook's output, and today's instructions fit in the
 * hooks `evals/harness/hooks/hooks.json` has. Expected values are written by hand.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildParts,
  HARNESS_ERROR,
  HOOK_PARTS,
  PART_LIMIT,
  partOutput,
  readSources,
  splitText,
} from "./load-instructions";

const INSTRUCTIONS = join(import.meta.dir, "..", "..", "plugin", "instructions");
/** Claude Code's cap on one hook's output (code.claude.com/docs/en/hooks). */
const CLAUDE_CODE_CAP = 10_000;

describe("load-instructions", () => {
  test("splits at ## headings, and the pieces join back to the same text", () => {
    const text = "# Title\n\nintro\n## One\naaaa\n## Two\nbbbb\n";
    expect(splitText(text, 20)).toEqual(["# Title\n\nintro\n", "## One\naaaa\n", "## Two\nbbbb\n"]);
    expect(splitText(text, 1_000)).toEqual([text]);
  });

  test("a section over the limit splits at blank lines, then at the limit itself", () => {
    const section = `## Long\n${"x".repeat(30)}\n\n${"y".repeat(12)}\n`;
    const pieces = splitText(section, 20);
    expect(pieces.join("")).toBe(section);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(20);
  });

  test("a part names its file, and its number only when the file has several", () => {
    expect(buildParts([{ label: "a.md (notes)", text: "short\n" }])).toEqual([
      "Contents of a.md (notes):\n\nshort\n",
    ]);
    const long = `## A\n${"a".repeat(6_000)}\n## B\n${"b".repeat(6_000)}\n`;
    const parts = buildParts([{ label: "b.md", text: long }]);
    expect(parts.length).toBe(2);
    expect(parts[0]?.startsWith("Contents of b.md, part 1 of 2:\n\n## A\n")).toBe(true);
    expect(parts[1]?.startsWith("Contents of b.md, part 2 of 2:\n\n## B\n")).toBe(true);
  });

  test("past the last part a hook prints nothing; too many parts is an error Claude sees", () => {
    expect(partOutput(["one", "two"], 2)).toBe("two");
    expect(partOutput(["one", "two"], 3)).toBe("");
    const many = Array.from({ length: HOOK_PARTS + 1 }, (_, index) => `part ${index + 1}`);
    expect(partOutput(many, HOOK_PARTS)).toBe(
      `${HARNESS_ERROR}: the instructions need 5 parts, and only 4 hooks print them. Add hooks to evals/harness/hooks/hooks.json.`,
    );
  });

  test("an opt-in name that is not a file in optin/ is refused", () => {
    expect(() => readSources("no-such-file", INSTRUCTIONS)).toThrow(
      'EVAL_KIT_OPTIN names "no-such-file", which is not a file in optin/',
    );
    expect(() => readSources("../core", INSTRUCTIONS)).toThrow('names "../core"');
  });

  test("today's core.md and every opt-in fit in the hooks there are, each under the cap", () => {
    const optIns = readdirSync(join(INSTRUCTIONS, "optin"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3));
    const sources = readSources(optIns.join(","), INSTRUCTIONS);
    const parts = buildParts(sources);
    expect(parts.length).toBeLessThanOrEqual(HOOK_PARTS);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(PART_LIMIT);
    expect(PART_LIMIT).toBeLessThan(CLAUDE_CODE_CAP);
    // Nothing is lost: with the headers taken off, the parts are core.md exactly.
    const core = readFileSync(join(INSTRUCTIONS, "core.md"), "utf8");
    const coreParts = parts.filter((part) => part.includes("instructions/core.md"));
    expect(coreParts.map((part) => part.slice(part.indexOf(":\n\n") + 3)).join("")).toBe(core);
  });
});
