/**
 * What a crew merge leaves on an issue, and what the release reads back (D67): the comment and
 * the `fixed-unreleased` label (`markFixed`), the list of `Fixes #n` lines (`listFixed`) and the
 * hidden marker between them. Every test runs against a temp checkout and the fake `gh`.
 */
import { describe, expect, test } from "bun:test";
import { repoOf } from "../testing/fake-gh";
import { issuesWorld, OWN_REPO } from "../testing/issues-world";
import { git } from "../testing/temp";
import {
  type FixedMark,
  fixedComment,
  fixedMarkers,
  listFixed,
  markFixed,
  openGate,
} from "./fixed";

const TIP = "a".repeat(40);
const MERGE = "b".repeat(40);

const MARK: FixedMark = {
  base: "release-1.3.0",
  branch: "crew/GI2-issues",
  issue: 1,
  merge: MERGE,
  tip: TIP,
};

const openIssue = () => ({
  body: "A bug",
  labels: ["kit:found"],
  number: 1,
  title: "A bug",
  url: "https://github.com/example-org/my-app/issues/1",
});

async function gateOf(setup: Parameters<typeof issuesWorld>[0] = {}) {
  const made = issuesWorld(setup);
  const gate = await openGate(made.world);
  return { ...made, gate };
}

describe("the comment", () => {
  test("says the branch, the short commit and the base, and carries no closing keyword", () => {
    const text = fixedComment(MARK);
    expect(text).toContain("Fixed on `crew/GI2-issues` at `aaaaaaa`, merged into `release-1.3.0`");
    expect(text).toContain("it closes when `release-1.3.0` ships");
    expect(text).not.toMatch(/\b(close[sd]?|fix(es|ed)?|resolve[sd]?) #\d/i);
  });

  test("the marker round-trips the branch, the tip and the merge commit", () => {
    const [read] = fixedMarkers(fixedComment({ ...MARK, branch: "crew/a-->b" }));
    expect(read).toEqual({ branch: "crew/a-->b", merge: MERGE, tip: TIP });
  });

  test("a comment without a marker, or with a forged one, reads as none", () => {
    expect(fixedMarkers("fixed it, thanks")).toEqual([]);
    expect(fixedMarkers("<!-- cc-smart-dev-kit:fixed nonsense -->")).toEqual([]);
  });
});

describe("markFixed", () => {
  test("a merge with two issues: two comments and two labels", async () => {
    const { gate, gh } = await gateOf({
      gh: { issues: [openIssue(), { ...openIssue(), number: 2, url: `${openIssue().url}x` }] },
    });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await markFixed(gate, MARK)).toEqual({ commented: true, kind: "marked", labeled: true });
    expect(await markFixed(gate, { ...MARK, issue: 2 })).toEqual({
      commented: true,
      kind: "marked",
      labeled: true,
    });
    expect(gh.issues.map((one) => one.comments?.length)).toEqual([1, 1]);
    expect(gh.issues.map((one) => one.labels)).toEqual([
      ["kit:found", "fixed-unreleased"],
      ["kit:found", "fixed-unreleased"],
    ]);
    expect(gh.labels).toContain("fixed-unreleased");
    // Every call names the project's own repository.
    for (const call of gh.calls) expect(repoOf(call.args)).toBe(OWN_REPO);
    // The posted text is the comment, with its marker.
    expect(gh.issues[0]?.comments?.[0]).toBe(fixedComment(MARK));
  });

  test("the same merge seen twice: one comment, one label, the second call writes nothing", async () => {
    const { gate, gh } = await gateOf({ gh: { issues: [openIssue()] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    await markFixed(gate, MARK);
    const writes = () =>
      gh.calls.filter(
        (call) =>
          (call.args[0] === "issue" && ["comment", "edit"].includes(call.args[1] ?? "")) ||
          (call.args[0] === "label" && call.args[1] === "create"),
      ).length;
    const before = writes();
    expect(await markFixed(gate, MARK)).toEqual({
      commented: false,
      kind: "marked",
      labeled: false,
    });
    expect(writes()).toBe(before);
    expect(gh.issues[0]?.comments).toHaveLength(1);
  });

  test("a later merge of the same branch with a new tip is a new comment", async () => {
    const { gate, gh } = await gateOf({ gh: { issues: [openIssue()] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    await markFixed(gate, MARK);
    const again = await markFixed(gate, { ...MARK, merge: "e".repeat(40), tip: "c".repeat(40) });
    expect(again).toEqual({ commented: true, kind: "marked", labeled: false });
    expect(gh.issues[0]?.comments).toHaveLength(2);
  });

  test("a hand-off chain merged as one: the second branch adds no comment", async () => {
    const { gate, gh } = await gateOf({ gh: { issues: [openIssue()] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    await markFixed(gate, MARK);
    const second = await markFixed(gate, { ...MARK, branch: "crew/x-2", tip: "c".repeat(40) });
    expect(second).toEqual({ commented: false, kind: "marked", labeled: false });
    expect(gh.issues[0]?.comments).toHaveLength(1);
  });

  test("a label that is there is not made again", async () => {
    const { gate, gh } = await gateOf({
      gh: { issues: [openIssue()], labels: ["kit:found", "fixed-unreleased"] },
    });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    await markFixed(gate, MARK);
    expect(gh.calls.some((call) => call.args[0] === "label" && call.args[1] === "create")).toBe(
      false,
    );
  });

  test("a closed issue gets nothing", async () => {
    const { gate, gh } = await gateOf({ gh: { issues: [{ ...openIssue(), closed: true }] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await markFixed(gate, MARK)).toEqual({ kind: "closed" });
    expect(gh.issues[0]?.comments ?? []).toEqual([]);
  });

  test("an issue number GitHub does not know is gone, not retried", async () => {
    const { gate } = await gateOf({ gh: { issues: [] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await markFixed(gate, { ...MARK, issue: 99 })).toEqual({ kind: "gone" });
  });

  test("GitHub down at the comment: failed, then the retry does the whole job once", async () => {
    const { gate, gh } = await gateOf({ gh: { issues: [openIssue()] } });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    gh.mode = "timeout";
    const down = await markFixed(gate, MARK);
    expect(down.kind).toBe("failed");
    expect(gh.issues[0]?.comments ?? []).toEqual([]);
    gh.mode = null;
    expect(await markFixed(gate, MARK)).toEqual({ commented: true, kind: "marked", labeled: true });
    expect(await markFixed(gate, MARK)).toEqual({
      commented: false,
      kind: "marked",
      labeled: false,
    });
    expect(gh.issues[0]?.comments).toHaveLength(1);
  });

  test("a comment done and a label not: the retry adds only the label", async () => {
    const { gate, gh } = await gateOf({
      gh: { issues: [{ ...openIssue(), comments: [fixedComment(MARK)] }] },
    });
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await markFixed(gate, MARK)).toEqual({
      commented: false,
      kind: "marked",
      labeled: true,
    });
    expect(gh.issues[0]?.comments).toHaveLength(1);
  });
});

describe("the gate", () => {
  test("the switch off: nothing is called", async () => {
    const { gate, gh } = await gateOf({ committed: { worktrees: { base: "main" } } });
    expect(gate.kind).toBe("off");
    expect(gh.calls).toEqual([]);
  });

  test("a project that never opted in: off", async () => {
    const { gate, gh } = await gateOf({ committed: null, personal: { issues: { enabled: true } } });
    expect(gate.kind).toBe("off");
    expect(gh.calls).toEqual([]);
  });

  test("a public repository without allowPublic: off", async () => {
    const { gate } = await gateOf({ gh: { visibility: "PUBLIC" } });
    expect(gate.kind).toBe("off");
  });

  test("GitHub unreachable at the gate: failed, with the reason", async () => {
    const { gate } = await gateOf({ gh: { mode: "logged-out" } });
    expect(gate.kind).toBe("failed");
  });
});

describe("listFixed: the Fixes lines of a release", () => {
  /** A repository with main, and a release branch that holds `fixed` but not `unreleased`. */
  function history(setup: ReturnType<typeof issuesWorld>) {
    const { repo } = setup;
    git(repo, "checkout", "-q", "-b", "release");
    git(repo, "commit", "-q", "--allow-empty", "-m", "fix one");
    const inRelease = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "checkout", "-q", "-b", "later");
    git(repo, "commit", "-q", "--allow-empty", "-m", "not in the release");
    const outside = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "checkout", "-q", "main");
    return { inRelease, outside };
  }

  const marked = (number: number, tip: string, extra: Partial<FixedMark> = {}) => ({
    ...openIssue(),
    comments: [fixedComment({ ...MARK, issue: number, tip, ...extra })],
    labels: ["fixed-unreleased"],
    number,
    url: `${openIssue().url}${number}`,
  });

  test("lists only open fixed-unreleased issues whose fix is in the range", async () => {
    const made = issuesWorld();
    const { inRelease, outside } = history(made);
    made.gh.issues.push(
      marked(1, inRelease, { merge: "d".repeat(40) }),
      marked(2, outside, { merge: "d".repeat(40) }),
      { ...marked(3, inRelease, { merge: "d".repeat(40) }), closed: true },
      { ...marked(4, inRelease, { merge: "d".repeat(40) }), labels: ["kit:found"] },
      { ...openIssue(), labels: ["fixed-unreleased"], number: 5, url: `${openIssue().url}5` },
    );
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await listFixed(gate, { base: "main", head: "release" })).toEqual({
      issues: [1],
      kind: "listed",
    });
  });

  test("a marker after the 100th comment is still found (gh's list returns 100 at most)", async () => {
    const made = issuesWorld();
    const { inRelease } = history(made);
    const long = marked(1, inRelease, { merge: "d".repeat(40) });
    long.comments = [...Array.from({ length: 120 }, (_, n) => `comment ${n}`), ...long.comments];
    made.gh.issues.push(long);
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await listFixed(gate, { base: "main", head: "release" })).toEqual({
      issues: [1],
      kind: "listed",
    });
  });

  test("a policy that cannot be read is a failure to retry, never an off switch", async () => {
    // The project's file is committed on main, but origin/main was never fetched.
    const made = issuesWorld();
    git(made.repo, "update-ref", "-d", "refs/remotes/origin/main");
    const gate = await openGate(made.world);
    expect(gate.kind).toBe("failed");
  });

  test("a fix already on the base is not listed again", async () => {
    const made = issuesWorld();
    const onMain = git(made.repo, "rev-parse", "HEAD").trim();
    git(made.repo, "branch", "release");
    made.gh.issues.push(marked(1, onMain, { merge: "d".repeat(40) }));
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await listFixed(gate, { base: "main", head: "release" })).toEqual({
      issues: [],
      kind: "listed",
    });
  });

  test("a squash merge: the merge commit is in the range, the branch tip is not", async () => {
    const made = issuesWorld();
    const { inRelease, outside } = history(made);
    made.gh.issues.push(marked(1, outside, { merge: inRelease }));
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    expect(await listFixed(gate, { base: "main", head: "release" })).toEqual({
      issues: [1],
      kind: "listed",
    });
  });

  test("a head git does not know is a failure with its words", async () => {
    const made = issuesWorld();
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    const out = await listFixed(gate, { base: "main", head: "no-such-branch" });
    expect(out.kind).toBe("failed");
  });

  test("GitHub unreachable: failed, never an empty list that looks complete", async () => {
    const made = issuesWorld();
    const gate = await openGate(made.world);
    if (gate.kind !== "ready") throw new Error(`gate: ${gate.kind}`);
    made.gh.mode = "timeout";
    const out = await listFixed(gate, { base: "main", head: "main" });
    expect(out.kind).toBe("failed");
  });
});
