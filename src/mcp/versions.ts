/**
 * The exact version of every MCP server cc-smart-dev-kit starts.
 *
 * WHY PINNED
 *   A server started as `@latest` asks the registry on EVERY session start and installs
 *   whatever was published a minute ago — code that then runs on the machine, with the
 *   person's environment. It also makes starts slow: re-resolving a whole dependency tree
 *   takes 23–27 seconds against Claude Code's 30-second start limit, so the server fails
 *   whenever the machine is busy; pinned, the same start took 1.1 seconds (measured in the
 *   project this was ported from). A pin is a version at least three days old.
 *
 * TO MOVE ONE
 *   Change it here, run `cc-smart-dev-kit setup` again, restart Claude Code, and check the
 *   server still starts (`cc-smart-dev-kit doctor`). The Playwright pin has one more check:
 *   `cc-smart-dev-kit browser check` drives two real sessions on one Chrome through the tab
 *   filter, which leans on how this version talks to Chrome over CDP — and the picker reads
 *   one private field of the playwright-core inside it.
 */
export const MCP_VERSIONS = {
  /** `@playwright/mcp` — started by `cc-smart-dev-kit browser mcp`. */
  playwright: "0.0.83",
  /** `@modelcontextprotocol/server-sequential-thinking`. */
  sequentialThinking: "2026.8.31",
  /**
   * github.com/oraios/serena at a commit on its main branch (it reports 2.0.0.dev0). A full
   * commit id, so `uvx` starts it from its own cache and never has to ask GitHub.
   */
  serena: "d0f7f92631c23dc4c5ed0b5ccd35bc623b19a809",
} as const;

/** Tavily's remote MCP server: an HTTP server, so no version to pin. */
export const TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";
