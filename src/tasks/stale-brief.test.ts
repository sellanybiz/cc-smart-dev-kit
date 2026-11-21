/**
 * The stale-brief warning (`staleBriefWarning`): a phase that starts with a base is told when the
 * default branch changed its plan's files after its brief was written. Real git in a temp clone
 * for the task tools; a fake git for the paths that only a broken repo reaches.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import type { GitRun } from "../hooks/git";
import { hookEnv, makeClone, makeRepo } from "../testing/hooks";
import { git } from "../testing/temp";
import { createTaskOps, type TaskAnswer } from "./ops";
import { staleBriefWarning } from "./plan-guards";
import type { Who } from "./work/types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };

function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}

/** Commits `files` on the checked-out branch, then points `origin/main` at it, as a fetch would. */
function landOnMain(repo: string, message: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  return git(repo, "rev-parse", "--short", "HEAD").trim();
}

/**
 * A plan with `files` and one phase whose brief is written at `writtenAt`, with one step under
 * it, made through the task tools: the phase's reference.
 */
function layPlan(repo: string, stateDir: string, env: Record<string, string>, writtenAt: number) {
  const ops = createTaskOps({
    stateDir,
    env,
    cwd: () => repo,
    caller: () => ({ ...LEAD, cwd: repo }),
    filesCheck: () => ({ ignore: [], caseFold: false }),
    now: () => writtenAt,
  });
  try {
    said(ops.call("create", { subject: "Alpha", plan: "alpha", files: ["src/a/", "docs/x.md"] }));
    said(
      ops.call("create", {
        subject: "Build A",
        plan: "alpha",
        phase: "A",
        description: "the brief",
      }),
    );
    said(ops.call("create", { subject: "Step", parent: "#2" }));
  } finally {
    ops.close();
  }
}

function startPhase(
  repo: string,
  stateDir: string,
  env: Record<string, string>,
  input: Record<string, unknown>,
): string {
  const ops = createTaskOps({
    stateDir,
    env,
    cwd: () => repo,
    caller: () => ({ ...LEAD, cwd: repo }),
    filesCheck: () => ({ ignore: [], caseFold: false }),
  });
  try {
    return said(ops.call("update", { task: "#2", status: "in_progress", ...input }));
  } finally {
    ops.close();
  }
}

test("a phase started with a base is warned of commits on the default branch that changed its plan's files", () => {
  const { repo } = makeClone();
  const env = hookEnv();
  const { stateDir } = cliPaths(env);
  const base = git(repo, "rev-parse", "HEAD").trim();
  // The brief is written a minute ago; three commits land after it.
  layPlan(repo, stateDir, env, Date.now() - 60_000);
  landOnMain(repo, "touch a", { "src/a/one.ts": "1\n", "docs/x.md": "x\n" });
  const newest = landOnMain(repo, "touch a again", { "src/a/two.ts": "2\n" });
  landOnMain(repo, "elsewhere", { "lib/z.ts": "z\n" });
  expect(startPhase(repo, stateDir, env, { base })).toBe(
    [
      '#2 "Build A" · in progress',
      `Warning: the brief of #2 may be stale: origin/main changed src/a/two.ts, docs/x.md, src/a/one.ts after it was written (newest: ${newest} "touch a again"). Read those changes before you build on it.`,
    ].join("\n"),
  );
});

test("no warning when the brief was written after the changes, with no base, or with no origin", () => {
  const { repo } = makeClone();
  const env = hookEnv();
  const { stateDir } = cliPaths(env);
  const base = git(repo, "rev-parse", "HEAD").trim();
  landOnMain(repo, "touch a", { "src/a/one.ts": "1\n" });
  // The brief is written a minute from now: every commit is older than it.
  layPlan(repo, stateDir, env, Date.now() + 60_000);
  expect(startPhase(repo, stateDir, env, { base })).toBe('#2 "Build A" · in progress');
  // A phase started with no base is not judged.
  const second = makeClone();
  const secondEnv = hookEnv();
  layPlan(second.repo, cliPaths(secondEnv).stateDir, secondEnv, Date.now() - 60_000);
  landOnMain(second.repo, "touch a", { "src/a/one.ts": "1\n" });
  expect(startPhase(second.repo, cliPaths(secondEnv).stateDir, secondEnv, {})).toBe(
    '#2 "Build A" · in progress',
  );
  // A repo with no origin has no default branch copy to compare with.
  const local = makeRepo();
  const localEnv = hookEnv();
  layPlan(local, cliPaths(localEnv).stateDir, localEnv, Date.now() - 60_000);
  expect(
    startPhase(local, cliPaths(localEnv).stateDir, localEnv, {
      base: git(local, "rev-parse", "HEAD").trim(),
    }),
  ).toBe('#2 "Build A" · in progress');
});

/** Each git call the fakes answered, in order. */
const RAN: string[][] = [];
/** A git that gives `answers` in order and fails the test on a call it was not given one for. */
function fakeGit(answers: GitRun[]): (args: string[]) => GitRun {
  return (args) => {
    RAN.push(args);
    const next = answers.shift();
    if (next === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
    return next;
  };
}

test("git that fails is said in the line, never a refusal; nothing to judge runs no git", () => {
  const phase = { number: 7 };
  const failing = fakeGit([
    { ok: true, out: "abc", err: "", code: 0 },
    { ok: false, out: "", err: "fatal: bad object", code: 128 },
  ]);
  expect(
    staleBriefWarning({ phase, files: ["src/"], writtenAt: 1000, base: "main", git: failing }),
  ).toBe(
    "Warning: the brief of #7 was not checked against origin/main: git could not read it (fatal: bad object)",
  );
  RAN.length = 0;
  const none = fakeGit([]);
  expect(staleBriefWarning({ phase, files: [], writtenAt: 1000, base: "main", git: none })).toBe(
    null,
  );
  expect(
    staleBriefWarning({ phase, files: ["src/"], writtenAt: null, base: "main", git: none }),
  ).toBe(null);
  expect(RAN).toEqual([]);
  // The paths go to git as literal pathspecs: a name git would read as magic is just a name.
  const seen = fakeGit([
    { ok: true, out: "abc", err: "", code: 0 },
    { ok: true, out: "", err: "", code: 0 },
  ]);
  staleBriefWarning({ phase, files: [":(glob)*"], writtenAt: 1000, base: "main", git: seen });
  expect(RAN.at(-1)?.slice(0, 3)).toEqual(["-c", "core.quotePath=false", "--literal-pathspecs"]);
  expect(RAN.at(-1)?.slice(-2)).toEqual(["--", ":(glob)*"]);
});
