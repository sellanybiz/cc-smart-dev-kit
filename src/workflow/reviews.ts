/**
 * The review record: which commits of one repository had their one premium review — and its
 * fixes — on this machine.
 *
 * `cc-smart-dev-kit workflow review-done` writes one commit into it (default: HEAD). The merge
 * guard reads it before a merge it would make without a person: with `reviewBeforePush` on,
 * the pull request's head commit must be there, or the person is asked
 * (`src/hooks/merge-guard.ts`).
 *
 * One small JSON file per repository, under the plugin's state folder
 * (`<stateDir>/reviews/<key>.json`, mode 0600, written atomically): the full commit sha to
 * the time it was recorded. The key is a hash of the main checkout's folder — the same key
 * the after-merge note uses — so a repository and every worktree of it share one record,
 * and a record never follows a copy of the repository somewhere else.
 *
 * Nothing here decides policy: a commit either is recorded or is not. `reviewBeforePush` is
 * what says whether a record is needed at all (`schema.ts`), and the guard is what asks.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "../setup/write";

/** How many commits one repository's record keeps: the newest first, older ones dropped. */
export const REVIEWS_KEPT = 50;

/** A commit as git writes one: 40 hex characters, or 64 in a sha256 repository. */
const COMMIT_SHA = /^[0-9a-f]{40,64}$/;

/** One repository's reviewed commits: the full sha of each, to when it was recorded. */
export type ReviewRecord = Record<string, string>;

/**
 * The short, stable name of one repository: a hash of its main checkout's folder. The same
 * key the after-merge note makes for a repository (`after-merge.ts`).
 */
export function repoKey(repo: string): string {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

/** Where one repository's reviews are recorded: `<state dir>/reviews/<key>.json`. */
export function reviewsFile(stateDir: string, repo: string): string {
  return join(stateDir, "reviews", `${repoKey(repo)}.json`);
}

/** The record in `file`: `{}` when there is none, or it cannot be read. Never throws. */
export function readReviews(file: string): ReviewRecord {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const record: ReviewRecord = {};
    for (const [sha, at] of Object.entries(parsed)) {
      if (COMMIT_SHA.test(sha) && typeof at === "string") record[sha] = at;
    }
    return record;
  } catch {
    // No record yet, or one that cannot be read: nothing is recorded, and the guard asks.
    return {};
  }
}

/** True when `sha` has a recorded review in `file`. */
export function hasReview(file: string, sha: string): boolean {
  return readReviews(file)[sha] !== undefined;
}

/** The line a write that happened prints: the commit, and when it was recorded before. */
export interface RecordedReview {
  /** True when this call recorded it; false when it was recorded before. */
  added: boolean;
  /** When it was recorded: this call's time, or the time already in the file. */
  at: string;
}

/**
 * Records `sha` in `file`, at `atMs`. A commit already there keeps its first time. The file
 * keeps the newest `REVIEWS_KEPT` commits, so it stays small.
 */
export function recordReview(file: string, sha: string, atMs: number): RecordedReview {
  const record = readReviews(file);
  const before = record[sha];
  if (before !== undefined) return { added: false, at: before };
  const at = new Date(atMs).toISOString();
  record[sha] = at;
  const kept: ReviewRecord = {};
  for (const [commit, time] of Object.entries(record)
    .sort(([, a], [, b]) => b.localeCompare(a))
    .slice(0, REVIEWS_KEPT)) {
    kept[commit] = time;
  }
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`, 0o600);
  return { added: true, at };
}
