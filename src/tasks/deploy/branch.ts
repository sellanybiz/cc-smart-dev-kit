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
import { type GitFacts, underTasks } from "./release";

export function taskGit(repo: string, args: string[], env: Env = process.env): string {
  const result = runGit(repo, args, env, RESOLVE_GIT_TIMEOUT_MS, {
    GIT_TERMINAL_PROMPT: "0",
  });
  if (!result.ok) throw new Error(`git ${args[0]} failed: ${result.err}`);
  return result.out;
}
/** The commit `ref` names, or a throw when git does not know it: the one way a ref becomes a commit here. */
export function refCommit(repo: string, ref: string, env: Env = process.env): string {
  return taskGit(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], env);
}
/**
 * The words for a ref git does not know: the fetch advice, then what to name instead. The release
 * gates and the listings (`resolveListBase`) both say it, so there is one text.
 */
export function unreadableRefMessage(ref: string, cause: unknown, instead: string): string {
  return `Cannot read ${ref} (${cause instanceof Error ? cause.message : String(cause)}): run \`git fetch origin\`, or ${instead}`;
}
/** True when git knows `ref` as a commit. Any git answer other than success counts as unknown. */
function knowsRef(repo: string, ref: string, env: Env): boolean {
  return runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
    env,
    RESOLVE_GIT_TIMEOUT_MS,
  ).ok;
}
/**
 * The ref a listing reads as the base, so it sees what the release gates see (`origin/<base>`).
 * What the name is decides:
 * - A name git knows that is not a local branch (a commit id, a tag, `HEAD`, `origin/main`, any
 *   remote-tracking ref) is read as written.
 * - A local branch, or a name git does not know, reads `origin/<base>` when origin has it, even
 *   when the name holds a slash (`release/1.0`): the local copy may be behind.
 * - A local branch that origin lacks (or any local branch with no `origin` remote) is read as
 *   written, and `note` says so. A name that resolves nowhere throws.
 */
export function resolveListBase(
  repo: string,
  base: string,
  env: Env = process.env,
): { ref: string; note: string | null } {
  const isLocalBranch = refExists(repo, `refs/heads/${base}`, env);
  if (!isLocalBranch && knowsRef(repo, base, env)) return { ref: base, note: null };
  const remotes = taskGit(repo, ["remote"], env).split("\n");
  if (!remotes.includes("origin")) {
    if (isLocalBranch)
      return { ref: base, note: `No origin remote: read against the local branch ${base}.` };
    throw new Error(
      `Cannot read ${base}: git does not know it. Pass a ref git knows (a branch, a tag or a commit id).`,
    );
  }
  if (knowsRef(repo, `refs/remotes/origin/${base}`, env))
    return { ref: `origin/${base}`, note: null };
  if (isLocalBranch)
    return { ref: base, note: `origin has no ${base}: read against the local branch ${base}.` };
  const named = base.startsWith("origin/") ? base : `origin/${base}`;
  try {
    refCommit(repo, named, env);
  } catch (error) {
    throw new Error(
      unreadableRefMessage(
        named,
        error,
        "pass a ref git knows (a commit id, or origin/<base> after a fetch)",
      ),
    );
  }
  return { ref: named, note: null };
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
  const commit = refCommit(repo, ref);
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
  const baseCommit = refCommit(checkoutRoot, base);
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
  /** Open tasks the base does not have yet. */
  tasks: { branch: string; task: DeployTask }[];
  /** Tasks closed (done or dropped) on a branch that are still open on the base: a close not merged. */
  closed: { branch: string; task: DeployTask }[];
  /** A file that does not parse on one branch: listed with its branch, and the others still read. */
  broken: (BranchBroken & { branch: string })[];
}
/**
 * What local branches not merged into `base` (a deploy run in progress) hold, by branch: open
 * tasks the base lacks, and closes of tasks the base still has open (`closed`). The second is why
 * a gate can still see an open task whose close was already pushed on a deploy branch.
 */
export function unmergedBranchTasks(repo: string, dir: string, base: string): UnmergedBranchTasks {
  const baseCommit = refCommit(repo, base);
  const onBase = tasksOn(repo, dir, baseCommit).tasks;
  const existing = new Set(onBase.map((task) => task.id));
  const openOnBase = new Set(onBase.filter((task) => task.status === "open").map((t) => t.id));
  const branches = taskGit(repo, [
    "for-each-ref",
    "--format=%(refname:short)",
    `--no-merged=${baseCommit}`,
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean);
  const result: UnmergedBranchTasks = { tasks: [], closed: [], broken: [] };
  for (const branch of branches) {
    const read = tasksOn(repo, dir, branch);
    for (const task of read.tasks) {
      if (task.status === "open" && !existing.has(task.id)) result.tasks.push({ branch, task });
      if (task.status !== "open" && openOnBase.has(task.id)) result.closed.push({ branch, task });
    }
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

/** True when the full ref name `name` exists. Exit 1 is "no"; any other failure throws. */
function refExists(repo: string, name: string, env: Env): boolean {
  const result = runGit(
    repo,
    ["show-ref", "--verify", "--quiet", name],
    env,
    RESOLVE_GIT_TIMEOUT_MS,
  );
  if (result.ok) return true;
  if (result.code === 1) return false;
  throw new Error(`git show-ref failed: ${result.err}`);
}

/**
 * Where git looks for a short name, in its own order (gitrevisions: the first match wins).
 * `$GIT_DIR/<name>` (HEAD, FETCH_HEAD) comes first in git's list and is left out: no branch lives there.
 */
function refCandidates(ref: string): string[] {
  return [
    `refs/${ref}`,
    `refs/tags/${ref}`,
    `refs/heads/${ref}`,
    `refs/remotes/${ref}`,
    `refs/remotes/${ref}/HEAD`,
  ];
}

/**
 * The branch `ref` names, read by git (`rev-parse --symbolic-full-name`): `refs/heads/<x>` gives
 * `<x>`, and `refs/remotes/<remote>/<x>` gives `<x>` for the longest remote name that fits (a
 * remote may be named `my/fork`). A commit, a tag, or HEAD (the current branch, not a ship branch)
 * give null. A failed read throws, as every read in `readGitFacts` does: a null would let a run on
 * the ref's own branch through. So does a short name that matches more than one ref (a stray local
 * branch `origin/main` beside origin's, a tag beside a branch): git ships the first match, which
 * may not be the one meant, so the gate stops and names them all.
 *
 * No `--end-of-options` here: with `--symbolic-full-name`, git prints that word back as a line of
 * output. A ref name never starts with `-` (git check-ref-format), so such text is refused before
 * git sees it, and nothing can read it as an option.
 */
function refBranchOf(repo: string, ref: string, env: Env): string | null {
  if (ref === "HEAD" || ref === "@" || ref.startsWith("-")) return null;
  // Counted for every short name, never only when git prints nothing: with
  // `core.warnAmbiguousRefs` off, git takes the first match and says nothing.
  if (!ref.startsWith("refs/")) {
    const found = refCandidates(ref).filter((name) => refExists(repo, name, env));
    if (found.length > 1)
      throw new Error(
        `${ref} names more than one ref (${found.join(", ")}): name the one that ships in full with --ref, or delete the one that should not be there`,
      );
  }
  const named = taskGit(repo, ["rev-parse", "--symbolic-full-name", ref], env);
  if (named === "") return null;
  if (named.startsWith("refs/heads/")) return named.slice("refs/heads/".length);
  if (!named.startsWith("refs/remotes/")) return null;
  // `git remote add` refuses a name inside another (`my` beside `my/fork`), but a config edit
  // does not: the longest name that fits is the remote.
  const remote = taskGit(repo, ["remote"], env)
    .split("\n")
    .filter((name) => name !== "" && named.startsWith(`refs/remotes/${name}/`))
    .sort((a, b) => b.length - a.length)[0];
  return remote === undefined ? null : named.slice(`refs/remotes/${remote}/`.length);
}

/**
 * The git facts the release gate judges by, read from `repo` (the checkout the run is in). A ref
 * git does not know throws: the caller turns it into exit 1. `env` is the git environment, so a
 * test can run with a clean one. `options.outside` also reads the uncommitted changes outside the
 * tasks folder (`uncommittedOutside`); without it that list is empty and git reads only the folder.
 */
export function readGitFacts(
  repo: string,
  dir: string,
  ref: string,
  env: Env = process.env,
  options: { outside?: boolean } = {},
): GitFacts {
  const tasksPath = taskRepoPath(repo, dir);
  const refSha = refCommit(repo, ref, env);
  const headCommit = taskGit(repo, ["rev-parse", "--verify", "HEAD"], env);
  const pathsOf = (args: string[]) => taskGit(repo, args, env).split("\0").filter(Boolean);
  const changedPaths =
    refSha === headCommit
      ? []
      : pathsOf(["diff", "--name-only", "--no-renames", "-z", refSha, headCommit]);
  // Staged, unstaged and untracked changes: under the tasks folder, a close not yet committed;
  // anywhere else (read only when `outside`: the before gate), code the gate did not judge.
  const scope = options.outside || !tasksPath ? [] : ["--", tasksPath];
  const dirty = [
    ...new Set([
      ...pathsOf(["diff", "--name-only", "--no-renames", "-z", "HEAD", ...scope]),
      ...pathsOf(["ls-files", "--others", "--exclude-standard", "-z", ...scope]),
    ]),
  ].sort();
  const uncommitted = dirty.filter((path) => underTasks(path, tasksPath));
  const uncommittedOutside = dirty.filter((path) => !underTasks(path, tasksPath));
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
    refBranch: refBranchOf(repo, ref, env),
    refCommit: refSha,
    headCommit,
    refIsAncestor: isAncestor(repo, refSha, headCommit, env),
    changedPaths,
    tasksPath,
    uncommitted,
    uncommittedOutside,
    push: {
      branch,
      remote: remoteKnown && branch !== null ? `origin/${branch}` : null,
      ahead,
    },
  };
}
