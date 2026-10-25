/**
 * The queue of marks a merge still owes GitHub (`pending.ts`) and the issues a phase names
 * (`phase-issues.ts`). Files go in temp folders; GitHub is the fake `gh`.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { issuesWorld } from "../testing/issues-world";
import { tempDir } from "../testing/temp";
import type { FixedMark } from "./fixed";
import {
  MARKS_PER_PASS,
  passBudget,
  queueMarks,
  RETRY_MS,
  readPending,
  settleMarks,
} from "./pending";
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

  test("a later merge of the same branch (a new tip, a new merge commit) is a new entry", () => {
    const path = file();
    queueMarks(path, [MARK, { ...MARK, merge: "e".repeat(40), tip: "c".repeat(40) }]);
    expect(readPending(path)).toHaveLength(2);
  });

  test("a hand-off chain merged as one (two branches, one merge commit) is one entry", () => {
    const path = file();
    queueMarks(path, [MARK, { ...MARK, branch: "crew/x-2", tip: "c".repeat(40) }]);
    expect(readPending(path).map((one) => one.branch)).toEqual(["crew/x"]);
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

describe("GI4: a pass has one budget for its issue work", () => {
  const manyIssues = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      body: "",
      labels: ["kit:found"],
      number: at + 1,
      title: "t",
      url: `https://github.com/example-org/my-app/issues/${at + 1}`,
    }));
  const marks = (count: number): FixedMark[] =>
    Array.from({ length: count }, (_, at) => ({
      ...MARK,
      issue: at + 1,
      merge: (at + 1).toString(16).padStart(40, "0"),
    }));

  test("only the budget's count of due marks is settled; the rest stay queued and due", async () => {
    const made = issuesWorld({ gh: { issues: manyIssues(30) } });
    const path = file();
    queueMarks(path, marks(30));
    const lines = await settleMarks(
      path,
      made.world,
      0,
      passBudget(() => 0),
    );
    expect(lines).toHaveLength(MARKS_PER_PASS);
    const left = readPending(path);
    expect(left).toHaveLength(30 - MARKS_PER_PASS);
    // Untouched: never tried, so the next pass takes them first.
    expect(left.every((one) => one.triedAt === undefined && !one.told)).toBe(true);
    expect(left.map((one) => one.issue)).toEqual(
      Array.from({ length: 30 - MARKS_PER_PASS }, (_, at) => at + MARKS_PER_PASS + 1),
    );
  });

  test("the next pass settles the next ones, until the queue is empty", async () => {
    const made = issuesWorld({ gh: { issues: manyIssues(7) } });
    const path = file();
    queueMarks(path, marks(7));
    for (const left of [4, 1, 0]) {
      await settleMarks(
        path,
        made.world,
        0,
        passBudget(() => 0),
      );
      expect(readPending(path)).toHaveLength(left);
    }
  });

  test("time spent elsewhere in the pass leaves no time: no call at all, the queue as it was", async () => {
    const made = issuesWorld({ gh: { issues: manyIssues(3) } });
    const path = file();
    queueMarks(path, marks(3));
    let clock = 0;
    const budget = passBudget(() => clock, { ms: 1_000 });
    clock = 1_000;
    expect(await settleMarks(path, made.world, 0, budget)).toEqual([]);
    expect(made.gh.calls).toEqual([]);
    expect(readPending(path)).toHaveLength(3);
  });

  test("time that runs out in the middle stops before the next mark", async () => {
    const made = issuesWorld({ gh: { issues: manyIssues(5) } });
    const path = file();
    queueMarks(path, marks(5));
    let clock = 0;
    const real = made.world.gh;
    // Each gh call takes 400 ms of the 1 000 ms budget.
    made.world.gh = async (args, call) => {
      clock += 400;
      return await real(args, call);
    };
    const lines = await settleMarks(
      path,
      made.world,
      0,
      passBudget(() => clock, { ms: 1_000 }),
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(MARKS_PER_PASS + 1);
    expect(readPending(path).length).toBeGreaterThan(5 - MARKS_PER_PASS);
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
