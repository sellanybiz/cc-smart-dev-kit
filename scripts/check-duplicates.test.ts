import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../src/testing/temp";
import {
  findDuplicates,
  normalize,
  readAllowList,
  readSourceFiles,
  report,
  scriptStrings,
  sentences,
} from "./check-duplicates";

const SCRIPT = join(import.meta.dir, "check-duplicates.ts");
const RULE = "Never start a second reviewer to check the fixes after the first one returned.";

function write(root: string, file: string, content: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

/** A small plugin tree with no duplicate. */
function cleanTree(): string {
  const root = tempDir("duplicates");
  write(root, "plugin/instructions/core.md", `# Core\n\n${RULE} The rest is short.\n`);
  write(root, "plugin/skills/review/SKILL.md", "# Review\n\nRead the whole diff, then fix it.\n");
  write(root, "plugin/agents/reviewer.md", "You are the reviewer. One round only.\n");
  return root;
}

describe("normalize and sentences", () => {
  test("lower case, markdown marks gone, whitespace collapsed", () => {
    expect(normalize("**Never** start a `second`   reviewer.")).toBe(
      "never start a second reviewer",
    );
  });

  test("a trailing . ! or ? does not make two sentences different", () => {
    expect(normalize("Never start a second reviewer.")).toBe("never start a second reviewer");
    expect(normalize("Never start a second reviewer!")).toBe("never start a second reviewer");
    expect(normalize("Never start a second reviewer?")).toBe("never start a second reviewer");
    expect(normalize("Never start a second reviewer")).toBe("never start a second reviewer");
  });

  test("a dash or a colon between words counts as one space; a hyphen inside a word stays", () => {
    const expected = "one round only the author's own pass checks the fixes";
    expect(normalize("One round only — the author's own pass checks the fixes.")).toBe(expected);
    expect(normalize("One round only – the author's own pass checks the fixes.")).toBe(expected);
    expect(normalize("One round only - the author's own pass checks the fixes.")).toBe(expected);
    expect(normalize("One round only: the author's own pass checks the fixes.")).toBe(expected);
    expect(normalize("A read-only agent.")).toBe("a read-only agent");
  });

  test("consecutive quote lines are one block; a blank quote line or plain text ends it", () => {
    const text = [
      "Before the quote.",
      "> A quoted rule that goes",
      "> on over a second line.",
      ">",
      "> A second paragraph.",
      "After the quote.",
    ].join("\n");
    expect(sentences(text)).toEqual([
      "Before the quote.",
      "A quoted rule that goes on over a second line.",
      "A second paragraph.",
      "After the quote.",
    ]);
  });

  test("splits on sentence ends, list items and table cells; skips code blocks", () => {
    const text = [
      "One sentence here. Another one",
      "goes on here.",
      "- a list item",
      "| a cell | another cell |",
      "```",
      "code that is not a sentence.",
      "```",
    ].join("\n");
    expect(sentences(text)).toEqual([
      "One sentence here.",
      "Another one goes on here.",
      "a list item",
      "| a cell",
      "another cell |",
    ]);
  });
});

describe("findDuplicates", () => {
  test("a clean tree passes", () => {
    const root = cleanTree();
    const result = findDuplicates(readSourceFiles(root), []);
    expect(result).toEqual({ duplicates: [], stale: [] });
    expect(report(result)).toEqual([]);
  });

  test("a planted duplicate in another file fails, even with other markdown around it", () => {
    const root = cleanTree();
    write(root, "plugin/skills/commit/SKILL.md", `# Commit\n\n- **${RULE}**\n`);
    const result = findDuplicates(readSourceFiles(root), []);
    expect(result.duplicates).toEqual([
      {
        sentence: normalize(RULE),
        files: ["plugin/instructions/core.md", "plugin/skills/commit/SKILL.md"],
      },
    ]);
    expect(report(result)[0]).toBe(
      `The same sentence in plugin/instructions/core.md and plugin/skills/commit/SKILL.md:\n  "${normalize(RULE)}"`,
    );
  });

  test("the same rule with another end mark, a colon for a dash, or split over quote lines fails", () => {
    const root = cleanTree();
    write(
      root,
      "plugin/skills/commit/SKILL.md",
      "> Never start a second reviewer to check the fixes:\n> after the first one returned!\n",
    );
    write(
      root,
      "plugin/agents/reviewer.md",
      "Never start a second reviewer to check the fixes — after the first one returned\n",
    );
    const result = findDuplicates(readSourceFiles(root), []);
    expect(result.duplicates).toEqual([
      {
        sentence: "never start a second reviewer to check the fixes after the first one returned",
        files: [
          "plugin/agents/reviewer.md",
          "plugin/instructions/core.md",
          "plugin/skills/commit/SKILL.md",
        ],
      },
    ]);
  });

  test("the same sentence twice in one file, a short sentence, or a code block is not flagged", () => {
    const root = cleanTree();
    write(root, "plugin/instructions/core.md", `${RULE}\n\n${RULE}\n`);
    write(root, "plugin/agents/reviewer.md", "You are the reviewer. One round only.\n");
    write(root, "plugin/skills/a/SKILL.md", "You are the reviewer. One round only.\n");
    write(root, "plugin/skills/b/SKILL.md", `\`\`\`\n${RULE}\n\`\`\`\n`);
    expect(findDuplicates(readSourceFiles(root), []).duplicates).toEqual([]);
  });

  test("an allow-listed sentence passes; an allow-list entry with no duplicate is stale", () => {
    const root = cleanTree();
    write(root, "plugin/output-styles/style.md", `${RULE}\n`);
    const allow = [{ sentence: RULE, reason: "on purpose" }];
    expect(findDuplicates(readSourceFiles(root), allow)).toEqual({ duplicates: [], stale: [] });

    const stale = [
      { sentence: "A line that is nowhere at all in any of the files here.", reason: "x" },
    ];
    const result = findDuplicates(readSourceFiles(root), stale);
    expect(result.stale).toEqual([normalize(stale[0]?.sentence ?? "")]);
    expect(report(result)).toHaveLength(2);
  });

  test("files outside the checked folders are not read", () => {
    const root = cleanTree();
    write(root, "docs/design.md", `${RULE}\n`);
    write(root, "plugin/skills/review/notes.txt", `${RULE}\n`);
    expect(findDuplicates(readSourceFiles(root), []).duplicates).toEqual([]);
  });

  test("a workflow script's prompts are read as rules: a sentence said in one and in a skill fails", () => {
    const root = cleanTree();
    write(
      root,
      "plugin/workflows/audit-run.js",
      [
        "export const meta = { name: 'audit-run', description: 'x' }",
        `const note = '${RULE}'`,
        "// a comment is not read: Never start a second reviewer to check the fixes after the first one returned.",
      ].join("\n"),
    );
    const result = findDuplicates(readSourceFiles(root), []);
    expect(result.duplicates).toEqual([
      {
        sentence: normalize(RULE),
        files: ["plugin/instructions/core.md", "plugin/workflows/audit-run.js"],
      },
    ]);
  });

  test("scriptStrings reads the literals, escapes and all, and skips comments", () => {
    // `${dollar}` keeps the fixture free of a literal `${`: the text under test has one, and
    // Biome refuses that inside a string.
    const dollar = "$";
    expect(
      scriptStrings(
        `const a = 'one'; // 'two'\nconst b = \`three ${dollar}{x} four\`\n/* 'five' */`,
      ),
    ).toBe(`one\n\nthree ${dollar}{x} four`);
  });
});

describe("readAllowList", () => {
  test("an entry without a reason is refused", () => {
    const root = cleanTree();
    write(
      root,
      "scripts/check-duplicates.allow.json",
      JSON.stringify({ allowed: [{ sentence: RULE, reason: " " }] }),
    );
    expect(() => readAllowList(root)).toThrow("expected");
  });
});

describe("the script", () => {
  test("passes on this repo's own plugin tree", () => {
    const result = Bun.spawnSync(["bun", SCRIPT], { stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
