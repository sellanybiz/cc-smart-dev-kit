// @bun
// src/hooks/run.ts
import { appendFileSync as appendFileSync2 } from "fs";

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
import { existsSync as existsSync3, realpathSync as realpathSync2, statSync as statSync2 } from "fs";
import { join as join4 } from "path";

// src/path-compare.ts
var IGNORE_CASE = process.platform === "win32";

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
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, dirname, join as join3, resolve } from "path";
function writeTemp(file, content, mode) {
  const dir = dirname(file);
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
  const why = error instanceof Error ? error.message : String(error);
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
  return realpathSync2(main.path);
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
  const root = realpathSync2(parts.top);
  const commonDir = realpathSync2(parts.common);
  return { commonDir, isWorktree: realpathSync2(parts.gitDir) !== commonDir, root };
}
function locateCheckout(cwd, options = {}) {
  if (!existsSync3(cwd) || !statSync2(cwd).isDirectory()) {
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
  const own = join4(root, CONFIG_PATH);
  if (existsSync3(own))
    return own;
  if (mainCheckout === null || mainCheckout === root)
    return null;
  const main = join4(mainCheckout, CONFIG_PATH);
  return existsSync3(main) ? main : null;
}
function ownHooksOf(checkout) {
  const file = projectFileFor(checkout);
  return file === null ? [] : readOwnHooks(file) ?? [];
}

// src/hooks/ask-log.ts
import { join as join5 } from "path";

// src/hooks/jsonl-log.ts
import { appendFileSync, mkdirSync as mkdirSync2, readFileSync as readFileSync3, statSync as statSync3 } from "fs";
import { dirname as dirname2 } from "path";

// src/update/state.ts
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;

// src/hooks/jsonl-log.ts
function cutBack(file) {
  let size;
  try {
    size = statSync3(file).size;
  } catch {
    return;
  }
  if (size <= LOG_MAX_BYTES)
    return;
  const text = readFileSync3(file, "utf8");
  const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
  atomicWrite(file, keep.slice(keep.indexOf(`
`) + 1), 384);
}
function appendJsonLine(file, value) {
  mkdirSync2(dirname2(file), { recursive: true, mode: 448 });
  cutBack(file);
  appendFileSync(file, `${JSON.stringify(value)}
`, { mode: 384 });
}

// src/hooks/ask-log.ts
var ASK_LOG_FILE = "guard-asks.jsonl";
var ASK_REASON_MAX = 200;
function askLogFile(stateDir) {
  return join5(stateDir, ASK_LOG_FILE);
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
  readFileSync as readFileSync4,
  statSync as statSync4,
  unlinkSync as unlinkSync2
} from "fs";
import { dirname as dirname3, join as join6 } from "path";

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
var PARSER_FINGERPRINT = "1fe75b2f95408e56c9ced0e05df3707f931e4a6b8d2641c848d57436130e8457";
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
  const built = join6(import.meta.dir, "config-check.js");
  const entry = existsSync4(built) ? built : join6(import.meta.dir, "..", "entries", "config-check.ts");
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
    const entry = JSON.parse(readFileSync4(file, "utf8"));
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
    const path = join6(dir, name);
    try {
      if (TEMP_NAME.test(name)) {
        if (nowMs - statSync4(path).mtimeMs > CHECKED_TEMP_MAX_AGE_MS)
          unlinkSync2(path);
      } else if (name.endsWith(".json")) {
        entries.push({ path, mtimeMs: statSync4(path).mtimeMs });
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
    atomicWrite(join6(dir, `${key}.json`), JSON.stringify(entry), 384);
  } catch {}
}
async function loadCheckedFile(file, kind, { paths }) {
  if (!existsSync4(file))
    return { ok: true, value: null, fact: "none" };
  const bytes = readFileSync4(file);
  const cacheable = bytes.length <= CHECKED_FILE_MAX_BYTES;
  const dir = join6(paths.stateDir, CHECKED_DIR);
  const key = checkedKey(PARSER_FINGERPRINT, kind, bytes);
  if (cacheable) {
    const hit = readEntry(join6(dir, `${key}.json`), key, kind);
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

// src/hooks/agent-usage.ts
import { readFileSync as readFileSync5 } from "fs";
import { join as join7 } from "path";

// src/gateway/targets.ts
var CONTEXT_SUFFIX = /\[1m\]$/i;
function withoutContextSuffix(name) {
  return name.replace(CONTEXT_SUFFIX, "");
}
var MODEL_SLOTS = {
  "cc-smart-dev-kit-fable": "fable",
  "cc-smart-dev-kit-opus": "opus"
};
var CLAUDE_FAMILIES = ["opus", "sonnet", "haiku", "fable"];
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
var VERSION_AT_START = /^(\d{1,3})(?:-(\d{1,2})(?!\d))?(?!\d)/;
function claudeVersion(model) {
  const family = claudeFamily(model);
  if (family === null)
    return null;
  const name = `${withoutContextSuffix(model).toLowerCase()}-`;
  const id = name.slice((PROVIDER_PREFIX.exec(name)?.[0].length ?? 0) - "claude-".length);
  const at = id.indexOf(`-${family}-`);
  const before = id.slice("claude-".length, at);
  const after = id.slice(at + family.length + 2);
  const match = VERSION_AT_START.exec(before === "" ? after : before);
  if (match === null)
    return null;
  return { major: Number(match[1]), minor: match[2] === undefined ? 0 : Number(match[2]) };
}
var CAPACITY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

// src/gateway/prices.ts
var CLAUDE_PRICES = [
  {
    family: "fable",
    major: 5,
    minor: 2,
    price: { cacheRead: 0.2, cacheWrite: 10, input: 8, output: 40 }
  },
  {
    family: "fable",
    major: 5,
    minor: 1,
    price: { cacheRead: 0.25, cacheWrite: 12.5, input: 10, output: 50 }
  },
  {
    family: "fable",
    major: 5,
    minor: 0,
    price: { cacheRead: 1, cacheWrite: 12.5, input: 10, output: 50 }
  },
  {
    family: "opus",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20 }
  },
  {
    family: "opus",
    major: 5,
    minor: 0,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 }
  },
  {
    family: "opus",
    major: 4,
    minor: 8,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 }
  },
  {
    family: "opus",
    major: 4,
    minor: 7,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 }
  },
  {
    family: "opus",
    major: 4,
    minor: 6,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 }
  },
  {
    family: "opus",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 }
  },
  {
    family: "opus",
    major: 4,
    minor: 1,
    price: { cacheRead: 1.5, cacheWrite: 18.75, input: 15, output: 75 }
  },
  {
    family: "opus",
    major: 4,
    minor: 0,
    price: { cacheRead: 1.5, cacheWrite: 18.75, input: 15, output: 75 }
  },
  {
    family: "sonnet",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 }
  },
  {
    family: "sonnet",
    major: 5,
    minor: 0,
    price: { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 }
  },
  {
    family: "sonnet",
    major: 4,
    minor: 6,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 }
  },
  {
    family: "sonnet",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 }
  },
  {
    family: "sonnet",
    major: 4,
    minor: 0,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 }
  },
  {
    family: "haiku",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.01, cacheWrite: 0.125, input: 0.1, output: 0.5 },
    overAfter: 1e5,
    over: { cacheRead: 0.05, cacheWrite: 0.625, input: 0.5, output: 2.5 }
  },
  {
    family: "haiku",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.1, cacheWrite: 1.25, input: 1, output: 5 }
  },
  {
    family: "haiku",
    major: 3,
    minor: 5,
    price: { cacheRead: 0.08, cacheWrite: 1, input: 0.8, output: 4 }
  }
];
function promptTokens(tokens) {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}
function priceRow(model) {
  const family = claudeFamily(model);
  const version = claudeVersion(model);
  if (family === null || version === null)
    return null;
  return CLAUDE_PRICES.find((candidate) => candidate.family === family && candidate.major === version.major && candidate.minor === version.minor) ?? null;
}
function tierOf(row, tokens) {
  return row.over !== undefined && row.overAfter !== undefined && promptTokens(tokens) > row.overAfter ? row.over : row.price;
}
function costUsd(price, tokens) {
  const usd = (tokens.input * price.input + tokens.output * price.output + tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
function claudeCost(model, tokens) {
  if (tokens === null)
    return null;
  const row = priceRow(model);
  if (row === null)
    return null;
  return { estimated: true, usd: costUsd(tierOf(row, tokens), tokens) };
}

// src/hooks/agent-usage.ts
var AGENT_USAGE_FILE = "agent-usage.jsonl";
function agentUsageFile(stateDir) {
  return join7(stateDir, AGENT_USAGE_FILE);
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function tokensOf(usage) {
  if (!isJsonObject(usage))
    return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
  return {
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    input: count(usage.input_tokens),
    output: count(usage.output_tokens)
  };
}
var UNKNOWN_MODEL = "(unknown)";
function repliesOfTranscript(text, agentId = "") {
  const replies = new Map;
  let unnamed = 0;
  for (const raw of text.split(`
`)) {
    if (raw.trim() === "")
      continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isJsonObject(line) || line.type !== "assistant")
      continue;
    const lineAgent = stringField(line.agentId);
    if (agentId !== "" && lineAgent !== null && lineAgent !== agentId)
      continue;
    const message = line.message;
    if (!isJsonObject(message))
      continue;
    const model = stringField(message.model) ?? UNKNOWN_MODEL;
    const id = stringField(message.id);
    const key = id ?? `line-${unnamed}`;
    if (id === null)
      unnamed += 1;
    if (replies.has(key))
      continue;
    replies.set(key, { model, tokens: tokensOf(message.usage) });
  }
  return replies;
}
function microUsd(sum) {
  return Math.round(sum * 1e6) / 1e6;
}
function modelsOfReplies(replies) {
  const byModel = new Map;
  for (const reply of replies) {
    const one = byModel.get(reply.model) ?? {
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      input: 0,
      model: reply.model,
      output: 0,
      priced: 0,
      replies: 0,
      usd: null
    };
    one.replies += 1;
    one.input += reply.tokens.input;
    one.output += reply.tokens.output;
    one.cacheRead += reply.tokens.cacheRead;
    one.cacheWrite += reply.tokens.cacheWrite;
    const cost = claudeCost(reply.model, reply.tokens);
    if (cost !== null) {
      one.priced += 1;
      one.cost += cost.usd;
    }
    byModel.set(reply.model, one);
  }
  return [...byModel.values()].map(({ priced, cost, ...one }) => ({
    ...one,
    usd: priced === 0 ? null : microUsd(cost)
  })).sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : 0);
}
function agentUsageOf(input, transcript, nowMs) {
  const models = modelsOfReplies(repliesOfTranscript(transcript, stringField(input.agent_id) ?? "").values());
  if (models.length === 0)
    return null;
  const priced = models.filter((one) => one.usd !== null);
  return {
    agent: stringField(input.agent_id) ?? "",
    agentType: stringField(input.agent_type),
    at: nowMs,
    models,
    session: stringField(input.session_id) ?? "",
    unpriced: models.reduce((sum, one) => sum + (one.usd === null ? one.replies : 0), 0),
    usd: priced.length === 0 ? null : microUsd(priced.reduce((sum, one) => sum + (one.usd ?? 0), 0))
  };
}
function said(why) {
  return { stderr: `cc-smart-dev-kit agent-usage: ${why}` };
}
function recordAgentUsage(input, event, paths, nowMs) {
  if (event !== "SubagentStop")
    return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null)
    return said("the input names no agent transcript");
  let text;
  try {
    text = readFileSync5(transcript, "utf8");
  } catch {
    return said("the agent's transcript cannot be read, so its usage is not recorded");
  }
  const usage = agentUsageOf(input, text, nowMs);
  if (usage === null)
    return SILENT;
  try {
    appendJsonLine(agentUsageFile(paths.stateDir), usage);
  } catch (error) {
    return said(`cannot write the record (${error instanceof Error ? error.message : String(error)})`);
  }
  return SILENT;
}

// src/hooks/specs/agent-usage.ts
var agentUsageHook = {
  name: "agent-usage",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, _checkout, context) => recordAgentUsage(input, event, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) => recordAgentUsage(input, event, context.paths, context.nowMs),
  run: ({ input, event, paths, nowMs }) => recordAgentUsage(input, event, paths, nowMs)
};

// src/entries/agent-usage.ts
await runHookEntry(agentUsageHook);
