/**
 * The stack proof from git (`stackHolds`, `judgeStacks`) and what the task tools do with it. A
 * pair counts only when that very pair is proved from the rows as the call writes them, one lead
 * leads both plans when the overlap is judged, the parent has work of its own past
 * `origin/<default>`, the stacked plan's start shares some of it (its fork point with the parent
 * is not on the default branch), and a stacked plan that records a branch holds its start.
 * Real git in a temp clone, whose `origin/main` is the default branch.
 */
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import { hookEnv, makeClone } from "../testing/hooks";
import { git, gitAt, tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { createTaskOps, type TaskAnswer } from "./ops";
import {
  judgeStacks,
  provedStacks,
  type StackCase,
  type StackGit,
  stackHolds,
} from "./stack-proof";
import { openWorkDb, workDbFile } from "./work/db";
import { allTasks, taskById } from "./work/queries";
import { createTask, reservePlan, updateTask } from "./work/store";
import type { Result, Who, WorkTask } from "./work/types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };
const OTHER: Who = { sessionId: "other", pid: 6303, procStart: "63030" };
const THIRD: Who = { sessionId: "third", pid: 7404, procStart: "74040" };
const CHILD: Who = { sessionId: "child", pid: 8505, procStart: "85050" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}
function refused(answer: TaskAnswer): string {
  if (answer.ok) throw new Error(`expected a refusal, got: ${answer.text}`);
  return answer.why;
}

/** Commits `files` in `repo`, dated `date` when given (else now), and returns the commit. */
function commit(repo: string, files: Record<string, string>, date?: string): string {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  git(repo, "add", "-A");
  const message = `change ${Object.keys(files).join(" ")}`;
  if (date === undefined) git(repo, "commit", "-q", "-m", message);
  else gitAt(date, repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
}

/**
 * A clone whose `origin/main` is its first commit (`base`), and an `alpha-branch` that leaves it
 * with one commit (`tip`). Checked out on `main`. `onMain` commits on `main` and pushes it, so
 * `origin/main` moves too, the way a merged pull request moves it.
 */
function stackRepo() {
  const { repo } = makeClone();
  const env = hookEnv();
  const base = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "checkout", "-q", "-b", "alpha-branch");
  const tip = commit(repo, { "alpha.txt": "1\n" });
  git(repo, "checkout", "-q", "main");
  const run: StackGit = (args) => runGit(repo, args, env);
  const onMain = (files: Record<string, string>, date?: string) => {
    git(repo, "checkout", "-q", "main");
    const made = commit(repo, files, date);
    git(repo, "push", "-q", "origin", "main");
    return made;
  };
  /** Commits on `branch` (made from `from` when it is new) and comes back to `main`. */
  const onBranch = (branch: string, files: Record<string, string>, from?: string) => {
    git(repo, "checkout", "-q", ...(from === undefined ? [branch] : ["-b", branch, from]));
    const made = commit(repo, files);
    git(repo, "checkout", "-q", "main");
    return made;
  };
  /** Rebases `branch` onto `main` and comes back to `main`. */
  const rebase = (branch: string) => {
    git(repo, "checkout", "-q", branch);
    git(repo, "rebase", "-q", "main");
    git(repo, "checkout", "-q", "main");
  };
  return { repo, env, base, tip, run, onMain, onBranch, rebase };
}

/** A store in a temp folder, and plan rows made in it by `who`. */
function store() {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const plan = (slug: string, change: Parameters<typeof updateTask>[2] = {}, who = LEAD) => {
    const made = ok(
      createTask(db, { project: "p", subject: slug, kind: "plan", plan: slug, files: [] }, who, 1),
    );
    return Object.keys(change).length ? ok(updateTask(db, made.id, change, who, 2)) : made;
  };
  return { db, plan };
}

/** `stackHolds` for one pair: a start given unless `given` says it was only recorded, no grandparent. */
function verdict(
  run: StackGit,
  onDefault: string | null,
  parent: WorkTask,
  child: WorkTask,
  start: string | null,
  over: Partial<StackCase> = {},
) {
  return stackHolds(run, onDefault, {
    parent,
    child,
    grandparent: null,
    start,
    given: true,
    ...over,
  });
}

test("the proof: a start that shares the parent's own work, past origin/<default> and its start", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  const holds = (start: string | null, child: WorkTask = beta, parent: WorkTask = alpha) =>
    verdict(g.run, D, parent, child, start);
  // Started on the parent's tip, or on a commit past it: proved.
  expect(holds(g.tip)).toEqual({ proved: true });
  const past = g.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  expect(holds(past)).toEqual({ proved: true });
  // Started on the default branch, or on nothing git knows: not proved.
  expect(holds(g.base)).toEqual({ proved: false, gap: "start-lacks-parent" });
  expect(holds(null)).toEqual({ proved: false, gap: "no-start" });
  expect(holds("no-such-ref")).toEqual({ proved: false, gap: "no-start" });
  expect(holds("--all")).toEqual({ proved: false, gap: "no-start" });
  // A default branch that is unknown, or a parent with no branch git knows, proves nothing.
  expect(verdict(g.run, null, alpha, beta, g.tip)).toEqual({
    proved: false,
    gap: "default-unknown",
  });
  expect(holds(g.tip, beta, { ...alpha, branch: null })).toEqual({
    proved: false,
    gap: "parent-branch",
  });
  expect(holds(g.tip, beta, { ...alpha, branch: "gone-branch" })).toEqual({
    proved: false,
    gap: "parent-branch",
  });
  // The parent's own start bounds its work: with none git knows, nothing is proved; a start at
  // its tip leaves it no work of its own below the fork point.
  expect(holds(g.tip, beta, { ...alpha, base: null })).toEqual({
    proved: false,
    gap: "parent-base",
  });
  expect(holds(g.tip, beta, { ...alpha, base: "no-such-ref" })).toEqual({
    proved: false,
    gap: "parent-base",
  });
  expect(holds(g.tip, beta, { ...alpha, base: g.tip })).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("an empty parent proves nothing: its branch holds no commit past origin/<default>", () => {
  const g = stackRepo();
  const { plan } = store();
  git(g.repo, "branch", "empty-branch", "main");
  const empty = plan("alpha", { branch: "empty-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D, empty, beta, g.base)).toEqual({
    proved: false,
    gap: "parent-empty",
  });
  // A parent whose work merged into the default branch has none of its own left either.
  const alpha = plan("gamma", { branch: "alpha-branch", base: g.base });
  git(g.repo, "merge", "-q", "--no-edit", "alpha-branch");
  git(g.repo, "push", "-q", "origin", "main");
  const merged = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, merged, alpha, beta, g.tip)).toEqual({
    proved: false,
    gap: "parent-empty",
  });
});

test("a start the stacked plan only wrote down proves nothing: its own branch must hold it", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  // Its branch was made on the default branch, and its base names alpha's tip all the same.
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, "main");
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  const recorded = { given: false };
  expect(verdict(g.run, D, alpha, beta, beta.base, recorded)).toEqual({
    proved: false,
    gap: "start-off-branch",
  });
  // A branch git does not know holds nothing.
  expect(verdict(g.run, D, alpha, { ...beta, branch: "gone-branch" }, g.tip, recorded)).toEqual({
    proved: false,
    gap: "start-off-branch",
  });
  // Rebuilt on alpha's branch, the same start is proved.
  git(g.repo, "branch", "-f", "beta-branch", "alpha-branch");
  g.onBranch("beta-branch", { "beta.txt": "1\n" });
  expect(verdict(g.run, D, alpha, beta, beta.base, recorded)).toEqual({ proved: true });
});

test("PROBE 6: a recorded start needs a recorded branch of the stacked plan's own, never the parent's", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  const unbranched = plan("beta", { stackedOn: "alpha", base: g.tip });
  expect(verdict(g.run, D, alpha, unbranched, g.tip, { given: false })).toEqual({
    proved: false,
    gap: "own-branch",
  });
  // The start a `herdr start` is about to reset to needs no branch yet: herdr records it at launch.
  expect(verdict(g.run, D, alpha, unbranched, g.tip)).toEqual({ proved: true });
  // The parent's own branch is never the stacked plan's, given or recorded.
  const shared = { ...unbranched, branch: "alpha-branch" };
  expect(verdict(g.run, D, alpha, shared, g.tip, { given: false })).toEqual({
    proved: false,
    gap: "own-branch",
  });
  expect(verdict(g.run, D, alpha, shared, g.tip)).toEqual({ proved: false, gap: "own-branch" });
});

test("a parent that moves on after the stacked plan started stays proved; one rebased since is a rival", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  const D = () => git(g.repo, "rev-parse", "origin/main").trim();
  const recorded = { given: false };
  // Alpha keeps building after beta started: the fork point is still alpha's own commit.
  g.onBranch("alpha-branch", { "alpha.txt": "2\n" });
  expect(verdict(g.run, D(), alpha, beta, beta.base, recorded)).toEqual({ proved: true });
  // The default branch moves on, and alpha is rebased onto it: the fork point is on main now.
  g.onMain({ "main.txt": "1\n" });
  g.rebase("alpha-branch");
  expect(verdict(g.run, D(), alpha, beta, beta.base, recorded)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("PROBE 2: a parent rebased onto a later main never proves a start on main, before or after", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha" });
  const m1 = g.onMain({ "m.txt": "1\n" }); // beta starts here, on main, without alpha's work
  g.onMain({ "m.txt": "2\n" });
  const D = () => git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D(), alpha, beta, m1).proved).toBe(false);
  g.rebase("alpha-branch");
  expect(verdict(g.run, D(), alpha, beta, m1)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

/**
 * A chain of stacks: `p-branch` (P1) leaves `origin/main`, `alpha-branch` (A1) is built on P1,
 * and `beta-branch` (B1) on P1 only, so it holds none of alpha's own work.
 */
function chainRepo() {
  const g = stackRepo();
  const p1 = g.onBranch("p-branch", { "p.txt": "1\n" }, "main");
  const a1 = g.onBranch("chain-alpha", { "a.txt": "1\n" }, "p-branch");
  g.onBranch("chain-beta", { "b.txt": "1\n" }, p1);
  return { ...g, p1, a1 };
}

test("PROBE 3: a plan stacked on a stacked plan, started on the grandparent's tip, holds none of its parent's work", () => {
  const g = chainRepo();
  const { plan } = store();
  const pp = plan("pp", { branch: "p-branch", base: g.base });
  const alpha = plan("alpha", { stackedOn: "pp", branch: "chain-alpha", base: g.p1 });
  const beta = plan("beta", { stackedOn: "alpha", branch: "chain-beta", base: g.p1 });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  const recorded = { given: false, grandparent: pp };
  // P1 is under alpha's own start: alpha's work starts above it.
  expect(verdict(g.run, D, alpha, beta, g.p1, recorded)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
  // Alpha's start recorded too low (the default branch): the grandparent's tip still fences P1.
  expect(verdict(g.run, D, { ...alpha, base: g.base }, beta, g.p1, recorded)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
  // A grandparent's branch git does not know proves nothing.
  expect(
    verdict(g.run, D, alpha, beta, g.p1, { ...recorded, grandparent: { ...pp, branch: "gone" } }),
  ).toEqual({ proved: false, gap: "chain-branch" });
  // Built on alpha's own commit, it is proved past every fence.
  git(g.repo, "branch", "-f", "chain-beta", "chain-alpha");
  g.onBranch("chain-beta", { "b.txt": "1\n" });
  expect(verdict(g.run, D, alpha, { ...beta, base: g.a1 }, g.a1, recorded)).toEqual({
    proved: true,
  });
});

test("PROBE 5: an unpushed commit on the local default branch is never the parent's own work", () => {
  const g = stackRepo();
  const { plan } = store();
  // L1 is on local main only; alpha starts there (its base), and beta's branch too.
  git(g.repo, "checkout", "-q", "main");
  const l1 = commit(g.repo, { "local.txt": "1\n" });
  g.onBranch("local-alpha", { "alpha.txt": "1\n" }, l1);
  g.onBranch("local-beta", { "beta.txt": "1\n" }, l1);
  const alpha = plan("alpha", { branch: "local-alpha", base: l1 });
  const beta = plan("beta", { stackedOn: "alpha", branch: "local-beta", base: l1 });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D, alpha, beta, l1, { given: false })).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("a criss-cross history has several fork points, and every one must pass", () => {
  const g = stackRepo();
  const { plan } = store();
  // The parent merges main in, and so does a start made apart from it: the two share two best
  // fork points, alpha's own commit and main's, which is on origin/main. A plain `git merge-base`
  // names alpha's commit here, so one fork point alone would prove the pair. It names it only
  // while the two fork points share a date (git takes the newer one first), so main's commit
  // takes alpha's commit date: on the wall clock a second could pass between the two.
  const tipDate = git(g.repo, "log", "-1", "--format=%cI", g.tip).trim();
  const m1 = g.onMain({ "m.txt": "1\n" }, tipDate);
  git(g.repo, "checkout", "-q", "-b", "start-branch", g.tip);
  git(g.repo, "merge", "-q", "--no-edit", m1);
  const start = git(g.repo, "rev-parse", "HEAD").trim();
  git(g.repo, "checkout", "-q", "alpha-branch");
  git(g.repo, "merge", "-q", "--no-edit", m1);
  git(g.repo, "checkout", "-q", "main");
  const forks = git(g.repo, "merge-base", "--all", start, "alpha-branch").trim().split("\n");
  expect(forks.sort()).toEqual([g.tip, m1].sort());
  expect(git(g.repo, "merge-base", start, "alpha-branch").trim()).toBe(g.tip);
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D, alpha, beta, start)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

/** Merges `other` into `branch` with a merge commit, comes back to `main`, and returns the merge. */
function mergeInto(repo: string, branch: string, other: string): string {
  git(repo, "checkout", "-q", branch);
  git(repo, "merge", "-q", "--no-ff", "--no-edit", other);
  const made = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "checkout", "-q", "main");
  return made;
}

test("PROBE 7: a branch the parent merged in is not its own work; its own commits and merges are", () => {
  const g = stackRepo();
  const { plan } = store();
  // feature-x is merged nowhere else; alpha (from origin/main, its exact base) merges it in.
  const f1 = g.onBranch("feature-x", { "f.txt": "1\n" }, g.base);
  const merge = mergeInto(g.repo, "alpha-branch", "feature-x");
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const D = () => git(g.repo, "rev-parse", "origin/main").trim();
  const on = (start: string) => {
    git(g.repo, "branch", "-f", "beta-branch", start);
    const beta = plan(`beta-${start.slice(0, 7)}`, {
      stackedOn: "alpha",
      branch: "beta-branch",
      base: start,
    });
    return verdict(g.run, D(), alpha, beta, start, { given: false });
  };
  // Built on F1 alone, beta holds none of alpha's own commits.
  expect(on(f1)).toEqual({ proved: false, gap: "start-lacks-parent" });
  // Alpha's own commit, its merge commit, and a later commit of its own all prove the pair.
  expect(on(g.tip)).toEqual({ proved: true });
  expect(on(merge)).toEqual({ proved: true });
  const a2 = g.onBranch("alpha-branch", { "alpha.txt": "2\n" });
  expect(on(a2)).toEqual({ proved: true });
  // A start on alpha's tip stays proved when alpha merges main after it.
  git(g.repo, "branch", "-f", "beta-branch", g.tip);
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  g.onMain({ "m.txt": "1\n" });
  mergeInto(g.repo, "alpha-branch", "main");
  expect(verdict(g.run, D(), alpha, beta, g.tip, { given: false })).toEqual({ proved: true });
});

test("PROBE 8: a parent built on an unmerged branch is fenced by its exact start, the commit it branched from", () => {
  const g = stackRepo();
  const { plan } = store();
  const f1 = g.onBranch("feature-x", { "f.txt": "1\n" }, g.base);
  g.onBranch("built-alpha", { "alpha.txt": "1\n" }, "feature-x");
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, f1);
  const alpha = plan("alpha", { branch: "built-alpha", base: f1 });
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: f1 });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D, alpha, beta, f1, { given: false })).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("PROBE 9: a parent rebased after the stacked plan started on its tip is a rival", () => {
  const g = stackRepo();
  const { plan } = store();
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  g.onMain({ "m.txt": "1\n" });
  g.rebase("alpha-branch");
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(verdict(g.run, D, alpha, beta, g.tip, { given: false })).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("PROBE 10: a grandparent squash-merged with its branch deleted fails closed; with its stack cleared the parent's start still fences", () => {
  const g = chainRepo();
  const { plan } = store();
  git(g.repo, "merge", "-q", "--squash", "p-branch");
  git(g.repo, "commit", "-q", "-m", "squash p");
  git(g.repo, "push", "-q", "origin", "main");
  git(g.repo, "branch", "-q", "-D", "p-branch");
  const pp = plan("pp", { branch: "p-branch", base: g.base });
  const alpha = plan("alpha", { stackedOn: "pp", branch: "chain-alpha", base: g.p1 });
  g.onBranch("on-alpha", { "b.txt": "1\n" }, "chain-alpha");
  const beta = plan("beta", { stackedOn: "alpha", branch: "on-alpha", base: g.a1 });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  const recorded = { given: false, grandparent: pp };
  expect(verdict(g.run, D, alpha, beta, g.a1, recorded)).toEqual({
    proved: false,
    gap: "chain-branch",
  });
  // Alpha's stack on pp cleared: the pair is proved on alpha's own commit, and a start on P1
  // is still refused by alpha's own start.
  expect(verdict(g.run, D, alpha, beta, g.a1, { given: false })).toEqual({ proved: true });
  git(g.repo, "branch", "-f", "on-alpha", g.p1);
  expect(verdict(g.run, D, alpha, { ...beta, base: g.p1 }, g.p1, { given: false })).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("judgeStacks proves pairs, never a plan alone, and runs no git for a pair with two leads", () => {
  const g = stackRepo();
  const { db, plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  g.onBranch("on-tip-branch", { "t.txt": "1\n" }, "alpha-branch");
  const onTip = plan("on-tip", { stackedOn: "alpha", branch: "on-tip-branch", base: g.tip });
  const onMain = plan("on-main", { stackedOn: "alpha", base: g.base });
  const unbased = plan("unbased", { stackedOn: "alpha" });
  plan("plain");
  const all = () => allTasks(db, "p");
  expect(provedStacks(all(), g.run, "main")).toEqual([{ child: onTip.id, parent: "alpha" }]);
  // A start given for a plan wins over its recorded base.
  expect(provedStacks(all(), g.run, "main", { [onMain.id]: g.tip, [unbased.id]: g.tip })).toEqual([
    { child: onTip.id, parent: "alpha" },
    { child: onMain.id, parent: "alpha" },
    { child: unbased.id, parent: "alpha" },
  ]);
  // The default branch unknown: nothing is proved.
  expect(provedStacks(all(), g.run, null)).toEqual([]);
  // The parent's own parent fences its work: alpha stacked on a plan whose branch holds alpha's
  // tip leaves alpha no work of its own above it.
  const pp = plan("pp", { branch: "alpha-branch" });
  db.sqlite.query("UPDATE tasks SET stacked_on='pp' WHERE id=?").run(alpha.id);
  expect(judgeStacks(all(), g.run, "main").get(onTip.id)?.verdict).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
  db.sqlite.query("UPDATE tasks SET stacked_on=NULL WHERE id=?").run(alpha.id);
  expect(pp.stackedOn).toBeNull();
  // A plan of another lead stacked on alpha (written past the store's own refusal) is judged
  // without git, and is not proved.
  const theirs = plan("theirs", {}, OTHER);
  db.sqlite.query("UPDATE tasks SET stacked_on='alpha', base=? WHERE id=?").run(g.tip, theirs.id);
  const calls: string[][] = [];
  const counted: StackGit = (args) => {
    calls.push(args);
    return g.run(args);
  };
  const judged = judgeStacks(
    all().filter((t) => t.id === alpha.id || t.id === theirs.id),
    counted,
    "main",
  );
  expect(judged.get(theirs.id)?.verdict).toEqual({ proved: false, gap: "other-lead" });
  expect(calls).toEqual([]);
  // A parent that no longer holds its files (dropped) proves no stack.
  ok(updateTask(db, alpha.id, { status: "dropped" }, LEAD, 4));
  expect(provedStacks(all(), g.run, "main")).toEqual([]);
});

/**
 * The task tools in a temp clone, for any caller, with nothing ignored and case compared, and
 * `alpha` laid with its branch and start recorded: the parent of every stack below.
 */
function world() {
  const g = stackRepo();
  const paths = cliPaths(g.env);
  const ops = (who: Who) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env: g.env,
      cwd: () => g.repo,
      caller: () => ({ ...who, cwd: g.repo }),
      filesCheck: () => ({ ignore: [], caseFold: false }),
    });
  const project = folderProject(g.repo);
  /** Runs `work` on the store, closed after. */
  const db = <T>(work: (db: ReturnType<typeof openWorkDb>) => T): T => {
    const opened = openWorkDb(workDbFile(paths), { mode: "write" });
    try {
      return work(opened);
    } finally {
      opened.close();
    }
  };
  const row = (slug: string) =>
    db((d) => allTasks(d, project).find((t) => t.kind === "plan" && t.plan === slug) as WorkTask);
  /** Calls one task tool as `who`. */
  const call = (who: Who, operation: string, input: Record<string, unknown>) => {
    const tools = ops(who);
    try {
      return tools.call(operation as Parameters<typeof tools.call>[0], input);
    } finally {
      tools.close();
    }
  };
  const lay = (slug: string, files: string[], stackedOn?: string, who = LEAD) =>
    said(
      call(who, "create", {
        subject: slug,
        plan: slug,
        files,
        ...(stackedOn === undefined ? {} : { stacked_on: stackedOn }),
      }),
    );
  const set = (slug: string, change: Parameters<typeof updateTask>[2], who = LEAD) =>
    db((d) => ok(updateTask(d, row(slug).id, change, who, 5)));
  /** Reserves a plan for a child, with the proof read from git the way `herdr start` reads it. */
  const reserve = (slug: string, who = LEAD) =>
    db((d) =>
      ok(
        reservePlan(d, {
          project,
          plan: slug,
          who,
          holder: "child",
          ignore: [],
          caseFold: false,
          stacked: provedStacks(allTasks(d, project), g.run, "main"),
          now: 10,
        }),
      ),
    );
  /** A branch for `slug` built on alpha's tip, with one commit of its own: its name. */
  const built = (slug: string) => {
    g.onBranch(`${slug}-branch`, { [`${slug}.txt`]: "1\n" }, "alpha-branch");
    return `${slug}-branch`;
  };
  lay("alpha", ["src/a/"]);
  set("alpha", { branch: "alpha-branch", base: g.base });
  return { ...g, project, call, lay, set, row, reserve, db, built };
}

test("PROBE 1: a stack moved to another parent in one update carries no proof: the new parent is a rival", () => {
  const w = world();
  w.lay("beta", ["src/b/"], "alpha");
  w.lay("gamma", ["src/c/"]);
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  w.reserve("alpha");
  w.reserve("beta");
  w.reserve("gamma");
  // Gamma records no branch: no stack on it can be proved, and beta's proof on alpha is no proof on gamma.
  expect(
    refused(w.call(LEAD, "update", { task: "#2", stacked_on: "gamma", files: ["src/c/x.ts"] })),
  ).toBe(
    '#2 "beta" is held, so its files may not overlap another held plan: overlaps #3 "gamma": src/c/x.ts (src/c/)',
  );
  expect([w.row("beta").stackedOn, w.row("beta").files]).toEqual(["alpha", ["src/b/"]]);
});

test("PROBE 1b: a stack moved to another parent while the plan starts is judged on the new parent", () => {
  const w = world();
  w.lay("beta", ["src/c/x.ts"], "alpha");
  w.lay("gamma", ["src/c/"]);
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  w.reserve("alpha");
  w.reserve("gamma");
  // The start makes beta held in the same write, so its new stack is judged like a held plan's.
  expect(
    refused(w.call(LEAD, "update", { task: "#2", stacked_on: "gamma", status: "in_progress" })),
  ).toBe(
    '#2 "beta" is held, so its files may not overlap another held plan: overlaps #3 "gamma": src/c/x.ts (src/c/)',
  );
  expect([w.row("beta").stackedOn, w.row("beta").status]).toEqual(["alpha", "pending"]);
});

test("PROBE 3b: through the task tools, a plan stacked on a stacked plan but started below its work is a rival", () => {
  const w = world();
  w.lay("child", ["src/c/"], "alpha");
  w.set("child", { branch: w.built("child"), base: w.tip });
  w.lay("grand", ["src/c/x.ts"], "child");
  w.reserve("child");
  // Grand records where it really started (alpha's tip, below child's work) and its real branch.
  git(w.repo, "branch", "grand-branch", "alpha-branch");
  expect(
    refused(
      w.call(LEAD, "update", {
        task: "#3",
        base: w.tip,
        branch: "grand-branch",
        status: "in_progress",
      }),
    ),
  ).toContain('#3 "grand" cannot start, since it overlaps #2 "child": src/c/x.ts (src/c/)');
});

test("a stack set in the same call as the start is proved on that stack", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"]);
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  w.reserve("alpha");
  expect(
    said(w.call(LEAD, "update", { task: "#2", stacked_on: "alpha", status: "in_progress" })),
  ).toBe('#2 "beta" · in progress · stacked on alpha');
});

test("a base set in the same call as the start is judged, not the base it replaces", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"], "alpha");
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  w.reserve("alpha");
  // The stored base is proved; the call moves it to the default branch: judged on the new one.
  expect(
    refused(w.call(LEAD, "update", { task: "#2", base: w.base, status: "in_progress" })),
  ).toContain('#2 "beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)');
  expect(w.row("beta").base).toBe(w.tip);
  // The stored base is not proved; the call moves it to alpha's tip: judged on that one.
  w.set("beta", { base: w.base });
  expect(said(w.call(LEAD, "update", { task: "#2", base: w.tip, status: "in_progress" }))).toBe(
    '#2 "beta" · in progress · stacked on alpha',
  );
});

test("a take by another session ends the pair: the same lead must lead both when the overlap is judged", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"], "alpha");
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  w.reserve("alpha");
  expect(
    provedStacks(
      w.db((d) => allTasks(d, w.project)),
      w.run,
      "main",
    ),
  ).toEqual([{ child: w.row("beta").id, parent: "alpha" }]);
  said(w.call(OTHER, "take", { task: "beta" }));
  // The stack and its git proof are as before; another session leads beta now, so alpha is a rival.
  expect(w.row("beta").stackedOn).toBe("alpha");
  expect(refused(w.call(OTHER, "update", { task: "#2", status: "in_progress" }))).toContain(
    '#2 "beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
  expect(
    provedStacks(
      w.db((d) => allTasks(d, w.project)),
      w.run,
      "main",
    ),
  ).toEqual([]);
});

test("a child that takes the parent it was handed keeps the pair: the reservation still names the lead", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"], "alpha");
  w.set("beta", { branch: w.built("beta"), base: w.tip });
  const handout = w.reserve("alpha").lead?.handoutId ?? "";
  said(w.call(CHILD, "take", { task: "alpha", from: handout }));
  expect(w.db((d) => taskById(d, w.row("alpha").id)).createdBy).toBe("child");
  expect(said(w.call(LEAD, "update", { task: "#2", status: "in_progress" }))).toBe(
    '#2 "beta" · in progress · stacked on alpha',
  );
});

test("a stacked plan whose recorded branch does not hold its base is judged as a rival", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"], "alpha");
  w.onBranch("beta-branch", { "beta.txt": "1\n" }, "main");
  w.set("beta", { branch: "beta-branch", base: w.tip });
  w.reserve("alpha");
  expect(refused(w.call(LEAD, "update", { task: "#2", status: "in_progress" }))).toContain(
    '#2 "beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
});

test("a parent rebased after its stacked plan started makes them rivals; one that moves on does not", () => {
  const moving = world();
  moving.lay("beta", ["src/a/x.ts"], "alpha");
  moving.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  moving.set("beta", { branch: "beta-branch", base: moving.tip });
  moving.reserve("alpha");
  moving.onBranch("alpha-branch", { "alpha.txt": "2\n" });
  expect(said(moving.call(LEAD, "update", { task: "#2", status: "in_progress" }))).toBe(
    '#2 "beta" · in progress · stacked on alpha',
  );
  const rebased = world();
  rebased.lay("beta", ["src/a/x.ts"], "alpha");
  rebased.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  rebased.set("beta", { branch: "beta-branch", base: rebased.tip });
  rebased.reserve("alpha");
  rebased.onMain({ "main.txt": "1\n" });
  rebased.rebase("alpha-branch");
  expect(refused(rebased.call(LEAD, "update", { task: "#2", status: "in_progress" }))).toContain(
    '#2 "beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
});

test("the task tools set a stack on create and update, show it, and refuse it off a plan", () => {
  const w = world();
  expect(
    said(
      w.call(LEAD, "create", {
        subject: "Beta",
        plan: "beta",
        files: ["src/a/x.ts"],
        stacked_on: "alpha",
      }),
    ),
  ).toBe('#2 "Beta" · plan beta');
  said(w.call(LEAD, "create", { subject: "Beta phase", plan: "beta", phase: "A" }));
  expect(said(w.call(LEAD, "list", { scope: "plan", plan: "beta" }))).toContain(
    "#2 [queued · plan · stacked on alpha] Beta",
  );
  expect(said(w.call(LEAD, "get", { task: "#2" }))).toContain(
    '#2 "Beta" [plan · pending · stacked on alpha]',
  );
  expect(
    refused(
      w.call(LEAD, "create", { subject: "B", plan: "beta", phase: "B", stacked_on: "alpha" }),
    ),
  ).toBe(
    "stacked_on belongs to a plan task: create the plan with plan and a subject (no phase, no parent), or set it with task_update",
  );
  expect(refused(w.call(LEAD, "update", { task: "#3", stacked_on: "alpha" }))).toBe(
    '#3 "Beta phase" is a phase: only a plan task is stacked on another plan (set stacked_on on the plan\'s own #n)',
  );
  expect(refused(w.call(LEAD, "update", { task: "#2", stacked_on: "beta" }))).toBe(
    '#2 "Beta" cannot be stacked on itself',
  );
  expect(said(w.call(LEAD, "update", { task: "#2", stacked_on: null }))).toBe(
    '#2 "Beta" · pending',
  );
  // Another session's plan is never stacked on this lead's plan through the tools either.
  said(w.call(OTHER, "create", { subject: "Theirs", plan: "theirs", files: ["src/a/y.ts"] }));
  expect(refused(w.call(OTHER, "update", { task: "#4", stacked_on: "alpha" }))).toBe(
    '#4 "Theirs" cannot be stacked on "alpha": #1 "alpha" is not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on',
  );
});

test("a stacked plan's phase starts beside its reserved parent only when its base holds the parent's work", () => {
  const w = world();
  const layPhase = (who: Who, slug: string, files: string[], stackedOn?: string) => {
    w.lay(slug, files, stackedOn, who);
    said(w.call(who, "create", { subject: `${slug} phase`, plan: slug, phase: "A" }));
    const phase = w.db((d) =>
      allTasks(d, w.project).find((t) => t.plan === slug && t.kind === "phase"),
    );
    said(w.call(who, "create", { subject: `${slug} step`, parent: `#${phase?.number}` }));
    return `#${phase?.number}`;
  };
  const beta = layPhase(LEAD, "beta", ["src/a/x.ts"], "alpha");
  const gamma = layPhase(THIRD, "gamma", ["src/a/y.ts"]);
  w.reserve("alpha");
  // Beta records the default branch as its start: its stack is not proved, so alpha is a rival.
  w.set("beta", { branch: w.built("beta"), base: w.base });
  expect(refused(w.call(LEAD, "update", { task: beta, status: "in_progress" }))).toContain(
    '"beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
  // Built on alpha's branch, it starts beside alpha in parallel.
  w.set("beta", { base: w.tip });
  expect(said(w.call(LEAD, "update", { task: beta, status: "in_progress" }))).toBe(
    `${beta} "beta phase" · in progress`,
  );
  expect(refused(w.call(THIRD, "update", { task: gamma, status: "in_progress" }))).toContain(
    '"gamma" cannot start, since it overlaps #1 "alpha": src/a/y.ts (src/a/)',
  );
});
