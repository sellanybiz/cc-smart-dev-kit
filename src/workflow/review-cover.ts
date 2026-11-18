/**
 * Does a recorded review still count for a later head of its branch? Decision D17: a review of
 * commit R covers head H when R's record names H's branch and the change made since R — the
 * base's own changes taken out — stays within the limits committed on the base
 * (`workflow.fixesAfterReview`). A review of H itself always counts, on any branch (the rule
 * before D17).
 *
 * **How the change is measured, without writing into the repository:**
 *
 * 1. `B = git merge-base H origin/<base>`: the base as H's branch knows it.
 * 2. `T = git merge-tree --write-tree B R`: the reviewed change replayed on that base — what the
 *    branch would hold had nobody touched it after the review. merge-tree writes the trees and
 *    blobs it makes into an object folder, so it runs with a TEMPORARY one
 *    (`GIT_OBJECT_DIRECTORY`), the repository's own objects only read through
 *    `GIT_ALTERNATE_OBJECT_DIRECTORIES`; the folder is removed after. A conflicted replay
 *    (exit 1) still prints a valid tree, with the conflict markers in its files: the hand
 *    resolution in H then counts as change after the review, as it should.
 * 3. The change after the review: `git diff --numstat -z -M T H`. The reviewed change, the size
 *    the percent limit is taken of: the same count over `merge-base(R, origin/<base>)..R`.
 *
 * So the base merged into the branch after the review counts for nothing, a rebase that only
 * moved the branch counts for nothing, and every line written after the review counts, wherever
 * it came in: a fix commit, a rebase that edits, a conflict resolved by hand, a new file.
 *
 * **What a count leaves out, and what it refuses.** Files the base marks `linguist-generated`
 * (read with `git check-attr --source=origin/<base>`: the base's attributes, never the branch's
 * own, so a pull request cannot hide a file by marking it) are listed, not counted. A binary file
 * changed after the review is never covered: its lines cannot be counted. A review whose change
 * is already all in the base (its branch was squash-merged, and the name was used again) is no
 * candidate at all.
 *
 * Anything it cannot read is "not covered", with the reason: the head or the reviewed commit not
 * in this checkout (fetch it), no `origin/<base>`, git older than 2.40 (`check-attr --source`
 * came in 2.40), the caller's time running out. It never reaches the network: the caller fetches.
 *
 * Nothing here decides policy: whether a review is needed at all, and which writers count, are
 * the caller's (`reviewBeforePush`, `reviewAgents`, `trustedReviews` in `reviews.ts`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { GIT_TIMED_OUT, type GitRun, GUARD_GIT_TIMEOUT_MS, runGitAsync } from "../hooks/git";
import type { Env } from "../hooks/run";
import type { Checkout } from "../project/resolve";
import { COMMIT_SHA, type TrustedReview } from "./reviews";

/** `git check-attr --source` came in git 2.40: an older git can only match the exact head. */
export const MIN_COVER_GIT = "2.40.0";

/** How many paths one `git check-attr` call names: well inside every system's argument limit. */
const PATHS_PER_CALL = 200;

/** `workflow.fixesAfterReview` as resolved: each a whole number, 0 or more. */
export interface FixLimits {
  lines: number;
  files: number;
  percent: number;
}

/** One change, counted. */
export interface ChangeCount {
  /** Lines added plus lines deleted, generated and binary files left out. */
  lines: number;
  /** Paths changed, generated files left out (binary ones counted). */
  files: number;
  /** The paths the base marks `linguist-generated`: listed, not counted. */
  generated: string[];
  /** The binary paths that are not generated: their lines cannot be counted. */
  binary: string[];
}

/** The head being judged: its commit, its branch (null: none known), and its base branch. */
export interface CoverTarget {
  head: string;
  branch: string | null;
  base: string;
}

/** How `readCover` runs git: the environment, and the caller's time. */
export interface CoverGit {
  env: Env;
  /**
   * How long the next git call may take: the smaller of `limitMs` and the time the caller has
   * left (the merge guard's `timeFor`). Zero or less: out of time. Left out: `limitMs`.
   */
  timeFor?: (limitMs: number) => number;
  /**
   * How one git call runs: `runGitAsync` (never `Bun.spawnSync`) in use, a fake in a test.
   * The measurement is read inside the portal's own process too, where a blocking spawn
   * freezes every page and the live stream (`.claude/rules/portal.md`).
   */
  run?: (
    cwd: string,
    args: string[],
    env: Env,
    timeoutMs: number,
    own: Record<string, string>,
  ) => Promise<GitRun>;
}

/** The answer: covered by which review (and by how much change), or not, and why. */
export type Cover =
  | {
      covered: true;
      /** The reviewed commit that covers the head. */
      review: string;
      /** The change after it; null when the review is of the head itself. */
      delta: ChangeCount | null;
      /** The reviewed change's own size; null when the review is of the head itself. */
      reviewed: ChangeCount | null;
    }
  | {
      covered: false;
      /** The candidate the reason is about; null when there was none. */
      review: string | null;
      /** The reason, as words a person reads: the counts and the limit, or what to fetch. */
      why: string;
      /**
       * The change after the review that is over the limit, and the reviewed change it is
       * judged against. Present only when the reason is that measurement; absent when nothing
       * was measured (no candidate, limits of 0/0/0, git that cannot measure).
       */
      delta?: ChangeCount;
      reviewed?: ChangeCount;
    };

/** The first seven characters of a commit: how a person reads it. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** `1 line`, `2 lines`. */
function counted(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** True for the limits that mean "the exact reviewed commit only". */
function exactOnly(limits: FixLimits): boolean {
  return limits.lines === 0 && limits.files === 0 && limits.percent === 0;
}

/**
 * What a review still covers: for the lines and for the files, the larger of `limits` and
 * `percent`% of the reviewed change, counted down (`Math.floor`). One home for the rule:
 * `coverRefusal` judges a change against it, and a page draws its meters from it.
 */
export function allowanceOf(
  reviewed: ChangeCount,
  limits: FixLimits,
): { files: number; lines: number } {
  return {
    files: Math.max(limits.files, Math.floor((reviewed.files * limits.percent) / 100)),
    lines: Math.max(limits.lines, Math.floor((reviewed.lines * limits.percent) / 100)),
  };
}

/**
 * Why the change `delta`, made after the review of `review` whose own change was `reviewed`,
 * is not covered by `limits`; null when it is. Covered when the delta stays within what the
 * review covers (`allowanceOf`: the limit, or `percent`% of the reviewed change, whichever is
 * more, for lines and for files each). A binary file in the delta is never covered; limits of
 * 0/0/0 cover nothing but the reviewed commit itself.
 */
export function coverRefusal(
  delta: ChangeCount,
  reviewed: ChangeCount,
  limits: FixLimits,
  review: string,
): string | null {
  const of = short(review);
  if (exactOnly(limits)) {
    return `fixesAfterReview is 0/0/0, so only the reviewed commit ${of} itself counts`;
  }
  const [binary, ...more] = delta.binary;
  if (binary !== undefined) {
    const others = more.length === 0 ? "" : ` (and ${counted(more.length, "other")})`;
    return `${binary}${others} is a binary file changed after the review of ${of}: its change cannot be counted`;
  }
  const allowance = allowanceOf(reviewed, limits);
  if (delta.lines <= allowance.lines && delta.files <= allowance.files) return null;
  return (
    `${counted(delta.lines, "line")} in ${counted(delta.files, "file")} changed after the review of ${of}, ` +
    `over the limit of ${counted(allowance.lines, "line")} and ${counted(allowance.files, "file")} ` +
    `(fixesAfterReview: ${counted(limits.lines, "line")}, ${counted(limits.files, "file")}, ` +
    `or ${limits.percent}% of the reviewed ${counted(reviewed.lines, "line")} in ${counted(reviewed.files, "file")})`
  );
}

/** The version `git --version` names (`2.53.0`), or null when it cannot be read. */
export function parseGitVersion(out: string): string | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  return match === null ? null : `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
}

/** True when git `version` is too old to measure a change after a review (`MIN_COVER_GIT`). */
export function tooOldToCover(version: string): boolean {
  return Bun.semver.order(version, MIN_COVER_GIT) < 0;
}

/** What `readCover` says when git is older than `MIN_COVER_GIT`. */
function oldGit(version: string, head: string): string {
  return `git ${version} is older than 2.40, so a change after a review cannot be measured: only a review of ${short(head)} itself counts (update git)`;
}

/** A path in a change: what numstat said of it. */
interface Changed {
  path: string;
  /** Added plus deleted; null for a binary file. */
  lines: number | null;
}

/**
 * The entries of `git diff --numstat -z`: `added\tdeleted\tpath\0`, or for a rename
 * `added\tdeleted\t\0old\0new\0`. A binary file shows `-` for both counts. Throws on output
 * that does not read as numstat.
 */
export function parseNumstat(out: string): Changed[] {
  const parts = out.split("\0");
  const changed: Changed[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (part === "") continue;
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(part);
    if (match === null)
      throw new Error(`git diff --numstat printed a line it cannot read: ${part}`);
    let path = match[3] ?? "";
    if (path === "") {
      // A rename or a copy: the old path, then the new one, each its own field.
      path = parts[index + 2] ?? "";
      index += 2;
      if (path === "") throw new Error("git diff --numstat printed a rename without its path");
    }
    const lines = match[1] === "-" || match[2] === "-" ? null : Number(match[1]) + Number(match[2]);
    changed.push({ path, lines });
  }
  return changed;
}

/** Stops the measurement: the head is not covered, for `message`, about `review`. */
class Uncovered extends Error {
  constructor(
    message: string,
    readonly review: string | null = null,
  ) {
    super(message);
  }
}

/** A candidate review, measured. */
interface Measured {
  review: string;
  delta: ChangeCount;
  reviewed: ChangeCount;
  refusal: string | null;
}

/** git's objects folder as an alternates entry: C-quoted, so no separator in the path splits it. */
function alternateEntry(folder: string): string {
  return `"${folder.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Whether a recorded review covers `target.head`. `records` are the repository's reviews by a
 * writer that counts (`trustedReviews`): one of the head itself covers it at once, on any
 * branch, with no git run; one recorded on `target.branch` is a candidate, measured as above.
 * The covered candidate with the smallest change is the one named; when none is covered, the
 * reason is about the candidate with the smallest change. Never throws.
 */
export async function readCover(
  checkout: Checkout,
  target: CoverTarget,
  records: readonly TrustedReview[],
  limits: FixLimits,
  git: CoverGit,
): Promise<Cover> {
  const { head, branch } = target;
  if (records.some((record) => record.sha === head)) {
    return { covered: true, review: head, delta: null, reviewed: null };
  }
  const candidates = [
    ...new Set(
      branch === null
        ? []
        : records.filter((record) => record.branches.includes(branch)).map((r) => r.sha),
    ),
  ];
  if (candidates.length === 0) {
    const earlier = branch === null ? "" : ` or for an earlier commit of ${branch}`;
    return {
      covered: false,
      review: null,
      why: `no review is recorded for ${short(head)}${earlier}`,
    };
  }
  if (exactOnly(limits)) {
    return {
      covered: false,
      review: candidates[0] ?? null,
      why: `fixesAfterReview is 0/0/0, so only a review of ${short(head)} itself counts`,
    };
  }
  let objects: string | null = null;
  try {
    objects = mkdtempSync(join(tmpdir(), `${COMMAND}-cover-`));
    // Awaited inside this try: a rejected measurement must become the answer below, never
    // escape past the `finally` that removes the temporary object folder.
    return await measure(checkout, target, candidates, limits, git, objects);
  } catch (error) {
    if (error instanceof Uncovered)
      return { covered: false, review: error.review, why: error.message };
    const why = error instanceof Error ? error.message : String(error);
    return {
      covered: false,
      review: null,
      why: `the change after the review cannot be read (${why})`,
    };
  } finally {
    if (objects !== null) rmSync(objects, { recursive: true, force: true });
  }
}

/** The measurement itself: every git call `readCover` makes. Throws `Uncovered` with a reason. */
async function measure(
  checkout: Checkout,
  { head, branch, base }: CoverTarget,
  candidates: readonly string[],
  limits: FixLimits,
  git: CoverGit,
  objects: string,
): Promise<Cover> {
  const baseRef = `refs/remotes/origin/${base}`;
  // Every call reads the repository's objects and writes only into the temporary folder.
  const own = {
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateEntry(join(checkout.commonDir, "objects")),
  };
  const run = async (args: string[]): Promise<GitRun> => {
    const left = (git.timeFor ?? ((limit: number) => limit))(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0) throw new Uncovered("the time to measure the change after the review ran out");
    const result = await (git.run ?? runGitAsync)(checkout.root, args, git.env, left, own);
    if (result.code === null && result.err === GIT_TIMED_OUT) {
      throw new Uncovered("the time to measure the change after the review ran out");
    }
    return result;
  };
  const commit = async (rev: string): Promise<string | null> => {
    const found = await run(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    return found.ok && COMMIT_SHA.test(found.out) ? found.out : null;
  };

  const asked = await run(["--version"]);
  if (!asked.ok) throw new Uncovered(`git cannot be run here (${asked.err})`);
  const version = parseGitVersion(asked.out);
  if (version !== null && tooOldToCover(version)) throw new Uncovered(oldGit(version, head));
  if (!COMMIT_SHA.test(head) || (await commit(head)) === null) {
    throw new Uncovered(`${short(head)} is not in this checkout: fetch it (git fetch origin)`);
  }
  if ((await commit(baseRef)) === null) {
    throw new Uncovered(
      `origin/${base} is not in this checkout: fetch it (git fetch origin ${base})`,
    );
  }
  const mergeBase = async (a: string, b: string): Promise<string> => {
    const found = await run(["merge-base", a, b]);
    if (!found.ok) {
      throw new Uncovered(`${short(a)} and origin/${base} share no history`, a === head ? null : a);
    }
    return found.out;
  };
  const numstat = async (from: string, to: string, review: string): Promise<Changed[]> => {
    // No textconv and no external diff: what is counted is the bytes in the commits, never what
    // a checkout's own attributes or config turn them into.
    const diff = await run([
      "diff",
      "--no-textconv",
      "--no-ext-diff",
      "--numstat",
      "-z",
      "-M",
      from,
      to,
    ]);
    if (!diff.ok) {
      throw new Uncovered(
        `the change after the review of ${short(review)} cannot be read (${diff.err})`,
        review,
      );
    }
    return parseNumstat(diff.out);
  };
  const generatedOf = async (paths: readonly string[]): Promise<Set<string>> => {
    const generated = new Set<string>();
    for (let at = 0; at < paths.length; at += PATHS_PER_CALL) {
      const some = paths.slice(at, at + PATHS_PER_CALL);
      const attrs = await run([
        "check-attr",
        `--source=${baseRef}`,
        "-z",
        "linguist-generated",
        "--",
        ...some,
      ]);
      if (!attrs.ok) {
        throw new Uncovered(
          `which files origin/${base} marks as generated cannot be read (${attrs.err})`,
        );
      }
      const fields = attrs.out.split("\0");
      for (let index = 0; index + 2 < fields.length; index += 3) {
        const value = fields[index + 2];
        if (value === "set" || value === "true") generated.add(fields[index] ?? "");
      }
    }
    return generated;
  };
  const tally = (changed: readonly Changed[], generated: ReadonlySet<string>): ChangeCount => {
    const count: ChangeCount = { lines: 0, files: 0, generated: [], binary: [] };
    for (const one of changed) {
      if (generated.has(one.path)) {
        count.generated.push(one.path);
        continue;
      }
      count.files += 1;
      if (one.lines === null) count.binary.push(one.path);
      else count.lines += one.lines;
    }
    return count;
  };

  const onBase = await mergeBase(head, baseRef);
  const measured: Measured[] = [];
  const unread: Uncovered[] = [];
  for (const review of candidates) {
    try {
      if ((await commit(review)) === null) {
        throw new Uncovered(
          `the reviewed commit ${short(review)} is not in this checkout: fetch it (git fetch origin)`,
          review,
        );
      }
      const replay = await run(["merge-tree", "--write-tree", "--no-messages", onBase, review]);
      // Exit 1 is a conflicted replay: its tree is still valid, and the conflict counts as change.
      const tree = replay.out.split("\n")[0] ?? "";
      if ((replay.code !== 0 && replay.code !== 1) || !COMMIT_SHA.test(tree)) {
        throw new Uncovered(
          `the review of ${short(review)} cannot be replayed on origin/${base} (${replay.err})`,
          review,
        );
      }
      const same = await run(["diff", "--no-textconv", "--no-ext-diff", "--quiet", onBase, tree]);
      if (same.code === 0) continue; // its change is all in the base already: no candidate
      if (same.code !== 1) {
        throw new Uncovered(
          `the review of ${short(review)} cannot be compared (${same.err})`,
          review,
        );
      }
      const after = await numstat(tree, head, review);
      const before = await numstat(await mergeBase(review, baseRef), review, review);
      const generated = await generatedOf([
        ...new Set([...after, ...before].map((one) => one.path)),
      ]);
      const delta = tally(after, generated);
      const reviewed = tally(before, generated);
      measured.push({
        review,
        delta,
        reviewed,
        refusal: coverRefusal(delta, reviewed, limits, review),
      });
    } catch (error) {
      if (!(error instanceof Uncovered) || error.review === null) throw error;
      unread.push(error);
    }
  }
  // The smallest change first: no binary file, then the fewest lines, then the fewest files.
  measured.sort(
    (a, b) =>
      Number(a.delta.binary.length > 0) - Number(b.delta.binary.length > 0) ||
      a.delta.lines - b.delta.lines ||
      a.delta.files - b.delta.files,
  );
  const covering = measured.find((one) => one.refusal === null);
  if (covering !== undefined) {
    return {
      covered: true,
      review: covering.review,
      delta: covering.delta,
      reviewed: covering.reviewed,
    };
  }
  const smallest = measured[0];
  if (smallest !== undefined && smallest.refusal !== null) {
    return {
      covered: false,
      review: smallest.review,
      why: smallest.refusal,
      delta: smallest.delta,
      reviewed: smallest.reviewed,
    };
  }
  const [first] = unread;
  if (first !== undefined) throw first;
  const listed = candidates.map(short).join(", ");
  throw new Uncovered(
    `the review of ${branch ?? "this branch"} (${listed}) covers nothing new: its change is already in origin/${base}`,
  );
}
