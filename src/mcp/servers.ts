/**
 * The MCP servers `cc-smart-dev-kit setup` registers at USER scope, and the JSON each one is
 * registered with.
 *
 * WHY USER SCOPE
 *   A server served from a plugin gets a new tool-name prefix, which would break every
 *   permission rule, hook matcher and agent tool list that names `mcp__<server>__*`. A
 *   server from a project file (`.mcp.json`) or the "local" scope is stopped by Claude Code
 *   as soon as the session's folder changes — and a session that works in a worktree moves
 *   folders. Registered for the user, the names stay and the servers stay.
 *
 * WHAT THE PLUGIN REGISTERS
 *   - `playwright`: the browser (`browser/launcher.ts`): the Playwright MCP server on the
 *     person's own Chrome, through the Playwright extension, in the profile `claude-code`.
 *   - `sequential-thinking`: the general reasoning server.
 *   - `tavily-websearch`: Tavily's remote HTTP server. Its key is never written here: the
 *     header carries `${TAVILY_API_KEY}`, which Claude Code fills in from its own
 *     environment when it connects, and the key itself lives in the person's environment or
 *     in a key file only they can read (`tavily.ts`). Without a key the server is skipped.
 *
 * WHAT IT NO LONGER REGISTERS
 *   `RETIRED_SERVER_NAMES`: a server an earlier version registered. The next setup takes back
 *   a registration of its own (`retired.ts`); one of the person's own under that name stays.
 *
 * A project's own servers are the project's: the plugin never knows them.
 */
import { TAVILY_SERVER_NAME } from "./names";
import { MCP_VERSIONS, TAVILY_MCP_URL } from "./versions";

/** The servers this plugin manages, in the order setup registers them. */
export const SERVER_NAMES = ["playwright", "sequential-thinking", TAVILY_SERVER_NAME] as const;

export type ServerName = (typeof SERVER_NAMES)[number];

/**
 * The servers an earlier version registered and this one does not. `serena` went in 0.6.0:
 * one server per session, gigabytes of memory each, for tools sessions seldom called.
 */
export const RETIRED_SERVER_NAMES = ["serena"] as const;

export type RetiredServerName = (typeof RETIRED_SERVER_NAMES)[number];

/** One server's registration: the name, and the JSON `claude mcp add-json` takes. */
export interface McpServer {
  name: ServerName;
  /** The exact JSON, as one line. */
  json: string;
  /**
   * A note instead of a registration: the server is left out, and setup says why. Set only
   * for `tavily-websearch` without a key.
   */
  skipped?: string;
}

/** What building the registrations needs from the machine. */
export interface McpContext {
  /**
   * How a program starts the launcher (`launcherArgv`): it finds bun itself, whatever PATH
   * Claude Code was started with. The `sh` launcher's path off Windows; on Windows
   * `cmd.exe /c <the .cmd launcher>`, because a program there cannot run a `sh` script (ST-7).
   */
  launcher: readonly string[];
  /** `bunx`, as an absolute path when there is one. */
  bunx: string;
  /**
   * The Tavily key's state: `key: true` when one is available, else the reason it is not —
   * that reason becomes the note setup prints (`skipped — <reason>`).
   */
  tavily: { key: true } | { key: false; reason: string };
}

function json(config: Record<string, unknown>): string {
  return JSON.stringify(config);
}

/** The longest ONE tool call may run — a Tavily research. */
const LONG_CALL_MS = 300_000;

/** Every server, with the JSON to register it by. */
export function mcpServers(context: McpContext): McpServer[] {
  const [command, ...before] = context.launcher;
  return [
    {
      name: "playwright",
      // `command` first, then `args`: the order every earlier setup wrote, so a machine whose
      // registration is the same as before sees the same JSON text (`planMcpServers`).
      json: json({ command, args: [...before, "browser", "mcp"] }),
    },
    {
      name: "sequential-thinking",
      json: json({
        args: [
          "-y",
          `@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}`,
        ],
        command: context.bunx,
      }),
    },
    context.tavily.key
      ? {
          name: TAVILY_SERVER_NAME,
          json: json({
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code at connect time.
            headers: { Authorization: "Bearer ${TAVILY_API_KEY}" },
            timeout: LONG_CALL_MS,
            type: "http",
            url: TAVILY_MCP_URL,
          }),
        }
      : {
          name: TAVILY_SERVER_NAME,
          json: "",
          skipped: context.tavily.reason,
        },
  ];
}
