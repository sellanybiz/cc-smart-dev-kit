/**
 * Text from outside — an upstream's error answer, a web page, a search result — made safe
 * to print on a terminal or in one log line. The one home for this: the router's log
 * (`router.ts`) and `cc-smart-dev-kit search` (`src/search/`) both use it.
 *
 * A terminal obeys control characters inside text: ESC starts a sequence that can write
 * the clipboard (OSC 52), hide text, move the cursor or clear the screen; a C1 control
 * (U+0080–U+009F) can do the same on some terminals; a bidi override (U+202E) shows text
 * in another order than it is; `\r` and `\n` can forge a line that looks like the
 * program's own. So every control (`\p{Cc}`) and format (`\p{Cf}`) character becomes a
 * space. A page's text keeps its line breaks and tabs (`keepNewlines`), nothing else.
 *
 * Imported by the router bundle: nothing here may import the version (`src/build-info`).
 */

/** Every control and format character: what a terminal may obey instead of showing. */
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/** The same, but `\n` and `\t`: the controls a page's text keeps. */
const CONTROL_BUT_LINES = /[^\P{Cc}\n\t]|\p{Cf}/gu;

/** `text` with every control and format character a space. `keepNewlines`: `\n` and `\t` stay. */
export function plainText(text: string, options: { keepNewlines?: boolean } = {}): string {
  return text.replace(options.keepNewlines === true ? CONTROL_BUT_LINES : CONTROL, " ");
}

/**
 * The first `max` UTF-16 units of `text`, one fewer when the last one would be the first
 * half of a pair (an emoji, say): a cut never leaves half a character.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/**
 * `text` as one line of at most `max` characters, then `mark` when it was cut. Controls
 * become spaces (`plainText`), each run of white space one space, the ends trimmed.
 * `ascii`: every character outside printable ASCII also becomes `?` (a log line).
 */
export function oneLine(
  text: string,
  max: number,
  options: { ascii?: boolean; mark?: string } = {},
): string {
  const flat =
    options.ascii === true
      ? text.replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?")
      : plainText(text).replace(/\s+/g, " ");
  const line = flat.trim();
  return line.length > max ? `${cutText(line, max)}${options.mark ?? ""}` : line;
}

/**
 * A value as JSON (two-space indent) that is safe to print: the same JSON, but every
 * control or format character JSON.stringify leaves as it is (C1 controls, U+007F, bidi
 * overrides, …) is written as a `\uXXXX` escape. It parses back to the same value. Only
 * the line breaks between JSON's own lines stay: inside a string, `\n` is already escaped.
 */
export function printableJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[^\P{Cc}\n]|\p{Cf}/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
