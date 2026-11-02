/**
 * The MCP servers' names, and nothing else.
 *
 * The router names Tavily's server in the answer it gives when a web search cannot run
 * (D44), so that name reaches `plugin/dist/router.js`. This module holds only the name:
 * `versions.ts` holds the pins, and a pin bump must never restart every machine's router
 * (`.claude/rules/bundles-and-releases.md`). `servers.ts` registers the server by it.
 */

import { COMMAND } from "../build-info/names";

/** The kit's task server, shared by setup and tool consumers. */
export const TASKS_SERVER_NAME = `${COMMAND}-tasks`;

/** Tavily's remote search server, registered as `tavily-websearch`. */
export const TAVILY_SERVER_NAME = "tavily-websearch";
