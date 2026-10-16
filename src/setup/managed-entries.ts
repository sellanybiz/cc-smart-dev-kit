import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteKey,
  ForeignKeyError,
  formatKeyPath,
  getKey,
  isObject,
  type JsonObject,
  type KeyPath,
  readJsonObject,
  setKey,
} from "./managed-json";
import { atomicWrite, realTarget, retryOnConcurrentChange, writeManagedFile } from "./write";

/**
 * Entries cc-smart-dev-kit owns inside a JSON list of strings, such as `autoMode.environment` in
 * `settings.json`. A list is shared: the person, other tools and cc-smart-dev-kit all add to it.
 * So cc-smart-dev-kit owns single entries, never the whole list.
 *
 * Who wants an entry is its **source** (for the auto-mode block: a project's folder).
 * One entry can be wanted by several sources; it leaves the list only when the last
 * source that owns it lets it go.
 *
 * State: `<stateDir>/owned-entries.json`:
 * `{ "<real file>": { "<key path as JSON>": [{ "entry": "…", "source": "…" }] } }`.
 */
const OWNED_ENTRIES_FILE = "owned-entries.json";

/** The source of the anchor entry: cc-smart-dev-kit put it there when it created the list. */
const ANCHOR_SOURCE = "";

interface OwnedEntry {
  entry: string;
  source: string;
}
type OwnedEntriesState = Record<string, Record<string, OwnedEntry[]>>;

export interface ManagedEntriesOptions {
  file: string;
  stateDir: string;
  /** The list's key path, e.g. ["autoMode", "environment"]. */
  path: KeyPath;
  /** Who wants these entries. */
  source: string;
  /** Every entry this source wants now. An owned entry of this source that is not here goes. */
  entries: readonly string[];
  /**
   * An entry put first when cc-smart-dev-kit creates the list (auto mode's `"$defaults"`, which
   * keeps Claude Code's built-in entries). It is cc-smart-dev-kit's, and it goes only with the
   * list: when no entry but cc-smart-dev-kit's anchor is left.
   */
  anchor?: string;
  dryRun?: boolean;
  /** Tests only: runs after the read and before the write, to play another program's write. */
  onBeforeWrite?: () => void;
}

export interface ManagedEntriesResult {
  file: string;
  /** Entries put into the list. */
  added: string[];
  /** Entries taken out of the list. */
  removed: string[];
  /** Wanted entries that were already in the list, put there by someone else: left alone. */
  skipped: string[];
  written: boolean;
  backup: string | null;
}

function pathKey(path: KeyPath): string {
  return JSON.stringify(path);
}

function isOwnedEntry(value: unknown): value is OwnedEntry {
  return (
    isObject(value) &&
    typeof (value as { entry?: unknown }).entry === "string" &&
    typeof (value as { source?: unknown }).source === "string"
  );
}

function readOwnedEntries(stateDir: string): OwnedEntriesState {
  const file = join(stateDir, OWNED_ENTRIES_FILE);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const valid =
    isObject(parsed) &&
    Object.values(parsed).every(
      (lists) =>
        isObject(lists) &&
        Object.values(lists).every((list) => Array.isArray(list) && list.every(isOwnedEntry)),
    );
  if (!valid) {
    throw new Error(
      `Invalid ${file}: expected { <file>: { <key path>: [{ "entry", "source" }] } }`,
    );
  }
  return parsed as OwnedEntriesState;
}

function writeOwnedEntries(stateDir: string, state: OwnedEntriesState): void {
  atomicWrite(join(stateDir, OWNED_ENTRIES_FILE), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

function withRecords(
  state: OwnedEntriesState,
  file: string,
  key: string,
  records: OwnedEntry[],
): OwnedEntriesState {
  const lists = { ...(state[file] ?? {}) };
  if (records.length === 0) delete lists[key];
  else lists[key] = records;
  const next = { ...state };
  if (Object.keys(lists).length === 0) delete next[file];
  else next[file] = lists;
  return next;
}

/** The entries cc-smart-dev-kit owns in `file` (its real path), per key path, with their sources. */
export function ownedEntries(stateDir: string, file: string): Record<string, OwnedEntry[]> {
  return readOwnedEntries(stateDir)[file] ?? {};
}

/** Removes the key, then each parent object that is left empty. */
function deleteWithEmptyParents(data: JsonObject, path: KeyPath): void {
  deleteKey(data, path);
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const parent = getKey(data, path.slice(0, depth));
    if (!parent.found || !isObject(parent.value) || Object.keys(parent.value).length > 0) return;
    deleteKey(data, path.slice(0, depth));
  }
}

type Plan =
  | { kind: "source"; source: string; entries: readonly string[]; anchor?: string }
  | { kind: "all" };

interface Common {
  path: KeyPath;
  stateDir: string;
  dryRun?: boolean;
  onBeforeWrite?: () => void;
}

function applyOnce(
  file: string,
  options: Common,
  plan: Plan,
  snapshot: OwnedEntriesState,
): ManagedEntriesResult {
  const { path } = options;
  const key = pathKey(path);
  const { data, indent, text } = readJsonObject(file);
  const current = getKey(data, path);
  if (
    current.found &&
    !(Array.isArray(current.value) && current.value.every((item) => typeof item === "string"))
  ) {
    throw new ForeignKeyError(
      `${file}: ${formatKeyPath(path)} is not a list of strings. cc-smart-dev-kit does not change it.`,
    );
  }
  const list: string[] = current.found ? [...(current.value as string[])] : [];
  const records: OwnedEntry[] = [...(snapshot[file]?.[key] ?? [])];
  // A record whose entry someone took out of the list by hand is gone: nothing to own.
  const live = records.filter((record) => list.includes(record.entry));

  const added: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  let kept: OwnedEntry[];

  if (plan.kind === "all") {
    kept = [];
  } else {
    const wanted = [...new Set(plan.entries)].filter((entry) => entry !== plan.anchor);
    kept = live.filter((record) => record.source !== plan.source || wanted.includes(record.entry));
    for (const entry of wanted) {
      const ownedHere = kept.some((r) => r.entry === entry && r.source === plan.source);
      if (ownedHere) continue;
      const ownedByCcSmartDevKit = kept.some((r) => r.entry === entry);
      if (list.includes(entry) && !ownedByCcSmartDevKit) {
        skipped.push(entry);
        continue;
      }
      if (!list.includes(entry)) {
        if (list.length === 0 && plan.anchor !== undefined && !current.found) {
          list.push(plan.anchor);
          added.push(plan.anchor);
          kept.push({ entry: plan.anchor, source: ANCHOR_SOURCE });
        }
        list.push(entry);
        added.push(entry);
      }
      kept.push({ entry, source: plan.source });
    }
  }

  // An entry leaves the list when no record of it is left (the anchor is handled below).
  for (const record of live) {
    if (record.source === ANCHOR_SOURCE) continue;
    if (kept.some((r) => r.entry === record.entry)) continue;
    if (removed.includes(record.entry)) continue;
    const at = list.indexOf(record.entry);
    if (at !== -1) {
      list.splice(at, 1);
      removed.push(record.entry);
    }
  }
  // The anchor goes with the list: when nothing but the anchor is left in it.
  const anchorRecord =
    kept.find((r) => r.source === ANCHOR_SOURCE) ?? live.find((r) => r.source === ANCHOR_SOURCE);
  let dropList = false;
  if (anchorRecord !== undefined) {
    const onlyAnchor = list.every((entry) => entry === anchorRecord.entry);
    if (onlyAnchor) {
      kept = kept.filter((r) => r.source !== ANCHOR_SOURCE);
      if (list.length > 0) removed.push(anchorRecord.entry);
      list.length = 0;
      dropList = true;
    } else if (plan.kind === "source" && !kept.includes(anchorRecord)) {
      kept.push(anchorRecord);
    }
    // On restore with other entries left, the anchor stays in the list (they rely on it),
    // and cc-smart-dev-kit no longer claims it: the list is the person's now.
  }

  const listChanged = added.length > 0 || removed.length > 0;
  const recordsChanged = JSON.stringify(kept) !== JSON.stringify(records);
  if (options.dryRun || (!listChanged && !recordsChanged)) {
    return { file, added, removed, skipped, written: false, backup: null };
  }

  if (!listChanged) {
    // Only the records changed (an entry taken out by hand): no write to the file.
    writeOwnedEntries(options.stateDir, withRecords(snapshot, file, key, kept));
    return { file, added, removed, skipped, written: false, backup: null };
  }

  if (dropList) deleteWithEmptyParents(data, path);
  else setKey(data, path, list);

  // Claim first: if the process dies during the write, the next run still knows what is ours.
  const claimed = withRecords(snapshot, file, key, [
    ...live,
    ...kept.filter((r) => !live.includes(r)),
  ]);
  writeOwnedEntries(options.stateDir, claimed);
  options.onBeforeWrite?.();
  let result: { outcome: string; backup: string | null };
  try {
    result = writeManagedFile(file, `${JSON.stringify(data, null, indent)}\n`, {
      stateDir: options.stateDir,
      kind: "json-entries",
      newFileMode: 0o600,
      expectedContent: text,
    });
  } catch (error) {
    // The file was not written: give back this try's claims.
    writeOwnedEntries(options.stateDir, snapshot);
    throw error;
  }
  writeOwnedEntries(options.stateDir, withRecords(snapshot, file, key, kept));
  return {
    file,
    added,
    removed,
    skipped,
    written: result.outcome !== "unchanged",
    backup: result.backup,
  };
}

/**
 * Makes the entries one source owns in a JSON list exactly `entries`:
 * - a wanted entry that is not in the list is added at its end, and owned;
 * - a wanted entry already in the list, put there by someone else, is left alone and not
 *   owned (`skipped`);
 * - an entry this source owns but no longer wants is taken out, unless another source
 *   still owns it;
 * - no other entry is ever touched, and their order stays.
 * When cc-smart-dev-kit creates the list, `anchor` comes first; it goes with the list.
 * Same write path as `applyManagedJson`: a backup, the record for restore, the race check.
 */
export function applyManagedEntries(options: ManagedEntriesOptions): ManagedEntriesResult {
  const file = realTarget(options.file);
  const snapshot = readOwnedEntries(options.stateDir);
  return retryOnConcurrentChange(file, () =>
    applyOnce(
      file,
      options,
      {
        kind: "source",
        source: options.source,
        entries: options.entries,
        ...(options.anchor !== undefined && { anchor: options.anchor }),
      },
      snapshot,
    ),
  );
}

/** Restore: takes every entry cc-smart-dev-kit owns out of `file`, for every source. */
export function removeAllOwnedEntries(
  stateDir: string,
  file: string,
): { removed: string[]; backup: string | null } {
  const real = realTarget(file);
  const removed: string[] = [];
  let backup: string | null = null;
  for (const key of Object.keys(ownedEntries(stateDir, real))) {
    const path = JSON.parse(key) as string[];
    const snapshot = readOwnedEntries(stateDir);
    const result = retryOnConcurrentChange(real, () =>
      applyOnce(real, { stateDir, path }, { kind: "all" }, snapshot),
    );
    removed.push(...result.removed);
    backup ??= result.backup;
  }
  return { removed, backup };
}
