/**
 * The screen an issue's text passes before anything is sent to GitHub (D67): a home path, a key
 * or token, and a URL with credentials are REFUSED, with the line and column of the first one
 * and never its value. The text is never "cleaned" and sent anyway: the writer must hear that
 * it wrote a secret, and the fix is theirs.
 *
 * Why not `maskSecrets` (`src/gateway/plain-text.ts`): it MASKS text for a log and is loose on
 * purpose (any run of 32 letters or digits), which here would refuse every commit hash; and the
 * router's bundle imports it, so changing it restarts every machine's router. This screen finds
 * the shapes a person would never mean to publish and tells where. Its URL rule reads the same
 * schemes `redactUrl` hides (`TOKEN_SCHEMES`, `src/setup/marketplace-access.ts`).
 */
import { TOKEN_SCHEMES } from "../setup/marketplace-access";

/** What a hit is, in the words of a refusal. */
export type HitKind = "a home path" | "a key or token" | "a URL with credentials";

/** One place the screen refuses: 1-based line and column (in characters), never the value. */
export interface Hit {
  column: number;
  kind: HitKind;
  line: number;
}

/** A key or token shape, each a pattern with bounded quantifiers (no input makes it backtrack long). */
const TOKEN_SHAPES: readonly RegExp[] = [
  /\bsk[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,256}/g,
  /\bnpm_[A-Za-z0-9]{30,256}/g,
  /\bglpat-[A-Za-z0-9_-]{16,256}/g,
  /\bhf_[A-Za-z0-9]{30,256}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,256}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,256}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,256}/g,
  /\bAIza[0-9A-Za-z_-]{30,256}/g,
  /\beyJ[A-Za-z0-9_-]{8,512}\.eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,512}/g,
  /-----BEGIN [A-Z ]{0,32}PRIVATE KEY(?: BLOCK)?-----/g,
  /\b(?:Bearer|Basic)[ \t]{1,4}[A-Za-z0-9._~+/=-]{16,512}/g,
];

/**
 * A value after `key`, `token`, `secret`, `password` or `authorization` and a `:` or `=`
 * (`api_key=…`, `"token": "…"`, `?token=…`). Without the `:` or `=` the words after it are
 * prose ("the key does not exist"). The value is group 1, at least 8 characters.
 */
const ASSIGNED_SECRET =
  /(?<![A-Za-z])(?:key|token|secret|passw(?:or)?d|authorization)["']?[ \t]{0,4}[:=][ \t]{0,4}["']?([^\s"'`,;&<>(){}[\]]{8,256})/gi;

/** The same after a lower-case letter, for a name in camel case: `apiKey=…`, `authToken: …`. */
const CAMEL_ASSIGNED_SECRET =
  /(?<=[a-z])(?:Key|Token|Secret|Passw(?:or)?d)["']?[ \t]{0,4}[:=][ \t]{0,4}["']?([^\s"'`,;&<>(){}[\]]{8,256})/g;

/** A value that names a place for a secret rather than holding one: `$TOKEN`, `${…}`, `***`, `%VAR%`. */
function isPlaceholder(value: string): boolean {
  return /^[$*%{]/.test(value) || /^(?:x{4,}|\.{3,}|-{3,})$/i.test(value);
}

/** A URL's `user:pass@` or `token@` part. The userinfo is group 1, the scheme group 2. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]{0,31}):\/\/([^/?#\s'"<>@]{1,256})@/gi;

/** The pattern to find the real home folder, in the forms a path takes; null when it is too short to mean one. */
function homePattern(home: string | null): RegExp | null {
  if (home === null) return null;
  const trimmed = home.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return null;
  const parts = trimmed.split(/[\\/]+/).filter((part) => part !== "");
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const lead = /^[\\/]/.test(trimmed) ? "[\\\\/]" : "";
  // The next character must not continue a name: `/home/ab` is not `/home/abc`. A full stop
  // ends a sentence (`it is in /home/user.`) unless a name character follows it.
  const flags = /^[A-Za-z]:/.test(trimmed) ? "gi" : "g";
  return new RegExp(`${lead}${escaped.join("[\\\\/]+")}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`, flags);
}

/** Where `index` sits in `text`: 1-based line, and column in characters (code points). */
function position(text: string, index: number): { column: number; line: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  const last = lines.at(-1) ?? "";
  return { column: [...last].length + 1, line: lines.length };
}

/** A place in a text: where it starts and how long it is. */
interface Span {
  index: number;
  length: number;
}

/** Every place `pattern` matches in `text`, as a list (the pattern is global). */
function starts(
  text: string,
  pattern: RegExp,
  accept?: (match: RegExpExecArray) => boolean,
): Span[] {
  const found: Span[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (accept === undefined || accept(match)) {
      found.push({ index: match.index, length: match[0].length });
    }
    if (match[0] === "") pattern.lastIndex += 1;
  }
  return found;
}

/** Every place `text` holds something the screen refuses, with its kind, in no order. */
function findings(text: string, home: string | null): (Span & { kind: HitKind })[] {
  const hits: (Span & { kind: HitKind })[] = [];
  const add = (kind: HitKind, spans: Span[]) => {
    for (const span of spans) hits.push({ ...span, kind });
  };
  const homeRule = homePattern(home);
  if (homeRule !== null) add("a home path", starts(text, homeRule));
  for (const shape of TOKEN_SHAPES) add("a key or token", starts(text, shape));
  for (const assigned of [ASSIGNED_SECRET, CAMEL_ASSIGNED_SECRET]) {
    add(
      "a key or token",
      starts(text, assigned, (match) => !isPlaceholder(match[1] ?? "")),
    );
  }
  add(
    "a URL with credentials",
    starts(text, URL_USERINFO, (match) => {
      const scheme = (match[1] ?? "").toLowerCase();
      // Over http(s) and ftp a lone `token@` is a credential; elsewhere (ssh) only `user:pass@`.
      return TOKEN_SCHEMES.has(scheme) || (match[2] ?? "").includes(":");
    }),
  );
  return hits;
}

/**
 * Every place `text` holds a home path (`home`: the real home folder, `~` paths are fine), a key
 * or token shape, or a URL with credentials, first to last. `home` is null when the machine has
 * none to name.
 */
export function screenText(text: string, home: string | null): Hit[] {
  return findings(text, home)
    .map((found) => ({ ...position(text, found.index), kind: found.kind }))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Where a hit really ends. The patterns cap a value's length (so no input makes one backtrack
 * long), but a secret is the whole run it sits in: a key or token goes to the next space or quote,
 * and a private key from its BEGIN line to its END line (or the end of the text). Left at the cap,
 * the tail of a long value would stay in the clear.
 */
function reach(text: string, found: Span & { kind: HitKind }): number {
  const end = found.index + found.length;
  if (found.kind !== "a key or token") return end;
  if (text.startsWith("-----BEGIN", found.index)) {
    const stop = text.indexOf("-----END", end);
    if (stop === -1) return text.length;
    const close = text.indexOf("-----", stop + "-----END".length);
    return close === -1 ? text.length : close + "-----".length;
  }
  let at = end;
  while (at < text.length && !/[\s"'`<>]/.test(text[at] ?? "")) at += 1;
  return at;
}

/**
 * `text` with every place the screen would refuse replaced by `[redacted: <kind>]`. For text
 * that is NOT ours to refuse: an issue someone else wrote, read into a brief. A secret in a
 * public issue is still a secret on this machine's disk (D67). Each hit is widened to the whole
 * secret (`reach`), and hits that overlap become one, ending at the furthest end.
 */
export function redactText(text: string, home: string | null): string {
  const spans = findings(text, home)
    .map((found) => ({ ...found, end: reach(text, found) }))
    .sort((a, b) => a.index - b.index || b.end - a.end);
  let out = "";
  let at = 0;
  for (const span of spans) {
    if (span.index < at) {
      at = Math.max(at, span.end);
      continue;
    }
    out += `${text.slice(at, span.index)}[redacted: ${span.kind}]`;
    at = span.end;
  }
  return out + text.slice(at);
}
