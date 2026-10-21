/**
 * A major version waits for the person (D33). The background check installs a patch or a
 * minor version by itself, but a new major one (0.7.0 → 1.0.0, 1.4.2 → 2.0.0) may need the
 * person's own work first — 1.0.0 refuses the retired worktree fields — so it is held until
 * the person runs `update`.
 *
 * AN INSTALLED VERSION THAT CANNOT BE READ IS NO MAJOR STEP. `installed_plugins.json` may name
 * no version (`findUserInstall` gives null), or one that is not a version. Then `isNewMajor` is
 * false, and the background check installs the newer version as it did before this rule: with
 * no version to compare, it cannot tell a major step from any other one.
 *
 * WHY THE NOTES ARE READ FROM THE NEW VERSION. The code that holds a major is the INSTALLED
 * version's code, and it cannot know why a later major is one. So each major says why in
 * `major-notes.json` (one short phrase per major version, keyed by the version that brings
 * it), and the check reads that file from Claude Code's copy of the marketplace — the new
 * version's own repo, refreshed a moment before. A copy without the file (another layout, a
 * marketplace that is not this repo) gives no note, and the line goes without one.
 *
 * NEVER MOVE `major-notes.json`: every installed version since 0.7.0 reads it at
 * `MAJOR_NOTES_PATH` in the new version's copy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info";

/** Where the notes are, from the marketplace's root: in this repo, and in Claude Code's copy of it. */
export const MAJOR_NOTES_PATH = join("src", "update", "major-notes.json");

/** The longest note shown: a few words, not a release note. */
const NOTE_MAX = 120;

/** The major number of a full version (`1` for `1.4.2`, `1.0.0-rc.1`), or null. */
function majorOf(version: string): null | number {
  const major = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/.exec(version.trim())?.[1];
  return major === undefined ? null : Number(major);
}

/**
 * True when `to` is a later major version than `from`: 0.6.0 → 1.0.0 or 1.1.0 (a prerelease
 * of 2.0.0 too), never 0.6.0 → 0.7.0 or 1.0.0 → 1.1.0. A version that cannot be read is no
 * major step: the update goes as it did before this rule. Compared by `Bun.semver`.
 */
export function isNewMajor(from: null | string, to: null | string): boolean {
  if (from === null || to === null) return false;
  const major = majorOf(from);
  if (major === null) return false;
  try {
    return Bun.semver.order(to, `${major + 1}.0.0-0`) >= 0;
  } catch {
    return false;
  }
}

/** A note fit for one line of a session's message: plain text, short; else null. */
function shownNote(note: unknown): null | string {
  if (typeof note !== "string") return null;
  const text = note.trim();
  return text !== "" && text.length <= NOTE_MAX && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : null;
}

/**
 * The notes of every major version a step from `from` to `to` crosses, oldest first, from a
 * notes file's text (`{ "1.0.0": "it refuses old project fields" }`). Empty when the text is
 * not such a file.
 */
export function majorNotesBetween(text: string, from: null | string, to: string): string[] {
  let table: unknown;
  try {
    table = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof table !== "object" || table === null || Array.isArray(table)) return [];
  const crossed = Object.keys(table).filter(
    (version) => majorOf(version) !== null && isNewMajor(from, version) && !isNewMajor(to, version),
  );
  return crossed
    .sort((a, b) => Bun.semver.order(a, b))
    .map((version) => shownNote((table as Record<string, unknown>)[version]))
    .filter((note): note is string => note !== null);
}

/** The notes of the majors from `from` to `to`, read from the copy at `location`; [] without the file. */
export function readMajorNotes(location: null | string, from: null | string, to: string): string[] {
  if (location === null) return [];
  try {
    return majorNotesBetween(readFileSync(join(location, MAJOR_NOTES_PATH), "utf8"), from, to);
  } catch {
    return [];
  }
}

/** Why a major is one, in brackets after "a major version", or nothing without a note. */
function why(notes: string[]): string {
  return notes.length === 0 ? "" : ` (${notes.join("; ")})`;
}

/** The one line a session start shows while a major version is held. */
export function majorReadyLine(version: string, notes: string[]): string {
  return `${PLUGIN} ${version} is ready: it is a major version${why(notes)}. Read What's new, then run \`${COMMAND} update\`.`;
}

/** What `update` says before it installs a major version, on the person's word. */
export function majorInstallLine(version: string, notes: string[]): string {
  return `${PLUGIN} ${version} is a major version${why(notes)}: installing it.`;
}

/** What `update` says after it installed a major version: its own one-time steps run in setup. */
export function majorSetupLine(): string {
  return `Run \`${COMMAND} setup\` now: a major version may need it.`;
}

/** What `update` says when a major version it tried to install is still not installed. */
export function majorStillWaitsLine(version: string, notes: string[]): string {
  return `${PLUGIN} ${version} is a major version${why(notes)}: it was not installed, and it still waits for \`${COMMAND} update\`.`;
}

/** The background check's record of a held major: `update-check.json`, the log, `doctor`. */
export function majorHeldDetail(version: string, notes: string[]): string {
  return `${version} is a major version${why(notes)}: it waits for \`${COMMAND} update\``;
}
