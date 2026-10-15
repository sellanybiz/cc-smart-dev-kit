import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { applyManagedMarkdown, removeManagedMarkdown } from "./managed-markdown";
import { listBackups } from "./write";

function setup(content: string | null) {
  const dir = tempDir("md");
  const file = join(dir, "CLAUDE.md");
  if (content !== null) writeFileSync(file, content);
  return { file, stateDir: join(dir, "state") };
}

const read = (file: string) => readFileSync(file, "utf8");

describe("applyManagedMarkdown", () => {
  test("appends the block at the end, after a blank line", () => {
    const { file, stateDir } = setup("# My notes\n\nKeep this.\n");
    expect(applyManagedMarkdown({ file, stateDir, body: "@~/.claude/cc/general.md" }).outcome).toBe(
      "updated",
    );
    expect(read(file)).toBe(
      "# My notes\n\nKeep this.\n\n<!-- cc-agentic:begin -->\n@~/.claude/cc/general.md\n<!-- cc-agentic:end -->\n",
    );
  });

  test("appends to a file without a final newline", () => {
    const { file, stateDir } = setup("no newline");
    applyManagedMarkdown({ file, stateDir, body: "x" });
    expect(read(file)).toBe(
      "no newline\n\n<!-- cc-agentic:begin -->\nx\n<!-- cc-agentic:end -->\n",
    );
  });

  test("creates a missing file with only the block", () => {
    const { file, stateDir } = setup(null);
    expect(applyManagedMarkdown({ file, stateDir, body: "x" }).outcome).toBe("created");
    expect(read(file)).toBe("<!-- cc-agentic:begin -->\nx\n<!-- cc-agentic:end -->\n");
  });

  test("replaces the block in place and keeps the text before and after it", () => {
    const { file, stateDir } = setup(
      "Before.\n\n<!-- cc-agentic:begin -->\nold line 1\nold line 2\n<!-- cc-agentic:end -->\n\nAfter, written by the user.\n",
    );
    applyManagedMarkdown({ file, stateDir, body: "new" });
    expect(read(file)).toBe(
      "Before.\n\n<!-- cc-agentic:begin -->\nnew\n<!-- cc-agentic:end -->\n\nAfter, written by the user.\n",
    );
  });

  test("the same block again writes nothing: no backup, same mtime", () => {
    const { file, stateDir } = setup("Text.\n");
    applyManagedMarkdown({ file, stateDir, body: "x" });
    const mtime = statSync(file).mtimeMs;
    expect(applyManagedMarkdown({ file, stateDir, body: "x" }).outcome).toBe("unchanged");
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(listBackups(file)).toHaveLength(1);
  });

  test("a broken block (begin without end) throws and writes nothing", () => {
    const text = "Text.\n<!-- cc-agentic:begin -->\nhalf\n";
    const { file, stateDir } = setup(text);
    expect(() => applyManagedMarkdown({ file, stateDir, body: "x" })).toThrow(
      "broken cc-agentic block",
    );
    expect(read(file)).toBe(text);
  });

  test("a write by another program between our read and our write is kept", () => {
    const { file, stateDir } = setup("Original.\n");
    let calls = 0;
    // The first write attempt finds the file changed; the second one succeeds.
    const result = applyManagedMarkdown({
      file,
      stateDir,
      body: "x",
      onBeforeWrite: () => {
        calls += 1;
        if (calls === 1) writeFileSync(file, "Original.\nAdded by someone else.\n");
      },
    });
    expect(calls).toBe(2);
    expect(result.outcome).toBe("updated");
    expect(read(file)).toBe(
      "Original.\nAdded by someone else.\n\n<!-- cc-agentic:begin -->\nx\n<!-- cc-agentic:end -->\n",
    );
  });
});

describe("removeManagedMarkdown", () => {
  const BLOCK = "<!-- cc-agentic:begin -->\nx\n<!-- cc-agentic:end -->";

  test.each([
    ["at the end, after a blank line", `# Notes\n\nKeep.\n\n${BLOCK}\n`, "# Notes\n\nKeep.\n"],
    ["in the middle", `Before.\n\n${BLOCK}\n\nAfter.\n`, "Before.\n\nAfter.\n"],
    ["between two lines", `A\n${BLOCK}\nB\n`, "A\nB\n"],
    ["at the start", `${BLOCK}\n\nText.\n`, "Text.\n"],
    ["alone in the file", `${BLOCK}\n`, ""],
  ])("removes a block %s and keeps the text around it", (_where, before, after) => {
    const { file, stateDir } = setup(before);
    expect(removeManagedMarkdown({ file, stateDir }).outcome).toBe("updated");
    expect(read(file)).toBe(after);
  });

  test("no block: nothing is written", () => {
    const { file, stateDir } = setup("Just text.\n");
    expect(removeManagedMarkdown({ file, stateDir })).toEqual({
      outcome: "unchanged",
      backup: null,
    });
    expect(listBackups(file)).toHaveLength(0);
  });

  test("a missing file stays missing", () => {
    const { file, stateDir } = setup(null);
    expect(removeManagedMarkdown({ file, stateDir }).outcome).toBe("unchanged");
    expect(existsSync(file)).toBe(false);
  });
});
