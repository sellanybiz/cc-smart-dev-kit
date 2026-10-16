/**
 * What the plugin's four MCP servers look like on this machine right now — one read-only
 * question, answered for `cc-smart-dev-kit mcp status` (the installer reads it, `--json`) and
 * for `doctor`'s `!` line.
 *
 * WHY IT EXISTS (live, 2026-10-17). A project's own script had registered `playwright`,
 * `serena`, `sequential-thinking` and `tavily-websearch` at user scope before cc-smart-dev-kit
 * was installed. `setup` left them all alone — the rule: a person's own server is never taken
 * over — and printed one `!` line per server saying so. Among the installer's output nobody
 * read it, so the old browser kept starting and the plugin's own never took over. The rule
 * stays; what changes is that the INSTALLER now asks, showing what runs instead.
 *
 * ONE HOME. "Is this ours?" is `register.ts`'s own decision: a server is cc-smart-dev-kit's
 * only while the config in Claude Code's file is exactly the JSON its record holds
 * (`sameConfig`, the same call `planMcpServers` and `removeMcpServers` make). This module reads
 * the same two files and answers with the same rule; it writes nothing.
 */
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { oneLine } from "../gateway/plain-text";
import { readMcpRecords } from "./records";
import { readUserServers, sameConfig } from "./register";
import { SERVER_NAMES, type ServerName } from "./servers";
import { readTavilyKey } from "./tavily";

/**
 * What a registered server runs, as one line: its command and its arguments, or the URL of a
 * remote server. NEVER its `env` or `headers`: a server config can hold a key there (the
 * Tavily registration carries `${TAVILY_API_KEY}`, and a person's own server may carry the key
 * itself), and this line is printed.
 */
export function describeServerConfig(value: unknown): string {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const url = typeof record.url === "string" ? record.url : "";
  if (url !== "") return oneLine(url, 200);
  const command = typeof record.command === "string" ? record.command : "";
  const args = Array.isArray(record.args)
    ? record.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (command === "" && args.length === 0) return "an unknown command";
  return oneLine([command, ...args].join(" "), 200);
}

/** Where one of the plugin's servers stands. */
export type McpServerState =
  /** Registered, holding exactly the JSON the plugin's record has. */
  | "ours"
  /** Registered by something else, or changed since the plugin registered it. */
  | "foreign"
  /** Not registered at all. */
  | "missing"
  /** Claude Code's own config cannot be read: nothing can be said. */
  | "unreadable";

export interface McpServerStatus {
  name: ServerName;
  state: McpServerState;
  /** For a foreign one: what runs instead (never env or headers). Null otherwise. */
  runsWhat: null | string;
}

/**
 * The one line a person reads for one server, in `cc-smart-dev-kit mcp status`. The foreign one
 * shows what runs instead AND the exact command that hands the name back to setup — the same
 * line the installer prints when the person answers no.
 */
export function mcpServerStatusLine(status: McpServerStatus): string {
  switch (status.state) {
    case "ours":
      return `✓ ${status.name}: registered by cc-smart-dev-kit`;
    case "foreign":
      return (
        `! ${status.name}: registered by something else (${status.runsWhat ?? "an unknown command"}). ` +
        `To let setup manage it: claude mcp remove ${status.name} --scope user, then ${COMMAND} setup`
      );
    case "missing":
      return `· ${status.name}: not registered. To add it: ${COMMAND} setup`;
    case "unreadable":
      return `✗ ${status.name}: Claude Code's own config could not be read, so nothing can be said about it`;
  }
}

/** True when the plugin wants this server on this machine (Tavily needs a key). */
function wanted(
  name: ServerName,
  paths: CliPaths,
  env: Record<string, string | undefined>,
): boolean {
  return name !== "tavily-websearch" || readTavilyKey(paths, env).source !== "none";
}

/**
 * The state of each of the plugin's servers. Reads Claude Code's own config and the plugin's
 * records; writes nothing. The Tavily server is left out ("skipped") when the machine has no
 * key for it — there is nothing of ours to take over there.
 */
export function mcpServerStatus(
  paths: CliPaths,
  env: Record<string, string | undefined> = {},
  stateDir: string = paths.stateDir,
): McpServerStatus[] {
  const servers = readUserServers(paths.userConfigFile);
  const names = SERVER_NAMES.filter((name) => wanted(name, paths, env));
  if (servers === null) {
    return names.map((name) => ({ name, runsWhat: null, state: "unreadable" }));
  }
  let records: Record<string, { json: string }> = {};
  try {
    records = readMcpRecords(stateDir);
  } catch {
    // A record file that cannot be read says nothing about what is registered: every server
    // then reads as "foreign", which is what the installer would ask about. Nothing of ours is
    // taken over by this module either way.
    records = {};
  }
  return names.map((name) => {
    const current = servers[name];
    if (current === undefined) return { name, runsWhat: null, state: "missing" };
    const record = records[name];
    return record !== undefined && sameConfig(record.json, current)
      ? { name, runsWhat: null, state: "ours" }
      : { name, runsWhat: describeServerConfig(current), state: "foreign" };
  });
}
