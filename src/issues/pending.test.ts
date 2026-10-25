/**
 * The queue of marks a merge still owes GitHub (`pending.ts`) and the issues a phase names
 * (`phase-issues.ts`). Files go in temp folders; GitHub is the fake `gh`.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { issuesWorld } from "../testing/issues-world";
import { tempDir } from "../testing/temp";
import type { GhExec } from "../workflow/merge-check";
import type { FixedMark } from "./fixed";
import {
  budgetedGh,
  MARKS_PER_PASS,
  passBudget,
  queueMarks,
  RETRY_MS,
  readPending,
  settleMarks,
} from "./pending";
import {
  briefIssueNumbers,
  checkPhaseIssues,
  phaseIssues,
  recordIssueNumbers,
} from "./phase-issues";

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

describe("IX2-4: no call outlives the pass's budget", () => {
  const issue = {
    body: "",
    labels: [],
    number: 1,
    title: "t",
    url: "https://github.com/example-org/my-app/issues/1",
  };

  /** A `gh` that, like the real one, runs until its own time limit and then times out. */
  function hanging(): { calls: number[]; exec: GhExec } {
    const calls: number[] = [];
    return {
      calls,
      exec: async (_args, call) => {
        calls.push(call.timeoutMs);
        await Bun.sleep(call.timeoutMs);
        return { code: null, err: "", kind: "timeout", out: "" };
      },
    };
  }

  test("a gh that never answers: the pass ends near its budget, not after the call's own 10 s", async () => {
    const made = issuesWorld({ gh: { issues: [issue] } });
    const slow = hanging();
    made.world.gh = slow.exec;
    const path = file();
    queueMarks(path, [MARK]);
    const started = Date.now();
    const lines = await settleMarks(path, made.world, 0, passBudget(Date.now, { ms: 1_500 }));
    expect(Date.now() - started).toBeLessThan(2_300);
    expect(slow.calls).toHaveLength(1);
    expect(slow.calls[0]).toBeLessThanOrEqual(1_500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("gh timed out");
    expect(readPending(path)).toHaveLength(1);
  });

  test("a write cut short says it may have been posted, and the retry reads before it writes", async () => {
    const made = issuesWorld({ gh: { issues: [issue] } });
    const real = made.world.gh;
    // The comment reaches GitHub, but the answer does not come back in time.
    made.world.gh = async (args, call) => {
      if (args[0] === "issue" && args[1] === "comment") {
        await real(args, call);
        await Bun.sleep(call.timeoutMs);
        return { code: null, err: "", kind: "timeout", out: "" };
      }
      return await real(args, call);
    };
    const path = file();
    queueMarks(path, [MARK]);
    const started = Date.now();
    const first = await settleMarks(path, made.world, 0, passBudget(Date.now, { ms: 1_500 }));
    expect(Date.now() - started).toBeLessThan(2_300);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("may have been posted");
    expect(made.gh.issues[0]?.comments).toHaveLength(1);
    // The retry: the issue is read first, the marker is found, nothing is posted again.
    const second = await settleMarks(path, made.world, RETRY_MS, passBudget(Date.now));
    expect(made.gh.issues[0]?.comments).toHaveLength(1);
    expect(second).toEqual([expect.stringContaining("marked fixed on release-1.3.0")]);
    expect(readPending(path)).toEqual([]);
  });

  test("IX2 review: under a second left, the marks wait untouched: no call, no line, nobody told", async () => {
    const made = issuesWorld({ gh: { issues: [issue] } });
    const path = file();
    queueMarks(path, [MARK]);
    let clock = 0;
    const budget = passBudget(() => clock, { ms: 5_000 });
    clock = 4_500;
    expect(await settleMarks(path, made.world, 0, budget)).toEqual([]);
    expect(made.gh.calls).toEqual([]);
    const [left] = readPending(path);
    expect(left?.told).toBe(false);
    expect(left?.triedAt).toBeUndefined();
  });

  test("budgetedGh: a call gets the smaller of its limit and the time left; under a second it is not made", async () => {
    let clock = 0;
    const seen: number[] = [];
    const gh = budgetedGh(
      async (_args, call) => {
        seen.push(call.timeoutMs);
        return { code: 0, err: "", kind: "ok", out: "" };
      },
      passBudget(() => clock, { ms: 12_000 }),
    );
    const call = { env: {}, folder: "/tmp", timeoutMs: 10_000 };
    expect((await gh(["a"], call)).kind).toBe("ok");
    clock = 5_000;
    expect((await gh(["b"], call)).kind).toBe("ok");
    clock = 11_001;
    const skipped = await gh(["c"], call);
    expect(skipped.kind).toBe("timeout");
    expect(seen).toEqual([10_000, 7_000]);
  });
});

describe("phaseIssues", () => {
  test("joins the report's list and the record's issue, each once, ascending", () => {
    const record = { issue: { number: 3, repo: "example-org/my-app", url: "u" } };
    expect(phaseIssues(record, { issues: [9, 3, 1] })).toEqual([1, 3, 9]);
    expect(phaseIssues({}, null)).toEqual([]);
  });

  test("IX2-5: a brief names an issue by #n, outside the quoted lines; an address names none", () => {
    expect(
      briefIssueNumbers(
        "Fix #12 and https://github.com/example-org/lib/issues/7, not 5 or #0 or #x.\n> and #99\n  > and #98\n",
      ),
    ).toEqual([12]);
  });

  test("IX2 review: a continuation's brief counts only what the lead wrote, not the old report's words", () => {
    // The shape `continuationBrief` writes: the lead's text, then `## What <phase> left behind`
    // with the crew session's own words (`start.ts` › `reportBlock`).
    const brief = [
      "Fix #1.",
      "",
      "## What B6b left behind",
      "",
      "- What is still open: also fixes #99.",
      "",
      "Its own words:",
      "",
      "I also closed #98.",
    ].join("\n");
    expect(briefIssueNumbers(brief)).toEqual([1]);
    expect(checkPhaseIssues({}, { issues: [1, 98, 99] }, brief)).toEqual({
      marks: [1],
      unnamed: [98, 99],
    });
  });

  test("IX2-5: only the record's issue and the brief's numbers are marked; the rest are named", () => {
    const record = { issue: { number: 3 } };
    expect(checkPhaseIssues(record, { issues: [1, 2, 3] }, "Fix #1.")).toEqual({
      marks: [1, 3],
      unnamed: [2],
    });
    // No brief to read: the record's issue alone.
    expect(checkPhaseIssues(record, { issues: [1, 3] }, null)).toEqual({
      marks: [3],
      unnamed: [1],
    });
    // A brief naming an issue the report does not: nothing is added.
    expect(checkPhaseIssues({}, { issues: [] }, "Fix #4.")).toEqual({ marks: [], unnamed: [] });
  });

  test("a record's issue that is not a whole number above 0 counts for nothing", () => {
    expect(recordIssueNumbers({ issue: { number: 0 } })).toEqual([]);
    expect(recordIssueNumbers({ issue: { number: "4" } })).toEqual([]);
    expect(recordIssueNumbers({ issue: null })).toEqual([]);
    expect(recordIssueNumbers({ issue: { number: 4 } })).toEqual([4]);
  });
});
