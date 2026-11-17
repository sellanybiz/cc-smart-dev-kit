import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { readFrontmatterHeader, splitFrontmatter } from "./frontmatter";

test("splitFrontmatter returns the header and the body, with LF or CRLF lines", () => {
  expect(splitFrontmatter("---\na: 1\nb: 2\n---\nbody\n")).toEqual({
    header: "a: 1\nb: 2",
    body: "body\n",
  });
  expect(splitFrontmatter("---\r\na: 1\r\n---\r\nbody")).toEqual({ header: "a: 1", body: "body" });
  expect(splitFrontmatter("---\na: 1\n---")).toEqual({ header: "a: 1", body: "" });
});

test("splitFrontmatter gives null without both delimiters", () => {
  expect(splitFrontmatter("no front matter")).toBeNull();
  expect(splitFrontmatter("---\na: 1\n")).toBeNull();
  expect(splitFrontmatter(" ---\na: 1\n---\n")).toBeNull();
});

test("readFrontmatterHeader reads through the closing line and returns the header", () => {
  const dir = tempDir();
  const file = join(dir, "a.md");
  writeFileSync(file, "---\nname: é\r\nmodel: sonnet\n---\nbody that is never read\n");
  expect(readFrontmatterHeader(file)).toBe("name: é\nmodel: sonnet");
});

test("readFrontmatterHeader gives null when the file does not start with a delimiter or never closes", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "plain.md"), "# title\n");
  writeFileSync(join(dir, "open.md"), "---\nname: x\n");
  expect(readFrontmatterHeader(join(dir, "plain.md"))).toBeNull();
  expect(readFrontmatterHeader(join(dir, "open.md"))).toBeNull();
});

test("readFrontmatterHeader accepts a closing line with no newline after it", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "end.md"), "---\nname: x\n---");
  expect(readFrontmatterHeader(join(dir, "end.md"))).toBe("name: x");
});
