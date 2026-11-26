/**
 * Where a folder's tasks live (D75, `docs/design/tasks.md`): the one place that turns a working
 * folder into the work store's project key, the checkout new deploy task files are written in,
 * and the project's `tasks` settings. The server, the `task` command, the hooks and `doctor`
 * all read it, so a session, its worktrees and the person's own terminal agree on one
 * project.
 *
 * - **The project key** is the main checkout's `repoKey`, so every worktree of a
 *   repo shares one list. A folder outside git is its own project, by its real path.
 * - **Deploy task files** go into the checkout the folder is in (a worktree's own root), so a
 *   task ships in that branch's commit and pull request.
 * - **A broken or too-new project file** leaves the work store usable: only the deploy tasks
 *   are unavailable, with the reason. Git that cannot answer is an error: a guessed key would
 *   split one project's tasks in two.
 */
import { realpathSync } from "node:fs";
import { VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import type { Env } from "../hooks/run";
import {
  type CcSmartDevKitConfig,
  CcSmartDevKitVersionError,
  loadCcSmartDevKitConfig,
} from "../project/config";
import {
  type Checkout,
  checkoutFailure,
  loadProjectConfig,
  locateCheckout,
  locateCheckoutAsync,
  type Project,
  projectFileFor,
  type ResolveOptions,
} from "../project/resolve";
import { findUserInstall } from "../setup/installed-plugins";
import { repoKey } from "../workflow/reviews";
import { DEFAULT_STALE_DAYS } from "./deploy/check";
import { deployTasksDir } from "./deploy/files";
import { DEPLOY_ENVS, type DeployEnv } from "./deploy/format";

export type ProjectTasks =
  | {
      ok: true;
      /** The task folder in this checkout (`tasks.dir`, default `.claude/tasks`). */
      dir: string;
      /** When an open task counts as stale (`tasks.staleDays`, default 30). */
      staleDays: number;
      /** The environments the project deploys to (`tasks.envs`, default both). */
      envs: readonly DeployEnv[];
    }
  | { ok: false; why: string };

/** The project's `.claude/cc-smart-dev-kit.json` as the checkout reads it, or why it cannot be read. */
export type ProjectConfigRead =
  | { ok: true; config: CcSmartDevKitConfig | null }
  | {
      ok: false;
      why: string;
      /**
       * The file whose `requires` this kit does not meet (`CcSmartDevKitVersionError`), which
       * another kit version can read; null for any other error.
       */
      requiresFile: string | null;
    };

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
      /** The project's file, for the settings the store reads (`plans.maxPhases`). */
      projectConfig: ProjectConfigRead;
    }
  | { ok: false; why: string };

/**
 * The work store's project key for a main checkout, so a hook that
 * already holds the checkout (`mainCheckout ?? root`) needs no second git call.
 */
export function projectKey(repo: string): string {
  return repoKey(repo);
}

/**
 * `read`: the project a hook's frame already read for this folder. The context then takes its
 * checkout and its file from it, so a hook run reads and parses the project file once.
 */
export function taskContext(cwd: string, env: Env = process.env, read?: Project): TaskContext {
  if (read !== undefined) return contextOf(read, cwd, read);
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(cwd, { env });
  } catch (error) {
    return { ok: false, why: checkoutFailure(error) };
  }
  return contextOf(checkout, cwd);
}

/**
 * `taskContext`, without blocking: the same answer, with git read through `Bun.spawn`, for the
 * portal's server, where a blocking spawn freezes every page (`.claude/rules/portal.md`).
 */
export async function taskContextAsync(cwd: string, env: Env = process.env): Promise<TaskContext> {
  let checkout: Checkout | null;
  try {
    checkout = await locateCheckoutAsync(cwd, { env });
  } catch (error) {
    return { ok: false, why: checkoutFailure(error) };
  }
  return contextOf(checkout, cwd);
}

/** The project key of a checkout already found; outside git (null), the folder's own real path. */
export function projectKeyOf(checkout: Checkout | null, cwd: string): string {
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
  return projectKeyOf(locateCheckout(cwd, options), cwd);
}

/**
 * The answer for a checkout already found (null: the folder is not in git). The project file is
 * read here unless `read` holds it.
 */
function contextOf(checkout: Checkout | null, cwd: string, read?: Project): TaskContext {
  if (checkout === null) {
    return {
      ok: true,
      project: projectKeyOf(null, cwd),
      repo: null,
      checkoutRoot: null,
      projectTasks: { ok: false, why: "not in a git checkout: deploy tasks live in a repository" },
      projectConfig: { ok: true, config: null },
    };
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  const base = {
    ok: true as const,
    project: projectKeyOf(checkout, cwd),
    repo,
    checkoutRoot: checkout.root,
  };
  let config: CcSmartDevKitConfig | null;
  try {
    config = (read ?? loadProjectConfig(checkout)).config;
  } catch (error) {
    const why = checkoutFailure(error);
    const requiresFile =
      error instanceof CcSmartDevKitVersionError ? projectFileFor(checkout) : null;
    return {
      ...base,
      projectTasks: { ok: false, why },
      projectConfig: { ok: false, why, requiresFile },
    };
  }
  const settings = config?.tasks;
  const root = checkout.root;
  return {
    ...base,
    projectConfig: { ok: true, config },
    projectTasks: {
      ok: true,
      dir: deployTasksDir(root, settings?.dir === undefined ? {} : { dir: settings.dir }),
      staleDays: settings?.staleDays ?? DEFAULT_STALE_DAYS,
      envs: settings?.envs ?? DEPLOY_ENVS,
    },
  };
}

/**
 * Why no task may be written in this project, with the fix, or null when writes go on. A project
 * file this kit cannot use stops every write up front, the same way for each task tool and for
 * herdr, so a plan is never left half written (a plan made, then its file list refused). Reads
 * still answer. Outside git there is no project file, so there is no gate.
 */
export function taskWriteRefusal(
  read: ProjectConfigRead,
  env: Env,
): { why: string; fix: string } | null {
  if (read.ok) return null;
  const why = `Task writes are refused: ${read.why}`;
  if (read.requiresFile === null) return { why, fix: "Fix that file; task reads still answer." };
  // The session runs the kit it started with: an update since then is on disk, not loaded.
  const installed = findUserInstall(cliPaths(env).installedPluginsFile)?.version ?? null;
  if (installed !== null && installed !== VERSION && meetsRequires(read.requiresFile, installed))
    return {
      why,
      fix: `The kit on disk (${installed}) already meets it: restart this session to load it.`,
    };
  return {
    why,
    fix:
      installed === null
        ? "If the kit on disk already meets it, restart this session to load it; after an update, restart it too."
        : "After an update, restart this session to load it.",
  };
}

/** True when kit `version` meets the file's `requires`: the check that runs first in the parse. */
function meetsRequires(file: string, version: string): boolean {
  try {
    loadCcSmartDevKitConfig(file, version);
    return true;
  } catch (error) {
    // A later check failing (a field this build does not know) means `requires` itself passed.
    return !(error instanceof CcSmartDevKitVersionError);
  }
}
