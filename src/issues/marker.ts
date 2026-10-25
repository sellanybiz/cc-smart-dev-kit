/**
 * The hidden marker that keeps one finding to one issue (D67). `issue file` puts one HTML
 * comment line in the body — `<!-- cc-smart-dev-kit:issue <hash> -->` — where `<hash>` is the
 * SHA-256 of the caller's fingerprint key, so a key that holds a path is never written raw.
 * The next call with the same key finds that line and updates the issue instead of opening a
 * second one (`file.ts` reads the labelled issues once and looks for the line itself:
 * GitHub's search is not documented to index an HTML comment, `.claude/research/`).
 *
 * The marker is persisted in issues for good: its text must not change with the plugin's
 * version, so it is built from the fixed command name only.
 */
import { COMMAND } from "../build-info/names";

/** What every marker line starts with. A body that holds it is not the caller's text to send. */
export const MARKER_PREFIX = `<!-- ${COMMAND}:issue `;

/** How many hex characters of the hash the marker keeps (128 bits). */
const HASH_HEX_LENGTH = 32;

/** The marker's hash for a fingerprint key. */
export function fingerprintHash(key: string): string {
  return new Bun.CryptoHasher("sha256").update(key).digest("hex").slice(0, HASH_HEX_LENGTH);
}

/**
 * True when `body` holds a line that reads as any of the kit's hidden markers (`issue`, `fixed`,
 * `handback`: `<!-- cc-smart-dev-kit:<kind> … -->`). Plain text anyone can write, so it says a
 * comment *may* be the kit's; only the kit's own account makes it so (`kitAccount`).
 */
export function hasKitMarker(body: string): boolean {
  const start = `<!-- ${COMMAND}:`;
  return body.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(start) && trimmed.endsWith("-->");
  });
}

/** The marker line for a hash. */
export function markerLine(hash: string): string {
  return `${MARKER_PREFIX}${hash} -->`;
}

/** True when `body` holds any marker line, ours or forged: the caller's own text must not. */
export function holdsMarker(body: string): boolean {
  return body.includes(MARKER_PREFIX);
}

/** True when `body` has the marker line for `hash` on a line of its own. */
export function hasMarker(body: string, hash: string): boolean {
  const wanted = markerLine(hash);
  return body.split(/\r?\n/).some((line) => line.trim() === wanted);
}

/** The text posted: the caller's body, then the marker on its own last line. */
export function bodyWithMarker(body: string, hash: string): string {
  return `${body.trimEnd()}\n\n${markerLine(hash)}\n`;
}
