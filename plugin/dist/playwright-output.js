// @bun
// src/hooks/playwright-output.ts
import { isAbsolute, resolve, sep as sep2 } from "path";

// src/cli/paths.ts
import { join as join2, sep } from "path";

// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;

// src/gateway/paths.ts
import { homedir } from "os";
import { join } from "path";

// src/machine/host.ts
var TEST_HOST_VAR = "CC_SMART_DEV_KIT_TEST_HOST";
function hostPlatform(env = process.env) {
  const text = env[TEST_HOST_VAR];
  if (!text)
    return process.platform;
  const given = JSON.parse(text);
  return given.platform ?? process.platform;
}

// src/gateway/paths.ts
function homeDir(env = process.env) {
  if (env.HOME)
    return env.HOME;
  if (hostPlatform(env) === "win32" && env.USERPROFILE)
    return env.USERPROFILE;
  return homedir();
}
function routerPaths(env = process.env) {
  const home = homeDir(env);
  return {
    home,
    gatewayConfigFile: join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
    gatewayStateFile: join(home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json"),
    safetyChecksFile: join(home, ".local", "state", "cc-smart-dev-kit", "safety-checks.json"),
    historyDbFile: join(home, ".local", "state", "cc-smart-dev-kit", "history.db")
  };
}

// src/cli/paths.ts
function userConfigFile(env, home) {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir ? join2(dir, ".claude.json") : join2(home, ".claude.json");
}
function cliPaths(env = process.env) {
  const router = routerPaths(env);
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join2(router.home, ".claude");
  return {
    ...router,
    claudeConfigDir,
    settingsFile: join2(claudeConfigDir, "settings.json"),
    installedPluginsFile: join2(claudeConfigDir, "plugins", "installed_plugins.json"),
    pluginCacheDir: join2(claudeConfigDir, "plugins", "cache", MARKETPLACE, PLUGIN),
    knownMarketplacesFile: join2(claudeConfigDir, "plugins", "known_marketplaces.json"),
    projectsDir: join2(claudeConfigDir, "projects"),
    userConfigFile: userConfigFile(env, router.home),
    binDir: join2(router.home, ".local", "bin"),
    stateDir: join2(claudeConfigDir, "cc-smart-dev-kit"),
    dataDir: join2(router.home, ".local", "share", "cc-smart-dev-kit"),
    browserOutputDir: join2(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-output"),
    browserTokenFile: join2(router.home, ".config", "cc-smart-dev-kit", "playwright-extension.token"),
    routerCopy: join2(router.home, ".local", "share", "cc-smart-dev-kit", "router.js"),
    routerTaskFile: join2(router.home, ".local", "share", "cc-smart-dev-kit", "router-task.xml"),
    portalCopy: join2(router.home, ".local", "share", "cc-smart-dev-kit", "portal.js"),
    portalUiFolder: join2(router.home, ".local", "share", "cc-smart-dev-kit", "portal-ui"),
    portalProjectsFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal-projects.json"),
    portalLogFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal.log"),
    portalHeldFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal-held.json"),
    omnirouteStateFile: join2(claudeConfigDir, "cc-smart-dev-kit", "omniroute.json"),
    routerUnitFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.service"),
    claudeMemSettingsFile: join2(claudeMemDataDir(env, router.home), "settings.json"),
    routerSocketFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.socket"),
    notifyConfigFile: join2(claudeConfigDir, "cc-smart-dev-kit", "notify.json"),
    workflowConfigFile: join2(router.home, ".config", "cc-smart-dev-kit", "workflow.json"),
    tmuxConfFile: join2(router.home, ".tmux.conf"),
    tavilyKeyFile: join2(claudeConfigDir, "cc-smart-dev-kit", "tavily.key")
  };
}
function claudeMemDataDir(env, home) {
  const dir = env.CLAUDE_MEM_DATA_DIR;
  if (!dir)
    return join2(home, ".claude-mem");
  if (dir === "~")
    return home;
  return dir.startsWith("~/") ? join2(home, dir.slice(2)) : dir;
}

// src/mcp/records.ts
import { existsSync, readFileSync } from "fs";
import { join as join3 } from "path";
var RECORD_FILE = "mcp-servers.json";
function mcpRecordsFile(stateDir) {
  return join3(stateDir, RECORD_FILE);
}
function isRecord(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const { at, json, pending } = value;
  return typeof json === "string" && typeof at === "string" && (pending === undefined || typeof pending === "boolean");
}
function readMcpRecords(stateDir, file = mcpRecordsFile(stateDir)) {
  if (!existsSync(file))
    return {};
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const servers = parsed?.servers;
  if (typeof servers !== "object" || servers === null || !Object.values(servers).every((entry) => isRecord(entry))) {
    throw new Error(`Invalid ${file}: expected { "servers": { <name>: { json, at } } }`);
  }
  return servers;
}

// src/mcp/register.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";

// src/build-info/index.ts
var info = {
  version: "1.7.1",
  repo: "sellanybiz/cc-smart-dev-kit",
  dependencies: [
    {
      name: "claude-mem",
      marketplace: "thedotmack",
      version: ">=13.36.0"
    },
    {
      name: "frontend-design",
      marketplace: "claude-plugins-official"
    }
  ]
};
var VERSION = info.version;
var MARKETPLACE_SOURCE = info.repo;
var DEPENDENCIES = info.dependencies;
var MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
var PLUGIN_INSTALL_COMMAND = `claude plugin install ${PLUGIN_ID}`;
var PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;

// src/setup/launcher.ts
var LAUNCHER_NAME = "cc-smart-dev-kit";
var LAUNCHER_IN_SHELL = `"$HOME/.local/bin/${LAUNCHER_NAME}"`;
var FIND_INSTALL_JS = [
  "const f=process.argv[process.argv.length-1];",
  'const j=JSON.parse(require("fs").readFileSync(f,"utf8"));',
  `const e=((j&&j.plugins&&j.plugins["${PLUGIN_ID}"])||[]).find(x=>x&&x.scope==="user"&&typeof x.installPath==="string");`,
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);"
].join("");

// src/setup/user-json.ts
var BOM = "\uFEFF";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}

// src/mcp/register.ts
function readUserServers(file) {
  let text;
  try {
    text = readFileSync2(file, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? {} : null;
  }
  try {
    const parsed = parseUserJson(text);
    if (typeof parsed !== "object" || parsed === null)
      return null;
    const servers = parsed.mcpServers;
    return typeof servers === "object" && servers !== null && !Array.isArray(servers) ? servers : {};
  } catch {
    return null;
  }
}
function sameConfig(json, live) {
  let wanted;
  try {
    wanted = JSON.parse(json);
  } catch {
    return false;
  }
  return deepEqual(wanted, live);
}
function deepEqual(a, b) {
  if (a === b)
    return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  if (Array.isArray(a) !== Array.isArray(b))
    return false;
  const left = a;
  const right = b;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length)
    return false;
  return keys.every((key) => (key in right) && deepEqual(left[key], right[key]));
}

// src/hooks/io.ts
var SILENT = {};
function parseHookInput(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function toolInput(input) {
  const value = input.tool_input;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function toolDecision(decision, reason) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })
  };
}

// src/hooks/playwright-output.ts
function outputFilename(fields, outputDir) {
  const filename = fields.filename;
  if (typeof filename !== "string" || filename === "" || isAbsolute(filename))
    return null;
  const name = filename.replace(/^(?:\.[\\/])+/, "");
  const target = resolve(outputDir, name);
  if (!target.startsWith(outputDir + sep2))
    return null;
  return target;
}
function climbsOut(filename) {
  return filename.split(/[\\/]+/).includes("..");
}
function outsideReason(filename, outputDir) {
  return `This call names a file outside the browser's output folder ("filename": ${JSON.stringify(filename)} \u2014 a path with ".." in it). ` + `Files the browser saves live in ${outputDir}. Name the file with a relative name (it lands there), or use an absolute path inside that folder.`;
}
function rewrittenAnswer(input, filename) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...toolInput(input), filename }
      }
    })
  };
}
function playwrightIsOurs(paths) {
  let record;
  try {
    record = readMcpRecords(paths.stateDir).playwright;
  } catch {
    return false;
  }
  if (record === undefined || record.pending === true)
    return false;
  const live = readUserServers(paths.userConfigFile);
  return live !== null && sameConfig(record.json, live.playwright);
}
function rewritableFilename(input) {
  const filename = toolInput(input).filename;
  return typeof filename === "string" && filename !== "" && !isAbsolute(filename) ? filename : null;
}
function playwrightOutputAnswer(input, outputDir, ours) {
  if (!ours)
    return SILENT;
  const filename = rewritableFilename(input);
  if (filename === null)
    return SILENT;
  if (climbsOut(filename))
    return toolDecision("deny", outsideReason(filename, outputDir));
  const target = outputFilename(toolInput(input), outputDir);
  return target === null ? SILENT : rewrittenAnswer(input, target);
}
async function playwrightOutput(paths = cliPaths(process.env)) {
  let answer = SILENT;
  try {
    const input = parseHookInput(await Bun.stdin.text());
    if (input !== null && rewritableFilename(input) !== null && playwrightIsOurs(paths)) {
      answer = playwrightOutputAnswer(input, paths.browserOutputDir, true);
    }
  } catch (error) {
    console.error(`cc-smart-dev-kit playwright-output: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (answer.stdout !== undefined)
    await Bun.write(Bun.stdout, answer.stdout);
  process.exit(answer.exitCode ?? 0);
}

// src/entries/playwright-output.ts
await playwrightOutput();
