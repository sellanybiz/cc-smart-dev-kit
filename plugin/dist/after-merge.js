// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};

// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit", PLUGIN = "cc-smart-dev-kit", PLUGIN_ID, COMMAND = "cc-smart-dev-kit";
var init_names = __esm(() => {
  PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
});

// src/machine/host.ts
function hostPlatform(env = process.env) {
  const text = env[TEST_HOST_VAR];
  if (!text)
    return process.platform;
  const given = JSON.parse(text);
  return given.platform ?? process.platform;
}
var TEST_HOST_VAR = "CC_SMART_DEV_KIT_TEST_HOST";

// src/gateway/paths.ts
import { homedir } from "os";
import { join } from "path";
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
var init_paths = () => {};

// src/cli/paths.ts
import { join as join2, sep } from "path";
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
var init_paths2 = __esm(() => {
  init_names();
  init_paths();
});

// src/setup/user-json.ts
import { readFileSync } from "fs";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}
function readUserJson(file) {
  return parseUserJson(readFileSync(file, "utf8"));
}
var BOM = "\uFEFF";
var init_user_json = () => {};

// src/project/config-facts.ts
import { existsSync } from "fs";
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
var CONFIG_PATH = ".claude/cc-smart-dev-kit.json";
var init_config_facts = __esm(() => {
  init_user_json();
});

// src/project/git-env.ts
function gitEnv(base) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !REPO_SELECTING_GIT_VARS.includes(key))
      env[key] = value;
  }
  return env;
}
var REPO_SELECTING_GIT_VARS;
var init_git_env = __esm(() => {
  REPO_SELECTING_GIT_VARS = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
    "GIT_NAMESPACE"
  ];
});

// src/project/locate.ts
import { existsSync as existsSync2, realpathSync, statSync } from "fs";
import { join as join3 } from "path";
function gitNotFound(error) {
  const why = error instanceof Error ? error.message : String(error);
  return /not found in \$PATH|ENOENT/.test(why) ? new Error(GIT_NOT_FOUND) : error;
}
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
var MIN_GIT_VERSION = "2.31.0", RESOLVE_GIT_TIMEOUT_MS = 5000, GIT_NOT_FOUND = "git was not found, so this project's own values cannot be read. Install git, then try again.", GIT_TIMED_OUT = "git did not answer in time", GIT_TIMED_OUT_FIX = "run `git status` in this folder; if that hangs too, fix git first, then run this again", GitTimedOutError, NO_TIME_LEFT;
var init_locate = __esm(() => {
  init_config_facts();
  init_git_env();
  GitTimedOutError = class GitTimedOutError extends Error {
    constructor() {
      super(`${GIT_TIMED_OUT}: ${GIT_TIMED_OUT_FIX}`);
      this.name = "GitTimedOutError";
    }
  };
  NO_TIME_LEFT = {
    ok: false,
    stdout: "",
    stderr: "no time left in the hook's budget",
    timedOut: true
  };
});

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
var init_file_mode = () => {};

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
var init_write = __esm(() => {
  init_file_mode();
});

// src/setup/lock.ts
var FALLBACK_STALE_MS;
var init_lock = __esm(() => {
  init_file_mode();
  FALLBACK_STALE_MS = 10 * 60 * 1000;
});

// src/update/state.ts
import {
  appendFileSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync2,
  readdirSync as readdirSync2,
  readFileSync as readFileSync3,
  rmSync,
  statSync as statSync3,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join5 } from "path";
function updateFiles(stateDir) {
  return {
    hold: join5(stateDir, "update-hold"),
    check: join5(stateDir, "update-check.json"),
    reported: join5(stateDir, "update-reported"),
    major: join5(stateDir, "update-major.json"),
    log: join5(stateDir, "update.log"),
    lockDir: join5(stateDir, "update"),
    sessions: join5(stateDir, "sessions")
  };
}
function isHeld(files) {
  return existsSync4(files.hold);
}
var CHECK_INTERVAL_MS, LOG_MAX_BYTES, UNREACHABLE_FAILS_AFTER_HOURS = 24, UNREACHABLE_FAILS_AFTER_MS;
var init_state = __esm(() => {
  init_lock();
  init_write();
  CHECK_INTERVAL_MS = 60 * 60 * 1000;
  LOG_MAX_BYTES = 256 * 1024;
  UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;
});
// src/build-info/index.ts
var info = {
  version: "6.7.1",
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
}, VERSION, MARKETPLACE_SOURCE, DEPENDENCIES, MARKETPLACE_ADD_COMMAND, PLUGIN_INSTALL_COMMAND, PLUGIN_UPDATE_COMMAND;
var init_build_info = __esm(() => {
  init_names();
  init_names();
  VERSION = info.version;
  MARKETPLACE_SOURCE = info.repo;
  DEPENDENCIES = info.dependencies;
  MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
  PLUGIN_INSTALL_COMMAND = `claude plugin install ${PLUGIN_ID}`;
  PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;
});

// src/shell/program-name.ts
function programName(word) {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
}

// src/shell/kit-invocation.ts
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
var INERT, KIT_BUNDLE;
var init_kit_invocation = __esm(() => {
  init_names();
  INERT = new Set([
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
  KIT_BUNDLE = /(?:^|[\\/])(?:dist|entries)[\\/](?:cli|portal)\.(?:js|ts)$/;
});

// src/shell/powershell.ts
function powershellQuoted(value) {
  return `'${value.replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}
var SINGLE_QUOTES;
var init_powershell = __esm(() => {
  SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g;
});

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
function wordsOf(segment, dialect = "bash") {
  return wordsWithFill(segment, dialect).map((one) => one.text);
}
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
function isRunnerProgram(program) {
  return RUNNER_PROGRAM_NAMES.includes(program);
}
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
function fillTest(filled) {
  const set = new Set(filled);
  return (word) => set.has(word);
}
function derivedFill(words, args) {
  const own = new Set(words);
  return args.filter((arg) => !own.has(arg) && anyFill(arg));
}
function fillOfStep(step, words, dialect, inherited) {
  const all = inherited || step.expanded;
  const own = words.some((word) => word.filled);
  const piped = step.pipedFrom !== null && wordsWithFill(step.pipedFrom, dialect).some((w) => w.filled);
  const filled = words.filter((word) => all || word.filled).map((word) => word.text);
  return { filled: [...new Set(filled)], passes: all || own || piped };
}
var DIALECTS, MAX_NESTING = 3, ESCAPE, SINGLE, DOUBLE, oneOf = (chars, char) => char !== "" && chars.includes(char), CONTINUATION, SEPARATORS, HERE_STRING, ARRAY_ASSIGNMENT, MAX_INNER = 8, isBlank = (char) => char === " " || char === "\t", ANSI_ESCAPES, POWERSHELL_ESCAPES, EXPANDS, KEYWORDS, ASSIGNMENT, CHANGE_DIR, REDIRECTION, DURATION = (word) => /^\d+(?:\.\d+)?[smhd]?$/.test(word), CPU_MASK = (word) => /^(?:0x)?[0-9a-f]+(?:[,-][0-9a-f]+)*$/i.test(word), WRAPPERS, SHELLS, CLAUDE_PACKAGE, PACKAGE_RUNNERS, START_PROCESS_PARAMETERS, START_PROCESS = "start-process", WRITING_REDIRECTIONS, RUNNER_PROGRAM_NAMES, FIND_EXEC, FIND_VALUED, WATCH_LONG, WATCH_VALUED, SU_LONG, SU_VALUED, PARALLEL_VALUED, PARALLEL_SWITCHES, PARALLEL_SOURCES, PARALLEL_LONG, anyFill = (word) => /[$`]/.test(word);
var init_command = __esm(() => {
  init_kit_invocation();
  init_powershell();
  DIALECTS = ["bash", "powershell"];
  ESCAPE = { bash: "\\", powershell: "`" };
  SINGLE = { bash: "'", powershell: "'\u2018\u2019\u201A\u201B" };
  DOUBLE = { bash: '"', powershell: '"\u201C\u201D\u201E' };
  CONTINUATION = {
    bash: /\\[ \t]*\r?\n/y,
    powershell: /`[ \t]*\r?\n/y
  };
  SEPARATORS = new Set([`
`, "\r", "&", "(", ")", ";", "|"]);
  HERE_STRING = /@(["'])\r?\n([\s\S]*?)\r?\n\1@/y;
  ARRAY_ASSIGNMENT = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*\+?=$/;
  ANSI_ESCAPES = {
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
  POWERSHELL_ESCAPES = {
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
  EXPANDS = {
    bash: /[A-Za-z_0-9{([@*#?$!-]/,
    powershell: /[A-Za-z_0-9{(?$^:]/
  };
  KEYWORDS = new Set(["!", "do", "done", "elif", "else", "fi", "if", "then", "until", "while"]);
  ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
  CHANGE_DIR = new Set([
    "cd",
    "chdir",
    "popd",
    "pushd",
    "set-location",
    "sl"
  ]);
  REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(?!\()(.*)$/s;
  WRAPPERS = {
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
  SHELLS = new Set(["bash", "dash", "fish", "ksh", "mksh", "sh", "zsh"]);
  CLAUDE_PACKAGE = /^@anthropic-ai\/claude-code(?:@[^/]*)?$/;
  PACKAGE_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
  START_PROCESS_PARAMETERS = new Map([
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
  WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
  RUNNER_PROGRAM_NAMES = ["find", "parallel", "su", "watch"];
  FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
  FIND_VALUED = new Set([
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
  WATCH_LONG = [
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
  WATCH_VALUED = new Set(["--equexit", "--interval"]);
  SU_LONG = [
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
  SU_VALUED = new Set([
    "--command",
    "--group",
    "--session-command",
    "--shell",
    "--supp-group",
    "--whitelist-environment"
  ]);
  PARALLEL_VALUED = new Set([
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
  PARALLEL_SWITCHES = new Set([
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
  PARALLEL_SOURCES = new Set([":::", "::::", ":::+", "::::+"]);
  PARALLEL_LONG = [...PARALLEL_VALUED, ...PARALLEL_SWITCHES];
});

// src/mcp/task-server-name.ts
var TASKS_SERVER_NAME;
var init_task_server_name = __esm(() => {
  init_names();
  TASKS_SERVER_NAME = `${COMMAND}-tasks`;
});

// src/tasks/words.ts
var TASK_TOOL, TASK_TOOLS_ALLOW_RULE, TASK_COMMAND, MAX_PHASE = 8, PHASE_RULE, OVERLAP_NOTE = "Overlap:", OVERLAP_WARNS, PLAN_FILES_WORDS;
var init_words = __esm(() => {
  init_names();
  init_task_server_name();
  TASK_TOOL = {
    create: "task_create",
    take: "task_take",
    update: "task_update",
    done: "task_done",
    note: "task_note",
    list: "task_list",
    get: "task_get",
    search: "task_search",
    delete: "task_delete"
  };
  TASK_TOOLS_ALLOW_RULE = `mcp__${TASKS_SERVER_NAME}__*`;
  TASK_COMMAND = `${COMMAND} task`;
  PHASE_RULE = `1-${MAX_PHASE} characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"`;
  OVERLAP_WARNS = `the answer warns, and both plans get an ${OVERLAP_NOTE} note`;
  PLAN_FILES_WORDS = `Plan task only: the repo-relative paths the plan changes, with / separators; a folder ends in /. Two plans overlap when a path is equal or inside the other's folder (inside a plans.appendOnly folder, only the same file). An overlap with a reserved or running plan never refuses: ${OVERLAP_WARNS}. The list replaces the stored one; an empty list clears it.`;
});

// src/path-compare.ts
import { dirname as dirname4, resolve as resolve2 } from "path";
function isInside(path, folder, ignoreCase = IGNORE_CASE) {
  const child = pathForm(path, ignoreCase);
  const parent = pathForm(folder, ignoreCase);
  return child === parent || child.startsWith(`${parent}/`);
}
function pathForm(path, ignoreCase = IGNORE_CASE) {
  const forward = resolve2(path.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return ignoreCase ? forward.toLowerCase() : forward;
}
var IGNORE_CASE;
var init_path_compare = __esm(() => {
  IGNORE_CASE = process.platform === "win32";
});

// src/workflow/reviews.ts
import { createHash as createHash2 } from "crypto";
function repoKey(repo) {
  return createHash2("sha256").update(repo).digest("hex").slice(0, 16);
}
var START_KEPT_MS;
var init_reviews = __esm(() => {
  init_lock();
  init_write();
  START_KEPT_MS = 24 * 60 * 60 * 1000;
});

// src/hooks/git.ts
function runGit(cwd, args, env, timeoutMs = 15000, own = {}, input) {
  return spawnGit(cwd, args, env, timeoutMs, own, true, input);
}
function spawnGit(cwd, args, env, timeoutMs, own, trim, input) {
  const bytes = input === undefined ? undefined : new TextEncoder().encode(input);
  const run = spawnGitBytes(cwd, args, env, timeoutMs, own, bytes);
  const out = new TextDecoder("utf-8", { ignoreBOM: true }).decode(run.out);
  return { ...run, out: trim ? out.trim() : out };
}
function spawnGitBytes(cwd, args, env, timeoutMs, own, input) {
  try {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...gitEnv(env), ...own },
      stdin: input ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true
    });
    const err = result.signalCode ? GIT_TIMED_OUT2 : result.stderr.toString().trim();
    const code = result.signalCode ? null : result.exitCode;
    return { ok: result.exitCode === 0, out: result.stdout, err, code };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: new Uint8Array, err, code: null };
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
      prunable: flag("prunable")
    });
  }
  return worktrees;
}
function listWorktrees(cwd, env, timeoutMs = 15000) {
  const listed = runGit(cwd, ["worktree", "list", "--porcelain"], env, timeoutMs);
  if (!listed.ok)
    throw new Error(`git worktree list failed: ${listed.err}`);
  return parseWorktreeList(listed.out);
}
function innermostWorktree(path, worktrees) {
  let deepest = null;
  for (const worktree of worktrees) {
    if (isInside(path, worktree) && (deepest === null || worktree.length > deepest.length)) {
      deepest = worktree;
    }
  }
  return deepest;
}
var GIT_TIMED_OUT2 = "timed out", GUARD_GIT_TIMEOUT_MS = 5000;
var init_git = __esm(() => {
  init_path_compare();
  init_git_env();
  init_reviews();
  init_path_compare();
});

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
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
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
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}
var captureStackTrace, allowsEval, propertyKeyTypes, NUMBER_FORMAT_RANGES, BIGINT_FORMAT_RANGES, highSurrogate, installing, broke = false, breaker, CONSTANT_CATCH = "~constantCatch";
var init_util = __esm(() => {
  init_core();
  captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
  allowsEval = /* @__PURE__ */ cached(() => {
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
  propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
  NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
    safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
    float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
  }))();
  BIGINT_FORMAT_RANGES = {
    int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
    uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
  };
  highSurrogate = /[\uD800-\uDBFF]/;
  breaker = {
    configurable: true,
    get() {
      broke = true;
      return;
    }
  };
});

// node_modules/zod/v4/core/core.js
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
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
var _a, NEVER, _zodDesc, _E, $ZodAsyncError, $ZodEncodeError, globalConfig;
var init_core = __esm(() => {
  init_util();
  NEVER = /* @__PURE__ */ Object.freeze({
    status: "aborted"
  });
  _zodDesc = { value: undefined, enumerable: false };
  _E = "captureStackTrace" in Error ? Error : null;
  $ZodAsyncError = class $ZodAsyncError extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
    }
  };
  $ZodEncodeError = class $ZodEncodeError extends Error {
    constructor(name) {
      super(`Encountered unidirectional transform during encode: ${name}`);
      this.name = "ZodEncodeError";
    }
  };
  (_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
  globalConfig = globalThis.__zod_globalConfig;
});

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
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
var _messageDesc, _issuesDesc, _installedToString, initializer = (inst, def) => {
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
}, $ZodError, $ZodRealError;
var init_errors = __esm(() => {
  init_core();
  init_util();
  _messageDesc = {
    get: _getMessage,
    set: _setMessage,
    enumerable: true,
    configurable: true
  };
  _issuesDesc = { value: undefined, enumerable: false };
  _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
  $ZodError = $constructor("$ZodError", initializer);
  $ZodRealError = $constructor("$ZodError", initializer, undefined, {
    Parent: Error
  });
});

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
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
}, _parseAsync = (_Err) => {
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
}, _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
}, _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
}, COMPILE_INVALID, COMPILE_FALLBACK, validate = (schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== undefined) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === undefined)
      return false;
  }
  return validateFallback(schema, value, _ctx);
}, validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
}, _encode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
}, _decode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
}, _encodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
}, _decodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
}, _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
}, _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
}, _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
}, _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
var init_parse = __esm(() => {
  init_core();
  init_util();
  COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
  COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
});

// node_modules/zod/v4/core/regexes.js
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
function emoji() {
  return new RegExp(_emoji, "u");
}
function anchor(source) {
  return new RegExp(`^${source}$`);
}
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
var cuid, cuid2, ulid, xid, ksuid, nanoid, duration, guid, uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
}, email, _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`, ipv4, ipv6, cidrv4, cidrv6, base64, base64url, httpProtocol, e164, dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`, date, anyString, integer, number, boolean, lowercase, uppercase;
var init_regexes = __esm(() => {
  cuid = /^[cC][0-9a-z]{6,}$/;
  cuid2 = /^[0-9a-z]+$/;
  ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
  xid = /^[0-9a-vA-V]{20}$/;
  ksuid = /^[A-Za-z0-9]{27}$/;
  nanoid = /^[a-zA-Z0-9_-]{21}$/;
  duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
  guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
  email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
  ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
  ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
  cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
  cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
  base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
  base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
  httpProtocol = /^https?$/;
  e164 = /^\+[1-9]\d{6,14}$/;
  date = /* @__PURE__ */ anchor(dateSource);
  anyString = /^[\s\S]{0,}$/;
  integer = /^-?\d+$/;
  number = /^-?\d+(?:\.\d+)?$/;
  boolean = /^(?:true|false)$/i;
  lowercase = /^[^A-Z]*$/;
  uppercase = /^[^a-z]*$/;
});

// node_modules/zod/v4/core/checks.js
var $ZodCheck, _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== undefined;
}, numericOriginMap, $ZodCheckLessThan, $ZodCheckGreaterThan, $ZodCheckMultipleOf, $ZodCheckNumberFormat, $ZodCheckMaxLength, $ZodCheckMinLength, $ZodCheckLengthEquals, $ZodCheckStringFormat, $ZodCheckRegex, $ZodCheckLowerCase, $ZodCheckUpperCase, $ZodCheckIncludes, $ZodCheckStartsWith, $ZodCheckEndsWith, $ZodCheckOverwrite;
var init_checks = __esm(() => {
  init_core();
  init_regexes();
  init_util();
  $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
    var _a;
    inst._zod ?? (inst._zod = {});
    inst._zod.def = def;
    (_a = inst._zod).onattach ?? (_a.onattach = []);
  });
  numericOriginMap = {
    number: "number",
    bigint: "bigint",
    object: "date"
  };
  $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
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
  $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
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
  $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
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
  $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
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
  $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
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
  $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
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
  $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
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
  $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
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
  $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
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
  $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
    def.pattern ?? (def.pattern = lowercase);
    $ZodCheckStringFormat.init(inst, def);
  });
  $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
    def.pattern ?? (def.pattern = uppercase);
    $ZodCheckStringFormat.init(inst, def);
  });
  $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
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
  $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
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
  $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
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
  $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
    $ZodCheck.init(inst, def);
    inst._zod.check = (payload) => {
      payload.value = def.tx(payload.value);
    };
  });
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
var version;
var init_versions = __esm(() => {
  version = {
    major: 4,
    minor: 6,
    patch: 7
  };
});

// node_modules/zod/v4/core/schemas.js
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
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
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
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
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
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
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
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? undefined : result.value;
  return payload;
}
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
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
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
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
var $ZodType, toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value }, $ZodString, $ZodStringFormat, $ZodGUID, $ZodUUID, $ZodEmail, URL_BAD_FORMAT = 1, URL_UNPARSEABLE = 2, asciiTabOrNewline, $ZodURL, $ZodEmoji, $ZodNanoID, $ZodCUID, $ZodCUID2, $ZodULID, $ZodXID, $ZodKSUID, $ZodISODateTime, $ZodISODate, $ZodISOTime, $ZodISODuration, $ZodIPv4, ipv6Alphabet, $ZodIPv6, $ZodCIDRv4, $ZodCIDRv6, base64Charset, $ZodBase64, base64urlCharset, $ZodBase64URL, $ZodE164, $ZodJWT, $ZodNumber, $ZodNumberFormat, $ZodBoolean, $ZodUnknown, $ZodNever, arraySize = (input) => Array.isArray(input) ? input.length : -1, $ZodArray, NO_SYMBOL_KEYS, $ZodObject, $ZodObjectJIT, $ZodUnion, $ZodIntersection, $ZodRecord, $ZodEnum, $ZodTransform, $ZodOptional, $ZodExactOptional, $ZodNullable, $ZodDefault, $ZodPrefault, $ZodNonOptional, $ZodCatch, $ZodPipe, $ZodPreprocess, $ZodReadonly, $ZodCustom;
var init_schemas = __esm(() => {
  init_checks();
  init_core();
  init_regexes();
  init_util();
  init_versions();
  init_util();
  $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
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
  $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
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
  $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
    $ZodCheckStringFormat.init(inst, def);
    $ZodString.init(inst, def);
  });
  $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
    def.pattern ?? (def.pattern = guid);
    $ZodStringFormat.init(inst, def);
  });
  $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
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
  $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
    def.pattern ?? (def.pattern = email);
    $ZodStringFormat.init(inst, def);
  });
  asciiTabOrNewline = /[\t\n\r]/g;
  $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
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
  $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
    def.pattern ?? (def.pattern = emoji());
    $ZodStringFormat.init(inst, def);
  });
  $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
    if (def.length !== undefined && (!Number.isInteger(def.length) || def.length < 1))
      throw new Error(`Invalid nanoid length: ${def.length}`);
    def.pattern ?? (def.pattern = def.length === undefined ? nanoid : nanoidOfLength(def.length));
    $ZodStringFormat.init(inst, def);
  });
  $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
    def.pattern ?? (def.pattern = cuid);
    $ZodStringFormat.init(inst, def);
  });
  $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
    def.pattern ?? (def.pattern = cuid2);
    $ZodStringFormat.init(inst, def);
  });
  $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
    def.pattern ?? (def.pattern = ulid);
    $ZodStringFormat.init(inst, def);
  });
  $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
    def.pattern ?? (def.pattern = xid);
    $ZodStringFormat.init(inst, def);
  });
  $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
    def.pattern ?? (def.pattern = ksuid);
    $ZodStringFormat.init(inst, def);
  });
  $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
    def.pattern ?? (def.pattern = datetime(def));
    $ZodStringFormat.init(inst, def);
  });
  $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
    def.pattern ?? (def.pattern = date);
    $ZodStringFormat.init(inst, def);
  });
  $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
    def.pattern ?? (def.pattern = time(def));
    $ZodStringFormat.init(inst, def);
  });
  $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
    def.pattern ?? (def.pattern = duration);
    $ZodStringFormat.init(inst, def);
  });
  $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
    def.pattern ?? (def.pattern = ipv4);
    $ZodStringFormat.init(inst, def);
  });
  ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
  $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
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
  $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
    def.pattern ?? (def.pattern = cidrv4);
    $ZodStringFormat.init(inst, def);
  });
  $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
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
  base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
  $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
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
  base64urlCharset = /^[A-Za-z0-9_-]*$/;
  $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
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
  $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
    def.pattern ?? (def.pattern = e164);
    $ZodStringFormat.init(inst, def);
  });
  $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
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
  $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
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
  $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
    $ZodCheckNumberFormat.init(inst, def);
    $ZodNumber.init(inst, def);
  });
  $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
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
  $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
    $ZodType.init(inst, def);
    inst._zod.parse = (payload) => payload;
  });
  $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
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
  $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
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
  NO_SYMBOL_KEYS = [];
  $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
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
    const isObject2 = isObject;
    const catchall = def.catchall;
    let value;
    const memo = globalConfig.memoizer;
    memo?.attach(inst);
    inst._zod.parse = (payload, ctx) => {
      value ?? (value = _normalized.value);
      const input = payload.value;
      if (!isObject2(input)) {
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
  $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
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
    const isObject2 = isObject;
    const jit = !globalConfig.jitless;
    const allowsEval2 = allowsEval;
    const fastEnabled = jit && allowsEval2.value;
    const catchall = def.catchall;
    let value;
    inst._zod.parse = (payload, ctx) => {
      value ?? (value = _normalized.value);
      const input = payload.value;
      if (!isObject2(input)) {
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
  $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
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
  $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
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
  $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
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
  $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
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
  $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
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
  $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
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
  $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
    $ZodOptional.init(inst, def);
    defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
    defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
    inst._zod.parse = (payload, ctx) => {
      return def.innerType._zod.run(payload, ctx);
    };
  });
  $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
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
  $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
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
  $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
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
  $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
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
  $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
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
  $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
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
  $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
    $ZodPipe.init(inst, def);
  });
  $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
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
  $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
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
});

// node_modules/zod/v4/core/memoizer.js
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
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
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== undefined && isRef(value) && backEdges.has(value);
}
var $ZodCyclicError, STATE = "~memo", NO_ISSUES, recursive, NONE = 0, ASSUMED = 1, PROVEN = 2, handoff, open, memo;
var init_memoizer = __esm(() => {
  init_util();
  $ZodCyclicError = class $ZodCyclicError extends Error {
    constructor() {
      super(`Cannot parse a reference cycle that closes through a transform`);
      this.name = "ZodCyclicError";
    }
  };
  NO_ISSUES = [];
  recursive = /* @__PURE__ */ new WeakMap;
  open = [];
  memo = {
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
});

// node_modules/zod/v4/locales/en.js
function en_default() {
  return {
    localeError: error()
  };
}
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
var init_en = __esm(() => {
  init_util();
});

// node_modules/zod/v4/locales/index.js
var init_locales = () => {};

// node_modules/zod/v4/core/registries.js
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
var _a2, globalRegistry;
var init_registries = __esm(() => {
  (_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
  globalRegistry = globalThis.__zod_globalRegistry;
});

// node_modules/zod/v4/core/compile.js
var INVALID, FALLBACK_FLAG, WHEN_DEFAULTED_CHECKS, PATTERN_IS_COMPLETE;
var init_compile = __esm(() => {
  INVALID = Symbol.for("zod.compile.invalid");
  FALLBACK_FLAG = Symbol.for("zod.compile.fallback");
  WHEN_DEFAULTED_CHECKS = new Set([
    "max_size",
    "min_size",
    "size_equals",
    "max_length",
    "min_length",
    "length_equals"
  ]);
  PATTERN_IS_COMPLETE = new Set([
    "cidrv4",
    "cuid",
    "cuid2",
    "date",
    "datetime",
    "duration",
    "e164",
    "email",
    "emoji",
    "ends_with",
    "guid",
    "includes",
    "ipv4",
    "ksuid",
    "lowercase",
    "mac",
    "nanoid",
    "regex",
    "starts_with",
    "time",
    "ulid",
    "uppercase",
    "uuid",
    "xid"
  ]);
});

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
var init_api = __esm(() => {
  init_checks();
  init_util();
});

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
var FOLDABLE_KEYS, UNION_KEYS, createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
}, createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var init_to_json_schema = __esm(() => {
  init_registries();
  init_util();
  FOLDABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
  UNION_KEYS = ["oneOf", "anyOf"];
});

// node_modules/zod/v4/core/json-schema-processors.js
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
var narrowMin = (agg, key, value) => {
  if (agg[key] === undefined || value > agg[key])
    agg[key] = value;
}, narrowMax = (agg, key, value) => {
  if (agg[key] === undefined || value < agg[key])
    agg[key] = value;
}, narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
}, addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
}, addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = new Set);
  agg.patterns.add(pattern);
}, intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
}, setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
}, minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum), maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum), formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
}, contributors, formatMap, exactPatterns, exactPattern = (p) => exactPatterns.get(p) ?? p, stringProcessor = (schema, ctx, _json, _params) => {
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
}, numberProcessor = (schema, ctx, _json, params) => {
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
}, booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
}, neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
}, unknownProcessor = (_schema, _ctx, _json, _params) => {}, enumProcessor = (schema, _ctx, json, _params) => {
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
}, customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
}, transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
}, arrayProcessor = (schema, ctx, _json, params) => {
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
}, objectProcessor = (schema, ctx, _json, params) => {
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
}, unionProcessor = (schema, ctx, json, params) => {
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
}, intersectionProcessor = (schema, ctx, json, params) => {
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
}, pendingRecords, recordProcessor = (schema, ctx, _json, params) => {
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
}, nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
}, nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
}, UNREPRESENTABLE_DEFAULT, defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
}, prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
}, catchProcessor = (schema, ctx, json, params) => {
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
}, pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
}, readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
}, optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var init_json_schema_processors = __esm(() => {
  init_regexes();
  init_schemas();
  init_to_json_schema();
  init_util();
  contributors = {
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
  formatMap = {
    guid: "uuid",
    url: "uri",
    datetime: "date-time",
    json_string: "json-string",
    regex: ""
  };
  exactPatterns = new Map([
    [base64Charset, base64],
    [base64urlCharset, base64url]
  ]);
  pendingRecords = new WeakMap;
  UNREPRESENTABLE_DEFAULT = Symbol();
});

// node_modules/zod/v4/core/json-schema.js
var init_json_schema = () => {};

// node_modules/zod/v4/core/index.js
var init_core2 = __esm(() => {
  init_util();
  init_regexes();
  init_locales();
  init_json_schema();
  init_core();
  init_parse();
  init_errors();
  init_schemas();
  init_memoizer();
  init_checks();
  init_versions();
  init_registries();
  init_compile();
  init_api();
  init_to_json_schema();
});

// node_modules/zod/v4/classic/checks.js
var init_checks2 = __esm(() => {
  init_core2();
});

// node_modules/zod/v4/classic/errors.js
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
var _installedErrorProtos, initializer2 = (inst, issues) => {
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
}, ZodRealError;
var init_errors2 = __esm(() => {
  init_core2();
  init_core2();
  init_util();
  _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
  ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, undefined, {
    Parent: Error
  });
});

// node_modules/zod/v4/classic/parse.js
var parse2, parseAsync, safeParse, safeParseAsync, encode, decode, encodeAsync, decodeAsync, safeEncode, safeDecode, safeEncodeAsync, safeDecodeAsync;
var init_parse2 = __esm(() => {
  init_core2();
  init_errors2();
  init_core2();
  parse2 = /* @__PURE__ */ _parse(ZodRealError);
  parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
  safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
  safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
  encode = /* @__PURE__ */ _encode(ZodRealError);
  decode = /* @__PURE__ */ _decode(ZodRealError);
  encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
  decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
  safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
  safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
  safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
  safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
});

// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
function string2(params) {
  return _string(ZodString, params);
}
function number2(params) {
  return _number(ZodNumber, params);
}
function int(params) {
  return _int(ZodNumberFormat, params);
}
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
function unknown() {
  return _unknown(ZodUnknown);
}
function never(params) {
  return _never(ZodNever, params);
}
function array(element, params) {
  return _array(ZodArray, element, params);
}
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...normalizeParams(params)
  });
}
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
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
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
var ZodType, _ZodString, ZodString, ZodStringFormat, ZodISODateTime, ZodISODate, ZodISOTime, ZodISODuration, ZodEmail, ZodGUID, ZodUUID, ZodURL, ZodEmoji, ZodNanoID, ZodCUID, ZodCUID2, ZodULID, ZodXID, ZodKSUID, ZodIPv4, ZodIPv6, ZodCIDRv4, ZodCIDRv6, ZodBase64, ZodBase64URL, ZodE164, ZodJWT, ZodNumber, ZodNumberFormat, ZodBoolean, ZodUnknown, ZodNever, ZodArray, ZodObject, ZodUnion, ZodIntersection, ZodRecord, ZodEnum, ZodTransform, ZodOptional, ZodExactOptional, ZodNullable, ZodDefault, ZodPrefault, ZodNonOptional, ZodCatch, ZodPipe, ZodPreprocess, ZodReadonly, ZodCustom;
var init_schemas2 = __esm(() => {
  init_core2();
  init_core2();
  init_json_schema_processors();
  init_to_json_schema();
  init_en();
  init_checks2();
  init_parse2();
  ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
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
  _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
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
  ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
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
  ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
    $ZodStringFormat.init(inst, def);
    _ZodString.init(inst, def);
  });
  ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
    $ZodISODateTime.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
    $ZodISODate.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
    $ZodISOTime.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
    $ZodISODuration.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
    $ZodEmail.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
    $ZodGUID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
    $ZodUUID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
    $ZodURL.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
    $ZodEmoji.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
    $ZodNanoID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
    $ZodCUID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
    $ZodCUID2.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
    $ZodULID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
    $ZodXID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
    $ZodKSUID.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
    $ZodIPv4.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
    $ZodIPv6.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
    $ZodCIDRv4.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
    $ZodCIDRv6.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
    $ZodBase64.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
    $ZodBase64URL.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
    $ZodE164.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
    $ZodJWT.init(inst, def);
    ZodStringFormat.init(inst, def);
  });
  ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
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
  ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
    $ZodNumberFormat.init(inst, def);
    ZodNumber.init(inst, def);
  });
  ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
    $ZodBoolean.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
  });
  ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
    $ZodUnknown.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
  });
  ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
    $ZodNever.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
  });
  ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
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
  ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
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
  ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
    $ZodUnion.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
    inst.options = def.options;
  });
  ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
    $ZodIntersection.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
  });
  ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
    _ensureDefaultMemoizer();
    $ZodRecord.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
    inst.keyType = def.keyType;
    inst.valueType = def.valueType;
  });
  ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
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
  ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
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
  ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
    $ZodOptional.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
    $ZodExactOptional.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
    $ZodNullable.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
    $ZodDefault.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
    inst.removeDefault = inst.unwrap;
  });
  ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
    $ZodPrefault.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
    $ZodNonOptional.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
    $ZodCatch.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
    inst.removeCatch = inst.unwrap;
  });
  ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
    $ZodPipe.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
    inst.in = def.in;
    inst.out = def.out;
  });
  ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
    ZodPipe.init(inst, def);
    $ZodPreprocess.init(inst, def);
  });
  ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
    $ZodReadonly.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });
  ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
    $ZodCustom.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
  });
});

// node_modules/zod/v4/classic/compat.js
var ZodFirstPartyTypeKind;
var init_compat = __esm(() => {
  (function(ZodFirstPartyTypeKind) {})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
});

// node_modules/zod/v4/classic/iso.js
var init_iso = () => {};

// node_modules/zod/v4/classic/coerce.js
var init_coerce = () => {};

// node_modules/zod/v4/classic/external.js
var init_external = __esm(() => {
  init_core2();
  init_core2();
  init_locales();
  init_iso();
  init_coerce();
  init_schemas2();
  init_checks2();
  init_errors2();
  init_parse2();
  init_compat();
});

// node_modules/zod/index.js
var init_zod = __esm(() => {
  init_external();
  init_external();
});

// src/jobs/kind-defaults.ts
var KIND_NAME;
var init_kind_defaults = __esm(() => {
  KIND_NAME = /^[a-z0-9][a-z0-9:._-]*$/;
});

// src/jobs/kinds.ts
var matchRuleSchema, kindSpecSchema, kindsSchema;
var init_kinds = __esm(() => {
  init_zod();
  init_kind_defaults();
  init_kind_defaults();
  matchRuleSchema = union([
    strictObject({
      tool: string2().min(1),
      sub: array(string2().min(1)).optional(),
      flags: array(string2().min(1)).optional(),
      argIncludes: string2().min(1).optional(),
      valued: array(string2().min(1)).optional()
    }),
    strictObject({
      script: string2().min(1)
    })
  ]);
  kindSpecSchema = strictObject({
    printOnly: array(string2().min(1)).optional(),
    noSlotForFiles: boolean2().optional(),
    skipWords: array(string2().min(1)).optional(),
    valuedFlags: array(string2().min(1)).optional(),
    match: array(matchRuleSchema).optional(),
    about: string2().min(1).optional(),
    gb: unknown().optional(),
    filesGb: unknown().optional(),
    maxFiles: unknown().optional(),
    workers: unknown().optional(),
    light: unknown().optional()
  });
  kindsSchema = record(string2().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"), kindSpecSchema);
});

// src/setup/managed-json.ts
var init_managed_json = __esm(() => {
  init_user_json();
  init_write();
});

// src/project/frontmatter.ts
var init_frontmatter = () => {};

// src/tasks/deploy/format.ts
var DEPLOY_ENVS, DEPLOY_ENVS_RISK_FIRST, DEPLOY_STEPS, DEPLOY_TYPES, DEPLOY_FLAGS, DEPLOY_TASK_ID, instant, deployTaskSchema;
var init_format = __esm(() => {
  init_zod();
  init_frontmatter();
  DEPLOY_ENVS = ["staging", "prod"];
  DEPLOY_ENVS_RISK_FIRST = [...DEPLOY_ENVS].reverse();
  DEPLOY_STEPS = ["before", "after"];
  DEPLOY_TYPES = ["blocking", "non-blocking"];
  DEPLOY_FLAGS = [
    "needs-yes",
    "twice-safe",
    "spends-money",
    "real-people",
    "destructive"
  ];
  DEPLOY_TASK_ID = /^(prod|staging)-\d{8}-\d{6}(-\d+)?$/;
  instant = string2().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "Expected a UTC date-time ending in Z").refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
  }, "Expected a calendar date-time that exists");
  deployTaskSchema = object({
    id: string2().regex(DEPLOY_TASK_ID),
    title: string2().min(1).max(200),
    env: _enum(DEPLOY_ENVS),
    status: _enum(["open", "done", "dropped"]),
    deploy: _enum(DEPLOY_STEPS),
    type: _enum(DEPLOY_TYPES),
    twin: string2().regex(DEPLOY_TASK_ID).optional(),
    flags: array(_enum(DEPLOY_FLAGS)).optional(),
    created: instant,
    closed: instant.optional(),
    from: string2().optional(),
    refs: array(string2()).optional(),
    evidence: string2().optional()
  }).passthrough();
});

// src/workflow/repo-path.ts
function normalizeRepoPath(raw) {
  const text = raw.trim().replaceAll("\\", "/");
  if (/\p{Cc}/u.test(text))
    return { ok: false, problem: "control" };
  if (/[*?]/.test(text))
    return { ok: false, problem: "pattern" };
  const kept = text.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (kept.length === 0)
    return { ok: false, problem: "root" };
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text))
    return { ok: false, problem: "absolute" };
  if (kept.includes(".."))
    return { ok: false, problem: "up" };
  const folder = text.endsWith("/") || text.endsWith("/.");
  return { ok: true, path: `${kept.join("/")}${folder ? "/" : ""}` };
}

// src/workflow/schema.ts
function numberSchema(rule) {
  const whole = number2().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}
function numberField(key) {
  return numberSchema(NUMBER_RULES[key]).optional();
}
function isLabelName(name) {
  return name.length >= 1 && name.length <= 50 && !name.startsWith("-") && !/[\p{Cc}\p{Cf},]/u.test(name) && name.trim() === name;
}
function labelsClash(labels) {
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (same(labels.foundLabel, labels.readyLabel)) {
    return `issues.foundLabel and issues.readyLabel are both ${labels.foundLabel}: the ready label is only a person's to add, so the kit's found label must be another word`;
  }
  if (same(labels.fixedLabel, labels.readyLabel)) {
    return `issues.fixedLabel and issues.readyLabel are both ${labels.fixedLabel}: the ready label is only a person's to add, so the kit's fixed label must be another word`;
  }
  if (same(labels.foundLabel, labels.fixedLabel)) {
    return `issues.foundLabel and issues.fixedLabel are both ${labels.foundLabel}: an issue could not be told found from fixed`;
  }
  return null;
}
function normalizeMergeFile(raw) {
  const parsed = normalizeRepoPath(raw);
  if (parsed.ok)
    return parsed;
  const shown = JSON.stringify(raw);
  const why = {
    control: `${shown} holds a control character`,
    pattern: `${shown} holds a pattern character (* or ?): name the path itself, and a whole folder with a trailing / (like plugin/dist/)`,
    root: `${shown} is the root: name the files or folders under it`,
    absolute: `${shown} is absolute: write it relative to the repository root`,
    up: `${shown} leaves the repository: no .. segments`
  };
  return { ok: false, why: why[parsed.problem] };
}
function normalizeAppendOnlyFolder(raw) {
  const parsed = normalizeMergeFile(raw);
  if (!parsed.ok || parsed.path.endsWith("/"))
    return parsed;
  return {
    ok: false,
    why: `${JSON.stringify(raw)} is not a folder: plans.appendOnly names folders, each ending in /`
  };
}
function oldNamesIn(raw) {
  return Object.keys(WORKFLOW_KEY_ALIASES).filter((old) => Object.hasOwn(raw, old)).map((old) => ({
    old,
    current: WORKFLOW_KEY_ALIASES[old],
    both: Object.hasOwn(raw, WORKFLOW_KEY_ALIASES[old])
  }));
}
function withCurrentNames(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return raw;
  const moved = { ...raw };
  for (const old of Object.keys(WORKFLOW_KEY_ALIASES)) {
    if (!Object.hasOwn(moved, old))
      continue;
    const current = WORKFLOW_KEY_ALIASES[old];
    if (!Object.hasOwn(moved, current))
      moved[current] = moved[old];
    delete moved[old];
  }
  return moved;
}
function readWithCurrentNames(raw, context) {
  const moved = withCurrentNames(raw);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return moved;
  const current = moved;
  for (const old of oldNamesIn(raw)) {
    if (old.both)
      continue;
    const checked = workflowObjectSchema.shape[old.current].safeParse(current[old.current]);
    if (checked.success)
      continue;
    const reason = checked.error.issues.map((issue) => issue.message).join(", ");
    context.issues.push({
      code: "custom",
      input: current[old.current],
      message: `${reason} (${old.old} is the old name of ${old.current})`,
      path: [old.old]
    });
    delete current[old.current];
  }
  return current;
}
function workflowValue(workflow, key) {
  const [head, tail] = key.split(".");
  if (head === undefined || tail === undefined)
    return workflow[head ?? ""];
  const group = workflow[head];
  if (typeof group !== "object" || group === null)
    return;
  return group[tail];
}
var PERCENT, AT_LEAST_ZERO, PHASE_COUNT, NUMBER_RULES, LABEL_RULE = "a label name of 1-50 characters on one line, with no comma, not starting with -", labelSchema, RUN_MODES, mergeFilesSchema, appendOnlySchema, WORKFLOW_KEY_ALIASES, workflowObjectSchema, workflowSchema, personalWorkflowSchema, workflowDefaults, SWITCH_NAMES, POLICY_KEYS, SWITCH_KEYS, WORKFLOW_KEYS;
var init_schema = __esm(() => {
  init_zod();
  PERCENT = { kind: "whole", max: 100, min: 1 };
  AT_LEAST_ZERO = { kind: "whole", min: 0 };
  PHASE_COUNT = { kind: "whole", max: 50, min: 1 };
  NUMBER_RULES = {
    "alerts.usagePercent": PERCENT,
    "fixesAfterReview.lines": AT_LEAST_ZERO,
    "fixesAfterReview.files": AT_LEAST_ZERO,
    "fixesAfterReview.percent": AT_LEAST_ZERO,
    "plans.maxPhases": PHASE_COUNT,
    "slopAudit.everyPlans": AT_LEAST_ZERO
  };
  labelSchema = string2().refine(isLabelName, LABEL_RULE);
  RUN_MODES = ["ask", "solo", "lead-children", "coordinator"];
  mergeFilesSchema = array(string2()).transform((paths, context) => {
    const normalised = [];
    for (const [index, raw] of paths.entries()) {
      const parsed = normalizeMergeFile(raw);
      if (!parsed.ok) {
        context.issues.push({ code: "custom", input: raw, message: parsed.why, path: [index] });
        return NEVER;
      }
      if (!normalised.includes(parsed.path))
        normalised.push(parsed.path);
    }
    return normalised;
  });
  appendOnlySchema = array(string2()).transform((paths, context) => {
    const folders = [];
    for (const [index, raw] of paths.entries()) {
      const parsed = normalizeAppendOnlyFolder(raw);
      if (!parsed.ok) {
        context.issues.push({ code: "custom", input: raw, message: parsed.why, path: [index] });
        return NEVER;
      }
      if (!folders.includes(parsed.path))
        folders.push(parsed.path);
    }
    return folders;
  });
  WORKFLOW_KEY_ALIASES = {
    autoCommit: "allowCommit",
    autoPush: "allowPush",
    autoMerge: "allowMerge"
  };
  workflowObjectSchema = strictObject({
    allowCommit: boolean2().optional(),
    allowPush: boolean2().optional(),
    openPr: _enum(["off", "draft", "ready"]).optional(),
    allowMerge: boolean2().optional(),
    mergeMethod: _enum(["merge", "squash", "rebase"]).optional(),
    deleteBranch: boolean2().optional(),
    reviewBeforePush: boolean2().optional(),
    reviewAgents: array(string2().min(1)).min(1).refine((agents) => new Set(agents).size === agents.length, "an agent is listed twice").optional(),
    fixesAfterReview: strictObject({
      lines: numberField("fixesAfterReview.lines"),
      files: numberField("fixesAfterReview.files"),
      percent: numberField("fixesAfterReview.percent")
    }).optional(),
    clearWorktreeAfterMerge: boolean2().optional(),
    plans: strictObject({
      maxPhases: numberField("plans.maxPhases"),
      mergeFiles: mergeFilesSchema.optional(),
      appendOnly: appendOnlySchema.optional()
    }).optional(),
    issues: strictObject({
      enabled: boolean2().optional(),
      allowPublic: boolean2().optional(),
      watch: unknown().optional(),
      watchMinutes: unknown().optional(),
      foundLabel: labelSchema.optional(),
      fixedLabel: labelSchema.optional(),
      readyLabel: labelSchema.optional()
    }).superRefine((issues, context) => {
      const clash = labelsClash({
        fixedLabel: issues.fixedLabel ?? workflowDefaults.issues.fixedLabel,
        foundLabel: issues.foundLabel ?? workflowDefaults.issues.foundLabel,
        readyLabel: issues.readyLabel ?? workflowDefaults.issues.readyLabel
      });
      if (clash !== null)
        context.addIssue({ code: "custom", message: clash });
    }).optional(),
    alerts: strictObject({
      events: unknown().optional(),
      sound: unknown().optional(),
      usagePercent: numberField("alerts.usagePercent")
    }).transform(({ events: _events, sound: _sound, ...usage }) => usage).optional(),
    slopAudit: strictObject({
      everyPlans: numberField("slopAudit.everyPlans")
    }).optional(),
    crew: unknown().optional()
  });
  workflowSchema = preprocess(readWithCurrentNames, workflowObjectSchema);
  personalWorkflowSchema = preprocess(readWithCurrentNames, workflowObjectSchema.extend({
    plans: strictObject({
      maxPhases: numberField("plans.maxPhases"),
      runMode: _enum(RUN_MODES).optional()
    }).optional(),
    switches: strictObject({ jobRoute: boolean2().optional(), leadHint: boolean2().optional() }).optional()
  }));
  workflowDefaults = {
    allowCommit: false,
    allowPush: false,
    openPr: "off",
    allowMerge: false,
    mergeMethod: "merge",
    deleteBranch: false,
    reviewBeforePush: true,
    reviewAgents: ["cc-smart-dev-kit:senior-engineer"],
    fixesAfterReview: {
      lines: 200,
      files: 10,
      percent: 20
    },
    clearWorktreeAfterMerge: true,
    issues: {
      enabled: true,
      allowPublic: false,
      foundLabel: "kit:found",
      fixedLabel: "fixed-unreleased",
      readyLabel: "kit:ready"
    },
    alerts: {
      usagePercent: 85
    },
    slopAudit: {
      everyPlans: 5
    },
    plans: {
      maxPhases: 10,
      mergeFiles: [],
      appendOnly: [],
      runMode: "ask"
    }
  };
  SWITCH_NAMES = [
    "statusLine",
    "sessionNames",
    "jobRoute",
    "updateHold",
    "leadHint"
  ];
  POLICY_KEYS = [
    "allowCommit",
    "allowPush",
    "openPr",
    "allowMerge",
    "mergeMethod",
    "deleteBranch",
    "reviewBeforePush",
    "reviewAgents",
    "fixesAfterReview.lines",
    "fixesAfterReview.files",
    "fixesAfterReview.percent",
    "clearWorktreeAfterMerge",
    "issues.enabled",
    "issues.allowPublic",
    "issues.foundLabel",
    "issues.fixedLabel",
    "issues.readyLabel",
    "alerts.usagePercent",
    "slopAudit.everyPlans",
    "plans.maxPhases",
    "plans.runMode",
    "plans.mergeFiles",
    "plans.appendOnly"
  ];
  SWITCH_KEYS = SWITCH_NAMES.map((name) => `switches.${name}`);
  WORKFLOW_KEYS = [...POLICY_KEYS, ...SWITCH_KEYS];
});

// src/project/version-range.ts
function isValidRange(range) {
  const alternatives = range.split("||").map((part) => part.trim());
  if (alternatives.some((part) => part === ""))
    return false;
  return alternatives.every((part) => {
    if (HYPHEN.test(part))
      return true;
    const comparators = part.replace(/([<>]=?|=|\^|~)\s+/g, "$1").split(/\s+/);
    return comparators.every((comparator) => COMPARATOR.test(comparator));
  });
}
var NUMBER = "(?:x|X|\\*|0|[1-9]\\d*)", IDENT = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*", PARTIAL, COMPARATOR, HYPHEN, WRITTEN_VERSION;
var init_version_range = __esm(() => {
  PARTIAL = `v?${NUMBER}(?:\\.${NUMBER}(?:\\.${NUMBER}(?:-${IDENT})?(?:\\+${IDENT})?)?)?`;
  COMPARATOR = new RegExp(`^(?:[<>]=?|=|\\^|~)?${PARTIAL}$`);
  HYPHEN = new RegExp(`^(${PARTIAL})\\s+-\\s+(${PARTIAL})$`);
  WRITTEN_VERSION = new RegExp(`v?(${NUMBER})(?:\\.(${NUMBER})(?:\\.(${NUMBER})(?:-(${IDENT}))?(?:\\+${IDENT})?)?)?`, "g");
});

// src/project/config.ts
import { posix, win32 } from "path";
var PLUGIN_HOOK_NAMES, RETIRED_HOOK_NAMES, UNSWITCHABLE_HOOK_NAMES, deployCommandEntry, deployCommandList, inCheckout, IGNORED_TASK_SCHEMAS, IGNORED_TASK_FIELDS, ccSmartDevKitConfigSchema;
var init_config = __esm(() => {
  init_zod();
  init_build_info();
  init_kinds();
  init_managed_json();
  init_user_json();
  init_command();
  init_format();
  init_schema();
  init_config_facts();
  init_version_range();
  init_config_facts();
  PLUGIN_HOOK_NAMES = [
    "fable-session",
    "tier-view",
    "after-merge",
    "review-record",
    "subagent-background",
    "builder-finish",
    "verify-gate",
    "keep-going",
    "agent-usage",
    "worktree-leftovers",
    "session-name",
    "task-start"
  ];
  RETIRED_HOOK_NAMES = [
    "serena-root",
    "crew-role",
    "lead-notes",
    "message-guard",
    "git-guard",
    "merge-guard",
    "deploy-guard",
    "main-folder-guard",
    "agent-guard",
    "session-escape-guard"
  ];
  UNSWITCHABLE_HOOK_NAMES = ["job-route"];
  deployCommandEntry = union([string2(), matchRuleSchema], { error: "is not a command or a match rule" }).superRefine((entry, ctx) => {
    if (typeof entry !== "string")
      return;
    const steps = shellSteps(entry);
    if (steps.every((step) => step.text.trim() === ""))
      ctx.addIssue({
        code: "custom",
        message: `${JSON.stringify(entry)} holds no command: write one command, such as \`vercel --prod\``
      });
    else if (steps.length > 1)
      ctx.addIssue({
        code: "custom",
        message: `${JSON.stringify(entry)} holds more than one command or a shell construct (;, &&, ||, |, &, a new line, $(\u2026), a here-doc or a group): write one plain command, such as \`vercel --prod\`; extra words in a run still match`
      });
  });
  deployCommandList = array(deployCommandEntry).min(1, "is an empty list: list at least one command, or remove the key");
  inCheckout = string2().min(1).refine((path) => !posix.isAbsolute(path) && !win32.isAbsolute(path) && !path.split(/[\\/]/).includes(".."), "must be relative to the checkout root, without ..").refine((path) => !path.includes("\\"), "use / as the separator").refine((path) => !path.split("/").includes("."), "must not contain . segments");
  IGNORED_TASK_SCHEMAS = {
    releaseBranch: string2().trim().min(1).optional(),
    legacyFolders: array(inCheckout).optional()
  };
  IGNORED_TASK_FIELDS = Object.keys(IGNORED_TASK_SCHEMAS);
  ccSmartDevKitConfigSchema = strictObject({
    requires: string2().refine(isValidRange, 'not a valid version range (like ">=1.2" or "^1.2")').optional(),
    worktrees: strictObject({
      base: string2().min(1),
      guardMainFolder: boolean2().optional(),
      autoClean: boolean2().optional(),
      rebuildable: array(inCheckout.refine((path) => /[^*?/[\]{},!.]/.test(path), "names nothing; list the folder or file name")).optional(),
      bases: record(string2(), string2().min(1)).refine((bases) => Object.keys(bases).every((prefix) => prefix.endsWith("/")), {
        error: (issue) => {
          const given = issue.input;
          const wrong = typeof given === "object" && given !== null ? Object.keys(given).find((prefix) => !prefix.endsWith("/")) : undefined;
          return `"${wrong ?? "a prefix"}" must end with "/" (a branch-name prefix, like "release/")`;
        }
      }).optional()
    }).optional(),
    protectedBranches: array(string2().min(1)).min(1).optional(),
    checks: strictObject({ fast: string2().trim().min(1) }).optional(),
    sessionNames: boolean2().optional(),
    instructions: boolean2().optional(),
    autoMode: array(string2().min(1)).optional(),
    jobs: strictObject({ kinds: kindsSchema.optional(), route: boolean2().optional() }).optional(),
    tasks: strictObject({
      dir: inCheckout.optional(),
      staleDays: number2().int().min(1).optional(),
      envs: array(_enum(DEPLOY_ENVS)).min(1).refine((envs) => new Set(envs).size === envs.length, "Each environment once").optional(),
      deployCommands: strictObject({ prod: deployCommandList.optional(), staging: deployCommandList.optional() }).refine((commands) => Object.keys(commands).length > 0, "is empty: list the commands for an environment, or remove the key").optional(),
      ...IGNORED_TASK_SCHEMAS
    }).superRefine((tasks, ctx) => {
      if (tasks.envs?.length === 0)
        return;
      const envs = tasks.envs ?? DEPLOY_ENVS;
      for (const env of Object.keys(tasks.deployCommands ?? {}))
        if (!envs.includes(env))
          ctx.addIssue({
            code: "custom",
            path: ["deployCommands", env],
            message: `is not one of tasks.envs (${envs.join(", ")}): remove it, or add ${env} to tasks.envs`
          });
    }).optional(),
    workflow: workflowSchema.optional(),
    ownHooks: array(_enum([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES, ...UNSWITCHABLE_HOOK_NAMES])).optional()
  });
});

// src/project/resolve.ts
var init_resolve = __esm(() => {
  init_config();
  init_config_facts();
  init_git_env();
  init_locate();
  init_config_facts();
  init_locate();
});

// src/setup/launcher.ts
var LAUNCHER_NAME = "cc-smart-dev-kit", LAUNCHER_IN_SHELL, FIND_INSTALL_JS;
var init_launcher = __esm(() => {
  init_build_info();
  init_write();
  LAUNCHER_IN_SHELL = `"$HOME/.local/bin/${LAUNCHER_NAME}"`;
  FIND_INSTALL_JS = [
    "const f=process.argv[process.argv.length-1];",
    'const j=JSON.parse(require("fs").readFileSync(f,"utf8"));',
    `const e=((j&&j.plugins&&j.plugins["${PLUGIN_ID}"])||[]).find(x=>x&&x.scope==="user"&&typeof x.installPath==="string");`,
    "if(!e)process.exit(1);",
    "process.stdout.write(e.installPath);"
  ].join("");
});

// src/setup/statusline.ts
import { join as join8 } from "path";
function statuslineSetting(paths) {
  return { command: `${shellWord(join8(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
}
var init_statusline = __esm(() => {
  init_launcher();
});

// src/zod-issues.ts
function describeIssues(issues) {
  return issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
    return issue.code === "unrecognized_keys" ? `${issue.keys.join(", ")}: unknown field` : `${field}: ${issue.message}`;
  }).join("; ");
}

// src/workflow/merge.ts
function current(value, source) {
  return { value, source };
}
function mergedGroup(personal, project) {
  if (personal === undefined)
    return project;
  if (project === undefined)
    return personal;
  return { ...personal, ...project };
}
function mergeWorkflows(personal, project) {
  const merged = { ...personal, ...project };
  const alerts = mergedGroup(personal.alerts, project.alerts);
  if (alerts !== undefined)
    merged.alerts = alerts;
  const fixes = mergedGroup(personal.fixesAfterReview, project.fixesAfterReview);
  if (fixes !== undefined)
    merged.fixesAfterReview = fixes;
  const slopAudit = mergedGroup(personal.slopAudit, project.slopAudit);
  if (slopAudit !== undefined)
    merged.slopAudit = slopAudit;
  const issues = mergedGroup(personal.issues, project.issues);
  if (issues !== undefined)
    merged.issues = issues;
  const plans = mergedGroup(personal.plans, project.plans);
  if (plans !== undefined)
    merged.plans = plans;
  return merged;
}
function jobRouteFrom(personal, projectConfig) {
  const project = projectConfig?.jobs?.route;
  if (project !== undefined)
    return current(project, "project");
  const own = personal.switches?.jobRoute;
  return own === undefined ? current(false, "default") : current(own, "personal");
}
function leadHintFrom(personal) {
  const own = personal.switches?.leadHint;
  return own === undefined ? current(LEAD_HINT_DEFAULT, "default") : current(own, "personal");
}
var LEAD_HINT_DEFAULT = true;

// src/workflow/resolve.ts
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "fs";
function personalWorkflowFile(paths) {
  return paths.workflowConfigFile;
}
function invalidJson(file, error) {
  const reason = error instanceof Error ? error.message : String(error);
  return new WorkflowConfigError(`Invalid ${file}: not valid JSON (${reason})`);
}
function parseWorkflowText(text, file) {
  let raw;
  try {
    raw = parseUserJson(text);
  } catch (error) {
    throw invalidJson(file, error);
  }
  const parsed = personalWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowConfigError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}
function loadWorkflow(file) {
  if (!existsSync6(file))
    return {};
  let text;
  try {
    text = readFileSync6(file, "utf8");
  } catch (error) {
    throw invalidJson(file, error);
  }
  return parseWorkflowText(text, file);
}
function sourceOf(personal, project, key) {
  if (workflowValue(project, key) !== undefined)
    return "project";
  return workflowValue(personal, key) !== undefined ? "personal" : "default";
}
function alertsFrom(personal, project) {
  const merged = mergeWorkflows(personal, project);
  const alerts = merged.alerts ?? {};
  const of = (key, value) => ({
    value,
    source: sourceOf(personal, project, key)
  });
  return {
    usagePercent: of("alerts.usagePercent", alerts.usagePercent ?? workflowDefaults.alerts.usagePercent)
  };
}
function plansFrom(personal, project) {
  const plans = mergeWorkflows(personal, project).plans ?? {};
  const mergeFiles = project.plans?.mergeFiles;
  const appendOnly = project.plans?.appendOnly;
  const runMode = personal.plans?.runMode;
  return {
    maxPhases: {
      value: plans.maxPhases ?? workflowDefaults.plans.maxPhases,
      source: sourceOf(personal, project, "plans.maxPhases")
    },
    mergeFiles: mergeFiles === undefined ? current([...workflowDefaults.plans.mergeFiles], "default") : current(mergeFiles, "project"),
    appendOnly: appendOnly === undefined ? current([...workflowDefaults.plans.appendOnly], "default") : current(appendOnly, "project"),
    runMode: runMode === undefined ? current(workflowDefaults.plans.runMode, "default") : current(runMode, "personal")
  };
}
function statusLineIsOurs(paths) {
  try {
    const parsed = readUserJson(paths.settingsFile);
    if (typeof parsed !== "object" || parsed === null)
      return false;
    const statusLine = parsed.statusLine;
    return Bun.deepEquals(statusLine, statuslineSetting(paths), true);
  } catch {
    return false;
  }
}
function projectFlag(value) {
  return value === undefined ? current(false, "default") : current(value, "project");
}
function resolveWorkflow(paths, projectConfig) {
  const personal = loadWorkflow(personalWorkflowFile(paths));
  const project = projectConfig?.workflow ?? {};
  const merged = mergeWorkflows(personal, project);
  const of = (key, value) => ({
    value,
    source: sourceOf(personal, project, key)
  });
  const fixes = merged.fixesAfterReview ?? {};
  const issues = merged.issues ?? {};
  const slopAudit = merged.slopAudit ?? {};
  return {
    allowCommit: of("allowCommit", merged.allowCommit ?? workflowDefaults.allowCommit),
    allowPush: of("allowPush", merged.allowPush ?? workflowDefaults.allowPush),
    openPr: of("openPr", merged.openPr ?? workflowDefaults.openPr),
    allowMerge: of("allowMerge", merged.allowMerge ?? workflowDefaults.allowMerge),
    mergeMethod: of("mergeMethod", merged.mergeMethod ?? workflowDefaults.mergeMethod),
    deleteBranch: of("deleteBranch", merged.deleteBranch ?? workflowDefaults.deleteBranch),
    reviewBeforePush: of("reviewBeforePush", merged.reviewBeforePush ?? workflowDefaults.reviewBeforePush),
    reviewAgents: of("reviewAgents", merged.reviewAgents ?? [...workflowDefaults.reviewAgents]),
    fixesAfterReview: {
      lines: of("fixesAfterReview.lines", fixes.lines ?? workflowDefaults.fixesAfterReview.lines),
      files: of("fixesAfterReview.files", fixes.files ?? workflowDefaults.fixesAfterReview.files),
      percent: of("fixesAfterReview.percent", fixes.percent ?? workflowDefaults.fixesAfterReview.percent)
    },
    clearWorktreeAfterMerge: of("clearWorktreeAfterMerge", merged.clearWorktreeAfterMerge ?? workflowDefaults.clearWorktreeAfterMerge),
    issues: {
      enabled: of("issues.enabled", issues.enabled ?? workflowDefaults.issues.enabled),
      allowPublic: of("issues.allowPublic", issues.allowPublic ?? workflowDefaults.issues.allowPublic),
      foundLabel: of("issues.foundLabel", issues.foundLabel ?? workflowDefaults.issues.foundLabel),
      fixedLabel: of("issues.fixedLabel", issues.fixedLabel ?? workflowDefaults.issues.fixedLabel),
      readyLabel: of("issues.readyLabel", issues.readyLabel ?? workflowDefaults.issues.readyLabel)
    },
    alerts: alertsFrom(personal, project),
    slopAudit: {
      everyPlans: of("slopAudit.everyPlans", slopAudit.everyPlans ?? workflowDefaults.slopAudit.everyPlans)
    },
    plans: plansFrom(personal, project),
    switches: {
      statusLine: statusLineIsOurs(paths) ? current(true, "personal") : current(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: jobRouteFrom(personal, projectConfig),
      updateHold: isHeld(updateFiles(paths.stateDir)) ? current(true, "personal") : current(false, "default"),
      leadHint: leadHintFrom(personal)
    }
  };
}
var WorkflowConfigError;
var init_resolve2 = __esm(() => {
  init_git();
  init_resolve();
  init_statusline();
  init_user_json();
  init_state();
  init_schema();
  WorkflowConfigError = class WorkflowConfigError extends Error {
    name = "WorkflowConfigError";
  };
});

// src/setup/installed-plugins.ts
var init_installed_plugins = __esm(() => {
  init_build_info();
});

// src/tasks/deploy/files.ts
var init_files = __esm(() => {
  init_path_compare();
  init_write();
  init_format();
});

// src/tasks/deploy/check.ts
var init_check = __esm(() => {
  init_path_compare();
  init_config();
  init_words();
  init_files();
  init_format();
});

// src/tasks/context.ts
var exports_context = {};
__export(exports_context, {
  projectKey: () => projectKey
});
function projectKey(repo) {
  return repoKey(repo);
}
var init_context = __esm(() => {
  init_build_info();
  init_paths2();
  init_config();
  init_resolve();
  init_installed_plugins();
  init_reviews();
  init_check();
  init_files();
  init_format();
});

// src/jobs/ancestry.ts
import { readFileSync as readFileSync7 } from "fs";
function parentPidFromStat(stat) {
  const end = stat.lastIndexOf(")");
  if (end === -1)
    return null;
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}
function ancestorsBy(pid, parentOf) {
  const ancestors = [];
  const seen = new Set([pid]);
  let current = pid;
  while (ancestors.length < MAX_DEPTH) {
    const parent = parentOf(current);
    if (parent === null || parent === 0 || seen.has(parent))
      break;
    ancestors.push(parent);
    seen.add(parent);
    current = parent;
  }
  return ancestors;
}
function ancestorPids(pid, readStat) {
  return ancestorsBy(pid, (one) => {
    const stat = readStat(one);
    return stat === null ? null : parentPidFromStat(stat);
  });
}
function readProcStat(pid) {
  try {
    return readFileSync7(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null;
  }
}
var MAX_DEPTH = 128;
var init_ancestry = () => {};

// src/hooks/sessions.ts
import { existsSync as existsSync7, readdirSync as readdirSync4, readFileSync as readFileSync8, statSync as statSync6 } from "fs";
import { uptime } from "os";
import { join as join9 } from "path";
function parseSessionRecord(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null)
    return null;
  const { cwd, name, pid, sessionId, procStart } = value;
  if (typeof cwd !== "string" || typeof pid !== "number" || typeof sessionId !== "string") {
    return null;
  }
  return {
    pid,
    sessionId,
    cwd,
    name: typeof name === "string" ? name : sessionId.slice(0, 8),
    ...typeof procStart === "string" ? { procStart } : {}
  };
}
function processStart(pid, facts) {
  if ((facts.platform ?? process.platform) !== "linux")
    return;
  const stat = (facts.readStat ?? readProcStat)(pid);
  const end = stat?.lastIndexOf(")") ?? -1;
  const start = end < 0 ? undefined : stat?.slice(end + 1).trim().split(/\s+/)[19];
  return start !== undefined && /^\d+$/.test(start) ? start : undefined;
}
function sessionIdentityProved(record, facts = {}) {
  return record.procStart !== undefined && processStart(record.pid, facts) === record.procStart;
}
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function sessionRecordOf(claudeConfigDir, pid, facts = {}) {
  if (!(facts.running ?? isRunning)(pid))
    return null;
  const dir = join9(claudeConfigDir, "sessions");
  const file = join9(dir, `${pid}.json`);
  const bootedAt = Date.now() - uptime() * 1000;
  let text;
  try {
    if (statSync6(file).mtimeMs < bootedAt)
      return null;
    text = readFileSync8(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw new Error(`the record of running session ${pid} cannot be read; retry`);
  }
  const record = parseSessionRecord(text);
  if (record === null) {
    throw new Error(`the record of running session ${pid} in ${dir} cannot be read, so it is unknown where it works`);
  }
  if ((facts.platform ?? process.platform) === "linux" && record.procStart !== undefined) {
    const start = processStart(pid, facts);
    if (start !== undefined && record.procStart !== start)
      return null;
  }
  return record;
}
function liveSessions(claudeConfigDir, facts = {}) {
  const dir = join9(claudeConfigDir, "sessions");
  if (!existsSync7(dir))
    return [];
  const live = [];
  for (const file of readdirSync4(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid))
      continue;
    const record = sessionRecordOf(claudeConfigDir, pid, facts);
    if (record !== null)
      live.push(record);
  }
  return live;
}
var init_sessions = __esm(() => {
  init_ancestry();
});

// src/worktrees/machine-facts.ts
import { readdirSync as readdirSync5, readFileSync as readFileSync9, readlinkSync as readlinkSync2 } from "fs";
import { platform } from "os";
function spawnPrograms(argv) {
  return Bun.spawnSync([...argv], {
    stderr: "pipe",
    stdout: "pipe",
    timeout: PROGRAMS_TIMEOUT_MS
  });
}
function parsePrograms(lines) {
  const programs = [];
  for (const line of lines.split(/\r?\n/)) {
    const fields = line.split("\t");
    const pid = Number(fields[0]?.trim() ?? "");
    const parentPid = Number(fields[1]?.trim() ?? "");
    const path = fields.slice(2).join("\t").trim();
    if (!Number.isInteger(pid) || pid <= 0)
      continue;
    if (!Number.isInteger(parentPid) || parentPid < 0)
      continue;
    if (path === "")
      continue;
    programs.push({ parentPid, path, pid });
  }
  return programs;
}
function parseCommandLines(lines) {
  const programs = [];
  for (const line of lines.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "")
      continue;
    const afterPid = text.indexOf(" ");
    if (afterPid === -1)
      continue;
    const pid = Number(text.slice(0, afterPid));
    const rest = text.slice(afterPid + 1).trimStart();
    const afterParent = rest.indexOf(" ");
    if (afterParent === -1)
      continue;
    const parentPid = Number(rest.slice(0, afterParent));
    const path = rest.slice(afterParent + 1).trim();
    if (!Number.isInteger(pid) || pid <= 0)
      continue;
    if (!Number.isInteger(parentPid) || parentPid < 0)
      continue;
    if (path === "")
      continue;
    programs.push({ parentPid, path, pid });
  }
  return programs;
}
function cwdOf(pid) {
  try {
    return readlinkSync2(`/proc/${String(pid)}/cwd`);
  } catch {
    return;
  }
}
function procPids() {
  try {
    return readdirSync5("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
  } catch {
    return [];
  }
}
function runningPrograms(on = platform(), spawn = spawnPrograms) {
  if (on === "win32") {
    try {
      const run = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", LIST_PROGRAMS], {
        stderr: "pipe",
        stdout: "pipe",
        timeout: PROGRAMS_TIMEOUT_MS,
        windowsHide: true
      });
      return run.exitCode === 0 ? parsePrograms(run.stdout.toString()) : "unknown";
    } catch {
      return "unknown";
    }
  }
  let lines;
  try {
    const run = spawn(PS_PROGRAMS_ARGV);
    if (run.exitCode !== 0)
      return "unknown";
    lines = run.stdout.toString();
  } catch {
    return "unknown";
  }
  const programs = parseCommandLines(lines);
  if (on !== "linux")
    return programs;
  for (const pid of procPids()) {
    const cwd = cwdOf(pid);
    if (cwd === undefined)
      continue;
    const known = programs.find((program) => program.pid === pid);
    if (known === undefined)
      programs.push({ cwd, path: null, pid });
    else
      known.cwd = cwd;
  }
  return programs;
}
var PROGRAMS_TIMEOUT_MS = 15000, PS_PROGRAMS_ARGV, OUR_TOOLS, SHELL_NAMES, LIST_PROGRAMS;
var init_machine_facts = __esm(() => {
  init_git();
  PS_PROGRAMS_ARGV = ["ps", "-ww", "-axo", "pid=,ppid=,args="];
  OUR_TOOLS = new Set(["git", "docker", "ps", "powershell", "pgrep"]);
  SHELL_NAMES = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "pwsh", "powershell"]);
  LIST_PROGRAMS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + "Get-CimInstance Win32_Process | Where-Object ExecutablePath | " + 'ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)" }';
});

// src/tasks/work/identity.ts
var exports_identity = {};
__export(exports_identity, {
  CLAIM_PROCESS: () => CLAIM_PROCESS,
  callerOf: () => callerOf,
  claimGone: () => claimGone
});
function listedParentOf(platform) {
  let listed = null;
  return (pid) => {
    if (listed === null) {
      const found = runningPrograms(platform);
      listed = new Map(found === "unknown" ? [] : found.map((one) => [one.pid, one]));
    }
    return listed.get(pid)?.parentPid ?? null;
  };
}
function claimLive(claim, facts = {}) {
  const platform = facts.platform ?? process.platform;
  if (platform !== "linux")
    return (facts.running ?? isRunning)(claim.pid);
  return claim.procStart !== null && sessionIdentityProved({
    pid: claim.pid,
    procStart: claim.procStart,
    sessionId: claim.sessionId ?? "",
    cwd: "",
    name: ""
  }, { platform, ...facts.readStat ? { readStat: facts.readStat } : {} });
}
function claimGone(claim, facts = {}) {
  if (!(facts.running ?? isRunning)(claim.pid))
    return true;
  const platform = facts.platform ?? process.platform;
  if (platform !== "linux" || claim.procStart === null)
    return false;
  const start = processStart(claim.pid, {
    platform,
    ...facts.readStat ? { readStat: facts.readStat } : {}
  });
  return start !== undefined && start !== claim.procStart;
}
function sessionEnded(claim, facts = {}) {
  if (!claimGone(claim, facts))
    return false;
  if (claim.sessionId === null)
    return true;
  try {
    const dir = facts.claudeConfigDir ?? cliPaths(facts.env ?? process.env).claudeConfigDir;
    const records = facts.sessions ? facts.sessions(dir) : liveSessions(dir, {
      ...facts.platform ? { platform: facts.platform } : {},
      ...facts.readStat ? { readStat: facts.readStat } : {},
      ...facts.running ? { running: facts.running } : {}
    });
    return !records.some((record) => record.sessionId === claim.sessionId);
  } catch {
    return false;
  }
}
function callerOf(facts = {}) {
  const env = facts.env ?? process.env;
  const platform = facts.platform ?? process.platform;
  const pid = facts.pid ?? process.pid;
  const readStat = facts.readStat ?? readProcStat;
  const config = facts.claudeConfigDir ?? cliPaths(env).claudeConfigDir;
  const cacheKey = `${config}:${pid}:${platform}`;
  const recordOf = (p) => sessionRecordOf(config, p, {
    readStat,
    platform,
    ...facts.running ? { running: facts.running } : {}
  });
  const previous = cached2.get(cacheKey);
  const remembered = previous ? recordOf(previous.pid) : null;
  let record = remembered !== null && (remembered.procStart ?? null) === previous?.procStart ? remembered : null;
  if (!record) {
    const parent = facts.ppid ?? process.ppid;
    const grandparent = platform === "linux" ? null : (facts.parentOf ?? listedParentOf(platform))(parent);
    const pids = platform === "linux" ? ancestorPids(pid, readStat) : [parent, ...grandparent ? [grandparent] : []];
    for (const p of pids) {
      record = recordOf(p);
      if (record !== null)
        break;
    }
  }
  if (record) {
    cached2.set(cacheKey, { pid: record.pid, procStart: record.procStart ?? null });
    return {
      sessionId: record.sessionId,
      pid: record.pid,
      procStart: record.procStart ?? null,
      cwd: record.cwd,
      name: record.name
    };
  }
  cached2.delete(cacheKey);
  const sessionId = env.CLAUDE_CODE_SESSION_ID?.trim();
  return sessionId ? {
    sessionId,
    pid: null,
    procStart: null,
    cwd: facts.cwd ?? process.cwd(),
    name: null
  } : null;
}
var CLAIM_PROCESS, cached2;
var init_identity = __esm(() => {
  init_paths2();
  init_sessions();
  init_ancestry();
  init_machine_facts();
  CLAIM_PROCESS = {
    live: (claim) => claimLive(claim),
    gone: (claim) => claimGone(claim),
    ended: (claim) => sessionEnded(claim)
  };
  cached2 = new Map;
});

// src/tasks/work/graph.ts
function isOpen(task) {
  return task.status === "pending" || task.status === "in_progress";
}
function inProgressFirst(a, b) {
  return Number(b.status === "in_progress") - Number(a.status === "in_progress") || a.number - b.number;
}

class TaskGraph {
  byId;
  children = new Map;
  added = new Map;
  constructor(tasks) {
    this.byId = new Map(tasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (!task.parentId)
        continue;
      const siblings = this.children.get(task.parentId);
      if (siblings)
        siblings.push(task);
      else
        this.children.set(task.parentId, [task]);
    }
  }
  childrenOf(id) {
    return this.children.get(id) ?? [];
  }
  waitsOf(id) {
    return [...this.byId.get(id)?.waitsFor ?? [], ...this.added.get(id) ?? []];
  }
  addWait(id, ref) {
    const waits = this.added.get(id);
    if (waits)
      waits.push(ref);
    else
      this.added.set(id, [ref]);
  }
  ancestorsOf(task) {
    const up = [];
    const seen = new Set([task.id]);
    for (let parent = this.byId.get(task.parentId ?? "");parent && !seen.has(parent.id); parent = this.byId.get(parent.parentId ?? "")) {
      seen.add(parent.id);
      up.push(parent);
    }
    return up;
  }
  holdingUnder(id) {
    const seen = new Set([id]);
    const result = [];
    const walk = (parent) => {
      for (const child of this.childrenOf(parent)) {
        if (seen.has(child.id) || child.type === "non-blocking")
          continue;
        seen.add(child.id);
        if (isOpen(child))
          result.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return result.sort(inProgressFirst);
  }
  waitsFor(start, target) {
    const reached = new Set;
    const pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (!id || reached.has(id))
        continue;
      if (id === target)
        return true;
      reached.add(id);
      pending.push(...this.waitsOf(id), ...this.holdingUnder(id).map((held) => held.id));
    }
    return false;
  }
}
function blockRefusal(graph, task, other) {
  if (graph.ancestorsOf(task).some((up) => up.id === other.id))
    return "under";
  const seen = new Set;
  const pending = [other.id];
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id))
      continue;
    if (id === task.id)
      return "cycle";
    seen.add(id);
    pending.push(...graph.waitsOf(id));
  }
  return graph.waitsFor(other.id, task.id) ? "through" : null;
}
var BLOCK_REFUSAL_WORDS;
var init_graph = __esm(() => {
  BLOCK_REFUSAL_WORDS = {
    under: "it sits above this task",
    cycle: "it would make a blocker cycle",
    through: "it already waits for this task, through a parent"
  };
});

// src/tasks/work/queries.ts
function hasFilesTable(db) {
  return db.sqlite.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_files'").get() !== null;
}
function storedFiles(db, project) {
  const files = new Map;
  if (!hasFilesTable(db))
    return files;
  for (const row of db.sqlite.query("SELECT f.task_id,f.path FROM task_files f JOIN tasks t ON t.id=f.task_id WHERE t.project=? ORDER BY f.path").all(project)) {
    const paths = files.get(row.task_id) ?? [];
    paths.push(row.path);
    files.set(row.task_id, paths);
  }
  return files;
}
function allTasks(db, project) {
  const dependencies = new Map;
  for (const row of db.sqlite.query("SELECT d.task_id,d.waits_for FROM task_deps d JOIN tasks t ON t.id=d.task_id WHERE t.project=? ORDER BY d.waits_for").all(project)) {
    const refs = dependencies.get(row.task_id) ?? [];
    refs.push(row.waits_for);
    dependencies.set(row.task_id, refs);
  }
  const files = storedFiles(db, project);
  return db.sqlite.query("SELECT * FROM tasks WHERE project=? ORDER BY number").all(project).map((row) => ({
    id: row.id,
    number: row.number,
    project: row.project,
    parentId: row.parent_id,
    kind: row.kind,
    subject: row.subject,
    description: row.description,
    status: row.status,
    plan: row.plan,
    phase: row.phase,
    agent: row.agent ?? null,
    branch: row.branch ?? null,
    worktree: row.worktree ?? null,
    base: row.base ?? null,
    createdBy: row.created_by,
    creator: row.created_pid == null ? null : {
      pid: row.created_pid,
      procStart: row.created_start ?? null,
      sessionId: row.created_by
    },
    claim: row.claim_pid === null ? null : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    waitsFor: dependencies.get(row.id) ?? [],
    type: row.blocking === 0 ? "non-blocking" : "blocking",
    files: files.get(row.id) ?? [],
    lead: row.lead_handout == null ? null : {
      sessionId: row.lead_session ?? null,
      pid: row.lead_pid ?? null,
      procStart: row.lead_start ?? null,
      holder: row.lead_child === 1 ? "child" : "self",
      handoutId: row.lead_handout
    },
    stackedOn: row.stacked_on ?? null
  }));
}
function runningTasksOf(all, plan) {
  if (plan === null)
    return [];
  return all.filter((t) => t.kind !== "plan" && t.plan === plan && t.status === "in_progress");
}
function isSessionWork(task) {
  return task.createdBy !== null || task.creator !== null || task.claim !== null;
}
function hasRunningTask(all, plan) {
  return runningTasksOf(all, plan.plan).some(isSessionWork);
}
function isInFlight(all, plan) {
  return plan.kind === "plan" && isOpen(plan) && (plan.status === "in_progress" || hasRunningTask(all, plan));
}
function ownerOf(who) {
  return (t) => who.sessionId !== null && t.createdBy === who.sessionId || claimHeldBy(t.claim, who) || claimHeldBy(t.creator, who);
}
function isLead(lead, who) {
  if (lead === null || !who)
    return false;
  if (who.sessionId !== null && lead.sessionId === who.sessionId)
    return true;
  return claimHeldBy(leadProcess(lead), who);
}
function leadProcess(lead) {
  return lead.pid === null ? null : { pid: lead.pid, procStart: lead.procStart, sessionId: lead.sessionId };
}
function openBlockers(task, byId) {
  return task.waitsFor.map((id) => byId.get(id)).filter((t) => t !== undefined && isOpen(t)).sort((a, b) => a.number - b.number);
}
function claimHeldBy(claim, who) {
  if (!claim || !who || who.pid === null || claim.pid !== who.pid)
    return false;
  if (claim.procStart !== null && who.procStart !== null)
    return claim.procStart === who.procStart;
  return who.sessionId !== null && claim.sessionId === who.sessionId;
}
var init_queries = __esm(() => {
  init_graph();
});

// src/tasks/work/lead-plans.ts
var exports_lead_plans = {};
__export(exports_lead_plans, {
  classifyLeadPlans: () => classifyLeadPlans
});
function reservedState(plan, owns, process2) {
  if (owns(plan))
    return plan.lead?.holder === "self" ? "own" : "with-child";
  const child = plan.creator;
  if (child === null || process2.live(child))
    return "with-child";
  return process2.ended(child) && (plan.claim === null || process2.ended(plan.claim)) ? "child-gone" : "with-child";
}
function classifyLeadPlans(db, project, who, process2 = CLAIM_PROCESS) {
  const all = allTasks(db, project);
  const byId = new Map(all.map((t) => [t.id, t]));
  const owns = ownerOf(who);
  const found = [];
  for (const plan of all) {
    if (plan.kind !== "plan")
      continue;
    if (isLead(plan.lead, who)) {
      const state = isOpen(plan) ? reservedState(plan, owns, process2) : "merging";
      found.push({ plan, state, waitingOn: [] });
    } else if (isOpen(plan) && plan.lead === null && owns(plan) && !isInFlight(all, plan)) {
      const waitingOn = openBlockers(plan, byId);
      const state = waitingOn.length > 0 ? "waiting" : plan.files.length === 0 ? "no-files" : "ready";
      found.push({ plan, state, waitingOn });
    }
  }
  return found;
}
var init_lead_plans = __esm(() => {
  init_identity();
  init_queries();
});

// src/tasks/work/db.ts
import { Database } from "bun:sqlite";
import { chmodSync as chmodSync2, existsSync as existsSync8, mkdirSync as mkdirSync5, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname5, join as join10 } from "path";
function workDbFile(paths) {
  return join10(paths.stateDir, "tasks", "work.db");
}
function restoreHolds(sqlite, projects, originalHolds, moved) {
  for (const tasks of projects.values()) {
    const graph = new TaskGraph(tasks.map((task) => {
      const row = moved.get(task.id);
      if (!row)
        return task;
      return {
        ...task,
        parentId: row.parent_id,
        type: row.blocking === 0 ? "non-blocking" : "blocking"
      };
    }));
    for (const task of graph.byId.values())
      for (const held of originalHolds.get(task.id) ?? []) {
        if (graph.waitsOf(task.id).includes(held.id))
          continue;
        const refusal = blockRefusal(graph, task, held);
        if (refusal) {
          sqlite.query("INSERT INTO task_events(task_id,project,number,at,action,changes,reason) VALUES (?,?,?,?,'noted',?,?)").run(task.id, task.project, task.number, Date.now(), JSON.stringify({
            note: [
              null,
              `hold on #${held.number} not restored: ${BLOCK_REFUSAL_WORDS[refusal]}`
            ]
          }), LEGACY_LIFT_REASON);
          continue;
        }
        sqlite.query("INSERT OR IGNORE INTO task_deps(task_id,waits_for) VALUES (?,?)").run(task.id, held.id);
        graph.addWait(task.id, held.id);
      }
  }
}
function repairTaskLayers(sqlite, file) {
  const nestedExists = sqlite.query("SELECT 1 FROM tasks t JOIN tasks p ON p.id=t.parent_id WHERE t.kind='task' AND p.kind='task' LIMIT 1").get();
  if (!nestedExists)
    return;
  const rows = sqlite.query("SELECT id,project,number,parent_id,kind,blocking,status FROM tasks ORDER BY project,number").all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const originalHolds = new Map;
  const reader = { sqlite, writable: false, close() {} };
  const projects = new Map;
  for (const project of new Set(rows.map((row) => row.project))) {
    const tasks = allTasks(reader, project);
    projects.set(project, tasks);
    const before = new TaskGraph(tasks);
    for (const task of tasks)
      if (task.kind === "task" && before.childrenOf(task.id).some((child) => child.kind === "task"))
        originalHolds.set(task.id, before.holdingUnder(task.id));
  }
  let backed = false;
  const move = (row, parent, above) => {
    if (!backed) {
      if (!existsSync8(`${file}.v4.bak`)) {
        try {
          writeFileSync3(`${file}.v4.bak.tmp`, sqlite.serialize(), { mode: 384 });
          renameSync2(`${file}.v4.bak.tmp`, `${file}.v4.bak`);
        } catch (error) {
          let cleanup = "";
          try {
            rmSync2(`${file}.v4.bak.tmp`, { force: true });
          } catch (cleanupError) {
            cleanup = ` Temporary backup cleanup also failed: ${String(cleanupError)}.`;
          }
          throw new BackupFailure(`task lift needs a backup: ${error instanceof Error ? error.message : String(error)}. Fix: free disk space and check folder rights for ${dirname5(file)}. The next task call tries again.${cleanup}`);
        }
      }
      backed = true;
    }
    const blocking = parent.blocking === 0 ? 0 : row.blocking;
    sqlite.query("UPDATE tasks SET parent_id=?,blocking=? WHERE id=?").run(above?.id ?? null, blocking, row.id);
    sqlite.query("INSERT INTO task_events(task_id,project,number,at,action,changes,reason) VALUES (?,?,?,?,'changed',?,?)").run(row.id, row.project, row.number, Date.now(), JSON.stringify({
      parent: [`#${parent.number}`, above === null ? null : `#${above.number}`],
      ...blocking !== row.blocking ? { type: ["blocking", "non-blocking"] } : {}
    }), LEGACY_LIFT_REASON);
    row.parent_id = above?.id ?? null;
    row.blocking = blocking;
  };
  for (;; ) {
    const nested = rows.find((row) => row.kind === "task" && byId.get(row.parent_id ?? "")?.kind === "task");
    if (!nested) {
      restoreHolds(sqlite, projects, originalHolds, byId);
      return;
    }
    const chain = [];
    const positions = new Map;
    let up = nested;
    while (up) {
      const at = positions.get(up.id);
      if (at !== undefined) {
        const lowest = chain.slice(at).filter((row) => row.kind === "task").sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))[0];
        if (!lowest) {
          up = undefined;
          break;
        }
        const parent = byId.get(lowest.parent_id ?? "");
        if (!parent)
          throw new Error("missing cycle parent");
        move(lowest, parent, null);
        break;
      }
      positions.set(up.id, chain.length);
      chain.push(up);
      up = byId.get(up.parent_id ?? "");
    }
    if (up)
      continue;
    const parent = byId.get(nested.parent_id ?? "");
    if (!parent)
      throw new Error("missing legacy task parent");
    move(nested, parent, byId.get(parent.parent_id ?? "") ?? null);
  }
}
function openWorkDb(file, options) {
  const hook = options.mode === "hook";
  const fresh = !existsSync8(file);
  if (hook && fresh)
    throw new Error("task store does not exist");
  if (!hook)
    mkdirSync5(dirname5(file), { recursive: true, mode: 448 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
  let writeRefusal;
  try {
    sqlite.run(`PRAGMA busy_timeout = ${hook ? HOOK_TIMEOUT_MS : WRITE_TIMEOUT_MS}`);
    sqlite.run("PRAGMA foreign_keys = ON");
    if (!hook) {
      chmodSync2(dirname5(file), 448);
      chmodSync2(file, 384);
      if (fresh)
        sqlite.run("PRAGMA journal_mode = WAL");
      sqlite.run("BEGIN IMMEDIATE");
      try {
        const version = sqlite.query("PRAGMA user_version").get()?.user_version ?? 0;
        if (version < 1) {
          sqlite.run(SCHEMA);
          sqlite.run("PRAGMA user_version = 1");
        }
        for (let at = Math.max(version, 1);at < WORK_SCHEMA_VERSION; at += 1) {
          const step = MIGRATIONS[at - 1];
          if (step === undefined)
            throw new Error(`no migration from task schema ${at}`);
          if (typeof step === "string")
            sqlite.run(step);
          else
            step(sqlite, file);
          sqlite.run(`PRAGMA user_version = ${at + 1}`);
        }
        const minimum = Number(sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()?.value ?? 1);
        if (minimum <= WORK_SCHEMA_VERSION)
          repairTaskLayers(sqlite, file);
        sqlite.run("COMMIT");
      } catch (error) {
        sqlite.run("ROLLBACK");
        if (error instanceof BackupFailure)
          writeRefusal = error.message;
        else
          throw error;
      }
    }
    const minimum = Number(sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()?.value ?? WORK_SCHEMA_VERSION);
    if (hook || writeRefusal !== undefined || minimum > WORK_SCHEMA_VERSION)
      sqlite.run("PRAGMA query_only = ON");
    return {
      sqlite,
      writable: !hook && writeRefusal === undefined && minimum <= WORK_SCHEMA_VERSION,
      ...writeRefusal === undefined ? {} : { writeRefusal },
      close: () => sqlite.close()
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
var WORK_SCHEMA_VERSION = 7, LEGACY_LIFT_REASON = "lift legacy nested task", WRITE_TIMEOUT_MS = 3000, HOOK_TIMEOUT_MS = 200, NEWER_STORE, SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta VALUES ('min_compatible','1');
CREATE TABLE tasks(id TEXT PRIMARY KEY, project TEXT NOT NULL, number INTEGER NOT NULL,
 parent_id TEXT REFERENCES tasks(id), kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','plan','phase')),
 subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','in_progress','done','dropped')),
 plan TEXT, phase TEXT, crew_id TEXT, created_by TEXT, claim_pid INTEGER, claim_start TEXT, claim_session TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, UNIQUE(project,number));
CREATE UNIQUE INDEX task_plan ON tasks(project,plan) WHERE kind='plan';
CREATE UNIQUE INDEX task_phase ON tasks(project,plan,phase) WHERE kind='phase';
CREATE INDEX task_status ON tasks(project,status);
CREATE INDEX task_parent ON tasks(parent_id);
CREATE INDEX task_crew ON tasks(project,crew_id);
CREATE TABLE task_deps(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, waits_for TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY(task_id,waits_for));
CREATE TABLE task_notes(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL, session_id TEXT, crew_id TEXT, at INTEGER NOT NULL);
CREATE TABLE acks(project TEXT NOT NULL, task_ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(project,task_ref));
CREATE TABLE task_events(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, project TEXT NOT NULL, number INTEGER NOT NULL,
 at INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','changed','noted','closed','deleted')),
 changes TEXT NOT NULL, session_id TEXT, session_name TEXT, crew_id TEXT, pid INTEGER, reason TEXT);
CREATE INDEX task_event_task ON task_events(task_id,id);
CREATE INDEX task_event_number ON task_events(project,number);
`, MIGRATIONS, BackupFailure;
var init_db = __esm(() => {
  init_names();
  init_graph();
  init_queries();
  NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
  MIGRATIONS = [
    "ALTER TABLE tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1 CHECK(blocking IN (0,1))",
    `ALTER TABLE tasks ADD COLUMN agent TEXT;
   ALTER TABLE tasks ADD COLUMN branch TEXT;
   ALTER TABLE tasks ADD COLUMN worktree TEXT;
   ALTER TABLE tasks ADD COLUMN base TEXT;`,
    repairTaskLayers,
    `ALTER TABLE tasks ADD COLUMN created_pid INTEGER;
   ALTER TABLE tasks ADD COLUMN created_start TEXT;
   CREATE INDEX IF NOT EXISTS task_note_task ON task_notes(task_id);`,
    `CREATE TABLE IF NOT EXISTS task_files(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, path TEXT NOT NULL, PRIMARY KEY(task_id,path));
   ALTER TABLE tasks ADD COLUMN lead_session TEXT;
   ALTER TABLE tasks ADD COLUMN lead_pid INTEGER;
   ALTER TABLE tasks ADD COLUMN lead_start TEXT;
   ALTER TABLE tasks ADD COLUMN lead_child INTEGER NOT NULL DEFAULT 0 CHECK(lead_child IN (0,1));
   ALTER TABLE tasks ADD COLUMN lead_handout TEXT;`,
    "ALTER TABLE tasks ADD COLUMN stacked_on TEXT"
  ];
  BackupFailure = class BackupFailure extends Error {
  };
});
// src/tasks/work/history.ts
var init_history = () => {};

// src/tasks/work/read.ts
var exports_read = {};
__export(exports_read, {
  readWorkStore: () => readWorkStore
});
import { existsSync as existsSync9 } from "fs";
function readWorkStore(paths, body) {
  let db;
  try {
    const file = workDbFile(paths);
    if (!existsSync9(file))
      return { state: "none" };
    db = openWorkDb(file, { mode: "hook" });
    return { state: "ready", value: body(db) };
  } catch (error) {
    return { state: "unreadable", why: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}
var init_read = __esm(() => {
  init_db();
  init_history();
  init_identity();
  init_queries();
});

// src/hooks/attended.ts
function isAttended(env) {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
}

// src/hooks/detached.ts
import { spawn } from "child_process";
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
var CMD = "cmd", CMD_ARGUMENTS;
var init_detached = __esm(() => {
  CMD_ARGUMENTS = ["/d", "/s", "/v:off", "/c"];
});

// src/setup/bun-config.ts
import { basename as basename2, join as join11 } from "path";
function bunConfigPath(pluginDir) {
  return join11(pluginDir, BUN_CONFIG_NAME);
}
function bunConfigArg(pluginDir) {
  return `--config=${bunConfigPath(pluginDir)}`;
}
function pluginFolderBeside(importDir) {
  return basename2(importDir) === "dist" ? join11(importDir, "..") : join11(importDir, "..", "..", "plugin");
}
var BUN_CONFIG_NAME = "bunfig.toml";
var init_bun_config = () => {};

// src/worktrees/auto-state.ts
import { createHash as createHash3 } from "crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync10 } from "fs";
import { dirname as dirname6, join as join12 } from "path";
function autoCleanLog(stateDir) {
  return join12(stateDir, "worktrees-auto-clean.log");
}
function autoCleanFiles(stateDir, repo) {
  const key = createHash3("sha256").update(pathForm(repo)).digest("hex").slice(0, 16);
  const dir = join12(stateDir, "worktrees-auto-clean");
  return {
    log: autoCleanLog(stateDir),
    result: join12(dir, `${key}.json`),
    told: join12(dir, `${key}.told.json`)
  };
}
function readJson(file, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync10(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function readRepoRecord(files) {
  return readJson(files.result, recordSchema);
}
function hourlyDue(record, nowMs) {
  if (record === null)
    return true;
  return nowMs - record.lastRunAt >= AUTO_CLEAN_INTERVAL_MS || record.lastRunAt > nowMs + 60000;
}
var AUTO_CLEAN_INTERVAL_MS, removedSchema, keptSchema, recordSchema, toldSchema;
var init_auto_state = __esm(() => {
  init_zod();
  init_names();
  init_path_compare();
  init_write();
  AUTO_CLEAN_INTERVAL_MS = 60 * 60 * 1000;
  removedSchema = object({
    branch: string2().nullable(),
    name: string2(),
    path: string2(),
    why: string2()
  });
  keptSchema = object({ name: string2(), path: string2(), why: string2() });
  recordSchema = object({
    base: string2(),
    kept: array(keptSchema),
    lastRunAt: number2(),
    removed: array(removedSchema),
    repo: string2(),
    seq: number2()
  });
  toldSchema = object({ seq: number2() });
});

// src/worktrees/auto-start.ts
import { basename as basename3, join as join13 } from "path";
function autoCleanOn(context) {
  return context.project.config?.worktrees?.autoClean !== false;
}
function autoCleanEntry(importDir) {
  return basename3(importDir) === "dist" ? join13(importDir, `${AUTO_CLEAN_BUNDLE}.js`) : join13(importDir, "..", "entries", `${AUTO_CLEAN_BUNDLE}.ts`);
}
function autoCleanArgv(bun, entry, pluginDir, repo, trigger, keep) {
  return [bun, "--no-env-file", bunConfigArg(pluginDir), entry, repo, trigger, keep];
}
function startAutoClean(context, repo, trigger, importDir = import.meta.dir) {
  if (!autoCleanOn(context))
    return false;
  if (trigger === "session") {
    if (!isAttended(context.env))
      return false;
    const record = readRepoRecord(autoCleanFiles(context.paths.stateDir, repo));
    if (!hourlyDue(record, Date.now()))
      return false;
  }
  const argv = autoCleanArgv(process.execPath, autoCleanEntry(importDir), pluginFolderBeside(importDir), repo, trigger, context.cwd);
  const env = gitEnv(context.env);
  (context.start ?? startDetached)(process.platform, argv, {
    cwd: context.paths.home,
    env,
    onError: (message) => console.error(`${COMMAND} worktrees clean: ${message}`)
  });
  return true;
}
var AUTO_CLEAN_BUNDLE = "worktrees-clean";
var init_auto_start = __esm(() => {
  init_names();
  init_detached();
  init_git_env();
  init_bun_config();
  init_auto_state();
});

// src/hooks/run.ts
init_paths2();
import { appendFileSync as appendFileSync3 } from "fs";

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

// src/hooks/run.ts
init_locate();

// src/hooks/ask-log.ts
import { join as join6 } from "path";

// src/hooks/jsonl-log.ts
init_write();
init_state();
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync4, statSync as statSync4 } from "fs";
import { dirname as dirname2 } from "path";
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
  mkdirSync3(dirname2(file), { recursive: true, mode: 448 });
  cutBack(file);
  appendFileSync2(file, `${JSON.stringify(value)}
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
init_build_info();
init_locate();
init_file_mode();
init_write();
import { createHash } from "crypto";
import {
  accessSync,
  constants,
  existsSync as existsSync5,
  mkdirSync as mkdirSync4,
  readdirSync as readdirSync3,
  readFileSync as readFileSync5,
  statSync as statSync5,
  unlinkSync as unlinkSync2
} from "fs";
import { dirname as dirname3, join as join7 } from "path";
var PARSER_FINGERPRINT = "f9ca83fa6e76773cdec7aa46583dabc540ca8030b04915c0c72d3979ae4003ae";
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
  const entry = existsSync5(built) ? built : join7(import.meta.dir, "..", "entries", "config-check.ts");
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
  for (const name of readdirSync3(dir)) {
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
    if (!existsSync5(dir)) {
      mkdirSync4(dir, { recursive: true, mode: 448 });
      setFileMode(dir, 448);
    }
    prune(dir, Date.now());
    const entry = { format: ENTRY_FORMAT, key, kind, value };
    atomicWrite(join7(dir, `${key}.json`), JSON.stringify(entry), 384);
  } catch {}
}
async function loadCheckedFile(file, kind, { paths }) {
  if (!existsSync5(file))
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
function toolInput(input) {
  const value = input.tool_input;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
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
function addContext(event, text) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text }
    })
  };
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
    appendFileSync3(file, `${JSON.stringify({
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

// src/hooks/after-merge.ts
init_names();
init_command();
import { createHash as createHash4 } from "crypto";
import { existsSync as existsSync10, mkdirSync as mkdirSync7, writeFileSync as writeFileSync4 } from "fs";
import { tmpdir } from "os";
import { join as join14 } from "path";

// src/shell/git-calls.ts
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

// src/hooks/after-merge.ts
init_words();

// src/hooks/budget.ts
var GUARD_BUDGET_MS = 25000;
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

// src/hooks/capped-list.ts
var HOOK_LIST_LIMIT = 8;
function cappedHookList(items, render, command, separator = ", ") {
  const shown = items.slice(0, HOOK_LIST_LIMIT).map(render);
  if (items.length > HOOK_LIST_LIMIT)
    shown.push(`+${items.length - HOOK_LIST_LIMIT} more: ${command}`);
  return shown.join(separator);
}

// src/hooks/after-merge.ts
init_git();
var GH_COMMANDS = new Set([
  "accessibility",
  "actions",
  "agent",
  "agent-task",
  "agent-tasks",
  "agents",
  "alias",
  "api",
  "at",
  "attestation",
  "auth",
  "browse",
  "cache",
  "co",
  "codespace",
  "completion",
  "config",
  "copilot",
  "cs",
  "discussion",
  "environment",
  "exit-codes",
  "ext",
  "extension",
  "extensions",
  "formatting",
  "gist",
  "gpg-key",
  "help",
  "issue",
  "label",
  "licenses",
  "mintty",
  "org",
  "pr",
  "preview",
  "project",
  "reference",
  "release",
  "repo",
  "rs",
  "ruleset",
  "run",
  "search",
  "secret",
  "skill",
  "ssh-key",
  "status",
  "telemetry",
  "variable",
  "version",
  "workflow"
]);
var WORDS = {
  the: ["the merge", "the command"],
  acts: ["merges in", "works in"],
  from: ["merges from", "acts on"]
};
function say(reason, opens) {
  return reason.replace(/\{(the|acts|from)\}/g, (_, key) => {
    const words = WORDS[key];
    return (opens ? words?.[1] : words?.[0]) ?? key;
  });
}
function call(fields = {}) {
  return {
    target: null,
    refusal: null,
    unread: null,
    arms: false,
    disarms: false,
    admin: false,
    unknown: null,
    unknownFlag: null,
    ...fields
  };
}
var ENV_PROGRAM = /^(?:.*[\\/])?env(?:\.(?:exe|cmd))?$/i;
var GH_POINTING_TEXT = {
  bash: /GH_(?:REPO|HOST)/,
  powershell: /GH_(?:REPO|HOST)/i
};
var isAutoFlag = (word) => /^--auto(?:=|$)/.test(word);
var isDisableAutoFlag = (word) => /^--disable-auto(?:=|$)/.test(word);
function pullRequestMerges(command, aliases = null, dialect) {
  return pullRequestCalls(command, aliases, dialect).filter(isMerge);
}
function isMerge(one) {
  return one.opens === undefined;
}
function pullRequestCalls(command, aliases, dialect) {
  const seen = new Set;
  const calls = [];
  for (const reading of readingsOf(command, dialect)) {
    const merges = readMerges(command, reading.dialect, reading.joinLines, aliases, 0, null, false);
    for (const one of merges) {
      const key = JSON.stringify(one);
      if (seen.has(key))
        continue;
      seen.add(key);
      calls.push(one);
    }
  }
  return calls;
}
function readMerges(command, dialect, joinLines, aliases, depth, movedBefore, filledIn) {
  const calls = [];
  let moved = movedBefore;
  for (const step of shellSteps(command, { dialect, joinLines })) {
    const read = wordsWithFill(step.text, dialect);
    const words = read.map((word) => word.text);
    const fill = fillOfStep(step, read, dialect, filledIn);
    if (words.some((word) => GH_POINTING_TEXT[dialect].test(word))) {
      moved ??= "this command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain";
    }
    const invocation = invocationOf(words);
    const runnerWord = RUNNERS[programName(words[0] ?? "")];
    if (invocation === undefined) {
      if (runnerWord !== undefined)
        moved ??= runnerWord.moved;
      continue;
    }
    const { program } = invocation;
    const isFilled = fillTest([...fill.filled, ...derivedFill(words, invocation.args)]);
    const args = withoutRedirections(invocation.args);
    if (program === "git")
      moved ??= gitMoved(args);
    else if (CHANGE_DIR.has(program)) {
      moved ??= `an earlier \`${program}\` in the same command changes the folder it runs in`;
    }
    const runner = runnerOf(program, invocation.prefix);
    if (runner === null && runnerWord !== undefined)
      moved ??= runnerWord.moved;
    const prefix = prefixMoved(invocation.prefix);
    if (program === "gh" && runner === null) {
      calls.push(...dispatch(args, moved ?? prefix, aliases, depth, null, isFilled));
      moved ??= ghSwitchReason(args, aliases, depth);
    } else if (runner !== null) {
      calls.push(...runnerCalls(words, runner, aliases, depth, dialect));
    }
    const nested = nestedCommand(program, invocation.args, step.pipedFrom);
    if (nested !== undefined && depth < MAX_NESTING) {
      const merges = lineMerges(nested, nestedDialect(program), aliases, depth + 1, moved, fill.passes);
      calls.push(...runner !== null && isRunnerProgram(program) ? refuseRunner(merges, runner) : merges);
    }
  }
  return calls;
}
function lineMerges(line, dialect, aliases, depth, moved, filledIn) {
  return readingsOf(line, dialect).flatMap((reading) => readMerges(line, reading.dialect, reading.joinLines, aliases, depth, moved, filledIn));
}
var RUNNERS = {
  doas: {
    feeds: false,
    moved: "an earlier `doas` in the same command may run {the} as another user",
    via: "under `doas`, with another user's login and gh config"
  },
  find: {
    feeds: false,
    moved: "an earlier `find` in the same command may run {the} once for each match",
    via: "from `find -exec`, once for each match"
  },
  parallel: {
    feeds: true,
    moved: "an earlier `parallel` in the same command may feed {the} its arguments from outside the line",
    via: "from `parallel`, whose arguments come from outside the line"
  },
  su: {
    feeds: true,
    moved: "an earlier `su` in the same command may run {the} in another shell, with its own environment",
    via: "from `su`, whose command and environment come from outside the line"
  },
  sudo: {
    feeds: false,
    moved: "an earlier `sudo` in the same command may run {the} under another user",
    via: "under `sudo`, with another user's login and gh config"
  },
  watch: {
    feeds: false,
    moved: "an earlier `watch` in the same command may run {the} over and over",
    via: "from `watch`, over and over"
  },
  xargs: {
    feeds: true,
    moved: "an earlier `xargs` in the same command may feed {the} its arguments from outside the line",
    via: "from `xargs`, whose arguments come from outside the line"
  }
};
function runnerOf(program, before) {
  for (const word of [program, ...before]) {
    const name = programName(word);
    const spec = RUNNERS[name];
    if (spec !== undefined)
      return { feeds: spec.feeds, name, via: spec.via };
  }
  return null;
}
function runnerCalls(words, runner, aliases, depth, dialect) {
  const at = words.findIndex((word) => programName(word) === "gh");
  if (at !== -1) {
    const ghWords = withoutRedirections(words.slice(at + 1));
    return refuseRunner(dispatch(ghWords, null, aliases, depth), runner);
  }
  const held = words.find((word) => /\bgh\b/i.test(word) && /\b(merge|create|new|ready)\b/i.test(word));
  if (held === undefined)
    return [];
  return refuseRunner(lineMerges(held, dialect, aliases, depth + 1, null, true), runner);
}
function refuseRunner(calls, runner) {
  return calls.filter((one) => !one.disarms).map((one) => call({
    ...one.opens === undefined ? {} : { opens: one.opens },
    target: runner.feeds ? null : one.target,
    refusal: say(`{the} runs ${runner.via}`, one.opens !== undefined)
  }));
}
function gitMoved(args) {
  const calls = gitCalls(args);
  if (calls.some((one) => one.dirs.length > 0)) {
    return "an earlier `git -C` in the same command runs in another folder";
  }
  const switched = calls.find((one) => one.sub === "switch" || one.sub === "checkout");
  if (switched !== undefined) {
    return `an earlier \`git ${switched.sub}\` in the same command may change the branch it {from}`;
  }
  return null;
}
function prefixMoved(before) {
  if (before.some((word) => ENV_PROGRAM.test(word))) {
    return "{the} runs through `env`, so which environment gh sees is not certain";
  }
  return null;
}
function leadingFlags(words) {
  let repo = null;
  let index = 0;
  for (;index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "--")
      return { rest: words.slice(index + 1), repo, unknown: null, help: false };
    if (!word.startsWith("-"))
      break;
    if (word === "-h" || word === "--help") {
      return { rest: [], repo, unknown: null, help: true };
    }
    if (word === "-R" || word === "--repo")
      repo = words[++index] ?? null;
    else if (word.startsWith("--repo="))
      repo = word.slice("--repo=".length) || null;
    else if (isShort(word) && word.startsWith("-R"))
      repo = word.slice(2) || null;
    else
      return { rest: words.slice(index + 1), repo, unknown: word, help: false };
  }
  return { rest: words.slice(index), repo, unknown: null, help: false };
}
var PR_OPENERS = new Set(["create", "new", "ready"]);
function couldBeMerge(rest) {
  const command = rest[0]?.toLowerCase();
  if (command === undefined)
    return false;
  if (command === "api")
    return true;
  if (command === "pr") {
    return rest.slice(1).some((word) => word.toLowerCase() === "merge" || PR_OPENERS.has(word.toLowerCase()));
  }
  return !GH_COMMANDS.has(command);
}
function onlyOpens(rest) {
  if (rest[0]?.toLowerCase() !== "pr")
    return false;
  const words = rest.slice(1).map((word) => word.toLowerCase());
  return words.some((word) => PR_OPENERS.has(word)) && !words.includes("merge");
}
function dispatch(words, moved, aliases, depth, repo = null, isFilled = anyFill) {
  const leading = leadingFlags(words);
  const carried = repo ?? leading.repo;
  if (leading.unknown !== null) {
    return couldBeMerge(leading.rest) ? [
      call({
        ...onlyOpens(leading.rest) ? { opens: "create" } : {},
        refusal: `the command carries \`${leading.unknown}\` before the gh command, which this guard does not know`
      })
    ] : [];
  }
  const word = leading.rest[0];
  if (word === undefined)
    return [];
  const command = word.toLowerCase();
  if (command === "pr")
    return prCalls(leading.rest.slice(1), moved, carried);
  if (command === "api")
    return apiCalls(leading.rest.slice(1), isFilled);
  if (GH_COMMANDS.has(command))
    return [];
  const rest = leading.rest.slice(1);
  if (aliases === null)
    return [call({ unknown: word })];
  const expansion = aliases.get(word);
  if (expansion === undefined) {
    return leading.rest.some((one) => /merge/i.test(one)) ? [
      call({
        refusal: `\`gh ${word}\` is no gh command or alias, and its words name a merge, which this guard does not judge`
      })
    ] : [];
  }
  if (expansion.startsWith("!")) {
    return [call({ refusal: `\`gh ${word}\` is a shell alias, so what it runs cannot be read` })];
  }
  if (depth >= MAX_NESTING) {
    return [
      call({
        refusal: `\`gh ${word}\` expands to further commands, which this guard does not follow`
      })
    ];
  }
  const own = wordsOf(expansion);
  const filled = (text) => own.includes(text) && anyFill(text) || isFilled(text);
  return dispatch([...own, ...rest], moved, aliases, depth + 1, carried, filled);
}
function ghSwitchReason(words, aliases, depth) {
  if (depth > MAX_NESTING)
    return null;
  const leading = leadingFlags(words);
  if (leading.unknown !== null)
    return null;
  const typed = leading.rest[0];
  const command = typed?.toLowerCase();
  const args = leading.rest.slice(1);
  if (command === "co") {
    return "an earlier `gh co` in the same command changes the branch gh works on";
  }
  if (command === "pr" && args[0] === "checkout") {
    return "an earlier `gh pr checkout` in the same command changes the branch gh works on";
  }
  if (command === "repo" && args[0] === "set-default") {
    return "an earlier `gh repo set-default` in the same command changes the repository gh works on";
  }
  if (typed === undefined || command === undefined || GH_COMMANDS.has(command))
    return null;
  const expansion = aliases?.get(typed);
  if (expansion === undefined || expansion.startsWith("!"))
    return null;
  return ghSwitchReason([...wordsOf(expansion), ...args], aliases, depth + 1);
}
function prCalls(rest, moved, carried) {
  let repo = null;
  let index = 0;
  for (;index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      index += 1;
      break;
    }
    if (!word.startsWith("-"))
      break;
    if (word === "-h" || word === "--help")
      return [];
    if (word === "-R" || word === "--repo")
      repo = rest[++index] ?? null;
    else if (word.startsWith("--repo="))
      repo = word.slice("--repo=".length) || null;
    else if (isShort(word) && word.startsWith("-R"))
      repo = word.slice(2) || null;
    else {
      return [
        call({
          refusal: `\`gh pr\` takes a flag this guard does not know (\`${word}\`), so it cannot tell whether this merges or opens a pull request`
        })
      ];
    }
  }
  const sub = rest[index];
  const args = rest.slice(index + 1);
  if (sub !== undefined && PR_OPENERS.has(sub)) {
    if (args.some((arg) => arg === "-h" || arg === "--help"))
      return [];
    return openingCall(sub === "ready" ? "ready" : "create", args, moved, repo ?? carried);
  }
  if (sub !== "merge")
    return [];
  if (args.some((arg) => arg === "-h" || arg === "--help"))
    return [];
  const named = mergeArguments(args);
  const refusal = moved !== null ? say(moved, false) : named.unknown === null ? null : `the merge carries \`${named.unknown}\`, a flag this guard does not know, so it cannot tell what it does`;
  return [
    call({
      target: { ref: named.ref, repo: repo ?? named.repo ?? carried },
      refusal,
      arms: args.some(isAutoFlag),
      disarms: args.some(isDisableAutoFlag),
      admin: named.admin,
      unknownFlag: named.unknown
    })
  ];
}
var CREATE_FLAGS_WITH_VALUE = new Set([
  "--assignee",
  "--attach",
  "--base",
  "--body",
  "--body-file",
  "--head",
  "--label",
  "--milestone",
  "--project",
  "--recover",
  "--repo",
  "--reviewer",
  "--template",
  "--title"
]);
var CREATE_SHORT_WITH_VALUE = "aBbFHlmprRTt";
function openingCall(kind, args, moved, carried) {
  let repo = carried;
  let base = null;
  let head = null;
  let draft = false;
  let undo = false;
  for (let index = 0;index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--")
      break;
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      const value = at === -1 ? undefined : word.slice(at + 1);
      if (name === "--repo")
        repo = value ?? args[index + 1] ?? repo;
      if (name === "--base")
        base = value ?? args[index + 1] ?? null;
      if (name === "--head")
        head = value ?? args[index + 1] ?? null;
      if (name === "--draft")
        draft = value === undefined || value.toLowerCase() !== "false";
      if (name === "--undo")
        undo = true;
      if (value === undefined && CREATE_FLAGS_WITH_VALUE.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, value, wantsNext } = shortFlags(word, CREATE_SHORT_WITH_VALUE);
      const last = flags.slice(-1);
      const own = last !== "" && CREATE_SHORT_WITH_VALUE.includes(last) ? flags.slice(0, -1) : flags;
      if (own.includes("d"))
        draft = true;
      if (last !== "" && CREATE_SHORT_WITH_VALUE.includes(last)) {
        const given = wantsNext ? args[index + 1] ?? null : value;
        if (last === "R")
          repo = given === "" ? repo : given;
        if (last === "B")
          base = given === "" ? null : given;
        if (last === "H")
          head = given === "" ? null : given;
        if (wantsNext)
          index += 1;
      }
    }
  }
  if (kind === "ready" && undo)
    return [];
  return [
    call({
      base: base === "" ? null : base,
      cli: true,
      draft: kind === "create" && draft,
      head: head === "" ? null : head,
      opens: kind,
      refusal: moved === null ? null : say(moved, true),
      target: { ref: null, repo }
    })
  ];
}
var MERGE_FLAGS_WITH_VALUE = new Set([
  "--author-email",
  "--body",
  "--body-file",
  "--match-head-commit",
  "--repo",
  "--subject"
]);
var MERGE_SHORT_WITH_VALUE = "AbtFR";
var MERGE_FLAGS = new Set([
  "--admin",
  "--author-email",
  "--auto",
  "--body",
  "--body-file",
  "--delete-branch",
  "--disable-auto",
  "--match-head-commit",
  "--merge",
  "--rebase",
  "--squash",
  "--subject",
  "--repo"
]);
var MERGE_LETTERS = "AbFdmrstR";
function mergeArguments(words) {
  let ref = null;
  let repo = null;
  let admin = false;
  let unknown = null;
  for (let index = 0;index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "--") {
      ref ??= words[index + 1] || null;
      break;
    }
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      const value = at === -1 ? undefined : word.slice(at + 1);
      if (!MERGE_FLAGS.has(name))
        unknown ??= name;
      if (name === "--repo")
        repo = value ?? words[index + 1] ?? null;
      if (name === "--admin")
        admin = true;
      if (value === undefined && MERGE_FLAGS_WITH_VALUE.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, value: attached, wantsNext } = shortFlags(word, MERGE_SHORT_WITH_VALUE);
      for (const letter of flags) {
        if (!MERGE_LETTERS.includes(letter))
          unknown ??= `-${letter}`;
      }
      const letter = flags.slice(-1);
      if (letter !== "" && MERGE_SHORT_WITH_VALUE.includes(letter)) {
        const value = wantsNext ? words[index + 1] ?? null : attached;
        if (letter === "R")
          repo = value === "" ? null : value;
        if (wantsNext)
          index += 1;
      }
      continue;
    }
    ref ??= word || null;
  }
  return { ref, repo, admin, unknown };
}
var API_VALUE_FLAGS = new Set([
  "--cache",
  "--field",
  "--header",
  "--hostname",
  "--input",
  "--jq",
  "--method",
  "--preview",
  "--raw-field",
  "--template",
  "-F",
  "-H",
  "-X",
  "-f",
  "-p",
  "-q",
  "-t"
]);
var API_PLAIN_FLAGS = new Set([
  "--allow-escape-sequences",
  "--include",
  "--paginate",
  "--silent",
  "--slurp",
  "--verbose",
  "-i"
]);
var API_VALUE_LETTERS = "FHXfpqt";
var API_MERGE_REFUSAL = "it merges with `gh api`, a form this guard does not judge";
function apiCalls(rest, isFilled) {
  const fields = [];
  let endpoint = null;
  let body = false;
  let method = null;
  for (let index = 0;index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      endpoint ??= rest[index + 1] ?? null;
      break;
    }
    if (word === "-h" || word === "--help")
      return [];
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      if (!API_VALUE_FLAGS.has(name) && !API_PLAIN_FLAGS.has(name)) {
        return [
          call({
            refusal: `\`gh api\` takes a flag this guard does not know (\`${name}\`), so it cannot tell whether this merges or opens a pull request`
          })
        ];
      }
      if (name === "--input")
        body = true;
      const source = at === -1 ? rest[index + 1] ?? "" : word;
      const value = at === -1 ? source : word.slice(at + 1);
      if (name === "--method")
        method = value;
      if (name === "--field" || name === "--raw-field") {
        fields.push({ filled: isFilled(source), value });
      }
      if (at === -1 && API_VALUE_FLAGS.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, value: attached, wantsNext } = shortFlags(word, API_VALUE_LETTERS);
      const unknown = flags.split("").find((one) => one !== "i" && !API_VALUE_LETTERS.includes(one));
      if (unknown !== undefined) {
        return [
          call({
            refusal: `\`gh api\` takes a flag this guard does not know (\`-${unknown}\`), so it cannot tell whether this merges or opens a pull request`
          })
        ];
      }
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter))
        continue;
      const source = wantsNext ? rest[index + 1] ?? "" : word;
      const value = wantsNext ? source : attached;
      if (wantsNext)
        index += 1;
      if (letter === "f" || letter === "F")
        fields.push({ filled: isFilled(source), value });
      if (letter === "X")
        method = value;
      continue;
    }
    endpoint ??= word;
  }
  if (endpoint === null)
    return [];
  if (isGraphqlEndpoint(endpoint))
    return graphqlCalls(fields, body);
  const posts = (method ?? (fields.length > 0 || body ? "POST" : "GET")).toUpperCase() === "POST";
  if (endpoint.endsWith("/")) {
    return [
      call({
        refusal: "the `gh api` path is cut short (gh's `{owner}`-style placeholders are read as parts of the command line), so this guard cannot tell which API path it reaches"
      })
    ];
  }
  const merged = pullRequestMergePath(endpoint);
  if (merged !== null)
    return [call({ target: merged, refusal: API_MERGE_REFUSAL })];
  const created = pullRequestsPath(endpoint);
  if (created === null || !posts)
    return [];
  const draft = fields.some((field) => /^draft=true$/i.test(field.value));
  return [call({ draft, opens: "create", target: { ref: null, repo: created.repo } })];
}
function isGraphqlEndpoint(endpoint) {
  const path = endpoint.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  return path === "graphql" || path.endsWith("/graphql");
}
function graphqlCalls(fields, body) {
  if (body) {
    return [
      call({
        refusal: "the GraphQL request is read from a file or standard input, so this guard cannot read the query"
      })
    ];
  }
  for (const { filled, value } of fields) {
    if (!value.startsWith("query="))
      continue;
    const query = value.slice("query=".length);
    if (query.startsWith("@") || filled) {
      return [
        call({
          refusal: "the GraphQL query is read from a file or built by the shell, so this guard cannot read it"
        })
      ];
    }
    const calls = [];
    if (/mergePullRequest|enablePullRequestAutoMerge/i.test(query)) {
      calls.push(call({
        refusal: "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge"
      }));
    }
    if (/createPullRequest/i.test(query)) {
      calls.push(call({ draft: /draft\s*:\s*true/i.test(query), opens: "create" }));
    }
    if (/markPullRequestReadyForReview/i.test(query))
      calls.push(call({ opens: "ready" }));
    if (calls.length > 0)
      return calls;
  }
  return [];
}
function pullRequestMergePath(endpoint) {
  const path = endpoint.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  const match = /^repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/merge$/.exec(path);
  const [, owner, name, number] = match ?? [];
  if (owner === undefined || name === undefined || number === undefined)
    return null;
  const placeholder = (part) => part.includes("{");
  return {
    ref: number,
    repo: placeholder(owner) || placeholder(name) ? null : `${owner}/${name}`
  };
}
function pullRequestsPath(endpoint) {
  const path = endpoint.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  const match = /^repos\/([^/]+)\/([^/]+)\/pulls$/.exec(path);
  const [, owner, name] = match ?? [];
  if (owner === undefined || name === undefined)
    return null;
  const placeholder = (part) => part.includes("{");
  return { repo: placeholder(owner) || placeholder(name) ? null : `${owner}/${name}` };
}
function mergeCalls(command, folder, env, timeoutMs = ALIAS_TIMEOUT_MS, dialect) {
  return pullRequestCallsWithAliases(command, folder, env, timeoutMs, dialect).filter(isMerge);
}
function pullRequestCallsWithAliases(command, folder, env, timeoutMs = ALIAS_TIMEOUT_MS, dialect, readAliases = onceAliases(folder, env, timeoutMs)) {
  const unread = pullRequestCalls(command, null, dialect);
  if (!unread.some((one) => one.unknown !== null))
    return unread;
  const aliases = readAliases();
  if (aliases === null) {
    return [...unread.filter((one) => one.unknown === null), call({ unread: "its aliases" })];
  }
  return pullRequestCalls(command, aliases, dialect);
}
var GH_TIMEOUT_MS = 1e4;
var ALIAS_TIMEOUT_MS = 3000;
function onceAliases(folder, env, timeoutMs) {
  let read = null;
  return () => {
    read ??= { aliases: readGhAliases(folder, env, timeoutMs) };
    return read.aliases;
  };
}
function readGhAliases(folder, env, timeoutMs = ALIAS_TIMEOUT_MS) {
  if (timeoutMs <= 0)
    return null;
  try {
    const run = Bun.spawnSync(["gh", "alias", "list"], {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs
    });
    const out = run.stdout.toString();
    if (run.exitCode !== 0) {
      return /no aliases configured/i.test(`${out}${run.stderr.toString()}`) ? new Map : null;
    }
    return parseAliasList(out);
  } catch {
    return null;
  }
}
function parseAliasList(text) {
  const aliases = new Map;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "")
      continue;
    const match = /^([^\s:][^:]*):[ \t]?(.*)$/.exec(line);
    const name = match?.[1]?.trim();
    const rest = match?.[2]?.trim();
    if (name === undefined || rest === undefined)
      return null;
    const expansion = unquoteYaml(rest);
    if (expansion === null)
      return null;
    aliases.set(name, expansion);
  }
  return aliases;
}
function unquoteYaml(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (/^[|>&*]/.test(value))
    return null;
  return value;
}
function mergesPullRequest(command, dialect) {
  return pullRequestMerges(command, null, dialect).some((one) => !one.arms && !one.disarms && (one.target !== null || one.refusal !== null));
}
function mergeTargetOf(calls) {
  const named = calls.filter((one) => one.target !== null);
  const chosen = named.find((one) => !one.arms && !one.disarms) ?? named[0];
  return chosen?.target ?? null;
}
var PULL_REQUEST_FIELDS = "number,title,baseRefName,headRefName,state,url,mergedAt";
function parsePullRequestView(json) {
  try {
    const view = JSON.parse(json);
    const { baseRefName, headRefName, mergedAt, number, state, title, url } = view;
    if (typeof baseRefName !== "string" || typeof headRefName !== "string" || typeof number !== "number" || typeof state !== "string" || typeof title !== "string" || typeof url !== "string") {
      return null;
    }
    return {
      number,
      title,
      base: baseRefName,
      head: headRefName,
      state,
      url,
      mergedAt: typeof mergedAt === "string" && mergedAt !== "" ? mergedAt : null
    };
  } catch {
    return null;
  }
}
function pullRequestRepository(url) {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\//i.exec(url);
  return match === null ? null : `${match[1] ?? ""}/${match[2] ?? ""}`.toLowerCase();
}
function repositoryKey(spec) {
  const parts = spec.trim().replace(/\.git$/i, "").replace(/\/+$/, "").split(/[/:]/).filter((part) => part !== "");
  if (parts.length < 2)
    return null;
  const [owner, name] = parts.slice(-2);
  return owner === undefined || name === undefined ? null : `${owner}/${name}`.toLowerCase();
}
function sameRepository(prUrl, origin) {
  const pr = pullRequestRepository(prUrl);
  return pr !== null && pr === repositoryKey(origin);
}
var RECENT_MERGE_MS = 15 * 60000;
function mergeOutcome(params) {
  const { base, failed, now, pr, sameRepo, seen, target, worktree } = params;
  const none = { clear: null, intoBase: null };
  if (pr === null ? failed : pr.state !== "MERGED" || !sameRepo)
    return none;
  const branch = worktree?.branch ?? null;
  const mergedHere = worktree !== null && branch !== null && (target.ref === null || target.ref === branch || pr?.head === branch);
  const clear = mergedHere && branch !== null ? { path: worktree.path, branch } : null;
  const mergedAt = pr === null || pr.mergedAt === null ? Number.NaN : Date.parse(pr.mergedAt);
  const recent = now - mergedAt <= RECENT_MERGE_MS;
  const intoBase = pr !== null && pr.base === base && !seen && recent ? pr : null;
  return { clear, intoBase };
}
function clearWorktreeNote(path, branch, clear) {
  const merged = `That merged the pull request of this worktree's branch, ${branch}.`;
  const steps = [
    "1. Stop the dev servers and Monitors this session started in it (TaskStop).",
    '2. ExitWorktree with action "keep": the session goes back to the folder it started in.',
    `3. Run ${COMMAND} worktrees --remove "${path}" with run_in_background: it removes the worktree only when it is finished, and says why when it keeps it.`
  ];
  if (!clear) {
    return [
      `${merged} This worktree looks finished, but the clearWorktreeAfterMerge setting is off: tell the user in one line, give them these steps, and let them decide. Do not clear it yourself.`,
      ...steps
    ].join(`
`);
  }
  return [
    `${merged} Clear the worktree now, unless the user wants more work on this branch:`,
    ...steps,
    `If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), the session stands in it and cannot remove it: tell the user it is finished, and that it goes when this session ends. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.`
  ].join(`
`);
}
async function clearsAfterMerge(context) {
  await Promise.resolve().then(() => init_resolve2());
  try {
    return resolveWorkflow(context.paths, context.project.config).clearWorktreeAfterMerge.value;
  } catch (error) {
    if (error instanceof WorkflowConfigError)
      return false;
    throw error;
  }
}
var KEPT_PLAN_STATES = new Set([
  "with-child",
  "child-gone",
  "waiting",
  "no-files",
  "ready"
]);
function keptWorktreeNote(slugs) {
  const one = slugs.length === 1;
  return `Kept: ${one ? "plan" : "plans"} ${cappedHookList(slugs, (slug) => slug, TASK_TOOL.list)} ${one ? "is" : "are"} still open here.`;
}
async function otherOpenPlans(context) {
  const { cwd, env, input, paths, project } = context;
  try {
    const [{ projectKey }, { callerOf }, { classifyLeadPlans }, { readWorkStore }] = await Promise.all([
      Promise.resolve().then(() => (init_context(), exports_context)),
      Promise.resolve().then(() => (init_identity(), exports_identity)),
      Promise.resolve().then(() => (init_lead_plans(), exports_lead_plans)),
      Promise.resolve().then(() => (init_read(), exports_read))
    ]);
    const sessionId = stringField(input.session_id);
    const who = callerOf({ env, cwd, claudeConfigDir: paths.claudeConfigDir }) ?? {
      sessionId,
      pid: null,
      procStart: null
    };
    if (who.sessionId === null && who.pid === null)
      return { state: "none" };
    const key = projectKey(project.mainCheckout ?? project.root);
    return readWorkStore(paths, (db) => classifyLeadPlans(db, key, who).filter((entry) => KEPT_PLAN_STATES.has(entry.state)).map((entry) => entry.plan.plan ?? `#${entry.plan.number}`));
  } catch (error) {
    return { state: "unreadable", why: error instanceof Error ? error.message : String(error) };
  }
}
function viewPullRequest(ref, repo, folder, env, timeoutMs) {
  if (timeoutMs <= 0)
    return null;
  try {
    const view = Bun.spawnSync([
      "gh",
      "pr",
      "view",
      ...ref === null ? [] : [ref],
      ...repo === null ? [] : ["--repo", repo],
      "--json",
      PULL_REQUEST_FIELDS
    ], { cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    return view.exitCode === 0 ? parsePullRequestView(view.stdout.toString()) : null;
  } catch {
    return null;
  }
}
function seenFile(repo, number, env) {
  const key = createHash4("sha256").update(repo).digest("hex").slice(0, 16);
  return join14(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-merges", `${key}-${number}`);
}
async function afterMerge(context) {
  const { project, input, event, env, cwd } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined)
    return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null)
    return SILENT;
  const dialect = dialectOfTool(input.tool_name);
  const { timeFor } = startBudget(env);
  const calls = mergeCalls(command, cwd, env, timeFor(ALIAS_TIMEOUT_MS), dialect).filter((one) => !one.arms && !one.disarms);
  const target = mergeTargetOf(calls);
  if (target === null)
    return SILENT;
  const repo = project.mainCheckout ?? project.root;
  let worktree = null;
  const listLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
  if (listLeft <= 0)
    return SILENT;
  const [, ...linked] = listWorktrees(repo, env, listLeft);
  const mine = innermostWorktree(cwd, linked.map((listed) => listed.path));
  if (mine !== null) {
    worktree = {
      path: mine,
      branch: linked.find((listed) => listed.path === mine)?.branch ?? null
    };
  }
  const viewLeft = timeFor(GH_TIMEOUT_MS);
  if (viewLeft <= 0)
    return SILENT;
  const pr = viewPullRequest(target.ref, target.repo, cwd, env, viewLeft);
  const originLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
  if (originLeft <= 0)
    return SILENT;
  const origin = runGit(repo, ["remote", "get-url", "origin"], env, originLeft);
  const record = pr === null ? null : seenFile(repo, pr.number, env);
  const outcome = mergeOutcome({
    base,
    failed: event === "PostToolUseFailure",
    now: Date.now(),
    pr,
    sameRepo: pr !== null && origin.ok && sameRepository(pr.url, origin.out),
    seen: record !== null && existsSync10(record),
    target,
    worktree
  });
  if (outcome.intoBase !== null && record !== null) {
    mkdirSync7(join14(record, ".."), { recursive: true });
    writeFileSync4(record, "");
    await Promise.resolve().then(() => init_auto_start());
    startAutoClean(context, repo, "merge");
  }
  if (outcome.clear === null)
    return SILENT;
  const others = await otherOpenPlans(context);
  if (others.state === "ready" && others.value.length > 0)
    return addContext(event, keptWorktreeNote(others.value));
  const note = addContext(event, clearWorktreeNote(outcome.clear.path, outcome.clear.branch, await clearsAfterMerge(context)));
  return others.state === "unreadable" ? { ...note, stderr: `${COMMAND} after-merge: ${others.why}` } : note;
}

// src/hooks/specs/after-merge.ts
var afterMergeHook = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
  onConfigProblem: (message, input, event) => {
    const command = stringField(toolInput(input).command);
    return command !== null && mergesPullRequest(command) ? addContext(event, `cc-smart-dev-kit: ${message}`) : SILENT;
  },
  run: afterMerge
};

// src/entries/after-merge.ts
await runHookEntry(afterMergeHook);
