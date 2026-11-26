/**
 * Does a review still cover a later head of its branch (D17)? Every case runs in a real temp
 * repository with a bare `origin`, and every count it expects is written by hand from the
 * files the case writes.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GIT_TIMED_OUT, runGitAsync } from "../hooks/git";
import { type Checkout, locateCheckout } from "../project/resolve";
import { makeClone } from "../testing/hooks";
import { cleanGitEnv, git, withGitVersion } from "../testing/temp";
import {
  allowanceOf,
  type ChangeCount,
  type Cover,
  type CoverGit,
  type CoverTarget,
  coverRefusal,
  type FixLimits,
  parseNumstat,
  readCover,
} from "./review-cover";
import type { TrustedReview } from "./reviews";

/** Git-heavy cases on a loaded machine: each gets its own generous time. */
const SLOW = 60_000;

const LIMITS: FixLimits = { lines: 200, files: 10, percent: 20 };
const AT = "2026-10-21T10:00:00.000Z";

interface World {
  repo: string;
  env: Record<string, string>;
  checkout: Checkout;
}

/** A clone of a bare `origin` whose `main` has one commit (README.md). */
function world(): World {
  const { repo } = makeClone();
  const env = cleanGitEnv();
  const checkout = locateCheckout(repo, { env });
  if (checkout === null) throw new Error("the clone is not a git checkout");
  return { repo, env, checkout };
}

/** `n` lines `<tag> 1` … `<tag> n`, each ending in a newline. */
function numbered(n: number, tag: string): string {
  return Array.from({ length: n }, (_, index) => `${tag} ${index + 1}\n`).join("");
}

/** Writes each file (null removes it), commits everything, and returns the new commit. */
function commit(
  repo: string,
  files: Record<string, string | Uint8Array | null>,
  message = "change",
): string {
  for (const [path, content] of Object.entries(files)) {
    const file = join(repo, path);
    if (content === null) {
      rmSync(file);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return head(repo);
}

/** The commit `repo` is on. */
function head(repo: string): string {
  return git(repo, "rev-parse", "HEAD").trim();
}

/** A commit on `main`, pushed to `origin`, then back to `branch`. */
function toBase(repo: string, files: Record<string, string | null>, branch = "feat"): string {
  git(repo, "checkout", "-q", "main");
  const sha = commit(repo, files, "base");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-q", branch);
  return sha;
}

/** On a new branch `feat`: the reviewed change, 100 lines in 2 files. */
function reviewed(repo: string): string {
  git(repo, "checkout", "-q", "-b", "feat");
  return commit(
    repo,
    { "src/a.txt": numbered(60, "a"), "src/b.txt": numbered(40, "b") },
    "reviewed",
  );
}

/** One recorded review of `sha`, on `branches`. */
function record(sha: string, branches: string[] = ["feat"]): TrustedReview {
  return { sha, at: AT, branches };
}

/** Is `target` covered by `records` in `w`, with `limits`? */
async function cover(
  w: World,
  records: TrustedReview[],
  target: Partial<CoverTarget> = {},
  limits: FixLimits = LIMITS,
  env: Record<string, string> = w.env,
) {
  return await readCover(
    w.checkout,
    { head: head(w.repo), branch: "feat", base: "main", ...target },
    records,
    limits,
    { env },
  );
}

/** A count with nothing generated and nothing binary. */
function count(lines: number, files: number): ChangeCount {
  return { lines, files, generated: [], binary: [] };
}

/** The 100 reviewed lines in 2 files every case starts from. */
const REVIEWED = count(100, 2);

/** The first seven characters of a commit. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** How many files the repository's object folder holds: loose objects and packs. */
function objectFiles(repo: string): number {
  let files = 0;
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(folder, entry.name));
      else files += 1;
    }
  };
  walk(join(repo, ".git", "objects"));
  return files;
}

describe("D17: fixes after a review", () => {
  test(
    "D17: fixes under the limit are covered",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/a.txt": numbered(70, "a") }, "fix");
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(10, 1),
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );

  test(
    "D17: over the lines: not covered, and the reason names the counts and the limit",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/c.txt": numbered(250, "c") }, "fix");
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        delta: count(250, 1),
        review: R,
        reviewed: REVIEWED,
        why: `250 lines in 1 file changed after the review of ${short(R)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)`,
      });
    },
    SLOW,
  );

  test(
    "D17: over the files: not covered",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const files: Record<string, string> = {};
      for (let index = 0; index < 11; index += 1) files[`src/f${index}.txt`] = `f ${index}\n`;
      commit(w.repo, files, "fix");
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        delta: count(11, 11),
        review: R,
        reviewed: REVIEWED,
        why: `11 lines in 11 files changed after the review of ${short(R)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)`,
      });
    },
    SLOW,
  );

  test(
    "D17: the percent raises the floor",
    async () => {
      const w = world();
      git(w.repo, "checkout", "-q", "-b", "feat");
      // 100 lines in 4 files: 50% of it is 50 lines and 2 files, over the 10 lines and 1 file.
      const R = commit(w.repo, {
        "src/a.txt": numbered(25, "a"),
        "src/b.txt": numbered(25, "b"),
        "src/c.txt": numbered(25, "c"),
        "src/d.txt": numbered(25, "d"),
      });
      commit(w.repo, { "src/a.txt": numbered(45, "a"), "src/b.txt": numbered(45, "b") }, "fix");
      expect(await cover(w, [record(R)], {}, { lines: 10, files: 1, percent: 50 })).toEqual({
        covered: true,
        review: R,
        delta: count(40, 2),
        reviewed: count(100, 4),
      });
      expect(await cover(w, [record(R)], {}, { lines: 10, files: 1, percent: 0 })).toEqual({
        covered: false,
        delta: count(40, 2),
        review: R,
        reviewed: count(100, 4),
        why: `40 lines in 2 files changed after the review of ${short(R)}, over the limit of 10 lines and 1 file (fixesAfterReview: 10 lines, 1 file, or 0% of the reviewed 100 lines in 4 files)`,
      });
    },
    SLOW,
  );

  test(
    "D17: a new file counts",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/new.txt": numbered(5, "new") }, "fix");
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(5, 1),
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );
});

describe("D17: the base taken out", () => {
  test(
    "D17: the base merged into the branch after the review: the base's changes are not counted",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      toBase(w.repo, { "base.txt": numbered(300, "base") });
      git(w.repo, "merge", "-q", "--no-edit", "origin/main");
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(0, 0),
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );

  test(
    "D17: a hand-resolved conflict in that merge is counted, and nothing is written into the repo",
    async () => {
      const w = world();
      toBase(w.repo, { "shared.txt": "one\ntwo\nthree\n" }, "main");
      git(w.repo, "checkout", "-q", "-b", "feat");
      // The reviewed change: 100 new lines, and "two" changed — 102 lines in 3 files.
      const R = commit(w.repo, {
        "src/a.txt": numbered(60, "a"),
        "src/b.txt": numbered(40, "b"),
        "shared.txt": "one\ntwo (review)\nthree\n",
      });
      toBase(w.repo, { "shared.txt": "one\ntwo (base)\nthree\n" });
      const merge = Bun.spawnSync(["git", "merge", "-q", "--no-edit", "origin/main"], {
        cwd: w.repo,
        env: w.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(merge.exitCode).toBe(1);
      commit(w.repo, { "shared.txt": "one\ntwo (both)\nthree\n" }, "merge");
      const before = objectFiles(w.repo);
      // The replay holds the five conflict lines; the resolution is one line: 6 lines in 1 file.
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(6, 1),
        reviewed: count(102, 3),
      });
      expect(objectFiles(w.repo)).toBe(before);
    },
    SLOW,
  );

  test(
    "D17: a pure rebase after the review is covered",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      toBase(w.repo, { "other.txt": numbered(30, "other") });
      git(w.repo, "rebase", "-q", "origin/main");
      expect(head(w.repo)).not.toBe(R);
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(0, 0),
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );

  test(
    "D17: a rebase that edits code: the edits count",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      toBase(w.repo, { "other.txt": numbered(30, "other") });
      git(w.repo, "rebase", "-q", "origin/main");
      writeFileSync(join(w.repo, "src", "a.txt"), numbered(63, "a"));
      git(w.repo, "commit", "-q", "-a", "--amend", "--no-edit");
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: count(3, 1),
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );

  test(
    "D17: a squash-merged review covers nothing, when the branch name is used again",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      git(w.repo, "checkout", "-q", "main");
      git(w.repo, "merge", "-q", "--squash", "feat");
      git(w.repo, "commit", "-q", "-m", "squashed");
      git(w.repo, "push", "-q", "origin", "main");
      git(w.repo, "checkout", "-q", "-B", "feat", "origin/main");
      commit(w.repo, { "src/next.txt": "next\n" }, "next");
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        review: null,
        why: `the review of feat (${short(R)}) covers nothing new: its change is already in origin/main`,
      });
    },
    SLOW,
  );
});

describe("D17: which reviews are candidates", () => {
  test(
    "D17: a revert of the reviewed change asks",
    async () => {
      const w = world();
      git(w.repo, "checkout", "-q", "-b", "feat");
      const R = commit(w.repo, { "src/a.txt": numbered(250, "a") }, "reviewed");
      git(w.repo, "revert", "--no-edit", R);
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        delta: count(250, 1),
        review: R,
        reviewed: count(250, 1),
        why: `250 lines in 1 file changed after the review of ${short(R)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 250 lines in 1 file)`,
      });
    },
    SLOW,
  );

  test(
    "D17: two reviews: the one with the smallest change wins, whatever the order",
    async () => {
      const w = world();
      const R1 = reviewed(w.repo);
      const R2 = commit(w.repo, { "src/c.txt": numbered(50, "c") }, "first fix");
      commit(w.repo, { "src/d.txt": numbered(5, "d") }, "second fix");
      const expected: Cover = {
        covered: true,
        review: R2,
        delta: count(5, 1),
        reviewed: count(150, 3),
      };
      expect(await cover(w, [record(R1), record(R2)])).toEqual(expected);
      expect(await cover(w, [record(R2), record(R1)])).toEqual(expected);
    },
    SLOW,
  );

  test(
    "D17: another branch's review never covers",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const H = commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      expect(await cover(w, [record(R, ["other"])])).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)}, for an earlier commit of feat, or on a local branch that holds ${short(H)}`,
      });
    },
    SLOW,
  );

  test(
    "D17: a stacked PR is not covered by the review below it",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      git(w.repo, "checkout", "-q", "-b", "feat2");
      const H = commit(w.repo, { "src/stacked.txt": "stacked\n" }, "stacked");
      expect(await cover(w, [record(R)], { branch: "feat2" })).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)}, for an earlier commit of feat2, or on a local branch that holds ${short(H)}`,
      });
    },
    SLOW,
  );

  test(
    "#934: a review on a builder's branch covers the PR pushed from it under another name",
    async () => {
      const w = world();
      git(w.repo, "checkout", "-q", "-b", "worktree-agent-x");
      const R = commit(
        w.repo,
        { "src/a.txt": numbered(60, "a"), "src/b.txt": numbered(40, "b") },
        "reviewed",
      );
      const H = commit(w.repo, { "src/a.txt": numbered(70, "a") }, "fix");
      git(w.repo, "branch", "fix/y");
      // The builder goes on after the push: its branch still holds the PR's head.
      commit(w.repo, { "src/later.txt": "later\n" }, "later");
      // A tag of the same name makes git's short name `heads/worktree-agent-x`: never read that way.
      git(w.repo, "tag", "worktree-agent-x", R);
      const builder = [record(R, ["worktree-agent-x"])];
      expect(await cover(w, builder, { head: H, branch: "fix/y" })).toEqual({
        covered: true,
        review: R,
        delta: count(10, 1),
        reviewed: REVIEWED,
      });
      // Within the limits only: a fix over them is measured, and refused.
      git(w.repo, "checkout", "-q", "fix/y");
      const big = commit(w.repo, { "src/c.txt": numbered(250, "c") }, "big fix");
      git(w.repo, "branch", "-f", "worktree-agent-x", big);
      expect(await cover(w, builder, { head: big, branch: "fix/y" })).toEqual({
        covered: false,
        delta: count(260, 2),
        review: R,
        reviewed: REVIEWED,
        why: `260 lines in 2 files changed after the review of ${short(R)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)`,
      });
    },
    SLOW,
  );

  test(
    "#934: a review on a branch whose tip does not hold the head is no candidate, and the reason says what was looked for",
    async () => {
      const w = world();
      git(w.repo, "checkout", "-q", "-b", "worktree-agent-x");
      const R = commit(w.repo, { "src/a.txt": numbered(60, "a") }, "reviewed");
      git(w.repo, "checkout", "-q", "-b", "fix/y", "origin/main");
      const H = commit(w.repo, { "src/a.txt": numbered(61, "a") }, "unrelated");
      expect(await cover(w, [record(R, ["worktree-agent-x"])], { branch: "fix/y" })).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)}, for an earlier commit of fix/y, or on a local branch that holds ${short(H)}`,
      });
    },
    SLOW,
  );

  test(
    "#934: a squash-merged parent's review does not cover the PR stacked on it",
    async () => {
      // The child still sits on the old base, so the parent's change replays as new work: only
      // the branch's tip, which never holds the child's head, keeps the parent's review out.
      const w = world();
      const R = reviewed(w.repo);
      git(w.repo, "checkout", "-q", "-b", "child");
      const H = commit(w.repo, { "src/child.txt": "child\n" }, "child");
      git(w.repo, "checkout", "-q", "main");
      git(w.repo, "merge", "-q", "--squash", "feat");
      git(w.repo, "commit", "-q", "-m", "squashed");
      git(w.repo, "push", "-q", "origin", "main");
      git(w.repo, "checkout", "-q", "child");
      expect(await cover(w, [record(R)], { branch: "child" })).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)}, for an earlier commit of child, or on a local branch that holds ${short(H)}`,
      });
    },
    SLOW,
  );

  test(
    "#934: a reviewed branch merged into the PR's branch is no candidate",
    async () => {
      const w = world();
      git(w.repo, "checkout", "-q", "-b", "other");
      const R = commit(w.repo, { "src/other.txt": numbered(60, "o") }, "reviewed elsewhere");
      git(w.repo, "checkout", "-q", "-b", "feat", "origin/main");
      commit(w.repo, { "src/a.txt": numbered(5, "a") }, "own");
      git(w.repo, "merge", "-q", "--no-edit", "other");
      const H = head(w.repo);
      expect(await cover(w, [record(R, ["other"])])).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)}, for an earlier commit of feat, or on a local branch that holds ${short(H)}`,
      });
    },
    SLOW,
  );

  test(
    "#934: a covering review stands when the time runs out on an older one; the newest is measured first",
    async () => {
      const w = world();
      const R1 = reviewed(w.repo);
      const R2 = commit(w.repo, { "src/c.txt": numbered(50, "c") }, "first fix");
      commit(w.repo, { "src/d.txt": numbered(5, "d") }, "second fix");
      const older = { sha: R1, at: "2026-10-21T09:00:00.000Z", branches: ["feat"] };
      const newer = { sha: R2, at: "2026-10-21T10:00:00.000Z", branches: ["feat"] };
      // Every git call about the older review times out.
      const run: CoverGit["run"] = async (cwd, args, env, timeoutMs, own) =>
        args.some((arg) => arg.startsWith(R1))
          ? { ok: false, out: "", err: GIT_TIMED_OUT, code: null }
          : await runGitAsync(cwd, args, env, timeoutMs, own);
      const target = { head: head(w.repo), branch: "feat", base: "main" };
      expect(
        await readCover(w.checkout, target, [older, newer], LIMITS, { env: w.env, run }),
      ).toEqual({ covered: true, review: R2, delta: count(5, 1), reviewed: count(150, 3) });
      // With no covering review measured yet, running out of time is the answer.
      expect(await readCover(w.checkout, target, [older], LIMITS, { env: w.env, run })).toEqual({
        covered: false,
        review: null,
        why: "the time to measure the change after the review ran out",
      });
    },
    SLOW,
  );

  test(
    "D17: a review of the head itself covers it on any branch, with no git run",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const covered: Cover = { covered: true, review: R, delta: null, reviewed: null };
      expect(await cover(w, [record(R, ["other"])])).toEqual(covered);
      // No git at all on PATH: the exact match needs none.
      expect(
        await cover(w, [record(R, [])], {}, LIMITS, { ...w.env, PATH: "/nonexistent" }),
      ).toEqual(covered);
    },
    SLOW,
  );

  test(
    "D17: a 0.6.0 record without a branch counts for its exact commit only",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      expect(await cover(w, [record(R, [])])).toMatchObject({ covered: true, review: R });
      const H = commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      expect(await cover(w, [record(R, [])])).toEqual({
        covered: false,
        review: null,
        why: `no review is recorded for ${short(H)} or for an earlier commit of feat`,
      });
    },
    SLOW,
  );

  test(
    "D17: limits 0/0/0 mean the exact head only",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const zero = { lines: 0, files: 0, percent: 0 };
      expect(await cover(w, [record(R)], {}, zero)).toMatchObject({ covered: true, review: R });
      toBase(w.repo, { "other.txt": "other\n" });
      git(w.repo, "rebase", "-q", "origin/main");
      expect(await cover(w, [record(R)], {}, zero)).toEqual({
        covered: false,
        review: R,
        why: `fixesAfterReview is 0/0/0, so only a review of ${short(head(w.repo))} itself counts`,
      });
    },
    SLOW,
  );
});

describe("D17: what is listed, not counted, and what is never covered", () => {
  test(
    "D17: a file the base marks generated is listed, not counted",
    async () => {
      const w = world();
      toBase(w.repo, { ".gitattributes": "dist/** linguist-generated=true\n" }, "main");
      const R = reviewed(w.repo);
      commit(w.repo, { "dist/bundle.js": numbered(500, "bundle"), "src/a.txt": numbered(62, "a") });
      expect(await cover(w, [record(R)])).toEqual({
        covered: true,
        review: R,
        delta: { lines: 2, files: 1, generated: ["dist/bundle.js"], binary: [] },
        reviewed: REVIEWED,
      });
    },
    SLOW,
  );

  test(
    "D17: a PR's own .gitattributes hides nothing",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, {
        ".gitattributes": "big.js linguist-generated=true\n",
        "big.js": numbered(500, "big"),
      });
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        delta: count(501, 2),
        review: R,
        reviewed: REVIEWED,
        why: `501 lines in 2 files changed after the review of ${short(R)}, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)`,
      });
    },
    SLOW,
  );

  test(
    "D17: a binary file changed after the review: not covered",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "logo.bin": new Uint8Array([0, 1, 2, 0, 255, 0]) });
      expect(await cover(w, [record(R)])).toEqual({
        covered: false,
        delta: { binary: ["logo.bin"], files: 1, generated: [], lines: 0 },
        review: R,
        reviewed: REVIEWED,
        why: `logo.bin is a binary file changed after the review of ${short(R)}: its change cannot be counted`,
      });
    },
    SLOW,
  );
});

describe("D17: what cannot be read is not covered, with the reason", () => {
  test(
    "D17: the head not in the checkout: not covered, fetch it",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const missing = "e".repeat(40);
      expect(await cover(w, [record(R)], { head: missing })).toEqual({
        covered: false,
        review: null,
        why: "eeeeeee is not in this checkout: fetch it (git fetch origin)",
      });
    },
    SLOW,
  );

  test(
    "D17: no git to run: not covered, and the reason says so",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      const result = await cover(w, [record(R)], {}, LIMITS, { ...w.env, PATH: "/nonexistent" });
      expect(result.covered).toBe(false);
      expect(result.covered === false && result.why).toStartWith("git cannot be run here (");
    },
    SLOW,
  );

  test(
    "D17: the reviewed commit not in the checkout: not covered, fetch it",
    async () => {
      const w = world();
      reviewed(w.repo);
      const missing = "d".repeat(40);
      expect(await cover(w, [record(missing)])).toEqual({
        covered: false,
        review: missing,
        why: "the reviewed commit ddddddd is not in this checkout: fetch it (git fetch origin)",
      });
    },
    SLOW,
  );

  test(
    "D17: no origin/<base>: not covered, fetch it",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      expect(await cover(w, [record(R)], { base: "release" })).toEqual({
        covered: false,
        review: null,
        why: "origin/release is not in this checkout: fetch it (git fetch origin release)",
      });
    },
    SLOW,
  );

  test(
    "D17: git older than 2.40: the exact head only, with the reason",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      const old = withGitVersion(w.env, "2.39.2");
      expect(await cover(w, [record(R)], {}, LIMITS, old)).toMatchObject({
        covered: true,
        review: R,
      });
      const H = commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      expect(await cover(w, [record(R)], {}, LIMITS, old)).toEqual({
        covered: false,
        review: null,
        why: `git 2.39.2 is older than 2.40, so a change after a review cannot be measured: only a review of ${short(H)} itself counts (update git)`,
      });
    },
    SLOW,
  );

  test(
    "D17: the caller's time ran out: not covered, and no git runs",
    async () => {
      const w = world();
      const R = reviewed(w.repo);
      commit(w.repo, { "src/a.txt": numbered(61, "a") }, "fix");
      const target = { head: head(w.repo), branch: "feat", base: "main" };
      expect(
        await readCover(w.checkout, target, [record(R)], LIMITS, { env: w.env, timeFor: () => 0 }),
      ).toEqual({
        covered: false,
        review: null,
        why: "the time to measure the change after the review ran out",
      });
    },
    SLOW,
  );
});

describe("D17: the pure parts", () => {
  test("D17: coverRefusal: at the limit is covered, one over is not; 1 is singular", () => {
    const R = "a".repeat(40);
    expect(coverRefusal(count(200, 10), REVIEWED, LIMITS, R)).toBeNull();
    expect(coverRefusal(count(201, 1), REVIEWED, LIMITS, R)).toBe(
      "201 lines in 1 file changed after the review of aaaaaaa, over the limit of 200 lines and 10 files (fixesAfterReview: 200 lines, 10 files, or 20% of the reviewed 100 lines in 2 files)",
    );
    expect(coverRefusal(count(1, 2), count(1, 1), { lines: 1, files: 1, percent: 0 }, R)).toBe(
      "1 line in 2 files changed after the review of aaaaaaa, over the limit of 1 line and 1 file (fixesAfterReview: 1 line, 1 file, or 0% of the reviewed 1 line in 1 file)",
    );
  });

  test("D17: coverRefusal: two binary files name the first and how many more", () => {
    const delta = { lines: 0, files: 2, generated: [], binary: ["a.png", "b.png"] };
    expect(coverRefusal(delta, REVIEWED, LIMITS, "b".repeat(40))).toBe(
      "a.png (and 1 other) is a binary file changed after the review of bbbbbbb: its change cannot be counted",
    );
  });

  test("D17: coverRefusal: limits 0/0/0 refuse even an empty change", () => {
    expect(
      coverRefusal(count(0, 0), REVIEWED, { lines: 0, files: 0, percent: 0 }, "c".repeat(40)),
    ).toBe("fixesAfterReview is 0/0/0, so only the reviewed commit ccccccc itself counts");
  });

  test("D17: allowanceOf: the limit, or the percent of the reviewed change, whichever is larger", () => {
    // 20% of 100 lines and 2 files is 20 and 0: the limits (200 and 10) are larger.
    expect(allowanceOf(REVIEWED, LIMITS)).toEqual({ files: 10, lines: 200 });
    // 50% of 100 lines and 4 files is 50 and 2: the percent is larger.
    expect(allowanceOf(count(100, 4), { files: 1, lines: 10, percent: 50 })).toEqual({
      files: 2,
      lines: 50,
    });
    // 20% of 3 lines and 3 files is 0 and 0, counted down: the limits stay.
    expect(allowanceOf(count(3, 3), { files: 1, lines: 1, percent: 20 })).toEqual({
      files: 1,
      lines: 1,
    });
  });

  test("D17: parseNumstat reads a change, a rename and a binary file", () => {
    expect(
      parseNumstat(
        "3\t1\tsrc/a.txt\u00000\t0\t\u0000old name.txt\u0000new name.txt\u0000-\t-\tlogo.png\u0000",
      ),
    ).toEqual([
      { path: "src/a.txt", lines: 4 },
      { path: "new name.txt", lines: 0 },
      { path: "logo.png", lines: null },
    ]);
    expect(parseNumstat("")).toEqual([]);
    expect(() => parseNumstat("not numstat\u0000")).toThrow(
      "git diff --numstat printed a line it cannot read",
    );
  });
});
