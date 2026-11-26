// @bun
// src/hooks/run.ts
import { appendFileSync as appendFileSync2 } from "fs";

// src/cli/paths.ts
import { join as join2, sep } from "path";

// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "cc-smart-dev-kit";

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
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError(`cliPaths takes an environment object (like process.env), not ${env === null ? "null" : Array.isArray(env) ? "an array" : typeof env}`);
  }
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
    gitHooksFolder: join2(router.home, ".local", "share", "cc-smart-dev-kit", "git-hooks"),
    portalProjectsFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal-projects.json"),
    portalLogFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal.log"),
    portalHeldFile: join2(claudeConfigDir, "cc-smart-dev-kit", "portal-held.json"),
    omnirouteStateFile: join2(claudeConfigDir, "cc-smart-dev-kit", "omniroute.json"),
    routerUnitFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.service"),
    claudeMemSettingsFile: join2(claudeMemDataDir(env, router.home), "settings.json"),
    routerSocketFile: join2(router.home, ".config", "systemd", "user", "cc-smart-dev-kit-router.socket"),
    workflowConfigFile: join2(router.home, ".config", "cc-smart-dev-kit", "workflow.json"),
    machinesFile: join2(router.home, ".config", "cc-smart-dev-kit", "machines.json"),
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

// src/error-message.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

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
function maskedTail(secret) {
  return secret.length >= 12 ? `****${secret.slice(-4)}` : "****";
}
var KNOWN_SECRET_MIN = 4;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function knownSecretForms(known) {
  const forms = new Map;
  for (const secret of known) {
    if (secret.length < KNOWN_SECRET_MIN)
      continue;
    const once = JSON.stringify(secret).slice(1, -1);
    const twice = JSON.stringify(once).slice(1, -1);
    for (const form of [secret, once, twice])
      if (!forms.has(form))
        forms.set(form, secret);
  }
  return [...forms].map(([form, secret]) => ({ form, secret })).sort((a, b) => b.form.length - a.form.length);
}
function maskSecrets(text, known = []) {
  let out = text;
  for (const { form, secret } of knownSecretForms(known)) {
    out = out.split(form).join(maskedTail(secret));
  }
  return out.replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g, "****@****").replace(/(\\?")([^"\\]{0,64}(?:key|token|secret|password|authorization)[^"\\]{0,64})\1(\s{0,4}):(\s{0,4})\1[^"\\]{0,512}\1/gi, "$1$2$1$3:$4$1****$1").replace(/\b(Bearer|Basic)\s{1,4}[A-Za-z0-9._~+/=-]{1,512}/gi, "$1 ****").replace(/\bsk-[A-Za-z0-9_-]{1,512}/g, (key) => `sk-${maskedTail(key)}`).replace(/(key|token|secret|password)(\W{0,3}[:=]\W{0,3})(?!\*{4}|sk-\*{4})([^\s"'`\\,;&<>(){}[\]]{4,256})/gi, (_match, name, separator, value) => `${name}${separator}${maskedTail(value)}`).replace(/[A-Za-z0-9_-]{32,512}/g, (run) => run.includes("__") || UUID.test(run) ? run : maskedTail(run));
}
function maskedLine(text, known, max, options = {}) {
  return oneLine(maskSecrets(text, known), max, options);
}

// src/project/locate.ts
import { existsSync as existsSync3, realpathSync as realpathSync3, statSync as statSync3 } from "fs";
import { join as join5 } from "path";

// src/hooks/git.ts
import { readFileSync as readFileSync2, realpathSync as realpathSync2 } from "fs";
import { basename as basename2, dirname as dirname3, join as join4, resolve as resolve3 } from "path";

// src/path-compare.ts
import { statSync } from "fs";
import { dirname, resolve } from "path";
var IGNORE_CASE = process.platform === "win32";
function isInside(path, folder, ignoreCase = IGNORE_CASE) {
  const child = pathForm(path, ignoreCase);
  const parent = pathForm(folder, ignoreCase);
  return child === parent || child.startsWith(`${parent}/`);
}
function pathForm(path, ignoreCase = IGNORE_CASE) {
  const forward = resolve(path.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return ignoreCase ? forward.toLowerCase() : forward;
}
function folderId(path) {
  try {
    const stat = statSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}
function isInsideOnDisk(path, folder, ignoreCase = IGNORE_CASE) {
  if (isInside(path, folder, ignoreCase))
    return true;
  const target = folderId(folder);
  if (target === null)
    return false;
  let at = resolve(path);
  for (;; ) {
    if (folderId(at) === target)
      return true;
    const up = dirname(at);
    if (up === at)
      return false;
    at = up;
  }
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

// src/setup/write.ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync as statSync2,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, dirname as dirname2, join as join3, resolve as resolve2 } from "path";
function writeTemp(file, content, mode) {
  const dir = dirname2(file);
  mkdirSync(dir, { recursive: true });
  const temp = join3(dir, `.${basename(file)}.cc-smart-dev-kit-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const fd = openSync(temp, "wx", mode);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    setFileMode(temp, mode);
  } catch (error) {
    if (existsSync(temp))
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
    if (existsSync(temp))
      unlinkSync(temp);
    throw error;
  }
}

// src/workflow/reviews.ts
var START_KEPT_MS = 24 * 60 * 60 * 1000;
// src/hooks/git.ts
function realPath(path) {
  const rest = [];
  let at = resolve3(path);
  for (;; ) {
    try {
      return join4(realpathSync2(at), ...rest);
    } catch {
      const parent = dirname3(at);
      if (parent === at)
        return resolve3(path);
      rest.unshift(basename2(at));
      at = parent;
    }
  }
}
function parseWorktreeList(porcelain) {
  const worktrees = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line !== "");
    const value = (key) => lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1);
    const flag = (key) => lines.some((line) => line === key || line.startsWith(`${key} `));
    const path = value("worktree");
    if (path === undefined)
      continue;
    const lockReason = value("locked")?.trim();
    worktrees.push({
      path,
      head: value("HEAD") ?? "",
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      locked: flag("locked"),
      ...lockReason === undefined || lockReason === "" ? {} : { lockReason },
      prunable: flag("prunable"),
      ...flag("bare") ? { bare: true } : {}
    });
  }
  return worktrees;
}

// src/project/config-facts.ts
import { existsSync as existsSync2 } from "fs";

// src/setup/user-json.ts
import { readFileSync as readFileSync3 } from "fs";
var BOM = "\uFEFF";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}
function readUserJson(file) {
  return parseUserJson(readFileSync3(file, "utf8"));
}

// src/project/config-facts.ts
var CONFIG_PATH = ".claude/cc-smart-dev-kit.json";
function readOwnHooks(file) {
  if (!existsSync2(file))
    return null;
  try {
    const raw = readUserJson(file);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return [];
    const listed = raw.ownHooks;
    return Array.isArray(listed) ? listed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

// src/project/locate.ts
var MIN_GIT_VERSION = "2.31.0";
var RESOLVE_GIT_TIMEOUT_MS = 5000;
var GIT_NOT_FOUND = "git was not found, so this project's own values cannot be read. Install git, then try again.";
function gitNotFound(error) {
  const why = messageOf(error);
  return /not found in \$PATH|ENOENT/.test(why) ? new Error(GIT_NOT_FOUND) : error;
}
var GIT_TIMED_OUT = "git did not answer in time";
var GIT_TIMED_OUT_FIX = "run `git status` in this folder; if that hangs too, fix git first, then run this again";

class GitTimedOutError extends Error {
  constructor() {
    super(`${GIT_TIMED_OUT}: ${GIT_TIMED_OUT_FIX}`);
    this.name = "GitTimedOutError";
  }
}
var NO_TIME_LEFT = {
  ok: false,
  stdout: "",
  stderr: "no time left in the hook's budget",
  timedOut: true
};
function callLimit(timeoutMs, timeFor) {
  return timeFor === undefined ? timeoutMs : timeFor(timeoutMs);
}
function gitIn(cwd, env, timeoutMs = RESOLVE_GIT_TIMEOUT_MS, timeFor) {
  return (args) => {
    const limit = callLimit(timeoutMs, timeFor);
    if (limit <= 0)
      return NO_TIME_LEFT;
    try {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: limit,
        windowsHide: true
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        timedOut: result.exitedDueToTimeout === true
      };
    } catch (error) {
      throw gitNotFound(error);
    }
  };
}
function requireGitVersionText(out) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  if (!match)
    return;
  const version = `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
  if (Bun.semver.order(version, MIN_GIT_VERSION) < 0) {
    throw new Error(`git 2.31 or newer is needed; you have git ${version}. Update git.`);
  }
}
function requireGitVersion(git) {
  requireGitVersionText(git(["--version"]).stdout);
}
function mainCheckoutFrom(list, cwd) {
  if (list.timedOut === true)
    throw new GitTimedOutError;
  if (!list.ok)
    throw new Error(`git worktree list failed in ${cwd}: ${list.stderr.trim()}`);
  const [main] = parseWorktreeList(list.stdout);
  if (main === undefined || main.bare === true)
    return null;
  if (!existsSync3(main.path) || main.prunable) {
    throw new Error(`The main checkout of the repo at ${cwd} is missing: ${main.path} was moved or deleted. ` + 'If you moved it, run "git worktree repair" in its new folder.');
  }
  return realpathSync3(main.path);
}
function findMainCheckout(git, cwd) {
  return mainCheckoutFrom(git(["worktree", "list", "--porcelain"]), cwd);
}
function revParseParts(revParse) {
  const [top, gitDir, common] = revParse.stdout.trim().split(`
`);
  if (!revParse.ok || top?.startsWith("--"))
    return "not-understood";
  if (!top || !gitDir || !common)
    return "outside";
  return { common, gitDir, top };
}
function checkoutRoots(parts) {
  const root = realpathSync3(parts.top);
  const commonDir = realpathSync3(parts.common);
  return { commonDir, isWorktree: realpathSync3(parts.gitDir) !== commonDir, root };
}
function locateCheckout(cwd, options = {}) {
  if (!existsSync3(cwd) || !statSync3(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const git = gitIn(cwd, gitEnv(options.env ?? process.env), undefined, options.timeFor);
  const revParse = git([
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir"
  ]);
  if (revParse.timedOut === true)
    throw new GitTimedOutError;
  const parts = revParseParts(revParse);
  if (parts === "not-understood") {
    requireGitVersion(git);
    if (revParse.ok) {
      throw new Error("git did not understand rev-parse --path-format: git 2.31 or newer is needed.");
    }
    return null;
  }
  if (parts === "outside")
    return null;
  const roots = checkoutRoots(parts);
  return {
    ...roots,
    mainCheckout: roots.isWorktree ? findMainCheckout(git, cwd) : roots.root
  };
}
function projectFileFor(checkout) {
  const { root, mainCheckout } = checkout;
  const own = join5(root, CONFIG_PATH);
  if (existsSync3(own))
    return own;
  if (mainCheckout === null || mainCheckout === root)
    return null;
  const main = join5(mainCheckout, CONFIG_PATH);
  return existsSync3(main) ? main : null;
}
function ownHooksOf(checkout) {
  const file = projectFileFor(checkout);
  return file === null ? [] : readOwnHooks(file) ?? [];
}

// src/hooks/ask-log.ts
import { join as join6 } from "path";

// src/hooks/jsonl-log.ts
import { appendFileSync, mkdirSync as mkdirSync2, readFileSync as readFileSync4, statSync as statSync4 } from "fs";
import { dirname as dirname4 } from "path";

// src/update/state.ts
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;

// src/hooks/jsonl-log.ts
function cutBack(file) {
  let size;
  try {
    size = statSync4(file).size;
  } catch {
    return;
  }
  if (size <= LOG_MAX_BYTES)
    return;
  const text = readFileSync4(file, "utf8");
  const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
  atomicWrite(file, keep.slice(keep.indexOf(`
`) + 1), 384);
}
function appendJsonLine(file, value) {
  mkdirSync2(dirname4(file), { recursive: true, mode: 448 });
  cutBack(file);
  appendFileSync(file, `${JSON.stringify(value)}
`, { mode: 384 });
}

// src/hooks/ask-log.ts
var ASK_LOG_FILE = "guard-asks.jsonl";
var ASK_REASON_MAX = 200;
function askLogFile(stateDir) {
  return join6(stateDir, ASK_LOG_FILE);
}
function appendAsk(file, ask) {
  appendJsonLine(file, ask);
}

// src/hooks/checked-config.ts
import { createHash } from "crypto";
import {
  accessSync,
  constants,
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync5,
  statSync as statSync5,
  unlinkSync as unlinkSync2
} from "fs";
import { dirname as dirname5, join as join7 } from "path";

// src/build-info/index.ts
var info = {
  version: "6.7.2",
  repo: "sellanybiz/cc-smart-dev-kit",
  dependencies: [
    {
      name: "claude-mem",
      marketplace: "thedotmack",
      version: ">=15.0.0"
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

// src/hooks/checked-config.ts
var PARSER_FINGERPRINT = "017ad9b973a1e5beca067c00474a5584289769924b661251e57e92c9f2769237";
var CHECKED_DIR = "checked";
var CHECKED_CACHE_LIMIT = 64;
var CHECKED_FILE_MAX_BYTES = 256 * 1024;
var CHECKED_TEMP_MAX_AGE_MS = 60000;
var ENTRY_FORMAT = 1;
var TEMP_NAME = /^\..+\.cc-smart-dev-kit-tmp-/;
var PARSE = {
  project: (sibling, text, where) => sibling.checkProjectText(text, where),
  workflow: (sibling, text, where) => sibling.checkWorkflowText(text, where)
};
function reinstallMessage(why) {
  return `The plugin's config checker is not usable (${why}): run \`${PLUGIN_INSTALL_COMMAND}\` to reinstall the plugin, then try again.`;
}
async function loadSibling() {
  const built = join7(import.meta.dir, "config-check.js");
  const entry = existsSync4(built) ? built : join7(import.meta.dir, "..", "entries", "config-check.ts");
  const loaded = await import(entry);
  for (const name of ["checkProjectText", "checkWorkflowText"]) {
    if (typeof loaded[name] !== "function") {
      throw new Error(`${entry} exports no ${name}`);
    }
  }
  return loaded;
}
function checkedKey(fingerprint, kind, bytes) {
  return createHash("sha256").update(`${fingerprint}
${kind}
`).update(bytes).digest("hex");
}
function readEntry(file, key, kind) {
  try {
    const entry = JSON.parse(readFileSync5(file, "utf8"));
    if (entry?.format !== ENTRY_FORMAT || entry.key !== key || entry.kind !== kind)
      return null;
    const { value } = entry;
    const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
    return isObject ? value : null;
  } catch {
    return null;
  }
}
function prune(dir, nowMs) {
  const entries = [];
  for (const name of readdirSync2(dir)) {
    const path = join7(dir, name);
    try {
      if (TEMP_NAME.test(name)) {
        if (nowMs - statSync5(path).mtimeMs > CHECKED_TEMP_MAX_AGE_MS)
          unlinkSync2(path);
      } else if (name.endsWith(".json")) {
        entries.push({ path, mtimeMs: statSync5(path).mtimeMs });
      }
    } catch {}
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const old of entries.slice(0, Math.max(0, entries.length - (CHECKED_CACHE_LIMIT - 1)))) {
    try {
      unlinkSync2(old.path);
    } catch {}
  }
}
function writeEntry(dir, key, kind, value) {
  try {
    if (!existsSync4(dir)) {
      mkdirSync3(dir, { recursive: true, mode: 448 });
      setFileMode(dir, 448);
    }
    prune(dir, Date.now());
    const entry = { format: ENTRY_FORMAT, key, kind, value };
    atomicWrite(join7(dir, `${key}.json`), JSON.stringify(entry), 384);
  } catch {}
}
async function loadCheckedFile(file, kind, { paths }) {
  if (!existsSync4(file))
    return { ok: true, value: null, fact: "none" };
  const bytes = readFileSync5(file);
  const cacheable = bytes.length <= CHECKED_FILE_MAX_BYTES;
  const dir = join7(paths.stateDir, CHECKED_DIR);
  const key = checkedKey(PARSER_FINGERPRINT, kind, bytes);
  if (cacheable) {
    const hit = readEntry(join7(dir, `${key}.json`), key, kind);
    if (hit !== null)
      return { ok: true, value: hit, fact: "cached" };
  }
  let sibling;
  try {
    sibling = await loadSibling();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, message: reinstallMessage(why), fact: "broken" };
  }
  const answer = PARSE[kind](sibling, bytes.toString("utf8"), file);
  if (answer.fingerprint !== PARSER_FINGERPRINT) {
    const why = "it was built from another version of the plugin than this hook";
    return { ok: false, message: reinstallMessage(why), fact: "broken" };
  }
  if (!answer.ok)
    return { ok: false, message: answer.message, fact: "broken" };
  if (cacheable)
    writeEntry(dir, key, kind, answer.value);
  return { ok: true, value: answer.value, fact: "checked" };
}
async function loadCheckedProject(checkout, options) {
  const file = projectFileFor(checkout);
  if (file === null) {
    return { ok: true, project: { ...checkout, config: null, configFile: null }, fact: "none" };
  }
  const checked = await loadCheckedFile(file, "project", options);
  if (!checked.ok)
    return checked;
  return {
    ok: true,
    project: { ...checkout, config: checked.value, configFile: file },
    fact: checked.fact
  };
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
function stringField(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function askReason(result) {
  if (result.stdout === undefined)
    return null;
  try {
    const value = JSON.parse(result.stdout);
    const output = value.hookSpecificOutput;
    if (output?.permissionDecision !== "ask")
      return null;
    return typeof output.permissionDecisionReason === "string" ? output.permissionDecisionReason : "";
  } catch {
    return null;
  }
}

// src/hooks/run.ts
var HOOK_LOG_ENV = "CC_SMART_DEV_KIT_HOOK_LOG";
function crashResult(spec, why, input, event, context) {
  const line = {
    exitCode: spec.crashExitCode ?? 0,
    stderr: `cc-smart-dev-kit ${spec.name}: ${why}`
  };
  if (spec.onCrash === undefined)
    return line;
  try {
    return spec.onCrash(why, input, event, context);
  } catch {
    return line;
  }
}
function recordAsk(spec, input, result, context) {
  const reason = askReason(result);
  if (reason === null)
    return result;
  try {
    appendAsk(askLogFile(context.paths.stateDir), {
      at: context.nowMs,
      hook: spec.name,
      session: stringField(input?.session_id) ?? "",
      tool: stringField(input?.tool_name) ?? "",
      reason: maskedLine(reason, [], ASK_REASON_MAX, { mark: "..." })
    });
  } catch (error) {
    const note = `cc-smart-dev-kit ${spec.name}: the ask could not be recorded (${messageOf(error)})`;
    return { ...result, stderr: result.stderr === undefined ? note : `${result.stderr}
${note}` };
  }
  return result;
}
async function answer(spec, input, context, observed) {
  const { env } = context;
  let event = "";
  try {
    if (input === null) {
      return crashResult(spec, "the hook input is not JSON", null, "", context);
    }
    const named = stringField(input.hook_event_name);
    if (named === null || !spec.events.includes(named))
      return SILENT;
    event = named;
    const cwd = stringField(input.cwd);
    const outside = spec.outsideGit ?? (() => SILENT);
    if (cwd === null)
      return await outside(input, event, "the hook input has no cwd", context);
    let checkout;
    try {
      checkout = locateCheckout(cwd, { env });
    } catch (error) {
      return await outside(input, event, messageOf(error), context);
    }
    if (checkout === null)
      return await outside(input, event, `${cwd} is not in a git checkout`, context);
    if (spec.alwaysOn !== true && ownHooksOf(checkout).includes(spec.name))
      return SILENT;
    const loaded = await loadCheckedProject(checkout, { paths: context.paths });
    observed.config = loaded.fact;
    if (!loaded.ok) {
      return await spec.onConfigProblem(loaded.message, input, event, checkout, context);
    }
    return await spec.run({
      input,
      event,
      cwd,
      project: loaded.project,
      env,
      paths: context.paths,
      nowMs: context.nowMs,
      ...context.start !== undefined && { start: context.start }
    });
  } catch (error) {
    return crashResult(spec, messageOf(error), input, event, context);
  }
}
async function handleHook(spec, text, env, nowMs = Date.now(), start, observed = {}) {
  const context = {
    env,
    paths: cliPaths(env),
    nowMs,
    ...start !== undefined && { start }
  };
  const input = parseHookInput(text);
  const result = await answer(spec, input, context, observed);
  return recordAsk(spec, input, result, context);
}
function logRun(spec, text, result, env, nowMs, observed) {
  const file = env[HOOK_LOG_ENV];
  if (file === undefined || file === "")
    return;
  try {
    const input = parseHookInput(text);
    const facts = input === null ? {} : spec.logFacts?.(input, { env, paths: cliPaths(env), nowMs }) ?? {};
    appendFileSync2(file, `${JSON.stringify({
      hook: spec.name,
      event: stringField(input?.hook_event_name),
      cwd: stringField(input?.cwd),
      exitCode: result.exitCode ?? 0,
      ...observed.config !== undefined && { config: observed.config },
      stdout: (result.stdout ?? "").slice(0, 2000),
      ...Object.keys(facts).length === 0 ? {} : { facts }
    })}
`);
  } catch {}
}
async function runHookEntry(spec) {
  const text = await Bun.stdin.text();
  const nowMs = Date.now();
  const observed = {};
  const result = await handleHook(spec, text, process.env, nowMs, undefined, observed);
  logRun(spec, text, result, process.env, nowMs, observed);
  if (result.stdout !== undefined)
    await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined)
    await Bun.write(Bun.stderr, `${result.stderr}
`);
  process.exit(result.exitCode ?? 0);
}

// src/hooks/verify-gate.ts
import { extname, isAbsolute, resolve as resolve5 } from "path";

// src/shell/program-name.ts
function programName(word) {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
}

// src/shell/kit-invocation.ts
var INERT = new Set([
  "[",
  "[[",
  "awk",
  "cat",
  "chmod",
  "chown",
  "cp",
  "diff",
  "echo",
  "egrep",
  "fgrep",
  "file",
  "git",
  "grep",
  "head",
  "less",
  "ln",
  "ls",
  "man",
  "mkdir",
  "more",
  "mv",
  "printf",
  "readlink",
  "realpath",
  "rg",
  "rm",
  "sed",
  "stat",
  "tail",
  "tee",
  "test",
  "touch",
  "type",
  "wc",
  "which"
]);
var KIT_BUNDLE = /(?:^|[\\/])(?:dist|entries)[\\/](?:cli|portal)\.(?:js|ts)$/;
function isKitWord(word) {
  return programName(word) === COMMAND || KIT_BUNDLE.test(word);
}
function kitArguments(program, args) {
  if (programName(program) === COMMAND)
    return [...args];
  if (INERT.has(program))
    return null;
  const at = args.findIndex(isKitWord);
  return at === -1 ? null : args.slice(at + 1);
}

// src/shell/powershell.ts
var SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g;
function powershellQuoted(value) {
  return `'${value.replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}

// src/shell/quote.ts
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/shell/command.ts
function dialectOfTool(tool) {
  if (tool === "Bash")
    return "bash";
  if (tool === "PowerShell")
    return "powershell";
  return;
}
var MAX_NESTING = 3;
var ESCAPE = { bash: "\\", powershell: "`" };
var SINGLE = { bash: "'", powershell: "'\u2018\u2019\u201A\u201B" };
var DOUBLE = { bash: '"', powershell: '"\u201C\u201D\u201E' };
var oneOf = (chars, char) => char !== "" && chars.includes(char);
var CONTINUATION = {
  bash: /\\[ \t]*\r?\n/y,
  powershell: /`[ \t]*\r?\n/y
};
var SEPARATORS = new Set([`
`, "\r", "&", "(", ")", ";", "|"]);
var HERE_STRING = /@(["'])\r?\n([\s\S]*?)\r?\n\1@/y;
var ARRAY_ASSIGNMENT = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*\+?=$/;
var MAX_INNER = 8;
var isBlank = (char) => char === " " || char === "\t";
function opensBraceSubstitution(text, at) {
  return text.startsWith("${", at) && /^[ \t\n|]$/.test(text.charAt(at + 2));
}
function braceSubstitutionClose(text, from) {
  const read = lex(text.slice(from), {
    blind: false,
    dialect: "bash",
    join: false,
    substitution: true
  });
  return read.open ? -1 : from + read.end;
}
function lex(text, options) {
  const { blind, dialect, join } = options;
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const segments = [];
  const piped = [];
  const expanded = [];
  const groups = [];
  const starts = [];
  let group = options.outer ?? null;
  const enterGroup = (array = false) => {
    group = { depth: (group?.depth ?? 0) + 1, outer: group, ...array ? { array } : {} };
  };
  const leaveGroup = () => {
    if (group !== (options.outer ?? null))
      group = group?.outer ?? null;
  };
  const cases = [];
  const owed = [];
  let open = false;
  let unparsable = false;
  let at = 0;
  let afterPipe = false;
  let matching = null;
  let semicolons = null;
  const push = (piece, from, filledIn = false, inner = group, start = null) => {
    segments.push(piece);
    piped.push(from);
    expanded.push(filledIn);
    groups.push(inner);
    starts.push(start);
  };
  function addInner(inner, body, filledIn = false) {
    const depth = (options.depth ?? 0) + 1;
    if (depth > MAX_INNER) {
      open = true;
      return;
    }
    const outer = { depth: (group?.depth ?? 0) + 1, outer: group };
    const read = lex(inner, { blind, dialect, join, body: body && !blind, depth, outer });
    if (read.open)
      open = true;
    if (read.unparsable)
      unparsable = true;
    for (let i = 0;i < read.segments.length; i++) {
      push(read.segments[i] ?? "", read.piped[i] ?? null, filledIn || read.expanded[i] === true, read.groups[i] ?? outer);
    }
  }
  function skipBodies() {
    for (const { quoted, script, stripTabs, word } of owed.splice(0)) {
      let line = at;
      let closedAt = -1;
      let bodyEnd = text.length;
      while (line < text.length) {
        const end = text.indexOf(`
`, line);
        const stop = end === -1 ? text.length : end;
        const content = text.slice(line, stop).replace(/\r$/, "");
        if ((stripTabs ? content.replace(/^\t+/, "") : content) === word) {
          closedAt = Math.min(stop + 1, text.length);
          bodyEnd = line;
          break;
        }
        line = stop + 1;
      }
      if (closedAt === -1 && blind)
        continue;
      if (script) {
        const body = text.slice(at, bodyEnd);
        addInner(body, false, !quoted && /[$`]/.test(body));
      } else if (!quoted)
        addInner(text.slice(at, bodyEnd), true);
      if (closedAt === -1) {
        open = true;
        at = text.length;
      } else {
        at = closedAt;
      }
    }
  }
  function arithmeticEnd(from) {
    if (text.charAt(from + 1) !== "(")
      return -1;
    if (matching === null || semicolons === null) {
      matching = new Int32Array(text.length).fill(-1);
      semicolons = new Int32Array(text.length + 1);
      const stack = [];
      for (let i = 0;i < text.length; i++) {
        const char = text.charAt(i);
        semicolons[i + 1] = (semicolons[i] ?? 0) + (char === ";" ? 1 : 0);
        if (char === "(")
          stack.push(i);
        else if (char === ")") {
          const opened = stack.pop();
          if (opened !== undefined)
            matching[opened] = i;
        }
      }
    }
    const close = matching[from] ?? -1;
    if (close === -1)
      return -1;
    const closes = text.charAt(close - 1) === ")" && close - 1 > from + 1;
    const plain = (semicolons[close] ?? 0) === (semicolons[from] ?? 0);
    return closes && plain ? close + 1 : -1;
  }
  function readArithmetic(end) {
    addInner(text.slice(at + 3, end - 2), true);
    const piece = text.slice(at, end);
    at = end;
    return piece;
  }
  function readSingle(ansi) {
    let end = at + 1;
    while (end < text.length) {
      const char = text.charAt(end);
      if (ansi && char === "\\") {
        end += 2;
        continue;
      }
      if (oneOf(single, char)) {
        if (!bash && oneOf(single, text.charAt(end + 1))) {
          end += 2;
          continue;
        }
        break;
      }
      end++;
    }
    if (end >= text.length)
      open = true;
    const piece = text.slice(at, end + 1);
    at = Math.min(end + 1, text.length);
    return piece;
  }
  function readBacktick() {
    let end = at + 1;
    while (end < text.length && text.charAt(end) !== "`") {
      end += text.charAt(end) === "\\" ? 2 : 1;
    }
    if (end >= text.length) {
      open = true;
      const piece = text.slice(at);
      at = text.length;
      return piece;
    }
    addInner(text.slice(at + 1, end).replace(/\\([`\\$])/g, "$1"), false);
    const piece = text.slice(at, end + 1);
    at = end + 1;
    return piece;
  }
  function readDouble(closes, substitutions = 0) {
    const mark = segments.length;
    let raw = "";
    if (closes) {
      raw = text.charAt(at);
      at++;
    }
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (closes && oneOf(double, char)) {
        if (!bash && oneOf(double, next)) {
          raw += char + next;
          at += 2;
          continue;
        }
        at++;
        return raw + char;
      }
      if (char === escaper && next !== "") {
        raw += char + next;
        at += 2;
      } else if (bash && char === "$" && next === "$") {
        raw += "$$";
        at += 2;
      } else if (char === "$" && (next === "(" || braceSubstitution()) && substitutions >= MAX_INNER) {
        open = true;
        raw += char;
        at++;
      } else if (char === "$" && next === "(") {
        const end = bash ? arithmeticEnd(at + 1) : -1;
        if (end === -1) {
          at += 2;
          enterGroup();
          raw += `$(${read(")", substitutions + 1).raw}`;
          leaveGroup();
        } else {
          raw += readArithmetic(end);
        }
      } else if (bash && char === "`") {
        raw += readBacktick();
      } else if (braceSubstitution()) {
        raw += readBraceSubstitution(substitutions);
      } else {
        raw += char;
        at++;
      }
    }
    if (!closes)
      return raw;
    open = true;
    segments.length = mark;
    piped.length = mark;
    expanded.length = mark;
    groups.length = mark;
    starts.length = mark;
    return raw;
  }
  function hereDocOpener() {
    let pos = at + 2;
    const stripTabs = text.charAt(pos) === "-";
    if (stripTabs)
      pos++;
    while (isBlank(text.charAt(pos)))
      pos++;
    let word = "";
    let quoted = false;
    while (pos < text.length) {
      const char = text.charAt(pos);
      if (/\s/.test(char) || "<>;&|()".includes(char))
        break;
      if (char === "'" || char === '"') {
        const close = text.indexOf(char, pos + 1);
        if (close === -1)
          return null;
        word += text.slice(pos + 1, close);
        quoted = true;
        pos = close + 1;
      } else if (char === "\\") {
        word += text.charAt(pos + 1);
        quoted = true;
        pos += 2;
      } else {
        word += char;
        pos++;
      }
    }
    return word === "" ? null : { end: pos, quoted, script: false, stripTabs, word };
  }
  const braceSubstitution = () => bash && opensBraceSubstitution(text, at);
  function readBraceSubstitution(substitutions) {
    const pipe = text.charAt(at + 2) === "|" ? "|" : "";
    at += 2 + pipe.length;
    const substitution = read("}", substitutions + 1);
    if (!substitution.closed)
      open = true;
    return `\${${pipe}${substitution.raw}`;
  }
  function isGroupBrace(char, wordStart) {
    if (char !== "{" && char !== "}")
      return false;
    if (!bash)
      return true;
    const after = text.charAt(at + 1);
    return wordStart && (after === "" || /\s/.test(after) || char === "}" && /[;&|)]/.test(after));
  }
  function casePattern(current, char, next) {
    const words = current.trim();
    const command = words.replace(/^(?:(?:do|then|else|elif|if|while|until|!|time(?:\s+-p)?)\s+)+/, "");
    const level = group;
    let top = cases.at(-1);
    if (top?.level === level && /^esac(?![\w-])/.test(command)) {
      cases.pop();
      top = cases.at(-1);
    }
    const starts = /^case\s[\s\S]*\sin(?:\s|$)/.test(command) && !/\sin\s+esac(?![\w-])/.test(command);
    if (starts) {
      top = { level, pattern: true };
      cases.push(top);
    }
    if (top?.level !== level)
      return false;
    if (char === ";" && (next === ";" || next === "&"))
      top.pattern = true;
    if (!top.pattern)
      return false;
    if (char === ")") {
      top.pattern = false;
      return true;
    }
    return char === "(" && (words === "" || starts && /\sin$/.test(command));
  }
  function read(closer, substitutions = 0) {
    const nested = closer !== null;
    let raw = "";
    let current = "";
    let currentStart = at;
    let depth = 0;
    let braces = 0;
    let wordStart = true;
    let afterClose = false;
    let stdinShell = null;
    const take = (piece, blank = false) => {
      current += piece;
      raw += piece;
      wordStart = blank;
      afterClose = false;
    };
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (join && char === escaper) {
        const continuation = CONTINUATION[dialect];
        continuation.lastIndex = at;
        if (continuation.test(text)) {
          take(" ", true);
          at = continuation.lastIndex;
          continue;
        }
      }
      if (!blind) {
        if (char === escaper && next !== "" && next !== `
` && next !== "\r") {
          take(char + next);
          at += 2;
          continue;
        }
        if (oneOf(single, char)) {
          take(readSingle(false));
          continue;
        }
        if (oneOf(double, char)) {
          take(readDouble(true, substitutions));
          continue;
        }
        if (bash && char === "$" && next === "$") {
          take("$$");
          at += 2;
          continue;
        }
        if (bash && char === "$" && next === "'") {
          at++;
          take(`$${readSingle(true)}`);
          continue;
        }
        if (bash && char === "`") {
          take(readBacktick());
          continue;
        }
        const arithmetic = bash && char === "$" && next === "(" ? arithmeticEnd(at + 1) : -1;
        if (arithmetic !== -1) {
          take(readArithmetic(arithmetic));
          continue;
        }
        const processSubstitution = bash && (char === "<" || char === ">") && wordStart;
        const arraySubexpression = !bash && char === "@" && wordStart;
        if (next === "(" && (char === "$" || processSubstitution || arraySubexpression) && substitutions < MAX_INNER) {
          at += 2;
          enterGroup();
          const substitution = read(")", substitutions + 1);
          leaveGroup();
          if (!substitution.closed)
            open = true;
          take(`${char}(${substitution.raw}`);
          continue;
        }
        if (braceSubstitution()) {
          if (substitutions < MAX_INNER) {
            take(readBraceSubstitution(substitutions));
            continue;
          }
          open = true;
        }
        if (closer === "}" && char === "}" && depth === 0 && braces === 0 && current.trim() === "") {
          push(current, afterPipe ? segments[segments.length - 1] ?? null : null, false, group, currentStart);
          afterPipe = false;
          at++;
          return { closed: true, raw: `${raw}}` };
        }
        if (char === "#" && wordStart && !afterClose) {
          const end = text.indexOf(`
`, at);
          at = end === -1 ? text.length : end;
          continue;
        }
        if (!bash && char === "<" && next !== "#")
          unparsable = true;
        if (!bash && char === "<" && next === "#" && wordStart) {
          const end = text.indexOf("#>", at + 2);
          if (end === -1)
            open = true;
          at = end === -1 ? text.length : end + 2;
          take(" ", true);
          continue;
        }
        if (!bash && wordStart && text.startsWith("--%", at) && /^\s?$/.test(text.charAt(at + 3))) {
          let end = at;
          while (end < text.length && text.charAt(end) !== `
` && text.charAt(end) !== "|")
            end++;
          take(text.slice(at, end));
          at = end;
          continue;
        }
      }
      if (bash && char === "<" && next === "<") {
        if (text.charAt(at + 2) === "<") {
          take("<<<");
          at += 3;
          continue;
        }
        const opener = hereDocOpener();
        if (opener === null) {
          take("<<");
          at += 2;
          continue;
        }
        stdinShell ??= readsStdinShell(current);
        owed.push({ ...opener, script: stdinShell });
        take(text.slice(at, opener.end));
        at = opener.end;
        continue;
      }
      if (!bash && char === "@" && (next === '"' || next === "'")) {
        HERE_STRING.lastIndex = at;
        const quoted = HERE_STRING.exec(text);
        if (quoted !== null) {
          if (next === '"' || blind)
            addInner(quoted[2] ?? "", true);
          take(`${next}${next}`);
          at = HERE_STRING.lastIndex;
          continue;
        }
      }
      if (bash && !blind && char === "|" && current.endsWith(">") && !current.endsWith("\\>")) {
        take(char);
        at++;
        continue;
      }
      if (!blind && char === "&" && (current.endsWith(">") && !current.endsWith(`${escaper}>`) || bash && next === ">")) {
        take(char);
        at++;
        continue;
      }
      if (SEPARATORS.has(char) || isGroupBrace(char, wordStart) || blind && bash && char === "`" || blind && braceSubstitution()) {
        const pattern = !blind && bash ? casePattern(current, char, next) : false;
        push(current, afterPipe ? segments[segments.length - 1] ?? null : null, false, group, currentStart);
        afterPipe = char === "|";
        if (!pattern && closer === ")" && char === ")" && depth === 0) {
          at++;
          return { closed: true, raw: `${raw})` };
        }
        if (!pattern && closer === "}" && char === ")" && depth === 0) {
          return { closed: false, raw };
        }
        if (!pattern && nested && char === "(")
          depth++;
        if (!pattern && nested && char === ")")
          depth--;
        if (closer === "}" && char === "{" && current.trim() === "")
          braces++;
        if (closer === "}" && char === "}" && braces > 0)
          braces--;
        if (!pattern && char === "(")
          enterGroup(bash && ARRAY_ASSIGNMENT.test(current));
        else if (!pattern && char === ")")
          leaveGroup();
        current = "";
        stdinShell = null;
        raw += char;
        at++;
        wordStart = true;
        afterClose = char === ")";
        if (char === `
`)
          skipBodies();
        currentStart = at;
        continue;
      }
      take(char, isBlank(char));
      at++;
    }
    push(current, afterPipe ? segments[segments.length - 1] ?? null : null, false, group, currentStart);
    return { closed: false, raw };
  }
  if (options.body === true)
    readDouble(false);
  else if (options.substitution === true)
    readBraceSubstitution(0);
  else
    read(null);
  return { end: at, expanded, groups, open, piped, segments, starts, unparsable };
}
function shellSteps(command, { blindWhenOpen = false, dialect = "bash", joinLines = false } = {}) {
  const read = lex(command, { blind: false, dialect, join: joinLines });
  if (read.unparsable)
    return [];
  const chosen = read.open && blindWhenOpen ? lex(command, { blind: true, dialect, join: joinLines }) : read;
  return chosen.segments.map((text, index) => {
    const start = chosen.starts[index];
    return {
      expanded: chosen.expanded[index] === true,
      pipedFrom: chosen.piped[index] ?? null,
      ...chosen.groups[index] ? { subshell: chosen.groups[index] } : {},
      ...typeof start === "number" && !joinLines ? { start } : {},
      text
    };
  });
}
var ANSI_ESCAPES = {
  a: "\x07",
  b: "\b",
  e: "\x1B",
  E: "\x1B",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t",
  v: "\v"
};
function ansiText(body) {
  return body.replace(/\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3}|c.|.)/gs, (_, code) => {
    const kind = code.charAt(0);
    if (kind === "x" || kind === "u" || kind === "U") {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
    }
    if (/[0-7]/.test(kind))
      return String.fromCharCode(Number.parseInt(code, 8) & 255);
    if (kind === "c")
      return String.fromCharCode(code.charCodeAt(1) & 31);
    return ANSI_ESCAPES[code] ?? code;
  });
}
var POWERSHELL_ESCAPES = {
  "0": "\x00",
  a: "\x07",
  b: "\b",
  e: "\x1B",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t",
  v: "\v"
};
function wordsOf(segment, dialect = "bash") {
  return wordsWithFill(segment, dialect).map((one) => one.text);
}
var EXPANDS = {
  bash: /[A-Za-z_0-9{([@*#?$!-]/,
  powershell: /[A-Za-z_0-9{(?$^:]/
};
function wordsWithFill(segment, dialect = "bash") {
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const expands = EXPANDS[dialect];
  const words = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  let filled = false;
  const end = () => {
    if (inWord)
      words.push({ text: word, filled });
    word = "";
    inWord = false;
    quoted = false;
    filled = false;
  };
  const add = (piece) => {
    word += piece;
    inWord = true;
  };
  const startsExpansion = (after) => expands.test(after) || after === "" || /\s/.test(after) || after === escaper || oneOf(double, after);
  const addExpandable = (char, after) => {
    if (char === "$" && startsExpansion(after) || bash && char === "`")
      filled = true;
    add(char);
  };
  let closes = null;
  const closeOf = (open) => {
    closes ??= parenCloses(segment);
    return closes[open] ?? -1;
  };
  let braceOpen = false;
  let braceTried = { from: -1, close: -1 };
  const braceCloseOf = (from) => {
    if (!bash || braceOpen || !opensBraceSubstitution(segment, from))
      return -1;
    if (braceTried.from !== from) {
      braceTried = { from, close: braceSubstitutionClose(segment, from) };
      if (braceTried.close === -1)
        braceOpen = true;
    }
    return braceTried.close;
  };
  const addSubstitution = (from, close) => {
    add(segment.slice(from, close));
    filled = true;
    i = close;
  };
  let i = 0;
  while (i < segment.length) {
    const char = segment.charAt(i);
    const next = segment.charAt(i + 1);
    if (/\s/.test(char)) {
      end();
      i++;
    } else if (char === escaper && next === `
`) {
      i += 2;
    } else if (char === escaper) {
      quoted = true;
      add(next === "" ? char : bash ? next : POWERSHELL_ESCAPES[next] ?? next);
      i += 2;
    } else if (bash && (char === "$" || !inWord && (char === "<" || char === ">")) && next === "(" && closeOf(i + 1) !== -1) {
      addSubstitution(i, closeOf(i + 1));
    } else if (braceCloseOf(i) !== -1) {
      addSubstitution(i, braceCloseOf(i));
    } else if (!bash && !inWord && char === "@" && next === "(" && powershellParenClose(segment, i + 1) !== -1) {
      const close = powershellParenClose(segment, i + 1);
      add(segment.slice(i, close));
      filled = true;
      i = close;
    } else if (bash && char === "&" && next === ">") {
      end();
      add(char);
      i++;
    } else if (char === "<" || char === ">") {
      const bothStreams = bash && !quoted && char === ">" && word === "&";
      if (!bothStreams && (quoted || !/^\d+$/.test(word)))
        end();
      while (oneOf("<>", segment.charAt(i)))
        add(segment.charAt(i++));
      if (oneOf("&|", segment.charAt(i)))
        add(segment.charAt(i++));
    } else if (bash && char === "$" && next === "$") {
      filled = true;
      add("$$");
      i += 2;
    } else if (bash && char === "$" && next === "'") {
      let close = i + 2;
      while (close < segment.length && segment.charAt(close) !== "'") {
        close += segment.charAt(close) === "\\" ? 2 : 1;
      }
      add(ansiText(segment.slice(i + 2, Math.min(close, segment.length))));
      quoted = true;
      i = close + 1;
    } else if (bash && char === "$" && next === '"') {
      i++;
    } else if (oneOf(single, char)) {
      quoted = true;
      inWord = true;
      i++;
      while (i < segment.length) {
        const inside = segment.charAt(i);
        if (oneOf(single, inside)) {
          if (bash || !oneOf(single, segment.charAt(i + 1)))
            break;
          add(inside);
          i += 2;
          continue;
        }
        add(inside);
        i++;
      }
      i++;
    } else if (oneOf(double, char)) {
      quoted = true;
      inWord = true;
      i++;
      while (i < segment.length) {
        const inside = segment.charAt(i);
        const after = segment.charAt(i + 1);
        if (oneOf(double, inside)) {
          if (bash || !oneOf(double, after))
            break;
          add(inside);
          i += 2;
          continue;
        }
        if (bash && inside === "$" && after === "$") {
          filled = true;
          add("$$");
          i += 2;
          continue;
        }
        const substitution = bash && inside === "$" && after === "(" ? closeOf(i + 1) : braceCloseOf(i);
        if (substitution !== -1) {
          addSubstitution(i, substitution);
          continue;
        }
        if (inside === escaper && after !== "") {
          if (!bash)
            add(POWERSHELL_ESCAPES[after] ?? after);
          else if ('$`"\\'.includes(after))
            add(after);
          else if (after !== `
`)
            add(inside + after);
          i += 2;
          continue;
        }
        addExpandable(inside, after);
        i++;
      }
      i++;
    } else {
      addExpandable(char, next);
      i++;
    }
  }
  end();
  return words;
}
function parenCloses(text) {
  const closes = new Int32Array(text.length).fill(-1);
  const open = [];
  const quoteEnd = (quote, from, escapes) => {
    for (let at = from;at < text.length; at++) {
      const char = text.charAt(at);
      if (escapes && char === "\\")
        at++;
      else if (char === quote)
        return at;
    }
    return -1;
  };
  for (let i = 0;i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === "\\" || char === "$" && next === "$") {
      i++;
    } else if (char === "`") {
      i = quoteEnd("`", i + 1, true);
    } else if (open.at(-1) === -1) {
      if (char === '"')
        open.pop();
      else if (char === "$" && next === "(")
        open.push(++i);
    } else if (char === "'") {
      i = quoteEnd("'", i + 1, false);
    } else if (char === "$" && next === "'") {
      i = quoteEnd("'", i + 2, true);
    } else if (char === '"') {
      open.push(-1);
    } else if (char === "(") {
      open.push(i);
    } else if (char === ")") {
      const at = open.pop();
      if (at !== undefined && at >= 0)
        closes[at] = i + 1;
    }
    if (i === -1)
      break;
  }
  return closes;
}
function powershellParenClose(text, open) {
  const single = SINGLE.powershell;
  const double = DOUBLE.powershell;
  const quoteEnd = (quotes, from, escapes) => {
    for (let at = from;at < text.length; at++) {
      const char = text.charAt(at);
      if (escapes && char === "`")
        at++;
      else if (oneOf(quotes, char)) {
        if (!oneOf(quotes, text.charAt(at + 1)))
          return at;
        at++;
      }
    }
    return -1;
  };
  let depth = 0;
  for (let i = open;i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "`")
      i++;
    else if (oneOf(single, char))
      i = quoteEnd(single, i + 1, false);
    else if (oneOf(double, char))
      i = quoteEnd(double, i + 1, true);
    else if (char === "(")
      depth++;
    else if (char === ")" && --depth === 0)
      return i + 1;
    if (i === -1)
      return -1;
  }
  return -1;
}
var KEYWORDS = new Set(["!", "do", "done", "elif", "else", "fi", "if", "then", "until", "while"]);
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
var CHANGE_DIR = new Set([
  "cd",
  "chdir",
  "popd",
  "pushd",
  "set-location",
  "sl"
]);
var REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(?!\()(.*)$/s;
var DURATION = (word) => /^\d+(?:\.\d+)?[smhd]?$/.test(word);
var CPU_MASK = (word) => /^(?:0x)?[0-9a-f]+(?:[,-][0-9a-f]+)*$/i.test(word);
var WRAPPERS = {
  builtin: { long: [], short: "" },
  busybox: { long: [], short: "" },
  chrt: {
    long: [
      "--sched-runtime",
      "--sched-period",
      "--sched-deadline",
      "--sched-priority",
      "--reset-on-fork"
    ],
    short: "PT",
    skip: (word) => /^-?\d+$/.test(word)
  },
  command: { inert: ["-v", "-V"], long: [], short: "" },
  "cross-env": { long: [], short: "" },
  doas: { long: [], short: "uC" },
  env: {
    long: ["--unset", "--chdir", "--split-string"],
    short: "uCS",
    split: { long: "--split-string", short: "S" }
  },
  exec: { long: [], short: "a" },
  flock: {
    long: ["--timeout", "--conflict-exit-code", "--command"],
    short: "wEc",
    skip: () => true,
    runs: { long: "--command", short: "c" }
  },
  ionice: { long: ["--class", "--classdata", "--pid", "--pgid"], short: "cnpPu" },
  nice: { long: ["--adjustment"], short: "n" },
  nohup: { long: [], short: "" },
  nsenter: {
    long: ["--target", "--setuid", "--setgid", "--root", "--wd", "--wdns", "--env"],
    short: "tSG"
  },
  script: {
    long: ["--command", "--log-out", "--log-in", "--logging-format", "--timing", "--output-limit"],
    short: "cEOI",
    skip: () => true,
    runs: { long: "--command", short: "c" }
  },
  setsid: { long: [], short: "" },
  stdbuf: { long: ["--input", "--output", "--error"], short: "ioe" },
  sudo: {
    long: [
      "--user",
      "--group",
      "--host",
      "--prompt",
      "--close-from",
      "--chdir",
      "--chroot",
      "--command-timeout",
      "--other-user"
    ],
    short: "ughpCDRTU"
  },
  taskset: { long: ["--cpu-list"], short: "c", skip: CPU_MASK },
  time: { long: [], short: "" },
  timeout: { long: ["--signal", "--kill-after"], short: "sk", skip: DURATION },
  unbuffer: { long: [], short: "" },
  xargs: {
    long: [
      "--arg-file",
      "--delimiter",
      "--eof",
      "--max-args",
      "--max-chars",
      "--max-lines",
      "--max-procs",
      "--replace",
      "--process-slot-var"
    ],
    short: "adEILnPs"
  }
};
var SHELLS = new Set(["bash", "dash", "fish", "ksh", "mksh", "sh", "zsh"]);
var CLAUDE_PACKAGE = /^@anthropic-ai\/claude-code(?:@[^/]*)?$/;
var PACKAGE_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
function packageCommand(program, args) {
  let rest;
  if (PACKAGE_RUNNERS.has(program))
    rest = args;
  else if (program === "pnpm" && args[0] === "dlx")
    rest = args.slice(1);
  else
    return null;
  for (let index = 0;index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      const pkg = rest[index + 1];
      return pkg !== undefined && CLAUDE_PACKAGE.test(pkg) ? { args: rest.slice(index + 2), program: "claude" } : null;
    }
    const name = word.split("=")[0] ?? word;
    if (name === "-p" || name === "--package") {
      const inline = word.includes("=") ? word.slice(word.indexOf("=") + 1) : undefined;
      const pkg = inline ?? rest[index + 1];
      if (pkg === undefined || !CLAUDE_PACKAGE.test(pkg))
        return null;
      const after = rest.slice(index + (inline === undefined ? 2 : 1));
      const command = after[0] === "claude" ? after.slice(1) : after;
      return { args: [...command], program: "claude" };
    }
    if (word.startsWith("-")) {
      index += /^--(?:registry|prefix|cache|userconfig)$/.test(name) ? 1 : 0;
      continue;
    }
    return CLAUDE_PACKAGE.test(word) ? { args: rest.slice(index + 1), program: "claude" } : null;
  }
  return null;
}
function shortFlags(arg, valued) {
  let flags = "";
  for (let i = 1;i < arg.length; i++) {
    const letter = arg.charAt(i);
    flags += letter;
    if (valued.includes(letter)) {
      const attached = arg.slice(i + 1);
      return {
        flags,
        value: attached.startsWith("=") ? attached.slice(1) : attached,
        wantsNext: i === arg.length - 1
      };
    }
  }
  return { flags, value: "", wantsNext: false };
}
function isShort(arg) {
  return /^-[^-]/.test(arg);
}
function afterWrapper(words, from, spec) {
  let index = from;
  let skipped = false;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--")
      return { index: index + 1 };
    if (!isShort(word) && !word.startsWith("--")) {
      if (!skipped && spec.skip?.(word) === true) {
        skipped = true;
        index++;
        continue;
      }
      break;
    }
    const name = word.split("=")[0] ?? word;
    if (spec.inert?.some((inert) => inert === name || inert === word) === true)
      return;
    if (word.startsWith("--")) {
      const valued = spec.long.includes(name) && !word.includes("=");
      if (spec.split !== undefined && name === spec.split.long) {
        const value = valued ? words[index + 1] ?? "" : word.slice(name.length + 1);
        const to = index + (valued ? 2 : 1);
        return { index, split: { from: index, to, value, keep: null } };
      }
      if (spec.runs !== undefined && name === spec.runs.long) {
        const value = valued ? words[index + 1] ?? "" : word.slice(name.length + 1);
        return { index, runs: { from: index, to: index + (valued ? 2 : 1), value } };
      }
      index += valued ? 2 : 1;
      continue;
    }
    const { flags, wantsNext } = shortFlags(word, spec.short);
    if (spec.split !== undefined && flags.endsWith(spec.split.short)) {
      const value = wantsNext ? words[index + 1] ?? "" : word.slice(flags.length + 1);
      const before = flags.slice(0, -1);
      const to = index + (wantsNext ? 2 : 1);
      return {
        index,
        split: { from: index, to, value, keep: before === "" ? null : `-${before}` }
      };
    }
    if (spec.runs !== undefined && flags.endsWith(spec.runs.short)) {
      const value = wantsNext ? words[index + 1] ?? "" : word.slice(flags.length + 1);
      return { index, runs: { from: index, to: index + (wantsNext ? 2 : 1), value } };
    }
    index += wantsNext ? 2 : 1;
  }
  return { index };
}
function invocationOf(words) {
  let list = [...words];
  let splits = 0;
  let index = 0;
  while (index < list.length) {
    const word = list[index] ?? "";
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++;
      continue;
    }
    const redirection = REDIRECTION.exec(word);
    if (redirection !== null) {
      index += (redirection[2] ?? "") === "" ? 2 : 1;
      continue;
    }
    const spec = WRAPPERS[programName(word)];
    if (spec === undefined)
      break;
    const after = afterWrapper(list, index + 1, spec);
    if (after === undefined)
      return;
    if (after.split !== undefined && splits < MAX_NESTING) {
      const { from, keep, to, value } = after.split;
      const kept = keep === null ? [] : [keep];
      list = [...list.slice(0, from), ...kept, ...wordsOf(value), ...list.slice(to)];
      splits++;
      continue;
    }
    if (after.runs !== undefined && splits < MAX_NESTING) {
      const { from, to, value } = after.runs;
      list = [...list.slice(0, from), ...wordsOf(value), ...list.slice(to)];
      index = from;
      splits++;
      continue;
    }
    index = after.split === undefined ? after.index : after.split.to;
  }
  const first = list[index];
  if (first === undefined)
    return;
  const program = programName(first);
  const ran = packageCommand(program, list.slice(index + 1));
  const started = program === START_PROCESS ? startProcess(list.slice(index + 1)) : null;
  const command = started ?? ran;
  return {
    args: command?.args ?? list.slice(index + 1),
    computed: isComputedWord(first),
    prefix: [...list.slice(0, index), ...started?.prefix ?? []],
    program: command?.program ?? program
  };
}
function isComputedWord(word) {
  if (word === "{}")
    return true;
  if (!/[$`]/.test(word))
    return false;
  return /[$`(){}[\]\s]/.test(programName(word));
}
var START_PROCESS_PARAMETERS = new Map([
  ["argumentlist", true],
  ["credential", true],
  ["erroraction", true],
  ["errorvariable", true],
  ["filepath", true],
  ["informationaction", true],
  ["informationvariable", true],
  ["loaduserprofile", false],
  ["nonewwindow", false],
  ["outbuffer", true],
  ["outvariable", true],
  ["passthru", false],
  ["pipelinevariable", true],
  ["redirectstandarderror", true],
  ["redirectstandardinput", true],
  ["redirectstandardoutput", true],
  ["usenewenvironment", false],
  ["verb", true],
  ["wait", false],
  ["warningaction", true],
  ["warningvariable", true],
  ["windowstyle", true],
  ["workingdirectory", true]
]);
function startProcessParameter(word) {
  const match = /^-([A-Za-z]\w*)(?::(.*))?$/.exec(word);
  const given = match?.[1]?.toLowerCase() ?? "";
  if (given === "")
    return null;
  const names = [...START_PROCESS_PARAMETERS.keys()].filter((name) => name.startsWith(given));
  const [name] = names;
  if (names.length !== 1 || name === undefined)
    return null;
  return { name, takesValue: START_PROCESS_PARAMETERS.get(name) === true, value: match?.[2] };
}
function continuesArray(args, index) {
  return (args[index] ?? "").endsWith(",") || (args[index + 1] ?? "").startsWith(",");
}
function arrayAt(args, from, first) {
  const words = [first];
  let next = from + 1;
  while (next < args.length && continuesArray([words.at(-1) ?? "", args[next] ?? ""], 0)) {
    words.push(args[next] ?? "");
    next++;
  }
  return { words, next };
}
function arrayElements(words) {
  return words.flatMap((word) => {
    const inner = /^@\(([\s\S]*)\)$/.exec(word)?.[1];
    return inner === undefined ? [word] : wordsOf(inner, "powershell");
  }).join(" ").split(",").flatMap((part) => wordsOf(part)).filter((one) => one !== "");
}
function startProcess(args) {
  let file = null;
  let list = null;
  let fresh = null;
  const positional = [];
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(index + 1).map((word) => [word]));
      break;
    }
    const parameter = startProcessParameter(arg);
    if (parameter === null) {
      if (!arg.startsWith("-") || continuesArray(args, index)) {
        const array = arrayAt(args, index, arg);
        positional.push(array.words);
        index = array.next - 1;
      }
      continue;
    }
    const { name, takesValue } = parameter;
    let value;
    if (takesValue) {
      const inline = parameter.value;
      const from = inline === undefined ? index + 1 : index;
      if (from < args.length) {
        const array = arrayAt(args, from, inline ?? args[from] ?? "");
        value = array.words;
        index = array.next - 1;
      }
    }
    if (name === "filepath" && value !== undefined)
      file = value[0] ?? null;
    else if (name === "argumentlist" && value !== undefined)
      list = arrayElements(value);
    else if (name === "usenewenvironment")
      fresh = arg;
  }
  file ??= positional[0]?.[0] ?? null;
  list ??= arrayElements(positional.slice(1).flat());
  if (file === null)
    return null;
  return {
    args: list,
    prefix: fresh === null ? [] : [START_PROCESS, fresh],
    program: programName(file)
  };
}
var START_PROCESS = "start-process";
var WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
function shellTakesStdin(args) {
  let stdin = false;
  let scriptFile = false;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    const redirection = REDIRECTION.exec(arg);
    if (redirection !== null) {
      if ((redirection[2] ?? "") === "")
        index++;
      if ((redirection[1] ?? "").startsWith("<<"))
        stdin = true;
      continue;
    }
    if (arg === "-") {
      stdin = true;
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg === "--init-file" || arg === "--rcfile")
        index++;
      continue;
    }
    if (isShort(arg) || arg.startsWith("+")) {
      const letters = arg.replace(/^[-+]+/, "");
      if (letters.includes("c"))
        return false;
      if (letters.includes("s"))
        stdin = true;
      if (letters === "o")
        index++;
      continue;
    }
    scriptFile = true;
  }
  return stdin || !scriptFile;
}
function shellCommandString(args) {
  let commandMode = false;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--")
      return commandMode ? args[index + 1] : undefined;
    const redirection = REDIRECTION.exec(arg);
    if (redirection !== null) {
      if ((redirection[2] ?? "") === "")
        index++;
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg === "--init-file" || arg === "--rcfile")
        index++;
      continue;
    }
    if (/^[-+][A-Za-z]+$/.test(arg)) {
      const letters = arg.slice(1);
      if (arg.startsWith("-") && letters.includes("c"))
        commandMode = true;
      if (/[oO]$/.test(letters))
        index++;
      continue;
    }
    return commandMode ? arg : undefined;
  }
  return;
}
function readsStdinShell(segment) {
  const invocation = invocationOf(wordsOf(segment));
  return invocation !== undefined && SHELLS.has(invocation.program) && shellTakesStdin(invocation.args);
}
function writtenText(segment) {
  const invocation = invocationOf(wordsOf(segment));
  if (invocation === undefined || invocation.args.length === 0)
    return null;
  const text = invocation.args.join(" ");
  return invocation.program === "printf" ? text.replace(/\\([nrt])/g, " ") : text;
}
var FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
var FIND_VALUED = new Set([
  "-amin",
  "-anewer",
  "-atime",
  "-cmin",
  "-cnewer",
  "-context",
  "-ctime",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fstype",
  "-gid",
  "-group",
  "-iname",
  "-inum",
  "-ipath",
  "-iregex",
  "-iwholename",
  "-links",
  "-lname",
  "-maxdepth",
  "-mindepth",
  "-mmin",
  "-mtime",
  "-name",
  "-newer",
  "-path",
  "-perm",
  "-printf",
  "-regex",
  "-regextype",
  "-samefile",
  "-size",
  "-type",
  "-uid",
  "-used",
  "-user",
  "-wholename",
  "-xtype"
]);
function endsFindCommand(word, before) {
  return word === ";" || word === "+" && before === "{}";
}
function findCommands(args) {
  const commands = [];
  for (let index = 0;index < args.length; index++) {
    const word = args[index] ?? "";
    if (FIND_VALUED.has(word) || /^-newer[a-zA-Z]{2}$/.test(word)) {
      index++;
      continue;
    }
    if (!FIND_EXEC.has(word))
      continue;
    const words = [];
    for (index++;index < args.length && !endsFindCommand(args[index] ?? "", args[index - 1] ?? ""); index++) {
      words.push(args[index] ?? "");
    }
    if (words.length > 0)
      commands.push(words.map(shellQuote).join(" "));
  }
  return commands.length === 0 ? undefined : commands.join(" ; ");
}
function longOption(word, names) {
  const name = word.split("=")[0] ?? word;
  if (names.includes(name))
    return name;
  const starts = names.filter((one) => one.startsWith(name));
  return starts.length === 1 ? starts[0] ?? null : null;
}
var WATCH_LONG = [
  "--beep",
  "--chgexit",
  "--color",
  "--cumulative",
  "--differences",
  "--equexit",
  "--errexit",
  "--exec",
  "--help",
  "--interval",
  "--no-color",
  "--no-title",
  "--no-wrap",
  "--precise",
  "--version"
];
var WATCH_VALUED = new Set(["--equexit", "--interval"]);
function watchCommand(args) {
  let exec = false;
  let index = 0;
  for (;index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--") {
      index++;
      break;
    }
    if (!word.startsWith("-") || word === "-")
      break;
    if (word.startsWith("--")) {
      const name = longOption(word, WATCH_LONG);
      if (name === "--exec")
        exec = true;
      else if (name !== null && WATCH_VALUED.has(name) && !word.includes("="))
        index++;
      continue;
    }
    for (let at = 1;at < word.length; at++) {
      const letter = word.charAt(at);
      if (letter === "d")
        break;
      if (letter === "x")
        exec = true;
      if (letter === "n" || letter === "q") {
        if (at === word.length - 1)
          index++;
        break;
      }
    }
  }
  const words = args.slice(index);
  if (words.length === 0)
    return;
  return exec ? words.map(shellQuote).join(" ") : words.join(" ");
}
function suCommand(args) {
  for (let index = 0;index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--")
      continue;
    if (word.startsWith("--")) {
      const name = longOption(word, SU_LONG);
      const carried = word.includes("=");
      if (name === "--command" || name === "--session-command") {
        return carried ? word.slice(word.indexOf("=") + 1) : args[index + 1];
      }
      if (name !== null && SU_VALUED.has(name) && !carried)
        index++;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, "cgGsw");
      if (flags.endsWith("c"))
        return wantsNext ? args[index + 1] : word.slice(flags.length + 1);
      if (wantsNext)
        index++;
    }
  }
  return;
}
var SU_LONG = [
  "--command",
  "--fast",
  "--group",
  "--help",
  "--login",
  "--preserve-environment",
  "--pty",
  "--session-command",
  "--shell",
  "--supp-group",
  "--version",
  "--whitelist-environment"
];
var SU_VALUED = new Set([
  "--command",
  "--group",
  "--session-command",
  "--shell",
  "--supp-group",
  "--whitelist-environment"
]);
var PARALLEL_VALUED = new Set([
  "--arg-file",
  "--arg-file-sep",
  "--arg-sep",
  "--block",
  "--colsep",
  "--delay",
  "--delimiter",
  "--env",
  "--eof",
  "--halt",
  "--header",
  "--jobs",
  "--joblog",
  "--load",
  "--max-args",
  "--max-lines",
  "--max-procs",
  "--memfree",
  "--nice",
  "--profile",
  "--recend",
  "--recstart",
  "--results",
  "--retries",
  "--rpl",
  "--sshlogin",
  "--sshloginfile",
  "--tagstring",
  "--timeout",
  "--workdir",
  "--basefile",
  "--bf",
  "--block-size",
  "--bt",
  "--ctagstring",
  "--filter",
  "--group-by",
  "--id",
  "--jl",
  "--limit",
  "--max-chars",
  "--memsuspend",
  "--res",
  "--return",
  "--ssh",
  "--ssh-delay",
  "--term-seq",
  "--tf",
  "--tmpdir",
  "--tmpl",
  "--trc",
  "--wd"
]);
var PARALLEL_SWITCHES = new Set([
  "--bar",
  "--dry-run",
  "--eta",
  "--group",
  "--keep-order",
  "--line-buffer",
  "--pipe",
  "--progress",
  "--quote",
  "--shebang",
  "--tag",
  "--ungroup",
  "--verbose",
  "--will-cite",
  "--xargs"
]);
var PARALLEL_SOURCES = new Set([":::", "::::", ":::+", "::::+"]);
var PARALLEL_LONG = [...PARALLEL_VALUED, ...PARALLEL_SWITCHES];
function parallelStarts(args) {
  const starts = new Set;
  const seen = new Set;
  const queue = [0];
  for (let at = queue.pop();at !== undefined; at = queue.pop()) {
    if (seen.has(at))
      continue;
    seen.add(at);
    const word = args[at];
    if (word === undefined) {
      starts.add(at);
    } else if (word === "--") {
      starts.add(at + 1);
    } else if (!word.startsWith("-") || word === "-") {
      starts.add(at);
    } else if (word.startsWith("--")) {
      const carried = word.includes("=");
      const name = longOption(word, PARALLEL_LONG);
      if (name === null)
        queue.push(at + 1, at + 2);
      else
        queue.push(PARALLEL_VALUED.has(name) && !carried ? at + 2 : at + 1);
    } else {
      queue.push(shortFlags(word, "jnNPadSIELCsJ").wantsNext ? at + 2 : at + 1);
    }
  }
  return [...starts].sort((a, b) => a - b);
}
function parallelLines(args) {
  const sepAt = args.findIndex((word) => word === "--arg-sep" || word.startsWith("--arg-sep="));
  const sepWord = sepAt === -1 ? undefined : args[sepAt];
  const separator = sepWord === undefined ? null : sepWord.includes("=") ? sepWord.slice(sepWord.indexOf("=") + 1) : args[sepAt + 1] ?? null;
  const isSource = (word) => separator === null ? PARALLEL_SOURCES.has(word) : word === separator;
  const lines = [];
  for (const start of parallelStarts(args)) {
    let index = start;
    const command = [];
    for (;index < args.length && !isSource(args[index] ?? ""); index++) {
      command.push(args[index] ?? "");
    }
    const given = [];
    let reading = false;
    for (;index < args.length; index++) {
      const word = args[index] ?? "";
      if (isSource(word))
        reading = !word.startsWith("::::");
      else if (reading)
        given.push(word);
    }
    if (command.length === 0) {
      if (given.length > 0)
        lines.push(given.join(" ; "));
      continue;
    }
    const line = command.join(" ");
    lines.push(line);
    if (given.length === 0)
      continue;
    const quoted = given.map(shellQuote).join(" ");
    lines.push(line.includes("{}") ? line.replaceAll("{}", quoted) : `${line} ${quoted}`);
    const program = programName(command[0] ?? "");
    if (SHELLS.has(program) || program === "eval")
      lines.push(...given);
  }
  return lines;
}
function parallelCommand(args) {
  const lines = [...new Set(parallelLines(args))];
  return lines.length === 0 ? undefined : lines.join(" ; ");
}
function jobRunArguments(program, args) {
  const kit = kitArguments(program, args);
  return kit !== null && kit[0] === "job" && kit[1] === "run" ? kit.slice(2) : null;
}
function nestedCommand(program, args, pipedFrom = null) {
  if (SHELLS.has(program)) {
    const script = shellCommandString(args);
    if (script !== undefined)
      return script;
    if (!shellTakesStdin(args))
      return jobRunLine(program, args);
    const here = args.findIndex((arg) => arg === "<<<" || arg.startsWith("<<<"));
    if (here !== -1) {
      const word = args[here] ?? "";
      return word.length > 3 ? word.slice(3) : args.slice(here + 1).join(" ");
    }
    return pipedFrom === null ? undefined : writtenText(pipedFrom) ?? undefined;
  }
  if (program === "find")
    return findCommands(args) ?? jobRunLine(program, args);
  if (program === "watch")
    return watchCommand(args) ?? jobRunLine(program, args);
  if (program === "su")
    return suCommand(args) ?? jobRunLine(program, args);
  if (program === "parallel")
    return parallelCommand(args) ?? jobRunLine(program, args);
  if (program === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return at === -1 ? jobRunLine(program, args) : args.slice(at + 1).join(" ");
  }
  if (program === "powershell" || program === "pwsh") {
    const at = args.findIndex((arg) => arg.length > 1 && "-command".startsWith(arg.toLowerCase()));
    return at === -1 ? jobRunLine(program, args, powershellQuoted) : afterCommandFlag(program, args, at, powershellQuoted);
  }
  if (program === "eval" || program === "iex" || program === "invoke-expression") {
    return args.join(" ");
  }
  return jobRunLine(program, args);
}
function afterCommandFlag(program, args, at, quote) {
  const job = jobRunArguments(program, args.slice(0, at)) === null ? undefined : jobRunLine(program, args, quote);
  return job ?? args.slice(at + 1).join(" ");
}
function jobRunLine(program, args, quote = shellQuote) {
  const queued = jobRunArguments(program, args);
  if (queued === null)
    return;
  const dashes = queued.indexOf("--");
  return dashes === -1 || dashes === queued.length - 1 ? undefined : queued.slice(dashes + 1).map(quote).join(" ");
}
function nestedDialect(program) {
  return ["iex", "invoke-expression", "powershell", "pwsh"].includes(program) ? "powershell" : "bash";
}

// src/hooks/plans-folders.ts
import { join as join8, resolve as resolve4 } from "path";

// src/setup/managed-json.ts
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "fs";
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectIndent(text) {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
function readJsonObject(file) {
  if (!existsSync5(file))
    return { data: {}, indent: "  ", text: null };
  return parseJsonObject(readFileSync6(file, "utf8"), file);
}
function parseJsonObject(text, file) {
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

// src/hooks/plans-folders.ts
function plansDirectory(root, env) {
  const paths = cliPaths(env);
  let plans = join8(paths.claudeConfigDir, "plans");
  for (const settings of [
    paths.settingsFile,
    join8(root, ".claude/settings.json"),
    join8(root, ".claude/settings.local.json")
  ]) {
    const configured = stringField(readJsonObject(settings).data.plansDirectory);
    if (configured !== null)
      plans = configured.startsWith("~/") ? join8(paths.home, configured.slice(2)) : resolve4(root, configured);
  }
  return realPath(plans);
}
function plansFolders(root, env) {
  return [plansDirectory(root, env), realPath(join8(root, ".claude/plans"))];
}

// src/hooks/transcript.ts
import { closeSync as closeSync2, fstatSync, openSync as openSync2, readSync } from "fs";
var TRANSCRIPT_TAIL_BYTES = 512 * 1024;
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var STOP_FEEDBACK = "Stop hook feedback:";
function stopFeedbackTexts(entry) {
  if (!isJsonObject(entry) || !isJsonObject(entry.message))
    return [];
  const content = entry.message.content;
  const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.flatMap((block) => isJsonObject(block) && typeof block.text === "string" ? [block.text] : []) : [];
  return texts.filter((text) => text.includes(STOP_FEEDBACK));
}
var LEADING_NULS = /^\0+/;
function splitLines(text) {
  return text.split(`
`).map((line) => line.replace(LEADING_NULS, ""));
}
function tailLines(transcriptPath, bytes = TRANSCRIPT_TAIL_BYTES) {
  let text;
  try {
    const fd = openSync2(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync2(fd);
    }
  } catch {
    return null;
  }
  return splitLines(text);
}
var BRIEF_HEAD_BYTES = 1024 * 1024;
var PROMPT_SCAN_MAX_BYTES = 16 * 1024 * 1024;
var NOTICE_HEAD = "<task-notification>\\n<task-id>[^<]*</task-id>\\n<tool-use-id>([^<]*)</tool-use-id>\\n<output-file>[^<]*</output-file>\\n<status>[^<]*</status>\\n";
var MONITOR_NOTICE_TRAILER = "If this event is something the user would act on now, send a PushNotification\\. Routine or benign output doesn't need one\\.";
var COMMAND_NOTICE = new RegExp(`^${NOTICE_HEAD}<summary>Background command "[^<]*</summary>\\n</task-notification>$`);
var MONITOR_NOTICE = new RegExp(`^${NOTICE_HEAD}<summary>Monitor "[^<]*" stream ended</summary>\\n(?:<event>(?:(?!</event>)[\\s\\S])*</event>\\n)?${MONITOR_NOTICE_TRAILER}\\n</task-notification>$`);

// src/hooks/verify-gate.ts
var VERIFY_GATE_TAIL_BYTES = 4 * 1024 * 1024;
var CHANGE_TOOLS = ["Edit", "Write", "NotebookEdit"];
var REMINDER_MARK = "has not run the project's fast check since";
function verifyGateReason(check) {
  return `This session changed files and has not run the project's fast check since: run \`${check}\`, then stop.`;
}
function objectOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function blocksOf(line) {
  const content = objectOf(line.message)?.content;
  if (!Array.isArray(content))
    return [];
  return content.filter((block) => objectOf(block) !== null && block !== null);
}
function toolUses(line) {
  return blocksOf(line).filter((block) => block.type === "tool_use");
}
function resultText(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return "";
  return content.map((block) => {
    const text = objectOf(block)?.text;
    return typeof text === "string" ? text : "";
  }).join(`
`);
}
var REFUSED = /(doesn't want to proceed|tool use was rejected|has been denied)/i;
function failedCalls(lines) {
  const failed = new Set;
  for (const line of lines) {
    if (!line.includes('"tool_result"'))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const record = objectOf(entry);
    if (record === null)
      continue;
    for (const block of blocksOf(record)) {
      if (block.type !== "tool_result")
        continue;
      const id = stringField(block.tool_use_id);
      if (id === null)
        continue;
      const text = resultText(block.content);
      if (block.is_error === true || REFUSED.test(text))
        failed.add(id);
    }
  }
  return failed;
}
function runWords(line, dialect, depth = 0) {
  if (depth > MAX_NESTING)
    return [];
  const words = [];
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const command = wordsOf(step.text, dialect);
    words.push(...command);
    const invocation = invocationOf(command);
    if (invocation === undefined)
      continue;
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined) {
      words.push(...runWords(inner, nestedDialect(invocation.program), depth + 1));
    }
  }
  return words;
}
function contains(run, wanted) {
  for (let at = 0;at + wanted.length <= run.length; at += 1) {
    if (wanted.every((word, index) => run[at + index] === word))
      return true;
  }
  return false;
}
function ranCheck(command, check, dialect) {
  const dialects = dialect === undefined ? ["bash", "powershell"] : [dialect];
  return dialects.some((one) => {
    const wanted = runWords(check, one);
    return wanted.length > 0 && contains(runWords(command, one), wanted);
  });
}
function isOwnReminder(line) {
  return stopFeedbackTexts(line).some((text) => text.includes(REMINDER_MARK));
}
function seenIn(lines, check, countsEdit) {
  const seen = { lastEdit: -1, lastCheck: -1, lastReminder: -1 };
  const failed = failedCalls(lines);
  for (let index = 0;index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes('"tool_use"') && !line.includes(STOP_FEEDBACK))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const record = objectOf(entry);
    if (record === null || record.isSidechain === true)
      continue;
    if (isOwnReminder(record))
      seen.lastReminder = index;
    for (const block of toolUses(record)) {
      const name = stringField(block.name);
      if (name !== null && CHANGE_TOOLS.includes(name)) {
        if (!failed.has(stringField(block.id) ?? "") && countsEdit(block, stringField(record.cwd)))
          seen.lastEdit = index;
        continue;
      }
      const dialect = dialectOfTool(name);
      if (dialect === undefined)
        continue;
      const command = stringField(objectOf(block.input)?.command);
      if (command !== null && ranCheck(command, check, dialect))
        seen.lastCheck = index;
    }
  }
  return seen;
}
function verifyGateWouldBlock(input, config, env, real = realPath) {
  if (config === null)
    return false;
  if (input.stop_hook_active === true)
    return false;
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0)
    return false;
  const check = config.checks?.fast;
  if (check === undefined)
    return false;
  const transcript = stringField(input.transcript_path);
  if (transcript === null)
    return false;
  const lines = tailLines(transcript, VERIFY_GATE_TAIL_BYTES);
  if (lines === null)
    return false;
  const cwd = stringField(input.cwd);
  if (cwd === null)
    return false;
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null)
    return false;
  const root = real(checkout.root);
  const excluded = plansFolders(root, env);
  const seen = seenIn(lines, check, (block, editCwd) => {
    const fields = objectOf(block.input);
    const path = stringField(block.name === "NotebookEdit" ? fields?.notebook_path : fields?.file_path);
    if (path === null || path.trim() === "" || path.includes("\x00") || !isAbsolute(path) && (editCwd === null || !isAbsolute(editCwd)))
      return true;
    const file = real(isAbsolute(path) ? resolve5(path) : resolve5(editCwd ?? cwd, path));
    return isInsideOnDisk(file, root) && ![".md", ".mdx"].includes(extname(file).toLowerCase()) && !excluded.some((folder) => isInsideOnDisk(file, folder));
  });
  return seen.lastEdit > Math.max(seen.lastCheck, seen.lastReminder);
}
function verifyGate(context) {
  if (context.event !== "Stop")
    return SILENT;
  if (!verifyGateWouldBlock(context.input, context.project.config, context.env))
    return SILENT;
  const check = context.project.config?.checks?.fast ?? "";
  return { stdout: JSON.stringify({ decision: "block", reason: verifyGateReason(check) }) };
}

// src/hooks/specs/verify-gate.ts
var verifyGateHook = {
  name: "verify-gate",
  events: ["Stop"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit verify-gate: ${message}` }),
  run: verifyGate
};

// src/entries/verify-gate.ts
await runHookEntry(verifyGateHook);
