/**
 * herdr's own record of a worktree it launched a child in: `{repo, worktree, branch, at}`, one
 * private file under `<stateDir>/herdr/launches/`, keyed by the worktree's real path.
 *
 * Why it exists: a plan's recorded worktree is a task row, which any session may write. A path in
 * `<repo>/.claude/worktrees/` is a child's folder by its shape (`inDefaultFolder`). A project's
 * own WorktreeCreate hook may put a worktree anywhere, so the shape says nothing; the plan's
 * binding check (`prepareStart`) then accepts such a path only when git lists it for the repo
 * and this record names it. A path someone typed into a task row is never in it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { realPath } from "../hooks/git";
import { pathForm } from "../path-compare";
import { writePrivate } from "./brief";

export interface LaunchRecord {
  /** When herdr bound the worktree, in milliseconds. */
  at: number;
  /** The branch git lists for the worktree. */
  branch: string;
  /** The main checkout the child was launched for. */
  repo: string;
  /** The worktree's folder, as git lists it. */
  worktree: string;
}

export function launchRecordsFolder(stateDir: string): string {
  return join(stateDir, "herdr", "launches");
}

/** The file of one worktree's record: the hash of its real path, so a link and its target agree. */
export function launchRecordPath(stateDir: string, worktree: string): string {
  const key = createHash("sha256")
    .update(pathForm(realPath(worktree)))
    .digest("hex");
  return join(launchRecordsFolder(stateDir), `${key.slice(0, 32)}.json`);
}

export async function writeLaunchRecord(stateDir: string, record: LaunchRecord): Promise<void> {
  await writePrivate(launchRecordPath(stateDir, record.worktree), `${JSON.stringify(record)}\n`);
}

/** The record of a worktree, or null when there is none or the file is not a record. */
function readLaunchRecord(stateDir: string, worktree: string): LaunchRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(launchRecordPath(stateDir, worktree), "utf8"));
  } catch {
    // No file, or not JSON: herdr never launched this worktree, as far as it can tell.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { at, branch, repo, worktree: recorded } = parsed as Record<string, unknown>;
  if (
    typeof at !== "number" ||
    typeof branch !== "string" ||
    typeof repo !== "string" ||
    typeof recorded !== "string"
  )
    return null;
  return { at, branch, repo, worktree: recorded };
}

/**
 * Did herdr launch a child in this worktree of this repo? The record must name the same repo and
 * the same worktree (by real path), so a record cannot vouch for another repo's folder.
 */
export function launchedHere(stateDir: string, repo: string, worktree: string): boolean {
  const record = readLaunchRecord(stateDir, worktree);
  if (record === null) return false;
  const same = (a: string, b: string) => pathForm(realPath(a)) === pathForm(realPath(b));
  return same(record.repo, repo) && same(record.worktree, worktree);
}
