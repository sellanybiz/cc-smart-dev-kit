import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWrite,
  realTarget,
  retryOnConcurrentChange,
  type WriteResult,
  writeManagedFile,
} from "./write";

/** A key inside a JSON file, as its path of segments: ["extraKnownMarketplaces", "anymodel", "autoUpdate"]. */
export type KeyPath = readonly string[];

/** The keys anymodel owns, per file: `<stateDir>/owned.json`. */
const OWNED_FILE = "owned.json";

type JsonObject = Record<string, unknown>;
type OwnedState = Record<string, string[][]>;

export interface JsonChange {
  path: KeyPath;
  before: unknown;
  after: unknown;
}

export interface ManagedJsonOptions {
  file: string;
  stateDir: string;
  /** Keys to set, with their values. */
  set?: ReadonlyArray<readonly [KeyPath, unknown]>;
  /** Keys to remove. Only keys anymodel owns are removed. */
  remove?: readonly KeyPath[];
  dryRun?: boolean;
  /** Tests only: runs after the read and before the write, to play another program's write. */
  onBeforeWrite?: () => void;
}

export interface ManagedJsonResult {
  file: string;
  changes: JsonChange[];
  /** Keys left alone, with the reason. */
  skipped: { path: KeyPath; reason: string }[];
  written: boolean;
  /** The backup made before the write, or null when nothing was written. */
  backup: string | null;
}

/** Thrown when a change would overwrite a key anymodel does not own. Nothing is written. */
export class ForeignKeyError extends Error {
  override name = "ForeignKeyError";
}

/** `extraKnownMarketplaces.anymodel.autoUpdate`; a segment that is not a name: `env["my-key"]` */
export function formatKeyPath(path: KeyPath): string {
  return path
    .map((segment, index) => {
      if (/^[A-Za-z_$][\w$]*$/.test(segment)) return index === 0 ? segment : `.${segment}`;
      return `[${JSON.stringify(segment)}]`;
    })
    .join("");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePath(a: KeyPath, b: KeyPath): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/** The file's object, its indent, and the exact text read (null: no file), for the race check. */
function readJsonObject(file: string): { data: JsonObject; indent: string; text: string | null } {
  if (!existsSync(file)) return { data: {}, indent: "  ", text: null };
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return { data: {}, indent: "  ", text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject(parsed)) throw new Error(`${file} must hold a JSON object.`);
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  return { data: parsed, indent, text };
}

function readOwned(stateDir: string): OwnedState {
  const file = join(stateDir, OWNED_FILE);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(parsed)) throw new Error(`Invalid ${file}: expected an object`);
  return parsed as OwnedState;
}

function writeOwned(stateDir: string, owned: OwnedState): void {
  atomicWrite(join(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}\n`, 0o600);
}

/** The keys anymodel owns in `file` (its real path), from owned.json. */
export function ownedKeys(stateDir: string, file: string): KeyPath[] {
  return readOwned(stateDir)[file] ?? [];
}

/** Reads a key; `found` is false when any segment is missing. */
function getKey(data: JsonObject, path: KeyPath): { found: boolean; value: unknown } {
  let node: unknown = data;
  for (const segment of path) {
    if (!isObject(node) || !Object.hasOwn(node, segment)) return { found: false, value: undefined };
    node = node[segment];
  }
  return { found: true, value: node };
}

function setKey(data: JsonObject, path: KeyPath, value: unknown): void {
  let node = data;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const next = node[segment];
    if (next === undefined) {
      node[segment] = {};
    } else if (!isObject(next)) {
      throw new ForeignKeyError(
        `Cannot set ${formatKeyPath(path)}: ${formatKeyPath(path.slice(0, index + 1))} is not an object.`,
      );
    }
    node = node[segment] as JsonObject;
  }
  const leaf = path.at(-1);
  if (leaf !== undefined) node[leaf] = structuredClone(value);
}

function deleteKey(data: JsonObject, path: KeyPath): void {
  const parent = getKey(data, path.slice(0, -1));
  const leaf = path.at(-1);
  if (parent.found && isObject(parent.value) && leaf !== undefined) delete parent.value[leaf];
}

/**
 * Sets or removes the keys anymodel owns in a JSON settings file.
 *
 * - Every other key stays as it is, and the file keeps its mode.
 * - A key that exists with another value and is not owned is never overwritten:
 *   the call throws ForeignKeyError and writes nothing.
 * - A key that already has the wanted value but is not owned is left alone, unowned.
 * - No change means no write: no backup, no new file.
 * - Just before the rename, the file is compared with the text we read. When another
 *   program (Claude Code) wrote it in between, nothing is written: we read again and redo
 *   ours, up to 3 times. This narrows the window in which its change could be lost; it
 *   does not close it.
 * - Which keys are ours comes from one owned.json snapshot, taken before the first try.
 *   A failed try writes that snapshot back, so a key another program set in between is
 *   never taken as ours on the next try.
 */
export function applyManagedJson(options: ManagedJsonOptions): ManagedJsonResult {
  const file = realTarget(options.file);
  const snapshot = readOwned(options.stateDir);
  return retryOnConcurrentChange(file, () => applyOnce(file, options, snapshot));
}

function applyOnce(
  file: string,
  options: ManagedJsonOptions,
  owned: OwnedState,
): ManagedJsonResult {
  const { data, indent, text } = readJsonObject(file);
  const ownedHere: string[][] = (owned[file] ?? []).map((path) => [...path]);
  const isOwned = (path: KeyPath) => ownedHere.some((entry) => samePath(entry, path));

  const changes: JsonChange[] = [];
  const skipped: { path: KeyPath; reason: string }[] = [];
  const claimed: string[][] = [];
  const released: string[][] = [];

  for (const [path, value] of options.set ?? []) {
    if (path.length === 0) throw new Error("applyManagedJson: an empty key path");
    const current = getKey(data, path);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      if (!isOwned(path)) skipped.push({ path, reason: "already set by someone else; left alone" });
      continue;
    }
    if (current.found && !isOwned(path)) {
      throw new ForeignKeyError(
        `${file}: ${formatKeyPath(path)} is ${JSON.stringify(current.value)}, set by someone else. ` +
          "anymodel does not overwrite it. Remove it by hand if anymodel should manage it.",
      );
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
    if (!isOwned(path)) claimed.push([...path]);
  }

  for (const path of options.remove ?? []) {
    if (!isOwned(path)) {
      skipped.push({ path, reason: "not owned by anymodel; left alone" });
      continue;
    }
    released.push([...path]);
    const current = getKey(data, path);
    if (!current.found) continue;
    deleteKey(data, path);
    changes.push({ path, before: current.value, after: undefined });
  }

  const ownedChanged = claimed.length > 0 || released.length > 0;
  if (options.dryRun || (changes.length === 0 && !ownedChanged)) {
    return { file, changes, skipped, written: false, backup: null };
  }

  const finalOwned = [...ownedHere, ...claimed].filter(
    (entry) => !released.some((path) => samePath(path, entry)),
  );
  // Claim first: if the process dies during the write, the next run still knows the key is ours.
  if (claimed.length > 0)
    writeOwned(options.stateDir, { ...owned, [file]: [...ownedHere, ...claimed] });
  let written = false;
  let backup: string | null = null;
  if (changes.length > 0) {
    options.onBeforeWrite?.();
    let result: WriteResult;
    try {
      result = writeManagedFile(file, `${JSON.stringify(data, null, indent)}\n`, {
        stateDir: options.stateDir,
        kind: "json-keys",
        newFileMode: 0o600,
        expectedContent: text,
      });
    } catch (error) {
      // The file was not written: give back this try's claim (owned.json as in the snapshot).
      if (claimed.length > 0) writeOwned(options.stateDir, owned);
      throw error;
    }
    written = result.outcome !== "unchanged";
    backup = result.backup;
  }
  if (released.length > 0 || claimed.length > 0) {
    const next: OwnedState = { ...owned, [file]: finalOwned };
    if (finalOwned.length === 0) delete next[file];
    writeOwned(options.stateDir, next);
  }
  return { file, changes, skipped, written, backup };
}
