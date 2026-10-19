/**
 * What the plugin's MCP servers (`SERVER_NAMES`) look like on this machine right now — one
 * read-only question, answered for `cc-smart-dev-kit mcp status` (the installer reads it,
 * `--json`) and for `doctor`'s `!` line. A retired name is not one of them: a server of the
 * person's own under it is never offered for replacement.
 *
 * WHY IT EXISTS (live, 2026-10-17). A project's own script had registered every one of the
 * plugin's server names at user scope before cc-smart-dev-kit was installed. `setup` left them
 * all alone — the rule: a person's own server is never taken over — and printed one `!` line
 * per server saying so. Among the installer's output nobody
 * read it, so the old browser kept starting and the plugin's own never took over. The rule
 * stays; what changes is that the INSTALLER now asks, showing what runs instead.
 *
 * ONE HOME. "Is this ours?" is `register.ts`'s own decision: a server is cc-smart-dev-kit's
 * only while the config in Claude Code's file is exactly the JSON its record holds
 * (`sameConfig`, the same call `planMcpServers` and `removeMcpServers` make). This module reads
 * the same two files and answers with the same rule; it writes nothing.
 */
import { basename } from "node:path";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { oneLine } from "../gateway/plain-text";
import { redactUrl } from "../setup/marketplace-access";
import { readMcpRecords } from "./records";
import { readUserServers, sameConfig } from "./register";
import { SERVER_NAMES, type ServerName } from "./servers";

/** A flag whose NEXT argument is a secret: `--api-key X`, `--token`, `-password`. */
const KEY_FLAG = /^--?[A-Za-z0-9-]*(key|token|secret|password|auth)[A-Za-z0-9-]*$/i;

/** A name that looks like a key, wherever it is: `tavilyApiKey=…`, `--token=…`. */
const KEY_WORD = /(key|token|secret|password|auth)/i;

/**
 * One argument as it is safe to print: a value that follows a key-like flag (`--api-key X`) and
 * the value of a `name=value` whose name looks like one (`--token=X`, `tavilyApiKey=X`) become
 * `•••`. The flag or the name stays, so the line still says what the server is.
 */
function safeArg(args: readonly string[], index: number): string {
  const arg = args[index] ?? "";
  const previous = index === 0 ? "" : (args[index - 1] ?? "");
  if (KEY_FLAG.test(previous)) return "•••";
  // An argument that is itself a URL (`npx mcp-remote <url>`) goes through the URL's one home.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return oneLine(redactUrl(arg), 200);
  const equals = arg.indexOf("=");
  if (equals > 0 && KEY_WORD.test(arg.slice(0, equals))) {
    return `${arg.slice(0, equals)}=•••`;
  }
  return oneLine(arg, 200);
}

/**
 * What a registered server runs, as one line: its command and its arguments, or the URL of a
 * remote server. NEVER its `env` or `headers`: a server config can hold a key there (the
 * Tavily registration carries `${TAVILY_API_KEY}`, and a person's own server may carry the key
 * itself), and this line is printed. A key can also sit in a URL's query, fragment or userinfo,
 * or in an argument — `npx mcp-remote https://host/mcp?key=…`, `--api-key X`, `--token=X` — so
 * a URL goes through `redactUrl` (the one home for a URL safe to print) and such an argument's
 * VALUE becomes `•••`.
 */
export function describeServerConfig(value: unknown): string {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const url = typeof record.url === "string" ? record.url : "";
  if (url !== "") return oneLine(redactUrl(url), 200);
  const command = typeof record.command === "string" ? record.command : "";
  const args = Array.isArray(record.args)
    ? record.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (command === "" && args.length === 0) return "an unknown command";
  // The command's own name only: a key never sits in a long path, and the path is noise.
  const named = command === "" ? "" : basename(command);
  const shown = [named, ...args.map((_arg, index) => safeArg(args, index))].filter(
    (one) => one !== "",
  );
  return oneLine(shown.join(" "), 200);
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
  | "unreadable"
  /**
   * Registered, but what setup registered cannot be read back (`mcp-servers.json` is there and
   * unreadable). NEVER "foreign": the installer offers to replace a foreign server, and a
   * server that is probably the plugin's own must not be offered for replacement because of a
   * read error (premium review, 2026-10-17). It is listed with the reason instead.
   */
  | "unknown";

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
    case "unknown":
      return (
        `! ${status.name} is registered, but what cc-smart-dev-kit registered cannot be read back: ` +
        `check it by hand (claude mcp get ${status.name}), then run ${COMMAND} setup`
      );
  }
}

/**
 * The state of each of the plugin's servers — EVERY ONE, whatever this machine has a key for.
 * Reads Claude Code's own config and the plugin's records; writes nothing.
 *
 * Tavily is reported even with no key (`readTavilyKey` source "none"): a person's own
 * `tavily-websearch` is registered by SOMETHING ELSE, and that is exactly when the installer
 * must offer to replace it. Leaving it out — the first cut of this module did — meant a server
 * a project's own script had registered was never mentioned on a machine whose Tavily key
 * arrived later in the installer's step 7, and it went on shadowing the plugin's own (premium
 * review, 2026-10-17; the live scenario is tested in `mcp.test.ts`).
 */
export function mcpServerStatus(
  paths: CliPaths,
  stateDir: string = paths.stateDir,
): McpServerStatus[] {
  const servers = readUserServers(paths.userConfigFile);
  const names: ServerName[] = [...SERVER_NAMES];
  if (servers === null) {
    return names.map((name) => ({ name, runsWhat: null, state: "unreadable" }));
  }
  /** What setup registered, or null when that record file cannot be read (state "unknown"). */
  let records: null | Record<string, { json: string }> = null;
  try {
    records = readMcpRecords(stateDir);
  } catch {
    records = null;
  }
  return names.map((name) => {
    const current = servers[name];
    if (current === undefined) return { name, runsWhat: null, state: "missing" };
    if (records === null) return { name, runsWhat: null, state: "unknown" };
    const record = records[name];
    return record !== undefined && sameConfig(record.json, current)
      ? { name, runsWhat: null, state: "ours" }
      : { name, runsWhat: describeServerConfig(current), state: "foreign" };
  });
}
