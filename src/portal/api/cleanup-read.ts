/** Read synchronous cleanup facts off the server loop, through the CLI's one builder. */
import { z } from "zod";
import type { CrewCleanupAnswer } from "../../crew/cleanup-read";
import { runCliChild } from "../cli-child";
import type { PortalContext } from "../context";

const discardSchema = z.object({
  head: z.string(),
  archiveRef: z.string(),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  unmergedCommits: z.object({ count: z.number().nullable(), subjects: z.array(z.string()) }),
  changedFiles: z.array(z.string()),
  ignoredFiles: z.array(z.string()),
  lines: z.array(z.string()),
  question: z.string(),
});

const cleanupSchema = z.object({
  error: z.string().nullable(),
  stopped: z.array(
    z.object({
      crew: z.object({
        id: z.string(),
        name: z.string(),
        shortId: z.string().nullable(),
        state: z.string(),
      }),
      repo: z.string(),
      since: z.string(),
      days: z.number(),
      unmergedCommits: z.number().nullable(),
      line: z.string(),
      discard: z.object({ facts: discardSchema.nullable(), error: z.string().nullable() }),
    }),
  ),
});

/** A new read on every request: stale confirmation facts must not authorize a removal. */
export async function readCleanupOffLoop(
  ctx: PortalContext,
  cwd: string,
): Promise<CrewCleanupAnswer> {
  const run = await runCliChild(ctx, ["crew", "cleanup", "--json"], { cwd });
  if (run.error !== null) return { stopped: [], error: run.error };
  if (run.timedOut) return { stopped: [], error: "the cleanup facts did not answer in time" };
  try {
    const parsed = cleanupSchema.safeParse(JSON.parse(run.lines.join("\n")));
    if (!parsed.success)
      return { stopped: [], error: "the cleanup answer was not one this portal reads" };
    if (parsed.data.error !== null) return { stopped: [], error: parsed.data.error };
    if (run.exitCode !== 0)
      return { stopped: [], error: `the cleanup facts did not run (exit ${run.exitCode})` };
    return parsed.data;
  } catch {
    return { stopped: [], error: "the cleanup answer was not one this portal reads" };
  }
}
