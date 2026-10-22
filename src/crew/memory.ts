/**
 * How much memory a crew session's own process holds, and how the watch reads it.
 *
 * **Linux only.** `/proc/<pid>/status` carries `VmRSS`, the resident set size in kilobytes.
 * Nothing is started and no process is looked at beyond the one the store names. Elsewhere
 * (macOS, Windows) the kit reads no memory: a session's size is not worth a helper program on
 * every machine, and the portal and `crew list` show a dash instead.
 */
import { readFileSync } from "node:fs";

/** The line of `/proc/<pid>/status` that carries the resident set size. */
const VM_RSS = /^VmRSS:\s+(\d+)\s+kB$/m;

/**
 * The memory the process `pid` holds, in MB (one decimal); null where it cannot be read: the
 * process is gone, or it is not a Linux one.
 */
export function memoryMbOf(pid: null | number): null | number {
  if (pid === null || pid <= 0) return null;
  try {
    const found = VM_RSS.exec(readFileSync(`/proc/${String(pid)}/status`, "utf8"));
    if (found?.[1] === undefined) return null;
    return Math.round((Number(found[1]) / 1024) * 10) / 10;
  } catch {
    // Gone, another user's, or not Linux: the memory is unknown.
    return null;
  }
}
