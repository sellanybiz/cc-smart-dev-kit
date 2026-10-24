import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUserJson } from "./user-json";
import {
  atomicWrite,
  type ChangedEntry,
  listBackups,
  readChanged,
  realTarget,
  retryOnConcurrentChange,
  type WriteResult,
  writeManagedFile,
} from "./write";

/** A key inside a JSON file, as its path of segments: ["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"]. */
export type KeyPath = readonly string[];

/** The keys cc-smart-dev-kit owns, per file: `<stateDir>/owned.json`. */
const OWNED_FILE = "owned.json";

/**
 * What a release or a removal says about a taken-over secret: its value was never kept, so there
 * is nothing to write back, and the key stays exactly as it is while the claim goes. One text, so
 * the reader of `skipped` and the command that prints a line agree.
 */
export const TAKEN_SECRET_LEFT =
  "a taken-over key's value is never kept; its claim is dropped and the key stays";

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
  /**
   * The value the key held just before cc-smart-dev-kit took it over (`claim`), and it stays
   * through every later write: `restore` writes it back instead of removing the key, because
   * cc-smart-dev-kit never wrote that value. A secret's value is never kept, so a taken-over
   * key has no `was`; its `wasSha256` stands in for it.
   */
  was?: unknown;
  /**
   * A taken-over secret's hash as it was when the key was taken over. The value itself is never
   * kept, so `restore` cannot write it back; while the key still hashes to this, cc-smart-dev-kit
   * never replaced it, and a release with no value leaves the key exactly as it is. A key whose
   * hash differs is the one cc-smart-dev-kit wrote since: restore leaves that key too, and names
   * the backup that holds the earlier settings file.
   */
  wasSha256?: string;
  /**
   * True for a key cc-smart-dev-kit took over (`claim`): it holds a value cc-smart-dev-kit never
   * wrote, so the person's own value is never replaced by another (a person's key is not a
   * backend's key). A secret's is set even though its value is not kept.
   */
  taken?: boolean;
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
  /**
   * Keys to take over as cc-smart-dev-kit's own **without changing them**: each must hold exactly
   * this value now. The file is not written; the record keeps the value the key held (`was`), so
   * `restore` writes it back. A secret's value is never kept: its `wasSha256` stands in for it.
   * A key that holds another value, or is not there, is skipped in words. What stops a value the
   * person set by hand from refusing a change for ever.
   */
  claim?: ReadonlyArray<readonly [KeyPath, unknown]>;
  /**
   * Keys to give back: writes each value and drops cc-smart-dev-kit's claim, so nothing of ours is
   * left to remove and the key is the person's again. What puts a taken-over value back. A pair
   * whose value is `undefined` writes nothing: it drops the claim and leaves the key as it is,
   * which is all a taken-over secret can do (its value was never kept).
   */
  release?: ReadonlyArray<readonly [KeyPath, unknown]>;
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
  /**
   * True for an object cc-smart-dev-kit created (the file, before cc-smart-dev-kit's first change,
   * did not hold it). A removal that leaves such an object empty removes it too, so no
   * `"env": {}` is left behind. Answers false for everything by default: an object the
   * person had stays, even empty. `createdObjects` builds it from the baseline backup.
   */
  createdObject?: (path: KeyPath) => boolean;
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

/** True when two key paths name the same key. One home, for the readers of owned records. */
export function samePath(a: KeyPath, b: KeyPath): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/**
 * The indentation a JSON file uses, read from its own text: the first line that starts a key.
 * Two spaces (Claude Code's own) when there is none. One home for this, so a writer that
 * keeps a file's formatting reads the same rule.
 */
export function detectIndent(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
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
    // A byte order mark an editor put first is skipped (`user-json.ts`); `text` keeps it, so
    // the race check compares with the file exactly as read.
    parsed = parseUserJson(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject(parsed)) throw new Error(`${file} must hold a JSON object.`);
  return { data: parsed, indent: detectIndent(text), text };
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
    // The value a taken-over key held before cc-smart-dev-kit managed it: `restore` writes it
    // back, so it must survive the file (and every later write: `recordFor`).
    if (Object.hasOwn(entry, "was")) record.was = entry.was;
    // A taken-over secret's own hash: the value is never kept, and this proves whether
    // cc-smart-dev-kit replaced the key since (`release` with no value, `remove`).
    if (typeof entry.wasSha256 === "string") record.wasSha256 = entry.wasSha256;
    if (entry.taken === true) record.taken = true;
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

/** The SHA-256 of a value as JSON: how owned.json remembers a secret without keeping it. */
export function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Is `value` exactly what cc-smart-dev-kit wrote at `path` in `file`? True when it owns that key
 * and `value` matches its record: the value it kept, or, for a secret, the SHA-256 it kept
 * instead. A record that keeps neither proves nothing, so that is false. Reads `owned.json`
 * only; `value` may come from anywhere (the environment, another file), never printed.
 */
export function isOwnedValue(
  stateDir: string,
  file: string,
  path: KeyPath,
  value: unknown,
): boolean {
  const record = ownedRecords(stateDir, realTarget(file)).find((entry) =>
    samePath(entry.path, path),
  );
  if (record === undefined) return false;
  if (record.sha256 !== undefined) return hashOf(value) === record.sha256;
  return Object.hasOwn(record, "value") && Bun.deepEquals(record.value, value, true);
}

/** The record cc-smart-dev-kit keeps for a key it just wrote: the value, or only its hash. */
function recordOf(path: KeyPath, value: unknown, secret: boolean): OwnedRecord {
  return secret ? { path: [...path], sha256: hashOf(value) } : { path: [...path], value };
}

/**
 * Whose key is it now?
 * - `none`: cc-smart-dev-kit does not own it.
 * - `ours`: cc-smart-dev-kit owns it, and it holds what cc-smart-dev-kit wrote: the recorded value, a
 *   program's own default (`unchosen`), or the record keeps no value at all (an `owned.json`
 *   from before values were kept, or the claim made just before a write).
 * - `changed`: cc-smart-dev-kit owned it, but it is not cc-smart-dev-kit's any more: it holds another
 *   value now, or it is not in the file at all — the person changed it, or removed it.
 */
export function ownership(
  records: readonly OwnedRecord[],
  path: KeyPath,
  current: { found: boolean; value: unknown },
  unchosen?: (path: KeyPath, value: unknown) => boolean,
): "none" | "ours" | "changed" {
  const record = records.find((entry) => samePath(entry.path, path));
  if (record === undefined) return "none";
  // A key that is not in the file any more is the person's: cc-smart-dev-kit does not put it
  // back (`migrate` would otherwise re-add a key they deleted, or rewrite a value of theirs).
  if (!current.found) return "changed";
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
 * Deletes `path`, then each object above it that this deletion emptied **and** that
 * cc-smart-dev-kit created (`createdObject`): the object a key lived in goes with its last
 * key, up to the file's own top. An object the person had stays, even when it is empty now,
 * and so does everything above a path cc-smart-dev-kit did not create. Returns the objects it
 * removed, deepest first.
 */
export function deleteKeyAndEmptiedObjects(
  data: JsonObject,
  path: KeyPath,
  createdObject?: (path: KeyPath) => boolean,
): KeyPath[] {
  deleteKey(data, path);
  const removed: KeyPath[] = [];
  // Up from the key's own object to the first segment: never the file's top level itself.
  for (let depth = path.length - 1; depth >= 1; depth -= 1) {
    const parentPath = path.slice(0, depth);
    const parent = getKey(data, parentPath);
    if (!parent.found || !isObject(parent.value)) break;
    if (Object.keys(parent.value).length > 0) break;
    if (createdObject?.(parentPath) !== true) break;
    deleteKey(data, parentPath);
    removed.push(parentPath);
  }
  return removed;
}

/**
 * The objects in `file` cc-smart-dev-kit created, read from the baseline backup: the file just
 * before cc-smart-dev-kit's first change. A key path the baseline does not hold was not there
 * then, so cc-smart-dev-kit made it. A missing or unreadable baseline answers false for
 * everything: nothing that may be the person's is ever pruned. A `changed.json` that cannot be
 * read answers false too, with one line on stderr: this is called by read-only passes
 * (setup's, and `gateway off --dry-run`), and a record they cannot use must not fail them —
 * the command that needs the record reads it itself and reports its own error.
 */
export function createdObjects(stateDir: string, file: string): (path: KeyPath) => boolean {
  const real = realTarget(file);
  let entry: ChangedEntry | undefined;
  try {
    entry = readChanged(stateDir)[real];
  } catch (error) {
    console.error(
      `cc-smart-dev-kit: the record of changed files cannot be read (${error instanceof Error ? error.message : String(error)}), so nothing is pruned from ${real}.`,
    );
    return () => false;
  }
  const baseline =
    entry === undefined
      ? undefined
      : listBackups(stateDir, real).find((backup) => backup.path === entry.baseline);
  if (baseline === undefined) return () => false;
  // The file itself was not there before cc-smart-dev-kit: everything in it came from us.
  if (baseline.absent) return () => true;
  let before: JsonObject;
  try {
    before = readJsonObject(baseline.path).data;
  } catch {
    // A baseline that cannot be read as a JSON object proves nothing about the file.
    return () => false;
  }
  return (path) => !getKey(before, path).found;
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
 * - `claim` takes over a key that already holds exactly that value, and writes no file: the key
 *   becomes cc-smart-dev-kit's, and the record keeps the value it held (`was`), so `restore`
 *   writes that value back instead of removing a value cc-smart-dev-kit never wrote.
 * - `release` writes a value and gives the key up: the file holds it, nothing of cc-smart-dev-kit's
 *   is left there, and `restore` has nothing to remove. A key the person changed since it was
 *   taken over keeps their value: the claim goes, their change stays.
 * - An object cc-smart-dev-kit created (`createdObject`) that a removal empties goes with its
 *   last key; an object the person had stays as it is, also when it is empty.
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
  /** Keys a `release` gave back: the file gets them, nothing stays cc-smart-dev-kit's. */
  const released: KeyPath[] = [];
  let setsSecret = false;
  /**
   * A key's record as cc-smart-dev-kit writes it: what it holds there, and the value it held
   * before cc-smart-dev-kit took it over (`was`), which a later write must not forget — that
   * value is what `restore` writes back.
   */
  const recordFor = (path: KeyPath, value: unknown): OwnedRecord => {
    const held = ownedHere.find((entry) => samePath(entry.path, path));
    return {
      ...recordOf(path, value, isSecret(path)),
      ...(held?.was !== undefined && { was: held.was }),
      ...(held?.wasSha256 !== undefined && { wasSha256: held.wasSha256 }),
      ...(held?.taken === true && { taken: true }),
    };
  };

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
        updated.push(recordFor(path, value));
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
    updated.push(recordFor(path, value));
  }

  // A claim changes nothing in the file: it makes the key cc-smart-dev-kit's, keeping the value
  // it held then, so a later change may set it and `restore` writes that value back.
  for (const [path, value] of options.claim ?? []) {
    const current = getKey(data, path);
    if (!current.found || !Bun.deepEquals(current.value, value, true)) {
      skipped.push({ path, reason: "not the value it was taken over with; left alone" });
      continue;
    }
    const record = recordFor(path, value);
    record.taken = true;
    // Only a value cc-smart-dev-kit may keep: a secret's is never written down. Its hash stands in
    // for the value, so a release with no value can prove cc-smart-dev-kit never replaced it.
    if (isSecret(path)) record.wasSha256 = hashOf(value);
    else record.was = value;
    updated.push(record);
  }

  // A release writes the value back and gives the key up: nothing of cc-smart-dev-kit's is left
  // to remove, and a later setup sees the value as the person's again.
  for (const [path, value] of options.release ?? []) {
    const current = getKey(data, path);
    // A key the person changed — or took away — since cc-smart-dev-kit took it over is theirs:
    // writing the older value back would undo their own change. The claim goes with it, so a
    // later restore has nothing of ours to take out of it.
    if (ownership(ownedHere, path, current) !== "ours") {
      dropped.push(path);
      skipped.push({ path, reason: "changed since cc-smart-dev-kit managed it; left alone" });
      continue;
    }
    if (value === undefined) {
      // A release with no value gives the claim up and writes nothing. That is what a taken-over
      // secret needs: its value was never kept, so there is nothing to put back, and the key —
      // the person's own, or the one cc-smart-dev-kit wrote when they picked another — stays.
      const held = ownedHere.find((entry) => samePath(entry.path, path));
      if (held?.taken === true) {
        dropped.push(path);
        skipped.push({ path, reason: TAKEN_SECRET_LEFT });
        continue;
      }
      skipped.push({ path, reason: "no value to write back; left as it is" });
      continue;
    }
    dropped.push(path);
    released.push(path);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      skipped.push({
        path,
        reason: "already holds that value; cc-smart-dev-kit's claim is dropped",
      });
      continue;
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
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
      skipped.push({
        path,
        reason: current.found
          ? "changed since cc-smart-dev-kit set it; left alone"
          : "not in the file any more (removed since cc-smart-dev-kit set it); left alone",
      });
      continue;
    }
    if (!current.found) continue;
    // A taken-over value is not cc-smart-dev-kit's to remove. A plain one is put back, as a
    // release would; a secret's is never kept, so its key stays exactly as it is.
    const held = ownedHere.find((entry) => samePath(entry.path, path));
    if (held?.was !== undefined) {
      setKey(data, path, held.was);
      changes.push({ path, before: current.value, after: held.was });
      continue;
    }
    if (held?.wasSha256 !== undefined) {
      skipped.push({ path, reason: TAKEN_SECRET_LEFT });
      continue;
    }
    const emptied = deleteKeyAndEmptiedObjects(data, path, options.createdObject);
    changes.push({ path, before: current.value, after: undefined });
    for (const parentPath of emptied) {
      // The object went with its last key: it was cc-smart-dev-kit's, and it is empty now.
      changes.push({ path: parentPath, before: {}, after: undefined });
    }
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
  const changedPaths = changes.filter(
    (change) =>
      change.after !== undefined &&
      // A released key is given up: it is never claimed again, not even for a moment, so a
      // crash right after the write leaves it the person's.
      !released.some((path) => samePath(path, change.path)),
  );
  if (changedPaths.length > 0) {
    const pending = [
      ...ownedHere.filter((entry) => !changedPaths.some((c) => samePath(c.path, entry.path))),
      ...changedPaths.map((change) => {
        // The record is written with no value on purpose, so a crash leaves the key ours
        // whatever it holds by then; what the key was taken over with must survive that too.
        const held = ownedHere.find((entry) => samePath(entry.path, change.path));
        return {
          path: [...change.path],
          ...(held?.was !== undefined && { was: held.was }),
          ...(held?.wasSha256 !== undefined && { wasSha256: held.wasSha256 }),
          ...(held?.taken === true && { taken: true }),
        };
      }),
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
