/**
 * The live gates of plan hand-outs (D5, D7): every state `herdr plans` can print, and how
 * `prepareStart` decides a start. Real git in a temp clone; gh and hc are fakes.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { allTasks, taskById } from "../tasks/work/queries";
import { createTask, reservePlan, takeTasks, updateTask } from "../tasks/work/store";
import type { ClaimProcess, Result, Who, WorkTask } from "../tasks/work/types";
import { makeClone } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import {
  changesBetween,
  HANDOUT_GRACE_MS,
  judgePlans,
  markOf,
  nothingToWaitFor,
  type Pane,
  type PlanLine,
  type PlansWorld,
  type PrState,
  prepareStart,
} from "./plans";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };
const CHILD: Who = { sessionId: "child", pid: 5202, procStart: "52020" };
const OTHER: Who = { sessionId: "other", pid: 6303, procStart: "63030" };
const NOBODY: ClaimProcess = { live: () => false, gone: () => false, ended: () => false };
const ENDED: ClaimProcess = { live: () => false, gone: () => true, ended: () => true };
const GONE: Pane = { state: "gone", status: null, address: "t2" };
const LIVE: Pane = { state: "live", status: "working", address: "t2" };
const NONE: Pane = { state: "none", status: null, address: null };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

/** A clone, a store, and fakes for gh (by branch) and hc (by agent). */
function build() {
  const { repo } = makeClone();
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const prs: Record<string, PrState> = {};
  const panes: Record<string, Pane> = {};
  const base: PlansWorld = {
    db,
    project: "p",
    who: LEAD,
    repo,
    env: cleanGitEnv(),
    base: "main",
    process: NOBODY,
    pr: (_repo, branch) => prs[branch] ?? "none",
    pane: (agent) => (agent === null ? NONE : (panes[agent] ?? GONE)),
    check: { ignore: [], caseFold: false },
    now: 1000,
  };
  let number = 0;
  const plan = (
    slug: string,
    files: string[] | undefined,
    over: { blockedBy?: string[]; who?: Who } = {},
  ): WorkTask =>
    ok(
      createTask(
        db,
        {
          project: "p",
          subject: slug,
          kind: "plan",
          plan: slug,
          ...(files === undefined ? {} : { files }),
          ...(over.blockedBy ? { blockedBy: over.blockedBy } : {}),
        },
        over.who ?? LEAD,
        ++number,
      ),
    );
  const change = (task: WorkTask, to: Parameters<typeof updateTask>[2]) =>
    ok(updateTask(db, task.id, to, LEAD, 50));
  const reserve = (slug: string, over: { files?: Record<string, string[]> } = {}) =>
    ok(
      reservePlan(db, {
        project: "p",
        plan: slug,
        who: LEAD,
        holder: "child",
        ignore: [],
        caseFold: false,
        extraFiles: over.files ?? {},
        now: 10,
      }),
    );
  /** A branch with one commit on it, made without leaving `main`. */
  const branch = (name: string, files: Record<string, string>, remove: string[] = []) => {
    git(repo, "checkout", "-q", "-b", name, "main");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    for (const path of remove) git(repo, "rm", "-q", path);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", `work on ${name}`);
    git(repo, "checkout", "-q", "main");
  };
  const line = (slug: string, world: Partial<PlansWorld> = {}, only?: string): PlanLine => {
    const found = judgePlans({ ...base, ...world }, only).lines.find((one) => one.plan === slug);
    if (!found) throw new Error(`no line for ${slug}`);
    return found;
  };
  return {
    repo,
    db,
    prs,
    panes,
    base,
    plan,
    change,
    reserve,
    branch,
    line,
    git: (...a: string[]) => git(repo, ...a).trim(),
  };
}

test("a plan nothing blocks is ready, a plan with no file list is not", () => {
  const w = build();
  w.plan("alpha", ["src/a/"]);
  w.plan("beta", undefined);
  expect(w.line("alpha")).toMatchObject({ state: "ready" });
  const beta = w.line("beta");
  expect(beta.state).toBe("no-files");
  expect(beta.fix).toContain("files");
  expect(markOf("no-files")).toBe("warn");
  expect(markOf("ready")).toBe("ok");
});

test("a blocker still open waits by the store; a dropped one is clear", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  expect(w.line("second")).toMatchObject({ state: "waiting" });
  expect(w.line("second").text).toContain("#1 first");
  w.change(first, { status: "dropped" });
  expect(w.line("second").state).toBe("ready");
});

test("a closed blocker that is a task, not a plan, is clear", () => {
  const w = build();
  const task = ok(createTask(w.db, { project: "p", subject: "a task", kind: "task" }, LEAD, 9));
  w.plan("second", ["src/two/"], { blockedBy: [task.id] });
  expect(w.line("second").state).toBe("waiting");
  ok(updateTask(w.db, task.id, { status: "done" }, LEAD, 11));
  expect(w.line("second").state).toBe("ready");
});

test("a done blocker with no branch is blocked, with its fix", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  w.change(first, { status: "done" });
  const line = w.line("second");
  expect(line.state).toBe("blocked");
  expect(line.text).toContain("has no branch recorded");
  expect(line.fix).toContain("task_update #1 with branch");
  expect(markOf("blocked")).toBe("fail");
});

test("a done blocker whose branch is not in the repository is blocked", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  w.change(first, { status: "done", branch: "gone-branch" });
  const line = w.line("second");
  expect(line.state).toBe("blocked");
  expect(line.text).toContain("branch gone-branch is not in this repository");
});

test("the blocker's pull request decides: merged clears, open waits, closed blocks", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  w.branch("feature-one", { "src/one/a.ts": "1\n" });
  w.change(first, { status: "done", branch: "feature-one" });
  w.prs["feature-one"] = "merged";
  expect(w.line("second").state).toBe("ready");
  w.prs["feature-one"] = "open";
  const open = w.line("second");
  expect(open.state).toBe("waiting");
  expect(open.text).toContain("its pull request is open");
  w.prs["feature-one"] = "closed";
  const closed = w.line("second");
  expect(closed.state).toBe("blocked");
  expect(closed.text).toContain("closed without merging");
  expect(closed.fix).toContain("the person decides");
});

test("with no pull request found, ancestry on the default branch decides, and an empty branch proves nothing", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  const start = w.git("rev-parse", "main");
  // No start commit recorded: a merge cannot be proved.
  w.branch("feature-one", { "src/one/a.ts": "1\n" });
  w.change(first, { status: "done", branch: "feature-one" });
  const unproved = w.line("second");
  expect(unproved.state).toBe("blocked");
  expect(unproved.text).toContain("no start commit is recorded");
  // Recorded, and the branch is not on the default branch yet: it waits.
  w.change(first, { base: start });
  const waiting = w.line("second");
  expect(waiting.state).toBe("waiting");
  expect(waiting.text).toContain("not merged into origin/main yet");
  // gh cannot say (unknown) gives the same answer as none.
  w.prs["feature-one"] = "unknown";
  expect(w.line("second").state).toBe("waiting");
  // Merged into origin/main: clear.
  w.git("merge", "-q", "--no-edit", "feature-one");
  w.git("push", "-q", "origin", "main");
  expect(w.line("second").state).toBe("ready");
});

test("a branch with no commit past its start is blocked: it is trivially an ancestor", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  const start = w.git("rev-parse", "main");
  w.git("branch", "empty-branch", "main");
  w.change(first, { status: "done", branch: "empty-branch", base: start });
  const line = w.line("second");
  expect(line.state).toBe("blocked");
  expect(line.text).toContain("holds no commit past its start");
});

test("a held plan's branch diff blocks an overlap, and a rename counts on both sides", () => {
  const w = build();
  mkdirSync(join(w.repo, "src"), { recursive: true });
  writeFileSync(join(w.repo, "src/old.ts"), "old\n");
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "add old");
  w.git("push", "-q", "origin", "main");
  const holder = w.plan("holder", ["src/holder.ts"]);
  w.plan("mover", ["src/old.ts"]);
  w.reserve("holder");
  // The holder's builder renamed old.ts: the diff names both paths, with no rename detection.
  w.git("checkout", "-q", "-b", "holder-branch", "main");
  w.git("mv", "src/old.ts", "src/new.ts");
  w.git("commit", "-q", "-m", "rename");
  w.git("checkout", "-q", "main");
  expect(w.line("mover").state).toBe("ready");
  w.change(holder, { branch: "holder-branch" });
  const line = w.line("mover");
  expect(line.state).toBe("overlaps");
  expect(line.text).toContain("#1 holder: src/old.ts");
});

test("drift: a held plan's branch reaches another held plan's files", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"]);
  w.reserve("first");
  w.reserve("second");
  // Inside its own folder is no drift; src/two/b.ts belongs to the other plan.
  w.branch("first-branch", { "src/one/a.ts": "1\n", "src/two/b.ts": "2\n" });
  w.change(first, { branch: "first-branch", agent: "herdr:core/t2" });
  w.panes["herdr:core/t2"] = LIVE;
  const line = w.line("first");
  expect(line.state).toBe("with-child");
  expect(line.drift).toEqual(["#2 second: src/two/b.ts"]);
  expect(line.text).toContain("drift: its branch reaches #2 second: src/two/b.ts");
});

test("a plan with a child reads its pane and its pull request", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  w.branch("first-branch", { "src/one/a.ts": "1\n" });
  w.change(first, { branch: "first-branch", agent: "herdr:core/t2" });
  w.panes["herdr:core/t2"] = LIVE;
  w.prs["first-branch"] = "open";
  const open = w.line("first");
  expect(open).toMatchObject({ state: "with-child", pr: "open" });
  expect(open.text).toContain("pane t2 live, working");
  expect(open.text).toContain("pull request open");
  w.prs["first-branch"] = "merged";
  expect(w.line("first")).toMatchObject({ state: "with-child", pr: "merged" });
});

test("a plan whose child is gone offers the resume; a pane still open must be closed first", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, { agent: "herdr:core/t2", worktree: "/repo/wt", branch: "b" });
  const gone = w.line("first", { process: ENDED });
  expect(gone.state).toBe("child-gone");
  expect(gone.fix).toContain("herdr start --plan first");
  w.panes["herdr:core/t2"] = LIVE;
  const open = w.line("first", { process: ENDED });
  expect(open.state).toBe("child-gone");
  expect(open.text).toContain("its child's session ended, but pane t2 live");
  expect(open.fix).toContain("herdr stop t2");
  // A child that cannot be proved gone is with its child, never child-gone.
  expect(w.line("first", { process: NOBODY }).state).toBe("with-child");
});

test("a closed plan whose pull request merged or closed is released, and holds no files after", () => {
  for (const settled of ["merged", "closed"] as const) {
    const w = build();
    const first = w.plan("first", ["src/one/"]);
    w.plan("second", ["src/one/inner.ts"]);
    w.reserve("first");
    w.branch("first-branch", { "src/one/a.ts": "1\n" });
    w.change(first, { branch: "first-branch", status: "done" });
    w.prs["first-branch"] = "open";
    const waiting = w.line("first");
    expect(waiting.state).toBe("merging");
    expect(w.line("second").state).toBe("overlaps");
    expect(w.line("second").text).toContain("finished: held until its pull request settles");
    w.prs["first-branch"] = settled;
    const released = judgePlans(w.base).lines;
    expect(released.find((one) => one.plan === "first")).toMatchObject({
      state: "released",
      pr: settled,
    });
    // Released in the same pass: the next plan no longer sees its files held.
    expect(released.find((one) => one.plan === "second")?.state).toBe("ready");
    expect(taskById(w.db, first.id).lead).toBeNull();
    expect(judgePlans(w.base).lines.find((one) => one.plan === "first")).toBeUndefined();
  }
});

test("a closed plan with no branch stays held, with its fix", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  w.change(first, { status: "done" });
  const line = w.line("first");
  expect(line.state).toBe("merging");
  expect(line.fix).toContain("task_update #1 with branch");
});

test("a hand-out whose child never started: relaunch with a worktree, release without one, a grace first", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"]);
  w.reserve("first");
  w.reserve("second");
  // No agent bound, inside the grace: a start is still launching.
  expect(w.line("first", { now: 10 + HANDOUT_GRACE_MS - 1 }).state).toBe("with-child");
  // Past the grace with no agent: the start died between the reserve and the bind.
  const late = judgePlans({ ...w.base, now: 10 + HANDOUT_GRACE_MS + 1 }).lines;
  expect(late.find((one) => one.plan === "first")).toMatchObject({ state: "released" });
  expect(taskById(w.db, first.id).lead).toBeNull();
  // Bound, with its worktree recorded, and the pane gone: relaunch into it.
  w.reserve("first");
  w.change(first, { agent: "herdr:core/t2", worktree: "/repo/wt", branch: "wt-branch" });
  const stale = w.line("first");
  expect(stale.state).toBe("stale");
  expect(stale.fix).toContain("relaunch it in its own worktree");
  expect(taskById(w.db, first.id).lead).not.toBeNull();
  // The same plan with its pane live is simply with its child.
  w.panes["herdr:core/t2"] = LIVE;
  expect(w.line("first").state).toBe("with-child");
});

test("a plan the lead builds itself reads own", () => {
  const w = build();
  w.plan("first", ["src/one/"]);
  ok(
    reservePlan(w.db, {
      project: "p",
      plan: "first",
      who: LEAD,
      holder: "self",
      ignore: [],
      caseFold: false,
      now: 10,
    }),
  );
  expect(w.line("first").state).toBe("own");
});

test("what changed between two readings, and when a wait has nothing to wait for", () => {
  const line = (n: number, state: PlanLine["state"], pr: PlanLine["pr"] = null): PlanLine => ({
    number: n,
    plan: `p${n}`,
    subject: `p${n}`,
    state,
    text: "",
    fix: null,
    pr,
    pane: null,
    drift: [],
  });
  const before = [line(1, "with-child", "open"), line(2, "waiting"), line(3, "overlaps")];
  expect(changesBetween(before, before)).toEqual([]);
  expect(
    changesBetween(before, [
      line(1, "with-child", "merged"),
      line(2, "ready"),
      line(3, "overlaps"),
    ]).map((one) => one.number),
  ).toEqual([1, 2]);
  expect(
    changesBetween(before, [line(1, "released"), line(2, "waiting"), line(3, "overlaps")]).map(
      (one) => one.number,
    ),
  ).toEqual([1]);
  expect(nothingToWaitFor(before)).toBeNull();
  expect(nothingToWaitFor([line(1, "ready")])).toBe("ready");
  expect(nothingToWaitFor([line(1, "blocked"), line(2, "own"), line(3, "no-files")])).toBe(
    "settled",
  );
  expect(nothingToWaitFor([])).toBe("settled");
});

test("a start is refused for a plan that is missing, not a plan, another's, finished or running", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const phase = ok(
    createTask(
      w.db,
      { project: "p", subject: "a phase", kind: "phase", plan: "first", parentId: first.id },
      LEAD,
      9,
    ),
  );
  const refusal = (ref: string, world: Partial<PlansWorld> = {}) => {
    const answer = prepareStart({ ...w.base, ...world }, ref);
    if (answer.ok) throw new Error("expected a refusal");
    return answer;
  };
  expect(refusal("nothing").why).toBe('Plan "nothing" was not found in this project.');
  expect(refusal(`#${phase.number}`).why).toBe(`#${phase.number} is a phase, not a plan.`);
  expect(refusal("first", { who: { ...LEAD, sessionId: null } }).why).toBe(
    "A plan hand-out needs a resolvable calling session.",
  );
  expect(refusal("first", { who: OTHER }).why).toContain(
    "is not one of this session's queued plans",
  );
  w.change(first, { status: "dropped" });
  expect(refusal("first").why).toBe('Plan "first" is dropped: nothing to hand out.');
});

test("a start is refused for a plan that is not ready, with the line's words and fix", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"], { blockedBy: [first.id] });
  w.plan("third", undefined);
  const refusal = (ref: string) => {
    const answer = prepareStart(w.base, ref);
    if (answer.ok) throw new Error("expected a refusal");
    return answer;
  };
  expect(refusal("second").why).toContain('Plan "second" is not ready: waiting on #1 first');
  expect(refusal("third").why).toContain("has no file list");
  expect(refusal("third").fix).toContain("task_update #3 with files");
  expect(taskById(w.db, first.id).lead).toBeNull();
});

test("a ready start reserves the plan for a child before anything launches", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("clash", ["src/one/inner.ts"]);
  const start = prepareStart(w.base, "first");
  if (!start.ok) throw new Error(start.why);
  expect(start).toMatchObject({ reserved: true, resume: false, recorded: null });
  const lead = taskById(w.db, first.id).lead;
  expect(lead).toMatchObject({ sessionId: "lead", holder: "child", handoutId: start.handoutId });
  // The reservation holds its files at once: a second hand-out in the same breath refuses.
  const second = prepareStart(w.base, "clash");
  if (second.ok) throw new Error("expected an overlap");
  expect(second.why).toContain("overlaps #1 first");
  // The plan is found by its task reference too.
  expect(prepareStart(w.base, "#1").ok).toBe(false);
});

test("a plan with a live child refuses a second start; a gone child resumes in its worktree", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, { agent: "herdr:core/t2", worktree: "/repo/wt", branch: "wt-branch" });
  // The child's process cannot be proved gone: it may still run.
  const running = prepareStart({ ...w.base, process: NOBODY }, "first");
  if (running.ok) throw new Error("expected a refusal");
  expect(running.why).toContain('Plan "first" already has a child (herdr:core/t2)');
  // Proved gone, but its pane is still open.
  w.panes["herdr:core/t2"] = LIVE;
  const open = prepareStart({ ...w.base, process: ENDED }, "first");
  if (open.ok) throw new Error("expected a refusal");
  expect(open.why).toContain("its child's session ended, but pane t2 live");
  expect(open.fix).toContain("herdr stop t2");
  // Proved gone and the pane gone: resume in the recorded worktree, under the same hand-out.
  delete w.panes["herdr:core/t2"];
  const resumed = prepareStart({ ...w.base, process: ENDED }, "first");
  if (!resumed.ok) throw new Error(resumed.why);
  expect(resumed).toMatchObject({
    reserved: false,
    resume: true,
    handoutId: handout,
    recorded: { worktree: "/repo/wt", branch: "wt-branch" },
  });
  // The reservation is untouched: no second reservation, no new hand-out id.
  expect(taskById(w.db, first.id).lead?.handoutId).toBe(handout);
});

test("a child gone before its binding cannot resume: no worktree is recorded", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  const answer = prepareStart({ ...w.base, process: ENDED }, "first");
  if (answer.ok) throw new Error("expected a refusal");
  expect(answer.why).toContain("no worktree is recorded");
});

test("a plan the lead builds, or one finished and held, is not handed out", () => {
  const w = build();
  w.plan("mine", ["src/one/"]);
  ok(
    reservePlan(w.db, {
      project: "p",
      plan: "mine",
      who: LEAD,
      holder: "self",
      ignore: [],
      caseFold: false,
      now: 10,
    }),
  );
  const own = prepareStart(w.base, "mine");
  if (own.ok) throw new Error("expected a refusal");
  expect(own.why).toContain("it builds it, with no child");
  const done = w.plan("done", ["src/two/"]);
  w.reserve("done");
  w.change(done, { status: "done" });
  const closing = prepareStart(w.base, "done");
  if (closing.ok) throw new Error("expected a refusal");
  expect(closing.why).toContain("files stay held until its pull request settles");
  expect(allTasks(w.db, "p").filter((t) => t.lead !== null)).toHaveLength(2);
});
