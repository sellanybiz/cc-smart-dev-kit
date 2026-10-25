/**
 * Claude Code's auto-compact variables, read only: the one reader of them.
 *
 * **What decides a crew session's auto-compact point** (proved from the 2.1.308 and 2.1.310
 * binaries and live on 2.1.310, `docs/claude-code-contract.md`): a crew session starts with
 * `--autocompact auto`, which makes Claude Code skip every `autoCompactWindow` and
 * `modelSettings.<model>.autoCompactWindow` setting. What still applies is the environment:
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (it wins over the model's own window), and
 * `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (it lowers the point to a share of the window).
 *
 * **Where the variables come from, in Claude Code's order** (P3 and P6 in the contract): a settings
 * file's `env` block beats the shell, and the first of these that sets a variable decides it: the
 * main checkout's `.claude/settings.local.json`, the session folder's own `settings.local.json`,
 * its `.claude/settings.json`, the user's `settings.json`, then the process environment. A file
 * that cannot be read, or holds no `env`, sets nothing.
 *
 * It does not read the `autoCompactWindow` keys: they do not apply to a crew session. A reader
 * of a normal session's window (the status line) adds them here, beside this one.
 */
import { join } from "node:path";
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

/** What `compactEnvOf` reads. */
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

/** The `env` block of one settings file, as text values; empty when there is none or it cannot be read. */
function settingsEnv(file: string): Record<string, string> {
  try {
    const parsed = readUserJson(file);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const env = (parsed as { env?: unknown }).env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" || typeof value === "number") out[key] = String(value);
    }
    return out;
  } catch {
    // A missing, unreadable or broken file sets nothing.
    return {};
  }
}

/**
 * The auto-compact variables that apply to a session running in `projectFolder`, in the order
 * the top of this file gives. The first source that sets a variable decides it, usable or not:
 * Claude Code ignores an unusable value and does not look further.
 */
export function compactEnvOf(sources: CompactEnvSources): CompactEnv {
  const layers: Record<string, string | undefined>[] = [
    settingsEnv(join(sources.mainCheckout, ".claude", "settings.local.json")),
    settingsEnv(join(sources.projectFolder, ".claude", "settings.local.json")),
    settingsEnv(join(sources.projectFolder, ".claude", "settings.json")),
    settingsEnv(join(sources.configDir, "settings.json")),
    sources.env,
  ];
  const decided = (key: string): string | undefined =>
    layers.find((layer) => layer[key] !== undefined)?.[key];
  const windowText = decided(AUTOCOMPACT_WINDOW_ENV);
  const percentText = decided(AUTOCOMPACT_PERCENT_ENV);
  return {
    percent: percentText === undefined ? null : parseCompactPercent(percentText),
    window: windowText === undefined ? null : parseCompactWindow(windowText),
  };
}
