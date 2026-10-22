/**
 * The `scripts` names of a folder's `package.json`, for the classifier (`classify.ts`).
 *
 * The classifier stays pure: it reads no file itself, and takes this as an injected reader
 * (`ScriptSource`). The reader runs once per folder in a line, because the classifier caches
 * what it returns for the length of one run.
 *
 * Anything but a `package.json` it can read gives null: no file, a file that is not JSON, or a
 * `scripts` that is not an object. Null means the classifier keeps its old answer — the word
 * is the tool of that name — so a project with a broken file is treated as one with no file,
 * never as one whose scripts are all gone.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The names in `folder`'s `package.json` `scripts`; an empty set when it has no scripts. */
export function packageScripts(folder: string): ReadonlySet<string> | null {
  let text: string;
  try {
    text = readFileSync(join(folder, "package.json"), "utf8");
  } catch {
    return null; // No package.json there (or no folder): the tool, as before.
  }
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
  if (scripts === undefined) return new Set();
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return null;
  return new Set(Object.keys(scripts));
}
