/**
 * The one rule for a path that names a file or folder inside the repository: a plan's file list
 * (`normalizePlanFile`, `src/tasks/work/queries.ts`) and `plans.mergeFiles` (`normalizeMergeFile`,
 * `schema.ts`) both write their entries by it, so a path means the same in each list and an
 * overlap check never compares two spellings. Each caller words the refusal for its own reader.
 * Pure: whether a path without a trailing `/` is a folder needs the repository, so the callers
 * that have one check that themselves.
 */

/** Why a path cannot stand. */
export type RepoPathProblem =
  /** A control character (a line break, a tab). */
  | "control"
  /** `*` or `?`: a path is named, never matched. */
  | "pattern"
  /** Empty, `.` or `/`: the whole repository. */
  | "root"
  /** `/x` or `C:\x`. */
  | "absolute"
  /** A `..` segment. */
  | "up";

export type RepoPath = { ok: true; path: string } | { ok: false; problem: RepoPathProblem };

/**
 * A path as written, normalised: `/` as the separator, no `./` or doubled `/`, and a folder (a
 * trailing `/` or `/.`) written with one trailing `/`. Refuses a control character, a pattern
 * character (`*` or `?`: a wildcard would overlap nothing, and a folder is named with a trailing
 * `/`), the root, an absolute path and a `..` segment. `[` and `]` stay: they are plain characters
 * in a name (a Next.js route `app/[id]/page.tsx`), and no list reaches git as a pathspec, where
 * `[` would be a glob. A plan's files are compared as text, and a `plans.mergeFiles` entry goes to
 * git only inside `git cat-file -t <rev>:<path>`, where the path after the colon is literal.
 */
export function normalizeRepoPath(raw: string): RepoPath {
  const text = raw.trim().replaceAll("\\", "/");
  if (/\p{Cc}/u.test(text)) return { ok: false, problem: "control" };
  if (/[*?]/.test(text)) return { ok: false, problem: "pattern" };
  const kept = text.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (kept.length === 0) return { ok: false, problem: "root" };
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return { ok: false, problem: "absolute" };
  if (kept.includes("..")) return { ok: false, problem: "up" };
  const folder = text.endsWith("/") || text.endsWith("/.");
  return { ok: true, path: `${kept.join("/")}${folder ? "/" : ""}` };
}
