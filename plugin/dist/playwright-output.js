// @bun
// src/hooks/playwright-output.ts
import { isAbsolute, resolve, sep } from "path";

// src/cli/paths.ts
import { join as join2 } from "path";

// src/gateway/paths.ts
import { homedir } from "os";
import { join } from "path";
function homeDir(env = process.env) {
  return env.HOME || homedir();
}
function routerPaths(env = process.env) {
  const home = homeDir(env);
  return {
    home,
    gatewayConfigFile: join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
    gatewayStateFile: join(home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json")
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
    knownMarketplacesFile: join2(claudeConfigDir, "plugins", "known_marketplaces.json"),
    userConfigFile: userConfigFile(env, router.home),
    binDir: join2(router.home, ".local", "bin"),
    stateDir: join2(claudeConfigDir, "cc-smart-dev-kit"),
    dataDir: join2(router.home, ".local", "share", "cc-smart-dev-kit"),
    browserProfileDir: join2(router.home, ".local", "share", "cc-smart-dev-kit", "playwright"),
    browserOutputDir: join2(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-output"),
    browserPickerFile: join2(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-picker.js"),
    serenaContextFile: join2(router.home, ".local", "share", "cc-smart-dev-kit", "serena", "contexts", "worktree.yml"),
    routerCopy: join2(router.home, ".local", "share", "cc-smart-dev-kit", "router.js"),
    routerUnitFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.service"),
    claudeMemSettingsFile: join2(claudeMemDataDir(env, router.home), "settings.json"),
    routerSocketFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.socket"),
    notifyConfigFile: join2(claudeConfigDir, "cc-smart-dev-kit", "notify.json"),
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

// src/hooks/playwright-output.ts
function outputFilename(fields, outputDir) {
  const filename = fields["filename"];
  if (typeof filename !== "string" || filename === "" || isAbsolute(filename))
    return null;
  const name = filename.replace(/^(?:\.[\\/])+/, "");
  const target = resolve(outputDir, name);
  if (!target.startsWith(outputDir + sep))
    return null;
  return target;
}
function playwrightOutputAnswer(input, outputDir) {
  const filename = outputFilename(toolInput(input), outputDir);
  if (filename === null)
    return SILENT;
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...toolInput(input), filename }
      }
    })
  };
}
async function playwrightOutput(paths = cliPaths(process.env)) {
  let answer = SILENT;
  try {
    const input = parseHookInput(await Bun.stdin.text());
    if (input !== null)
      answer = playwrightOutputAnswer(input, paths.browserOutputDir);
  } catch (error) {
    console.error(`cc-smart-dev-kit playwright-output: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (answer.stdout !== undefined)
    await Bun.write(Bun.stdout, answer.stdout);
  process.exit(answer.exitCode ?? 0);
}

// src/entries/playwright-output.ts
await playwrightOutput();
