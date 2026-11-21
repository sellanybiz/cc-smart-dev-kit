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
import { escapeRegex } from "../regex-escape";
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
  /\brk_(?:live|test)_[A-Za-z0-9]{16,256}/g,
  /\bgsk_[A-Za-z0-9]{20,256}/g,
  /\btvly-[A-Za-z0-9_-]{16,256}/g,
  // A webhook URL is the secret: whoever holds it can post to the channel.
  /(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{16,256}/g,
  /(?:https?:\/\/)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{5,32}\/[A-Za-z0-9._-]{16,256}/g,
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
 * (`api_key=…`, `"token": "…"`, `?token=…`), in any case and with letters before the word and no
 * space (`APIKEY`, `PGPASSWORD`, `GITHUBTOKEN`, `apiKey`, `accesstoken`). Without the `:` or `=`
 * the words after it are prose ("the key does not exist"); a short or placeholder value after
 * "monkey:" passes. The value is group 1, at least 8 characters.
 */
const ASSIGNED_SECRET =
  /(?:key|token|secret|passw(?:or)?d|authorization)["']?[ \t]{0,4}[:=][ \t]{0,4}["']?([^\s"'`,;&<>(){}[\]]{8,256})/gi;

/** A value that names a place for a secret rather than holding one: `$TOKEN`, `${…}`, `***`, `%VAR%`. */
function isPlaceholder(value: string): boolean {
  return /^[$*%{]/.test(value) || /^(?:x{4,}|\.{3,}|-{3,})$/i.test(value);
}

/** A URL's `user:pass@` or `token@` part. The userinfo is group 1, the scheme group 2. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]{0,31}):\/\/([^/?#\s'"<>@]{1,256})@/gi;

/** A home folder told apart: a drive-letter home in any of its spellings, or a plain path. */
interface HomeShape {
  /** The drive letter of a Windows home (`C:\Users\x`, Git Bash `/c/Users/x`, WSL `/mnt/c/Users/x`), or null. */
  drive: string | null;
  parts: string[];
}

/** Which folder `home` names: the drive and the names below it. */
function homeShape(trimmed: string): HomeShape {
  const parts = trimmed.split(/[\\/]+/).filter((part) => part !== "");
  const windows = /^([A-Za-z]):(?:[\\/]|$)/.exec(trimmed);
  if (windows !== null) return { drive: windows[1] ?? null, parts: parts.slice(1) };
  // Git Bash writes `C:\Users\x` as `/c/Users/x`, WSL as `/mnt/c/Users/x`.
  const wsl = /^[\\/]mnt[\\/]([A-Za-z])[\\/]/.exec(trimmed);
  if (wsl !== null) return { drive: wsl[1] ?? null, parts: parts.slice(2) };
  const msys = /^[\\/]([A-Za-z])[\\/]/.exec(trimmed);
  if (msys !== null) return { drive: msys[1] ?? null, parts: parts.slice(1) };
  return { drive: null, parts };
}

/**
 * The patterns that find the real home folder, one for each spelling a path takes in a session:
 * the one `$HOME` itself has; for a drive-letter home also `C:\Users\x`, `C:/Users/x`, Git Bash's
 * `/c/Users/x` and WSL's `/mnt/c/Users/x`, in any case. Empty when the home is too short to mean
 * one. The one list `screenText` and `redactText` read.
 */
function homePatterns(home: string | null): RegExp[] {
  if (home === null) return [];
  const trimmed = home.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return [];
  const { drive, parts } = homeShape(trimmed);
  const escaped = parts.map((part) => escapeRegex(part));
  const below = escaped.join("[\\\\/]+");
  // The next character must not continue a name: `/home/ab` is not `/home/abc`. A full stop
  // ends a sentence (`it is in /home/user.`) unless a name character follows it.
  const end = "(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])";
  if (drive === null) {
    const lead = /^[\\/]/.test(trimmed) ? "[\\\\/]" : "";
    return [new RegExp(`${lead}${escaped.join("[\\\\/]+")}${end}`, "g")];
  }
  // A bare drive names no home. Git Bash's `/c/…` must not start inside WSL's `/mnt/c/…`, nor
  // inside a `~` path (`~/c/Users/x` is a folder under the home, which is fine).
  if (below === "") return [];
  const rest = `[\\\\/]+${below}`;
  return [
    `${drive}:${rest}`,
    `(?<![A-Za-z0-9_~])[\\\\/]${drive}${rest}`,
    `[\\\\/]mnt[\\\\/]${drive}${rest}`,
  ].map((source) => new RegExp(`${source}${end}`, "gi"));
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
  for (const homeRule of homePatterns(home)) add("a home path", starts(text, homeRule));
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
