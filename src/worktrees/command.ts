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
import { basename, resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { type CrewRecord, listCrew } from "../crew/store";
import { runGit, samePath } from "../hooks/git";
import type { Env } from "../hooks/run";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { autoCleanFiles, readRepoRecord } from "./auto-state";
import { type CleanLock, canGo, cleanFinished, forgottenLine, holdCleanLock } from "./clean";
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
  /**
   * `--json`: print the answer the portal's `/api/worktrees` shows (`worktreesAnswerOf`) and
   * change nothing. The command line refuses it with `--clean` or `--remove`.
   */
  json: boolean;
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

/** The crew sessions of `repo`, for naming the worktrees the store knows; none when it cannot be read. */
export function crewRecordsOf(paths: CliPaths, repo: string): CrewRecord[] {
  try {
    return listCrew(paths.stateDir, repo).records;
  } catch {
    // The store's own reader names a broken record and goes on; a read that cannot happen at
    // all leaves the worktrees judged as usual.
    return [];
  }
}

/** The crew session whose worktree is `path`, in any state and of any lead, or null. */
export function crewOfWorktree(records: readonly CrewRecord[], path: string): null | CrewRecord {
  return records.find((one) => samePath(one.worktree, path)) ?? null;
}

/**
 * True for a worktree the crew store names: the clean leaves it to its lead (D62). The main
 * checkout is none, and neither is a folder that is gone — there is nothing of it to remove, and
 * the clean forgets it like any other.
 */
export function isCrewWorktree(worktree: ScannedWorktree, records: readonly CrewRecord[]): boolean {
  if (worktree.state === "main" || worktree.state === "gone") return false;
  return crewOfWorktree(records, worktree.listed.path) !== null;
}

/**
 * The step a crew session's worktree waits for, in its state's own words. A crew session's work
 * goes to its **lead's** branch, and the lead merges it there: `worktrees --clean` judges against
 * `origin/<base>` and is the wrong tool, so the line names `crew rm` or the watch (D62).
 */
export function crewWorktreeStep(record: CrewRecord): string {
  switch (record.state) {
    case "merged":
      return `merged into its lead's branch — its lead removes it with \`${COMMAND} crew rm\`, or the watch does`;
    case "done":
      return `done, waiting for its lead's merge; then \`${COMMAND} crew rm\` or the watch removes it`;
    case "handoff":
      return `handed off; it goes once its continuation and the lead's merge are past`;
    case "failed":
      return `failed; its lead removes it with \`${COMMAND} crew rm\` once its work is merged`;
    case "stopped":
      return `stopped; its removal is its lead's call (\`${COMMAND} crew rm\`)`;
    case "queued":
      return "queued; it has not started";
    case "removed":
      return `removed already; a folder it left behind is finished by \`${COMMAND} worktrees --clean\``;
    default:
      return `still running (${record.state}); its lead's watch ends it, and removes it once merged`;
  }
}

/** The line a crew session's worktree is named with: whose it is, and what happens to it. */
export function crewWorktreeLine(record: CrewRecord): string {
  return `crew session \`${record.name}\` (lead \`${record.leadName}\`), ${crewWorktreeStep(record)}`;
}

function describe(worktree: ScannedWorktree, crew: null | CrewRecord = null): string {
  const { state } = worktree;
  if (state === "main") return "the main checkout";
  if (state === "gone") return "GONE — its folder no longer exists";
  // A crew session's worktree is never cleared by `--clean`: its record, branch and Claude
  // session go with `crew rm`, which judges the branch the lead merged into (D62).
  if (crew !== null) return `kept: ${crewWorktreeLine(crew)}`;
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

function show(
  scanned: ScannedWorktree[],
  crewRecords: readonly CrewRecord[],
  print: (line: string) => void,
): void {
  for (const worktree of scanned) {
    const { branch, head, path } = worktree.listed;
    const name = basename(path).padEnd(30);
    const on = (branch ?? `detached at ${head.slice(0, 9)}`).padEnd(42);
    print(`  ${name} ${on} ${describe(worktree, crewOfWorktree(crewRecords, path))}`);
  }
  print("");
}

/** One worktree, as `--json` and the portal's `/api/worktrees` show it. */
export interface WorktreeItem {
  branch: null | string;
  /** `main`, a folder that is gone, finished, or kept with its reason. */
  kind: "finished" | "gone" | "kept" | "main";
  /** The commit it is on. */
  head: string;
  /** Minutes since git last wrote to it; null for the main checkout and a folder that is gone. */
  idleMinutes: null | number;
  path: string;
  /** Why it is kept; null when it is finished or the main checkout. */
  why: null | string;
}

/**
 * The background clean's record of a repository (`src/worktrees/auto-state.ts`): when it last
 * ran, and the removals no session start has reported to the person yet (the record keeps them
 * until then, so they are not necessarily from that last run).
 */
export interface WorktreeAutoClean {
  /** The base those removals were judged against. */
  base: string;
  /** When auto-clean last ran (ISO 8601), whatever that run did. */
  lastRunAt: string;
  /** The latest removals auto-clean has not reported yet, and why each counted as finished. */
  removed: { branch: null | string; name: string; path: string; why: string }[];
}

/**
 * `worktrees --json`'s answer, and `/api/worktrees`'s: every worktree's verdict against
 * `base`, with no fetch (origin as it is). One builder (`worktreesAnswerOf`) so the command and
 * the page can never disagree.
 */
export interface WorktreesAnswer {
  /** The last background clean of this repository; null when it never ran. */
  autoClean: null | WorktreeAutoClean;
  base: string;
  /** Where the base came from: the project's file, the remote's default, or the fallback. */
  from: "config" | "default" | "origin";
  /** A line about this folder or the machine's own facts when they could not be read. */
  note: null | string;
  worktrees: WorktreeItem[];
}

/** One scanned worktree in the answer's shape. */
function worktreeItemOf(worktree: ScannedWorktree, crew: null | CrewRecord = null): WorktreeItem {
  const { branch, head, path } = worktree.listed;
  // The main checkout is never one to clear, and a folder that is gone has no git files to
  // read: neither has an idle time.
  if (worktree.state === "main") {
    return { branch, head, idleMinutes: null, kind: "main", path, why: null };
  }
  if (worktree.state === "gone") {
    return {
      branch,
      head,
      idleMinutes: null,
      kind: "gone",
      path,
      why: "its folder no longer exists",
    };
  }
  // A crew session's worktree is its lead's to remove, never `--clean`'s (D62).
  if (crew !== null) {
    return {
      branch,
      head,
      idleMinutes: worktree.idleMinutes,
      kind: "kept",
      path,
      why: crewWorktreeLine(crew),
    };
  }
  return worktree.state.finished
    ? { branch, head, idleMinutes: worktree.idleMinutes, kind: "finished", path, why: null }
    : {
        branch,
        head,
        idleMinutes: worktree.idleMinutes,
        kind: "kept",
        path,
        why: worktree.state.why,
      };
}

/** What the last background clean of `repo` did, or null when it never ran. */
function autoCleanOf(paths: CliPaths, repo: string): null | WorktreeAutoClean {
  const record = readRepoRecord(autoCleanFiles(paths.stateDir, repo));
  if (record === null) return null;
  return {
    base: record.base,
    lastRunAt: new Date(record.lastRunAt).toISOString(),
    removed: record.removed,
  };
}

/**
 * The worktrees answer for the folder `cwd`: what `--json` prints. Read-only and with no fetch:
 * a read never changes the repository, and the portal's page (which runs this in a child,
 * `src/portal/worktrees-read.ts`) never waits on the network. A folder that is no git project
 * says so — the portal's normal start is the home folder.
 */
export function worktreesAnswerOf(
  paths: CliPaths,
  env: Env,
  cwd: string,
  now: number,
): WorktreesAnswer {
  const none = (note: string): WorktreesAnswer => ({
    autoClean: null,
    base: "",
    from: "default",
    note,
    worktrees: [],
  });
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(cwd, { env });
  } catch (error) {
    return none(error instanceof Error ? error.message : String(error));
  }
  if (checkout === null) {
    return none("this folder is not in a git project, so there is no work to show");
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  try {
    // A project file the plugin cannot read (`baseBranch` loads it) is a note, never a crash:
    // this answer is printed by `--json`, and a stack trace is no answer.
    const chosen = baseBranch(checkout, env, repo);
    const judged = {
      base: chosen.base,
      claudeConfigDir: paths.claudeConfigDir,
      env,
      now,
    };
    let note: null | string = null;
    let scanned: ScannedWorktree[];
    try {
      scanned = scanWorktrees(repo, judged);
    } catch (error) {
      // A repository with no `origin/<base>` (a local-only repo) is judged against its own
      // base branch: the same comparison, said plainly.
      const why = error instanceof Error ? error.message : String(error);
      if (!why.includes("is not known here")) return none(why);
      scanned = scanWorktrees(repo, {
        ...judged,
        against: { label: chosen.base, ref: `refs/heads/${chosen.base}` },
      });
      note = `origin/${chosen.base} is not known here, so this judges against the local ${chosen.base}`;
    }
    const crewRecords = crewRecordsOf(paths, repo);
    return {
      autoClean: autoCleanOf(paths, repo),
      base: chosen.base,
      from: chosen.from,
      note,
      worktrees: scanned.map((one) =>
        worktreeItemOf(one, crewOfWorktree(crewRecords, one.listed.path)),
      ),
    };
  } catch (error) {
    return none(error instanceof Error ? error.message : String(error));
  }
}

export async function runWorktrees(
  paths: CliPaths,
  options: WorktreesOptions,
  env: Env,
  cwd: string = process.cwd(),
  sinks: WorktreesSinks = CONSOLE_SINKS,
  // The machine-wide lock: a test hands in its own, so it never reaches the real port a running
  // clean may hold (`LOCK_PORTS.worktreesClean`), as `auto-clean.ts` takes `deps.hold`.
  hold: () => Promise<null | CleanLock> = holdCleanLock,
): Promise<number> {
  const { error, print } = sinks;

  if (options.remove !== null && options.remove === "") {
    error("Say which worktree: cc-smart-dev-kit worktrees --remove <path>");
    return 1;
  }
  if (options.json) {
    // The answer a page reads: one line on stdout and nothing else, and nothing changed.
    print(JSON.stringify(worktreesAnswerOf(paths, env, cwd, Date.now())));
    return 0;
  }
  const checkout = locateCheckout(cwd, { env });
  const repo = checkout?.mainCheckout ?? resolve(cwd);
  const { base, from } = baseBranch(checkout, env, repo);
  if (from !== "config") {
    print(`No \`worktrees.base\` in .claude/cc-smart-dev-kit.json: judging against ${base}.\n`);
  }

  let lock: null | CleanLock = null;
  if (options.clean || options.remove !== null) {
    if (!samePath(cwd, repo)) {
      error(
        `Run this in the main checkout, ${repo}. A session working in a worktree leaves it first (ExitWorktree, action "keep").`,
      );
      return 1;
    }
    lock = await hold();
    if (lock === null) {
      print("Another `cc-smart-dev-kit worktrees` is removing worktrees right now. Nothing done.");
      return 0;
    }
  }

  try {
    if (!options.noFetch && !fetchBase(repo, base, env)) {
      print(`Could not fetch origin/${base}; judging against the copy of it here.\n`);
    }

    const crewRecords = crewRecordsOf(paths, repo);
    const crewAt = (path: string): null | CrewRecord => crewOfWorktree(crewRecords, path);

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
      // A crew session's worktree is its lead's to remove: `crew rm` takes the record, its
      // branch and its Claude session with the folder, which this command does not (D62).
      const crew = crewAt(found.listed.path);
      if (crew !== null) {
        error(`Kept ${found.listed.path}: ${crewWorktreeLine(crew)}.`);
        error(`Fix: its lead removes it: ${COMMAND} crew rm "${crew.name}"`);
        return 1;
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
    show(scanned, crewRecords, print);

    // A crew session's worktree is never cleared here: its lead removes it with `crew rm`, or
    // the watch does once the branch is merged (D62). The summary says so, so a person is not
    // sent to a command that does nothing for them.
    const isCrew = (one: ScannedWorktree): boolean => isCrewWorktree(one, crewRecords);
    const going = scanned.filter((one) => canGo(one) && !isCrew(one));
    const crewCount = scanned.filter(isCrew).length;
    const crewLine =
      crewCount === 0
        ? null
        : `${String(crewCount)} crew worktree${crewCount === 1 ? "" : "s"}: their leads remove them (\`${COMMAND} crew rm\`)`;
    if (!options.clean) {
      if (going.length > 0) {
        print(
          `${String(going.length)} can go. \`${COMMAND} worktrees --clean\` in the main checkout removes them.`,
        );
      }
      if (crewLine !== null) print(crewLine);
      if (going.length === 0 && crewLine === null) print("Nothing finished to clear.");
      return 0;
    }

    cleanFinished(repo, scanned, judged, (line) => print(line), isCrew);
    if (crewLine !== null) print(crewLine);
    if (going.length === 0 && crewLine === null) print("Nothing finished to clear.");
    return 0;
  } finally {
    lock?.close();
  }
}
