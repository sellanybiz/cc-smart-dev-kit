/**
 * The one script lexer (`script-lexer.ts`): which `/` is a division and which starts a regular
 * expression, nested templates, and the texts it refuses to read.
 */
import { describe, expect, it } from "bun:test";
import { lexScript } from "./script-lexer";

/** The units the lexer skips, as their text, in order. */
function units(text: string): string[] {
  const lexed = lexScript(text);
  if (!lexed.ok) throw new Error(`not read: ${lexed.why}`);
  return [...lexed.lex.ends.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, to]) => text.slice(from, to));
}

/** The text the lexer marks as code, with every other character as `_`. */
function codeOf(text: string): string {
  const lexed = lexScript(text);
  if (!lexed.ok) throw new Error(`not read: ${lexed.why}`);
  return [...text].map((char, index) => (lexed.lex.code[index] === 1 ? char : "_")).join("");
}

describe("the script lexer", () => {
  it("a `/` where an expression starts is a regular expression, with its class and flags", () => {
    expect(units(`s.replace(/"/g, "'")`)).toEqual(['/"/g', `"'"`]);
    expect(units('x = /[/"]+/u;')).toEqual(['/[/"]+/u']);
    expect(units("if (ok) /'/.test(s)")).toEqual(["/'/"]);
    expect(units("if (ok) { go(); } /'/.test(s)")).toEqual(["/'/"]);
    expect(units("return /a\\/b/;")).toEqual(["/a\\/b/"]);
    expect(units("const f = () => /'/;")).toEqual(["/'/"]);
    expect(units("/'/.test(s)")).toEqual(["/'/"]);
  });

  it("a `/` after a value is a division", () => {
    expect(units("a / b / 2")).toEqual([]);
    expect(units("f(x) / 2 + a[i] / 3")).toEqual([]);
    expect(units("const n = ({}).size / 2; n /= 2; const o = { a: 1 } / 2;")).toEqual([]);
    expect(units("1 / 2 / 3")).toEqual([]);
    expect(units("this / that")).toEqual([]);
  });

  it("strings, comments and templates; a template's placeholder is code, to any depth", () => {
    expect(units('a = "x\\"y"; // c\n/* d */ b')).toEqual(['"x\\"y"', "// c", "/* d */"]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture nests templates.
    const nested = 'a = `p ${ `"` + agent } q`; b';
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected unit is a template's text.
    expect(units(nested)).toEqual(['`p ${ `"` + agent } q`', '`"`']);
    // `` `p ${`` and `` } q` `` are the template's text; ` ` + agent ` ` is code.
    expect(codeOf(nested)).toBe("a = _____ ___ + agent ____; b");
  });

  it("refuses what does not close, never guessing", () => {
    for (const [text, why] of [
      ['x = (/"\n);', "a `/` that starts a regular expression, which does not close on its line"],
      ["x = /a\\\nb/;", "a `/` that starts a regular expression, which does not close on its line"],
      ['x = "open\n";', "a string that does not close on its line"],
      ["/* open", "a block comment that never closes"],
      ["x = `open", "a template that never closes"],
      ["x = `a ${ b", "a template's `${` that never closes"],
    ] as const) {
      const lexed = lexScript(text);
      expect(lexed.ok).toBe(false);
      if (!lexed.ok) expect(lexed.why).toBe(why);
    }
  });
});
