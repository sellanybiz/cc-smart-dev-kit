// @bun
// src/build-info/names.ts
var MARKETPLACE = "anymodel";
var PLUGIN = "anymodel";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "anymodel";

// src/build-info/index.ts
var info = {
  version: "0.2.1",
  repo: "sellanybiz/anymodel"
};
var VERSION = info.version;
var MARKETPLACE_SOURCE = info.repo;
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
    routerCopy: join(home, ".local", "share", "anymodel", "router.js"),
    routerUnitFile: join(home, ".config", "systemd", "user", "anymodel-router.service"),
    routerSocketFile: join(home, ".config", "systemd", "user", "anymodel-router.socket")
  };
}
function tildify(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// src/setup/installed-plugins.ts
import { existsSync, readFileSync } from "fs";
function findUserInstall(installedPluginsFile) {
  if (!existsSync(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = parsed?.plugins;
  const entries = plugins?.[PLUGIN_ID];
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
function canReadGitRemote(url, baseEnv = process.env) {
  const result = lsRemote(url, "HEAD", baseEnv);
  return result.ok ? { ok: true, detail: "" } : result;
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
async function canReadHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS) });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
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
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
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
function remotePluginVersion(url, ref, baseEnv) {
  const env = gitAccessEnv(gitEnv(baseEnv));
  const dir = mkdtempSync(join3(tmpdir(), "anymodel-update-check-"));
  const git = (args) => {
    const result = Bun.spawnSync(["git", ...args], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: GIT_TIMEOUT_MS
    });
    return {
      ok: result.exitCode === 0,
      stderr: redactUrlsIn(result.stderr.toString().trim().split(`
`).at(-1) ?? ""),
      stdout: result.stdout.toString()
    };
  };
  try {
    const init = git(["init", "-q", "--bare", dir]);
    if (!init.ok)
      return { detail: `git init: ${init.stderr}`, ok: false };
    const fetch2 = git(["-C", dir, "fetch", "-q", "--depth", "1", "--no-tags", url, ref]);
    if (!fetch2.ok)
      return { detail: fetch2.stderr || "git fetch failed", ok: false };
    const marketplace = git(["-C", dir, "show", "FETCH_HEAD:.claude-plugin/marketplace.json"]);
    const folder = marketplace.ok && pluginFolderIn(marketplace.stdout, PLUGIN) || "plugin";
    const manifest = git(["-C", dir, "show", `FETCH_HEAD:${folder}/.claude-plugin/plugin.json`]);
    if (!manifest.ok)
      return { detail: `no ${folder}/.claude-plugin/plugin.json`, ok: false };
    const version = JSON.parse(manifest.stdout)?.version;
    return typeof version === "string" ? { ok: true, version } : { detail: `no version in ${folder}/.claude-plugin/plugin.json`, ok: false };
  } catch (error) {
    return {
      detail: redactUrlsIn(error instanceof Error ? error.message : String(error)),
      ok: false
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

// src/update/apply.ts
var CLAUDE_TIMEOUT_MS = 180000;
var MARKETPLACE_REFRESH = ["plugin", "marketplace", "update", MARKETPLACE];
var PLUGIN_UPDATE = ["plugin", "update", PLUGIN_ID, "--scope", "user"];
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
    const last = result.output.trim().split(`
`).at(-1)?.trim();
    return `claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`;
  };
  const refreshed = step(MARKETPLACE_REFRESH);
  if (refreshed !== null)
    return fail(refreshed);
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const inCopy = location === null ? null : marketplaceCopyVersion(location, PLUGIN).version;
  if (isOlder(before, inCopy)) {
    const updated = step(PLUGIN_UPDATE);
    if (updated !== null)
      return fail(updated);
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}
function shownVersion(version) {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
}
function installedText(version) {
  return `${PLUGIN} ${shownVersion(version)} installed; restart Claude sessions to load it`;
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
function capturingRunner(env) {
  return (argv) => {
    try {
      const result = Bun.spawnSync(argv, {
        env,
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
  mkdirSync,
  openSync,
  readFileSync as readFileSync3,
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
      time: parsed.time,
      token: parsed.token
    };
  } catch {
    return null;
  }
}
function readHeld(file) {
  try {
    const stat = statSync(file);
    const info = parseLock(readFileSync3(file, "utf8"));
    return { info, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
function sameHeld(a, b) {
  if (a.info && b.info)
    return a.info.token === b.info.token;
  if (a.info || b.info)
    return false;
  return a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;
}
function isStale(held, fallbackStaleMs) {
  const { info } = held;
  const oldEnough = Date.now() - (info?.time ?? held.mtimeMs) > fallbackStaleMs;
  if (info === null || info.host !== hostname())
    return oldEnough;
  if (!isAlive(info.pid))
    return true;
  if (info.startTime === null)
    return oldEnough;
  const now = processStartTime(info.pid, info.startTime);
  if (now === null)
    return oldEnough;
  return now !== info.startTime;
}
function tryCreate(file, info) {
  let fd;
  try {
    fd = openSync(file, "wx", 384);
  } catch (error) {
    if (error.code === "EEXIST")
      return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
  return true;
}
var ownStartTime;
function newLockInfo() {
  ownStartTime ??= processStartTime(process.pid);
  return {
    pid: process.pid,
    startTime: ownStartTime,
    host: hostname(),
    time: Date.now(),
    token: crypto.randomUUID()
  };
}
function takeOverStale(file, judged, fallbackStaleMs) {
  const claim = `${file}${TAKEOVER_SUFFIX}`;
  const me = newLockInfo();
  if (!tryCreate(claim, me)) {
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
  for (;; ) {
    mine.time = Date.now();
    if (tryCreate(file, mine))
      break;
    const held = readHeld(file);
    if (held === null)
      continue;
    if (isStale(held, fallbackStaleMs) && takeOverStale(file, held, fallbackStaleMs))
      continue;
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

// src/update/state.ts
import {
  appendFileSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync5,
  rmSync as rmSync2,
  statSync as statSync3,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join6 } from "path";

// src/setup/write.ts
import {
  chmodSync,
  closeSync as closeSync2,
  existsSync as existsSync3,
  fsyncSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync4,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "fs";
import { basename, dirname, join as join5, resolve } from "path";
var BACKUPS_DIR = "backups";
var BACKUP_INFIX = ".bak-anymodel-";
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
      return parent === path ? path : join5(realTarget(parent), basename(path));
    }
    path = resolve(dirname(path), readlinkSync(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}
function fileMode(file) {
  return existsSync3(file) ? statSync2(file).mode & 4095 : null;
}
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
  return join5(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}
function makePrivateDir(dir) {
  mkdirSync2(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
}
function listBackups(stateDir, file) {
  const dir = backupDir(stateDir, file);
  if (!existsSync3(dir))
    return [];
  const base = basename(realTarget(file));
  return readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup !== null).sort((a, b) => a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1).map((backup) => {
    const path = join5(dir, backup.name);
    return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 384 };
  });
}
function copyNotExecutable(file, target) {
  const mode = fileMode(file) ?? 384;
  const safeMode = mode & ~73;
  writeFileSync(target, readFileSync4(file), { flag: "wx", mode: safeMode });
  chmodSync(target, safeMode);
  return mode;
}
function backupFile(stateDir, file) {
  const real = realTarget(file);
  const dir = backupDir(stateDir, real);
  const base = basename(real);
  const stamp = utcStamp();
  const mode = fileMode(real);
  const suffix = mode === null ? ABSENT_SUFFIX : (mode & 73) !== 0 ? `.mode-${mode.toString(8)}` : "";
  makePrivateDir(join5(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  const sameStamp = readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup?.stamp === stamp);
  const counter = sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join5(dir, `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`);
  if (mode === null) {
    writeFileSync(target, "", { flag: "wx", mode: 384 });
  } else {
    copyNotExecutable(real, target);
  }
  return target;
}
var CHANGE_KINDS = ["json-keys", "markdown-block", "whole-file"];
function isChangedEntry(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const entry = value;
  return Array.isArray(entry.kinds) && entry.kinds.every((kind) => CHANGE_KINDS.includes(kind)) && (entry.baseline === null || typeof entry.baseline === "string");
}
function readChanged(stateDir) {
  const file = join5(stateDir, CHANGED_FILE);
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
  atomicWrite(join5(stateDir, CHANGED_FILE), `${JSON.stringify({ files: sorted }, null, 2)}
`, 384);
}
function recordChange(stateDir, file, kind, backup) {
  const files = readChanged(stateDir);
  const entry = files[file];
  if (!entry) {
    files[file] = { kinds: [kind], baseline: backup };
    writeChanged(stateDir, files);
    return true;
  }
  if (!entry.kinds.includes(kind)) {
    entry.kinds.push(kind);
    writeChanged(stateDir, files);
  }
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
          throw new ConcurrentChangeError(`${file} kept changing while anymodel tried to update it (${attempts} tries). ` + "Close the program that writes it (for example Claude Code), then run again.");
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
      throw new ConcurrentChangeError(`${target} changed after anymodel read it.`);
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
  const backup = backupFile(options.stateDir, target);
  const isBaseline = recordChange(options.stateDir, target, options.kind, backup);
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
var RESULTS = ["checking", "up-to-date", "updated", "skipped", "failed"];
function ensureDir(dir) {
  mkdirSync3(dir, { recursive: true, mode: 448 });
}
function readLastCheck(files) {
  try {
    const parsed = JSON.parse(readFileSync5(files.check, "utf8"));
    if (typeof parsed?.at !== "string" || Number.isNaN(Date.parse(parsed.at)) || !RESULTS.includes(parsed.result) || typeof parsed.detail !== "string") {
      return null;
    }
    return { at: parsed.at, detail: parsed.detail, result: parsed.result };
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
  return existsSync4(files.hold);
}
function heldSince(files) {
  try {
    const text = readFileSync5(files.hold, "utf8").trim();
    return text === "" ? "an unknown time" : text;
  } catch {
    return null;
  }
}
function hold(files, nowMs) {
  if (isHeld(files))
    return false;
  ensureDir(join6(files.hold, ".."));
  atomicWrite(files.hold, `${isoSeconds(nowMs)}
`, 384);
  return true;
}
function resume(files) {
  if (!isHeld(files))
    return false;
  rmSync2(files.hold, { force: true });
  return true;
}
function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function appendLog(files, line, nowMs) {
  ensureDir(join6(files.log, ".."));
  try {
    if (statSync3(files.log).size > LOG_MAX_BYTES) {
      const text = readFileSync5(files.log, "utf8");
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
    return readFileSync5(files.reported, "utf8").trim() === at;
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
    const parsed = JSON.parse(readFileSync5(file, "utf8"));
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
      rmSync2(file, { force: true });
  }
  const record = { pid, start, version };
  atomicWrite(join6(files.sessions, `${pid}.json`), `${JSON.stringify(record)}
`, 384);
}
function runningSessions(files) {
  let names;
  try {
    names = readdirSync2(files.sessions);
  } catch {
    return [];
  }
  return names.filter((name) => SESSION_FILE.test(name)).map((name) => readSession(join6(files.sessions, name))).filter((session) => session !== null && isRunning(session));
}

// src/update/background.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function sessionStart(deps) {
  const files = updateFiles(deps.paths.stateDir);
  if (deps.sessionPid !== null)
    registerSession(files, deps.sessionPid, deps.version);
  if (isHeld(files))
    return "";
  const last = readLastCheck(files);
  let answer = "";
  if (last?.result === "failed" && !wasReported(files, last.at)) {
    markReported(files, last.at);
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
      if (isHeld(files) || !isDue(readLastCheck(files), deps.now()))
        return;
      at = isoSeconds(deps.now());
      writeLastCheck(files, { at, detail: "", result: "checking" });
      const record = (result, detail) => {
        writeLastCheck(files, { at, detail, result });
        log(`${result}: ${detail}`);
      };
      const status = checkForUpdate(deps.paths, deps.env);
      switch (status.kind) {
        case "not-installed":
          record("skipped", `${PLUGIN_ID} is not installed for this user`);
          return;
        case "no-marketplace":
          record("skipped", status.detail);
          return;
        case "unreachable":
          record("failed", `cannot read the marketplace (${status.detail})`);
          return;
        case "up-to-date":
          record("up-to-date", status.installed);
          return;
        case "behind": {
          log(`newer: installed ${status.installed ?? "(no version)"}, the marketplace copy ${status.inCopy ?? "(unreadable)"}${status.catalogBehind ? ", and the copy is behind the remote" : ""}`);
          const result = applyUpdate(deps.paths, deps.claude, deps.run, (line) => log(`run: ${line}`));
          if (!result.ok) {
            record("failed", result.detail);
            return;
          }
          if (result.after === result.before) {
            record("up-to-date", result.after ?? "(no version)");
            return;
          }
          record("updated", `${result.after ?? "(no version)"} (was ${result.before ?? "none"})`);
          deps.notify(installedText(result.after));
          return;
        }
      }
    }, { waitMs: 0 });
  } catch (error) {
    if (error instanceof LockBusyError)
      return;
    const detail = messageOf(error);
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
  await backgroundCheck({
    paths,
    env,
    now: () => Date.now(),
    claude: which("claude"),
    run: capturingRunner(env),
    notify: (text) => {
      const argv = notifyCommand(text, process.platform, which);
      if (argv !== null)
        capturingRunner(env)(argv);
    }
  });
} else {
  try {
    const answer = sessionStart({
      paths,
      nowMs: Date.now(),
      sessionPid: sessionPid(),
      version: VERSION,
      spawnBackground: () => {
        Bun.spawn([process.execPath, Bun.main, "--background"], {
          detached: true,
          env,
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
