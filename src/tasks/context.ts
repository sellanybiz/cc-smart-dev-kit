/**
 * Where a folder's tasks live (D75, `docs/design/tasks.md`): the one place that turns a working
 * folder into the work store's project key, the checkout new project task files are written in,
 * and the project's `tasks` settings. The server, the `task` command, the hooks and `doctor`
 * all read it, so a session, its crew worktrees and the person's own terminal agree on one
 * project.
 *
 * - **The project key** is the crew store's: the main checkout's `repoKey`, so every worktree of a
 *   repo shares one list. A folder outside git is its own project, by its real path.
 * - **Project task files** go into the checkout the folder is in (a worktree's own root), so a
 *   task ships in that branch's commit and pull request.
 * - **A broken or too-new project file** leaves the work store usable: only the project tasks
 *   are unavailable, with the reason. Git that cannot answer is an error: a guessed key would
 *   split one project's tasks in two.
 */
import { realpathSync } from "node:fs";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import {
  type Checkout,
  checkoutFailure,
  loadProjectConfig,
  locateCheckout,
  locateCheckoutAsync,
  type ResolveOptions,
} from "../project/resolve";
import { repoKey } from "../workflow/reviews";
import { DEFAULT_STALE_DAYS } from "./project/check";
import { projectTasksDir } from "./project/files";

/** The branch a release ships from when neither the project nor `origin/HEAD` names one. */
export const DEFAULT_RELEASE_BRANCH = "main";

/** How long the `origin/HEAD` lookup may take. */
const RELEASE_BRANCH_GIT_TIMEOUT_MS = 5_000;

export type ProjectTasks =
  | {
      ok: true;
      /** The task folder in this checkout (`tasks.dir`, default `.claude/tasks`). */
      dir: string;
      /** When an open task counts as stale (`tasks.staleDays`, default 30). */
      staleDays: number;
      /** The old notes folders `task check` watches for new files (`tasks.legacyFolders`). */
      legacyFolders: string[];
      /** The branch a release ships from: the project's, else `origin/HEAD`, else `main`. Asks git. */
      releaseBranch: () => string;
    }
  | { ok: false; why: string };

export type TaskContext =
  | {
      ok: true;
      /** The work store's project key. */
      project: string;
      /** The main checkout, or null outside git. */
      repo: string | null;
      /** The checkout the folder is in (a linked worktree's own root), or null outside git. */
      checkoutRoot: string | null;
      projectTasks: ProjectTasks;
    }
  | { ok: false; why: string };

/**
 * The work store's project key for a main checkout: the crew store's own key, so a hook that
 * already holds the checkout (`mainCheckout ?? root`) needs no second git call.
 */
export function projectKey(repo: string): string {
  return repoKey(repo);
}

export function taskContext(cwd: string, env: Env = process.env): TaskContext {
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(cwd, { env });
  } catch (error) {
    return { ok: false, why: checkoutFailure(error) };
  }
  return contextOf(checkout, cwd, env);
}

/**
 * `taskContext`, without blocking: the same answer, with git read through `Bun.spawn`, for the
 * portal's server, where a blocking spawn freezes every page (`.claude/rules/portal.md`). Its
 * `releaseBranch()` still asks git directly: the portal never calls it.
 */
export async function taskContextAsync(cwd: string, env: Env = process.env): Promise<TaskContext> {
  let checkout: Checkout | null;
  try {
    checkout = await locateCheckoutAsync(cwd, { env });
  } catch (error) {
    return { ok: false, why: checkoutFailure(error) };
  }
  return contextOf(checkout, cwd, env);
}

/** The project key of a checkout already found; outside git (null), the folder's own real path. */
function keyOf(checkout: Checkout | null, cwd: string): string {
  return projectKey(
    checkout === null ? realpathSync(cwd) : (checkout.mainCheckout ?? checkout.root),
  );
}

/**
 * A folder's project key alone, without the project's settings: one git call, inside a hook's
 * budget when it gives one (`timeFor`). Throws as `locateCheckout` does (a folder that is not
 * there, a git that did not answer in time).
 */
export function folderProject(
  cwd: string,
  options: Pick<ResolveOptions, "env" | "timeFor"> = {},
): string {
  return keyOf(locateCheckout(cwd, options), cwd);
}

/** The answer for a checkout already found (null: the folder is not in git). */
function contextOf(checkout: Checkout | null, cwd: string, env: Env): TaskContext {
  if (checkout === null) {
    return {
      ok: true,
      project: keyOf(null, cwd),
      repo: null,
      checkoutRoot: null,
      projectTasks: { ok: false, why: "not in a git checkout: project tasks live in a repository" },
    };
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  const base = {
    ok: true as const,
    project: keyOf(checkout, cwd),
    repo,
    checkoutRoot: checkout.root,
  };
  let settings: NonNullable<ReturnType<typeof loadProjectConfig>["config"]>["tasks"];
  try {
    settings = loadProjectConfig(checkout).config?.tasks;
  } catch (error) {
    return { ...base, projectTasks: { ok: false, why: checkoutFailure(error) } };
  }
  const root = checkout.root;
  return {
    ...base,
    projectTasks: {
      ok: true,
      dir: projectTasksDir(root, settings?.dir === undefined ? {} : { dir: settings.dir }),
      staleDays: settings?.staleDays ?? DEFAULT_STALE_DAYS,
      legacyFolders: settings?.legacyFolders ?? [],
      releaseBranch: () => {
        if (settings?.releaseBranch !== undefined) return settings.releaseBranch;
        const head = runGit(
          root,
          ["rev-parse", "--abbrev-ref", "origin/HEAD"],
          env,
          RELEASE_BRANCH_GIT_TIMEOUT_MS,
        );
        const name = head.ok ? head.out.replace(/^origin\//, "") : "";
        return name === "" ? DEFAULT_RELEASE_BRANCH : name;
      },
    },
  };
}
