/**
 * Claude Code's own subagent cap, written as an owned settings key.
 * Setup merges `planMaxSubagents(...).set` into its one managed JSON write, under its lock.
 * Restore removes our key through the normal managed JSON record; a value the person changed
 * or removed stays theirs.
 */
import { COMMAND } from "../build-info";
import { getKey, type KeyPath, ownedRecords, ownership, readJsonObject } from "./managed-json";
import { realTarget } from "./write";

export const DEFAULT_MAX_SUBAGENTS = 10;
export const MAX_SUBAGENTS_ENV = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";
export const MAX_SUBAGENTS_FLAG = "--max-subagents";
export const MAX_SUBAGENTS_KEY: KeyPath = ["env", MAX_SUBAGENTS_ENV];

const FIX = `${MAX_SUBAGENTS_FLAG} needs a whole number from 1 to 100; run: ${COMMAND} setup ${MAX_SUBAGENTS_FLAG} ${DEFAULT_MAX_SUBAGENTS}`;
const CHANGE = `to change it, run: ${COMMAND} setup ${MAX_SUBAGENTS_FLAG} <n> (1–100)`;

function validateMaxSubagents(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(FIX);
  return value;
}

/** Parse the argument after --max-subagents. A missing or invalid value throws with a fix. */
export function parseMaxSubagents(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(FIX);
  return validateMaxSubagents(Number(value));
}

/**
 * Whose the key is now:
 *   - `ours`: it holds the value cc-smart-dev-kit wrote;
 *   - `yours`: it holds a value cc-smart-dev-kit did not write (set by hand, or changed since);
 *   - `removed`: cc-smart-dev-kit wrote it and the person deleted it since — their choice;
 *   - `unset`: it was never there.
 */
export type MaxSubagentsState =
  | { kind: "ours"; value: unknown }
  | { kind: "yours"; value: unknown }
  | { kind: "removed" }
  | { kind: "unset" };

/** Read-only. Throws when the settings file is not a JSON object. */
export function maxSubagentsState(settingsFile: string, stateDir: string): MaxSubagentsState {
  const current = getKey(readJsonObject(settingsFile).data, MAX_SUBAGENTS_KEY);
  const whose = ownership(
    ownedRecords(stateDir, realTarget(settingsFile)),
    MAX_SUBAGENTS_KEY,
    current,
  );
  if (current.found) {
    return whose === "ours"
      ? { kind: "ours", value: current.value }
      : { kind: "yours", value: current.value };
  }
  return whose === "none" ? { kind: "unset" } : { kind: "removed" };
}

export interface MaxSubagentsOptions {
  settingsFile: string;
  /** The settings file as setup's lines show it (`~/.claude/settings.json`); `settingsFile` when left out. */
  shownFile?: string;
  stateDir: string;
  /** The kit's requested value; omitted means the default. Never overrides a person's key. */
  maxSubagents?: number;
  dryRun?: boolean;
}

export interface MaxSubagentsPlan {
  /** Merge these pairs into setup's managed JSON set list. */
  set: ReadonlyArray<readonly [KeyPath, string]>;
  /** Print once as an info line, if present. No output is printed by this module. */
  note: string | null;
}

/** Read-only, including in a real run. Does not create settings, state or a lock. */
export function planMaxSubagents(options: MaxSubagentsOptions): MaxSubagentsPlan {
  const value = String(validateMaxSubagents(options.maxSubagents ?? DEFAULT_MAX_SUBAGENTS));
  const state = maxSubagentsState(options.settingsFile, options.stateDir);
  // A key removed after we wrote it is the person's choice too: setup says so in doctor's words.
  if (state.kind === "yours" || state.kind === "removed") {
    return { set: [], note: maxSubagentsLine(state, options.shownFile ?? options.settingsFile) };
  }
  return {
    set: [[MAX_SUBAGENTS_KEY, value]],
    note:
      state.kind === "ours" && state.value === value
        ? null
        : options.dryRun
          ? `would set max subagents: ${value}; ${CHANGE}`
          : `max subagents: ${value} (set by ${COMMAND}); ${CHANGE}`,
  };
}

/** A string as it is; anything else a person wrote (a number, null) as JSON. */
function shown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * How many subagents a session runs at once, and whose value: `doctor`'s one information line,
 * and setup's note when the value is the person's.
 */
export function maxSubagentsLine(state: MaxSubagentsState, settingsFile: string): string {
  switch (state.kind) {
    case "ours":
      return `max subagents: ${shown(state.value)} at once (set by ${COMMAND}); ${CHANGE}`;
    case "yours":
      return `max subagents: ${shown(state.value)} at once (your own ${MAX_SUBAGENTS_ENV} in ${settingsFile}; change it there to use another value)`;
    case "removed":
      return `max subagents: Claude Code's own default (you removed ${MAX_SUBAGENTS_ENV} from ${settingsFile}; set it by hand to use another value)`;
    case "unset":
      return `max subagents: Claude Code's own default; to use the kit's ${DEFAULT_MAX_SUBAGENTS}, run: ${COMMAND} setup`;
  }
}
