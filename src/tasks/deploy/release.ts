/**
 * The release gates (`task release <env> --before|--after`, `docs/design/tasks.md`).
 * `gateBefore` and `gateAfter` read the tasks folder themselves (every task, closed ones too), so
 * no caller can hand them a partial scan; the git facts come from `branch.ts` (`readGitFacts`).
 * `judgeBefore` and `judgeAfter` are the same rules as pure functions over a scan and the facts,
 * so every refusal is tested with plain data.
 */
import { scanDeployTasks, type TaskScan } from "./files";
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
  /** Whether the ref's commit is HEAD or one of HEAD's ancestors: HEAD has taken in everything the ref has. */
  refIsAncestor: boolean;
  /** Repo-relative paths (`/` separators) that differ between the ref's commit and HEAD. */
  changedPaths: readonly string[];
  /** The tasks folder, repo-relative with `/` separators. */
  tasksPath: string;
  /** Repo-relative paths with uncommitted changes under the tasks folder (staged, unstaged, new). */
  uncommitted: readonly string[];
  push: {
    /** The current branch, or null on a detached HEAD. */
    branch: string | null;
    /**
     * Origin's own copy of that branch (`origin/<branch>`), or null when it was never pushed. Not
     * the branch's upstream: a branch cut from `origin/main` tracks main until it is pushed with `-u`.
     */
    remote: string | null;
    /** Commits on HEAD that copy does not have. */
    ahead: number;
  };
}

export interface GateInput {
  /** The tasks folder (`tasks.dir`): the gate scans it, closed tasks included. */
  dir: string;
  facts: GitFacts;
  /** The project's `tasks.envs`. */
  envs: readonly DeployEnv[];
  /** The time for the deploy branch name in a refusal's fix. */
  now: Date;
}

/** What the pure rules judge: the same input, with the scan already made. */
export interface JudgeInput extends Omit<GateInput, "dir"> {
  scan: TaskScan;
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

/** How to start the run again on the right commit: the fix every "wrong HEAD" refusal ends with. */
function startAgain(env: DeployEnv, facts: GitFacts, now: Date): string {
  const branch = deployBranchName(env, now);
  // --no-track: a branch cut from origin/main would otherwise track main, and a plain `git push`
  // could send the closes there instead of to the deploy branch.
  return (
    `Start the run on a deploy branch cut from the commit that ships: \`git fetch origin\`, then \`git switch --no-track -c ${branch} ${facts.ref}\` ` +
    `(in a project that uses a worktree per session: \`git worktree add --no-track -b ${branch} <folder> ${facts.ref}\`)`
  );
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
 * - HEAD is not the ref's commit, unless HEAD holds every commit of the ref and differs from it
 *   only in the tasks folder (closes already made on the deploy branch are fine). A ref that has
 *   commits HEAD lacks may hold tasks this checkout cannot see, even when those commits changed
 *   task files only;
 * - a blocking `before` task of the environment is open;
 * - any task file is broken or its id is claimed twice;
 * - for prod, a task whose staging twin is still open.
 * An open non-blocking `before` task is a note: do it now, or drop it with a reason.
 */
export function gateBefore(env: DeployEnv, input: GateInput): GateResult {
  const { dir, ...rest } = input;
  return judgeBefore(env, { ...rest, scan: scanDeployTasks(dir, { archive: true }) });
}

/** `gateBefore`'s rules over a scan that holds every task, open and closed. */
export function judgeBefore(env: DeployEnv, input: JudgeInput): GateResult {
  const { scan, facts, envs, now } = input;
  const refusals = [...envRefusal(env, envs)];
  const foreign = facts.changedPaths.filter((path) => !underTasks(path, facts.tasksPath));
  if (facts.headCommit !== facts.refCommit) {
    if (!facts.refIsAncestor)
      refusals.push(
        `HEAD ${facts.headCommit.slice(0, 12)} does not contain ${facts.ref} (${facts.refCommit.slice(0, 12)}): the ref has commits this branch has not taken in, and may hold tasks it cannot see. ` +
          `Run \`git fetch origin\`, then rebase or merge the deploy branch onto ${facts.ref}. ${startAgain(env, facts, now)}`,
      );
    else if (foreign.length > 0)
      refusals.push(
        `HEAD ${facts.headCommit.slice(0, 12)} is not ${facts.ref} (${facts.refCommit.slice(0, 12)}): it differs in ${foreign.length} path(s) outside ${facts.tasksPath || "the tasks folder"}. ${startAgain(env, facts, now)}`,
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
 * - the branch is not pushed: detached, never pushed to origin, or commits origin's copy lacks;
 * - any task file is broken or its id is claimed twice.
 */
export function gateAfter(env: DeployEnv, input: GateInput): GateResult {
  const { dir, ...rest } = input;
  return judgeAfter(env, { ...rest, scan: scanDeployTasks(dir, { archive: true }) });
}

/** `gateAfter`'s rules over a scan that holds every task, open and closed. */
export function judgeAfter(env: DeployEnv, input: JudgeInput): GateResult {
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
  const { branch, remote, ahead } = facts.push;
  if (branch === null)
    refusals.push("HEAD is detached: the closes need a branch to be pushed from");
  else if (remote === null)
    refusals.push(`Branch ${branch} is not pushed: run \`git push -u origin ${branch}\``);
  else if (ahead > 0)
    refusals.push(
      `Branch ${branch} is ${ahead} commit(s) ahead of ${remote}: run \`git push origin ${branch}\``,
    );
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
