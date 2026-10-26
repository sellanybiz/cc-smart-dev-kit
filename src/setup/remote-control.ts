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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getKey, type KeyPath, ownedRecords, ownership, readJsonObject } from "./managed-json";
import { realTarget } from "./write";

/**
 * The settings key that starts Remote Control's bridge at a session's start: its name (a crew
 * session's own settings file writes it `false`, `src/crew/start.ts`), and its path for setup.
 */
export const REMOTE_CONTROL_SETTING = "remoteControlAtStartup";
export const REMOTE_CONTROL_KEY: KeyPath = [REMOTE_CONTROL_SETTING];

/** The value setup manages it at. */
export const REMOTE_CONTROL_VALUE = true;

export interface RemoteControlPaths {
  settingsFile: string;
  stateDir: string;
}

/**
 * Says setup let go of the key once, because the person deleted or changed it. A lasting
 * record, like the status line's "no" (`statuslineDeclinedFile`): without it, the run after
 * the release finds no key and no claim, and writes `true` again over a deletion.
 */
export function remoteControlReleasedFile(stateDir: string): string {
  return join(stateDir, "remote-control-released");
}

/** What setup does with the key on this run. */
export type RemoteControlPlan = "set" | "drop" | "leave";

/**
 * - `set`: the key is absent and setup never let go of it (a first run), or it holds the
 *   `true` setup wrote and still owns (a later run, which then changes nothing);
 * - `drop`: setup wrote it once, and the person deleted or changed it since. The key is
 *   theirs: setup gives up its claim (one quiet line, once), so a later `true` of their own
 *   is never taken for setup's and removed by `restore`. The caller records the release
 *   (`remoteControlReleasedFile`), so the key is never written again;
 * - `leave`: a value of the person's own (`true` or `false`), never claimed, or an absent
 *   key after setup let go of it: setup does not touch it or say a word about it.
 */
export function planRemoteControl(paths: RemoteControlPaths): RemoteControlPlan {
  const current = getKey(readJsonObject(paths.settingsFile).data, REMOTE_CONTROL_KEY);
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  const whose = ownership(records, REMOTE_CONTROL_KEY, current);
  if (whose === "changed") return "drop";
  if (whose === "ours") return "set";
  if (!current.found)
    return existsSync(remoteControlReleasedFile(paths.stateDir)) ? "leave" : "set";
  return "leave";
}
