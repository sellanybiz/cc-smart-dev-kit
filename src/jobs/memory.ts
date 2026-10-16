/**
 * How much memory this machine has, and how much is free right now.
 *
 * - **Linux:** `MemTotal` and `MemAvailable` from `/proc/meminfo`. `MemAvailable` is what
 *   the kernel can still hand out without swapping. Some container systems (lxcfs) already
 *   show the container's ceiling there.
 * - **A container or a memory-limited group (Linux):** the cgroup this process lives in,
 *   or one above it, may have a ceiling (`memory.max`, cgroup v2; `memory.limit_in_bytes`,
 *   v1). Then the total is that ceiling, and the free memory is the ceiling less what the
 *   group uses, not counting the file cache the kernel can drop (`inactive_file`). The
 *   smaller of the two views wins.
 * - **Windows:** `os.totalmem()` and `os.freemem()`: both are real readings there. There
 *   is no cgroup. Windows counts the standby cache as used, so its free memory is lower
 *   than what can really still be handed out: the live check then waits a little longer,
 *   the safe side (docs/windows-jobs.md § Memory).
 * - **macOS and others:** `os.totalmem()` for the total, and no free-memory reading: the
 *   queue still works on its budget, without the live check.
 *
 * Every read goes through `MemoryFiles`, so a test feeds fake files.
 */

import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

export const GIB = 1024 ** 3;

/** Reads one file as text, or null when it is not there or cannot be read. */
export type ReadText = (path: string) => string | null;

export interface MemoryFacts {
  platform: NodeJS.Platform;
  read: ReadText;
  /** `os.totalmem()`: the fallback when nothing better can be read. */
  totalmem: () => number;
  /** `os.freemem()`: what Windows reports as free right now. */
  freemem: () => number;
}

export const realReadText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null; // not there, or not ours to read: the caller falls back
  }
};

export function realMemoryFacts(): MemoryFacts {
  return { platform: process.platform, read: realReadText, totalmem, freemem };
}

/** One field of `/proc/meminfo`, in bytes, or null when it is not there. */
export function meminfoBytes(meminfo: string, field: string): number | null {
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB\\s*$`, "m").exec(meminfo);
  return match === null ? null : Number(match[1]) * 1024;
}

/** A cgroup file holding one number; null for `max`, an unset v1 limit, or no file. */
function cgroupNumber(text: string | null): number | null {
  if (text === null) return null;
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  // cgroup v1 writes "no limit" as a huge number near 2^63.
  return number >= 2 ** 60 ? null : number;
}

/** One `<key> <number>` line of a cgroup's `memory.stat`. */
function statField(stat: string | null, key: string): number {
  if (stat === null) return 0;
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(stat);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

/** Where this process's memory group is: a cgroup v2 path, or v1's memory controller path. */
export function ownCgroup(procSelfCgroup: string): { version: 1 | 2; path: string } | null {
  for (const line of procSelfCgroup.split("\n")) {
    const [, controllers, path] = line.split(":");
    if (path === undefined || !path.startsWith("/")) continue;
    if (line.startsWith("0::")) return { version: 2, path };
    if (controllers?.split(",").includes("memory")) return { version: 1, path };
  }
  return null;
}

export interface CgroupLimit {
  /** The smallest ceiling on this group or above it. */
  limitBytes: number;
  /** What that group uses now, less the file cache the kernel can drop. */
  usedBytes: number;
  /** The group's folder under `/sys/fs/cgroup`. */
  dir: string;
}

/** Every folder from `path` up to the root of the mount, nearest first. */
function upwards(root: string, path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const dirs: string[] = [];
  for (let i = parts.length; i >= 0; i--) {
    dirs.push([root, ...parts.slice(0, i)].join("/"));
  }
  return dirs;
}

/**
 * The tightest memory ceiling on this process's group or a group above it, or null when
 * there is none (or no cgroup can be read). Inside a container the group's own path often
 * reads `/`, and its files sit at the top of `/sys/fs/cgroup`.
 */
export function cgroupLimit(read: ReadText): CgroupLimit | null {
  const own = ownCgroup(read("/proc/self/cgroup") ?? "");
  if (own === null) return null;
  const root = own.version === 2 ? "/sys/fs/cgroup" : "/sys/fs/cgroup/memory";
  const limitFile = own.version === 2 ? "memory.max" : "memory.limit_in_bytes";
  const usageFile = own.version === 2 ? "memory.current" : "memory.usage_in_bytes";
  const cacheKey = own.version === 2 ? "inactive_file" : "total_inactive_file";
  let best: CgroupLimit | null = null;
  for (const dir of upwards(root, own.path)) {
    const limit = cgroupNumber(read(`${dir}/${limitFile}`));
    if (limit === null || (best !== null && limit >= best.limitBytes)) continue;
    const usage = cgroupNumber(read(`${dir}/${usageFile}`));
    const cache = statField(read(`${dir}/memory.stat`), cacheKey);
    // No usage file: count the group as full, so the live check stays on the safe side.
    const usedBytes = usage === null ? limit : Math.max(0, usage - cache);
    best = { limitBytes: limit, usedBytes, dir };
  }
  return best;
}

export interface MachineMemory {
  totalBytes: number;
  /** What can still be used without swapping; null where it cannot be read (macOS). */
  availableBytes: number | null;
  /** The cgroup ceiling that lowered the numbers, if one did. */
  limit: CgroupLimit | null;
}

/** This machine's memory: the smaller of `/proc/meminfo` and any cgroup ceiling. */
export function machineMemory(facts: MemoryFacts): MachineMemory {
  if (facts.platform === "win32") {
    // Windows reads both numbers itself, and has no cgroup to lower them.
    return { totalBytes: facts.totalmem(), availableBytes: facts.freemem(), limit: null };
  }
  if (facts.platform !== "linux") {
    return { totalBytes: facts.totalmem(), availableBytes: null, limit: null };
  }
  const meminfo = facts.read("/proc/meminfo");
  const memTotal = meminfo === null ? null : meminfoBytes(meminfo, "MemTotal");
  const memAvailable = meminfo === null ? null : meminfoBytes(meminfo, "MemAvailable");
  const total = memTotal ?? facts.totalmem();
  const limit = cgroupLimit(facts.read);
  if (limit === null || limit.limitBytes >= total) {
    return { totalBytes: total, availableBytes: memAvailable, limit: null };
  }
  const inGroup = Math.max(0, limit.limitBytes - limit.usedBytes);
  return {
    totalBytes: limit.limitBytes,
    availableBytes: memAvailable === null ? inGroup : Math.min(memAvailable, inGroup),
    limit,
  };
}

/**
 * The GB heavy jobs on this machine may hold together: its memory in whole GB less
 * `reserveGb` (kept for what never queues: the desktop, the Claude sessions, MCP
 * servers, dev servers, a local database), and never less than the largest single job,
 * so that job can always run, alone.
 */
export function machineBudgetGb(totalBytes: number, reserveGb: number, largestGb: number): number {
  return Math.max(largestGb, Math.floor(totalBytes / GIB) - reserveGb);
}

/**
 * The cgroup path (under `/sys/fs/cgroup`) of a slice of user `uid`'s systemd manager.
 * systemd reads every dash in a slice name as nesting: `cc-smart-dev-kit-heavy.slice` sits inside
 * `cc-smart-dev-kit.slice`. One home for that rule, so the launcher and the live check agree.
 */
export function userSliceCgroup(uid: number, slice: string): string {
  const parts = slice.replace(/\.slice$/, "").split("-");
  const chain = parts.map((_, i) => `${parts.slice(0, i + 1).join("-")}.slice`);
  return `/user.slice/user-${String(uid)}.slice/user@${String(uid)}.service/${chain.join("/")}`;
}

/** What every heavy job of this user uses right now: the slice's `memory.current`. */
export function sliceBytes(read: ReadText, uid: number, slice: string): number | null {
  return cgroupNumber(read(`/sys/fs/cgroup${userSliceCgroup(uid, slice)}/memory.current`));
}
