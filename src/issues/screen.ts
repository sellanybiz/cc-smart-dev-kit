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
  /\bsk-[A-Za-z0-9_-]{16,256}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,256}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,256}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,256}/g,
  /\bAIza[0-9A-Za-z_-]{30,256}/g,
  /\beyJ[A-Za-z0-9_-]{8,512}\.eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,512}/g,
  /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----/g,
  /\b(?:Bearer|Basic)[ \t]{1,4}[A-Za-z0-9._~+/=-]{16,512}/g,
];

/**
 * A value after `key`, `token`, `secret`, `password` or `authorization` and a `:` or `=`
 * (`api_key=…`, `"token": "…"`, `?token=…`). Without the `:` or `=` the words after it are
 * prose ("the key does not exist"). The value is group 1, at least 8 characters.
 */
const ASSIGNED_SECRET =
  /(?:key|token|secret|passw(?:or)?d|authorization)["']?[ \t]{0,4}[:=][ \t]{0,4}["']?([^\s"'`,;&<>(){}[\]]{8,256})/gi;

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
  // The next character must not continue a name: `/home/ab` is not `/home/abc`.
  const flags = /^[A-Za-z]:/.test(trimmed) ? "gi" : "g";
  return new RegExp(`${lead}${escaped.join("[\\\\/]+")}(?![A-Za-z0-9_.-])`, flags);
}

/** Where `index` sits in `text`: 1-based line, and column in characters (code points). */
function position(text: string, index: number): { column: number; line: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  const last = lines.at(-1) ?? "";
  return { column: [...last].length + 1, line: lines.length };
}

/** Every start index of `pattern` in `text`, as a list (the pattern is global). */
function starts(text: string, pattern: RegExp, accept?: (match: RegExpExecArray) => boolean) {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (accept === undefined || accept(match)) found.push(match.index);
    if (match[0] === "") pattern.lastIndex += 1;
  }
  return found;
}

/**
 * Every place `text` holds a home path (`home`: the real home folder, `~` paths are fine), a key
 * or token shape, or a URL with credentials, first to last. `home` is null when the machine has
 * none to name.
 */
export function screenText(text: string, home: string | null): Hit[] {
  const hits: Hit[] = [];
  const add = (kind: HitKind, indexes: number[]) => {
    for (const index of indexes) hits.push({ ...position(text, index), kind });
  };
  const homeRule = homePattern(home);
  if (homeRule !== null) add("a home path", starts(text, homeRule));
  for (const shape of TOKEN_SHAPES) add("a key or token", starts(text, shape));
  add(
    "a key or token",
    starts(text, ASSIGNED_SECRET, (match) => !isPlaceholder(match[1] ?? "")),
  );
  add(
    "a URL with credentials",
    starts(text, URL_USERINFO, (match) => {
      const scheme = (match[1] ?? "").toLowerCase();
      // Over http(s) and ftp a lone `token@` is a credential; elsewhere (ssh) only `user:pass@`.
      return TOKEN_SCHEMES.has(scheme) || (match[2] ?? "").includes(":");
    }),
  );
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}
