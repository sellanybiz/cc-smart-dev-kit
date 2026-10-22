/**
 * The Next.js export, served by the portal's own Bun server (D49).
 *
 * The portal's pages are a static export (Pages Router, `output: "export"`, `trailingSlash`):
 * one `index.html` per route and `_next/static/*` beside it. There is no Next server and no
 * Next API route; the Bun server owns every route and serves these files behind the same door
 * as everything else (Host, Origin, `Sec-Fetch-Site`).
 *
 * What this module adds to a plain file server, and why:
 *
 *   - **The CSRF value goes into every HTML page at serve time** as
 *     `<meta name="ccsdk-csrf" content="…">`. A static file cannot carry a value made when the
 *     server started, and the UI's POSTs need it; the meta tag is outside every script, so the
 *     page's hashes stay valid.
 *   - **The content policy comes from the export's `csp.json`** (`{ styleAttr: [...],
 *     styleElem: [...] }`, written at build time): `style-src 'self' <styleElem hashes>` and
 *     `style-src-attr 'unsafe-hashes' <styleAttr hashes>` — the owner's yes (D49) to the one
 *     loosening, for the exact style values the export writes and nothing else. `script-src`
 *     stays `'self'`: the Pages Router's webpack export has no executable inline script.
 *   - **A path never leaves the folder**: only its own files are served, and `..` is refused.
 *
 * When no export folder is there, nothing here runs and the server-rendered pages answer as
 * they always did; the switch-over is a later phase.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { CSP, securityHeaders } from "./guard";

/** The hashes the export's build step wrote: sha256 values, base64 (no `sha256-` prefix). */
export interface CspHashes {
  styleAttr: string[];
  styleElem: string[];
}

/** A static export this server can serve. */
export interface StaticExport {
  csp: CspHashes;
  folder: string;
}

/** The file each extension is served as; anything else is an octet stream. */
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** A `csp.json` entry: a base64 SHA-256 value, or the whole `'sha256-…'` token. */
const CSP_HASH = /^(?:'sha256-[A-Za-z0-9+/]{43}='|[A-Za-z0-9+/]{43}=)$/;

/** How many files the process keeps in memory: the export does not change while it runs. */
const CACHE_MAX = 256;

/** A path inside the export, or null when it is not there or points outside the folder. */
function fileInside(folder: string, pathname: string): null | string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const file = resolve(join(folder, decoded));
  if (file !== folder && !file.startsWith(`${folder}${sep}`)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** The file a page route answers: `/` → `index.html`, `/x` → `x/index.html` or `x.html`. */
function pageFile(folder: string, pathname: string): null | string {
  if (pathname === "/") return fileInside(folder, "index.html");
  const clean = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const page = fileInside(folder, `${clean}/index.html`) ?? fileInside(folder, `${clean}.html`);
  if (page !== null) return page;
  // A page's own image or icon at the root (`favicon.ico`); never its data files.
  const bare = fileInside(folder, clean);
  return bare !== null && /\.(ico|jpe?g|png|svg|webp|woff2?)$/i.test(bare) ? bare : null;
}

/** The hashes `csp.json` holds; a missing or broken file has none (the strict policy stays). */
function readCsp(folder: string): CspHashes {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(folder, "csp.json"), "utf8"));
  } catch {
    return { styleAttr: [], styleElem: [] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { styleAttr: [], styleElem: [] };
  }
  const value = parsed as Record<string, unknown>;
  // A hash only: an entry that is any other policy word (`'unsafe-inline'`) would loosen the
  // policy, so it is dropped, never passed on.
  const list = (one: unknown): string[] =>
    Array.isArray(one)
      ? one.filter((entry): entry is string => typeof entry === "string" && CSP_HASH.test(entry))
      : [];
  return { styleAttr: list(value.styleAttr), styleElem: list(value.styleElem) };
}

/**
 * The export in `folder`, or null when it is not there (or holds no `index.html`): a folder
 * with no page is not an export, and the server-rendered pages keep answering.
 */
export function readExport(folder: null | string): StaticExport | null {
  if (folder === null) return null;
  const absolute = resolve(folder);
  if (!existsSync(join(absolute, "index.html"))) return null;
  return { csp: readCsp(absolute), folder: absolute };
}

/** One hash as a policy token: the export writes the base64 value, or the whole token. */
function token(hash: string): string {
  return hash.startsWith("'") ? hash : `'sha256-${hash}'`;
}

/**
 * The policy for the export: today's strict policy with the export's own style hashes added,
 * and `style-src-attr` opened only by `'unsafe-hashes'` and those hashes (the owner's yes).
 */
export function exportPolicy(csp: CspHashes): string {
  const style = ["'self'", ...csp.styleElem.map(token)].join(" ");
  const attr = ["'unsafe-hashes'", ...csp.styleAttr.map(token)].join(" ");
  // One home for the rest of the policy: `CSP` in `guard.ts`, with `style-src` replaced.
  const rest = CSP.split("; ").filter(
    (directive) => !directive.startsWith("style-src") && directive !== "",
  );
  return [...rest, `style-src ${style}`, `style-src-attr ${attr}`].join("; ");
}

/** The CSRF meta every HTML page carries: outside every script, so the page's hashes hold. */
const CSRF_META = (csrf: string): string =>
  `<meta name="ccsdk-csrf" content="${csrf.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`;

/**
 * The page with the CSRF meta in its head. Inserted after `<head>`, so the page's charset and
 * viewport stay first; a page with no head (never Next's) gets it at the very start.
 */
export function injectCsrf(html: string, csrf: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head === null) return `${CSRF_META(csrf)}${html}`;
  let at = head.index + head[0].length;
  // The charset stays the first thing the parser meets, as the HTML spec asks.
  const charset = /^\s*<meta[^>]*charset[^>]*>/i.exec(html.slice(at));
  if (charset !== null) at += charset[0].length;
  return `${html.slice(0, at)}${CSRF_META(csrf)}${html.slice(at)}`;
}

/** What the server keeps of one export: its folder, its policy, and the files it has read. */
export interface ExportServer {
  /** The policy for every answer from the export. */
  policy: string;
  /** The file a page route answers, or null (the server-rendered page then answers). */
  page(pathname: string): null | string;
  /** One file under `_next/static/`, or null. */
  staticFile(pathname: string): null | string;
  /** A file's bytes, read once and kept. */
  bytes(file: string): Uint8Array | null;
}

/** One server over an export: the routes, the bytes cache, and the policy. */
export function exportServer(source: StaticExport): ExportServer {
  const cache = new Map<string, Uint8Array>();
  return {
    bytes: (file) => {
      const kept = cache.get(file);
      if (kept !== undefined) return kept;
      try {
        const bytes = readFileSync(file);
        if (cache.size >= CACHE_MAX) cache.clear();
        cache.set(file, bytes);
        return bytes;
      } catch {
        return null;
      }
    },
    page: (pathname) => pageFile(source.folder, pathname),
    policy: exportPolicy(source.csp),
    staticFile: (pathname) => {
      if (!pathname.startsWith("/_next/static/")) return null;
      const file = fileInside(source.folder, pathname.slice(1));
      // Build output only: a `..` that climbed out of `_next/static` is not one of its files.
      const build = resolve(source.folder, "_next", "static");
      return file?.startsWith(`${build}${sep}`) === true ? file : null;
    },
  };
}

/** The answer for one export file: the page's CSRF meta added, the policy attached. */
export function exportResponse(server: ExportServer, file: string, csrf: string): null | Response {
  const bytes = server.bytes(file);
  if (bytes === null) return null;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const html = type.startsWith("text/html");
  const body = html ? injectCsrf(new TextDecoder().decode(bytes), csrf) : bytes;
  return new Response(body, {
    headers: {
      ...securityHeaders(),
      "content-security-policy": server.policy,
      "content-type": type,
    },
  });
}
