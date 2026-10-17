/**
 * The plugin must work for anyone, so no text may name the organization that hosts it.
 * The forbidden words come from the two manifests themselves, never from this script:
 * the owner in plugin.json's `repository`, and the marketplace's `owner.name`.
 *
 * Checked: every file git tracks, plus new files it does not ignore — its path, and its text.
 * A file with a NUL byte is read too, never skipped (ST-11): as UTF-16 in both byte orders (a
 * file a Windows tool saved), and as bytes (a name inside a binary file's metadata).
 * Not checked:
 * - the two manifests: publisher metadata is the one place the name belongs;
 * - bun.lock: written by bun;
 * - plugin/dist/: built from src/ (checked here) plus values baked in from the manifests.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRepository } from "../src/build-info/manifest";

/**
 * The texts a file's bytes may hold. Without a NUL byte: its UTF-8. With one: also its UTF-16,
 * read from the first byte and from the second — the two byte orders, and a text that starts
 * at an odd offset. A UTF-8 reading of a binary file keeps every ASCII run, so a name in its
 * metadata is found too.
 */
function textsOf(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  if (!buffer.includes(0)) return [buffer.toString("utf8")];
  return [
    buffer.toString("utf8"),
    buffer.toString("utf16le"),
    buffer.subarray(1).toString("utf16le"),
  ];
}

/** Every place `file` (its path, and its bytes) names one of `words` (lower case), once each. */
export function neutralHits(file: string, bytes: Uint8Array, words: readonly string[]): string[] {
  const hits = new Set<string>();
  const path = file.toLowerCase();
  for (const word of words) {
    if (path.includes(word)) hits.add(`${file}: its path names "${word}"`);
  }
  for (const text of textsOf(bytes)) {
    text.split("\n").forEach((line, index) => {
      const lower = line.toLowerCase();
      for (const word of words) {
        if (lower.includes(word)) hits.add(`${file}:${index + 1}: names "${word}"`);
      }
    });
  }
  return [...hits];
}

const repoRoot = join(import.meta.dir, "..");
const MARKETPLACE_MANIFEST = ".claude-plugin/marketplace.json";
const PLUGIN_MANIFEST = "plugin/.claude-plugin/plugin.json";
const SKIPPED_FILES = new Set([MARKETPLACE_MANIFEST, PLUGIN_MANIFEST, "bun.lock"]);
const SKIPPED_FOLDERS = ["plugin/dist/"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as Record<string, unknown>;
}

/** The names to keep out of the text, lower case. */
function forbiddenWords(): string[] {
  const words = new Set<string>();
  const repository = readJson(PLUGIN_MANIFEST).repository;
  if (typeof repository === "string") {
    const [owner] = parseRepository(repository).split("/");
    if (owner) words.add(owner.toLowerCase());
  }
  const owner = readJson(MARKETPLACE_MANIFEST).owner as { name?: unknown } | undefined;
  if (typeof owner?.name === "string" && owner.name.trim() !== "") {
    words.add(owner.name.trim().toLowerCase());
  }
  return [...words];
}

function listFiles(): string[] {
  const result = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  return [...new Set(result.stdout.toString().split("\0").filter(Boolean))].sort();
}

function main(): number {
  const words = forbiddenWords();
  if (words.length === 0) {
    console.error(`No names found in ${PLUGIN_MANIFEST} or ${MARKETPLACE_MANIFEST}.`);
    return 1;
  }
  const hits: string[] = [];
  for (const file of listFiles()) {
    if (SKIPPED_FILES.has(file) || SKIPPED_FOLDERS.some((folder) => file.startsWith(folder))) {
      continue;
    }
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue; // deleted, not yet committed
    hits.push(...neutralHits(file, readFileSync(path), words));
  }
  if (hits.length > 0) {
    console.error(hits.join("\n"));
    console.error(
      "Keep the plugin neutral: a project's own facts belong in its .claude/cc-smart-dev-kit.json, not here.",
    );
    return 1;
  }
  console.log(`Neutral: no file names ${words.length === 1 ? "the owner" : "the owners"}.`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
