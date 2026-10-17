/** The review record: one small file per repository, and what it keeps. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import {
  BY_HAND,
  hasReview,
  noteReviewStart,
  REVIEWS_KEPT,
  readReviews,
  recordReview,
  recordsReview,
  repoKey,
  reviewStartsFile,
  reviewsFile,
  takeReviewStart,
} from "./reviews";

/** The key of one repo, written the way the module does: a sha256 of its folder, 16 characters. */
function keyOf(repo: string): string {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const REVIEWER = "cc-smart-dev-kit:reviewer";
const AGENTS = [REVIEWER];

/** A record file in a fresh temp folder, with `content` written into it. */
function fileWith(content: string | null): string {
  const file = join(tempDir("reviews"), "reviews", `${keyOf("/home/user/app")}.json`);
  if (content !== null) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return file;
}

/** A record's text as the module writes it. */
function text(record: unknown): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

describe("the record file", () => {
  test("one repository, one file under the state folder: the key is a hash of its folder", () => {
    expect(reviewsFile("/home/user/.claude/cc-smart-dev-kit", "/home/user/app")).toBe(
      join("/home/user/.claude/cc-smart-dev-kit", "reviews", `${keyOf("/home/user/app")}.json`),
    );
    expect(reviewStartsFile("/home/user/.claude/cc-smart-dev-kit", "/home/user/app")).toBe(
      join(
        "/home/user/.claude/cc-smart-dev-kit",
        "reviews",
        `${keyOf("/home/user/app")}.starts.json`,
      ),
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
    expect(hasReview(fileWith(null), SHA_A, AGENTS)).toBe(false);
  });

  test("a file that is not JSON, or not an object: nothing is recorded, never a throw", () => {
    expect(readReviews(fileWith("not json"))).toEqual({});
    expect(readReviews(fileWith("[1, 2]"))).toEqual({});
    expect(readReviews(fileWith('"a string"'))).toEqual({});
  });

  test("entries that are not a commit sha, not a time, or name no writer are dropped", () => {
    const file = fileWith(
      JSON.stringify({
        [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] },
        abc: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] },
        [SHA_B]: { at: 7, by: [REVIEWER] },
        ["c".repeat(40)]: { at: "2026-10-16T10:00:00.000Z", by: [] },
      }),
    );
    expect(readReviews(file)).toEqual({
      [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] },
    });
    expect(hasReview(file, SHA_A, AGENTS)).toBe(true);
    expect(hasReview(file, SHA_B, AGENTS)).toBe(false);
  });

  test("HK-6: an entry an older plugin wrote names no agent, so it is no review now", () => {
    // 0.5.x wrote `sha: time` and matched any agent named "reviewer"; such an entry cannot
    // say which agent it was, so the guard asks once for that commit.
    const file = fileWith(JSON.stringify({ [SHA_A]: "2026-10-16T10:00:00.000Z" }));
    expect(readReviews(file)).toEqual({});
    expect(hasReview(file, SHA_A, AGENTS)).toBe(false);
  });

  test("HK-6: a commit counts only when an agent the given list names recorded it", () => {
    const file = fileWith(
      JSON.stringify({
        [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: ["other-plugin:reviewer"] },
        [SHA_B]: { at: "2026-10-16T10:00:00.000Z", by: ["reviewer", REVIEWER] },
      }),
    );
    expect(hasReview(file, SHA_A, AGENTS)).toBe(false);
    expect(hasReview(file, SHA_B, AGENTS)).toBe(true);
    // The list the guard reads decides: a list naming the other plugin's agent trusts it.
    expect(hasReview(file, SHA_A, ["other-plugin:reviewer"])).toBe(true);
  });

  test("a record the person wrote by hand counts whatever the list says", () => {
    const file = fileWith(
      JSON.stringify({ [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [BY_HAND] } }),
    );
    expect(hasReview(file, SHA_A, ["fresh-eyes"])).toBe(true);
  });
});

describe("which agent names count (HK-6: one matcher, its own)", () => {
  test("HK-6: a plugin:name in the list matches only that plugin's agent, exactly", () => {
    expect(recordsReview(REVIEWER, AGENTS)).toBe(true);
    expect(recordsReview("other-plugin:reviewer", AGENTS)).toBe(false);
    expect(recordsReview("reviewer", AGENTS)).toBe(false);
    expect(recordsReview("Reviewer", AGENTS)).toBe(false);
    expect(recordsReview("cc-smart-dev-kit:Reviewer", AGENTS)).toBe(false);
  });

  test("HK-6: a bare name matches only an agent with no plugin prefix, exactly", () => {
    expect(recordsReview("fresh-eyes", ["fresh-eyes"])).toBe(true);
    expect(recordsReview("some-plugin:fresh-eyes", ["fresh-eyes"])).toBe(false);
    expect(recordsReview("Fresh Eyes", ["fresh-eyes"])).toBe(false);
    expect(recordsReview("general-purpose", AGENTS)).toBe(false);
  });
});

describe("recording", () => {
  test("a new commit is added with its time and its writer, in a 0600 file", async () => {
    const file = fileWith(null);
    const result = await recordReview(
      file,
      SHA_A,
      REVIEWER,
      Date.parse("2026-10-16T10:00:00.000Z"),
    );
    expect(result).toEqual({ added: true, at: "2026-10-16T10:00:00.000Z" });
    expect(readFileSync(file, "utf8")).toBe(
      text({ [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] } }),
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a commit recorded before by the same writer keeps its first time, and nothing is written again", async () => {
    const before = text({ [SHA_A]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] } });
    const file = fileWith(before);
    chmodSync(file, 0o600);
    const result = await recordReview(
      file,
      SHA_A,
      REVIEWER,
      Date.parse("2026-10-16T10:00:00.000Z"),
    );
    expect(result).toEqual({ added: false, at: "2026-10-15T08:00:00.000Z" });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("another writer of the same commit is added beside the first, with the first time", async () => {
    const file = fileWith(
      text({ [SHA_A]: { at: "2026-10-15T08:00:00.000Z", by: ["fresh-eyes"] } }),
    );
    const result = await recordReview(file, SHA_A, BY_HAND, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(result).toEqual({ added: true, at: "2026-10-15T08:00:00.000Z" });
    expect(readReviews(file)).toEqual({
      [SHA_A]: { at: "2026-10-15T08:00:00.000Z", by: ["fresh-eyes", BY_HAND] },
    });
  });

  test("every other commit stays when one is added", async () => {
    const file = fileWith(text({ [SHA_B]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] } }));
    await recordReview(file, SHA_A, REVIEWER, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(readReviews(file)).toEqual({
      [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] },
      [SHA_B]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] },
    });
  });

  test("only the newest commits are kept: the file stays small", async () => {
    const file = fileWith(null);
    for (let index = 0; index <= REVIEWS_KEPT; index++) {
      const sha = index.toString(16).padStart(40, "0");
      await recordReview(
        file,
        sha,
        REVIEWER,
        Date.parse("2026-01-01T00:00:00.000Z") + index * 1000,
      );
    }
    const record = readReviews(file);
    expect(Object.keys(record)).toHaveLength(REVIEWS_KEPT);
    // The oldest one (index 0) was dropped; the newest is there, with its own time.
    expect(record["0".repeat(40)]).toBeUndefined();
    expect(record[REVIEWS_KEPT.toString(16).padStart(40, "0")]?.at).toBe(
      new Date(Date.parse("2026-01-01T00:00:00.000Z") + REVIEWS_KEPT * 1000).toISOString(),
    );
  });

  test("CM-10: a write waits for the record's own lock and keeps what the holder wrote", async () => {
    // Two reviewers finishing at once: the second one's read-modify-write must not drop the
    // first one's commit. The record has its own lock in its own folder, so the holder here
    // is exactly what another writer would be.
    const file = fileWith(null);
    mkdirSync(dirname(file), { recursive: true });
    let pending: Promise<unknown> | null = null;
    await withLock(dirname(file), async () => {
      pending = recordReview(file, SHA_A, REVIEWER, Date.parse("2026-10-16T10:00:00.000Z"));
      // The other writer finishes its own update while it holds the lock.
      writeFileSync(file, text({ [SHA_B]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] } }));
      // Let the waiting write try at least once: it must still be waiting.
      await Bun.sleep(150);
      expect(readReviews(file)).toEqual({
        [SHA_B]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] },
      });
    });
    await pending;
    expect(readReviews(file)).toEqual({
      [SHA_A]: { at: "2026-10-16T10:00:00.000Z", by: [REVIEWER] },
      [SHA_B]: { at: "2026-10-15T08:00:00.000Z", by: [REVIEWER] },
    });
  });

  test("CM-10: the lock is the record's own, not the state folder's shared one", async () => {
    const stateDir = tempDir("state");
    const file = reviewsFile(stateDir, "/home/user/app");
    // Holding the shared state lock (setup, update, restore) must not hold up a review.
    await withLock(stateDir, async () => {
      await recordReview(file, SHA_A, REVIEWER, Date.parse("2026-10-16T10:00:00.000Z"));
    });
    expect(hasReview(file, SHA_A, AGENTS)).toBe(true);
    expect(existsSync(join(dirname(file), "lock"))).toBe(false);
  });
});

describe("where a review agent started (HK-6: HEAD at its start)", () => {
  test("HK-6: the start is noted once, then taken back exactly once", async () => {
    const file = reviewStartsFile(tempDir("state"), "/home/user/app");
    await noteReviewStart(file, "0a1b2c3d4e5f60718", SHA_A, Date.parse("2026-10-16T10:00:00.000Z"));
    // A resumed agent starts again: the first start stays, a later HEAD never replaces it.
    await noteReviewStart(file, "0a1b2c3d4e5f60718", SHA_B, Date.parse("2026-10-16T10:05:00.000Z"));
    expect(await takeReviewStart(file, "0a1b2c3d4e5f60718")).toBe(SHA_A);
    expect(await takeReviewStart(file, "0a1b2c3d4e5f60718")).toBeNull();
  });

  test("HK-6: an id with Claude Code's agent- prefix and the bare one are the same agent", async () => {
    // SubagentStart's documented example says `agent-abc123`; SubagentStop's proved id is bare.
    const file = reviewStartsFile(tempDir("state"), "/home/user/app");
    await noteReviewStart(file, "agent-0a1b2c", SHA_A, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(await takeReviewStart(file, "0a1b2c")).toBe(SHA_A);
  });

  test("an agent that never started here has no start", async () => {
    const file = reviewStartsFile(tempDir("state"), "/home/user/app");
    expect(await takeReviewStart(file, "0a1b2c")).toBeNull();
    expect(await takeReviewStart(file, "")).toBeNull();
  });

  test("a start older than a day is forgotten when the next one is noted", async () => {
    const file = reviewStartsFile(tempDir("state"), "/home/user/app");
    await noteReviewStart(file, "old", SHA_A, Date.parse("2026-10-14T10:00:00.000Z"));
    await noteReviewStart(file, "new", SHA_B, Date.parse("2026-10-16T10:00:00.000Z"));
    expect(await takeReviewStart(file, "old")).toBeNull();
    expect(await takeReviewStart(file, "new")).toBe(SHA_B);
  });
});
