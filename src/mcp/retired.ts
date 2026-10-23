/**
 * What an earlier version set up and this one no longer does, and taking it back on the next
 * `cc-smart-dev-kit setup`. Today that is Serena, retired in 0.6.0 (`SERENA_RETIRED_IN`;
 * README § 0.6.0: Serena is removed).
 *
 * WHAT AN OLDER SETUP LEFT ON A MACHINE
 *   - the `serena` MCP server, registered at user scope, with its record in
 *     `<stateDir>/mcp-servers.json` (`records.ts`);
 *   - the context Serena was started with, a whole file setup owned:
 *     `<dataDir>/serena/contexts/worktree.yml` (tracked in `changed.json`);
 *   - the `serena-root` hook's records, one per session: `<stateDir>/serena-root/`.
 *
 * WHAT SETUP TAKES BACK, AND WHAT IT LEAVES
 *   - The registration, only while the record says setup made it AND Claude Code still holds
 *     exactly that JSON — the rule every server follows (`sameConfig`); for an update an older
 *     setup left half done (`pending`), setup's own shape counts too (`setupMadeIt`). It goes
 *     through Claude Code's own `claude mcp remove`, the way a Tavily server without a key goes
 *     (`planRetiredServers` feeds `applyMcpServers`). A `serena` the record does not own stays:
 *     setup never touches it, and `doctor` says, with a `·` line, that it has no record of it.
 *   - The context file, through the managed-file helpers (a backup first, then its
 *     `changed.json` entry dropped), while no registration in Claude Code's own config still
 *     names it: a Serena of the person's own may start with it. Its folder goes too, but only
 *     while nothing else is in it.
 *   - The record folder: the plugin's own state, which nothing reads any more.
 *
 * `restore` needs nothing from here: it takes back a recorded registration and a tracked file
 * the way it takes back any other (`removeMcpServers`, `restore()`).
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { parseUserJson } from "../setup/user-json";
import { forgetChange, realTarget, removeManagedFile } from "../setup/write";
import type { McpCheck } from "./doctor";
import { type McpRecord, readMcpRecords } from "./records";
import { type McpPlanEntry, readUserServers, sameConfig } from "./register";
import { RETIRED_SERVER_NAMES, type RetiredServerName } from "./servers";
import { describeServerConfig } from "./status";

/** The release that dropped Serena: the one home of that number in what setup and doctor say. */
export const SERENA_RETIRED_IN = "0.6.0";

/** Where an older setup kept Serena's pieces, from the folders the plugin owns. */
export function serenaLeftoverPaths(paths: Pick<CliPaths, "dataDir" | "stateDir">): {
  /** `<dataDir>/serena/`: the folder setup made for the context. */
  folder: string;
  /** The context Serena was started with. */
  contextFile: string;
  /** The `serena-root` hook's per-session records. */
  recordDir: string;
} {
  const folder = join(paths.dataDir, "serena");
  return {
    folder,
    contextFile: join(folder, "contexts", "worktree.yml"),
    recordDir: join(paths.stateDir, "serena-root"),
  };
}

/** Where an older setup started Serena from: the start of its `--from` argument. */
const SERENA_SOURCE_PREFIX = "git+https://github.com/oraios/serena@";

/**
 * Does `config` have the shape an older setup registered Serena with? `uvx`, `--from` the
 * Serena repository at some commit, and `--context` naming setup's OWN context file — a path
 * inside the plugin's data folder, which nothing but setup ever named.
 */
function setupsSerenaShape(config: unknown, contextFile: string): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false;
  const { args, command } = config as { args?: unknown; command?: unknown };
  if (command !== "uvx" || !Array.isArray(args)) return false;
  const from = args.indexOf("--from");
  const context = args.indexOf("--context");
  const source = args[from + 1];
  return (
    from >= 0 &&
    typeof source === "string" &&
    source.startsWith(SERENA_SOURCE_PREFIX) &&
    context >= 0 &&
    args[context + 1] === contextFile
  );
}

/**
 * Is the live registration `current` the one setup made, by its record? It is while it still
 * holds exactly the JSON the record has (`sameConfig`). A record marked `pending` is an older
 * setup's own update that stopped after its `add-json` and before the record write — the record
 * then holds the OLD JSON and the live config the newer one — so there the registration counts
 * as setup's when it has setup's own shape too (`planMcpServers` reasons the same way, with the
 * JSON it would write; a retired server has none, so the shape stands in for it).
 */
function setupMadeIt(
  name: RetiredServerName,
  recorded: McpRecord | undefined,
  current: unknown,
  paths: Pick<CliPaths, "dataDir" | "stateDir">,
): boolean {
  if (recorded === undefined) return false;
  if (sameConfig(recorded.json, current)) return true;
  return (
    recorded.pending === true &&
    name === "serena" &&
    setupsSerenaShape(current, serenaLeftoverPaths(paths).contextFile)
  );
}

/** The `·` line for a retired server whose record no longer matches what is registered. */
function leftAloneNote(name: string): string {
  return (
    `· MCP server ${name} holds a config other than the one ${PLUGIN} registered: left alone, and its record forgotten. ` +
    `${COMMAND} no longer registers ${name} (${SERENA_RETIRED_IN}); to remove it: claude mcp remove ${name} --scope user`
  );
}

/**
 * What setup does about each retired server: `remove` while it is the registration setup made
 * (`setupMadeIt`). Any other server under that name stays: its record (when there is one) is
 * forgotten. A name the record never had is not planned at all. `live` null (Claude Code's own
 * config does not read): nothing, and every record stays.
 */
export function planRetiredServers(
  records: Record<string, McpRecord>,
  live: null | Record<string, unknown>,
  paths: Pick<CliPaths, "dataDir" | "stateDir">,
): McpPlanEntry[] {
  if (live === null) return [];
  const plan: McpPlanEntry[] = [];
  for (const name of RETIRED_SERVER_NAMES) {
    const recorded = records[name];
    if (recorded === undefined) continue;
    const current = live[name];
    if (current === undefined) {
      // Gone already: only the record is left, and it goes without a word.
      plan.push({ action: "gone", forget: true, json: "", name, note: null });
    } else if (setupMadeIt(name, recorded, current, paths)) {
      plan.push({ action: "remove", json: "", name, note: null });
    } else {
      // Re-pointed since, or another program's under that name: not provably ours, so it stays.
      plan.push({ action: "foreign", forget: true, json: "", name, note: leftAloneNote(name) });
    }
  }
  return plan;
}

/** The own keys of a JSON object, or none. */
function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

/** Does any string inside `value` hold `text`? */
function mentions(value: unknown, text: string): boolean {
  if (typeof value === "string") return value.includes(text);
  if (Array.isArray(value)) return value.some((one) => mentions(one, text));
  return entriesOf(value).some(([, one]) => mentions(one, text));
}

/**
 * The registrations in Claude Code's own config that start something with `file`: each
 * user-scope server but the ones this run takes back (`takenBack`), and each folder's
 * local-scope servers (`projects[<folder>].mcpServers`), as `<name>` or
 * `<name> (local scope, <folder>)`. Only the servers are read — never the rest of the file,
 * where a prompt may quote a path. Null when the file is there and does not read.
 */
export function registrationsNaming(
  userConfigFile: string,
  file: string,
  takenBack: readonly string[],
): null | string[] {
  let text: string;
  try {
    text = readFileSync(userConfigFile, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }
  let config: unknown;
  try {
    config = parseUserJson(text);
  } catch {
    return null;
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
  const { mcpServers, projects } = config as { mcpServers?: unknown; projects?: unknown };
  const found: string[] = [];
  for (const [name, server] of entriesOf(mcpServers)) {
    if (!takenBack.includes(name) && mentions(server, file)) found.push(name);
  }
  for (const [folder, project] of entriesOf(projects)) {
    for (const [name, server] of entriesOf((project as { mcpServers?: unknown }).mcpServers)) {
      if (mentions(server, file)) found.push(`${name} (local scope, ${folder})`);
    }
  }
  return found;
}

/**
 * True when `dir` holds nothing once `gone` is removed: only `gone` and empty folders. A link
 * counts as something (it is never followed).
 */
function emptyWithout(dir: string, gone: null | string): boolean {
  return readdirSync(dir).every((name) => {
    const path = join(dir, name);
    if (path === gone) return true;
    return lstatSync(path).isDirectory() && emptyWithout(path, gone);
  });
}

/** Removes `dir` and the empty folders inside it, never a file: one that turned up stays. */
function removeEmptyFolders(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) removeEmptyFolders(path);
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

/** What setup takes back of Serena's files, decided before anything is removed. */
export interface SerenaCleanup {
  /** The context file, when it is there and no registration still names it. */
  contextFile: null | string;
  /** `<dataDir>/serena/`, when nothing but that file (or nothing at all) is left in it. */
  folder: null | string;
  /** The `serena-root` records' folder, when it is there. */
  recordDir: null | string;
  /** Why the context file stays: the registrations still naming it, or that the config did not read. */
  kept: null | { unreadable: true } | { by: string[] };
}

/** Is `path` a file (a link to one counts)? A folder, or nothing there, is not. */
function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Is `path` a folder itself (never followed through a link)? */
function isFolder(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory();
}

/**
 * Plans the cleanup of Serena's files. `takenBack`: the retired registrations this run takes
 * out (a dry run: the ones it would) — they no longer count as naming the context file. A path
 * of the wrong kind (a folder where the file was, a file where the folder was) is not
 * Serena's, and is left alone.
 */
export function planSerenaCleanup(paths: CliPaths, takenBack: readonly string[]): SerenaCleanup {
  const where = serenaLeftoverPaths(paths);
  const plan: SerenaCleanup = { contextFile: null, folder: null, kept: null, recordDir: null };
  if (isFile(where.contextFile)) {
    const naming = registrationsNaming(paths.userConfigFile, where.contextFile, takenBack);
    if (naming === null) plan.kept = { unreadable: true };
    else if (naming.length > 0) plan.kept = { by: naming };
    else plan.contextFile = where.contextFile;
  }
  if (isFolder(where.folder) && emptyWithout(where.folder, plan.contextFile)) {
    plan.folder = where.folder;
  }
  if (isFolder(where.recordDir)) plan.recordDir = where.recordDir;
  return plan;
}

/**
 * Carries out `plan`: the context file through the managed-file helpers (a backup in the
 * state folder, then its `changed.json` entry dropped, so `restore` never looks for it), its
 * empty folder, and the record folder. A dry run only says what it would do. Runs inside
 * setup's lock. Returns setup's lines: changes (`-`) and information (what stays).
 */
export function applySerenaCleanup(
  paths: CliPaths,
  plan: SerenaCleanup,
  dryRun: boolean,
): { changes: string[]; info: string[] } {
  const short = (path: string) => tildify(path, paths.home);
  const changes: string[] = [];
  const info: string[] = [];
  const retired = `Serena is retired in ${SERENA_RETIRED_IN}`;
  if (plan.contextFile !== null) {
    const target = realTarget(plan.contextFile);
    if (!dryRun) {
      removeManagedFile(paths.stateDir, target);
      forgetChange(paths.stateDir, target);
    }
    changes.push(`- ${short(plan.contextFile)}: removed (Serena's context; ${retired})`);
  }
  if (plan.folder !== null) {
    if (!dryRun) removeEmptyFolders(plan.folder);
    changes.push(`- ${short(plan.folder)}/: removed (Serena's folder, empty now)`);
  }
  if (plan.recordDir !== null) {
    if (!dryRun) rmSync(plan.recordDir, { force: true, recursive: true });
    changes.push(
      `- ${short(plan.recordDir)}/: removed (the serena-root hook's records; ${retired})`,
    );
  }
  if (plan.kept !== null) {
    const file = short(serenaLeftoverPaths(paths).contextFile);
    info.push(
      "unreadable" in plan.kept
        ? `  ${file}: left in place: Claude Code's own config cannot be read, so whether a server still starts Serena with it is not known`
        : `  ${file}: left in place: ${plan.kept.by.join(", ")} still starts Serena with it`,
    );
  }
  return { changes, info };
}

/**
 * `doctor`'s lines about Serena: one ✗ line while setup still owes a removal (the registration
 * it made, the context file, the record folder), and a `·` line for a `serena` that is not
 * setup's own, which stays. Nothing on a machine Serena never reached, and nothing when Claude
 * Code's own config cannot be read (the MCP checks say so already).
 */
export function retiredChecks(paths: CliPaths): McpCheck[] {
  const live = readUserServers(paths.userConfigFile);
  if (live === null) return [];
  let records: Record<string, McpRecord> = {};
  try {
    records = readMcpRecords(paths.stateDir);
  } catch {
    // A record that does not read proves nothing is ours, the way setup reads it.
  }
  const owed: string[] = [];
  const takenBack: string[] = [];
  const others: McpCheck[] = [];
  for (const name of RETIRED_SERVER_NAMES) {
    const current = live[name];
    if (current === undefined) continue;
    if (setupMadeIt(name, records[name], current, paths)) {
      owed.push(`the "${name}" MCP server it registered`);
      takenBack.push(name);
      continue;
    }
    // Only what is known: setup has no record of registering this config. Whose it is, the
    // line does not claim.
    others.push({
      ok: true,
      info: true,
      text:
        `the "${name}" MCP server is registered (${describeServerConfig(current)}), and ${PLUGIN} has no record of registering it as it is: ` +
        `${COMMAND} no longer registers it (${SERENA_RETIRED_IN}) and leaves it alone. To remove it: claude mcp remove ${name} --scope user`,
    });
  }
  const cleanup = planSerenaCleanup(paths, takenBack);
  if (cleanup.contextFile !== null) {
    owed.push(`Serena's context ${tildify(cleanup.contextFile, paths.home)}`);
  }
  if (cleanup.recordDir !== null) {
    owed.push(`the serena-root records in ${tildify(cleanup.recordDir, paths.home)}/`);
  }
  if (owed.length === 0) return others;
  return [
    {
      ok: false,
      text: `Serena is retired in ${SERENA_RETIRED_IN}, and setup has not taken back ${owed.join(", ")} yet`,
      fix: `${COMMAND} setup`,
    },
    ...others,
  ];
}
