/**
 * Finishing the removals that stopped halfway (D62).
 *
 * `removeWorktree` (`scan.ts`) moves a worktree it judged finished to `<path>-removing-<time>`,
 * then asks git to remove it. When that second step fails, the folder stays, in one of two
 * states — both seen on a real machine, three registered ones and five unregistered ones:
 *
 * - **git still lists it** (`finishParked`). It is a worktree like any other, at its new path.
 *   The verdict judges it again — nothing runs from it, nothing in it is uncommitted that the
 *   removal did not delete itself — and `removeWorktree` removes it where it stands.
 * - **git no longer lists it** (`finishStrays`). `git worktree remove` deleted the registration
 *   and the `.git` file, then failed on a file it could not delete: half a folder nobody tracks.
 *   Git cannot judge it, so the kit's own rule stands in, and the name is the proof: the folder
 *   carries the time of the move, the verdict that allowed the move said everything in it was
 *   disposable, and a file written *after* that time is not. So it is removed only when
 *   nothing runs from it, it is no repository and has no registration of its own, it crosses no
 *   mount, and no file in it is newer than its move. Anything else stays, with the reason.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, type Stats } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isInside, type ListedWorktree, listWorktrees, realPath, samePath } from "../hooks/git";
import type { Env } from "../hooks/run";
import { containersUsing, programsInside } from "./machine-facts";
import {
  forgottenLine,
  isParkedWorktree,
  type MachineFacts,
  machineFactsOf,
  pruneWorktrees,
  removeWorktree,
  type ScannedWorktree,
  type ScanOptions,
  scanWorktrees,
} from "./scan";
import { verdict, type WorktreeFacts } from "./verdict";

/** What one pass over a removal's parked folders came to. */
export interface ParkedPass {
  /** The folders that stayed, with the reason the verdict gave. */
  kept: Array<{ path: string; why: string }>;
  /** The folders that went (or were forgotten), and the lines said about each. */
  removed: string[];
  said: string[];
}

/**
 * Finishes the removals git still lists: the folders a removal moved aside
 * (`<path>-removing-<time>`) and could not then remove, so they are never left behind (D62).
 * Each is judged again right before it goes, by the same verdict as any removal — nothing runs
 * from it, nothing in it is uncommitted beyond the tracked files the removal itself deleted — and
 * a parked folder asks for no idle hour and no commits on `options.against`: its branch keeps
 * them (`WorktreeFacts.parked`).
 *
 * `paths` names the folders to finish; the caller passes only those it is entitled to (`crew rm`
 * its own record's, the watch the rest). A folder that does not look finished stays. A folder
 * whose record is gone is finished just the same: this pass needs no store.
 */
export function finishParked(
  repo: string,
  paths: readonly string[],
  options: ScanOptions,
  say: (line: string) => void,
): ParkedPass {
  const pass: ParkedPass = { kept: [], removed: [], said: [] };
  if (paths.length === 0) return pass;
  let scanned: ScannedWorktree[];
  try {
    scanned = scanWorktrees(repo, options);
  } catch {
    // The ref is not known here: nothing may be judged against a guess.
    return pass;
  }
  for (const worktree of scanned) {
    if (worktree.state === "main") continue;
    if (!paths.some((path) => samePath(path, worktree.listed.path))) continue;
    const shown = worktree.listed.path;
    if (worktree.state === "gone") {
      pruneWorktrees(repo, options.env);
      pass.removed.push(shown);
      const line = forgottenLine(shown);
      pass.said.push(line);
      say(line);
      continue;
    }
    if (!worktree.state.finished) {
      pass.kept.push({ path: shown, why: worktree.state.why });
      continue;
    }
    const removal = removeWorktree(repo, worktree.listed, options);
    for (const line of removal.said) {
      pass.said.push(line);
      say(line);
    }
    if (removal.status === "removed") pass.removed.push(shown);
    else pass.kept.push({ path: shown, why: removal.said[0] ?? removal.status });
  }
  return pass;
}

/** A leftover folder git no longer lists: where it is, and when the removal moved it aside. */
export interface StrayFolder {
  /** The moment the removal moved it aside, from the name (milliseconds). */
  parkedAt: number;
  path: string;
}

/** The time in the last mark of a moved-aside folder's name, or null when it carries none. */
function parkedAtOf(path: string): null | number {
  if (!isParkedWorktree(path)) return null;
  const found = /-removing-(\d{13})$/.exec(path);
  return found?.[1] === undefined ? null : Number(found[1]);
}

/**
 * The folders a removal moved aside that git no longer lists: next to the worktrees git does
 * list, and in the repository's own `.claude/worktrees/` where Claude Code makes them. A folder
 * git lists is the scan's to judge, and a name without the mark is nobody's but its owner's.
 * Empty when git cannot say what it lists — nothing is a stray then.
 */
export function strayParkedFolders(repo: string, env: Env): StrayFolder[] {
  let all: ListedWorktree[];
  try {
    all = listWorktrees(repo, env);
  } catch {
    return [];
  }
  const folders = new Set<string>([join(repo, ".claude", "worktrees")]);
  for (const listed of all.slice(1)) folders.add(dirname(listed.path));
  const found: StrayFolder[] = [];
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(folder, name);
      const parkedAt = parkedAtOf(path);
      if (parkedAt === null || all.some((listed) => samePath(listed.path, path))) continue;
      try {
        // `lstat`: a link is not a folder of ours, whatever it points at.
        if (!lstatSync(path).isDirectory()) continue;
      } catch {
        continue;
      }
      found.push({ parkedAt, path });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** How much later than the move a file's time may be and still be the removal's own: a disk's rounding. */
const MTIME_SLACK_MS = 2_000;

/** The most entries one leftover folder is walked for: a bigger one is not a remnant. */
const MAX_ENTRIES = 100_000;

/** What a walk of a leftover folder found. */
interface Walk {
  crossesMount: boolean;
  unreadable: boolean;
  /** Files written after the move: how many, and the first few by name. */
  newer: { count: number; first: string[] };
  tooMany: boolean;
}

/**
 * Walks `root` without following a link, and reports the files written after `limitMs`. A
 * directory's own time is not looked at: it moves when git deletes an entry from it, and that is
 * the removal's own work. A file's time does not move then.
 */
function walkLeftover(root: string, limitMs: number): Walk {
  const walk: Walk = {
    crossesMount: false,
    unreadable: false,
    newer: { count: 0, first: [] },
    tooMany: false,
  };
  let rootDevice: number;
  try {
    rootDevice = lstatSync(root).dev;
  } catch {
    walk.unreadable = true;
    return walk;
  }
  const folders = [root];
  let seen = 0;
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      walk.unreadable = true;
      continue;
    }
    for (const name of names) {
      seen += 1;
      if (seen > MAX_ENTRIES) {
        walk.tooMany = true;
        return walk;
      }
      const path = join(folder, name);
      let stat: Stats;
      try {
        stat = lstatSync(path);
      } catch {
        walk.unreadable = true;
        continue;
      }
      if (stat.dev !== rootDevice) {
        walk.crossesMount = true;
        continue;
      }
      if (stat.isDirectory()) {
        folders.push(path);
      } else if (stat.mtimeMs > limitMs) {
        walk.newer.count += 1;
        if (walk.newer.first.length < 3) walk.newer.first.push(relative(root, path));
      }
    }
  }
  return walk;
}

/** Why git's own bookkeeping makes the folder not a stray, or null when there is none. */
function gitEntryWhy(folder: string): null | string {
  const dotGit = join(folder, ".git");
  let stat: Stats;
  try {
    stat = lstatSync(dotGit);
  } catch (error) {
    // Only an absent entry proves git left no bookkeeping behind.
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? null
      : "its .git entry cannot be read";
  }
  if (stat.isDirectory()) return "it holds a git repository of its own";
  if (!stat.isFile()) return "its .git entry is neither a file nor a folder";
  try {
    const target = readFileSync(dotGit, "utf8")
      .trim()
      .replace(/^gitdir:\s*/, "");
    return target !== "" && existsSync(target)
      ? `git still has an administrative folder for it: ${target}`
      : null;
  } catch {
    return "its .git file cannot be read";
  }
}

/**
 * Why a leftover folder stays, or null when it may go. The same machine facts as any worktree's
 * verdict (`verdict`: a session in it, a program from it, a container on it, an unreadable
 * listing), then the two things only the name can tell: it is no repository and has no
 * registration, and no file in it is newer than its move.
 */
export function strayKeptWhy(stray: StrayFolder, machine: MachineFacts): null | string {
  if (machine.mounts === "unknown")
    return "its mount points could not be read, so it cannot be shown that nothing is mounted in it";
  const mounted = machine.mounts.find((path) => isInside(realPath(path), realPath(stray.path)));
  if (mounted !== undefined) return `a mount point lies inside it: ${mounted}`;
  const entry = gitEntryWhy(stray.path);
  if (entry !== null) return entry;
  const session = machine.sessions.find((one) => isInside(realPath(one.cwd), realPath(stray.path)));
  const facts: WorktreeFacts = {
    aheadOfBase: 0,
    base: "",
    containers:
      machine.containers === "unknown"
        ? "unknown"
        : containersUsing(stray.path, machine.containers),
    gitTooOld: null,
    idleMinutes: 0,
    innerWorktree: null,
    locked: false,
    mergedBy: null,
    parked: true,
    programs:
      machine.programs === "unknown" ? "unknown" : programsInside(machine.programs, stray.path),
    sessionName: session?.name ?? null,
  };
  const judged = verdict(facts, () => ({ localFiles: [], uncommitted: false }), 0);
  if (!judged.finished) return judged.why;
  const walk = walkLeftover(stray.path, stray.parkedAt + MTIME_SLACK_MS);
  if (walk.unreadable) return "its files could not all be read";
  if (walk.crossesMount) return "it crosses a mount point";
  if (walk.tooMany)
    return `it holds more than ${String(MAX_ENTRIES)} entries, too many for a remnant`;
  if (walk.newer.count > 0) {
    const more =
      walk.newer.count > walk.newer.first.length
        ? ` and ${String(walk.newer.count - walk.newer.first.length)} more`
        : "";
    return `files were written in it after the removal moved it: ${walk.newer.first.join(", ")}${more}`;
  }
  return null;
}

/** What one pass over the leftover folders git no longer lists came to. */
export interface StrayPass {
  kept: Array<{ path: string; why: string }>;
  removed: string[];
}

/**
 * Removes the leftover folders git no longer lists whose proof holds (`strayKeptWhy`), and says
 * each through `say`. The rest stay, with their reason in the result: the caller decides whether
 * a pass that runs every few seconds has anything to say about them. A removal that fails
 * midway (a file this user cannot delete) leaves what is left and says why; the next pass tries
 * again. Nothing outside the folder is touched: a link inside it is removed as a link.
 *
 * `strays` is the list to work on: a caller that removes worktrees first reads it before, because
 * the folders are looked for next to the worktrees git lists, and a clean may have removed them.
 */
export function finishStrays(
  repo: string,
  options: ScanOptions,
  say: (line: string) => void,
  strays: readonly StrayFolder[] = strayParkedFolders(repo, options.env),
): StrayPass {
  const pass: StrayPass = { kept: [], removed: [] };
  if (strays.length === 0) return pass;
  const machine = machineFactsOf(options);
  for (const stray of strays) {
    const why = strayKeptWhy(stray, machine);
    if (why !== null) {
      pass.kept.push({ path: stray.path, why });
      continue;
    }
    try {
      rmSync(stray.path, { recursive: true });
    } catch (error) {
      pass.kept.push({
        path: stray.path,
        why: `it could not be removed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    pass.removed.push(stray.path);
    say(`removed ${stray.path} (left by a removal that stopped halfway; git no longer lists it)`);
  }
  return pass;
}
