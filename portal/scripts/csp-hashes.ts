/**
 * After `next build`: the content-policy hashes the exported pages need, written to
 * `out/csp.json` as `{ "styleAttr": [...], "styleElem": [...] }` (each sorted, no duplicates).
 *
 * The portal's policy is `script-src 'self'` and `style-src 'self'`. Where the export still
 * writes a `style="…"` attribute or an inline `<style>`, the server may allow that exact text by
 * its hash (`style-src-attr 'unsafe-hashes' 'sha256-…'`, `style-src 'self' 'sha256-…'`), and
 * nothing else. The Bun portal server reads this file to build the header.
 *
 * Usage: bun scripts/csp-hashes.ts [out-dir]
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CspHashes {
  styleAttr: string[];
  styleElem: string[];
}

/** The text a browser hashes for an attribute: the value after its character references. */
export function decodeAttribute(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(quot|amp|lt|gt|apos));/gi,
    (whole, dec, hex, name) => {
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      const named: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };
      return named[String(name).toLowerCase()] ?? whole;
    },
  );
}

/** A CSP source for a text: `'sha256-<base64>'`. */
export function cspHash(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** Every style attribute value and inline `<style>` body in these pages, hashed. */
export function cspHashes(pages: readonly string[]): CspHashes {
  const attrs = new Set<string>();
  const elems = new Set<string>();
  for (const html of pages) {
    // Inline styles are values of a `style` attribute in a start tag: double or single quoted.
    for (const tag of html.matchAll(/<[a-zA-Z][^\s/>]*(\s[^>]*)?>/g)) {
      const inside = tag[1] ?? "";
      for (const attr of inside.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        attrs.add(cspHash(decodeAttribute(attr[1] ?? attr[2] ?? "")));
      }
    }
    // A `<style>` element's body is raw text: it is hashed exactly as written.
    for (const style of html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi)) {
      elems.add(cspHash(style[1] ?? ""));
    }
  }
  return { styleAttr: [...attrs].sort(), styleElem: [...elems].sort() };
}

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2] ?? "out";
  const files = htmlFiles(dir);
  const hashes = cspHashes(files.map((file) => readFileSync(file, "utf8")));
  writeFileSync(join(dir, "csp.json"), `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(
    `csp.json: ${hashes.styleAttr.length} style attribute hash(es), ${hashes.styleElem.length} <style> hash(es), from ${files.length} pages`,
  );
}
