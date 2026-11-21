/**
 * Bundles each src/entries/*.ts into plugin/dist/<name>.js (target bun, not minified).
 * The bundles are committed: only plugin/ reaches machines, with no install step.
 *
 *   bun scripts/build.ts          rebuild plugin/dist
 *   bun scripts/build.ts --check  build into a temp folder; exit 1 when plugin/dist differs
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEntry, entryPoints } from "./build-entry";

const repoRoot = join(import.meta.dir, "..");
const distDir = join(repoRoot, "plugin", "dist");
// The bundles carry source-path comments relative to the working folder: pin it.
process.chdir(repoRoot);

/**
 * One `Bun.build` per entry, never all of them in one call. Built together, the bundles
 * share one tree-shaking pass: Bun drops the unused code of a shared module (zod, say) by
 * what all the entries of that build use, so a library function one bundle starts to use is
 * then copied into every other bundle too, and `router.js` would change with code it never
 * runs. The router bundle must change only when its own code does: a changed one makes every
 * machine restart its router (`.claude/rules/bundles-and-releases.md`), so each bundle holds
 * only its own graph.
 */
async function buildInto(outdir: string): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  for (const entry of entryPoints()) await buildEntry(entry, outdir);
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

if (process.argv.includes("--check")) {
  const temp = mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-build-"));
  try {
    const fresh = join(temp, "dist");
    await buildInto(fresh);
    const want = listFiles(fresh);
    const have = listFiles(distDir);
    const problems: string[] = [];
    for (const file of want) {
      if (!have.includes(file)) problems.push(`missing: plugin/dist/${file}`);
      else if (
        readFileSync(join(fresh, file), "utf8") !== readFileSync(join(distDir, file), "utf8")
      ) {
        problems.push(`out of date: plugin/dist/${file}`);
      }
    }
    for (const file of have)
      if (!want.includes(file)) problems.push(`not built from src: plugin/dist/${file}`);
    if (problems.length > 0) {
      console.error(
        `${problems.join("\n")}\nThe bundles are stale. Run: bun run build, then commit plugin/dist.`,
      );
      // Not process.exit: the finally below must still remove the temp folder.
      process.exitCode = 1;
    } else {
      console.log(
        `plugin/dist is up to date (${want.length} bundle${want.length === 1 ? "" : "s"}).`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
} else {
  await buildInto(distDir);
  console.log(
    `Built ${listFiles(distDir)
      .map((file) => `plugin/dist/${file}`)
      .join(", ")}`,
  );
}
