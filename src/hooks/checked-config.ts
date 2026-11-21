import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_INSTALL_COMMAND } from "../build-info";
import { parserFingerprint } from "../build-info/parser-fingerprint" with { type: "macro" };
import type { CliPaths } from "../cli/paths";
import type { Answer } from "../entries/config-check";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, projectFileFor } from "../project/locate";
import type { Project } from "../project/resolve";
import { setFileMode } from "../setup/file-mode";
import { atomicWrite } from "../setup/write";
import type { PersonalWorkflow } from "../workflow/schema";

/**
 * The hooks' one read of a config file (the project's, and the person's workflow file): its
 * bytes, looked up in a cache of checked answers. The parsers (`src/entries/config-check.ts`, a
 * sibling bundle) load only on a miss, so a warm hook evaluates no zod and no config schema.
 *
 * The key is sha256 over the parser's build fingerprint, the kind and the bytes
 * (`parser-fingerprint.ts` says why not the version alone). Only a success is written: a broken
 * file is checked again every run and says its message from the parser each time.
 *
 * Failing closed keeps today's meaning:
 * - a config problem, or a sibling that cannot be loaded or comes from another build, is
 *   `{ ok: false, message }`, and the hook answers as it does for any broken file;
 * - an error thrown inside the parser that is not a config error, and a read error on the file
 *   (a folder, no permission), are thrown, so the hook takes its crash path;
 * - a cache that cannot be read or written is a miss.
 *
 * The person's workflow file is the one exception (`loadPersonalWorkflow`): a hook never fails
 * on it, as `personalWorkflowOrDefault` never does.
 *
 * The folder is the person's own (`0700`, entries `0600`). It holds project files and workflow
 * files only, which have no secret field; `gateway.json` is never cached.
 */

/** The parser's build fingerprint; the sibling bakes in the same one. */
export const PARSER_FINGERPRINT: string = parserFingerprint();

/** The folder under the state folder that holds the checked answers. */
export const CHECKED_DIR = "checked";

/** The most entries the folder keeps: the oldest go on the next miss. */
export const CHECKED_CACHE_LIMIT = 64;

/** A file bigger than this is parsed every time and never cached. */
export const CHECKED_FILE_MAX_BYTES = 256 * 1024;

/** A leftover temp file (a writer killed before its rename) goes once it is this old. */
export const CHECKED_TEMP_MAX_AGE_MS = 60_000;

/** An entry with another `format` is a miss. */
const ENTRY_FORMAT = 1;

/** The name `atomicWrite` gives its temp file (`src/setup/write.ts`); a test keeps them in step. */
export const TEMP_NAME = /^\..+\.cc-smart-dev-kit-tmp-/;

/** What each kind of checked file parses to. */
interface CheckedValues {
  project: CcSmartDevKitConfig;
  workflow: PersonalWorkflow;
}

/** What kind of file is checked: the key names it, so two kinds never share an entry. */
export type CheckedKind = keyof CheckedValues;

/**
 * How the run got the project's file, for the hook log: `none` (no file), `cached` (an entry
 * answered), `checked` (the sibling parsed it) or `broken` (a config problem).
 */
export type ConfigFact = "none" | "cached" | "checked" | "broken";

export type CheckedFile<K extends CheckedKind = "project"> =
  | { ok: true; value: CheckedValues[K] | null; fact: "none" | "cached" | "checked" }
  | { ok: false; message: string; fact: "broken" };

export type CheckedProject =
  | { ok: true; project: Project; fact: "none" | "cached" | "checked" }
  | { ok: false; message: string; fact: "broken" };

export interface CheckedOptions {
  /** `<stateDir>/checked/` holds the entries. */
  paths: Pick<CliPaths, "stateDir">;
}

interface Sibling {
  checkProjectText: (text: string, where: string) => Answer<CheckedValues["project"]>;
  checkWorkflowText: (text: string, where: string) => Answer<CheckedValues["workflow"]>;
}

type Parse<K extends CheckedKind> = (
  sibling: Sibling,
  text: string,
  where: string,
) => Answer<CheckedValues[K]>;

/** The sibling's parser for each kind: one entry per kind, so none is missed. */
const PARSE: { readonly [K in CheckedKind]: Parse<K> } = {
  project: (sibling, text, where) => sibling.checkProjectText(text, where),
  workflow: (sibling, text, where) => sibling.checkWorkflowText(text, where),
};

function reinstallMessage(why: string): string {
  return `The plugin's config checker is not usable (${why}): run \`${PLUGIN_INSTALL_COMMAND}\` to reinstall the plugin, then try again.`;
}

/**
 * Loads the sibling: beside the bundle as `config-check.js`, from source the entry file, the way
 * `task mcp` finds `tasks-mcp.js`. The path is computed, so the bundler cannot inline the parser.
 */
async function loadSibling(): Promise<Sibling> {
  const built = join(import.meta.dir, "config-check.js");
  const entry = existsSync(built)
    ? built
    : join(import.meta.dir, "..", "entries", "config-check.ts");
  const loaded: unknown = await import(entry);
  for (const name of ["checkProjectText", "checkWorkflowText"] as const) {
    if (typeof (loaded as Partial<Sibling>)[name] !== "function") {
      throw new Error(`${entry} exports no ${name}`);
    }
  }
  return loaded as Sibling;
}

export function checkedKey(fingerprint: string, kind: CheckedKind, bytes: Uint8Array): string {
  return createHash("sha256").update(`${fingerprint}\n${kind}\n`).update(bytes).digest("hex");
}

interface Entry {
  format: number;
  key: string;
  kind: CheckedKind;
  value: unknown;
}

/** The stored value, or null when the entry is missing, unreadable or not what `key` names. */
function readEntry<K extends CheckedKind>(
  file: string,
  key: string,
  kind: K,
): CheckedValues[K] | null {
  try {
    const entry = JSON.parse(readFileSync(file, "utf8")) as Partial<Entry> | null;
    if (entry?.format !== ENTRY_FORMAT || entry.key !== key || entry.kind !== kind) return null;
    const { value } = entry;
    // The key names the bytes and the parser build, so a matching entry holds that parser's value.
    const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
    return isObject ? (value as CheckedValues[K]) : null;
  } catch {
    return null;
  }
}

/**
 * Makes room for one entry: removes the oldest entries beyond the cap, and temp files older than
 * `CHECKED_TEMP_MAX_AGE_MS`. A fresh temp file stays: its writer may still rename it.
 */
function prune(dir: string, nowMs: number): void {
  const entries: { path: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (TEMP_NAME.test(name)) {
        if (nowMs - statSync(path).mtimeMs > CHECKED_TEMP_MAX_AGE_MS) unlinkSync(path);
      } else if (name.endsWith(".json")) {
        entries.push({ path, mtimeMs: statSync(path).mtimeMs });
      }
    } catch {
      // Removed by another hook since the listing.
    }
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const old of entries.slice(0, Math.max(0, entries.length - (CHECKED_CACHE_LIMIT - 1)))) {
    try {
      unlinkSync(old.path);
    } catch {
      // Removed by another hook since the listing.
    }
  }
}

/** Writes one success. A folder that cannot be written costs speed only: `doctor` names it. */
function writeEntry(dir: string, key: string, kind: CheckedKind, value: unknown): void {
  try {
    if (!existsSync(dir)) {
      // `atomicWrite` would make the folder with the umask's mode.
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      setFileMode(dir, 0o700);
    }
    prune(dir, Date.now());
    const entry: Entry = { format: ENTRY_FORMAT, key, kind, value };
    atomicWrite(join(dir, `${key}.json`), JSON.stringify(entry), 0o600);
  } catch {
    // The answer is already in hand.
  }
}

/**
 * The checked answer for one file; `value` null with fact `none` when the file does not exist.
 * The bytes are read once, so the key and the parse cannot disagree after an edit mid-run.
 */
export async function loadCheckedFile<K extends CheckedKind>(
  file: string,
  kind: K,
  { paths }: CheckedOptions,
): Promise<CheckedFile<K>> {
  if (!existsSync(file)) return { ok: true, value: null, fact: "none" };
  const bytes = readFileSync(file);
  const cacheable = bytes.length <= CHECKED_FILE_MAX_BYTES;
  const dir = join(paths.stateDir, CHECKED_DIR);
  const key = checkedKey(PARSER_FINGERPRINT, kind, bytes);
  if (cacheable) {
    const hit = readEntry(join(dir, `${key}.json`), key, kind);
    if (hit !== null) return { ok: true, value: hit, fact: "cached" };
  }
  let sibling: Sibling;
  try {
    sibling = await loadSibling();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, message: reinstallMessage(why), fact: "broken" };
  }
  const answer = PARSE[kind](sibling, bytes.toString("utf8"), file);
  if (answer.fingerprint !== PARSER_FINGERPRINT) {
    const why = "it was built from another version of the plugin than this hook";
    return { ok: false, message: reinstallMessage(why), fact: "broken" };
  }
  if (!answer.ok) return { ok: false, message: answer.message, fact: "broken" };
  if (cacheable) writeEntry(dir, key, kind, answer.value);
  return { ok: true, value: answer.value, fact: "checked" };
}

/** The project of a located checkout, read as `loadProjectConfig` reads it, through the cache. */
export async function loadCheckedProject(
  checkout: Checkout,
  options: CheckedOptions,
): Promise<CheckedProject> {
  const file = projectFileFor(checkout);
  if (file === null) {
    return { ok: true, project: { ...checkout, config: null, configFile: null }, fact: "none" };
  }
  const checked = await loadCheckedFile(file, "project", options);
  if (!checked.ok) return checked;
  return {
    ok: true,
    project: { ...checkout, config: checked.value, configFile: file },
    fact: checked.fact,
  };
}

/**
 * The person's own workflow values, read through the cache, or `{}` when the file is not there,
 * is broken, or cannot be read: the answers of `personalWorkflowOrDefault`, which a hook uses so
 * it never fails on the person's file (`workflow show` says what is wrong with it). A broken
 * file is never cached, so it is checked again each run and stays broken until it is fixed.
 */
export async function loadPersonalWorkflow(
  paths: Pick<CliPaths, "stateDir" | "workflowConfigFile">,
): Promise<PersonalWorkflow> {
  try {
    const checked = await loadCheckedFile(paths.workflowConfigFile, "workflow", { paths });
    return checked.ok ? (checked.value ?? {}) : {};
  } catch {
    // A file that cannot be read, or a parser that failed: the hook goes on without the
    // person's defaults, as `personalWorkflowOrDefault` does for any failure.
    return {};
  }
}

/**
 * Why the checked folder cannot be written ("is not a folder", "cannot be written (EACCES)"), or
 * null when it can. Read-only: it creates nothing. An unwritable folder costs every hook run the
 * parser's load, so `doctor` names it.
 */
export function checkedCacheProblem(paths: Pick<CliPaths, "stateDir">): string | null {
  const dir = join(paths.stateDir, CHECKED_DIR);
  try {
    if (existsSync(dir)) {
      if (!statSync(dir).isDirectory()) return "is not a folder";
      accessSync(dir, constants.W_OK | constants.X_OK);
      return null;
    }
    // Not made yet: the nearest folder that exists must let a new folder in.
    let parent = dirname(dir);
    while (!existsSync(parent)) parent = dirname(parent);
    accessSync(parent, constants.W_OK | constants.X_OK);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `cannot be written${code === undefined ? "" : ` (${code})`}`;
  }
}
