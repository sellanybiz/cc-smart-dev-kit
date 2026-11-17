/**
 * What the classifier (`classify.ts`) reads from the machine: the `scripts` of a folder's
 * `package.json`, and whether a word names a file.
 *
 * The classifier stays pure: it reads no file itself, and takes these as injected readers
 * (`ScriptSource`, `WeightSource`). The script reader runs once per folder in a line, because the
 * classifier caches what it returns for the length of one run.
 *
 * Anything but a `package.json` it can use gives null: no file, a file that is not JSON, or a
 * `scripts` that is not an object. Null means the classifier keeps its old answer — the word
 * is the tool of that name — so a project with a broken file is treated as one with no file,
 * never as one whose scripts are all gone.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ScriptBodies } from "./classify";

/** Read errors that mean "no package.json in this folder": the search goes on above it. */
const NO_FILE_HERE = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

/**
 * `start` and the folders above it, up to and including the checkout root (the folder holding
 * `.git`, a folder or a linked worktree's file) and never above it. With no checkout root
 * above, only `start`: nothing proves where the project ends.
 */
function foldersToCheckoutRoot(start: string): string[] {
  const chain: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    chain.push(dir);
    if (existsSync(join(dir, ".git"))) return chain;
    if (dirname(dir) === dir) return [start];
  }
}

/**
 * The `scripts` of the nearest `package.json` from `folder` up to the checkout root, as the
 * package managers find it: each name with its body, bodies that are no string dropped, and the
 * folder that file is in (`ScriptBodies.folder`: the folder a script runs in). An empty map when
 * the file has no `scripts`; null when no file is found, or the nearest one cannot be used.
 */
export function packageScripts(folder: string): ScriptBodies | null {
  for (const dir of foldersToCheckoutRoot(resolve(folder))) {
    let text: string;
    try {
      text = readFileSync(join(dir, "package.json"), "utf8");
    } catch (error) {
      if (NO_FILE_HERE.has((error as NodeJS.ErrnoException).code ?? "")) continue;
      return null; // A file it may not read: the tool, as before.
    }
    return scriptsOf(text, dir);
  }
  return null; // No package.json (or no folder): the tool, as before.
}

/** The map of one `package.json`'s text; null for a file the classifier cannot use. */
function scriptsOf(text: string, folder: string): ScriptBodies | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // Not JSON: the classifier keeps its old answer.
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const scripts = (parsed as { scripts?: unknown }).scripts;
  // No `scripts` key at all is a real answer: this project defines no script, so the name is
  // the package manager's `node_modules/.bin` tool.
  const bodies = new Map<string, string>();
  if (scripts !== undefined) {
    if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return null;
    for (const [name, body] of Object.entries(scripts)) {
      if (typeof body === "string") bodies.set(name, body);
    }
  }
  return Object.assign(bodies, { folder, yarnBerry: usesYarnBerry(parsed, folder) });
}

/**
 * True when the project uses Yarn 2 or newer (berry): its `packageManager` field says `yarn@2`
 * or newer, or a `.yarnrc.yml` is there. Berry runs no `pre` or `post` script of a script;
 * classic yarn does. In a workspace both usually sit at the project's root, not beside a
 * package's own `package.json`, so the folders up to the checkout root count too: the nearest
 * `packageManager` field decides, and a `.yarnrc.yml` on the way says berry.
 */
function usesYarnBerry(packageJson: object, folder: string): boolean {
  let json: object | null = packageJson;
  for (const dir of foldersToCheckoutRoot(folder)) {
    if (existsSync(join(dir, ".yarnrc.yml"))) return true;
    json ??= packageJsonAt(dir);
    const manager = (json as { packageManager?: unknown } | null)?.packageManager;
    if (typeof manager === "string") return Number(/^yarn@(\d+)/.exec(manager)?.[1] ?? 0) >= 2;
    json = null;
  }
  return false;
}

/** The parsed `package.json` in `dir`, or null when there is none it can read. */
function packageJsonAt(dir: string): object | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null; // No file, or not JSON: it names no package manager.
  }
}

/** True when `word` names a file (not a folder) from `folder`; anything that cannot be read is no file. */
export function fileExistsIn(folder: string, word: string): boolean {
  try {
    return statSync(resolve(folder, word)).isFile();
  } catch {
    return false;
  }
}
