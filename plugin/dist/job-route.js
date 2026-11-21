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
import { existsSync as existsSync2, realpathSync, statSync } from "fs";
import { join as join3 } from "path";

// src/project/config-facts.ts
import { existsSync } from "fs";

// src/setup/user-json.ts
import { readFileSync } from "fs";
var BOM = "\uFEFF";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}
function readUserJson(file) {
  return parseUserJson(readFileSync(file, "utf8"));
}

// src/project/config-facts.ts
var CONFIG_PATH = ".claude/cc-smart-dev-kit.json";
function readOwnHooks(file) {
  if (!existsSync(file))
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
  const [firstEntry = ""] = list.stdout.split(`

`);
  const lines = firstEntry.split(`
`);
  if (lines.includes("bare"))
    return null;
  const pathLine = lines.find((line) => line.startsWith("worktree "));
  if (!pathLine)
    return null;
  const path = pathLine.slice("worktree ".length);
  if (!existsSync2(path) || lines.some((line) => line.startsWith("prunable"))) {
    throw new Error(`The main checkout of the repo at ${cwd} is missing: ${path} was moved or deleted. ` + 'If you moved it, run "git worktree repair" in its new folder.');
  }
  return realpathSync(path);
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
  const root = realpathSync(parts.top);
  const commonDir = realpathSync(parts.common);
  return { commonDir, isWorktree: realpathSync(parts.gitDir) !== commonDir, root };
}
function locateCheckout(cwd, options = {}) {
  if (!existsSync2(cwd) || !statSync(cwd).isDirectory()) {
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
  const own = join3(root, CONFIG_PATH);
  if (existsSync2(own))
    return own;
  if (mainCheckout === null || mainCheckout === root)
    return null;
  const main = join3(mainCheckout, CONFIG_PATH);
  return existsSync2(main) ? main : null;
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

// src/setup/write.ts
import {
  closeSync,
  existsSync as existsSync3,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync as readFileSync2,
  readlinkSync,
  realpathSync as realpathSync2,
  renameSync,
  statSync as statSync2,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, dirname, join as join4, resolve } from "path";

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

// src/setup/write.ts
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join4(dir, `.${basename(file)}.cc-smart-dev-kit-tmp-${process.pid}-${crypto.randomUUID()}`);
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
    if (existsSync3(temp))
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
    if (existsSync3(temp))
      unlinkSync(temp);
    throw error;
  }
}

// src/setup/lock.ts
var FALLBACK_STALE_MS = 10 * 60 * 1000;

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
  version: "6.3.0",
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
var PARSER_FINGERPRINT = "ecbf12d64fe46194dd034dc713b5e1e608f672cd2abae09ebc3f7dec686bda49";
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
async function loadPersonalWorkflow(paths) {
  try {
    const checked = await loadCheckedFile(paths.workflowConfigFile, "workflow", { paths });
    return checked.ok ? checked.value ?? {} : {};
  } catch {
    return {};
  }
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
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
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
    const note = `cc-smart-dev-kit ${spec.name}: the ask could not be recorded (${errorMessage(error)})`;
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
      return await outside(input, event, errorMessage(error), context);
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
    return crashResult(spec, errorMessage(error), input, event, context);
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

// src/hooks/job-route.ts
import { existsSync as existsSync7 } from "fs";

// src/cli/git-bash.ts
import { win32 } from "path";
var GIT_BASH_VAR = "CLAUDE_CODE_GIT_BASH_PATH";
var ACCEPTED_NAMES = ["bash.exe", "sh.exe", "bash", "sh"];
var GIT_BASH_INSTALLS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
];
function baseName(path) {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}
function variableIsUsable(value, facts) {
  return ACCEPTED_NAMES.includes(baseName(value)) && facts.exists(value);
}
function findGitBash(env, facts) {
  const given = env[GIT_BASH_VAR] ?? "";
  if (given !== "" && variableIsUsable(given, facts)) {
    return { ignoredVariable: null, path: given };
  }
  const ignoredVariable = given === "" ? null : given;
  for (const install of GIT_BASH_INSTALLS) {
    if (facts.exists(install))
      return { ignoredVariable, path: install };
  }
  const git = facts.which("git");
  if (git !== null) {
    const beside = win32.join(win32.dirname(git), "..", "bin", "bash.exe");
    if (facts.exists(beside))
      return { ignoredVariable, path: beside };
  }
  return { ignoredVariable, path: null };
}

// src/jobs/classify.ts
import { isAbsolute, join as join7, normalize } from "path";

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
function shellWord(value) {
  return /^[\w./-]+$/.test(value) ? value : shellQuote(value);
}

// src/shell/command.ts
function dialectOfTool(tool) {
  if (tool === "Bash")
    return "bash";
  if (tool === "PowerShell")
    return "powershell";
  return;
}
var DIALECTS = ["bash", "powershell"];
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
function readingsOf(command, dialect) {
  const readings = [];
  for (const one of dialect === undefined ? DIALECTS : [dialect]) {
    readings.push({ dialect: one, joinLines: false });
    if (new RegExp(CONTINUATION[one].source).test(command)) {
      readings.push({ dialect: one, joinLines: true });
    }
  }
  return readings;
}
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
function shellSegments(command, options = {}) {
  return shellSteps(command, options).map((step) => step.text);
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
function isAssignmentOnly(words) {
  return words.length > 0 && words.every((word) => ASSIGNMENT.test(word));
}
var CHANGE_DIR = new Set([
  "cd",
  "chdir",
  "popd",
  "pushd",
  "set-location",
  "sl"
]);
var REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(?!\()(.*)$/s;
var ANY_REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(.*)$/s;
var textOf = (word) => typeof word === "string" ? word : word.text;
function isProcessSubstitution(word) {
  return /^[<>]\(/.test(textOf(word)) && (typeof word === "string" || word.filled);
}
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
function withoutRedirections(args) {
  const kept = [];
  for (let index = 0;index < args.length; index++) {
    const redirection = REDIRECTION.exec(args[index] ?? "");
    if (redirection === null)
      kept.push(args[index] ?? "");
    else if ((redirection[2] ?? "") === "")
      index++;
  }
  return kept;
}
var WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
function redirectionTargets(words) {
  const targets = [];
  for (let index = 0;index < words.length; index++) {
    const word = words[index] ?? "";
    const known = typeof word !== "string" && !word.filled;
    const redirection = (known ? ANY_REDIRECTION : REDIRECTION).exec(textOf(word));
    if (redirection === null)
      continue;
    const operator = redirection[1] ?? "";
    let target = redirection[2] ?? "";
    const apart = operator === ">" && target === "&";
    if (target === "" || apart) {
      const next = words[++index] ?? "";
      if (isProcessSubstitution(next))
        continue;
      target = apart ? `&${textOf(next)}` : textOf(next);
    }
    if (operator === ">" && target.startsWith("&")) {
      target = /^&(\d+|-)$/.test(target) ? "" : target.slice(1);
    }
    if (WRITING_REDIRECTIONS.has(operator) && target !== "")
      targets.push(target);
  }
  return targets;
}
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
var RUNNER_PROGRAM_NAMES = ["find", "parallel", "su", "watch"];
function isRunnerProgram(program) {
  return RUNNER_PROGRAM_NAMES.includes(program);
}
var AS_ANOTHER_USER_NAMES = ["doas", "pkexec", "su", "sudo"];
function runsAsAnotherUser(invocation) {
  return [invocation.program, ...invocation.prefix].some((word) => AS_ANOTHER_USER_NAMES.includes(programName(word)));
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
function isJobRun(program, args) {
  return jobRunArguments(program, args) !== null;
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

// src/shell/tool.ts
var BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
var NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
var NPM_VALUED = ["--prefix", "-C"];
var PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
var YARN_VALUED = [...PNPM_VALUED, "--cwd"];
var RUNNER_VALUED = {
  bun: BUN_VALUED,
  npm: NPM_VALUED,
  pnpm: PNPM_VALUED,
  yarn: YARN_VALUED
};
var RUNNER_FOLDER_OPTIONS = {
  bun: ["--cwd"],
  npm: ["--prefix", "-C"],
  pnpm: ["-C", "--dir"],
  yarn: ["--cwd"]
};
function runnerFolder(program, head) {
  const names = RUNNER_FOLDER_OPTIONS[program] ?? [];
  for (let index = 0;index < head.length; index++) {
    const word = head[index] ?? "";
    const equals = word.indexOf("=");
    if (!names.includes(equals === -1 ? word : word.slice(0, equals)))
      continue;
    return equals === -1 ? head[index + 1] : word.slice(equals + 1);
  }
  return;
}
function inFolder(call, program, head) {
  const dir = runnerFolder(program, head);
  return dir === undefined ? call : { ...call, dir };
}
var NODE_VALUED = [
  "--conditions",
  "--eval",
  "--import",
  "--input-type",
  "--loader",
  "--print",
  "--require",
  "-C",
  "-e",
  "-p",
  "-r"
];
var TOOL_VALUED = {
  docker: [
    "--config",
    "--context",
    "--host",
    "--log-level",
    "--tlscacert",
    "--tlscert",
    "--tlskey",
    "-c",
    "-H",
    "-l",
    "--builder",
    "--ansi",
    "--env-file",
    "--file",
    "--parallel",
    "--profile",
    "--progress",
    "--project-directory",
    "--project-name",
    "-f",
    "-p"
  ],
  "docker-compose": [
    "--ansi",
    "--env-file",
    "--file",
    "--parallel",
    "--profile",
    "--progress",
    "--project-directory",
    "--project-name",
    "-f",
    "-p"
  ],
  podman: ["--connection", "--url", "--root", "--runroot", "--log-level"]
};
var BUN_COMMANDS = new Set([
  "add",
  "build",
  "create",
  "exec",
  "i",
  "init",
  "install",
  "link",
  "outdated",
  "patch",
  "pm",
  "publish",
  "remove",
  "repl",
  "rm",
  "unlink",
  "update",
  "upgrade"
]);
function firstWord(args, from, valued) {
  let index = from;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    index += valued.includes(args[index] ?? "") ? 2 : 1;
  }
  return Math.min(index, args.length);
}
function toolName(word) {
  const isPath = /[\\/]/.test(word) && !/^@[^\\/]+\/[^\\/]+$/.test(word);
  const base = (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/, "");
  return (isPath ? base.replace(/\.(mjs|cjs|js)$/, "") : base).replace(/(?<=.)@.*$/, "");
}
function scriptOrTool(word, args) {
  return /[\\/]/.test(word) ? { name: toolName(word), args } : { name: toolName(word), args, script: word };
}
function toolOf(program, args, depth = 0) {
  if (depth > 4)
    return;
  const at = (valued, from = 0) => firstWord(args, from, valued);
  if (["bun", "npm", "pnpm", "yarn"].includes(program)) {
    const index = at(RUNNER_VALUED[program] ?? []);
    const sub = args[index];
    if (program === "yarn" && sub === undefined || sub !== undefined && ["install", "i", "add", ...program === "npm" ? ["ci"] : []].includes(sub)) {
      return { name: program, args: sub === undefined ? ["install", ...args] : args.slice(index) };
    }
  }
  switch (program) {
    case "bunx":
    case "npx": {
      const index = at(program === "npx" ? NPX_VALUED : NPX_VALUED.slice(0, 2));
      const name = args[index];
      return name === undefined ? undefined : { name: toolName(name), args: args.slice(index + 1) };
    }
    case "bun": {
      const index = at(BUN_VALUED);
      const sub = args[index];
      if (sub === undefined)
        return;
      if (sub === "x")
        return toolOf("bunx", args.slice(index + 1), depth + 1);
      if (sub === "run") {
        const nameAt = firstWord(args, index + 1, BUN_VALUED);
        const name = args[nameAt];
        if (name === undefined)
          return;
        return inFolder(scriptOrTool(name, args.slice(nameAt + 1)), program, args.slice(0, nameAt));
      }
      if (sub === "test") {
        return { name: "bun", args: ["test", ...args.slice(0, index), ...args.slice(index + 1)] };
      }
      if (BUN_COMMANDS.has(sub))
        return;
      return inFolder(scriptOrTool(sub, args.slice(index + 1)), program, args.slice(0, index));
    }
    case "npm": {
      const index = at(NPM_VALUED);
      const sub = args[index];
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "x")
        return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") {
        return inFolder({ name: "", args: rest, script: "test" }, program, args.slice(0, index));
      }
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, NPM_VALUED);
        const name = rest[nameAt];
        if (name === undefined)
          return;
        const call = { name: "", args: rest.slice(nameAt + 1), script: name };
        return inFolder(call, program, args.slice(0, index + 1 + nameAt));
      }
      return;
    }
    case "pnpm":
    case "yarn": {
      const index = at(RUNNER_VALUED[program] ?? []);
      const sub = args[index];
      if (sub === undefined)
        return;
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "dlx")
        return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") {
        return inFolder({ name: "", args: rest, script: "test" }, program, args.slice(0, index));
      }
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        if (name === undefined)
          return;
        const call = scriptOrTool(name, rest.slice(nameAt + 1));
        return inFolder(call, program, args.slice(0, index + 1 + nameAt));
      }
      return inFolder(scriptOrTool(sub, rest), program, args.slice(0, index));
    }
    case "node": {
      const index = at(NODE_VALUED);
      const script = args[index];
      if (script !== undefined && /[\\/]/.test(script)) {
        return { name: toolName(script), args: args.slice(index + 1) };
      }
      return;
    }
    default:
      return { name: program, args };
  }
}
function hasFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}
function startsWithSub(args, sub, valued) {
  let from = 0;
  for (const word of sub) {
    const index = firstWord(args, from, valued);
    if (args[index] !== word)
      return false;
    from = index + 1;
  }
  return true;
}
function argsHold(args, required) {
  if (required.sub !== undefined && !startsWithSub(args, required.sub, required.valued ?? []))
    return false;
  return required.flags === undefined || required.flags.every((flag) => hasFlag(args, flag));
}
function ruleMatches(rule, call, scriptOnly = false) {
  if ("script" in rule)
    return call.script === rule.script;
  if (scriptOnly)
    return false;
  if (call.name !== rule.tool)
    return false;
  const valued = [...TOOL_VALUED[rule.tool] ?? [], ...rule.valued ?? []];
  if (!argsHold(call.args, { flags: rule.flags, sub: rule.sub, valued }))
    return false;
  const text = rule.argIncludes?.toLowerCase();
  return text === undefined || call.args.some((arg) => arg.toLowerCase().includes(text));
}

// src/jobs/kind-defaults.ts
var LIGHT_FILE_LIMIT = 10;
var TSC_PRINT_ONLY = ["--help", "--listfilesonly", "--showconfig", "--version", "-h", "-v"];
var TEST_PRINT_ONLY = ["--help", "--version", "-h", "-v"];
var TEST_VALUED_FLAGS = [
  "--bail",
  "--config",
  "--coverageDirectory",
  "--dir",
  "--environment",
  "--env",
  "--exclude",
  "--hookTimeout",
  "--maxWorkers",
  "--minWorkers",
  "--mode",
  "--outputFile",
  "--pool",
  "--project",
  "--reporter",
  "--reporters",
  "--retry",
  "--root",
  "--rootDir",
  "--roots",
  "--selectProjects",
  "--shard",
  "--testEnvironment",
  "--testNamePattern",
  "--testPathIgnorePatterns",
  "--testPathPattern",
  "--testTimeout",
  "-c",
  "-r",
  "-t",
  "-w"
];
var TEST_BARE_FLAGS = [
  "--ci",
  "--detectOpenHandles",
  "--forceExit",
  "--no-cache",
  "--no-color",
  "--passWithNoTests",
  "--run",
  "--runInBand",
  "--updateSnapshot",
  "--verbose",
  "-i"
];
var TSC_OPTIONS = {
  valued: [
    "--baseUrl",
    "--charset",
    "--checkers",
    "--customConditions",
    "--declarationDir",
    "--excludeDirectories",
    "--excludeFiles",
    "--fallbackPolling",
    "--generateCpuProfile",
    "--generateTrace",
    "--ignoreDeprecations",
    "--jsx",
    "--jsxFactory",
    "--jsxFragmentFactory",
    "--jsxImportSource",
    "--lib",
    "--locale",
    "--mapRoot",
    "--maxNodeModuleJsDepth",
    "--module",
    "--moduleDetection",
    "--moduleResolution",
    "--moduleSuffixes",
    "--newLine",
    "--outDir",
    "--outFile",
    "--plugins",
    "--pprofDir",
    "--reactNamespace",
    "--rootDir",
    "--rootDirs",
    "--sourceRoot",
    "--target",
    "--tsBuildInfoFile",
    "--typeRoots",
    "--types",
    "--watchDirectory",
    "--watchFile",
    "--watchInterval",
    "-m",
    "-t"
  ],
  bare: [
    "--allowArbitraryExtensions",
    "--allowImportingTsExtensions",
    "--allowJs",
    "--allowSyntheticDefaultImports",
    "--allowUmdGlobalAccess",
    "--allowUnreachableCode",
    "--allowUnusedLabels",
    "--alwaysStrict",
    "--checkJs",
    "--composite",
    "--declaration",
    "--declarationMap",
    "--deduplicatePackages",
    "--diagnostics",
    "--disableSizeLimit",
    "--downlevelIteration",
    "--emitBOM",
    "--emitDeclarationOnly",
    "--emitDecoratorMetadata",
    "--erasableSyntaxOnly",
    "--esModuleInterop",
    "--exactOptionalPropertyTypes",
    "--experimentalDecorators",
    "--explainFiles",
    "--extendedDiagnostics",
    "--forceConsistentCasingInFileNames",
    "--ignoreConfig",
    "--importHelpers",
    "--incremental",
    "--inlineSourceMap",
    "--inlineSources",
    "--isolatedDeclarations",
    "--isolatedModules",
    "--libReplacement",
    "--listEmittedFiles",
    "--listFiles",
    "--noCheck",
    "--noEmit",
    "--noEmitHelpers",
    "--noEmitOnError",
    "--noErrorTruncation",
    "--noFallthroughCasesInSwitch",
    "--noImplicitAny",
    "--noImplicitOverride",
    "--noImplicitReturns",
    "--noImplicitThis",
    "--noLib",
    "--noPropertyAccessFromIndexSignature",
    "--noResolve",
    "--noUncheckedIndexedAccess",
    "--noUncheckedSideEffectImports",
    "--noUnusedLocals",
    "--noUnusedParameters",
    "--preserveConstEnums",
    "--preserveSymlinks",
    "--preserveWatchOutput",
    "--pretty",
    "--quiet",
    "--removeComments",
    "--resolveJsonModule",
    "--resolvePackageJsonExports",
    "--resolvePackageJsonImports",
    "--rewriteRelativeImportExtensions",
    "--singleThreaded",
    "--skipDefaultLibCheck",
    "--skipLibCheck",
    "--sourceMap",
    "--stableTypeOrdering",
    "--strict",
    "--strictBindCallApply",
    "--strictBuiltinIteratorReturn",
    "--strictFunctionTypes",
    "--strictNullChecks",
    "--strictPropertyInitialization",
    "--stripInternal",
    "--traceResolution",
    "--useDefineForClassFields",
    "--useUnknownInCatchVariables",
    "--verbatimModuleSyntax",
    "-d",
    "-i",
    "-q"
  ],
  watch: { flags: ["--watch", "-w"], ignoreCase: true }
};
var VITEST_OPTIONS = {
  valued: [
    "--attachmentsDir",
    "--config",
    "--configLoader",
    "--dir",
    "--environment",
    "--exclude",
    "--execArgv",
    "--hookTimeout",
    "--maxConcurrency",
    "--maxWorkers",
    "--minWorkers",
    "--mode",
    "--outputFile",
    "--pool",
    "--project",
    "--reporter",
    "--repeats",
    "--retry",
    "--retry.count",
    "--root",
    "--sequence.hooks",
    "--sequence.seed",
    "--sequence.setupFiles",
    "--shard",
    "--slowTestThreshold",
    "--tagsFilter",
    "--teardownTimeout",
    "--testNamePattern",
    "--testTimeout",
    "--vmMemoryLimit",
    "-c",
    "-p",
    "-r",
    "-t"
  ],
  bare: [
    "--allowOnly",
    "--cache",
    "--clearScreen",
    "--detectAsyncLeaks",
    "--disableConsoleIntercept",
    "--expandSnapshotDiff",
    "--fileParallelism",
    "--globals",
    "--hideSkippedTests",
    "--includeTaskLocation",
    "--isolate",
    "--last-failed",
    "--lastFailed",
    "--logHeapUsage",
    "--no-cache",
    "--no-color",
    "--no-file-parallelism",
    "--no-isolate",
    "--passWithNoTests",
    "--printConsoleTrace",
    "--run",
    "--sequence.concurrent",
    "--sequence.shuffle.files",
    "--sequence.shuffle.tests"
  ],
  skip: ["run"],
  watch: { flags: ["--watch", "-w"], commands: ["watch", "dev"] }
};
var JEST_OPTIONS = {
  valued: [
    "--changedSince",
    "--collectCoverageFrom",
    "--config",
    "--coverageDirectory",
    "--coverageProvider",
    "--env",
    "--filter",
    "--maxConcurrency",
    "--maxWorkers",
    "--openHandlesTimeout",
    "--outputFile",
    "--rootDir",
    "--seed",
    "--shard",
    "--testEnvironment",
    "--testEnvironmentOptions",
    "--testNamePattern",
    "--testRunner",
    "--testSequencer",
    "--testTimeout",
    "--workerGracefulExitTimeout",
    "-c",
    "-t",
    "-w"
  ],
  bare: [
    "--cache",
    "--changedFilesWithAncestor",
    "--ci",
    "--clearMocks",
    "--colors",
    "--debug",
    "--detectOpenHandles",
    "--errorOnDeprecated",
    "--expand",
    "--forceExit",
    "--injectGlobals",
    "--json",
    "--lastCommit",
    "--listTests",
    "--logHeapUsage",
    "--no-cache",
    "--no-watchman",
    "--noStackTrace",
    "--notify",
    "--onlyChanged",
    "--onlyFailures",
    "--passWithNoTests",
    "--randomize",
    "--resetMocks",
    "--restoreMocks",
    "--runInBand",
    "--runTestsByPath",
    "--showSeed",
    "--silent",
    "--testLocationInResults",
    "--updateSnapshot",
    "--useStderr",
    "--verbose",
    "--waitForUnhandledRejections",
    "--watchman",
    "--workerThreads",
    "-e",
    "-f",
    "-i",
    "-o",
    "-u"
  ],
  watch: { flags: ["--watch", "--watchAll"] }
};
var BUN_TEST_OPTIONS = {
  valued: [
    "--coverage-dir",
    "--coverage-reporter",
    "--max-concurrency",
    "--parallel-delay",
    "--path-ignore-patterns",
    "--rerun-each",
    "--reporter",
    "--reporter-outfile",
    "--retry",
    "--seed",
    "--shard",
    "--test-name-pattern",
    "--timeout",
    "--timings",
    "-t"
  ],
  bare: [
    "--check",
    "--concurrent",
    "--dots",
    "--isolate",
    "--no-isolate",
    "--no-orphans",
    "--only",
    "--only-failures",
    "--pass-with-no-tests",
    "--randomize",
    "--todo",
    "--update-snapshots",
    "--update-timings",
    "-u"
  ],
  skip: ["test"],
  isOperand: (word) => word.startsWith("./") || word.startsWith("/"),
  watch: { flags: ["--watch"] }
};
var PLAYWRIGHT_OPTIONS = {
  valued: [
    "--add-reporter",
    "--browser",
    "--config",
    "--global-timeout",
    "--grep",
    "--grep-invert",
    "--last-failed-file",
    "--max-failures",
    "--output",
    "--project",
    "--repeat-each",
    "--reporter",
    "--retries",
    "--run-agents",
    "--shard",
    "--test-list",
    "--test-list-invert",
    "--timeout",
    "--trace",
    "--tsconfig",
    "--ui-host",
    "--ui-port",
    "--update-source-method",
    "--workers",
    "-c",
    "-G",
    "-g",
    "-j"
  ],
  bare: [
    "--fail-on-flaky-tests",
    "--forbid-only",
    "--fully-parallel",
    "--headed",
    "--ignore-snapshots",
    "--last-failed",
    "--no-deps",
    "--pass-with-no-tests",
    "--quiet",
    "--ui",
    "-x"
  ],
  skip: ["test"],
  watch: { flags: ["--debug", "--ui", "--ui-host", "--ui-port"] }
};
var TOOL_OPTIONS = {
  bun: BUN_TEST_OPTIONS,
  jest: JEST_OPTIONS,
  playwright: PLAYWRIGHT_OPTIONS,
  tsc: TSC_OPTIONS,
  tsgo: TSC_OPTIONS,
  vitest: VITEST_OPTIONS,
  "vue-tsc": TSC_OPTIONS
};
var DEFAULT_KINDS = {
  tsc: {
    about: "A TypeScript type check (tsc, tsgo, vue-tsc). A run on named files runs at once, with no slot.",
    printOnly: TSC_PRINT_ONLY,
    noSlotForFiles: true,
    match: [{ tool: "tsc" }, { tool: "tsgo" }, { tool: "vue-tsc" }]
  },
  "lint:typed": {
    about: "A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "eslint", argIncludes: "typed" },
      { tool: "eslint", argIncludes: "type-checked" },
      { tool: "oxlint", flags: ["--type-aware"] }
    ]
  },
  "test:coverage": {
    about: "A test run with coverage (vitest, jest or bun test with --coverage).",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" },
      { tool: "bun", sub: ["test"], argIncludes: "--coverage" }
    ]
  },
  "test:run": {
    about: "A test run (vitest, jest, bun test). A run on named test files runs at once, with no slot.",
    printOnly: TEST_PRINT_ONLY,
    noSlotForFiles: true,
    match: [{ tool: "vitest" }, { tool: "jest" }, { tool: "bun", sub: ["test"] }]
  },
  e2e: {
    about: "An end-to-end test run (playwright test). Every run takes a slot, one spec file too: it starts the app and its browsers.",
    printOnly: ["--list", "--help", "-h"],
    match: [{ tool: "playwright", sub: ["test"] }]
  },
  build: {
    about: "A framework production build (next build).",
    match: [{ tool: "next", sub: ["build"] }]
  },
  "image:build": {
    about: "A container image build (docker, podman, compose).",
    match: [
      { tool: "docker", sub: ["build"] },
      { tool: "docker", sub: ["image", "build"] },
      { tool: "docker", sub: ["builder", "build"] },
      { tool: "docker", sub: ["buildx", "build"] },
      { tool: "docker", sub: ["buildx", "b"] },
      { tool: "docker", sub: ["buildx", "bake"] },
      { tool: "docker", sub: ["compose", "build"] },
      { tool: "docker", sub: ["compose", "up"], flags: ["--build"] },
      { tool: "docker", sub: ["compose", "run"], flags: ["--build"] },
      { tool: "docker", sub: ["compose", "create"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["build"] },
      { tool: "docker-compose", sub: ["up"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["run"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["create"], flags: ["--build"] },
      { tool: "podman", sub: ["build"] },
      { tool: "podman", sub: ["image", "build"] },
      { tool: "buildah", sub: ["build"] }
    ]
  }
};
function mergeKinds(projectKinds) {
  return { ...DEFAULT_KINDS, ...projectKinds ?? {} };
}
function isPrintOnly(kind, args) {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  return args.some((arg) => printOnly.has(arg.toLowerCase()));
}
function namesOnlyFiles(kind, args, isFile, tool) {
  if (kind.noSlotForFiles !== true)
    return false;
  const table = tool === undefined ? undefined : TOOL_OPTIONS[tool];
  const skip = new Set([...kind.skipWords ?? [], ...table?.skip ?? []]);
  const valued = new Set([...table?.valued ?? TEST_VALUED_FLAGS, ...kind.valuedFlags ?? []]);
  const bare = new Set(table?.bare ?? TEST_BARE_FLAGS);
  let index = 0;
  while (index < args.length && skip.has(args[index] ?? ""))
    index++;
  const operands = [];
  let optionsEnded = false;
  for (;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!optionsEnded && arg === "--")
      optionsEnded = true;
    else if (!optionsEnded && arg.startsWith("-")) {
      if (arg.includes("=") || bare.has(arg))
        continue;
      if (!valued.has(arg))
        return false;
      index++;
    } else
      operands.push(arg);
  }
  const names = table?.isOperand;
  return operands.length > 0 && operands.length <= LIGHT_FILE_LIMIT && operands.every((word) => (names === undefined || names(word)) && isFile(word));
}
function isWatchRun(tool, args) {
  const watch = TOOL_OPTIONS[tool]?.watch;
  if (watch === undefined)
    return false;
  const fold = (word) => watch.ignoreCase === true ? word.toLowerCase() : word;
  for (const arg of args) {
    if (arg === "--")
      break;
    const [flag = "", value] = arg.split("=", 2);
    if (watch.flags.includes(fold(flag)) && value !== "false" && value !== "0")
      return true;
  }
  if (watch.commands === undefined)
    return false;
  const valued = new Set(TOOL_OPTIONS[tool]?.valued);
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-"))
      return watch.commands.includes(arg);
    if (valued.has(arg))
      index++;
  }
  return false;
}

// src/jobs/classify.ts
function runOf(source) {
  return {
    source,
    folder: source?.folder ?? null,
    cache: new Map,
    runner: undefined,
    extra: undefined,
    compound: false,
    reading: [],
    printOk: false,
    step: "",
    pipeFed: false
  };
}
function scriptsAt(run, folder) {
  if (run.source === undefined || folder === null)
    return null;
  if (!run.cache.has(folder)) {
    let found = null;
    try {
      found = run.source.scriptsIn(folder);
    } catch {
      found = null;
    }
    run.cache.set(folder, found);
  }
  return run.cache.get(folder) ?? null;
}
var CD_OPTIONS = new Set(["-L", "-P", "-e", "-@", "--"]);
var COMPUTED_FOLDER = /[$`*?[\]{}~]/;
function folderWord(args) {
  let index = 0;
  while (CD_OPTIONS.has(args[index] ?? ""))
    index++;
  return args[index];
}
function resolveFolder(folder, target) {
  if (target === undefined || target === "-" || COMPUTED_FOLDER.test(target))
    return null;
  if (isAbsolute(target))
    return normalize(target);
  return folder === null ? null : normalize(join7(folder, target));
}
function folderAfter(program, args, folder) {
  if (folder === null)
    return null;
  if (program !== "cd" && program !== "chdir" && program !== "pushd")
    return null;
  return resolveFolder(folder, folderWord(args));
}
function matchOfCall(call, kinds, scriptOnly) {
  let printing = null;
  for (const [name, kind] of Object.entries(kinds)) {
    const rules = (kind.match ?? []).filter((rule) => ruleMatches(rule, call, scriptOnly));
    if (rules.length === 0)
      continue;
    if (rules.some((rule) => ("script" in rule))) {
      return { kind: name, tool: undefined, printOnly: false };
    }
    const hit = { kind: name, tool: call.name, printOnly: isPrintOnly(kind, call.args) };
    if (!hit.printOnly)
      return hit;
    printing ??= hit;
  }
  return printing;
}
var newScan = () => ({
  found: [],
  background: false,
  queued: false,
  stray: null,
  opaque: false,
  unread: null
});
var LONE_AMPERSAND = /(?<![&|>])&(?![&>])/;
function sendsToBackground(command, steps) {
  let at = 0;
  for (const step of steps) {
    if (step.text === "")
      continue;
    const start = command.indexOf(step.text, at);
    if (start === -1 || LONE_AMPERSAND.test(command.slice(at, start)))
      return true;
    at = start + step.text.length;
  }
  return LONE_AMPERSAND.test(command.slice(at));
}
var NPM_EXECPATH = /^\$\{?npm_execpath\}?$/;
function isOneCommand(body) {
  const steps = shellSteps(body, { blindWhenOpen: true, dialect: "bash", joinLines: true });
  return steps.map((step) => wordsOf(step.text)).filter((words) => words.length > 0 && !isAssignmentOnly(words)).length === 1;
}
function expandScript(call, runner, bodies, lookedUpIn, kinds, depth, run, all, out) {
  if (depth >= MAX_NESTING)
    return opaque(out, "unreadable");
  const name = call.script ?? "";
  const folder = bodies.folder ?? lookedUpIn;
  const hooks = !(runner === "yarn" && bodies.yarnBerry === true);
  const parts = [hooks ? `pre${name}` : "", name, hooks ? `post${name}` : ""].filter((part) => bodies.has(part));
  const main = bodies.get(name) ?? "";
  const one = parts.length === 1 && isOneCommand(main);
  for (const part of parts) {
    const key = JSON.stringify([folder, part]);
    if (run.reading.includes(key)) {
      if (all)
        return opaque(out, "unreadable");
      out.unread ??= "unreadable";
      continue;
    }
    const inside = {
      ...run,
      folder,
      runner,
      extra: part === name ? call.args : undefined,
      compound: run.compound || !one,
      reading: [...run.reading, key]
    };
    if (!scan(bodies.get(part) ?? "", kinds, "bash", depth + 1, inside, all, out) && all) {
      return opaque(out, "unreadable");
    }
  }
  return true;
}
function opaque(out, why) {
  out.opaque = true;
  out.unread ??= why;
  return false;
}
function refuse(run, out, step) {
  if (run.reading.length > 0)
    return opaque(out, "not-heavy");
  out.stray ??= step.text.trim();
  return false;
}
function scriptArgs(args, runner, bodies) {
  const at = args.indexOf("--");
  if (runner === "npm") {
    const own = at === -1 ? args : args.slice(0, at);
    const after = at === -1 ? [] : args.slice(at + 1);
    return [...own.filter((word) => word === "-" || !word.startsWith("-")), ...after];
  }
  if (at === -1)
    return args;
  const anywhere = runner === "yarn" && bodies.yarnBerry !== true;
  const leading = runner === "bun" || runner === "yarn" && bodies.yarnBerry === true;
  const drops = anywhere || leading && at === 0;
  return drops ? [...args.slice(0, at), ...args.slice(at + 1)] : args;
}
function matchCall(asked, runner, kinds, depth, run, all, out) {
  const lookedUpIn = asked.dir === undefined ? run.folder : resolveFolder(run.folder, asked.dir);
  const bodies = asked.script === undefined ? null : scriptsAt(run, lookedUpIn);
  const isScript = asked.script !== undefined && bodies?.has(asked.script) === true;
  const call = isScript && bodies !== null ? { ...asked, args: scriptArgs(asked.args, runner, bodies) } : asked;
  const hit = matchOfCall(call, kinds, isScript);
  if (hit !== null) {
    if (all && hit.printOnly && !run.printOk)
      return false;
    const folder = hit.tool === undefined ? bodies?.folder ?? lookedUpIn : lookedUpIn;
    out.found.push({ ...hit, call, folder, compound: run.compound, text: run.step });
    return true;
  }
  if (!isScript || bodies === null)
    return false;
  return expandScript(call, runner, bodies, lookedUpIn, kinds, depth, run, all, out);
}
function scan(command, kinds, dialect, depth, run, all, out) {
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  if (sendsToBackground(command, steps))
    out.background = true;
  for (const step of steps) {
    const words = wordsOf(step.text, dialect);
    if (all && (words.length === 0 || isAssignmentOnly(words)))
      continue;
    if (run.reading.length === 0 && !run.pipeFed)
      run.step = step.text.trim();
    const invocation = invocationOf(words);
    if (invocation === undefined) {
      if (!all)
        continue;
      if (dialect === "bash" && withoutRedirections(words).length === 0 && !readsAFile(words)) {
        continue;
      }
      return refuse(run, out, step);
    }
    const { args } = invocation;
    const program = run.runner !== undefined && NPM_EXECPATH.test(invocation.program) ? run.runner : invocation.program;
    const plain = withoutRedirections(args);
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    if (all && runsAsAnotherUser(invocation)) {
      const asked = newScan();
      scan(step.text, kinds, dialect, depth + 1, { ...run }, false, asked);
      return takesSlot(asked, kinds, run.source) ? opaque(out, "other-user") : refuse(run, out, step);
    }
    if (all && isRunnerProgram(program))
      return refuse(run, out, step);
    if (!all && runsAsAnotherUser(invocation))
      out.unread ??= "other-user";
    if (!all && isRunnerProgram(program))
      out.unread ??= "runner";
    if (isJobRun(program, args))
      out.queued = true;
    const inner = nestedCommand(program, args, step.pipedFrom);
    const pipeFed = inner !== undefined && step.pipedFrom !== null && nestedCommand(program, args) === undefined;
    const readInner = (line) => depth < MAX_NESTING ? scan(line, kinds, nestedDialect(program), depth + 1, {
      ...run,
      extra: undefined,
      pipeFed: run.pipeFed || pipeFed,
      step: pipeFed ? null : run.step
    }, all, out) : opaque(out, "unreadable");
    if (all && inner !== undefined) {
      if (pipeFed)
        return refuse(run, out, step);
      if (!readInner(inner))
        return false;
      continue;
    }
    const call = toolOf(program, run.extra === undefined ? plain : [...plain, ...run.extra]);
    const before = out.found.length;
    const heavy = call !== undefined && matchCall(call, program, kinds, depth, run, all, out);
    if (all && !heavy && !(dialect === "bash" && isGlueCommand(step))) {
      if (out.opaque && run.reading.length === 0) {
        const body = newScan();
        if (call !== undefined)
          matchCall(call, program, kinds, depth, { ...run }, false, body);
        if (!takesSlot(body, kinds, run.source)) {
          if (out.found.length === before)
            out.opaque = false;
        } else if (out.unread === "not-heavy" && body.unread === null && !body.background) {
          const taking = canWeigh(run.source) ? slotRun(body, kinds, run.source) : undefined;
          const heavyRuns = body.found.filter((one) => !one.printOnly);
          out.found.length = before;
          out.found.push(...typeof taking === "object" ? [taking, ...heavyRuns.filter((one) => one !== taking)] : heavyRuns);
          out.queued ||= body.queued;
          out.opaque = false;
          out.unread = null;
          continue;
        }
      }
      return out.opaque ? false : refuse(run, out, step);
    }
    if (inner !== undefined)
      readInner(inner);
  }
  return true;
}
function classifyHeavyCommand(command, kinds, source, dialect = "bash") {
  return readHeavy(command, kinds, source, dialect).kind;
}
function readHeavy(command, kinds, source, dialect) {
  const out = newScan();
  scan(command, kinds, dialect, 0, runOf(source), false, out);
  return { kind: out.found.find((one) => !one.printOnly)?.kind ?? null, queued: out.queued };
}
function classifyUnqueuedHeavy(command, kinds, source, dialect = "bash") {
  const { kind, queued } = readHeavy(command, kinds, source, dialect);
  return queued ? null : kind;
}
function isLight(one, kinds, source) {
  if (one.printOnly)
    return true;
  const spec = kinds[one.kind];
  const { folder } = one;
  if (spec === undefined || folder === null || one.compound)
    return false;
  return namesOnlyFiles(spec, one.call.args, (word) => source.isFile(folder, word), one.tool);
}
function runWeight(line, kinds, source) {
  const out = newScan();
  const run = runOf(source);
  scan(line, kinds, "bash", 0, run, false, out);
  const { found } = out;
  const first = found[0];
  const slot = slotRun(out, kinds, source);
  if (first === undefined || slot === "none")
    return { weight: "none" };
  if (slot !== "light")
    return { weight: "heavy", kind: slot.kind };
  if (!everyCommandUnderstood(line, kinds, source, run.cache)) {
    return { weight: "heavy", kind: first.kind };
  }
  return found.length > 1 && out.background ? { weight: "heavy", kind: first.kind } : { weight: "light" };
}
function canWeigh(source) {
  return source !== undefined && "isFile" in source;
}
function takesSlot(out, kinds, source) {
  if (canWeigh(source))
    return typeof slotRun(out, kinds, source) === "object";
  return out.found.some((one) => !one.printOnly);
}
function slotRun(out, kinds, source) {
  const { found } = out;
  if (found[0] === undefined || out.queued)
    return "none";
  if (found.some((one) => one.tool !== undefined && isWatchRun(one.tool, one.call.args))) {
    return "none";
  }
  return found.find((one) => !isLight(one, kinds, source)) ?? "light";
}
function everyCommandUnderstood(line, kinds, source, cache) {
  const run = { ...runOf(source), cache, printOk: true };
  return scan(cutAtFilters(line).heavy, kinds, "bash", 0, run, true, newScan());
}
var READS_ONLY = () => true;
var isOption = (arg) => arg.startsWith("-") && arg !== "-";
var isShortCluster = (arg) => /^-[^-]/.test(arg);
function readsFileByOption(shape, arg) {
  if (arg.startsWith("--")) {
    const name = arg.split("=")[0] ?? arg;
    return name.length >= 3 && shape.readsLong?.some((long) => long.startsWith(name)) === true;
  }
  return [...arg.slice(1)].some((letter) => shape.readsShort?.includes(letter) === true);
}
function readerWords(shape, args) {
  let words = 0;
  let scripted = false;
  let optionsEnded = false;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-")
      continue;
    if (optionsEnded || !isOption(arg)) {
      words++;
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (readsFileByOption(shape, arg))
      return null;
    if (arg.startsWith("--")) {
      const name = arg.split("=")[0] ?? arg;
      if (name === shape.script?.long)
        scripted = true;
      if (!arg.includes("=") && shape.longValued?.includes(name) === true)
        index++;
      continue;
    }
    for (let at = 1;at < arg.length; at++) {
      const letter = arg.charAt(at);
      if (letter === shape.script?.short)
        scripted = true;
      if (!shape.valued.includes(letter))
        continue;
      if (at === arg.length - 1)
        index++;
      break;
    }
  }
  return { scripted, words };
}
function readsStdinOnly(shape, args) {
  const found = readerWords(shape, args);
  return found !== null && found.words <= (found.scripted ? 0 : shape.operands);
}
var NO_WORDS = { operands: 0, valued: "" };
var HEAD_TAIL_SHAPE = {
  operands: 0,
  valued: "nc",
  longValued: ["--lines", "--bytes"]
};
var CUT_SHAPE = {
  operands: 0,
  valued: "bcdf",
  longValued: ["--bytes", "--characters", "--delimiter", "--fields", "--output-delimiter"]
};
var FILES0_LIST = ["--files0-from"];
var SORT_SHAPE = {
  operands: 0,
  valued: "kStT",
  longValued: ["--key", "--field-separator", "--buffer-size", "--temporary-directory"],
  readsLong: FILES0_LIST
};
var UNIQ_SHAPE = {
  operands: 0,
  valued: "fsw",
  longValued: ["--skip-fields", "--skip-chars", "--check-chars"]
};
var GREP_SHAPE = {
  operands: 1,
  valued: "emABCD",
  longValued: ["--regexp", "--max-count", "--after-context", "--before-context", "--context"],
  script: { short: "e", long: "--regexp" },
  readsShort: "rRfd",
  readsLong: [
    "--recursive",
    "--dereference-recursive",
    "--file",
    "--exclude-from",
    "--directories"
  ]
};
var AWK_SHAPE = { operands: 1, valued: "Fv" };
var SED_SCRIPT = { short: "e", long: "--expression" };
var SED_LENGTH = { short: "l", long: "--line-length" };
var SED_SHAPE = {
  operands: 1,
  valued: SED_SCRIPT.short + SED_LENGTH.short,
  longValued: [SED_SCRIPT.long, SED_LENGTH.long],
  script: SED_SCRIPT
};
function catReadsStdin(args) {
  return args.every((arg) => arg === "-" || isOption(arg));
}
function teeWritesNoFile(args) {
  return args.every((arg) => isOption(arg) || arg === "/dev/null");
}
function sortReadsOnly(args) {
  return !args.some((arg) => arg.startsWith("--o") || arg.startsWith("--co") || isShortCluster(arg) && arg.includes("o"));
}
function uniqReadsOnly(args) {
  const read = readerWords(UNIQ_SHAPE, args);
  if (read === null)
    return false;
  return read.words + args.filter((arg) => arg === "-").length <= 1;
}
function rgReadsOnly(args) {
  return !args.some((arg) => arg.startsWith("--pre") || arg.startsWith("--hostname-bin") || arg === "--search-zip" || isShortCluster(arg) && arg.includes("z"));
}
var SED_SHORT = /^-[nErsuz]+$/;
var SED_LONG = new Set([
  "--debug",
  "--null-data",
  "--posix",
  "--quiet",
  "--regexp-extended",
  "--sandbox",
  "--separate",
  "--silent",
  "--unbuffered"
]);
var SED_PLAIN_COMMANDS = "=DdGgHhNnPpQqxz}";
function sedPartEnd(script, from, delimiter) {
  let at = from;
  while (at < script.length) {
    const char = script.charAt(at);
    if (char === "\\")
      at += 2;
    else if (char === delimiter)
      return at;
    else if (char === `
`)
      return -1;
    else
      at++;
  }
  return -1;
}
function sedBracketsPlain(part, delimiter) {
  let at = 0;
  while (at < part.length) {
    const char = part.charAt(at);
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char !== "[") {
      at++;
      continue;
    }
    let inside = at + 1;
    if (part.charAt(inside) === "^")
      inside++;
    const first = inside;
    while (inside < part.length && part.charAt(inside) !== "]") {
      const one = part.charAt(inside);
      if (one === "[" || one === "\\" || one === `
` || one === delimiter)
        return false;
      inside++;
    }
    if (inside === first || inside >= part.length)
      return false;
    at = inside + 1;
  }
  return true;
}
function sedAddressEnd(script, at) {
  const number = /^(?:\d+(?:~\d+)?|\$|[+~]\d+)/.exec(script.slice(at));
  if (number !== null)
    return at + number[0].length;
  if (script.charAt(at) !== "/")
    return at;
  const end = sedPartEnd(script, at + 1, "/");
  if (end === -1 || !sedBracketsPlain(script.slice(at + 1, end), "/"))
    return -1;
  return end + 1;
}
function sedScriptReadsOnly(script) {
  let at = 0;
  const skip = (chars) => {
    while (at < script.length && chars.test(script.charAt(at)))
      at++;
  };
  while (true) {
    skip(/[\s;]/);
    if (at >= script.length)
      return true;
    at = sedAddressEnd(script, at);
    if (at === -1)
      return false;
    if (script.charAt(at) === ",") {
      const end = sedAddressEnd(script, at + 1);
      if (end === -1 || end === at + 1)
        return false;
      at = end;
    }
    skip(/[ \t]/);
    if (script.charAt(at) === "!")
      at++;
    skip(/[ \t]/);
    const command = script.charAt(at);
    at++;
    if (command === "s" || command === "y") {
      const delimiter = script.charAt(at);
      if (delimiter === "" || /[\s\\]/.test(delimiter))
        return false;
      const middle = sedPartEnd(script, at + 1, delimiter);
      if (middle === -1)
        return false;
      if (!sedBracketsPlain(script.slice(at + 1, middle), delimiter))
        return false;
      const end = sedPartEnd(script, middle + 1, delimiter);
      if (end === -1)
        return false;
      at = end + 1;
      if (command === "s") {
        const flags = /^[gpiImM0-9]*/.exec(script.slice(at))?.[0] ?? "";
        at += flags.length;
      }
    } else if (command === "{") {
      continue;
    } else if (command !== "" && SED_PLAIN_COMMANDS.includes(command)) {
      if (command === "q" || command === "Q")
        skip(/\d/);
    } else {
      return false;
    }
    skip(/[ \t]/);
    const next = script.charAt(at);
    if (next !== "" && next !== ";" && next !== `
` && next !== "}")
      return false;
  }
}
function sedReadsOnly(args) {
  const scripts = [];
  const operands = [];
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    const expression = new RegExp(`^-[nErsuz]*${SED_SCRIPT.short}(.*)$`, "s").exec(arg);
    if (expression !== null) {
      const value = expression[1] === "" ? args[++index] : expression[1];
      if (value === undefined)
        return false;
      scripts.push(value);
    } else if (arg === SED_SCRIPT.long) {
      const value = args[++index];
      if (value === undefined)
        return false;
      scripts.push(value);
    } else if (arg.startsWith(`${SED_SCRIPT.long}=`)) {
      scripts.push(arg.slice(SED_SCRIPT.long.length + 1));
    } else if (arg.startsWith(`${SED_LENGTH.long}=`) && /^\d+$/.test(arg.slice(SED_LENGTH.long.length + 1))) {} else if (arg === `-${SED_LENGTH.short}` && /^\d+$/.test(args[index + 1] ?? "")) {
      index++;
    } else if (SED_SHORT.test(arg) || SED_LONG.has(arg)) {} else if (isOption(arg)) {
      return false;
    } else {
      operands.push(arg);
    }
  }
  if (scripts.length === 0) {
    const script = operands.shift();
    if (script === undefined)
      return false;
    scripts.push(script);
  }
  return scripts.every(sedScriptReadsOnly);
}
var AWK_OPENS_FILES = /getline|ARG[CV]/;
function awkReadsOnly(args) {
  let program;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      program = args[index + 1];
      break;
    }
    const takesValue = isOption(arg) && !arg.startsWith("--") && AWK_SHAPE.valued.includes(arg.charAt(1));
    if (takesValue && arg.length === 2)
      index++;
    else if (takesValue && arg.length > 2)
      continue;
    else if (isOption(arg))
      return false;
    else {
      program = arg;
      break;
    }
  }
  return program !== undefined && !/[>|@]|system/.test(program) && !AWK_OPENS_FILES.test(program);
}
var READ_ONLY_FILTERS = {
  awk: { check: awkReadsOnly, shape: AWK_SHAPE },
  cat: { check: catReadsStdin, shape: NO_WORDS },
  cut: { check: READS_ONLY, shape: CUT_SHAPE },
  egrep: { check: READS_ONLY, shape: GREP_SHAPE },
  fgrep: { check: READS_ONLY, shape: GREP_SHAPE },
  gawk: { check: awkReadsOnly, shape: AWK_SHAPE },
  grep: { check: READS_ONLY, shape: GREP_SHAPE },
  head: { check: READS_ONLY, shape: HEAD_TAIL_SHAPE },
  mawk: { check: awkReadsOnly, shape: AWK_SHAPE },
  nawk: { check: awkReadsOnly, shape: AWK_SHAPE },
  rg: { check: rgReadsOnly, shape: null },
  sed: { check: sedReadsOnly, shape: SED_SHAPE },
  sort: { check: sortReadsOnly, shape: SORT_SHAPE },
  tail: { check: READS_ONLY, shape: HEAD_TAIL_SHAPE },
  tee: { check: teeWritesNoFile, shape: NO_WORDS },
  tr: { check: READS_ONLY, shape: { operands: 2, valued: "" } },
  uniq: { check: uniqReadsOnly, shape: UNIQ_SHAPE },
  wc: { check: READS_ONLY, shape: { operands: 0, valued: "", readsLong: FILES0_LIST } }
};
function isReadOnlyFilter(step) {
  if (step.pipedFrom === null || step.pipedFrom.trim() === "" || step.expanded)
    return false;
  const filled = wordsWithFill(step.text, "bash");
  if (filled.length === 0 || filled.some((word) => word.filled))
    return false;
  const words = filled.map((word) => word.text);
  const program = programName(words[0] ?? "");
  const check = READ_ONLY_FILTERS[program]?.check;
  if (check === undefined)
    return false;
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.computed || invocation.prefix.length > 0 || invocation.program !== program) {
    return false;
  }
  if (redirectionTargets(filled).some((target) => target !== "/dev/null"))
    return false;
  return check(withoutRedirections(invocation.args));
}
var GLUE_COMMANDS = new Set([
  ":",
  "[",
  "echo",
  "exit",
  "export",
  "false",
  "printf",
  "pwd",
  "return",
  "set",
  "test",
  "true"
]);
var INPUT_REDIRECTION = /^\d*<(?![<(])/;
function readsAFile(words) {
  for (let index = 0;index < words.length; index++) {
    const word = words[index] ?? "";
    if (!INPUT_REDIRECTION.test(word))
      continue;
    const attached = word.replace(/^\d*<>?/, "");
    const target = attached === "" ? words[++index] ?? "" : attached;
    if (target !== "/dev/null")
      return true;
  }
  return false;
}
function isGlueReader(step) {
  if (!isReadOnlyFilter(step))
    return false;
  const words = wordsOf(step.text, "bash");
  const invocation = invocationOf(words);
  const shape = invocation === undefined ? null : READ_ONLY_FILTERS[invocation.program]?.shape;
  if (invocation === undefined || !shape || invocation.program !== words[0])
    return false;
  if (words.some((word) => INPUT_REDIRECTION.test(word)))
    return false;
  return readsStdinOnly(shape, withoutRedirections(invocation.args));
}
var ARITHMETIC_WORD = /\$\(\(|\$\[|\$\{(?:!|[^}]*(?:\[|:[^-=?+]|@))/;
var LITERAL_SUBSCRIPT = /\$\{#?[A-Za-z_]\w*\[(?:\d+|@|\*)\]\}/g;
function runsAsArithmetic(word) {
  return ARITHMETIC_WORD.test(word.replace(LITERAL_SUBSCRIPT, "V"));
}
var SET_OPTIONS = /^[-+][A-Za-z]+$/;
var SET_OPTION_NAME = /^[A-Za-z][A-Za-z-]*$/;
var EXIT_CODE = new RegExp(`^(?:\\d+|\\$\\?|${LITERAL_SUBSCRIPT.source})$`);
var SAFE_SET_LETTERS = /^-[euo]+$/;
var SAFE_SET_NAMES = new Set(["errexit", "nounset", "pipefail"]);
function setsOptionsOnly(args) {
  let wantsName = false;
  let turnsOn = false;
  for (const arg of args) {
    if (wantsName) {
      if (!SET_OPTION_NAME.test(arg))
        return false;
      if (turnsOn && !SAFE_SET_NAMES.has(arg))
        return false;
      wantsName = false;
    } else if (SET_OPTIONS.test(arg)) {
      turnsOn = arg.startsWith("-");
      if (turnsOn && !SAFE_SET_LETTERS.test(arg))
        return false;
      wantsName = arg.endsWith("o");
    } else {
      return false;
    }
  }
  return args.length > 0 && !wantsName;
}
function glueArguments(program, words, plain) {
  if (program === "printf") {
    const format = plain[0];
    if (format === undefined)
      return true;
    return !format.startsWith("-") && words.every((word) => word.text !== format || !word.filled);
  }
  if (program === "test" || program === "[") {
    return !words.some((word) => word.filled) && !plain.some((arg) => arg === "-v" || arg === "-R");
  }
  if (program === "set")
    return setsOptionsOnly(plain);
  if (program === "exit" || program === "return") {
    return plain.length === 0 || plain.length === 1 && EXIT_CODE.test(plain[0] ?? "");
  }
  if (program === "export") {
    return isAssignmentOnly(plain) && !plain.some((word) => /\$\(|`/.test(word));
  }
  return true;
}
function isGlueCommand(step) {
  if (step.expanded)
    return false;
  const filled = wordsWithFill(step.text, "bash");
  const words = filled.map((word) => word.text);
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.computed || invocation.prefix.length > 0 || invocation.program !== words[0]) {
    return false;
  }
  if (redirectionTargets(filled).some((target) => target !== "/dev/null"))
    return false;
  if (words.some(runsAsArithmetic))
    return false;
  const { program } = invocation;
  if (GLUE_COMMANDS.has(program)) {
    return glueArguments(program, filled.slice(1), withoutRedirections(invocation.args));
  }
  return isGlueReader(step);
}
function splitAtFilters(line) {
  const steps = shellSteps(line, { blindWhenOpen: true, dialect: "bash", joinLines: true });
  let end = line.length;
  let found = 0;
  for (let index = steps.length - 1;index > 0; index--) {
    const step = steps[index];
    if (step === undefined || !isReadOnlyFilter(step))
      break;
    const start = end - step.text.length;
    if (start < 1 || line.slice(start, end) !== step.text)
      return null;
    const before = line.charAt(start - 2);
    if (line.charAt(start - 1) !== "|" || before === "|" || before === ">")
      return null;
    end = start - 1;
    found++;
  }
  return found === 0 ? null : { heavy: line.slice(0, end).trimEnd(), filters: line.slice(end) };
}
function feedsFiltersAlone(heavy) {
  const commands = shellSteps(heavy, { blindWhenOpen: true, dialect: "bash", joinLines: true }).map((step) => wordsOf(step.text)).filter((words) => words.length > 0 && !isAssignmentOnly(words));
  const last = commands.at(-1);
  if (last === undefined || last[0] === "!")
    return false;
  const changesDir = (words) => {
    const invocation = invocationOf(words);
    return invocation !== undefined && CHANGE_DIR.has(invocation.program);
  };
  return !changesDir(last) && commands.slice(0, -1).every(changesDir);
}
function cutAtFilters(line) {
  const split = splitAtFilters(line.trim());
  return split !== null && feedsFiltersAlone(split.heavy) ? split : { heavy: line, filters: "" };
}
function routableKinds(command, kinds, source) {
  const out = newScan();
  if (!scan(command, kinds, "bash", 0, runOf(source), true, out) || out.queued)
    return null;
  return out.found.map((one) => one.kind);
}
function routableLine(bashCommand, kinds, source) {
  const { heavy, filters } = cutAtFilters(bashCommand);
  const kind = routableKinds(heavy, kinds, source)?.[0];
  return kind === undefined ? null : { filters, heavy, kind };
}
function mixedHeavyLine(line, kinds, source) {
  if (routableLine(line, kinds, source) !== null)
    return null;
  const heavy = newScan();
  scan(line, kinds, "bash", 0, runOf(source), false, heavy);
  const slot = slotRun(heavy, kinds, source);
  if (slot === "none" || slot === "light")
    return null;
  const rule = newScan();
  scan(line, kinds, "bash", 0, runOf(source), true, rule);
  return rule.stray === null ? null : { kind: slot.kind, other: rule.stray, run: slot.text };
}

// src/jobs/git-hooks.ts
import { closeSync as closeSync2, openSync as openSync2, readSync, realpathSync as realpathSync3, statSync as statSync5 } from "fs";
import { basename as basename2, dirname as dirname4, join as join8, resolve as resolve2 } from "path";

// src/path-compare.ts
var IGNORE_CASE = process.platform === "win32";

// src/hooks/git.ts
var GIT_TIMED_OUT2 = "timed out";
var GUARD_GIT_TIMEOUT_MS = 5000;
function runGit(cwd, args, env, timeoutMs = 15000, own = {}) {
  return spawnGit(cwd, args, env, timeoutMs, own, true);
}
function spawnGit(cwd, args, env, timeoutMs, own, trim) {
  try {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...gitEnv(env), ...own },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true
    });
    const err = result.signalCode ? GIT_TIMED_OUT2 : result.stderr.toString().trim();
    const code = result.signalCode ? null : result.exitCode;
    const out = result.stdout.toString();
    return { ok: result.exitCode === 0, out: trim ? out.trim() : out, err, code };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: "", err, code: null };
  }
}

// src/jobs/git-hooks.ts
var HOOK_NAMES = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "post-receive",
  "post-update",
  "reference-transaction",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change"
];
var TIMED_OUT = "timed-out";
var MAX_HOOK_BYTES = 256 * 1024;
var HOOKS_PATH_ARGS = [
  "rev-parse",
  "--path-format=absolute",
  "--git-path",
  "hooks",
  "--show-cdup",
  "--is-inside-work-tree"
];
function hooksPlace(cwd, env = process.env, timeoutMs = GUARD_GIT_TIMEOUT_MS) {
  if (timeoutMs <= 0)
    return TIMED_OUT;
  const run = runGit(cwd, HOOKS_PATH_ARGS, env, timeoutMs, { GIT_CONFIG_COUNT: "0" });
  if (run.code === null && run.err === GIT_TIMED_OUT2)
    return TIMED_OUT;
  if (!run.ok)
    return null;
  const lines = run.out.split(`
`);
  const inside = lines.pop() === "true";
  const up = inside ? lines.pop() ?? "" : "";
  const folder = lines.join(`
`);
  if (folder === "")
    return null;
  return { folder, top: inside ? resolve2(realFolder(cwd), up) : cwd };
}
function realFolder(folder) {
  try {
    return realpathSync3(folder);
  } catch {
    return folder;
  }
}
function isHuskyStubFolder(folder) {
  return basename2(folder) === "_" && basename2(dirname4(folder)) === ".husky";
}
function isFile(file) {
  try {
    return statSync5(file).isFile();
  } catch {
    return false;
  }
}
function hookText(file) {
  let fd = null;
  try {
    fd = openSync2(file, "r");
    const size = statSync5(file).size;
    if (size > MAX_HOOK_BYTES)
      return null;
    const buffer = Buffer.alloc(size);
    const read = readSync(fd, buffer, 0, size, 0);
    const bytes = buffer.subarray(0, read);
    return bytes.includes(0) ? null : bytes.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null)
      closeSync2(fd);
  }
}
function hookDecision(name, cwd, kinds, scriptsIn, env = process.env, gitTimeoutMs = GUARD_GIT_TIMEOUT_MS) {
  const place = hooksPlace(cwd, env, gitTimeoutMs);
  if (place === TIMED_OUT)
    return "timed-out";
  if (place === null)
    return "none";
  const { folder, top } = place;
  if (!isFile(join8(folder, name)))
    return "none";
  const file = isHuskyStubFolder(folder) ? join8(dirname4(folder), name) : join8(folder, name);
  if (!isFile(file))
    return "none";
  const text = hookText(file);
  if (text === null)
    return "direct";
  const kind = classifyUnqueuedHeavy(text, kinds, { folder: top, scriptsIn });
  return kind === null ? "direct" : { queue: kind };
}

// src/jobs/hook-folder.ts
import { accessSync as accessSync2, constants as constants2, existsSync as existsSync5, readdirSync as readdirSync3, readFileSync as readFileSync5, statSync as statSync6 } from "fs";
import { join as join9 } from "path";

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

// src/setup/managed-folder.ts
var OWNED_FOLDER_MARK = ".cc-smart-dev-kit-owned";

// src/jobs/hook-folder.ts
function hookLauncher(paths) {
  return join9(paths.binDir, LAUNCHER_NAME);
}
function hookScript(launcher) {
  return `#!/bin/sh
# ${PLUGIN} git hook. Written by "${COMMAND} setup"; setup rewrites it, so do not edit it.
# A git command that the kit routes uses this folder for that one command. This script runs the
# repo's own hook of the same name: as it is, or inside the heavy-job queue when that hook runs
# heavy work. Every doubt runs the hook as it is, so a broken kit never blocks a commit.
name=\${0##*/}
launcher=${shellQuote(launcher)}
# Take the kit's own pair out of the environment, so nothing the hook runs (a staged-files linter,
# a test suite that commits in temp repos) sends its own git calls through this folder. Only the
# top pair, and only when it sets core.hooksPath to this very folder: a pair below it stays.
count=\${GIT_CONFIG_COUNT-}
case $count in
  '' | 0* | *[!0-9]* | [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*) ;;
  *)
    top=$((count - 1))
    eval "key=\\\${GIT_CONFIG_KEY_$top-} value=\\\${GIT_CONFIG_VALUE_$top-}"
    case $key in
      [Cc][Oo][Rr][Ee].[Hh][Oo][Oo][Kk][Ss][Pp][Aa][Tt][Hh])
        if [ "$value" = "\${0%/*}" ]; then
          unset "GIT_CONFIG_KEY_$top" "GIT_CONFIG_VALUE_$top"
          if [ "$top" = 0 ]; then unset GIT_CONFIG_COUNT; else GIT_CONFIG_COUNT=$top; fi
          own_pair_gone=1
        fi
        ;;
    esac
    ;;
esac
# With the kit's pair gone, git reads the person's own pairs too (a safe.directory that trusts
# this repo); else GIT_CONFIG_COUNT=0 is the only sure way past the pair that brought git here.
if [ -n "\${own_pair_gone-}" ]; then
  real_dir=$(git rev-parse --path-format=absolute --git-path hooks 2>/dev/null) || exit 0
else
  real_dir=$(GIT_CONFIG_COUNT=0 git rev-parse --path-format=absolute --git-path hooks 2>/dev/null) || exit 0
fi
[ -n "$real_dir" ] || exit 0
real=$real_dir/$name
[ -f "$real" ] || exit 0
case $real_dir in
  */.husky/_)
    [ -f "$real_dir/../$name" ] || exit 0
    # HUSKY=0 turns husky's hooks off: its stub ends at once, so it never waits for a slot.
    if [ "\${HUSKY:-}" = 0 ]; then launcher=; fi
    ;;
esac
if [ ! -x "$real" ]; then
  # Git's own hint, unless the person turned it off (advice.ignoredHook=false, or GIT_ADVICE read
  # as git reads a boolean: set and empty, false, no, off or 0, in any case, is off).
  hint=1
  if [ "\${GIT_ADVICE+set}" = set ]; then
    case $GIT_ADVICE in
      '' | [Ff][Aa][Ll][Ss][Ee] | [Nn][Oo] | [Oo][Ff][Ff] | 0) hint= ;;
    esac
  fi
  if [ -n "$hint" ] && [ "$(git config --type=bool advice.ignoredHook 2>/dev/null)" = false ]; then hint=; fi
  if [ -n "$hint" ]; then
    echo "hint: The '$real' hook was ignored because it's not set as executable." >&2
  fi
  exit 0
fi
answer=direct
if [ -x "$launcher" ]; then
  answer=$("$launcher" job hook "$name" </dev/null) || answer=direct
fi
case $answer in
  "queue "*)
    kind=\${answer#queue }
    case $kind in
      '' | *[!A-Za-z0-9:._-]*) ;;
      *)
        # A hook with no #! line: git and sh run it through sh, but the queue starts it itself.
        first=
        IFS= read -r first < "$real"
        case $first in
          '#!'*) exec "$launcher" job run --hook --kind "$kind" -- "$real" "$@" ;;
          *) exec "$launcher" job run --hook --kind "$kind" -- /bin/sh "$real" "$@" ;;
        esac
        ;;
    esac
    ;;
esac
exec "$real" "$@"
`;
}
function isExecutable(file) {
  try {
    accessSync2(file, constants2.X_OK);
    return true;
  } catch {
    return false;
  }
}
function gitHooksState(paths) {
  const folder = paths.gitHooksFolder;
  if (!existsSync5(folder))
    return { kind: "missing" };
  if (!existsSync5(join9(folder, OWNED_FOLDER_MARK)))
    return { kind: "not-ours" };
  const wanted = hookScript(hookLauncher(paths));
  const problems = [];
  for (const name of HOOK_NAMES) {
    const file = join9(folder, name);
    if (!existsSync5(file) || !statSync6(file).isFile())
      problems.push(`${name} is missing`);
    else if (!isExecutable(file))
      problems.push(`${name} is not executable`);
    else if (readFileSync5(file, "utf8") !== wanted)
      problems.push(`${name} is from another version`);
  }
  for (const entry of readdirSync3(folder)) {
    if (entry !== OWNED_FOLDER_MARK && !HOOK_NAMES.includes(entry)) {
      problems.push(`${entry} should not be there`);
    }
  }
  return problems.length === 0 ? { kind: "ok" } : { kind: "problems", problems };
}

// src/jobs/package-scripts.ts
import { existsSync as existsSync6, readFileSync as readFileSync6, statSync as statSync7 } from "fs";
import { dirname as dirname5, join as join10, resolve as resolve3 } from "path";
var NO_FILE_HERE = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);
function foldersToCheckoutRoot(start) {
  const chain = [];
  for (let dir = start;; dir = dirname5(dir)) {
    chain.push(dir);
    if (existsSync6(join10(dir, ".git")))
      return chain;
    if (dirname5(dir) === dir)
      return [start];
  }
}
function packageScripts(folder) {
  for (const dir of foldersToCheckoutRoot(resolve3(folder))) {
    let text;
    try {
      text = readFileSync6(join10(dir, "package.json"), "utf8");
    } catch (error) {
      if (NO_FILE_HERE.has(error.code ?? ""))
        continue;
      return null;
    }
    return scriptsOf(text, dir);
  }
  return null;
}
function scriptsOf(text, folder) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object")
    return null;
  const scripts = parsed.scripts;
  const bodies = new Map;
  if (scripts !== undefined) {
    if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts))
      return null;
    for (const [name, body] of Object.entries(scripts)) {
      if (typeof body === "string")
        bodies.set(name, body);
    }
  }
  return Object.assign(bodies, { folder, yarnBerry: usesYarnBerry(parsed, folder) });
}
function usesYarnBerry(packageJson, folder) {
  let json = packageJson;
  for (const dir of foldersToCheckoutRoot(folder)) {
    if (existsSync6(join10(dir, ".yarnrc.yml")))
      return true;
    json ??= packageJsonAt(dir);
    const manager = json?.packageManager;
    if (typeof manager === "string")
      return Number(/^yarn@(\d+)/.exec(manager)?.[1] ?? 0) >= 2;
    json = null;
  }
  return false;
}
function packageJsonAt(dir) {
  try {
    const parsed = JSON.parse(readFileSync6(join10(dir, "package.json"), "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function fileExistsIn(folder, word) {
  try {
    return statSync7(resolve3(folder, word)).isFile();
  } catch {
    return false;
  }
}

// src/jobs/weight-source.ts
function diskWeightSource(folder) {
  return { folder, isFile: fileExistsIn, scriptsIn: packageScripts };
}

// src/shell/change-dir.ts
import { posix, win32 as win322 } from "path";
var CHANGES_FOLDER = new Set([...CHANGE_DIR, "push-location"]);
function pathRules(platform) {
  return platform === "win32" ? win322 : posix;
}
function shellTargetPath(path, platform = process.platform, dialect = "bash") {
  if (platform !== "win32" || dialect !== "bash")
    return path;
  const drive = /^\/+([A-Za-z])(?:\/+|$)/.exec(path);
  return drive === null ? path : `${drive[1]?.toUpperCase()}:/${path.slice(drive[0].length)}`;
}
var COMPUTED_PATH = /[$`*?[\]]|%\w+%/;
function movedTo(program, folder, args, options = {}) {
  const { dialect = "bash", home, platform = process.platform } = options;
  if (program === "popd")
    return null;
  const target = args.find((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  if (target === undefined)
    return home === undefined ? null : program === "cd" ? home : folder;
  const named = home !== undefined && /^~(?=$|[\\/])/.test(target) ? home + target.slice(1) : target;
  if (/^[~%]/.test(named) || COMPUTED_PATH.test(named))
    return null;
  const path = shellTargetPath(named, platform, dialect);
  const rules = pathRules(platform);
  if (rules.isAbsolute(path))
    return rules.resolve(path);
  return folder === null ? null : rules.resolve(folder, path);
}

class FolderTracker {
  folder;
  outer = [];
  constructor(start) {
    this.folder = start;
  }
  enter(subshell = null) {
    const entering = [];
    let at = subshell;
    while (at !== null && at.depth > this.outer.length) {
      entering.push(at);
      at = at.outer;
    }
    while (this.outer.length > (at?.depth ?? 0))
      this.leave();
    while (at !== null && this.outer.at(-1)?.group !== at) {
      entering.push(at);
      at = at.outer;
      this.leave();
    }
    for (const group of entering.reverse())
      this.outer.push({ from: this.folder, group });
    return this.folder;
  }
  moveTo(folder) {
    this.folder = folder;
  }
  leave() {
    const left = this.outer.pop();
    if (left !== undefined)
      this.folder = left.from;
  }
}

// src/shell/git-calls.ts
function longOption2(arg, full, min) {
  const name = arg.split("=")[0] ?? arg;
  return name.length >= min && name.length <= full.length && full.startsWith(name);
}
function configKey(raw) {
  const parts = raw.split(".");
  if (parts.length < 2)
    return raw.toLowerCase();
  const first = (parts[0] ?? "").toLowerCase();
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  return [first, ...parts.slice(1, -1), last].join(".");
}
var GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree"
]);
var GIT_FLAGS = new Set([
  "-P",
  "-p",
  "--bare",
  "--glob-pathspecs",
  "--icase-pathspecs",
  "--literal-pathspecs",
  "--no-advice",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate"
]);
var GIT_PRINTS = new Set([
  "-h",
  "-v",
  "--exec-path",
  "--help",
  "--html-path",
  "--info-path",
  "--man-path",
  "--version"
]);
var MAX_READINGS = 16;
function gitCalls(args) {
  const calls = [];
  const readings = [
    { config: new Map, dirs: [], gitDir: null, index: 0, workTree: null }
  ];
  let started = 1;
  for (let next = readings.shift();next !== undefined; next = readings.shift()) {
    const { config, dirs } = next;
    let { gitDir, workTree } = next;
    let index = next.index;
    for (;index < args.length; index++) {
      const arg = args[index] ?? "";
      const name = arg.startsWith("--") ? arg.split("=")[0] ?? arg : arg;
      const attached = arg.startsWith("--") && arg.includes("=");
      if (arg === "-C") {
        const dir = args[++index];
        if (dir !== undefined)
          dirs.push(dir);
      } else if (arg === "-c" || name === "--config-env") {
        const setting = attached ? arg.slice(name.length + 1) : args[++index] ?? "";
        const equals = setting.indexOf("=");
        const key = configKey(equals === -1 ? setting : setting.slice(0, equals));
        config.set(key, arg === "-c" ? equals === -1 ? "true" : setting.slice(equals + 1) : null);
      } else if (name === "--work-tree") {
        workTree = (attached ? arg.slice(name.length + 1) : args[++index]) ?? workTree;
      } else if (name === "--git-dir") {
        gitDir = (attached ? arg.slice(name.length + 1) : args[++index]) ?? gitDir;
      } else if (GIT_VALUE_OPTIONS.has(arg)) {
        index++;
      } else if (GIT_PRINTS.has(arg) || name === "--list-cmds") {
        break;
      } else if (attached && GIT_VALUE_OPTIONS.has(name) || name === "--exec-path") {} else if (GIT_FLAGS.has(arg)) {} else if (arg.startsWith("-")) {
        if (!attached && index + 1 < args.length && started < MAX_READINGS) {
          started++;
          readings.push({
            config: new Map(config),
            dirs: [...dirs],
            gitDir,
            index: index + 2,
            workTree
          });
        }
      } else {
        calls.push({ config, dirs, gitDir, rest: args.slice(index + 1), sub: arg, workTree });
        break;
      }
    }
  }
  return calls;
}

// src/workflow/merge.ts
function current(value, source) {
  return { value, source };
}
function jobRouteFrom(personal, projectConfig) {
  const project = projectConfig?.jobs?.route;
  if (project !== undefined)
    return current(project, "project");
  const own = personal.switches?.jobRoute;
  return own === undefined ? current(false, "default") : current(own, "personal");
}

// src/hooks/budget.ts
var GUARD_BUDGET_MS = 25000;
var SHORT_GUARD_BUDGET_MS = 8000;
var BUDGET_MARGIN_MS = 2000;
var GUARD_BUDGET_ENV = "CC_SMART_DEV_KIT_GUARD_BUDGET_MS";
function budgetMs(env, ceilingMs = GUARD_BUDGET_MS) {
  const given = Number(env[GUARD_BUDGET_ENV]);
  return Number.isFinite(given) && given > 0 ? Math.min(given, ceilingMs) : ceilingMs;
}
function startBudget(env, now = Date.now, ceilingMs = GUARD_BUDGET_MS, startedAtMs) {
  const budgetAt = (startedAtMs ?? now()) + budgetMs(env, ceilingMs);
  return { timeFor: (limitMs) => Math.min(limitMs, budgetAt - now() - BUDGET_MARGIN_MS) };
}

// src/hooks/job-route.ts
var SHELL_MEANING = /[$`*?[\]{}~<>|&;\n\\]/;
function plainWords(command) {
  const segments = shellSegments(command);
  if (segments.length !== 1)
    return null;
  const words = wordsOf(segments[0] ?? "");
  if (words.length === 0 || !words.every((word) => !SHELL_MEANING.test(word)))
    return null;
  const invocation = invocationOf(words);
  return invocation === undefined || invocation.program !== words[0] ? null : words;
}
function routedShell(env, which = (command) => Bun.which(command, { PATH: env.PATH ?? "" })) {
  const shell = env.SHELL ?? "";
  const name = shell.split("/").pop() ?? "";
  if (name === "bash" || name === "zsh")
    return shell;
  return which("bash") ?? "sh";
}
function jobRunCommand(kind, command, shell) {
  const words = plainWords(command);
  const inner = words === null ? `${shellWord(shell)} -c ${shellQuote(command)}` : words.map(shellWord).join(" ");
  return `${LAUNCHER_IN_SHELL} job run --kind ${kind} -- ${inner}`;
}
function routeHeavyCommand(command, kinds, shell, source) {
  const line = routableLine(command, kinds, source);
  if (line === null || runWeight(line.heavy, kinds, source).weight !== "heavy")
    return null;
  const queued = jobRunCommand(line.kind, line.heavy, shell);
  return {
    command: line.filters === "" ? queued : `${queued} ${line.filters}`,
    kind: line.kind
  };
}
var GIT_COMMAND_HOOKS = {
  commit: ["pre-commit", "commit-msg"],
  merge: ["pre-merge-commit", "commit-msg"],
  push: ["pre-push"]
};
var COMMIT_VALUED_SHORT = "cCFmtuS";
function skipsHooks(sub, rest) {
  for (const arg of rest) {
    if (arg === "--")
      return false;
    if (longOption2(arg, "--no-verify", 8))
      return true;
    if (sub === "commit" && isShort(arg) && shortFlags(arg, COMMIT_VALUED_SHORT).flags.includes("n"))
      return true;
  }
  return false;
}
function gitHookSteps(command, cwd) {
  const found = [];
  const tracker = new FolderTracker(cwd);
  for (const step of shellSteps(command)) {
    const folder = tracker.enter(step.subshell);
    const words = wordsWithFill(step.text);
    const invocation = invocationOf(words.map((word) => word.text));
    if (invocation === undefined)
      continue;
    const { args, computed, prefix, program } = invocation;
    if (CHANGES_FOLDER.has(program)) {
      tracker.moveTo(movedTo(program, folder, withoutRedirections(args)));
    }
    if (program !== "git" || computed || step.start === undefined || folder === null)
      continue;
    if (step.subshell?.array === true)
      continue;
    if (prefix.length > 0 && !isAssignmentOnly(prefix))
      continue;
    const calls = gitCalls(withoutRedirections(args));
    const call = calls.length === 1 ? calls[0] : undefined;
    if (call === undefined || GIT_COMMAND_HOOKS[call.sub] === undefined)
      continue;
    if (call.config.has("core.hookspath") || skipsHooks(call.sub, call.rest))
      continue;
    if (words.slice(0, words.length - call.rest.length).some((word) => word.filled))
      continue;
    let runsIn = folder;
    for (const dir of call.dirs)
      runsIn = runsIn === null ? null : movedTo("cd", runsIn, [dir]);
    if (runsIn === null)
      continue;
    const lead = step.text.split(`
`)[0] ?? "";
    if (!command.startsWith(lead, step.start))
      continue;
    const blanks = /^[ \t]*/.exec(step.text)?.[0].length ?? 0;
    found.push({ at: step.start + blanks, folder: runsIn, sub: call.sub });
  }
  return found;
}
function hooksPairNumber(env) {
  const given = env.GIT_CONFIG_COUNT;
  if (given === undefined)
    return 0;
  if (!/^(0|[1-9]\d*)$/.test(given) || !Number.isSafeInteger(Number(given) + 1))
    return null;
  const count = Number(given);
  for (const [name, value] of Object.entries(env)) {
    const number = /^GIT_CONFIG_KEY_(\d+)$/.exec(name)?.[1];
    if (number !== undefined && Number(number) < count && value?.toLowerCase() === "core.hookspath") {
      return null;
    }
  }
  return count;
}
function routeGitHooks(command, context, kinds, platform = process.platform) {
  if (platform === "win32" || command.includes("GIT_CONFIG_"))
    return null;
  if (readingsOf(command, "bash").length > 1)
    return null;
  const pair = hooksPairNumber(context.env);
  if (pair === null)
    return null;
  const steps = gitHookSteps(command, context.cwd);
  const folder = context.paths.gitHooksFolder;
  if (steps.length === 0 || gitHooksState(context.paths).kind !== "ok")
    return null;
  const { timeFor } = startBudget(context.env, Date.now, SHORT_GUARD_BUDGET_MS, context.nowMs);
  const answers = new Map;
  const queued = [];
  for (const step of steps) {
    for (const name of GIT_COMMAND_HOOKS[step.sub] ?? []) {
      const key = `${step.folder}\x00${name}`;
      let answer = answers.get(key);
      if (answer === undefined) {
        answer = hookDecision(name, step.folder, kinds, packageScripts, context.env, timeFor(GUARD_GIT_TIMEOUT_MS));
        answers.set(key, answer);
      }
      if (typeof answer === "object") {
        queued.push({ at: step.at, kind: answer.queue });
        break;
      }
    }
  }
  const first = queued[0];
  if (first === undefined)
    return null;
  const prefix = [
    `GIT_CONFIG_COUNT=${pair + 1}`,
    `GIT_CONFIG_KEY_${pair}=core.hooksPath`,
    `GIT_CONFIG_VALUE_${pair}=${shellWord(folder)}`
  ].join(" ");
  let routed = command;
  for (const { at } of queued.toSorted((one, other) => other.at - one.at)) {
    routed = `${routed.slice(0, at)}${prefix} ${routed.slice(at)}`;
  }
  return { command: routed, kind: first.kind };
}
var REWRITE_SUPPORTED = true;
var REWRITE_TIMEOUT_SUPPORTED = true;
var DEFAULT_BASH_MAX_TIMEOUT_MS = 600000;
var DEFAULT_BASH_TIMEOUT_MS = 120000;
function limitFromEnv(value, fallback) {
  if (value === undefined || !/^[1-9]\d*$/.test(value))
    return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}
function routedTimeoutMs(env) {
  return Math.max(limitFromEnv(env.BASH_MAX_TIMEOUT_MS, DEFAULT_BASH_MAX_TIMEOUT_MS), limitFromEnv(env.BASH_DEFAULT_TIMEOUT_MS, DEFAULT_BASH_TIMEOUT_MS));
}
function rewriteAnswer(fields, command, timeoutMs = null) {
  const timeout = timeoutMs !== null && fields.timeout === undefined && fields.run_in_background !== true ? { timeout: timeoutMs } : {};
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...fields, command, ...timeout }
      }
    })
  };
}
function heavyRunKind(command, kinds, source, dialect) {
  const kind = classifyHeavyCommand(command, kinds, source ?? undefined, dialect);
  if (kind === null || source === null)
    return kind;
  const bash = dialect === "bash" ? command : bashLineOf(command);
  if (bash === null)
    return kind;
  return runWeight(bash, kinds, source).weight === "heavy" ? kind : null;
}
function weightSourceOf(input) {
  const cwd = stringField(input.cwd);
  return cwd === null ? null : diskWeightSource(cwd);
}
function bashToolExists(env, platform = process.platform, facts = {
  exists: existsSync7,
  which: (command) => Bun.which(command, { PATH: env.PATH ?? env.Path ?? "" })
}) {
  return platform !== "win32" || findGitBash(env, facts).path !== null;
}
function bashLineOf(powerShellCommand) {
  const segments = shellSegments(powerShellCommand, { dialect: "powershell" });
  if (segments.length !== 1)
    return null;
  const filled = wordsWithFill(segments[0] ?? "", "powershell");
  if (filled.length === 0 || filled.some((word) => word.filled))
    return null;
  const words = filled.map((word) => word.text);
  if (withoutRedirections(words).length !== words.length)
    return null;
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.computed || invocation.prefix.length > 0 || invocation.program !== programName(words[0] ?? "")) {
    return null;
  }
  return words.map(shellWord).join(" ");
}
function powerShellDenial(command, kinds, source) {
  const kind = heavyRunKind(command, kinds, source, "powershell");
  if (kind === null)
    return null;
  const bash = bashLineOf(command);
  const queued = bash !== null && routableLine(bash, kinds, source) !== null;
  const why = `This is a heavy command (${kind}), and the job queue takes Bash lines only: run in PowerShell it would not wait for a free slot, and many heavy runs at once have run machines out of memory.`;
  return toolDecision("deny", queued ? [
    why,
    "Run it with the Bash tool instead, where it waits for a slot in the queue:",
    bash
  ].join(`
`) : `${why}
Run it with the Bash tool instead, written for Bash: there a heavy command alone (or after a cd, or piped into a filter such as tail) waits for a slot in the queue.`);
}
var QUOTED_MAX = 120;
function quoted(text) {
  const line = text.replace(/\s+/g, " ");
  return line.length <= QUOTED_MAX ? line : `${line.slice(0, QUOTED_MAX)}\u2026`;
}
function mixedLineDenial(command, kinds, source) {
  const mixed = mixedHeavyLine(command, kinds, source);
  if (mixed === null)
    return null;
  return toolDecision("deny", [
    `This line runs heavy work (${mixed.run === null ? mixed.kind : `${mixed.kind}: ${quoted(mixed.run)}`}) beside other commands (${quoted(mixed.other)}). The job queue cannot take the whole line without hiding those commands from your permission rules, and run raw the heavy part would not wait for a free slot; many heavy runs at once have run machines out of memory.`,
    `Run the heavy command on its own line, where it waits for a slot in the queue: it may keep a cd before it, a redirection, echo or printf around it, and a pipe into tail, head or grep with plain words (no $VAR or $(\u2026) in the reader's words, and no file for it to read). Then run the other commands in a separate call. To keep the exit code on one line, write { cmd; echo "exit $?"; } 2>&1 | tail -20.`
  ].join(`
`));
}
function routeDenial(routed) {
  return toolDecision("deny", [
    `This is a heavy command (${routed.kind}): running it raw does not wait for a free slot, and many heavy runs at once have run machines out of memory.`,
    "Run it through the queue instead:",
    routed.command
  ].join(`
`));
}
function commandOf(input) {
  return stringField(toolInput(input).command);
}
function inputDialect(input) {
  return dialectOfTool(input.tool_name) ?? "bash";
}
function jobRoute(context, bashTool = bashToolExists, platform = process.platform, personal = {}) {
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null)
    return SILENT;
  if (!jobRouteFrom(personal, context.project.config).value)
    return SILENT;
  const dialect = inputDialect(context.input);
  const kinds = mergeKinds(context.project.config?.jobs?.kinds);
  const source = diskWeightSource(context.cwd);
  if (dialect !== "bash") {
    const refused = powerShellDenial(command, kinds, source);
    return refused !== null && bashTool(context.env) ? refused : SILENT;
  }
  let routed = routeHeavyCommand(command, kinds, routedShell(context.env), source);
  if (routed === null) {
    const refused = mixedLineDenial(command, kinds, source);
    if (refused !== null)
      return refused;
    routed = routeGitHooks(command, context, kinds, platform);
  }
  if (routed === null)
    return SILENT;
  if (!REWRITE_SUPPORTED)
    return routeDenial(routed);
  const timeoutMs = REWRITE_TIMEOUT_SUPPORTED ? routedTimeoutMs(context.env) : null;
  return rewriteAnswer(fields, routed.command, timeoutMs);
}
async function jobRouteAnswer(context) {
  const personal = await loadPersonalWorkflow(context.paths);
  return jobRoute(context, bashToolExists, process.platform, personal);
}
function routeFacts(input) {
  const command = commandOf(input);
  if (command === null)
    return {};
  const source = weightSourceOf(input);
  if (source === null || inputDialect(input) !== "bash")
    return {};
  return { weight: runWeight(command, mergeKinds(undefined), source).weight };
}

// src/hooks/specs/job-route.ts
var jobRouteHook = {
  name: "job-route",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: (_message, input, event, checkout, context) => jobRouteAnswer({
    input,
    event,
    cwd: stringField(input.cwd) ?? checkout.root,
    project: { ...checkout, config: null, configFile: null },
    env: context.env,
    paths: context.paths,
    nowMs: context.nowMs
  }),
  logFacts: routeFacts,
  run: jobRouteAnswer
};

// src/entries/job-route.ts
await runHookEntry(jobRouteHook);
