/**
 * What `cc-smart-dev-kit setup` registered, so `restore` removes exactly that.
 *
 * The registrations themselves live in Claude Code's own user config, and only `claude mcp
 * add-json` / `remove` may change them. This record is cc-smart-dev-kit's own state
 * (`<stateDir>/mcp-servers.json`, like `owned.json` and `changed.json`): the name, the exact
 * JSON it was registered with, when, and whether an update is in flight (`pending`).
 * `restore` removes a server only while it still holds what setup registered — one the
 * person re-pointed is theirs, and stays.
 *
 * No key or token ever reaches this file: the registrations carry `${TAVILY_API_KEY}` as
 * text, and the key itself lives in the settings or the environment (`tavily.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../setup/write";

/** One server setup registered. */
export interface McpRecord {
  /** The exact JSON `claude mcp add-json` was given. */
  json: string;
  /** When it was registered (ISO time), for a person reading the file. */
  at: string;
  /**
   * An add or an update (`claude mcp remove`, then `add-json`) is in flight. The mark is
   * written BEFORE the first command runs and cleared only after the add succeeds, so an
   * interrupted one is told from a server the person took away or registered themselves: a
   * server that is registered no more WHILE this is set is the plugin's own half-finished
   * work, and setup registers it again; one that holds what setup was adding is kept.
   */
  pending?: boolean;
}

const RECORD_FILE = "mcp-servers.json";

export function mcpRecordsFile(stateDir: string): string {
  return join(stateDir, RECORD_FILE);
}

function isRecord(value: unknown): value is McpRecord {
  if (typeof value !== "object" || value === null) return false;
  const { at, json, pending } = value as Partial<McpRecord>;
  return (
    typeof json === "string" &&
    typeof at === "string" &&
    (pending === undefined || typeof pending === "boolean")
  );
}

/** The servers setup registered. Throws on a file that does not read. */
export function readMcpRecords(
  stateDir: string,
  file = mcpRecordsFile(stateDir),
): Record<string, McpRecord> {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const servers = (parsed as { servers?: unknown } | null)?.servers;
  if (
    typeof servers !== "object" ||
    servers === null ||
    !Object.values(servers).every((entry) => isRecord(entry))
  ) {
    throw new Error(`Invalid ${file}: expected { "servers": { <name>: { json, at } } }`);
  }
  return servers as Record<string, McpRecord>;
}

function writeRecords(_stateDir: string, servers: Record<string, McpRecord>, file: string): void {
  const sorted = Object.fromEntries(Object.entries(servers).sort(([a], [b]) => (a < b ? -1 : 1)));
  atomicWrite(file, `${JSON.stringify({ servers: sorted }, null, 2)}\n`, 0o600);
}

/** Record that setup registered `name` with `json`. */
export function recordMcpServer(
  stateDir: string,
  name: string,
  json: string,
  now: string,
  file = mcpRecordsFile(stateDir),
): void {
  const servers = readMcpRecords(stateDir, file);
  servers[name] = { json, at: now };
  writeRecords(stateDir, servers, file);
}

/** Stop tracking `name`: restore leaves it alone from now on. Nothing else changes. */
export function forgetMcpServer(
  stateDir: string,
  name: string,
  file = mcpRecordsFile(stateDir),
): void {
  const servers = readMcpRecords(stateDir, file);
  if (!(name in servers)) return;
  delete servers[name];
  writeRecords(stateDir, servers, file);
}

/**
 * Mark `name`'s record pending: an update is about to run `claude mcp remove` for it. Called
 * before that command runs, so a crash between the remove and the add is known the next time
 * (`register.ts` registers the server again). The record's json and at stay as they were: the
 * json is what is registered until the add succeeds.
 */
export function markMcpServerPending(
  stateDir: string,
  name: string,
  file = mcpRecordsFile(stateDir),
): void {
  const servers = readMcpRecords(stateDir, file);
  const record = servers[name];
  if (record === undefined || record.pending === true) return;
  servers[name] = { ...record, pending: true };
  writeRecords(stateDir, servers, file);
}

/**
 * The record before any `claude mcp add-json` setup runs for `name` (ST-4). A server is
 * registered the moment the add returns, so a run that dies after it — or that then finds the
 * state lock busy — used to leave a registration with no record, which every later setup read
 * as the person's own and never managed again. Written first, the record says "setup's own
 * add is in flight", and the next setup finishes or keeps it (`planMcpServers`).
 *
 * A record that is there already (an update, or one interrupted earlier) is only marked
 * pending, its json kept: that json is what is registered until the add succeeds. With no
 * record, a pending one of `json` is written. Called inside the state lock.
 */
export function markMcpServerAdding(
  stateDir: string,
  name: string,
  json: string,
  now: string,
  file = mcpRecordsFile(stateDir),
): void {
  const servers = readMcpRecords(stateDir, file);
  if (servers[name] !== undefined) {
    markMcpServerPending(stateDir, name, file);
    return;
  }
  servers[name] = { at: now, json, pending: true };
  writeRecords(stateDir, servers, file);
}
