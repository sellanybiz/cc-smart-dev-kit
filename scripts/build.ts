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

const repoRoot = join(import.meta.dir, "..");
const entriesDir = join(repoRoot, "src", "entries");
const distDir = join(repoRoot, "plugin", "dist");
// The bundles carry source-path comments relative to the working folder: pin it.
process.chdir(repoRoot);

function entryPoints(): string[] {
  return readdirSync(entriesDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(entriesDir, name));
}

async function buildInto(outdir: string): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: entryPoints(),
    outdir,
    root: entriesDir,
    target: "bun",
    format: "esm",
    minify: false,
    naming: "[name].js",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("The build failed.");
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

if (process.argv.includes("--check")) {
  const temp = mkdtempSync(join(tmpdir(), "cc-agentic-build-"));
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
