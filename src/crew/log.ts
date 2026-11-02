/** Read a crew branch through shared git refs, never through its worktree. */
import { runGit } from "../hooks/git";
import { findCrew, isRefusal, readRecords } from "./board";
import type { CrewContext } from "./context";

/** `crew log <name>`: commits since the pinned base, and the diff against the merge base. */
export function runCrewLog(ref: string, ctx: CrewContext): number {
  const read = readRecords(ctx, false, "log");
  if (isRefusal(read)) {
    for (const line of read.lines) ctx.error(line);
    return read.code;
  }
  const found = findCrew(read.records, ref, "log");
  if ("refusal" in found) {
    for (const line of found.refusal.lines) ctx.error(line);
    return found.refusal.code;
  }
  const { record } = found;
  if (record.base === null) {
    ctx.error(`crew log: ${record.name} has no branch base yet; it has not started`);
    return 1;
  }
  // All worktrees share refs. The caller's checkout is the only git target here.
  const range = `${record.base.sha}..${record.branch}`;
  const commits = runGit(ctx.cwd, ["log", "--oneline", range, "--"], ctx.env);
  if (!commits.ok) {
    ctx.error(`crew log: cannot read commits for ${record.branch}: ${commits.err}`);
    ctx.error("Fix: check that the crew branch and its base commit still exist");
    return 1;
  }
  const stat = runGit(
    ctx.cwd,
    ["diff", "--stat", `${record.base.sha}...${record.branch}`, "--"],
    ctx.env,
  );
  if (!stat.ok) {
    ctx.error(`crew log: cannot read diff stat for ${record.branch}: ${stat.err}`);
    ctx.error("Fix: check that the crew branch and its base have a merge base");
    return 1;
  }
  ctx.print(`${record.name} — ${record.branch}`);
  ctx.print(`Commits since ${record.base.sha}:`);
  ctx.print(commits.out || "No commits.");
  ctx.print("Diff stat against merge base:");
  ctx.print(stat.out || "No changes.");
  return 0;
}
