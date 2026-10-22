/**
 * Text from outside made safe to print: every control and format character a space, and
 * a cut that never leaves half a character.
 * Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { cutText, oneLine, plainText } from "./plain-text";

/** An OSC 52 clipboard write, hidden text, a C1 control, a bidi override, a forged line. */
const NASTY = "\u001b]52;c;ZXZpbA==\u0007\u001b[8m\u009b2J\u202e\r\n\u200b\u00ad";

describe("plainText", () => {
  it("turns every control and format character into a space", () => {
    expect(plainText(`a${NASTY}b`)).toBe("a ]52;c;ZXZpbA==  [8m 2J     b");
    expect(plainText("tab\there\nnew line\u007f")).toBe("tab here new line ");
  });

  it("keepNewlines: `\\n` and `\\t` stay, `\\r` and every other control does not", () => {
    expect(plainText(`a${NASTY}b\tc\nd`, { keepNewlines: true })).toBe(
      "a ]52;c;ZXZpbA==  [8m 2J  \n  b\tc\nd",
    );
  });

  it("leaves other text alone: letters, accents, emoji, other scripts", () => {
    const text = "Café — naïve 😀 日本語 مرحبا";
    expect(plainText(text)).toBe(text);
    expect(plainText(text, { keepNewlines: true })).toBe(text);
  });
});

describe("cutText", () => {
  it("cuts to the length, one unit fewer when it would keep half of an emoji", () => {
    expect(cutText("abcdef", 3)).toBe("abc");
    expect(cutText("ab\u{1F600}cd", 3)).toBe("ab");
    expect(cutText("ab\u{1F600}cd", 4)).toBe("ab\u{1F600}");
    expect(cutText("short", 10)).toBe("short");
    expect(cutText("\u{1F600}", 1)).toBe("");
    expect(cutText("abc", 0)).toBe("");
  });
});

describe("oneLine", () => {
  it("one line: controls a space, runs of white space one space, ends trimmed, cut with the mark", () => {
    expect(oneLine(`  Title${NASTY}next  `, 100)).toBe("Title ]52;c;ZXZpbA== [8m 2J next");
    expect(oneLine("abcdef", 4, { mark: "…" })).toBe("abcd…");
    expect(oneLine("abcd", 4, { mark: "…" })).toBe("abcd");
    expect(oneLine("abc\u{1F600}", 4, { mark: "…" })).toBe("abc…");
  });

  it("ascii (the router's log line): everything outside printable ASCII is `?`, no mark", () => {
    expect(oneLine("bad\u001b[31m red\r\n reason é", 120, { ascii: true })).toBe(
      "bad?[31m red reason ?",
    );
    expect(oneLine("  abcdef  ", 3, { ascii: true })).toBe("abc");
  });
});
