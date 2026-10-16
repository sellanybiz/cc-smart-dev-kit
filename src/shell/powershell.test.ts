/**
 * The PowerShell single-quoted literal (`powershell.ts`): the five characters PowerShell
 * reads as a quote, each doubled, and a line break refused.
 *
 * Where the rule and the five characters come from: `about_Quoting_Rules` § Including quote
 * characters in a string ("PowerShell interprets smart quotation marks … as normal quotation
 * marks", with `'…‘‘smart…’’…'` as the example), and the tokenizer's own `SpecialChars` list
 * in the PowerShell source (`CharTraits.cs`: `QuoteSingleLeft` 0x2018, `QuoteSingleRight`
 * 0x2019, `QuoteSingleBase` 0x201a, `QuoteReversed` 0x201b).
 */
import { describe, expect, test } from "bun:test";
import { powershellLiteral } from "./powershell";

describe("powershellLiteral", () => {
  test("plain text is wrapped, and nothing inside needs an escape", () => {
    expect(powershellLiteral("plain")).toBe("'plain'");
    expect(powershellLiteral("")).toBe("''");
    // `$`, a backtick, a double quote and a backslash: all literal in single quotes.
    expect(powershellLiteral('$x `y` "z" \\n')).toBe("'$x `y` \"z\" \\n'");
  });

  test("every character PowerShell reads as a quote is doubled with itself", () => {
    expect(powershellLiteral("don't")).toBe("'don''t'");
    expect(powershellLiteral("''")).toBe("''''''");
    expect(powershellLiteral("O’Brien")).toBe("'O’’Brien'");
    expect(powershellLiteral("‘a’ ‚b‛")).toBe("'‘‘a’’ ‚‚b‛‛'");
  });

  test("a path with a smart quote in it stays one string", () => {
    expect(powershellLiteral("C:\\Users\\O’Brien\\bun.exe")).toBe("'C:\\Users\\O’’Brien\\bun.exe'");
  });

  test("a line break is refused: the literal travels on a command line", () => {
    expect(() => powershellLiteral("a\nb")).toThrow(/cannot put "a\\nb" in a PowerShell command/);
    expect(() => powershellLiteral("a\rb")).toThrow(/cannot put/);
    expect(powershellLiteral("a b")).toBe("'a b'");
  });
});
