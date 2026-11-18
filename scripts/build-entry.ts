/**
 * How one bundle is built: the one home of the `Bun.build` options, for `scripts/build.ts` and
 * for a test that needs a bundle (`src/tasks/release-check-ci.test.ts`). No side effects at
 * the top level, so importing it builds nothing.
 */
import { join } from "node:path";

/** `src/entries`: each `<name>.ts` here becomes the bundle `<name>.js`. */
export const ENTRIES_DIR = join(import.meta.dir, "..", "src", "entries");

/**
 * Builds one entry into `<outdir>/<name>.js`: target bun, ESM, not minified, one flat folder.
 * Each entry is built on its own, never together with the others (see `scripts/build.ts`).
 */
export async function buildEntry(entry: string, outdir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    root: ENTRIES_DIR,
    target: "bun",
    format: "esm",
    minify: false,
    naming: "[name].js",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`The build of ${entry} failed.`);
  }
}
