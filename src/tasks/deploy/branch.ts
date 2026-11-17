/**
 * What git says about deploy tasks: the tasks on a ref, what a branch changed, which unmerged
 * branches hold open tasks, and the facts the release gate reads (`readGitFacts`). Task paths are
 * `<tasks.dir>/<env>/x.md` and `<tasks.dir>/<env>/archive/x.md`; git's paths always use `/`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit } from "../../hooks/git";
import type { Env } from "../../hooks/run";
import { gitEnv } from "../../project/git-env";
import { RESOLVE_GIT_TIMEOUT_MS } from "../../project/resolve";
import { isTaskFile } from "./files";
import { type DeployTask, folderPlace, parseDeployTask } from "./format";
import type { GitFacts } from "./release";

export function taskGit(repo: string, args: string[], env: Env = process.env): string {
  const result = runGit(repo, args, env, RESOLVE_GIT_TIMEOUT_MS, {
    GIT_TERMINAL_PROMPT: "0",
  });
  if (!result.ok) throw new Error(`git ${args[0]} failed: ${result.err}`);
  return result.out;
}
export function taskRepoPath(repo: string, dir: string): string {
  const path = relative(resolve(repo), resolve(repo, dir));
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new Error("Task folder must be inside the checkout");
  return path.split(sep).join("/");
}
/** The environment a git path belongs to, or null when it is not a deploy task file under `prefix`. */
function taskPlace(path: string, prefix: string) {
  if (prefix && !path.startsWith(`${prefix}/`)) return null;
  const segments = (prefix ? path.slice(prefix.length + 1) : path).split("/");
  const name = segments.at(-1);
  if (name === undefined || !isTaskFile(name)) return null;
  return folderPlace(segments);
}

export interface BranchBroken {
  file: string;
  why: string;
}
/** The deploy tasks on `ref`; a file that does not parse is reported, never thrown. */
export function tasksOn(
  repo: string,
  dir: string,
  ref: string,
): { tasks: DeployTask[]; broken: BranchBroken[] } {
  const prefix = taskRepoPath(repo, dir);
  const commit = taskGit(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const paths = taskGit(repo, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    commit,
    "--",
    ...(prefix ? [prefix] : []),
  ])
    .split("\0")
    .filter(Boolean);
  const tasks: DeployTask[] = [];
  const broken: BranchBroken[] = [];
  for (const file of paths) {
    const place = taskPlace(file, prefix);
    if (!place) continue;
    // runGit trims stdout. Blob contents must keep the Markdown body's exact whitespace.
    const result = Bun.spawnSync(["git", "show", `${commit}:${file}`], {
      cwd: repo,
      env: { ...gitEnv(process.env), GIT_TERMINAL_PROMPT: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: RESOLVE_GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.exitCode !== 0) throw new Error(`git show failed: ${result.stderr.toString()}`);
    const parsed = parseDeployTask(result.stdout.toString(), file, place.env);
    if (parsed.ok) tasks.push(parsed.task);
    else broken.push({ file, why: parsed.why });
  }
  return { tasks, broken };
}
export interface BranchTaskChange {
  file: string;
  change: "added" | "changed" | "closed" | "deleted";
  task?: DeployTask;
  why?: string;
}
export function branchTaskChanges(
  checkoutRoot: string,
  dir: string,
  base: string,
): BranchTaskChange[] {
  const prefix = taskRepoPath(checkoutRoot, dir);
  const baseCommit = taskGit(checkoutRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]);
  const mergeBase = taskGit(checkoutRoot, ["merge-base", baseCommit, "HEAD"]);
  // No rename detection: an archive move must expose both the old path and the closed task.
  const tokens = taskGit(checkoutRoot, [
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    mergeBase,
    "--",
    ...(prefix ? [prefix] : []),
  ]).split("\0");
  const untracked = taskGit(checkoutRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...(prefix ? [prefix] : []),
  ])
    .split("\0")
    .filter(Boolean);
  for (const file of untracked) tokens.splice(tokens.length - 1, 0, "A", file);
  const changes: BranchTaskChange[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const file = tokens[i + 1];
    const place = file ? taskPlace(file, prefix) : null;
    if (!file || !place) continue;
    const absolute = join(checkoutRoot, file);
    if (status === "D" || !existsSync(absolute)) {
      changes.push({ file, change: "deleted" });
      continue;
    }
    const parsed = parseDeployTask(readFileSync(absolute, "utf8"), absolute, place.env);
    const change = status === "A" ? "added" : "changed";
    changes.push(
      parsed.ok
        ? { file, change: parsed.task.status === "open" ? change : "closed", task: parsed.task }
        : { file, change, why: parsed.why },
    );
  }
  return changes;
}
export interface UnmergedBranchTasks {
  tasks: { branch: string; task: DeployTask }[];
  /** A file that does not parse on one branch: listed with its branch, and the others still read. */
  broken: (BranchBroken & { branch: string })[];
}
/** Open tasks on local branches not merged into `base` (a deploy run in progress), by branch. */
export function unmergedBranchTasks(repo: string, dir: string, base: string): UnmergedBranchTasks {
  const baseCommit = taskGit(repo, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]);
  const existing = new Set(tasksOn(repo, dir, baseCommit).tasks.map((task) => task.id));
  const branches = taskGit(repo, [
    "for-each-ref",
    "--format=%(refname:short)",
    `--no-merged=${baseCommit}`,
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean);
  const result: UnmergedBranchTasks = { tasks: [], broken: [] };
  for (const branch of branches) {
    const read = tasksOn(repo, dir, branch);
    for (const task of read.tasks)
      if (task.status === "open" && !existing.has(task.id)) result.tasks.push({ branch, task });
    for (const item of read.broken) result.broken.push({ branch, ...item });
  }
  return result;
}

/** True when `ancestor` is `commit` or one of its ancestors. Exit 1 is "no"; any other failure throws. */
function isAncestor(repo: string, ancestor: string, commit: string, env: Env): boolean {
  const result = runGit(
    repo,
    ["merge-base", "--is-ancestor", ancestor, commit],
    env,
    RESOLVE_GIT_TIMEOUT_MS,
  );
  if (result.ok) return true;
  if (result.code === 1) return false;
  throw new Error(`git merge-base failed: ${result.err}`);
}

/**
 * The git facts the release gate judges by, read from `repo` (the checkout the run is in). A ref
 * git does not know throws: the caller turns it into exit 1. `env` is the git environment, so a
 * test can run with a clean one.
 */
export function readGitFacts(
  repo: string,
  dir: string,
  ref: string,
  env: Env = process.env,
): GitFacts {
  const tasksPath = taskRepoPath(repo, dir);
  const refCommit = taskGit(
    repo,
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    env,
  );
  const headCommit = taskGit(repo, ["rev-parse", "--verify", "HEAD"], env);
  const pathsOf = (args: string[]) => taskGit(repo, args, env).split("\0").filter(Boolean);
  const changedPaths =
    refCommit === headCommit
      ? []
      : pathsOf(["diff", "--name-only", "--no-renames", "-z", refCommit, headCommit]);
  const scope = tasksPath ? ["--", tasksPath] : [];
  // Staged, unstaged and untracked changes under the tasks folder: a close not yet committed.
  const uncommitted = [
    ...new Set([
      ...pathsOf(["diff", "--name-only", "--no-renames", "-z", "HEAD", ...scope]),
      ...pathsOf(["ls-files", "--others", "--exclude-standard", "-z", ...scope]),
    ]),
  ].sort();
  const currentBranch = runGit(repo, ["branch", "--show-current"], env, RESOLVE_GIT_TIMEOUT_MS);
  const branch = currentBranch.ok && currentBranch.out ? currentBranch.out : null;
  // Origin's own copy of the branch, not `@{upstream}`: a branch cut from origin/main tracks main
  // until it is pushed with -u, and "ahead of origin/main" would then never end.
  const remoteRef = branch === null ? null : `refs/remotes/origin/${branch}`;
  const remoteKnown =
    remoteRef !== null &&
    runGit(repo, ["rev-parse", "--verify", "--quiet", remoteRef], env, RESOLVE_GIT_TIMEOUT_MS).ok;
  const ahead =
    remoteKnown && remoteRef !== null
      ? Number(taskGit(repo, ["rev-list", "--count", `${remoteRef}..HEAD`], env))
      : 0;
  return {
    ref,
    refCommit,
    headCommit,
    refIsAncestor: isAncestor(repo, refCommit, headCommit, env),
    changedPaths,
    tasksPath,
    uncommitted,
    push: {
      branch,
      remote: remoteKnown && branch !== null ? `origin/${branch}` : null,
      ahead,
    },
  };
}
