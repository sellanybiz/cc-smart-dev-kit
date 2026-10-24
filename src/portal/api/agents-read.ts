/** The shared agent-view parsers, with an asynchronous child so reads never freeze the portal. */
import { CLAUDE_TIMEOUT_MS, claudeArgv, findClaude, parseAgentPresence } from "../../crew/claude";
import { sessionAgentRows } from "../../sessions/finished";
import { commandContext } from "../../update/apply";
import type { PortalContext } from "../context";

/** No cache: a removal must see today's ownership and terminal state, not a page's earlier view. */
export async function readPortalAgents(ctx: PortalContext, cwd: string) {
  const binary = findClaude({
    home: ctx.paths.home,
    platform: ctx.machine.platform,
    which: ctx.which,
  });
  if (binary === null) return { crew: null, sessions: null };
  const command = claudeArgv(binary, ["agents", "--json", "--all"], ctx.machine.platform);
  if ("why" in command) return { crew: null, sessions: null };
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
    if (code !== 0 || child.signalCode) return { crew: null, sessions: null };
    const crew = parseAgentPresence(output);
    if (crew === null) return { crew: null, sessions: null };
    return { crew, sessions: sessionAgentRows(output) };
  } catch {
    // A failed read is unknown, never an empty successful view that could prove absence.
    return { crew: null, sessions: null };
  }
}
