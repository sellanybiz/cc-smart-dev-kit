/**
 * Registering, and removing, the plugin's MCP servers at user scope — through Claude Code's
 * own `claude mcp` commands, never by editing `<config dir>/.claude.json` by hand (Claude
 * Code writes that file itself, and a second writer would lose its changes).
 *
 * WHAT SETUP DOES, PER SERVER (inside the state lock; every add and update writes its
 * `pending` record before its first command, so a run that stops halfway is finished or kept
 * by the next one, never read as someone else's server)
 *   - not registered: `claude mcp add-json --scope user <name> <json>`.
 *   - registered with exactly the JSON setup recorded: nothing at all.
 *   - registered with the JSON setup recorded, and that JSON has changed (a new pin): remove,
 *     then add again — `add-json` refuses a name that exists ("MCP server <name> already
 *     exists in user config", exit 1, seen live). The update marks the record `pending`
 *     before the remove, and the mark is cleared only after the add succeeds.
 *   - not registered, with a record marked `pending`: setup's own add or update was
 *     interrupted before its add, so the server is registered.
 *   - registered with exactly what setup would register, and a record marked `pending`: the
 *     add succeeded and only the record write did not land: kept, and the mark cleared.
 *   - not registered, with a record NOT marked pending: the person removed it. The record is
 *     forgotten, the server is not registered again, and one `·` line says how to add it back.
 *   - registered with something else, and not ours: LEFT ALONE, with a note — a server of the
 *     person's own is never taken over, the rule `src/setup/` follows for keys too.
 *   - registered with our record, but the file now holds a different config: the person
 *     changed it, so it is theirs: the record is forgotten, and restore leaves it.
 *   - a server the plugin no longer wants (Tavily without a key), still registered with our
 *     record: taken back (`claude mcp remove`), and the record goes. A server an earlier
 *     version registered and this one retired is planned the same way (`retired.ts`).
 *
 * WHEN CLAUDE CODE'S OWN CONFIG, OR THE RECORD, CANNOT BE READ
 *   Nothing is touched on any path: no server is added, removed, updated or forgotten, every
 *   record stays, and one line says `cannot read <file>: nothing changed`. Reading "not
 *   registered" out of a file that did not read would drop the record of a server that IS
 *   registered, and the plugin's servers would then stay registered with nothing tracking them.
 *   A record file that does not read is kept as it is, for the person to fix: it may still say
 *   what setup registered (`unreadableRecordsNote`).
 *
 * WHAT RESTORE DOES
 *   For each recorded server still holding the JSON setup registered: `claude mcp remove
 *   <name> --scope user`. Then the record goes. A server the person re-pointed stays. When
 *   the user config or the record cannot be read, every record stays, one line says so, and
 *   restore exits 1 — as it does when a removal fails (that record stays, for the next try).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CliPaths } from "../cli/paths";
import { tildify } from "../cli/paths";
import { shellQuote } from "../setup/launcher";
import { parseUserJson, readUserJson } from "../setup/user-json";
import {
  forgetMcpServer,
  type McpRecord,
  mcpRecordsFile,
  readMcpRecords,
  recordMcpServer,
} from "./records";
import type { McpServer, RetiredServerName, ServerName } from "./servers";

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
    const parsed = parseUserJson(text);
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
  /** One of the plugin's servers, or one it retired (only ever taken back: `retired.ts`). */
  name: RetiredServerName | ServerName;
  /** The JSON to register, for `add` and `update`. Empty for the other actions. */
  json: string;
  action: "add" | "foreign" | "gone" | "keep" | "remove" | "skip" | "update";
  /** A line setup prints as it is: `!` a warning, `·` information. */
  note: string | null;
  /**
   * Drop this server's record: it is not cc-smart-dev-kit's any more (the person re-pointed or
   * removed it), or the plugin does not want it any more.
   */
  forget?: true;
  /**
   * A `keep` whose record is marked `pending`: the interrupted update's `add-json` had in fact
   * succeeded, so the record is written again without the mark.
   */
  clearPending?: true;
}

/** The command that registers `name` with `json` again — the one setup itself runs. */
export function addCommand(name: string, json: string): string {
  return `claude mcp add-json --scope user ${name} ${shellQuote(json)}`;
}

/**
 * The one line setup and restore print when Claude Code's own config cannot be read:
 * nothing was added, removed, updated or forgotten. `names` are the records that stay.
 */
export function unreadableUserConfigNote(file: string, names: readonly string[]): string {
  const kept = [...names].sort();
  const which =
    kept.length === 0
      ? "no MCP server is touched"
      : `the MCP servers cc-smart-dev-kit registered stay as they are: ${kept.join(", ")}`;
  return `! cannot read ${file}: nothing changed — ${which}`;
}

/**
 * The one line setup and restore print when cc-smart-dev-kit's own record of the servers
 * (`mcp-servers.json`) cannot be read: no server is added, removed or updated, and the file
 * stays as it is — it may still hold what setup registered, and only a person can tell.
 */
export function unreadableRecordsNote(file: string, reason: string): string {
  return (
    `! cannot read ${file} (${reason}): nothing changed — no MCP server is touched, and the ` +
    "file stays. Fix it by hand, then run the command again"
  );
}

/** The note for a server that is registered with a config cc-smart-dev-kit did not write. */
function changedByPersonNote(name: string): string {
  return (
    `! ${name} is registered with a config cc-smart-dev-kit did not write: left alone, and no longer ` +
    `managed (restore keeps it). To hand it back: claude mcp remove ${name} --scope user, then setup`
  );
}

/** The note for a server that is registered already, and not by cc-smart-dev-kit. */
export function registeredByOthersNote(name: string): string {
  return (
    `! ${name} is registered already, and not by cc-smart-dev-kit: left alone. ` +
    `To let setup manage it: claude mcp remove ${name} --scope user`
  );
}

/** The `·` line for a recorded server the person removed: gone, and how to bring it back. */
function goneNote(name: string, registeredJson: string): string {
  return (
    `· MCP server ${name} is not registered any more: the record was forgotten. ` +
    `To add it back: ${addCommand(name, registeredJson)}`
  );
}

/**
 * What setup does about each server. `live` is what Claude Code holds now. Null: it could not
 * be read, so nothing is touched — every record stays, nothing is added or forgotten, and the
 * caller prints `unreadableUserConfigNote` (one line, not one per server).
 */
export function planMcpServers(
  servers: readonly McpServer[],
  records: Record<string, McpRecord>,
  live: Record<string, unknown> | null,
): McpPlanEntry[] {
  if (live === null) {
    return servers.map((server) => ({ action: "keep", json: "", name: server.name, note: null }));
  }
  return servers.map((server) => {
    const { name, json } = server;
    const recorded = records[name];
    const current = live[name];
    const skipNote = server.skipped === undefined ? null : `! ${name}: skipped — ${server.skipped}`;
    if (server.skipped !== undefined) {
      // The plugin does not want this server (a key the machine does not have). A record
      // still holding a registration of ours is taken back; anything else is left alone.
      if (recorded === undefined) {
        return { action: "skip", json, name, note: skipNote };
      }
      if (current !== undefined && sameConfig(recorded.json, current)) {
        return { action: "remove", json: "", name, note: skipNote };
      }
      if (current === undefined) {
        return {
          action: "gone",
          forget: true,
          json: "",
          name,
          note: `· MCP server ${name} is not registered any more: the record was forgotten`,
        };
      }
      // Something of the person's is registered under this name now: it is theirs.
      return { action: "foreign", forget: true, json, name, note: skipNote };
    }
    if (recorded === undefined) {
      return current !== undefined
        ? { action: "foreign", json, name, note: registeredByOthersNote(name) }
        : { action: "add", json, name, note: null };
    }
    if (current === undefined) {
      return recorded.pending === true
        ? // Setup's own update stopped between its remove and its add: finish it.
          { action: "add", json, name, note: null }
        : // The person removed it: theirs to keep away, and the record goes with one `·` line.
          { action: "gone", forget: true, json: "", name, note: goneNote(name, recorded.json) };
    }
    if (recorded.pending === true) {
      // First: what setup would register is there. Its own add (a first one, or an update's)
      // succeeded and only the record write did not land: keep it, and clear the mark. Asked
      // before the next test, because a first add's pending record holds that same json.
      if (sameConfig(json, current)) {
        return { action: "keep", clearPending: true, json, name, note: null };
      }
      if (sameConfig(recorded.json, current)) {
        // The update's remove never ran (or failed): run the whole update again.
        return { action: "update", json, name, note: null };
      }
      // Someone else wrote it while the update was in flight: theirs.
      return { action: "foreign", forget: true, json, name, note: changedByPersonNote(name) };
    }
    if (sameConfig(recorded.json, current)) {
      return recorded.json === json
        ? { action: "keep", json, name, note: null }
        : { action: "update", json, name, note: null };
    }
    // Ours by record, something else in the file: the person changed it.
    return { action: "foreign", forget: true, json, name, note: changedByPersonNote(name) };
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
    case "remove":
      return [["claude", "mcp", "remove", entry.name, "--scope", "user"]];
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
  /** One `+`, `~` or `-` line per registration change, or `!` when a command failed. */
  changes: string[];
  notes: string[];
  ok: boolean;
  /** What to record as registered now (the caller writes it inside its lock). */
  registered: { json: string; name: string }[];
  /** Servers whose record must be forgotten: the person changed them, or they are gone. */
  forgotten: string[];
  /** Servers this run took out of the user config: their `claude mcp remove` succeeded. */
  removed: string[];
  /** The commands a dry run would have run, as `$` lines. */
  wouldRun: string[];
}

/**
 * Runs the plan with `claude`. `ok` is false when a command failed, or when `claude` is not
 * on PATH (`which` returns null: nothing is run).
 *
 * `markPending(name, json)` is called before the first command of every add and every update
 * — before an update's own `claude mcp remove`, before a first `add-json` — so an interrupted
 * one is known the next time (`records.ts` `markMcpServerAdding`); a dry run never calls it.
 * Every other write is the caller's, after this returns. The caller runs this inside the state
 * lock, so no second setup reads or writes the records in between.
 */
export function applyMcpServers(
  plan: readonly McpPlanEntry[],
  run: ClaudeRun,
  which: (command: string) => null | string,
  dryRun: boolean,
  markPending: (name: string, json: string) => void,
): McpApplyResult {
  const result: McpApplyResult = {
    changes: [],
    forgotten: [],
    notes: [],
    ok: true,
    registered: [],
    removed: [],
    wouldRun: [],
  };
  for (const entry of plan) {
    if (entry.note !== null) result.notes.push(entry.note);
    if (entry.forget === true) result.forgotten.push(entry.name);
    const argvList = commands(entry);
    if (argvList.length === 0) {
      // The mark an interrupted update left, cleared: the record is written again below.
      if (entry.clearPending === true && !dryRun) {
        result.registered.push({ json: entry.json, name: entry.name });
      }
      continue;
    }
    if (dryRun) {
      result.wouldRun.push(...argvList.map(line));
      continue;
    }
    if (which("claude") === null) {
      result.ok = false;
      const undone = entry.action === "remove" ? "removed" : "registered";
      result.notes.push(
        `! The claude command is not on PATH, so ${entry.name} was not ${undone}. Run it once it is.`,
      );
      continue;
    }
    if (entry.action === "update" || entry.action === "add") markPending(entry.name, entry.json);
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
    if (entry.action === "remove") {
      result.changes.push(`- MCP server ${entry.name} removed from your user config`);
      result.forgotten.push(entry.name);
      result.removed.push(entry.name);
      continue;
    }
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
  /**
   * The record file could not be read: nothing was removed, and the file must stay (ST-5) —
   * it may hold what setup registered. The caller counts this as a failure.
   */
  recordsUnreadable: boolean;
}

/**
 * Takes back exactly what setup registered: each recorded server that still holds the JSON
 * setup wrote leaves the user config. A server the person re-pointed, or that is gone
 * already, is left alone (its record goes). When Claude Code's own config cannot be read,
 * nothing is removed and nothing is forgotten: every record stays, so a later restore can
 * still take the servers back, and one line says so.
 */
export function removeMcpServers(
  paths: CliPaths,
  run: ClaudeRun,
  which: (command: string) => null | string,
  dryRun: boolean,
  stateDir: string = paths.stateDir,
): McpRemoval {
  const result: McpRemoval = {
    forgotten: [],
    kept: [],
    notes: [],
    recordsUnreadable: false,
    removed: [],
    wouldRun: [],
  };
  let records: Record<string, McpRecord>;
  try {
    records = readMcpRecords(stateDir);
  } catch (error) {
    result.recordsUnreadable = true;
    result.notes.push(
      unreadableRecordsNote(
        tildify(mcpRecordsFile(stateDir), paths.home),
        error instanceof Error ? error.message : String(error),
      ),
    );
    return result;
  }
  const live = readUserServers(paths.userConfigFile);
  if (live === null) {
    result.kept.push(...Object.keys(records).sort());
    result.notes.push(
      unreadableUserConfigNote(tildify(paths.userConfigFile, paths.home), Object.keys(records)),
    );
    return result;
  }
  for (const [name, record] of Object.entries(records)) {
    const current = live[name];
    if (current === undefined) {
      // Gone already: nothing to remove, and nothing left to track. (A record still marked
      // `pending` is setup's own interrupted update, but restore has nothing to take back
      // either way: the server is not registered.)
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

/**
 * A server of one of the plugin's names registered somewhere that WINS OVER the user scope:
 * the LOCAL scope (Claude Code's own file, `projects[<cwd>].mcpServers`) or a project's
 * `.mcp.json` in the folder the command runs in (or in a parent, up to the folder holding
 * `.git`). A copy there takes precedence over the user-scope one, so the plugin's own server is
 * not the one starting — the same shape as the user-scope case, one scope down (premium review,
 * 2026-10-17). Returns what runs instead and the file it is in, or null.
 */
export function overridingServer(
  userConfigFile: string,
  cwd: string,
  name: string,
): null | { config: unknown; file: string } {
  const fromLocal = localServers(userConfigFile, cwd)[name];
  if (fromLocal !== undefined) return { config: fromLocal, file: userConfigFile };
  for (const file of projectMcpFiles(cwd)) {
    const fromProject = readProjectServers(file)[name];
    if (fromProject !== undefined) return { config: fromProject, file };
  }
  return null;
}

/** The local-scope servers for `cwd`: `projects[<cwd>].mcpServers` in Claude Code's own file. */
function localServers(userConfigFile: string, cwd: string): Record<string, unknown> {
  try {
    const parsed = readUserJson(userConfigFile);
    const projects = (parsed as { projects?: unknown } | null)?.projects;
    if (typeof projects !== "object" || projects === null) return {};
    const entry = (projects as Record<string, { mcpServers?: unknown }>)[cwd];
    const servers = entry?.mcpServers;
    return typeof servers === "object" && servers !== null && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The `mcpServers` of one `.mcp.json` (a project's own file). `{}` when it is not readable. */
function readProjectServers(file: string): Record<string, unknown> {
  try {
    const parsed = readUserJson(file);
    const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
    return typeof servers === "object" && servers !== null && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The `.mcp.json` files that could speak for this folder, nearest first: the folder itself, then
 * each parent up to (and including) the one holding `.git`. Beyond that is not this project.
 */
function projectMcpFiles(cwd: string): string[] {
  const files: string[] = [];
  let folder = resolve(cwd);
  for (let depth = 0; depth < 40; depth += 1) {
    files.push(join(folder, ".mcp.json"));
    const parent = dirname(folder);
    if (parent === folder || existsSync(join(folder, ".git"))) break;
    folder = parent;
  }
  return files;
}
