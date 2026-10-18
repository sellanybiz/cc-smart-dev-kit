import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, MARKETPLACE, PLUGIN } from "../build-info/names";
import {
  deleteKey,
  ForeignKeyError,
  formatKeyPath,
  getKey,
  isObject,
  type JsonObject,
  readJsonObject,
} from "./managed-json";
import { atomicWrite, realTarget, retryOnConcurrentChange, writeManagedFile } from "./write";

/**
 * One hook entry cc-smart-dev-kit owns inside a settings file's `hooks.<event>` list, such as
 * the user-level `Notification` hook that lets agent view's alerts through
 * (`src/setup/user-notify-hook.ts`). The list is shared: the person, other tools and
 * cc-smart-dev-kit all add to it, and Claude Code runs every entry. So cc-smart-dev-kit owns
 * single entries, never the list: every other entry stays exactly as the person wrote it.
 *
 * State: `<stateDir>/owned-hooks.json`:
 * `{ "<real file>": { "<event>": { "entry": <the entry cc-smart-dev-kit wrote>,
 *    "created": { "hooks": true, "event": true } } } }`.
 * Restore removes the entry only while it still matches what cc-smart-dev-kit wrote: one the
 * person changed since is theirs and stays. `created` says which empty objects around it
 * cc-smart-dev-kit made, so restore takes those with the last entry.
 *
 * **This file is the kind's one record: it is deliberately not in `changed.json`.** A
 * changed.json kind is read by every cc-smart-dev-kit, and a running 0.5.2 CLI (a portal
 * copy, a session that has not restarted) refuses one it does not know. `writeManagedFile`
 * therefore writes with `record: false`, and `restore` reads this file for the hook entry.
 */
const OWNED_HOOKS_FILE = "owned-hooks.json";

/** One program a hook entry runs: Claude Code's own shape. */
export interface HookHandler {
  command: string;
  timeout?: number;
  type: string;
}

/** One entry of a `hooks.<event>` list: an optional matcher, and the handlers it runs. */
export interface HookEntry {
  hooks: HookHandler[];
  matcher?: string;
}

/** What cc-smart-dev-kit created around its entry, and takes with the entry's last run. */
export interface CreatedAround {
  /** The event list (`hooks.<event>`) did not exist before cc-smart-dev-kit's write. */
  event: boolean;
  /** The `hooks` object itself did not exist before cc-smart-dev-kit's write. */
  hooks: boolean;
}

/** The record of one managed entry. */
export interface OwnedHookRecord {
  created: CreatedAround;
  entry: HookEntry;
}

type OwnedHooksState = Record<string, Record<string, OwnedHookRecord>>;

export interface ManagedHookOptions {
  file: string;
  stateDir: string;
  /** The event whose list holds the entry, e.g. "Notification". */
  event: string;
  /** The entry cc-smart-dev-kit wants there. */
  entry: HookEntry;
  /**
   * A hand-written entry setup replaces instead of adding a second: one cc-smart-dev-kit
   * recognizes as an older copy of the same hook (never one of the person's own).
   */
  replaces?: (entry: HookEntry) => boolean;
  /**
   * An entry the person edited after setup wrote it, which setup still recognizes as its own
   * kind (the managed hook's matcher and command). It is theirs now: setup leaves it, claims
   * nothing, and adds no second entry beside it.
   */
  ownEdited?: (entry: HookEntry) => boolean;
  dryRun?: boolean;
  /** Tests only: runs after the read and before the write, to play another program's write. */
  onBeforeWrite?: () => void;
}

/**
 * What the call did: `unchanged` when the wanted entry was already there, `left` when the
 * person's edited copy stays.
 */
export type ManagedHookAction = "added" | "left" | "replaced" | "unchanged" | "updated";

export interface ManagedHookResult {
  file: string;
  action: ManagedHookAction;
  written: boolean;
  backup: string | null;
}

function isHookHandler(value: unknown): value is HookHandler {
  return (
    isObject(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { command?: unknown }).command === "string" &&
    ((value as { timeout?: unknown }).timeout === undefined ||
      typeof (value as { timeout?: unknown }).timeout === "number")
  );
}

/** True when `value` has the shape of a hook entry (Claude Code's own). */
export function isHookEntry(value: unknown): value is HookEntry {
  return (
    isObject(value) &&
    Array.isArray(value.hooks) &&
    value.hooks.every(isHookHandler) &&
    (value.matcher === undefined || typeof value.matcher === "string")
  );
}

/** Claude Code's placeholder for a plugin's own folder, exported to a plugin's hook. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";

/** The last part of a notify bundle's path: `<something>/dist/notify.js`, as one word. */
const NOTIFY_BUNDLE = /(?:^|[\\/\s"'])dist[\\/]notify\.js(?:\s|"|'|$)/;

/** Claude Code's cache folder for THIS plugin: `plugins/cache/<marketplace>/<plugin>/…`. */
const PLUGIN_CACHE = `plugins/cache/${MARKETPLACE}/${PLUGIN}/`;

function normalized(command: string): string {
  return command.replaceAll("\\", "/");
}

/**
 * True when a command runs THIS plugin's own notify bundle from `dist/`, as a hand-written
 * test entry does. The path must name the plugin, not just any `dist/notify.js`: Claude
 * Code's `${CLAUDE_PLUGIN_ROOT}`, the plugin's `cc-smart-dev-kit-bun.sh` shim, or Claude
 * Code's cache folder for this marketplace and plugin. Anything else (a personal notifier at
 * `/home/user/my-notifier/dist/notify.js`) is the person's, and setup never replaces it.
 */
export function runsPluginNotify(command: string): boolean {
  if (!NOTIFY_BUNDLE.test(command)) return false;
  const path = normalized(command);
  return (
    command.includes(PLUGIN_ROOT) ||
    path.includes(`${COMMAND}-bun.sh`) ||
    path.includes(PLUGIN_CACHE)
  );
}

function isCreatedAround(value: unknown): value is CreatedAround {
  return (
    isObject(value) &&
    typeof (value as { event?: unknown }).event === "boolean" &&
    typeof (value as { hooks?: unknown }).hooks === "boolean"
  );
}

function isOwnedHookRecord(value: unknown): value is OwnedHookRecord {
  return (
    isObject(value) &&
    isHookEntry((value as { entry?: unknown }).entry) &&
    isCreatedAround((value as { created?: unknown }).created)
  );
}

function readOwnedHooks(stateDir: string): OwnedHooksState {
  const file = join(stateDir, OWNED_HOOKS_FILE);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const valid =
    isObject(parsed) &&
    Object.values(parsed).every(
      (events) => isObject(events) && Object.values(events).every(isOwnedHookRecord),
    );
  if (!valid) {
    throw new Error(`Invalid ${file}: expected { <file>: { <event>: { entry, created } } }`);
  }
  return parsed as OwnedHooksState;
}

function writeOwnedHooks(stateDir: string, state: OwnedHooksState): void {
  atomicWrite(join(stateDir, OWNED_HOOKS_FILE), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/** The state with one event's record set (`record`) or dropped (`null`). */
function withRecord(
  state: OwnedHooksState,
  file: string,
  event: string,
  record: OwnedHookRecord | null,
): OwnedHooksState {
  const events = { ...(state[file] ?? {}) };
  if (record === null) delete events[event];
  else events[event] = record;
  const next = { ...state };
  if (Object.keys(events).length === 0) delete next[file];
  else next[file] = events;
  return next;
}

/** The event list in `data`, or null when it does not exist yet. Throws on another shape. */
function eventList(data: JsonObject, file: string, event: string): unknown[] | null {
  const hooks = data.hooks;
  if (hooks !== undefined && !isObject(hooks)) {
    throw new ForeignKeyError(
      `${file}: ${formatKeyPath(["hooks"])} is not an object. cc-smart-dev-kit does not change it.`,
    );
  }
  const list = isObject(hooks) ? hooks[event] : undefined;
  if (list === undefined) return null;
  if (!Array.isArray(list)) {
    throw new ForeignKeyError(
      `${file}: ${formatKeyPath(["hooks", event])} is not a list. cc-smart-dev-kit does not change it.`,
    );
  }
  return [...list];
}

/** What the entry list and the `hooks` object around it looked like before a write. */
function createdAround(data: JsonObject, event: string): CreatedAround {
  const hooks = isObject(data.hooks);
  return { event: !hooks || !Array.isArray((data.hooks as JsonObject)[event]), hooks: !hooks };
}

/** The index of an entry deep-equal to `wanted`, or -1. */
function indexOf(list: unknown[], wanted: unknown): number {
  return list.findIndex((entry) => Bun.deepEquals(entry, wanted, true));
}

function applyOnce(
  file: string,
  options: ManagedHookOptions,
  snapshot: OwnedHooksState,
): ManagedHookResult {
  const { data, indent, text } = readJsonObject(file);
  const list = eventList(data, file, options.event) ?? [];
  const record = snapshot[file]?.[options.event];
  const wanted = options.entry;

  // Ours is the entry that still matches what cc-smart-dev-kit wrote; a changed one is the
  // person's, and is never rewritten.
  const ownAt = record === undefined ? -1 : indexOf(list, record.entry);
  let action: ManagedHookAction;
  let keep: OwnedHookRecord | null;
  if (record !== undefined && ownAt !== -1) {
    if (Bun.deepEquals(record.entry, wanted, true)) {
      action = "unchanged";
    } else {
      // The wanted entry changed since setup wrote it (a new command, say): update ours.
      list[ownAt] = structuredClone(wanted);
      action = "updated";
    }
    keep = { created: record.created, entry: structuredClone(wanted) };
  } else if (indexOf(list, wanted) !== -1) {
    // The wanted entry is already there, put by someone else: leave it, and claim nothing.
    action = "unchanged";
    keep = null;
  } else {
    const handAt =
      options.replaces === undefined
        ? -1
        : list.findIndex((entry) => isHookEntry(entry) && options.replaces?.(entry) === true);
    if (handAt !== -1) {
      // A hand-written copy setup recognizes (this plugin's own bundle from a version folder):
      // replaced in place, so no second entry ever runs beside it.
      list[handAt] = structuredClone(wanted);
      action = "replaced";
      keep = { created: createdAround(data, options.event), entry: structuredClone(wanted) };
    } else if (
      options.ownEdited !== undefined &&
      list.some((entry) => isHookEntry(entry) && options.ownEdited?.(entry) === true)
    ) {
      // The person edited the managed entry (a longer timeout, a redirection): it is theirs
      // now. Leave it, claim nothing, and never add a second one beside it.
      action = "left";
      keep = null;
    } else {
      list.push(structuredClone(wanted));
      action = "added";
      keep = { created: createdAround(data, options.event), entry: structuredClone(wanted) };
    }
  }

  const recordChanged = !Bun.deepEquals(record ?? null, keep, true);
  const listChanged = action === "added" || action === "replaced" || action === "updated";
  if (options.dryRun || (!listChanged && !recordChanged)) {
    return { file, action, written: false, backup: null };
  }
  if (!listChanged) {
    // Only the record changed (a foreign identical entry, or the person's edited copy):
    // no write to the file.
    writeOwnedHooks(options.stateDir, withRecord(snapshot, file, options.event, keep));
    return { file, action, written: false, backup: null };
  }

  data.hooks = isObject(data.hooks) ? data.hooks : {};
  (data.hooks as JsonObject)[options.event] = list;

  // Claim first: if the process dies during the write, the next run still knows what is ours.
  writeOwnedHooks(options.stateDir, withRecord(snapshot, file, options.event, keep));
  options.onBeforeWrite?.();
  let result: { outcome: string; backup: string | null };
  try {
    result = writeManagedFile(file, `${JSON.stringify(data, null, indent)}\n`, {
      stateDir: options.stateDir,
      // No changed.json kind: this file is the record (`readChanged` in an older running
      // cc-smart-dev-kit must never meet a kind it does not know).
      record: false,
      newFileMode: 0o600,
      expectedContent: text,
    });
  } catch (error) {
    // The file was not written: give back this try's claim.
    writeOwnedHooks(options.stateDir, snapshot);
    throw error;
  }
  writeOwnedHooks(options.stateDir, withRecord(snapshot, file, options.event, keep));
  return { file, action, written: result.outcome !== "unchanged", backup: result.backup };
}

/**
 * Makes cc-smart-dev-kit's entry for `event` exactly `entry`:
 * - an entry it already owns and that still matches its record is updated in place when the
 *   wanted entry changed, and otherwise left alone;
 * - a `replaces` entry (a hand-written copy setup recognizes) is replaced in place;
 * - an `ownEdited` entry (the person's edited copy of the managed hook) is left untouched,
 *   and setup claims nothing;
 * - when the list holds neither, the wanted entry is added at the end;
 * - every other entry, and the list's order, stays exactly as it is;
 * - an entry cc-smart-dev-kit does not own and that equals the wanted one is left unowned.
 * Same write path as `applyManagedJson`: a backup, the record for restore, the race check.
 */
export function applyManagedHook(options: ManagedHookOptions): ManagedHookResult {
  const file = realTarget(options.file);
  const snapshot = readOwnedHooks(options.stateDir);
  return retryOnConcurrentChange(file, () => applyOnce(file, options, snapshot));
}

export interface RemovedHooks {
  /** The lists the entry was taken out of, as `hooks.<event>`. */
  removed: string[];
  written: boolean;
  backup: string | null;
}

/**
 * Restore: takes cc-smart-dev-kit's entry out of every `hooks.<event>` list it owns in
 * `file`, and keeps every other entry. An entry the person changed since no longer matches
 * its record, so it stays and only the record goes. An event list or `hooks` object
 * cc-smart-dev-kit created goes with its last entry.
 */
export function removeManagedHooks(stateDir: string, file: string): RemovedHooks {
  const real = realTarget(file);
  const snapshot = readOwnedHooks(stateDir);
  const events = snapshot[real];
  if (events === undefined) return { removed: [], written: false, backup: null };
  return retryOnConcurrentChange(real, () => {
    const { data, indent, text } = readJsonObject(real);
    const removed: string[] = [];
    let backup: string | null = null;
    let written = false;
    let next = snapshot;
    for (const [event, record] of Object.entries(events)) {
      const list = eventList(data, real, event);
      if (list === null) {
        next = withRecord(next, real, event, null);
        continue;
      }
      const at = indexOf(list, record.entry);
      if (at !== -1) {
        list.splice(at, 1);
        removed.push(formatKeyPath(["hooks", event]));
        if (list.length === 0 && record.created.event) {
          // The event list was cc-smart-dev-kit's, and its last entry went with it. The
          // `hooks` object around it goes too when cc-smart-dev-kit created that as well.
          deleteKey(data, ["hooks", event]);
          const hooks = getKey(data, ["hooks"]);
          if (
            record.created.hooks &&
            hooks.found &&
            isObject(hooks.value) &&
            Object.keys(hooks.value).length === 0
          ) {
            deleteKey(data, ["hooks"]);
          }
        } else {
          data.hooks = isObject(data.hooks) ? data.hooks : {};
          (data.hooks as JsonObject)[event] = list;
        }
      }
      next = withRecord(next, real, event, null);
    }
    if (removed.length > 0) {
      const result = writeManagedFile(real, `${JSON.stringify(data, null, indent)}\n`, {
        stateDir,
        record: false,
        newFileMode: 0o600,
        expectedContent: text,
      });
      written = result.outcome !== "unchanged";
      backup = result.backup;
    }
    if (!Bun.deepEquals(next, snapshot, true)) writeOwnedHooks(stateDir, next);
    return { removed, written, backup };
  });
}

/** One file restore cleaned of its managed hook entries. */
export interface RemovedHooksInFile extends RemovedHooks {
  file: string;
}

/**
 * Restore: every file `owned-hooks.json` names, each through `removeManagedHooks`, honoring
 * `restore`'s `except` and `only` filters. A record whose entry is gone (the person removed
 * or changed it) is dropped without a line about a removal.
 */
export function removeAllManagedHooks(
  stateDir: string,
  options: { except?: ReadonlySet<string>; only?: ReadonlySet<string> | null } = {},
): RemovedHooksInFile[] {
  const state = readOwnedHooks(stateDir);
  const results: RemovedHooksInFile[] = [];
  for (const file of Object.keys(state)) {
    if (options.except?.has(file) === true) continue;
    if (options.only !== undefined && options.only !== null && !options.only.has(file)) continue;
    const result = removeManagedHooks(stateDir, file);
    results.push({ file, ...result });
  }
  return results;
}
