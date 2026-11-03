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

// node_modules/zod/v4/classic/iso.js
var exports_iso = {};
__export(exports_iso, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});

// src/build-info/names.ts
var MARKETPLACE = "cc-smart-dev-kit";
var PLUGIN = "cc-smart-dev-kit";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "cc-smart-dev-kit";

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

// src/worktrees/auto-clean.ts
import { existsSync as existsSync17, readdirSync as readdirSync11 } from "fs";
import { join as join23 } from "path";

// src/crew/discard.ts
import { createHash as createHash3 } from "crypto";
import {
  closeSync as closeSync4,
  copyFileSync as copyFileSync2,
  existsSync as existsSync16,
  lstatSync as lstatSync4,
  mkdirSync as mkdirSync10,
  mkdtempSync as mkdtempSync2,
  openSync as openSync4,
  readdirSync as readdirSync10,
  readFileSync as readFileSync19,
  readlinkSync as readlinkSync5,
  readSync as readSync2,
  renameSync as renameSync2,
  rmSync as rmSync5,
  writeFileSync as writeFileSync3
} from "fs";
import { tmpdir as tmpdir2 } from "os";
import { dirname as dirname9, join as join22 } from "path";

// src/hooks/git.ts
import { realpathSync } from "fs";
import { basename, dirname, join as join3, resolve as resolve2 } from "path";

// src/path-compare.ts
import { resolve } from "path";
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
function samePath(a, b, ignoreCase = IGNORE_CASE) {
  return isInside(a, b, ignoreCase) && isInside(b, a, ignoreCase);
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

// src/hooks/git.ts
var GUARD_GIT_TIMEOUT_MS = 5000;
function runGit(cwd, args, env, timeoutMs = 15000, own = {}) {
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
    const err = result.signalCode ? "timed out" : result.stderr.toString().trim();
    const code = result.signalCode ? null : result.exitCode;
    return { ok: result.exitCode === 0, out: result.stdout.toString().trim(), err, code };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: "", err, code: null };
  }
}
function realPath(path) {
  const rest = [];
  let at = resolve2(path);
  for (;; ) {
    try {
      return join3(realpathSync(at), ...rest);
    } catch {
      const parent = dirname(at);
      if (parent === at)
        return resolve2(path);
      rest.unshift(basename(at));
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
function hasChanges(folder, env) {
  const status = runGit(folder, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], env);
  return !status.ok || status.out !== "";
}

// src/hooks/local-files.ts
import { lstatSync, readdirSync, readFileSync as readFileSync2, readlinkSync } from "fs";
import { join as join5 } from "path";

// src/project/config.ts
import { existsSync, readFileSync } from "fs";
import { posix, win32 } from "path";

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
function isObject(data) {
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
function discriminatorMap(def) {
  const map = new Map;
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== undefined)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(undefined))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, new Set);
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(undefined);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const value = input?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== undefined || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
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
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...normalizeParams(params)
  });
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
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
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
// node_modules/zod/v4/classic/iso.js
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
function date2(params) {
  return _isoDate(ZodISODate, params);
}
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}
// src/build-info/index.ts
var info = {
  version: "1.11.3",
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

// src/jobs/kinds.ts
var matchRuleSchema = union([
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
var kindSpecSchema = strictObject({
  light: boolean2().optional(),
  printOnly: array(string2().min(1)).optional(),
  noSlotForFiles: boolean2().optional(),
  skipWords: array(string2().min(1)).optional(),
  valuedFlags: array(string2().min(1)).optional(),
  match: array(matchRuleSchema).optional(),
  about: string2().min(1).optional(),
  gb: number2().int().min(0).max(1024).optional(),
  filesGb: number2().int().min(0).max(1024).optional(),
  maxFiles: number2().int().min(1).optional(),
  workers: strictObject({
    flag: string2().min(1),
    aliases: array(string2().min(1)).optional(),
    gbEach: number2().positive()
  }).optional()
});
var KIND_NAME = /^[a-z0-9][a-z0-9:._-]*$/;
var kindsSchema = record(string2().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"), kindSpecSchema);
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
var DEFAULT_KINDS = {
  tsc: {
    about: "A TypeScript type check (tsc, tsgo, vue-tsc).",
    printOnly: TSC_PRINT_ONLY,
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
    about: "A test run with coverage (vitest or jest with --coverage).",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" }
    ]
  },
  "test:run": {
    about: "A test run (vitest, jest). A run on named test files runs at once, with no slot.",
    printOnly: TEST_PRINT_ONLY,
    noSlotForFiles: true,
    skipWords: ["run"],
    valuedFlags: TEST_VALUED_FLAGS,
    match: [{ tool: "vitest" }, { tool: "jest" }]
  },
  build: {
    about: "A framework production build (next build).",
    match: [{ tool: "next", sub: ["build"] }]
  },
  install: {
    about: "Install dependencies in the light lane.",
    light: true,
    printOnly: TEST_PRINT_ONLY,
    match: ["bun", "npm", "pnpm", "yarn"].flatMap((tool) => ["install", "i", "add", ...tool === "npm" ? ["ci"] : []].map((sub) => ({
      tool,
      sub: [sub]
    })))
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

// src/setup/user-json.ts
var BOM = "\uFEFF";
function withoutBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function parseUserJson(text) {
  return JSON.parse(withoutBom(text));
}

// src/crew/names.ts
var MAX_TAG = 12;
var MAX_PHASE = 8;
var MAX_SLUG = 32;
var LEAD_ROLE = "LEAD";
var CREW_ROLE = "C";
var EDGE_SEPARATORS = /^[._-]+|[._-]+$/g;
function namePart(raw, max) {
  const plain = raw.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(EDGE_SEPARATORS, "");
  return plain.slice(0, Math.max(0, max)).replace(EDGE_SEPARATORS, "");
}
function partRule(max) {
  return `1-${max} characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"`;
}
var TAG_RULE = partRule(MAX_TAG);
function isNameTag(value) {
  return value !== "" && value.length <= MAX_TAG && namePart(value, MAX_TAG) === value;
}
var SLUG_RULE = partRule(MAX_SLUG);
var PHASE_RULE = partRule(MAX_PHASE);
function withoutListRef(name) {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}
var PART = "[A-Za-z0-9._-]+";
var HANDOFF = "(?:[2-9]|[1-9][0-9]+)";
var LEAD_SHAPE = new RegExp(`^${LEAD_ROLE}( ${PART}){1,2}$`);
var CREW_SHAPE = new RegExp(`^${CREW_ROLE}( ${PART}){2,4}( ${HANDOFF})?$`);

// src/workflow/schema.ts
var ALERT_EVENTS = ["needs-you", "question", "finished", "failed"];
var alertEventsSchema = array(_enum(ALERT_EVENTS)).min(1).refine((events) => new Set(events).size === events.length, "an event is listed twice");
var PERCENT = { kind: "whole", max: 100, min: 1 };
var AT_LEAST_ONE = { kind: "whole", min: 1 };
var AT_LEAST_ZERO = { kind: "whole", min: 0 };
var ABOVE_ZERO = { kind: "positive" };
var WATCH_MINUTES_FLOOR = 2;
var WATCH_MINUTES = { kind: "whole", max: 24 * 60, min: WATCH_MINUTES_FLOOR };
function numberSchema(rule) {
  if (rule.kind === "positive")
    return number2().positive();
  const whole = number2().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}
var NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "crew.idleStopMinutes": AT_LEAST_ONE,
  "crew.max": AT_LEAST_ONE,
  "crew.maxOpus": AT_LEAST_ONE,
  "crew.memoryGb": ABOVE_ZERO,
  "crew.loadPerCore": ABOVE_ZERO,
  "crew.startGapSeconds": AT_LEAST_ONE,
  "crew.perLead": AT_LEAST_ONE,
  "crew.perLeadOpus": AT_LEAST_ONE,
  "crew.usagePercent": PERCENT,
  "crew.quietMinutes": AT_LEAST_ONE,
  "crew.handoffPercent": PERCENT,
  "crew.handoffTokens": AT_LEAST_ONE,
  "crew.softHours": ABOVE_ZERO,
  "crew.maxHours": ABOVE_ZERO,
  "crew.archiveDays": AT_LEAST_ONE,
  "crew.deleteDays": AT_LEAST_ONE,
  "issues.watchMinutes": WATCH_MINUTES,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO
};
function numberField(key) {
  return numberSchema(NUMBER_RULES[key]).optional();
}
var LABEL_RULE = "a label name of 1-50 characters on one line, with no comma, not starting with -";
function isLabelName(name) {
  return name.length >= 1 && name.length <= 50 && !name.startsWith("-") && !/[\p{Cc}\p{Cf},]/u.test(name) && name.trim() === name;
}
var labelSchema = string2().refine(isLabelName, LABEL_RULE);
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
var tagSchema = string2().refine(isNameTag, TAG_RULE);
var CREW_KEEP_RULE = '"plugin:<id>" or "server:<name>"';
function parseCrewKeep(entry) {
  if (entry.startsWith("plugin:")) {
    const id = entry.slice("plugin:".length);
    return /^[^\s@]+@[^\s@]+$/.test(id) ? { id, kind: "plugin" } : null;
  }
  if (entry.startsWith("server:")) {
    const name = entry.slice("server:".length);
    return /^[a-z0-9][a-z0-9-]*$/.test(name) ? { kind: "server", name } : null;
  }
  return null;
}
var crewKeepSchema = string2().refine((entry) => parseCrewKeep(entry) !== null, `an entry is ${CREW_KEEP_RULE}`);
var workflowSchema = strictObject({
  autoCommit: boolean2().optional(),
  autoPush: boolean2().optional(),
  openPr: _enum(["off", "draft", "ready"]).optional(),
  autoMerge: boolean2().optional(),
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
  issues: strictObject({
    enabled: boolean2().optional(),
    allowPublic: boolean2().optional(),
    watch: boolean2().optional(),
    watchMinutes: numberField("issues.watchMinutes"),
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
    events: alertEventsSchema.optional(),
    sound: boolean2().optional(),
    usagePercent: numberField("alerts.usagePercent")
  }).optional(),
  crew: strictObject({
    enabled: boolean2().optional(),
    keep: array(crewKeepSchema).optional(),
    idleStopMinutes: numberField("crew.idleStopMinutes"),
    max: numberField("crew.max"),
    maxOpus: numberField("crew.maxOpus"),
    memoryGb: numberField("crew.memoryGb"),
    loadPerCore: numberField("crew.loadPerCore"),
    startGapSeconds: numberField("crew.startGapSeconds"),
    perLead: numberField("crew.perLead"),
    perLeadOpus: numberField("crew.perLeadOpus"),
    usagePercent: numberField("crew.usagePercent"),
    quietMinutes: numberField("crew.quietMinutes"),
    handoffPercent: numberField("crew.handoffPercent"),
    handoffTokens: numberField("crew.handoffTokens"),
    softHours: numberField("crew.softHours"),
    maxHours: numberField("crew.maxHours"),
    archiveDays: numberField("crew.archiveDays"),
    deleteDays: numberField("crew.deleteDays"),
    tag: tagSchema.optional()
  }).refine((crew) => crew.deleteDays === undefined || crew.archiveDays === undefined || crew.deleteDays >= crew.archiveDays, { message: "crew.deleteDays must be at least crew.archiveDays", path: ["deleteDays"] }).optional()
});
var personalWorkflowSchema = workflowSchema.extend({
  switches: strictObject({ jobRoute: boolean2().optional() }).optional()
});
var workflowDefaults = {
  autoCommit: false,
  autoPush: false,
  openPr: "off",
  autoMerge: false,
  mergeMethod: "merge",
  deleteBranch: false,
  reviewBeforePush: true,
  reviewAgents: ["cc-smart-dev-kit:reviewer"],
  fixesAfterReview: {
    lines: 200,
    files: 10,
    percent: 20
  },
  clearWorktreeAfterMerge: false,
  issues: {
    enabled: false,
    allowPublic: false,
    watch: false,
    watchMinutes: 5,
    foundLabel: "kit:found",
    fixedLabel: "fixed-unreleased",
    readyLabel: "kit:ready"
  },
  alerts: {
    events: [...ALERT_EVENTS],
    sound: false,
    usagePercent: 85
  },
  crew: {
    enabled: false,
    keep: [],
    idleStopMinutes: 10,
    max: 12,
    maxOpus: null,
    memoryGb: 6,
    loadPerCore: 1.5,
    startGapSeconds: 60,
    perLead: 4,
    perLeadOpus: 2,
    usagePercent: 85,
    quietMinutes: 20,
    handoffPercent: 70,
    handoffTokens: 400000,
    softHours: 2,
    maxHours: 4,
    archiveDays: 7,
    deleteDays: 30,
    tag: null
  }
};
var SWITCH_NAMES = ["statusLine", "sessionNames", "jobRoute", "updateHold"];
var POLICY_KEYS = [
  "autoCommit",
  "autoPush",
  "openPr",
  "autoMerge",
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
  "issues.watch",
  "issues.watchMinutes",
  "issues.foundLabel",
  "issues.fixedLabel",
  "issues.readyLabel",
  "alerts.events",
  "alerts.sound",
  "alerts.usagePercent",
  "crew.enabled",
  "crew.keep",
  "crew.idleStopMinutes",
  "crew.max",
  "crew.maxOpus",
  "crew.memoryGb",
  "crew.loadPerCore",
  "crew.startGapSeconds",
  "crew.perLead",
  "crew.perLeadOpus",
  "crew.usagePercent",
  "crew.quietMinutes",
  "crew.handoffPercent",
  "crew.handoffTokens",
  "crew.softHours",
  "crew.maxHours",
  "crew.archiveDays",
  "crew.deleteDays",
  "crew.tag"
];
var SWITCH_KEYS = SWITCH_NAMES.map((name) => `switches.${name}`);
var WORKFLOW_KEYS = [...POLICY_KEYS, ...SWITCH_KEYS];

// src/project/version-range.ts
var NUMBER = "(?:x|X|\\*|0|[1-9]\\d*)";
var IDENT = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
var PARTIAL = `v?${NUMBER}(?:\\.${NUMBER}(?:\\.${NUMBER}(?:-${IDENT})?(?:\\+${IDENT})?)?)?`;
var COMPARATOR = new RegExp(`^(?:[<>]=?|=|\\^|~)?${PARTIAL}$`);
var HYPHEN = new RegExp(`^(${PARTIAL})\\s+-\\s+(${PARTIAL})$`);
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
function satisfiesRange(version, range) {
  if (!isValidRange(range))
    throw new Error(`"${range}" is not a valid version range`);
  return Bun.semver.satisfies(version, range);
}

// src/project/config.ts
var PLUGIN_HOOK_NAMES = [
  "git-guard",
  "merge-guard",
  "main-folder-guard",
  "message-guard",
  "agent-guard",
  "fable-session",
  "tier-view",
  "after-merge",
  "review-record",
  "subagent-background",
  "verify-gate",
  "agent-usage",
  "worktree-leftovers",
  "session-name",
  "crew-role",
  "lead-notes",
  "task-start"
];
var RETIRED_HOOK_NAMES = ["serena-root"];
var UNSWITCHABLE_HOOK_NAMES = ["job-route"];
var RETIRED_WORKTREE_FIELDS = ["prefix", "setup", "engine"];
var inCheckout = string2().min(1).refine((path) => !posix.isAbsolute(path) && !win32.isAbsolute(path) && !path.split(/[\\/]/).includes(".."), "must be relative to the checkout root, without ..").refine((path) => !path.includes("\\"), "use / as the separator").refine((path) => !path.split("/").includes("."), "must not contain . segments");
var ccSmartDevKitConfigSchema = strictObject({
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
    releaseBranch: string2().trim().min(1).optional(),
    legacyFolders: array(inCheckout).optional()
  }).optional(),
  workflow: workflowSchema.optional(),
  ownHooks: array(_enum([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES, ...UNSWITCHABLE_HOOK_NAMES])).optional()
});
class CcSmartDevKitConfigError extends Error {
  name = "CcSmartDevKitConfigError";
}

class CcSmartDevKitVersionError extends CcSmartDevKitConfigError {
  name = "CcSmartDevKitVersionError";
}

class CcSmartDevKitRetiredFieldError extends CcSmartDevKitConfigError {
  name = "CcSmartDevKitRetiredFieldError";
}
function describeIssue(issue) {
  const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => field === "(top level)" ? key : `${field}.${key}`);
    return `${keys.join(", ")}: unknown field (a newer cc-smart-dev-kit may be needed)`;
  }
  return `${field}: ${issue.message}`;
}
function checkRequires(file, raw, pluginVersion) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return;
  const requires = raw.requires;
  if (typeof requires !== "string" || !isValidRange(requires))
    return;
  if (!satisfiesRange(pluginVersion, requires)) {
    throw new CcSmartDevKitVersionError(`${file}: this project needs cc-smart-dev-kit ${requires}; you have ${pluginVersion}; ` + `run ${PLUGIN_UPDATE_COMMAND}`);
  }
}
function retiredFieldMessage(field) {
  return `worktrees.${field} is no longer supported: remove it \u2014 Claude Code's own worktrees need none. \`${COMMAND} project init\` removes it (README \xA7 Worktrees).`;
}
function retiredFieldsOf(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return [];
  const worktrees = raw.worktrees;
  if (typeof worktrees !== "object" || worktrees === null || Array.isArray(worktrees))
    return [];
  return RETIRED_WORKTREE_FIELDS.filter((field) => Object.hasOwn(worktrees, field));
}
function checkRetiredFields(where, raw) {
  const found = retiredFieldsOf(raw);
  if (found.length === 0)
    return;
  throw new CcSmartDevKitRetiredFieldError(`Invalid ${where}: ${found.map(retiredFieldMessage).join(" ")}`);
}
function loadCcSmartDevKitConfig(file, pluginVersion = VERSION) {
  if (!existsSync(file))
    return null;
  return parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file, pluginVersion);
}
function parseCcSmartDevKitConfig(text, where, pluginVersion = VERSION) {
  let raw;
  try {
    raw = parseUserJson(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CcSmartDevKitConfigError(`Invalid ${where}: not valid JSON (${reason})`);
  }
  return checkCcSmartDevKitConfig(raw, where, pluginVersion);
}
function checkCcSmartDevKitConfig(raw, where, pluginVersion = VERSION) {
  checkRequires(where, raw, pluginVersion);
  checkRetiredFields(where, raw);
  const parsed = ccSmartDevKitConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new CcSmartDevKitConfigError(`Invalid ${where}: ${issues}`);
  }
  return parsed.data;
}

// src/project/resolve.ts
import { existsSync as existsSync2, realpathSync as realpathSync2, statSync } from "fs";
import { join as join4 } from "path";
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
  return realpathSync2(path);
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
function loadProjectConfig(checkout, pluginVersion) {
  const { root, mainCheckout } = checkout;
  const own = join4(root, ".claude", "cc-smart-dev-kit.json");
  let config = loadCcSmartDevKitConfig(own, pluginVersion);
  let configFile = config === null ? null : own;
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    const main = join4(mainCheckout, ".claude", "cc-smart-dev-kit.json");
    config = loadCcSmartDevKitConfig(main, pluginVersion);
    configFile = config === null ? null : main;
  }
  return { ...checkout, config, configFile };
}
var CONFIG_PATH = ".claude/cc-smart-dev-kit.json";

// src/hooks/local-files.ts
var REBUILDABLE = [
  /(?:^|\/)(?:node_modules|bower_components|jspm_packages|\.venv|venv|\.tox|\.nox|\.bundle|\.gradle|\.pnpm-store|\.yarn\/cache)\/$/,
  /(?:^|\/)(?:dist|build|out|target|coverage|\.next|\.nuxt|\.output|\.svelte-kit|\.turbo|\.vercel|\.parcel-cache|\.angular|storybook-static|test-results|playwright-report|htmlcov|\.nyc_output)\/$/,
  /(?:^|\/)supabase\/\.temp\/cli-latest$/,
  /(?:^|\/)(?:\.cache|\.vite|\.eslintcache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.hypothesis|\.terraform|\.dart_tool)\/?$/,
  /\.(?:tsbuildinfo|pyc|pyo)$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)Thumbs\.db$/,
  /(?:^|\/)(?:npm-debug|yarn-debug|yarn-error|pnpm-debug|lerna-debug)\.log/,
  /(?:^|\/)logs\/$/,
  /\.log$/
];
var MAX_COMPARED = 2000;
function parseIgnored(porcelain) {
  return porcelain.split("\x00").filter((entry) => entry.startsWith("!! ")).map((entry) => entry.slice(3));
}
function sameAsMain(worktree, mainCheckout, path) {
  let budget = MAX_COMPARED;
  const same = (relative) => {
    if (--budget < 0)
      return false;
    const here = join5(worktree, relative);
    const there = join5(mainCheckout, relative);
    try {
      const a = lstatSync(here);
      const b = lstatSync(there);
      if (a.isSymbolicLink() || b.isSymbolicLink()) {
        return a.isSymbolicLink() && b.isSymbolicLink() && readlinkSync(here) === readlinkSync(there);
      }
      if (a.isDirectory()) {
        return b.isDirectory() && readdirSync(here).every((entry) => same(join5(relative, entry)));
      }
      return a.isFile() && b.isFile() && a.size === b.size && readFileSync2(here).equals(readFileSync2(there));
    } catch {
      return false;
    }
  };
  return same(path.replace(/\/$/, ""));
}
function projectRebuildable(mainCheckout) {
  if (mainCheckout === null)
    return [];
  try {
    const patterns = loadCcSmartDevKitConfig(join5(mainCheckout, CONFIG_PATH))?.worktrees?.rebuildable ?? [];
    return patterns.map((pattern) => new Bun.Glob(`**/${pattern}`));
  } catch {
    return [];
  }
}
function safeEntry(worktree, mainCheckout, entry, patterns) {
  if (patterns.some((pattern) => pattern.match(entry)))
    return true;
  if (REBUILDABLE.some((pattern) => pattern.test(entry))) {
    if (!entry.endsWith("/cli-latest"))
      return true;
    try {
      if (lstatSync(join5(worktree, entry)).isFile())
        return true;
    } catch {
      return false;
    }
  }
  return mainCheckout !== null && sameAsMain(worktree, mainCheckout, entry);
}
function localFiles(worktree, mainCheckout, env, patterns = projectRebuildable(mainCheckout)) {
  const status = runGit(worktree, [
    "--no-optional-locks",
    "status",
    "--porcelain",
    "-z",
    "--ignored=traditional",
    "--untracked-files=normal"
  ], env, 30000);
  if (!status.ok)
    return null;
  const safe = (entry) => safeEntry(worktree, mainCheckout, entry, patterns);
  const onlySafeInside = (entry) => {
    if (!entry.endsWith("/"))
      return false;
    let budget = MAX_COMPARED;
    const visit = (path) => {
      if (--budget < 0)
        return false;
      try {
        if (!lstatSync(join5(worktree, path)).isDirectory())
          return safe(path);
        const folder = `${path.replace(/\/$/, "")}/`;
        return safe(folder) || readdirSync(join5(worktree, path)).every((name) => visit(`${folder}${name}`));
      } catch {
        return false;
      }
    };
    return visit(entry);
  };
  return parseIgnored(status.out).filter((entry) => !safe(entry) && !onlySafeInside(entry));
}

// src/crew/end.ts
import { existsSync as existsSync15, readFileSync as readFileSync18 } from "fs";

// src/setup/lock.ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync as readFileSync3,
  readlinkSync as readlinkSync2,
  statSync as statSync2,
  unlinkSync,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join6 } from "path";

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
    return readlinkSync2("/proc/self/ns/pid");
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
    stat = statSync2(file);
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
  const file = join6(stateDir, LOCK_FILE);
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

// src/jobs/windows.ts
function processIsGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

// src/worktrees/machine-facts.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync4, readlinkSync as readlinkSync3 } from "fs";
import { platform } from "os";
var DOCKER_TIMEOUT_MS = 5000;
var PROGRAMS_TIMEOUT_MS = 15000;
var CONTAINER_FORMAT = '{"name":{{json .Name}},"mounts":{{json .Mounts}}}';
function parseContainerMounts(output) {
  const containers = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "")
      continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null)
      return null;
    const { mounts, name } = value;
    if (typeof name !== "string")
      return null;
    if (mounts !== null && !Array.isArray(mounts))
      return null;
    const listed = mounts ?? [];
    const sources = [];
    for (const mount of listed) {
      if (typeof mount !== "object" || mount === null)
        return null;
      const { Source, Type } = mount;
      if (Type === "bind" && typeof Source === "string")
        sources.push(Source);
    }
    containers.push({ name: name.replace(/^\//, ""), sources });
  }
  return containers;
}
function hostPath(source, windows) {
  if (!windows)
    return source;
  const drive = /^\/(?:run\/desktop\/mnt\/host\/|host_mnt\/|mnt\/)?([a-zA-Z])(\/.*)?$/.exec(source);
  if (drive?.[1] === undefined)
    return source;
  return `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
}
function containersUsing(worktree, containers, ignoreCase = IGNORE_CASE) {
  const real = realPath(worktree);
  return containers.filter((container) => container.sources.some((source) => isInside(realPath(hostPath(source, ignoreCase)), real, ignoreCase))).map((container) => container.name);
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
function mentions(line, folder) {
  const form = (text) => text.replace(/\\/g, "/");
  const inFolder = form(line);
  const at = form(folder).replace(/\/+$/, "").toLowerCase();
  const lower = inFolder.toLowerCase();
  for (let index = lower.indexOf(at);index !== -1; index = lower.indexOf(at, index + 1)) {
    const after = inFolder[index + at.length];
    if (after === undefined || after === "/" || after === " " || after === "'" || after === '"') {
      return true;
    }
  }
  return false;
}
function lineage(programs, pid) {
  const parents = new Map;
  for (const program of programs) {
    if (program.parentPid !== undefined)
      parents.set(program.pid, program.parentPid);
  }
  const chain = new Set([pid]);
  let at = pid;
  for (;; ) {
    const parent = parents.get(at);
    if (parent === undefined || parent <= 0 || chain.has(parent))
      break;
    chain.add(parent);
    at = parent;
  }
  return chain;
}
var OUR_TOOLS = new Set(["git", "docker", "ps", "powershell", "pgrep"]);
function programName(program) {
  const file = (program.path ?? "").split(/[\s"'`]/)[0] ?? "";
  const base = file.replace(/^.*[\\/]/, "");
  return base === "" ? `pid ${String(program.pid)}` : base;
}
function programsUsing(programs, worktree, ignoreCase = IGNORE_CASE, ownPid = process.pid) {
  const asking = lineage(programs, ownPid);
  const real = realPath(worktree);
  const forms = real === worktree ? [worktree] : [worktree, real];
  const found = [];
  for (const program of programs) {
    const named = program.path !== null && forms.some((form) => mentions(program.path ?? "", form));
    const working = program.cwd !== undefined && isInside(realPath(program.cwd), real, ignoreCase);
    if (!named && !working)
      continue;
    if (!working && asking.has(program.pid))
      continue;
    if (OUR_TOOLS.has(programName(program)))
      continue;
    found.push(program);
  }
  return found;
}
function programsInside(programs, worktree, ignoreCase = IGNORE_CASE, ownPid = process.pid) {
  const names = new Set;
  for (const program of programsUsing(programs, worktree, ignoreCase, ownPid)) {
    names.add(programName(program));
  }
  return [...names].sort();
}
function docker(args) {
  try {
    const run = Bun.spawnSync(["docker", ...args], {
      stderr: "pipe",
      stdout: "pipe",
      timeout: DOCKER_TIMEOUT_MS,
      windowsHide: true
    });
    return {
      err: run.stderr.toString().trim(),
      ok: run.exitCode === 0,
      out: run.stdout.toString().trim()
    };
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    return { err: String(error), ok: false, out: "" };
  }
}
function dockerMounts() {
  const listed = docker(["ps", "--all", "--quiet", "--no-trunc"]);
  if (listed === null)
    return [];
  if (!listed.ok)
    return "unknown";
  const ids = listed.out.split(/\s+/).filter((id) => id !== "");
  if (ids.length === 0)
    return [];
  const inspected = docker(["inspect", "--format", CONTAINER_FORMAT, ...ids]);
  if (inspected === null || !inspected.ok)
    return "unknown";
  return parseContainerMounts(inspected.out) ?? "unknown";
}
var LIST_PROGRAMS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + "Get-CimInstance Win32_Process | Where-Object ExecutablePath | " + 'ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)" }';
function cwdOf(pid) {
  try {
    return readlinkSync3(`/proc/${String(pid)}/cwd`);
  } catch {
    return;
  }
}
function procPids() {
  try {
    return readdirSync2("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
  } catch {
    return [];
  }
}
function runningPrograms(on = platform()) {
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
    const run = Bun.spawnSync(["ps", "-ww", "-o", "pid=,ppid=,args="], {
      stderr: "pipe",
      stdout: "pipe",
      timeout: PROGRAMS_TIMEOUT_MS
    });
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
function parseMountPoints(text) {
  const mounts = [];
  for (const line of text.split(`
`)) {
    if (line === "")
      continue;
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    const destination = fields[4];
    if (separator < 6 || fields.length < separator + 4 || !/^\d+$/.test(fields[0] ?? "") || !/^\d+$/.test(fields[1] ?? "") || !/^\d+:\d+$/.test(fields[2] ?? "") || destination === undefined || !destination.startsWith("/") || /\\(?!040|011|012|134)/.test(destination))
      return null;
    mounts.push(destination.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8))));
  }
  return mounts.includes("/") ? mounts : null;
}
function mountKeptWhy(worktree, mounts) {
  if (mounts === "unknown")
    return "its mount points could not be read, so it cannot be shown that nothing is mounted in it";
  const mounted = mounts.find((path) => isInside(realPath(path), realPath(worktree)));
  return mounted === undefined ? null : `a mount point lies inside it: ${mounted}`;
}
function mountPoints(on = platform()) {
  if (on !== "linux")
    return "unknown";
  try {
    return parseMountPoints(readFileSync4("/proc/self/mountinfo", "utf8")) ?? "unknown";
  } catch {
    return "unknown";
  }
}

// src/worktrees/scan.ts
import { existsSync as existsSync14, mkdtempSync, readdirSync as readdirSync9, rmSync as rmSync4, statSync as statSync9 } from "fs";
import { tmpdir } from "os";
import { join as join21 } from "path";

// src/hooks/sessions.ts
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync6, statSync as statSync3 } from "fs";
import { uptime } from "os";
import { join as join7 } from "path";

// src/jobs/ancestry.ts
import { readFileSync as readFileSync5 } from "fs";
var MAX_DEPTH = 128;
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
function readProcStat(pid) {
  try {
    return readFileSync5(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null;
  }
}

// src/hooks/sessions.ts
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
function liveSessions(claudeConfigDir, facts = {}) {
  const dir = join7(claudeConfigDir, "sessions");
  if (!existsSync3(dir))
    return [];
  const bootedAt = Date.now() - uptime() * 1000;
  const live = [];
  for (const file of readdirSync3(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid) || !(facts.running ?? isRunning)(pid))
      continue;
    let text;
    try {
      if (statSync3(join7(dir, file)).mtimeMs < bootedAt)
        continue;
      text = readFileSync6(join7(dir, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      throw new Error(`the record of running session ${pid} cannot be read; retry`);
    }
    const record = parseSessionRecord(text);
    if (record === null) {
      throw new Error(`the record of running session ${pid} in ${dir} cannot be read, so it is unknown where it works`);
    }
    if ((facts.platform ?? process.platform) === "linux" && record.procStart !== undefined) {
      const start = processStart(pid, facts);
      if (start !== undefined && record.procStart !== start)
        continue;
    }
    live.push(record);
  }
  return live;
}

// src/hooks/worktree-leftovers.ts
import { existsSync as existsSync13, readFileSync as readFileSync17, statSync as statSync8 } from "fs";
import { basename as basename6, isAbsolute as isAbsolute2, join as join20, resolve as resolve4 } from "path";

// src/crew/store.ts
import {
  appendFileSync,
  closeSync as closeSync3,
  existsSync as existsSync7,
  fstatSync,
  mkdirSync as mkdirSync5,
  openSync as openSync3,
  readdirSync as readdirSync6,
  readFileSync as readFileSync10,
  readSync,
  rmSync,
  statSync as statSync5
} from "fs";
import { dirname as dirname5, join as join12 } from "path";

// src/setup/write.ts
import {
  closeSync as closeSync2,
  existsSync as existsSync4,
  fsyncSync,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync as readdirSync4,
  readFileSync as readFileSync7,
  readlinkSync as readlinkSync4,
  realpathSync as realpathSync3,
  renameSync,
  statSync as statSync4,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "fs";
import { basename as basename2, dirname as dirname2, join as join8, resolve as resolve3 } from "path";
function writeTemp(file, content, mode) {
  const dir = dirname2(file);
  mkdirSync2(dir, { recursive: true });
  const temp = join8(dir, `.${basename2(file)}.cc-smart-dev-kit-tmp-${process.pid}-${crypto.randomUUID()}`);
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

// src/workflow/reviews.ts
import { createHash } from "crypto";
var START_KEPT_MS = 24 * 60 * 60 * 1000;
var COMMIT_SHA = /^[0-9a-f]{40,64}$/;
function repoKey(repo) {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}

// src/zod-issues.ts
function describeIssues(issues) {
  return issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
    return issue.code === "unrecognized_keys" ? `${issue.keys.join(", ")}: unknown field` : `${field}: ${issue.message}`;
  }).join("; ");
}

// src/tasks/project/format.ts
var date3 = string2().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Expected a calendar date (YYYY-MM-DD)");
var projectTaskSchema = object({
  id: string2().regex(/^T-[a-z2-7]{6}$/),
  title: string2().min(1).max(200),
  kind: _enum(["production", "database", "teammate", "follow-up"]),
  status: _enum(["open", "done", "dropped"]),
  when: _enum(["now", "next-release", "any"]).optional(),
  weight: _enum(["blocks-release", "after-deploy", "owner"]).optional(),
  flags: array(_enum(["needs-yes", "twice-safe", "spends-money", "real-people", "destructive"])).optional(),
  created: date3,
  closed: date3.optional(),
  from: string2().optional(),
  refs: array(string2()).optional(),
  evidence: string2().optional()
}).passthrough();

// src/tasks/context.ts
function projectKey(repo) {
  return repoKey(repo);
}

// src/tasks/work/db.ts
import { Database } from "bun:sqlite";
import { chmodSync as chmodSync2, existsSync as existsSync5, mkdirSync as mkdirSync3 } from "fs";
import { dirname as dirname3, join as join9 } from "path";
var WORK_SCHEMA_VERSION = 2;
var WRITE_TIMEOUT_MS = 3000;
var HOOK_TIMEOUT_MS = 200;
var NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
function workDbFile(paths) {
  return join9(paths.stateDir, "tasks", "work.db");
}
var SCHEMA = `
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
`;
var MIGRATIONS = [
  "ALTER TABLE tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1 CHECK(blocking IN (0,1))"
];
function openWorkDb(file, options) {
  const hook = options.mode === "hook";
  const fresh = !existsSync5(file);
  if (hook && fresh)
    throw new Error("task store does not exist");
  if (!hook)
    mkdirSync3(dirname3(file), { recursive: true, mode: 448 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
  try {
    sqlite.run(`PRAGMA busy_timeout = ${hook ? HOOK_TIMEOUT_MS : WRITE_TIMEOUT_MS}`);
    sqlite.run("PRAGMA foreign_keys = ON");
    if (!hook) {
      chmodSync2(dirname3(file), 448);
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
          sqlite.run(step);
          sqlite.run(`PRAGMA user_version = ${at + 1}`);
        }
        sqlite.run("COMMIT");
      } catch (error) {
        sqlite.run("ROLLBACK");
        throw error;
      }
    }
    const minimum = Number(sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()?.value ?? WORK_SCHEMA_VERSION);
    if (hook || minimum > WORK_SCHEMA_VERSION)
      sqlite.run("PRAGMA query_only = ON");
    return {
      sqlite,
      writable: !hook && minimum <= WORK_SCHEMA_VERSION,
      close: () => sqlite.close()
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
function writeWork(db, body, options = {}) {
  if (!db.writable)
    return { ok: false, why: NEWER_STORE };
  let began = false;
  try {
    db.sqlite.run("BEGIN IMMEDIATE");
    began = true;
    const min = Number(db.sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()?.value ?? 1);
    if (min > WORK_SCHEMA_VERSION)
      throw new Error(NEWER_STORE);
    const value = body();
    db.sqlite.run(options.rehearse ? "ROLLBACK" : "COMMIT");
    return { ok: true, value };
  } catch (error) {
    if (began)
      db.sqlite.run("ROLLBACK");
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

// src/crew/session.ts
import { readFileSync as readFileSync8 } from "fs";
import { join as join10 } from "path";
var CREW_ENV = "CC_SMART_DEV_KIT_CREW";
function crewIdOf(env) {
  const id = env[CREW_ENV]?.trim() ?? "";
  return id === "" ? null : id;
}
var CREW_QUESTION_STEP = "Nobody is at the machine to answer this question, so the call is refused. Ask your lead " + `with \`${COMMAND} crew report --question "<the question>" --option "<choice>" --option ` + '"<choice>" --recommend <n>`, and go on with the rest of your phase.';
function sessionRecordFile(claudeConfigDir, pid) {
  return join10(claudeConfigDir, "sessions", `${pid}.json`);
}

class SessionRecordError extends Error {
  name = "SessionRecordError";
}
var readText = (file) => {
  try {
    return readFileSync8(file, "utf8");
  } catch {
    return null;
  }
};
var CLAUDE_PID_ENV = "CLAUDE_PID";
var CLAUDE_SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID";
function recordOf(claudeConfigDir, pid, read) {
  const file = sessionRecordFile(claudeConfigDir, pid);
  const text = read(file);
  if (text === null)
    return null;
  const record = parseSessionRecord(text);
  if (record === null || record.pid !== pid) {
    throw new SessionRecordError(`the session record ${file} cannot be read, so the session that runs this command is unknown`);
  }
  return record;
}
function sessionNamedByEnv(claudeConfigDir, env, read = readText) {
  const pid = env[CLAUDE_PID_ENV]?.trim() ?? "";
  const id = env[CLAUDE_SESSION_ID_ENV]?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(pid) || id === "")
    return null;
  const record = recordOf(claudeConfigDir, Number(pid), read);
  return record !== null && record.sessionId === id ? record : null;
}
function callingSession(claudeConfigDir, pid, parentOf, env = {}, read = readText) {
  const named = sessionNamedByEnv(claudeConfigDir, env, read);
  if (named !== null)
    return named;
  for (const ancestor of ancestorsBy(pid, parentOf)) {
    const record = recordOf(claudeConfigDir, ancestor, read);
    if (record !== null)
      return record;
  }
  return null;
}
function procCommandLine(pid) {
  try {
    const raw = readFileSync8(`/proc/${String(pid)}/cmdline`, "utf8");
    const args = raw.split("\x00").filter((arg) => arg !== "");
    return args.length === 0 ? null : args.join(" ");
  } catch {
    return null;
  }
}
function realProcessFacts(platform) {
  if (platform === "linux") {
    return {
      commandLineOf: procCommandLine,
      parentOf: (pid) => {
        const stat = readProcStat(pid);
        return stat === null ? null : parentPidFromStat(stat);
      }
    };
  }
  let listed = null;
  const program = (pid) => {
    if (listed === null) {
      const found = runningPrograms(platform);
      listed = new Map(found === "unknown" ? [] : found.map((one) => [one.pid, one]));
    }
    return listed.get(pid);
  };
  return {
    commandLineOf: (pid) => platform === "win32" ? null : program(pid)?.path ?? null,
    parentOf: (pid) => program(pid)?.parentPid ?? null
  };
}

// src/tasks/work/identity.ts
var cached2 = new Map;

// src/tasks/work/queries.ts
function allTasks(db, project) {
  const dependencies = new Map;
  for (const row of db.sqlite.query("SELECT d.task_id,d.waits_for FROM task_deps d JOIN tasks t ON t.id=d.task_id WHERE t.project=? ORDER BY d.waits_for").all(project)) {
    const refs = dependencies.get(row.task_id) ?? [];
    refs.push(row.waits_for);
    dependencies.set(row.task_id, refs);
  }
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
    crewId: row.crew_id,
    createdBy: row.created_by,
    claim: row.claim_pid === null ? null : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    waitsFor: dependencies.get(row.id) ?? [],
    type: row.blocking === 0 ? "non-blocking" : "blocking"
  }));
}
function getTask(db, project, ref) {
  const number = /^#?\d+$/.test(ref) ? Number(ref.replace(/^#/, "")) : null;
  return allTasks(db, project).find((t) => number === null ? t.id === ref : t.number === number) ?? null;
}
function taskById(db, id) {
  const row = db.sqlite.query("SELECT project FROM tasks WHERE id=?").get(id);
  if (!row)
    throw new Error("task not found");
  const task = getTask(db, row.project, id);
  if (!task)
    throw new Error("task not found");
  return task;
}
function isOpen(task) {
  return task.status === "pending" || task.status === "in_progress";
}
function descendants(db, id) {
  const task = taskById(db, id);
  return descendantsIn(allTasks(db, task.project), id);
}
function descendantsIn(tasks, id) {
  const ids = new Set([id]);
  const result = [];
  let added = true;
  while (added) {
    added = false;
    for (const t of tasks)
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        result.push(t);
        added = true;
      }
  }
  return result;
}
function inProgressFirst(a, b) {
  return Number(b.status === "in_progress") - Number(a.status === "in_progress") || a.number - b.number;
}
function openSubtasks(db, id) {
  return descendants(db, id).filter(isOpen).sort(inProgressFirst);
}
function holdingUnder(tasks, id) {
  const children = new Map;
  for (const t of tasks) {
    if (!t.parentId)
      continue;
    const siblings = children.get(t.parentId);
    if (siblings)
      siblings.push(t);
    else
      children.set(t.parentId, [t]);
  }
  const seen = new Set([id]);
  const result = [];
  const walk = (parent) => {
    for (const child of children.get(parent) ?? []) {
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

// src/tasks/work/types.ts
var NOTE_LIMIT = 64000;

// src/tasks/work/store.ts
var NOTE_PREVIEW = 120;
function shape(db, task) {
  const numberOf = (id) => `#${taskById(db, id).number}`;
  return {
    subject: task.subject,
    description: task.description,
    status: task.status,
    type: task.type,
    parent: task.parentId === null ? null : numberOf(task.parentId),
    crew: task.crewId,
    claim: task.claim === null ? null : task.claim.sessionId ?? `process ${task.claim.pid}`,
    waitsFor: task.waitsFor.map(numberOf).sort()
  };
}
function diff(before, after) {
  const changes = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Bun.deepEquals(before[key], after[key]))
      changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}
function recordEvent(db, task, action, changes, who, now, reason) {
  db.sqlite.query("INSERT INTO task_events(task_id,project,number,at,action,changes,session_id,session_name,crew_id,pid,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(task.id, task.project, task.number, now, action, JSON.stringify(changes), who.sessionId, who.name ?? null, who.crewId, who.pid, reason);
}
function recordChange(db, before, task, who, now, reason) {
  const changes = diff(before, shape(db, task));
  if (Object.keys(changes).length === 0)
    return;
  const closed = changes.status !== undefined && (task.status === "done" || task.status === "dropped");
  recordEvent(db, task, closed ? "closed" : "changed", changes, who, now, reason);
}
function insertNote(db, id, text, who, now, reason = null) {
  const task = taskById(db, id);
  if (!text.trim() || text.length > NOTE_LIMIT)
    throw new Error(`note must be 1\u2013${NOTE_LIMIT} characters`);
  const row = db.sqlite.query("INSERT INTO task_notes(task_id,text,session_id,crew_id,at) VALUES (?,?,?,?,?) RETURNING id").get(id, text, who.sessionId, who.crewId, now);
  db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(now, id);
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW)}\u2026` : text;
  recordEvent(db, task, "noted", { note: [null, preview] }, who, now, reason);
  return {
    id: row?.id ?? 0,
    taskId: id,
    text,
    sessionId: who.sessionId,
    crewId: who.crewId,
    at: now
  };
}
function systemClose(db, id, status, reason, who, now) {
  return writeWork(db, () => applySystemClose(db, id, status, reason, who, now));
}
function applySystemClose(db, id, status, reason, who, now) {
  const task = taskById(db, id);
  const open = status === "done" ? holdingUnder(allTasks(db, task.project), id) : openSubtasks(db, id);
  const laidOut = (t) => status === "dropped" && task.kind === "phase" && t.crewId === null;
  for (const child of open) {
    const before = shape(db, child);
    if (laidOut(child)) {
      if (child.status === "pending" && child.claim === null)
        continue;
      db.sqlite.query("UPDATE tasks SET status='pending',updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?").run(now, child.id);
      recordChange(db, before, taskById(db, child.id), who, now, reason);
      insertNote(db, child.id, `Back to pending: ${reason}. The phase's next crew session takes it.`, who, now, reason);
      continue;
    }
    db.sqlite.query("UPDATE tasks SET status='dropped',closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?").run(now, now, child.id);
    recordChange(db, before, taskById(db, child.id), who, now, reason);
    insertNote(db, child.id, `Automatically dropped: ${reason}`, who, now, reason);
  }
  const before = shape(db, task);
  db.sqlite.query("UPDATE tasks SET status=?,closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?").run(status, now, now, task.id);
  recordChange(db, before, taskById(db, id), who, now, reason);
  insertNote(db, id, `Automatically ${status}: ${reason}`, who, now, reason);
  return taskById(db, id);
}

// src/crew/phase-task.ts
var UNKNOWN = { sessionId: null, crewId: null, pid: null, procStart: null };
function closePhaseTask(stateDir, record, outcome, reason, now, error) {
  let db;
  try {
    db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
    const phase = allTasks(db, projectKey(record.repo)).find((t) => t.kind === "phase" && t.crewId === record.id);
    if (!phase || phase.status === "done" || phase.status === "dropped")
      return;
    const result = systemClose(db, phase.id, outcome, reason, UNKNOWN, now);
    if (!result.ok)
      throw new Error(result.why);
  } catch (cause) {
    error(`note: the phase task could not be closed: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    db?.close();
  }
}

// src/crew/runs.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readdirSync as readdirSync5, readFileSync as readFileSync9 } from "fs";
import { basename as basename3, dirname as dirname4, join as join11 } from "path";
var RUNS_DIR = "runs";
var PLAN_ARCHIVE_DIR = "archive";
var RUN_VERSION = 1;
var text = string2().min(1);
var actor = looseObject({ name: text, sessionId: text });
function planFolderOf(planFile) {
  return planFile.replace(/\.md$/, "");
}
function livePlanFolder(planFile) {
  const folder = planFolderOf(planFile);
  if (existsSync6(folder))
    return folder;
  const archived = join11(dirname4(folder), PLAN_ARCHIVE_DIR, basename3(folder));
  if (!existsSync6(planFile) && (existsSync6(archived) || existsSync6(`${archived}.md`))) {
    return archived;
  }
  return folder;
}
function plansFolderGone(planFile) {
  return !existsSync6(dirname4(planFile));
}
function runFile(planFile, id) {
  return join11(livePlanFolder(planFile), RUNS_DIR, `${id}.json`);
}
var runEventSchema = looseObject({
  at: text,
  kind: text,
  by: actor.nullable(),
  state: text,
  text: string2().nullable(),
  detail: record(string2(), unknown()).optional()
});
var runTimesSchema = looseObject({
  createdAt: text,
  startedAt: text.nullable(),
  finishedAt: text.nullable(),
  mergedAt: text.nullable(),
  removedAt: text.nullable(),
  wallMs: number2().nullable(),
  workingMs: number2().nullable(),
  queuedMs: number2().nullable(),
  pausedMs: number2(),
  pauses: array(looseObject({ from: text, to: text.nullable(), reason: text }))
});
var runRecordSchema = looseObject({
  version: number2().int().min(1),
  id: text,
  name: text,
  plan: text,
  phase: text,
  slug: text,
  kind: text,
  model: looseObject({
    named: text,
    resolved: text,
    slot: string2().nullable()
  }),
  effort: text,
  branch: text,
  baseRef: text,
  base: looseObject({ ref: text, sha: text }).nullable(),
  brief: looseObject({ path: string2().nullable(), sha256: string2().nullable() }),
  issue: looseObject({ number: number2().int().positive(), url: text }).optional(),
  lead: actor,
  continues: string2().nullable(),
  continuedBy: string2().nullable(),
  sessions: array(looseObject({
    at: text,
    by: actor.nullable(),
    sessionId: text,
    shortId: string2().nullable()
  })),
  state: text,
  events: array(runEventSchema),
  times: runTimesSchema,
  contextTokens: number2().int().min(0).nullable().optional(),
  backfilled: array(text).optional(),
  createdAt: text,
  updatedAt: text
});
function leadOf(record2) {
  return { name: record2.leadName, sessionId: record2.leadSessionId };
}
function oneLine(value, max = 160) {
  const line = value.split(`
`)[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}
function eventsOf(change) {
  const { after, at, before, report } = change;
  const lead = change.by === undefined ? leadOf(after) : change.by;
  const base = { at, state: after.state };
  const events = [];
  if (before === null) {
    events.push({ ...base, by: change.by ?? leadOf(after), kind: "created", text: null });
  } else if (before.state !== after.state) {
    const reason = change.event?.text ?? null;
    if (after.state === "merged") {
      events.push({
        ...base,
        by: lead,
        detail: {
          commit: after.mergeProof?.leadCommit ?? null,
          head: after.mergeProof?.head ?? null,
          leadRef: after.mergeProof?.leadRef ?? null
        },
        kind: "merged",
        text: reason
      });
    } else if (after.state === "removed") {
      events.push({
        ...base,
        by: lead,
        detail: { mergedBeforeRemoval: after.mergedBeforeRemoval ?? false },
        kind: "removed",
        text: reason
      });
    } else {
      events.push({
        ...base,
        by: after.state === "discarded" ? lead : null,
        ...after.state === "paused" && after.waitingFor !== undefined ? { detail: { waitingFor: after.waitingFor } } : {},
        kind: "state",
        text: reason
      });
    }
  }
  if (after.sessionId !== null && after.sessionId !== before?.sessionId) {
    events.push({
      ...base,
      by: null,
      detail: { sessionId: after.sessionId, shortId: after.shortId },
      kind: "session",
      text: null
    });
  }
  const askedBefore = before?.questions.length ?? 0;
  for (const [index, asked] of after.questions.entries()) {
    if (index >= askedBefore) {
      events.push({
        ...base,
        by: null,
        detail: { index },
        kind: "question",
        text: oneLine(asked.question)
      });
    }
    const earlier = before?.questions[index];
    if (asked.answer !== null && earlier?.answer === null) {
      events.push({
        ...base,
        by: lead,
        detail: { index },
        kind: "answer",
        text: oneLine(asked.answer)
      });
    } else if (asked.answer !== null && earlier !== undefined && (asked.superseded?.length ?? 0) > (earlier.superseded?.length ?? 0)) {
      events.push({
        ...base,
        by: lead,
        detail: { correction: true, index },
        kind: "answer",
        text: oneLine(asked.answer)
      });
    }
  }
  if (report !== undefined) {
    events.push({
      ...base,
      by: null,
      detail: {
        checksFailed: report.checks.filter((one) => !one.ok).length,
        review: report.review === null ? null : {
          agent: report.review.agent,
          effort: report.review.effort,
          model: report.review.model
        },
        sha: report.branch.sha,
        status: report.status,
        testsFailed: report.tests.targeted.reduce((sum, one) => sum + one.failed, 0) + (report.tests.full?.failed ?? 0),
        testsPassed: report.tests.targeted.reduce((sum, one) => sum + one.passed, 0) + (report.tests.full?.passed ?? 0),
        wholeSuite: report.tests.full === null ? null : report.tests.full.ok
      },
      kind: "report",
      text: report.status
    });
  }
  return events;
}
var END_OF_WORK = ["done", "failed", "handoff", "discarded"];
function deriveTimes(run, nowMs = null) {
  const lastEnd = run.events.findLastIndex((one) => END_OF_WORK.includes(one.state) && (one.kind === "state" || one.kind === "report"));
  const runsAgain = run.events.slice(lastEnd + 1).some((one) => one.kind === "state" && !["stopped", ...END_OF_WORK].includes(one.state));
  const finishedAt = lastEnd === -1 || runsAgain ? null : run.events[lastEnd]?.at ?? null;
  const mergedAt = run.events.find((one) => one.kind === "merged")?.at ?? null;
  const removedAt = run.events.find((one) => one.kind === "removed")?.at ?? null;
  const startedAt = run.startedAt ?? run.events.find((one) => one.kind === "state" && !["queued", "failed"].includes(one.state))?.at ?? null;
  const pauses = [];
  let open = null;
  for (const one of run.events) {
    if (one.kind !== "state" && one.kind !== "merged" && one.kind !== "removed")
      continue;
    if (open !== null && one.state !== "paused") {
      pauses.push({ ...open, to: one.at });
      open = null;
    }
    if (open === null && one.state === "paused") {
      const waiting = one.detail?.waitingFor;
      const kind = typeof waiting === "object" && waiting !== null && "kind" in waiting ? String(waiting.kind) : "unknown";
      open = { from: one.at, reason: kind };
    }
  }
  if (open !== null)
    pauses.push({ ...open, to: null });
  const endMs = finishedAt === null ? nowMs : Date.parse(finishedAt);
  const startMs = startedAt === null ? null : Date.parse(startedAt);
  let pausedMs = 0;
  for (const pause of pauses) {
    const from = Date.parse(pause.from);
    const to = pause.to === null ? endMs : Date.parse(pause.to);
    if (to === null || Number.isNaN(from) || Number.isNaN(to))
      continue;
    const clippedFrom = startMs === null ? from : Math.max(from, startMs);
    const clippedTo = endMs === null ? to : Math.min(to, endMs);
    if (clippedTo > clippedFrom)
      pausedMs += clippedTo - clippedFrom;
  }
  const createdMs = Date.parse(run.createdAt);
  const finishedMs = finishedAt === null ? null : Date.parse(finishedAt);
  return {
    createdAt: run.createdAt,
    finishedAt,
    mergedAt,
    pausedMs,
    pauses,
    queuedMs: startMs === null ? null : Math.max(0, startMs - createdMs),
    removedAt,
    startedAt,
    wallMs: finishedMs === null ? null : Math.max(0, finishedMs - createdMs),
    workingMs: finishedMs === null || startMs === null ? null : Math.max(0, finishedMs - startMs - pausedMs)
  };
}
function startOf(after, at) {
  const source = after.briefSource;
  return {
    base: after.base ?? null,
    baseRef: after.baseRef,
    branch: after.branch,
    brief: { path: source?.path ?? null, sha256: source?.sha256 ?? null },
    continuedBy: null,
    continues: after.continues ?? null,
    createdAt: at,
    effort: after.effort,
    events: [],
    id: after.id,
    ...after.issue === undefined ? {} : { issue: { number: after.issue.number, url: after.issue.url } },
    kind: after.kind,
    lead: leadOf(after),
    model: { named: after.model.named, resolved: after.model.resolved, slot: after.model.slot },
    name: after.name,
    phase: after.phase,
    plan: after.plan,
    sessions: [],
    slug: after.slug,
    state: after.state,
    times: deriveTimes({ createdAt: at, events: [], startedAt: null }),
    updatedAt: at,
    version: RUN_VERSION
  };
}
function nextRun(previous, change) {
  const { after, at } = change;
  const run = previous ?? startOf(after, change.before === null ? at : after.createdAt);
  const events = eventsOf(change);
  const sessions = [...run.sessions];
  for (const one of events) {
    if (one.kind !== "session")
      continue;
    const sessionId = String(one.detail?.sessionId ?? "");
    if (sessionId === "" || sessions.some((known) => known.sessionId === sessionId))
      continue;
    const shortId = one.detail?.shortId;
    sessions.push({
      at: one.at,
      by: one.by,
      sessionId,
      shortId: typeof shortId === "string" ? shortId : null
    });
  }
  const all = [...run.events, ...events];
  const startedAt = after.startedAt ?? run.times.startedAt;
  return {
    ...run,
    base: after.base ?? run.base,
    brief: after.briefSource === undefined ? run.brief : { path: after.briefSource.path, sha256: after.briefSource.sha256 },
    ...change.contextTokens === undefined || change.contextTokens === null ? {} : { contextTokens: change.contextTokens },
    events: all,
    sessions,
    state: after.state,
    times: deriveTimes({ createdAt: run.createdAt, events: all, startedAt }),
    updatedAt: at,
    version: Math.max(run.version, RUN_VERSION)
  };
}
function readRunFile(file) {
  let raw;
  try {
    raw = readFileSync9(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : error}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${file}: not valid JSON (${error instanceof Error ? error.message : error})`);
  }
  const parsed = runRecordSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  return parsed.data;
}
function writeRunFile(file, run) {
  mkdirSync4(dirname4(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(run, null, 2)}
`, 420);
}
function recordRun(change) {
  const planFile = change.after.planFile;
  if (typeof planFile !== "string" || planFile === "")
    return;
  const file = runFile(planFile, change.after.id);
  const previous = readRunFile(file);
  if (previous === null && plansFolderGone(planFile))
    return;
  if (previous !== null && eventsOf(change).length === 0 && change.contextTokens == null)
    return;
  writeRunFile(file, nextRun(previous, change));
  const continues = change.after.continues;
  if (change.before === null && typeof continues === "string") {
    linkContinuation(planFile, continues, change.after.id, change.at);
  }
}
function linkContinuation(planFile, oldId, newId, at) {
  const file = runFile(planFile, oldId);
  const old = readRunFile(file);
  if (old === null || old.continuedBy === newId)
    return;
  writeRunFile(file, { ...old, continuedBy: newId, updatedAt: at });
}

// src/crew/store.ts
var CREW_STORE_VERSION = 1;
var STORE_LOCK_WAIT_MS = 3000;
var NO_RESUME_STATES = ["merged", "removed", "discarded"];
class CrewStoreError extends Error {
  name = "CrewStoreError";
}
var FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var RECORD_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;
function fileId(id, what) {
  if (!FILE_ID.test(id)) {
    throw new CrewStoreError(`"${id}" is not a ${what} the store can name a file after`);
  }
  return id;
}
function crewRootDir(stateDir) {
  return join12(stateDir, "crew");
}
function crewStoreDir(stateDir, repo) {
  return join12(crewRootDir(stateDir), repoKey(repo));
}
function crewFile(stateDir, repo, id) {
  return join12(crewStoreDir(stateDir, repo), "crew", `${fileId(id, "crew id")}.json`);
}
function leadFile(stateDir, repo, sessionId) {
  return join12(crewStoreDir(stateDir, repo), "leads", `${fileId(sessionId, "session id")}.json`);
}
function crewFilesDir(stateDir, repo, id) {
  return join12(crewStoreDir(stateDir, repo), "files", fileId(id, "crew id"));
}
function crewEventsFile(stateDir, repo) {
  return join12(crewStoreDir(stateDir, repo), "events.jsonl");
}
var text2 = string2().min(1);
var version2 = number2().int().min(1);
var sha = string2().regex(COMMIT_SHA, "a full commit sha");
var count = number2().int().min(0);
var word = () => text2.transform((value) => value);
var supersededAnswer = looseObject({
  answer: text2,
  answeredAt: text2,
  deliveredAt: text2.nullable().optional()
});
var crewQuestionFields = looseObject({
  question: text2,
  options: array(text2).min(2),
  recommended: number2().int().min(1).nullable(),
  askedAt: text2,
  answeredAt: text2.nullable(),
  answer: text2.nullable(),
  supersededBy: number2().int().min(0).nullable().optional(),
  deliveredAt: text2.nullable().optional(),
  superseded: array(supersededAnswer).optional()
});
var crewQuestion = crewQuestionFields.superRefine((asked, context) => {
  if (asked.recommended !== null && asked.recommended > asked.options.length) {
    context.addIssue({
      code: "custom",
      message: `recommends option ${asked.recommended} of ${asked.options.length}`,
      path: ["recommended"]
    });
  }
  if (asked.answer === null !== (asked.answeredAt === null)) {
    context.addIssue({
      code: "custom",
      message: "an answer and its time are given together",
      path: ["answeredAt"]
    });
  }
});
function crewOfWorktree(records, path) {
  let found = null;
  for (const one of records) {
    if (one.released !== undefined || ["removed", "discarded"].includes(one.state) || !samePath(one.worktree, path))
      continue;
    found = one;
  }
  return found;
}
var waitingForSchema = discriminatedUnion("kind", [
  looseObject({
    kind: literal("slot"),
    since: text2,
    slot: text2
  }),
  looseObject({
    kind: literal("claude-limit"),
    model: text2,
    resetsAt: text2.nullable()
  }),
  looseObject({
    kind: literal("safety-checks"),
    scope: text2,
    since: text2
  }),
  looseObject({
    kind: literal("unknown"),
    since: text2,
    slot: text2.exactOptional()
  })
]);
var discardArchiveSchema = looseObject({
  ref: text2,
  head: sha,
  at: text2,
  prunedAt: text2.optional()
});
var crewFields = object({
  version: version2,
  id: string2().regex(FILE_ID, "a plain file name"),
  name: text2,
  sessionId: text2.nullable(),
  shortId: text2.nullable(),
  earlierSessions: array(looseObject({ sessionId: text2, shortId: text2 })).optional(),
  sessionEndedAt: exports_iso.datetime().optional(),
  leadSessionId: text2,
  leadName: text2,
  repo: text2,
  plan: text2,
  phase: text2,
  slug: text2,
  kind: word(),
  model: looseObject({
    named: text2,
    slot: text2.nullable(),
    resolved: text2,
    tier: text2.nullable()
  }),
  effort: text2,
  permissionMode: text2,
  worktree: text2,
  released: object({ at: text2 }).optional(),
  branch: text2,
  baseRef: text2,
  baseCommit: sha.optional(),
  base: looseObject({ ref: text2, sha }).nullable(),
  waitsFor: array(text2),
  files: array(text2),
  questions: array(crewQuestion),
  notes: array(looseObject({ text: text2, at: text2, deliveredAt: text2.nullable() })).optional(),
  state: word(),
  lastLine: string2().nullable(),
  reportPath: text2.nullable(),
  pr: number2().int().positive().nullable(),
  memoryMb: number2().min(0).nullable(),
  waitingFor: waitingForSchema.optional(),
  resumeClaim: looseObject({ at: text2, token: text2 }).optional(),
  pendingLaunch: looseObject({
    at: text2,
    effort: text2,
    model: looseObject({
      named: text2,
      slot: text2.nullable(),
      resolved: text2,
      tier: text2.nullable()
    }),
    why: text2
  }).optional(),
  lastPause: looseObject({ backoffMs: count, since: text2 }).optional(),
  lastApiError: looseObject({ at: text2, class: text2, text: string2() }).optional(),
  startedAt: text2.nullable().optional(),
  launchedAt: text2.optional(),
  resumeWaits: looseObject({ at: text2, answer: count.nullable() }).optional(),
  sweptFrom: text2.optional(),
  continues: text2.nullable().optional(),
  mergedBeforeRemoval: boolean2().optional(),
  mergedWhileStopped: boolean2().optional(),
  stoppedByWatch: boolean2().optional(),
  mergeProof: looseObject({ head: sha, leadRef: text2, leadCommit: sha }).optional(),
  archive: discardArchiveSchema.optional(),
  archiveHistory: array(discardArchiveSchema).optional(),
  discardPending: looseObject({
    head: sha,
    archivedHead: sha,
    indexPath: text2,
    indexBackup: text2,
    indexArchived: text2
  }).optional(),
  planFile: text2.nullable().optional(),
  briefSource: looseObject({ path: string2().nullable(), sha256: text2 }).optional(),
  issue: looseObject({ author: text2, number: number2().int().positive(), repo: text2, url: text2 }).optional(),
  createdAt: text2,
  updatedAt: text2
});
var crewRecordSchema = crewFields.loose();
function crewSessions(record2) {
  const shortId = record2.shortId ?? record2.sessionId?.slice(0, 8) ?? null;
  const current = shortId === null ? [] : [{ sessionId: record2.sessionId, shortId }];
  const earlier = [...record2.earlierSessions ?? []].reverse();
  return [...current, ...earlier.filter((one) => one.sessionId !== record2.sessionId)].map((one) => ({ sessionId: one.sessionId, shortId: one.shortId }));
}
var leadFields = object({
  version: version2,
  sessionId: string2().regex(FILE_ID, "a plain file name"),
  name: text2,
  repo: text2,
  plan: text2,
  tag: text2,
  cwd: text2,
  planFile: text2.nullable().optional(),
  earlierSessions: array(object({ sessionId: text2, shortId: text2 })).optional(),
  adoptedBy: text2.optional(),
  adoptedAt: text2.optional(),
  generation: count.optional(),
  endedAt: text2.nullable().optional(),
  sessionUnknownSince: text2.nullable().optional(),
  pausedAgents: array(text2).optional(),
  createdAt: text2,
  updatedAt: text2
});
var leadRecordSchema = leadFields.loose();
var eventFields = object({
  version: version2,
  at: text2,
  type: word(),
  crew: string2().regex(FILE_ID, "a plain file name"),
  name: text2,
  lead: text2.nullable(),
  state: word(),
  text: string2().nullable(),
  sha: sha.nullable().optional(),
  note: string2().nullable().optional(),
  question: number2().int().min(1).optional(),
  memoryMb: number2().min(0).nullable().optional(),
  pair: text2.optional(),
  tell: looseObject({ kind: text2, to: array(text2) }).nullable().optional()
});
var crewEventSchema = eventFields.loose();
var testRun = looseObject({ command: text2, passed: count, failed: count, ok: boolean2() });
var reportFields = object({
  version: version2,
  status: word(),
  phase: text2,
  branch: looseObject({ name: text2, sha }),
  base: looseObject({ ref: text2, sha }),
  pr: number2().int().positive().nullable(),
  changed: looseObject({ files: count, insertions: count, deletions: count }),
  outsideBrief: array(text2),
  tests: looseObject({ targeted: array(testRun), full: testRun.nullable() }),
  checks: array(looseObject({ name: text2, ok: boolean2(), note: string2().nullable() })),
  review: looseObject({
    agent: text2,
    model: text2,
    effort: text2,
    sha,
    findings: array(looseObject({ finding: text2, fix: text2 }))
  }).nullable(),
  ownReview: looseObject({
    reason: text2,
    findings: array(looseObject({ finding: text2, fix: text2 }))
  }).nullable().optional(),
  docs: array(text2),
  issues: array(number2().int().positive()).optional(),
  needsLead: array(text2),
  open: array(text2),
  question: text2.nullable(),
  summary: text2.nullable().optional(),
  extra: record(string2(), unknown()).optional()
});
var handBackReportSchema = reportFields.loose().superRefine((report, context) => {
  if (report.status === "blocked" && report.question === null) {
    context.addIssue({
      code: "custom",
      message: "a blocked report names the question it waits on",
      path: ["question"]
    });
  }
});
function iso(atMs) {
  return new Date(atMs).toISOString();
}
function notThere(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function checked(schema, value, file) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CrewStoreError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}
function readRecord(schema, file) {
  let raw;
  try {
    raw = readFileSync10(file, "utf8");
  } catch (error) {
    if (notThere(error))
      return null;
    throw new CrewStoreError(`Cannot read ${file}: ${reasonOf(error)}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CrewStoreError(`Invalid ${file}: not valid JSON (${reasonOf(error)})`);
  }
  return checked(schema, value, file);
}
function listRecords(schema, folder) {
  const listed = { broken: [], records: [] };
  if (!existsSync7(folder))
    return listed;
  const found = [];
  for (const name of readdirSync6(folder).sort()) {
    if (!RECORD_FILE.test(name))
      continue;
    const file = join12(folder, name);
    try {
      const record2 = readRecord(schema, file);
      if (record2 !== null)
        found.push({ file, record: record2 });
    } catch (error) {
      listed.broken.push({ file, why: reasonOf(error) });
    }
  }
  found.sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt) || a.file.localeCompare(b.file));
  listed.records = found.map((one) => one.record);
  return listed;
}
function writeStoreFile(file, text) {
  mkdirSync5(dirname5(file), { mode: 448, recursive: true });
  atomicWrite(file, text, 384);
}
function writeJsonFile(file, value) {
  writeStoreFile(file, `${JSON.stringify(value, null, 2)}
`);
}
function appendEvent(stateDir, repo, event) {
  const file = crewEventsFile(stateDir, repo);
  const line = checked(crewEventSchema, event, file);
  mkdirSync5(dirname5(file), { mode: 448, recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}
`, { mode: 384 });
}
var reportRunFailure = (line) => {
  process.stderr.write(`${line}
`);
};
function recordRunOf(change) {
  try {
    recordRun(change);
  } catch (error) {
    reportRunFailure(`crew: the run record of ${change.after.name} was not written: ${reasonOf(error)}`);
  }
}
async function underStoreLock(stateDir, repo, write) {
  const folder = crewStoreDir(stateDir, repo);
  mkdirSync5(folder, { mode: 448, recursive: true });
  return await withLock(folder, write, { waitMs: STORE_LOCK_WAIT_MS });
}
function readCrew(stateDir, repo, id) {
  return readRecord(crewRecordSchema, crewFile(stateDir, repo, id));
}
function listCrew(stateDir, repo) {
  return listRecords(crewRecordSchema, join12(crewStoreDir(stateDir, repo), "crew"));
}
function listAllRecords(schema, stateDir, folder, tie) {
  const root = crewRootDir(stateDir);
  const all = { broken: [], records: [] };
  if (!existsSync7(root))
    return all;
  for (const key of readdirSync6(root).sort()) {
    const one = listRecords(schema, join12(root, key, folder));
    all.broken.push(...one.broken);
    all.records.push(...one.records);
  }
  all.records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || tie(a).localeCompare(tie(b)));
  return all;
}
function listAllCrew(stateDir) {
  return listAllRecords(crewRecordSchema, stateDir, "crew", (one) => one.id);
}
async function updateCrew(stateDir, repo, id, change, atMs, text = null, memoryMb = null, by = null) {
  const { record: record2 } = await changeCrew(stateDir, repo, id, atMs, (before, at) => ({
    change,
    event: (after) => after.state === before.state ? null : eventOf(after, at, "state", text, memoryMb)
  }), by);
  return record2;
}
async function updateCrewIfState(stateDir, repo, id, states, change, atMs, text = null, by = null) {
  return await changeCrew(stateDir, repo, id, atMs, (before, at) => {
    if (!states.includes(before.state))
      return null;
    return {
      change,
      event: (after) => after.state === before.state ? null : eventOf(after, at, "state", text)
    };
  }, by);
}
function eventOf(crew, at, type, text, memoryMb = null) {
  return {
    at,
    lead: crew.leadSessionId,
    ...memoryMb === null ? {} : { memoryMb },
    name: crew.name,
    state: crew.state,
    text,
    type,
    version: CREW_STORE_VERSION,
    crew: crew.id
  };
}
function dropStateFacts(record2) {
  if (record2.state !== "stopped") {
    delete record2.stoppedByWatch;
    delete record2.sweptFrom;
  }
  if (NO_RESUME_STATES.includes(record2.state))
    delete record2.resumeWaits;
}
async function changeCrew(stateDir, repo, id, atMs, plan, by = null) {
  const file = crewFile(stateDir, repo, id);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(crewRecordSchema, file);
    if (before === null) {
      throw new CrewStoreError(`no crew session "${id}" is recorded for ${repo} (${file})`);
    }
    const at = iso(atMs);
    const planned = plan(before, at);
    if (planned === null)
      return { changed: false, record: before };
    const { change, event } = planned;
    const merged = {
      ...before,
      ...change,
      createdAt: before.createdAt,
      id: before.id,
      repo: before.repo,
      updatedAt: at,
      version: Math.max(before.version, CREW_STORE_VERSION)
    };
    if (merged.state !== "paused")
      delete merged.waitingFor;
    if (merged.state === "working" && before.state !== "working") {
      delete merged.lastApiError;
      delete merged.sessionEndedAt;
    }
    if (merged.state !== before.state)
      delete merged.resumeClaim;
    if (merged.state === "removed") {
      merged.mergedBeforeRemoval = before.state === "merged" || before.mergedBeforeRemoval === true;
    }
    if (merged.state === "merged" && before.state === "stopped") {
      merged.mergedWhileStopped = before.stoppedByWatch !== true;
    }
    dropStateFacts(merged);
    if (before.sessionId !== null && merged.sessionId !== before.sessionId) {
      const kept = before.earlierSessions ?? [];
      if (!kept.some((one) => one.sessionId === before.sessionId)) {
        merged.earlierSessions = [
          ...kept,
          { sessionId: before.sessionId, shortId: before.shortId ?? before.sessionId.slice(0, 8) }
        ];
      }
    }
    const after = checked(crewRecordSchema, merged, file);
    writeJsonFile(file, after);
    const line = event(after);
    if (line !== null)
      appendEvent(stateDir, repo, line);
    if (after.state !== before.state) {
      if (after.state === "merged") {
        closePhaseTask(stateDir, after, "done", `merged into ${after.mergeProof?.leadRef ?? after.baseRef}`, atMs, reportRunFailure);
      } else if (after.state === "removed" || after.state === "discarded") {
        closePhaseTask(stateDir, after, "dropped", line?.text ?? after.state, atMs, reportRunFailure);
      }
    }
    recordRunOf({ after, at, before, by: by ?? undefined, event: line });
    return { changed: true, record: after };
  });
}
function readLead(stateDir, repo, sessionId) {
  return readRecord(leadRecordSchema, leadFile(stateDir, repo, sessionId));
}
function listLeads(stateDir, repo) {
  return listRecords(leadRecordSchema, join12(crewStoreDir(stateDir, repo), "leads"));
}
async function setLeadPresence(stateDir, repo, sessionId, known, atMs) {
  const file = leadFile(stateDir, repo, sessionId);
  const unchanged = (before) => known ? (before.sessionUnknownSince ?? null) === null : before.sessionUnknownSince !== undefined && before.sessionUnknownSince !== null;
  const seen = readRecord(leadRecordSchema, file);
  if (seen === null)
    return null;
  if (unchanged(seen))
    return seen;
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(leadRecordSchema, file);
    if (before === null)
      return null;
    if (unchanged(before))
      return before;
    const since = known ? null : iso(atMs);
    const after = checked(leadRecordSchema, { ...before, sessionUnknownSince: since }, file);
    writeJsonFile(file, after);
    return after;
  });
}
async function appendCrewEvent(stateDir, repo, event, atMs) {
  const line = { version: CREW_STORE_VERSION, at: iso(atMs), ...event };
  await underStoreLock(stateDir, repo, () => appendEvent(stateDir, repo, line));
  return line;
}
var RESUME_CLAIM_MS = 2 * 60000;
function resumeClaimHeld(claim, atMs) {
  if (claim === undefined)
    return false;
  const since = Date.parse(claim.at);
  return Number.isFinite(since) && atMs - since < RESUME_CLAIM_MS;
}
var watchStateFields = object({
  fyi: object({ dropped: count, kept: array(string2()).optional(), lines: array(string2()) }).optional(),
  summarizedGeneration: count.optional(),
  missingSince: record(string2(), number2()).optional(),
  removals: record(string2(), object({ at: number2(), signature: string2() })).optional(),
  parkedAt: number2().int().min(0).optional(),
  noted: boolean2().optional(),
  offset: count,
  said: record(string2(), string2()),
  resumedAt: number2().int().min(0).optional(),
  routerRequests: number2().int().min(0).nullable().optional(),
  stoppedRemindedAt: record(string2(), number2().int().min(0)).optional()
});
function watchLeaseFile(stateDir, repo, leadSessionId) {
  return join12(crewStoreDir(stateDir, repo), "watch-lease", `${fileId(leadSessionId, "session id")}.json`);
}
var watchLeaseFields = object({
  at: number2().int().min(0),
  host: string2(),
  once: boolean2().optional(),
  pid: number2().int().positive(),
  pidns: string2().nullable().default(null),
  startTime: string2().nullable(),
  token: text2
});
function readWatchLease(stateDir, repo, leadSessionId) {
  let raw;
  try {
    raw = readFileSync10(watchLeaseFile(stateDir, repo, leadSessionId), "utf8");
  } catch (error) {
    if (notThere(error))
      return null;
    throw error;
  }
  try {
    const parsed = watchLeaseFields.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function watchIsAlive(stateDir, repo, leadSessionId) {
  let lease;
  try {
    lease = readWatchLease(stateDir, repo, leadSessionId);
  } catch {
    return false;
  }
  return lease !== null && !holderIsGone(lease, lease.at, FALLBACK_STALE_MS);
}
var WATCH_LEASE_REFRESH_MS = FALLBACK_STALE_MS / 5;
var notesStateFields = object({ offset: count });
var stopStateFields = object({
  last: _enum(["report", "step"]).nullable(),
  offset: count
});
var selfWatchStateFields = object({ at: number2().int().min(0), kind: text2 });
var answerWatchFields = object({ at: number2().int().min(0) });
var feedCursor = object({
  etag: string2().nullable(),
  top: count
});
var issueFeedFields = object({
  comments: feedCursor.nullable(),
  issues: feedCursor.nullable(),
  nextAt: count,
  problem: string2().nullable(),
  source: string2().min(1),
  version: literal(1)
});

// src/hooks/detached.ts
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
function windowsRun(argv) {
  return cmdLine("", argv);
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

// src/worktrees/auto-state.ts
import { createHash as createHash2 } from "crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync11 } from "fs";
import { dirname as dirname6, join as join13 } from "path";
var AUTO_CLEAN_TRIGGERS = ["merge", "session"];
var AUTO_CLEAN_INTERVAL_MS = 60 * 60 * 1000;
var removedSchema = object({
  branch: string2().nullable(),
  name: string2(),
  path: string2(),
  why: string2()
});
var keptSchema = object({ name: string2(), path: string2(), why: string2() });
var recordSchema = object({
  base: string2(),
  kept: array(keptSchema),
  lastRunAt: number2(),
  removed: array(removedSchema),
  repo: string2(),
  seq: number2()
});
var toldSchema = object({ seq: number2() });
function autoCleanLog(stateDir) {
  return join13(stateDir, "worktrees-auto-clean.log");
}
function autoCleanFiles(stateDir, repo) {
  const key = createHash2("sha256").update(pathForm(repo)).digest("hex").slice(0, 16);
  const dir = join13(stateDir, "worktrees-auto-clean");
  return {
    log: autoCleanLog(stateDir),
    result: join13(dir, `${key}.json`),
    told: join13(dir, `${key}.told.json`)
  };
}
function readJson(file, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync11(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeJson(file, value) {
  mkdirSync6(dirname6(file), { recursive: true, mode: 448 });
  atomicWrite(file, `${JSON.stringify(value, null, 2)}
`, 384);
}
function readRepoRecord(files) {
  return readJson(files.result, recordSchema);
}
function readTold(files) {
  return readJson(files.told, toldSchema)?.seq ?? 0;
}
function hourlyDue(record, nowMs) {
  if (record === null)
    return true;
  return nowMs - record.lastRunAt >= AUTO_CLEAN_INTERVAL_MS || record.lastRunAt > nowMs + 60000;
}
function recordRun2(files, repo, run) {
  const before = readRepoRecord(files);
  const told = readTold(files);
  const unchanged = { removed: before?.removed ?? [], seq: before?.seq ?? 0 };
  const removals = run.removed.length === 0 ? unchanged : {
    removed: [
      ...before !== null && before.seq > told ? before.removed : [],
      ...run.removed
    ],
    seq: Math.max(before?.seq ?? 0, told) + 1
  };
  writeJson(files.result, {
    base: run.base,
    kept: run.kept,
    lastRunAt: run.now,
    repo,
    ...removals
  });
}
function recordStart(files, repo, nowMs) {
  const before = readRepoRecord(files);
  writeJson(files.result, before === null ? { base: "", kept: [], lastRunAt: nowMs, removed: [], repo, seq: 0 } : { ...before, lastRunAt: nowMs });
}

// src/worktrees/clean.ts
import { basename as basename4 } from "path";

// src/machine/hold-port.ts
import { createServer } from "net";
function codeOf(error) {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown error";
}
function holdPort(port) {
  return new Promise((done) => {
    const server = createServer((socket) => {
      socket.destroy();
    });
    server.once("error", (error) => {
      const code = codeOf(error);
      done(code === "EADDRINUSE" ? { taken: true } : { error: code });
    });
    server.listen({ exclusive: true, host: "127.0.0.1", port }, () => {
      done({ held: server });
    });
  });
}

// src/ports.ts
var LOCK_PORTS = {
  worktreesClean: 27641
};

// src/worktrees/clean.ts
async function holdCleanLock() {
  const hold = await holdPort(LOCK_PORTS.worktreesClean);
  return "held" in hold ? hold.held : null;
}
function canGo(worktree) {
  return worktree.state === "gone" || typeof worktree.state === "object" && worktree.state.finished;
}
function whyFinished(worktree, base) {
  const { state } = worktree;
  if (typeof state === "object" && state.finished && state.note !== null)
    return state.note;
  return `every commit is on ${base}`;
}
function cleanFinished(repo, scanned, judged, say, skip) {
  const going = scanned.filter((one) => canGo(one) && (skip === undefined || !skip(one)));
  const removed = [];
  const kept = [];
  const failed = [];
  for (const worktree of going) {
    if (worktree.state === "gone")
      continue;
    say(`removing ${worktree.listed.path} \u2026`);
    const removal = removeWorktree(repo, worktree.listed, judged);
    for (const said of removal.said)
      say(`  ${said}`);
    const name = basename4(worktree.listed.path);
    if (removal.status === "removed") {
      removed.push({
        branch: worktree.listed.branch,
        name,
        path: worktree.listed.path,
        why: whyFinished(worktree, judged.against?.label ?? judged.base)
      });
    } else if (removal.status === "failed") {
      failed.push({
        name,
        path: worktree.listed.path,
        why: removal.said[0] ?? removal.status
      });
    } else {
      const prefix = `kept ${worktree.listed.path}: `;
      const said = removal.said[0] ?? removal.status;
      kept.push({
        name,
        path: worktree.listed.path,
        why: said.startsWith(prefix) ? said.slice(prefix.length) : said
      });
    }
  }
  pruneWorktrees(repo, judged.env);
  const forgotten = [];
  for (const worktree of going) {
    if (worktree.state !== "gone")
      continue;
    forgotten.push(worktree.listed.path);
    say(forgottenLine(worktree.listed.path));
    if (worktree.listed.branch !== null) {
      say(`  ${deleteMergedBranch(repo, judged.base, worktree.listed.branch, judged.env)}`);
    }
  }
  for (const worktree of scanned) {
    const { state } = worktree;
    if (typeof state === "object" && !state.finished) {
      kept.push({
        name: basename4(worktree.listed.path),
        path: worktree.listed.path,
        why: state.why
      });
    }
  }
  return { failed, forgotten, kept, removed };
}

// src/worktrees/crew-clean.ts
import { basename as basename5 } from "path";

// src/crew/claude.ts
import { readFileSync as readFileSync12, statSync as statSync6 } from "fs";
import { join as join14 } from "path";

// src/mcp/task-server-name.ts
var TASKS_SERVER_NAME = `${COMMAND}-tasks`;

// src/crew/claude.ts
var CLAUDE_TIMEOUT_MS = 30000;
var realRunProgram = (argv, options) => {
  try {
    const result = Bun.spawnSync(argv, {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatim
    });
    return {
      error: null,
      exitCode: result.signalCode ? null : result.exitCode,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
      timedOut: result.exitedDueToTimeout === true
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
      stderr: "",
      stdout: "",
      timedOut: false
    };
  }
};
function isFile(path) {
  try {
    return statSync6(path).isFile();
  } catch {
    return false;
  }
}
function fallbackNames(platform) {
  return platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
}
function findClaude(deps) {
  const onPath = deps.which("claude");
  if (onPath !== null)
    return onPath;
  for (const name of fallbackNames(deps.platform)) {
    const path = join14(deps.home, ".local", "bin", name);
    if (isFile(path))
      return path;
  }
  return null;
}
function claudeArgv(binary, args, platform) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(binary)) {
    return { argv: [binary, ...args], verbatim: false };
  }
  const line = windowsRun([binary, ...args]);
  if (!line.ok)
    return { why: `cmd.exe cannot carry "${line.argument}": ${line.reason}` };
  return { argv: line.argv, verbatim: true };
}
function callClaude(deps, binary, args, cwd, timeoutMs = CLAUDE_TIMEOUT_MS) {
  const command = claudeArgv(binary, args, deps.platform);
  if ("why" in command)
    return { ok: false, why: command.why };
  const run = deps.runProgram(command.argv, {
    cwd,
    env: deps.env,
    timeoutMs,
    windowsVerbatim: command.verbatim
  });
  if (run.error !== null)
    return { ok: false, why: `${binary} did not start: ${run.error}` };
  return { ok: true, run };
}
function textField(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function parseAgents(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed))
    return null;
  return parsed.filter((row) => typeof row === "object" && row !== null).map((row) => ({
    cwd: textField(row.cwd),
    id: textField(row.id),
    pid: typeof row.pid === "number" ? row.pid : null,
    sessionId: textField(row.sessionId),
    state: textField(row.state),
    status: textField(row.status),
    waitingFor: textField(row.waitingFor)
  }));
}
function parseAgentPresence(output) {
  const rows = parseAgents(output);
  if (rows === null)
    return null;
  const raw = JSON.parse(output);
  return Array.isArray(raw) && rows.length === raw.length && rows.every((row) => row.id !== null || row.sessionId !== null) ? rows : null;
}
function agentRow(rows, shortId) {
  return rows.find((row) => row.id === shortId) ?? rows.find((row) => row.sessionId?.startsWith(shortId) === true) ?? null;
}

// src/crew/agents.ts
function claudeDeps(ctx) {
  return {
    env: ctx.env,
    home: ctx.paths.home,
    platform: ctx.platform,
    runProgram: ctx.runProgram,
    which: ctx.which
  };
}
function agentRows(ctx) {
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null)
    return null;
  const called = callClaude(claudeDeps(ctx), claude, ["agents", "--json", "--all"], ctx.cwd);
  if (!called.ok || called.run.exitCode !== 0)
    return null;
  return parseAgentPresence(called.run.stdout);
}
function rowOf(rows, record) {
  if (record.shortId !== null) {
    const byShort = rows.find((row) => row.id === record.shortId);
    if (byShort !== undefined)
      return byShort;
  }
  if (record.sessionId !== null) {
    const bySession = rows.find((row) => row.sessionId === record.sessionId);
    if (bySession !== undefined)
      return bySession;
  }
  return null;
}
function isLiveRow(row) {
  return row !== null && row.pid !== null && row.state !== "stopped" && row.state !== "failed";
}

// src/crew/context.ts
import { randomBytes } from "crypto";

// src/jobs/memory.ts
import { readFileSync as readFileSync13 } from "fs";
import { freemem, totalmem } from "os";
var GIB = 1024 ** 3;
var realReadText = (path) => {
  try {
    return readFileSync13(path, "utf8");
  } catch {
    return null;
  }
};
function realMemoryFacts() {
  return { platform: process.platform, read: realReadText, totalmem, freemem };
}
function meminfoBytes(meminfo, field) {
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB\\s*$`, "m").exec(meminfo);
  return match === null ? null : Number(match[1]) * 1024;
}
function cgroupNumber(text) {
  if (text === null)
    return null;
  const value = text.trim();
  if (!/^\d+$/.test(value))
    return null;
  const number = Number(value);
  return number >= 2 ** 60 ? null : number;
}
function statField(stat, key) {
  if (stat === null)
    return 0;
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(stat);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}
function ownCgroup(procSelfCgroup) {
  for (const line of procSelfCgroup.split(`
`)) {
    const [, controllers, path] = line.split(":");
    if (path === undefined || !path.startsWith("/"))
      continue;
    if (line.startsWith("0::"))
      return { version: 2, path };
    if (controllers?.split(",").includes("memory"))
      return { version: 1, path };
  }
  return null;
}
function upwards(root, path) {
  const parts = path.split("/").filter((part) => part !== "");
  const dirs = [];
  for (let i = parts.length;i >= 0; i--) {
    dirs.push([root, ...parts.slice(0, i)].join("/"));
  }
  return dirs;
}
function cgroupLimit(read) {
  const own = ownCgroup(read("/proc/self/cgroup") ?? "");
  if (own === null)
    return null;
  const root = own.version === 2 ? "/sys/fs/cgroup" : "/sys/fs/cgroup/memory";
  const limitFile = own.version === 2 ? "memory.max" : "memory.limit_in_bytes";
  const usageFile = own.version === 2 ? "memory.current" : "memory.usage_in_bytes";
  const cacheKey = own.version === 2 ? "inactive_file" : "total_inactive_file";
  let best = null;
  for (const dir of upwards(root, own.path)) {
    const limit = cgroupNumber(read(`${dir}/${limitFile}`));
    if (limit === null || best !== null && limit >= best.limitBytes)
      continue;
    const usage = cgroupNumber(read(`${dir}/${usageFile}`));
    const cache = statField(read(`${dir}/memory.stat`), cacheKey);
    const usedBytes = usage === null ? limit : Math.max(0, usage - cache);
    best = { limitBytes: limit, usedBytes, dir };
  }
  return best;
}
function machineMemory(facts) {
  if (facts.platform === "win32") {
    return { totalBytes: facts.totalmem(), availableBytes: facts.freemem(), limit: null };
  }
  if (facts.platform !== "linux") {
    return { totalBytes: facts.totalmem(), availableBytes: null, limit: null };
  }
  const meminfo = facts.read("/proc/meminfo");
  const memTotal = meminfo === null ? null : meminfoBytes(meminfo, "MemTotal");
  const memAvailable = meminfo === null ? null : meminfoBytes(meminfo, "MemAvailable");
  const total = memTotal ?? facts.totalmem();
  const limit = cgroupLimit(facts.read);
  if (limit === null || limit.limitBytes >= total) {
    return { totalBytes: total, availableBytes: memAvailable, limit: null };
  }
  const inGroup = Math.max(0, limit.limitBytes - limit.usedBytes);
  return {
    totalBytes: limit.limitBytes,
    availableBytes: memAvailable === null ? inGroup : Math.min(memAvailable, inGroup),
    limit
  };
}

// src/machine/load.ts
import { availableParallelism, loadavg } from "os";
function realLoadFacts() {
  return { cores: availableParallelism, loadavg, platform: process.platform };
}
function machineLoad(facts) {
  if (facts.platform === "win32")
    return null;
  const oneMinute = facts.loadavg()[0];
  const cores = facts.cores();
  if (oneMinute === undefined || !Number.isFinite(oneMinute) || !(cores >= 1))
    return null;
  return { cores, oneMinute };
}

// src/setup/installed-plugins.ts
import { existsSync as existsSync8, readFileSync as readFileSync14 } from "fs";
function pluginsRecord(installedPluginsFile) {
  if (!existsSync8(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync14(installedPluginsFile, "utf8"));
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

// src/jobs/config.ts
import { isAbsolute, join as join15 } from "path";
var absolutePath = string2().min(1).refine((path) => isAbsolute(path), "must be an absolute path");
var MAX_WEIGHT = 1e4;
var weightSchema = union([
  literal(0),
  literal("off"),
  number2().int().min(1).max(MAX_WEIGHT)
]);
var jobsMachineConfigSchema = strictObject({
  stateDir: absolutePath.optional(),
  maxJobs: number2().int().min(1).optional(),
  lightJobs: number2().int().min(1).optional(),
  startFreeGb: number2().min(0).optional(),
  budgetGb: number2().int().min(1).optional(),
  reserveGb: number2().int().min(0).optional(),
  sharedDirs: array(absolutePath).optional(),
  launch: _enum(["auto", "plain"]).optional(),
  slice: string2().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*\.slice$/, "must be a slice name like name.slice").optional(),
  cpuWeight: union([weightSchema, literal("idle")]).optional(),
  ioWeight: weightSchema.optional()
});

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

// src/update/state.ts
import {
  appendFileSync as appendFileSync2,
  existsSync as existsSync9,
  mkdirSync as mkdirSync7,
  readdirSync as readdirSync7,
  readFileSync as readFileSync15,
  rmSync as rmSync2,
  statSync as statSync7,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join16 } from "path";
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;
function ensureDir(dir) {
  mkdirSync7(dir, { recursive: true, mode: 448 });
}
function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function appendLogLine(logFile, line, nowMs) {
  ensureDir(join16(logFile, ".."));
  try {
    if (statSync7(logFile).size > LOG_MAX_BYTES) {
      const text = readFileSync15(logFile, "utf8");
      const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
      writeFileSync2(logFile, keep.slice(keep.indexOf(`
`) + 1), { mode: 384 });
    }
  } catch {}
  appendFileSync2(logFile, `${isoSeconds(nowMs)} ${line}
`, { mode: 384 });
}

// src/cli/usage-window.ts
var WINDOW_SPAN_MS = 5 * 60 * 60000;
var storedSchema = looseObject({
  fiveHour: object({ percent: number2(), resetsAt: number2().nullable() }),
  readAt: string2()
});

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

// src/gateway/settings.ts
function gatewayEnv(port) {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: routerBaseUrl(port)
  };
}
function routerBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}
var REMOTE_CONTROL_HOST = new URL(DEFAULT_ANTHROPIC_BASE_URL).host;
var RETIRED_GATEWAY_ENV_KEYS = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"
];
var GATEWAY_ENV_KEYS = Object.keys(gatewayEnv(20100));
var GATEWAY_ENV_KEYS_ALL = [...GATEWAY_ENV_KEYS, ...RETIRED_GATEWAY_ENV_KEYS];

// src/gateway/project-state.ts
var PERSONAL_FILE = "settings.local.json";
var PERSONAL_EXCLUDE_LINE = `/.claude/${PERSONAL_FILE}`;

// src/models/launch-policy.ts
var ALLOWED_EFFORTS = ["medium", "high", "xhigh", "max"];
var OPUS_ASK_EFFORT = "max";
var OPUS_FREE_EFFORTS = ALLOWED_EFFORTS.filter((one) => one !== OPUS_ASK_EFFORT);
var UI_POLICY = {
  minEffort: "high",
  tiers: ["opus", "fable"]
};
function uiEffortAllowed(effort) {
  if (effort === null)
    return false;
  const levels = ALLOWED_EFFORTS;
  return levels.indexOf(effort.toLowerCase()) >= levels.indexOf(UI_POLICY.minEffort);
}
var UI_EFFORTS = ALLOWED_EFFORTS.filter((one) => uiEffortAllowed(one));
var EFFORT_AUTO = "auto";
var CREW_KINDS = {
  build: { about: "routine building", effort: "high", model: "sonnet" },
  docs: {
    about: "docs and their updates",
    effort: "high",
    model: "sonnet"
  },
  tests: { about: "tests and test runs", effort: "high", model: "sonnet" },
  security: {
    about: "code that touches security",
    effort: "high",
    model: "sonnet"
  },
  money: {
    about: "code that touches money",
    effort: "high",
    model: "sonnet"
  },
  permissions: {
    about: "code that touches permissions",
    effort: "high",
    model: "sonnet"
  },
  schema: {
    about: "a schema or a contract",
    effort: "high",
    model: "sonnet"
  },
  deploy: { about: "deploy plumbing", effort: "high", model: "sonnet" },
  architecture: {
    about: "architecture and design",
    effort: "xhigh",
    model: "opus"
  },
  ui: {
    about: "UI and UX judgment",
    effort: UI_POLICY.minEffort,
    model: UI_POLICY.tiers[0]
  }
};
var CREW_KIND_NAMES = Object.keys(CREW_KINDS);

// src/hooks/agent-guard-workflows.ts
var FAIL = Symbol("not a pure literal");

// src/hooks/agent-launches.ts
var SESSION_EFFORT = "session-effort";
var REASON_EFFORTS = [...ALLOWED_EFFORTS, EFFORT_AUTO, SESSION_EFFORT];
var RECORD_TAIL_BYTES = 64 * 1024;

// src/hooks/transcript.ts
var TRANSCRIPT_TAIL_BYTES = 512 * 1024;

// src/hooks/agent-guard.ts
function agentKey(type) {
  const base = type.includes(":") ? type.split(":").pop() ?? type : type;
  return base.trim().toLowerCase().replace(/[\s_-]+/g, "-");
}
var READ_ONLY_BUILT_INS = [
  "Explore",
  "Plan",
  "claude-code-guide",
  "statusline-setup"
];
var READ_ONLY_KIT_AGENTS = ["reviewer", "auditor", "ui-verifier"];
var READ_ONLY_BUILT_IN_KEYS = new Set(READ_ONLY_BUILT_INS.map(agentKey));
var READ_ONLY_KIT_KEYS = new Set(READ_ONLY_KIT_AGENTS.map((one) => `${PLUGIN}:${one}`.toLowerCase()));
var READ_ONLY_WORKFLOWS = [
  `${PLUGIN}:audit-run`,
  `${PLUGIN}:review-split`,
  `${PLUGIN}:research-sweep`
];
var READ_ONLY_WORKFLOW_KEYS = new Set(READ_ONLY_WORKFLOWS.map((one) => one.toLowerCase()));
var THROUGH_A_VARIABLE = "A launch made through a variable runs inside the tool and never reaches a hook, so the guard cannot read the model and effort it will run on.";
var HANDED_AROUND = {
  agent: [
    THROUGH_A_VARIABLE,
    'Write every launch as a direct `agent("<prompt>", { model: "\u2026", effort: "\u2026" })` call.'
  ].join(`
`),
  workflow: [
    THROUGH_A_VARIABLE,
    'Write every nested workflow as a direct `workflow("<name>")` call.'
  ].join(`
`)
};
var OPTIONS_BUILT_AT_RUNTIME = [
  "Its options are not what they seem: a `...spread`, a computed `[\u2026]` key, or the same option written twice (the last one wins at run time, while the guard reads the first). The model and effort it will really run on cannot be read.",
  "Write `model`, `effort` and `agentType` once each, as string literals in the call's own options object."
].join(`
`);
var NO_WORKFLOW_MODEL = [
  "This Workflow launch names no `model` the guard can read.",
  "An agent given none runs on the session's model and effort, which nobody chose \u2014 and a `model` held in a variable is not visible to a hook.",
  "Write `model` and `effort` as string literals in the `agent(...)` options."
].join(`
`);
var NO_MODEL = [
  "This Agent launch names no `model`.",
  "An agent given none runs on the session's model and effort, which nobody chose: pass `model` and `effort` on every launch."
].join(`
`);
function levelsText(levels) {
  const named = levels.map((one) => `\`${one}\``);
  return named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}
var EFFORTS = levelsText(ALLOWED_EFFORTS);
var EFFORT_USE = "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).";
var NO_EFFORT = [
  "This Agent launch names no `effort`.",
  `An agent given none runs at the session's effort: pass \`effort\` on every launch, ${EFFORTS}.`,
  EFFORT_USE
].join(`
`);

// src/crew/places.ts
var RUNNING_STATES = [
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet"
];
function freeForCrewGb(memory) {
  const reading = machineMemory(memory);
  return reading.availableBytes === null ? null : reading.availableBytes / GIB;
}

// src/crew/context.ts
function stdoutPrinter(stream) {
  let failed = false;
  stream.on("error", () => {
    failed = true;
  });
  return {
    closed: () => failed,
    print: (line) => {
      stream.write(`${line}
`, (error) => {
        if (error)
          failed = true;
      });
    }
  };
}
function realCrewContext(paths) {
  const env = process.env;
  const stdout = stdoutPrinter(process.stdout);
  return {
    cwd: process.cwd(),
    env,
    error: (line) => console.error(line),
    freeMemoryGb: () => Promise.resolve(freeForCrewGb(realMemoryFacts())),
    installedVersion: () => findUserInstall(paths.installedPluginsFile)?.version ?? null,
    load: () => machineLoad(realLoadFacts()),
    now: () => Date.now(),
    outputClosed: stdout.closed,
    parentPid: () => process.ppid,
    paths,
    pid: process.pid,
    platform: process.platform,
    print: stdout.print,
    processes: realProcessFacts(process.platform),
    randomSuffix: () => randomBytes(3).toString("hex"),
    readStdin: () => Bun.stdin.text(),
    runProgram: realRunProgram,
    sleep: (ms) => Bun.sleep(ms),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" })
  };
}

// src/crew/lifecycle.ts
var RELEASE_STATES = ["done", "handoff", "failed", "stopped", "merged"];
var STOPPED_REMINDER_MS = 24 * 60 * 60000;
function validMergeProof(record, ctx) {
  if (record.mergeProof === undefined)
    return false;
  const head = runGit(record.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`], ctx.env, GIT_TIMEOUT_MS);
  if (!head.ok || head.out !== record.mergeProof.head)
    return false;
  const commit = runGit(record.repo, ["cat-file", "-t", record.mergeProof.leadCommit], ctx.env, GIT_TIMEOUT_MS);
  if (!commit.ok || commit.out !== "commit")
    return false;
  const proofRef = `refs/crew-merge-proofs/${record.mergeProof.leadCommit}`;
  const saved = runGit(record.repo, ["update-ref", proofRef, record.mergeProof.leadCommit, ""], ctx.env, GIT_TIMEOUT_MS);
  if (saved.ok)
    return true;
  const existing = runGit(record.repo, ["rev-parse", "--verify", proofRef], ctx.env, GIT_TIMEOUT_MS);
  return existing.ok && existing.out === record.mergeProof.leadCommit;
}
function sessionSnapshot(ctx) {
  return ctx.sessions?.() ?? liveSessions(ctx.paths.claudeConfigDir);
}
function leadRunningReason(lead, rows, sessions, ctx) {
  const session = sessions.find((one) => one.sessionId === lead.sessionId);
  if (session !== undefined) {
    return sessionIdentityProved(session) ? {
      line: "a live session record has a proved identity",
      fix: "end that lead with crew lead --end in its session, then retry here"
    } : {
      line: `a session record for pid ${session.pid} has an unproved identity`,
      fix: `when that session is really gone, retry once pid ${session.pid} has ended, or after a restart`
    };
  }
  if (ctx.watchAlive?.(lead.repo, lead.sessionId) ?? watchIsAlive(ctx.paths.stateDir, lead.repo, lead.sessionId))
    return {
      line: "its watch holds the lease",
      fix: "stop that watch, or wait for it to end, then retry here"
    };
  if (rows === null)
    throw new Error("the agent view cannot be read; retry crew lead");
  return rowsOfLead(rows, lead).some((row) => isLiveRow(row)) ? {
    line: "the agent view lists it as live",
    fix: "stop it in the agent view or run crew lead --end in it, then retry here"
  } : null;
}
function leadRunning(lead, rows, sessions, ctx) {
  return leadRunningReason(lead, rows, sessions, ctx) !== null;
}
function rowsOfLead(rows, lead) {
  return rows.filter((row) => row.sessionId === lead.sessionId || row.id === lead.sessionId.slice(0, 8));
}
async function observeLeadPresence(stateDir, leads, rows, now, ctx) {
  if (rows === null)
    return [...leads];
  let sessions = [];
  try {
    sessions = sessionSnapshot(ctx);
  } catch {
    return [...leads];
  }
  const observed = [];
  for (const lead of leads) {
    const known = leadRunning(lead, rows, sessions, ctx);
    observed.push(await setLeadPresence(stateDir, lead.repo, lead.sessionId, known, now) ?? lead);
  }
  return observed;
}
function leadGone(lead, rows, now, ctx) {
  if (lead === null)
    return false;
  if (lead.endedAt != null)
    return true;
  try {
    if (leadRunning(lead, rows, sessionSnapshot(ctx), ctx))
      return false;
  } catch {
    return false;
  }
  const since = Date.parse(lead.sessionUnknownSince ?? "");
  return Number.isFinite(since) && now - since > STOPPED_REMINDER_MS;
}

// src/crew/remove.ts
import { existsSync as existsSync12, mkdirSync as mkdirSync9 } from "fs";
import { join as join19 } from "path";

// src/worktrees/include.ts
import { copyFileSync, existsSync as existsSync10, mkdirSync as mkdirSync8 } from "fs";
import { dirname as dirname7, join as join17 } from "path";
var INCLUDE_TIMEOUT_MS = 60000;
function copyWorktreeInclude(source, target, env) {
  const includeFile = join17(source, ".worktreeinclude");
  if (!existsSync10(includeFile))
    return [];
  const listed = runGit(source, ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${includeFile}`], env, INCLUDE_TIMEOUT_MS);
  if (!listed.ok || listed.out === "")
    return [];
  const candidates = listed.out.split("\x00").filter((path) => path !== "");
  const ignored = Bun.spawnSync(["git", "check-ignore", "-z", "--stdin"], {
    cwd: source,
    env: gitEnv(env),
    stdin: Buffer.from(`${candidates.join("\x00")}\x00`),
    stdout: "pipe",
    stderr: "pipe",
    timeout: INCLUDE_TIMEOUT_MS,
    windowsHide: true
  });
  const copied = [];
  for (const path of ignored.stdout.toString().split("\x00")) {
    if (path === "" || existsSync10(join17(target, path)))
      continue;
    mkdirSync8(dirname7(join17(target, path)), { recursive: true });
    copyFileSync(join17(source, path), join17(target, path));
    copied.push(path);
  }
  return copied;
}

// src/worktrees/scan-parked.ts
import { existsSync as existsSync11, lstatSync as lstatSync3, readdirSync as readdirSync8, readFileSync as readFileSync16, rmSync as rmSync3 } from "fs";
import { dirname as dirname8, join as join18, relative } from "path";

// src/worktrees/verdict.ts
var MIN_MERGE_TREE_GIT = "2.38.0";
var IDLE_MINUTES = 60;
function verdict(facts, contents, idleLimit = IDLE_MINUTES) {
  if (facts.locked) {
    return { finished: false, held: false, why: "locked with `git worktree lock`" };
  }
  if (facts.sessionName !== null) {
    return {
      finished: false,
      held: true,
      why: `Claude session "${facts.sessionName}" works in it`
    };
  }
  if (facts.programs !== "unknown" && facts.programs.length > 0) {
    return { finished: false, held: true, why: programsWhy(facts.programs) };
  }
  if (facts.containers !== "unknown" && facts.containers.length > 0) {
    return { finished: false, held: true, why: containersWhy(facts.containers) };
  }
  if (facts.innerWorktree !== null) {
    return {
      finished: false,
      held: false,
      why: `another worktree lives inside it: ${facts.innerWorktree}`
    };
  }
  if (facts.aheadOfBase > 0 && facts.mergedBy === null && !facts.parked) {
    const commits = facts.aheadOfBase === 1 ? "1 commit" : `${String(facts.aheadOfBase)} commits`;
    const tooOld = facts.gitTooOld === null ? "" : ` (git ${facts.gitTooOld} is too old to replay it onto ${facts.base}: git ${MIN_MERGE_TREE_GIT} or newer is needed)`;
    return { finished: false, held: false, why: `${commits} not on ${facts.base}${tooOld}` };
  }
  if (facts.idleMinutes < idleLimit && !facts.parked) {
    return {
      finished: false,
      held: true,
      why: `git used it ${String(Math.floor(facts.idleMinutes))} min ago`
    };
  }
  if (facts.programs === "unknown") {
    return {
      finished: false,
      held: true,
      why: "the running programs could not be listed, so it is unknown whether one runs from its files"
    };
  }
  if (facts.containers === "unknown") {
    return {
      finished: false,
      held: true,
      why: "Docker did not answer, so it is unknown whether a container uses its files \u2014 start Docker and run again"
    };
  }
  const found = contents();
  if (found.uncommitted)
    return { finished: false, held: false, why: "uncommitted changes" };
  if (found.localFiles.length > 0) {
    const shown = found.localFiles.slice(0, 3).join(", ");
    const more = found.localFiles.length > 3 ? ` and ${String(found.localFiles.length - 3)} more` : "";
    return {
      finished: false,
      held: false,
      why: `local files git does not keep: ${shown}${more}`
    };
  }
  return { finished: true, note: mergedNote(facts) };
}
function mergedNote(facts) {
  if (facts.mergedBy === null)
    return null;
  if (facts.mergedBy === "cherry")
    return `every commit is on ${facts.base} under another sha`;
  if (facts.mergedBy === "replay")
    return `merging it into ${facts.base} changes nothing`;
  return "its pull request is merged";
}
function containersWhy(names) {
  const shown = names.slice(0, 3).map((name) => `"${name}"`).join(", ");
  if (names.length === 1)
    return `Docker container ${shown} uses its files`;
  const more = names.length > 3 ? ` and ${String(names.length - 3)} more` : "";
  return `Docker containers ${shown}${more} use its files`;
}
function programsWhy(names) {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${String(names.length - 3)} more` : "";
  return names.length === 1 ? `a program runs from its files: ${shown}` : `programs run from its files: ${shown}${more}`;
}

// src/worktrees/scan-parked.ts
function finishParked(repo, paths, options, say) {
  const pass = { kept: [], removed: [], said: [] };
  if (paths.length === 0)
    return pass;
  let scanned;
  try {
    scanned = scanWorktrees(repo, options);
  } catch (error) {
    const why = `it could not be judged: ${error instanceof Error ? error.message : String(error)}`;
    pass.kept.push(...paths.map((path) => ({ path, why })));
    return pass;
  }
  for (const worktree of scanned) {
    if (worktree.state === "main")
      continue;
    if (!paths.some((path) => samePath(path, worktree.listed.path)))
      continue;
    const shown = worktree.listed.path;
    if (worktree.state === "gone") {
      pruneWorktrees(repo, options.env);
      pass.removed.push(shown);
      const line = forgottenLine(shown);
      pass.said.push(line);
      say(line);
      continue;
    }
    if (!worktree.state.finished) {
      pass.kept.push({ path: shown, why: worktree.state.why });
      continue;
    }
    const removal = removeWorktree(repo, worktree.listed, options);
    for (const line of removal.said) {
      pass.said.push(line);
      say(line);
    }
    if (removal.status === "removed")
      pass.removed.push(shown);
    else
      pass.kept.push({ path: shown, why: removal.said[0] ?? removal.status });
  }
  return pass;
}
function parkedAtOf(path) {
  if (!isParkedWorktree(path))
    return null;
  const found = /-removing-(\d{13})$/.exec(path);
  return found?.[1] === undefined ? null : Number(found[1]);
}
function strayParkedFolders(repo, env) {
  let all;
  try {
    all = listWorktrees(repo, env);
  } catch {
    return [];
  }
  const folders = new Set([join18(repo, ".claude", "worktrees")]);
  for (const listed of all.slice(1))
    folders.add(dirname8(listed.path));
  const found = [];
  for (const folder of folders) {
    let names;
    try {
      names = readdirSync8(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join18(folder, name);
      const parkedAt = parkedAtOf(path);
      if (parkedAt === null || all.some((listed) => samePath(listed.path, path)))
        continue;
      try {
        if (!lstatSync3(path).isDirectory())
          continue;
      } catch {
        continue;
      }
      found.push({ parkedAt, path });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
var MTIME_SLACK_MS = 2000;
var MAX_ENTRIES = 1e5;
function walkLeftover(root, limitMs) {
  const walk = {
    crossesMount: false,
    unreadable: false,
    newer: { count: 0, first: [] },
    tooMany: false
  };
  let rootDevice;
  try {
    rootDevice = lstatSync3(root).dev;
  } catch {
    walk.unreadable = true;
    return walk;
  }
  const folders = [root];
  let seen = 0;
  for (let folder = folders.pop();folder !== undefined; folder = folders.pop()) {
    let names;
    try {
      names = readdirSync8(folder);
    } catch {
      walk.unreadable = true;
      continue;
    }
    for (const name of names) {
      seen += 1;
      if (seen > MAX_ENTRIES) {
        walk.tooMany = true;
        return walk;
      }
      const path = join18(folder, name);
      let stat;
      try {
        stat = lstatSync3(path);
      } catch {
        walk.unreadable = true;
        continue;
      }
      if (stat.dev !== rootDevice) {
        walk.crossesMount = true;
        continue;
      }
      if (stat.isDirectory()) {
        folders.push(path);
      } else if (stat.mtimeMs > limitMs) {
        walk.newer.count += 1;
        if (walk.newer.first.length < 3)
          walk.newer.first.push(relative(root, path));
      }
    }
  }
  return walk;
}
function gitEntryWhy(folder) {
  const dotGit = join18(folder, ".git");
  let stat;
  try {
    stat = lstatSync3(dotGit);
  } catch (error) {
    return error.code === "ENOENT" ? null : "its .git entry cannot be read";
  }
  if (stat.isDirectory())
    return "it holds a git repository of its own";
  if (!stat.isFile())
    return "its .git entry is neither a file nor a folder";
  try {
    const target = readFileSync16(dotGit, "utf8").trim().replace(/^gitdir:\s*/, "");
    return target !== "" && existsSync11(target) ? `git still has an administrative folder for it: ${target}` : null;
  } catch {
    return "its .git file cannot be read";
  }
}
function strayKeptWhy(stray, machine) {
  const mountWhy = mountKeptWhy(stray.path, machine.mounts);
  if (mountWhy !== null)
    return mountWhy;
  const entry = gitEntryWhy(stray.path);
  if (entry !== null)
    return entry;
  const session = machine.sessions.find((one) => isInside(realPath(one.cwd), realPath(stray.path)));
  const facts = {
    aheadOfBase: 0,
    base: "",
    containers: machine.containers === "unknown" ? "unknown" : containersUsing(stray.path, machine.containers),
    gitTooOld: null,
    idleMinutes: 0,
    innerWorktree: null,
    locked: false,
    mergedBy: null,
    parked: true,
    programs: machine.programs === "unknown" ? "unknown" : programsInside(machine.programs, stray.path),
    sessionName: session?.name ?? null
  };
  const judged = verdict(facts, () => ({ localFiles: [], uncommitted: false }), 0);
  if (!judged.finished)
    return judged.why;
  const walk = walkLeftover(stray.path, stray.parkedAt + MTIME_SLACK_MS);
  if (walk.unreadable)
    return "its files could not all be read";
  if (walk.crossesMount)
    return "it crosses a mount point";
  if (walk.tooMany)
    return `it holds more than ${String(MAX_ENTRIES)} entries, too many for a remnant`;
  if (walk.newer.count > 0) {
    const more = walk.newer.count > walk.newer.first.length ? ` and ${String(walk.newer.count - walk.newer.first.length)} more` : "";
    return `files were written in it after the removal moved it: ${walk.newer.first.join(", ")}${more}`;
  }
  return null;
}
function finishStrays(repo, options, say, strays = strayParkedFolders(repo, options.env)) {
  const pass = { kept: [], removed: [] };
  if (strays.length === 0)
    return pass;
  const machine = machineFactsOf(options);
  for (const stray of strays) {
    const why = strayKeptWhy(stray, machine);
    if (why !== null) {
      pass.kept.push({ path: stray.path, why });
      continue;
    }
    try {
      rmSync3(stray.path, { recursive: true });
    } catch (error) {
      pass.kept.push({
        path: stray.path,
        why: `it could not be removed: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }
    pass.removed.push(stray.path);
    say(`removed ${stray.path} (left by a removal that stopped halfway; git no longer lists it)`);
  }
  return pass;
}

// src/crew/display.ts
function lastLine(text) {
  return text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

// src/crew/board.ts
var REMOVED_VISIBLE_MS = 6 * 60 * 60 * 1000;
function isRefusal(value) {
  return "lines" in value && "code" in value;
}
function readRecords(ctx, all, command) {
  let checkout = null;
  try {
    checkout = locateCheckout(ctx.cwd, { env: ctx.env });
  } catch (error) {
    if (!all)
      return outsideProject(command, error instanceof Error ? error.message : String(error));
  }
  if (!all && checkout === null)
    return outsideProject(command, "this folder is not in a git project");
  const repo = checkout === null ? null : checkout.mainCheckout ?? checkout.root;
  const listed = all ? listAllCrew(ctx.paths.stateDir) : listCrew(ctx.paths.stateDir, repo ?? "");
  const newestFirst = [...listed.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  let machine = all ? listed.records : null;
  return {
    broken: listed.broken,
    checkout,
    machine: () => {
      machine ??= listAllCrew(ctx.paths.stateDir).records;
      return machine;
    },
    records: newestFirst,
    repo: all ? null : repo
  };
}
function outsideProject(command, why) {
  const fix = command === "list" ? "run it in the project's folder, or add --all" : `run it in the project's folder (${COMMAND} crew list --all shows every repository)`;
  return { code: 1, lines: [`crew ${command}: ${why}`, `Fix: ${fix}`] };
}
function findNamed(records, ref, look) {
  const plain = withoutListRef(ref);
  const matches = records.filter((one) => one.name === plain || look.ids(one).some((id) => id !== null && id === plain)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (matches.length === 0)
    return { kind: "none" };
  if (matches.length === 1)
    return { kind: "one", record: matches[0] };
  const live = matches.filter((one) => (look.live ?? (() => true))(one));
  if (live.length === 1)
    return { kind: "one", record: live[0] };
  return { kind: "many", records: matches };
}
var CREW_LOOK = {
  ids: (one) => [one.id, one.shortId, one.sessionId],
  live: (one) => !["removed", "discarded"].includes(one.state)
};
function findCrew(records, ref, command) {
  const found = findNamed(records, ref, CREW_LOOK);
  switch (found.kind) {
    case "one":
      return { record: found.record };
    case "none":
      return {
        refusal: {
          code: 1,
          lines: [
            `crew ${command}: no crew session of this repository is "${ref}"`,
            `Fix: ${COMMAND} crew list shows them, and --all those of every repository`
          ]
        }
      };
    case "many":
      return {
        refusal: {
          code: 1,
          lines: [
            `crew ${command}: "${ref}" is ${found.records.length === 2 ? "two" : String(found.records.length)} crew sessions`,
            ...found.records.map((one) => `  ${one.id}  ${one.name}  ${one.state}`),
            "Fix: name one by its id"
          ]
        }
      };
  }
}
var OTHER_WORDS = new Set(["clash", "lead-tell", "merge", "person"]);

// src/crew/remove.ts
function commits(count) {
  return `${String(count)} commit${count === 1 ? "" : "s"}`;
}
function discardBlocker(record, ctx) {
  try {
    const all = listWorktrees(record.repo, ctx.env);
    const listed = all.find((one) => samePath(one.path, record.worktree));
    if (listed === undefined || samePath(record.worktree, record.repo))
      return "its worktree is not one git lists apart from the main checkout";
    if (all.some((one) => !samePath(one.path, record.worktree) && isInside(one.path, record.worktree)))
      return "another worktree lives inside it";
    if (lockedByPerson(listed))
      return "the worktree has a person's lock";
    const machine = machineFactsOf({
      base: "",
      claudeConfigDir: ctx.paths.claudeConfigDir,
      env: ctx.env,
      ...ctx.scanFacts === undefined ? {} : { facts: ctx.scanFacts }
    });
    const mount = mountKeptWhy(record.worktree, machine.mounts);
    if (mount !== null)
      return mount;
    const leftoverPrograms = programsWithoutOwn(findOwnLeftovers(record, ctx));
    const row = agentRows(ctx);
    const session = row === null ? null : rowOf(row, record);
    const terminalSessionPid = session !== null && session.pid !== null && session.state !== null && ["done", "failed", "stopped"].includes(session.state) ? session.pid : null;
    const programs = leftoverPrograms === "unknown" || terminalSessionPid === null ? leftoverPrograms : leftoverPrograms.filter((program) => program.pid !== terminalSessionPid);
    if (programs === "unknown")
      return "running programs could not be listed; nothing archived or removed";
    const names = programsInside(programs, record.worktree, undefined, ctx.pid);
    if (names.length > 0)
      return programsWhy(names);
    if (machine.containers === "unknown")
      return "Docker did not answer; nothing archived or removed";
    const containers = containersUsing(record.worktree, machine.containers);
    return containers.length > 0 ? containersWhy(containers) : null;
  } catch (error) {
    return reasonOf2(error);
  }
}
function crewRemovalLockDir(stateDir, repo, id) {
  return join19(crewFilesDir(stateDir, repo, id), "removal");
}
async function remakeReleasedWorktree(record, ctx, options) {
  if (record.released === undefined)
    return { ok: true, remade: false, record };
  return await remakeWorktree(record, ctx, options);
}
async function remakeWorktree(record, ctx, options) {
  if (existsSync12(record.worktree))
    return { ok: false, why: `${record.worktree} exists already; inspect it first` };
  if (record.released === undefined) {
    let all;
    try {
      all = listWorktrees(record.repo, ctx.env);
    } catch (error) {
      return { ok: false, why: reasonOf2(error) };
    }
    const listed = all.find((one) => samePath(one.path, record.worktree));
    const elsewhere = all.find((one) => one.branch === record.branch && !samePath(one.path, record.worktree));
    if (elsewhere !== undefined)
      return {
        fix: "Fix: switch that worktree to another branch, or remove it, then run crew rm --discard again",
        ok: false,
        why: `${record.branch} is checked out in ${relative2(record.repo, elsewhere.path)}, so its worktree cannot be made again`
      };
    if (listed !== undefined && lockedByPerson(listed))
      return { ok: false, ...personLock(record, listed) };
    if (listed?.locked === true) {
      const unlock = runGit(record.repo, ["worktree", "unlock", listed.path], ctx.env, GIT_TIMEOUT_MS);
      if (!unlock.ok)
        return { ok: false, why: `${record.worktree} could not be unlocked: ${unlock.err}` };
    }
    pruneWorktrees(record.repo, ctx.env);
  }
  const added = runGit(record.repo, ["worktree", "add", record.worktree, record.branch], ctx.env, GIT_TIMEOUT_MS);
  if (!added.ok)
    return { ok: false, why: `worktree could not be made again: ${added.err}` };
  try {
    if (options.include)
      copyWorktreeInclude(record.repo, record.worktree, ctx.env);
    const stored = record.released === undefined ? record : await updateCrew(ctx.paths.stateDir, record.repo, record.id, { released: undefined }, ctx.now());
    return { ok: true, remade: true, record: stored };
  } catch (error) {
    const undone = runGit(record.repo, ["worktree", "remove", "--force", record.worktree], ctx.env, GIT_TIMEOUT_MS);
    return {
      ok: false,
      why: `the worktree's files or the store could not be written (${reasonOf2(error)}); ${undone.ok ? "the worktree was taken back" : `remove ${record.worktree} by hand: ${undone.err.trim()}`}`
    };
  }
}
function personLock(record, listed) {
  const reason = listed.lockReason === undefined ? "" : ` (${listed.lockReason})`;
  return {
    fix: `Fix: release it yourself if you mean to remove the crew session: git worktree unlock ${record.worktree}; crew rm unlocks only Claude Code's own lock`,
    why: `${relative2(record.repo, record.worktree)} is locked${reason}, and not by Claude Code`
  };
}
async function runCrewRm(ref, ctx, options = {}) {
  const first = actOn(ref, "rm", ctx);
  if (isRefusal(first))
    return refuse(first, ctx);
  const dir = crewRemovalLockDir(ctx.paths.stateDir, first.record.repo, first.record.id);
  let entered = false;
  try {
    mkdirSync9(dir, { mode: 448, recursive: true });
    return await withLock(dir, async () => {
      entered = true;
      return await removeCrewSession(ref, ctx, options);
    }, { waitMs: 0 });
  } catch (error) {
    if (error instanceof LockBusyError && !entered) {
      return refuse(options.release === true ? failure2(`crew rm: ${first.record.name} is being removed or resumed by another run`, "Fix: nothing to do; the watch tries the release again by itself") : failure2(`crew rm: ${first.record.name} is being removed by another run; wait for it to end, then run crew rm again if it is still there`), ctx);
    }
    throw error;
  }
}
async function removeCrewSession(ref, ctx, options) {
  const found = actOn(ref, "rm", ctx);
  if (isRefusal(found))
    return refuse(found, ctx);
  let { record } = found;
  const release = options.release === true;
  const then = release ? "; the watch then releases it by itself" : ", then run crew rm again";
  const releasedBefore = record.released !== undefined;
  const hadWorktree = existsSync12(record.worktree);
  if (release) {
    if (!RELEASE_STATES.includes(record.state))
      return refuse(failure2(`crew rm: ${record.name} is not over or stopped`), ctx);
    if (record.discardPending !== undefined)
      return refuse(failure2(`crew rm: ${pendingDiscardWhy(record)}`), ctx);
    if (resumeClaimHeld(record.resumeClaim, ctx.now()))
      return refuse(failure2(`crew rm: a resume of ${record.name} is starting`, "Fix: nothing to do; the watch tries the release again once the resume is over"), ctx);
  }
  if (record.discardPending !== undefined) {
    try {
      record = await rollbackCrewDiscard(record, ctx);
    } catch (error) {
      return refuse(failure2(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf2(error)})`), ctx);
    }
  }
  const { repo } = record;
  const home = ctx.paths.home;
  const discard = options.discard === true;
  let preview;
  if (["removed", "discarded"].includes(record.state)) {
    return refuse(failure2(`crew rm: ${record.name} is removed already`), ctx);
  }
  if (record.state === "queued" && record.shortId === null) {
    const stored = await markState(record, "removed", "removed before it started", ctx);
    ctx.print(`removed ${record.name}; it had not started, so nothing else went`);
    return stored ? 0 : 1;
  }
  const branchThere = runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}`], ctx.env, GIT_TIMEOUT_MS).ok;
  const folderGone = discard && record.released === undefined && record.archive === undefined && !existsSync12(record.worktree);
  if (folderGone && !branchThere) {
    return refuse(failure2(`crew rm: ${record.name} has no worktree and no branch ${record.branch}, so there is nothing to archive`, `Fix: crew rm ${record.id}, without --discard, removes the record`), ctx);
  }
  let remadeForDiscard = false;
  if (discard && (record.released !== undefined || folderGone)) {
    const remade = record.released !== undefined ? await remakeReleasedWorktree(record, ctx, { include: false }) : await remakeWorktree(record, ctx, { include: false });
    if (!remade.ok)
      return refuse(failure2(`crew rm: ${remade.why}`, ...remade.fix === undefined ? [] : [remade.fix]), ctx);
    record = remade.record;
    remadeForDiscard = true;
    ctx.print(`made ${relative2(repo, record.worktree)} again on ${record.branch}, to discard it${folderGone ? " (its folder was gone)" : ""}`);
  }
  const proof = options.against === undefined && !discard && validMergeProof(record, ctx) ? record.mergeProof : undefined;
  const lead = options.against !== undefined ? { folder: null, label: options.against.label, sha: options.against.ref } : discard ? { folder: null, label: "discard archive", sha: record.archive?.head ?? "HEAD" } : proof === undefined ? leadRef(record, ctx) : { folder: null, label: proof.leadRef, sha: proof.leadCommit };
  if ("why" in lead)
    return refuse(failure2(`crew rm: ${lead.why}`), ctx);
  let removalBase = { label: lead.label, ref: lead.sha };
  const discardRollbackBase = removalBase;
  const mergeStep = lead.folder === null ? `merge ${record.branch} into ${lead.label}` : `git merge ${record.branch}, in ${lead.folder}`;
  if (branchThere && proof === undefined && !discard) {
    const merged = options.against === undefined ? mergedIntoBase(record, ctx) : workOnRef(repo, removalBase.ref, `refs/heads/${record.branch}`, ctx.env);
    const legacy = record.state === "merged" && record.mergeProof === undefined ? "merged earlier, but no exact-head proof was recorded; its lead's branch may have been rewritten since. Confirm the work with the lead and merge it again, or use explicit recoverable crew rm --discard" : null;
    if (merged === "unknown") {
      return refuse(failure2(`crew rm: ${legacy ?? `git could not tell whether the work of ${record.branch} is on ${lead.label} (a conflict, or a git older than 2.38)`}`, `Fix: ${mergeStep} so that it is an ancestor, then run crew rm again`), ctx);
    }
    if (merged === "missing") {
      const count = commitsNotOn(repo, lead, record.branch, ctx.env);
      if (count !== 0) {
        const missing = count === null ? "some commits" : commits(count);
        return refuse(failure2(`crew rm: ${legacy ?? `${record.branch} has ${missing} that ${lead.label} does not have`}`, lead.folder === null ? `Fix: the lead must ${mergeStep}, then run crew rm again` : `Fix: the lead merges it first (${mergeStep}), then run crew rm again`), ctx);
      }
    }
  }
  if (!discard && existsSync12(record.worktree) && hasChanges(record.worktree, ctx.env)) {
    return refuse(failure2(`crew rm: ${tildify(record.worktree, home)} has changes that are not committed (or git cannot read it)`, `Fix: commit or discard them there${then}; it never forces`), ctx);
  }
  let listed;
  try {
    listed = listWorktrees(repo, ctx.env).find((one) => samePath(one.path, record.worktree));
  } catch (error) {
    return refuse(failure2(`crew rm: ${reasonOf2(error)}`), ctx);
  }
  const shown = relative2(repo, record.worktree);
  const locked = listed?.locked === true;
  if (listed !== undefined && lockedByPerson(listed)) {
    const held = personLock(record, listed);
    return refuse(failure2(`crew rm: ${held.why}`, `${held.fix}${release ? then : ""}`), ctx);
  }
  if (discard && existsSync12(record.worktree)) {
    if (listed === undefined)
      return refuse(failure2("crew rm: discard needs its registered worktree; nothing archived or removed"), ctx);
    const blocker = discardBlocker(record, ctx);
    if (blocker !== null)
      return refuse(failure2(`crew rm: ${blocker}`), ctx);
    try {
      preview = buildCrewDiscardFacts(record, ctx);
      if (record.archive !== undefined && (preview.head !== record.archive.head || preview.changedFiles.length > 0 || preview.ignoredFiles.length > 0))
        return refuse(failure2("crew rm: work changed after its archive was made; keep this worktree and recover the existing archive before discarding again"), ctx);
      for (const line of preview.lines)
        ctx.print(line);
      if (options.expectedDiscardToken !== undefined && options.expectedDiscardToken !== preview.token)
        return refuse(failure2("crew rm: the work changed since the discard preview; preview and confirm it again"), ctx);
      if (!options.yes && (options.confirm === undefined || !options.confirm(preview.question))) {
        ctx.print(`Nothing removed${remadeForDiscard ? `; ${shown} stays made again for this preview` : ""}. Use crew rm <name|id> --discard --yes to confirm without a terminal.`);
        return 1;
      }
      if (buildCrewDiscardFacts(record, ctx).token !== preview.token)
        return refuse(failure2("crew rm: the work changed since confirmation; preview and confirm it again"), ctx);
    } catch (error) {
      return refuse(failure2(`crew rm: ${reasonOf2(error)}`), ctx);
    }
  }
  if (release && existsSync12(record.worktree)) {
    const blocker = discardBlocker(record, ctx);
    const local = blocker === null ? localFiles(record.worktree, record.repo, ctx.env) : [];
    if (blocker !== null || local === null || local.length > 0) {
      return refuse(blocker !== null || local === null ? failure2(`crew rm: ${blocker ?? "git could not list the files it does not keep"}`, `Fix: clear that${then}`) : failure2(`crew rm: local files git does not keep: ${local.join(", ")}`, `Fix: commit them on ${record.branch}, or move them out of ${tildify(record.worktree, home)}${then}`), ctx);
    }
  }
  if (record.shortId !== null && record.state !== "stopped" && !(release && options.notLive)) {
    const stopped = await stopSession(record, ctx);
    if (stopped.ok) {
      ctx.print(stopped.gone ? `session ${record.shortId} was gone already` : `stopped session ${record.shortId}`);
    } else {
      ctx.error(`note: ${stopped.why}; going on, the check below stops the removal if anything still works in its worktree`);
    }
  }
  if (discard) {
    try {
      if (preview !== undefined && record.archive === undefined) {
        const blocker = discardBlocker(record, ctx);
        if (blocker !== null)
          return refuse(failure2(`crew rm: ${blocker}`), ctx);
        if (buildCrewDiscardFacts(record, ctx).token !== preview.token)
          return refuse(failure2("crew rm: the work changed since confirmation; preview and confirm it again"), ctx);
        const own = findOwnLeftovers(record, ctx);
        const stopped = await stopOwnLeftovers(record, own, ctx);
        if (stopped.line !== null)
          ctx.print(stopped.line);
        record = await archiveCrewDiscard(record, preview, ctx);
      }
      if (record.archive === undefined)
        return refuse(failure2("crew rm: discard has no saved archive"), ctx);
      const archive = runGit(repo, ["rev-parse", "--verify", record.archive.ref], ctx.env, GIT_TIMEOUT_MS);
      if (!archive.ok || archive.out !== record.archive.head)
        return refuse(failure2("crew rm: saved discard archive is missing or changed; nothing removed"), ctx);
      if (preview === undefined && branchThere)
        return refuse(failure2("crew rm: worktree is gone but its branch remains; inspect the saved archive before retrying"), ctx);
      removalBase = { label: record.archive.ref, ref: record.archive.head };
      ctx.print(`archived ${record.name} at ${record.archive.ref}`);
    } catch (error) {
      return refuse(failure2(`crew rm: ${reasonOf2(error)}`), ctx);
    }
  }
  let releasedReason = null;
  if (listed !== undefined && locked) {
    const unlock = runGit(repo, ["worktree", "unlock", listed.path], ctx.env, GIT_TIMEOUT_MS);
    if (!unlock.ok) {
      if (record.discardPending !== undefined) {
        try {
          record = await rollbackCrewDiscard(record, ctx);
          removalBase = discardRollbackBase;
        } catch (error) {
          ctx.error(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf2(error)})`);
        }
      }
      return refuse(failure2(`crew rm: ${shown} could not be unlocked: ${unlock.err}`, `Fix: git worktree unlock ${record.worktree} by hand${then}`), ctx);
    }
    releasedReason = listed.lockReason ?? "";
    ctx.print(`unlocked ${shown}`);
  }
  const refuseKept = async (refusal) => {
    if (record.discardPending !== undefined) {
      try {
        record = await rollbackCrewDiscard(record, ctx);
        removalBase = discardRollbackBase;
      } catch (error) {
        ctx.error(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf2(error)})`);
      }
    }
    if (releasedReason !== null && listed !== undefined) {
      const again = runGit(repo, ["worktree", "lock", "--reason", releasedReason, listed.path], ctx.env, GIT_TIMEOUT_MS);
      if (again.ok) {
        ctx.print(`locked ${shown} again, with the same reason`);
      } else {
        ctx.error(`note: ${shown} could not be locked again (${lastLine(again.err)}); lock it yourself if you mean to keep it: git worktree lock ${record.worktree}`);
      }
    }
    return refuse(refusal, ctx);
  };
  const leftovers = findOwnLeftovers(record, ctx);
  const rows = discard ? agentRows(ctx) : null;
  const session = rows === null ? null : rowOf(rows, record);
  const terminalSessionPid = session !== null && session.pid !== null && session.state !== null && ["done", "failed", "stopped"].includes(session.state) ? session.pid : null;
  const programs = programsWithoutOwn(leftovers);
  const judgedPrograms = discard && programs !== "unknown" && terminalSessionPid !== null ? programs.filter((program) => program.pid !== terminalSessionPid) : programs;
  const facts = { ...ctx.scanFacts, programs: judgedPrograms };
  const finished = options.skipParked ? { kept: [], removed: [] } : await finishParkedWorktrees(repo, ctx, discard ? null : { label: lead.label, ref: lead.sha }, (line) => ctx.print(line), facts);
  const stuck = finished.kept.find((one) => {
    const original = parkedOriginal(one.path);
    return samePath(one.path, repo) || original !== null && samePath(original, record.worktree);
  });
  if (stuck !== undefined) {
    return await refuseKept(failure2(`crew rm: ${relative2(repo, stuck.path)} is kept: ${stuck.why}`, `Fix: clear that${then}; it never forces`));
  }
  if (listed !== undefined) {
    let judged;
    try {
      judged = scanWorktrees(repo, {
        against: removalBase,
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        env: ctx.env,
        ...facts === undefined ? {} : { facts },
        idleLimit: 0
      }).find((one) => one.state !== "main" && samePath(one.listed.path, record.worktree));
    } catch (error) {
      return await refuseKept(failure2(`crew rm: ${reasonOf2(error)}`));
    }
    if (judged === undefined || judged.state === "main") {
      return await refuseKept(failure2(`crew rm: ${shown} is listed by git but could not be judged`));
    }
    if (judged.state === "gone") {
      pruneWorktrees(repo, ctx.env);
      ctx.print(`forgot ${shown} (its folder was already gone)`);
    } else {
      if (!judged.state.finished) {
        return await refuseKept(failure2(`crew rm: ${shown} is kept: ${judged.state.why}`, `Fix: clear that${then}; it never forces`));
      }
      const stopped = await stopOwnLeftovers(record, leftovers, ctx);
      if (stopped.line !== null)
        ctx.print(stopped.line);
      const removal = removeWorktree(repo, judged.listed, {
        against: removalBase,
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        deleteBranch: (_repo, branch) => release ? `kept branch ${branch}` : deleteBranchOnRef(repo, removalBase.ref, removalBase.label, branch, ctx.env),
        env: ctx.env,
        ...facts === undefined ? {} : { facts },
        idleLimit: 0
      });
      for (const said of removal.said)
        ctx.print(said);
      if (removal.status !== "removed") {
        return await refuseKept(release ? failure2(`crew rm: ${shown} was not removed${removal.said.length > 0 ? `: ${removal.said.join("; ")}` : ""}`, `Fix: clear what holds it${then}; it never forces`) : failure2(`crew rm: ${shown} was not removed`, "Fix: clear what holds it (the line above says what), then run crew rm again; it never forces"));
      }
    }
  }
  if (existsSync12(record.worktree)) {
    return await refuseKept(failure2(`crew rm: ${shown} is still there, and git does not list it as a worktree`, `Fix: remove that folder yourself${then}; crew rm never deletes what git does not know`));
  }
  const branchLeft = () => runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}`], ctx.env, GIT_TIMEOUT_MS).ok;
  if (branchLeft() && !release) {
    ctx.print(deleteBranchOnRef(repo, removalBase.ref, removalBase.label, record.branch, ctx.env));
  }
  if (discard && record.discardPending !== undefined && !branchLeft())
    record = await completeCrewDiscard(record, ctx);
  if (release && record.released === undefined)
    record = await updateCrew(ctx.paths.stateDir, repo, record.id, { released: { at: new Date(ctx.now()).toISOString() } }, ctx.now());
  const sessions = crewSessions(record);
  let removedAny = false;
  for (const one of sessions) {
    const rm = claudeFailure(ctx, repo, ["rm", one.shortId]);
    const goneAlready = rm !== null && sessionUnknown(ctx, record, one.shortId);
    if (rm !== null && !goneAlready) {
      const branchGone = !branchLeft();
      ctx.error(`crew rm: ${rm}`);
      ctx.error(release ? `Fix: nothing to do; the worktree is gone${branchGone ? "" : `, ${record.branch} is kept`}, and the watch tries claude rm ${one.shortId} again by itself (or run it by hand)` : `  the worktree is gone already${branchGone ? ", and so is the branch" : ""}; run claude rm ${one.shortId} by hand, then crew rm again`);
      if (!(release && releasedBefore)) {
        try {
          await appendCrewEvent(ctx.paths.stateDir, repo, {
            lead: record.leadSessionId,
            name: record.name,
            state: record.state,
            text: `the worktree is gone${branchGone ? " and so is the branch" : ""}; ${rm}`,
            type: "step",
            crew: record.id
          }, ctx.now());
        } catch (error) {
          ctx.error(`crew rm: the store could not record it: ${reasonOf2(error)}`);
        }
      }
      return 1;
    }
    if (!goneAlready)
      removedAny = true;
    ctx.print(goneAlready ? `session ${one.shortId} was gone already` : `removed session ${one.shortId}`);
  }
  const endedAt = new Date(ctx.now()).toISOString();
  record = await updateCrew(ctx.paths.stateDir, repo, record.id, { sessionEndedAt: record.sessionEndedAt ?? endedAt }, ctx.now());
  if (release) {
    if (!releasedBefore || removedAny)
      await appendCrewEvent(ctx.paths.stateDir, repo, {
        lead: record.leadSessionId,
        name: record.name,
        state: record.state,
        text: `released: ${releasedBefore ? "its agent-view rows are removed now" : hadWorktree ? "worktree and agent-view rows removed" : "agent-view rows removed"}${branchLeft() ? `; branch ${record.branch} kept` : ""}`,
        type: "step",
        crew: record.id
      }, ctx.now());
    return 0;
  }
  if (discard)
    record = await completeCrewDiscard(record, ctx);
  const state = discard ? "discarded" : "removed";
  const stored = await markState(record, state, discard ? `discarded; recover from ${record.archive?.ref}` : "removed", ctx);
  ctx.print(`${state} ${record.name}`);
  return stored ? 0 : 1;
}
async function finishParkedWorktrees(repo, ctx, base, say, facts = ctx.scanFacts) {
  const lock = await (ctx.holdCleanLock ?? holdCleanLock)();
  if (lock === null)
    return { kept: [{ path: repo, why: "another worktree clean is running" }], removed: [] };
  try {
    const pass = { kept: [], removed: [] };
    const options = {
      claudeConfigDir: ctx.paths.claudeConfigDir,
      env: ctx.env,
      ...facts === undefined ? {} : { facts },
      idleLimit: 0
    };
    let parked;
    try {
      parked = listWorktrees(repo, ctx.env).filter((one) => isParkedWorktree(one.path));
    } catch (error) {
      return { kept: [{ path: repo, why: reasonOf2(error) }], removed: [] };
    }
    if (parked.length > 0) {
      const records = listCrew(ctx.paths.stateDir, repo).records;
      const groups = new Map;
      for (const one of parked) {
        const original = parkedOriginal(one.path) ?? one.path;
        const record = records.find((two) => samePath(two.worktree, original));
        let chosen = null;
        if (record !== undefined) {
          const lead = leadRef(record, ctx);
          if (!("why" in lead)) {
            const proof = validMergeProof(record, ctx) ? record.mergeProof : undefined;
            chosen = { label: lead.label, ref: proof?.leadCommit ?? lead.sha };
          }
        }
        chosen = chosen ?? base;
        if (chosen === null)
          continue;
        const group = groups.get(chosen.ref) ?? { label: chosen.label, paths: [], ref: chosen.ref };
        group.paths.push(one.path);
        groups.set(chosen.ref, group);
      }
      for (const group of groups.values()) {
        const done = finishParked(repo, group.paths, { ...options, against: { label: group.label, ref: group.ref }, base: group.label }, say);
        pass.removed.push(...done.removed);
        pass.kept.push(...done.kept);
      }
    }
    const strays = finishStrays(repo, { ...options, base: base?.label ?? "" }, say);
    pass.removed.push(...strays.removed);
    pass.kept.push(...strays.kept);
    return pass;
  } finally {
    lock.close();
  }
}

// src/worktrees/crew-clean.ts
function cleanupCrewContext(paths, env, repo, facts, now = Date.now) {
  return {
    ...realCrewContext(paths),
    cwd: repo,
    env,
    now,
    scanFacts: facts,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" })
  };
}
async function orphanCrewOf(ctx) {
  const crew = listCrew(ctx.paths.stateDir, ctx.cwd);
  const leads = listLeads(ctx.paths.stateDir, ctx.cwd);
  const none = { records: crew.records, gone: new Set };
  if (crew.broken.length || leads.broken.length || leads.records.length === 0)
    return none;
  const rows = agentRows(ctx);
  const observed = await observeLeadPresence(ctx.paths.stateDir, leads.records, rows, ctx.now(), ctx);
  return {
    records: crew.records,
    gone: new Set(crew.records.filter((record) => leadGone(observed.find((lead) => lead.sessionId === record.leadSessionId) ?? null, rows, ctx.now(), ctx)).map((record) => record.id))
  };
}
function orphanCrewLine(record) {
  return `its lead is gone: remove it with \`crew rm\`, or continue it with \`crew start ${record.phase} --continue "${record.name}"\``;
}
async function cleanOrphanCrew(ctx, orphaned, base, say) {
  const removed = [];
  const resolved = runGit(ctx.cwd, ["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`], ctx.env);
  if (!resolved.ok)
    return { removed };
  const against = { label: base.label, ref: resolved.out };
  for (const record of orphaned.records) {
    if (!orphaned.gone.has(record.id) || !["stopped", "done", "failed", "merged", "handoff"].includes(record.state))
      continue;
    const tip = runGit(ctx.cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`], ctx.env);
    if (!tip.ok || !["ancestor", "replay"].includes(workOnRef(ctx.cwd, against.ref, tip.out, ctx.env))) {
      say(`kept ${record.name}: ${orphanCrewLine(record)}`);
      continue;
    }
    const lines = [];
    const code = await runCrewRm(record.id, { ...ctx, error: (line) => lines.push(line), print: (line) => lines.push(line) }, { against, skipParked: true });
    for (const line of lines)
      say(line);
    if (code === 0) {
      const why = `its lead is gone; its work is on ${base.label}`;
      say(`removed ${record.name}: ${why}`);
      removed.push({
        branch: record.branch,
        name: basename5(record.worktree),
        path: record.worktree,
        why
      });
    }
  }
  return { removed };
}

// src/worktrees/command.ts
var DEFAULT_BASE = "main";
function baseBranch(checkout, env, repo) {
  if (checkout !== null) {
    const config = loadProjectConfig(checkout).config;
    const base = config?.worktrees?.base;
    if (base !== undefined)
      return { base, from: "config" };
  }
  const head = runGit(repo, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env);
  const name = head.ok ? head.out.replace(/^origin\//, "") : "";
  return name === "" ? { base: DEFAULT_BASE, from: "default" } : { base: name, from: "origin" };
}
function isCrewWorktree(worktree, records) {
  if (worktree.state === "main" || worktree.state === "gone")
    return false;
  return crewOfWorktree(records, worktree.listed.path) !== null;
}

// src/hooks/worktree-leftovers.ts
function idleMinutesOrNull(worktree, now) {
  let admin;
  try {
    admin = readFileSync17(join20(worktree, ".git"), "utf8").trim().replace(/^gitdir:\s*/, "");
  } catch {
    return null;
  }
  if (!isAbsolute2(admin))
    admin = resolve4(worktree, admin);
  let last = 0;
  for (const file of ["index", "HEAD", join20("logs", "HEAD")]) {
    try {
      last = Math.max(last, statSync8(join20(admin, file)).mtimeMs);
    } catch {}
  }
  return last === 0 ? null : (now - last) / 60000;
}

// src/workflow/review-cover.ts
function parseGitVersion(out) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  return match === null ? null : `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
}

// src/worktrees/scan.ts
var PARKED_END = /(?:-removing-\d{13})+$/;
function parkedOriginal(path) {
  const found = PARKED_END.exec(path);
  return found === null || found.index === 0 ? null : path.slice(0, found.index);
}
function isParkedWorktree(path) {
  return parkedOriginal(path) !== null;
}
function forgottenLine(path) {
  return `forgot ${path} (its folder was already gone). A worktree on a disk that is not connected reads ` + `the same way: lock one there (\`git worktree lock "${path}"\`) and prune leaves it alone.`;
}
function fetchBase(repo, base, env, timeoutMs = 30000) {
  return runGit(repo, ["-c", "credential.interactive=never", "fetch", "origin", base, "--quiet"], env, timeoutMs).ok;
}
function innerWorktreeOf(worktree, all) {
  const listed = all.find((other) => isInside(other.path, worktree) && !isInside(worktree, other.path));
  if (listed !== undefined)
    return listed.path;
  const claudeOwn = join21(worktree, ".claude", "worktrees");
  let entries;
  try {
    entries = readdirSync9(claudeOwn);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const folder = join21(claudeOwn, entry);
    try {
      if (statSync9(folder).isDirectory() && readdirSync9(folder).length > 0)
        return folder;
    } catch {}
  }
  return null;
}
function hasChangesBeyondDeletions(worktree, env) {
  const status = runGit(worktree, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], env);
  if (!status.ok)
    return true;
  return status.out.split(`
`).some((line) => line !== "" && !/^(?: D|D) /.test(line));
}
function contentsOf(worktree, mainCheckout, env, parked = false) {
  const changed = parked ? hasChangesBeyondDeletions(worktree, env) : hasChanges(worktree, env);
  if (changed)
    return { localFiles: [], uncommitted: true };
  const ignored = localFiles(worktree, mainCheckout, env);
  if (ignored === null) {
    return { localFiles: ["(git could not list the ignored files)"], uncommitted: false };
  }
  return { localFiles: ignored, uncommitted: false };
}
var GH_TIMEOUT_MS = 1e4;
function cherryOnBase(repo, baseRef, head, env) {
  const run = runGit(repo, ["cherry", baseRef, head], env);
  if (!run.ok)
    return false;
  const lines = run.out.split(`
`).filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => line.startsWith("-"));
}
function pullRequestMerged(repo, branch, head, env) {
  try {
    if (Bun.which("gh", { PATH: env.PATH ?? "" }) === null)
      return false;
    const run = Bun.spawnSync([
      "gh",
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "merged",
      "--json",
      "number,headRefOid",
      "--limit",
      "1"
    ], { cwd: repo, env, stdin: "ignore", stderr: "pipe", stdout: "pipe", timeout: GH_TIMEOUT_MS });
    const parsed = JSON.parse(run.stdout.toString() || "null");
    if (!Array.isArray(parsed) || parsed.length === 0)
      return false;
    const first = parsed[0];
    return typeof first.headRefOid === "string" && first.headRefOid === head;
  } catch {
    return false;
  }
}
function objectFolder(repo, env) {
  const common = runGit(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], env);
  if (!common.ok || common.out === "")
    return null;
  const dir = mkdtempSync(join21(tmpdir(), `${COMMAND}-worktrees-`));
  const objects = join21(common.out, "objects");
  return {
    dir,
    own: {
      GIT_OBJECT_DIRECTORY: dir,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replaceAll("\\", "\\\\").replaceAll('"', "\\\"")}"`
    }
  };
}
function replayOntoBase(repo, baseRef, head, env) {
  const base = runGit(repo, ["rev-parse", "--verify", "--quiet", `${baseRef}^{tree}`], env);
  if (!base.ok || !COMMIT_SHA.test(base.out))
    return "unknown";
  const objects = objectFolder(repo, env);
  if (objects === null)
    return "unknown";
  try {
    const merged = runGit(repo, ["merge-tree", "--write-tree", "--no-messages", baseRef, head], env, GUARD_GIT_TIMEOUT_MS, objects.own);
    if (!merged.ok)
      return "unknown";
    const tree = merged.out.split(`
`)[0] ?? "";
    if (!COMMIT_SHA.test(tree))
      return "unknown";
    return tree === base.out ? "nothing" : "changes";
  } finally {
    rmSync4(objects.dir, { recursive: true, force: true });
  }
}
function replayerFor(repo, env) {
  const asked = runGit(repo, ["--version"], env);
  const version = asked.ok ? parseGitVersion(asked.out) : null;
  const tooOld = version !== null && Bun.semver.order(version, MIN_MERGE_TREE_GIT) < 0 ? version : null;
  return {
    tooOld,
    replay: (baseRef, head) => tooOld === null ? replayOntoBase(repo, baseRef, head, env) : "unknown"
  };
}
function holdsSubmodule(worktree, env) {
  const status = runGit(worktree, ["submodule", "status"], env);
  return status.ok && status.out.trim() !== "";
}
function workOnBase(repo, baseRef, head, branch, env, replayer) {
  const replay = replayer.replay(baseRef, head);
  if (replay === "nothing")
    return "replay";
  if (replay === "changes")
    return null;
  if (cherryOnBase(repo, baseRef, head, env))
    return "cherry";
  if (branch !== null && pullRequestMerged(repo, branch, head, env))
    return "pull request";
  return null;
}
function workOnRef(repo, ref, head, env, replayer = replayerFor(repo, env)) {
  const ancestor = runGit(repo, ["merge-base", "--is-ancestor", head, ref], env);
  if (ancestor.ok)
    return "ancestor";
  if (ancestor.code !== 1)
    return "unknown";
  const replay = replayer.replay(ref, head);
  if (replay === "nothing")
    return "replay";
  return replay === "changes" ? "missing" : "unknown";
}
var INITIAL_PID_NAMESPACE = `pid:[${4026531836}]`;
function staleClaudeLock(listed, look) {
  if (!listed.locked || listed.lockReason === undefined)
    return false;
  const match = /^claude session .+ \(pid (\d+) start (\d+)\)$/.exec(listed.lockReason);
  if (match === null || look.platform !== "linux" || look.pidNamespace !== INITIAL_PID_NAMESPACE)
    return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return false;
  if (look.processIsGone(pid))
    return true;
  const expected = `proc:${match[2]}`;
  const actual = look.processStartTime(pid, expected);
  return actual !== null && actual !== expected;
}
function judgeOne(repo, listed, all, look, idle) {
  const ahead = runGit(repo, ["rev-list", "--count", `${look.ref}..${listed.head}`], look.env);
  if (!ahead.ok) {
    return {
      finished: false,
      held: false,
      why: `git could not compare it with ${look.label}`
    };
  }
  const aheadOfBase = Number(ahead.out);
  const session = look.sessions.find((one) => isInside(realPath(one.cwd), realPath(listed.path)));
  const parked = isParkedWorktree(listed.path) && listed.branch !== null;
  if (parked) {
    const mountWhy = mountKeptWhy(listed.path, look.mounts);
    if (mountWhy !== null)
      return { finished: false, held: false, why: mountWhy };
  }
  const facts = {
    aheadOfBase,
    base: look.label,
    containers: look.containers === "unknown" ? "unknown" : containersUsing(listed.path, look.containers),
    gitTooOld: look.replayer.tooOld,
    idleMinutes: idle ?? 0,
    innerWorktree: innerWorktreeOf(listed.path, all),
    locked: listed.locked && !staleClaudeLock(listed, look),
    mergedBy: aheadOfBase > 0 ? workOnBase(repo, look.ref, listed.head, listed.branch, look.env, look.replayer) : null,
    parked,
    programs: look.programs === "unknown" ? "unknown" : programsInside(look.programs, listed.path),
    sessionName: session?.name ?? null
  };
  return verdict(facts, () => contentsOf(listed.path, repo, look.env, parked), look.idleLimit);
}
function machineFactsOf(options) {
  return {
    containers: options.facts?.containers ?? dockerMounts(),
    mounts: options.facts?.mounts ?? mountPoints(),
    programs: options.facts?.programs ?? runningPrograms(),
    sessions: options.facts?.sessions ?? liveSessions(options.claudeConfigDir),
    processStartTime: options.facts?.processStartTime ?? processStartTime,
    processIsGone: options.facts?.processIsGone ?? processIsGone,
    platform: options.facts?.platform ?? process.platform,
    pidNamespace: options.facts?.pidNamespace === undefined ? ownPidNamespace() : options.facts.pidNamespace
  };
}
function lookAt(repo, options) {
  return {
    ...machineFactsOf(options),
    env: options.env,
    idleLimit: options.idleLimit,
    label: options.against?.label ?? options.base,
    now: options.now ?? Date.now(),
    ref: options.against?.ref ?? `refs/remotes/origin/${options.base}`,
    replayer: replayerFor(repo, options.env)
  };
}
function lockLine(listed, onBase = false) {
  const reason = listed.lockReason;
  if (reason === undefined)
    return "locked with `git worktree lock` (locker cannot be proved gone)";
  const match = /^claude session (.+) \(pid (\d+) start (\S+)\)$/.exec(reason);
  if (match === null)
    return `locked: ${reason} (locker cannot be proved gone)`;
  const session = match[1];
  return `locked by live or unprovable Claude session ${session}${onBase ? "; its work is on the base \u2014 leave it with Claude Code's ExitWorktree (remove), or close that session" : "; its locker is not proved gone"}`;
}
function scanWorktrees(repo, options) {
  const { env } = options;
  const againstRef = options.against?.ref ?? `refs/remotes/origin/${options.base}`;
  const againstLabel = options.against?.label ?? options.base;
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", againstRef], env).ok) {
    throw new Error(options.against === undefined ? `origin/${options.base} is not known here \u2014 run \`git fetch origin ${options.base}\` first` : `${againstLabel} is not known here`);
  }
  const look = lookAt(repo, options);
  const all = listWorktrees(repo, env);
  const [main, ...others] = all;
  const scanned = main === undefined ? [] : [{ idleMinutes: null, listed: main, state: "main" }];
  for (const listed of others) {
    if (listed.locked && (!existsSync14(listed.path) || !staleClaudeLock(listed, look))) {
      const onBase = (listed.lockReason ?? "").startsWith("claude session ") && ["ancestor", "replay"].includes(workOnRef(repo, look.ref, listed.head, env, look.replayer));
      scanned.push({
        idleMinutes: idleMinutesOrNull(listed.path, look.now),
        listed,
        state: { finished: false, held: false, why: lockLine(listed, onBase) }
      });
      continue;
    }
    if (listed.prunable || !existsSync14(listed.path)) {
      scanned.push({ idleMinutes: null, listed, state: "gone" });
      continue;
    }
    const idle = idleMinutesOrNull(listed.path, look.now);
    scanned.push({ idleMinutes: idle, listed, state: judgeOne(repo, listed, all, look, idle) });
  }
  return scanned;
}
function removeWorktree(repo, listed, options) {
  let all;
  try {
    all = listWorktrees(repo, options.env);
  } catch {
    return { said: [`kept ${listed.path}: git could not list the worktrees`], status: "kept" };
  }
  const current = all.find((one) => samePath(one.path, listed.path));
  if (current === undefined || !existsSync14(current.path)) {
    return {
      said: [`kept ${listed.path}: its folder is gone \u2014 \`${COMMAND} worktrees\` forgets it`],
      status: "kept"
    };
  }
  const look = lookAt(repo, options);
  if (current.locked && !staleClaudeLock(current, look)) {
    return { said: [`kept ${current.path}: ${lockLine(current)}`], status: "kept" };
  }
  const fresh = judgeOne(repo, current, all, look, idleMinutesOrNull(current.path, look.now));
  if (!fresh.finished) {
    return {
      said: [`kept ${listed.path}: ${fresh.why}`],
      status: fresh.held ? "held" : "kept"
    };
  }
  let released = false;
  const keptAfterUnlock = (removal, path = current.path) => {
    if (!released)
      return removal;
    const relocked = runGit(repo, ["worktree", "lock", "--reason", current.lockReason ?? "", path], options.env);
    removal.said.push(relocked.ok ? `locked ${path} again, with the same reason` : `note: ${path} could not be locked again (${relocked.err}); its removal is not finished`);
    return removal;
  };
  if (current.locked) {
    let check;
    try {
      check = listWorktrees(repo, options.env).find((one) => samePath(one.path, current.path));
    } catch {
      return {
        said: [`kept ${listed.path}: git could not revalidate its stale lock`],
        status: "kept"
      };
    }
    if (check === undefined || check.head !== current.head || check.branch !== current.branch || check.lockReason !== current.lockReason || !staleClaudeLock(check, look)) {
      return { said: [`kept ${listed.path}: lock state changed during removal`], status: "kept" };
    }
    const unlocked = runGit(repo, ["worktree", "unlock", current.path], options.env);
    if (!unlocked.ok) {
      return {
        said: [`kept ${current.path}: stale lock could not be unlocked (${unlocked.err})`],
        status: "kept"
      };
    }
    released = true;
  }
  const alreadyParked = isParkedWorktree(listed.path);
  const parked = alreadyParked ? listed.path : `${listed.path}-removing-${String(Date.now())}`;
  if (!alreadyParked) {
    const moved = runGit(repo, ["worktree", "move", listed.path, parked], options.env);
    if (!moved.ok) {
      if (holdsSubmodule(listed.path, options.env)) {
        return keptAfterUnlock({
          said: [
            `kept ${listed.path}: it holds a git submodule, and git cannot move or remove such a ` + `worktree. Commit and push the work in it, delete the folder by hand, and run ` + `\`${COMMAND} worktrees\` again: a worktree whose folder is gone is forgotten.`
          ],
          status: "kept"
        });
      }
      return keptAfterUnlock({
        said: [
          `kept ${listed.path}: a program may still work in it \u2014 a terminal, a background command, ` + `or an MCP server restarted while a session was in it (${moved.err})`
        ],
        status: "held"
      });
    }
  }
  const removed = runGit(repo, alreadyParked ? ["worktree", "remove", "--force", parked] : ["worktree", "remove", parked], options.env);
  if (!removed.ok) {
    return keptAfterUnlock({
      said: [
        alreadyParked ? `could not remove ${parked}: ${removed.err}` : `moved ${listed.path} to ${parked}, then could not remove it: ${removed.err}`
      ],
      status: "failed"
    }, parked);
  }
  const deleteBranch = options.deleteBranch ?? ((repo_, branch) => deleteBranchOnRef(repo_, options.against?.ref ?? `refs/remotes/origin/${options.base}`, options.against?.label ?? options.base, branch, options.env));
  const said = [
    current.locked ? `unlocked stale Claude lock and removed ${listed.path}` : `removed ${listed.path}`
  ];
  if (listed.branch !== null)
    said.push(deleteBranch(repo, listed.branch));
  return { said, status: "removed" };
}
function deleteBranchOnRef(repo, ref, label, branch, env) {
  const ahead = runGit(repo, ["rev-list", "--count", `${ref}..refs/heads/${branch}`], env);
  if (!ahead.ok) {
    return `kept branch ${branch}: ${ahead.err || `git could not compare it with ${label}`}`;
  }
  if (ahead.out !== "0") {
    const head = runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], env);
    const sha = head.ok ? head.out.trim() : "";
    const elsewhere = COMMIT_SHA.test(sha) && workOnBase(repo, ref, sha, branch, env, replayerFor(repo, env)) !== null;
    if (!elsewhere)
      return `kept branch ${branch}: it has commits that are not on ${label}`;
  }
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? `deleted branch ${branch}` : `kept branch ${branch}: ${deleted.err}`;
}
function deleteMergedBranch(repo, base, branch, env) {
  return deleteBranchOnRef(repo, `refs/remotes/origin/${base}`, base, branch, env);
}
function pruneWorktrees(repo, env) {
  runGit(repo, ["worktree", "prune"], env);
}

// src/setup/launcher-cmd.ts
var FIND_INSTALL_JS2 = [
  "const f=process.argv[process.argv.length-1];",
  "const j=JSON.parse(require('fs').readFileSync(f,'utf8'));",
  `const e=((j&&j.plugins&&j.plugins['${PLUGIN_ID}'])||[]).find(function(x){`,
  "return x&&x.scope==='user'&&typeof x.installPath==='string';});",
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);"
].join("");

// src/tasks/words.ts
var TASK_TOOLS_ALLOW_RULE = `mcp__${TASKS_SERVER_NAME}__*`;
var TASK_COMMAND = `${COMMAND} task`;

// src/crew/transcript.ts
var TAIL_BYTES = 256 * 1024;

// src/crew/archive.ts
var DAY_MS = 24 * 60 * 60 * 1000;

// src/crew/skills.ts
var CREW_SKILL = `${PLUGIN}:crew`;
var LEAD_SKILL = `${PLUGIN}:lead`;

// src/crew/brief.ts
var CREW_COMMAND = `/${CREW_SKILL}`;
var SELF_WATCH_ARGS = "crew self-watch";
var LEAD_WATCH_ARGS = "crew watch";
function literal2(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function monitorCommand(args) {
  const launcher = literal2(COMMAND);
  return new RegExp(`^\\s*(?:"(?:[^"]*[\\\\/])?${launcher}"|(?:[^\\s"]*[\\\\/])?${launcher})\\s+${literal2(args)}\\s*$`);
}
var SELF_WATCH_COMMAND = monitorCommand(SELF_WATCH_ARGS);
var LEAD_WATCH_COMMAND = monitorCommand(LEAD_WATCH_ARGS);
var COMMAND_WRAPPER = new RegExp(`^<command-message>${CREW_SKILL}</command-message>\\r?\\n<command-name>/${CREW_SKILL}</command-name>(?:\\r?\\n<command-args>([\\s\\S]*)</command-args>)?$`);
var REPORT_COMMAND = `${COMMAND} crew report`;
var REPORT_DONE_COMMAND = `${REPORT_COMMAND} --status done --file -`;
var CREW_NEVER_DOES = {
  answer: "answers its lead's questions",
  note: "sends its lead's notes",
  lead: "leads",
  "lead tell": "tells another lead",
  model: "changes a crew session's model or effort",
  resume: "stops, removes or resumes crew sessions",
  start: "starts crew sessions",
  watch: "watches its lead's crew sessions"
};
var CREW_NEVER_RUNS = {
  answer: CREW_NEVER_DOES.answer,
  note: CREW_NEVER_DOES.note,
  lead: CREW_NEVER_DOES.lead,
  "lead tell": CREW_NEVER_DOES["lead tell"],
  model: CREW_NEVER_DOES.model,
  resume: CREW_NEVER_DOES.resume,
  rm: CREW_NEVER_DOES.resume,
  start: CREW_NEVER_DOES.start,
  stop: CREW_NEVER_DOES.resume,
  watch: CREW_NEVER_DOES.watch
};

// src/workflow/merge-check.ts
var PASSING_BUCKETS = new Set(["pass", "skipping"]);

// src/setup/marketplace-access.ts
var TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

// src/issues/marker.ts
var MARKER_PREFIX = `<!-- ${COMMAND}:issue `;

// src/issues/phase-issues.ts
var MAX_PHASE_ISSUES = 10;

// src/crew/report.ts
var issueNumber = number2().int().positive();
var testRunFields = looseObject({
  command: string2().min(1),
  passed: number2().int().min(0),
  failed: number2().int().min(0),
  ok: boolean2()
});
var checkFields = looseObject({
  name: string2().min(1),
  ok: boolean2(),
  note: string2().nullable()
});
var modelReviewFields = looseObject({
  agent: string2().min(1),
  model: string2().min(1),
  effort: string2().min(1),
  findings: array(looseObject({ finding: string2().min(1), fix: string2().min(1) }))
});
var ownReviewFields = looseObject({
  findings: array(looseObject({ finding: string2().min(1), fix: string2().min(1) })),
  reason: string2().min(1)
});
var modelReportSchema = looseObject({
  issues: array(issueNumber).max(MAX_PHASE_ISSUES, `a phase fixes at most ${MAX_PHASE_ISSUES} issues: split it`).default([]),
  tests: looseObject({
    targeted: array(testRunFields).default([]),
    full: testRunFields.nullable().default(null)
  }).default({ targeted: [], full: null }),
  checks: array(checkFields).default([]),
  review: modelReviewFields.nullable().default(null),
  ownReview: ownReviewFields.nullable().default(null),
  docs: array(string2().min(1)).default([]),
  needsLead: array(string2().min(1)).default([]),
  open: array(string2().min(1)).default([]),
  question: string2().nullable().default(null),
  summary: string2().nullable().default(null).transform((value) => value === null || value.trim() === "" ? null : value.trim())
});

// src/crew/runs-actor.ts
function actorOfCaller(ctx, repo) {
  try {
    const session = callingSession(ctx.paths.claudeConfigDir, ctx.pid, ctx.processes.parentOf, ctx.env);
    if (session === null)
      return null;
    const lead = readLead(ctx.paths.stateDir, repo, session.sessionId);
    return lead === null ? null : { name: lead.name, sessionId: lead.sessionId };
  } catch {
    return null;
  }
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

// src/crew/wait.ts
var FIRST_BACKOFF_MS = 5 * 60000;
var MAX_BACKOFF_MS = 20 * 60000;
var REPAUSE_WINDOW_MS = 15 * 60000;

// src/issues/fixed.ts
var MARKER_PREFIX2 = `<!-- ${COMMAND}:fixed `;

// src/issues/pending.ts
var RETRY_MS = 5 * 60000;
var sha2 = string2().regex(/^[0-9a-f]{40}$/);
var pendingSchema = object({
  marks: array(object({
    base: string2().min(1),
    branch: string2().min(1),
    issue: number2().int().positive(),
    merge: sha2.nullable(),
    told: boolean2().default(false),
    tip: sha2,
    triedAt: number2().int().min(0).optional()
  })),
  version: literal(1)
});

// src/issues/feed.ts
var FAR_AHEAD_MIN_MS = 60 * 60000;
var PAGE = 100;
var ISSUES_QUERY = `state=all&sort=created&direction=desc&per_page=${PAGE}`;
var COMMENTS_QUERY = `sort=created&direction=desc&per_page=${PAGE}`;

// src/issues/pickup.ts
var STRIPPED_CONTENT_TAGS = [
  "iframe",
  "math",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "svg",
  "template",
  "xmp"
];
var STRIPPED_OPEN = new RegExp(`<(${STRIPPED_CONTENT_TAGS.join("|")})(?=[\\s/>])[^>]*>`, "gi");
var STRIPPED_PAIRS = new Map(STRIPPED_CONTENT_TAGS.map((tag) => [tag, new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*>`, "gi")]));

// src/setup/retry-watchdog.ts
var RETRY_WATCHDOG_ENV = "CLAUDE_CODE_RETRY_WATCHDOG";
var RETRY_WATCHDOG_VALUE = "1";
var RETRY_WATCHDOG_RECHECK_ENV = "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS";
var RETRY_WATCHDOG_RECHECK_MS = 300000;
var RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_ENV = "CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS";
var RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS = 86400000;
var RETRY_WATCHDOG_KEY = ["env", RETRY_WATCHDOG_ENV];
var RETRY_WATCHDOG_RECHECK_KEY = ["env", RETRY_WATCHDOG_RECHECK_ENV];
var RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_KEY = [
  "env",
  RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_ENV
];
var RETRY_WATCHDOG_SETTINGS = [
  [RETRY_WATCHDOG_KEY, RETRY_WATCHDOG_VALUE],
  [RETRY_WATCHDOG_RECHECK_KEY, String(RETRY_WATCHDOG_RECHECK_MS)],
  [RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_KEY, String(RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS)]
];
var RETRY_WATCHDOG_FLAG = "--retry-watchdog";
var NO_RETRY_WATCHDOG_FLAG = "--no-retry-watchdog";
var RETRY_WATCHDOG_ON_NOTE = `retry watchdog: on, so every Claude session on this machine waits and retries at a limit ` + 'instead of failing ("Retrying in \u2026"; Esc cancels); a limit that resets more than 24 hours ' + `away ends the wait; a \`claude -p\` script can wait until a model answers; to turn it off: ${COMMAND} setup ${NO_RETRY_WATCHDOG_FLAG}`;
var RETRY_WATCHDOG_DECLINED_NOTE = `retry watchdog: off because you said no; ${COMMAND} setup ${RETRY_WATCHDOG_FLAG} turns it on`;

// src/crew/start.ts
var CLASH_STATES = [...RUNNING_STATES, "queued"];

// src/crew/watch.ts
var SELF_WATCH_GRACE_MS = 5 * 60000;
var WATCH_MONITOR_COMMAND = `"$HOME/.local/bin/${COMMAND}" ${LEAD_WATCH_ARGS}`;
var WATCH_RESTART = `start the watch again with Claude Code's Monitor tool (timeout_ms: 1800000; re-arm at once on expiry), command: ${WATCH_MONITOR_COMMAND}`;
var WORKTREE_CONFIRM_MS = 3 * 60000;
var PARKED_PASS_MS = 5 * 60000;
var CONVERSATION_SWEEP_MS = 60 * 60 * 1000;
var conversationSweepAt = new Map;

// src/crew/end.ts
var CLAUDE_END_TIMEOUT_MS = 30000;
var GIT_TIMEOUT_MS = 30000;
var CLAUDE_LOCK_PREFIX = "claude session ";
function lockedByPerson(listed) {
  return listed.locked && !(listed.lockReason ?? "").startsWith(CLAUDE_LOCK_PREFIX);
}
function reasonOf2(error) {
  return error instanceof Error ? error.message : String(error);
}
function refuse(refusal, ctx) {
  for (const line of refusal.lines)
    ctx.error(line);
  return refusal.code;
}
function failure2(...lines) {
  return { code: 1, lines };
}
function relative2(repo, path) {
  return isInside(path, repo) ? path.slice(repo.replace(/\/+$/, "").length + 1) : path;
}
function crewSessionRefusal(command, ctx) {
  const crew = crewIdOf(ctx.env);
  if (crew === null)
    return null;
  return failure2(`crew ${command}: this session is the crew session ${crew}, and a crew session never ${CREW_NEVER_RUNS[command]}`, `Fix: hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`);
}
function actOn(ref, command, ctx) {
  const own = crewSessionRefusal(command, ctx);
  if (own !== null)
    return own;
  const read = readRecords(ctx, false, command);
  if (isRefusal(read))
    return read;
  const found = findCrew(read.records, ref, command);
  return "refusal" in found ? found.refusal : { read, record: found.record };
}
function claudeFailure(ctx, repo, args) {
  const command = `claude ${args.join(" ")}`;
  const binary = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (binary === null)
    return "claude is not on PATH, nor in ~/.local/bin";
  const call = callClaude(claudeDeps(ctx), binary, args, repo, CLAUDE_END_TIMEOUT_MS);
  if (!call.ok)
    return call.why;
  if (call.run.timedOut)
    return `${command} did not answer in time`;
  if (call.run.exitCode === 0)
    return null;
  const said = lastLine(`${call.run.stdout}
${call.run.stderr}`);
  return `${command} failed (exit ${String(call.run.exitCode)})${said === "" ? "" : `: ${said}`}`;
}
function sessionUnknown(ctx, record, shortId = record.shortId) {
  const binary = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (binary === null || shortId === null)
    return false;
  const listed = callClaude(claudeDeps(ctx), binary, ["agents", "--json", "--all"], record.repo, CLAUDE_END_TIMEOUT_MS);
  if (!listed.ok || listed.run.exitCode !== 0)
    return false;
  const rows = parseAgentPresence(listed.run.stdout);
  return rows !== null && agentRow(rows, shortId) === null;
}
async function markState(record, state, text, ctx, change = {}) {
  try {
    await updateCrew(ctx.paths.stateDir, record.repo, record.id, { ...change, state }, ctx.now(), text, null, actorOfCaller(ctx, record.repo));
    return true;
  } catch (error) {
    ctx.error(`crew: the store could not record ${record.name} as ${state}: ${reasonOf2(error)}`);
    return false;
  }
}
async function stopSession(record, ctx) {
  if (record.shortId === null)
    return { ok: false, why: `${record.name} has no session to stop` };
  const stop = claudeFailure(ctx, record.repo, ["stop", record.shortId]);
  const gone = stop !== null && sessionUnknown(ctx, record);
  if (stop !== null && !gone)
    return { ok: false, why: stop };
  const running = RUNNING_STATES.includes(record.state);
  if (!running)
    return { gone, ok: true, state: record.state, stored: true };
  const text = gone ? "its session was gone already" : "stopped by the lead";
  try {
    const result = await updateCrewIfState(ctx.paths.stateDir, record.repo, record.id, RUNNING_STATES, { state: "stopped" }, ctx.now(), text, actorOfCaller(ctx, record.repo));
    return { gone, ok: true, state: result.record.state, stored: true };
  } catch (error) {
    ctx.error(`crew: the store could not record ${record.name} as stopped: ${reasonOf2(error)}`);
    return { gone, ok: true, state: "stopped", stored: false };
  }
}
var LEFTOVER_GRACE_MS = 3000;
var LEFTOVER_STOP_MARK = "stopped its own leftover programs";
function signal(pid, sig) {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}
function procEnviron(pid) {
  try {
    const environment = {};
    for (const entry of readFileSync18(`/proc/${String(pid)}/environ`, "utf8").split("\x00")) {
      const at = entry.indexOf("=");
      if (at > 0)
        environment[entry.slice(0, at)] = entry.slice(at + 1);
    }
    return environment;
  } catch {
    return null;
  }
}
function isTheSessionsOwn(record, pid, environOf) {
  const environment = environOf(pid);
  return environment !== null && crewIdOf(environment) === record.id;
}
function findOwnLeftovers(record, ctx, environOf = procEnviron) {
  const programs = ctx.scanFacts?.programs ?? runningPrograms();
  if (programs === "unknown")
    return { own: [], programs };
  const inside = programsUsing(programs, record.worktree, IGNORE_CASE, ctx.pid);
  if (inside.length === 0)
    return { own: [], programs };
  const rows = agentRows(ctx);
  if (rows === null || isLiveRow(rowOf(rows, record)))
    return { own: [], programs };
  const theirs = inside.every((program) => isTheSessionsOwn(record, program.pid, environOf));
  return { own: theirs ? inside : [], programs };
}
function programsWithoutOwn(found) {
  const { own, programs } = found;
  if (programs === "unknown" || own.length === 0)
    return programs;
  const going = new Set(own.map((one) => one.pid));
  return programs.filter((one) => !going.has(one.pid));
}
async function stopOwnLeftovers(record, found, ctx, startOf = processStartTime) {
  const { own, programs } = found;
  if (programs === "unknown" || own.length === 0)
    return { line: null, programs };
  const known = new Map;
  for (const pid of new Set(own.map((one) => one.pid))) {
    if (pid !== process.pid)
      known.set(pid, startOf(pid));
  }
  const signalled = new Set([...known.keys()].filter((pid) => signal(pid, "SIGTERM")));
  if (signalled.size === 0)
    return { line: null, programs };
  await ctx.sleep(LEFTOVER_GRACE_MS);
  for (const pid of signalled) {
    const born = known.get(pid) ?? null;
    if (born !== null && !processIsGone(pid) && startOf(pid, born) === born)
      signal(pid, "SIGKILL");
  }
  const names = [...new Set(own.map((one) => programName(one)))].sort();
  return {
    line: `${record.name}: ${LEFTOVER_STOP_MARK} (${names.join(", ")})`,
    programs: programs.filter((one) => !signalled.has(one.pid))
  };
}
function chainBaseRef(record, ctx) {
  const seen = new Set;
  let first = record;
  while (first.continues != null) {
    if (seen.has(first.id))
      return { why: "the continuation chain has a cycle" };
    seen.add(first.id);
    const previous = readCrew(ctx.paths.stateDir, record.repo, first.continues);
    if (previous === null)
      return { why: `the continuation's previous record ${first.continues} is missing` };
    first = previous;
  }
  return first.baseRef;
}
function leadRef(record, ctx) {
  let ref;
  let lead;
  try {
    ref = chainBaseRef(record, ctx);
    lead = readLead(ctx.paths.stateDir, record.repo, record.leadSessionId);
  } catch (error) {
    return { why: reasonOf2(error) };
  }
  if (typeof ref !== "string")
    return ref;
  const base = runGit(record.repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], ctx.env, GIT_TIMEOUT_MS);
  if (base.ok) {
    try {
      const checkedOut = listWorktrees(record.repo, ctx.env).find((one) => one.branch === ref);
      return { folder: checkedOut?.path ?? null, label: ref, sha: base.out };
    } catch (error) {
      return { why: reasonOf2(error) };
    }
  }
  if (lead !== null && existsSync15(lead.cwd)) {
    const sha = runGit(lead.cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], ctx.env, GIT_TIMEOUT_MS);
    if (sha.ok) {
      const branch = runGit(lead.cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], ctx.env, GIT_TIMEOUT_MS);
      return {
        folder: lead.cwd,
        label: branch.ok ? branch.out : `HEAD at ${sha.out.slice(0, 7)}`,
        sha: sha.out
      };
    }
  }
  return {
    why: `${record.leadName} has no folder here any more, and ${ref} is no commit: there is no branch to merge into`
  };
}
function mergedIntoBase(record, ctx) {
  if (record.base === null)
    return "unknown";
  const tip = runGit(record.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`], ctx.env, GIT_TIMEOUT_MS);
  if (!tip.ok || tip.out === "")
    return "unknown";
  if (tip.out === record.base.sha)
    return "missing";
  const base = leadRef(record, ctx);
  if ("why" in base)
    return "unknown";
  return workOnRef(record.repo, base.sha, tip.out, ctx.env);
}
function commitsNotOn(repo, lead, branch, env) {
  const count = runGit(repo, ["rev-list", "--count", `${lead.sha}..refs/heads/${branch}`], env, GIT_TIMEOUT_MS);
  return count.ok && /^\d+$/.test(count.out) ? Number(count.out) : null;
}

// src/crew/discard.ts
function pendingDiscardWhy(record) {
  return record.discardPending === undefined ? null : `discard recovery is pending; retry crew rm ${record.id} --discard --yes before resuming or continuing`;
}
function archiveRefOf(record) {
  const attempts = [
    ...record.archiveHistory ?? [],
    ...record.archive === undefined ? [] : [record.archive]
  ];
  let ref = `refs/crew-discarded/${record.id}`;
  let attempt = 1;
  while (attempts.some((one) => one.ref === ref))
    ref = `refs/crew-discarded/${record.id}-${++attempt}`;
  return ref;
}
async function rollbackCrewDiscard(record, ctx) {
  const pending = record.discardPending;
  const archive = record.archive;
  if (pending === undefined || archive === undefined)
    return record;
  const branch = checkedGit(record.repo, ["rev-parse", "--verify", `refs/heads/${record.branch}^{commit}`], ctx);
  if (branch === pending.archivedHead)
    checkedGit(record.repo, ["update-ref", `refs/heads/${record.branch}`, pending.head, pending.archivedHead], ctx);
  else if (branch !== pending.head)
    throw new Error("the crew branch changed after discard was prepared");
  const currentIndex = readFileSync19(pending.indexPath);
  const originalIndex = readFileSync19(pending.indexBackup);
  const preparedIndex = readFileSync19(pending.indexArchived);
  if (!currentIndex.equals(originalIndex)) {
    if (!currentIndex.equals(preparedIndex))
      throw new Error("the crew index changed after discard was prepared");
    const lock = `${pending.indexPath}.lock`;
    const fd = openSync4(lock, "wx", 384);
    try {
      writeFileSync3(fd, originalIndex);
      closeSync4(fd);
      renameSync2(lock, pending.indexPath);
    } catch (error) {
      try {
        closeSync4(fd);
      } catch {}
      try {
        rmSync5(lock, { force: true });
      } catch {}
      throw error;
    }
  }
  const updated = await updateCrew(ctx.paths.stateDir, record.repo, record.id, {
    archive: undefined,
    archiveHistory: [...record.archiveHistory ?? [], archive],
    discardPending: undefined
  }, ctx.now());
  rmSync5(pending.indexBackup, { force: true });
  rmSync5(pending.indexArchived, { force: true });
  return updated;
}
async function completeCrewDiscard(record, ctx) {
  const pending = record.discardPending;
  if (pending === undefined)
    return record;
  const updated = await updateCrew(ctx.paths.stateDir, record.repo, record.id, { discardPending: undefined }, ctx.now());
  rmSync5(pending.indexBackup, { force: true });
  rmSync5(pending.indexArchived, { force: true });
  return updated;
}
var CREW_DISCARD_RETENTION_MS = 30 * 24 * 60 * 60000;
var DISCARD_IGNORED_FILE_MAX_BYTES = 65536;
var DISCARD_IGNORED_TOTAL_MAX_BYTES = 1048576;
var DISCARD_IGNORED_MAX_FILES = 256;
var PREVIEW_FILES = 5;
var PREVIEW_COMMITS = 10;
var TEXT_RULE = `small regular UTF-8 text only (at most ${DISCARD_IGNORED_FILE_MAX_BYTES} bytes each, ${DISCARD_IGNORED_MAX_FILES} files and ${DISCARD_IGNORED_TOTAL_MAX_BYTES} bytes total; no symlinks or binary files)`;
function rawGit(cwd, args, ctx, input) {
  const run = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitEnv(ctx.env),
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true
  });
  if (run.exitCode !== 0 || run.signalCode)
    throw new Error(`git ${args[0]} could not read the work: ${run.stderr.toString().trim()}`);
  return run.stdout;
}
function names(cwd, args, ctx) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawGit(cwd, args, ctx));
  return text.split("\x00").filter((one) => one !== "");
}
function checkedGit(cwd, args, ctx, own = {}) {
  const run = runGit(cwd, args, ctx.env, GIT_TIMEOUT_MS, own);
  if (!run.ok)
    throw new Error(`git ${args[0]} failed: ${run.err}`);
  return run.out;
}
function showFiles(label, files) {
  return `${files.length} ${label}${files.length === 0 ? "" : `: ${files.slice(0, PREVIEW_FILES).map((file) => JSON.stringify(file)).join(", ")}${files.length > PREVIEW_FILES ? ` and ${files.length - PREVIEW_FILES} more` : ""}`}`;
}
function protectedIgnored(record, ctx) {
  const patterns = projectRebuildable(record.repo);
  const roots = localFiles(record.worktree, record.repo, ctx.env, patterns);
  if (roots === null)
    throw new Error("git could not list protected ignored files; nothing archived");
  const files = [];
  let visited = 0;
  const walk = (file) => {
    if (++visited > DISCARD_IGNORED_MAX_FILES * 2)
      throw new Error(`ignored files must be ${TEXT_RULE}`);
    const stat = lstatSync4(join22(record.worktree, file));
    const entry = stat.isDirectory() ? `${file.replace(/\/$/, "")}/` : file;
    if (safeEntry(record.worktree, record.repo, entry, patterns))
      return;
    if (stat.isDirectory())
      for (const name of readdirSync10(join22(record.worktree, file)))
        walk(`${file.replace(/\/$/, "")}/${name}`);
    else
      files.push(file);
  };
  for (const root of roots)
    walk(root.replace(/\/$/, ""));
  return files.sort();
}
function buildCrewDiscardFacts(record, ctx) {
  if (record.released !== undefined && !existsSync16(record.worktree))
    throw new Error("its worktree was released; crew rm --discard makes it again on its kept branch first");
  const head = checkedGit(record.repo, ["rev-parse", "--verify", `refs/heads/${record.branch}^{commit}`], ctx);
  if (record.discardPending !== undefined)
    throw new Error(pendingDiscardWhy(record) ?? "discard recovery is pending");
  const symbolic = checkedGit(record.worktree, ["symbolic-ref", "HEAD"], ctx);
  if (symbolic !== `refs/heads/${record.branch}`)
    throw new Error("the worktree is not on its recorded crew branch");
  const stages = rawGit(record.worktree, ["ls-files", "--stage", "-z"], ctx);
  if (rawGit(record.worktree, ["ls-files", "--unmerged", "-z"], ctx).length > 0)
    throw new Error("the index has unresolved conflicts; resolve them before discarding");
  if (rawGit(record.worktree, ["ls-files", "-v", "-z"], ctx).toString().split("\x00").some((line) => /^[a-zS] /.test(line)))
    throw new Error("the index hides files with assume-unchanged or skip-worktree; make them visible before discarding");
  if (stages.toString().split("\x00").some((line) => line.startsWith("160000 ")))
    throw new Error("a submodule cannot be archived by crew discard; keep the worktree");
  const untracked = names(record.worktree, ["ls-files", "--others", "--exclude-standard", "-z"], ctx);
  const ignoredFiles = protectedIgnored(record, ctx);
  const changedFiles = [
    ...new Set([
      ...names(record.worktree, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"], ctx),
      ...names(record.worktree, ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"], ctx),
      ...untracked
    ])
  ].sort();
  const hash = createHash3("sha256").update(head).update(stages);
  hash.update(rawGit(record.worktree, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--"], ctx));
  hash.update(rawGit(record.worktree, [
    "diff",
    "--cached",
    "--binary",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "HEAD",
    "--"
  ], ctx));
  let ignoredBytes = 0;
  if (ignoredFiles.length > DISCARD_IGNORED_MAX_FILES)
    throw new Error(`ignored files must be ${TEXT_RULE}`);
  for (const file of [...new Set([...changedFiles, ...ignoredFiles])]) {
    hash.update(JSON.stringify(file));
    const path = join22(record.worktree, file);
    let stat;
    try {
      stat = lstatSync4(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        hash.update("deleted");
        continue;
      }
      throw error;
    }
    const ignored = ignoredFiles.includes(file);
    if (ignored) {
      ignoredBytes += stat.size;
      if (!stat.isFile() || stat.size > DISCARD_IGNORED_FILE_MAX_BYTES || ignoredBytes > DISCARD_IGNORED_TOTAL_MAX_BYTES)
        throw new Error(`ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`);
      const bytes = readFileSync19(path);
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`);
      }
      if ([...text].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code === 127 || code < 32 && code !== 9 && code !== 10 && code !== 13;
      }))
        throw new Error(`ignored file ${JSON.stringify(file)} is not safe to archive: ${TEXT_RULE}`);
      hash.update(bytes);
    } else if (stat.isSymbolicLink()) {
      hash.update("symlink").update(readlinkSync5(path));
    } else if (stat.isFile()) {
      const fd = openSync4(path, "r");
      try {
        const chunk = Buffer.alloc(65536);
        let count = readSync2(fd, chunk);
        while (count > 0) {
          hash.update(chunk.subarray(0, count));
          count = readSync2(fd, chunk);
        }
      } finally {
        closeSync4(fd);
      }
    } else
      throw new Error(`file ${JSON.stringify(file)} is not a regular file or symlink; it cannot be archived`);
    hash.update(String(stat.mode));
  }
  const lead = leadRef(record, ctx);
  let count = null;
  let subjects = [];
  if (!("why" in lead)) {
    const counted = runGit(record.repo, ["rev-list", "--count", `${lead.sha}..${head}`], ctx.env, GIT_TIMEOUT_MS);
    if (counted.ok && /^\d+$/.test(counted.out)) {
      count = Number(counted.out);
      subjects = checkedGit(record.repo, ["log", `--max-count=${PREVIEW_COMMITS}`, "--format=%s", `${lead.sha}..${head}`], ctx).split(`
`).filter(Boolean);
    }
  }
  const archiveRef = archiveRefOf(record);
  const lines = [
    `Discard ${record.name}?`,
    `${count ?? "unknown"} unmerged commit${count === 1 ? "" : "s"}${subjects.length === 0 ? "" : ":"}`,
    ...subjects.map((subject) => `  ${subject}`),
    showFiles("uncommitted or untracked files", changedFiles),
    showFiles("files git does not keep", ignoredFiles),
    `Ignored files: ${TEXT_RULE}.`,
    `Stop the session's own leftover programs, archive all work at ${archiveRef}, then remove its worktree, branch and session.`,
    `Recover within 30 days: git branch ${record.branch} ${archiveRef}`,
    "A different staged version is kept in the archive commit's parent; git show <archive>^:<path> reads it."
  ];
  return {
    head,
    archiveRef,
    token: hash.digest("hex"),
    unmergedCommits: { count, subjects },
    changedFiles,
    ignoredFiles,
    lines,
    question: "Archive this work and remove the crew session?"
  };
}
async function archiveCrewDiscard(record, facts, ctx) {
  if (buildCrewDiscardFacts(record, ctx).token !== facts.token)
    throw new Error("the work changed since confirmation; preview and confirm it again");
  const dir = mkdtempSync2(join22(tmpdir2(), "crew-discard-"));
  try {
    const index = join22(dir, "index");
    const own = { GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: "1" };
    const sourceIndex = checkedGit(record.worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"], ctx);
    copyFileSync2(sourceIndex, index);
    const stagedTree = checkedGit(record.worktree, ["write-tree"], ctx, own);
    let parent = facts.head;
    const headTree = checkedGit(record.repo, ["rev-parse", `${facts.head}^{tree}`], ctx);
    if (stagedTree !== headTree)
      parent = checkedGit(record.repo, ["commit-tree", stagedTree, "-p", facts.head, "-m", "discarded staged work in progress"], ctx);
    checkedGit(record.worktree, ["read-tree", facts.head], ctx, own);
    for (const file of [...new Set([...facts.changedFiles, ...facts.ignoredFiles])]) {
      const path = join22(record.worktree, file);
      let stat;
      try {
        stat = lstatSync4(path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          checkedGit(record.worktree, ["update-index", "--force-remove", "--", file], ctx, own);
          continue;
        }
        throw error;
      }
      const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync5(path)) : readFileSync19(path);
      const blob = rawGit(record.repo, ["hash-object", "-w", "--stdin"], ctx, bytes).toString().trim();
      const mode = stat.isSymbolicLink() ? "120000" : (stat.mode & 73) !== 0 ? "100755" : "100644";
      checkedGit(record.worktree, ["update-index", "--add", "--cacheinfo", mode, blob, file], ctx, own);
    }
    const tree = checkedGit(record.worktree, ["write-tree"], ctx, own);
    const commit = checkedGit(record.repo, ["commit-tree", tree, "-p", parent, "-m", "discarded work in progress"], ctx);
    if (buildCrewDiscardFacts(record, ctx).token !== facts.token)
      throw new Error("the work changed while archiving; nothing removed, preview and confirm it again");
    checkedGit(record.repo, ["update-ref", facts.archiveRef, commit, ""], ctx);
    const archive = { ref: facts.archiveRef, head: commit, at: new Date(ctx.now()).toISOString() };
    const indexPath = checkedGit(record.worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"], ctx);
    const indexBackup = join22(crewFilesDir(ctx.paths.stateDir, record.repo, record.id), `discard-index-${commit}.bak`);
    const indexArchived = join22(crewFilesDir(ctx.paths.stateDir, record.repo, record.id), `discard-index-${commit}.new`);
    mkdirSync10(dirname9(indexBackup), { recursive: true, mode: 448 });
    copyFileSync2(sourceIndex, indexBackup);
    copyFileSync2(index, indexArchived);
    const pending = {
      head: facts.head,
      archivedHead: commit,
      indexPath,
      indexBackup,
      indexArchived
    };
    try {
      await updateCrew(ctx.paths.stateDir, record.repo, record.id, { archive, discardPending: pending }, ctx.now());
    } catch (error) {
      checkedGit(record.repo, ["update-ref", "-d", facts.archiveRef, commit], ctx);
      rmSync5(indexBackup, { force: true });
      rmSync5(indexArchived, { force: true });
      throw error;
    }
    try {
      checkedGit(record.repo, ["update-ref", `refs/heads/${record.branch}`, commit, facts.head], ctx);
      const lock = `${indexPath}.lock`;
      const fd = openSync4(lock, "wx", 384);
      try {
        if (!readFileSync19(indexPath).equals(readFileSync19(indexBackup)))
          throw new Error("the index changed during discard");
        writeFileSync3(fd, readFileSync19(indexArchived));
        closeSync4(fd);
        renameSync2(lock, indexPath);
      } catch (error) {
        try {
          closeSync4(fd);
        } catch {}
        try {
          rmSync5(lock, { force: true });
        } catch {}
        throw error;
      }
      return readCrew(ctx.paths.stateDir, record.repo, record.id) ?? record;
    } catch (error) {
      try {
        const current = readCrew(ctx.paths.stateDir, record.repo, record.id);
        if (current?.discardPending === undefined)
          throw new Error("discard recovery record is missing");
        await rollbackCrewDiscard(current, ctx);
      } catch (rollback) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}; ${pendingDiscardWhy({ ...record, discardPending: pending })}; rollback failed: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
      }
      throw error;
    }
  } finally {
    rmSync5(dir, { recursive: true, force: true });
  }
}
async function pruneCrewDiscarded(repo, ctx) {
  const listed = listCrew(ctx.paths.stateDir, repo);
  if (listed.broken.length > 0)
    return [];
  const lines = [];
  for (const record of listed.records) {
    const archives = [
      ...record.archiveHistory ?? [],
      ...record.archive === undefined ? [] : [record.archive]
    ];
    for (const archive of archives) {
      if (record.archive?.ref === archive.ref && record.state !== "discarded")
        continue;
      if (archive.prunedAt !== undefined)
        continue;
      const age = ctx.now() - Date.parse(archive.at);
      if (!Number.isFinite(age) || age <= CREW_DISCARD_RETENTION_MS)
        continue;
      const removed = runGit(repo, ["update-ref", "-d", archive.ref, archive.head], ctx.env, GIT_TIMEOUT_MS);
      if (!removed.ok) {
        ctx.error(`crew discard: could not prune ${archive.ref}: ${removed.err}`);
        continue;
      }
      const history = (record.archiveHistory ?? []).map((one) => one.ref === archive.ref ? { ...one, prunedAt: new Date(ctx.now()).toISOString() } : one);
      await updateCrew(ctx.paths.stateDir, repo, record.id, {
        ...record.archive?.ref === archive.ref ? { archive: { ...archive, prunedAt: new Date(ctx.now()).toISOString() } } : { archiveHistory: history }
      }, ctx.now());
      lines.push(`pruned ${archive.ref} (discarded more than 30 days ago)`);
    }
  }
  return lines;
}

// src/worktrees/auto-clean.ts
var GIT_LOCKS = ["index.lock", "HEAD.lock", "packed-refs.lock"];
function refLockUnder(dir, depth = 0) {
  if (depth > 8)
    return null;
  try {
    for (const entry of readdirSync11(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = refLockUnder(join23(dir, entry.name), depth + 1);
        if (found !== null)
          return found;
      } else if (entry.name.endsWith(".lock")) {
        return entry.name;
      }
    }
  } catch {}
  return null;
}
function gitLockHeld(gitDir) {
  for (const name of GIT_LOCKS) {
    if (existsSync17(join23(gitDir, name)))
      return name;
  }
  return refLockUnder(join23(gitDir, "refs"));
}
function sessionsToKeep(deps, claudeConfigDir) {
  const running = deps.facts?.sessions ?? liveSessions(claudeConfigDir);
  if (deps.keep === undefined)
    return running;
  return [
    ...running,
    { cwd: deps.keep, name: "the session that started the clean", pid: 0, sessionId: "starting" }
  ];
}
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}
function summary(repo, trigger, removed, forgotten, failed, kept, leftovers) {
  const parts = [
    `${repo} (${trigger}): removed ${String(removed.length)}${removed.length === 0 ? "" : ` (${removed.join(", ")})`}`
  ];
  if (forgotten > 0)
    parts.push(`forgot ${String(forgotten)}`);
  if (leftovers.removed.length > 0) {
    parts.push(`finished ${String(leftovers.removed.length)} leftover folder${leftovers.removed.length === 1 ? "" : "s"} (${leftovers.removed.join(", ")})`);
  }
  if (leftovers.kept.length > 0) {
    parts.push(`left ${String(leftovers.kept.length)} leftover folder${leftovers.kept.length === 1 ? "" : "s"} (${leftovers.kept.map((one) => `${one.path}: ${one.why}`).join("; ")})`);
  }
  if (failed.length > 0) {
    parts.push(`could not finish removing ${String(failed.length)} (${failed.map((one) => one.why).join("; ")})`);
  }
  parts.push(`kept ${String(kept)}`);
  return parts.join("; ");
}
async function runAutoClean(repo, trigger, deps) {
  const { env, paths } = deps;
  const log = (line) => {
    try {
      appendLogLine(autoCleanLog(paths.stateDir), line, deps.now());
    } catch {}
  };
  let lock = null;
  try {
    const checkout = locateCheckout(repo, { env });
    if (checkout === null) {
      log(`${repo} (${trigger}): not a git checkout; nothing done`);
      return "failed";
    }
    const project = loadProjectConfig(checkout);
    if (project.config?.worktrees?.autoClean === false) {
      log(`${repo} (${trigger}): worktrees.autoClean is false; nothing done`);
      return "off";
    }
    const main = project.mainCheckout ?? project.root;
    if (!samePath(main, repo)) {
      log(`${repo} (${trigger}): not the main checkout (${main}); nothing done`);
      return "failed";
    }
    const held = gitLockHeld(checkout.commonDir);
    if (held !== null) {
      log(`${main} (${trigger}): git is writing here (${held}); skipped this round`);
      return "git-busy";
    }
    const { base } = baseBranch(checkout, env, main);
    lock = await (deps.hold ?? holdCleanLock)();
    if (lock === null)
      return "busy";
    const files = autoCleanFiles(paths.stateDir, main);
    const now = deps.now();
    if (trigger === "session" && !hourlyDue(readRepoRecord(files), now))
      return "recent";
    recordStart(files, main, now);
    if (!fetchBase(main, base, env)) {
      log(`${main} (${trigger}): could not fetch origin/${base}; judging against the copy here`);
    }
    const judged = {
      base,
      claudeConfigDir: paths.claudeConfigDir,
      env,
      now,
      facts: { ...deps.facts, sessions: sessionsToKeep(deps, paths.claudeConfigDir) }
    };
    const scanned = scanWorktrees(main, judged);
    const strays = strayParkedFolders(main, env);
    const crewContext = deps.crewContext ?? cleanupCrewContext(paths, env, main, judged.facts, deps.now);
    const orphaned = await orphanCrewOf(crewContext);
    for (const line of await pruneCrewDiscarded(main, crewContext))
      log(line);
    const crewRecords = orphaned.records;
    const orphanPass = await cleanOrphanCrew(crewContext, orphaned, { label: base, ref: `refs/remotes/origin/${base}` }, log);
    const report = cleanFinished(main, scanned, judged, () => {
      return;
    }, (one) => isCrewWorktree(one, crewRecords));
    report.removed.push(...orphanPass.removed);
    report.kept = report.kept.filter((one) => !orphanPass.removed.some((removed) => samePath(removed.path, one.path)));
    recordRun2(files, main, { base, kept: report.kept, now, removed: report.removed });
    const leftovers = finishStrays(main, judged, () => {
      return;
    }, strays);
    log(summary(main, trigger, report.removed.map((one) => one.name), report.forgotten.length, report.failed, report.kept.length, leftovers));
    return "cleaned";
  } catch (error) {
    log(`${repo} (${trigger}): error: ${messageOf2(error)}`);
    return "failed";
  } finally {
    lock?.close();
  }
}

// src/entries/worktrees-clean.ts
var [repo, said, keep] = process.argv.slice(2);
var trigger = AUTO_CLEAN_TRIGGERS.find((one) => one === said);
if (repo === undefined || trigger === undefined) {
  console.error(`${COMMAND} worktrees clean: expected <repo> <${AUTO_CLEAN_TRIGGERS.join("|")}> [<session folder>], got: ${process.argv.slice(2).join(" ")}`);
  process.exit(2);
}
await runAutoClean(repo, trigger, {
  env: process.env,
  ...keep !== undefined && { keep },
  now: () => Date.now(),
  paths: cliPaths(process.env)
});
process.exit(0);
