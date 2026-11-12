import type { Env } from "../hooks/run";
import { ancestorPids, readProcStat } from "../jobs/ancestry";
import { runningPrograms } from "../worktrees/machine-facts";
import { coreId, type HcRunner, hcGet } from "./hc";
import { leadId } from "./labels";
export interface Identity {
  core: string;
  address: string;
  leadId: string;
}
export interface IdentityFacts {
  pid: number;
  ancestors: (pid: number) => number[];
}
function ancestors(pid: number): number[] {
  if (process.platform === "linux") return ancestorPids(pid, readProcStat);
  const programs = runningPrograms();
  if (programs === "unknown") return [];
  const parents = new Map(programs.map((p) => [p.pid, p.parentPid]));
  const result: number[] = [];
  const seen = new Set([pid]);
  let at = parents.get(pid);
  while (at && !seen.has(at)) {
    result.push(at);
    seen.add(at);
    at = parents.get(at);
  }
  return result;
}
export function checkedIdentity(
  env: Env,
  runner: HcRunner,
  facts: IdentityFacts = { pid: process.pid, ancestors },
): Identity | { why: string } {
  const refuse = (why: string) => ({
    why: `This session is not inside a Herdr terminal (${why}).`,
  });
  const target = env.HC_TERMINAL_ID;
  if (!target) return refuse("HC_TERMINAL_ID is missing");
  const core = coreId(runner);
  const terminal = hcGet(runner, target);
  if (terminal.state !== "live") return refuse("the terminal is not live");
  if (terminal.address.includes("/")) return refuse("the terminal is on another core");
  if (!terminal.pid || !facts.ancestors(facts.pid).includes(terminal.pid))
    return refuse("the terminal process is not an ancestor");
  return { core, address: terminal.address, leadId: leadId(core, terminal.address) };
}
