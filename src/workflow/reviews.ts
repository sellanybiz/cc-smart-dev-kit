/**
 * The review record: which commits of one repository had their one premium review — and its
 * fixes — on this machine, and who recorded each.
 *
 * Two writers fill it: the `review-record` hook, when a review agent stops on the same commit
 * it started on (`src/hooks/review-record.ts`), and `cc-smart-dev-kit workflow review-done`,
 * which the person runs by hand in their own terminal (`BY_HAND`). The merge guard reads it
 * before a merge it would make without a person: with `reviewBeforePush` on, the pull
 * request's head commit must be there, recorded by an agent the `reviewAgents` list it judges
 * with names, or by hand (`src/hooks/merge-guard.ts`).
 *
 * One small JSON file per repository, under the plugin's state folder
 * (`<stateDir>/reviews/<key>.json`, mode 0600, written atomically): the full commit sha to
 * when it was first recorded and every writer that recorded it. The key is a hash of the main
 * checkout's folder — the same key the after-merge note uses — so a repository and every
 * worktree of it share one record, and a record never follows a copy of the repository
 * somewhere else. Beside it, `<key>.starts.json` holds the commit each review agent started
 * on, until it stops.
 *
 * **Every write holds the record's own lock** (`withLock` on the `reviews` folder, a short
 * wait): two reviewers that finish at once both land, and no read-modify-write drops the
 * other's commit. It is not the state folder's shared lock, whose 10 s wait is as long as a
 * hook may run.
 *
 * Nothing here decides policy: a commit either is recorded by a writer or is not.
 * `reviewBeforePush` says whether a record is needed at all (`schema.ts`), and the guard asks.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";

/** How many commits one repository's record keeps: the newest first, older ones dropped. */
export const REVIEWS_KEPT = 50;

/**
 * How long a write waits for the record's lock. A write takes milliseconds; the hook that
 * writes has 10 s, so this leaves it room to say on stderr that it could not.
 */
export const REVIEWS_LOCK_WAIT_MS = 3_000;

/** A start older than this is forgotten: no review agent runs for a day. */
export const START_KEPT_MS = 24 * 60 * 60 * 1000;

/** The writer `workflow review-done` records: the person, by hand, in their own terminal. */
export const BY_HAND = "workflow review-done";

/** A commit as git writes one: 40 hex characters, or 64 in a sha256 repository. */
export const COMMIT_SHA = /^[0-9a-f]{40,64}$/;

/** One recorded commit: when it was first recorded, and every writer that recorded it. */
export interface ReviewEntry {
  at: string;
  by: string[];
}

/** One repository's reviewed commits: the full sha of each, to its entry. */
export type ReviewRecord = Record<string, ReviewEntry>;

/**
 * Is `agent` (an `agent_type` as Claude Code reports it) one of the review agents `agents`
 * lists? The one home of that question. A `plugin:name` in the list matches that plugin's
 * agent only, exactly; a bare name matches only an agent with no plugin prefix, exactly — so
 * another plugin's `reviewer`, or a project agent of that name, never counts for this plugin's
 * `cc-smart-dev-kit:reviewer`. Claude Code reports a plugin agent as `plugin:name` and a
 * project agent by its frontmatter `name` (code.claude.com/docs/en/hooks § SubagentStart).
 */
export function recordsReview(agent: string, agents: readonly string[]): boolean {
  return agents.some((name) => name === agent);
}

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

/** Where one repository's review agents' starts are kept: `<state dir>/reviews/<key>.starts.json`. */
export function reviewStartsFile(stateDir: string, repo: string): string {
  return join(stateDir, "reviews", `${repoKey(repo)}.starts.json`);
}

/** A JSON object from `file`, or `{}` when there is none or it cannot be read. Never throws. */
function readObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // No file yet, or one that cannot be read: nothing is recorded, and the guard asks.
    return {};
  }
}

/** A list of non-empty strings, or null when `value` is not one. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((one) => typeof one === "string" && one !== "") ? value : null;
}

/**
 * The record in `file`: `{}` when there is none, or it cannot be read. Never throws. An entry
 * that names no writer — what a plugin before 1.0.0 wrote, `sha: time` — is dropped: it
 * cannot say which agent wrote it, so it proves no review now.
 */
export function readReviews(file: string): ReviewRecord {
  const record: ReviewRecord = {};
  for (const [sha, entry] of Object.entries(readObject(file))) {
    if (!COMMIT_SHA.test(sha) || typeof entry !== "object" || entry === null) continue;
    const { at, by } = entry as { at?: unknown; by?: unknown };
    const writers = stringList(by);
    if (typeof at === "string" && writers !== null) record[sha] = { at, by: writers };
  }
  return record;
}

/**
 * True when `sha` has a recorded review in `file` by a writer that counts: an agent `agents`
 * lists (`recordsReview`), or the person by hand (`BY_HAND`).
 */
export function hasReview(file: string, sha: string, agents: readonly string[]): boolean {
  const entry = readReviews(file)[sha];
  return entry?.by.some((by) => by === BY_HAND || recordsReview(by, agents)) ?? false;
}

/** The line a write that happened prints: the commit, and when it was recorded before. */
export interface RecordedReview {
  /** True when this call recorded it for this writer; false when that was done before. */
  added: boolean;
  /** When the commit was first recorded: this call's time, or the time already in the file. */
  at: string;
}

/** Runs `write` holding the record's own lock, in the folder of `file` (mode 0700). */
async function underRecordLock<T>(file: string, write: () => T): Promise<T> {
  const folder = dirname(file);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(folder, write, { waitMs: REVIEWS_LOCK_WAIT_MS });
}

/**
 * Records `sha` in `file` for writer `by`, at `atMs`. A commit already there keeps its first
 * time and gains the writer. The file keeps the newest `REVIEWS_KEPT` commits, so it stays
 * small. Throws `LockBusyError` when the lock stays held past `REVIEWS_LOCK_WAIT_MS`.
 */
export async function recordReview(
  file: string,
  sha: string,
  by: string,
  atMs: number,
): Promise<RecordedReview> {
  return await underRecordLock(file, () => {
    const record = readReviews(file);
    const before = record[sha];
    if (before?.by.includes(by)) return { added: false, at: before.at };
    const at = before?.at ?? new Date(atMs).toISOString();
    record[sha] = { at, by: [...(before?.by ?? []), by] };
    const kept: ReviewRecord = {};
    for (const [commit, entry] of Object.entries(record)
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, REVIEWS_KEPT)) {
      kept[commit] = entry;
    }
    atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`, 0o600);
    return { added: true, at };
  });
}

/** One review agent's start: the commit its folder was on, and when. */
interface ReviewStart {
  head: string;
  at: number;
}

/**
 * The key of one agent in the starts file. SubagentStop's `agent_id` is bare hex (proved on
 * 2.1.300, `docs/claude-code-contract.md`); SubagentStart's documented example carries an
 * `agent-` prefix, so both forms name the same agent. Null for an id that names nothing.
 */
export function agentIdKey(agentId: string): string | null {
  const key = agentId.replace(/^agent-/, "");
  return key === "" ? null : key;
}

/** The starts in `file`, the ones that are not well formed dropped. */
function readStarts(file: string): Record<string, ReviewStart> {
  const starts: Record<string, ReviewStart> = {};
  for (const [key, entry] of Object.entries(readObject(file))) {
    if (typeof entry !== "object" || entry === null) continue;
    const { head, at } = entry as { head?: unknown; at?: unknown };
    if (typeof head === "string" && COMMIT_SHA.test(head) && typeof at === "number") {
      starts[key] = { head, at };
    }
  }
  return starts;
}

/**
 * Notes that review agent `agentId` started with its folder on `head`. A start already noted
 * for it stays: a resumed agent (SubagentStart fires again) must not move the commit it began
 * reading. Starts older than `START_KEPT_MS` are dropped on the way.
 */
export async function noteReviewStart(
  file: string,
  agentId: string,
  head: string,
  atMs: number,
): Promise<void> {
  const key = agentIdKey(agentId);
  if (key === null) return;
  await underRecordLock(file, () => {
    const starts = readStarts(file);
    const kept: Record<string, ReviewStart> = {};
    for (const [one, start] of Object.entries(starts)) {
      if (atMs - start.at <= START_KEPT_MS) kept[one] = start;
    }
    if (kept[key] !== undefined) return;
    kept[key] = { head, at: atMs };
    atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`, 0o600);
  });
}

/**
 * The commit review agent `agentId` started on, taken out of `file` (a stop is the end of
 * that start), or null when none was noted.
 */
export async function takeReviewStart(file: string, agentId: string): Promise<string | null> {
  const key = agentIdKey(agentId);
  if (key === null) return null;
  return await underRecordLock(file, () => {
    const starts = readStarts(file);
    const start = starts[key];
    if (start === undefined) return null;
    delete starts[key];
    atomicWrite(file, `${JSON.stringify(starts, null, 2)}\n`, 0o600);
    return start.head;
  });
}
