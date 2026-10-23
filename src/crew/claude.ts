/**
 * The Claude Code commands a crew session launch runs, and what it reads from their answers:
 *
 * - `claude --bg -w <worktree> --name … --model … --effort … --permission-mode auto
 *   --autocompact auto --strict-mcp-config --mcp-config <file> --settings <file> "<first line>"`
 *   — returns at once and prints `backgrounded · <short id> · <name>` (proved live, L1a.1: 0.9 s;
 *   `--session-id` is ignored with `--bg`, so the short id is read from that line);
 * - `claude agents --json --all` — one row per session (`id`, `sessionId`, `cwd`, `pid`, `state`
 *   …), read once to record the new session's id and see that agent view lists it. **Not** its
 *   `cwd`: that read shows the launch folder until a `-w` session has entered its worktree
 *   (2.1.308, `docs/claude-code-contract.md`).
 *
 * **Which `claude`:** the one on PATH (`Bun.which`), else the native installer's place,
 * `~/.local/bin` (`claude`; on Windows `claude.exe`, then npm's `claude.cmd`). **A `.cmd` is no
 * executable on Windows:** it runs through `cmd.exe` with one quoted line (`windowsRun`, the
 * hooks' own quoting), which is also why the crew session's settings go in a FILE, never inline JSON —
 * a `"` has no escape on that line.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "../build-info/names";
import { windowsRun } from "../hooks/detached";
import { TAVILY_SERVER_NAME } from "../mcp/names";
import { type McpContext, mcpServers, SERVER_NAMES, type ServerName } from "../mcp/servers";
import type { CrewKind } from "../models/launch-policy";
import { CREW_KEEP_RULE, parseCrewKeep } from "../workflow/schema";

type Env = Record<string, string | undefined>;

/** How long one `claude` command may take: `--bg` returns in about a second (L1a.1). */
export const CLAUDE_TIMEOUT_MS = 30_000;

/**
 * The `--autocompact` a crew session gets: `auto`, Claude Code's own window for the model. The kit
 * reads that window to measure the hand-off (`context-window.ts`: Claude Code's own report, one
 * table, a backend's listed window), but it never sets a token count of its own here. The
 * hand-off at `workflow.crew.handoffPercent` comes before Claude Code's own compaction either way.
 */
export const CREW_AUTOCOMPACT = "auto";

/** The permission mode every crew session runs in: the person's rules plus auto mode's safety checks. */
export const CREW_PERMISSION_MODE = "auto";

/** What one program run gave back. */
export interface ProgramRun {
  /** The exit code; null when it was killed (a timeout) or never started. */
  exitCode: null | number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why it never started (the spawner's own words); null when it did. */
  error: null | string;
}

/** Runs a program and waits for it. A test hands in the real one with a fake `claude` on PATH. */
export type RunProgram = (
  argv: string[],
  options: { cwd: string; env: Env; timeoutMs: number; windowsVerbatim: boolean },
) => ProgramRun;

export const realRunProgram: RunProgram = (argv, options) => {
  try {
    const result = Bun.spawnSync(argv, {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs,
      windowsHide: true,
      // A `cmd.exe` line is already quoted (`windowsRun`): never quote it a second time.
      windowsVerbatimArguments: options.windowsVerbatim,
    });
    return {
      error: null,
      exitCode: result.signalCode ? null : result.exitCode,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
      timedOut: result.exitedDueToTimeout === true,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
      stderr: "",
      stdout: "",
      timedOut: false,
    };
  }
};

/** What finding and running `claude` needs from the machine. */
export interface ClaudeDeps {
  env: Env;
  /** The home folder (`cliPaths().home`): where the native installer puts `claude`. */
  home: string;
  platform: NodeJS.Platform;
  runProgram: RunProgram;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => null | string;
}

/** True when `path` is a file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The names the native installer and npm leave in `~/.local/bin`, in the order they are tried. */
function fallbackNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
}

/** The `claude` to run: PATH first, then `~/.local/bin`; null when there is none. */
export function findClaude(deps: Pick<ClaudeDeps, "home" | "platform" | "which">): null | string {
  const onPath = deps.which("claude");
  if (onPath !== null) return onPath;
  for (const name of fallbackNames(deps.platform)) {
    const path = join(deps.home, ".local", "bin", name);
    if (isFile(path)) return path;
  }
  return null;
}

/** The argv that runs `claude <args>` here, or why it cannot be run. */
export function claudeArgv(
  binary: string,
  args: string[],
  platform: NodeJS.Platform,
): { argv: string[]; verbatim: boolean } | { why: string } {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(binary)) {
    return { argv: [binary, ...args], verbatim: false };
  }
  const line = windowsRun([binary, ...args]);
  if (!line.ok) return { why: `cmd.exe cannot carry "${line.argument}": ${line.reason}` };
  return { argv: line.argv, verbatim: true };
}

/** One `claude` command's outcome: what it printed, or why it did not run. */
export type ClaudeCall = { ok: true; run: ProgramRun } | { ok: false; why: string };

/** Runs `claude <args>` in `cwd` with `binary` (`findClaude`). */
export function callClaude(
  deps: ClaudeDeps,
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs = CLAUDE_TIMEOUT_MS,
): ClaudeCall {
  const command = claudeArgv(binary, args, deps.platform);
  if ("why" in command) return { ok: false, why: command.why };
  const run = deps.runProgram(command.argv, {
    cwd,
    env: deps.env,
    timeoutMs,
    windowsVerbatim: command.verbatim,
  });
  if (run.error !== null) return { ok: false, why: `${binary} did not start: ${run.error}` };
  return { ok: true, run };
}

/** What a crew session's `claude --bg` names. */
export interface CrewLaunchSpec {
  effort: string;
  /** The MCP servers this session loads, in `--mcp-config`'s file. */
  mcpFile: string;
  model: string;
  name: string;
  /** The first line of its conversation: who it is, and where its brief is. */
  prompt: string;
  /** The settings file that names it to its own session (`CREW_ENV`). */
  settingsFile: string;
  /** The worktree's folder name under `.claude/worktrees/` (`crew-<phase>-<slug>`). */
  worktreeName: string;
}

/**
 * The flags a crew session runs with — its model, effort, permission mode and autocompact — in
 * the one home: a launch and every resume of it read them here, so a flag added for a launch
 * cannot miss a resume (`docs/design.md` § The lead and the crew).
 */
export function sessionFlags(
  model: string,
  effort: string,
  permissionMode = CREW_PERMISSION_MODE,
): string[] {
  return [
    "--model",
    model,
    "--effort",
    effort,
    "--permission-mode",
    permissionMode,
    "--autocompact",
    CREW_AUTOCOMPACT,
  ];
}

/**
 * The arguments of a crew session's `claude --bg`, in the order the live proof ran them (L1a.1),
 * with the lean start's two MCP options after `--autocompact`.
 *
 * **`--mcp-config` comes before `--settings`, never last:** it takes any number of files, so a
 * prompt after it would be read as another config file (proved live on 2.1.309: `Say ok` became
 * `MCP config file not found: …/Say ok`). `--settings` takes one value and ends the list.
 */
export function launchArgs(spec: CrewLaunchSpec): string[] {
  return [
    "--bg",
    "-w",
    spec.worktreeName,
    "--name",
    spec.name,
    ...sessionFlags(spec.model, spec.effort),
    "--strict-mcp-config",
    "--mcp-config",
    spec.mcpFile,
    "--settings",
    spec.settingsFile,
    spec.prompt,
  ];
}

/** One row of `claude plugin list --json`, as much as a lean start reads. */
export interface PluginRow {
  enabled: boolean;
  id: string;
  /** The folder the plugin loads from, which holds its `.claude-plugin/plugin.json`; null when the row names none. */
  installPath?: null | string;
}

/**
 * The rows `claude plugin list --json` printed; null when it is not a JSON list. A row with no
 * string `id` names no plugin to turn off and is dropped; an `enabled` that is not `true` is off.
 */
export function parsePluginList(output: string): null | PluginRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows: PluginRow[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const { enabled, id, installPath } = row as {
      enabled?: unknown;
      id?: unknown;
      installPath?: unknown;
    };
    if (typeof id !== "string" || id === "") continue;
    rows.push({
      enabled: enabled === true,
      id,
      installPath: typeof installPath === "string" && installPath !== "" ? installPath : null,
    });
  }
  return rows;
}

/**
 * The plugin ids a manifest's `dependencies` names, in Claude Code's forms: `"name"` (in the
 * declaring plugin's own marketplace), `"name@marketplace"`, or `{ "name", "marketplace"? }`.
 * An entry in any other shape names nothing.
 */
export function dependencyIds(raw: unknown, marketplace: string): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry !== "") {
      ids.push(entry.includes("@") ? entry : `${entry}@${marketplace}`);
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const { name, marketplace: other } = entry as { marketplace?: unknown; name?: unknown };
    if (typeof name !== "string" || name === "") continue;
    ids.push(`${name}@${typeof other === "string" && other !== "" ? other : marketplace}`);
  }
  return ids;
}

/** The marketplace part of a plugin id (`name@marketplace`); "" when it has none. */
function marketplaceOf(id: string): string {
  const at = id.lastIndexOf("@");
  return at < 0 ? "" : id.slice(at + 1);
}

/** Reads a plugin's `dependencies` from its folder; undefined when the manifest cannot be read. */
export type ReadDependencies = (installPath: string) => unknown;

/** The `dependencies` of `<installPath>/.claude-plugin/plugin.json`, or undefined. */
export function readInstalledDependencies(installPath: string): unknown {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(installPath, ".claude-plugin", "plugin.json"), "utf8"),
    );
    return typeof manifest === "object" && manifest !== null
      ? (manifest as { dependencies?: unknown }).dependencies
      : undefined;
  } catch {
    // A manifest that cannot be read names no dependency: the plugin's own load says why.
    return undefined;
  }
}

/**
 * Every plugin a kept plugin needs, whatever depth: Claude Code does not load a plugin whose
 * dependency is turned off (proved live on 2.1.309, `docs/claude-code-contract.md`), so a lean
 * start that turned one off would drop the plugin it meant to keep. `own` is this plugin's own
 * list, from its manifest at build time, so it holds even when its installed copy cannot be read.
 */
export function neededByKept(
  kept: ReadonlySet<string>,
  rows: readonly PluginRow[],
  own: readonly string[],
  read: ReadDependencies,
): Set<string> {
  const needed = new Set<string>(own);
  const queue = [...kept, ...own];
  const seen = new Set<string>();
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    // One plugin can have an install record per scope, each its own copy: what any of them
    // needs stays on, so the copy this session loads finds its dependencies whichever it is.
    for (const row of rows) {
      if (row.id !== id || !row.installPath) continue;
      for (const dependency of dependencyIds(read(row.installPath), marketplaceOf(id))) {
        needed.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return needed;
}

/**
 * The MCP servers a crew session of `kind` keeps: Tavily, for the research every phase may need,
 * and the browser for `ui` work (D50). Everything else is not loaded (`--strict-mcp-config`), so
 * its tools never reach the session's context.
 */
export function serversFor(kind: null | CrewKind): ServerName[] {
  const names: ServerName[] = [TAVILY_SERVER_NAME];
  if (kind === "ui") names.push("playwright");
  return names;
}

/** What a lean launch turns off, and what it keeps. */
export interface LeanLaunch {
  /** The plugin ids the session turns off: every enabled one but this plugin and the kept ones. */
  off: string[];
  /** The MCP servers it passes, exactly as the kit registers them. */
  servers: Record<string, unknown>;
}

/**
 * The lean start: **every enabled plugin but this one goes off** for the session, and **only the
 * servers its kind needs are kept**, plus what the project's `workflow.crew.keep` names.
 *
 * - The off list is written as `enabledPlugins: {<id>: false}` in the session's own settings
 *   file. Entries merge key by key across settings sources, so the plugins it does not name stay
 *   as they are (proved live on 2.1.309, `docs/claude-code-contract.md`).
 * - `enabled: null` means the plugin list could not be read: nothing is turned off, and a kept
 *   plugin is not refused (a lean start never fails a start over a list it could not read).
 * - A keep entry that names nothing this machine runs — or a server cc-smart-dev-kit does not
 *   register — is refused with the plain line the project fixes.
 */
export function leanLaunch(input: {
  context: McpContext;
  enabled: null | readonly PluginRow[];
  keep: readonly string[];
  kind: null | CrewKind;
  /** This plugin's own dependencies, as plugin ids (`DEPENDENCIES`, from its manifest). */
  own: readonly string[];
  /** How a kept plugin's `dependencies` is read; its installed manifest by default. */
  readDependencies?: ReadDependencies;
}): { lean: LeanLaunch; ok: true } | { ok: false; why: string } {
  const keptPlugins = new Set<string>();
  const keptServers = new Set<ServerName>(serversFor(input.kind));
  for (const entry of input.keep) {
    const parsed = parseCrewKeep(entry);
    if (parsed === null) {
      return { ok: false, why: `workflow.crew.keep: "${entry}" is not ${CREW_KEEP_RULE}` };
    }
    if (parsed.kind === "plugin") {
      // This plugin is always kept, whatever origin its copy loads from.
      if (parsed.id.startsWith(`${PLUGIN}@`)) continue;
      if (
        input.enabled !== null &&
        !input.enabled.some((row) => row.enabled && row.id === parsed.id)
      ) {
        return {
          ok: false,
          why: `workflow.crew.keep names plugin "${parsed.id}", which is not enabled in this Claude Code`,
        };
      }
      keptPlugins.add(parsed.id);
      continue;
    }
    if (!SERVER_NAMES.includes(parsed.name as ServerName)) {
      return {
        ok: false,
        why: `workflow.crew.keep names server "${parsed.name}"; a crew session can keep only the servers cc-smart-dev-kit registers (${SERVER_NAMES.join(", ")})`,
      };
    }
    keptServers.add(parsed.name as ServerName);
  }
  const enabled = input.enabled;
  // What the kept plugins need stays on too: this plugin's own dependencies always, and the
  // dependencies of every kept plugin, read from its installed manifest.
  const needed =
    enabled === null
      ? new Set<string>()
      : neededByKept(
          new Set([
            ...keptPlugins,
            ...enabled.filter((row) => row.id.startsWith(`${PLUGIN}@`)).map((row) => row.id),
          ]),
          enabled,
          input.own,
          input.readDependencies ?? readInstalledDependencies,
        );
  const off =
    enabled === null
      ? []
      : [
          ...new Set(
            enabled
              .filter((row) => row.enabled && !row.id.startsWith(`${PLUGIN}@`))
              .map((row) => row.id)
              .filter((id) => !keptPlugins.has(id) && !needed.has(id)),
          ),
        ].sort();
  const servers: Record<string, unknown> = {};
  for (const one of mcpServers(input.context)) {
    // `skipped`: the registration the kit would write is a note, not a server (Tavily, no key).
    if (!keptServers.has(one.name) || one.skipped !== undefined) continue;
    servers[one.name] = JSON.parse(one.json);
  }
  return { lean: { off, servers }, ok: true };
}

/** The `--mcp-config` file: the kept servers under `mcpServers`, as their registrations read. */
export function mcpConfigText(servers: Record<string, unknown>): string {
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

/** `backgrounded · <short id> · <name>`: the line `claude --bg` prints. */
const BACKGROUNDED = /^\s*backgrounded\s+·\s+([0-9a-f]{8})\s+·\s+(\S.*?)\s*$/m;

/** The short id and the name a `claude --bg` printed; null when no such line is there. */
export function parseBackgrounded(output: string): null | { name: string; shortId: string } {
  const found = BACKGROUNDED.exec(output);
  if (found?.[1] === undefined || found[2] === undefined) return null;
  return { name: found[2], shortId: found[1] };
}

/** The words `claude --bg` refuses a repository with that the person never opened (L1a.1). */
const NOT_TRUSTED = /workspace not trusted/i;

/** True when `claude --bg` refused because the person never accepted this repo's trust prompt. */
export function refusedUntrusted(output: string): boolean {
  return NOT_TRUSTED.test(output);
}

/** One row of `claude agents --json`, as much as a launch reads. */
export interface AgentRow {
  cwd: null | string;
  id: null | string;
  pid: null | number;
  sessionId: null | string;
  state: null | string;
  /** `busy`, `waiting` or `idle`: what the session is doing now. */
  status: null | string;
  /** What the session waits for (`permission prompt`, `input needed`, …); null when it waits for nothing. */
  waitingFor: null | string;
}

/** A field as text, or null. */
function textField(value: unknown): null | string {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The rows `claude agents --json` printed; null when it is not a JSON list. */
export function parseAgents(output: string): AgentRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      cwd: textField(row.cwd),
      id: textField(row.id),
      pid: typeof row.pid === "number" ? row.pid : null,
      sessionId: textField(row.sessionId),
      state: textField(row.state),
      status: textField(row.status),
      waitingFor: textField(row.waitingFor),
    }));
}

/** The row of the session with short id `shortId`: its `id`, or the start of its `sessionId`. */
export function agentRow(rows: AgentRow[], shortId: string): AgentRow | null {
  return (
    rows.find((row) => row.id === shortId) ??
    rows.find((row) => row.sessionId?.startsWith(shortId) === true) ??
    null
  );
}
