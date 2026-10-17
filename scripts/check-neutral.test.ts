import { describe, expect, test } from "bun:test";
import { neutralHits } from "./check-neutral";

/** A neutral stand-in for a forbidden name: the checks only ever see the words they are given. */
const WORDS = ["example-org"];

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, order: "be" | "le", bom: boolean): Uint8Array {
  const units = [...(bom ? [0xfeff] : []), ...[...text].map((ch) => ch.charCodeAt(0))];
  const bytes = new Uint8Array(units.length * 2);
  units.forEach((unit, index) => {
    const high = unit >> 8;
    const low = unit & 0xff;
    bytes[index * 2] = order === "le" ? low : high;
    bytes[index * 2 + 1] = order === "le" ? high : low;
  });
  return bytes;
}

describe("check:neutral", () => {
  test("a name in the text, any case, with its line", () => {
    expect(neutralHits("docs/a.md", utf8("one\nby Example-Org\n"), WORDS)).toEqual([
      'docs/a.md:2: names "example-org"',
    ]);
    expect(neutralHits("docs/a.md", utf8("nothing here\n"), WORDS)).toEqual([]);
  });

  test("ST-11: a name in a file's path is a hit too", () => {
    expect(neutralHits("docs/example-org/notes.md", utf8("clean\n"), WORDS)).toEqual([
      'docs/example-org/notes.md: its path names "example-org"',
    ]);
    expect(neutralHits("fixtures/Example-Org.json", utf8("{}\n"), WORDS)).toEqual([
      'fixtures/Example-Org.json: its path names "example-org"',
    ]);
  });

  test.each([
    ["UTF-16 LE with a BOM", utf16("first\nmade by example-org\n", "le", true)],
    ["UTF-16 BE with a BOM", utf16("first\nmade by example-org\n", "be", true)],
    ["UTF-16 LE without a BOM", utf16("first\nmade by example-org\n", "le", false)],
    ["UTF-16 BE without a BOM", utf16("first\nmade by example-org\n", "be", false)],
  ])("ST-11: a file with NUL bytes is read, not skipped: %s", (_, bytes) => {
    expect(neutralHits("scripts/notes.txt", bytes, WORDS)).toEqual([
      'scripts/notes.txt:2: names "example-org"',
    ]);
  });

  test("ST-11: a binary file is searched as bytes, and a clean one has no hit", () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, ...utf8("tEXtexample-org"), 0, 1]);
    expect(neutralHits("assets/a.png", binary, WORDS)).toEqual([
      'assets/a.png:1: names "example-org"',
    ]);
    expect(neutralHits("assets/b.png", new Uint8Array([0x89, 0, 0x50, 0, 1, 2]), WORDS)).toEqual(
      [],
    );
  });
});
