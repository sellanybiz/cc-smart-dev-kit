/**
 * Registering, and removing, the plugin's MCP servers at user scope — through Claude Code's
 * own `claude mcp` commands, never by editing `<config dir>/.claude.json` by hand (Claude
 * Code writes that file itself, and a second writer would lose its changes).
 *
 * WHAT SETUP DOES, PER SERVER
 *   - not registered: `claude mcp add-json --scope user <name> <json>`.
 *   - registered with exactly the JSON setup recorded: nothing at all.
 *   - registered with the JSON setup recorded, and that JSON has changed (a new pin): remove,
 *     then add again — `add-json` refuses a name that exists ("MCP server <name> already
 *     exists in user config", exit 1, seen live).
 *   - registered with something else, and not ours: LEFT ALONE, with a note — a server of the
 *     person's own is never taken over, the rule `src/setup/` follows for keys too.
 *   - registered with our record, but the file now holds a different config: the person
 *     changed it, so it is theirs: the record is forgotten, and restore leaves it.
 *
 * WHAT RESTORE DOES
 *   For each recorded server still holding the JSON setup registered: `claude mcp remove
 *   <name> --scope user`. Then the record goes. A server the person re-pointed stays.
 */
import { readFileSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { forgetMcpServer, readMcpRecords, recordMcpServer } from "./records";
import type { McpServer, ServerName } from "./servers";

/** Runs one `claude` command. A test hands in a fake; the CLI passes `Bun.spawnSync`. */
export type ClaudeRun = (argv: string[]) => { ok: boolean; out: string };

/**
 * The user-scope MCP servers Claude Code has registered, from its own config file
 * (`<config dir>/.claude.json`), keyed by name. `{}` when the file does not exist yet — a
 * fresh config folder, where nothing is registered. Null when the file is there but does not
 * read: a caller then knows nothing, rather than "nothing is registered", and takes no server
 * of the person's over.
 */
export function readUserServers(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    return typeof servers === "object" && servers !== null && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

/** The names Claude Code has registered at user scope, sorted. */
export function registeredNames(file: string): string[] | null {
  const servers = readUserServers(file);
  return servers === null ? null : Object.keys(servers).sort();
}

/** Does `live` (Claude Code's copy of the config) hold exactly the JSON `json` says? */
export function sameConfig(json: string, live: unknown): boolean {
  let wanted: unknown;
  try {
    wanted = JSON.parse(json);
  } catch {
    return false;
  }
  return deepEqual(wanted, live);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
}

export interface McpPlanEntry {
  name: ServerName;
  /** The JSON to register, for `add` and `update`. Empty for `skip`. */
  json: string;
  action: "add" | "foreign" | "keep" | "skip" | "update";
  /** A note for setup's output (`!`): the server is left alone or skipped. */
  note: string | null;
}

/**
 * What setup does about each server. `live` is what Claude Code holds now (null: it could
 * not be read, so nothing is taken over — every server that is not ours is left alone).
 */
export function planMcpServers(
  servers: readonly McpServer[],
  records: Record<string, { json: string }>,
  live: Record<string, unknown> | null,
): McpPlanEntry[] {
  return servers.map((server) => {
    const { name, json } = server;
    if (server.skipped !== undefined) {
      return { name, json: "", action: "skip", note: `! ${name}: skipped — ${server.skipped}` };
    }
    const recorded = records[name];
    const current = live === null ? undefined : live[name];
    if (recorded === undefined) {
      if (current !== undefined) {
        return {
          name,
          json,
          action: "foreign",
          note:
            `! ${name} is registered already, and not by cc-smart-dev-kit: left alone. ` +
            `To let setup manage it: claude mcp remove ${name} --scope user`,
        };
      }
      return { name, json, action: "add", note: null };
    }
    if (sameConfig(recorded.json, current)) {
      return recorded.json === json
        ? { name, json, action: "keep", note: null }
        : { name, json, action: "update", note: null };
    }
    // Ours by record, something else in the file: the person changed it (or removed it).
    return {
      name,
      json,
      action: "foreign",
      note:
        `! ${name} is registered with a config cc-smart-dev-kit did not write: left alone, and no longer ` +
        `managed (restore keeps it). To hand it back: claude mcp remove ${name} --scope user, then setup`,
    };
  });
}

function line(argv: string[]): string {
  return `$ ${argv.join(" ")}`;
}

/** The `claude mcp` commands one entry needs, in order. */
function commands(entry: McpPlanEntry): string[][] {
  switch (entry.action) {
    case "add":
      return [["claude", "mcp", "add-json", "--scope", "user", entry.name, entry.json]];
    case "update":
      return [
        ["claude", "mcp", "remove", entry.name, "--scope", "user"],
        ["claude", "mcp", "add-json", "--scope", "user", entry.name, entry.json],
      ];
    default:
      return [];
  }
}

export interface McpApplyResult {
  /** One `+` line per registration, or `!` when a command failed. */
  changes: string[];
  notes: string[];
  ok: boolean;
  /** What to record as registered now (the caller writes it inside its lock). */
  registered: { json: string; name: string }[];
  /** Servers whose record must be forgotten: the person changed them. */
  forgotten: string[];
  /** The commands a dry run would have run, as `$` lines. */
  wouldRun: string[];
}

/**
 * Runs the plan with `claude`. `ok` is false when a command failed, or when `claude` is not
 * on PATH (`which` returns null: nothing is run).
 */
export function applyMcpServers(
  plan: readonly McpPlanEntry[],
  run: ClaudeRun,
  which: (command: string) => null | string,
  dryRun: boolean,
): McpApplyResult {
  const result: McpApplyResult = {
    changes: [],
    forgotten: [],
    notes: [],
    ok: true,
    registered: [],
    wouldRun: [],
  };
  for (const entry of plan) {
    if (entry.note !== null) result.notes.push(entry.note);
    if (entry.action === "foreign" && entry.note !== null) result.forgotten.push(entry.name);
    const argvList = commands(entry);
    if (argvList.length === 0) continue;
    if (dryRun) {
      result.wouldRun.push(...argvList.map(line));
      continue;
    }
    if (which("claude") === null) {
      result.ok = false;
      result.notes.push(
        `! The claude command is not on PATH, so ${entry.name} was not registered. Run it once it is.`,
      );
      continue;
    }
    let failed = false;
    for (const argv of argvList) {
      const outcome = run(argv);
      if (!outcome.ok) {
        failed = true;
        result.ok = false;
        const reason = outcome.out.trim().split("\n").at(-1) ?? "";
        result.notes.push(`! ${line(argv)} failed (${reason})`);
        break;
      }
    }
    if (failed) continue;
    const verb = entry.action === "add" ? "+" : "~";
    result.changes.push(
      `${verb} MCP server ${entry.name} ${entry.action === "add" ? "registered" : "updated"} for your user`,
    );
    result.registered.push({ json: entry.json, name: entry.name });
  }
  return result;
}

/** Writes the records after `applyMcpServers` ran. Never in a dry run. */
export function recordApplied(stateDir: string, applied: McpApplyResult, now: string): void {
  for (const server of applied.registered) {
    recordMcpServer(stateDir, server.name, server.json, now);
  }
  for (const name of applied.forgotten) {
    forgetMcpServer(stateDir, name);
  }
}

export interface McpRemoval {
  /** One `-` line per server removed. */
  removed: string[];
  notes: string[];
  /** Names that could not be removed: the record stays, so a later restore tries again. */
  kept: string[];
  /** Names that are no longer cc-smart-dev-kit's: their record can go. */
  forgotten: string[];
  wouldRun: string[];
}

/**
 * Takes back exactly what setup registered: each recorded server that still holds the JSON
 * setup wrote leaves the user config. A server the person re-pointed, or that is gone
 * already, is left alone (its record goes).
 */
export function removeMcpServers(
  paths: CliPaths,
  run: ClaudeRun,
  which: (command: string) => null | string,
  dryRun: boolean,
  stateDir: string = paths.stateDir,
): McpRemoval {
  const result: McpRemoval = { forgotten: [], kept: [], notes: [], removed: [], wouldRun: [] };
  let records: Record<string, { json: string }>;
  try {
    records = readMcpRecords(stateDir);
  } catch (error) {
    result.notes.push(
      `! the MCP servers cc-smart-dev-kit registered cannot be read back (${
        error instanceof Error ? error.message : String(error)
      }): none was removed`,
    );
    return result;
  }
  const live = readUserServers(paths.userConfigFile);
  for (const [name, record] of Object.entries(records)) {
    const current = live?.[name];
    if (current === undefined) {
      // Gone already: nothing to remove, and nothing left to track.
      result.notes.push(`  MCP server ${name} is not registered any more; nothing to remove`);
      result.forgotten.push(name);
      continue;
    }
    if (!sameConfig(record.json, current)) {
      result.notes.push(
        `  MCP server ${name} holds a config cc-smart-dev-kit did not write: left alone (it is yours now)`,
      );
      result.forgotten.push(name);
      continue;
    }
    const argv = ["claude", "mcp", "remove", name, "--scope", "user"];
    if (dryRun) {
      result.wouldRun.push(line(argv));
      continue;
    }
    if (which("claude") === null) {
      result.kept.push(name);
      result.notes.push(
        `! The claude command is not on PATH, so MCP server ${name} was not removed. Run it once it is, then restore again.`,
      );
      continue;
    }
    const outcome = run(argv);
    if (outcome.ok) {
      result.removed.push(`- MCP server ${name} removed from your user config`);
      result.forgotten.push(name);
    } else {
      result.kept.push(name);
      result.notes.push(
        `! ${line(argv)} failed (${outcome.out.trim().split("\n").at(-1) ?? ""}): the server is still registered`,
      );
    }
  }
  return result;
}
