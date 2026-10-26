/**
 * The portal's Next.js export, shipped inside the plugin (D49, B6p).
 *
 *   bun scripts/portal-export.ts          build portal/out, then copy it into plugin/portal-ui/
 *   bun scripts/portal-export.ts --check  build it, then fail when plugin/portal-ui differs
 *
 * **Separate from `bun run build` on purpose.** The Next build needs `portal/node_modules` — a
 * checkout or CI installs it with `bun install --frozen-lockfile` inside `portal/` — and it
 * takes far longer than bundling `src/entries/`. A developer who only changes `src/` must not
 * need React's dependencies, and every build must not pay for the Next build. So the step is
 * its own script and CI proves it current in its own job (`.github/workflows/ci.yml`).
 *
 * **The check is a plain file compare, because the export is reproducible.** Next makes a
 * build id at random, so two builds differ; `portal/next.config.ts` fixes it
 * (`generateBuildId`), and with it a second build is byte for byte the same (tested: build
 * twice, `diff -r` is empty). So a stale export, a hand edit and a file the build no longer
 * writes are all caught, with no recorded hash to fall out of step.
 *
 * **Build it on Linux.** Next's compiler for Windows minifies the same source to other bytes
 * (seen with Next 16.4.2: other names in the runtime chunk, `main-*.js`), so an export built on
 * Windows fails CI's compare, and `--check` on Windows reports a difference CI would not. On
 * Windows the script says so after it builds.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { setFileMode } from "../src/setup/file-mode";

const repoRoot = join(import.meta.dir, "..");
const portalDir = join(repoRoot, "portal");
/** Where `next build --webpack` writes the export (`output: "export"`). */
const outDir = join(portalDir, "out");
/** What reaches a machine: Claude Code copies `plugin/`, and the portal runs from a copy. */
const pluginUiDir = join(repoRoot, "plugin", "portal-ui");

/** Said on Windows after a build: its bytes are not CI's (header). */
const WINDOWS_NOTE =
  "! Built on Windows: Next's compiler there gives other bytes than CI's Linux build, so CI's " +
  "check:portal fails on this export. Build it on Linux, or in a Linux container with the Bun of " +
  "the bun-version in .github/workflows/ci.yml: copy the repo in, never mount portal/node_modules.";

/** The Next build's own limit: a slow CI machine still finishes. */
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

/** Every file under `folder`, as relative paths with `/`, sorted. */
function listFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/** The portal's own dependencies: the Next build cannot run without them. */
function checkDependencies(): string | null {
  if (existsSync(join(portalDir, "node_modules", "next", "package.json"))) return null;
  return `The portal's dependencies are not installed. Run: cd portal && bun install --frozen-lockfile`;
}

/** Runs the portal's own build (`next build --webpack`, then `scripts/csp-hashes.ts`). */
function build(): string | null {
  const result = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: portalDir,
    stderr: "inherit",
    stdout: "inherit",
    timeout: BUILD_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return `The portal's build failed (exit ${result.exitCode ?? "signal"}).`;
  }
  if (!existsSync(join(outDir, "index.html"))) {
    return `The portal's build wrote no export (${join(outDir, "index.html")} is missing).`;
  }
  return null;
}

/** Copies the export into `plugin/portal-ui/`, replacing what is there: build output, whole. */
function copyExport(): void {
  rmSync(pluginUiDir, { force: true, recursive: true });
  for (const file of listFiles(outDir)) {
    const to = join(pluginUiDir, ...file.split("/"));
    mkdirSync(dirname(to), { recursive: true, mode: 0o755 });
    writeFileSync(to, readFileSync(join(outDir, ...file.split("/"))), { mode: 0o644 });
    setFileMode(to, 0o644); // the umask may have changed the bits
  }
}

/** The differences between the fresh export and the committed one, for `--check`. */
function differences(): string[] {
  const problems: string[] = [];
  const fresh = listFiles(outDir);
  const have = existsSync(pluginUiDir) ? listFiles(pluginUiDir) : [];
  for (const file of fresh) {
    if (!have.includes(file)) problems.push(`missing: plugin/portal-ui/${file}`);
    else if (
      !readFileSync(join(outDir, ...file.split("/"))).equals(
        readFileSync(join(pluginUiDir, ...file.split("/"))),
      )
    ) {
      problems.push(`out of date: plugin/portal-ui/${file}`);
    }
  }
  for (const file of have) {
    if (!fresh.includes(file)) problems.push(`not built from portal/: plugin/portal-ui/${file}`);
  }
  return problems;
}

const missing = checkDependencies();
if (missing !== null) {
  console.error(missing);
  process.exitCode = 1;
} else {
  const failed = build();
  if (failed !== null) {
    console.error(failed);
    process.exitCode = 1;
  } else if (process.argv.includes("--check")) {
    const problems = differences();
    if (problems.length > 0) {
      console.error(
        `${problems.slice(0, 20).join("\n")}${problems.length > 20 ? `\n… and ${problems.length - 20} more` : ""}\n` +
          "The export is stale. Run: bun run build:portal, then commit plugin/portal-ui.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `plugin/portal-ui is up to date (${listFiles(pluginUiDir).length} files from the portal's build).`,
      );
    }
  } else {
    copyExport();
    console.log(
      `Built plugin/portal-ui (${listFiles(pluginUiDir).length} files from the portal's build).`,
    );
  }
  if (failed === null && process.platform === "win32") console.error(WINDOWS_NOTE);
}
