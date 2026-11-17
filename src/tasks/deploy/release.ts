/**
 * The release gates (`task release <env> --before|--after`, `docs/design/tasks.md`): pure
 * functions over the scanned tasks and the git facts they are given. Reading the tasks is
 * `files.ts`, reading git is `branch.ts`; nothing here touches either, so every refusal is tested
 * with plain data.
 */
import type { TaskScan } from "./files";
import {
  DEPLOY_ENVS,
  DEPLOY_STEPS,
  DEPLOY_TYPES,
  type DeployEnv,
  type DeployStep,
  type DeployTask,
  type DeployType,
} from "./format";

/** What git said about the checkout a deploy run is in. */
export interface GitFacts {
  /** The ref the run was told to ship (default `origin/<worktrees.base>`), as written. */
  ref: string;
  refCommit: string;
  headCommit: string;
  /** Repo-relative paths (`/` separators) that differ between the ref's commit and HEAD. */
  changedPaths: readonly string[];
  /** The tasks folder, repo-relative with `/` separators. */
  tasksPath: string;
  /** Repo-relative paths with uncommitted changes under the tasks folder (staged, unstaged, new). */
  uncommitted: readonly string[];
  push: {
    /** The current branch, or null on a detached HEAD. */
    branch: string | null;
    /** Its upstream, or null when it has none. */
    upstream: string | null;
    /** Commits on HEAD the upstream does not have. */
    ahead: number;
  };
}

export interface GateInput {
  scan: TaskScan;
  facts: GitFacts;
  /** The project's `tasks.envs`. */
  envs: readonly DeployEnv[];
  /** The time for the deploy branch name in a refusal's fix. */
  now: Date;
}

export interface GateResult {
  ok: boolean;
  /** Why the run may not go on; each line is a full sentence with its fix. */
  refusals: string[];
  /** What the run may go on with, but should know: open non-blocking tasks, listed. */
  notes: string[];
}

const open = (task: DeployTask) => task.status === "open";
const describe = (task: DeployTask) => `${task.id} "${task.title}"`;

function underTasks(path: string, tasksPath: string): boolean {
  return tasksPath === "" || path.startsWith(`${tasksPath}/`);
}

/** `deploy/<env>-<YYYYMMDD-HHMM>`, the branch a deploy run starts on. */
function deployBranchName(env: DeployEnv, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `deploy/${env}-${stamp}`;
}

function brokenRefusals(scan: TaskScan): string[] {
  return [
    ...scan.broken.map(
      (item) => `${item.file} cannot be read (${item.why}): fix or delete it, then run again`,
    ),
    ...scan.duplicates.map(
      (item) =>
        `Task id ${item.id} is claimed by ${item.files.join(" and ")}: rename the id inside one of them`,
    ),
  ];
}

function envRefusal(env: DeployEnv, envs: readonly DeployEnv[]): string[] {
  return envs.includes(env)
    ? []
    : [`${env} is not one of this project's environments (tasks.envs: ${envs.join(", ")})`];
}

/**
 * The gate before a deploy. It refuses when:
 * - the environment is not in `tasks.envs`;
 * - HEAD is not the ref's commit and differs from it in anything but the tasks folder (closes
 *   already made on the deploy branch are fine);
 * - a blocking `before` task of the environment is open;
 * - any task file is broken or its id is claimed twice;
 * - for prod, a task whose staging twin is still open.
 * An open non-blocking `before` task is a note: do it now, or drop it with a reason.
 */
export function gateBefore(env: DeployEnv, input: GateInput): GateResult {
  const { scan, facts, envs, now } = input;
  const refusals = [...envRefusal(env, envs)];
  const foreign = facts.changedPaths.filter((path) => !underTasks(path, facts.tasksPath));
  if (facts.headCommit !== facts.refCommit && foreign.length > 0) {
    const branch = deployBranchName(env, now);
    refusals.push(
      `HEAD ${facts.headCommit.slice(0, 12)} is not ${facts.ref} (${facts.refCommit.slice(0, 12)}): it differs in ${foreign.length} path(s) outside ${facts.tasksPath || "the tasks folder"}. ` +
        `Start the run on a deploy branch cut from the commit that ships: \`git fetch origin\`, then \`git switch -c ${branch} ${facts.ref}\` ` +
        `(in a project that uses a worktree per session: \`git worktree add -b ${branch} <folder> ${facts.ref}\`)`,
    );
  }
  const mine = scan.tasks.filter((task) => task.env === env && open(task));
  for (const task of mine.filter((one) => one.deploy === "before" && one.type === "blocking"))
    refusals.push(`Blocking task is open: ${describe(task)}: do it, then close it with evidence`);
  refusals.push(...brokenRefusals(scan));
  if (env === "prod") {
    const staging = new Map(
      scan.tasks.filter((task) => task.env === "staging").map((task) => [task.id, task]),
    );
    for (const task of mine) {
      const twin = task.twin === undefined ? undefined : staging.get(task.twin);
      if (twin && open(twin))
        refusals.push(
          `${describe(task)} waits for its staging twin ${twin.id}, which is still open: finish staging first`,
        );
    }
  }
  const notes = mine
    .filter((task) => task.deploy === "before" && task.type === "non-blocking")
    .map(
      (task) => `Non-blocking, still open: ${describe(task)}: do it now, or drop it with a reason`,
    );
  return { ok: refusals.length === 0, refusals, notes };
}

/**
 * The gate after a deploy. It refuses when:
 * - the environment is not in `tasks.envs`;
 * - any task of the environment is open, before or after (nothing lingers);
 * - the tasks folder has uncommitted changes (a close not yet committed);
 * - the branch is not pushed: detached, no upstream, or commits the upstream lacks;
 * - any task file is broken or its id is claimed twice.
 */
export function gateAfter(env: DeployEnv, input: GateInput): GateResult {
  const { scan, facts, envs } = input;
  const refusals = [...envRefusal(env, envs)];
  for (const task of scan.tasks.filter((one) => one.env === env && open(one)))
    refusals.push(
      `Task is open: ${describe(task)} (${task.deploy} the deploy, ${task.type}): close it with evidence, or drop it with a reason`,
    );
  if (facts.uncommitted.length > 0)
    refusals.push(
      `${facts.uncommitted.length} uncommitted change(s) under ${facts.tasksPath || "the tasks folder"} (${facts.uncommitted.slice(0, 5).join(", ")}${facts.uncommitted.length > 5 ? ", ..." : ""}): commit the closes on the deploy branch`,
    );
  const { branch, upstream, ahead } = facts.push;
  if (branch === null)
    refusals.push("HEAD is detached: the closes need a branch to be pushed from");
  else if (upstream === null)
    refusals.push(`Branch ${branch} is not pushed: run \`git push -u origin ${branch}\``);
  else if (ahead > 0)
    refusals.push(`Branch ${branch} is ${ahead} commit(s) ahead of ${upstream}: push it`);
  refusals.push(...brokenRefusals(scan));
  return { ok: refusals.length === 0, refusals, notes: [] };
}

export interface ReleaseGroup {
  env: DeployEnv;
  deploy: DeployStep;
  type: DeployType;
  tasks: DeployTask[];
}

/**
 * The open tasks of `env` (every environment when it is left out), grouped by environment, then
 * deploy step, then type, blocking first: the listing of `task release` with no flag. An empty
 * group is left out.
 */
export function releaseList(tasks: readonly DeployTask[], env?: DeployEnv): ReleaseGroup[] {
  const groups: ReleaseGroup[] = [];
  for (const one of env === undefined ? DEPLOY_ENVS : [env])
    for (const deploy of DEPLOY_STEPS)
      for (const type of DEPLOY_TYPES) {
        const found = tasks.filter(
          (task) => open(task) && task.env === one && task.deploy === deploy && task.type === type,
        );
        if (found.length > 0) groups.push({ env: one, deploy, type, tasks: found });
      }
  return groups;
}
