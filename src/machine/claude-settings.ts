/**
 * Claude Code's auto-compact variables and settings keys, read only: the one reader of them.
 * The status line reads them for a session's window (`compactWindowsOf`).
 *
 * **What applies:** the environment first — `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (it wins over the
 * model's own window) and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (it lowers the point to a share of
 * the window) — then the `autoCompactWindow` and `modelSettings.<model>.autoCompactWindow` keys,
 * then the model's own window.
 *
 * **Where the variables come from, in Claude Code's order** (P3 and P6 in the contract): a settings
 * file's `env` block beats the shell, and the first of these that sets a variable decides it: the
 * main checkout's `.claude/settings.local.json`, the session folder's own `settings.local.json`,
 * its `.claude/settings.json`, the user's `settings.json`, then the process environment. A file
 * that cannot be read, or holds no `env`, sets nothing. `compactWindowsOf` reads the keys from
 * the same single read of each file.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { withoutContextSuffix } from "../gateway/targets";
import { readUserJson } from "../setup/user-json";

/** The environment variable that sets the auto-compact window, in tokens. */
export const AUTOCOMPACT_WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";

/** The environment variable that lowers the compaction point to this share (above 0, to 100) of the window. */
export const AUTOCOMPACT_PERCENT_ENV = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";

/** The smallest and the largest window Claude Code takes (`--autocompact`: "100k-1M tokens"). */
export const AUTOCOMPACT_MIN_TOKENS = 100_000;
export const AUTOCOMPACT_MAX_TOKENS = 1_000_000;

/** What applies to a folder: the window variable, in tokens, and the percent variable. Null when unset or unusable. */
export interface CompactEnv {
  percent: null | number;
  window: null | number;
}

/** What `compactWindowsOf` reads. */
export interface CompactEnvSources {
  /** Claude Code's config folder (`CliPaths.claudeConfigDir`). */
  configDir: string;
  env: Record<string, string | undefined>;
  /** The main checkout's root: its `.claude/settings.local.json` is read for every linked worktree. */
  mainCheckout: string;
  /** The folder the session runs in: its own `.claude/settings.local.json` and `.claude/settings.json`. */
  projectFolder: string;
}

/** Scientific notation (`1e5`), as Claude Code's integer reader takes it. */
const SCIENTIFIC = /^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/;
/** Thousands separators (`400,000`, `1_000_000`, `400 000`), one kind throughout. */
const GROUPED = /^[+-]?\d{1,3}([_,\s  ])\d{3}(?:\1\d{3})*$/;
const SEPARATORS = /[_,\s  ]/g;

/** A whole number from text the way Claude Code reads one without a suffix; NaN when it is none. */
function wholeNumber(text: string): number {
  if (text.length <= 32) {
    if (SCIENTIFIC.test(text)) {
      const value = Number(text);
      return Number.isInteger(value) ? value : Number.NaN;
    }
    if (GROUPED.test(text)) return Number.parseInt(text.replace(SEPARATORS, ""), 10);
  }
  return Number.parseInt(text, 10);
}

/**
 * The window a value of `CLAUDE_CODE_AUTO_COMPACT_WINDOW` stands for, read as Claude Code 2.1.310
 * reads it: a last character `k` or `M` scales what `parseFloat` reads, otherwise a whole number
 * (scientific notation and grouped digits included); below 1 or no number is no value, and a
 * value out of range is held at the nearest end. Null when it is no usable value.
 */
export function parseCompactWindow(text: string): null | number {
  const trimmed = text.trim();
  const unit = trimmed.slice(-1).toLowerCase();
  const scale = unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : undefined;
  const tokens = scale === undefined ? wholeNumber(trimmed) : Number.parseFloat(trimmed) * scale;
  if (Number.isNaN(tokens) || tokens < 1) return null;
  return Math.min(AUTOCOMPACT_MAX_TOKENS, Math.max(AUTOCOMPACT_MIN_TOKENS, Math.round(tokens)));
}

/** A share above 0 and up to 100 from the percent variable, read with `parseFloat`; null for anything else. */
export function parseCompactPercent(text: string): null | number {
  const value = Number.parseFloat(text);
  return value > 0 && value <= 100 ? value : null;
}

/** The JSON object in one settings file; empty when it is missing, unreadable, broken or no object. */
function settingsObject(file: string): Record<string, unknown> {
  try {
    const parsed = readUserJson(file);
    return isObject(parsed) ? parsed : {};
  } catch {
    // A missing, unreadable or broken file sets nothing.
    return {};
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `env` block of one settings object, as text values; empty when there is none. */
function envOf(settings: Record<string, unknown>): Record<string, string> {
  const env = settings.env;
  if (!isObject(env)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" || typeof value === "number") out[key] = String(value);
  }
  return out;
}

/** The settings files that apply to a folder, highest first, each read once. */
function settingsFilesOf(sources: CompactEnvSources): Record<string, unknown>[] {
  const mainLocal = join(sources.mainCheckout, ".claude", "settings.local.json");
  const projectLocal = join(sources.projectFolder, ".claude", "settings.local.json");
  return [
    // The main checkout's own folder is the session's in the common case: read that file once.
    ...(mainLocal === projectLocal ? [] : [mainLocal]),
    projectLocal,
    join(sources.projectFolder, ".claude", "settings.json"),
    join(sources.configDir, "settings.json"),
  ].map(settingsObject);
}

/**
 * The variables, from the files (highest first) then the process environment, in the order the
 * top of this file gives. The first source that sets a variable decides it, usable or not:
 * Claude Code ignores an unusable value and does not look further.
 */
function envFrom(
  files: readonly Record<string, unknown>[],
  processEnv: Record<string, string | undefined>,
): CompactEnv {
  const layers: Record<string, string | undefined>[] = [...files.map(envOf), processEnv];
  const decided = (key: string): string | undefined =>
    layers.find((layer) => layer[key] !== undefined)?.[key];
  const windowText = decided(AUTOCOMPACT_WINDOW_ENV);
  const percentText = decided(AUTOCOMPACT_PERCENT_ENV);
  return {
    percent: percentText === undefined ? null : parseCompactPercent(percentText),
    window: windowText === undefined ? null : parseCompactWindow(windowText),
  };
}

/** A model's id as Claude Code keys `modelSettings` by it: lower case, without `[1m]`. */
function settingsKeyOf(model: string): string {
  return withoutContextSuffix(model.trim().toLowerCase());
}

/**
 * A window the settings give: a whole number of tokens in Claude Code's range, or `"auto"`
 * (`modelSettings` only: the model's own window). Anything else is no value, as Claude Code's
 * schema drops it.
 */
function windowValue(value: unknown, allowAuto: boolean): "auto" | number | undefined {
  if (allowAuto && value === "auto") return "auto";
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AUTOCOMPACT_MIN_TOKENS &&
    value <= AUTOCOMPACT_MAX_TOKENS
    ? value
    : undefined;
}

/**
 * The window the `autoCompactWindow` keys give `model`, in tokens; null for none, or `"auto"`
 * (the model's own window). Merged as Claude Code 2.1.310 merges them (`s0t`): from the
 * person's file up to the project's local one, each file's `modelSettings.<id>.autoCompactWindow`
 * adds to the per-model entries, and a file with a top-level `autoCompactWindow` makes that the
 * default and drops the entries of the files below it. The model's own entry wins over the default
 * (`"auto"` included: it ends the search). Keys are matched by lower-case id without `[1m]`.
 */
function settingsWindowFrom(
  files: readonly Record<string, unknown>[],
  model: string,
): null | number {
  let fallback: "auto" | number | undefined;
  let byModel = new Map<string, "auto" | number>();
  for (const file of files.toReversed()) {
    const own = new Map<string, "auto" | number>();
    const models = file.modelSettings;
    if (isObject(models)) {
      for (const [id, entry] of Object.entries(models)) {
        const value = isObject(entry) ? windowValue(entry.autoCompactWindow, true) : undefined;
        if (value === undefined) continue;
        const key = settingsKeyOf(id);
        // An id spelled exactly as its key wins over a longer spelling of it.
        if (id === key || !own.has(key)) own.set(key, value);
      }
    }
    const top = windowValue(file.autoCompactWindow, false);
    if (top === undefined) byModel = new Map([...byModel, ...own]);
    else {
      fallback = top;
      byModel = own;
    }
  }
  const key = settingsKeyOf(model);
  const decided = byModel.has(key) ? byModel.get(key) : fallback;
  return typeof decided === "number" ? decided : null;
}

/** What applies to a session: the variables, and the window the settings keys give its model. */
export interface CompactWindows {
  env: CompactEnv;
  /** Tokens; null for no key or `"auto"`. */
  settings: null | number;
}

/**
 * The variables (`envFrom`) and the `autoCompactWindow` keys for `model`, from one read of
 * each file: the status line runs on every refresh and reads nothing twice. Claude Code uses the
 * variable first, then the keys, then the model's own window (the 2.1.310 binary, `TS`).
 */
export function compactWindowsOf(sources: CompactEnvSources, model: string): CompactWindows {
  const files = settingsFilesOf(sources);
  return { env: envFrom(files, sources.env), settings: settingsWindowFrom(files, model) };
}

/**
 * The main checkout of the git checkout `folder` is in, found without running git (the status
 * line runs on every refresh): the first folder up the tree with a `.git` entry; when that is a
 * linked worktree's `.git` file (`gitdir: <main>/.git/worktrees/<name>`), the folder that holds
 * the `.git` folder it names. A folder outside git, or a checkout whose `.git` file names
 * something else (a submodule), gives its own root; no checkout at all gives `folder` itself.
 */
export function mainCheckoutOfFolder(folder: string): string {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    const root = checkoutRootAt(dir);
    if (root !== null) return root;
    if (dirname(dir) === dir) return resolve(folder);
  }
}

function checkoutRootAt(dir: string): null | string {
  const entry = join(dir, ".git");
  try {
    if (statSync(entry).isDirectory()) return dir;
    const line = readFileSync(entry, "utf8").split("\n", 1)[0] ?? "";
    if (!line.startsWith("gitdir:")) return dir;
    const gitdir = resolve(dir, line.slice("gitdir:".length).trim());
    const worktrees = dirname(gitdir);
    const common = dirname(worktrees);
    return basename(worktrees) === "worktrees" && basename(common) === ".git"
      ? dirname(common)
      : dir;
  } catch {
    // No `.git` here (or none readable): look one folder up.
    return null;
  }
}
