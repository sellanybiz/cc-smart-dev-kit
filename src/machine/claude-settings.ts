/**
 * Claude Code's auto-compact variables, read only: the one reader of them.
 *
 * **What decides a crew session's auto-compact point** (proved from the 2.1.308 and 2.1.310
 * binaries, `docs/claude-code-contract.md`): a crew session starts with `--autocompact auto`,
 * which makes Claude Code skip every `autoCompactWindow` and `modelSettings.<model>.autoCompactWindow`
 * setting. What still applies is the environment: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (it wins over
 * the model's own window), and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (it lowers the point to a share
 * of the window). Claude Code sets a settings file's `env` block into its own environment, so
 * this reads the process environment and the `env` block of the user, project and local
 * settings files.
 *
 * A source that cannot be read, or that holds nothing usable, is skipped. When several set a
 * value the smallest wins: a crew session then hands off early, never late.
 *
 * It does not read the `autoCompactWindow` keys: they do not apply to a crew session. A reader
 * of a normal session's window (the status line) adds them here, beside this one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The environment variable that sets the auto-compact window, in tokens. */
export const AUTOCOMPACT_WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";

/** The environment variable that lowers the compaction point to this share (1-100) of the window. */
export const AUTOCOMPACT_PERCENT_ENV = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";

/** The smallest and the largest window Claude Code takes (`--autocompact`: "100k-1M tokens"). */
export const AUTOCOMPACT_MIN_TOKENS = 100_000;
export const AUTOCOMPACT_MAX_TOKENS = 1_000_000;

/** What applies to a folder: the window variable, in tokens, and the percent variable. Null when unset. */
export interface CompactEnv {
  percent: null | number;
  window: null | number;
}

/** What `compactEnvOf` reads: Claude Code's config folder, the project's folder, and the environment. */
export interface CompactEnvSources {
  /** Claude Code's config folder (`CliPaths.claudeConfigDir`). */
  configDir: string;
  env: Record<string, string | undefined>;
  /** The folder Claude Code runs in: its `.claude/settings.json` and `.claude/settings.local.json`. */
  projectFolder: string;
}

/**
 * The window a value of `CLAUDE_CODE_AUTO_COMPACT_WINDOW` stands for, as Claude Code reads it: a
 * number of tokens, or a number with `k` or `M`; out of range it is held at the nearest end.
 * Null when it is no number.
 */
export function parseCompactWindow(text: string): null | number {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(text.trim());
  if (match === null) return null;
  const unit = match[2]?.toLowerCase();
  const scale = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  const tokens = Math.round(Number(match[1]) * scale);
  return Math.min(AUTOCOMPACT_MAX_TOKENS, Math.max(AUTOCOMPACT_MIN_TOKENS, tokens));
}

/** A share of 1-100 from the percent variable; null for anything else. */
function parsePercent(text: string): null | number {
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 1 && value <= 100 ? value : null;
}

/** The `env` block of one settings file, as text values; empty when there is none or it cannot be read. */
function settingsEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const env = (parsed as { env?: unknown }).env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" || typeof value === "number") out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** The smaller of two readings, where null is no reading. */
function smaller(a: null | number, b: null | number): null | number {
  return a === null ? b : b === null ? a : Math.min(a, b);
}

/**
 * The auto-compact variables that apply to a session running in `projectFolder`: the process
 * environment and the `env` block of the user, project and local settings files. See the top of
 * this file for why these and no setting key.
 */
export function compactEnvOf(sources: CompactEnvSources): CompactEnv {
  const layers: Record<string, string | undefined>[] = [
    sources.env,
    settingsEnv(join(sources.configDir, "settings.json")),
    settingsEnv(join(sources.projectFolder, ".claude", "settings.json")),
    settingsEnv(join(sources.projectFolder, ".claude", "settings.local.json")),
  ];
  let window: null | number = null;
  let percent: null | number = null;
  for (const layer of layers) {
    const windowText = layer[AUTOCOMPACT_WINDOW_ENV];
    if (windowText !== undefined) window = smaller(window, parseCompactWindow(windowText));
    const percentText = layer[AUTOCOMPACT_PERCENT_ENV];
    if (percentText !== undefined) percent = smaller(percent, parsePercent(percentText));
  }
  return { percent, window };
}
