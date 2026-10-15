// @bun
// src/build-info/names.ts
var MARKETPLACE = "anymodel";
var PLUGIN = "anymodel";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "anymodel";

// src/build-info/index.ts
var info = {
  version: "0.3.0",
  repo: "sellanybiz/anymodel",
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
import { homedir } from "os";
import { join } from "path";
function cliPaths(env = process.env) {
  const home = env.HOME || homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  return {
    home,
    claudeConfigDir,
    settingsFile: join(claudeConfigDir, "settings.json"),
    installedPluginsFile: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    knownMarketplacesFile: join(claudeConfigDir, "plugins", "known_marketplaces.json"),
    binDir: join(home, ".local", "bin"),
    stateDir: join(claudeConfigDir, "anymodel"),
    gatewayConfigFile: join(home, ".config", "anymodel", "gateway.json"),
    gatewayStateFile: join(home, ".local", "state", "anymodel", "gateway-state.json"),
    routerCopy: join(home, ".local", "share", "anymodel", "router.js"),
    routerUnitFile: join(home, ".config", "systemd", "user", "anymodel-router.service"),
    claudeMemSettingsFile: join(claudeMemDataDir(env, home), "settings.json"),
    routerSocketFile: join(home, ".config", "systemd", "user", "anymodel-router.socket")
  };
}
function claudeMemDataDir(env, home) {
  const dir = env.CLAUDE_MEM_DATA_DIR;
  if (!dir)
    return join(home, ".claude-mem");
  if (dir === "~")
    return home;
  return dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
}
function tildify(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// src/update/apply.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "fs";
import { join as join3 } from "path";

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
import { join as join2 } from "path";
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
    return result;
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
    const lines = result.stderr.toString().trim().split(`
`);
    const detail = result.signalCode ? "timed out" : (lines.at(-1) ?? "").trim();
    return { ok: false, detail: redactUrlsIn(detail) || `git exited with ${result.exitCode}` };
  } catch (error) {
    return {
      ok: false,
      detail: redactUrlsIn(error instanceof Error ? error.message : String(error))
    };
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
    folder = pluginFolderIn(readFileSync2(join2(location, ".claude-plugin", "marketplace.json"), "utf8"), plugin) ?? folder;
  } catch {}
  const manifest = join2(location, folder, ".claude-plugin", "plugin.json");
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
  if (install === null || !existsSync3(paths.routerCopy))
    return false;
  const bundle = join3(install.installPath, "dist", "router.js");
  return existsSync3(bundle) && readFileSync3(bundle, "utf8") !== readFileSync3(paths.routerCopy, "utf8");
}
var ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart)`;
function shownVersion(version) {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
}
function installedText(version, routerChanged = false) {
  const text = `${PLUGIN} ${shownVersion(version)} installed; restart Claude sessions to load it`;
  return routerChanged ? `${text}; ${ROUTER_SETUP_HINT}` : text;
}
function notifyCommand(text, platform, which) {
  if (platform === "linux") {
    const notifySend = which("notify-send");
    return notifySend === null ? null : [notifySend, PLUGIN, text];
  }
  if (platform === "darwin") {
    const osascript = which("osascript");
    return osascript === null ? null : [osascript, "-e", `display notification ${JSON.stringify(text)} with title "${PLUGIN}"`];
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

// src/setup/lock.ts
import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync as readFileSync4,
  readlinkSync,
  statSync,
  unlinkSync,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join4 } from "path";
var FALLBACK_STALE_MS = 10 * 60 * 1000;
var LOCK_FILE = "lock";
var TAKEOVER_SUFFIX = ".takeover";

class LockBusyError extends Error {
  name = "LockBusyError";
}
function procStartTime(pid) {
  try {
    const stat = readFileSync4(`/proc/${pid}/stat`, "utf8");
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
    info = parseLock(readFileSync4(file, "utf8"));
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
    fchmodSync(fd, mode);
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
  const file = join4(stateDir, LOCK_FILE);
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
      throw new LockBusyError(`anymodel is busy: ${who} holds ${file}. Wait for it to finish, then try again.`);
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

// src/update/opt-out.ts
import { readFileSync as readFileSync5 } from "fs";
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
    const parsed = JSON.parse(readFileSync5(settingsFile, "utf8"));
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
  existsSync as existsSync5,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync7,
  rmSync,
  statSync as statSync3,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join6 } from "path";

// src/setup/write.ts
import {
  chmodSync,
  closeSync as closeSync2,
  existsSync as existsSync4,
  fsyncSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync6,
  readlinkSync as readlinkSync2,
  realpathSync,
  renameSync,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "fs";
import { basename, dirname, join as join5, resolve } from "path";
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync2(dir, { recursive: true });
  const temp = join5(dir, `.${basename(file)}.anymodel-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const fd = openSync2(temp, "wx", mode);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync2(fd);
    }
    chmodSync(temp, mode);
  } catch (error) {
    if (existsSync4(temp))
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
    if (existsSync4(temp))
      unlinkSync2(temp);
    throw error;
  }
}

// src/update/state.ts
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
function updateFiles(stateDir) {
  return {
    hold: join6(stateDir, "update-hold"),
    check: join6(stateDir, "update-check.json"),
    reported: join6(stateDir, "update-reported"),
    log: join6(stateDir, "update.log"),
    lockDir: join6(stateDir, "update"),
    sessions: join6(stateDir, "sessions")
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
    const parsed = JSON.parse(readFileSync7(files.check, "utf8"));
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
  ensureDir(join6(files.check, ".."));
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
  return existsSync5(files.hold);
}
function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function appendLog(files, line, nowMs) {
  ensureDir(join6(files.log, ".."));
  try {
    if (statSync3(files.log).size > LOG_MAX_BYTES) {
      const text = readFileSync7(files.log, "utf8");
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
    return readFileSync7(files.reported, "utf8").trim() === at;
  } catch {
    return false;
  }
}
function markReported(files, at) {
  ensureDir(join6(files.reported, ".."));
  atomicWrite(files.reported, `${at}
`, 384);
}
function readSession(file) {
  try {
    const parsed = JSON.parse(readFileSync7(file, "utf8"));
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
  for (const name of readdirSync2(files.sessions).filter((entry) => SESSION_FILE.test(entry))) {
    const file = join6(files.sessions, name);
    const session = readSession(file);
    if (session === null || !isRunning(session))
      rmSync(file, { force: true });
  }
  const record = { pid, start, version };
  atomicWrite(join6(files.sessions, `${pid}.json`), `${JSON.stringify(record)}
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
          record("updated", `${result.after ?? "(no version)"} (was ${result.before ?? "none"})${routerChanged ? `; ${ROUTER_SETUP_HINT}` : ""}`);
          deps.notify(installedText(result.after, routerChanged));
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
        Bun.spawn([process.execPath, Bun.main, "--background"], {
          ...commandContext(env, paths.home),
          detached: true,
          stdio: ["ignore", "ignore", "ignore"]
        }).unref();
      }
    });
    if (answer !== "")
      process.stdout.write(`${answer}
`);
  } catch (error) {
    console.error(`${PLUGIN} update check: ${error instanceof Error ? error.message : error}`);
  }
}
