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
import { git, tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { createTaskOps, type TaskAnswer } from "./ops";
import { judgeStacks, provedStacks, type StackGit, stackHolds } from "./stack-proof";
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

/** Commits `files` on the checked-out branch and returns the new commit. */
function commit(repo: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `change ${Object.keys(files).join(" ")}`);
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
  const onMain = (files: Record<string, string>) => {
    git(repo, "checkout", "-q", "main");
    const made = commit(repo, files);
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

test("the proof: a start that shares the parent's own work, past origin/<default>, on the child's own branch", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch" });
  const beta = plan("beta", { stackedOn: "alpha" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  const holds = (start: string | null, child: WorkTask = beta, parent: WorkTask = alpha) =>
    stackHolds(g.run, D, parent, child, start);
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
  expect(stackHolds(g.run, null, alpha, beta, g.tip)).toEqual({
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
  // The parent's recorded base decides nothing any more: a wrong one changes no verdict.
  expect(holds(g.tip, beta, { ...alpha, base: g.tip })).toEqual({ proved: true });
});

test("an empty parent proves nothing: its branch holds no commit past origin/<default>", () => {
  const g = stackRepo();
  const { plan } = store();
  git(g.repo, "branch", "empty-branch", "main");
  const empty = plan("alpha", { branch: "empty-branch" });
  const beta = plan("beta", { stackedOn: "alpha" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  expect(stackHolds(g.run, D, empty, beta, g.base)).toEqual({
    proved: false,
    gap: "parent-empty",
  });
  // A parent whose work merged into the default branch has none of its own left either.
  const alpha = plan("gamma", { branch: "alpha-branch" });
  git(g.repo, "merge", "-q", "--no-edit", "alpha-branch");
  git(g.repo, "push", "-q", "origin", "main");
  const merged = git(g.repo, "rev-parse", "origin/main").trim();
  expect(stackHolds(g.run, merged, alpha, beta, g.tip)).toEqual({
    proved: false,
    gap: "parent-empty",
  });
});

test("a start the stacked plan only wrote down proves nothing: its own branch must hold it", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch" });
  const D = git(g.repo, "rev-parse", "origin/main").trim();
  // Its branch was made on the default branch, and its base names alpha's tip all the same.
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, "main");
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  expect(stackHolds(g.run, D, alpha, beta, beta.base)).toEqual({
    proved: false,
    gap: "start-off-branch",
  });
  // A branch git does not know holds nothing.
  expect(stackHolds(g.run, D, alpha, { ...beta, branch: "gone-branch" }, g.tip)).toEqual({
    proved: false,
    gap: "start-off-branch",
  });
  // Rebuilt on alpha's branch, the same start is proved.
  git(g.repo, "branch", "-f", "beta-branch", "alpha-branch");
  g.onBranch("beta-branch", { "beta.txt": "1\n" });
  expect(stackHolds(g.run, D, alpha, beta, beta.base)).toEqual({ proved: true });
});

test("a parent that moves on after the stacked plan started stays proved; one rebased since is a rival", () => {
  const g = stackRepo();
  const { plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch" });
  g.onBranch("beta-branch", { "beta.txt": "1\n" }, "alpha-branch");
  const beta = plan("beta", { stackedOn: "alpha", branch: "beta-branch", base: g.tip });
  const D = () => git(g.repo, "rev-parse", "origin/main").trim();
  // Alpha keeps building after beta started: the fork point is still alpha's own commit.
  g.onBranch("alpha-branch", { "alpha.txt": "2\n" });
  expect(stackHolds(g.run, D(), alpha, beta, beta.base)).toEqual({ proved: true });
  // The default branch moves on, and alpha is rebased onto it: the fork point is on main now.
  g.onMain({ "main.txt": "1\n" });
  g.rebase("alpha-branch");
  expect(stackHolds(g.run, D(), alpha, beta, beta.base)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("PROBE 2: a parent rebased onto a later main never proves a start on main, before or after", () => {
  const g = stackRepo();
  const { plan } = store();
  // The parent records its old base: it decides nothing.
  const alpha = plan("alpha", { branch: "alpha-branch", base: g.base });
  const beta = plan("beta", { stackedOn: "alpha" });
  const m1 = g.onMain({ "m.txt": "1\n" }); // beta starts here, on main, without alpha's work
  g.onMain({ "m.txt": "2\n" });
  const D = () => git(g.repo, "rev-parse", "origin/main").trim();
  expect(stackHolds(g.run, D(), alpha, beta, m1).proved).toBe(false);
  g.rebase("alpha-branch");
  expect(stackHolds(g.run, D(), alpha, beta, m1)).toEqual({
    proved: false,
    gap: "start-lacks-parent",
  });
});

test("judgeStacks proves pairs, never a plan alone, and runs no git for a pair with two leads", () => {
  const g = stackRepo();
  const { db, plan } = store();
  const alpha = plan("alpha", { branch: "alpha-branch" });
  const onTip = plan("on-tip", { stackedOn: "alpha", base: g.tip });
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
 * `alpha` laid with its branch recorded: the parent of every stack below.
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
  lay("alpha", ["src/a/"]);
  set("alpha", { branch: "alpha-branch" });
  return { ...g, project, call, lay, set, row, reserve, db };
}

test("PROBE 1: a stack moved to another parent in one update carries no proof: the new parent is a rival", () => {
  const w = world();
  w.lay("beta", ["src/b/"], "alpha");
  w.lay("gamma", ["src/c/"]);
  w.set("beta", { base: w.tip });
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
  w.set("beta", { base: w.tip });
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

test("a stack set in the same call as the start is proved on that stack", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"]);
  w.set("beta", { base: w.tip });
  w.reserve("alpha");
  expect(
    said(w.call(LEAD, "update", { task: "#2", stacked_on: "alpha", status: "in_progress" })),
  ).toBe('#2 "beta" · in progress · stacked on alpha');
});

test("a base set in the same call as the start is judged, not the base it replaces", () => {
  const w = world();
  w.lay("beta", ["src/a/x.ts"], "alpha");
  w.set("beta", { base: w.tip });
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
  w.set("beta", { base: w.tip });
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
  w.set("beta", { base: w.tip });
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
  w.set("beta", { base: w.base });
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
