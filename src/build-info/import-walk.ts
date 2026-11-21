import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The one import walk: every file `entry` loads, found from its source. A test uses it to prove
 * what a bundle reaches (`src/hooks/entries.test.ts`, `src/cli/ui/out.test.ts`,
 * `src/cli/setup-claude-default.test.ts`), and the parser's build fingerprint uses it to hash
 * the code a hook's cache entry depends on (`parser-fingerprint.ts`). `Bun.Transpiler` reads the
 * imports from the real code, so a type-only import is dropped the way the bundle drops it.
 *
 * Relative imports only: a package is not ours to walk. A relative import that names no file
 * throws, so a hole never reads as "nothing reached".
 */

/** A macro import (`src/build-info/`) runs at build time; read here, it is a plain import. */
const MACRO_ATTRIBUTE = /\bwith\s*\{\s*type:\s*"macro"\s*\}/g;

/** The files a source file imports by a relative path, resolved to absolute files. */
function importsOf(file: string, transpiler: Bun.Transpiler): string[] {
  const source = readFileSync(file, "utf8").replace(MACRO_ATTRIBUTE, "");
  return transpiler
    .scanImports(source)
    .map((one) => one.path)
    .filter((path) => path.startsWith("."))
    .map((path) => {
      const base = resolve(dirname(file), path);
      const found = [base, `${base}.ts`, join(base, "index.ts")].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (found === undefined) throw new Error(`${file} imports ${path}, which is not a file`);
      return found;
    });
}

/**
 * Every file `entry` reaches through its relative imports, itself included, as absolute paths.
 * Only a TypeScript file is read for imports; any other file it names (a data file) is reached
 * but not walked.
 */
export function reachableFiles(entry: string): Set<string> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const queue = [resolve(entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".ts")) queue.push(...importsOf(file, transpiler));
  }
  return seen;
}
