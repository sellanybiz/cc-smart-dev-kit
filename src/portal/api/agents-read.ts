/** The shared agent-view parsers, with an asynchronous child so reads never freeze the portal. */
import { CLAUDE_TIMEOUT_MS, claudeArgv, findClaude } from "../../crew/claude";
import { sessionAgentRows } from "../../sessions/finished";
import { commandContext } from "../../update/apply";
import { PAGE_READ_FRESH_MS, shortCache } from "../cli-child";
import type { PortalContext } from "../context";

type AgentsRead = Awaited<ReturnType<typeof readPortalAgents>>;

/**
 * One agent list per folder, kept like the worktrees scan (`shortCache`'s rules). The cache
 * holds `{ read }` for a list that answered and `{ error }` for one that did not, which
 * `shortCache` never keeps.
 */
const lists = shortCache<string, { read: AgentsRead } | { error: AgentsRead }>(PAGE_READ_FRESH_MS);

/** Drops this portal's kept agent lists: an action may have started or ended a session. */
export function forgetAgentLists(ctx: PortalContext): void {
  lists.forget(ctx);
}

export async function readPortalAgentsForPage(
  ctx: PortalContext,
  cwd: string,
): Promise<AgentsRead> {
  const answer = await lists.read(ctx, cwd, async () => {
    const read = await readPortalAgents(ctx, cwd);
    return read.sessions === null ? { error: read } : { read };
  });
  return "error" in answer ? answer.error : answer.read;
}

/** No cache: a removal must see today's ownership and terminal state, not a page's earlier view. */
export async function readPortalAgents(ctx: PortalContext, cwd: string) {
  const binary = findClaude({
    home: ctx.paths.home,
    platform: ctx.machine.platform,
    which: ctx.which,
  });
  if (binary === null) return { sessions: null };
  const command = claudeArgv(binary, ["agents", "--json", "--all"], ctx.machine.platform);
  if ("why" in command) return { sessions: null };
  const context = commandContext(ctx.env, ctx.paths.home);
  try {
    const child = Bun.spawn(command.argv, {
      cwd,
      env: { ...context.env, HOME: ctx.paths.home, CLAUDE_CONFIG_DIR: ctx.paths.claudeConfigDir },
      stderr: "ignore",
      stdin: "ignore",
      stdout: "pipe",
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      windowsVerbatimArguments: command.verbatim,
    });
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0 || child.signalCode) return { sessions: null };
    return { sessions: sessionAgentRows(output) };
  } catch {
    // A failed read is unknown, never an empty successful view that could prove absence.
    return { sessions: null };
  }
}
