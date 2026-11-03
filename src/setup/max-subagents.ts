/**
 * Claude Code's own subagent cap, written as an owned settings key.
 * The caller holds setup's lock for a real write. Restore removes our key through
 * the normal managed JSON record; a value the person changed or removed stays theirs.
 */
import { COMMAND } from "../build-info";
import {
  applyManagedJson,
  getKey,
  type KeyPath,
  type ManagedJsonResult,
  ownedRecords,
  ownership,
  readJsonObject,
} from "./managed-json";
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

export interface MaxSubagentsOptions {
  settingsFile: string;
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
  const current = getKey(readJsonObject(options.settingsFile).data, MAX_SUBAGENTS_KEY);
  const records = ownedRecords(options.stateDir, realTarget(options.settingsFile));
  const whose = ownership(records, MAX_SUBAGENTS_KEY, current);
  // A key removed after we wrote it is the person's choice too.
  if (current.found ? whose !== "ours" : whose !== "none") {
    return {
      set: [],
      note: `max subagents: your own ${MAX_SUBAGENTS_ENV} in ${options.settingsFile} is kept; change it by hand to use another value`,
    };
  }
  return {
    set: [[MAX_SUBAGENTS_KEY, value]],
    note:
      current.found && current.value === value
        ? null
        : options.dryRun
          ? `would set max subagents: ${value}; ${CHANGE}`
          : `max subagents: ${value} (set by ${COMMAND}); ${CHANGE}`,
  };
}

/** Apply through the owned-key writer. The caller holds the lock unless dryRun is true. */
export function applyMaxSubagents(
  options: MaxSubagentsOptions,
): ManagedJsonResult & { note: string | null } {
  const plan = planMaxSubagents(options);
  const result = applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    set: plan.set,
    dryRun: options.dryRun ?? false,
  });
  return { ...result, note: plan.note };
}
