// @bun
// src/entries/notify.ts
import { closeSync as closeSync2, openSync as openSync2, writeSync } from "fs";

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

// src/hooks/notify.ts
import { spawn } from "child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join as join3 } from "path";

// src/gateway/plain-text.ts
var CONTROL = /[\p{Cc}\p{Cf}]/gu;
var CONTROL_BUT_LINES = /[^\P{Cc}\n\t]|\p{Cf}/gu;
function plainText(text, options = {}) {
  return text.replace(options.keepNewlines === true ? CONTROL_BUT_LINES : CONTROL, " ");
}
function cutText(text, max) {
  if (text.length <= max)
    return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 55296 && last <= 56319)
    end -= 1;
  return text.slice(0, end);
}
function oneLine(text, max, options = {}) {
  const flat = options.ascii === true ? text.replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?") : plainText(text).replace(/\s+/g, " ");
  const line = flat.trim();
  return line.length > max ? `${cutText(line, max)}${options.mark ?? ""}` : line;
}

// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "cc-smart-dev-kit";

// src/build-info/index.ts
var info = {
  version: "0.3.0",
  repo: "sellanybiz/cc-smart-dev-kit",
  dependencies: [
    {
      name: "claude-mem",
      marketplace: "thedotmack",
      version: ">=13.29.0"
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

// src/setup/marketplace-access.ts
var TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

// src/update/apply.ts
var ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart)`;
function notifyCommand(text, platform, which, title = PLUGIN, critical = false) {
  if (platform === "linux") {
    const notifySend = which("notify-send");
    return notifySend === null ? null : [notifySend, ...critical ? ["--urgency=critical"] : [], title, text];
  }
  if (platform === "darwin") {
    const osascript = which("osascript");
    return osascript === null ? null : [
      osascript,
      "-e",
      `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`
    ];
  }
  return null;
}

// src/hooks/io.ts
var SILENT = {};

// src/hooks/session-name.ts
var MAX_SESSION_NAME = 60;
function cleanSessionName(raw) {
  const firstLine = raw.split(/\r?\n|\r/)[0] ?? "";
  const plain = firstLine.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (plain === "")
    return null;
  return [...plain].slice(0, MAX_SESSION_NAME).join("").trimEnd();
}

// src/hooks/transcript.ts
import { closeSync, fstatSync, openSync, readSync } from "fs";
var TRANSCRIPT_TAIL_BYTES = 512 * 1024;
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function tailLines(transcriptPath) {
  let text;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  return text.split(`
`);
}
function* entriesFromEnd(lines) {
  for (let index = lines.length - 1;index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line === "")
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isJsonObject(entry))
      yield entry;
  }
}
function lastCustomTitle(transcriptPath) {
  const lines = tailLines(transcriptPath);
  if (lines === null)
    return null;
  for (const entry of entriesFromEnd(lines)) {
    const title = entry.customTitle;
    if (typeof title === "string" && title.trim() !== "")
      return title;
  }
  return null;
}
function lastAssistantText(transcriptPath) {
  const lines = tailLines(transcriptPath);
  if (lines === null)
    return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.type !== "assistant" || !isJsonObject(entry.message))
      continue;
    const content = entry.message.content;
    if (!Array.isArray(content))
      continue;
    return content.filter((block) => isJsonObject(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join(" ");
  }
  return null;
}
function startedByPeer(transcriptPath) {
  const lines = tailLines(transcriptPath);
  if (lines === null)
    return false;
  for (let index = lines.length - 1;index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.includes('"turnOrigin"') && !line.includes('"humanTurn":true'))
      continue;
    if (line.includes('"isCompactSummary":true'))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isJsonObject(entry))
      continue;
    const attachment = isJsonObject(entry.attachment) ? entry.attachment : null;
    const origin = isJsonObject(entry.origin) ? entry.origin : null;
    if (attachment?.humanTurn === true)
      return false;
    if (origin !== null && origin.senderTaskId !== null && origin.senderTaskId !== undefined) {
      return false;
    }
    return entry.turnOrigin === "peer";
  }
  return false;
}

// src/hooks/notify.ts
var NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
  "worker_permission_prompt"
];
var ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"];
var TYPE_BODY = {
  agent_needs_input: "A background agent is waiting for you.",
  elicitation_dialog: "Claude asks you for input.",
  elicitation_url_dialog: "Claude asks you to open a page.",
  permission_prompt: "Claude is waiting for your permission.",
  worker_permission_prompt: "A background worker is waiting for your permission."
};
var WAIT_END_EVENTS = ["PostToolUse", "PostToolUseFailure", "UserPromptSubmit"];
var MAX_TEXT = 180;
var MAX_TITLE = 80;
var ASK_MARK_MS = 10 * 60000;
var TRANSCRIPT_FLUSH_MS = 300;
var SOUND_DIR = "/usr/share/sounds/freedesktop/stereo";
var TERMINAL_SEQUENCE_MIN_VERSION = "2.1.141";
var TERMINAL_SEQUENCE_EVENTS = ["Notification", "PreToolUse", "Stop"];
var WARP_PLUGIN_ID = "warp@claude-code-warp";
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shown(text, fallback) {
  const line = oneLine(text, MAX_TEXT - 1, { mark: "\u2026" });
  return line === "" ? fallback : line;
}
function titled(kind, label) {
  const title = label === null ? kind : `${kind} \xB7 ${label}`;
  return oneLine(title, MAX_TITLE - 1, { mark: "\u2026" });
}
function sessionKey(value) {
  const key = (typeof value === "string" ? value : "none").replace(/[^A-Za-z0-9-]/g, "");
  return key === "" ? "none" : key;
}
function runtimeDir(env) {
  return env.XDG_RUNTIME_DIR || tmpdir();
}
function forget(file) {
  try {
    rmSync(file, { force: true });
  } catch {}
}
function markedWaiting(file, nowMs) {
  try {
    return nowMs - statSync(file).mtimeMs < ASK_MARK_MS;
  } catch {
    return false;
  }
}
function markWaiting(file) {
  try {
    writeFileSync(file, `${Date.now()}
`);
  } catch {}
}
function isSsh(env) {
  return (env.SSH_CONNECTION ?? "") !== "" || (env.SSH_TTY ?? "") !== "";
}
function isWarpTerminal(env) {
  if ((env.TERM_PROGRAM ?? "").toLowerCase() === "warpterminal")
    return true;
  return (env.WARP_CLI_AGENT_PROTOCOL_VERSION ?? "") !== "" && (env.WARP_CLIENT_VERSION ?? "") !== "";
}
function warpPluginOn(claudeConfigDir) {
  try {
    const settings = JSON.parse(readFileSync(join3(claudeConfigDir, "settings.json"), "utf8"));
    if (!isJsonObject2(settings) || !isJsonObject2(settings.enabledPlugins))
      return false;
    if (settings.enabledPlugins[WARP_PLUGIN_ID] !== true)
      return false;
  } catch {
    return false;
  }
  try {
    const installed = JSON.parse(readFileSync(join3(claudeConfigDir, "plugins", "installed_plugins.json"), "utf8"));
    if (!isJsonObject2(installed) || !isJsonObject2(installed.plugins))
      return false;
    const entries = installed.plugins[WARP_PLUGIN_ID];
    return Array.isArray(entries) && entries.length > 0;
  } catch {
    return false;
  }
}
function warpShowsIt(event, input) {
  if (event !== "Notification")
    return true;
  const type = typeof input.notification_type === "string" ? input.notification_type : "";
  return !(type.startsWith("elicitation") || type === "agent_needs_input");
}
function sessionLabel(transcript, cwd) {
  if (transcript !== null) {
    const named = lastCustomTitle(transcript);
    const clean = named === null ? null : cleanSessionName(named);
    if (clean !== null)
      return clean;
  }
  if (cwd === null)
    return null;
  const folder = basename(cwd);
  return folder === "" || folder === "." ? null : cleanSessionName(folder);
}
function askAlert(input, ctx) {
  markWaiting(ctx.mark);
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = isJsonObject2(input.tool_input) ? input.tool_input : {};
  if (tool === "ExitPlanMode") {
    return {
      body: "A plan is ready for your OK",
      critical: true,
      sound: "service-login",
      title: titled("Claude asks you", ctx.label)
    };
  }
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const first = questions.find((question) => isJsonObject2(question) && question !== null);
  const asked = (isJsonObject2(first) && typeof first.question === "string" ? first.question : null) ?? (typeof toolInput.question === "string" ? toolInput.question : null) ?? "";
  return {
    body: shown(asked, "Claude has a question for you"),
    critical: true,
    sound: "service-login",
    title: titled("Claude asks you", ctx.label)
  };
}
function alertFor(input, event, ctx) {
  switch (event) {
    case "StopFailure": {
      forget(ctx.mark);
      if (input.error === "rate_limit")
        return null;
      const key = typeof input.error === "string" ? input.error : "unknown";
      if (readFailed(ctx.failed) === key)
        return null;
      writeFailed(ctx.failed, key);
      const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message : typeof input.message === "string" ? input.message : "";
      return {
        body: shown(text, "The turn ended with an error"),
        critical: true,
        sound: "dialog-warning",
        title: titled("Claude stopped", ctx.label)
      };
    }
    case "Stop": {
      forget(ctx.mark);
      forget(ctx.failed);
      if (input.stop_hook_active === true)
        return null;
      if (ctx.transcript !== null && startedByPeer(ctx.transcript))
        return null;
      const answer = ctx.transcript === null ? null : waitThenLastAnswer(ctx.transcript);
      return {
        body: shown(answer ?? "", "Claude finished its turn."),
        critical: false,
        sound: "service-logout",
        title: titled("Claude finished", ctx.label)
      };
    }
    case "PreToolUse": {
      if (!ASK_TOOLS.includes(String(input.tool_name ?? "")))
        return null;
      return askAlert(input, ctx);
    }
    case "Notification": {
      const type = typeof input.notification_type === "string" ? input.notification_type : "";
      if (!NOTIFY_TYPES.includes(type))
        return null;
      if (markedWaiting(ctx.mark, ctx.nowMs))
        return null;
      const message = typeof input.message === "string" ? input.message : "";
      return {
        body: shown(message, TYPE_BODY[type] ?? "Claude needs you."),
        critical: true,
        sound: "service-login",
        title: titled("Claude needs you", ctx.label)
      };
    }
    default:
      return null;
  }
}
function waitThenLastAnswer(transcript) {
  Bun.sleepSync(TRANSCRIPT_FLUSH_MS);
  return lastAssistantText(transcript);
}
function readFailed(file) {
  try {
    const text = readFileSync(file, "utf8").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}
function writeFailed(file, key) {
  try {
    writeFileSync(file, key);
  } catch {}
}
function terminalRoute(event, env) {
  if (!TERMINAL_SEQUENCE_EVENTS.includes(event))
    return "tty";
  const raw = env.CLAUDE_CODE_VERSION;
  if (raw === undefined || raw === "")
    return "field-if-no-tty";
  return versionAtLeast(raw, TERMINAL_SEQUENCE_MIN_VERSION) ? "field" : "tty";
}
function versionAtLeast(raw, min) {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(raw ?? "");
  if (found === null)
    return false;
  const parts = [1, 2, 3].map((index) => Number(found[index]));
  const least = min.split(".").map(Number);
  for (const [index, want] of least.entries()) {
    const have = parts[index] ?? 0;
    if (have !== want)
      return have > want;
  }
  return true;
}
function notifySequence(title, body) {
  return `\x1B]777;notify;${title.replaceAll(";", ",")};${body}\x07`;
}
function tmuxPassthrough(sequence) {
  return `\x1BPtmux;${sequence.replaceAll("\x1B", "\x1B\x1B")}\x1B\\`;
}
function forTty(sequence, env) {
  return (env.TMUX ?? "") === "" ? sequence : tmuxPassthrough(sequence);
}
var DEFAULT_NOTIFY_CONFIG = { desktopSound: true, sshBell: false };
function readNotifyConfig(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return DEFAULT_NOTIFY_CONFIG;
  }
  if (!isJsonObject2(parsed))
    return DEFAULT_NOTIFY_CONFIG;
  return {
    desktopSound: typeof parsed.desktopSound === "boolean" ? parsed.desktopSound : true,
    sshBell: parsed.sshBell === true
  };
}
var spawnNotify = (argv) => {
  const [file, ...args] = argv;
  if (file === undefined)
    return;
  try {
    const child = spawn(file, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => {
      console.error(`cc-smart-dev-kit notify: could not show the notification: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(`cc-smart-dev-kit notify: ${error instanceof Error ? error.message : error}`);
  }
};
function desktopCommand(alert, deps) {
  if (deps.platform === "linux" && (deps.env.DISPLAY ?? "") === "")
    return null;
  return notifyCommand(alert.body, deps.platform, deps.which, alert.title, alert.critical);
}
function playSound(alert, deps, config) {
  if (alert.sound === null || !config.desktopSound)
    return;
  if (deps.platform !== "linux")
    return;
  const paplay = deps.which("paplay");
  if (paplay === null)
    return;
  deps.run([paplay, join3(SOUND_DIR, `${alert.sound}.oga`)]);
}
function notifyHook(input, event, deps) {
  if (!isJsonObject2(input))
    return SILENT;
  if ((deps.env.CLAUDE_CODE_ENTRYPOINT ?? "cli") !== "cli")
    return SILENT;
  const session = sessionKey(input.session_id);
  const dir = runtimeDir(deps.env);
  const mark = join3(dir, `cc-smart-dev-kit-notify-asked-${session}`);
  const failed = join3(dir, `cc-smart-dev-kit-notify-failed-${session}`);
  if (WAIT_END_EVENTS.includes(event)) {
    forget(mark);
    return SILENT;
  }
  const transcript = typeof input.transcript_path === "string" ? input.transcript_path : null;
  const cwd = typeof input.cwd === "string" ? input.cwd : null;
  const alert = alertFor(input, event, {
    failed,
    label: sessionLabel(transcript, cwd),
    mark,
    nowMs: deps.nowMs,
    transcript
  });
  if (alert === null)
    return SILENT;
  const config = readNotifyConfig(deps.paths.notifyConfigFile);
  const argv = desktopCommand(alert, deps);
  if (isWarpTerminal(deps.env) && warpPluginOn(deps.paths.claudeConfigDir)) {
    if (warpShowsIt(event, input)) {
      if (argv !== null)
        playSound(alert, deps, config);
      return SILENT;
    }
  }
  if (argv !== null) {
    playSound(alert, deps, config);
    deps.run(argv);
    return SILENT;
  }
  if (!isSsh(deps.env))
    return SILENT;
  const sequence = config.sshBell ? `${notifySequence(alert.title, alert.body)}\x07` : notifySequence(alert.title, alert.body);
  const route = terminalRoute(event, deps.env);
  if (route === "field")
    return fieldAnswer(sequence);
  const onTty = forTty(sequence, deps.env);
  if (route === "tty") {
    deps.writeTerminal(onTty);
    return SILENT;
  }
  return deps.writeTerminal(onTty) ? SILENT : fieldAnswer(sequence);
}
function fieldAnswer(sequence) {
  return { stdout: JSON.stringify({ terminalSequence: sequence }) };
}

// src/entries/notify.ts
function writeTerminal(sequence) {
  try {
    const fd = openSync2("/dev/tty", "w");
    try {
      writeSync(fd, sequence);
    } finally {
      closeSync2(fd);
    }
    return true;
  } catch {
    return false;
  }
}
async function hook() {
  let input;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("cc-smart-dev-kit notify: the hook input is not JSON");
    return;
  }
  const event = typeof input === "object" && input !== null && !Array.isArray(input) ? input.hook_event_name : undefined;
  const env = process.env;
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    env,
    nowMs: Date.now(),
    paths: cliPaths(env),
    platform: process.platform,
    run: spawnNotify,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
    writeTerminal
  });
  if (result.stdout !== undefined)
    await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined)
    await Bun.write(Bun.stderr, `${result.stderr}
`);
}
try {
  await hook();
} catch (error) {
  console.error(`cc-smart-dev-kit notify: ${error instanceof Error ? error.message : String(error)}`);
}
