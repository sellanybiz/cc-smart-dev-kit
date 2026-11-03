// @bun
// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "cc-smart-dev-kit";

// src/build-info/index.ts
var info = {
  version: "2.0.0",
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
  return cmdLine('start "" /b ', argv);
}
function cmdLine(head, argv) {
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
  return { argv: [CMD, ...CMD_ARGUMENTS, `"${head}${quoted.join(" ")}"`], ok: true };
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

// src/portal/session-start.ts
import { existsSync as existsSync15 } from "fs";
import { join as join15 } from "path";

// src/hooks/attended.ts
function isAttended(env) {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
}

// src/setup/lock.ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join3 } from "path";

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
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
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
    info = parseLock(readFileSync(file, "utf8"));
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
  const file = join3(stateDir, LOCK_FILE);
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

// src/setup/managed-json.ts
import { createHash } from "crypto";
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "fs";
import { join as join5 } from "path";

// src/setup/user-json.ts
import { readFileSync as readFileSync2 } from "fs";
var BOM = "\uFEFF";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}
function readUserJson(file) {
  return parseUserJson(readFileSync2(file, "utf8"));
}

// src/setup/write.ts
import {
  closeSync as closeSync2,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync3,
  readlinkSync as readlinkSync2,
  realpathSync,
  renameSync,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "fs";
import { basename, dirname, join as join4, resolve } from "path";
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
      return parent === path ? path : join4(realTarget(parent), basename(path));
    }
    path = resolve(dirname(path), readlinkSync2(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}
function fileMode(file) {
  return existsSync(file) ? statSync2(file).mode & 4095 : null;
}
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync2(dir, { recursive: true });
  const temp = join4(dir, `.${basename(file)}.cc-smart-dev-kit-tmp-${process.pid}-${crypto.randomUUID()}`);
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
    if (existsSync(temp))
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
    if (existsSync(temp))
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
  return join4(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}
function makePrivateDir(dir) {
  mkdirSync2(dir, { recursive: true, mode: 448 });
  setFileMode(dir, 448);
}
function listBackups(stateDir, file) {
  const dir = backupDir(stateDir, file);
  if (!existsSync(dir))
    return [];
  const base = basename(realTarget(file));
  return readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup !== null).sort((a, b) => a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1).map((backup) => {
    const path = join4(dir, backup.name);
    return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 384 };
  });
}
function copyNotExecutable(file, target) {
  const mode = fileMode(file) ?? 384;
  const safeMode = mode & ~73;
  writeFileSync(target, readFileSync3(file), { flag: "wx", mode: safeMode });
  setFileMode(target, safeMode);
  return mode;
}
function backupFile(stateDir, file) {
  const real = realTarget(file);
  const dir = backupDir(stateDir, real);
  const base = basename(real);
  const stamp = utcStamp();
  const mode = fileMode(real);
  const suffix = mode === null ? ABSENT_SUFFIX : (mode & 73) !== 0 ? `.mode-${mode.toString(8)}` : "";
  makePrivateDir(join4(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  const sameStamp = readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup?.stamp === stamp);
  const counter = sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join4(dir, `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`);
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
  const file = join4(stateDir, CHANGED_FILE);
  if (!existsSync(file))
    return {};
  const parsed = JSON.parse(readFileSync3(file, "utf8"));
  const files = parsed?.files;
  if (typeof files !== "object" || files === null || !Object.values(files).every((entry) => isChangedEntry(entry))) {
    throw new Error(`Invalid ${file}: expected { "files": { <path>: { kinds, baseline } } }`);
  }
  return files;
}
function writeChanged(stateDir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
  atomicWrite(join4(stateDir, CHANGED_FILE), `${JSON.stringify({ files: sorted }, null, 2)}
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
  return existsSync(file) ? readFileSync3(file, "utf8") : null;
}
function writeManagedFile(file, content, options) {
  const target = realTarget(file);
  const currentMode = fileMode(target);
  const current = currentMode === null ? null : readFileSync3(target, "utf8");
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
    if (!isBaseline && existsSync(backup))
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

// src/setup/managed-json.ts
var OWNED_FILE = "owned.json";
var TAKEN_SECRET_LEFT = "a taken-over key's value is never kept; its claim is dropped and the key stays";
var TAKEN_VALUE_HELD = "already holds the value it had before cc-smart-dev-kit took it over; the claim is dropped";

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
  if (!existsSync2(file))
    return { data: {}, indent: "  ", text: null };
  const text = readFileSync4(file, "utf8");
  if (text.trim() === "")
    return { data: {}, indent: "  ", text };
  let parsed;
  try {
    parsed = parseUserJson(text);
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
    if (Object.hasOwn(entry, "was"))
      record.was = entry.was;
    if (typeof entry.wasSha256 === "string")
      record.wasSha256 = entry.wasSha256;
    if (entry.taken === true)
      record.taken = true;
    return record;
  }
  throw new Error(`Invalid ${file}: an owned key that is neither a path nor a record`);
}
function readOwned(stateDir) {
  const file = join5(stateDir, OWNED_FILE);
  if (!existsSync2(file))
    return {};
  const parsed = JSON.parse(readFileSync4(file, "utf8"));
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
  atomicWrite(join5(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}
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
  const released = [];
  let setsSecret = false;
  const recordFor = (path, value) => {
    const held = ownedHere.find((entry) => samePath(entry.path, path));
    return {
      ...recordOf(path, value, isSecret(path)),
      ...held?.was !== undefined && { was: held.was },
      ...held?.wasSha256 !== undefined && { wasSha256: held.wasSha256 },
      ...held?.taken === true && { taken: true }
    };
  };
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
        updated.push(recordFor(path, value));
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
    updated.push(recordFor(path, value));
  }
  for (const [path, value] of options.claim ?? []) {
    const current = getKey(data, path);
    if (!current.found || !Bun.deepEquals(current.value, value, true)) {
      skipped.push({ path, reason: "not the value it was taken over with; left alone" });
      continue;
    }
    const record = recordFor(path, value);
    record.taken = true;
    if (isSecret(path))
      record.wasSha256 = hashOf(value);
    else
      record.was = value;
    updated.push(record);
  }
  for (const [path, value] of options.release ?? []) {
    const current = getKey(data, path);
    if (ownership(ownedHere, path, current) !== "ours") {
      dropped.push(path);
      skipped.push({ path, reason: "changed since cc-smart-dev-kit managed it; left alone" });
      continue;
    }
    if (value === undefined) {
      const held = ownedHere.find((entry) => samePath(entry.path, path));
      if (held?.taken === true) {
        dropped.push(path);
        skipped.push({ path, reason: TAKEN_SECRET_LEFT });
        continue;
      }
      skipped.push({ path, reason: "no value to write back; left as it is" });
      continue;
    }
    dropped.push(path);
    released.push(path);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      skipped.push({
        path,
        reason: "already holds that value; cc-smart-dev-kit's claim is dropped"
      });
      continue;
    }
    if (isSecret(path))
      setsSecret = true;
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
  }
  for (const path of options.withdraw ?? []) {
    const current = getKey(data, path);
    dropped.push(path);
    if (ownership(ownedHere, path, current) !== "ours") {
      skipped.push({ path, reason: "changed since cc-smart-dev-kit managed it; left alone" });
      continue;
    }
    const emptied = deleteKeyAndEmptiedObjects(data, path, options.createdObject);
    changes.push({ path, before: current.value, after: undefined });
    for (const parentPath of emptied)
      changes.push({ path: parentPath, before: {}, after: undefined });
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
    const held = ownedHere.find((entry) => samePath(entry.path, path));
    if (held?.was !== undefined) {
      if (Bun.deepEquals(current.value, held.was, true)) {
        skipped.push({ path, reason: TAKEN_VALUE_HELD });
        continue;
      }
      setKey(data, path, held.was);
      changes.push({ path, before: current.value, after: held.was });
      continue;
    }
    if (held?.wasSha256 !== undefined) {
      skipped.push({ path, reason: TAKEN_SECRET_LEFT });
      continue;
    }
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
  const changedPaths = changes.filter((change) => change.after !== undefined && !released.some((path) => samePath(path, change.path)));
  if (changedPaths.length > 0) {
    const pending = [
      ...ownedHere.filter((entry) => !changedPaths.some((c) => samePath(c.path, entry.path))),
      ...changedPaths.map((change) => {
        const held = ownedHere.find((entry) => samePath(entry.path, change.path));
        return {
          path: [...change.path],
          ...held?.was !== undefined && { was: held.was },
          ...held?.wasSha256 !== undefined && { wasSha256: held.wasSha256 },
          ...held?.taken === true && { taken: true }
        };
      })
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

// src/setup/marketplace-access.ts
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "fs";
import { join as join6 } from "path";
var ACCESS_TIMEOUT_MS = 1e4;
function marketplaceSource(knownMarketplacesFile, name, env = process.env) {
  if (!existsSync3(knownMarketplacesFile))
    return { kind: "missing" };
  let known;
  try {
    known = JSON.parse(readFileSync5(knownMarketplacesFile, "utf8"));
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
    return lsRemoteFailure(result.exitCode, Boolean(result.signalCode), result.stderr.toString());
  } catch (error) {
    return lsRemoteUnspawned(error);
  }
}
function lsRemoteFailure(exitCode, timedOut, stderrText) {
  const said = redactUrlsIn(stderrText.trim());
  const detail = timedOut ? "timed out" : (said.split(`
`).at(-1) ?? "").trim();
  const output = said || `git exited with ${exitCode}`;
  return {
    detail: detail || `git exited with ${exitCode}`,
    ok: false,
    output
  };
}
function lsRemoteUnspawned(error) {
  const said = redactUrlsIn(error instanceof Error ? error.message : String(error));
  return { detail: said, ok: false, output: said };
}
function marketplaceInstallLocation(knownMarketplacesFile, name) {
  const location = knownMarketplaceEntry(knownMarketplacesFile, name)?.installLocation;
  return typeof location === "string" && location !== "" ? location : null;
}
function marketplaceAutoUpdate(knownMarketplacesFile, name) {
  const autoUpdate = knownMarketplaceEntry(knownMarketplacesFile, name)?.autoUpdate;
  return typeof autoUpdate === "boolean" ? autoUpdate : undefined;
}
function knownMarketplaceEntry(knownMarketplacesFile, name) {
  if (!existsSync3(knownMarketplacesFile))
    return null;
  try {
    const known = JSON.parse(readFileSync5(knownMarketplacesFile, "utf8"));
    const entry = known?.[name];
    return typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : null;
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
    folder = pluginFolderIn(readFileSync5(join6(location, ".claude-plugin", "marketplace.json"), "utf8"), plugin) ?? folder;
  } catch {}
  const manifest = join6(location, folder, ".claude-plugin", "plugin.json");
  try {
    const version = JSON.parse(readFileSync5(manifest, "utf8"))?.version;
    return { manifest, version: typeof version === "string" ? version : null };
  } catch {
    return { manifest, version: null };
  }
}

// src/setup/auto-update.ts
var AUTO_UPDATE_KEY = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];
var AUTO_UPDATE_VALUE = false;
function autoUpdateState(paths) {
  const current = getKey(readJsonObject(paths.settingsFile).data, AUTO_UPDATE_KEY);
  if (current.found) {
    if (current.value !== true)
      return "off";
    const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
    return ownership(records, AUTO_UPDATE_KEY, current) === "ours" ? "ours" : "yours";
  }
  return marketplaceAutoUpdate(paths.knownMarketplacesFile, MARKETPLACE) === true ? "known" : "off";
}
async function turnOffLeftoverAutoUpdate(paths) {
  const state = autoUpdateState(paths);
  if (state !== "ours")
    return { result: null, state };
  const result = await withLock(paths.stateDir, () => applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: [[AUTO_UPDATE_KEY, AUTO_UPDATE_VALUE]]
  }));
  return { result, state };
}

// src/setup/bun-config.ts
import { basename as basename2, join as join7 } from "path";
var BUN_CONFIG_NAME = "bunfig.toml";
function bunConfigPath(pluginDir) {
  return join7(pluginDir, BUN_CONFIG_NAME);
}
function bunConfigArg(pluginDir) {
  return `--config=${bunConfigPath(pluginDir)}`;
}
function pluginFolderBeside(importDir) {
  return basename2(importDir) === "dist" ? join7(importDir, "..") : join7(importDir, "..", "..", "plugin");
}

// src/setup/installed-plugins.ts
import { existsSync as existsSync4, readFileSync as readFileSync6 } from "fs";
function pluginsRecord(installedPluginsFile) {
  if (!existsSync4(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync6(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = parsed?.plugins;
  return typeof plugins === "object" && plugins !== null && !Array.isArray(plugins) ? plugins : null;
}
function findUserInstall(installedPluginsFile, pluginId = PLUGIN_ID) {
  const entries = pluginsRecord(installedPluginsFile)?.[pluginId];
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

// src/setup/instructions.ts
import { existsSync as existsSync11, readdirSync as readdirSync4, readFileSync as readFileSync13, rmSync as rmSync2 } from "fs";
import { join as join11, relative as relative2, sep as sep3 } from "path";

// src/path-compare.ts
import { resolve as resolve2 } from "path";
var IGNORE_CASE = process.platform === "win32";
function isInside(path, folder, ignoreCase = IGNORE_CASE) {
  const child = pathForm(path, ignoreCase);
  const parent = pathForm(folder, ignoreCase);
  return child === parent || child.startsWith(`${parent}/`);
}
function pathForm(path, ignoreCase = IGNORE_CASE) {
  const forward = resolve2(path.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return ignoreCase ? forward.toLowerCase() : forward;
}
function isStrictlyInside(path, folder, ignoreCase = IGNORE_CASE) {
  return isInside(path, folder, ignoreCase) && !isInside(folder, path, ignoreCase);
}

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
    const local = localHead(location, env);
    catalogBehind = local !== null && local !== remote.head;
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

// src/setup/managed-markdown.ts
import { existsSync as existsSync5, readFileSync as readFileSync7 } from "fs";
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
    const text = existsSync5(file) ? readFileSync7(file, "utf8") : null;
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
import { existsSync as existsSync10, readdirSync as readdirSync3, readFileSync as readFileSync12, rmdirSync } from "fs";
import { dirname as dirname3 } from "path";

// src/setup/managed-entries.ts
import { existsSync as existsSync6, readFileSync as readFileSync8 } from "fs";
import { join as join8 } from "path";
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
  const parsed = JSON.parse(readFileSync8(file, "utf8"));
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
  const created = createdObjects(options.stateDir, file);
  if (dropList || list.length === 0 && created(path)) {
    deleteKey(data, path);
    for (let depth = path.length - 1;depth > 0; depth -= 1) {
      const parentPath = path.slice(0, depth);
      const parent = getKey(data, parentPath);
      if (!created(parentPath) || !parent.found || !isObject(parent.value) || Object.keys(parent.value).length > 0)
        break;
      deleteKey(data, parentPath);
    }
  } else
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

// src/setup/managed-folder.ts
import {
  existsSync as existsSync7,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync9,
  renameSync as renameSync2,
  rmSync,
  writeFileSync as writeFileSync2
} from "fs";
import { basename as basename3, dirname as dirname2, join as join9, relative, sep as sep2 } from "path";
var OWNED_FOLDERS_FILE = "owned-folders.json";
var OWNED_FOLDER_MARK = ".cc-smart-dev-kit-owned";
function markedOwned(folder) {
  return existsSync7(join9(folder, OWNED_FOLDER_MARK));
}
function ownedFoldersFile(stateDir) {
  return join9(stateDir, OWNED_FOLDERS_FILE);
}
function readOwnedFolders(stateDir) {
  const file = ownedFoldersFile(stateDir);
  if (!existsSync7(file))
    return [];
  const parsed = JSON.parse(readFileSync9(file, "utf8"));
  const folders = parsed?.folders;
  if (!Array.isArray(folders) || !folders.every((one) => typeof one === "string")) {
    throw new Error(`Invalid ${file}: expected { "folders": [<path>, \u2026] }`);
  }
  return [...folders].sort();
}
function writeOwnedFolders(stateDir, folders) {
  mkdirSync3(stateDir, { recursive: true });
  atomicWrite(ownedFoldersFile(stateDir), `${JSON.stringify({ folders: [...folders].sort() }, null, 2)}
`, 384);
}
function forgetOwnedFolder(stateDir, folder) {
  const folders = readOwnedFolders(stateDir);
  if (!folders.includes(folder))
    return;
  writeOwnedFolders(stateDir, folders.filter((one) => one !== folder));
}
function removeManagedFolder(target, stateDir) {
  const real = realTarget(target);
  const ours = existsSync7(real) && markedOwned(real);
  if (ours)
    rmSync(real, { force: true, recursive: true });
  forgetOwnedFolder(stateDir, real);
  return ours;
}

// src/setup/managed-hook.ts
import { existsSync as existsSync8, readFileSync as readFileSync10 } from "fs";
import { join as join10 } from "path";
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
  const file = join10(stateDir, OWNED_HOOKS_FILE);
  if (!existsSync8(file))
    return {};
  const parsed = JSON.parse(readFileSync10(file, "utf8"));
  const valid = isObject(parsed) && Object.values(parsed).every((events) => isObject(events) && Object.values(events).every(isOwnedHookRecord));
  if (!valid) {
    throw new Error(`Invalid ${file}: expected { <file>: { <event>: { entry, created } } }`);
  }
  return parsed;
}
function writeOwnedHooks(stateDir, state) {
  atomicWrite(join10(stateDir, OWNED_HOOKS_FILE), `${JSON.stringify(state, null, 2)}
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
import { existsSync as existsSync9, readFileSync as readFileSync11 } from "fs";
function renderWithoutLines(current, lines) {
  const unwanted = new Set(lines);
  return current.split(`
`).filter((one) => !unwanted.has(one)).join(`
`);
}
function writeRendered(file, stateDir, render, options) {
  const target = realTarget(file);
  return retryOnConcurrentChange(target, () => {
    const current = existsSync9(target) ? readFileSync11(target, "utf8") : null;
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
function writeEach(file, keys, options) {
  const remove = [];
  const write = [];
  for (const key of keys) {
    const instead = options.writeInstead?.(file, key);
    if (instead === undefined)
      remove.push(key);
    else
      write.push([key, instead.value]);
  }
  return { remove, write };
}
function createdByUs(entry) {
  return entry.baseline?.endsWith(ABSENT_SUFFIX) ?? false;
}
function restoreWholeFile(file, entry, stateDir) {
  const baseline = listBackups(stateDir, file).find((backup) => backup.path === entry.baseline);
  if (!baseline)
    return { file, action: "no-backup", details: [] };
  if (baseline.absent) {
    if (!existsSync10(file))
      return { file, action: "unchanged", details: [] };
    return { file, action: "removed", details: [], savedAs: removeManagedFile(stateDir, file) };
  }
  const result = writeManagedFile(file, readFileSync12(baseline.path, "utf8"), {
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
  if (!existsSync10(file))
    return false;
  const text = readFileSync12(file, "utf8").trim();
  return text === "" || text === "{}";
}
function restorePartly(file, entry, stateDir, options) {
  const details = [];
  const written = [];
  const putBack = [];
  let savedAs = null;
  if (entry.kinds.includes("json-keys")) {
    const keys = ownedKeys(stateDir, file);
    if (keys.length > 0) {
      const { remove, write } = writeEach(file, keys, options);
      const result = applyManagedJson({
        file,
        stateDir,
        ...write.length > 0 && { set: write },
        remove,
        createdObject: createdObjects(stateDir, file)
      });
      for (const change of result.changes) {
        const path = formatKeyPath(change.path);
        if (change.after === undefined)
          details.push(path);
        else if (write.some(([key]) => samePath(key, change.path)))
          written.push({ path, value: change.after });
        else
          putBack.push(path);
      }
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
  if (details.length === 0 && written.length === 0 && putBack.length === 0) {
    return { file, action: "unchanged", details };
  }
  return {
    file,
    action: "cleaned",
    details,
    ...written.length > 0 && { written },
    ...putBack.length > 0 && { putBack },
    ...savedAs && { savedAs }
  };
}
function restore(stateDir, options = {}) {
  const except = new Set(options.except ?? []);
  const only = options.only === undefined ? null : new Set(options.only);
  const hooks = new Map(removeAllManagedHooks(stateDir, { except, only }).map((result) => [result.file, result]));
  const entries = Object.entries(readChanged(stateDir)).filter(([file]) => !except.has(file) && (only === null || only.has(file)));
  const results = entries.map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file") ? restoreWholeFile(file, entry, stateDir) : restorePartly(file, entry, stateDir, options);
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
    const holdsWritten = (result.written ?? []).length > 0;
    if (result.action !== "no-backup" && !holdsWritten)
      forgetChange(stateDir, file);
    if (result.action === "removed")
      removeEmptyFolders(file, stateDir);
    return result;
  });
  for (const folder of readOwnedFolders(stateDir)) {
    if (except.has(folder) || only !== null && !only.has(folder))
      continue;
    if (removeManagedFolder(folder, stateDir))
      results.push({ file: folder, action: "removed", details: [] });
  }
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
  let dir = dirname3(file);
  while (isStrictlyInside(dir, root) && existsSync10(dir) && readdirSync3(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname3(dir);
  }
}

// src/setup/instructions.ts
var ALWAYS_ON_FILE = "core.md";
function optOutFile(stateDir) {
  return join11(stateDir, "no-instructions");
}
function versionStampFile(stateDir) {
  return join11(stateDir, "instructions-version");
}
function instructionsOptedOut(stateDir) {
  return existsSync11(optOutFile(stateDir));
}
function readVersionStamp(stateDir) {
  const file = versionStampFile(stateDir);
  if (!existsSync11(file))
    return null;
  const version = readFileSync13(file, "utf8").trim();
  return version === "" ? null : version;
}
function instructionsPaths(paths, source) {
  const target = join11(paths.stateDir, "instructions");
  return {
    source,
    target,
    claudeMd: join11(paths.claudeConfigDir, "CLAUDE.md"),
    stateDir: paths.stateDir,
    importPath: claudeImportPath(join11(target, ALWAYS_ON_FILE), paths.home),
    installedPluginsFile: paths.installedPluginsFile
  };
}
function instructionsFolder(bundleDir) {
  const beside = join11(bundleDir, "..", "instructions");
  return existsSync11(beside) ? beside : join11(bundleDir, "..", "..", "plugin", "instructions");
}
function claudeImportPath(path, home) {
  const rest = path.slice(home.length);
  const underHome = path.startsWith(home) && /^[\\/]/.test(rest);
  return (underHome ? `~${rest}` : path).replaceAll("\\", "/").replaceAll(" ", "\\ ");
}
function listInstructionFiles(source) {
  if (!existsSync11(source)) {
    throw new Error(`The plugin's instructions folder is missing: ${source}. Reinstall the plugin.`);
  }
  const files = readdirSync4(source, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => relative2(source, join11(entry.parentPath, entry.name)).split(sep3).join("/")).sort();
  if (!files.includes(ALWAYS_ON_FILE)) {
    throw new Error(`The plugin's instructions folder has no ${ALWAYS_ON_FILE}: ${source}. Reinstall the plugin.`);
  }
  return files;
}
function copiesUnder(files, root, ignoreCase = IGNORE_CASE) {
  return files.filter((file) => isStrictlyInside(file, root, ignoreCase));
}
function trackedCopies(target, stateDir) {
  return copiesUnder(Object.keys(readChanged(stateDir)), realTarget(target));
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
    return files.filter((file) => existsSync11(file)).map((file) => {
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
    const file = join11(paths.target, name);
    wanted.add(realTarget(file));
    const result = writeManagedFile(file, readFileSync13(join11(paths.source, name), "utf8"), {
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

// src/setup/user-notify-hook.ts
import { existsSync as existsSync12 } from "fs";

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
    parsed = readUserJson(file);
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

// src/update/apply.ts
import { existsSync as existsSync13, readFileSync as readFileSync15 } from "fs";
import { join as join13 } from "path";

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

// src/update/major.ts
import { readFileSync as readFileSync14 } from "fs";
import { join as join12 } from "path";
var MAJOR_NOTES_PATH = join12("src", "update", "major-notes.json");
var NOTE_MAX = 120;
function majorOf(version) {
  const major = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/.exec(version.trim())?.[1];
  return major === undefined ? null : Number(major);
}
function isNewMajor(from, to) {
  if (from === null || to === null)
    return false;
  const major = majorOf(from);
  if (major === null)
    return false;
  try {
    return Bun.semver.order(to, `${major + 1}.0.0-0`) >= 0;
  } catch {
    return false;
  }
}
function shownNote(note) {
  if (typeof note !== "string")
    return null;
  const text = note.trim();
  return text !== "" && text.length <= NOTE_MAX && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : null;
}
function majorNotesBetween(text, from, to) {
  let table;
  try {
    table = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof table !== "object" || table === null || Array.isArray(table))
    return [];
  const crossed = Object.keys(table).filter((version) => majorOf(version) !== null && isNewMajor(from, version) && !isNewMajor(to, version));
  return crossed.sort((a, b) => Bun.semver.order(a, b)).map((version) => shownNote(table[version])).filter((note) => note !== null);
}
function readMajorNotes(location, from, to) {
  if (location === null)
    return [];
  try {
    return majorNotesBetween(readFileSync14(join12(location, MAJOR_NOTES_PATH), "utf8"), from, to);
  } catch {
    return [];
  }
}
function why(notes) {
  return notes.length === 0 ? "" : ` (${notes.join("; ")})`;
}
function majorReadyLine(version, notes) {
  return `${PLUGIN} ${version} is ready: it is a major version${why(notes)}. Read What's new, then run \`${COMMAND} update\`.`;
}
function majorHeldDetail(version, notes) {
  return `${version} is a major version${why(notes)}: it waits for \`${COMMAND} update\``;
}

// src/update/apply.ts
var CLAUDE_TIMEOUT_MS = 180000;
var MARKETPLACE_REFRESH = ["plugin", "marketplace", "update", MARKETPLACE];
var PLUGIN_UPDATE = ["plugin", "update", PLUGIN_ID, "--scope", "user"];
var BUSY_DETAIL = "Claude Code was refreshing the same marketplace (git's index.lock was taken); the next check tries again";
async function applyUpdate(paths, claude, run, say, onMajor) {
  const before = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const fail = (detail) => ({ after: before, before, detail, ok: false });
  if (claude === null)
    return fail("the claude command is not on PATH");
  const step = async (args) => {
    say(`claude ${args.join(" ")}`);
    const result = await run([claude, ...args]);
    if (result.exitCode === 0)
      return null;
    if (result.output.includes("index.lock")) {
      return { after: before, before, busy: true, detail: BUSY_DETAIL, ok: false };
    }
    const last = redactUrlsIn(result.output.trim().split(`
`).at(-1)?.trim() ?? "");
    return fail(`claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`);
  };
  const refreshed = await step(MARKETPLACE_REFRESH);
  if (refreshed !== null)
    return refreshed;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const inCopy = location === null ? null : marketplaceCopyVersion(location, PLUGIN).version;
  if (inCopy !== null && isOlder(before, inCopy)) {
    if (isNewMajor(before, inCopy)) {
      const major = {
        from: before,
        notes: readMajorNotes(location, before, inCopy),
        to: inCopy
      };
      if (!onMajor(major))
        return { after: before, before, detail: "", held: major, ok: true };
    }
    const updated = await step(PLUGIN_UPDATE);
    if (updated !== null)
      return updated;
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}
function routerNeedsSetup(paths) {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null || !existsSync13(paths.routerCopy))
    return false;
  const bundle = join13(install.installPath, "dist", "router.js");
  return existsSync13(bundle) && readFileSync15(bundle, "utf8") !== readFileSync15(paths.routerCopy, "utf8");
}
var ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart); a machine set up before Claude became the default runs ${COMMAND} setup once first, which moves it`;
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
        timeout: CLAUDE_TIMEOUT_MS,
        windowsHide: true
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

// src/update/opt-out.ts
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
    const parsed = readUserJson(settingsFile);
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
  existsSync as existsSync14,
  mkdirSync as mkdirSync4,
  readdirSync as readdirSync5,
  readFileSync as readFileSync16,
  rmSync as rmSync3,
  statSync as statSync3,
  writeFileSync as writeFileSync3
} from "fs";
import { join as join14 } from "path";
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
function updateFiles(stateDir) {
  return {
    hold: join14(stateDir, "update-hold"),
    check: join14(stateDir, "update-check.json"),
    reported: join14(stateDir, "update-reported"),
    major: join14(stateDir, "update-major.json"),
    log: join14(stateDir, "update.log"),
    lockDir: join14(stateDir, "update"),
    sessions: join14(stateDir, "sessions")
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
  mkdirSync4(dir, { recursive: true, mode: 448 });
}
function readLastCheck(files) {
  try {
    const parsed = JSON.parse(readFileSync16(files.check, "utf8"));
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
  ensureDir(join14(files.check, ".."));
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
  return existsSync14(files.hold);
}
function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function appendLogLine(logFile, line, nowMs) {
  ensureDir(join14(logFile, ".."));
  try {
    if (statSync3(logFile).size > LOG_MAX_BYTES) {
      const text = readFileSync16(logFile, "utf8");
      const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
      writeFileSync3(logFile, keep.slice(keep.indexOf(`
`) + 1), { mode: 384 });
    }
  } catch {}
  appendFileSync(logFile, `${isoSeconds(nowMs)} ${line}
`, { mode: 384 });
}
function appendLog(files, line, nowMs) {
  appendLogLine(files.log, line, nowMs);
}
function wasReported(files, at) {
  try {
    return readFileSync16(files.reported, "utf8").trim() === at;
  } catch {
    return false;
  }
}
function markReported(files, at) {
  ensureDir(join14(files.reported, ".."));
  atomicWrite(files.reported, `${at}
`, 384);
}
function readHeldMajor(files) {
  try {
    const parsed = JSON.parse(readFileSync16(files.major, "utf8"));
    if (typeof parsed?.version !== "string" || typeof parsed.at !== "string" || parsed.from !== null && typeof parsed.from !== "string" || !Array.isArray(parsed.notes) || !parsed.notes.every((note) => typeof note === "string")) {
      return null;
    }
    return { at: parsed.at, from: parsed.from, notes: parsed.notes, version: parsed.version };
  } catch {
    return null;
  }
}
function writeHeldMajor(files, held) {
  ensureDir(join14(files.major, ".."));
  atomicWrite(files.major, `${JSON.stringify(held, null, 2)}
`, 384);
}
function clearHeldMajor(files) {
  rmSync3(files.major, { force: true });
}
function readSession(file) {
  try {
    const parsed = JSON.parse(readFileSync16(file, "utf8"));
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
  for (const name of readdirSync5(files.sessions).filter((entry) => SESSION_FILE.test(entry))) {
    const file = join14(files.sessions, name);
    const session = readSession(file);
    if (session === null || !isRunning(session))
      rmSync3(file, { force: true });
  }
  const record = { pid, start, version };
  atomicWrite(join14(files.sessions, `${pid}.json`), `${JSON.stringify(record)}
`, 384);
}

// src/update/background.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function optOutDetail(name) {
  return `${name} is set`;
}
function backgroundCommand(bunPath, entryPath, pluginDir) {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), entryPath, "--background"];
}
function sessionSourceOf(input) {
  try {
    const source = JSON.parse(input)?.source;
    return typeof source === "string" ? source : null;
  } catch {
    return null;
  }
}
function sessionStarts(source) {
  return source === null || source === "startup" || source === "resume";
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
  const messages = [];
  const reportKey = last?.since ?? last?.at ?? "";
  if (last?.result === "failed" && !wasReported(files, reportKey) && isAttended(deps.env)) {
    markReported(files, reportKey);
    messages.push(`${PLUGIN}: the background update failed at ${last.at} (${last.detail}). The log: ${tildify(files.log, deps.paths.home)}. To try now: ${COMMAND} update`);
  }
  const major = readHeldMajor(files);
  if (major !== null && sessionStarts(deps.source) && isAttended(deps.env)) {
    const installed = findUserInstall(deps.paths.installedPluginsFile)?.version ?? null;
    if (isOlder(installed, major.version)) {
      messages.push(majorReadyLine(major.version, major.notes));
    }
  }
  if (isDue(last, deps.nowMs))
    deps.spawnBackground();
  return messages.length === 0 ? "" : JSON.stringify({ systemMessage: messages.join(`
`) });
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
async function turnOffAutoUpdateQuietly(paths, log) {
  const key = formatKeyPath(AUTO_UPDATE_KEY);
  try {
    const { result, state } = await turnOffLeftoverAutoUpdate(paths);
    if (result?.written === true) {
      log(`auto-update: ${key} set to ${AUTO_UPDATE_VALUE} in ${tildify(result.file, paths.home)}: Claude Code's own plugin auto-update is off`);
    } else if (state === "yours") {
      log(`auto-update: left on: ${key} is true in ${tildify(paths.settingsFile, paths.home)}, set by you; \`${COMMAND} doctor\` says how to turn it off`);
    }
  } catch (error) {
    const why = error instanceof LockBusyError ? "the state lock is busy (a setup runs now)" : redactUrlsIn(messageOf(error));
    log(`auto-update: not turned off (${why}); the next check tries again`);
  }
}
async function backgroundCheck(deps) {
  const files = updateFiles(deps.paths.stateDir);
  const log = (line) => appendLog(files, line, deps.now());
  let at = isoSeconds(deps.now());
  try {
    await withLock(files.lockDir, async () => {
      const previous = readLastCheck(files);
      if (isHeld(files) || !isDue(previous, deps.now()))
        return;
      at = isoSeconds(deps.now());
      await turnOffAutoUpdateQuietly(deps.paths, log);
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
          clearHeldMajor(files);
          record("up-to-date", status.installed);
          return;
        case "behind": {
          log(`newer: installed ${status.installed ?? "(no version)"}, the marketplace copy ${status.inCopy ?? "(unreadable)"}${status.catalogBehind ? ", and the copy is behind the remote" : ""}`);
          const result = await applyUpdate(deps.paths, deps.claude, deps.run, (line) => log(`run: ${line}`), () => false);
          if (result.held !== undefined) {
            const { from, notes, to } = result.held;
            const known = readHeldMajor(files);
            writeHeldMajor(files, {
              at: known?.version === to ? known.at : at,
              from,
              notes,
              version: to
            });
            record("skipped", majorHeldDetail(to, notes));
            return;
          }
          if (result.busy === true) {
            record("skipped", result.detail);
            return;
          }
          if (!result.ok) {
            record("failed", result.detail);
            return;
          }
          clearHeldMajor(files);
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

// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}

class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = undefined;
  }
  get value() {
    const getter = this._getter;
    if (getter !== undefined) {
      this._value = getter();
      this._getter = undefined;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject2(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject2(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject2(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== undefined && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value }));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a;
  for (let i = start;i < issues.length; i++) {
    (_a = issues[i]).schema ?? (_a.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config) {
  var _a;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a = iss).schema ?? (_a.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : undefined;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0;i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? undefined : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = undefined;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: undefined };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: undefined, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition;
      }
      try {
        return new Definition;
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition;
}
function $constructor(name, initializer, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = new Set;
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && new WeakSet;
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = undefined;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    if (initialized) {
      const own = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto = _.prototype;
    for (const k in proto) {
      if (!Object.prototype.hasOwnProperty.call(proto, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = undefined;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: undefined, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = undefined;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, undefined, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node = curr[el];
            if (terminal) {
              node._errors.push(mapper(issue));
            }
            curr = node;
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError;
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = undefined;
        ctx = undefined;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = undefined;
      ctx = undefined;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = (schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== undefined) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === undefined)
      return false;
  }
  return validateFallback(schema, value, _ctx);
};
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== undefined;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join(`
`)}
};`);
    return factory(...Object.values(this.closed));
  }
}

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {}
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== undefined && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === undefined ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== undefined && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === undefined) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, new Set);
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== undefined)
          propValues[key].add(undefined);
      }
    }
    return propValues;
  });
  const isObject = isObject2;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== undefined;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject = isObject2;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== undefined) ? "optional" : undefined);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  const keyIssues = new Map;
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? undefined : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? new Set([...values, undefined]) : undefined;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result) => handleOptionalResult(payload, result));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? new Set([...zod.def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleCatchResult(payload, result, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// node_modules/zod/v4/core/memoizer.js
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap;
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached = recursive.get(inst);
  if (cached !== undefined)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : undefined);
      merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    case "template_literal":
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = new WeakMap;
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = undefined;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError;
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === undefined) {
          const walked = isRecursive(inst, new Set, false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: new WeakMap, backEdges: undefined };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = new WeakSet);
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = undefined;
        const entry = open.length > depth ? open.pop() : undefined;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== undefined && isRef(value) && backEdges.has(value);
}
// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = getTypeName(issue.expected);
        const receivedType = parsedType(issue.input);
        const received = getTypeName(receivedType, issue.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// node_modules/zod/v4/core/registries.js
var _a2;
class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    sharedDefsExtractedFor: undefined,
    sharedEmitDoneFor: undefined,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? undefined
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === undefined || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = undefined;
  ctx.sharedEmitDoneFor = undefined;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== undefined)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === undefined || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members) {
  const objects = [];
  for (const member of members) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required = new Set;
  for (const object of objects) {
    for (const key in object.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === undefined)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object.required ?? [])
      required.add(key);
  }
  const folded = { type: "object", properties };
  if (required.size)
    folded.required = [...required];
  if (objects.every((object) => object.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object of objects) {
      const constraint = undeclaredConstraint(object);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
    if (Object.keys(union).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union);
    const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        assignProps(schema, refSchema);
      }
      assignProps(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = new Map;
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === undefined || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === undefined || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = new Set);
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== undefined)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== undefined)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== undefined)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== undefined)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== undefined)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== undefined) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var exactPatterns = new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = new Set;
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== undefined)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === undefined : field._zod.optout === undefined) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== undefined ? [json.const] : undefined);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = new WeakMap;
function rewriteKeyNames(ctx) {
  const bySchema = new Map;
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = new Map;
  for (const record of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, new Set);
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== undefined;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues) => {
    self.issues.push(...issues);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, undefined, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(undefined).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse(data, params) {
    return parse2(this, data, params, { callee: _parse });
  },
  parseAsync: async function _parseAsync(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode(data, params) {
    return encode(this, data, params, { callee: _encode });
  },
  decode: function _decode(data, params) {
    return decode(this, data, params, { callee: _decode });
  },
  encodeAsync: async function _encodeAsync(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync });
  },
  decodeAsync: async function _decodeAsync(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  get description() {
    return globalRegistry.get(this)?.description;
  },
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /* @__PURE__ */ derived({
  format: (inst) => aggregateChecks(inst).format ?? null,
  minLength: (inst) => aggregateChecks(inst).minimum ?? null,
  maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
  regex(...args) {
    return this.check(_regex(...args));
  },
  includes(...args) {
    return this.check(_includes(...args));
  },
  startsWith(...args) {
    return this.check(_startsWith(...args));
  },
  endsWith(...args) {
    return this.check(_endsWith(...args));
  },
  min(...args) {
    return this.check(_minLength(...args));
  },
  max(...args) {
    return this.check(_maxLength(...args));
  },
  length(...args) {
    return this.check(_length(...args));
  },
  nonempty(...args) {
    return this.check(_minLength(1, ...args));
  },
  lowercase(params) {
    return this.check(_lowercase(params));
  },
  uppercase(params) {
    return this.check(_uppercase(params));
  },
  trim() {
    return this.check(_trim());
  },
  normalize(...args) {
    return this.check(_normalize(...args));
  },
  toLowerCase() {
    return this.check(_toLowerCase());
  },
  toUpperCase() {
    return this.check(_toUpperCase());
  },
  slugify() {
    return this.check(_slugify());
  }
}));
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  inst.isFinite = true;
}, /* @__PURE__ */ derived({
  minValue: (inst) => {
    const { minimum, exclusiveMinimum } = aggregateChecks(inst);
    return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
  },
  maxValue: (inst) => {
    const { maximum, exclusiveMaximum } = aggregateChecks(inst);
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
  },
  isInt: (inst) => {
    const { isInt, multipleOf } = aggregateChecks(inst);
    return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
  },
  format: (inst) => aggregateChecks(inst).format ?? null
}, {
  gt(value, params) {
    return this.check(_gt(value, params));
  },
  gte(value, params) {
    return this.check(_gte(value, params));
  },
  min(value, params) {
    return this.check(_gte(value, params));
  },
  lt(value, params) {
    return this.check(_lt(value, params));
  },
  lte(value, params) {
    return this.check(_lte(value, params));
  },
  max(value, params) {
    return this.check(_lte(value, params));
  },
  int(params) {
    return this.check(int(params));
  },
  safe(params) {
    return this.check(int(params));
  },
  positive(params) {
    return this.check(_gt(0, params));
  },
  nonnegative(params) {
    return this.check(_gte(0, params));
  },
  negative(params) {
    return this.check(_lt(0, params));
  },
  nonpositive(params) {
    return this.check(_lte(0, params));
  },
  multipleOf(value, params) {
    return this.check(_multipleOf(value, params));
  },
  step(value, params) {
    return this.check(_multipleOf(value, params));
  },
  finite() {
    return this;
  }
}));
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: undefined }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
// src/gateway/history.ts
var HISTORY_MAX_RETENTION_DAYS = 3650;
var HISTORY_PURGE_EVERY_MS = 24 * 60 * 60 * 1000;
var HISTORY_RETRY_MS = 60 * 1000;

// src/gateway/targets.ts
var BACKEND_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"];
var BACKEND_NAME = /^[a-z0-9][a-z0-9_-]*$/;
var SLOT_KEY = /^cc-smart-dev-kit-[a-z0-9][a-z0-9-]*$/;
var CONTEXT_SUFFIX = /\[1m\]$/i;
function isBackendName(name) {
  return BACKEND_NAME.test(name);
}
function isSlotKey(name) {
  return SLOT_KEY.test(name);
}
function withoutContextSuffix(name) {
  return name.replace(CONTEXT_SUFFIX, "");
}
var PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isProfileName(name) {
  return PROFILE_NAME.test(name);
}
function parseTarget(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("claude-")) {
    if (trimmed.length === "claude-".length || /\s/.test(trimmed)) {
      return { error: `"${text}" is not a Claude model id` };
    }
    return { target: { kind: "anthropic", model: trimmed } };
  }
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return { error: `"${text}" is neither claude-<id> nor <backend>:<model>` };
  }
  const backend = trimmed.slice(0, colon);
  const model = trimmed.slice(colon + 1);
  if (!isBackendName(backend)) {
    return { error: `"${backend}" is not a backend name (a-z, 0-9, - and _)` };
  }
  if (model === "" || /\s/.test(model)) {
    return { error: `"${text}" names no model after "${backend}:"` };
  }
  return { target: { backend, kind: "backend", model } };
}
var JUDGE_SLOT = "cc-smart-dev-kit-judge";
var MODEL_SLOTS = {
  "cc-smart-dev-kit-fable": "fable",
  "cc-smart-dev-kit-opus": "opus"
};
var CLAUDE_FAMILIES = ["fable", "haiku", "opus", "sonnet"];
var WORKER_SLOT = "cc-smart-dev-kit-worker";
var FAMILY_SLOTS = {
  "cc-smart-dev-kit-scout": "haiku",
  [WORKER_SLOT]: "sonnet",
  ...MODEL_SLOTS
};
var PROVIDER_PREFIX = /^(?:[a-z0-9-]+\.)*claude-/;
function claudeFamily(model) {
  const name = `${withoutContextSuffix(model).toLowerCase()}-`;
  const prefix = PROVIDER_PREFIX.exec(name);
  if (prefix === null)
    return null;
  const id = name.slice(prefix[0].length - "claude-".length);
  return CLAUDE_FAMILIES.find((family) => id.includes(`-${family}-`)) ?? null;
}
var CAPACITY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

// src/gateway/config.ts
var DEFAULT_PORT = 20100;
var DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
var DEFAULT_FIRST_BYTE_MS = 60000;
var MAX_TIMER_MS = 2147483647;
function timerTooLong(consequence) {
  return `too long: at most ${MAX_TIMER_MS} ms, the longest a timer can wait (above it the wait is 1 ms and ${consequence})`;
}
var BREAKER_HOLD_CEILING_MS = 240000;
var JUDGE_NEVER_HOLDS = "the judge never holds a request (a held safety check would freeze every action in auto mode), so it has no breaker switch";
var baseUrl = url({ protocol: /^https?$/ }).transform((url2) => url2.replace(/\/+$/, ""));
var backendSchema = looseObject({
  apiKey: string2().min(1),
  baseUrl
});
var keptChainSchema = looseObject({
  effort: record(string2(), _enum(BACKEND_EFFORT_LEVELS)).optional(),
  fallback: boolean2().optional(),
  targets: array(string2().min(1)).min(1)
});
var PROFILE_NAME_RULE = "a profile name is lower-case letters, digits and - (the /p/<name> of a project's URL), at most 64";
var SLOT_KEY_RULE = (slot) => `"${slot}" is not a slot key (cc-smart-dev-kit-<name>)`;
var profileSlotSchema = union([literal("claude"), array(string2().min(1)).min(1)], {
  error: 'a profile slot is "claude" (plain Claude for that slot there) or a chain: a list of one or more targets'
});
var profileSchema = looseObject({
  breaker: record(string2(), boolean2()).optional(),
  fallback: record(string2(), boolean2()).optional(),
  kept: record(string2(), keptChainSchema).optional(),
  slots: record(string2(), profileSlotSchema).optional()
});
var gatewayConfigSchema = looseObject({
  aliases: record(string2(), string2()).default({}),
  effort: record(string2(), record(string2(), _enum(BACKEND_EFFORT_LEVELS))).optional(),
  anthropicBaseUrl: literal(DEFAULT_ANTHROPIC_BASE_URL).default(DEFAULT_ANTHROPIC_BASE_URL),
  backends: record(string2().refine(isBackendName, "not a backend name"), backendSchema),
  judgeTested: record(string2(), string2()).optional(),
  kept: record(string2().refine(isSlotKey, "a slot key is cc-smart-dev-kit-<name>"), keptChainSchema).optional(),
  fallback: record(string2(), boolean2()).optional(),
  breaker: record(string2(), boolean2()).optional(),
  history: looseObject({
    retentionDays: int().min(0, "0 turns the request history off, which is the smallest value").max(HISTORY_MAX_RETENTION_DAYS, `at most ${String(HISTORY_MAX_RETENTION_DAYS)} days (ten years), so a typo cannot fill the disk`).optional()
  }).optional(),
  modelSlots: record(string2(), string2()).optional(),
  port: int().min(1).max(65535).default(DEFAULT_PORT),
  profiles: record(string2(), profileSchema).optional(),
  slots: record(string2(), array(string2()).min(1)),
  timeouts: looseObject({
    breakerHoldMs: int().min(0).max(BREAKER_HOLD_CEILING_MS, `too long: at most ${BREAKER_HOLD_CEILING_MS} ms (${BREAKER_HOLD_CEILING_MS / 1000} s), because a longer hold risks Claude Code giving up on the request`).optional(),
    firstByteMs: int().positive().max(MAX_TIMER_MS, timerTooLong("every wait it bounds would end at once")).default(DEFAULT_FIRST_BYTE_MS),
    streamIdleMs: int().positive().max(MAX_TIMER_MS, timerTooLong("every stream would be cut")).optional()
  }).default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
  version: literal(1)
}).superRefine((config, ctx) => {
  for (const [slot, pins] of Object.entries(config.effort ?? {})) {
    if (!isSlotKey(slot))
      ctx.addIssue({ code: "custom", message: SLOT_KEY_RULE(slot), path: ["effort", slot] });
    effortIssues(pins, ["effort", slot], ctx);
  }
  for (const [slot, saved] of Object.entries(config.kept ?? {})) {
    effortIssues(saved.effort ?? {}, ["kept", slot, "effort"], ctx);
  }
  for (const slot of Object.keys(config.slots)) {
    if (!isSlotKey(slot))
      ctx.addIssue({ code: "custom", message: SLOT_KEY_RULE(slot), path: ["slots", slot] });
  }
  for (const [slot, targets] of Object.entries(config.slots)) {
    chainIssues(config, targets, ["slots", slot], ctx);
  }
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    if (!isProfileName(name)) {
      ctx.addIssue({ code: "custom", message: PROFILE_NAME_RULE, path: ["profiles", name] });
      continue;
    }
    for (const field of ["slots", "kept"]) {
      for (const slot of Object.keys(profile[field] ?? {})) {
        if (isSlotKey(slot))
          continue;
        ctx.addIssue({
          code: "custom",
          message: SLOT_KEY_RULE(slot),
          path: ["profiles", name, field, slot]
        });
      }
    }
    for (const [slot, chain] of Object.entries(profile.slots ?? {})) {
      if (chain === "claude")
        continue;
      chainIssues(config, chain, ["profiles", name, "slots", slot], ctx);
    }
    const chained = new Set([...Object.keys(config.slots), ...Object.keys(profile.slots ?? {})].filter((slot) => profileSlotChain(config, profile, slot) !== null));
    for (const slot of Object.keys(profile.fallback ?? {})) {
      if (slot !== JUDGE_SLOT && !chained.has(slot)) {
        ctx.addIssue({
          code: "custom",
          message: `fallback names slot "${slot}", which profile "${name}" has no chain for (a slot with no chain has nothing to fall back to)`,
          path: ["profiles", name, "fallback", slot]
        });
      }
    }
    for (const slot of Object.keys(profile.breaker ?? {})) {
      if (slot === JUDGE_SLOT) {
        ctx.addIssue({
          code: "custom",
          message: `breaker names ${slot}: ${JUDGE_NEVER_HOLDS}`,
          path: ["profiles", name, "breaker", slot]
        });
      } else if (!chained.has(slot)) {
        ctx.addIssue({
          code: "custom",
          message: `breaker names slot "${slot}", which profile "${name}" has no chain for (a slot with no chain has no request to hold)`,
          path: ["profiles", name, "breaker", slot]
        });
      }
    }
  }
  for (const [name, to] of Object.entries(config.aliases)) {
    const error = aliasError(name, to, config);
    if (error !== null)
      ctx.addIssue({ code: "custom", message: error, path: ["aliases", name] });
  }
  for (const [model, slot] of Object.entries(config.modelSlots ?? {})) {
    const error = modelSlotError(model, slot, config.slots);
    if (error !== null) {
      ctx.addIssue({ code: "custom", message: error, path: ["modelSlots", model] });
    }
  }
  for (const slot of Object.keys(config.fallback ?? {})) {
    if (slot !== JUDGE_SLOT && !Object.hasOwn(config.slots, slot)) {
      ctx.addIssue({
        code: "custom",
        message: `fallback names slot "${slot}", which is not in slots (a slot with no chain has nothing to fall back to)`,
        path: ["fallback", slot]
      });
    }
  }
  for (const slot of Object.keys(config.breaker ?? {})) {
    if (slot === JUDGE_SLOT) {
      ctx.addIssue({
        code: "custom",
        message: `breaker names ${slot}: ${JUDGE_NEVER_HOLDS}`,
        path: ["breaker", slot]
      });
    } else if (!Object.hasOwn(config.slots, slot)) {
      ctx.addIssue({
        code: "custom",
        message: `breaker names slot "${slot}", which is not in slots (a slot with no chain has no request to hold)`,
        path: ["breaker", slot]
      });
    }
  }
});
function chainIssues(config, targets, path, ctx) {
  targets.forEach((text, index) => {
    const parsed = parseTarget(text);
    if ("error" in parsed) {
      ctx.addIssue({ code: "custom", message: parsed.error, path: [...path, index] });
    } else if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
      ctx.addIssue({
        code: "custom",
        message: `"${text}" names backend "${parsed.target.backend}", which is not in backends`,
        path: [...path, index]
      });
    }
  });
}
function effortIssues(pins, path, ctx) {
  for (const target of Object.keys(pins)) {
    const parsed = parseTarget(target);
    const error = "error" in parsed ? parsed.error : parsed.target.kind === "anthropic" ? "a Claude target cannot pin effort: Anthropic gets only the fields its model refuses changed" : null;
    if (error !== null)
      ctx.addIssue({ code: "custom", message: error, path: [...path, target] });
  }
}
function profileSlotChain(config, profile, slot) {
  const own = profile.slots !== undefined && Object.hasOwn(profile.slots, slot) ? profile.slots[slot] : undefined;
  if (own === "claude")
    return null;
  if (own !== undefined)
    return own;
  return Object.hasOwn(config.slots, slot) ? config.slots[slot] ?? null : null;
}
function modelSlotError(model, slot, slots) {
  if (!model.startsWith("claude-") || /\s/.test(model) || model === "claude-") {
    return `modelSlots key "${model}" is not a Claude model id`;
  }
  if (withoutContextSuffix(model) !== model) {
    return `modelSlots key "${model}": write it without [1m]; the router looks names up without it`;
  }
  const family = Object.hasOwn(MODEL_SLOTS, slot) ? MODEL_SLOTS[slot] : undefined;
  if (family === undefined) {
    return `modelSlots "${model}" points at "${slot}", which is not a model slot (${Object.keys(MODEL_SLOTS).sort().join(", ")})`;
  }
  if (claudeFamily(model) !== family) {
    return `modelSlots "${model}" points at ${slot}, which is for ${family} models`;
  }
  if (!Object.hasOwn(slots, slot)) {
    return `modelSlots "${model}" points at slot "${slot}", which is not in slots`;
  }
  return null;
}
function aliasError(name, to, config) {
  if (name.trim() === "" || /\s/.test(name))
    return `alias "${name}" is not a model name`;
  if (withoutContextSuffix(name) !== name) {
    return `alias "${name}": write it without [1m]; the router looks names up without it`;
  }
  if (name.startsWith("claude-"))
    return `alias "${name}": a claude-\u2026 name cannot be an alias`;
  if (Object.hasOwn(config.slots, name)) {
    return `alias "${name}" has the name of a slot; a slot cannot be an alias too`;
  }
  if (Object.hasOwn(config.aliases, to)) {
    return `alias "${name}" points at "${to}", which is an alias too; point it at a slot or a model`;
  }
  if (isSlotKey(to)) {
    return Object.hasOwn(config.slots, to) || Object.hasOwn(config.kept ?? {}, to) || Object.hasOwn(FAMILY_SLOTS, to) || to === JUDGE_SLOT ? null : `alias "${name}" points at slot "${to}", which is no slot: not in slots, not saved in kept, and none of the five`;
  }
  const parsed = parseTarget(to);
  if ("error" in parsed)
    return `alias "${name}": ${parsed.error}`;
  if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
    return `alias "${name}" names backend "${parsed.target.backend}", which is not in backends`;
  }
  return null;
}

// src/gateway/limit-state.ts
var NO_RESET_FRESH_MS = 15 * 60000;
var limitSchema = object({
  claim: string2().nullable(),
  resetsAt: number2().nullable(),
  seenAt: number2()
});
var fallbackSchema = object({
  lastAt: number2(),
  model: string2(),
  resetsAt: number2().nullable(),
  since: number2(),
  target: string2()
});
var breakerTargetSchema = object({
  status: int().nullable(),
  target: string2(),
  until: number2()
});
var breakerSchema = object({
  held: int().min(0),
  lastAt: number2(),
  since: number2(),
  targets: array(breakerTargetSchema)
});
var CHECKS_DOWN_WHY = [
  "untested",
  "no-worker",
  "off",
  "failed",
  "chain-untested",
  "chain-failed"
];
var checksDownSchema = object({
  claim: string2().nullable(),
  lastAt: number2(),
  resetsAt: number2().nullable(),
  since: number2(),
  status: int(),
  why: _enum(CHECKS_DOWN_WHY)
});
var stateSchema = object({
  breakers: record(string2(), breakerSchema).optional(),
  checksDown: record(string2(), checksDownSchema).optional(),
  fallbacks: record(string2(), fallbackSchema),
  limits: record(string2(), limitSchema),
  seenClaude: record(string2(), number2()).optional(),
  version: literal(1)
});

// src/gateway/breaker.ts
var BREAKER_REMINDER_MS = 10 * 60000;

// src/gateway/fallback-answer.ts
var DROPPED_BLOCKS = new Set(["redacted_thinking"]);

// src/gateway/safety-checks.ts
var countSchema = object({
  cacheRead: number2(),
  cacheWrite: number2(),
  checks: number2(),
  input: number2(),
  output: number2()
});
var daySchema = object({
  anthropic: countSchema,
  checks: number2(),
  fallback: countSchema
});
var stateSchema2 = object({
  days: record(string2(), daySchema),
  version: literal(1)
});
var CHECK_USAGE_MAX_BYTES = 256 * 1024;
var EVENT_MAX_CHARS = 64 * 1024;

// src/gateway/router.ts
var PRICE_REFRESH_MS = 6 * 60 * 60 * 1000;
var HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
var ABOVE_HIGH = new Set(["max", "xhigh"]);
var encoder = new TextEncoder;

// src/portal/lifecycle.ts
function portalStarterArgv(bunPath, bundle, pluginDir) {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), bundle, "--ensure"];
}

// src/portal/session-start.ts
function startPortalAtSessionStart(deps) {
  if (!isAttended(deps.env))
    return "unattended";
  if (!sessionStarts(deps.source))
    return "not-a-start";
  const installed = deps.installed;
  if (installed === null)
    return "no-bundle";
  const bundle = join15(installed.folder, "dist", "portal.js");
  if (!existsSync15(bundle))
    return "no-bundle";
  deps.spawn(portalStarterArgv(deps.bunPath, bundle, installed.folder), deps.runIn);
  return "started";
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
    const input = process.stdin.isTTY ? "" : await Bun.stdin.text();
    const source = sessionSourceOf(input);
    const answer = sessionStart({
      paths,
      env,
      nowMs: Date.now(),
      sessionPid: sessionPid(),
      source,
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
    const installed = findUserInstall(paths.installedPluginsFile);
    startPortalAtSessionStart({
      bunPath: process.execPath,
      env,
      installed: installed === null ? null : { folder: installed.installPath },
      runIn: commandContext(env, paths.home),
      source,
      spawn: (argv, options) => startDetached(process.platform, argv, {
        ...options,
        onError: (message) => console.error(`${PLUGIN} portal: ${message}`)
      })
    });
    await refreshInstructionsAtSessionStart({
      where: instructionsPaths(paths, instructionsFolder(import.meta.dir)),
      version: VERSION,
      log: (line) => console.error(line)
    });
  } catch (error) {
    console.error(`${PLUGIN} update check: ${error instanceof Error ? error.message : error}`);
  }
}
