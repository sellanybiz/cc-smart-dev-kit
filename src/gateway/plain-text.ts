/**
 * Text from outside — an upstream's error answer, a web page, a search result — made safe
 * to print on a terminal or in one log line, and anything in it that looks like a key masked
 * (`maskSecrets`, `maskedLine`). The one home for this: the router's log (`router.ts`), the
 * gateway's commands, claude-mem's check and `cc-smart-dev-kit search` (`src/search/`) use it.
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

/** A secret as the log shows it: `****` and, for a long one, its last four characters. */
function maskedTail(secret: string): string {
  return secret.length >= 12 ? `****${secret.slice(-4)}` : "****";
}

/** A known secret shorter than this is not masked by its text: it would wreck the line. */
const KNOWN_SECRET_MIN = 4;

/** A UUID (8-4-4-4-12 hex): a request or object id, never a key. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each known secret as it can stand in an error text: as it is, as a JSON string shows it,
 * and as a JSON string inside a JSON string shows it. Longest first, so a secret that holds
 * another is masked whole.
 */
function knownSecretForms(known: readonly string[]): { form: string; secret: string }[] {
  const forms = new Map<string, string>();
  for (const secret of known) {
    if (secret.length < KNOWN_SECRET_MIN) continue;
    const once = JSON.stringify(secret).slice(1, -1);
    const twice = JSON.stringify(once).slice(1, -1);
    for (const form of [secret, once, twice]) if (!forms.has(form)) forms.set(form, secret);
  }
  return [...forms]
    .map(([form, secret]) => ({ form, secret }))
    .sort((a, b) => b.form.length - a.form.length);
}

/**
 * An upstream's error text with anything that looks like a key masked, before it goes to
 * the log. An upstream may echo a key back ("invalid x-api-key sk-…"). Masked, in order:
 *   - `known`: the exact secrets the router holds (each backend's key, the request's
 *     `x-api-key` and `authorization`), short ones too, and their JSON-escaped forms;
 *   - an email address (an account's, in an error about it);
 *   - the value of a JSON field whose name says key, token, secret, password or
 *     authorization, its quotes escaped or not;
 *   - a `Bearer` / `Basic` credential; an `sk-…` key;
 *   - a value after `key`, `token`, `secret` or `password` and a `:` or `=` (a header, a
 *     query): `x-api-key: abc123`, `api_key=…`. Without the `:` or `=` the words after it
 *     are prose ("the key does not exist"), and stay;
 *   - any unbroken run of 32 or more letters, digits, `_` or `-`, but a run with `__` (an
 *     MCP tool name, `mcp__plugin_x__tool`) or a UUID: those are names, never keys.
 * Every quantifier is bounded, so no input makes a pattern backtrack for long; the router's
 * log also cuts the text to 2 KB first (`errorSnippet`). ASCII only, because a log line is;
 * so not `maskKey` from settings.ts, whose `••••` the log would turn into `????` (and the
 * router bundle must not import settings.ts: it bakes in the plugin version).
 */
export function maskSecrets(text: string, known: readonly string[] = []): string {
  let out = text;
  for (const { form, secret } of knownSecretForms(known)) {
    out = out.split(form).join(maskedTail(secret));
  }
  return out
    .replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g, "****@****")
    .replace(
      /(\\?")([^"\\]{0,64}(?:key|token|secret|password|authorization)[^"\\]{0,64})\1(\s{0,4}):(\s{0,4})\1[^"\\]{0,512}\1/gi,
      "$1$2$1$3:$4$1****$1",
    )
    .replace(/\b(Bearer|Basic)\s{1,4}[A-Za-z0-9._~+/=-]{1,512}/gi, "$1 ****")
    .replace(/\bsk-[A-Za-z0-9_-]{1,512}/g, (key) => `sk-${maskedTail(key)}`)
    .replace(
      /(key|token|secret|password)(\W{0,3}[:=]\W{0,3})(?!\*{4}|sk-\*{4})([^\s"'`\\,;&<>(){}[\]]{4,256})/gi,
      (_match, name: string, separator: string, value: string) =>
        `${name}${separator}${maskedTail(value)}`,
    )
    .replace(/[A-Za-z0-9_-]{32,512}/g, (run) =>
      run.includes("__") || UUID.test(run) ? run : maskedTail(run),
    );
}

/**
 * An outside error text as one line to show: anything like a key masked first
 * (`maskSecrets`, with the `known` secrets), then made one line of at most `max`
 * characters with no control character (`oneLine`). The router's log passes `ascii`;
 * `cc-smart-dev-kit search` shows Unicode and marks a cut with `…`.
 */
export function maskedLine(
  text: string,
  known: readonly string[],
  max: number,
  options: { ascii?: boolean; mark?: string } = {},
): string {
  return oneLine(maskSecrets(text, known), max, options);
}
