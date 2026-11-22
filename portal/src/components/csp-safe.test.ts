import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The page runs under `style-src 'self'` (`.claude/rules/portal.md`), so nothing may inject a
 * `<style>` element at run time. Radix's modal parts do: `Dialog.Overlay` and a modal
 * `DropdownMenu`, `Popover` or `Select` mount `RemoveScroll`, whose scroll-bar gap is a
 * measured `<style>` that no build-time hash can cover. This guard reads the source and fails
 * on any part that would mount it, so the browser never has to find it.
 */

const SRC = join(import.meta.dir, "..");

/**
 * `ui/dialog.tsx` is shadcn's code and renders `DialogPrimitive.Overlay`. It stays as it is
 * and nothing may import it (the import rule below), so its own Overlay never renders.
 */
const OVERLAY_EXEMPT = new Set(["components/ui/dialog.tsx"]);

/** A rendered Radix Overlay: `<SheetOverlay`, `<DialogOverlay`, `<Dialog.Overlay`, `<X.Overlay`. */
const OVERLAY_TAG = /<(?:SheetOverlay|DialogOverlay|[A-Za-z]+\.Overlay)\b/g;

/** An import of the modal-only shadcn parts, by alias or by relative path. */
const MODAL_IMPORT = /from\s+["'][^"']*\/ui\/(dialog|popover)["']/g;

/** Radix Select, through the `radix-ui` package, its own package, or a shadcn `ui/select`. */
const SELECT_IMPORT =
  /import\s*\{[^}]*\bSelect\b[^}]*\}\s*from\s*["']radix-ui["']|from\s+["'](?:@radix-ui\/react-select|[^"']*\/ui\/select)["']/g;

/** `react-remove-scroll` itself, imported straight. */
const REMOVE_SCROLL_IMPORT = /from\s+["']react-remove-scroll(?:-bar)?["']/g;

/** The text of one JSX opening tag from `start` (at its `<`) to its closing `>`. */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: null | string = null;
  for (let at = start + 1; at < text.length; at++) {
    const char = text[at];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return text.slice(start, at + 1);
  }
  return text.slice(start);
}

/** The line a character offset is on, 1-based. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** What in one source file would mount `RemoveScroll`, each as `file:line what`. */
function cspViolations(file: string, text: string): string[] {
  const found: string[] = [];
  const add = (offset: number, what: string) =>
    found.push(`${file}:${lineOf(text, offset)} ${what}`);
  if (!OVERLAY_EXEMPT.has(file)) {
    for (const match of text.matchAll(OVERLAY_TAG)) {
      add(match.index, `renders ${match[0].slice(1)}, which mounts RemoveScroll`);
    }
  }
  for (const match of text.matchAll(MODAL_IMPORT)) {
    add(match.index, `imports ui/${match[1]}, a modal part that mounts RemoveScroll`);
  }
  for (const match of text.matchAll(SELECT_IMPORT)) {
    add(match.index, "imports a Radix Select, which mounts RemoveScroll; use NativeSelect");
  }
  for (const match of text.matchAll(REMOVE_SCROLL_IMPORT)) {
    add(match.index, "imports react-remove-scroll, which injects a <style>");
  }
  for (const match of text.matchAll(/<DropdownMenu(?=[\s>])/g)) {
    if (!/\bmodal=\{false\}/.test(openingTag(text, match.index))) {
      add(match.index, "renders a DropdownMenu without modal={false}, which mounts RemoveScroll");
    }
  }
  return found;
}

/** Every source file under `portal/src`, tests left out (this one names what it forbids). */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

describe("the page policy: nothing mounts RemoveScroll", () => {
  test("no source file renders an Overlay, a modal menu, a Popover, a Dialog or a Select", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);
    const found = files.flatMap((file) =>
      cspViolations(file, readFileSync(join(SRC, file), "utf8")),
    );
    expect(found).toEqual([]);
  });

  test("each rule catches its case and names the file and line", () => {
    expect(cspViolations("a.tsx", "x\n  <SheetOverlay />")).toEqual([
      "a.tsx:2 renders SheetOverlay, which mounts RemoveScroll",
    ]);
    expect(cspViolations("a.tsx", "<DialogPrimitive.Overlay className='x' />")).toHaveLength(1);
    expect(cspViolations("a.tsx", 'import { Dialog } from "@/components/ui/dialog"')).toHaveLength(
      1,
    );
    expect(cspViolations("a.tsx", 'import { Popover } from "./ui/popover"')).toHaveLength(1);
    expect(cspViolations("a.tsx", 'import { Select, Tooltip } from "radix-ui"')).toHaveLength(1);
    expect(
      cspViolations("a.tsx", 'import { RemoveScroll } from "react-remove-scroll"'),
    ).toHaveLength(1);
    expect(cspViolations("a.tsx", "<DropdownMenu>\n<DropdownMenuTrigger />")).toHaveLength(1);
    expect(
      cspViolations("a.tsx", "<DropdownMenu\n  onOpenChange={(o) => o > 1}\n  modal={true}>"),
    ).toHaveLength(1);
  });

  test("what the policy allows passes", () => {
    expect(cspViolations("a.tsx", "<DropdownMenu modal={false}>")).toEqual([]);
    expect(
      cspViolations("a.tsx", "<DropdownMenu\n  onOpenChange={(o) => o > 1}\n  modal={false}\n>"),
    ).toEqual([]);
    expect(cspViolations("a.tsx", '<div data-slot="sheet-overlay" />')).toEqual([]);
    expect(cspViolations("a.tsx", 'import { Tooltip as T } from "radix-ui"')).toEqual([]);
    expect(
      cspViolations("a.tsx", 'import { NativeSelect } from "@/components/ui/native-select"'),
    ).toEqual([]);
    expect(cspViolations("components/ui/dialog.tsx", "<DialogPrimitive.Overlay />")).toEqual([]);
  });
});
