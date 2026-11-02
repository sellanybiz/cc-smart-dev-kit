/** Orphaned crew work uses crew rm's own removal, after proof against the project's base. */
import { basename } from "node:path";
import type { CliPaths } from "../cli/paths";
import { agentRows } from "../crew/agents";
import { type CrewContext, realCrewContext } from "../crew/context";
import { leadGone, observeLeadPresence } from "../crew/lifecycle";
import { runCrewRm } from "../crew/remove";
import { type CrewRecord, listCrew, listLeads } from "../crew/store";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import type { RemovedWorktree } from "./clean";
import { type ScanOptions, workOnRef } from "./scan";

export interface OrphanCrew {
  records: CrewRecord[];
  gone: ReadonlySet<string>;
}

/** The daemon and command name their own repo, environment and machine facts. */
export function cleanupCrewContext(
  paths: CliPaths,
  env: Env,
  repo: string,
  facts?: ScanOptions["facts"],
  now: () => number = Date.now,
): CrewContext {
  return {
    ...realCrewContext(paths),
    cwd: repo,
    env,
    now,
    scanFacts: facts,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
  };
}

/** Observe once per pass. Broken role records never authorize an automatic removal. */
export async function orphanCrewOf(ctx: CrewContext): Promise<OrphanCrew> {
  const crew = listCrew(ctx.paths.stateDir, ctx.cwd);
  const leads = listLeads(ctx.paths.stateDir, ctx.cwd);
  const none = { records: crew.records, gone: new Set<string>() };
  if (crew.broken.length || leads.broken.length || leads.records.length === 0) return none;
  const rows = agentRows(ctx);
  const observed = await observeLeadPresence(
    ctx.paths.stateDir,
    leads.records,
    rows,
    ctx.now(),
    ctx,
  );
  return {
    records: crew.records,
    gone: new Set(
      crew.records
        .filter((record) =>
          leadGone(
            observed.find((lead) => lead.sessionId === record.leadSessionId) ?? null,
            rows,
            ctx.now(),
            ctx,
          ),
        )
        .map((record) => record.id),
    ),
  };
}

export function orphanCrewLine(record: CrewRecord): string {
  return `its lead is gone: remove it with \`crew rm\`, or continue it with \`crew start ${record.phase} --continue "${record.name}"\``;
}

/** Caller holds the clean lock. Never discards, and never substitutes old lead proof for the base. */
export async function cleanOrphanCrew(
  ctx: CrewContext,
  orphaned: OrphanCrew,
  base: { label: string; ref: string },
  say: (line: string) => void,
): Promise<{ removed: RemovedWorktree[] }> {
  const removed: RemovedWorktree[] = [];
  const resolved = runGit(
    ctx.cwd,
    ["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`],
    ctx.env,
  );
  if (!resolved.ok) return { removed };
  const against = { label: base.label, ref: resolved.out };
  for (const record of orphaned.records) {
    if (
      !orphaned.gone.has(record.id) ||
      !["stopped", "done", "failed", "merged", "handoff"].includes(record.state)
    )
      continue;
    const tip = runGit(
      ctx.cwd,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`],
      ctx.env,
    );
    if (
      !tip.ok ||
      !["ancestor", "replay"].includes(workOnRef(ctx.cwd, against.ref, tip.out, ctx.env))
    ) {
      say(`kept ${record.name}: ${orphanCrewLine(record)}`);
      continue;
    }
    const lines: string[] = [];
    const code = await runCrewRm(
      record.id,
      { ...ctx, error: (line) => lines.push(line), print: (line) => lines.push(line) },
      { against, skipParked: true },
    );
    for (const line of lines) say(line);
    if (code === 0) {
      const why = `its lead is gone; its work is on ${base.label}`;
      say(`removed ${record.name}: ${why}`);
      removed.push({
        branch: record.branch,
        name: basename(record.worktree),
        path: record.worktree,
        why,
      });
    }
  }
  return { removed };
}
