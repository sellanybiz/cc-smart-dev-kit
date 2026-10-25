/**
 * Remote Control's auto-connect (D66, the owner, 2026-10-25): setup writes
 * `remoteControlAtStartup: true` into Claude Code's user settings, so a session connects its
 * Remote Control bridge when it starts. Claude Code reads the key from the user's settings,
 * a `--settings` file or managed settings only, never from a project's files
 * (`docs/claude-code-contract.md`, the Remote Control rows).
 *
 * It is a default, not a decision for the person: the key is written only while it is
 * absent. A value the person set (`true` or `false`) is theirs, and so is a value they
 * changed after setup wrote it; `restore` removes the key only while it still holds the
 * value setup wrote (the managed-key rule, `applyManagedJson`).
 */

import { getKey, type KeyPath, ownedRecords, ownership, readJsonObject } from "./managed-json";
import { realTarget } from "./write";

/** The settings key that starts Remote Control's bridge at a session's start. */
export const REMOTE_CONTROL_KEY: KeyPath = ["remoteControlAtStartup"];

/** The value setup manages it at. */
export const REMOTE_CONTROL_VALUE = true;

export interface RemoteControlPaths {
  settingsFile: string;
  stateDir: string;
}

/**
 * Whether setup sets the key on this run: when it is absent (a first run), or when it holds
 * the value setup wrote and still owns (a later run, which then changes nothing). Any other
 * state is the person's, and setup does not touch it or say a word about it.
 */
export function planRemoteControl(paths: RemoteControlPaths): boolean {
  const current = getKey(readJsonObject(paths.settingsFile).data, REMOTE_CONTROL_KEY);
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  const whose = ownership(records, REMOTE_CONTROL_KEY, current);
  // Absent: a first run sets it, but a key setup wrote and the person deleted since is theirs
  // (`whose` is "changed") and is not put back.
  if (!current.found) return whose !== "changed";
  return Bun.deepEquals(current.value, REMOTE_CONTROL_VALUE, true) && whose === "ours";
}
