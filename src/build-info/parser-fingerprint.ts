import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { reachableFiles } from "./import-walk";
import { buildInfo } from "./manifest";

/**
 * The parser's build fingerprint: a hash of everything that decides what the project file's
 * parser answers. A hook caches the parser's answer by the file's bytes and this fingerprint
 * (`src/hooks/checked-config.ts`), so one build never reads the answer of another, even at the
 * same plugin version. The version alone would serve an old success after a schema change that
 * was rebuilt without a version bump, and the hook would fail open.
 *
 * It covers the source of every module `src/entries/config-check.ts` reaches (found with the
 * import walk, never a typed list), the plugin version (`requires` is judged against it) and the
 * installed zod version. The hook frame and the sibling bundle both bake it in.
 *
 * `parserFingerprint` is a Bun macro (imported `with { type: "macro" }`): it runs when the code
 * is transpiled, so a bundle holds the hash only.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** The hash of every module `entry` reaches (by path under `root`, then source) and of `facts`. */
export function fingerprintOf(entry: string, root: string, facts: readonly string[] = []): string {
  const files = [...reachableFiles(entry)]
    .map((file) => ({ file, name: relative(root, file).split(sep).join("/") }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const hash = createHash("sha256");
  // A length before each part, so two different lists never make the same byte stream.
  const part = (text: string | Buffer): void => {
    hash.update(`${Buffer.byteLength(text)}:`);
    hash.update(text);
  };
  for (const fact of facts) part(fact);
  for (const { file, name } of files) {
    part(name);
    part(readFileSync(file));
  }
  return hash.digest("hex");
}

function installedZodVersion(): string {
  const file = join(REPO_ROOT, "node_modules", "zod", "package.json");
  const { version } = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
  if (typeof version !== "string") throw new Error(`${file}: no "version"`);
  return version;
}

/** The macro: the fingerprint of this repo's parser. */
export function parserFingerprint(): string {
  return fingerprintOf(join(REPO_ROOT, "src", "entries", "config-check.ts"), REPO_ROOT, [
    `plugin ${buildInfo().version}`,
    `zod ${installedZodVersion()}`,
  ]);
}
