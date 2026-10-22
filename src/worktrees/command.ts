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
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { canGo, cleanFinished, forgottenLine, holdCleanLock } from "./clean";
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

/**
 * Where a command's lines go: the terminal in use, a collector in the portal. One home for the
 * rule every command the portal shows follows (`.claude/rules/portal.md`).
 */
export interface WorktreesSinks {
  error: (line: string) => void;
  print: (line: string) => void;
}

const CONSOLE_SINKS: WorktreesSinks = {
  error: (line) => console.error(line),
  print: (line) => console.log(line),
};

function show(scanned: ScannedWorktree[], print: (line: string) => void): void {
  for (const worktree of scanned) {
    const { branch, head, path } = worktree.listed;
    const name = basename(path).padEnd(30);
    const on = (branch ?? `detached at ${head.slice(0, 9)}`).padEnd(42);
    print(`  ${name} ${on} ${describe(worktree)}`);
  }
  print("");
}

export async function runWorktrees(
  paths: CliPaths,
  options: WorktreesOptions,
  env: Env,
  cwd: string = process.cwd(),
  sinks: WorktreesSinks = CONSOLE_SINKS,
): Promise<number> {
  const { error, print } = sinks;
  const checkout = locateCheckout(cwd, { env });
  const repo = checkout?.mainCheckout ?? resolve(cwd);
  const { base, from } = baseBranch(checkout, env, repo);
  if (from !== "config") {
    print(`No \`worktrees.base\` in .claude/cc-smart-dev-kit.json: judging against ${base}.\n`);
  }

  if (options.remove !== null && options.remove === "") {
    error("Say which worktree: cc-smart-dev-kit worktrees --remove <path>");
    return 1;
  }

  let lock: null | Server = null;
  if (options.clean || options.remove !== null) {
    if (!samePath(cwd, repo)) {
      error(
        `Run this in the main checkout, ${repo}. A session working in a worktree leaves it first (ExitWorktree, action "keep").`,
      );
      return 1;
    }
    lock = await holdCleanLock();
    if (lock === null) {
      print("Another `cc-smart-dev-kit worktrees` is removing worktrees right now. Nothing done.");
      return 0;
    }
  }

  try {
    if (!options.noFetch && !fetchBase(repo, base, env)) {
      print(`Could not fetch origin/${base}; judging against the copy of it here.\n`);
    }

    if (options.remove !== null) {
      const target = resolve(options.remove);
      // `--remove` is the session that has just finished in it, so the one-hour wait is out;
      // the removal judges the folder again with the same options (`removeWorktree`).
      const judged = {
        base,
        claudeConfigDir: paths.claudeConfigDir,
        env,
        idleLimit: 0,
      };
      const scanned = scanWorktrees(repo, judged);
      const found = scanned.find(
        (worktree) => worktree.state !== "main" && samePath(worktree.listed.path, target),
      );
      if (found === undefined) {
        error(
          `${target} is not a worktree of this repo. \`cc-smart-dev-kit worktrees\` lists them.`,
        );
        return 1;
      }
      if (found.state === "gone") {
        pruneWorktrees(repo, env);
        print(forgottenLine(found.listed.path));
        if (found.listed.branch !== null) {
          print(deleteMergedBranch(repo, base, found.listed.branch, env));
        }
        return 0;
      }
      if (typeof found.state === "object" && found.state.finished) {
        print(`removing ${found.listed.path} …`);
        const removal = removeWorktree(repo, found.listed, judged);
        for (const said of removal.said) print(said);
        // Exit 1 unless it really went: "held" (something uses it), "kept" (something in it
        // is changed) and "failed" (git could not finish) all leave it a worktree still.
        return removal.status === "removed" ? 0 : 1;
      }
      print(`Kept ${found.listed.path}: ${describe(found).replace(/^kept: /, "")}.`);
      return 1;
    }

    const judged = { base, claudeConfigDir: paths.claudeConfigDir, env };
    const scanned = scanWorktrees(repo, judged);
    print(`Worktrees of ${repo}\n`);
    show(scanned, print);

    const going = scanned.filter(canGo);
    if (!options.clean) {
      print(
        going.length === 0
          ? "Nothing finished to clear."
          : `${String(going.length)} can go. \`cc-smart-dev-kit worktrees --clean\` in the main checkout removes them.`,
      );
      return 0;
    }

    cleanFinished(repo, scanned, judged, (line) => print(line));
    if (going.length === 0) print("Nothing finished to clear.");
    return 0;
  } finally {
    lock?.close();
  }
}
