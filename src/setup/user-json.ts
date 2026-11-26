/**
 * Reading a JSON file a person may have edited: `~/.claude/settings.json`, Claude Code's own
 * files beside it, a project's `.mcp.json` and settings files, `package.json`, the kit's own
 * `gateway.json` and `workflow.json`. The one home of that read, so every reader agrees.
 *
 * Why it is not a plain `JSON.parse`: an editor on Windows (Notepad, an older PowerShell's
 * `Set-Content -Encoding UTF8`) saves UTF-8 with a byte order mark, U+FEFF, at the start.
 * `JSON.parse` refuses that character, so a settings file Claude Code reads without trouble
 * looked broken to setup: "the marketplace is not added yet", a status line that was not
 * there, an opt-out that was not seen. A JSON text never needs the mark (RFC 8259 § 8.1: an
 * implementation "MUST NOT add a byte order mark"), so it is skipped on the way in, and a file
 * setup writes again is written without it — the form Claude Code writes itself.
 */
import { readFileSync } from "node:fs";

/** The byte order mark, as `readFileSync(…, "utf8")` hands it over: one U+FEFF character. */
const BOM = "﻿";

/** `text` without a leading byte order mark. */
export function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/** The JSON value in `text`, a leading byte order mark skipped. Throws like `JSON.parse`. */
export function parseUserJson(text: string): unknown {
  return JSON.parse(withoutBom(text));
}

/** The JSON value in `file`. Throws when it cannot be read or is not JSON. */
export function readUserJson(file: string): unknown {
  return parseUserJson(readFileSync(file, "utf8"));
}
