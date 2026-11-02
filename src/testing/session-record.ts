import { readProcStat } from "../jobs/ancestry";

/**
 * Linux identity for fixtures backed by this test process or its real parent. Other pids
 * belong to fake process trees: their tests inject sessions, so never inspect the host for them.
 */
export function sessionProcessIdentity(pid: number): { procStart?: string } {
  if (process.platform !== "linux" || (pid !== process.pid && pid !== process.ppid)) return {};
  const stat = readProcStat(pid);
  const procStart = stat
    ?.slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/)[19];
  if (procStart === undefined) throw new Error(`cannot read test session ${pid}'s start identity`);
  return { procStart };
}
