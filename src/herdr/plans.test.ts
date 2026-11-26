/**
 * The live gates of plan hand-outs (D5, D7): every state `herdr plans` can print, and how
 * `prepareStart` decides a start. Real git in a temp clone; gh and hc are fakes.
 */
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { createOut } from "../cli/ui/out";
import { planFilesCheck } from "../tasks/files-check";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { allTasks, eventsOf, notesOf, type StackPair, taskById } from "../tasks/work/queries";
import { createTask, releasePlan, reservePlan, takeTasks, updateTask } from "../tasks/work/store";
import type { ClaimProcess, Result, Who, WorkTask } from "../tasks/work/types";
import { commitConfig, makeClone } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { launchedHere, writeLaunchRecord } from "./launch-record";
import {
  changesBetween,
  confirmClaim,
  HANDOUT_GRACE_MS,
  judgePlans,
  markOf,
  nothingToWaitFor,
  type Pane,
  type PlanLine,
  type PlansWorld,
  type PrState,
  prepareReserve,
  prepareStart,
  releaseByHand,
  showPlanLines,
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
  /** A live terminal labelled `kit.plan=<slug>`, by slug: hc's answer to "who carries this label". */
  const strays: Record<string, string> = {};
  const base: PlansWorld = {
    db,
    project: "p",
    who: LEAD,
    repo,
    env: cleanGitEnv(),
    base: "main",
    baseFrom: "origin",
    process: NOBODY,
    pr: (_repo, branch) => prs[branch] ?? "none",
    pane: (agent) => (agent === null ? NONE : (panes[agent] ?? GONE)),
    labelled: (slug) => strays[slug] ?? null,
    launched: (worktree) => launchedHere(paths.stateDir, repo, worktree),
    check: { ignore: [], caseFold: false },
    now: () => 1000,
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
  const reserve = (
    slug: string,
    over: { files?: Record<string, string[]>; stacked?: StackPair[] } = {},
  ) =>
    ok(
      reservePlan(db, {
        project: "p",
        plan: slug,
        who: LEAD,
        holder: "child",
        ignore: [],
        caseFold: false,
        extraFiles: over.files ?? {},
        ...(over.stacked === undefined ? {} : { stacked: over.stacked }),
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
    stateDir: paths.stateDir,
    db,
    prs,
    panes,
    strays,
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
  expect(waiting.text).toContain("its branch is not on origin/main yet");
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

test("a held plan's branch diff counts in an overlap, and a rename counts on both sides", () => {
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
  expect(line.state).toBe("ready");
  expect(line.text).toBe(
    "ready: nothing blocks it; overlaps #1 holder: src/old.ts (an overlap warns and never holds a plan back)",
  );
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
  expect(gone.fix).toBe(
    `resume it in its own worktree: ${COMMAND} herdr start --plan first --model <model> --effort <effort> --mode <mode> -- "<brief>"`,
  );
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
    expect(w.line("second").state).toBe("ready");
    expect(w.line("second").text).toContain("finished: held until its pull request settles");
    w.prs["first-branch"] = settled;
    const released = judgePlans(w.base).lines;
    expect(released.find((one) => one.plan === "first")).toMatchObject({
      state: "released",
      pr: settled,
    });
    // Released in the same pass: the next plan no longer sees its files held.
    expect(released.find((one) => one.plan === "second")?.text).toBe(
      "ready: nothing blocks it and no held plan shares its files",
    );
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
  expect(w.line("first", { now: () => 10 + HANDOUT_GRACE_MS - 1 }).state).toBe("with-child");
  // Past the grace with no agent: the start died between the reserve and the bind.
  const late = judgePlans({ ...w.base, now: () => 10 + HANDOUT_GRACE_MS + 1 }).lines;
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
    stackedOn: null,
    drift: [],
  });
  const before = [line(1, "with-child", "open"), line(2, "waiting"), line(3, "merging")];
  expect(changesBetween(before, before)).toEqual([]);
  expect(
    changesBetween(before, [
      line(1, "with-child", "merged"),
      line(2, "ready"),
      line(3, "merging"),
    ]).map((one) => one.number),
  ).toEqual([1, 2]);
  expect(
    changesBetween(before, [line(1, "released"), line(2, "waiting"), line(3, "merging")]).map(
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
  expect(start.warnings).toEqual([]);
  // The reservation holds its files at once: a second hand-out in the same breath is warned of,
  // and both plans get the note.
  const second = prepareStart(w.base, "clash");
  if (!second.ok) throw new Error(second.why);
  expect(second.warnings).toEqual([
    'Overlap: #1 "first" and #2 "clash" share src/one/ (src/one/inner.ts). Leads: #1 session lead; #2 session lead. Both may run at once: the plan that merges second rebases onto the first one\'s merged code (or merges it in, once pushed), resolves the conflicts, reruns the full check, and names the other plan and these files in its pull request.',
  ]);
  for (const id of [first.id, second.plan.id])
    expect(notesOf(w.db, id).map((note) => note.text)).toEqual(second.warnings);
  // The plan is found by its task reference too.
  expect(prepareStart(w.base, "#1").ok).toBe(false);
});

test("a plan with a live child refuses a second start; a gone child resumes in its worktree", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, {
    agent: "herdr:core/t2",
    worktree: join(w.repo, ".claude", "worktrees", "kit-first"),
    branch: "wt-branch",
  });
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
    recorded: { worktree: join(w.repo, ".claude", "worktrees", "kit-first"), branch: "wt-branch" },
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

// ---- fix round 1: the review's findings, each from its trigger ----

/** A finished plan whose branch has a commit past its recorded start, with no pull request. */
function finishedPlan(w: ReturnType<typeof build>, merged: boolean) {
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  const start = w.git("rev-parse", "main");
  w.branch("first-branch", { "src/one/a.ts": "1\n" });
  w.change(first, { status: "done", branch: "first-branch", base: start });
  if (merged) {
    w.git("merge", "-q", "--no-edit", "first-branch");
    w.git("push", "-q", "origin", "main");
  }
  return first;
}

test("a finished plan with no pull request is released once its branch is proved on the default branch", () => {
  for (const gh of ["none", "unknown"] as const) {
    const w = build();
    const first = finishedPlan(w, false);
    w.prs["first-branch"] = gh;
    // Not on the default branch yet: it stays held, and the line names the person's way out.
    const held = w.line("first");
    expect(held.state).toBe("merging");
    expect(held.fix).toContain("herdr plans --release first");
    expect(held.text).toContain(
      gh === "unknown"
        ? "gh cannot say whether its pull request merged"
        : "no pull request was found",
    );
    expect(taskById(w.db, first.id).lead).not.toBeNull();
    // Merged into origin/main: the same reading releases it.
    w.git("merge", "-q", "--no-edit", "first-branch");
    w.git("push", "-q", "origin", "main");
    const released = judgePlans(w.base).lines.find((one) => one.plan === "first");
    expect(released).toMatchObject({ state: "released" });
    expect(released?.text).toContain("its branch is on origin/main");
    expect(taskById(w.db, first.id).lead).toBeNull();
  }
});

test("a finished plan whose branch is empty past its start is never released by ancestry", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  const start = w.git("rev-parse", "main");
  w.git("branch", "empty-branch", "main");
  w.change(first, { status: "done", branch: "empty-branch", base: start });
  expect(w.line("first").state).toBe("merging");
  expect(taskById(w.db, first.id).lead).not.toBeNull();
});

test("--release lets the person release a closed plan, and only that", () => {
  const w = build();
  const open = w.plan("open", ["src/a/"]);
  const closed = w.plan("closed", ["src/b/"]);
  w.plan("loose", ["src/c/"]);
  w.reserve("open");
  w.reserve("closed");
  w.change(closed, { status: "done" });
  const refused = (ref: string, world: Partial<PlansWorld> = {}) => {
    const answer = releaseByHand({ ...w.base, ...world }, ref);
    if (answer.ok) throw new Error("expected a refusal");
    return answer;
  };
  expect(refused("nothing").why).toBe('Plan "nothing" was not found in this project.');
  expect(refused("loose").why).toBe('Plan "loose" is not reserved: it holds no files.');
  const stillOpen = refused("open");
  expect(stillOpen.why).toContain('Plan "open" is still open');
  expect(stillOpen.fix).toContain("task_done");
  expect(taskById(w.db, open.id).lead).not.toBeNull();
  expect(refused("closed", { who: { ...LEAD, sessionId: "x", pid: 1, procStart: "1" } }).why).toBe(
    'Plan "closed" is reserved for another session.',
  );
  const done = releaseByHand(w.base, "closed");
  expect(done).toEqual({ ok: true, text: "Released plan #2 closed: its files are free." });
  expect(taskById(w.db, closed.id).lead).toBeNull();
  expect(eventsOf(w.db, closed).at(-1)?.reason).toBe("released by hand");
});

test("a reservation lost to a race is refused with the way to see where the plan stands", () => {
  const w = build();
  w.plan("alpha", ["src/a/"]);
  let lost = false;
  // The gates have passed when `reservePlan`'s arguments are read: another start reserves it now.
  const check = {
    ignore: [] as string[],
    get caseFold() {
      if (!lost) {
        lost = true;
        w.reserve("alpha");
      }
      return false;
    },
  };
  for (const prepare of [prepareStart, prepareReserve]) {
    const answer = prepare({ ...w.base, check }, "alpha");
    if (answer.ok) throw new Error("expected a refusal");
    expect(answer.why).toContain("is already reserved for session lead");
    expect(answer.fix).toContain("herdr plans shows where it stands");
    // Reset: free the plan for the next kind of caller.
    ok(releasePlan(w.db, { project: "p", plan: "alpha", who: LEAD, now: 20 }));
    lost = false;
  }
});

test("a start is refused when the default branch can only be guessed", () => {
  const w = build();
  w.plan("alpha", ["src/a/"]);
  const answer = prepareStart({ ...w.base, baseFrom: "default" }, "alpha");
  if (answer.ok) throw new Error("expected a refusal");
  expect(answer.why).toContain("The default branch cannot be found");
  expect(answer.fix).toBe(
    "run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
  );
  expect(allTasks(w.db, "p").every((t) => t.lead === null)).toBe(true);
  expect(prepareStart({ ...w.base, baseFrom: "config" }, "alpha").ok).toBe(true);
});

test("a start refuses a guessed default branch even with --base: a held branch could hide in the unread diff", () => {
  const w = build();
  const holder = w.plan("holder", ["src/a/"]);
  w.plan("mover", ["src/b/x.ts"]);
  w.reserve("holder");
  // The holder's branch drifted into the mover's file, which its stored list never named.
  w.branch("holder-branch", { "src/b/x.ts": "drift\n" });
  w.change(holder, { branch: "holder-branch" });
  // The real default branch is not `main`: a guessed one finds no branch to diff against.
  const guessed = { ...w.base, base: "no-such-branch", baseFrom: "default" as const };
  expect(w.line("mover", guessed).state).toBe("ready");
  const answer = prepareStart(guessed, "mover");
  if (answer.ok) throw new Error("expected a refusal");
  expect(answer.why).toContain("The default branch cannot be found");
  expect(answer.fix).toBe(
    "run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
  );
  expect(allTasks(w.db, "p").find((t) => t.plan === "mover")?.lead).toBeNull();
  // With the default branch known, the same start warns of the overlap the guess hid.
  const known = prepareStart(w.base, "mover");
  if (!known.ok) throw new Error(known.why);
  expect(known.warnings.map((one) => one.split(". ")[0])).toEqual([
    'Overlap: #1 "holder" and #2 "mover" share src/b/x.ts',
  ]);
});

test("the lead's own reservation also needs the default branch", () => {
  const w = build();
  w.plan("beta", ["src/b/"]);
  const reserve = prepareReserve({ ...w.base, baseFrom: "default" }, "beta");
  if (reserve.ok) throw new Error("expected a refusal");
  expect(reserve.why).toContain("The default branch cannot be found");
});

test("a resume claims the plan before it launches, and a second reading of it finds a child starting", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  const worktree = join(w.repo, ".claude", "worktrees", "kit-first");
  w.change(first, { agent: "herdr:core/t2", worktree, branch: "wt-branch" });
  let clock = 5000;
  const world = { ...w.base, process: ENDED, now: () => clock };
  const claimed = prepareStart(world, "first");
  if (!claimed.ok) throw new Error(claimed.why);
  expect(claimed.claim).toEqual({ marker: "pending:5000", previous: "herdr:core/t2" });
  expect(taskById(w.db, first.id).agent).toBe("pending:5000");
  // The second start reads the claim: a child is starting, so it is refused.
  const second = prepareStart(world, "first");
  if (second.ok) throw new Error("expected a refusal");
  expect(second.why).toContain("its child's session ended, but a child is starting");
  // A start that died leaves the claim behind: past the grace it reads as gone, and a resume goes.
  clock = 5000 + HANDOUT_GRACE_MS + 1;
  const again = prepareStart(world, "first");
  if (!again.ok) throw new Error(again.why);
  expect(again.claim?.previous).toBe("pending:5000");
});

test("a live terminal that carries the plan's label stops a start, whichever way it would go", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.plan("second", ["src/two/"]);
  w.strays.second = "t9";
  const fresh = prepareStart(w.base, "second");
  if (fresh.ok) throw new Error("expected a refusal");
  expect(fresh.why).toBe('Plan "second": terminal t9 carries its label and is live.');
  expect(taskById(w.db, first.id).lead).toBeNull();
  // A resume: the plan's own pane is gone, but another terminal carries its label.
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, {
    agent: "herdr:core/t2",
    worktree: join(w.repo, ".claude", "worktrees", "kit-first"),
    branch: "b",
  });
  w.strays.first = "t7";
  const resume = prepareStart({ ...w.base, process: ENDED }, "first");
  if (resume.ok) throw new Error("expected a refusal");
  expect(resume.why).toContain("terminal t7 carries its label");
  expect(taskById(w.db, first.id).agent).toBe("herdr:core/t2");
});

test("a hand-out with no pane bound is not released while a terminal carries its label", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  const late = { ...w.base, now: () => 10 + HANDOUT_GRACE_MS + 1 };
  w.strays.first = "t9";
  const kept = judgePlans(late).lines.find((one) => one.plan === "first");
  expect(kept?.state).toBe("stale");
  expect(kept?.text).toContain("terminal t9 carries its label");
  expect(taskById(w.db, first.id).lead).not.toBeNull();
  delete w.strays.first;
  expect(judgePlans(late).lines.find((one) => one.plan === "first")?.state).toBe("released");
  expect(taskById(w.db, first.id).lead).toBeNull();
});

test("a release decided on an old reading leaves a plan that was handed out again alone", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  // While the lead reads the pane, another start releases the plan and hands it out again.
  const late = {
    ...w.base,
    now: () => 10 + HANDOUT_GRACE_MS + 1,
    pane: () => {
      ok(releasePlan(w.db, { project: "p", plan: "first", who: LEAD, now: 5 }));
      w.reserve("first");
      return NONE;
    },
  };
  judgePlans(late);
  const lead = taskById(w.db, first.id).lead;
  expect(lead).not.toBeNull();
  expect(lead?.handoutId).not.toBe("");
});

test("the reservation is stamped when it is made, not when the command opened", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  let clock = 1000;
  const world = { ...w.base, now: () => clock };
  clock = 7777;
  const start = prepareStart(world, "first");
  if (!start.ok) throw new Error(start.why);
  expect(taskById(w.db, first.id).updatedAt).toBe(7777);
});

test("a recorded worktree outside .claude/worktrees is never reused", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, { agent: "herdr:core/t2", worktree: "/etc", branch: "b" });
  const answer = prepareStart({ ...w.base, process: ENDED }, "first");
  if (answer.ok) throw new Error("expected a refusal");
  expect(answer.why).toContain("its recorded worktree /etc is not a child's folder");
  expect(answer.fix).toContain("task_update #1 worktree");
});

/** A plan whose child is gone, its worktree recorded at `worktree`; the resume reads it. */
function goneAt(w: ReturnType<typeof build>, worktree: string) {
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, { agent: "herdr:core/t2", worktree, branch: "feat-x" });
  return () => prepareStart({ ...w.base, process: ENDED }, "first");
}

/** The words of a refused start, or a failure when it started. */
function refusedWhy(answer: ReturnType<typeof prepareStart>): string {
  if (answer.ok) throw new Error("expected a refusal");
  return answer.why;
}

test("a worktree outside the default folder is reused only when git lists it and herdr's launch record names it", async () => {
  const w = build();
  const elsewhere = join(tempDir("elsewhere"), "feature-x");
  git(w.repo, "worktree", "add", "-q", "-b", "feat-x", elsewhere);
  const resume = goneAt(w, elsewhere);
  // Listed by git, but herdr never launched a child there: a hand-made worktree for a task row.
  expect(refusedWhy(resume())).toContain(
    `its recorded worktree ${elsewhere} is not a child's folder`,
  );
  await writeLaunchRecord(w.stateDir, {
    at: 1,
    branch: "feat-x",
    repo: w.repo,
    worktree: elsewhere,
  });
  const resumed = resume();
  if (!resumed.ok) throw new Error(resumed.why);
  expect(resumed.recorded).toEqual({ worktree: elsewhere, branch: "feat-x" });
});

test("a launch record alone is not enough: the main checkout, an unlisted path and a gone folder stay refused", async () => {
  const gone = join(tempDir("elsewhere"), "feature-g");
  const cases: Record<string, (repo: string) => string> = {
    main: (repo) => repo,
    unlisted: () => join(tempDir("unlisted"), "x"),
    gone: (repo) => {
      git(repo, "worktree", "add", "-q", "-b", "feat-g", gone);
      rmSync(gone, { recursive: true });
      return gone;
    },
  };
  for (const [kind, where] of Object.entries(cases)) {
    const w = build();
    const target = where(w.repo);
    await writeLaunchRecord(w.stateDir, { at: 1, branch: "b", repo: w.repo, worktree: target });
    expect(refusedWhy(goneAt(w, target)()), kind).toContain("is not a child's folder");
  }
});

test("a worktree git lists in the default folder keeps today's rule, with no record needed", () => {
  const w = build();
  const home = join(w.repo, ".claude", "worktrees", "kit-first");
  git(w.repo, "worktree", "add", "-q", "-b", "worktree-kit-first", home);
  expect(goneAt(w, home)().ok).toBe(true);
});

test("plans.ts holds no gh code of its own: pullRequestState is the one home", () => {
  const source = readFileSync(join(import.meta.dir, "plans.ts"), "utf8");
  expect(source).not.toContain("Bun.spawn");
  expect(source).not.toContain('"gh"');
  expect(source).toContain("pullRequestState");
});

test("a release decided on an old reading leaves a plan a start has claimed since", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  // While the lead reads the pane, a start claims the plan: the reading is no longer the plan.
  const late = {
    ...w.base,
    now: () => 10 + HANDOUT_GRACE_MS + 1,
    pane: () => {
      ok(updateTask(w.db, first.id, { agent: "pending:1" }, LEAD, 10 + HANDOUT_GRACE_MS));
      return NONE;
    },
  };
  judgePlans(late);
  expect(taskById(w.db, first.id).lead).not.toBeNull();
  expect(taskById(w.db, first.id).agent).toBe("pending:1");
});

test("a start confirms its claim just before it launches, and is refused when the claim was taken", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  const handout = w.reserve("first").lead?.handoutId ?? "";
  ok(takeTasks(w.db, "p", first.id, CHILD, 20, { from: handout, isLive: () => false }));
  w.change(first, {
    agent: "herdr:core/t2",
    worktree: join(w.repo, ".claude", "worktrees", "kit-first"),
    branch: "b",
  });
  const world = { ...w.base, process: ENDED, now: () => 5000 };
  const claimed = prepareStart(world, "first");
  if (!claimed.ok || !claimed.claim) throw new Error("expected a claim");
  expect(confirmClaim(world, "first", claimed.claim)).toEqual({ ok: true });
  // Another start took the plan over meanwhile.
  w.change(first, { agent: "herdr:core/t9" });
  const lost = confirmClaim(world, "first", claimed.claim);
  if (lost.ok) throw new Error("expected a refusal");
  expect(lost.why).toContain("its claim was taken over while this start waited");
  expect(lost.fix).toContain("herdr plans");
  expect(taskById(w.db, first.id).agent).toBe("herdr:core/t9");
});

test("the merging line leaves the release to the person", () => {
  const w = build();
  const first = w.plan("first", ["src/one/"]);
  w.reserve("first");
  w.change(first, { status: "done" });
  w.change(first, { branch: "no-pr" });
  w.git("branch", "no-pr", "main");
  const line = w.line("first");
  expect(line.fix).toContain("the person decides: ");
  expect(line.fix).toContain("herdr plans --release first");
});

test("a held plan with no file list and no branch diff is named, never a block: a hand-out and a reserve warn, with the fix", () => {
  const w = build();
  // Another session runs a plan that lists no file and has no branch yet.
  const solo = w.plan("solo", undefined, { who: OTHER });
  ok(updateTask(w.db, solo.id, { status: "in_progress" }, OTHER, 5));
  const beta = w.plan("beta", ["src/b/"]);
  const line = w.line("beta");
  expect(line.state).toBe("ready");
  expect(line.text).toBe(
    "ready: nothing blocks it; #1 solo is held with no file list and no branch diff, so no overlap can be ruled out (an overlap warns and never holds a plan back)",
  );
  expect(line.fix).toBe(
    "task_update #1 with files: the paths and folders it changes, so overlaps with it can be named",
  );
  const unknown =
    'Overlap unknown: #1 "solo" has no file list, so it cannot be compared with #2 "beta": set its files (task_update on #1 with files).';
  for (const prepare of [prepareReserve, prepareStart]) {
    const answer = prepare(w.base, "beta");
    if (!answer.ok) throw new Error(answer.why);
    expect(answer.warnings).toEqual([unknown]);
    ok(releasePlan(w.db, { project: "p", plan: "beta", who: LEAD, now: 20 }));
  }
  expect(notesOf(w.db, beta.id)).toEqual([]);
});

test("a held plan with a file list, or a branch diff, still allows a disjoint hand-out", () => {
  const w = build();
  const listed = w.plan("listed", ["lib/"], { who: OTHER });
  ok(updateTask(w.db, listed.id, { status: "in_progress" }, OTHER, 5));
  w.plan("beta", ["src/b/"]);
  expect(w.line("beta").state).toBe("ready");
  // No list, but its branch changed a file: that file is what it holds, and a plan elsewhere is clear.
  const branched = w.plan("branched", undefined, { who: OTHER });
  w.branch("branched-branch", { "docs/x.md": "x\n" });
  ok(updateTask(w.db, branched.id, { status: "in_progress", branch: "branched-branch" }, OTHER, 6));
  expect(w.line("beta").state).toBe("ready");
  w.plan("gamma", ["docs/"]);
  expect(w.line("gamma").text).toBe(
    "ready: nothing blocks it; overlaps #3 branched: docs/ (an overlap warns and never holds a plan back)",
  );
  expect(prepareStart(w.base, "beta").ok).toBe(true);
});

test("a stacked plan is ready beside its held parent once it starts on its work, says what it is stacked on, and drift skips the pair", () => {
  const w = build();
  const base = w.git("rev-parse", "HEAD");
  w.branch("alpha-branch", { "src/a/one.ts": "1\n" });
  const tip = w.git("rev-parse", "alpha-branch");
  const alpha = w.plan("alpha", ["src/a/"]);
  w.change(alpha, { branch: "alpha-branch", base });
  w.reserve("alpha");
  const beta = w.change(w.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  w.plan("gamma", ["src/a/y.ts"]);
  // No start yet and no base recorded: nothing proves beta is built on alpha, so alpha is a rival.
  const unproved = w.line("beta");
  expect([unproved.state, unproved.text, unproved.fix]).toEqual([
    "ready",
    "ready: nothing blocks it; overlaps #1 alpha: src/a/x.ts (an overlap warns and never holds a plan back)",
    "the stack on alpha counts only when this plan is built on alpha's work: cc-smart-dev-kit herdr start --plan beta starts it on alpha-branch when --base is left out; a plan built here rebuilds its branch on alpha-branch",
  ]);
  // A start on alpha's tip proves it; a start on the default branch does not.
  const started = (start: string) =>
    judgePlans(w.base, "beta", start).lines.find((one) => one.plan === "beta");
  const line = started(tip);
  expect([line?.state, line?.text, line?.stackedOn]).toEqual([
    "ready",
    "ready: nothing blocks it and no held plan shares its files",
    "alpha",
  ]);
  expect(started(base)?.text).toBe(
    "ready: nothing blocks it; overlaps #1 alpha: src/a/x.ts (an overlap warns and never holds a plan back)",
  );
  // Started on the default branch, the hand-out goes ahead and warns of its parent.
  const offWork = prepareStart(w.base, "beta", base);
  if (!offWork.ok) throw new Error(offWork.why);
  expect(offWork.warnings.map((one) => one.split(". ")[0])).toEqual([
    'Overlap: #1 "alpha" and #2 "beta" share src/a/ (src/a/x.ts)',
  ]);
  ok(releasePlan(w.db, { project: "p", plan: "beta", who: LEAD, now: 30 }));
  expect(w.line("gamma").text).toBe(
    "ready: nothing blocks it; overlaps #1 alpha: src/a/y.ts (an overlap warns and never holds a plan back)",
  );
  // The stacked plan's branch holds its parent's work: that is no drift against the parent.
  w.reserve("beta", { stacked: [{ child: beta.id, parent: "alpha" }] });
  git(w.repo, "checkout", "-q", "-b", "beta-branch", "alpha-branch");
  writeFileSync(join(w.repo, "src/a/x.ts"), "x\n");
  writeFileSync(join(w.repo, "src/a/z.ts"), "z\n");
  git(w.repo, "add", "-A");
  git(w.repo, "commit", "-q", "-m", "work on beta");
  git(w.repo, "checkout", "-q", "main");
  w.change(beta, { branch: "beta-branch", base: tip });
  expect(w.line("beta").drift).toEqual([]);
  // A parent with no branch recorded proves no stack, and the fix says so.
  const parentless = build();
  parentless.plan("alpha", ["src/a/"]);
  parentless.reserve("alpha");
  parentless.change(parentless.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  expect(parentless.line("beta").fix).toBe(
    "the stack on alpha counts only once alpha records its branch: task_update #1 with branch",
  );
  // A parent whose branch holds no commit of its own yet proves no stack: the fix waits for one,
  // whatever the start.
  const empty = build();
  git(empty.repo, "branch", "alpha-branch", "main");
  empty.change(empty.plan("alpha", ["src/a/"]), { branch: "alpha-branch" });
  empty.reserve("alpha");
  empty.change(empty.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  const waiting = judgePlans(empty.base, "beta", empty.git("rev-parse", "alpha-branch")).lines.find(
    (one) => one.plan === "beta",
  );
  expect([waiting?.state, waiting?.fix]).toEqual([
    "ready",
    "the stack on alpha counts only once alpha has work of its own: wait for its first commit on alpha-branch",
  ]);
  // A stacked plan another session took is no pair, and the fix names it.
  const taken = build();
  taken.branch("alpha-branch", { "src/a/one.ts": "1\n" });
  taken.change(taken.plan("alpha", ["src/a/"]), { branch: "alpha-branch" });
  taken.reserve("alpha");
  const theirs = taken.change(taken.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  ok(takeTasks(taken.db, "p", theirs.id, OTHER, 60, { isLive: () => false }));
  const after = judgePlans(
    { ...taken.base, who: OTHER },
    "beta",
    taken.git("rev-parse", "alpha-branch"),
  );
  expect(after.stacked).toEqual([]);
  expect(after.lines.find((one) => one.plan === "beta")?.fix).toBe(
    "the stack on alpha counts only while one lead leads both plans, and another session now holds this plan or alpha: take it back (task_take), or clear the stack (task_update #2 with stacked_on null)",
  );
  // The default branch only guessed proves nothing either.
  const guessed = judgePlans(
    { ...empty.base, baseFrom: "default" },
    "beta",
    empty.git("rev-parse", "alpha-branch"),
  ).lines.find((one) => one.plan === "beta");
  expect(guessed?.fix).toBe(
    "the stack on alpha counts only once the default branch is known: run `git remote set-head origin --auto`, or set worktrees.base in .claude/cc-smart-dev-kit.json",
  );
  // A parent that records no start has no lower end to its own work: the fix asks for it.
  const unstarted = build();
  unstarted.branch("alpha-branch", { "src/a/one.ts": "1\n" });
  unstarted.change(unstarted.plan("alpha", ["src/a/"]), { branch: "alpha-branch" });
  unstarted.reserve("alpha");
  unstarted.change(unstarted.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  const noBase = judgePlans(
    unstarted.base,
    "beta",
    unstarted.git("rev-parse", "alpha-branch"),
  ).lines.find((one) => one.plan === "beta");
  expect(noBase?.fix).toBe(
    "the stack on alpha counts only once alpha records where it started: task_update #1 with base set to the commit you created its branch from (`git rev-parse HEAD` at that moment), not its fork from the default branch",
  );
  // A parent stacked on a finished plan whose branch is gone (squash-merged, then deleted): no
  // fetch brings it back, so the fix clears the parent's stack on it.
  const gone = build();
  const goneBase = gone.git("rev-parse", "HEAD");
  gone.branch("alpha-branch", { "src/a/one.ts": "1\n" });
  const pp = gone.plan("pp", ["src/p/"]);
  gone.change(pp, { branch: "p-branch" });
  ok(updateTask(gone.db, pp.id, { status: "dropped" }, LEAD, 51));
  gone.change(gone.plan("alpha", ["src/a/"]), {
    branch: "alpha-branch",
    base: goneBase,
    stackedOn: "pp",
  });
  gone.reserve("alpha");
  gone.change(gone.plan("beta", ["src/a/x.ts"]), { stackedOn: "alpha" });
  const cleared = judgePlans(gone.base, "beta", gone.git("rev-parse", "alpha-branch")).lines.find(
    (one) => one.plan === "beta",
  );
  expect(cleared?.fix).toBe(
    "the stack on alpha counts only once alpha no longer names pp, which holds no files and whose branch is gone: clear #2's stack on pp (task_update stacked_on null)",
  );
  // While the grandparent still holds its files, its branch is only missing here: fetch it.
  ok(updateTask(gone.db, pp.id, { status: "pending" }, LEAD, 52));
  const fetch = judgePlans(gone.base, "beta", gone.git("rev-parse", "alpha-branch")).lines.find(
    (one) => one.plan === "beta",
  );
  expect(fetch?.fix).toBe(
    "the stack on alpha counts only once the branch of pp, which alpha is stacked on, is in this repository: fetch it",
  );
  // A stacked plan that keeps a branch made apart from its parent's: the fix records the branch
  // built on the parent, since a new herdr start would not replace it.
  const offBranch = build();
  const offBase = offBranch.git("rev-parse", "HEAD");
  offBranch.branch("alpha-branch", { "src/a/one.ts": "1\n" });
  offBranch.branch("beta-branch", { "src/b/one.ts": "1\n" });
  offBranch.change(offBranch.plan("alpha", ["src/a/"]), {
    branch: "alpha-branch",
    base: offBase,
  });
  offBranch.reserve("alpha");
  offBranch.change(offBranch.plan("beta", ["src/a/x.ts"]), {
    stackedOn: "alpha",
    branch: "beta-branch",
    base: offBranch.git("rev-parse", "alpha-branch"),
  });
  expect(offBranch.line("beta").fix).toBe(
    "the stack on alpha counts only when this plan records its own branch, built on alpha's work: task_update #2 branch=<branch built on alpha>",
  );
  // The stack is shown on the line the command prints.
  const shown: string[] = [];
  const out = createOut(
    { color: false, unicode: true, width: 200, rich: false },
    { line: (text) => shown.push(text), raw: (text) => shown.push(text) },
  );
  showPlanLines(out, line === undefined ? [] : [line]);
  expect(shown).toEqual([
    "✓ #2 beta (stacked on alpha): ready: nothing blocks it and no held plan shares its files",
  ]);
});

test("a hand-out that overlaps names the base's generated files with the ready propose line, in both orders", () => {
  for (const order of [
    ["folder", "file"],
    ["file", "folder"],
  ]) {
    const w = build();
    mkdirSync(join(w.repo, "db"), { recursive: true });
    writeFileSync(join(w.repo, ".gitattributes"), "db/*.gen.ts linguist-generated\n");
    writeFileSync(join(w.repo, "db/types.gen.ts"), "export {};\n");
    writeFileSync(join(w.repo, "db/schema.ts"), "export {};\n");
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "generated files");
    commitConfig(w.repo, { workflow: { plans: { mergeFiles: ["CHANGELOG.md"] } } }, ["main"]);
    const world = { ...w.base, check: planFilesCheck(w.repo, w.base.env) };
    const folder = w.plan("folder", ["db/"]);
    const file = w.plan("file", ["db/types.gen.ts"]);
    const first = prepareStart(world, order[0] ?? "");
    if (!first.ok) throw new Error(first.why);
    expect(first.warnings).toEqual([]);
    const second = prepareStart(world, order[1] ?? "");
    if (!second.ok) throw new Error(second.why);
    expect(second.warnings).toEqual([
      `Overlap: #1 "folder" and #2 "file" share db/ (db/types.gen.ts). Leads: #1 session lead; #2 session lead. Both may run at once: the plan that merges second rebases onto the first one's merged code (or merges it in, once pushed), resolves the conflicts, reruns the full check, and names the other plan and these files in its pull request. origin/main marks db/types.gen.ts generated: \`${COMMAND} workflow propose plans.mergeFiles 'CHANGELOG.md,db/types.gen.ts'\` opens the pull request that leaves them out of every overlap once the person merges it.`,
    ]);
    // The child of each plan finds it as the plan's first note.
    for (const id of [folder.id, file.id])
      expect(notesOf(w.db, id).map((note) => note.text)).toEqual(second.warnings);
  }
});
