/**
 * Text as PowerShell reads it: the one home for the single-quoted literal the Windows toast
 * (`src/hooks/windows-toast.ts`) and the router's Scheduled Task
 * (`src/gateway/service-windows.ts`) put a path or a name into.
 *
 * PowerShell's tokenizer reads **five** characters as a single quote: `'`, and the four
 * "smart" ones — U+2018, U+2019, U+201A and U+201B (single quotation marks, left, right,
 * low-9 and high-reversed-9). Doubling the character is what makes it literal, exactly as
 * `''` does for `'`: `about_Quoting_Rules` § Including quote characters in a string says
 * "PowerShell interprets smart quotation marks … as normal quotation marks", and shows
 * `'…‘‘smart…’’…'` for the smart ones. The tokenizer's own list is `SpecialChars`
 * (`CharTraits.cs` in the PowerShell source).
 *
 * Doubling only `'` — which both copies of this used to do — is the hole: a folder like
 * `C:\Users\O’Brien` ends the string early, and what follows is read as code rather than as
 * part of the path, so the command fails or runs something else.
 *
 * Pure: no file, no environment, no process.
 */

/** The five characters PowerShell's tokenizer reads as a single quote. */
const SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g;

/**
 * `value` as a PowerShell single-quoted literal: each of the five quotes doubled with
 * itself, every other character left exactly as it is (`$`, a backtick, a double quote and a
 * backslash are literal inside single quotes).
 *
 * A line break is refused rather than quoted: PowerShell does allow a string to span lines,
 * but this literal travels on a **command line**, where a line break ends the command. A
 * value that would split it is the caller's error, never a command that runs differently.
 */
export function powershellLiteral(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`cannot put ${JSON.stringify(value)} in a PowerShell command`);
  }
  return `'${value.replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}
