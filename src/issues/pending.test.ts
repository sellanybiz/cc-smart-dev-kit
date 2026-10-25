/**
 * The queue of marks a merge still owes GitHub (`pending.ts`) and the issues a phase names
 * (`phase-issues.ts`). Files go in temp folders; GitHub is the fake `gh`.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { issuesWorld } from "../testing/issues-world";
import { tempDir } from "../testing/temp";
import type { FixedMark } from "./fixed";
import { queueMarks, RETRY_MS, readPending, settleMarks } from "./pending";
import { phaseIssues, recordIssueNumbers } from "./phase-issues";

const MARK: FixedMark = {
  base: "release-1.3.0",
  branch: "crew/x",
  issue: 1,
  merge: "b".repeat(40),
  tip: "a".repeat(40),
};

const file = () => join(tempDir("issue-marks"), "marks", "lead.json");

describe("queueMarks", () => {
  test("the same issue, branch and tip is one entry, however often it is queued", () => {
    const path = file();
    queueMarks(path, [MARK]);
    queueMarks(path, [MARK, { ...MARK, issue: 2 }]);
    queueMarks(path, [MARK]);
    expect(readPending(path).map((one) => one.issue)).toEqual([1, 2]);
  });

  test("a new tip on the same branch is a new entry", () => {
    const path = file();
    queueMarks(path, [MARK, { ...MARK, tip: "c".repeat(40) }]);
    expect(readPending(path)).toHaveLength(2);
  });

  test("a file that is not there, or not a queue, reads as empty", () => {
    expect(readPending(file())).toEqual([]);
  });
});

describe("settleMarks", () => {
  test("an issue that is closed leaves the queue without a word", async () => {
    const made = issuesWorld({
      gh: {
        issues: [
          {
            body: "",
            closed: true,
            labels: [],
            number: 1,
            title: "t",
            url: "https://github.com/example-org/my-app/issues/1",
          },
        ],
      },
    });
    const path = file();
    queueMarks(path, [MARK]);
    expect(await settleMarks(path, made.world, 0)).toEqual([]);
    expect(readPending(path)).toEqual([]);
    expect(made.gh.issues[0]?.comments ?? []).toEqual([]);
  });

  test("an issue GitHub does not know is said once and dropped", async () => {
    const made = issuesWorld();
    const path = file();
    queueMarks(path, [MARK]);
    expect(await settleMarks(path, made.world, 0)).toEqual([
      "issues: #1 does not exist on GitHub; nothing to mark",
    ]);
    expect(readPending(path)).toEqual([]);
  });

  test("a failed mark waits RETRY_MS, and is told to the lead only the first time", async () => {
    const made = issuesWorld({
      gh: {
        issues: [
          {
            body: "",
            labels: [],
            number: 1,
            title: "t",
            url: "https://github.com/example-org/my-app/issues/1",
          },
        ],
        mode: "timeout",
      },
    });
    const path = file();
    queueMarks(path, [MARK]);
    const first = await settleMarks(path, made.world, 1_000);
    expect(first).toHaveLength(1);
    // Not due yet: no call, no line.
    made.gh.calls.length = 0;
    expect(await settleMarks(path, made.world, 1_000 + RETRY_MS - 1)).toEqual([]);
    expect(made.gh.calls).toEqual([]);
    // Due and still down: tried, and silent.
    expect(await settleMarks(path, made.world, 1_000 + RETRY_MS)).toEqual([]);
    expect(made.gh.calls.length).toBeGreaterThan(0);
    expect(readPending(path)).toHaveLength(1);
  });
});

describe("phaseIssues", () => {
  test("joins the report's list and the record's issue, each once, ascending", () => {
    const record = { issue: { number: 3, repo: "example-org/my-app", url: "u" } };
    expect(phaseIssues(record, { issues: [9, 3, 1] })).toEqual([1, 3, 9]);
    expect(phaseIssues({}, null)).toEqual([]);
  });

  test("a record's issue that is not a whole number above 0 counts for nothing", () => {
    expect(recordIssueNumbers({ issue: { number: 0 } })).toEqual([]);
    expect(recordIssueNumbers({ issue: { number: "4" } })).toEqual([]);
    expect(recordIssueNumbers({ issue: null })).toEqual([]);
    expect(recordIssueNumbers({ issue: { number: 4 } })).toEqual([4]);
  });
});
