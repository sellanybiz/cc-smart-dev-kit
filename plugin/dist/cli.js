// @bun
// src/build-info/index.ts
var info = {
  version: "0.1.0",
  repo: "sellanybiz/cc-agentic"
};
var VERSION = info.version;
var MARKETPLACE_SOURCE = info.repo;
var MARKETPLACE = "cc-agentic";
var PLUGIN = "cc";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
var PLUGIN_INSTALL_COMMAND = `claude plugin install ${PLUGIN_ID}`;
var PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;

// src/cli/doctor.ts
import { accessSync, constants, existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
import { join as join4 } from "path";

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

// src/setup/launcher.ts
import { join as join2 } from "path";

// src/setup/write.ts
import {
  chmodSync,
  closeSync,
  existsSync as existsSync2,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync as readFileSync2,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, dirname, join, resolve } from "path";
var BACKUPS_DIR = "backups";
var BACKUP_INFIX = ".bak-cc-agentic-";
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
      return parent === path ? path : join(realTarget(parent), basename(path));
    }
    path = resolve(dirname(path), readlinkSync(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}
function fileMode(file) {
  return existsSync2(file) ? statSync(file).mode & 4095 : null;
}
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.cc-agentic-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const fd = openSync(temp, "wx", mode);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temp, mode);
  } catch (error) {
    if (existsSync2(temp))
      unlinkSync(temp);
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
    if (existsSync2(temp))
      unlinkSync(temp);
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
  return join(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}
function makePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
}
function listBackups(stateDir, file) {
  const dir = backupDir(stateDir, file);
  if (!existsSync2(dir))
    return [];
  const base = basename(realTarget(file));
  return readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup !== null).sort((a, b) => a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1).map((backup) => {
    const path = join(dir, backup.name);
    return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 384 };
  });
}
function copyNotExecutable(file, target) {
  const mode = fileMode(file) ?? 384;
  const safeMode = mode & ~73;
  writeFileSync(target, readFileSync2(file), { flag: "wx", mode: safeMode });
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
  makePrivateDir(join(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  const sameStamp = readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup?.stamp === stamp);
  const counter = sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join(dir, `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`);
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
  const file = join(stateDir, CHANGED_FILE);
  if (!existsSync2(file))
    return {};
  const parsed = JSON.parse(readFileSync2(file, "utf8"));
  const files = parsed?.files;
  if (typeof files !== "object" || files === null || !Object.values(files).every((entry) => isChangedEntry(entry))) {
    throw new Error(`Invalid ${file}: expected { "files": { <path>: { kinds, baseline } } }`);
  }
  return files;
}
function writeChanged(stateDir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
  atomicWrite(join(stateDir, CHANGED_FILE), `${JSON.stringify({ files: sorted }, null, 2)}
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
          throw new ConcurrentChangeError(`${file} kept changing while cc-agentic tried to update it (${attempts} tries). ` + "Close the program that writes it (for example Claude Code), then run again.");
        }
        throw error;
      }
    }
  }
}
function readCurrent(file) {
  return existsSync2(file) ? readFileSync2(file, "utf8") : null;
}
function writeManagedFile(file, content, options) {
  const target = realTarget(file);
  const currentMode = fileMode(target);
  const current = currentMode === null ? null : readFileSync2(target, "utf8");
  const checkUnchanged = (now) => {
    if (options.expectedContent !== undefined && now !== options.expectedContent) {
      throw new ConcurrentChangeError(`${target} changed after cc-agentic read it.`);
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
    if (!isBaseline && existsSync2(backup))
      unlinkSync(backup);
    throw error;
  }
  return { outcome, backup };
}
function removeManagedFile(stateDir, file) {
  const backup = backupFile(stateDir, file);
  unlinkSync(file);
  return backup;
}

// src/setup/launcher.ts
var LAUNCHER_NAME = "cc-agentic";
var FIND_INSTALL_JS = [
  "const f=process.argv[process.argv.length-1];",
  'const j=JSON.parse(require("fs").readFileSync(f,"utf8"));',
  `const e=((j&&j.plugins&&j.plugins["${PLUGIN_ID}"])||[]).find(x=>x&&x.scope==="user"&&typeof x.installPath==="string");`,
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);"
].join("");
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function bakedBunPath(script) {
  const match = /^baked_bun=('(?:[^']|'\\'')*')$/m.exec(script);
  if (!match?.[1])
    return null;
  return match[1].slice(1, -1).replaceAll("'\\''", "'");
}
function launcherScript(bunPath) {
  return `#!/bin/sh
# cc-agentic launcher. Written by "cc-agentic setup"; setup rewrites it, so do not edit it.
# It runs the cc-agentic command from the installed version of the cc plugin.
fail() {
  echo "cc-agentic: $1 Run: claude plugin install ${PLUGIN_ID}" >&2
  exit 1
}
baked_bun=${shellQuote(bunPath)}
if [ -x "$baked_bun" ]; then
  bun="$baked_bun"
elif command -v bun >/dev/null 2>&1; then
  bun=$(command -v bun)
else
  echo "cc-agentic: bun not found (not at $baked_bun, not on PATH). Install bun, then run: cc-agentic setup" >&2
  exit 1
fi
config_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
installed="$config_dir/plugins/installed_plugins.json"
[ -f "$installed" ] || fail "the cc plugin is not installed."
install_path=$("$bun" -e '${FIND_INSTALL_JS}' -- "$installed" 2>/dev/null) || fail "the cc plugin is not installed."
[ -n "$install_path" ] || fail "the cc plugin is not installed."
[ -f "$install_path/dist/cli.js" ] || fail "the cc plugin folder is missing: $install_path."
exec "$bun" "$install_path/dist/cli.js" "$@"
`;
}
function installLauncher(binDir, options) {
  const path = join2(binDir, LAUNCHER_NAME);
  const { outcome } = writeManagedFile(path, launcherScript(options.bunPath), {
    stateDir: options.stateDir,
    kind: "whole-file",
    mode: 493,
    ...options.dryRun !== undefined && { dryRun: options.dryRun }
  });
  return { path, outcome };
}

// src/setup/marketplace-access.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "fs";
var ACCESS_TIMEOUT_MS = 1e4;
function marketplaceSource(knownMarketplacesFile, name, env = process.env) {
  if (!existsSync3(knownMarketplacesFile))
    return { kind: "missing" };
  let known;
  try {
    known = JSON.parse(readFileSync3(knownMarketplacesFile, "utf8"));
  } catch {
    return { kind: "missing" };
  }
  const entry = known?.[name];
  const source = entry?.source;
  if (!source || typeof source.source !== "string")
    return { kind: "missing" };
  const text = (key) => typeof source[key] === "string" ? source[key] : null;
  switch (source.source) {
    case "github": {
      const repo = text("repo");
      if (!repo)
        return { kind: "unknown", type: "github without repo" };
      const ssh = `git@github.com:${repo}.git`;
      const https = `https://github.com/${repo}.git`;
      const preferHttps = Boolean(env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS);
      return { kind: "git", urls: preferHttps ? [https, ssh] : [ssh, https] };
    }
    case "git": {
      const url = text("url");
      return url ? { kind: "git", urls: [url] } : { kind: "unknown", type: "git without url" };
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
  const env = { ...baseEnv, GIT_TERMINAL_PROMPT: "0" };
  if (!hasOwnSshCommand(env))
    env.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  try {
    const result = Bun.spawnSync(["git", "ls-remote", url, "HEAD"], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: ACCESS_TIMEOUT_MS
    });
    if (result.exitCode === 0)
      return { ok: true, detail: "" };
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
  if (!existsSync3(knownMarketplacesFile))
    return null;
  try {
    const known = JSON.parse(readFileSync3(knownMarketplacesFile, "utf8"));
    const location = known?.[name]?.installLocation;
    return typeof location === "string" && location !== "" ? location : null;
  } catch {
    return null;
  }
}

// src/cli/paths.ts
import { homedir } from "os";
import { join as join3 } from "path";
function cliPaths(env = process.env) {
  const home = env.HOME || homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join3(home, ".claude");
  return {
    home,
    claudeConfigDir,
    settingsFile: join3(claudeConfigDir, "settings.json"),
    installedPluginsFile: join3(claudeConfigDir, "plugins", "installed_plugins.json"),
    knownMarketplacesFile: join3(claudeConfigDir, "plugins", "known_marketplaces.json"),
    binDir: join3(home, ".local", "bin"),
    stateDir: join3(claudeConfigDir, "cc-agentic")
  };
}
function tildify(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// src/cli/doctor.ts
var UPDATE_BLOCKING_VARS = [
  "DISABLE_AUTOUPDATER",
  "DISABLE_UPDATES",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
];
var FORCE_PLUGIN_UPDATES_VAR = "FORCE_AUTOUPDATE_PLUGINS";
var MARKETPLACE_UPDATE_COMMAND = `claude plugin marketplace update ${MARKETPLACE}`;
function readSettings(file) {
  if (!existsSync4(file))
    return null;
  try {
    const parsed = JSON.parse(readFileSync4(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function run(argv) {
  try {
    const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 20000 });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    return { ok: result.exitCode === 0, output };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
function checkPlugin(paths) {
  const install = findUserInstall(paths.installedPluginsFile);
  if (!install) {
    return {
      ok: false,
      text: `the ${PLUGIN_ID} plugin is not installed. Run: ${PLUGIN_INSTALL_COMMAND}`
    };
  }
  const where = tildify(install.installPath, paths.home);
  if (!existsSync4(install.installPath)) {
    return {
      ok: false,
      text: `the plugin folder is missing: ${where}. Run: ${PLUGIN_INSTALL_COMMAND}`
    };
  }
  return {
    ok: true,
    text: `${PLUGIN_ID} ${install.version ?? "(no version)"} is installed at ${where}`
  };
}
function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function checkLauncher(paths) {
  const launcher = join4(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync4(launcher))
    return { ok: false, text: `no launcher at ${where}. Run: cc-agentic setup` };
  if (!isExecutable(launcher)) {
    return { ok: false, text: `the launcher ${where} is not executable. Run: cc-agentic setup` };
  }
  const script = readFileSync4(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return { ok: false, text: `the launcher ${where} is out of date. Run: cc-agentic setup` };
  }
  if (!isExecutable(bun)) {
    return {
      ok: false,
      text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: cc-agentic setup`
    };
  }
  const result = run([launcher, "version"]);
  if (!result.ok)
    return { ok: false, text: `the launcher ${where} does not run: ${result.output}` };
  return { ok: true, text: `the launcher ${where} runs ${result.output}` };
}
async function checkMarketplaceAccess(paths, env) {
  const source = marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE, env);
  switch (source.kind) {
    case "missing":
      return {
        ok: false,
        text: `the ${MARKETPLACE} marketplace is not added. Run: ${MARKETPLACE_ADD_COMMAND}`
      };
    case "unknown":
      return { ok: false, text: `cannot check the marketplace source (${source.type})` };
    case "local":
      return existsSync4(source.path) ? { ok: true, text: `the marketplace folder ${tildify(source.path, paths.home)} exists` } : { ok: false, text: `the marketplace folder is missing: ${source.path}` };
    case "http": {
      const url = redactUrl(source.url);
      const result = await canReadHttp(source.url);
      return result.ok ? { ok: true, text: `can read the marketplace at ${url}` } : { ok: false, text: `cannot read the marketplace at ${url}: ${result.detail}` };
    }
    case "git": {
      const failures = [];
      for (const url of source.urls) {
        const result = canReadGitRemote(url, env);
        if (result.ok)
          return { ok: true, text: `can read the marketplace at ${redactUrl(url)}` };
        failures.push(`${redactUrl(url)}: ${result.detail}`);
      }
      return {
        ok: false,
        text: `cannot read the marketplace (${failures.join("; ")}). ` + "Check your git access: an SSH key, or a git credential helper."
      };
    }
  }
}
function marketplaceVersion(manifest) {
  try {
    const version = JSON.parse(readFileSync4(manifest, "utf8"))?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}
function checkInstalledVersion(paths) {
  const install = findUserInstall(paths.installedPluginsFile);
  if (!install)
    return null;
  if (marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE).kind === "missing")
    return null;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  if (location === null) {
    return {
      ok: false,
      text: `the ${MARKETPLACE} marketplace has no local copy. Run: ${MARKETPLACE_UPDATE_COMMAND}`
    };
  }
  const manifest = join4(location, "plugin", ".claude-plugin", "plugin.json");
  const latest = marketplaceVersion(manifest);
  if (latest === null) {
    return {
      ok: false,
      text: `cannot read the version in ${tildify(manifest, paths.home)}. Run: ${MARKETPLACE_UPDATE_COMMAND}`
    };
  }
  const installed = install.version;
  let order;
  try {
    order = installed === null ? -1 : Bun.semver.order(installed, latest);
  } catch {
    return {
      ok: false,
      text: `cannot compare the installed version ${installed} with the marketplace's ${latest}`
    };
  }
  if (order < 0) {
    return {
      ok: false,
      text: `installed ${installed ?? "(no version)"}, marketplace has ${latest}. Run: ${PLUGIN_UPDATE_COMMAND}`
    };
  }
  return { ok: true, text: `the installed version ${installed} is not behind the marketplace` };
}
function checkAutoUpdate(settings, paths) {
  const marketplaces = settings?.extraKnownMarketplaces;
  return marketplaces?.[MARKETPLACE]?.autoUpdate === true ? { ok: true, text: "plugin auto-update is on" } : {
    ok: false,
    text: `plugin auto-update is off in ${tildify(paths.settingsFile, paths.home)}. Run: cc-agentic setup`
  };
}
function isSet(value) {
  if (typeof value !== "string")
    return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
function checkUpdatesNotOff(settings, env, paths) {
  const settingsEnv = settings?.env ?? {};
  const where = (name) => [
    isSet(env[name]) ? "your environment" : null,
    isSet(settingsEnv[name]) ? `the env of ${tildify(paths.settingsFile, paths.home)}` : null
  ].filter((place) => place !== null);
  if (where(FORCE_PLUGIN_UPDATES_VAR).length > 0) {
    return { ok: true, text: `plugin updates are on (${FORCE_PLUGIN_UPDATES_VAR} is set)` };
  }
  const blocking = UPDATE_BLOCKING_VARS.filter((name) => where(name).length > 0);
  if (blocking.length === 0)
    return { ok: true, text: "plugin updates are not switched off" };
  const named = blocking.map((name) => `${name} (in ${where(name).join(" and ")})`).join(", ");
  return {
    ok: false,
    text: `plugin updates are switched off: ${named} ${blocking.length === 1 ? "is" : "are"} set. ` + `Set ${FORCE_PLUGIN_UPDATES_VAR}=1 as well, or remove ${blocking.join(" and ")}.`
  };
}
function checkNameClash(settings) {
  const enabled = settings?.enabledPlugins ?? {};
  const clashes = Object.entries(enabled).filter(([id, on]) => on === true && id.startsWith(`${PLUGIN}@`) && id !== PLUGIN_ID).map(([id]) => id);
  return clashes.length === 0 ? { ok: true, text: `no other enabled plugin is named ${PLUGIN}` } : {
    ok: false,
    text: `another plugin named ${PLUGIN} is enabled: ${clashes.join(", ")}. Disable it.`
  };
}
async function runDoctor(paths, env = process.env) {
  const settings = readSettings(paths.settingsFile);
  const checks = [
    checkPlugin(paths),
    checkInstalledVersion(paths),
    checkLauncher(paths),
    await checkMarketplaceAccess(paths, env),
    checkAutoUpdate(settings, paths),
    checkUpdatesNotOff(settings, env, paths),
    checkNameClash(settings)
  ].filter((check) => check !== null);
  for (const check of checks)
    console.log(`${check.ok ? "\u2713" : "\u2717"} ${check.text}`);
  return checks.every((check) => check.ok) ? 0 : 1;
}

// src/setup/lock.ts
import {
  closeSync as closeSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readFileSync as readFileSync5,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join5 } from "path";
var FALLBACK_STALE_MS = 10 * 60 * 1000;
var LOCK_FILE = "lock";
var TAKEOVER_SUFFIX = ".takeover";

class LockBusyError extends Error {
  name = "LockBusyError";
}
function procStartTime(pid) {
  try {
    const stat = readFileSync5(`/proc/${pid}/stat`, "utf8");
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
    const stat = statSync2(file);
    const info = parseLock(readFileSync5(file, "utf8"));
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
    fd = openSync2(file, "wx", 384);
  } catch (error) {
    if (error.code === "EEXIST")
      return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync2(fd);
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
        unlinkSync2(claim);
    }
    return false;
  }
  try {
    const now = readHeld(file);
    if (now && sameHeld(now, judged))
      unlinkSync2(file);
    return true;
  } finally {
    if (readHeld(claim)?.info?.token === me.token)
      unlinkSync2(claim);
  }
}
async function withLock(stateDir, fn, options = {}) {
  mkdirSync2(stateDir, { recursive: true });
  const file = join5(stateDir, LOCK_FILE);
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
      throw new LockBusyError(`cc-agentic is busy: ${who} holds ${file}. Wait for it to finish, then try again.`);
    }
    await Bun.sleep(100);
  }
  try {
    return await fn();
  } finally {
    if (readHeld(file)?.info?.token === mine.token)
      unlinkSync2(file);
  }
}

// src/setup/restore.ts
import { existsSync as existsSync7, readFileSync as readFileSync8 } from "fs";

// src/setup/managed-json.ts
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "fs";
import { join as join6 } from "path";
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
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  return { data: parsed, indent, text };
}
function readOwned(stateDir) {
  const file = join6(stateDir, OWNED_FILE);
  if (!existsSync5(file))
    return {};
  const parsed = JSON.parse(readFileSync6(file, "utf8"));
  if (!isObject(parsed))
    throw new Error(`Invalid ${file}: expected an object`);
  return parsed;
}
function writeOwned(stateDir, owned) {
  atomicWrite(join6(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}
`, 384);
}
function ownedKeys(stateDir, file) {
  return readOwned(stateDir)[file] ?? [];
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
function applyManagedJson(options) {
  const file = realTarget(options.file);
  const snapshot = readOwned(options.stateDir);
  return retryOnConcurrentChange(file, () => applyOnce(file, options, snapshot));
}
function applyOnce(file, options, owned) {
  const { data, indent, text } = readJsonObject(file);
  const ownedHere = (owned[file] ?? []).map((path) => [...path]);
  const isOwned = (path) => ownedHere.some((entry) => samePath(entry, path));
  const changes = [];
  const skipped = [];
  const claimed = [];
  const released = [];
  for (const [path, value] of options.set ?? []) {
    if (path.length === 0)
      throw new Error("applyManagedJson: an empty key path");
    const current = getKey(data, path);
    if (current.found && Bun.deepEquals(current.value, value, true)) {
      if (!isOwned(path))
        skipped.push({ path, reason: "already set by someone else; left alone" });
      continue;
    }
    if (current.found && !isOwned(path)) {
      throw new ForeignKeyError(`${file}: ${formatKeyPath(path)} is ${JSON.stringify(current.value)}, set by someone else. ` + "cc-agentic does not overwrite it. Remove it by hand if cc-agentic should manage it.");
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
    if (!isOwned(path))
      claimed.push([...path]);
  }
  for (const path of options.remove ?? []) {
    if (!isOwned(path)) {
      skipped.push({ path, reason: "not owned by cc-agentic; left alone" });
      continue;
    }
    released.push([...path]);
    const current = getKey(data, path);
    if (!current.found)
      continue;
    deleteKey(data, path);
    changes.push({ path, before: current.value, after: undefined });
  }
  const ownedChanged = claimed.length > 0 || released.length > 0;
  if (options.dryRun || changes.length === 0 && !ownedChanged) {
    return { file, changes, skipped, written: false, backup: null };
  }
  const finalOwned = [...ownedHere, ...claimed].filter((entry) => !released.some((path) => samePath(path, entry)));
  if (claimed.length > 0)
    writeOwned(options.stateDir, { ...owned, [file]: [...ownedHere, ...claimed] });
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
        expectedContent: text
      });
    } catch (error) {
      if (claimed.length > 0)
        writeOwned(options.stateDir, owned);
      throw error;
    }
    written = result.outcome !== "unchanged";
    backup = result.backup;
  }
  if (released.length > 0 || claimed.length > 0) {
    const next = { ...owned, [file]: finalOwned };
    if (finalOwned.length === 0)
      delete next[file];
    writeOwned(options.stateDir, next);
  }
  return { file, changes, skipped, written, backup };
}

// src/setup/managed-markdown.ts
import { existsSync as existsSync6, readFileSync as readFileSync7 } from "fs";
var BLOCK_BEGIN = "<!-- cc-agentic:begin -->";
var BLOCK_END = "<!-- cc-agentic:end -->";
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
    throw new Error(`${file} has a broken cc-agentic block (${begins} begin and ${ends} end markers). ` + "Fix it by hand: keep one begin marker and one end marker after it.");
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
    const text = existsSync6(file) ? readFileSync7(file, "utf8") : null;
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
function createdByUs(entry) {
  return entry.baseline?.endsWith(ABSENT_SUFFIX) ?? false;
}
function restoreWholeFile(file, entry, stateDir) {
  const baseline = listBackups(stateDir, file).find((backup) => backup.path === entry.baseline);
  if (!baseline)
    return { file, action: "no-backup", details: [] };
  if (baseline.absent) {
    if (!existsSync7(file))
      return { file, action: "unchanged", details: [] };
    return { file, action: "removed", details: [], savedAs: removeManagedFile(stateDir, file) };
  }
  const result = writeManagedFile(file, readFileSync8(baseline.path, "utf8"), {
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
  if (!existsSync7(file))
    return false;
  const text = readFileSync8(file, "utf8").trim();
  return text === "" || text === "{}";
}
function restorePartly(file, entry, stateDir) {
  const details = [];
  let savedAs = null;
  if (entry.kinds.includes("json-keys")) {
    const keys = ownedKeys(stateDir, file);
    if (keys.length > 0) {
      const result = applyManagedJson({ file, stateDir, remove: keys });
      details.push(...result.changes.map((change) => formatKeyPath(change.path)));
      savedAs ??= result.backup;
    }
  }
  if (entry.kinds.includes("markdown-block")) {
    const result = removeManagedMarkdown({ file, stateDir });
    if (result.outcome !== "unchanged")
      details.push("the cc-agentic block");
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
function restore(stateDir) {
  return Object.entries(readChanged(stateDir)).map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file") ? restoreWholeFile(file, entry, stateDir) : restorePartly(file, entry, stateDir);
    if (result.action !== "no-backup")
      forgetChange(stateDir, file);
    return result;
  });
}

// src/cli/restore.ts
function describe(result, short) {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before cc-agentic`;
    case "removed":
      return `- ${file}: removed (cc-agentic had created it)`;
    case "cleaned":
      return `~ ${file}: removed ${result.details.join(", ")}; everything else kept`;
    case "unchanged":
      return `  ${file}: nothing of cc-agentic left in it`;
    case "no-backup":
      return `! ${file}: the backup from before cc-agentic is missing; left alone`;
  }
}
async function runRestore(paths) {
  const short = (path) => tildify(path, paths.home);
  return withLock(paths.stateDir, () => {
    const results = restore(paths.stateDir);
    if (results.length === 0) {
      console.log("Nothing to restore: cc-agentic has nothing in any file.");
      return 0;
    }
    for (const result of results) {
      console.log(describe(result, short));
      if (result.savedAs) {
        console.log(`  (its state before this restore: ${short(result.savedAs)})`);
      }
    }
    return results.some((result) => result.action === "no-backup") ? 1 : 0;
  }, { waitMs: 1e4 });
}

// src/cli/setup.ts
import { existsSync as existsSync8, readFileSync as readFileSync9 } from "fs";
import { delimiter } from "path";
var AUTO_UPDATE_KEY = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];
function show(value) {
  return value === undefined ? "(none)" : JSON.stringify(value);
}
function marketplaceKnown(settingsFile) {
  if (!existsSync8(settingsFile))
    return false;
  try {
    const settings = JSON.parse(readFileSync9(settingsFile, "utf8"));
    const entry = settings.extraKnownMarketplaces?.[MARKETPLACE];
    return typeof entry === "object" && entry !== null;
  } catch {
    return false;
  }
}
function applySetup(paths, dryRun) {
  const short = (path) => tildify(path, paths.home);
  const lines = [];
  const launcher = installLauncher(paths.binDir, {
    stateDir: paths.stateDir,
    bunPath: process.execPath,
    dryRun
  });
  if (launcher.outcome !== "unchanged") {
    const mark = launcher.outcome === "created" ? "+" : "~";
    lines.push(`${mark} ${short(launcher.path)}: launcher ${launcher.outcome}`);
  }
  const settings = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: [[AUTO_UPDATE_KEY, true]],
    dryRun
  });
  for (const change of settings.changes) {
    lines.push(`~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`);
  }
  for (const skip of settings.skipped) {
    lines.push(`  ${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`);
  }
  return lines;
}
async function runSetup(paths, options) {
  const short = (path) => tildify(path, paths.home);
  if (!marketplaceKnown(paths.settingsFile)) {
    console.error(`${short(paths.settingsFile)} does not list the ${MARKETPLACE} marketplace yet.
` + `Run first: ${MARKETPLACE_ADD_COMMAND}
` + `Then:      ${PLUGIN_INSTALL_COMMAND}`);
    return 1;
  }
  const planned = applySetup(paths, true);
  if (options.dryRun) {
    console.log(planned.length > 0 ? planned.join(`
`) : "Nothing to change.");
    console.log("Dry run: nothing was written.");
  } else {
    const lines = await withLock(paths.stateDir, () => applySetup(paths, false), {
      waitMs: 1e4
    });
    if (lines.length === 0) {
      console.log("Nothing to change. Setup is up to date.");
    } else {
      console.log(lines.join(`
`));
      console.log(`Done. Each changed file has a backup in ${short(paths.stateDir)}/backups/.`);
    }
  }
  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  if (!pathDirs.includes(paths.binDir)) {
    console.log(`Note: ${short(paths.binDir)} is not on your PATH. Add it, so the cc-agentic command works.`);
  }
  return 0;
}

// src/entries/cli.ts
var HELP = `cc-agentic ${VERSION} - set up and check the cc plugin for Claude Code

Usage: cc-agentic <command> [options]

Commands:
  setup [--dry-run]  Install the launcher in ~/.local/bin and turn on plugin auto-update.
                     --dry-run prints what would change and writes nothing.
  doctor             Check the install. Exit code 1 when a check fails.
  restore            Remove what cc-agentic added, and keep everything else: its settings
                     keys, its Markdown blocks, and the files it created (the launcher).
                     Each changed file gets a backup first.
  version            Print the version.
  --help             Print this help.

Paths follow HOME and CLAUDE_CONFIG_DIR.`;
async function main(argv) {
  const [command, ...rest] = argv;
  const paths = cliPaths();
  switch (command) {
    case "setup": {
      const unknown = rest.filter((arg) => arg !== "--dry-run");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}

${HELP}`);
        return 2;
      }
      return runSetup(paths, { dryRun: rest.includes("--dry-run") });
    }
    case "doctor":
      return runDoctor(paths);
    case "restore":
      return runRestore(paths);
    case "version":
    case "--version":
      console.log(`cc-agentic ${VERSION}`);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command: ${command}

${HELP}`);
      return 2;
  }
}
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`cc-agentic: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
