/**
 * Claude Code's own plugin auto-update stays off for this marketplace (D39). The kit's own
 * background check updates the plugin, and it holds a new major version for the person
 * (D33). Claude Code knows nothing of that hold: with its auto-update on, it would install
 * the next major version by itself.
 *
 * WHY `false`, AND NOT A REMOVED KEY. Claude Code 2.1.306 decides by the first of these that
 * is set: the settings' `extraKnownMarketplaces.<name>.autoUpdate`, then the `autoUpdate` in
 * its own `known_marketplaces.json`, then its default (off for a marketplace that is not
 * Anthropic's). A session start copies a settings value into `known_marketplaces.json`, and
 * copies nothing when the settings have none. So a machine where an older setup wrote `true`
 * keeps `true` there after the key is removed: only an explicit `false` in the settings turns
 * it off (proved live, `docs/claude-code-contract.md`).
 *
 * `setup` writes `false` as a managed key (an older setup's `true` is its own, so it changes
 * it). The background check changes only that leftover `true` of setup's, so a `restore` that
 * took the key away is not undone behind the person's back. A value the person set is theirs:
 * neither writes over it, and `doctor` says what to do.
 */

import { MARKETPLACE } from "../build-info";
import { withLock } from "./lock";
import {
  applyManagedJson,
  getKey,
  type KeyPath,
  type ManagedJsonResult,
  ownedRecords,
  ownership,
  readJsonObject,
} from "./managed-json";
import { marketplaceAutoUpdate } from "./marketplace-access";
import { realTarget } from "./write";

/** The settings key that decides Claude Code's own auto-update for this marketplace. */
export const AUTO_UPDATE_KEY: KeyPath = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];

/** The value setup manages it at: off (see the header for why it is written, not removed). */
export const AUTO_UPDATE_VALUE = false;

export interface AutoUpdatePaths {
  settingsFile: string;
  knownMarketplacesFile: string;
  stateDir: string;
}

/**
 * Where Claude Code's own auto-update for this marketplace stands:
 * - `off`: nothing turns it on;
 * - `ours`: the settings hold `true`, and it is setup's own (an older setup wrote it);
 * - `yours`: the settings hold `true`, set by the person (or changed since setup set it);
 * - `known`: the settings have no value, and Claude Code's own record still says `true`.
 */
export type AutoUpdateState = "known" | "off" | "ours" | "yours";

/** Reads where it stands. Throws when the settings file is not valid JSON. */
export function autoUpdateState(paths: AutoUpdatePaths): AutoUpdateState {
  const current = getKey(readJsonObject(paths.settingsFile).data, AUTO_UPDATE_KEY);
  if (current.found) {
    if (current.value !== true) return "off";
    const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
    return ownership(records, AUTO_UPDATE_KEY, current) === "ours" ? "ours" : "yours";
  }
  return marketplaceAutoUpdate(paths.knownMarketplacesFile, MARKETPLACE) === true ? "known" : "off";
}

/**
 * The background check's part: turns setup's own leftover `true` to `false`, under the state
 * lock, through `applyManagedJson` (backup, atomic write, the ownership rules). Changes
 * nothing in any other state, so it is a no-op once done. Never waits: a busy lock throws
 * `LockBusyError`, and the caller logs it and goes on.
 */
export async function turnOffLeftoverAutoUpdate(
  paths: AutoUpdatePaths,
): Promise<{ state: AutoUpdateState; result: ManagedJsonResult | null }> {
  const state = autoUpdateState(paths);
  if (state !== "ours") return { result: null, state };
  const result = await withLock(paths.stateDir, () =>
    applyManagedJson({
      file: paths.settingsFile,
      stateDir: paths.stateDir,
      set: [[AUTO_UPDATE_KEY, AUTO_UPDATE_VALUE]],
    }),
  );
  return { result, state };
}
