/**
 * `doctor`'s lines for the MCP servers setup registers: is each one registered at user scope,
 * and does it start? And is a Tavily key there (never printed)?
 *
 * HOW EACH IS CHECKED
 *   - Registered: Claude Code's own config (`<config dir>/.claude.json`, `mcpServers`) is
 *     read. Reading only: `claude mcp add --scope user` is the one way to write it.
 *   - Starts: `claude mcp get <name>` asks Claude Code to start it once and report, with
 *     `MCP_TIMEOUT` long enough for a first download. The first line of its report gives the
 *     scope, so a server registered somewhere else (a project's `.mcp.json`) is caught too —
 *     it would win over the user-scope one, and a session that moves into a worktree would
 *     lose it.
 *   - Tavily's key: from the environment or the key file. No key is a `·` line, never a
 *     failure: a person who never wanted Tavily has no server and loses nothing. Its value is
 *     never read into a message.
 *   - A retired server (`retired.ts`): one ✗ line while setup still owes its removal, and a
 *     `·` line for one of the person's own under that name.
 */
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { readMcpRecords } from "./records";
import { overridingServer, readUserServers, sameConfig } from "./register";
import { retiredChecks } from "./retired";
import { SERVER_NAMES } from "./servers";
import { describeServerConfig } from "./status";
import { readTavilyKey } from "./tavily";

export interface McpCheck {
  ok: boolean;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  /** A warning: printed with `!`, never a failure. */
  warn?: boolean;
  text: string;
}

/**
 * How long `claude mcp get` may take: it starts the server, and a first download can take a
 * minute (the Playwright MCP through `bunx`).
 */
const FIRST_START_LIMIT_MS = 180_000;

/** What these checks ask of the machine — a test hands in fakes. */
export interface McpDoctorDeps {
  /** Runs `claude mcp get`, with extra environment variables (its `MCP_TIMEOUT`). */
  run: (argv: string[], extraEnv: Record<string, string>) => { ok: boolean; output: string };
  which: (command: string) => null | string;
}

/**
 * The machine's own `McpDoctorDeps`: `claude mcp get` run for real. One home for both
 * `cc-smart-dev-kit doctor` and the portal's Machine page, so the two judge a machine alike.
 */
export function realMcpDoctorDeps(): McpDoctorDeps {
  return {
    run: (argv, extraEnv) => {
      try {
        const result = Bun.spawnSync(argv, {
          env: { ...process.env, ...extraEnv },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        return {
          ok: result.exitCode === 0,
          output: `${result.stdout.toString()}${result.stderr.toString()}`,
        };
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) };
      }
    },
    which: (command) => Bun.which(command),
  };
}

/** One labelled line of `claude mcp get`. Its other lines can hold a command line someone
 *  pasted a key into, so nothing else of that output is printed. */
function field(report: string, label: string): string {
  const line = report.split(/\r?\n/).find((text) => text.trim().startsWith(`${label}:`));
  return line === undefined ? "unknown" : line.slice(line.indexOf(":") + 1).trim();
}

/** The MCP servers' lines for `doctor`. */
export function mcpChecks(
  paths: CliPaths,
  deps: McpDoctorDeps,
  env: Record<string, string | undefined>,
  /** The folder doctor runs in: where a project's `.mcp.json` and the local scope are looked
   *  for. A copy there wins over the user-scope server. */
  cwd: string = process.cwd(),
): McpCheck[] {
  const names = SERVER_NAMES.filter(
    (name) => name !== "tavily-websearch" || readTavilyKey(paths, env).source !== "none",
  );
  const checks: McpCheck[] = [];
  const servers = readUserServers(paths.userConfigFile);
  /** What setup registered. A record file that cannot be read: nothing is judged as ours. */
  let records: null | Record<string, { json: string }> = null;
  try {
    records = readMcpRecords(paths.stateDir);
  } catch {
    records = null;
  }
  for (const name of names) {
    if (servers === null) {
      checks.push({
        ok: false,
        text: `cannot read ${paths.userConfigFile} to check the MCP servers. Run: ${COMMAND} setup`,
      });
      break;
    }
    if (!(name in servers)) {
      checks.push({
        ok: false,
        text: `the "${name}" MCP server is not registered for your user. Run: ${COMMAND} setup`,
      });
      continue;
    }
    // Registered, but not with what cc-smart-dev-kit recorded: someone else's server under our
    // name — a project's own script, say. That is why the plugin's browser is not the one
    // starting (live, 2026-10-17), so it is named here, with what runs instead. `!`, not a
    // failure: setup is told to leave a person's own server alone, and this line says how to
    // hand the name over. (The record file that cannot be read means "not ours" here, which is
    // the truth: nothing of ours is being managed.)
    const record = records?.[name];
    if (record === undefined || !sameConfig(record.json, servers[name])) {
      checks.push({
        ok: true,
        warn: true,
        text:
          `the "${name}" MCP server is registered by something else (${describeServerConfig(servers[name])}), ` +
          `not by cc-smart-dev-kit. To let setup manage it: claude mcp remove ${name} --scope user, then ${COMMAND} setup`,
      });
      continue;
    }
    // Ours at user scope, but a copy one scope down WINS OVER it — the local scope
    // (`projects[<cwd>]` in Claude Code's own file) or a project's `.mcp.json` — so the
    // plugin's server is not the one starting. `!`, never a failure, and never a key: what
    // runs instead goes through the same redacting line as above.
    const overriding = overridingServer(paths.userConfigFile, cwd, name);
    if (overriding !== null) {
      checks.push({
        ok: true,
        warn: true,
        text:
          `the "${name}" MCP server has a copy that wins over yours (${describeServerConfig(overriding.config)} in ${tildify(overriding.file, paths.home)}): ` +
          `a project's .mcp.json, or the local scope, takes precedence over the user-scope server, so cc-smart-dev-kit's is not the one starting. ` +
          `Remove it from that file (or merge the base branch when it came from one), then run: ${COMMAND} doctor`,
      });
      continue;
    }
    if (deps.which("claude") === null) {
      checks.push({
        ok: false,
        text: `the claude command is not on PATH, so the "${name}" MCP server could not be started to check it`,
      });
      continue;
    }
    const report = deps.run(["claude", "mcp", "get", name], {
      MCP_TIMEOUT: String(FIRST_START_LIMIT_MS),
    }).output;
    const scope = field(report, "Scope");
    // `claude mcp get` leads the status with a mark of its own; ours says more.
    const status = field(report, "Status").replace(/^[^A-Za-z]+/, "");
    if (status === "" || status === "unknown") {
      checks.push({
        ok: false,
        text: `\`claude mcp get ${name}\` gave no state. Run it to see why`,
      });
      continue;
    }
    if (!scope.startsWith("User config")) {
      checks.push({
        ok: false,
        text:
          `another copy of "${name}" wins over yours: ${scope}. ` +
          `A project .mcp.json: merge the base branch, or remove the file; a copy of your own: claude mcp remove ${name} --scope local`,
      });
      continue;
    }
    checks.push({
      ok: status.includes("Connected"),
      text: `MCP server "${name}": ${status}`,
    });
  }
  // Tavily is the one server that needs a key. No key: skipped, not a failure — and the
  // line names the key file, without ever reading the key itself.
  if (!names.includes("tavily-websearch")) {
    const key = readTavilyKey(paths, env);
    checks.push({
      ok: true,
      info: true,
      text: `the Tavily MCP server is skipped: ${
        key.source === "none" ? key.reason : "no key"
      } (key file: ${paths.tavilyKeyFile})`,
    });
  }
  // What a retired server left (Serena): a line only while setup owes its removal, or for a
  // server of that name that is the person's own.
  checks.push(...retiredChecks(paths));
  return checks;
}
