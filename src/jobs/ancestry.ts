/**
 * Is this job running INSIDE another heavy job?
 *
 * WHY
 *   Some heavy commands start others: a project script that runs the type check, then
 *   the build, each through `cc-smart-dev-kit job run`. The outer job already holds its
 *   gigabytes. If the inner one queued too, it could wait for memory the outer job holds,
 *   while the outer job waits for the inner one to end: neither would ever move. So an
 *   inner job runs its command directly: no queue, no new memory group (it already lives
 *   in the outer job's, with its kill mark).
 *
 * HOW: no environment variable
 *   The job must get exactly the environment it was given, so nothing is passed down to
 *   say "you are nested". Instead `job run` walks its own parent chain, from
 *   `/proc/<pid>/stat`, and looks for a process that holds a lease on this machine.
 *
 * Linux only. Elsewhere the check says "not nested": there, heavy jobs must not be nested
 * through `cc-smart-dev-kit job run` (docs/jobs.md § Limits).
 */

import { readFileSync } from "node:fs";

/** The text of `/proc/<pid>/stat`, or null when that process is gone or unreadable. */
export type StatReader = (pid: number) => string | null;

/** A parent chain longer than this is a loop in bad data, not a real process tree. */
const MAX_DEPTH = 128;

/**
 * The parent pid in a `/proc/<pid>/stat` line: `pid (comm) state ppid …`. The command name
 * may hold spaces and brackets, so the fields are read after the LAST `)`.
 */
export function parentPidFromStat(stat: string): number | null {
  const end = stat.lastIndexOf(")");
  if (end === -1) return null;
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

/** One process's parent pid, or null when that process is gone or cannot be read. */
export type ParentReader = (pid: number) => number | null;

/**
 * Every ancestor of `pid`, nearest first, up to (not including) pid 0, by `parentOf`: the one
 * walk, whatever reads the parents (`/proc` here; a process listing where there is none — the
 * crew launcher finds its Claude session this way, `src/crew/session.ts`). A chain that
 * comes back to a pid it holds, or runs past `MAX_DEPTH`, ends there.
 */
export function ancestorsBy(pid: number, parentOf: ParentReader): number[] {
  const ancestors: number[] = [];
  const seen = new Set<number>([pid]);
  let current = pid;
  while (ancestors.length < MAX_DEPTH) {
    const parent = parentOf(current);
    if (parent === null || parent === 0 || seen.has(parent)) break;
    ancestors.push(parent);
    seen.add(parent);
    current = parent;
  }
  return ancestors;
}

/** Every ancestor of `pid`, nearest first, up to (not including) pid 0, from `/proc` stat lines. */
export function ancestorPids(pid: number, readStat: StatReader): number[] {
  return ancestorsBy(pid, (one) => {
    const stat = readStat(one);
    return stat === null ? null : parentPidFromStat(stat);
  });
}

export interface NestingFacts {
  platform: NodeJS.Platform;
  /** This process's own pid. */
  pid: number;
  readStat: StatReader;
  /** The pids that hold a lease on this machine right now. */
  holderPids: () => Promise<ReadonlySet<number>>;
}

/** True when an ancestor of this process holds a heavy-job lease (Linux only). */
export async function isInsideHeavyJob(facts: NestingFacts): Promise<boolean> {
  if (facts.platform !== "linux") return false;
  const ancestors = ancestorPids(facts.pid, facts.readStat);
  if (ancestors.length === 0) return false;
  const holders = await facts.holderPids();
  return ancestors.some((ancestor) => holders.has(ancestor));
}

/** The real reader. A process that has ended has no file: null. */
export function readProcStat(pid: number): string | null {
  try {
    return readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null; // gone, or not ours to read: the chain stops, which reads as "not nested"
  }
}
