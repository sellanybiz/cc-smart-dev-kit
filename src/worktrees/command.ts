/**
 * `cc-smart-dev-kit worktrees` — every worktree of the repo: who works in it, what is left on
 * it, and which are finished.
 *
 * WHY THIS EXISTS
 *   Each session works in a worktree of its own and is meant to remove it once its work is
 *   merged. Sessions forget, crash, or end first, so finished worktrees pile up beside the
 *   repo with nobody left to remove them.
 *
 * WHAT IT DOES
 *   cc-smart-dev-kit worktrees                  lists them, after fetching origin/<base>.
 *   cc-smart-dev-kit worktrees --clean          also removes every FINISHED one, with its
 *                                               branch.
 *   cc-smart-dev-kit worktrees --remove <path>  removes that one now — for the session that
 *                                               has just finished in it, so without the
 *                                               one-hour wait.
 *   --no-fetch                                  judges against origin/<base> as it is.
 *
 *   Finished = no running Claude session, no program (a dev server included) and no Docker
 *   container uses it, every commit on origin/<base>, git has left it alone for an hour,
 *   nothing uncommitted and no local files (`verdict.ts`). Every other worktree is listed
 *   with the reason it stays.
 *
 *   `--clean` and `--remove` run only in the main checkout: a session working in a worktree
 *   leaves it (ExitWorktree) before it removes one.
 *
 * THE BASE BRANCH, AND WHERE IT COMES FROM
 *   The project's `.claude/cc-smart-dev-kit.json` `worktrees.base`. Without that file (or
 *   without the field), the remote's default branch (`origin/HEAD`), else `main` — with one
 *   line saying which was used.
 */
import type { Server } from "node:net";
import { basename, resolve } from "node:path";
import type { CliPaths } from "../cli/paths";
import { runGit, samePath } from "../hooks/git";
import type { Env } from "../hooks/run";
import { holdPort } from "../machine/hold-port";
import { LOCK_PORTS } from "../ports";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import {
  deleteMergedBranch,
  fetchBase,
  pruneWorktrees,
  removeWorktree,
  type ScannedWorktree,
  scanWorktrees,
} from "./scan";

/** The default base when nothing else says: the remote's default branch, else this. */
export const DEFAULT_BASE = "main";

export interface WorktreesOptions {
  /** `--clean`: remove every finished worktree, with its branch. */
  clean: boolean;
  /** `--remove <path>`: remove that one now, without the one-hour wait. */
  remove: null | string;
  /** `--no-fetch`: judge against `origin/<base>` as it is. */
  noFetch: boolean;
}

/** The base branch this project works against, and where that came from. */
export function baseBranch(
  checkout: Checkout | null,
  env: Env,
  repo: string,
): { base: string; from: "config" | "origin" | "default" } {
  if (checkout !== null) {
    const config = loadProjectConfig(checkout).config;
    const base = config?.worktrees?.base;
    if (base !== undefined) return { base, from: "config" };
  }
  const head = runGit(repo, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env);
  const name = head.ok ? head.out.replace(/^origin\//, "") : "";
  return name === "" ? { base: DEFAULT_BASE, from: "default" } : { base: name, from: "origin" };
}

function describe(worktree: ScannedWorktree): string {
  const { state } = worktree;
  if (state === "main") return "the main checkout";
  if (state === "gone") return "GONE — its folder no longer exists";
  return state.finished ? "FINISHED" : `kept: ${state.why}`;
}

function show(scanned: ScannedWorktree[]): void {
  for (const worktree of scanned) {
    const { branch, head, path } = worktree.listed;
    const name = basename(path).padEnd(30);
    const on = (branch ?? `detached at ${head.slice(0, 9)}`).padEnd(42);
    console.log(`  ${name} ${on} ${describe(worktree)}`);
  }
  console.log();
}

function canGo(worktree: ScannedWorktree): boolean {
  return (
    worktree.state === "gone" || (typeof worktree.state === "object" && worktree.state.finished)
  );
}

/**
 * Said when a worktree whose folder is gone is forgotten. `git worktree prune` cannot tell a
 * folder that was deleted from one on a disk that is not connected — and a LOCKED worktree is
 * never pruned, so the line says how to be sure next time.
 */
export function forgottenLine(path: string): string {
  return (
    `forgot ${path} (its folder was already gone). A worktree on a disk that is not connected reads ` +
    `the same way: lock one there (\`git worktree lock "${path}"\`) and prune leaves it alone.`
  );
}

/** The lock, or null when another run holds it. */
async function holdCleanLock(): Promise<null | Server> {
  const hold = await holdPort(LOCK_PORTS.worktreesClean);
  return "held" in hold ? hold.held : null;
}

export async function runWorktrees(
  paths: CliPaths,
  options: WorktreesOptions,
  env: Env,
  cwd: string = process.cwd(),
): Promise<number> {
  const checkout = locateCheckout(cwd, { env });
  const repo = checkout?.mainCheckout ?? resolve(cwd);
  const { base, from } = baseBranch(checkout, env, repo);
  if (from !== "config") {
    console.log(
      `No \`worktrees.base\` in .claude/cc-smart-dev-kit.json: judging against ${base}.\n`,
    );
  }

  if (options.remove !== null && options.remove === "") {
    console.error("Say which worktree: cc-smart-dev-kit worktrees --remove <path>");
    return 1;
  }

  let lock: null | Server = null;
  if (options.clean || options.remove !== null) {
    if (!samePath(cwd, repo)) {
      console.error(
        `Run this in the main checkout, ${repo}. A session working in a worktree leaves it first (ExitWorktree, action "keep").`,
      );
      return 1;
    }
    lock = await holdCleanLock();
    if (lock === null) {
      console.log(
        "Another `cc-smart-dev-kit worktrees` is removing worktrees right now. Nothing done.",
      );
      return 0;
    }
  }

  try {
    if (!options.noFetch && !fetchBase(repo, base, env)) {
      console.log(`Could not fetch origin/${base}; judging against the copy of it here.\n`);
    }

    if (options.remove !== null) {
      const target = resolve(options.remove);
      const scanned = scanWorktrees(repo, {
        base,
        claudeConfigDir: paths.claudeConfigDir,
        env,
        idleLimit: 0,
      });
      const found = scanned.find(
        (worktree) => worktree.state !== "main" && samePath(worktree.listed.path, target),
      );
      if (found === undefined) {
        console.error(
          `${target} is not a worktree of this repo. \`cc-smart-dev-kit worktrees\` lists them.`,
        );
        return 1;
      }
      if (found.state === "gone") {
        pruneWorktrees(repo, env);
        console.log(forgottenLine(found.listed.path));
        if (found.listed.branch !== null) {
          console.log(deleteMergedBranch(repo, base, found.listed.branch, env));
        }
        return 0;
      }
      if (typeof found.state === "object" && found.state.finished) {
        console.log(`removing ${found.listed.path} …`);
        const removal = removeWorktree(repo, found.listed, env, base);
        for (const said of removal.said) console.log(said);
        // Exit 1 unless it really went: "held" (something uses it), "kept" (something in it
        // is changed) and "failed" (git could not finish) all leave it a worktree still.
        return removal.status === "removed" ? 0 : 1;
      }
      console.log(`Kept ${found.listed.path}: ${describe(found).replace(/^kept: /, "")}.`);
      return 1;
    }

    const scanned = scanWorktrees(repo, { base, claudeConfigDir: paths.claudeConfigDir, env });
    console.log(`Worktrees of ${repo}\n`);
    show(scanned);

    const going = scanned.filter(canGo);
    if (!options.clean) {
      console.log(
        going.length === 0
          ? "Nothing finished to clear."
          : `${String(going.length)} can go. \`cc-smart-dev-kit worktrees --clean\` in the main checkout removes them.`,
      );
      return 0;
    }

    for (const worktree of going) {
      if (worktree.state === "gone") continue;
      console.log(`removing ${worktree.listed.path} …`);
      for (const said of removeWorktree(repo, worktree.listed, env, base).said) {
        console.log(`  ${said}`);
      }
    }
    pruneWorktrees(repo, env);
    for (const worktree of going) {
      if (worktree.state !== "gone") continue;
      console.log(forgottenLine(worktree.listed.path));
      if (worktree.listed.branch !== null) {
        console.log(`  ${deleteMergedBranch(repo, base, worktree.listed.branch, env)}`);
      }
    }
    if (going.length === 0) console.log("Nothing finished to clear.");
    return 0;
  } finally {
    lock?.close();
  }
}
