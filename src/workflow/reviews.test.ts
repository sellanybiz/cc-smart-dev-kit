/** The review record: one small file per repository, and what it keeps. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  hasReview,
  REVIEWS_KEPT,
  readReviews,
  recordReview,
  repoKey,
  reviewsFile,
} from "./reviews";

/** The key of one repo, written the way the module does: a sha256 of its folder, 16 characters. */
function keyOf(repo: string): string {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A record file in a fresh temp folder, with `content` written into it. */
function fileWith(content: string | null): string {
  const file = join(tempDir("reviews"), "reviews", `${keyOf("/home/user/app")}.json`);
  if (content !== null) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return file;
}

describe("the record file", () => {
  test("one repository, one file under the state folder: the key is a hash of its folder", () => {
    expect(reviewsFile("/home/user/.claude/cc-smart-dev-kit", "/home/user/app")).toBe(
      join("/home/user/.claude/cc-smart-dev-kit", "reviews", `${keyOf("/home/user/app")}.json`),
    );
  });

  test("two repositories never share a file, and the same one always does", () => {
    const one = repoKey("/home/user/app");
    expect(one).toBe(repoKey("/home/user/app"));
    expect(one).not.toBe(repoKey("/home/user/other"));
  });
});

describe("reading", () => {
  test("no file: nothing is recorded", () => {
    expect(readReviews(fileWith(null))).toEqual({});
    expect(hasReview(fileWith(null), SHA_A)).toBe(false);
  });

  test("a file that is not JSON, or not an object: nothing is recorded, never a throw", () => {
    expect(readReviews(fileWith("not json"))).toEqual({});
    expect(readReviews(fileWith("[1, 2]"))).toEqual({});
    expect(readReviews(fileWith('"a string"'))).toEqual({});
  });

  test("entries that are not a commit sha, or not a time, are dropped", () => {
    const file = fileWith(
      JSON.stringify({
        [SHA_A]: "2026-10-16T10:00:00.000Z",
        abc: "2026-10-16T10:00:00.000Z",
        [SHA_B]: 7,
      }),
    );
    expect(readReviews(file)).toEqual({ [SHA_A]: "2026-10-16T10:00:00.000Z" });
    expect(hasReview(file, SHA_A)).toBe(true);
    expect(hasReview(file, SHA_B)).toBe(false);
  });
});

describe("recording", () => {
  test("a new commit is added with its time, in a 0600 file", () => {
    const file = fileWith(null);
    const result = recordReview(file, SHA_A, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(result).toEqual({ added: true, at: "2026-10-16T10:00:00.000Z" });
    expect(readFileSync(file, "utf8")).toBe(
      `${JSON.stringify({ [SHA_A]: "2026-10-16T10:00:00.000Z" }, null, 2)}\n`,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a commit recorded before keeps its first time, and nothing is written again", () => {
    const file = fileWith(`${JSON.stringify({ [SHA_A]: "2026-10-15T08:00:00.000Z" }, null, 2)}\n`);
    chmodSync(file, 0o600);
    const result = recordReview(file, SHA_A, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(result).toEqual({ added: false, at: "2026-10-15T08:00:00.000Z" });
    expect(readFileSync(file, "utf8")).toBe(
      `${JSON.stringify({ [SHA_A]: "2026-10-15T08:00:00.000Z" }, null, 2)}\n`,
    );
  });

  test("every other commit stays when one is added", () => {
    const file = fileWith(`${JSON.stringify({ [SHA_B]: "2026-10-15T08:00:00.000Z" }, null, 2)}\n`);
    recordReview(file, SHA_A, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(readReviews(file)).toEqual({
      [SHA_A]: "2026-10-16T10:00:00.000Z",
      [SHA_B]: "2026-10-15T08:00:00.000Z",
    });
  });

  test("only the newest commits are kept: the file stays small", () => {
    const file = fileWith(null);
    for (let index = 0; index <= REVIEWS_KEPT; index++) {
      const sha = index.toString(16).padStart(40, "0");
      recordReview(file, sha, Date.parse("2026-01-01T00:00:00.000Z") + index * 1000);
    }
    const record = readReviews(file);
    expect(Object.keys(record)).toHaveLength(REVIEWS_KEPT);
    // The oldest one (index 0) was dropped; the newest is there, with its own time.
    expect(record["0".repeat(40)]).toBeUndefined();
    expect(record[REVIEWS_KEPT.toString(16).padStart(40, "0")]).toBe(
      new Date(Date.parse("2026-01-01T00:00:00.000Z") + REVIEWS_KEPT * 1000).toISOString(),
    );
  });
});
