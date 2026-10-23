/**
 * The Next.js export, served by the Bun server: the folder's pages, the CSRF meta, the content
 * policy built from `csp.json`, and a path that never leaves the folder (D49, B6b).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { exportPolicy, exportResponse, exportServer, injectCsrf, readExport } from "./static";

/** Real SHA-256 values in base64 (of "", "foo"), written by hand: `csp.json` takes only hashes. */
const ATTR_HASH = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const ELEM_HASH = "LCa0a2j/xo/5m0U8HTBBNBNCLXBkg7+g+YpeiGJm564=";

/** A small export: a page with a head, a page under a folder, a static chunk, and the hashes. */
function fixture(): string {
  const folder = tempDir("export");
  writeFileSync(
    join(folder, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>Portal</title></head><body><div id="root"></div></body></html>',
  );
  mkdirSync(join(folder, "work"));
  writeFileSync(join(folder, "work", "index.html"), "<html><head></head><body>work</body></html>");
  mkdirSync(join(folder, "_next", "static", "chunks"), { recursive: true });
  writeFileSync(join(folder, "_next", "static", "chunks", "app.js"), "console.log(1);\n");
  writeFileSync(
    join(folder, "csp.json"),
    JSON.stringify({
      styleAttr: [ATTR_HASH, "'unsafe-inline'", "AAA="],
      styleElem: [`'sha256-${ELEM_HASH}'`, "'unsafe-eval'"],
    }),
  );
  return folder;
}

describe("the Next.js export", () => {
  test("a folder with no index.html is not an export", () => {
    const folder = tempDir("empty");
    expect(readExport(folder)).toBe(null);
    expect(readExport(null)).toBe(null);
  });

  test("the policy adds the export's style hashes and keeps script-src 'self'", () => {
    const policy = exportPolicy({ styleAttr: ["AAA=", "BBB="], styleElem: ["CCC="] });
    expect(policy).toContain("style-src 'self' 'sha256-CCC='");
    expect(policy).toContain("style-src-attr 'unsafe-hashes' 'sha256-AAA=' 'sha256-BBB='");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("nonce");
    // The rest is today's policy, unchanged.
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self'");
    // And only one style-src directive: the old one is replaced, never doubled.
    expect(policy.split("style-src ").length).toBe(2);
  });

  test("a whole hash token from csp.json is used as it is", () => {
    expect(exportPolicy({ styleAttr: ["'sha256-X='"], styleElem: [] })).toContain(
      "style-src-attr 'unsafe-hashes' 'sha256-X='",
    );
  });

  test("the CSRF meta goes into the head, outside every script", () => {
    const html = injectCsrf(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      "tok",
    );
    expect(html).toContain('<head><meta charset="utf-8"><meta name="ccsdk-csrf" content="tok">');
    // A value with a quote is escaped, never breaking out of the attribute.
    expect(injectCsrf("<html><head></head></html>", 'a"b')).toContain('content="a&quot;b"');
    // No head at all: the meta still comes, at the start.
    expect(injectCsrf("<body></body>", "tok").startsWith('<meta name="ccsdk-csrf"')).toBe(true);
  });

  test("pages: the root, a folder's index, a trailing slash, and a missing page", () => {
    const server = exportServer(
      readExport(fixture()) as NonNullable<ReturnType<typeof readExport>>,
    );
    expect(server.page("/")).toContain("index.html");
    expect(server.page("/work")).toContain(join("work", "index.html"));
    expect(server.page("/work/")).toContain(join("work", "index.html"));
    expect(server.page("/nowhere")).toBe(null);
  });

  test("a path never leaves the export's folder", () => {
    const folder = fixture();
    const server = exportServer(readExport(folder) as NonNullable<ReturnType<typeof readExport>>);
    expect(server.page("/../etc/passwd")).toBe(null);
    expect(server.page("/%2e%2e/%2e%2e/etc/passwd")).toBe(null);
    expect(server.staticFile("/_next/static/../../../../etc/passwd")).toBe(null);
    expect(server.staticFile("/_next/static/chunks/app.js")).toContain(join("_next", "static"));
    // Only `_next/static` is served as build output; a page is not a static file.
    expect(server.staticFile("/index.html")).toBe(null);
    // A page route never serves the export's data or script files.
    expect(server.page("/csp.json")).toBe(null);
    expect(server.page("/_next/static/chunks/app.js")).toBe(null);
  });

  test("an HTML answer carries the CSRF meta and the export's policy; a script carries no meta", () => {
    const folder = fixture();
    const server = exportServer(readExport(folder) as NonNullable<ReturnType<typeof readExport>>);
    const page = server.page("/");
    if (page === null) throw new Error("no page");
    const html = exportResponse(server, page, "csrf-value");
    if (html === null) throw new Error("no answer");
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("content-security-policy")).toContain(`'sha256-${ELEM_HASH}'`);
    return html.text().then((body) => {
      expect(body).toContain('name="ccsdk-csrf" content="csrf-value"');
      const script = server.staticFile("/_next/static/chunks/app.js");
      if (script === null) throw new Error("no script");
      const js = exportResponse(server, script, "csrf-value");
      if (js === null) throw new Error("no answer");
      expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      return js.text().then((text) => {
        expect(text).not.toContain("ccsdk-csrf");
      });
    });
  });

  test("csp.json that is missing or broken leaves the strict policy", () => {
    const folder = tempDir("export-nocsp");
    writeFileSync(join(folder, "index.html"), "<html><head></head></html>");
    const parsed = readExport(folder);
    if (parsed === null) throw new Error("no export");
    expect(parsed.csp).toEqual({ styleAttr: [], styleElem: [] });
    expect(exportPolicy(parsed.csp)).toContain("style-src 'self'");
  });
});

describe("csp.json takes hashes only", () => {
  test("a policy word that is not a hash is dropped, so the policy never loosens", () => {
    const parsed = readExport(fixture()) as NonNullable<ReturnType<typeof readExport>>;
    expect(parsed.csp).toEqual({ styleAttr: [ATTR_HASH], styleElem: [`'sha256-${ELEM_HASH}'`] });
    const policy = exportPolicy(parsed.csp);
    expect(policy).toContain(`style-src 'self' 'sha256-${ELEM_HASH}'`);
    expect(policy).toContain(`style-src-attr 'unsafe-hashes' 'sha256-${ATTR_HASH}'`);
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("AAA=");
  });
});
