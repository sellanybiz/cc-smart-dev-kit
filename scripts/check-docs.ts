/**
 * A reference must resolve. Three kinds: a design-page reference with a section (the page must
 * hold it), a README reference with a section (the README must hold it), and a link to another
 * heading in the same file (its anchor must be a heading's).
 *
 * The design doc is one page per part under `docs/design/`, with the index at the root. A code
 * comment, a rule or a skill points at a section by name; when a section moves, the pointer
 * must move with it. This check is what fails when it does not. A rule, a skill or a doc names
 * the page; a comment in `src/` may name the index instead, because a comment reaches
 * `plugin/dist` and a bundle is rebuilt only by the release — there the index must still name a
 * section some page holds.
 *
 * Skipped, on purpose: the plans and research folders (the lead's working files and the
 * archived record of what was true then), and build output (`plugin/dist`,
 * `plugin/portal-ui`).
 *
 *   bun scripts/check-docs.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DESIGN_INDEX = "docs/design.md";
export const DESIGN_DIR = "docs/design";
export const README = "README.md";

/** Folders whose files hold history rather than pointers that must stay true. */
export const SKIPPED_FOLDERS = [
  ".claude/plans/",
  ".claude/research/",
  "node_modules/",
  "portal/node_modules/",
  "plugin/dist/",
  "plugin/portal-ui/",
];
export const SKIPPED_FILES = new Set([
  "bun.lock",
  // The check's own test quotes references that do not resolve, on purpose.
  "scripts/check-docs.test.ts",
]);

/**
 * A reference that cannot be made true today, with its reason. One entry: a comment in a
 * bundle keeps a section name the design no longer uses, and a comment reaches `plugin/dist`,
 * which only the release rebuilds. Drop the entry once a release has rebuilt the bundle.
 */
export const ALLOWED: { file: string; section: string; reason: string }[] = [
  {
    file: "src/crew/command.ts",
    section: "lead and crew sessions",
    reason: "The design's section is Lead and the crew; a bundle comment cannot be rebuilt here.",
  },
];
/** Only text files are read. */
export const TEXT = /\.(md|ts|tsx|js|mjs|sh|ps1|json|ya?ml|html|css)$/;

export interface SourceFile {
  /** Path from the repo root. */
  path: string;
  text: string;
}

export interface Heading {
  /** The heading's text, without its marks. */
  name: string;
  line: number;
}

export interface BrokenRef {
  /** Path from the repo root, and the line it sits on. */
  file: string;
  line: number;
  /** What the line says, shortened. */
  text: string;
  /** Why it does not resolve. */
  why: string;
}

/** Every ATX heading outside a fenced code block, with its line. */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = line.match(/^#{1,4} (.+?)\s*$/);
    if (m) out.push({ name: m[1] ?? "", line: i + 1 });
  }
  return out;
}

/** Lower case, no marks, one space; a leading "The " is dropped so "the browser" and "The browser" agree. */
export function normalizeHeading(name: string): string {
  return name.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/^the /, "");
}

/** A heading's own names: the whole line, and it without a trailing qualifier ("(optional)", ": the …"). */
export function headingNames(name: string): string[] {
  const names = [name];
  const beforeParen = name.replace(/\s+\([^()]*\)\s*$/, "");
  if (beforeParen !== name) names.push(beforeParen);
  const beforeColon = name.split(": ")[0] ?? name;
  if (beforeColon !== name) names.push(beforeColon);
  return names;
}

/** GitHub's anchor for a heading: lower case, no marks, no punctuation but a hyphen, spaces to hyphens. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

/** The longest heading the text starts with, at a word boundary, or null. */
export function longestHeadingIn(text: string, headings: readonly Heading[]): Heading | null {
  const t = normalizeHeading(text);
  let best: Heading | null = null;
  let bestLength = 0;
  for (const h of headings) {
    for (const name of headingNames(h.name)) {
      const n = normalizeHeading(name);
      if (n === "" || !t.startsWith(n)) continue;
      const next = t.slice(n.length, n.length + 1);
      if (next !== "" && /[a-z0-9]/.test(next)) continue;
      if (n.length > bestLength) {
        best = h;
        bestLength = n.length;
      }
    }
  }
  return best;
}

/** Is this file's reference to this section one that cannot be fixed today? */
function allowedRef(filePath: string, section: string): boolean {
  const t = normalizeHeading(section);
  return ALLOWED.some((a) => {
    if (a.file !== filePath) return false;
    const n = normalizeHeading(a.section);
    return (
      t.startsWith(n) &&
      (t.length === n.length || !/[a-z0-9]/.test(t.slice(n.length, n.length + 1)))
    );
  });
}

/** The page a design path names, or null for the index. */
function pageSlug(path: string): string | null {
  const m = path.match(/^docs\/design\/([\w-]+)\.md$/);
  return m?.[1] ?? null;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function excerpt(text: string, index: number): string {
  const from = Math.max(0, text.lastIndexOf("\n", index) + 1);
  const to = text.indexOf("\n", index);
  return text
    .slice(from, to === -1 ? text.length : to)
    .trim()
    .slice(0, 160);
}

/**
 * Every reference in `files` that does not resolve.
 *
 * `files` must hold every file to scan, the pages under `docs/design/` and the README
 * included: their headings are what a reference is checked against.
 */
export function checkDocs(files: readonly SourceFile[]): BrokenRef[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const pages = new Map<string, readonly Heading[]>();
  for (const f of files) {
    const slug = pageSlug(f.path);
    if (slug) pages.set(slug, headingsOf(f.text));
  }
  const readme = byPath.get(README);
  const readmeHeadings = readme ? headingsOf(readme.text) : [];
  const broken: BrokenRef[] = [];

  for (const file of files) {
    if (SKIPPED_FILES.has(file.path)) continue;
    if (SKIPPED_FOLDERS.some((d) => file.path.startsWith(d))) continue;
    if (!TEXT.test(file.path)) continue;
    const text = file.text;

    // A link to another heading in the same file: its anchor must be a heading's.
    if (file.path.endsWith(".md")) {
      const anchors = new Set(headingsOf(text).map((h) => slugOf(h.name)));
      for (const m of text.matchAll(/\]\(#([\w-]+)\)/g)) {
        const anchor = m[1] ?? "";
        if (!anchors.has(anchor)) {
          broken.push({
            file: file.path,
            line: lineAt(text, m.index ?? 0),
            text: excerpt(text, m.index ?? 0),
            why: `no heading in this file has the anchor "#${anchor}"`,
          });
        }
      }
    }

    // A design-page path, or the old index path, with a section after it.
    const design = /(?<![-\w])(docs\/design\/[\w-]+\.md|docs\/design\.md|design\.md)/g;
    for (const m of text.matchAll(design)) {
      const at = m.index ?? 0;
      const raw = m[1] ?? "";
      const path = raw.startsWith("docs/") ? raw : `docs/${raw}`;
      // A reference may put the section first: "the section, then `in` the path".
      const before = text.slice(Math.max(0, at - 120), at);
      const back = before.match(/§§?\s*([^§\n]{0,100})\s+in\s*$/);
      const ahead = text.slice(at + m[0].length, at + m[0].length + 240);
      const forward = ahead.match(/^[)`\s]*§§?\s*([^\n]{0,120}(?:\n[^\n]{0,80})?)/);
      const section = forward?.[1] ?? back?.[1];
      const slug = path === DESIGN_INDEX ? null : pageSlug(path);
      const exists = slug === null ? byPath.has(path) : pages.has(slug);
      if (section === undefined) {
        if (!exists) {
          broken.push({
            file: file.path,
            line: lineAt(text, at),
            text: excerpt(text, at),
            why: `${path} does not exist`,
          });
        }
        continue;
      }
      if (slug === null) {
        // The index form: allowed only while some page holds the section. The index lists
        // every page, so a reader finds it there. `src/` comments keep this form on purpose:
        // a comment reaches `plugin/dist`, and a bundle is rebuilt only by the release.
        const holder = [...pages.values()].some((headings) => longestHeadingIn(section, headings));
        if (!holder && !allowedRef(file.path, section)) {
          broken.push({
            file: file.path,
            line: lineAt(text, at),
            text: excerpt(text, at),
            why: `no page under ${DESIGN_DIR}/ has the section "${section.trim().slice(0, 60)}"`,
          });
        }
        continue;
      }
      const headings = pages.get(slug);
      if (!headings) {
        broken.push({
          file: file.path,
          line: lineAt(text, at),
          text: excerpt(text, at),
          why: `${path} does not exist`,
        });
        continue;
      }
      if (!longestHeadingIn(section, headings)) {
        if (allowedRef(file.path, section)) continue;
        broken.push({
          file: file.path,
          line: lineAt(text, at),
          text: excerpt(text, at),
          why: `${path} has no section "${section.trim().slice(0, 60)}"`,
        });
      }
    }

    // A README reference with a section after it: the README path, a section mark, the name.
    const readmeRef = /(?<![-\w/])README(?:\.md)?`?\s*(?:§|,?\s+section)\s*/g;
    for (const m of text.matchAll(readmeRef)) {
      const at = (m.index ?? 0) + m[0].length;
      const ahead = text.slice(at, at + 240);
      const name = ahead.match(/([^\n]{1,120}(?:\n[^\n]{0,80})?)/)?.[1] ?? "";
      if (!longestHeadingIn(name, readmeHeadings)) {
        broken.push({
          file: file.path,
          line: lineAt(text, m.index ?? 0),
          text: excerpt(text, m.index ?? 0),
          why: `${README} has no section "${name.trim().slice(0, 60)}"`,
        });
      }
    }
  }
  return broken;
}

function listFiles(root: string): string[] {
  const result = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  return [...new Set(result.stdout.toString().split("\0").filter(Boolean))].sort();
}

function main(): number {
  const root = join(import.meta.dir, "..");
  const files: SourceFile[] = [];
  for (const path of listFiles(root)) {
    if (!TEXT.test(path)) continue;
    const full = join(root, path);
    if (!existsSync(full)) continue; // deleted, not yet committed
    files.push({ path, text: readFileSync(full, "utf8") });
  }
  const broken = checkDocs(files);
  if (broken.length > 0) {
    for (const b of broken) console.error(`${b.file}:${b.line}: ${b.why}\n  ${b.text}`);
    const pages = files.filter((f) => pageSlug(f.path)).length;
    console.error(
      `\n${broken.length} reference${broken.length === 1 ? "" : "s"} do not resolve. The design doc is ` +
        `${DESIGN_INDEX} (the index) plus a page per part under ${DESIGN_DIR}/ (${pages} pages).`,
    );
    return 1;
  }
  const pages = files.filter((f) => pageSlug(f.path)).length;
  console.log(
    `Docs: every design and README reference resolves (${files.length} files read, ` +
      `${pages} design pages).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
