// @bun
// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "cc-smart-dev-kit";

// src/build-info/index.ts
var info = {
  version: "0.6.0",
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

// src/cli/paths.ts
import { join as join2, sep } from "path";

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
    safetyChecksFile: join(home, ".local", "state", "cc-smart-dev-kit", "safety-checks.json")
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
    browserOutputDir: join2(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-output"),
    browserTokenFile: join2(router.home, ".config", "cc-smart-dev-kit", "playwright-extension.token"),
    routerCopy: join2(router.home, ".local", "share", "cc-smart-dev-kit", "router.js"),
    routerTaskFile: join2(router.home, ".local", "share", "cc-smart-dev-kit", "router-task.xml"),
    portalCopy: join2(router.home, ".local", "share", "cc-smart-dev-kit", "portal.js"),
    portalStateFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal.json"),
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
function tildify(path, home) {
  const rest = path.slice(home.length);
  return path === home || path.startsWith(home) && (rest.startsWith("/") || rest.startsWith(sep)) ? `~${rest}` : path;
}

// src/hooks/detached.ts
import { spawn } from "child_process";
var CMD = "cmd";
var CMD_ARGUMENTS = ["/d", "/s", "/v:off", "/c"];
function unableInCmd(argument) {
  if (argument.includes('"'))
    return 'a " would end the quoted argument';
  if (argument.includes("%"))
    return "a % is read as a variable name, inside double quotes too";
  if (/[\r\n]/.test(argument))
    return "a line break ends the command line";
  if (argument.includes("\x00"))
    return "a NUL ends the command line";
  return null;
}
function cmdArgument(argument) {
  const reason = unableInCmd(argument);
  if (reason !== null)
    return { ok: false, reason };
  const trailing = /\\+$/.exec(argument)?.[0] ?? "";
  const kept = argument.slice(0, argument.length - trailing.length);
  return { ok: true, text: `"${kept}${trailing}${trailing}"` };
}
function windowsStart(argv) {
  if (argv[0] === undefined) {
    return { argument: "", ok: false, reason: "there is no program to start" };
  }
  const quoted = [];
  for (const argument of argv) {
    const one = cmdArgument(argument);
    if (!one.ok)
      return { argument, ok: false, reason: one.reason };
    quoted.push(one.text);
  }
  return { argv: [CMD, ...CMD_ARGUMENTS, `"start "" /b ${quoted.join(" ")}"`], ok: true };
}
function forMessage(argument) {
  return argument.replace(/[\r\n]/g, " ").replaceAll("\x00", " ");
}
function detachedArgv(platform, argv) {
  if (platform !== "win32")
    return argv;
  const start = windowsStart(argv);
  return start.ok ? start.argv : [];
}
function startDetached(platform, argv, options) {
  const [file, ...args] = argv;
  if (file === undefined)
    return;
  const where = {
    ...options.cwd !== undefined && { cwd: options.cwd },
    ...options.env !== undefined && { env: options.env }
  };
  try {
    if (platform === "win32") {
      const start = windowsStart(argv);
      if (!start.ok) {
        options.onError(`cannot run "${forMessage(start.argument)}" through cmd.exe: ${start.reason}; nothing was started`);
        return;
      }
      const result = Bun.spawnSync(start.argv, {
        ...where,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true
      });
      const exitCode = result.exitCode ?? 1;
      if (exitCode !== 0)
        options.onError(`cmd /d /s /c start failed (exit ${exitCode})`);
      return;
    }
    const child = spawn(file, args, { ...where, detached: true, stdio: "ignore" });
    child.on("error", (error) => options.onError(error.message));
    child.unref();
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
  }
}

// src/setup/bun-config.ts
import { basename, join as join3 } from "path";
var BUN_CONFIG_NAME = "bunfig.toml";
function bunConfigPath(pluginDir) {
  return join3(pluginDir, BUN_CONFIG_NAME);
}
function bunConfigArg(pluginDir) {
  return `--config=${bunConfigPath(pluginDir)}`;
}
function pluginFolderBeside(importDir) {
  return basename(importDir) === "dist" ? join3(importDir, "..") : join3(importDir, "..", "..", "plugin");
}

// src/setup/instructions.ts
import { existsSync as existsSync10, readdirSync as readdirSync3, readFileSync as readFileSync11, rmSync } from "fs";
import { join as join10, relative, sep as sep2 } from "path";

// src/project/git-env.ts
var REPO_SELECTING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE"
];
function gitEnv(base) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !REPO_SELECTING_GIT_VARS.includes(key))
      env[key] = value;
  }
  return env;
}

// src/setup/installed-plugins.ts
import { existsSync, readFileSync } from "fs";
function findUserInstall(installedPluginsFile, pluginId = PLUGIN_ID) {
  if (!existsSync(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = parsed?.plugins;
  const entries = plugins?.[pluginId];
  if (!Array.isArray(entries))
    return null;
  const entry = entries.find((candidate) => typeof candidate === "object" && candidate !== null && candidate.scope === "user" && typeof candidate.installPath === "string");
  if (!entry)
    return null;
  return {
    installPath: entry.installPath,
    version: typeof entry.version === "string" ? entry.version : null
  };
}

// src/setup/marketplace-access.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { join as join4 } from "path";
var ACCESS_TIMEOUT_MS = 1e4;
function marketplaceSource(knownMarketplacesFile, name, env = process.env) {
  if (!existsSync2(knownMarketplacesFile))
    return { kind: "missing" };
  let known;
  try {
    known = JSON.parse(readFileSync2(knownMarketplacesFile, "utf8"));
  } catch {
    return { kind: "missing" };
  }
  const entry = known?.[name];
  const source = entry?.source;
  if (!source || typeof source.source !== "string")
    return { kind: "missing" };
  const text = (key) => typeof source[key] === "string" ? source[key] : null;
  const ref = text("ref");
  const withRef = ref ? { ref } : {};
  switch (source.source) {
    case "github": {
      const repo = text("repo");
      if (!repo)
        return { kind: "unknown", type: "github without repo" };
      const ssh = `git@github.com:${repo}.git`;
      const https = `https://github.com/${repo}.git`;
      const preferHttps = Boolean(env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS);
      return { kind: "git", urls: preferHttps ? [https, ssh] : [ssh, https], ...withRef };
    }
    case "git": {
      const url = text("url");
      return url ? { kind: "git", urls: [url], ...withRef } : { kind: "unknown", type: "git without url" };
    }
    case "url": {
      const url = text("url");
      return url ? { kind: "http", url } : { kind: "unknown", type: "url without url" };
    }
    case "directory":
    case "file": {
      const path = text("path");
      return path ? { kind: "local", path } : { kind: "unknown", type: `${source.source} without path` };
    }
    default:
      return { kind: "unknown", type: source.source };
  }
}
var BATCH_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=8";
var TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);
function redactUrl(url) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is.exec(url);
  let result = url;
  if (match) {
    const [, scheme = "", authority = "", rest = ""] = match;
    const at = authority.lastIndexOf("@");
    if (at >= 0) {
      const userinfo = authority.slice(0, at);
      const host = authority.slice(at + 1);
      const colon = userinfo.indexOf(":");
      const safeUser = TOKEN_SCHEMES.has(scheme.toLowerCase()) ? "***" : colon >= 0 ? `${userinfo.slice(0, colon)}:***` : userinfo;
      result = `${scheme}://${safeUser}@${host}${rest}`;
    }
  }
  const hash = result.indexOf("#");
  if (hash >= 0)
    result = result.slice(0, hash);
  const query = result.indexOf("?");
  return query >= 0 ? `${result.slice(0, query)}?***` : result;
}
function redactUrlsIn(text) {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (url) => redactUrl(url));
}
function hasOwnSshCommand(env) {
  if (env.GIT_SSH_COMMAND || env.GIT_SSH)
    return true;
  try {
    const result = Bun.spawnSync(["git", "config", "--get", "core.sshCommand"], {
      env,
      stdout: "pipe",
      stderr: "ignore",
      timeout: ACCESS_TIMEOUT_MS
    });
    return result.exitCode === 0 && result.stdout.toString().trim() !== "";
  } catch {
    return false;
  }
}
function gitAccessEnv(baseEnv) {
  const env = { ...baseEnv, GIT_TERMINAL_PROMPT: "0" };
  if (!hasOwnSshCommand(env))
    env.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  return env;
}
function gitRemoteHead(url, ref, baseEnv = process.env) {
  const result = lsRemote(url, ref, baseEnv);
  if (!result.ok)
    return { detail: result.detail, ok: false };
  const lines = result.stdout.split(`
`).map((line) => line.trim().split(/\s+/)).filter((fields) => fields.length === 2);
  const line = lines.find(([, name]) => name.endsWith("^{}")) ?? lines[0];
  if (line === undefined || !/^[0-9a-f]{40,64}$/.test(line[0])) {
    return { detail: `the remote has no ${ref}`, ok: false };
  }
  return { ok: true, sha: line[0] };
}
function lsRemote(url, ref, baseEnv) {
  const env = gitAccessEnv(baseEnv);
  try {
    const result = Bun.spawnSync(["git", "ls-remote", url, ref], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS
    });
    if (result.exitCode === 0)
      return { ok: true, stdout: result.stdout.toString() };
    const said = redactUrlsIn(result.stderr.toString().trim());
    const detail = result.signalCode ? "timed out" : (said.split(`
`).at(-1) ?? "").trim();
    const output = said || `git exited with ${result.exitCode}`;
    return {
      detail: detail || `git exited with ${result.exitCode}`,
      ok: false,
      output
    };
  } catch (error) {
    const said = redactUrlsIn(error instanceof Error ? error.message : String(error));
    return { detail: said, ok: false, output: said };
  }
}
function marketplaceInstallLocation(knownMarketplacesFile, name) {
  if (!existsSync2(knownMarketplacesFile))
    return null;
  try {
    const known = JSON.parse(readFileSync2(knownMarketplacesFile, "utf8"));
    const location = known?.[name]?.installLocation;
    return typeof location === "string" && location !== "" ? location : null;
  } catch {
    return null;
  }
}
function pluginFolderIn(marketplaceJson, plugin) {
  try {
    const manifest = JSON.parse(marketplaceJson);
    const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
    const entry = plugins.find((candidate) => typeof candidate === "object" && candidate !== null && candidate.name === plugin);
    if (typeof entry?.source !== "string")
      return null;
    const folder = entry.source.replace(/^\.\//, "").replace(/\/+$/, "");
    return folder === "" || folder.split("/").includes("..") ? null : folder;
  } catch {
    return null;
  }
}
function marketplaceCopyVersion(location, plugin) {
  let folder = "plugin";
  try {
    folder = pluginFolderIn(readFileSync2(join4(location, ".claude-plugin", "marketplace.json"), "utf8"), plugin) ?? folder;
  } catch {}
  const manifest = join4(location, folder, ".claude-plugin", "plugin.json");
  try {
    const version = JSON.parse(readFileSync2(manifest, "utf8"))?.version;
    return { manifest, version: typeof version === "string" ? version : null };
  } catch {
    return { manifest, version: null };
  }
}

// src/update/check.ts
var GIT_TIMEOUT_MS = 20000;
function isOlder(a, b) {
  if (b === null)
    return false;
  if (a === null)
    return true;
  try {
    return Bun.semver.order(a, b) < 0;
  } catch {
    return false;
  }
}
function localHead(folder, env) {
  try {
    const result = Bun.spawnSync(["git", "-C", folder, "rev-parse", "HEAD"], {
      env: gitEnv(env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: GIT_TIMEOUT_MS
    });
    const head = result.stdout.toString().trim();
    return result.exitCode === 0 && /^[0-9a-f]{40,64}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}
function checkForUpdate(paths, env) {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null)
    return { kind: "not-installed" };
  const source = marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE, env);
  if (source.kind === "missing") {
    return { detail: `the ${MARKETPLACE} marketplace is not added`, kind: "no-marketplace" };
  }
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  if (location === null) {
    return {
      detail: `the ${MARKETPLACE} marketplace has no local copy`,
      kind: "no-marketplace"
    };
  }
  const inCopy = marketplaceCopyVersion(location, PLUGIN).version;
  let remote = null;
  let catalogBehind = false;
  if (source.kind === "git") {
    const ref = source.ref ?? "HEAD";
    const failures = [];
    for (const url of source.urls) {
      const head = gitRemoteHead(url, ref, env);
      if (head.ok) {
        remote = { head: head.sha, ref, url };
        break;
      }
      failures.push(`${redactUrl(url)}: ${head.detail}`);
    }
    if (remote === null)
      return { detail: failures.join("; "), kind: "unreachable" };
    catalogBehind = localHead(location, env) !== remote.head;
  }
  if (catalogBehind || isOlder(install.version, inCopy)) {
    return {
      catalogBehind,
      inCopy,
      installed: install.version,
      kind: "behind",
      remote
    };
  }
  return { installed: install.version ?? "(no version)", kind: "up-to-date" };
}

// src/setup/lock.ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync as readFileSync3,
  readlinkSync,
  statSync,
  unlinkSync,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join5 } from "path";

// src/setup/file-mode.ts
import { chmodSync, fchmodSync } from "fs";
function failureIsFatal(platform) {
  return platform !== "win32";
}
function setFileMode(fileOrFd, mode, platform = hostPlatform()) {
  try {
    if (typeof fileOrFd === "number")
      fchmodSync(fileOrFd, mode);
    else
      chmodSync(fileOrFd, mode);
  } catch (error) {
    if (failureIsFatal(platform))
      throw error;
  }
}

// src/setup/lock.ts
var FALLBACK_STALE_MS = 10 * 60 * 1000;
var LOCK_FILE = "lock";
var TAKEOVER_SUFFIX = ".takeover";

class LockBusyError extends Error {
  name = "LockBusyError";
}
function procStartTime(pid) {
  try {
    const stat = readFileSync3(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const start = fields[22 - 3];
    return start && /^\d+$/.test(start) ? start : null;
  } catch {
    return null;
  }
}
function psStartTime(pid) {
  try {
    const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C" },
      stdout: "pipe",
      stderr: "ignore"
    });
    const text = result.stdout.toString().trim();
    return result.exitCode === 0 && text !== "" ? text : null;
  } catch {
    return null;
  }
}
function processStartTime(pid, like) {
  if (like === undefined || like.startsWith("proc:")) {
    const proc = procStartTime(pid);
    if (proc !== null)
      return `proc:${proc}`;
  }
  if (like === undefined || like.startsWith("ps:")) {
    const ps = psStartTime(pid);
    if (ps !== null)
      return `ps:${ps}`;
  }
  return null;
}
function ownPidNamespace() {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}
var ownPidns;
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function parseLock(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.pid !== "number" || typeof parsed.time !== "number" || typeof parsed.token !== "string") {
      return null;
    }
    return {
      pid: parsed.pid,
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : null,
      host: typeof parsed.host === "string" ? parsed.host : "",
      pidns: typeof parsed.pidns === "string" ? parsed.pidns : null,
      time: parsed.time,
      token: parsed.token
    };
  } catch {
    return null;
  }
}
function readHeld(file) {
  let stat;
  try {
    stat = statSync(file);
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
  let info;
  try {
    info = parseLock(readFileSync3(file, "utf8"));
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT")
      return null;
    if (code !== "EACCES" && code !== "EPERM")
      throw error;
    info = null;
  }
  return { info, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
}
function sameHeld(a, b) {
  if (a.info && b.info)
    return a.info.token === b.info.token;
  if (a.info || b.info)
    return false;
  return a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;
}
function holderIsGone(holder, lastSeenMs, fallbackStaleMs, startTimeOf = processStartTime) {
  const oldEnough = Date.now() - lastSeenMs > fallbackStaleMs;
  if (holder === null || holder.host !== hostname())
    return oldEnough;
  ownPidns ??= ownPidNamespace();
  const theirs = holder.pidns ?? null;
  if (theirs !== null && ownPidns !== null && theirs !== ownPidns)
    return oldEnough;
  if (!isAlive(holder.pid))
    return true;
  if (holder.startTime === null)
    return oldEnough;
  const now = startTimeOf(holder.pid, holder.startTime);
  if (now === null)
    return oldEnough;
  return now !== holder.startTime;
}
function isStale(held, fallbackStaleMs) {
  return holderIsGone(held.info, held.info?.time ?? held.mtimeMs, fallbackStaleMs);
}
function tryCreate(file, info, mode) {
  let fd;
  try {
    fd = openSync(file, "wx", mode);
  } catch (error) {
    if (error.code === "EEXIST")
      return false;
    throw error;
  }
  try {
    setFileMode(fd, mode);
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
  return true;
}
var ownStartTime;
function currentHolder() {
  ownStartTime ??= processStartTime(process.pid);
  ownPidns ??= ownPidNamespace();
  return { pid: process.pid, startTime: ownStartTime, host: hostname(), pidns: ownPidns };
}
function newLockInfo() {
  return { ...currentHolder(), time: Date.now(), token: crypto.randomUUID() };
}
function takeOverStale(file, judged, fallbackStaleMs, mode) {
  const claim = `${file}${TAKEOVER_SUFFIX}`;
  const me = newLockInfo();
  if (!tryCreate(claim, me, mode)) {
    const other = readHeld(claim);
    if (other && isStale(other, fallbackStaleMs)) {
      const again = readHeld(claim);
      if (again && sameHeld(again, other))
        unlinkSync(claim);
    }
    return false;
  }
  try {
    const now = readHeld(file);
    if (now && sameHeld(now, judged))
      unlinkSync(file);
    return true;
  } finally {
    if (readHeld(claim)?.info?.token === me.token)
      unlinkSync(claim);
  }
}
async function withLock(stateDir, fn, options = {}) {
  mkdirSync(stateDir, { recursive: true });
  const file = join5(stateDir, LOCK_FILE);
  const mine = newLockInfo();
  const deadline = Date.now() + (options.waitMs ?? 0);
  const fallbackStaleMs = options.fallbackStaleMs ?? FALLBACK_STALE_MS;
  const mode = options.mode ?? 384;
  for (;; ) {
    mine.time = Date.now();
    if (tryCreate(file, mine, mode))
      break;
    const held = readHeld(file);
    if (held === null)
      continue;
    if (isStale(held, fallbackStaleMs) && takeOverStale(file, held, fallbackStaleMs, mode)) {
      continue;
    }
    if (Date.now() >= deadline) {
      const info = held.info;
      const where = info && info.host !== hostname() ? ` on ${info.host || "another host"}` : "";
      const who = info ? `process ${info.pid}${where}` : "another run";
      throw new LockBusyError(`cc-smart-dev-kit is busy: ${who} holds ${file}. Wait for it to finish, then try again.`);
    }
    await Bun.sleep(100);
  }
  try {
    return await fn();
  } finally {
    if (readHeld(file)?.info?.token === mine.token)
      unlinkSync(file);
  }
}

// src/setup/managed-markdown.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "fs";

// src/setup/write.ts
import {
  closeSync as closeSync2,
  existsSync as existsSync3,
  fsyncSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync4,
  readlinkSync as readlinkSync2,
  realpathSync,
  renameSync,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "fs";
import { basename as basename2, dirname, join as join6, resolve } from "path";
var BACKUPS_DIR = "backups";
var BACKUP_INFIX = ".bak-cc-smart-dev-kit-";
var ABSENT_SUFFIX = ".absent";
var CHANGED_FILE = "changed.json";
var MAX_LINKS = 40;
function utcStamp(date = new Date) {
  return date.toISOString().replace(/[-:.]/g, "");
}
function realTarget(file) {
  let path = resolve(file);
  for (let links = 0;links <= MAX_LINKS; links += 1) {
    try {
      return realpathSync(path);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    let isLink = false;
    try {
      isLink = lstatSync(path).isSymbolicLink();
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    if (!isLink) {
      const parent = dirname(path);
      return parent === path ? path : join6(realTarget(parent), basename2(path));
    }
    path = resolve(dirname(path), readlinkSync2(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}
function fileMode(file) {
  return existsSync3(file) ? statSync2(file).mode & 4095 : null;
}
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync2(dir, { recursive: true });
  const temp = join6(dir, `.${basename2(file)}.cc-smart-dev-kit-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const fd = openSync2(temp, "wx", mode);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync2(fd);
    }
    setFileMode(temp, mode);
  } catch (error) {
    if (existsSync3(temp))
      unlinkSync2(temp);
    throw error;
  }
  return temp;
}
function atomicWrite(file, content, mode, beforeRename) {
  const temp = writeTemp(file, content, mode);
  try {
    beforeRename?.();
    renameSync(temp, file);
  } catch (error) {
    if (existsSync3(temp))
      unlinkSync2(temp);
    throw error;
  }
}
function parseBackupName(base, name) {
  const prefix = `${base}${BACKUP_INFIX}`;
  if (!name.startsWith(prefix))
    return null;
  const match = /^(\d{8}T\d{9}Z)(?:-(\d+))?(?:(\.absent)|\.mode-([0-7]{3,4}))?$/.exec(name.slice(prefix.length));
  if (!match?.[1])
    return null;
  return {
    name,
    stamp: match[1],
    counter: match[2] ? Number(match[2]) : 0,
    absent: match[3] !== undefined,
    mode: match[4] ? Number.parseInt(match[4], 8) : null
  };
}
function backupDir(stateDir, file) {
  return join6(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}
function makePrivateDir(dir) {
  mkdirSync2(dir, { recursive: true, mode: 448 });
  setFileMode(dir, 448);
}
function listBackups(stateDir, file) {
  const dir = backupDir(stateDir, file);
  if (!existsSync3(dir))
    return [];
  const base = basename2(realTarget(file));
  return readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup !== null).sort((a, b) => a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1).map((backup) => {
    const path = join6(dir, backup.name);
    return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 384 };
  });
}
function copyNotExecutable(file, target) {
  const mode = fileMode(file) ?? 384;
  const safeMode = mode & ~73;
  writeFileSync(target, readFileSync4(file), { flag: "wx", mode: safeMode });
  setFileMode(target, safeMode);
  return mode;
}
function backupFile(stateDir, file) {
  const real = realTarget(file);
  const dir = backupDir(stateDir, real);
  const base = basename2(real);
  const stamp = utcStamp();
  const mode = fileMode(real);
  const suffix = mode === null ? ABSENT_SUFFIX : (mode & 73) !== 0 ? `.mode-${mode.toString(8)}` : "";
  makePrivateDir(join6(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  const sameStamp = readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup?.stamp === stamp);
  const counter = sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join6(dir, `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`);
  if (mode === null) {
    writeFileSync(target, "", { flag: "wx", mode: 384 });
  } else {
    copyNotExecutable(real, target);
  }
  return target;
}
var CHANGE_KINDS = [
  "json-keys",
  "json-entries",
  "markdown-block",
  "file-line",
  "whole-file"
];
function isChangedEntry(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const entry = value;
  return Array.isArray(entry.kinds) && entry.kinds.every((kind) => CHANGE_KINDS.includes(kind)) && (entry.baseline === null || typeof entry.baseline === "string") && (entry.lines === undefined || Array.isArray(entry.lines) && entry.lines.every((line) => typeof line === "string"));
}
function readChanged(stateDir) {
  const file = join6(stateDir, CHANGED_FILE);
  if (!existsSync3(file))
    return {};
  const parsed = JSON.parse(readFileSync4(file, "utf8"));
  const files = parsed?.files;
  if (typeof files !== "object" || files === null || !Object.values(files).every((entry) => isChangedEntry(entry))) {
    throw new Error(`Invalid ${file}: expected { "files": { <path>: { kinds, baseline } } }`);
  }
  return files;
}
function writeChanged(stateDir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
  atomicWrite(join6(stateDir, CHANGED_FILE), `${JSON.stringify({ files: sorted }, null, 2)}
`, 384);
}
function recordChange(stateDir, file, kind, backup, lines) {
  const files = readChanged(stateDir);
  const entry = files[file];
  if (!entry) {
    files[file] = {
      kinds: [kind],
      baseline: backup,
      ...lines !== undefined && lines.length > 0 && { lines: [...lines] }
    };
    writeChanged(stateDir, files);
    return true;
  }
  let changed = false;
  if (!entry.kinds.includes(kind)) {
    entry.kinds.push(kind);
    changed = true;
  }
  for (const line of lines ?? []) {
    const known = entry.lines ?? [];
    if (known.includes(line))
      continue;
    entry.lines = [...known, line];
    changed = true;
  }
  if (changed)
    writeChanged(stateDir, files);
  return false;
}
function forgetChange(stateDir, file) {
  const files = readChanged(stateDir);
  if (!(file in files))
    return;
  delete files[file];
  writeChanged(stateDir, files);
}

class ConcurrentChangeError extends Error {
  name = "ConcurrentChangeError";
}
function retryOnConcurrentChange(file, fn, attempts = 3) {
  for (let attempt = 1;; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof ConcurrentChangeError) || attempt >= attempts) {
        if (error instanceof ConcurrentChangeError) {
          throw new ConcurrentChangeError(`${file} kept changing while cc-smart-dev-kit tried to update it (${attempts} tries). ` + "Close the program that writes it (for example Claude Code), then run again.");
        }
        throw error;
      }
    }
  }
}
function readCurrent(file) {
  return existsSync3(file) ? readFileSync4(file, "utf8") : null;
}
function writeManagedFile(file, content, options) {
  const target = realTarget(file);
  const currentMode = fileMode(target);
  const current = currentMode === null ? null : readFileSync4(target, "utf8");
  const checkUnchanged = (now) => {
    if (options.expectedContent !== undefined && now !== options.expectedContent) {
      throw new ConcurrentChangeError(`${target} changed after cc-smart-dev-kit read it.`);
    }
  };
  if (!options.dryRun)
    checkUnchanged(current);
  const wantedMode = options.mode ?? currentMode ?? options.newFileMode ?? 384;
  if (current === content && currentMode === wantedMode) {
    return { outcome: "unchanged", backup: null };
  }
  const outcome = currentMode === null ? "created" : "updated";
  if (options.dryRun)
    return { outcome, backup: null };
  if (options.record !== false && options.kind === undefined) {
    throw new Error("writeManagedFile: a recorded write needs its kind");
  }
  const backup = backupFile(options.stateDir, target);
  const isBaseline = options.record === false ? false : recordChange(options.stateDir, target, options.kind, backup, options.lines);
  try {
    atomicWrite(target, content, wantedMode, () => {
      options.onBeforeCompare?.();
      checkUnchanged(readCurrent(target));
    });
  } catch (error) {
    if (!isBaseline && existsSync3(backup))
      unlinkSync2(backup);
    throw error;
  }
  return { outcome, backup };
}
function removeManagedFile(stateDir, file) {
  const backup = backupFile(stateDir, file);
  unlinkSync2(file);
  return backup;
}

// src/setup/managed-markdown.ts
var BLOCK_BEGIN = "<!-- cc-smart-dev-kit:begin -->";
var BLOCK_END = "<!-- cc-smart-dev-kit:end -->";
function countOf(text, marker) {
  return text.split(marker).length - 1;
}
function findBlock(current, file) {
  const begins = countOf(current, BLOCK_BEGIN);
  const ends = countOf(current, BLOCK_END);
  if (begins === 0 && ends === 0)
    return null;
  const start = current.indexOf(BLOCK_BEGIN);
  const end = current.indexOf(BLOCK_END);
  if (begins !== 1 || ends !== 1 || end < start) {
    throw new Error(`${file} has a broken cc-smart-dev-kit block (${begins} begin and ${ends} end markers). ` + "Fix it by hand: keep one begin marker and one end marker after it.");
  }
  return { start, end: end + BLOCK_END.length };
}
function renderWithoutBlock(current, file = "the file") {
  const found = findBlock(current, file);
  if (found === null)
    return current;
  let before = current.slice(0, found.start);
  let after = current.slice(found.end);
  if (after.startsWith(`
`))
    after = after.slice(1);
  if (before === "" && after.startsWith(`
`))
    after = after.slice(1);
  if (before.endsWith(`

`) && (after === "" || after.startsWith(`
`))) {
    before = before.slice(0, -1);
  }
  return `${before}${after}`;
}
function writeMarkdown(options, render) {
  const file = realTarget(options.file);
  return retryOnConcurrentChange(file, () => {
    const text = existsSync4(file) ? readFileSync5(file, "utf8") : null;
    const next = render(text ?? "", file);
    if (text === null && next === "")
      return { outcome: "unchanged", backup: null };
    options.onBeforeWrite?.();
    return writeManagedFile(file, next, {
      stateDir: options.stateDir,
      kind: "markdown-block",
      newFileMode: 420,
      expectedContent: text,
      ...options.dryRun !== undefined && { dryRun: options.dryRun }
    });
  });
}
function removeManagedMarkdown(options) {
  return writeMarkdown(options, renderWithoutBlock);
}

// src/setup/restore.ts
import { existsSync as existsSync9, readdirSync as readdirSync2, readFileSync as readFileSync10, rmdirSync } from "fs";
import { dirname as dirname2 } from "path";

// src/setup/managed-entries.ts
import { existsSync as existsSync6, readFileSync as readFileSync7 } from "fs";
import { join as join8 } from "path";

// src/setup/managed-json.ts
import { createHash } from "crypto";
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "fs";
import { join as join7 } from "path";
var OWNED_FILE = "owned.json";

class ForeignKeyError extends Error {
  name = "ForeignKeyError";
}
function formatKeyPath(path) {
  return path.map((segment, index) => {
    if (/^[A-Za-z_$][\w$]*$/.test(segment))
      return index === 0 ? segment : `.${segment}`;
    return `[${JSON.stringify(segment)}]`;
  }).join("");
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function samePath(a, b) {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}
function detectIndent(text) {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
function readJsonObject(file) {
  if (!existsSync5(file))
    return { data: {}, indent: "  ", text: null };
  const text = readFileSync6(file, "utf8");
  if (text.trim() === "")
    return { data: {}, indent: "  ", text };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject(parsed))
    throw new Error(`${file} must hold a JSON object.`);
  return { data: parsed, indent: detectIndent(text), text };
}
function toRecord(entry, file) {
  if (Array.isArray(entry) && entry.every((segment) => typeof segment === "string")) {
    return { path: [...entry] };
  }
  if (isObject(entry) && Array.isArray(entry.path) && entry.path.every((segment) => typeof segment === "string")) {
    const record = { path: [...entry.path] };
    if (Object.hasOwn(entry, "value"))
      record.value = entry.value;
    if (typeof entry.sha256 === "string")
      record.sha256 = entry.sha256;
    return record;
  }
  throw new Error(`Invalid ${file}: an owned key that is neither a path nor a record`);
}
function readOwned(stateDir) {
  const file = join7(stateDir, OWNED_FILE);
  if (!existsSync5(file))
    return {};
  const parsed = JSON.parse(readFileSync6(file, "utf8"));
  if (!isObject(parsed))
    throw new Error(`Invalid ${file}: expected an object`);
  const owned = {};
  for (const [target, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries))
      throw new Error(`Invalid ${file}: expected a list per file`);
    owned[target] = entries.map((entry) => toRecord(entry, file));
  }
  return owned;
}
function writeOwned(stateDir, owned) {
  atomicWrite(join7(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}
`, 384);
}
function ownedKeys(stateDir, file) {
  return ownedRecords(stateDir, file).map((record) => record.path);
}
function ownedRecords(stateDir, file) {
  return readOwned(stateDir)[file] ?? [];
}
function hashOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function recordOf(path, value, secret) {
  return secret ? { path: [...path], sha256: hashOf(value) } : { path: [...path], value };
}
function ownership(records, path, current, unchosen) {
  const record = records.find((entry) => samePath(entry.path, path));
  if (record === undefined)
    return "none";
  if (!current.found)
    return "changed";
  if (record.sha256 !== undefined) {
    if (hashOf(current.value) === record.sha256)
      return "ours";
  } else if (!Object.hasOwn(record, "value")) {
    return "ours";
  } else if (Bun.deepEquals(current.value, record.value, true)) {
    return "ours";
  }
  return unchosen?.(path, current.value) ? "ours" : "changed";
}
function getKey(data, path) {
  let node = data;
  for (const segment of path) {
    if (!isObject(node) || !Object.hasOwn(node, segment))
      return { found: false, value: undefined };
    node = node[segment];
  }
  return { found: true, value: node };
}
function setKey(data, path, value) {
  let node = data;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const next = node[segment];
    if (next === undefined) {
      node[segment] = {};
    } else if (!isObject(next)) {
      throw new ForeignKeyError(`Cannot set ${formatKeyPath(path)}: ${formatKeyPath(path.slice(0, index + 1))} is not an object.`);
    }
    node = node[segment];
  }
  const leaf = path.at(-1);
  if (leaf !== undefined)
    node[leaf] = structuredClone(value);
}
function deleteKey(data, path) {
  const parent = getKey(data, path.slice(0, -1));
  const leaf = path.at(-1);
  if (parent.found && isObject(parent.value) && leaf !== undefined)
    delete parent.value[leaf];
}
function deleteKeyAndEmptiedObjects(data, path, createdObject) {
  deleteKey(data, path);
  const removed = [];
  for (let depth = path.length - 1;depth >= 1; depth -= 1) {
    const parentPath = path.slice(0, depth);
    const parent = getKey(data, parentPath);
    if (!parent.found || !isObject(parent.value))
      break;
    if (Object.keys(parent.value).length > 0)
      break;
    if (createdObject?.(parentPath) !== true)
      break;
    deleteKey(data, parentPath);
    removed.push(parentPath);
  }
  return removed;
}
function createdObjects(stateDir, file) {
  const real = realTarget(file);
  let entry;
  try {
    entry = readChanged(stateDir)[real];
  } catch (error) {
    console.error(`cc-smart-dev-kit: the record of changed files cannot be read (${error instanceof Error ? error.message : String(error)}), so nothing is pruned from ${real}.`);
    return () => false;
  }
  const baseline = entry === undefined ? undefined : listBackups(stateDir, real).find((backup) => backup.path === entry.baseline);
  if (baseline === undefined)
    return () => false;
  if (baseline.absent)
    return () => true;
  let before;
  try {
    before = readJsonObject(baseline.path).data;
  } catch {
    return () => false;
  }
  return (path) => !getKey(before, path).found;
}
function applyManagedJson(options) {
  const file = realTarget(options.file);
  const snapshot = readOwned(options.stateDir);
  return retryOnConcurrentChange(file, () => applyOnce(file, options, snapshot));
}
function applyOnce(file, options, owned) {
  const { data, indent, text } = readJsonObject(file);
  const ownedHere = owned[file] ?? [];
  const isSecret = (path) => options.secret?.(path) ?? false;
  const shown = (path, value) => isSecret(path) ? "a secret" : JSON.stringify(value);
  const changes = [];
  const skipped = [];
  const updated = [];
  const dropped = [];
  let setsSecret = false;
  for (const [path, value] of options.set ?? []) {
    if (path.length === 0)
      throw new Error("applyManagedJson: an empty key path");
    if (isSecret(path))
      setsSecret = true;
    const current = getKey(data, path);
    const whose = ownership(ownedHere, path, current, options.unchosen);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      if (whose === "none") {
        skipped.push({ path, reason: "already set by someone else; left alone" });
      } else if (whose === "changed") {
        skipped.push({
          path,
          reason: "set by you since; left alone, no longer cc-smart-dev-kit's"
        });
        dropped.push(path);
      } else {
        updated.push(recordOf(path, value, isSecret(path)));
      }
      continue;
    }
    if (current.found && whose === "changed") {
      throw new ForeignKeyError(`${file}: ${formatKeyPath(path)} is ${shown(path, current.value)}: it was changed after cc-smart-dev-kit set it, so it is your choice now. ` + "cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it again.");
    }
    if (current.found && whose === "none" && !options.unchosen?.(path, current.value)) {
      throw new ForeignKeyError(`${file}: ${formatKeyPath(path)} is ${shown(path, current.value)}, set by someone else. ` + "cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it.");
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
    updated.push(recordOf(path, value, isSecret(path)));
  }
  for (const path of options.remove ?? []) {
    const current = getKey(data, path);
    const whose = ownership(ownedHere, path, current);
    if (whose === "none") {
      skipped.push({ path, reason: "not owned by cc-smart-dev-kit; left alone" });
      continue;
    }
    dropped.push(path);
    if (whose === "changed") {
      skipped.push({
        path,
        reason: current.found ? "changed since cc-smart-dev-kit set it; left alone" : "not in the file any more (removed since cc-smart-dev-kit set it); left alone"
      });
      continue;
    }
    if (!current.found)
      continue;
    const emptied = deleteKeyAndEmptiedObjects(data, path, options.createdObject);
    changes.push({ path, before: current.value, after: undefined });
    for (const parentPath of emptied) {
      changes.push({ path: parentPath, before: {}, after: undefined });
    }
  }
  const touched = (entry) => updated.some((record) => samePath(record.path, entry.path)) || dropped.some((path) => samePath(path, entry.path));
  const finalOwned = [...ownedHere.filter((entry) => !touched(entry)), ...updated];
  const ownedChanged = !Bun.deepEquals([...finalOwned].sort(byPath), [...ownedHere].sort(byPath), true);
  if (options.dryRun || changes.length === 0 && !ownedChanged) {
    return { file, changes, skipped, written: false, backup: null };
  }
  const nextState = (records) => {
    const next = { ...owned, [file]: records };
    if (records.length === 0)
      delete next[file];
    return next;
  };
  const changedPaths = changes.filter((change) => change.after !== undefined);
  if (changedPaths.length > 0) {
    const pending = [
      ...ownedHere.filter((entry) => !changedPaths.some((c) => samePath(c.path, entry.path))),
      ...changedPaths.map((change) => ({ path: [...change.path] }))
    ];
    writeOwned(options.stateDir, nextState(pending));
  }
  let written = false;
  let backup = null;
  if (changes.length > 0) {
    options.onBeforeWrite?.();
    let result;
    try {
      result = writeManagedFile(file, `${JSON.stringify(data, null, indent)}
`, {
        stateDir: options.stateDir,
        kind: "json-keys",
        newFileMode: 384,
        ...setsSecret && { mode: 384 },
        expectedContent: text
      });
    } catch (error) {
      if (changedPaths.length > 0)
        writeOwned(options.stateDir, owned);
      throw error;
    }
    written = result.outcome !== "unchanged";
    backup = result.backup;
  }
  writeOwned(options.stateDir, nextState(finalOwned));
  return { file, changes, skipped, written, backup };
}
function byPath(a, b) {
  const left = JSON.stringify(a.path);
  const right = JSON.stringify(b.path);
  return left < right ? -1 : left > right ? 1 : 0;
}

// src/setup/managed-entries.ts
var OWNED_ENTRIES_FILE = "owned-entries.json";
var ANCHOR_SOURCE = "";
function pathKey(path) {
  return JSON.stringify(path);
}
function isOwnedEntry(value) {
  return isObject(value) && typeof value.entry === "string" && typeof value.source === "string";
}
function readOwnedEntries(stateDir) {
  const file = join8(stateDir, OWNED_ENTRIES_FILE);
  if (!existsSync6(file))
    return {};
  const parsed = JSON.parse(readFileSync7(file, "utf8"));
  const valid = isObject(parsed) && Object.values(parsed).every((lists) => isObject(lists) && Object.values(lists).every((list) => Array.isArray(list) && list.every(isOwnedEntry)));
  if (!valid) {
    throw new Error(`Invalid ${file}: expected { <file>: { <key path>: [{ "entry", "source" }] } }`);
  }
  return parsed;
}
function writeOwnedEntries(stateDir, state) {
  atomicWrite(join8(stateDir, OWNED_ENTRIES_FILE), `${JSON.stringify(state, null, 2)}
`, 384);
}
function withRecords(state, file, key, records) {
  const lists = { ...state[file] ?? {} };
  if (records.length === 0)
    delete lists[key];
  else
    lists[key] = records;
  const next = { ...state };
  if (Object.keys(lists).length === 0)
    delete next[file];
  else
    next[file] = lists;
  return next;
}
function ownedEntries(stateDir, file) {
  return readOwnedEntries(stateDir)[file] ?? {};
}
function deleteWithEmptyParents(data, path) {
  deleteKey(data, path);
  for (let depth = path.length - 1;depth > 0; depth -= 1) {
    const parent = getKey(data, path.slice(0, depth));
    if (!parent.found || !isObject(parent.value) || Object.keys(parent.value).length > 0)
      return;
    deleteKey(data, path.slice(0, depth));
  }
}
function applyOnce2(file, options, plan, snapshot) {
  const { path } = options;
  const key = pathKey(path);
  const { data, indent, text } = readJsonObject(file);
  const current = getKey(data, path);
  if (current.found && !(Array.isArray(current.value) && current.value.every((item) => typeof item === "string"))) {
    throw new ForeignKeyError(`${file}: ${formatKeyPath(path)} is not a list of strings. cc-smart-dev-kit does not change it.`);
  }
  const list = current.found ? [...current.value] : [];
  const records = [...snapshot[file]?.[key] ?? []];
  const live = records.filter((record) => list.includes(record.entry));
  const added = [];
  const removed = [];
  const skipped = [];
  let kept;
  if (plan.kind === "all") {
    kept = [];
  } else {
    const wanted = [...new Set(plan.entries)].filter((entry) => entry !== plan.anchor);
    kept = live.filter((record) => record.source !== plan.source || wanted.includes(record.entry));
    for (const entry of wanted) {
      const ownedHere = kept.some((r) => r.entry === entry && r.source === plan.source);
      if (ownedHere)
        continue;
      const ownedByCcSmartDevKit = kept.some((r) => r.entry === entry);
      if (list.includes(entry) && !ownedByCcSmartDevKit) {
        skipped.push(entry);
        continue;
      }
      if (!list.includes(entry)) {
        if (list.length === 0 && plan.anchor !== undefined && !current.found) {
          list.push(plan.anchor);
          added.push(plan.anchor);
          kept.push({ entry: plan.anchor, source: ANCHOR_SOURCE });
        }
        list.push(entry);
        added.push(entry);
      }
      kept.push({ entry, source: plan.source });
    }
  }
  for (const record of live) {
    if (record.source === ANCHOR_SOURCE)
      continue;
    if (kept.some((r) => r.entry === record.entry))
      continue;
    if (removed.includes(record.entry))
      continue;
    const at = list.indexOf(record.entry);
    if (at !== -1) {
      list.splice(at, 1);
      removed.push(record.entry);
    }
  }
  const anchorRecord = kept.find((r) => r.source === ANCHOR_SOURCE) ?? live.find((r) => r.source === ANCHOR_SOURCE);
  let dropList = false;
  if (anchorRecord !== undefined) {
    const onlyAnchor = list.every((entry) => entry === anchorRecord.entry);
    if (onlyAnchor) {
      kept = kept.filter((r) => r.source !== ANCHOR_SOURCE);
      if (list.length > 0)
        removed.push(anchorRecord.entry);
      list.length = 0;
      dropList = true;
    } else if (plan.kind === "source" && !kept.includes(anchorRecord)) {
      kept.push(anchorRecord);
    }
  }
  const listChanged = added.length > 0 || removed.length > 0;
  const recordsChanged = JSON.stringify(kept) !== JSON.stringify(records);
  if (options.dryRun || !listChanged && !recordsChanged) {
    return { file, added, removed, skipped, written: false, backup: null };
  }
  if (!listChanged) {
    writeOwnedEntries(options.stateDir, withRecords(snapshot, file, key, kept));
    return { file, added, removed, skipped, written: false, backup: null };
  }
  if (dropList)
    deleteWithEmptyParents(data, path);
  else
    setKey(data, path, list);
  const claimed = withRecords(snapshot, file, key, [
    ...live,
    ...kept.filter((r) => !live.includes(r))
  ]);
  writeOwnedEntries(options.stateDir, claimed);
  options.onBeforeWrite?.();
  let result;
  try {
    result = writeManagedFile(file, `${JSON.stringify(data, null, indent)}
`, {
      stateDir: options.stateDir,
      kind: "json-entries",
      newFileMode: 384,
      expectedContent: text
    });
  } catch (error) {
    writeOwnedEntries(options.stateDir, snapshot);
    throw error;
  }
  writeOwnedEntries(options.stateDir, withRecords(snapshot, file, key, kept));
  return {
    file,
    added,
    removed,
    skipped,
    written: result.outcome !== "unchanged",
    backup: result.backup
  };
}
function removeAllOwnedEntries(stateDir, file) {
  const real = realTarget(file);
  const removed = [];
  let backup = null;
  for (const key of Object.keys(ownedEntries(stateDir, real))) {
    const path = JSON.parse(key);
    const snapshot = readOwnedEntries(stateDir);
    const result = retryOnConcurrentChange(real, () => applyOnce2(real, { stateDir, path }, { kind: "all" }, snapshot));
    removed.push(...result.removed);
    backup ??= result.backup;
  }
  return { removed, backup };
}

// src/setup/managed-hook.ts
import { existsSync as existsSync7, readFileSync as readFileSync8 } from "fs";
import { join as join9 } from "path";
var OWNED_HOOKS_FILE = "owned-hooks.json";
function isHookHandler(value) {
  return isObject(value) && typeof value.type === "string" && typeof value.command === "string" && (value.timeout === undefined || typeof value.timeout === "number");
}
function isHookEntry(value) {
  return isObject(value) && Array.isArray(value.hooks) && value.hooks.every(isHookHandler) && (value.matcher === undefined || typeof value.matcher === "string");
}
var PLUGIN_CACHE = `plugins/cache/${MARKETPLACE}/${PLUGIN}/`;
function isCreatedAround(value) {
  return isObject(value) && typeof value.event === "boolean" && typeof value.hooks === "boolean";
}
function isOwnedHookRecord(value) {
  return isObject(value) && isHookEntry(value.entry) && isCreatedAround(value.created);
}
function readOwnedHooks(stateDir) {
  const file = join9(stateDir, OWNED_HOOKS_FILE);
  if (!existsSync7(file))
    return {};
  const parsed = JSON.parse(readFileSync8(file, "utf8"));
  const valid = isObject(parsed) && Object.values(parsed).every((events) => isObject(events) && Object.values(events).every(isOwnedHookRecord));
  if (!valid) {
    throw new Error(`Invalid ${file}: expected { <file>: { <event>: { entry, created } } }`);
  }
  return parsed;
}
function writeOwnedHooks(stateDir, state) {
  atomicWrite(join9(stateDir, OWNED_HOOKS_FILE), `${JSON.stringify(state, null, 2)}
`, 384);
}
function withRecord(state, file, event, record) {
  const events = { ...state[file] ?? {} };
  if (record === null)
    delete events[event];
  else
    events[event] = record;
  const next = { ...state };
  if (Object.keys(events).length === 0)
    delete next[file];
  else
    next[file] = events;
  return next;
}
function eventList(data, file, event) {
  const hooks = data.hooks;
  if (hooks !== undefined && !isObject(hooks)) {
    throw new ForeignKeyError(`${file}: ${formatKeyPath(["hooks"])} is not an object. cc-smart-dev-kit does not change it.`);
  }
  const list = isObject(hooks) ? hooks[event] : undefined;
  if (list === undefined)
    return null;
  if (!Array.isArray(list)) {
    throw new ForeignKeyError(`${file}: ${formatKeyPath(["hooks", event])} is not a list. cc-smart-dev-kit does not change it.`);
  }
  return [...list];
}
function indexOf(list, wanted) {
  return list.findIndex((entry) => Bun.deepEquals(entry, wanted, true));
}
function removeManagedHooks(stateDir, file) {
  const real = realTarget(file);
  const snapshot = readOwnedHooks(stateDir);
  const events = snapshot[real];
  if (events === undefined)
    return { removed: [], written: false, backup: null };
  return retryOnConcurrentChange(real, () => {
    const { data, indent, text } = readJsonObject(real);
    const removed = [];
    let backup = null;
    let written = false;
    let next = snapshot;
    for (const [event, record] of Object.entries(events)) {
      const list = eventList(data, real, event);
      if (list === null) {
        next = withRecord(next, real, event, null);
        continue;
      }
      const at = indexOf(list, record.entry);
      if (at !== -1) {
        list.splice(at, 1);
        removed.push(formatKeyPath(["hooks", event]));
        if (list.length === 0 && record.created.event) {
          deleteKey(data, ["hooks", event]);
          const hooks = getKey(data, ["hooks"]);
          if (record.created.hooks && hooks.found && isObject(hooks.value) && Object.keys(hooks.value).length === 0) {
            deleteKey(data, ["hooks"]);
          }
        } else {
          data.hooks = isObject(data.hooks) ? data.hooks : {};
          data.hooks[event] = list;
        }
      }
      next = withRecord(next, real, event, null);
    }
    if (removed.length > 0) {
      const result = writeManagedFile(real, `${JSON.stringify(data, null, indent)}
`, {
        stateDir,
        record: false,
        newFileMode: 384,
        expectedContent: text
      });
      written = result.outcome !== "unchanged";
      backup = result.backup;
    }
    if (!Bun.deepEquals(next, snapshot, true))
      writeOwnedHooks(stateDir, next);
    return { removed, written, backup };
  });
}
function removeAllManagedHooks(stateDir, options = {}) {
  const state = readOwnedHooks(stateDir);
  const results = [];
  for (const file of Object.keys(state)) {
    if (options.except?.has(file) === true)
      continue;
    if (options.only !== undefined && options.only !== null && !options.only.has(file))
      continue;
    const result = removeManagedHooks(stateDir, file);
    results.push({ file, ...result });
  }
  return results;
}

// src/setup/managed-line.ts
import { existsSync as existsSync8, readFileSync as readFileSync9 } from "fs";
function renderWithoutLines(current, lines) {
  const unwanted = new Set(lines);
  return current.split(`
`).filter((one) => !unwanted.has(one)).join(`
`);
}
function writeRendered(file, stateDir, render, options) {
  const target = realTarget(file);
  return retryOnConcurrentChange(target, () => {
    const current = existsSync8(target) ? readFileSync9(target, "utf8") : null;
    const { removed, text } = render(current ?? "");
    if (current === null && text === "") {
      return { backup: null, outcome: "unchanged", removed: removed ?? [] };
    }
    const result = writeManagedFile(target, text, {
      stateDir,
      kind: "file-line",
      ...options.lines !== undefined && { lines: options.lines },
      newFileMode: 420,
      expectedContent: current,
      ...options.dryRun !== undefined && { dryRun: options.dryRun }
    });
    return { backup: result.backup, outcome: result.outcome, removed: removed ?? [] };
  });
}
function removeManagedLines(options) {
  return writeRendered(options.file, options.stateDir, (current) => ({
    removed: current.split(`
`).filter((one) => options.lines.includes(one)),
    text: renderWithoutLines(current, options.lines)
  }), { dryRun: options.dryRun });
}

// src/setup/restore.ts
function createdByUs(entry) {
  return entry.baseline?.endsWith(ABSENT_SUFFIX) ?? false;
}
function restoreWholeFile(file, entry, stateDir) {
  const baseline = listBackups(stateDir, file).find((backup) => backup.path === entry.baseline);
  if (!baseline)
    return { file, action: "no-backup", details: [] };
  if (baseline.absent) {
    if (!existsSync9(file))
      return { file, action: "unchanged", details: [] };
    return { file, action: "removed", details: [], savedAs: removeManagedFile(stateDir, file) };
  }
  const result = writeManagedFile(file, readFileSync10(baseline.path, "utf8"), {
    stateDir,
    kind: "whole-file",
    mode: baseline.mode
  });
  if (result.outcome === "unchanged")
    return { file, action: "unchanged", details: [] };
  return {
    file,
    action: "restored",
    details: [],
    ...result.backup && { savedAs: result.backup }
  };
}
function isEmpty(file) {
  if (!existsSync9(file))
    return false;
  const text = readFileSync10(file, "utf8").trim();
  return text === "" || text === "{}";
}
function restorePartly(file, entry, stateDir) {
  const details = [];
  let savedAs = null;
  if (entry.kinds.includes("json-keys")) {
    const keys = ownedKeys(stateDir, file);
    if (keys.length > 0) {
      const result = applyManagedJson({
        file,
        stateDir,
        remove: keys,
        createdObject: createdObjects(stateDir, file)
      });
      details.push(...result.changes.map((change) => formatKeyPath(change.path)));
      savedAs ??= result.backup;
    }
  }
  if (entry.kinds.includes("json-entries")) {
    const result = removeAllOwnedEntries(stateDir, file);
    details.push(...result.removed.map((removed) => `the entry ${JSON.stringify(removed)}`));
    savedAs ??= result.backup;
  }
  if (entry.kinds.includes("markdown-block")) {
    const result = removeManagedMarkdown({ file, stateDir });
    if (result.outcome !== "unchanged")
      details.push("the cc-smart-dev-kit block");
    savedAs ??= result.backup;
  }
  if (entry.kinds.includes("file-line")) {
    const result = removeManagedLines({ file, lines: entry.lines ?? [], stateDir });
    for (const line of result.removed)
      details.push(`the line ${JSON.stringify(line)}`);
    savedAs ??= result.backup;
  }
  if (createdByUs(entry) && isEmpty(file)) {
    const backup = removeManagedFile(stateDir, file);
    return { file, action: "removed", details, savedAs: savedAs ?? backup };
  }
  if (details.length === 0)
    return { file, action: "unchanged", details };
  return { file, action: "cleaned", details, ...savedAs && { savedAs } };
}
function restore(stateDir, options = {}) {
  const except = new Set(options.except ?? []);
  const only = options.only === undefined ? null : new Set(options.only);
  const hooks = new Map(removeAllManagedHooks(stateDir, { except, only }).map((result) => [result.file, result]));
  const entries = Object.entries(readChanged(stateDir)).filter(([file]) => !except.has(file) && (only === null || only.has(file)));
  const results = entries.map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file") ? restoreWholeFile(file, entry, stateDir) : restorePartly(file, entry, stateDir);
    const hook = hooks.get(file);
    if (hook !== undefined) {
      hooks.delete(file);
      for (const where of hook.removed)
        result.details.push(`the hook entry in ${where}`);
      if (hook.backup !== null)
        result.savedAs ??= hook.backup;
      if (result.action === "unchanged" && hook.removed.length > 0)
        result.action = "cleaned";
    }
    if (result.action !== "no-backup")
      forgetChange(stateDir, file);
    if (result.action === "removed")
      removeEmptyFolders(file, stateDir);
    return result;
  });
  for (const [file, hook] of hooks) {
    results.push({
      file,
      action: hook.removed.length > 0 ? "cleaned" : "unchanged",
      details: hook.removed.map((where) => `the hook entry in ${where}`),
      ...hook.backup !== null && { savedAs: hook.backup }
    });
  }
  return results;
}
function removeEmptyFolders(file, stateDir) {
  const root = realTarget(stateDir);
  let dir = dirname2(file);
  while (dir.startsWith(`${root}/`) && existsSync9(dir) && readdirSync2(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname2(dir);
  }
}

// src/setup/instructions.ts
var ALWAYS_ON_FILE = "core.md";
function optOutFile(stateDir) {
  return join10(stateDir, "no-instructions");
}
function versionStampFile(stateDir) {
  return join10(stateDir, "instructions-version");
}
function instructionsOptedOut(stateDir) {
  return existsSync10(optOutFile(stateDir));
}
function readVersionStamp(stateDir) {
  const file = versionStampFile(stateDir);
  if (!existsSync10(file))
    return null;
  const version = readFileSync11(file, "utf8").trim();
  return version === "" ? null : version;
}
function instructionsPaths(paths, source) {
  const target = join10(paths.stateDir, "instructions");
  return {
    source,
    target,
    claudeMd: join10(paths.claudeConfigDir, "CLAUDE.md"),
    stateDir: paths.stateDir,
    importPath: tildify(join10(target, ALWAYS_ON_FILE), paths.home),
    installedPluginsFile: paths.installedPluginsFile
  };
}
function instructionsFolder(bundleDir) {
  const beside = join10(bundleDir, "..", "instructions");
  return existsSync10(beside) ? beside : join10(bundleDir, "..", "..", "plugin", "instructions");
}
function listInstructionFiles(source) {
  if (!existsSync10(source)) {
    throw new Error(`The plugin's instructions folder is missing: ${source}. Reinstall the plugin.`);
  }
  const files = readdirSync3(source, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => relative(source, join10(entry.parentPath, entry.name)).split(sep2).join("/")).sort();
  if (!files.includes(ALWAYS_ON_FILE)) {
    throw new Error(`The plugin's instructions folder has no ${ALWAYS_ON_FILE}: ${source}. Reinstall the plugin.`);
  }
  return files;
}
function trackedCopies(target, stateDir) {
  const root = `${realTarget(target)}/`;
  return Object.keys(readChanged(stateDir)).filter((file) => file.startsWith(root));
}
function lineOf(result, block) {
  switch (result.action) {
    case "removed":
      return { mark: "-", file: result.file, what: "removed" };
    case "restored":
      return { mark: "~", file: result.file, what: "back as it was before cc-smart-dev-kit" };
    case "cleaned":
      return {
        mark: "~",
        file: result.file,
        what: block ? "cc-smart-dev-kit block removed" : "cleaned"
      };
    case "no-backup":
      return {
        mark: "!",
        file: result.file,
        what: "the backup from before cc-smart-dev-kit is missing; left alone"
      };
    case "unchanged":
      return null;
  }
}
function copyInstalled(paths) {
  return trackedCopies(paths.target, paths.stateDir).length > 0;
}
function instructionsNeedRefresh(paths, version) {
  if (instructionsOptedOut(paths.stateDir))
    return false;
  if (!copyInstalled(paths))
    return false;
  return readVersionStamp(paths.stateDir) !== version;
}
function removeCopies(files, stateDir, dryRun) {
  if (files.length === 0)
    return [];
  if (dryRun) {
    const changed = readChanged(stateDir);
    return files.filter((file) => existsSync10(file)).map((file) => {
      const entry = changed[file];
      return entry !== undefined && createdByUs(entry) ? { mark: "-", file, what: "removed" } : { mark: "~", file, what: "back as it was before cc-smart-dev-kit" };
    });
  }
  return restore(stateDir, { only: files }).map((result) => lineOf(result, false)).filter((line) => line !== null);
}
function installCopy(paths, dryRun, version) {
  const lines = [];
  const files = listInstructionFiles(paths.source);
  const wanted = new Set;
  for (const name of files) {
    const file = join10(paths.target, name);
    wanted.add(realTarget(file));
    const result = writeManagedFile(file, readFileSync11(join10(paths.source, name), "utf8"), {
      stateDir: paths.stateDir,
      kind: "whole-file",
      mode: 420,
      dryRun
    });
    if (result.outcome !== "unchanged") {
      lines.push({
        mark: result.outcome === "created" ? "+" : "~",
        file,
        what: result.outcome
      });
    }
  }
  const stale = trackedCopies(paths.target, paths.stateDir).filter((file) => !wanted.has(file));
  lines.push(...removeCopies(stale, paths.stateDir, dryRun).map((line) => ({
    ...line,
    what: `${line.what} (the plugin no longer ships it)`
  })));
  if (!dryRun && readVersionStamp(paths.stateDir) !== version) {
    atomicWrite(versionStampFile(paths.stateDir), `${version}
`, 420);
  }
  return lines;
}
function refreshMayWrite(stamp, version, installed) {
  if (installed !== null)
    return installed === version;
  return isOlder(stamp, version);
}
function refreshRefusal(paths, version) {
  if (!instructionsNeedRefresh(paths, version))
    return null;
  const stamp = readVersionStamp(paths.stateDir);
  const installed = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  if (refreshMayWrite(stamp, version, installed))
    return null;
  if (installed !== null && stamp === installed)
    return null;
  return installed !== null ? `this session runs ${version}; restart it to use the installed ${installed}'s instructions` : `this session runs ${version}, and the instructions copy is not this session's; it is left alone`;
}
function refreshDue(paths, version) {
  if (!instructionsNeedRefresh(paths, version))
    return false;
  const installed = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return refreshMayWrite(readVersionStamp(paths.stateDir), version, installed);
}
async function refreshInstructionsCopy(paths, version, options = {}) {
  if (!refreshDue(paths, version))
    return [];
  if (options.dryRun)
    return installCopy(paths, true, version);
  return withLock(paths.stateDir, () => refreshDue(paths, version) ? installCopy(paths, false, version) : [], { waitMs: options.waitMs ?? 1e4 });
}

// src/update/apply.ts
import { existsSync as existsSync11, readFileSync as readFileSync12 } from "fs";
import { join as join11 } from "path";

// src/shell/powershell.ts
var SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g;
function powershellLiteral(value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`cannot put ${JSON.stringify(value)} in a PowerShell command`);
  }
  return `'${value.replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}

// src/hooks/windows-toast.ts
var TOAST_SHELL = "powershell";
var TOAST_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
function base64Literal(text) {
  return `'${Buffer.from(text, "utf8").toString("base64")}'`;
}
function decodedText(text) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${base64Literal(text)}))`;
}
function windowsToastScript(title, body, critical) {
  const scenario = critical ? ' scenario="reminder"' : "";
  return [
    "$ErrorActionPreference = 'Stop'",
    `$title = ${decodedText(title)}`,
    `$body = ${decodedText(body)}`,
    `$appId = ${powershellLiteral(TOAST_APP_ID)}`,
    "try {",
    "  $xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::New()",
    `  $xml.LoadXml('<toast${scenario}><visual><binding template="ToastGeneric"><text id="1" /><text id="2" /></binding></visual></toast>')`,
    "  $texts = $xml.GetElementsByTagName('text')",
    "  $null = $texts.Item(0).AppendChild($xml.CreateTextNode($title))",
    "  $null = $texts.Item(1).AppendChild($xml.CreateTextNode($body))",
    "  $toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::New($xml)",
    "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier($appId).Show($toast)",
    "} catch {",
    "  try {",
    "    Add-Type -AssemblyName System.Windows.Forms",
    "    Add-Type -AssemblyName System.Drawing",
    "    $balloon = New-Object System.Windows.Forms.NotifyIcon",
    "    $balloon.Icon = [System.Drawing.SystemIcons]::Information",
    "    $balloon.BalloonTipTitle = $title",
    "    $balloon.BalloonTipText = $body",
    "    $balloon.Visible = $true",
    "    $balloon.ShowBalloonTip(10000)",
    "    Start-Sleep -Milliseconds 4000",
    "    $balloon.Dispose()",
    "  } catch {",
    "    [Console]::Error.WriteLine('cc-smart-dev-kit: the desktop notification could not be shown: ' + $_.Exception.Message)",
    "    exit 1",
    "  }",
    "}"
  ].join(`
`);
}
function windowsToastArgv(shell, title, body, critical = false) {
  const script = windowsToastScript(title, body, critical);
  return [
    shell,
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")
  ];
}

// src/update/apply.ts
var CLAUDE_TIMEOUT_MS = 180000;
var MARKETPLACE_REFRESH = ["plugin", "marketplace", "update", MARKETPLACE];
var PLUGIN_UPDATE = ["plugin", "update", PLUGIN_ID, "--scope", "user"];
var BUSY_DETAIL = "Claude Code was refreshing the same marketplace (git's index.lock was taken); the next check tries again";
function applyUpdate(paths, claude, run, say) {
  const before = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const fail = (detail) => ({ after: before, before, detail, ok: false });
  if (claude === null)
    return fail("the claude command is not on PATH");
  const step = (args) => {
    say(`claude ${args.join(" ")}`);
    const result = run([claude, ...args]);
    if (result.exitCode === 0)
      return null;
    if (result.output.includes("index.lock")) {
      return { after: before, before, busy: true, detail: BUSY_DETAIL, ok: false };
    }
    const last = redactUrlsIn(result.output.trim().split(`
`).at(-1)?.trim() ?? "");
    return fail(`claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`);
  };
  const refreshed = step(MARKETPLACE_REFRESH);
  if (refreshed !== null)
    return refreshed;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const inCopy = location === null ? null : marketplaceCopyVersion(location, PLUGIN).version;
  if (isOlder(before, inCopy)) {
    const updated = step(PLUGIN_UPDATE);
    if (updated !== null)
      return updated;
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}
function routerNeedsSetup(paths) {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null || !existsSync11(paths.routerCopy))
    return false;
  const bundle = join11(install.installPath, "dist", "router.js");
  return existsSync11(bundle) && readFileSync12(bundle, "utf8") !== readFileSync12(paths.routerCopy, "utf8");
}
var ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart)`;
var NOTIFY_HOOK_SETUP_HINT = `agent view's notification hook is missing: ${COMMAND} setup writes it`;
function shownVersion(version) {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
}
function installedText(version, routerChanged = false, notifyHookMissing = false) {
  const text = `${PLUGIN} ${shownVersion(version)} installed; restart Claude sessions to load it`;
  const hints = [
    ...routerChanged ? [ROUTER_SETUP_HINT] : [],
    ...notifyHookMissing ? [NOTIFY_HOOK_SETUP_HINT] : []
  ];
  return hints.length === 0 ? text : `${text}; ${hints.join("; ")}`;
}
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
  if (platform === "win32") {
    const powershell = which(TOAST_SHELL);
    return powershell === null ? null : windowsToastArgv(powershell, title, text, critical);
  }
  return null;
}
function commandContext(env, home) {
  return { cwd: home, env: gitEnv(env) };
}
function capturingRunner(env, home) {
  const context = commandContext(env, home);
  return (argv) => {
    try {
      const result = Bun.spawnSync(argv, {
        ...context,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: CLAUDE_TIMEOUT_MS
      });
      return {
        exitCode: result.exitCode ?? 1,
        output: `${result.stdout.toString()}${result.stderr.toString()}`
      };
    } catch (error) {
      return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
    }
  };
}

// src/setup/user-notify-hook.ts
import { existsSync as existsSync12, readFileSync as readFileSync13 } from "fs";

// src/hooks/notify-types.ts
var PLUGIN_NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "worker_permission_prompt"
];
var AGENT_VIEW_TYPES = ["agent_needs_input", "agent_completed"];
var NOTIFY_TYPES = [...PLUGIN_NOTIFY_TYPES, ...AGENT_VIEW_TYPES];
var NOTIFY_MATCHER = PLUGIN_NOTIFY_TYPES.join("|");
var AGENT_VIEW_MATCHER = AGENT_VIEW_TYPES.join("|");

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

// src/setup/user-notify-hook.ts
var USER_NOTIFY_HOOK_NAME = "notify";
var USER_NOTIFY_TIMEOUT = 10;
var USER_NOTIFY_COMMAND = `${LAUNCHER_IN_SHELL} hook ${USER_NOTIFY_HOOK_NAME}`;
var USER_NOTIFY_ENTRY = {
  matcher: AGENT_VIEW_MATCHER,
  hooks: [{ type: "command", command: USER_NOTIFY_COMMAND, timeout: USER_NOTIFY_TIMEOUT }]
};
function runsHookNotify(command) {
  const escaped = COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s/"'])${escaped}["']?\\s+hook\\s+${USER_NOTIFY_HOOK_NAME}(\\s|;|$)`).test(command);
}
function isEditedNotify(entry) {
  return entry.matcher === AGENT_VIEW_MATCHER && entry.hooks.some((h) => runsHookNotify(h.command));
}
function userNotifyHookState(file) {
  if (!existsSync12(file))
    return "missing";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync13(file, "utf8"));
  } catch {
    return "missing";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return "missing";
  const hooks = parsed.hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))
    return "missing";
  const list = hooks.Notification;
  if (!Array.isArray(list))
    return "missing";
  if (list.some((entry) => Bun.deepEquals(entry, USER_NOTIFY_ENTRY, true)))
    return "current";
  const entries = list.filter(isHookEntry);
  if (entries.some((entry) => isEditedNotify(entry)))
    return "edited";
  return entries.some((entry) => entry.matcher === AGENT_VIEW_MATCHER) ? "elsewhere" : "missing";
}

// src/update/opt-out.ts
import { readFileSync as readFileSync14 } from "fs";
var UPDATE_BLOCKING_VARS = [
  "DISABLE_AUTOUPDATER",
  "DISABLE_UPDATES",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
];
var FORCE_PLUGIN_UPDATES_VAR = "FORCE_AUTOUPDATE_PLUGINS";
function isSet(value) {
  if (typeof value !== "string")
    return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
function settingsEnv(settingsFile) {
  try {
    const parsed = JSON.parse(readFileSync14(settingsFile, "utf8"));
    const env = parsed?.env;
    return typeof env === "object" && env !== null && !Array.isArray(env) ? env : {};
  } catch {
    return {};
  }
}
function updateOptOuts(env, fromSettings) {
  const where = (name) => ({
    inEnv: isSet(env[name]),
    inSettings: isSet(fromSettings[name]),
    name
  });
  const force = where(FORCE_PLUGIN_UPDATES_VAR);
  if (force.inEnv || force.inSettings)
    return { blocking: [], forced: true };
  const blocking = UPDATE_BLOCKING_VARS.map(where).filter((v) => v.inEnv || v.inSettings);
  return { blocking, forced: false };
}
function blockingVar(env, settingsFile) {
  return updateOptOuts(env, settingsEnv(settingsFile)).blocking[0]?.name ?? null;
}

// src/update/state.ts
import {
  appendFileSync,
  existsSync as existsSync13,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync4,
  readFileSync as readFileSync15,
  rmSync as rmSync2,
  statSync as statSync3,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join12 } from "path";
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
function updateFiles(stateDir) {
  return {
    hold: join12(stateDir, "update-hold"),
    check: join12(stateDir, "update-check.json"),
    reported: join12(stateDir, "update-reported"),
    log: join12(stateDir, "update.log"),
    lockDir: join12(stateDir, "update"),
    sessions: join12(stateDir, "sessions")
  };
}
var RESULTS = [
  "checking",
  "up-to-date",
  "updated",
  "skipped",
  "unreachable",
  "failed"
];
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;
function unreachableCheck(previous, at, nowMs, detail) {
  const since = previous?.since ?? at;
  const failed = nowMs - Date.parse(since) >= UNREACHABLE_FAILS_AFTER_MS;
  return {
    at,
    detail: `cannot read the marketplace${failed ? ` since ${since}` : ""} (${detail})`,
    result: failed ? "failed" : "unreachable",
    since
  };
}
function ensureDir(dir) {
  mkdirSync3(dir, { recursive: true, mode: 448 });
}
function readLastCheck(files) {
  try {
    const parsed = JSON.parse(readFileSync15(files.check, "utf8"));
    if (typeof parsed?.at !== "string" || Number.isNaN(Date.parse(parsed.at)) || !RESULTS.includes(parsed.result) || typeof parsed.detail !== "string") {
      return null;
    }
    const check = {
      at: parsed.at,
      detail: parsed.detail,
      result: parsed.result
    };
    if (typeof parsed.since === "string" && !Number.isNaN(Date.parse(parsed.since))) {
      check.since = parsed.since;
    }
    return check;
  } catch {
    return null;
  }
}
function writeLastCheck(files, check) {
  ensureDir(join12(files.check, ".."));
  atomicWrite(files.check, `${JSON.stringify(check, null, 2)}
`, 384);
}
function isDue(last, nowMs) {
  if (last === null)
    return true;
  const at = Date.parse(last.at);
  return nowMs - at >= CHECK_INTERVAL_MS || at > nowMs + 60000;
}
function isHeld(files) {
  return existsSync13(files.hold);
}
function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function appendLog(files, line, nowMs) {
  ensureDir(join12(files.log, ".."));
  try {
    if (statSync3(files.log).size > LOG_MAX_BYTES) {
      const text = readFileSync15(files.log, "utf8");
      const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
      writeFileSync2(files.log, keep.slice(keep.indexOf(`
`) + 1), { mode: 384 });
    }
  } catch {}
  appendFileSync(files.log, `${isoSeconds(nowMs)} ${line}
`, { mode: 384 });
}
function wasReported(files, at) {
  try {
    return readFileSync15(files.reported, "utf8").trim() === at;
  } catch {
    return false;
  }
}
function markReported(files, at) {
  ensureDir(join12(files.reported, ".."));
  atomicWrite(files.reported, `${at}
`, 384);
}
function readSession(file) {
  try {
    const parsed = JSON.parse(readFileSync15(file, "utf8"));
    if (typeof parsed?.pid !== "number" || typeof parsed.start !== "string" || typeof parsed.version !== "string") {
      return null;
    }
    return { pid: parsed.pid, start: parsed.start, version: parsed.version };
  } catch {
    return null;
  }
}
var SESSION_FILE = /^\d+\.json$/;
function isRunning(session) {
  return processStartTime(session.pid, session.start) === session.start;
}
function registerSession(files, pid, version) {
  const start = processStartTime(pid);
  if (start === null)
    return;
  ensureDir(files.sessions);
  for (const name of readdirSync4(files.sessions).filter((entry) => SESSION_FILE.test(entry))) {
    const file = join12(files.sessions, name);
    const session = readSession(file);
    if (session === null || !isRunning(session))
      rmSync2(file, { force: true });
  }
  const record = { pid, start, version };
  atomicWrite(join12(files.sessions, `${pid}.json`), `${JSON.stringify(record)}
`, 384);
}

// src/update/background.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function optOutDetail(name) {
  return `${name} is set`;
}
function isAttended(env) {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
}
function backgroundCommand(bunPath, entryPath, pluginDir) {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), entryPath, "--background"];
}
function sessionStart(deps) {
  const files = updateFiles(deps.paths.stateDir);
  if (deps.sessionPid !== null)
    registerSession(files, deps.sessionPid, deps.version);
  if (isHeld(files))
    return "";
  const last = readLastCheck(files);
  const blocked = blockingVar(deps.env, deps.paths.settingsFile);
  if (blocked !== null) {
    const detail = optOutDetail(blocked);
    if (last?.result !== "skipped" || last.detail !== detail) {
      writeLastCheck(files, { at: isoSeconds(deps.nowMs), detail, result: "skipped" });
    }
    return "";
  }
  let answer = "";
  const reportKey = last?.since ?? last?.at ?? "";
  if (last?.result === "failed" && !wasReported(files, reportKey) && isAttended(deps.env)) {
    markReported(files, reportKey);
    answer = JSON.stringify({
      systemMessage: `${PLUGIN}: the background update failed at ${last.at} (${last.detail}). The log: ${tildify(files.log, deps.paths.home)}. To try now: ${COMMAND} update`
    });
  }
  if (isDue(last, deps.nowMs))
    deps.spawnBackground();
  return answer;
}
function backgroundCheckArgv(platform, bun, bundle, pluginDir) {
  return detachedArgv(platform, backgroundCommand(bun, bundle, pluginDir));
}
async function refreshInstructionsAtSessionStart(deps) {
  try {
    await refreshInstructionsCopy(deps.where, deps.version, { waitMs: deps.waitMs ?? 2000 });
    const refusal = refreshRefusal(deps.where, deps.version);
    if (refusal !== null)
      deps.log(`${PLUGIN}: ${refusal}.`);
  } catch (error) {
    if (error instanceof LockBusyError)
      return;
    deps.log(`${PLUGIN}: the instructions copy was not refreshed (${messageOf(error)}). A plain ${COMMAND} setup brings it up to date.`);
  }
}
async function backgroundCheck(deps) {
  const files = updateFiles(deps.paths.stateDir);
  const log = (line) => appendLog(files, line, deps.now());
  let at = isoSeconds(deps.now());
  try {
    await withLock(files.lockDir, () => {
      const previous = readLastCheck(files);
      if (isHeld(files) || !isDue(previous, deps.now()))
        return;
      at = isoSeconds(deps.now());
      const write = (check) => {
        writeLastCheck(files, check);
        log(`${check.result}: ${check.detail}`);
      };
      const record = (result, detail) => write({ at, detail, result });
      const blocked = blockingVar(deps.env, deps.paths.settingsFile);
      if (blocked !== null) {
        record("skipped", optOutDetail(blocked));
        return;
      }
      writeLastCheck(files, {
        at,
        detail: "",
        result: "checking",
        ...previous?.since !== undefined && { since: previous.since }
      });
      const status = checkForUpdate(deps.paths, deps.env);
      switch (status.kind) {
        case "not-installed":
          record("skipped", `${PLUGIN_ID} is not installed for this user`);
          return;
        case "no-marketplace":
          record("skipped", status.detail);
          return;
        case "unreachable":
          write(unreachableCheck(previous, at, deps.now(), status.detail));
          return;
        case "up-to-date":
          record("up-to-date", status.installed);
          return;
        case "behind": {
          log(`newer: installed ${status.installed ?? "(no version)"}, the marketplace copy ${status.inCopy ?? "(unreadable)"}${status.catalogBehind ? ", and the copy is behind the remote" : ""}`);
          const result = applyUpdate(deps.paths, deps.claude, deps.run, (line) => log(`run: ${line}`));
          if (result.busy === true) {
            record("skipped", result.detail);
            return;
          }
          if (!result.ok) {
            record("failed", result.detail);
            return;
          }
          if (result.after === result.before) {
            record("up-to-date", result.after ?? "(no version)");
            return;
          }
          const routerChanged = routerNeedsSetup(deps.paths);
          const notifyState = userNotifyHookState(deps.paths.settingsFile);
          const notifyHookMissing = notifyState === "missing" || notifyState === "elsewhere";
          record("updated", `${result.after ?? "(no version)"} (was ${result.before ?? "none"})${routerChanged ? `; ${ROUTER_SETUP_HINT}` : ""}${notifyHookMissing ? `; ${NOTIFY_HOOK_SETUP_HINT}` : ""}`);
          deps.notify(installedText(result.after, routerChanged, notifyHookMissing));
          return;
        }
      }
    }, { waitMs: 0 });
  } catch (error) {
    if (error instanceof LockBusyError)
      return;
    const detail = redactUrlsIn(messageOf(error));
    try {
      writeLastCheck(files, { at, detail, result: "failed" });
      log(`failed: ${detail}`);
    } catch {}
  }
}

// src/entries/update-check.ts
var env = process.env;
var paths = cliPaths(env);
function sessionPid() {
  const pid = Number(env.CLAUDE_PID ?? process.ppid);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}
if (process.argv.includes("--background")) {
  const which = (command) => Bun.which(command, { PATH: env.PATH ?? "" });
  const run = capturingRunner(env, paths.home);
  await backgroundCheck({
    paths,
    env,
    now: () => Date.now(),
    claude: which("claude"),
    run,
    notify: (text) => {
      const argv = notifyCommand(text, process.platform, which);
      if (argv !== null)
        run(argv);
    }
  });
} else {
  try {
    const answer = sessionStart({
      paths,
      env,
      nowMs: Date.now(),
      sessionPid: sessionPid(),
      version: VERSION,
      spawnBackground: () => {
        startDetached(process.platform, backgroundCheckArgv(process.platform, process.execPath, Bun.main, pluginFolderBeside(import.meta.dir)), {
          ...commandContext(env, paths.home),
          onError: (message) => console.error(`${PLUGIN} update check: ${message}`)
        });
      }
    });
    if (answer !== "")
      process.stdout.write(`${answer}
`);
    await refreshInstructionsAtSessionStart({
      where: instructionsPaths(paths, instructionsFolder(import.meta.dir)),
      version: VERSION,
      log: (line) => console.error(line)
    });
  } catch (error) {
    console.error(`${PLUGIN} update check: ${error instanceof Error ? error.message : error}`);
  }
}
