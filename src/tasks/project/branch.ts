import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit } from "../../hooks/git";
import { gitEnv } from "../../project/git-env";
import { RESOLVE_GIT_TIMEOUT_MS } from "../../project/resolve";
import { isTaskFile } from "./files";
import { type ProjectTask, parseProjectTask } from "./format";

export function taskGit(repo: string, args: string[]): string {
  const result = runGit(repo, args, process.env, RESOLVE_GIT_TIMEOUT_MS, {
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
function taskPath(path: string, prefix: string): boolean {
  const local = prefix ? path.slice(prefix.length + 1) : path;
  return (
    (!prefix || path.startsWith(`${prefix}/`)) &&
    ((isTaskFile(local) && !local.includes("/")) ||
      (local.startsWith("archive/") && isTaskFile(local.slice(8)) && !local.slice(8).includes("/")))
  );
}
export function tasksOn(repo: string, dir: string, ref: string): ProjectTask[] {
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
    .filter((path) => path && taskPath(path, prefix));
  return paths.map((file) => {
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
    const parsed = parseProjectTask(result.stdout.toString(), file);
    if (!parsed.ok) throw new Error(parsed.why);
    return parsed.task;
  });
}
export interface BranchTaskChange {
  file: string;
  change: "added" | "changed" | "closed" | "deleted";
  task?: ProjectTask;
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
    if (!file || !taskPath(file, prefix)) continue;
    const absolute = join(checkoutRoot, file);
    if (status === "D" || !existsSync(absolute)) {
      changes.push({ file, change: "deleted" });
      continue;
    }
    const parsed = parseProjectTask(readFileSync(absolute, "utf8"), absolute);
    const change = status === "A" ? "added" : "changed";
    changes.push(
      parsed.ok
        ? { file, change: parsed.task.status === "open" ? change : "closed", task: parsed.task }
        : { file, change, why: parsed.why },
    );
  }
  return changes;
}
export function unmergedBranchTasks(
  repo: string,
  dir: string,
  base: string,
): { branch: string; task: ProjectTask }[] {
  const baseCommit = taskGit(repo, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]);
  const existing = new Set(tasksOn(repo, dir, baseCommit).map((task) => task.id));
  const branches = taskGit(repo, [
    "for-each-ref",
    "--format=%(refname:short)",
    `--no-merged=${baseCommit}`,
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean);
  return branches.flatMap((branch) =>
    tasksOn(repo, dir, branch)
      .filter((task) => task.status === "open" && !existing.has(task.id))
      .map((task) => ({ branch, task })),
  );
}
