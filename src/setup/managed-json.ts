import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWrite,
  realTarget,
  retryOnConcurrentChange,
  type WriteResult,
  writeManagedFile,
} from "./write";

/** A key inside a JSON file, as its path of segments: ["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"]. */
export type KeyPath = readonly string[];

/** The keys cc-smart-dev-kit owns, per file: `<stateDir>/owned.json`. */
const OWNED_FILE = "owned.json";

export type JsonObject = Record<string, unknown>;

/**
 * One key cc-smart-dev-kit owns, and the value it wrote there: `value`, or, for a secret, only
 * `sha256` (the SHA-256 of the value as JSON), never the secret itself. A record with
 * neither comes from an owned.json written before values were kept, or is the claim made
 * just before a write: it counts as owned whatever the key holds, as before.
 */
export interface OwnedRecord {
  path: string[];
  value?: unknown;
  sha256?: string;
}

/** owned.json in memory: each file's records. On disk, an older entry is only a path. */
type OwnedState = Record<string, OwnedRecord[]>;

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
  /** Keys to remove. Only keys cc-smart-dev-kit owns, and that still hold its value, are removed. */
  remove?: readonly KeyPath[];
  dryRun?: boolean;
  /**
   * A value that means "nobody chose this yet" (a program's own default, written into the
   * file by that program): such a key is not someone else's, so cc-smart-dev-kit may take it.
   * Restore then removes it, and the program falls back to its default again.
   */
  unchosen?: (path: KeyPath, value: unknown) => boolean;
  /**
   * A key whose value must never be printed (an API key): errors say "a secret" instead,
   * owned.json keeps only its hash, and a write that sets it leaves the file at mode 600.
   */
  secret?: (path: KeyPath) => boolean;
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

/** Thrown when a change would overwrite a key cc-smart-dev-kit does not own. Nothing is written. */
export class ForeignKeyError extends Error {
  override name = "ForeignKeyError";
}

/** `extraKnownMarketplaces.cc-smart-dev-kit.autoUpdate`; a segment that is not a name: `env["my-key"]` */
export function formatKeyPath(path: KeyPath): string {
  return path
    .map((segment, index) => {
      if (/^[A-Za-z_$][\w$]*$/.test(segment)) return index === 0 ? segment : `.${segment}`;
      return `[${JSON.stringify(segment)}]`;
    })
    .join("");
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePath(a: KeyPath, b: KeyPath): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/** The file's object, its indent, and the exact text read (null: no file), for the race check. */
export function readJsonObject(file: string): {
  data: JsonObject;
  indent: string;
  text: string | null;
} {
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

/** One entry of owned.json as a record: an older entry is only its path. */
function toRecord(entry: unknown, file: string): OwnedRecord {
  if (Array.isArray(entry) && entry.every((segment) => typeof segment === "string")) {
    return { path: [...entry] };
  }
  if (
    isObject(entry) &&
    Array.isArray(entry.path) &&
    entry.path.every((segment) => typeof segment === "string")
  ) {
    const record: OwnedRecord = { path: [...(entry.path as string[])] };
    if (Object.hasOwn(entry, "value")) record.value = entry.value;
    if (typeof entry.sha256 === "string") record.sha256 = entry.sha256;
    return record;
  }
  throw new Error(`Invalid ${file}: an owned key that is neither a path nor a record`);
}

function readOwned(stateDir: string): OwnedState {
  const file = join(stateDir, OWNED_FILE);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(parsed)) throw new Error(`Invalid ${file}: expected an object`);
  const owned: OwnedState = {};
  for (const [target, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries)) throw new Error(`Invalid ${file}: expected a list per file`);
    owned[target] = entries.map((entry) => toRecord(entry, file));
  }
  return owned;
}

function writeOwned(stateDir: string, owned: OwnedState): void {
  atomicWrite(join(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}\n`, 0o600);
}

/** The keys cc-smart-dev-kit owns in `file` (its real path), from owned.json. */
export function ownedKeys(stateDir: string, file: string): KeyPath[] {
  return ownedRecords(stateDir, file).map((record) => record.path);
}

/** The keys cc-smart-dev-kit owns in `file` (its real path), with the value it wrote. */
export function ownedRecords(stateDir: string, file: string): OwnedRecord[] {
  return readOwned(stateDir)[file] ?? [];
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The record cc-smart-dev-kit keeps for a key it just wrote: the value, or only its hash. */
function recordOf(path: KeyPath, value: unknown, secret: boolean): OwnedRecord {
  return secret ? { path: [...path], sha256: hashOf(value) } : { path: [...path], value };
}

/**
 * Whose key is it now?
 * - `none`: cc-smart-dev-kit does not own it.
 * - `ours`: cc-smart-dev-kit owns it, and it holds what cc-smart-dev-kit wrote: the recorded value, a
 *   program's own default (`unchosen`), or nothing at all; or the record keeps no value.
 * - `changed`: cc-smart-dev-kit owned it, but it holds another value now: the person's choice.
 */
export function ownership(
  records: readonly OwnedRecord[],
  path: KeyPath,
  current: { found: boolean; value: unknown },
  unchosen?: (path: KeyPath, value: unknown) => boolean,
): "none" | "ours" | "changed" {
  const record = records.find((entry) => samePath(entry.path, path));
  if (record === undefined) return "none";
  if (!current.found) return "ours";
  if (record.sha256 !== undefined) {
    if (hashOf(current.value) === record.sha256) return "ours";
  } else if (!Object.hasOwn(record, "value")) {
    return "ours";
  } else if (Bun.deepEquals(current.value, record.value, true)) {
    return "ours";
  }
  return unchosen?.(path, current.value) ? "ours" : "changed";
}

/** Reads a key; `found` is false when any segment is missing. */
export function getKey(data: JsonObject, path: KeyPath): { found: boolean; value: unknown } {
  let node: unknown = data;
  for (const segment of path) {
    if (!isObject(node) || !Object.hasOwn(node, segment)) return { found: false, value: undefined };
    node = node[segment];
  }
  return { found: true, value: node };
}

export function setKey(data: JsonObject, path: KeyPath, value: unknown): void {
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

export function deleteKey(data: JsonObject, path: KeyPath): void {
  const parent = getKey(data, path.slice(0, -1));
  const leaf = path.at(-1);
  if (parent.found && isObject(parent.value) && leaf !== undefined) delete parent.value[leaf];
}

/**
 * Sets or removes the keys cc-smart-dev-kit owns in a JSON settings file.
 *
 * - Every other key stays as it is, and the file keeps its mode (a write that sets a
 *   `secret` key leaves it at 600).
 * - A key that exists with another value and is not owned is never overwritten:
 *   the call throws ForeignKeyError and writes nothing.
 * - An owned key keeps the value cc-smart-dev-kit wrote, in owned.json. When the key holds
 *   another value now (and not a program's own default), the person changed it: it is
 *   theirs. Setting it throws ForeignKeyError like any foreign key; removing it leaves it
 *   and gives up the ownership.
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
  const ownedHere: OwnedRecord[] = owned[file] ?? [];
  const isSecret = (path: KeyPath) => options.secret?.(path) ?? false;
  const shown = (path: KeyPath, value: unknown) =>
    isSecret(path) ? "a secret" : JSON.stringify(value);

  const changes: JsonChange[] = [];
  const skipped: { path: KeyPath; reason: string }[] = [];
  // The records after this call: a key set gets its new record, a key dropped goes.
  const updated: OwnedRecord[] = [];
  const dropped: KeyPath[] = [];
  let setsSecret = false;

  for (const [path, value] of options.set ?? []) {
    if (path.length === 0) throw new Error("applyManagedJson: an empty key path");
    if (isSecret(path)) setsSecret = true;
    const current = getKey(data, path);
    const whose = ownership(ownedHere, path, current, options.unchosen);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      if (whose === "none") {
        skipped.push({ path, reason: "already set by someone else; left alone" });
      } else if (whose === "changed") {
        // The person set it to this value themselves: it is theirs now.
        skipped.push({
          path,
          reason: "set by you since; left alone, no longer cc-smart-dev-kit's",
        });
        dropped.push(path);
      } else {
        // Ours: keep the value in the record (an older record, or a program's default, has none).
        updated.push(recordOf(path, value, isSecret(path)));
      }
      continue;
    }
    if (current.found && whose === "changed") {
      throw new ForeignKeyError(
        `${file}: ${formatKeyPath(path)} is ${shown(path, current.value)}: it was changed after cc-smart-dev-kit set it, so it is your choice now. ` +
          "cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it again.",
      );
    }
    if (current.found && whose === "none" && !options.unchosen?.(path, current.value)) {
      throw new ForeignKeyError(
        `${file}: ${formatKeyPath(path)} is ${shown(path, current.value)}, set by someone else. ` +
          "cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it.",
      );
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
    updated.push(recordOf(path, value, isSecret(path)));
  }

  for (const path of options.remove ?? []) {
    const current = getKey(data, path);
    const whose = ownership(ownedHere, path, current);
    if (whose === "none") {
      skipped.push({ path, reason: "not owned by cc-smart-dev-kit; left alone" });
      continue;
    }
    dropped.push(path);
    if (whose === "changed") {
      skipped.push({ path, reason: "changed since cc-smart-dev-kit set it; left alone" });
      continue;
    }
    if (!current.found) continue;
    deleteKey(data, path);
    changes.push({ path, before: current.value, after: undefined });
  }

  const touched = (entry: OwnedRecord) =>
    updated.some((record) => samePath(record.path, entry.path)) ||
    dropped.some((path) => samePath(path, entry.path));
  const finalOwned = [...ownedHere.filter((entry) => !touched(entry)), ...updated];
  const ownedChanged = !Bun.deepEquals(
    [...finalOwned].sort(byPath),
    [...ownedHere].sort(byPath),
    true,
  );
  if (options.dryRun || (changes.length === 0 && !ownedChanged)) {
    return { file, changes, skipped, written: false, backup: null };
  }

  const nextState = (records: OwnedRecord[]): OwnedState => {
    const next: OwnedState = { ...owned, [file]: records };
    if (records.length === 0) delete next[file];
    return next;
  };
  // Claim first, with no value: if the process dies during the write, the next run still
  // knows the key is ours, whatever value it holds by then.
  const changedPaths = changes.filter((change) => change.after !== undefined);
  if (changedPaths.length > 0) {
    const pending = [
      ...ownedHere.filter((entry) => !changedPaths.some((c) => samePath(c.path, entry.path))),
      ...changedPaths.map((change) => ({ path: [...change.path] })),
    ];
    writeOwned(options.stateDir, nextState(pending));
  }
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
        // A secret in the file: only its owner may read it.
        ...(setsSecret && { mode: 0o600 }),
        expectedContent: text,
      });
    } catch (error) {
      // The file was not written: give back this try's claims (owned.json as in the snapshot).
      if (changedPaths.length > 0) writeOwned(options.stateDir, owned);
      throw error;
    }
    written = result.outcome !== "unchanged";
    backup = result.backup;
  }
  writeOwned(options.stateDir, nextState(finalOwned));
  return { file, changes, skipped, written, backup };
}

function byPath(a: OwnedRecord, b: OwnedRecord): number {
  const left = JSON.stringify(a.path);
  const right = JSON.stringify(b.path);
  return left < right ? -1 : left > right ? 1 : 0;
}
