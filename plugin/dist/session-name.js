// @bun
// src/hooks/run.ts
import { appendFileSync } from "fs";

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

// src/project/config.ts
import { existsSync, readFileSync } from "fs";

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
function toDotPath(_path) {
  const segs = [];
  const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error) {
  const lines = [];
  const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue of issues) {
    lines.push(`\u2716 ${issue.message}`);
    if (issue.path?.length)
      lines.push(`  \u2192 at ${toDotPath(issue.path)}`);
  }
  return lines.join(`
`);
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
  gb: number2().int().min(0).max(1024),
  filesGb: number2().int().min(0).max(1024).optional(),
  maxFiles: number2().int().min(1).optional(),
  printOnly: array(string2().min(1)).optional(),
  skipWords: array(string2().min(1)).optional(),
  valuedFlags: array(string2().min(1)).optional(),
  workers: strictObject({
    flag: string2().min(1),
    aliases: array(string2().min(1)).optional(),
    gbEach: number2().positive()
  }).optional(),
  match: array(matchRuleSchema).optional(),
  about: string2().min(1).optional()
});
var KIND_NAME = /^[a-z0-9][a-z0-9:._-]*$/;
var kindsSchema = record(string2().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"), kindSpecSchema);
var TSC_PRINT_ONLY = ["--help", "--listfilesonly", "--showconfig", "--version", "-h", "-v"];
var TEST_PRINT_ONLY = ["--help", "--version", "-h", "-v"];
var VALUED = ["--config", "-c", "--max-warnings", "--reporter", "--project", "--root"];
var TEST_WORKERS = { flag: "--maxWorkers", aliases: ["--max-workers"], gbEach: 0.5 };
var DEFAULT_KINDS = {
  tsc: {
    about: "A TypeScript type check (tsc, tsgo, vue-tsc).",
    gb: 8,
    printOnly: TSC_PRINT_ONLY,
    match: [{ tool: "tsc" }, { tool: "tsgo" }, { tool: "vue-tsc" }]
  },
  "lint:typed": {
    about: "A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
    gb: 12,
    filesGb: 6,
    valuedFlags: VALUED,
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "eslint", argIncludes: "typed" },
      { tool: "eslint", argIncludes: "type-checked" },
      { tool: "oxlint", flags: ["--type-aware"] }
    ]
  },
  "test:coverage": {
    about: "A test run with coverage (vitest or jest with --coverage).",
    gb: 12,
    printOnly: TEST_PRINT_ONLY,
    workers: TEST_WORKERS,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" }
    ]
  },
  "test:run": {
    about: "A test run (vitest, jest). Up to 3 existing files: the small size.",
    gb: 8,
    filesGb: 2,
    maxFiles: 3,
    skipWords: ["run"],
    valuedFlags: VALUED,
    printOnly: TEST_PRINT_ONLY,
    workers: TEST_WORKERS,
    match: [{ tool: "vitest" }, { tool: "jest" }]
  },
  build: {
    about: "A framework production build (next build).",
    gb: 14,
    match: [{ tool: "next", sub: ["build"] }]
  },
  "image:build": {
    about: "A container image build (docker, podman, compose).",
    gb: 14,
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

// src/workers/names.ts
var MAX_SESSION_NAME = 60;
var MAX_TAG = 12;
var MAX_PHASE = 8;
var MAX_SLUG = 32;
var LEAD_ROLE = "LEAD";
var WORKER_ROLE = "W";
function cleanSessionName(raw) {
  const firstLine = raw.split(/\r?\n|\r/)[0] ?? "";
  const plain = firstLine.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (plain === "")
    return null;
  return [...plain].slice(0, MAX_SESSION_NAME).join("").trimEnd();
}
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
var LEAD_SHAPE = new RegExp(`^${LEAD_ROLE}( ${PART}){1,2}$`);
var WORKER_SHAPE = new RegExp(`^${WORKER_ROLE}( ${PART}){2,4}$`);

// src/workflow/schema.ts
var ALERT_EVENTS = ["needs-you", "question", "finished", "failed"];
var alertEventsSchema = array(_enum(ALERT_EVENTS)).min(1).refine((events) => new Set(events).size === events.length, "an event is listed twice");
var PERCENT = { kind: "whole", max: 100, min: 1 };
var AT_LEAST_ONE = { kind: "whole", min: 1 };
var AT_LEAST_ZERO = { kind: "whole", min: 0 };
var ABOVE_ZERO = { kind: "positive" };
function numberSchema(rule) {
  if (rule.kind === "positive")
    return number2().positive();
  const whole = number2().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}
var NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "workers.idleStopMinutes": AT_LEAST_ONE,
  "workers.max": AT_LEAST_ONE,
  "workers.maxOpus": AT_LEAST_ONE,
  "workers.memoryGb": ABOVE_ZERO,
  "workers.quietMinutes": AT_LEAST_ONE,
  "workers.handoffPercent": PERCENT,
  "workers.softHours": ABOVE_ZERO,
  "workers.maxHours": ABOVE_ZERO,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO
};
function numberField(key) {
  return numberSchema(NUMBER_RULES[key]).optional();
}
var tagSchema = string2().refine(isNameTag, TAG_RULE);
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
  alerts: strictObject({
    events: alertEventsSchema.optional(),
    sound: boolean2().optional(),
    usagePercent: numberField("alerts.usagePercent")
  }).optional(),
  workers: strictObject({
    enabled: boolean2().optional(),
    idleStopMinutes: numberField("workers.idleStopMinutes"),
    max: numberField("workers.max"),
    maxOpus: numberField("workers.maxOpus"),
    memoryGb: numberField("workers.memoryGb"),
    quietMinutes: numberField("workers.quietMinutes"),
    handoffPercent: numberField("workers.handoffPercent"),
    softHours: numberField("workers.softHours"),
    maxHours: numberField("workers.maxHours"),
    tag: tagSchema.optional()
  }).optional()
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
  alerts: {
    events: [...ALERT_EVENTS],
    sound: false,
    usagePercent: 85
  },
  workers: {
    enabled: false,
    idleStopMinutes: 10,
    max: 6,
    maxOpus: 2,
    memoryGb: 2,
    quietMinutes: 20,
    handoffPercent: 70,
    softHours: 2,
    maxHours: 4,
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
  "alerts.events",
  "alerts.sound",
  "alerts.usagePercent",
  "workers.enabled",
  "workers.idleStopMinutes",
  "workers.max",
  "workers.maxOpus",
  "workers.memoryGb",
  "workers.quietMinutes",
  "workers.handoffPercent",
  "workers.softHours",
  "workers.maxHours",
  "workers.tag"
];
var SWITCH_KEYS = SWITCH_NAMES.map((name) => `switches.${name}`);
var WORKFLOW_KEYS = [...POLICY_KEYS, ...SWITCH_KEYS];
function workflowValue(workflow, key) {
  const [head, tail] = key.split(".");
  if (head === undefined || tail === undefined)
    return workflow[head ?? ""];
  const group = workflow[head];
  if (typeof group !== "object" || group === null)
    return;
  return group[tail];
}

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
  "job-route",
  "after-merge",
  "review-record",
  "worktree-leftovers",
  "session-name"
];
var RETIRED_HOOK_NAMES = ["serena-root"];
var RETIRED_WORKTREE_FIELDS = ["prefix", "setup", "engine"];
var ccSmartDevKitConfigSchema = strictObject({
  requires: string2().refine(isValidRange, 'not a valid version range (like ">=1.2" or "^1.2")').optional(),
  worktrees: strictObject({
    base: string2().min(1),
    guardMainFolder: boolean2().optional(),
    bases: record(string2(), string2().min(1)).refine((bases) => Object.keys(bases).every((prefix) => prefix.endsWith("/")), {
      error: (issue) => {
        const given = issue.input;
        const wrong = typeof given === "object" && given !== null ? Object.keys(given).find((prefix) => !prefix.endsWith("/")) : undefined;
        return `"${wrong ?? "a prefix"}" must end with "/" (a branch-name prefix, like "release/")`;
      }
    }).optional()
  }).optional(),
  protectedBranches: array(string2().min(1)).min(1).optional(),
  sessionNames: boolean2().optional(),
  instructions: boolean2().optional(),
  autoMode: array(string2().min(1)).optional(),
  jobs: strictObject({ kinds: kindsSchema.optional(), route: boolean2().optional() }).optional(),
  workflow: workflowSchema.optional(),
  ownHooks: array(_enum([...PLUGIN_HOOK_NAMES, ...RETIRED_HOOK_NAMES])).optional()
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
function readOwnHooks(file) {
  if (!existsSync(file))
    return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return [];
    const listed = raw.ownHooks;
    return Array.isArray(listed) ? listed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}
function loadCcSmartDevKitConfig(file, pluginVersion = VERSION) {
  if (!existsSync(file))
    return null;
  return parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file, pluginVersion);
}
function parseCcSmartDevKitConfig(text, where, pluginVersion = VERSION) {
  let raw;
  try {
    raw = JSON.parse(text);
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
import { existsSync as existsSync2, realpathSync, statSync } from "fs";
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

// src/project/resolve.ts
var MIN_GIT_VERSION = "2.31.0";
var RESOLVE_GIT_TIMEOUT_MS = 5000;
var GIT_NOT_FOUND = "git was not found, so this project's own values cannot be read. Install git, then try again.";
function gitIn(cwd, env, timeoutMs = RESOLVE_GIT_TIMEOUT_MS) {
  return (args) => {
    try {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString()
      };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw /not found in \$PATH|ENOENT/.test(why) ? new Error(GIT_NOT_FOUND) : error;
    }
  };
}
function requireGitVersion(git) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(git(["--version"]).stdout);
  if (!match)
    return;
  const version = `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
  if (Bun.semver.order(version, MIN_GIT_VERSION) < 0) {
    throw new Error(`git 2.31 or newer is needed; you have git ${version}. Update git.`);
  }
}
function findMainCheckout(git, cwd) {
  const list = git(["worktree", "list", "--porcelain"]);
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
function locateCheckout(cwd, options = {}) {
  if (!existsSync2(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const git = gitIn(cwd, gitEnv(options.env ?? process.env));
  const revParse = git([
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir"
  ]);
  const [top, gitDir, common] = revParse.stdout.trim().split(`
`);
  if (!revParse.ok || top?.startsWith("--")) {
    requireGitVersion(git);
    if (revParse.ok) {
      throw new Error("git did not understand rev-parse --path-format: git 2.31 or newer is needed.");
    }
    return null;
  }
  if (!top || !gitDir || !common)
    return null;
  const root = realpathSync(top);
  const commonDir = realpathSync(common);
  const isWorktree = realpathSync(gitDir) !== commonDir;
  const mainCheckout = isWorktree ? findMainCheckout(git, cwd) : root;
  return { root, commonDir, isWorktree, mainCheckout };
}
function ownHooksOf(checkout) {
  const { root, mainCheckout } = checkout;
  const own = readOwnHooks(join3(root, ".claude", "cc-smart-dev-kit.json"));
  if (own !== null)
    return own;
  if (mainCheckout === null || mainCheckout === root)
    return [];
  return readOwnHooks(join3(mainCheckout, ".claude", "cc-smart-dev-kit.json")) ?? [];
}
function loadProjectConfig(checkout, pluginVersion) {
  const { root, mainCheckout } = checkout;
  const own = join3(root, ".claude", "cc-smart-dev-kit.json");
  let config = loadCcSmartDevKitConfig(own, pluginVersion);
  let configFile = config === null ? null : own;
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    const main = join3(mainCheckout, ".claude", "cc-smart-dev-kit.json");
    config = loadCcSmartDevKitConfig(main, pluginVersion);
    configFile = config === null ? null : main;
  }
  return { ...checkout, config, configFile };
}
var CONFIG_PATH = ".claude/cc-smart-dev-kit.json";
function readCommittedConfig(checkout, branch, options = {}) {
  const ref = `origin/${branch}`;
  const where = `${ref}:${CONFIG_PATH}`;
  const git = gitIn(checkout.root, gitEnv(options.env ?? process.env), options.timeoutMs);
  const commit = git(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`]);
  if (!commit.ok) {
    return {
      found: false,
      where,
      why: `${ref} is not known in this repository (no origin, or the branch was never fetched)`
    };
  }
  const blob = git(["rev-parse", "--verify", "--quiet", `${commit.stdout.trim()}:${CONFIG_PATH}`]);
  if (!blob.ok)
    return { found: false, where, why: `${ref} has no ${CONFIG_PATH} committed` };
  const text = git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok)
    return { found: false, where, why: `git could not read ${where}` };
  return {
    found: true,
    where,
    config: parseCcSmartDevKitConfig(text.stdout, where, options.pluginVersion)
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
function addContext(event, text) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text }
    })
  };
}
function systemMessage(text) {
  return { stdout: JSON.stringify({ systemMessage: text }) };
}

// src/hooks/run.ts
var HOOK_LOG_ENV = "CC_SMART_DEV_KIT_HOOK_LOG";
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function handleHook(spec, text, env) {
  try {
    const input = parseHookInput(text);
    if (input === null) {
      return {
        exitCode: spec.crashExitCode ?? 0,
        stderr: `cc-smart-dev-kit ${spec.name}: the hook input is not JSON`
      };
    }
    const event = stringField(input.hook_event_name);
    if (event === null || !spec.events.includes(event))
      return SILENT;
    const cwd = stringField(input.cwd);
    const context = { env, paths: cliPaths(env) };
    const outside = spec.outsideGit ?? (() => SILENT);
    if (cwd === null)
      return outside(input, event, "the hook input has no cwd", context);
    let checkout;
    try {
      checkout = locateCheckout(cwd, { env });
    } catch (error) {
      return outside(input, event, errorMessage(error), context);
    }
    if (checkout === null)
      return outside(input, event, `${cwd} is not in a git checkout`, context);
    if (ownHooksOf(checkout).includes(spec.name))
      return SILENT;
    let project;
    try {
      project = loadProjectConfig(checkout);
    } catch (error) {
      if (error instanceof CcSmartDevKitConfigError) {
        return spec.onConfigProblem(error.message, input, event, checkout, context);
      }
      throw error;
    }
    return await spec.run({ input, event, cwd, project, env, paths: context.paths });
  } catch (error) {
    return {
      exitCode: spec.crashExitCode ?? 0,
      stderr: `cc-smart-dev-kit ${spec.name}: ${errorMessage(error)}`
    };
  }
}
function logRun(spec, text, result, env) {
  const file = env[HOOK_LOG_ENV];
  if (file === undefined || file === "")
    return;
  try {
    const input = parseHookInput(text);
    const facts = input === null ? {} : spec.logFacts?.(input, { env, paths: cliPaths(env) }) ?? {};
    appendFileSync(file, `${JSON.stringify({
      hook: spec.name,
      event: stringField(input?.hook_event_name),
      cwd: stringField(input?.cwd),
      exitCode: result.exitCode ?? 0,
      stdout: (result.stdout ?? "").slice(0, 2000),
      ...Object.keys(facts).length === 0 ? {} : { facts }
    })}
`);
  } catch {}
}
async function runHookEntry(spec) {
  const text = await Bun.stdin.text();
  const result = await handleHook(spec, text, process.env);
  logRun(spec, text, result, process.env);
  if (result.stdout !== undefined)
    await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined)
    await Bun.write(Bun.stderr, `${result.stderr}
`);
  process.exit(result.exitCode ?? 0);
}

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
function isOwnerOnly(mode, platform = hostPlatform()) {
  return platform === "win32" || (mode & 63) === 0;
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
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function shellWord(path) {
  return /^[\w./-]+$/.test(path) ? path : shellQuote(path);
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
function lex(text, options) {
  const { blind, dialect, join } = options;
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const segments = [];
  const piped = [];
  const owed = [];
  let open = false;
  let unparsable = false;
  let at = 0;
  let afterPipe = false;
  let matching = null;
  let semicolons = null;
  const push = (piece, from) => {
    segments.push(piece);
    piped.push(from);
  };
  function addInner(inner, body) {
    const depth = (options.depth ?? 0) + 1;
    if (depth > MAX_INNER) {
      open = true;
      return;
    }
    const read = lex(inner, { blind, dialect, join, body: body && !blind, depth });
    if (read.open)
      open = true;
    if (read.unparsable)
      unparsable = true;
    for (let i = 0;i < read.segments.length; i++) {
      push(read.segments[i] ?? "", read.piped[i] ?? null);
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
      if (script)
        addInner(text.slice(at, bodyEnd), false);
      else if (!quoted)
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
  function readDouble(closes) {
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
      } else if (char === "$" && next === "(") {
        const end = bash ? arithmeticEnd(at + 1) : -1;
        if (end === -1) {
          at += 2;
          raw += `$(${read(true)}`;
        } else {
          raw += readArithmetic(end);
        }
      } else if (bash && char === "`") {
        raw += readBacktick();
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
  function isGroupBrace(char, wordStart) {
    if (char !== "{" && char !== "}")
      return false;
    if (!bash)
      return true;
    const after = text.charAt(at + 1);
    return wordStart && (after === "" || /\s/.test(after) || char === "}" && /[;&|)]/.test(after));
  }
  function read(nested) {
    let raw = "";
    let current = "";
    let depth = 0;
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
          take(readDouble(true));
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
      if (SEPARATORS.has(char) || isGroupBrace(char, wordStart) || blind && bash && char === "`") {
        push(current, afterPipe ? segments[segments.length - 1] ?? null : null);
        afterPipe = char === "|";
        if (nested && char === ")" && depth === 0) {
          at++;
          return `${raw})`;
        }
        if (nested && char === "(")
          depth++;
        if (nested && char === ")")
          depth--;
        current = "";
        stdinShell = null;
        raw += char;
        at++;
        wordStart = true;
        afterClose = char === ")";
        if (char === `
`)
          skipBodies();
        continue;
      }
      take(char, isBlank(char));
      at++;
    }
    push(current, afterPipe ? segments[segments.length - 1] ?? null : null);
    return raw;
  }
  if (options.body === true)
    readDouble(false);
  else
    read(false);
  return { open, piped, segments, unparsable };
}
function shellSteps(command, { blindWhenOpen = false, dialect = "bash", joinLines = false } = {}) {
  const read = lex(command, { blind: false, dialect, join: joinLines });
  if (read.unparsable)
    return [];
  const chosen = read.open && blindWhenOpen ? lex(command, { blind: true, dialect, join: joinLines }) : read;
  return chosen.segments.map((text, index) => ({ text, pipedFrom: chosen.piped[index] ?? null }));
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
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const words = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  const end = () => {
    if (inWord)
      words.push(word);
    word = "";
    inWord = false;
    quoted = false;
  };
  const add = (piece) => {
    word += piece;
    inWord = true;
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
    } else if (char === "<" || char === ">") {
      if (quoted || !/^\d+$/.test(word))
        end();
      while (oneOf("<>", segment.charAt(i)))
        add(segment.charAt(i++));
      if (oneOf("&|", segment.charAt(i)))
        add(segment.charAt(i++));
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
        add(inside);
        i++;
      }
      i++;
    } else {
      add(char);
      i++;
    }
  }
  end();
  return words;
}
var KEYWORDS = new Set(["!", "do", "done", "elif", "else", "fi", "if", "then", "until", "while"]);
var ASSIGNMENT = /^[A-Za-z_]\w*=/;
var REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|>&|&>)(.*)$/s;
var DURATION = (word) => /^\d+(?:\.\d+)?[smhd]?$/.test(word);
var WRAPPERS = {
  builtin: { long: [], short: "" },
  command: { inert: ["-v", "-V"], long: [], short: "" },
  doas: { long: [], short: "uC" },
  env: {
    long: ["--unset", "--chdir", "--split-string"],
    short: "uCS",
    split: { long: "--split-string", short: "S" }
  },
  exec: { long: [], short: "a" },
  ionice: { long: ["--class", "--classdata", "--pid", "--pgid"], short: "cnpPu" },
  nice: { long: ["--adjustment"], short: "n" },
  nohup: { long: [], short: "" },
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
  time: { long: [], short: "" },
  timeout: { long: ["--signal", "--kill-after"], short: "sk", skip: DURATION },
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
var SHELLS = new Set(["bash", "dash", "sh", "zsh"]);
function programName(word) {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
}
function shortFlags(arg, valued) {
  let flags = "";
  for (let i = 1;i < arg.length; i++) {
    const letter = arg.charAt(i);
    flags += letter;
    if (valued.includes(letter))
      return { flags, wantsNext: i === arg.length - 1 };
  }
  return { flags, wantsNext: false };
}
function isShort(arg) {
  return /^-[^-]/.test(arg);
}
function afterWrapper(words, from, spec) {
  let index = from;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--")
      return { index: index + 1 };
    if (!isShort(word) && !word.startsWith("--"))
      break;
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
    index += wantsNext ? 2 : 1;
  }
  return { index: spec.skip?.(words[index] ?? "") === true ? index + 1 : index };
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
    index = after.split === undefined ? after.index : after.split.to;
  }
  const first = list[index];
  if (first === undefined)
    return;
  return { args: list.slice(index + 1), prefix: list.slice(0, index), program: programName(first) };
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
function nestedCommand(program, args, pipedFrom = null) {
  if (SHELLS.has(program)) {
    const script = shellCommandString(args);
    if (script !== undefined)
      return script;
    if (!shellTakesStdin(args))
      return;
    const here = args.findIndex((arg) => arg === "<<<" || arg.startsWith("<<<"));
    if (here !== -1) {
      const word = args[here] ?? "";
      return word.length > 3 ? word.slice(3) : args.slice(here + 1).join(" ");
    }
    return pipedFrom === null ? undefined : writtenText(pipedFrom) ?? undefined;
  }
  if (program === COMMAND && args[0] === "job" && args[1] === "run") {
    const dashes = args.indexOf("--");
    return dashes === -1 || dashes === args.length - 1 ? undefined : args.slice(dashes + 1).map(shellQuote).join(" ");
  }
  if (program === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return at === -1 ? undefined : args.slice(at + 1).join(" ");
  }
  if (program === "powershell" || program === "pwsh") {
    const at = args.findIndex((arg) => arg.length > 1 && "-command".startsWith(arg.toLowerCase()));
    return at === -1 ? undefined : args.slice(at + 1).join(" ");
  }
  if (program === "eval" || program === "iex" || program === "invoke-expression") {
    return args.join(" ");
  }
  return;
}
function nestedDialect(program) {
  return ["iex", "invoke-expression", "powershell", "pwsh"].includes(program) ? "powershell" : "bash";
}
function programsOf(command, dialect) {
  if (dialect !== undefined)
    return programsIn(command, dialect);
  const found = programsIn(command, "bash");
  const left = [...found];
  for (const program of programsIn(command, "powershell")) {
    const at = left.indexOf(program);
    if (at === -1)
      found.push(program);
    else
      left.splice(at, 1);
  }
  return found;
}
function programsIn(command, dialect) {
  const found = [];
  const walk = (line, one, depth) => {
    for (const step of shellSteps(line, { blindWhenOpen: true, dialect: one, joinLines: true })) {
      const invocation = invocationOf(wordsOf(step.text, one));
      if (invocation === undefined)
        continue;
      found.push(invocation.program);
      const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
      if (inner !== undefined && depth < MAX_NESTING) {
        walk(inner, nestedDialect(invocation.program), depth + 1);
      }
    }
  };
  walk(command, dialect, 0);
  return found;
}

// src/jobs/classify.ts
var BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
var NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
var PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
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
  "test",
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
        return name === undefined ? undefined : scriptOrTool(name, args.slice(nameAt + 1));
      }
      if (BUN_COMMANDS.has(sub))
        return;
      return scriptOrTool(sub, args.slice(index + 1));
    }
    case "npm": {
      const index = at([]);
      const sub = args[index];
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "x")
        return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t")
        return { name: "", args: rest, script: "test" };
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        if (name === undefined)
          return;
        return { name: "", args: rest.slice(nameAt + 1), script: name };
      }
      return;
    }
    case "pnpm":
    case "yarn": {
      const index = at(PNPM_VALUED);
      const sub = args[index];
      if (sub === undefined)
        return;
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "dlx")
        return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t")
        return { name: "", args: rest, script: "test" };
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        return name === undefined ? undefined : scriptOrTool(name, rest.slice(nameAt + 1));
      }
      return scriptOrTool(sub, rest);
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
function printsOnly(kind, args) {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  return printOnly.size > 0 && args.length > 0 && args.every((arg) => printOnly.has(arg.toLowerCase()));
}
function ruleMatches(rule, call) {
  if ("script" in rule)
    return call.script === rule.script;
  if (call.name !== rule.tool)
    return false;
  const valued = [...TOOL_VALUED[rule.tool] ?? [], ...rule.valued ?? []];
  if (rule.sub !== undefined && !startsWithSub(call.args, rule.sub, valued))
    return false;
  if (rule.flags !== undefined && !rule.flags.every((flag) => hasFlag(call.args, flag))) {
    return false;
  }
  const text = rule.argIncludes?.toLowerCase();
  return text === undefined || call.args.some((arg) => arg.toLowerCase().includes(text));
}
function kindOfCall(call, kinds) {
  let best = null;
  for (const [name, kind] of Object.entries(kinds)) {
    const heavy = (kind.match ?? []).some((rule) => ruleMatches(rule, call) && (("script" in rule) || !printsOnly(kind, call.args)));
    if (heavy && (best === null || kind.gb > best.gb))
      best = { name, gb: kind.gb };
  }
  return best;
}
function inspect(command, kinds, dialect, depth) {
  const found = [];
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  for (const step of steps) {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined)
      continue;
    const { program, args } = invocation;
    const call = toolOf(program, withoutRedirections(args));
    const kind = call === undefined ? null : kindOfCall(call, kinds);
    if (kind !== null)
      found.push(kind);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      found.push(...inspect(inner, kinds, nestedDialect(program), depth + 1));
    }
  }
  return found;
}
function classifyHeavyCommand(bashCommand, kinds) {
  let best = null;
  for (const kind of inspect(bashCommand, kinds, "bash", 0)) {
    if (best === null || kind.gb > best.gb)
      best = kind;
  }
  return best?.name ?? null;
}

// src/workflow/reviews.ts
import { createHash } from "crypto";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "fs";
import { dirname as dirname2, join as join6 } from "path";

// src/setup/lock.ts
import {
  closeSync as closeSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readFileSync as readFileSync3,
  readlinkSync as readlinkSync2,
  statSync as statSync3,
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
    stat = statSync3(file);
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
    fd = openSync2(file, "wx", mode);
  } catch (error) {
    if (error.code === "EEXIST")
      return false;
    throw error;
  }
  try {
    setFileMode(fd, mode);
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync2(fd);
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
      unlinkSync2(file);
  }
}

// src/workflow/reviews.ts
var REVIEWS_KEPT = 50;
var REVIEWS_LOCK_WAIT_MS = 3000;
var START_KEPT_MS = 24 * 60 * 60 * 1000;
var BY_HAND = "workflow review-done";
var COMMIT_SHA = /^[0-9a-f]{40,64}$/;
function recordsReview(agent, agents) {
  return agents.some((name) => name === agent);
}
function repoKey(repo) {
  return createHash("sha256").update(repo).digest("hex").slice(0, 16);
}
function reviewsFile(stateDir, repo) {
  return join6(stateDir, "reviews", `${repoKey(repo)}.json`);
}
function reviewStartsFile(stateDir, repo) {
  return join6(stateDir, "reviews", `${repoKey(repo)}.starts.json`);
}
function readObject(file) {
  try {
    const parsed = JSON.parse(readFileSync4(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0)
    return null;
  return value.every((one) => typeof one === "string" && one !== "") ? value : null;
}
function readReviews(file) {
  const record = {};
  for (const [sha, entry] of Object.entries(readObject(file))) {
    if (!COMMIT_SHA.test(sha) || typeof entry !== "object" || entry === null)
      continue;
    const { at, by, branches } = entry;
    const writers = stringList(by);
    if (typeof at !== "string" || writers === null)
      continue;
    const named = stringList(branches);
    record[sha] = named === null ? { at, by: writers } : { at, by: writers, branches: named };
  }
  return record;
}
function trusted(entry, agents) {
  return entry.by.some((by) => by === BY_HAND || recordsReview(by, agents));
}
function hasReview(file, sha, agents) {
  const entry = readReviews(file)[sha];
  return entry !== undefined && trusted(entry, agents);
}
async function underRecordLock(file, write) {
  const folder = dirname2(file);
  mkdirSync3(folder, { mode: 448, recursive: true });
  return await withLock(folder, write, { waitMs: REVIEWS_LOCK_WAIT_MS });
}
async function recordReview(file, sha, by, atMs, branch = null) {
  return await underRecordLock(file, () => {
    const record = readReviews(file);
    const before = record[sha];
    const branches = before?.branches ?? [];
    const newBranch = branch !== null && branch !== "" && !branches.includes(branch);
    if (before?.by.includes(by) && !newBranch)
      return { added: false, at: before.at };
    const at = before?.at ?? new Date(atMs).toISOString();
    const writers = before?.by.includes(by) ? before.by : [...before?.by ?? [], by];
    const named = newBranch ? [...branches, branch] : branches;
    record[sha] = named.length === 0 ? { at, by: writers } : { at, by: writers, branches: named };
    const kept = {};
    for (const [commit, entry] of Object.entries(record).sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, REVIEWS_KEPT)) {
      kept[commit] = entry;
    }
    atomicWrite(file, `${JSON.stringify(kept, null, 2)}
`, 384);
    return { added: true, at };
  });
}
function agentIdKey(agentId) {
  const key = agentId.replace(/^agent-/, "");
  return key === "" ? null : key;
}
function readStarts(file) {
  const starts = {};
  for (const [key, entry] of Object.entries(readObject(file))) {
    if (typeof entry !== "object" || entry === null)
      continue;
    const { head, at, branch } = entry;
    if (typeof head === "string" && COMMIT_SHA.test(head) && typeof at === "number") {
      starts[key] = typeof branch === "string" && branch !== "" ? { head, at, branch } : { head, at };
    }
  }
  return starts;
}
async function noteReviewStart(file, agentId, head, atMs, branch = null) {
  const key = agentIdKey(agentId);
  if (key === null)
    return;
  await underRecordLock(file, () => {
    const starts = readStarts(file);
    const kept = {};
    for (const [one, start] of Object.entries(starts)) {
      if (atMs - start.at <= START_KEPT_MS)
        kept[one] = start;
    }
    if (kept[key] !== undefined)
      return;
    kept[key] = branch === null || branch === "" ? { head, at: atMs } : { head, at: atMs, branch };
    atomicWrite(file, `${JSON.stringify(kept, null, 2)}
`, 384);
  });
}
async function takeReviewStart(file, agentId) {
  const key = agentIdKey(agentId);
  if (key === null)
    return null;
  return await underRecordLock(file, () => {
    const starts = readStarts(file);
    const start = starts[key];
    if (start === undefined)
      return null;
    delete starts[key];
    atomicWrite(file, `${JSON.stringify(starts, null, 2)}
`, 384);
    return { head: start.head, branch: start.branch ?? null };
  });
}

// src/hooks/after-merge.ts
import { createHash as createHash2 } from "crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync4, writeFileSync as writeFileSync2 } from "fs";
import { tmpdir } from "os";
import { join as join8 } from "path";

// src/hooks/git.ts
import { realpathSync as realpathSync3 } from "fs";
import { basename as basename2, dirname as dirname3, join as join7, resolve as resolve3 } from "path";

// src/path-compare.ts
import { resolve as resolve2 } from "path";
var IGNORE_CASE = process.platform === "win32";
function isInside(path, folder, ignoreCase = IGNORE_CASE) {
  const form = (p) => {
    const forward = resolve2(p.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
    return ignoreCase ? forward.toLowerCase() : forward;
  };
  const child = form(path);
  const parent = form(folder);
  return child === parent || child.startsWith(`${parent}/`);
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
      timeout: timeoutMs
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
  let at = resolve3(path);
  for (;; ) {
    try {
      return join7(realpathSync3(at), ...rest);
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
    worktrees.push({
      path,
      head: value("HEAD") ?? "",
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      locked: flag("locked"),
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
function hasChanges(folder, env) {
  const status = runGit(folder, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], env);
  return !status.ok || status.out !== "";
}

// src/hooks/git-guard.ts
import { isAbsolute, resolve as resolve4 } from "path";
var DEFAULT_PROTECTED_BRANCHES = ["main"];
var PUSH_VALUE_OPTIONS = [
  ["--exec", 4],
  ["--push-option", 4],
  ["--receive-pack", 5],
  ["--repo", 6]
];
var CHANGE_DIR = new Set(["cd", "chdir", "popd", "pushd", "set-location", "sl"]);
function longOption(arg, full, min) {
  const name = arg.split("=")[0] ?? arg;
  return name.length >= min && name.length <= full.length && full.startsWith(name);
}
function movedTo(program, folder, args) {
  if (program === "popd")
    return null;
  const target = args.find((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  if (target === undefined || /^[~%]|[$`]/.test(target))
    return null;
  const path = process.platform === "win32" ? target.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : target;
  if (isAbsolute(path))
    return resolve4(path);
  return folder === null ? null : resolve4(folder, path);
}
function currentBranch(where, run) {
  if (!run.branches.has(where)) {
    const read = runGit(where, ["symbolic-ref", "--short", "-q", "HEAD"], run.options.env, GUARD_GIT_TIMEOUT_MS);
    run.branches.set(where, read.ok && read.out !== "" ? read.out : undefined);
  }
  return run.branches.get(where);
}
var PUSH_CONFIG_KEYS = "^(push\\.default|remote\\.pushdefault|branch\\..*\\.(remote|pushremote|merge)|remote\\..*\\.push)$";
function pushConfig(where, run) {
  const cached = run.pushConfigs.get(where);
  if (cached !== undefined)
    return cached;
  const read = runGit(where, ["config", "--get-regexp", PUSH_CONFIG_KEYS], run.options.env, GUARD_GIT_TIMEOUT_MS);
  const config = new Map;
  for (const line of read.ok ? read.out.split(`
`) : []) {
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    if (key !== "")
      config.set(key, [...config.get(key) ?? [], space === -1 ? "" : line.slice(space + 1)]);
  }
  run.pushConfigs.set(where, config);
  return config;
}
function configKey(raw) {
  const parts = raw.split(".");
  if (parts.length < 2)
    return raw.toLowerCase();
  const first = (parts[0] ?? "").toLowerCase();
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  return [first, ...parts.slice(1, -1), last].join(".");
}
function bareRefspecs(remote, branch, config, onLine) {
  let unknown = false;
  const values = (key) => {
    if (!onLine.has(key))
      return config.get(key) ?? [];
    const value = onLine.get(key);
    if (value === null || value === undefined)
      unknown = true;
    return value === null || value === undefined ? [] : [value];
  };
  const one = (key) => values(key)[0];
  const target = remote ?? one(`branch.${branch}.pushremote`) ?? one("remote.pushdefault") ?? one(`branch.${branch}.remote`) ?? "origin";
  const configured = values(`remote.${target}.push`);
  const mode = (one("push.default") ?? "simple").toLowerCase();
  const merge = one(`branch.${branch}.merge`);
  if (unknown)
    return [":"];
  if (configured.length > 0)
    return configured;
  if (mode === "nothing")
    return [];
  if (mode === "matching")
    return [":"];
  if (mode === "upstream" || mode === "tracking") {
    return merge === undefined ? [] : [`${branch}:${merge}`];
  }
  return [branch];
}
function protectedMatch(destination, protectedBranches) {
  const name = destination.replace(/^refs\/heads\//, "");
  if (!destination.includes("*"))
    return protectedBranches.find((branch) => branch === name);
  const glob = (pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  const asRef = glob(destination);
  const asName = glob(name);
  return protectedBranches.find((branch) => asRef.test(`refs/heads/${branch}`) || asName.test(branch));
}
function pushQuestions(args, place, protectedBranches) {
  const found = [];
  const positional = [];
  let dryRun = false;
  let force = false;
  let deleting = false;
  let everyBranch = false;
  let repo = null;
  let repoGiven = false;
  let tagsOnly = false;
  for (let i = 0;i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      if (longOption(arg, "--force", 6) || longOption(arg, "--force-if-includes", 9) || longOption(arg, "--force-with-lease", 9)) {
        force = true;
      }
      if (longOption(arg, "--all", 4) || longOption(arg, "--mirror", 6))
        everyBranch = true;
      if (longOption(arg, "--dry-run", 4))
        dryRun = true;
      if (longOption(arg, "--tags", 4))
        tagsOnly = true;
      if (longOption(arg, "--delete", 5))
        deleting = true;
      if (longOption(arg, "--repo", 6)) {
        repoGiven = true;
        repo = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[i + 1] ?? null;
      }
      if (!arg.includes("=") && PUSH_VALUE_OPTIONS.some(([full, min]) => longOption(arg, full, min)))
        i++;
    } else if (isShort(arg)) {
      const { flags, wantsNext } = shortFlags(arg, "o");
      if (flags.includes("f"))
        force = true;
      if (flags.includes("n"))
        dryRun = true;
      if (flags.includes("d"))
        deleting = true;
      if (wantsNext)
        i++;
    } else {
      positional.push(arg);
    }
  }
  if (dryRun)
    return found;
  const given = repoGiven ? positional : positional.slice(1);
  const remote = repoGiven ? repo : positional[0] ?? null;
  const refspecs = given.length === 0 && !tagsOnly && !everyBranch ? place.bare(remote) : given;
  if (force || refspecs.some((refspec) => refspec.startsWith("+"))) {
    found.push("This is a force-push: it can overwrite commits that other people or other sessions " + "already pushed, and those commits can be lost. Approve only if you meant it.");
  }
  if (everyBranch) {
    found.push(`\`git push --all\` / \`--mirror\` pushes every branch, ${protectedBranches.map((b) => `\`${b}\``).join(", ")} included.`);
  }
  const deleted = (deleting ? given : refspecs).map((refspec) => refspec.replace(/^\+/, "")).map((spec) => deleting ? spec : spec.startsWith(":") && spec.length > 1 ? spec.slice(1) : "").filter((name) => name !== "").map((name) => name.replace(/^refs\/heads\//, ""));
  if (deleted.length > 0) {
    found.push(`This deletes ${deleted.map((name) => `\`${name}\``).join(", ")} on the remote: the ` + "commits on it are gone for everyone, and a teammate may still be working on it. " + "Approve only if you meant to delete it.");
  }
  const targets = [];
  for (const refspec of refspecs) {
    const spec = refspec.replace(/^\+/, "");
    const colon = spec.indexOf(":");
    const destination = colon === -1 ? spec : spec.slice(colon + 1);
    if (spec === ":") {
      targets.push(...protectedBranches);
    } else if (colon === -1 && (spec === "HEAD" || spec === "@")) {
      const here = place.branch();
      if (here !== undefined)
        targets.push(here);
    } else {
      targets.push(destination);
    }
  }
  const protectedTarget = targets.map((target) => protectedMatch(target, protectedBranches)).find((match) => match !== undefined);
  if (protectedTarget !== undefined) {
    found.push(`This pushes straight to \`${protectedTarget}\`, a protected branch: work usually reaches ` + "it through a pull request. Approve only if you meant to push there.");
  }
  return found;
}
function stashQuestions(args, sharedStash) {
  const sub = args[0];
  const named = args.slice(1).some((arg) => !arg.startsWith("-"));
  if (sub === "clear") {
    return [
      "`git stash clear` throws away every stash for good: git cannot bring them back. " + "`git stash list` shows what they hold, `git stash show -p` one of them."
    ];
  }
  if (sub === "drop" && !named) {
    return [
      "`git stash drop` with no stash named drops the newest one, whoever made it. " + "`git stash list` shows them; `git stash drop stash@{n}` drops the one you mean."
    ];
  }
  if (!sharedStash)
    return [];
  const tagged = args.some((arg) => longOption(arg, "--message", 6) || isShort(arg) && shortFlags(arg, "m").flags.includes("m"));
  const untaggedPush = (sub === undefined || sub.startsWith("-") || sub === "push") && !tagged;
  const saveWithoutMessage = sub === "save" && !named;
  if (sub !== "pop" && !untaggedPush && !saveWithoutMessage)
    return [];
  return [
    "The git stash is shared by every worktree of this repo, so a bare `git stash` or " + "`git stash pop` can take or restore another session's work. A WIP commit is safer; " + "or `git stash push -u -m <tag>`, then `git stash apply <its sha>`."
  ];
}
function discardsChanges(sub, rest) {
  if (sub === "switch") {
    return rest.some((arg) => longOption(arg, "--force", 6) || longOption(arg, "--discard-changes", 8) || isShort(arg) && shortFlags(arg, "cC").flags.includes("f"));
  }
  if (sub === "checkout") {
    const dashes = rest.indexOf("--");
    const pathsGiven = dashes !== -1 && dashes < rest.length - 1;
    const force = rest.some((arg) => longOption(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "bB").flags.includes("f"));
    return pathsGiven || force || rest.slice(0, dashes === -1 ? undefined : dashes).includes(".");
  }
  const staged = rest.some((arg) => longOption(arg, "--staged", 6) || isShort(arg) && shortFlags(arg, "s").flags.includes("S"));
  const worktree = rest.some((arg) => longOption(arg, "--worktree", 6) || isShort(arg) && shortFlags(arg, "s").flags.includes("W"));
  return !staged || worktree;
}
function forceDeletesBranch(rest) {
  const has = (long, min, short) => rest.some((arg) => long !== undefined && longOption(arg, long, min) || isShort(arg) && shortFlags(arg, "").flags.includes(short));
  return has(undefined, 0, "D") || has("--delete", 5, "d") && has("--force", 6, "f");
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
function gitCalls(args) {
  const dirs = [];
  const config = new Map;
  for (let index = 0;index < args.length; index++) {
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
    } else if (GIT_VALUE_OPTIONS.has(arg)) {
      index++;
    } else if (GIT_PRINTS.has(arg) || name === "--list-cmds") {
      return [];
    } else if (attached && GIT_VALUE_OPTIONS.has(name) || name === "--exec-path") {} else if (!GIT_FLAGS.has(arg) && arg.startsWith("-")) {
      const later = args.slice(index + 1);
      return later.flatMap((word, at) => word.startsWith("-") ? [] : [{ config, dirs: [...dirs], rest: later.slice(at + 1), sub: word }]);
    } else if (!arg.startsWith("-")) {
      return [{ config, dirs, rest: args.slice(index + 1), sub: arg }];
    }
  }
  return [];
}
function gitQuestions(args, folder, run) {
  return gitCalls(args).flatMap((call) => callQuestions(call, folder, run));
}
function callQuestions(call, folder, run) {
  const { options } = run;
  const { rest, sub } = call;
  if (sub === "push") {
    const where = folder === null ? null : resolve4(folder, ...call.dirs);
    const place = {
      branch: () => where === null ? undefined : currentBranch(where, run),
      bare: (remote) => {
        const branch = where === null ? undefined : currentBranch(where, run);
        if (where === null || branch === undefined)
          return [];
        return bareRefspecs(remote, branch, pushConfig(where, run), call.config);
      }
    };
    return pushQuestions(rest, place, options.protectedBranches);
  }
  if (sub === "stash")
    return stashQuestions(rest, options.sharedStash);
  if (sub === "worktree" && rest[0] === "remove") {
    const force = rest.slice(1).some((arg) => longOption(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "").flags.includes("f"));
    if (force) {
      return [
        "`git worktree remove --force` deletes a worktree even when it holds uncommitted or " + "untracked work, and git cannot bring that back. Look in it first."
      ];
    }
  }
  if ((sub === "checkout" || sub === "restore" || sub === "switch") && discardsChanges(sub, rest)) {
    return [
      `\`git ${sub}\` here overwrites files in this folder with another version, and any ` + "uncommitted change in them is lost for good. Approve only if you want them gone; a " + "WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask."
    ];
  }
  if (sub === "branch" && forceDeletesBranch(rest)) {
    return [
      "`git branch -D` deletes a branch even if it was never merged: its commits are then " + "only in the reflog. `git branch -d` deletes a merged branch, and does not ask."
    ];
  }
  if (sub === "reset" && rest.some((arg) => longOption(arg, "--hard", 4))) {
    return [
      "`git reset --hard` throws away every uncommitted change in this folder, for good. " + "Approve only if you want them gone; a WIP commit keeps the work first."
    ];
  }
  if (sub === "clean") {
    const force = rest.some((arg) => longOption(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "e").flags.includes("f"));
    const dryRun = rest.some((arg) => longOption(arg, "--dry-run", 4) || isShort(arg) && shortFlags(arg, "e").flags.includes("n"));
    if (force && !dryRun) {
      return [
        "`git clean -f` deletes untracked files for good: git cannot bring them back. " + "`git clean -n` shows what it would delete, without deleting."
      ];
    }
  }
  return [];
}
function inspect2(command, cwd, reading, run, depth = 0) {
  const found = [];
  let folder = cwd;
  const { dialect, joinLines } = reading;
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined)
      continue;
    const { args, program } = invocation;
    const operands = withoutRedirections(args);
    if (program === "git")
      found.push(...gitQuestions(operands, folder, run));
    if (CHANGE_DIR.has(program))
      folder = movedTo(program, folder, operands);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const nested of readingsOf(inner, nestedDialect(program))) {
        found.push(...inspect2(inner, folder, nested, run, depth + 1));
      }
    }
  }
  return found;
}
function guardQuestions(command, cwd, options) {
  const run = { options, branches: new Map, pushConfigs: new Map };
  const found = readingsOf(command, options.dialect).flatMap((reading) => inspect2(command, cwd, reading, run));
  return [...new Set(found)];
}
function runsGit(command, dialect) {
  return programsOf(command, dialect).includes("git");
}

// src/hooks/after-merge.ts
var GH_COMMANDS = new Set([
  "accessibility",
  "actions",
  "agent-task",
  "alias",
  "api",
  "attestation",
  "auth",
  "browse",
  "cache",
  "co",
  "codespace",
  "completion",
  "config",
  "copilot",
  "discussion",
  "environment",
  "exit-codes",
  "extension",
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
  "ruleset",
  "run",
  "search",
  "secret",
  "skill",
  "ssh-key",
  "status",
  "telemetry",
  "variable",
  "workflow"
]);
function call(fields = {}) {
  return {
    target: null,
    refusal: null,
    unread: null,
    arms: false,
    disarms: false,
    admin: false,
    unknown: null,
    ...fields
  };
}
var CHANGE_DIR2 = new Set(["cd", "chdir", "popd", "pushd", "set-location", "sl"]);
var ENV_PROGRAM = /^(?:.*[\\/])?env(?:\.(?:exe|cmd))?$/i;
var GH_POINTING_TEXT = /GH_(?:REPO|HOST)/;
var GH_POINTING = /^GH_(?:REPO|HOST)=/;
var isAutoFlag = (word) => /^--auto(?:=|$)/.test(word);
var isDisableAutoFlag = (word) => /^--disable-auto(?:=|$)/.test(word);
function pullRequestMerges(command, aliases = null, dialect) {
  const seen = new Set;
  const calls = [];
  for (const reading of readingsOf(command, dialect)) {
    for (const one of readMerges(command, reading.dialect, reading.joinLines, aliases, 0, null)) {
      const key = JSON.stringify(one);
      if (seen.has(key))
        continue;
      seen.add(key);
      calls.push(one);
    }
  }
  return calls;
}
function readMerges(command, dialect, joinLines, aliases, depth, movedBefore) {
  const calls = [];
  let moved = movedBefore;
  for (const step of shellSteps(command, { dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    if (words.some((word) => GH_POINTING_TEXT.test(word))) {
      moved ??= "an earlier step in the same command sets `GH_REPO`/`GH_HOST`, so which repository gh works on is not certain";
    }
    const invocation = invocationOf(words);
    const runnerWord = RUNNERS[programName(words[0] ?? "")];
    if (invocation === undefined) {
      if (runnerWord !== undefined)
        moved ??= runnerWord.moved;
      continue;
    }
    const { program } = invocation;
    const args = withoutRedirections(invocation.args);
    if (program === "git")
      moved ??= gitMoved(args);
    else if (CHANGE_DIR2.has(program)) {
      moved ??= `an earlier \`${program}\` in the same command changes the folder it runs in`;
    }
    const runner = runnerOf(program, invocation.prefix);
    if (runner === null && runnerWord !== undefined)
      moved ??= runnerWord.moved;
    const prefix = prefixMoved(invocation.prefix);
    if (program === "gh" && runner === null) {
      calls.push(...dispatch(args, moved ?? prefix, aliases, depth));
      moved ??= ghSwitchReason(args, aliases, depth);
    } else if (runner !== null) {
      calls.push(...runnerCalls(words, runner, aliases, depth, dialect));
    }
    const nested = nestedCommand(program, invocation.args, step.pipedFrom);
    if (nested !== undefined && depth < MAX_NESTING) {
      calls.push(...lineMerges(nested, nestedDialect(program), aliases, depth + 1, moved));
    }
    const script = suScript(program, args);
    if (script !== undefined && depth < MAX_NESTING) {
      const merges = lineMerges(script, "bash", aliases, depth + 1, moved);
      calls.push(...refuseRunner(merges, runner ?? SU_RUNNER));
    }
  }
  return calls;
}
function lineMerges(line, dialect, aliases, depth, moved) {
  return readingsOf(line, dialect).flatMap((reading) => readMerges(line, reading.dialect, reading.joinLines, aliases, depth, moved));
}
function suScript(program, args) {
  if (program !== "su")
    return;
  const at = args.findIndex((arg) => arg === "-c" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
  return at === -1 ? undefined : args[at + 1];
}
var RUNNERS = {
  doas: {
    feeds: false,
    moved: "an earlier `doas` in the same command may run the merge as another user",
    reason: "the merge runs under `doas`, with another user's login and gh config"
  },
  find: {
    feeds: false,
    moved: "an earlier `find` in the same command may run the merge once for each match",
    reason: "the merge runs from `find -exec`, once for each match"
  },
  parallel: {
    feeds: true,
    moved: "an earlier `parallel` in the same command may feed the merge its arguments from outside the line",
    reason: "the merge runs from `parallel`, whose arguments come from outside the line"
  },
  su: {
    feeds: true,
    moved: "an earlier `su` in the same command may run the merge in another shell, with its own environment",
    reason: "the merge runs from `su`, whose command and environment come from outside the line"
  },
  sudo: {
    feeds: false,
    moved: "an earlier `sudo` in the same command may run the merge under another user",
    reason: "the merge runs under `sudo`, with another user's login and gh config"
  },
  watch: {
    feeds: false,
    moved: "an earlier `watch` in the same command may run the merge over and over",
    reason: "the merge runs from `watch`, over and over"
  },
  xargs: {
    feeds: true,
    moved: "an earlier `xargs` in the same command may feed the merge its arguments from outside the line",
    reason: "the merge runs from `xargs`, whose arguments come from outside the line"
  }
};
var SU_RUNNER = {
  feeds: true,
  name: "su",
  reason: "the merge runs from `su`, whose command and environment come from outside the line"
};
function runnerOf(program, before) {
  for (const word of [program, ...before]) {
    const name = programName(word);
    const spec = RUNNERS[name];
    if (spec !== undefined)
      return { feeds: spec.feeds, name, reason: spec.reason };
  }
  return null;
}
function runnerCalls(words, runner, aliases, depth, dialect) {
  const at = words.findIndex((word) => programName(word) === "gh");
  if (at !== -1) {
    const ghWords = withoutRedirections(words.slice(at + 1));
    return refuseRunner(dispatch(ghWords, null, aliases, depth), runner);
  }
  const held = words.find((word) => /\bgh\b/i.test(word) && /\bmerge\b/i.test(word));
  if (held === undefined)
    return [];
  return refuseRunner(lineMerges(held, dialect, aliases, depth + 1, null), runner);
}
function refuseRunner(calls, runner) {
  return calls.filter((one) => !one.disarms).map((one) => call({ target: runner.feeds ? null : one.target, refusal: runner.reason }));
}
function gitMoved(args) {
  const calls = gitCalls(args);
  if (calls.some((one) => one.dirs.length > 0)) {
    return "an earlier `git -C` in the same command runs in another folder";
  }
  const switched = calls.find((one) => one.sub === "switch" || one.sub === "checkout");
  if (switched !== undefined) {
    return `an earlier \`git ${switched.sub}\` in the same command may change the branch it merges from`;
  }
  return null;
}
function prefixMoved(before) {
  if (before.some((word) => GH_POINTING.test(word))) {
    return "the merge sets `GH_REPO`/`GH_HOST` itself, so which repository it merges in is not certain";
  }
  if (before.some((word) => ENV_PROGRAM.test(word))) {
    return "the merge runs through `env`, so which environment gh sees is not certain";
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
function couldBeMerge(rest) {
  const command = rest[0]?.toLowerCase();
  if (command === undefined)
    return false;
  if (command === "api")
    return true;
  if (command === "pr")
    return rest.slice(1).some((word) => word.toLowerCase() === "merge");
  return !GH_COMMANDS.has(command);
}
function dispatch(words, moved, aliases, depth, repo = null) {
  const leading = leadingFlags(words);
  const carried = repo ?? leading.repo;
  if (leading.unknown !== null) {
    return couldBeMerge(leading.rest) ? [
      call({
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
    return apiCalls(leading.rest.slice(1));
  if (GH_COMMANDS.has(command))
    return [];
  const rest = leading.rest.slice(1);
  if (aliases === null)
    return [call({ unknown: command })];
  const expansion = aliases.get(command);
  if (expansion === undefined) {
    return leading.rest.some((word) => /merge/i.test(word)) ? [
      call({
        refusal: `\`gh ${command}\` is no gh command or alias, and its words name a merge, which this guard does not judge`
      })
    ] : [];
  }
  if (expansion.startsWith("!")) {
    return [
      call({ refusal: `\`gh ${command}\` is a shell alias, so what it runs cannot be read` })
    ];
  }
  if (depth >= MAX_NESTING) {
    return [
      call({
        refusal: `\`gh ${command}\` expands to further commands, which this guard does not follow`
      })
    ];
  }
  return dispatch([...wordsOf(expansion), ...rest], moved, aliases, depth + 1, carried);
}
function ghSwitchReason(words, aliases, depth) {
  if (depth > MAX_NESTING)
    return null;
  const leading = leadingFlags(words);
  if (leading.unknown !== null)
    return null;
  const command = leading.rest[0]?.toLowerCase();
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
  if (command === undefined || GH_COMMANDS.has(command))
    return null;
  const expansion = aliases?.get(command);
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
          refusal: `\`gh pr\` takes a flag this guard does not know (\`${word}\`), so it cannot tell whether this is a merge`
        })
      ];
    }
  }
  if (rest[index] !== "merge")
    return [];
  const args = rest.slice(index + 1);
  if (args.some((arg) => arg === "-h" || arg === "--help"))
    return [];
  const named = mergeArguments(args);
  return [
    call({
      target: { ref: named.ref, repo: repo ?? named.repo ?? carried },
      refusal: moved,
      arms: args.some(isAutoFlag),
      disarms: args.some(isDisableAutoFlag),
      admin: named.admin
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
function mergeArguments(words) {
  let ref = null;
  let repo = null;
  let admin = false;
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
      if (name === "--repo")
        repo = value ?? words[index + 1] ?? null;
      if (name === "--admin")
        admin = true;
      if (value === undefined && MERGE_FLAGS_WITH_VALUE.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, MERGE_SHORT_WITH_VALUE);
      const letter = flags.slice(-1);
      if (letter !== "" && MERGE_SHORT_WITH_VALUE.includes(letter)) {
        const value = wantsNext ? words[index + 1] ?? null : word.slice(flags.length + 1);
        if (letter === "R")
          repo = value === "" ? null : value;
        if (wantsNext)
          index += 1;
      }
      continue;
    }
    ref ??= word || null;
  }
  return { ref, repo, admin };
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
function apiCalls(rest) {
  const fields = [];
  let endpoint = null;
  let body = false;
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
            refusal: `\`gh api\` takes a flag this guard does not know (\`${name}\`), so it cannot tell whether this is a merge`
          })
        ];
      }
      if (name === "--input")
        body = true;
      if (name === "--field" || name === "--raw-field") {
        fields.push(at === -1 ? rest[index + 1] ?? "" : word.slice(at + 1));
      }
      if (at === -1 && API_VALUE_FLAGS.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, API_VALUE_LETTERS);
      const unknown = flags.split("").find((one) => one !== "i" && !API_VALUE_LETTERS.includes(one));
      if (unknown !== undefined) {
        return [
          call({
            refusal: `\`gh api\` takes a flag this guard does not know (\`-${unknown}\`), so it cannot tell whether this is a merge`
          })
        ];
      }
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter))
        continue;
      const value = wantsNext ? rest[index + 1] ?? "" : word.slice(flags.length + 1);
      if (wantsNext)
        index += 1;
      if (letter === "f" || letter === "F")
        fields.push(value);
      continue;
    }
    endpoint ??= word;
  }
  if (endpoint === null)
    return [];
  if (isGraphqlEndpoint(endpoint))
    return graphqlCalls(fields, body);
  if (endpoint.endsWith("/")) {
    return [
      call({
        refusal: "the `gh api` path is cut short (gh's `{owner}`-style placeholders are read as parts of the command line), so this guard cannot tell which API path it reaches"
      })
    ];
  }
  const merged = pullRequestMergePath(endpoint);
  return merged === null ? [] : [call({ target: merged, refusal: API_MERGE_REFUSAL })];
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
  for (const field of fields) {
    if (!field.startsWith("query="))
      continue;
    const query = field.slice("query=".length);
    if (query.startsWith("@") || /\$\(|\$\{|`/.test(query)) {
      return [
        call({
          refusal: "the GraphQL query is read from a file or built by the shell, so this guard cannot read it"
        })
      ];
    }
    if (/mergePullRequest|enablePullRequestAutoMerge/i.test(query)) {
      return [
        call({
          refusal: "the GraphQL query it sends merges a pull request (`mergePullRequest`), which this guard does not judge"
        })
      ];
    }
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
function mergeCalls(command, folder, env, timeoutMs = ALIAS_TIMEOUT_MS, dialect) {
  const unread = pullRequestMerges(command, null, dialect);
  if (!unread.some((one) => one.unknown !== null))
    return unread;
  const aliases = readGhAliases(folder, env, timeoutMs);
  if (aliases === null) {
    return [...unread.filter((one) => one.unknown === null), call({ unread: "its aliases" })];
  }
  return pullRequestMerges(command, aliases, dialect);
}
var GH_TIMEOUT_MS = 1e4;
var ALIAS_TIMEOUT_MS = 3000;
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
function requestsMerge(command, dialect) {
  return pullRequestMerges(command, null, dialect).some((one) => !one.disarms);
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
var ANNOUNCE_WINDOW_MS = 15 * 60000;
function mergeOutcome(params) {
  const { announced, base, failed, now, pr, sameRepo, target, worktree } = params;
  const none = { announce: null, clear: null };
  if (pr === null ? failed : pr.state !== "MERGED" || !sameRepo)
    return none;
  const branch = worktree?.branch ?? null;
  const mergedHere = worktree !== null && branch !== null && (target.ref === null || target.ref === branch || pr?.head === branch);
  const clear = mergedHere && branch !== null ? { path: worktree.path, branch } : null;
  const mergedAt = pr === null || pr.mergedAt === null ? Number.NaN : Date.parse(pr.mergedAt);
  const recent = now - mergedAt <= ANNOUNCE_WINDOW_MS;
  const announce = pr !== null && pr.base === base && !announced && recent ? pr : null;
  return { announce, clear };
}
function quotableTitle(title) {
  const line = title.replace(/["`]/g, "'").replace(/\s+/g, " ").trim();
  return line.length > 100 ? `${line.slice(0, 99)}\u2026` : line;
}
function insideClaudeWorktrees(path) {
  return /(^|[\\/])\.claude[\\/]worktrees[\\/]/.test(path);
}
function clearWorktreeNote(path, branch) {
  return [
    `That merged the pull request of this worktree's branch, ${branch}. Clear the worktree now, unless the user wants more work on this branch:`,
    insideClaudeWorktrees(path) ? 'ExitWorktree with action "remove": Claude Code checks a worktree under .claude/worktrees/ itself and says when work is left.' : 'ExitWorktree with action "remove". A worktree outside .claude/worktrees/ may be refused because Claude Code cannot check it: if the refusal is only for the merged commits, check that `git status --porcelain` is empty and `git log @{u}..` shows nothing, then call it again with discard_changes true.',
    `If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: ${COMMAND} worktrees --remove "${path}" \u2014 it removes the folder and the branch only when the worktree is finished. A subagent never calls ExitWorktree: it is already isolated and leaves its worktree to the session that launched it.`
  ].join(`
`);
}
function otherBaseCaution(bases, base) {
  const elsewhere = Object.entries(bases).filter(([, target]) => target !== base).map(([prefix]) => prefix);
  if (elsewhere.length === 0)
    return null;
  return `One exception: a branch whose pull request goes into another base (${elsewhere.join(", ")}) must NOT merge ${base} in, ` + `because that would ship unreleased work. A branch there stays as it is.`;
}
function tellSessionsNote(pr, base, bases = {}) {
  const caution = otherBaseCaution(bases, base);
  const message = `${base} now has #${pr.number} (${quotableTitle(pr.title)}). At your next stop, once your current work is committed: ` + `git fetch origin ${base}, then git merge origin/${base}, and fix any conflict. ` + `${caution === null ? "" : `${caution} `}No reply needed.`;
  return [
    `That merged #${pr.number} into ${base}.`,
    "Tell the other sessions of this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo (not this session, not a subagent, not another project) with exactly this text:",
    `"${message}"`,
    "Merged several pull requests this turn? Send each session one message, naming every merged number."
  ].join(`
`);
}
function viewPullRequest(ref, repo, folder, env) {
  try {
    const view = Bun.spawnSync([
      "gh",
      "pr",
      "view",
      ...ref === null ? [] : [ref],
      ...repo === null ? [] : ["--repo", repo],
      "--json",
      PULL_REQUEST_FIELDS
    ], { cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: GH_TIMEOUT_MS });
    return view.exitCode === 0 ? parsePullRequestView(view.stdout.toString()) : null;
  } catch {
    return null;
  }
}
function announcedFile(repo, number, env) {
  const key = createHash2("sha256").update(repo).digest("hex").slice(0, 16);
  return join8(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-merges", `${key}-${number}`);
}
function afterMerge(context) {
  const { project, input, event, env, cwd } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined)
    return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null)
    return SILENT;
  const dialect = dialectOfTool(input.tool_name);
  const calls = mergeCalls(command, cwd, env, ALIAS_TIMEOUT_MS, dialect).filter((one) => !one.arms && !one.disarms);
  const target = mergeTargetOf(calls);
  if (target === null)
    return SILENT;
  const repo = project.mainCheckout ?? project.root;
  let worktree = null;
  const [, ...linked] = listWorktrees(repo, env);
  const mine = innermostWorktree(cwd, linked.map((listed) => listed.path));
  if (mine !== null) {
    worktree = {
      path: mine,
      branch: linked.find((listed) => listed.path === mine)?.branch ?? null
    };
  }
  const pr = viewPullRequest(target.ref, target.repo, cwd, env);
  const origin = runGit(repo, ["remote", "get-url", "origin"], env);
  const record = pr === null ? null : announcedFile(repo, pr.number, env);
  const outcome = mergeOutcome({
    announced: record !== null && existsSync4(record),
    base,
    failed: event === "PostToolUseFailure",
    now: Date.now(),
    pr,
    sameRepo: pr !== null && origin.ok && sameRepository(pr.url, origin.out),
    target,
    worktree
  });
  const notes = [];
  if (outcome.clear !== null)
    notes.push(clearWorktreeNote(outcome.clear.path, outcome.clear.branch));
  if (outcome.announce !== null && record !== null) {
    notes.push(tellSessionsNote(outcome.announce, base, project.config?.worktrees?.bases ?? {}));
    mkdirSync4(join8(record, ".."), { recursive: true });
    writeFileSync2(record, "");
  }
  return notes.length === 0 ? SILENT : addContext(event, notes.join(`

`));
}

// src/gateway/config.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync5, statSync as statSync4 } from "fs";

// src/gateway/targets.ts
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
var FAMILY_SLOTS = {
  "cc-smart-dev-kit-scout": "haiku",
  "cc-smart-dev-kit-worker": "sonnet",
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
function familySlotKey(family) {
  return Object.keys(FAMILY_SLOTS).find((key) => FAMILY_SLOTS[key] === family) ?? null;
}
var FALLBACK_OFF_BY_DEFAULT = [...Object.keys(MODEL_SLOTS), JUDGE_SLOT];
var FALLBACK_ANY = new Set([408, 429, 500, 502, 503, 504, 529]);

// src/gateway/config.ts
var DEFAULT_PORT = 20100;
var DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
var DEFAULT_FIRST_BYTE_MS = 60000;
var baseUrl = url({ protocol: /^https?$/ }).transform((url2) => url2.replace(/\/+$/, ""));
var backendSchema = looseObject({
  apiKey: string2().min(1),
  baseUrl
});
var gatewayConfigSchema = looseObject({
  aliases: record(string2(), string2()).default({}),
  anthropicBaseUrl: literal(DEFAULT_ANTHROPIC_BASE_URL).default(DEFAULT_ANTHROPIC_BASE_URL),
  backends: record(string2().refine(isBackendName, "not a backend name"), backendSchema),
  judgeTested: record(string2(), string2()).optional(),
  fallback: record(string2(), boolean2()).optional(),
  modelSlots: record(string2(), string2()).optional(),
  port: int().min(1).max(65535).default(DEFAULT_PORT),
  slots: record(string2().refine(isSlotKey, "a slot key is cc-smart-dev-kit-<name>"), array(string2()).min(1)),
  timeouts: looseObject({ firstByteMs: int().positive().default(DEFAULT_FIRST_BYTE_MS) }).default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
  version: literal(1)
}).superRefine((config, ctx) => {
  for (const [slot, targets] of Object.entries(config.slots)) {
    targets.forEach((text, index) => {
      const parsed = parseTarget(text);
      if ("error" in parsed) {
        ctx.addIssue({ code: "custom", message: parsed.error, path: ["slots", slot, index] });
      } else if (slot === JUDGE_SLOT && parsed.target.kind === "anthropic") {
        ctx.addIssue({
          code: "custom",
          message: `${JUDGE_SLOT} takes no claude-\u2026 target; use "${COMMAND} gateway slot judge off" to put the checks on Claude`,
          path: ["slots", slot, index]
        });
      } else if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
        ctx.addIssue({
          code: "custom",
          message: `"${text}" names backend "${parsed.target.backend}", which is not in backends`,
          path: ["slots", slot, index]
        });
      }
    });
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
    if (!Object.hasOwn(config.slots, slot)) {
      ctx.addIssue({
        code: "custom",
        message: `fallback names slot "${slot}", which is not in slots (a slot with no chain has nothing to fall back to)`,
        path: ["fallback", slot]
      });
    }
  }
});
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
    return Object.hasOwn(config.slots, to) ? null : `alias "${name}" points at slot "${to}", which is not in slots`;
  }
  const parsed = parseTarget(to);
  if ("error" in parsed)
    return `alias "${name}": ${parsed.error}`;
  if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
    return `alias "${name}" names backend "${parsed.target.backend}", which is not in backends`;
  }
  return null;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

class ConfigError extends Error {
  name = "ConfigError";
}
function parseConfig(raw) {
  const result = gatewayConfigSchema.safeParse(raw);
  return result.success ? { config: result.data } : { error: prettifyError(result.error) };
}
function loadConfigFile(path, platform = hostPlatform()) {
  let mode;
  try {
    mode = statSync4(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if (!isOwnerOnly(mode, platform)) {
    throw new ConfigError(`${path} can be read by other users (mode ${(mode & 511).toString(8)}); it holds API keys. Run: chmod 600 ${path}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync5(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON. Fix it by hand.`, { cause: error });
  }
  const parsed = parseConfig(raw);
  if ("error" in parsed)
    throw new ConfigError(`${path} is not a valid gateway config:
${parsed.error}`);
  return parsed.config;
}

// src/gateway/settings.ts
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "fs";
function gatewayEnv(port) {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`
  };
}
var RETIRED_GATEWAY_ENV_KEYS = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"
];
var GATEWAY_ENV_KEYS = Object.keys(gatewayEnv(20100));
var REMOVED_ON_OFF = [...GATEWAY_ENV_KEYS, ...RETIRED_GATEWAY_ENV_KEYS];
var SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];
var LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSettings(path) {
  if (!existsSync5(path))
    return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync6(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it by hand, then run again.`);
  }
  if (!isJsonObject(parsed))
    throw new Error(`${path} is not a JSON object; not touching it`);
  const env = parsed.env;
  if (env !== undefined && !isJsonObject(env))
    throw new Error(`${path} has an "env" that is not an object`);
  return parsed;
}
function maskKey(key) {
  return key.length >= 12 ? `\u2022\u2022\u2022\u2022${key.slice(-4)}` : "\u2022\u2022\u2022\u2022";
}
function shownValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(text))
    return maskKey(text);
  return /^sk-|[A-Za-z0-9_-]{32,}/.test(text) ? maskKey(text) : text;
}
function settingsReport(settingsPath) {
  const settings = readSettings(settingsPath);
  const env = isJsonObject(settings.env) ? settings.env : {};
  const baseUrl = typeof env.ANTHROPIC_BASE_URL === "string" ? shownValue(env.ANTHROPIC_BASE_URL) : null;
  const loginOverrides = LOGIN_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  if (Object.hasOwn(settings, "apiKeyHelper"))
    loginOverrides.push("apiKeyHelper");
  const subagentOverrides = SUBAGENT_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  return { baseUrl, loginOverrides, subagentOverrides };
}

// src/models/launch-policy.ts
var FABLE_BUILD_REASON = "build";
var FABLE_REASONS = [
  "hard",
  "rewrite",
  "ui-design",
  "architecture",
  "review",
  "plan",
  "unsatisfied"
];
var ALLOWED_EFFORTS = ["medium", "high", "xhigh", "max"];
var OPUS_ASK_EFFORT = "max";
var OPUS_FREE_EFFORTS = ALLOWED_EFFORTS.filter((one) => one !== OPUS_ASK_EFFORT);
var AFFORDABLE_EFFORT = "max";
function effortAllowed(effort) {
  return ALLOWED_EFFORTS.includes(effort.toLowerCase());
}
function premiumTier(family) {
  return family === "fable" || family === "opus" ? family : null;
}
function tierOfReading(family) {
  return family === null ? "opus" : premiumTier(family);
}
function familyEnv(family) {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
}
function familyFirstTarget(gateway, family) {
  if (!gateway.gatewayOn || gateway.config === null || family === null)
    return null;
  const slot = familySlotKey(family);
  if (slot === null || !Object.hasOwn(gateway.config.slots, slot))
    return null;
  return gateway.config.slots[slot]?.[0] ?? null;
}
function tierOfMappedId(model, gateway, env) {
  for (const premium of ["fable", "opus"]) {
    const override = stringField(env[familyEnv(premium)]);
    if (override !== null && withoutContextSuffix(override.trim()) === model)
      return premium;
    if (familyFirstTarget(gateway, premium) === model)
      return premium;
  }
  return null;
}
function tierRank(tier) {
  return tier === "fable" ? 2 : tier === "opus" ? 1 : 0;
}
function asNamed(answered, family, tier) {
  const real = premiumTier(answered.family);
  return tierRank(real) > tierRank(tier) ? { ...answered, tier: real } : { ...answered, family, tier };
}
function throughFamilySlot(claude, family, gateway) {
  const tier = tierOfReading(family);
  const first = familyFirstTarget(gateway, family);
  if (first === null)
    return { claude: true, family, model: claude, tier };
  return asNamed(resolveTarget(first), family, tier);
}
function resolveName(text, gateway) {
  const family = claudeFamily(text);
  if (family !== null || text.startsWith("claude-")) {
    return throughFamilySlot(text, family, gateway);
  }
  if (isSlotKey(text)) {
    const first = gateway.config?.slots[text]?.[0];
    const model = first === undefined ? { claude: false, family: null, model: text, tier: null } : resolveTarget(first);
    const slotFamily = MODEL_SLOTS[text];
    return slotFamily === "fable" || slotFamily === "opus" ? { ...model, family: slotFamily, tier: slotFamily } : model;
  }
  const parsed = parseTarget(text);
  if ("target" in parsed && parsed.target.kind === "backend") {
    return { claude: false, family: null, model: text, tier: null };
  }
  return { claude: true, family: null, model: text, tier: "opus" };
}
function resolveTarget(text) {
  const parsed = parseTarget(text);
  if (!("target" in parsed) || parsed.target.kind !== "anthropic") {
    return { claude: false, family: null, model: text, tier: null };
  }
  const family = claudeFamily(parsed.target.model);
  return { claude: true, family, model: parsed.target.model, tier: tierOfReading(family) };
}
function resolveLaunchModel(name, gateway, env) {
  const text = withoutContextSuffix(name.trim());
  const family = CLAUDE_FAMILIES.find((one) => one === text.toLowerCase());
  if (family === undefined) {
    const mapped = tierOfMappedId(text, gateway, env);
    const resolved = resolveName(text, gateway);
    if (mapped === null || resolved.tier !== null && resolved.family !== null)
      return resolved;
    return { ...resolved, family: resolved.family ?? mapped, tier: mapped };
  }
  const tier = premiumTier(family);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) {
    return asNamed(resolveName(withoutContextSuffix(override.trim()), gateway), family, tier);
  }
  return throughFamilySlot(text, family, gateway);
}
function isAffordable(real) {
  return !real.claude && real.tier === null;
}
var SUBAGENT_MODEL_FORCE_ENV = "CLAUDE_CODE_SUBAGENT_MODEL_FORCE";
var SUBAGENT_MODEL_ENV = "CLAUDE_CODE_SUBAGENT_MODEL";
var WORKFLOW_SUBAGENT_MODEL_ENV = "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL";
var EFFORT_LEVEL_ENV = "CLAUDE_CODE_EFFORT_LEVEL";
var EFFORT_AUTO = "auto";
function switchOn(value) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}
function modelVariable(env, name) {
  const value = stringField(env[name])?.trim() ?? "";
  return value === "" || value.toLowerCase() === "inherit" ? null : value;
}
function effectiveLaunch(launch, env, sessionModel) {
  if (launch.fork) {
    return { effort: launch.effort, effortFrom: null, model: sessionModel, modelFrom: "fork" };
  }
  const level = stringField(env[EFFORT_LEVEL_ENV])?.trim().toLowerCase() ?? "";
  const effort = level === "" ? { effort: launch.effort, effortFrom: null } : { effort: level, effortFrom: EFFORT_LEVEL_ENV };
  if (switchOn(env[SUBAGENT_MODEL_FORCE_ENV])) {
    const forced = modelVariable(env, SUBAGENT_MODEL_ENV);
    return forced === null ? { ...effort, model: sessionModel, modelFrom: "force-session" } : { ...effort, model: forced, modelFrom: "force" };
  }
  const workflowModel = launch.workflow ? modelVariable(env, WORKFLOW_SUBAGENT_MODEL_ENV) : null;
  if (workflowModel !== null)
    return { ...effort, model: workflowModel, modelFrom: "workflow" };
  return { ...effort, model: launch.model, modelFrom: "call" };
}
var WORKER_KINDS = {
  build: { about: "routine building", affordableEffort: "max", effort: "high", model: "sonnet" },
  docs: {
    about: "docs and their updates",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet"
  },
  tests: { about: "tests and test runs", affordableEffort: "max", effort: "high", model: "sonnet" },
  security: {
    about: "code that touches security",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus"
  },
  money: {
    about: "code that touches money",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus"
  },
  permissions: {
    about: "code that touches permissions",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus"
  },
  schema: {
    about: "a schema or a contract",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus"
  },
  deploy: { about: "deploy plumbing", affordableEffort: "xhigh", effort: "xhigh", model: "opus" },
  architecture: {
    about: "architecture and design",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus"
  },
  ui: { about: "UI and UX judgment", affordableEffort: "xhigh", effort: "xhigh", model: "opus" }
};
var WORKER_KIND_NAMES = Object.keys(WORKER_KINDS);

// src/hooks/agent-guard-workflows.ts
import { existsSync as existsSync7, readdirSync as readdirSync2, readFileSync as readFileSync8, statSync as statSync5 } from "fs";
import { dirname as dirname4, isAbsolute as isAbsolute2, join as join9, resolve as resolve5, sep as sep2 } from "path";

// src/setup/installed-plugins.ts
import { existsSync as existsSync6, readFileSync as readFileSync7 } from "fs";
function pluginsRecord(installedPluginsFile) {
  if (!existsSync6(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync7(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = parsed?.plugins;
  return typeof plugins === "object" && plugins !== null && !Array.isArray(plugins) ? plugins : null;
}
function installsOfPlugin(installedPluginsFile, pluginName) {
  const plugins = pluginsRecord(installedPluginsFile);
  if (plugins === null)
    return [];
  const out = [];
  for (const [id, entries] of Object.entries(plugins)) {
    const at = id.lastIndexOf("@");
    if ((at === -1 ? id : id.slice(0, at)) !== pluginName || !Array.isArray(entries))
      continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null)
        continue;
      const { installPath, projectPath, scope } = entry;
      if (typeof installPath !== "string" || typeof scope !== "string")
        continue;
      out.push({
        installPath,
        projectPath: typeof projectPath === "string" ? projectPath : null,
        scope
      });
    }
  }
  return out;
}

// src/hooks/agent-guard-workflows.ts
var WORKFLOW_SCRIPT_MAX_BYTES = 524288;
function stringAt(text, from) {
  const quote = text[from];
  if (quote !== '"' && quote !== "'" && quote !== "`")
    return null;
  let value = "";
  for (let index = from + 1;index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      const next = text[index + 1] ?? "";
      value += next === "n" ? `
` : next;
      index += 1;
      continue;
    }
    if (char === quote)
      return { end: index + 1, value };
    value += char;
  }
  return null;
}
function interpolated(text, from, end) {
  for (let index = from + 1;index < end - 1; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "$" && text[index + 1] === "{")
      return true;
  }
  return false;
}
function literalAt(text, from) {
  const literal = stringAt(text, from);
  if (literal === null)
    return null;
  return text[from] === "`" && interpolated(text, from, literal.end) ? null : literal;
}
function skipBlank(text, from) {
  let index = from;
  while (index < text.length) {
    if (/\s/.test(text[index] ?? "")) {
      index += 1;
    } else if (text.startsWith("//", index)) {
      const end = text.indexOf(`
`, index);
      index = end === -1 ? text.length : end + 1;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      break;
    }
  }
  return index;
}
function wholeLiteralAt(text, from, ends) {
  const literal = literalAt(text, from);
  if (literal === null)
    return null;
  const next = text[skipBlank(text, literal.end)] ?? "";
  return ends.includes(next) ? literal.value : null;
}
var FAIL = Symbol("not a pure literal");
var RESERVED_KEYS = ["__proto__", "constructor", "prototype"];
var NUMBER2 = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;
function literalValue(text, from) {
  const at = skipBlank(text, from);
  const char = text[at] ?? "";
  if (char === '"' || char === "'" || char === "`") {
    const literal = literalAt(text, at);
    return literal === null ? FAIL : { end: literal.end, value: literal.value };
  }
  if (char === "{")
    return objectValue(text, at);
  if (char === "[")
    return arrayValue(text, at);
  const number = NUMBER2.exec(text.slice(at));
  if (number !== null)
    return { end: at + number[0].length, value: Number(number[0]) };
  const word = /^(true|false|null)(?![\w$])/.exec(text.slice(at));
  if (word !== null) {
    const values = { false: false, null: null, true: true };
    return { end: at + word[0].length, value: values[word[1]] };
  }
  return FAIL;
}
function objectValue(text, from) {
  const value = {};
  let at = skipBlank(text, from + 1);
  while (text[at] !== "}") {
    let key;
    const quoted = literalAt(text, at);
    const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(at))?.[0];
    if (quoted !== null) {
      key = quoted.value;
      at = quoted.end;
    } else if (name !== undefined) {
      key = name;
      at += name.length;
    } else {
      return FAIL;
    }
    if (RESERVED_KEYS.includes(key) || key in value)
      return FAIL;
    at = skipBlank(text, at);
    if (text[at] !== ":")
      return FAIL;
    const inner = literalValue(text, at + 1);
    if (inner === FAIL)
      return FAIL;
    value[key] = inner.value;
    at = skipBlank(text, inner.end);
    if (text[at] === ",")
      at = skipBlank(text, at + 1);
    else if (text[at] !== "}")
      return FAIL;
  }
  return { end: at + 1, value };
}
function arrayValue(text, from) {
  const value = [];
  let at = skipBlank(text, from + 1);
  while (text[at] !== "]") {
    const inner = literalValue(text, at);
    if (inner === FAIL)
      return FAIL;
    value.push(inner.value);
    at = skipBlank(text, inner.end);
    if (text[at] === ",")
      at = skipBlank(text, at + 1);
    else if (text[at] !== "]")
      return FAIL;
  }
  return { end: at + 1, value };
}
function workflowMetaName(script) {
  const start = skipBlank(script, 0);
  const head = /^export\s+const\s+meta\s*=\s*(?=\{)/.exec(script.slice(start));
  if (head === null)
    return null;
  const meta = objectValue(script, start + head[0].length);
  if (meta === FAIL)
    return null;
  const after = script[skipBlank(script, meta.end)];
  if (after !== undefined && after !== ";" && !/\n/.test(script.slice(meta.end, skipBlank(script, meta.end)))) {
    return null;
  }
  const { description, name } = meta.value;
  if (typeof name !== "string" || name === "")
    return null;
  if (typeof description !== "string" || description === "")
    return null;
  return name;
}
function normalized(text) {
  return text.replaceAll(`\r
`, `
`);
}
function scriptAtPath(path, cwd) {
  if (cwd === "" && !isAbsolute2(path)) {
    return {
      unreadable: `The workflow script \`${path}\` is a relative path, and the hook input names no folder it is relative to.`
    };
  }
  const file = resolve5(cwd, path);
  let size;
  try {
    const stat = statSync5(file);
    if (!stat.isFile())
      return { unreadable: `The workflow script \`${file}\` is not a file.` };
    size = stat.size;
  } catch {
    return { unreadable: `The workflow script \`${file}\` does not exist.` };
  }
  if (size > WORKFLOW_SCRIPT_MAX_BYTES) {
    return {
      unreadable: `The workflow script \`${file}\` is larger than the ${WORKFLOW_SCRIPT_MAX_BYTES} bytes Claude Code runs.`
    };
  }
  try {
    return { file, script: normalized(readFileSync8(file, "utf8")) };
  } catch {
    return { unreadable: `The workflow script \`${file}\` cannot be read.` };
  }
}
function workflowFiles(folder) {
  let names;
  try {
    names = readdirSync2(folder).filter((name) => name.endsWith(".js"));
  } catch {
    return [];
  }
  return names.sort().map((name) => join9(folder, name));
}
function claiming(files, name) {
  const found = [];
  for (const file of files) {
    try {
      const stat = statSync5(file);
      if (!stat.isFile() || stat.size > WORKFLOW_SCRIPT_MAX_BYTES)
        continue;
      const script = normalized(readFileSync8(file, "utf8"));
      if (workflowMetaName(script) === name)
        found.push({ file, script });
    } catch {}
  }
  return found;
}
function oneOf2(found, name) {
  const [first] = found;
  if (first === undefined)
    return null;
  const other = found.find((one) => one.script !== first.script);
  if (other === undefined)
    return first;
  return {
    unreadable: `Two files claim the workflow name \`${name}\`: \`${first.file}\` and \`${other.file}\`. Claude Code runs one of them, and which one depends on the order the folder lists them, so the guard cannot tell. Give each workflow its own \`meta.name\`.`
  };
}
function savedFolders(place) {
  const folders = [];
  let at = resolve5(place.cwd);
  const home = resolve5(place.home);
  while (place.cwd !== "" && at !== home) {
    folders.push(join9(at, ".claude", "workflows"));
    if (existsSync7(join9(at, ".git")))
      break;
    const up = dirname4(at);
    if (up === at)
      break;
    at = up;
  }
  folders.push(join9(place.claudeConfigDir, "workflows"));
  return folders;
}
function noFile(name) {
  return {
    unreadable: `The workflow \`${name}\` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.`
  };
}
function within(folder, inside) {
  const root = resolve5(inside);
  const path = resolve5(folder);
  return path === root || path.startsWith(root.endsWith(sep2) ? root : `${root}${sep2}`);
}
function pluginFolder(plugin, place) {
  if (plugin === PLUGIN && place.pluginRoot !== null)
    return place.pluginRoot;
  const installs = installsOfPlugin(place.installedPluginsFile, plugin);
  const project = installs.filter((one) => one.scope !== "user" && one.projectPath !== null && place.cwd !== "" && within(place.cwd, one.projectPath)).sort((a, b) => b.projectPath.length - a.projectPath.length);
  const user = installs.filter((one) => one.scope === "user");
  return [...project, ...user].find((one) => existsSync7(one.installPath))?.installPath ?? null;
}
function pluginWorkflowFiles(root) {
  let listed;
  try {
    const manifest = JSON.parse(readFileSync8(join9(root, ".claude-plugin", "plugin.json"), "utf8"));
    listed = manifest?.workflows ?? manifest?.experimental?.workflows;
  } catch {
    listed = undefined;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : null;
  if (paths === null)
    return workflowFiles(join9(root, "workflows"));
  return paths.filter((one) => typeof one === "string").flatMap((one) => {
    const path = resolve5(root, one);
    try {
      if (statSync5(path).isDirectory())
        return workflowFiles(path);
    } catch {
      return [];
    }
    return path.endsWith(".js") ? [path] : [];
  });
}
function scriptByName(name, place) {
  const colon = name.indexOf(":");
  if (colon !== -1) {
    const plugin = name.slice(0, colon);
    const own = name.slice(colon + 1);
    const root = pluginFolder(plugin, place);
    if (root === null) {
      return {
        unreadable: `The workflow \`${name}\` belongs to the plugin \`${plugin}\`, and Claude Code's installed_plugins.json names no installed folder for it.`
      };
    }
    return oneOf2(claiming(pluginWorkflowFiles(root), own), name) ?? {
      unreadable: `The workflow \`${name}\`: the plugin's folder \`${root}\` holds no workflow named \`${own}\`.`
    };
  }
  for (const folder of savedFolders(place)) {
    const found = oneOf2(claiming(workflowFiles(folder), name), name);
    if (found !== null)
      return found;
  }
  return noFile(name);
}

// src/hooks/agent-launches.ts
import { appendFileSync as appendFileSync2, closeSync as closeSync3, fstatSync, openSync as openSync3, readFileSync as readFileSync9, readSync } from "fs";
import { join as join10 } from "path";
var SESSION_EFFORT = "session-effort";
var REASON_EFFORTS = [...ALLOWED_EFFORTS, EFFORT_AUTO, SESSION_EFFORT];
function reasonParts(reason) {
  const parts = reason.split(":");
  const rest = parts[0] === "opus" || parts[0] === "fable" ? parts.slice(1) : parts;
  const [first = "", ...after] = rest;
  if (REASON_EFFORTS.includes(first)) {
    return { effort: first, word: after.length === 0 ? null : after.join(":") };
  }
  const word = rest.join(":");
  return { effort: null, word: word === "" ? null : word };
}
function agentLaunchesFile(stateDir) {
  return join10(stateDir, "agent-launches.jsonl");
}
var RECORD_TAIL_BYTES = 64 * 1024;
function tailLines(file) {
  let fd;
  try {
    fd = openSync3(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const from = Math.max(0, size - RECORD_TAIL_BYTES);
    const buffer = Buffer.alloc(size - from);
    const read = readSync(fd, buffer, 0, buffer.length, from);
    const lines = buffer.subarray(0, read).toString("utf8").split(`
`);
    return (from > 0 ? lines.slice(1) : lines).filter((line) => line.trim() !== "");
  } catch {
    return [];
  } finally {
    closeSync3(fd);
  }
}
function launchKey(launch) {
  return `${launch.session}\x00${launch.toolUseId}\x00${launch.launchIndex}`;
}
function appendAgentLaunches(file, launches) {
  const written = new Set(tailLines(file).map(parseAgentLaunch).filter((one) => one !== null && one.toolUseId !== "").map(launchKey));
  const fresh = launches.filter((one) => {
    if (one.toolUseId === "")
      return true;
    const key = launchKey(one);
    if (written.has(key))
      return false;
    written.add(key);
    return true;
  });
  if (fresh.length === 0)
    return;
  try {
    appendFileSync2(file, fresh.map((one) => `${JSON.stringify(one)}
`).join(""));
  } catch {}
}
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textOrNull(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function parseAgentLaunch(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isJsonObject2(value))
    return null;
  const { at, family, model, project, reason, subagentType } = value;
  if (typeof at !== "number" || family !== "opus" && family !== "fable" || typeof model !== "string" || typeof reason !== "string") {
    return null;
  }
  const parts = "effort" in value || "word" in value ? { effort: textOrNull(value.effort), word: textOrNull(value.word) } : reasonParts(reason);
  const index = value.launchIndex;
  return {
    at,
    effort: parts.effort,
    family,
    launchIndex: typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0,
    model,
    project: typeof project === "string" ? project : "",
    reason,
    session: typeof value.session === "string" ? value.session : "",
    subagentType: typeof subagentType === "string" ? subagentType : "",
    toolUseId: typeof value.toolUseId === "string" ? value.toolUseId : "",
    word: parts.word
  };
}

// src/hooks/transcript.ts
import { closeSync as closeSync4, fstatSync as fstatSync2, openSync as openSync4, readSync as readSync2 } from "fs";
var TRANSCRIPT_TAIL_BYTES = 512 * 1024;
function isJsonObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function tailLines2(transcriptPath) {
  let text;
  try {
    const fd = openSync4(transcriptPath, "r");
    try {
      const size = fstatSync2(fd).size;
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync2(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync4(fd);
    }
  } catch {
    return null;
  }
  return text.split(`
`);
}
function* entriesFromEnd(lines) {
  for (let index = lines.length - 1;index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line === "")
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isJsonObject3(entry))
      yield entry;
  }
}
function lastClaudeModel(transcriptPath) {
  const lines = tailLines2(transcriptPath);
  if (lines === null)
    return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.isSidechain === true)
      continue;
    if (entry.type !== "assistant" || !isJsonObject3(entry.message))
      continue;
    const model = entry.message.model;
    if (typeof model === "string" && model.startsWith("claude-"))
      return model;
  }
  return null;
}

// src/hooks/agent-guard.ts
var AGENT_TOOLS = ["Agent", "Task"];
var WORKFLOW_TOOLS = ["Workflow"];
var FORK = "fork";
var BUILDER_WORDS = [FABLE_BUILD_REASON];
var READ_ONLY_AGENTS = ["Plan", "Reviewer", "Explore"];
var READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";
function agentKey(type) {
  const base = type.includes(":") ? type.split(":").pop() ?? type : type;
  return base.trim().toLowerCase().replace(/[\s_-]+/g, "-");
}
function agentList(from, env, name) {
  const listed = (env[name] ?? "").split(",").map((one) => one.trim()).filter((one) => one !== "");
  return new Set([...from, ...listed].map(agentKey));
}
function readLaunch(input) {
  const tool = stringField(input.tool_name);
  if (tool === null || !AGENT_TOOLS.includes(tool))
    return null;
  const fields = toolInput(input);
  const subagentType = stringField(fields.subagent_type);
  return {
    effort: stringField(fields.effort),
    fork: subagentType?.toLowerCase() === FORK,
    model: stringField(fields.model),
    prompt: typeof fields.prompt === "string" ? fields.prompt : "",
    subagentType,
    tool
  };
}
function endOf(text, from, open, close) {
  let depth = 0;
  for (let index = from;index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      const literal = stringAt(text, index);
      if (literal === null)
        return text.length;
      index = literal.end - 1;
      continue;
    }
    if (char === open)
      depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0)
        return index;
    }
  }
  return text.length;
}
function callText(script, open) {
  return script.slice(open, endOf(script, open, "(", ")") + 1);
}
function firstArgument(call) {
  return wholeLiteralAt(call, skipBlank(call, 1), ",)");
}
function stringOption(call, name) {
  const at = readOptions(call).keys.get(name);
  if (at === undefined)
    return null;
  const colon = /^\s*:/.exec(call.slice(at));
  if (colon === null)
    return null;
  return wholeLiteralAt(call, skipBlank(call, at + colon[0].length), ",}");
}
function callOpen(mention, script) {
  return skipBlank(script, mention.at + mention.name.length);
}
function mentionsOf(script, name) {
  const mentions = [];
  const stack = [{ braces: 0, kind: "code" }];
  for (let index = 0;index < script.length; index += 1) {
    const frame = stack.at(-1);
    if (frame === undefined)
      break;
    const char = script[index] ?? "";
    const next = script[index + 1] ?? "";
    if (frame.kind === "line") {
      if (char === `
`)
        stack.pop();
      continue;
    }
    if (frame.kind === "block") {
      if (char === "*" && next === "/") {
        stack.pop();
        index += 1;
      }
      continue;
    }
    if (frame.kind === "single" || frame.kind === "double") {
      if (char === "\\")
        index += 1;
      else if (char === (frame.kind === "single" ? "'" : '"'))
        stack.pop();
      continue;
    }
    if (frame.kind === "template") {
      if (char === "\\")
        index += 1;
      else if (char === "`")
        stack.pop();
      else if (char === "$" && next === "{") {
        stack.push({ braces: 0, kind: "code" });
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      stack.push({ braces: 0, kind: "line" });
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      stack.push({ braces: 0, kind: "block" });
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      stack.push({ braces: 0, kind: char === "'" ? "single" : "double" });
      continue;
    }
    if (char === "`") {
      stack.push({ braces: 0, kind: "template" });
      continue;
    }
    if (char === "{") {
      frame.braces += 1;
      continue;
    }
    if (char === "}") {
      if (frame.braces > 0)
        frame.braces -= 1;
      else if (stack.length > 1)
        stack.pop();
      continue;
    }
    if (script.startsWith(name, index) && (index === 0 || /[^\w.$]/.test(script[index - 1] ?? ""))) {
      const after = index + name.length;
      if (/[\w$]/.test(script[after] ?? ""))
        continue;
      mentions.push({ at: index, call: /^\s*\(/.test(script.slice(after)), name });
    }
  }
  return mentions;
}
function lineOf(script, index) {
  return script.slice(0, index).split(`
`).length;
}
function readOptions(call) {
  const stack = [];
  const seen = [];
  const keys = new Map;
  let optionsDone = false;
  let keyExpected = false;
  const found = (hidden) => ({ hidden, keys });
  const twice = (key, end) => {
    const open = seen.at(-1);
    if (open !== undefined) {
      if (open.has(key))
        return true;
      open.add(key);
    }
    if (stack.length === 1 && !optionsDone)
      keys.set(key, end);
    return false;
  };
  for (let index = 1;index < call.length; index += 1) {
    const char = call[index] ?? "";
    const next = call[index + 1] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      const literal = stringAt(call, index);
      if (literal === null)
        return found(false);
      if (keyExpected && char !== "`" && twice(literal.value, literal.end))
        return found(true);
      index = literal.end - 1;
      keyExpected = false;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = call.indexOf(`
`, index);
      if (end === -1)
        return found(false);
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = call.indexOf("*/", index + 2);
      if (end === -1)
        return found(false);
      index = end + 1;
      continue;
    }
    if (call.startsWith("...", index))
      return found(true);
    if (/\s/.test(char))
      continue;
    if (char === "{" || char === "(" || char === "[") {
      if (keyExpected && char === "[")
        return found(true);
      stack.push(char);
      if (char === "{")
        seen.push(new Set);
      keyExpected = char === "{";
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      if (char === "}") {
        seen.pop();
        if (stack.length === 1)
          optionsDone = true;
      }
      stack.pop();
      keyExpected = false;
      continue;
    }
    if (char === ",") {
      keyExpected = stack.at(-1) === "{";
      continue;
    }
    const key = keyExpected ? /^[A-Za-z_$][\w$]*/.exec(call.slice(index))?.[0] : undefined;
    if (key !== undefined) {
      if (twice(key, index + key.length))
        return found(true);
      index += key.length - 1;
    }
    keyExpected = false;
  }
  return found(false);
}
function builtAtRuntime(call) {
  return readOptions(call).hidden;
}
function callsOf(script) {
  return mentionsOf(script, "agent").filter((mention) => mention.call).map((mention) => callOpen(mention, script));
}
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
function workflowRefusal(script) {
  for (const name of ["agent", "workflow"]) {
    const handed = mentionsOf(script, name).find((mention) => !mention.call);
    if (handed === undefined)
      continue;
    return [
      `This Workflow uses \`${name}\` without calling it at once (line ${lineOf(script, handed.at)}): a variable holds it, it is optional-called (\`${name}?.(\u2026)\`), or it is passed as a value.`,
      HANDED_AROUND[name]
    ].join(`
`);
  }
  for (const mention of mentionsOf(script, "agent")) {
    if (!builtAtRuntime(callText(script, callOpen(mention, script)))) {
      continue;
    }
    return [
      `This Workflow's \`agent(\u2026)\` call at line ${lineOf(script, mention.at)} cannot be read.`,
      OPTIONS_BUILT_AT_RUNTIME
    ].join(`
`);
  }
  return null;
}
function nestedWorkflows(script) {
  const calls = [];
  for (const mention of mentionsOf(script, "workflow")) {
    if (!mention.call)
      continue;
    const call = callText(script, callOpen(mention, script));
    const line = lineOf(script, mention.at);
    const name = firstArgument(call);
    const path = call[skipBlank(call, 1)] === "{" && !builtAtRuntime(call) ? stringOption(call, "scriptPath") : null;
    if (name !== null)
      calls.push({ line, name });
    else if (path !== null)
      calls.push({ line, scriptPath: path });
    else {
      return {
        refusal: [
          `This Workflow's \`workflow(\u2026)\` call at line ${line} names its workflow at run time.`,
          'Write it as `workflow("<name>")` or `workflow({ scriptPath: "<path>" })`, with a string literal, so the guard can read what it runs.'
        ].join(`
`)
      };
    }
  }
  return { calls };
}
function readWorkflowScript(script) {
  const launches = [];
  for (const open of callsOf(script)) {
    const call = callText(script, open);
    const prompt = firstArgument(call);
    const label = stringOption(call, "label");
    launches.push({
      agentType: stringOption(call, "agentType"),
      effort: stringOption(call, "effort"),
      model: stringOption(call, "model"),
      prompt,
      where: label ?? prompt?.split(`
`)[0]?.slice(0, 60) ?? "(unreadable)"
    });
  }
  return launches;
}
function asLaunch(one) {
  return {
    effort: one.effort,
    fork: false,
    model: one.model,
    prompt: one.prompt ?? "",
    subagentType: one.agentType,
    tool: "Workflow"
  };
}
var NO_WORKFLOW_MODEL = [
  "This Workflow launch names no `model` the guard can read.",
  "An agent given none runs on the session's model and effort, which nobody chose \u2014 and a `model` held in a variable is not visible to a hook.",
  "Write `model` and `effort` as string literals in the `agent(...)` options."
].join(`
`);
var PROMPT_UNREADABLE = "The launch's prompt is built at run time, so the guard cannot read a `Fable reason:` line in it.";
function judgeWorkflow(script, ctx, env, from = null) {
  return readWorkflowScript(script).map((launch) => {
    const verdict = judgeLaunch(asLaunch(launch), ctx, env);
    if (launch.model === null && verdict.ran.modelFrom === "call") {
      return {
        from,
        launch,
        verdict: { ...deny(verdict.real, NO_WORKFLOW_MODEL), ran: verdict.ran }
      };
    }
    if (launch.prompt === null && (verdict.decision === "deny" || verdict.restsOnPrompt === true)) {
      return {
        from,
        launch,
        verdict: {
          ...verdict,
          decision: "deny",
          reason: `${verdict.reason}
${PROMPT_UNREADABLE}`
        }
      };
    }
    return { from, launch, verdict };
  });
}
function workflowReason(result) {
  const named = result.launch.where === "(unreadable)" ? "one launch" : `the launch "${result.launch.where}"`;
  const workflow = result.from === null ? "this workflow" : `the workflow \`${result.from}\``;
  return `In ${workflow}, ${named}: ${result.verdict.reason}`;
}
function resumeUnreadable(runId) {
  return `This Workflow call resumes run \`${runId}\`: the run goes on from a script the guard does not see, and it runs again every launch whose prompt or options changed.`;
}
var NO_SCRIPT = "This Workflow call names no `script`, `name` or `scriptPath`.";
function callScript(fields, place) {
  const resume = stringField(fields.resumeFromRunId);
  if (resume !== null)
    return { unreadable: resumeUnreadable(resume) };
  const name = stringField(fields.name);
  const script = stringField(fields.script);
  if (script !== null)
    return { from: name, script };
  const path = stringField(fields.scriptPath);
  const found = path !== null ? scriptAtPath(path, place.cwd) : name !== null ? scriptByName(name, place) : null;
  if (found === null)
    return { unreadable: NO_SCRIPT };
  if ("unreadable" in found)
    return found;
  return { from: path === null ? name : found.file, script: found.script };
}
function judgeWorkflowCall(fields, ctx, env, place) {
  const refused = (refusal) => ({ refusal, results: [], unreadable: [] });
  const top = callScript(fields, place);
  if ("unreadable" in top)
    return { refusal: null, results: [], unreadable: [top.unreadable] };
  const inTop = (reason) => top.from === null ? reason : `In the workflow \`${top.from}\`: ${reason}`;
  const topRefusal = workflowRefusal(top.script);
  if (topRefusal !== null)
    return refused(inTop(topRefusal));
  const nested = nestedWorkflows(top.script);
  if ("refusal" in nested)
    return refused(inTop(nested.refusal));
  const scripts = [top];
  const unreadable = [];
  for (const call of nested.calls) {
    const found = "name" in call ? scriptByName(call.name, place) : scriptAtPath(call.scriptPath, place.cwd);
    if ("unreadable" in found) {
      unreadable.push(found.unreadable);
      continue;
    }
    const from = "name" in call ? call.name : found.file;
    const deeper = mentionsOf(found.script, "workflow")[0];
    if (deeper !== undefined) {
      return refused(`The workflow \`${from}\` this one runs nests a workflow of its own (line ${lineOf(found.script, deeper.at)}): Claude Code runs workflows one level deep, and the guard reads no deeper.`);
    }
    const childRefusal = workflowRefusal(found.script);
    if (childRefusal !== null) {
      return refused(`In the workflow \`${from}\` this one runs: ${childRefusal}`);
    }
    scripts.push({ from, script: found.script });
  }
  return {
    refusal: null,
    results: scripts.flatMap((one) => judgeWorkflow(one.script, ctx, env, one.from)),
    unreadable
  };
}
var UNREADABLE_ASK = "The guard cannot see the model and effort its launches run on: approve only if you know what this workflow runs.";
var UNREADABLE_UNATTENDED = "The guard cannot see the model and effort its launches run on, and this session has nobody to answer (`claude -p`): pass the script inline (`script`), or by `scriptPath` to a file the guard can read, or run it in an interactive session.";
function workflowAnswer(call, env) {
  if (call.refusal !== null)
    return { decision: "deny", reason: call.refusal };
  const denied = call.results.find((one) => one.verdict.decision === "deny");
  if (denied !== undefined)
    return { decision: "deny", reason: workflowReason(denied) };
  if (call.unreadable.length > 0 && nobodyWatches(env)) {
    return { decision: "deny", reason: [...call.unreadable, UNREADABLE_UNATTENDED].join(`
`) };
  }
  const asks = [
    ...call.unreadable.map((reason) => `${reason}
${UNREADABLE_ASK}`),
    ...call.results.filter((one) => one.verdict.decision === "ask").map(workflowReason)
  ];
  return asks.length > 0 ? { decision: "ask", reason: asks.join(`
`) } : { decision: "allow", reason: "" };
}
function allow(real, why = "") {
  return { decision: "allow", real, reason: "", why };
}
function deny(real, reason, why = "") {
  return { decision: "deny", real, reason, why };
}
function reasonLine(prompt, label) {
  const pattern = new RegExp(`^\\s*${label}:\\s*(\\S.*)$`, "i");
  for (const line of prompt.split(`
`)) {
    const found = pattern.exec(line);
    if (found?.[1] !== undefined)
      return found[1].trim();
  }
  return null;
}
function reasonWord(text, allowed) {
  const word = firstWord2(text) ?? "";
  return allowed.includes(word) ? word : null;
}
var REASON_WORD_MAX = 40;
function firstWord2(text) {
  const found = /^[^a-z0-9]*([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(text?.toLowerCase() ?? "");
  return found?.[1]?.slice(0, REASON_WORD_MAX) ?? null;
}
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
var EFFORT_USE = "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` only when the person asks for it (an affordable gateway slot always runs at `max`).";
var NO_EFFORT = [
  "This Agent launch names no `effort`.",
  `An agent given none runs at the session's effort: pass \`effort\` on every launch, ${EFFORTS}.`,
  EFFORT_USE
].join(`
`);
function effortDenial(effort) {
  return [
    `This launch asks for effort \`${effort}\`, which no subagent may run at (the plugin's rule).`,
    `A subagent runs at ${EFFORTS} \u2014 never \`low\`, on any model.`,
    EFFORT_USE
  ].join(`
`);
}
function namedModel(real) {
  if (real.claude)
    return real.tier === "fable" ? "Claude Fable" : "Claude Opus";
  return `\`${real.tier ?? real.model}\` (answered by ${real.model})`;
}
function atEffort(effort) {
  return effort === null ? "at the session's own effort" : `at effort \`${effort.toLowerCase()}\``;
}
function opusWhy(effort, word) {
  const level = effort ?? SESSION_EFFORT;
  return word === null ? `opus:${level}` : `opus:${level}:${word}`;
}
function fableDenial(real) {
  return [
    `This launch would run on ${namedModel(real)}.`,
    `Fable advises; it builds only when the person asks. Use a read-only agent type (${READ_ONLY_AGENTS.join(", ")}) and put a line in the prompt saying why:`,
    `Fable reason: <${FABLE_REASONS.join("|")}> - <why>`,
    `An agent that can change files needs \`Fable reason: ${FABLE_BUILD_REASON} - <what the person asked>\` instead.`
  ].join(`
`);
}
function fableBuildDenial(real, type) {
  return [
    `This launch would run on ${namedModel(real)}, and it asks for \`${type || "(no type)"}\`, which can change files.`,
    "Fable builds only when the person asks: put what they asked for in the prompt as this line, and they approve this one launch:",
    `Fable reason: ${FABLE_BUILD_REASON} - <what the person asked>`
  ].join(`
`);
}
var WHERE_SET = "where it is set \u2014 the environment Claude Code was started with, or the `env` of a Claude Code settings file (the user's, the project's, or the project's local one)";
function effortLevelDenial(level) {
  return [
    `\`${EFFORT_LEVEL_ENV}\` is \`${level}\`, and Claude Code runs every subagent at it: no subagent may run at \`${level}\` (the plugin's rule).`,
    `A subagent runs at ${EFFORTS} \u2014 never \`low\`, on any model.`,
    `Only the person can change the variable: ask them to set it to one of those levels, or to remove it, ${WHERE_SET}.`
  ].join(`
`);
}
function modelNote(ran) {
  const ignored = "Claude Code ignores the launch's own `model`.";
  if (ran.modelFrom === "force") {
    return `This launch runs on \`${ran.model}\` because \`${SUBAGENT_MODEL_FORCE_ENV}\` is set, with \`${SUBAGENT_MODEL_ENV}=${ran.model}\`: ${ignored}`;
  }
  if (ran.modelFrom === "force-session") {
    const which = ran.model === null ? "" : `, \`${ran.model}\`,`;
    const unknown = ran.model === null ? " The guard cannot read the session's model, so it judges the launch as the opus tier." : "";
    return `This launch runs on the session's own model${which} because \`${SUBAGENT_MODEL_FORCE_ENV}\` is set without \`${SUBAGENT_MODEL_ENV}\`: ${ignored}${unknown}`;
  }
  if (ran.modelFrom === "workflow") {
    return `This launch runs on \`${ran.model}\` because \`${WORKFLOW_SUBAGENT_MODEL_ENV}\` is set: Claude Code ignores the script's own \`model\`.`;
  }
  return null;
}
function effortNote(ran) {
  if (ran.effortFrom === null)
    return null;
  return `It runs at effort \`${ran.effort}\` because \`${ran.effortFrom}\` is set: Claude Code ignores the launch's own \`effort\`, and only the person can change the variable, ${WHERE_SET}.`;
}
function judgeLaunch(launch, ctx, env) {
  const ran = effectiveLaunch({
    effort: launch.effort,
    fork: launch.fork,
    model: launch.model,
    workflow: launch.tool === "Workflow"
  }, env, ctx.sessionModel);
  const { verdict, namesEffortLevel } = judgeRan(launch, ran, ctx, env);
  if (verdict.decision === "allow")
    return { ...verdict, ran };
  const notes = [modelNote(ran), namesEffortLevel ? null : effortNote(ran)].filter((one) => one !== null);
  return { ...verdict, ran, reason: [...notes, verdict.reason].join(`
`) };
}
function judgeRan(launch, ran, ctx, env) {
  const judged = (verdict) => ({ namesEffortLevel: false, verdict });
  if (!launch.fork) {
    if (ran.modelFrom === "call" && ran.model === null)
      return judged(deny(null, NO_MODEL));
    if (ran.effort === null)
      return judged(deny(null, NO_EFFORT));
  }
  const real = ran.modelFrom === "fork" || ran.modelFrom === "force-session" ? sessionLaunchModel(ran.model, ctx, env) : resolveLaunchModel(ran.model ?? "", ctx, env);
  const auto = ran.effortFrom !== null && ran.effort === EFFORT_AUTO;
  if (ran.effort !== null && !auto && !effortAllowed(ran.effort)) {
    return ran.effortFrom === null ? judged(deny(real, effortDenial(ran.effort))) : { namesEffortLevel: true, verdict: deny(real, effortLevelDenial(ran.effort)) };
  }
  if (ran.effortFrom !== null && isAffordable(real) && ctx.gatewayOn && ran.effort !== AFFORDABLE_EFFORT) {
    return {
      namesEffortLevel: true,
      verdict: deny(real, [
        `This launch runs on ${real.model}, an affordable gateway slot.`,
        `An affordable slot runs at effort \`${AFFORDABLE_EFFORT}\` (its reasoning costs cents), and \`${ran.effortFrom}\` runs every subagent at \`${ran.effort}\`: only the person can change the variable \u2014 ask them to set it to \`${AFFORDABLE_EFFORT}\`, or to remove it, ${WHERE_SET}.`
      ].join(`
`))
    };
  }
  return judged(judgeModel({ ...launch, effort: ran.effort }, real, ctx, env));
}
function judgeModel(launch, real, ctx, env) {
  const type = launch.subagentType ?? "";
  const readOnly = ctx.readOnlyAgents === undefined ? agentList(READ_ONLY_AGENTS, env, READ_ONLY_AGENTS_ENV) : new Set(ctx.readOnlyAgents.map(agentKey));
  const builder = !readOnly.has(agentKey(type));
  if (real.tier === "fable") {
    const said = reasonLine(launch.prompt, "Fable reason");
    const word = reasonWord(said, builder ? BUILDER_WORDS : FABLE_REASONS);
    if (word === null)
      return deny(real, builder ? fableBuildDenial(real, type) : fableDenial(real));
    if (nobodyWatches(env)) {
      return deny(real, [
        "A Fable launch is approved by the person, one by one, and this session has nobody to answer (`claude -p`).",
        "Run it in an interactive session."
      ].join(`
`));
    }
    return {
      decision: "ask",
      real,
      reason: builder ? [
        `${namedModel(real)} launch: \`${type || "(no type)"}\` will build here, ${atEffort(launch.effort)}, at the person's request, with the reason line \`Fable reason: ${said}\`.`,
        "Fable builds only when the person asks, and this launch spends the person's own plan usage. Approve only if you asked for it."
      ].join(`
`) : [
        `${namedModel(real)} launch: a read-only agent (\`${type}\`) ${atEffort(launch.effort)}, with the reason line \`Fable reason: ${said}\`.`,
        "Fable advises; it builds only when the person asks. Approve if this is the advice, the review or the fresh attempt you want."
      ].join(`
`),
      why: `fable:${word}`,
      restsOnPrompt: true
    };
  }
  if (real.tier === "opus") {
    const said = reasonLine(launch.prompt, "Opus reason");
    const effort = launch.effort?.toLowerCase() ?? null;
    if (real.family !== "opus") {
      if (nobodyWatches(env)) {
        return deny(real, [
          `This launch names \`${real.model}\`, which the guard cannot read as Claude Opus, and such a launch is approved by the person, one by one: this session has nobody to answer (\`claude -p\`).`,
          "Name `opus` (or a Claude Opus id) as its model."
        ].join(`
`));
      }
      return {
        decision: "ask",
        real,
        reason: [
          `A launch on \`${real.model}\` ${atEffort(launch.effort)}: the guard cannot read the model behind it as Claude Opus, so it may be a higher tier.`,
          "Approve only if this launch really runs on the opus tier."
        ].join(`
`),
        why: "opus:unreadable"
      };
    }
    const why = opusWhy(effort, firstWord2(said));
    if (effort !== OPUS_ASK_EFFORT)
      return allow(real, why);
    if (nobodyWatches(env)) {
      return deny(real, [
        `A launch on ${namedModel(real)} at effort \`${effort}\` is approved by the person, one by one, and this session has nobody to answer (\`claude -p\`).`,
        `Run it at ${levelsText(OPUS_FREE_EFFORTS)}, or in an interactive session.`
      ].join(`
`));
    }
    return {
      decision: "ask",
      real,
      reason: [
        `${namedModel(real)} launch at effort \`${effort}\`: \`${type || "general-purpose"}\`${said === null ? "" : `, with the reason line "Opus reason: ${said}"`}.`,
        `The opus tier runs at ${levelsText(OPUS_FREE_EFFORTS)} with no question; \`${effort}\` only when the person asks for it. Approve only if you did.`
      ].join(`
`),
      why
    };
  }
  if (isAffordable(real)) {
    if (ctx.gatewayOn && launch.effort?.toLowerCase() !== AFFORDABLE_EFFORT) {
      return deny(real, [
        `This launch runs on ${real.model}, an affordable gateway slot.`,
        `An affordable slot runs at effort \`${AFFORDABLE_EFFORT}\` (its reasoning costs cents): pass \`effort: "${AFFORDABLE_EFFORT}"\`.`
      ].join(`
`));
    }
    return allow(real, "");
  }
  return allow(real, "");
}
function nobodyWatches(env) {
  return (env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0";
}
function sessionLaunchModel(sessionModel, gateway, env) {
  if (sessionModel === null)
    return { claude: true, family: "opus", model: "the session's model (unknown)", tier: "opus" };
  return resolveLaunchModel(sessionModel, gateway, env);
}
function gatewayConfigOf(paths) {
  try {
    return loadConfigFile(paths.gatewayConfigFile);
  } catch {
    return null;
  }
}
function sessionModelOf(input, env) {
  const transcript = stringField(input.transcript_path);
  const answered = transcript === null ? null : lastClaudeModel(transcript);
  return answered ?? stringField(env.ANTHROPIC_MODEL);
}
function gatewayOnOf(paths) {
  try {
    return settingsReport(paths.settingsFile).baseUrl !== null;
  } catch {
    return false;
  }
}
function gatewayFactsOf(paths) {
  return { config: gatewayConfigOf(paths), gatewayOn: gatewayOnOf(paths) };
}
function readGuardContext(paths, input, env) {
  return {
    ...gatewayFactsOf(paths),
    sessionModel: sessionModelOf(input, env)
  };
}
function guardFacts(input, context) {
  if (afterTheCall(input))
    return { event: RAN_EVENT };
  const guard = readGuardContext(context.paths, input, context.env);
  const tool = stringField(input.tool_name);
  if (tool !== null && WORKFLOW_TOOLS.includes(tool)) {
    const call = judgeWorkflowCall(toolInput(input), guard, context.env, workflowPlace(context.paths, context.env, stringField(input.cwd) ?? ""));
    const { decision } = workflowAnswer(call, context.env);
    const decided = call.results.find((one) => one.verdict.decision === decision);
    const why = decision === "allow" ? null : call.refusal !== null || call.unreadable.length > 0 && decided?.verdict.decision !== "deny" ? "unreadable" : decided === undefined ? decision : decided.verdict.why || decided.verdict.decision;
    return {
      decision,
      launches: call.results.length,
      tool: "Workflow",
      ...why === null ? {} : { why }
    };
  }
  const launch = readLaunch(input);
  if (launch === null)
    return {};
  const result = judgeLaunch(launch, guard, context.env);
  return {
    decision: result.decision,
    effort: launch.effort,
    family: result.real?.family ?? null,
    fork: launch.fork,
    model: launch.model,
    subagent_type: launch.subagentType,
    tier: result.real?.tier ?? null,
    tool: launch.tool,
    ...result.why === "" ? {} : { why: result.why },
    ...overrideFacts(result.ran)
  };
}
function modelOverride(ran) {
  if (ran.modelFrom === "force" || ran.modelFrom === "force-session") {
    return SUBAGENT_MODEL_FORCE_ENV;
  }
  return ran.modelFrom === "workflow" ? WORKFLOW_SUBAGENT_MODEL_ENV : null;
}
function overrideFacts(ran) {
  const model = modelOverride(ran);
  return {
    ...model === null ? {} : { model_override: model, ran_model: ran.model },
    ...ran.effortFrom === null ? {} : { effort_override: ran.effortFrom, ran_effort: ran.effort }
  };
}
function workflowPlace(paths, env, cwd) {
  return {
    claudeConfigDir: paths.claudeConfigDir,
    cwd,
    home: paths.home,
    installedPluginsFile: paths.installedPluginsFile,
    pluginRoot: stringField(env.CLAUDE_PLUGIN_ROOT)
  };
}
function recorded(result, launch, input, cwd, nowMs, index) {
  const family = result.real?.tier;
  if (family !== "opus" && family !== "fable")
    return null;
  const reason = result.why === "" ? result.decision : result.why;
  return {
    at: nowMs,
    effort: result.ran.effort?.toLowerCase() ?? SESSION_EFFORT,
    family,
    launchIndex: index,
    model: result.real?.model ?? "",
    project: cwd,
    reason,
    session: stringField(input.session_id) ?? "",
    subagentType: launch.subagentType ?? "",
    toolUseId: stringField(input.tool_use_id) ?? "",
    word: reasonParts(reason).word
  };
}
var RAN_EVENT = "PostToolUse";
function afterTheCall(input) {
  return stringField(input.hook_event_name) === RAN_EVENT;
}
function agentGuard(input, env, paths, cwd, nowMs = Date.now()) {
  const tool = stringField(input.tool_name);
  const context = readGuardContext(paths, input, env);
  const file = agentLaunchesFile(paths.stateDir);
  const ran = afterTheCall(input);
  const record = (judged) => {
    const lines = judged.map((one, index) => recorded(one.verdict, one.launch, input, cwd, nowMs, index)).filter((line) => line !== null);
    if (lines.length > 0)
      appendAgentLaunches(file, lines);
  };
  if (tool !== null && WORKFLOW_TOOLS.includes(tool)) {
    const call = judgeWorkflowCall(toolInput(input), context, env, workflowPlace(paths, env, cwd));
    const answer = workflowAnswer(call, env);
    if (answer.decision === "deny")
      return ran ? SILENT : toolDecision("deny", answer.reason);
    const asked = answer.decision === "ask";
    if (ran === asked) {
      record(call.results.map((one) => ({ launch: asLaunch(one.launch), verdict: one.verdict })));
    }
    if (ran || !asked)
      return SILENT;
    return toolDecision("ask", answer.reason);
  }
  const launch = readLaunch(input);
  if (launch === null)
    return SILENT;
  const result = judgeLaunch(launch, context, env);
  if (result.decision === (ran ? "ask" : "allow"))
    record([{ launch, verdict: result }]);
  return ran || result.decision === "allow" ? SILENT : toolDecision(result.decision, result.reason);
}

// src/hooks/fable-session.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync7, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname5, join as join12 } from "path";

// src/hooks/session-name.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync6, readFileSync as readFileSync10, renameSync as renameSync2, writeFileSync as writeFileSync3 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join11 } from "path";
function isSessionId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function namesDir(env) {
  return join11(env.TMPDIR || tmpdir2(), "cc-smart-dev-kit-session-names");
}
function readName(file) {
  try {
    return existsSync8(file) ? cleanSessionName(readFileSync10(file, "utf8")) : null;
  } catch {
    return null;
  }
}
function writeAtomic(file, text) {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync3(partial, text);
  renameSync2(partial, file);
}
function namingNote(sessionId, current) {
  const command = `${COMMAND} session-name ${sessionId} "<the task, in a few words>"`;
  return current === null ? `This session has no name yet. Name it once, as soon as its main task is clear: people and other sessions find it by this name in ListAgents and /resume. Run: ${command}` : `This session is named "${current}" after its main task. Keep it; rename it only if the name no longer describes the main task: ${command}`;
}
function sessionName(context) {
  const { project, input, event, env } = context;
  if (project.config?.sessionNames !== true)
    return SILENT;
  const sessionId = input.session_id;
  if (!isSessionId(sessionId))
    return SILENT;
  const dir = namesDir(env);
  const wanted = readName(join11(dir, `${sessionId}.name`));
  const note = namingNote(sessionId, wanted);
  if (event === "SessionStart") {
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: note }
      })
    };
  }
  const appliedFile = join11(dir, sessionId);
  const title = wanted !== null && wanted !== readName(appliedFile) ? wanted : null;
  if (title !== null) {
    mkdirSync6(dir, { recursive: true });
    writeAtomic(appliedFile, title);
    return {
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, sessionTitle: title } })
    };
  }
  return wanted === null ? {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: note }
    })
  } : SILENT;
}

// src/hooks/fable-session.ts
function fableSessionMessage(named) {
  return `${COMMAND}: this session runs on ${named}, the premium model \u2014 it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.`;
}
function fableSessionModelName(real) {
  return real.claude ? "Claude Fable" : `the \`fable\` model, ${real.model}`;
}
function fableSessionMark(env, sessionId) {
  return join12(namesDir(env), `${sessionId}.fable`);
}
function firstTime(mark) {
  try {
    mkdirSync7(dirname5(mark), { recursive: true });
    writeFileSync4(mark, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
function couldBeFable(model, env) {
  if (claudeFamily(model) === "fable")
    return true;
  const override = stringField(env[familyEnv("fable")]);
  if (override !== null && withoutContextSuffix(override.trim()) === model)
    return true;
  const text = withoutContextSuffix(model.trim());
  return text === "fable" || MODEL_SLOTS[text] === "fable";
}
function fableSession(input, env, paths) {
  const event = stringField(input.hook_event_name);
  const sessionId = input.session_id;
  if (event === null || !isSessionId(sessionId))
    return SILENT;
  if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0")
    return SILENT;
  const mark = fableSessionMark(env, sessionId);
  if (existsSync9(mark))
    return SILENT;
  let model;
  if (event === "SessionStart")
    model = stringField(input.model);
  else if (event === "PostModelSwitch")
    model = stringField(input.to_model);
  else
    model = sessionModelOf(input, env);
  if (model === null || !couldBeFable(model, env))
    return SILENT;
  const real = resolveLaunchModel(model, gatewayFactsOf(paths), env);
  if (real.tier !== "fable")
    return SILENT;
  if (!firstTime(mark))
    return SILENT;
  return systemMessage(fableSessionMessage(fableSessionModelName(real)));
}

// src/hooks/job-route.ts
var PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
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
function shellWord2(word) {
  return PLAIN_WORD.test(word) ? word : shellQuote(word);
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
  const inner = words === null ? `${shellWord2(shell)} -c ${shellQuote(command)}` : words.map(shellWord2).join(" ");
  return `${LAUNCHER_IN_SHELL} job run --kind ${kind} -- ${inner}`;
}
function runsJobRun(command) {
  return shellSegments(command).some((segment) => {
    const words = wordsOf(segment);
    const inner = invocationOf(words);
    if (inner === undefined)
      return false;
    if (isJobRun(inner.program, inner.args))
      return true;
    const nested = nestedCommand(inner.program, inner.args);
    if (nested === undefined)
      return false;
    const deeper = invocationOf(wordsOf(nested));
    return deeper !== undefined && isJobRun(deeper.program, deeper.args);
  });
}
function isJobRun(program, args) {
  const base = (program.split(/[\\/]/).pop() ?? program).replace(/\.(cmd|exe|ps1|bat)$/, "");
  return base === COMMAND && args[0] === "job" && args[1] === "run";
}
function routeHeavyCommand(command, kinds, shell) {
  if (runsJobRun(command))
    return null;
  const kind = classifyHeavyCommand(command, kinds);
  return kind === null ? null : { command: jobRunCommand(kind, command, shell), kind };
}
var REWRITE_SUPPORTED = true;
function rewriteAnswer(fields, routed) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...fields, command: routed.command }
      }
    })
  };
}
function routeDenial(routed) {
  return toolDecision("deny", [
    `This is a heavy command (${routed.kind}): running it raw does not wait for free memory, and parallel heavy runs have run machines out of memory.`,
    "Run it through the queue instead:",
    routed.command
  ].join(`
`));
}
function jobRoute(context) {
  if (context.project.config?.jobs?.route !== true)
    return SILENT;
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null)
    return SILENT;
  const routed = routeHeavyCommand(command, mergeKinds(context.project.config.jobs?.kinds), routedShell(context.env));
  if (routed === null)
    return SILENT;
  return REWRITE_SUPPORTED ? rewriteAnswer(fields, routed) : routeDenial(routed);
}
function routeFacts(input) {
  const command = stringField(toolInput(input).command);
  if (command === null)
    return {};
  return { job_run: runsJobRun(command) };
}

// src/hooks/main-folder-guard.ts
import { isAbsolute as isAbsolute3, resolve as resolve6 } from "path";
function editedFile(input, cwd) {
  const fields = toolInput(input);
  const path = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (path === null)
    return null;
  return realPath(isAbsolute3(path) ? resolve6(path) : resolve6(cwd, path));
}
function editsMainFolder(file, mainCheckout, worktrees) {
  if (!isInside(file, mainCheckout))
    return false;
  return innermostWorktree(file, [mainCheckout, ...worktrees]) === mainCheckout;
}
function mainFolderRefusal(mainCheckout) {
  return [
    `This file is in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    "Already working in a worktree? Edit the same file under that worktree's folder.",
    "Not in one yet: `EnterWorktree` with the task name as its `name` makes one, or resumes an existing one \u2014 use dashes, since a `/` becomes `+`."
  ].join(`
`);
}
function mainFolderGuard(context) {
  const { project, input, cwd, env } = context;
  if (project.config?.worktrees?.guardMainFolder !== true || project.mainCheckout === null) {
    return SILENT;
  }
  const file = editedFile(input, cwd);
  if (file === null)
    return SILENT;
  const main = realPath(project.mainCheckout);
  const [, ...worktrees] = listWorktrees(main, env, GUARD_GIT_TIMEOUT_MS);
  if (!editsMainFolder(file, main, worktrees.map((worktree) => realPath(worktree.path)))) {
    return SILENT;
  }
  return toolDecision("deny", mainFolderRefusal(main));
}

// src/workflow/resolve.ts
import { existsSync as existsSync12, readFileSync as readFileSync13 } from "fs";

// src/cli/setup.ts
import { delimiter, dirname as dirname6, join as join14 } from "path";

// src/browser/chrome.ts
var PLAYWRIGHT_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";
var PLAYWRIGHT_EXTENSION_URL = `https://chromewebstore.google.com/detail/playwright-extension/${PLAYWRIGHT_EXTENSION_ID}`;
var PLAYWRIGHT_EXTENSION_SETTINGS_URL = `chrome://extensions/?id=${PLAYWRIGHT_EXTENSION_ID}`;

// src/browser/legacy.ts
var WINDOWS_LIST = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + "Get-CimInstance Win32_Process | Where-Object CommandLine | " + 'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }';

// src/browser/token.ts
var BROWSER_TOKEN_ENV = "PLAYWRIGHT_MCP_EXTENSION_TOKEN";
var TOKEN_LINE_PREFIX = `${BROWSER_TOKEN_ENV}=`;

// src/browser/setup.ts
var WINDOWS_KEY = `HKCU\\Software\\Google\\Chrome\\Extensions\\${PLAYWRIGHT_EXTENSION_ID}`;

// src/setup/marketplace-access.ts
var TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

// src/machine/claude-mem.ts
var API_KEY = "CLAUDE_MEM_OPENAI_COMPAT_API_KEY";
var PROVIDER = "CLAUDE_MEM_PROVIDER";
var START_BLOCK_KEYS = [
  "CLAUDE_MEM_WORK_STATE_ENABLED",
  "CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED"
];
var WORK_STATE_KEY = START_BLOCK_KEYS[0];
var UNCHOSEN = {
  [PROVIDER]: ["", "claude"],
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: [""],
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: [""],
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: [""],
  [API_KEY]: [""],
  [START_BLOCK_KEYS[0]]: ["", "true"],
  [START_BLOCK_KEYS[1]]: ["", "true"]
};

// src/machine/warp.ts
var WARP_KEY_URL = "https://releases.warp.dev/linux/keys/warp.asc";
var YUM_REPO_TEXT = `[warpdotdev]
name=warpdotdev
baseurl=https://releases.warp.dev/linux/rpm/stable
enabled=1
gpgcheck=1
gpgkey=${WARP_KEY_URL}
`;

// src/setup/managed-hook.ts
var PLUGIN_CACHE = `plugins/cache/${MARKETPLACE}/${PLUGIN}/`;

// src/setup/launcher-cmd.ts
var FIND_INSTALL_JS2 = [
  "const f=process.argv[process.argv.length-1];",
  "const j=JSON.parse(require('fs').readFileSync(f,'utf8'));",
  `const e=((j&&j.plugins&&j.plugins['${PLUGIN_ID}'])||[]).find(function(x){`,
  "return x&&x.scope==='user'&&typeof x.installPath==='string';});",
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);"
].join("");

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

// src/setup/user-notify-hook.ts
var USER_NOTIFY_HOOK_NAME = "notify";
var USER_NOTIFY_COMMAND = `${LAUNCHER_IN_SHELL} hook ${USER_NOTIFY_HOOK_NAME}`;

// src/hooks/settings-hooks.ts
var RETIRED_ENGINE_HOOKS = [
  "worktree-create",
  "worktree-remove",
  "subagent-stop"
];
var RETIRED_ENGINE_LINE = new RegExp(String.raw`(^|[\s/"'])${COMMAND}(\.cmd)?["']?\s+["']?hook["']?\s+["']?(${RETIRED_ENGINE_HOOKS.join("|")})["']?(\s|;|$)`);

// src/hooks/sessions.ts
import { existsSync as existsSync10, readdirSync as readdirSync3, readFileSync as readFileSync11, statSync as statSync6 } from "fs";
import { uptime } from "os";
import { join as join13 } from "path";
function parseSessionRecord(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null)
    return null;
  const { cwd, name, pid, sessionId } = value;
  if (typeof cwd !== "string" || typeof pid !== "number" || typeof sessionId !== "string") {
    return null;
  }
  return { pid, sessionId, cwd, name: typeof name === "string" ? name : sessionId.slice(0, 8) };
}
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function liveSessions(claudeConfigDir) {
  const dir = join13(claudeConfigDir, "sessions");
  if (!existsSync10(dir))
    return [];
  const bootedAt = Date.now() - uptime() * 1000;
  const live = [];
  for (const file of readdirSync3(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid) || !isRunning(pid))
      continue;
    let text;
    try {
      if (statSync6(join13(dir, file)).mtimeMs < bootedAt)
        continue;
      text = readFileSync11(join13(dir, file), "utf8");
    } catch {
      continue;
    }
    const record = parseSessionRecord(text);
    if (record === null) {
      throw new Error(`the record of running session ${pid} in ${dir} cannot be read, so it is unknown where it works`);
    }
    live.push(record);
  }
  return live;
}

// src/sessions/command.ts
var TAIL_BYTES = 512 * 1024;

// src/cli/setup.ts
function statuslineSetting(paths) {
  return { command: `${shellWord(join14(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
}

// src/update/state.ts
import {
  appendFileSync as appendFileSync3,
  existsSync as existsSync11,
  mkdirSync as mkdirSync8,
  readdirSync as readdirSync4,
  readFileSync as readFileSync12,
  rmSync,
  statSync as statSync7,
  writeFileSync as writeFileSync5
} from "fs";
import { join as join15 } from "path";
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
function updateFiles(stateDir) {
  return {
    hold: join15(stateDir, "update-hold"),
    check: join15(stateDir, "update-check.json"),
    reported: join15(stateDir, "update-reported"),
    major: join15(stateDir, "update-major.json"),
    log: join15(stateDir, "update.log"),
    lockDir: join15(stateDir, "update"),
    sessions: join15(stateDir, "sessions")
  };
}
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;
function isHeld(files) {
  return existsSync11(files.hold);
}

// src/zod-issues.ts
function describeIssues(issues) {
  return issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
    return issue.code === "unrecognized_keys" ? `${issue.keys.join(", ")}: unknown field` : `${field}: ${issue.message}`;
  }).join("; ");
}

// src/workflow/resolve.ts
class WorkflowConfigError extends Error {
  name = "WorkflowConfigError";
}
function personalWorkflowFile(paths) {
  return paths.workflowConfigFile;
}
function loadWorkflow(file) {
  if (!existsSync12(file))
    return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync13(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowConfigError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
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
  const workers = mergedGroup(personal.workers, project.workers);
  if (workers !== undefined)
    merged.workers = workers;
  return merged;
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
    events: of("alerts.events", alerts.events ?? workflowDefaults.alerts.events),
    sound: of("alerts.sound", alerts.sound ?? workflowDefaults.alerts.sound),
    usagePercent: of("alerts.usagePercent", alerts.usagePercent ?? workflowDefaults.alerts.usagePercent)
  };
}
function statusLineIsOurs(paths) {
  try {
    const parsed = JSON.parse(readFileSync13(paths.settingsFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return false;
    const statusLine = parsed.statusLine;
    return Bun.deepEquals(statusLine, statuslineSetting(paths), true);
  } catch {
    return false;
  }
}
function current(value, source) {
  return { value, source };
}
function projectFlag(value) {
  return value === undefined ? current(false, "default") : current(value, "project");
}
function sourceLabel(value, branch) {
  return value.source === "project" && branch !== null ? `project, committed on origin/${branch}` : value.source;
}
function resolveGate(paths, checkout, branch, options = {}) {
  if (branch === null) {
    return { ok: true, gate: { branch, config: null, resolved: resolveWorkflow(paths, null) } };
  }
  let committed;
  try {
    committed = readCommittedConfig(checkout, branch, options);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  if (!committed.found)
    return { ok: false, why: committed.why };
  const resolved = resolveWorkflow(paths, committed.config);
  return { ok: true, gate: { branch, config: committed.config, resolved } };
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
  const workers = merged.workers ?? {};
  return {
    autoCommit: of("autoCommit", merged.autoCommit ?? workflowDefaults.autoCommit),
    autoPush: of("autoPush", merged.autoPush ?? workflowDefaults.autoPush),
    openPr: of("openPr", merged.openPr ?? workflowDefaults.openPr),
    autoMerge: of("autoMerge", merged.autoMerge ?? workflowDefaults.autoMerge),
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
    alerts: alertsFrom(personal, project),
    workers: {
      enabled: of("workers.enabled", workers.enabled ?? workflowDefaults.workers.enabled),
      idleStopMinutes: of("workers.idleStopMinutes", workers.idleStopMinutes ?? workflowDefaults.workers.idleStopMinutes),
      max: of("workers.max", workers.max ?? workflowDefaults.workers.max),
      maxOpus: of("workers.maxOpus", workers.maxOpus ?? workflowDefaults.workers.maxOpus),
      memoryGb: of("workers.memoryGb", workers.memoryGb ?? workflowDefaults.workers.memoryGb),
      quietMinutes: of("workers.quietMinutes", workers.quietMinutes ?? workflowDefaults.workers.quietMinutes),
      handoffPercent: of("workers.handoffPercent", workers.handoffPercent ?? workflowDefaults.workers.handoffPercent),
      softHours: of("workers.softHours", workers.softHours ?? workflowDefaults.workers.softHours),
      maxHours: of("workers.maxHours", workers.maxHours ?? workflowDefaults.workers.maxHours),
      tag: of("workers.tag", workers.tag ?? workflowDefaults.workers.tag)
    },
    switches: {
      statusLine: statusLineIsOurs(paths) ? current(true, "personal") : current(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: projectFlag(projectConfig?.jobs?.route),
      updateHold: isHeld(updateFiles(paths.stateDir)) ? current(true, "personal") : current(false, "default")
    }
  };
}

// src/workflow/auto-merge.ts
function autoMergeOff(resolved, base) {
  if (resolved.autoMerge.value)
    return null;
  const where = base ?? "the integration base (worktrees.base)";
  return `autoMerge is off (${sourceLabel(resolved.autoMerge, base)}): turn it on in ${CONFIG_PATH} ("workflow": {"autoMerge": true}), commit it to ${where} and push`;
}
function autoMergeRefusal(resolved, projectConfig, prBase, defaultBranch) {
  const off = autoMergeOff(resolved, prBase);
  if (off !== null)
    return off;
  const integration = projectConfig?.worktrees?.base;
  if (integration === undefined) {
    return "this project names no integration base (worktrees.base in .claude/cc-smart-dev-kit.json), so there is no branch cc-smart-dev-kit may merge into by itself";
  }
  if (prBase !== integration) {
    return `the pull request's base is ${prBase}, not the project's integration base ${integration}`;
  }
  if (integration === defaultBranch) {
    return `${integration} is the repository's default branch: merging there is a release, and that is your decision`;
  }
  const targets = Object.values(projectConfig?.worktrees?.bases ?? {});
  if (targets.includes(integration)) {
    return `${integration} is the target of another branch family (worktrees.bases), so it is not a plain integration base`;
  }
  return null;
}

// src/hooks/merge-guard.ts
var GH_TIMEOUT_MS2 = 1e4;
var GUARD_BUDGET_MS = 25000;
var BUDGET_MARGIN_MS = 2000;
var GUARD_BUDGET_ENV = "CC_SMART_DEV_KIT_GUARD_BUDGET_MS";
function budgetMs(env) {
  const given = Number(env[GUARD_BUDGET_ENV]);
  return Number.isFinite(given) && given > 0 ? given : GUARD_BUDGET_MS;
}
var ALIAS_LIMIT_MS = 3000;
var PULL_REQUEST_FACTS = "number,baseRefName,headRefOid";
function parsePullRequestFacts(json) {
  try {
    const view = JSON.parse(json);
    const { baseRefName, headRefOid, number } = view;
    if (typeof number !== "number" || typeof baseRefName !== "string")
      return null;
    if (typeof headRefOid !== "string" || !/^[0-9a-f]{40,64}$/.test(headRefOid))
      return null;
    return { number, base: baseRefName, headOid: headRefOid };
  } catch {
    return null;
  }
}
function parseDefaultBranch(json) {
  try {
    const view = JSON.parse(json);
    const ref = view.defaultBranchRef;
    if (typeof ref !== "object" || ref === null)
      return null;
    const name = ref.name;
    return typeof name === "string" && name !== "" ? name : null;
  } catch {
    return null;
  }
}
function parseRequiredChecks(json) {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed))
      return null;
    const checks = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null)
        return null;
      const { bucket, name } = entry;
      if (typeof bucket !== "string" || typeof name !== "string")
        return null;
      checks.push({ bucket, name });
    }
    return checks;
  } catch {
    return null;
  }
}
var PASSING_BUCKETS = new Set(["pass", "skipping"]);
function mergeRefusal(facts) {
  if (facts.branchRefusal !== null)
    return facts.branchRefusal;
  if (facts.checks === null)
    return null;
  if (facts.checks.length === 0) {
    return "gh reports no required checks for it, so there is nothing green to trust";
  }
  const failing = facts.checks.filter((check) => !PASSING_BUCKETS.has(check.bucket));
  if (failing.length > 0) {
    const list = failing.map((check) => `${check.name} (${check.bucket})`).join(", ");
    return `its required checks are not all green: ${list}`;
  }
  if (facts.reviewBeforePush && !facts.reviewed) {
    return `the head commit ${facts.headOid.slice(0, 7)} has no recorded review (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)`;
  }
  return null;
}
function notByItself(reason, number = null) {
  const which = number === null ? "this pull request" : `#${number}`;
  return `cc-smart-dev-kit will not merge ${which} by itself: ${reason}. Approve the merge yourself if you meant it.`;
}
function policyUnread(branch, why) {
  return `the merge policy committed on ${branch} cannot be read: ${why}; a policy counts once it is committed, pushed and fetched`;
}
function workflowUnread(error) {
  return `the workflow settings cannot be read (${error instanceof Error ? error.message : String(error)})`;
}
function adminRefusal(ref) {
  const which = ref === null ? "the current branch's pull request" : numericRef(ref) === null ? `\`${ref}\`` : `#${ref}`;
  return `the command merges ${which} with \`--admin\`, which uses administrator rights to merge past the repository's branch protection (its required reviews, a code-owner approval among them, its required checks and its merge queue), so you decide each one`;
}
function adminMerge(calls) {
  return calls.find((one) => one.admin && !one.disarms);
}
function notChecked(what, env) {
  const why = ghMissing(env) ? "gh is not installed" : `gh could not read ${what}`;
  return `cc-smart-dev-kit could not check this merge: ${why}. Approve the merge yourself if it is right.`;
}
function notInTime(what) {
  return `cc-smart-dev-kit could not check this merge in time: reading ${what} would have taken longer than the guard's own budget allows. Approve the merge yourself if it is right.`;
}
function ghMissing(env) {
  try {
    return Bun.which("gh", { PATH: env.PATH ?? "" }) === null;
  } catch {
    return false;
  }
}
function ghStdout(args, folder, env, timeoutMs) {
  try {
    const run = Bun.spawnSync(["gh", ...args], {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs
    });
    const out = run.stdout.toString();
    return out.trim() === "" ? null : out;
  } catch {
    return null;
  }
}
function viewPullRequest2(target, folder, env, timeoutMs = GH_TIMEOUT_MS2) {
  const out = ghStdout([
    "pr",
    "view",
    ...target.ref === null ? [] : [target.ref],
    ...target.repo === null ? [] : ["--repo", target.repo],
    "--json",
    PULL_REQUEST_FACTS
  ], folder, env, timeoutMs);
  return out === null ? null : parsePullRequestFacts(out);
}
function requiredChecks(number, repo, folder, env, timeoutMs = GH_TIMEOUT_MS2) {
  const out = ghStdout([
    "pr",
    "checks",
    String(number),
    "--required",
    ...repo === null ? [] : ["--repo", repo],
    "--json",
    "name,bucket"
  ], folder, env, timeoutMs);
  return out === null ? null : parseRequiredChecks(out);
}
function defaultBranchOf(folder, env, repo = null, timeoutMs = GH_TIMEOUT_MS2) {
  const out = ghStdout(["repo", "view", ...repo === null ? [] : [repo], "--json", "defaultBranchRef"], folder, env, timeoutMs);
  return out === null ? null : parseDefaultBranch(out);
}
function ownRepository(project, env, timeoutMs) {
  const folder = project.mainCheckout ?? project.root;
  const origin = runGit(folder, ["remote", "get-url", "origin"], env, timeoutMs);
  return origin.ok && origin.out !== "" ? repositoryKey(origin.out) : null;
}
function foreignRepository(repo, own) {
  if (repo === null)
    return null;
  const named = repositoryKey(repo);
  if (own !== null && named !== null && named === own)
    return null;
  return own === null ? `the command names the repository ${repo}, and cc-smart-dev-kit could not read this project's own (\`git remote get-url origin\`), so it cannot tell whether they are the same one` : `the command names the repository ${repo}, and the autoMerge policy covers only this project's own repository (${own})`;
}
function numericRef(ref) {
  return ref !== null && /^\d+$/.test(ref) ? Number(ref) : null;
}
function mergeGuard(context) {
  const { project, input, env, cwd, paths } = context;
  const command = stringField(toolInput(input).command);
  const dialect = dialectOfTool(input.tool_name);
  if (command === null || !requestsMerge(command, dialect))
    return SILENT;
  const config = project.config;
  if (config === null)
    return SILENT;
  const admin = adminMerge(pullRequestMerges(command, null, dialect));
  if (admin !== undefined) {
    return toolDecision("ask", notByItself(adminRefusal(admin.target?.ref ?? null)));
  }
  const startedAt = Date.now();
  const budgetAt = startedAt + budgetMs(env);
  const timeFor = (limitMs) => Math.min(limitMs, budgetAt - Date.now() - BUDGET_MARGIN_MS);
  const gates = new Map;
  const gateOf = (branch) => {
    const known = gates.get(branch);
    if (known !== undefined)
      return known;
    const left = timeFor(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0)
      return "late";
    const read = resolveGate(paths, project, branch, { env, timeoutMs: left });
    gates.set(branch, read);
    return read;
  };
  const integration = config.worktrees?.base ?? null;
  if (integration !== null) {
    let early;
    try {
      early = gateOf(integration);
    } catch (error) {
      return toolDecision("ask", notByItself(workflowUnread(error)));
    }
    if (early === "late")
      return toolDecision("ask", notInTime(`the policy committed on ${integration}`));
    if (!early.ok)
      return toolDecision("ask", notByItself(policyUnread(integration, early.why)));
    if (early.gate.config?.ownHooks?.includes("merge-guard") === true)
      return SILENT;
    const off = autoMergeOff(early.gate.resolved, integration);
    if (off !== null)
      return toolDecision("ask", notByItself(off));
  }
  const merges = mergeCalls(command, cwd, env, timeFor(ALIAS_LIMIT_MS), dialect).filter((one) => !one.disarms);
  const defaultBranches = new Map;
  let own = null;
  let ownRead = false;
  for (const merge of merges) {
    const number = numericRef(merge.target?.ref ?? null);
    if (merge.admin) {
      return toolDecision("ask", notByItself(adminRefusal(merge.target?.ref ?? null)));
    }
    if (merge.unread !== null)
      return toolDecision("ask", notChecked(merge.unread, env));
    if (merge.refusal !== null)
      return toolDecision("ask", notByItself(merge.refusal, number));
    const target = merge.target;
    if (target === null)
      continue;
    if (target.repo !== null) {
      if (!ownRead) {
        const left = timeFor(GUARD_GIT_TIMEOUT_MS);
        if (left <= 0)
          return toolDecision("ask", notInTime("this project's own repository"));
        own = ownRepository(project, env, left);
        ownRead = true;
      }
      const foreign = foreignRepository(target.repo, own);
      if (foreign !== null)
        return toolDecision("ask", notByItself(foreign, number));
    }
    const viewLeft = timeFor(GH_TIMEOUT_MS2);
    if (viewLeft <= 0) {
      return toolDecision("ask", notInTime("the pull request this command names"));
    }
    const view = viewPullRequest2(target, cwd, env, viewLeft);
    if (view === null) {
      return toolDecision("ask", notChecked("the pull request this command names", env));
    }
    let read;
    try {
      read = gateOf(view.base);
    } catch (error) {
      return toolDecision("ask", notByItself(workflowUnread(error), view.number));
    }
    if (read === "late") {
      return toolDecision("ask", notInTime(`the policy committed on ${view.base}`));
    }
    if (!read.ok) {
      return toolDecision("ask", notByItself(policyUnread(view.base, read.why), view.number));
    }
    const { resolved, config: committed } = read.gate;
    const where = target.repo ?? "";
    if (!defaultBranches.has(where)) {
      const branchLeft = timeFor(GH_TIMEOUT_MS2);
      if (branchLeft <= 0) {
        return toolDecision("ask", notInTime("this repository's default branch"));
      }
      defaultBranches.set(where, defaultBranchOf(cwd, env, target.repo, branchLeft));
    }
    const defaultBranch = defaultBranches.get(where) ?? null;
    if (defaultBranch === null) {
      return toolDecision("ask", notChecked("this repository's default branch", env));
    }
    const branchRefusal = autoMergeRefusal(resolved, committed, view.base, defaultBranch);
    let checks = null;
    if (branchRefusal === null) {
      const checksLeft = timeFor(GH_TIMEOUT_MS2);
      if (checksLeft <= 0) {
        return toolDecision("ask", notInTime(`the required checks of #${view.number}`));
      }
      checks = requiredChecks(view.number, target.repo, cwd, env, checksLeft);
      if (checks === null) {
        return toolDecision("ask", notChecked(`the required checks of #${view.number}`, env));
      }
    }
    const repository = project.mainCheckout ?? project.root;
    const reviewed = !resolved.reviewBeforePush.value || hasReview(reviewsFile(paths.stateDir, repository), view.headOid, resolved.reviewAgents.value);
    const reason = mergeRefusal({
      branchRefusal,
      checks,
      headOid: view.headOid,
      reviewBeforePush: resolved.reviewBeforePush.value,
      reviewed
    });
    if (reason !== null)
      return toolDecision("ask", notByItself(reason, view.number));
  }
  return SILENT;
}

// src/hooks/message-guard.ts
function messageLeavesRepo(to, sessions, repoFolders) {
  const name = withoutListRef(to);
  const named = sessions.filter((session) => session.name === name);
  const outside = named.filter((session) => !repoFolders.some((folder) => isInside(realPath(session.cwd), folder)));
  return named.length > 0 && outside.length === named.length ? outside[0]?.cwd ?? null : null;
}
function otherProjectRefusal(to, folder) {
  return [
    `"${to}" works in ${folder}, outside this repo: sessions message only sessions of their own repo.`,
    "ListAgents lists every Claude session on the machine, other projects too."
  ].join(`
`);
}
function messageGuard(context) {
  const { project, input, env, paths } = context;
  if (project.config === null)
    return SILENT;
  const to = stringField(toolInput(input).to);
  if (to === null)
    return SILENT;
  let sessions;
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    return SILENT;
  }
  const repo = realPath(project.mainCheckout ?? project.root);
  const folders = listWorktrees(repo, env, GUARD_GIT_TIMEOUT_MS).map((worktree) => realPath(worktree.path));
  const folder = messageLeavesRepo(to, sessions, folders);
  return folder === null ? SILENT : toolDecision("deny", otherProjectRefusal(to, folder));
}

// src/hooks/subagent-worktree.ts
function subagentWorktreeOf(cwd, agentId) {
  if (agentId === null || !/^[0-9a-f]+$/.test(agentId))
    return null;
  const found = new RegExp(String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-${agentId})(?:[\\/]|$)`).exec(cwd);
  return found?.[1] ?? null;
}

// src/hooks/review-record.ts
function agentTypeOf(input) {
  return stringField(input.agent_type);
}
function headBranch(folder, env) {
  const run = runGit(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"], env, GUARD_GIT_TIMEOUT_MS);
  return run.ok && run.out !== "" ? run.out : null;
}
function headCommit(folder, env) {
  const run = runGit(folder, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], env, GUARD_GIT_TIMEOUT_MS);
  return run.ok && /^[0-9a-f]{40,64}$/.test(run.out) ? run.out : null;
}
function said(why) {
  return { stderr: `cc-smart-dev-kit review-record: ${why}` };
}
function inSubagentWorktree(cwd, agentId) {
  if (subagentWorktreeOf(cwd, agentId) !== null)
    return true;
  return /[\\/]\.claude[\\/]worktrees[\\/]agent-[0-9a-f]+(?:[\\/]|$)/.test(cwd);
}
async function reviewRecord(context) {
  const { project, input, event, env, cwd, paths } = context;
  const config = project.config;
  if (config === null)
    return SILENT;
  const agent = agentTypeOf(input);
  if (agent === null)
    return SILENT;
  const agentId = stringField(input.agent_id);
  if (inSubagentWorktree(cwd, agentId === null ? null : agentIdKey(agentId)))
    return SILENT;
  let resolved;
  try {
    resolved = resolveWorkflow(paths, config);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return said(`the workflow settings cannot be read (${why})`);
  }
  if (!recordsReview(agent, resolved.reviewAgents.value))
    return SILENT;
  if (agentId === null)
    return SILENT;
  const repository = project.mainCheckout ?? project.root;
  const commit = headCommit(cwd, env);
  try {
    if (event === "SubagentStart") {
      if (commit !== null) {
        await noteReviewStart(reviewStartsFile(paths.stateDir, repository), agentId, commit, Date.now(), headBranch(cwd, env));
      }
      return SILENT;
    }
    const start = await takeReviewStart(reviewStartsFile(paths.stateDir, repository), agentId);
    if (commit === null)
      return SILENT;
    if (start === null) {
      return said("no start was seen for this review agent, so no review is recorded: run the review again");
    }
    await recordReview(reviewsFile(paths.stateDir, repository), start.head, agent, Date.now(), start.branch);
  } catch (error) {
    return said(`cannot write the record (${error instanceof Error ? error.message : String(error)})`);
  }
  return SILENT;
}
// src/hooks/worktree-leftovers.ts
import { readFileSync as readFileSync15, statSync as statSync8 } from "fs";
import { basename as basename3, isAbsolute as isAbsolute4, join as join17, resolve as resolve7 } from "path";

// src/hooks/local-files.ts
import { lstatSync as lstatSync2, readdirSync as readdirSync5, readFileSync as readFileSync14, readlinkSync as readlinkSync3 } from "fs";
import { join as join16 } from "path";
var REBUILDABLE = [
  /(?:^|\/)(?:node_modules|bower_components|jspm_packages|\.venv|venv|\.tox|\.nox|\.bundle|\.gradle|\.pnpm-store|\.yarn\/cache)\/$/,
  /(?:^|\/)(?:dist|build|out|target|coverage|\.next|\.nuxt|\.output|\.svelte-kit|\.turbo|\.vercel|\.parcel-cache|\.angular|storybook-static|test-results|playwright-report|htmlcov|\.nyc_output)\/$/,
  /(?:^|\/)(?:\.cache|\.vite|\.eslintcache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.hypothesis|\.terraform|\.dart_tool)\/?$/,
  /\.(?:tsbuildinfo|pyc|pyo)$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)Thumbs\.db$/,
  /(?:^|\/)(?:npm-debug|yarn-debug|yarn-error|pnpm-debug|lerna-debug)\.log/
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
    const here = join16(worktree, relative);
    const there = join16(mainCheckout, relative);
    try {
      const a = lstatSync2(here);
      const b = lstatSync2(there);
      if (a.isSymbolicLink() || b.isSymbolicLink()) {
        return a.isSymbolicLink() && b.isSymbolicLink() && readlinkSync3(here) === readlinkSync3(there);
      }
      if (a.isDirectory()) {
        return b.isDirectory() && readdirSync5(here).every((entry) => same(join16(relative, entry)));
      }
      return a.isFile() && b.isFile() && a.size === b.size && readFileSync14(here).equals(readFileSync14(there));
    } catch {
      return false;
    }
  };
  return same(path.replace(/\/$/, ""));
}
function localFiles(worktree, mainCheckout, env) {
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
  return parseIgnored(status.out).filter((entry) => !REBUILDABLE.some((pattern) => pattern.test(entry)) && !(mainCheckout !== null && sameAsMain(worktree, mainCheckout, entry)));
}

// src/hooks/worktree-leftovers.ts
var IDLE_MINUTES = 60;
function idleMinutes(worktree, now) {
  let admin;
  try {
    admin = readFileSync15(join17(worktree, ".git"), "utf8").trim().replace(/^gitdir:\s*/, "");
  } catch {
    return 0;
  }
  if (!isAbsolute4(admin))
    admin = resolve7(worktree, admin);
  let last = 0;
  for (const file of ["index", "HEAD", join17("logs", "HEAD")]) {
    try {
      last = Math.max(last, statSync8(join17(admin, file)).mtimeMs);
    } catch {}
  }
  return last === 0 ? 0 : (now - last) / 60000;
}
function judgeWorktree(repo, listed, base, sessions, env, now) {
  if (listed.locked)
    return "kept";
  if (listed.prunable)
    return "gone";
  try {
    statSync8(listed.path);
  } catch {
    return "gone";
  }
  if (sessions.some((session) => isInside(session.cwd, listed.path)))
    return "kept";
  const ahead = runGit(repo, ["rev-list", "--count", `refs/remotes/origin/${base}..${listed.head}`], env);
  if (!ahead.ok || ahead.out !== "0")
    return "kept";
  if (idleMinutes(listed.path, now) < IDLE_MINUTES)
    return "kept";
  if (hasChanges(listed.path, env))
    return "kept";
  return localFiles(listed.path, repo, env)?.length === 0 ? "finished" : "kept";
}
function leftoversNote(base, finished, gone) {
  const parts = [];
  if (finished.length > 0) {
    const names = finished.map((worktree) => basename3(worktree.path)).join(", ");
    const count = finished.length === 1 ? "1 finished worktree is" : `${finished.length} finished worktrees are`;
    parts.push(`${count} left in this repo: ${names}. Each has every commit on origin/${base}, nothing uncommitted, no running session, and no git use for an hour. ` + "Tell the user, and when they agree, clear them in the main checkout with `cc-smart-dev-kit worktrees --clean` \u2014 it judges each one again, Docker containers and running programs included, before it removes anything.");
  }
  if (gone.length > 0) {
    parts.push(`${gone.length === 1 ? "1 worktree is still listed, but its folder is gone" : `${gone.length} worktrees are still listed, but their folders are gone`}: ${gone.map((worktree) => worktree.path).join(", ")}. \`git worktree prune\` in the main checkout forgets ${gone.length === 1 ? "it" : "them"}.`);
  }
  return parts.length === 0 ? null : parts.join(`
`);
}
function worktreeLeftovers(context) {
  const { project, env, paths, event } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined)
    return SILENT;
  const repo = project.mainCheckout ?? project.root;
  const [, ...linked] = listWorktrees(repo, env);
  if (linked.length === 0)
    return SILENT;
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], env).ok) {
    return SILENT;
  }
  let sessions;
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    return SILENT;
  }
  const now = Date.now();
  const finished = [];
  const gone = [];
  for (const listed of linked) {
    const verdict = judgeWorktree(repo, listed, base, sessions, env, now);
    if (verdict === "finished")
      finished.push(listed);
    if (verdict === "gone")
      gone.push(listed);
  }
  const note = leftoversNote(base, finished, gone);
  return note === null ? SILENT : addContext(event, note);
}

// src/hooks/specs.ts
function cannotCheck(what, message) {
  return `cc-smart-dev-kit cannot check ${what}: ${message}`;
}
var gitGuardHook = {
  name: "git-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command !== null && runsGit(command) ? toolDecision("ask", cannotCheck("this git command", message)) : SILENT;
  },
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  run: ({ project, input, cwd, env }) => {
    const config = project.config;
    if (config === null)
      return SILENT;
    const command = stringField(toolInput(input).command);
    if (command === null)
      return SILENT;
    const questions = guardQuestions(command, cwd, {
      protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
      sharedStash: config.worktrees !== undefined,
      env
    });
    return questions.length === 0 ? SILENT : toolDecision("ask", questions.join(`
`));
  }
};
var mergeGuardHook = {
  name: "merge-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command !== null && requestsMerge(command) ? toolDecision("ask", cannotCheck("whether this merge may happen by itself", message)) : SILENT;
  },
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  run: mergeGuard
};
var mainFolderGuardHook = {
  name: "main-folder-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input, _event, checkout) => {
    const file = typeof input.cwd === "string" ? editedFile(input, input.cwd) : null;
    const repo = checkout.mainCheckout ?? checkout.root;
    return file !== null && isInside(file, repo) ? toolDecision("ask", cannotCheck("whether this edit belongs in a worktree", message)) : SILENT;
  },
  run: mainFolderGuard
};
var messageGuardHook = {
  name: "message-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message) => toolDecision("ask", cannotCheck("whether this message stays in this repo", message)),
  run: messageGuard
};
var afterMergeHook = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
  onConfigProblem: (message, input, event) => {
    const command = stringField(toolInput(input).command);
    return command !== null && mergesPullRequest(command) ? addContext(event, `cc-smart-dev-kit: ${message}`) : SILENT;
  },
  run: afterMerge
};
var reviewRecordHook = {
  name: "review-record",
  events: ["SubagentStart", "SubagentStop"],
  onConfigProblem: (message, input, event) => {
    const agent = agentTypeOf(input);
    return event === "SubagentStop" && agent !== null && recordsReview(agent, workflowDefaults.reviewAgents) ? { stderr: `cc-smart-dev-kit review-record: ${message}` } : SILENT;
  },
  run: reviewRecord
};
var worktreeLeftoversHook = {
  name: "worktree-leftovers",
  events: ["SessionStart"],
  onConfigProblem: (message, _input, event) => addContext(event, `cc-smart-dev-kit: ${message}`),
  run: worktreeLeftovers
};
var sessionNameHook = {
  name: "session-name",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit session-name: ${message}` }),
  run: sessionName
};
var agentGuardHook = {
  name: "agent-guard",
  events: ["PreToolUse"],
  onConfigProblem: (_message, input, _event, _checkout, context) => agentGuard(input, context.env, context.paths, cwdOf(input)),
  outsideGit: (input, _event, _why, context) => agentGuard(input, context.env, context.paths, cwdOf(input)),
  logFacts: guardFacts,
  run: ({ input, env, paths, cwd }) => agentGuard(input, env, paths, cwd)
};
var fableSessionHook = {
  name: "fable-session",
  events: ["SessionStart", "PostModelSwitch", "Stop"],
  onConfigProblem: (_message, input, _event, _checkout, context) => fableSession(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => fableSession(input, context.env, context.paths),
  run: ({ input, env, paths }) => fableSession(input, env, paths)
};
var jobRouteHook = {
  name: "job-route",
  events: ["PreToolUse"],
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command === null || classifyHeavyCommand(command, mergeKinds(undefined)) === null ? SILENT : toolDecision("ask", cannotCheck("whether this project routes heavy commands through its job queue", message));
  },
  logFacts: routeFacts,
  run: jobRoute
};
function cwdOf(input) {
  return stringField(input.cwd) ?? "";
}
var HOOKS = [
  gitGuardHook,
  mergeGuardHook,
  mainFolderGuardHook,
  messageGuardHook,
  agentGuardHook,
  fableSessionHook,
  jobRouteHook,
  afterMergeHook,
  reviewRecordHook,
  worktreeLeftoversHook,
  sessionNameHook
];
var NON_GUARD_PRE_TOOL_USE = new Set(["playwright-output"]);
var GUARD_BUNDLES = new Set(HOOKS.filter((spec) => spec.events.includes("PreToolUse") && !NON_GUARD_PRE_TOOL_USE.has(spec.name)).map((spec) => spec.name));
var USER_HOOKS = [
  "stop-failure",
  "update-check",
  "notify",
  "playwright-output"
];
var MACHINE_WIDE_HOOKS = [
  ...USER_HOOKS,
  "agent-guard",
  "fable-session"
];

// src/entries/session-name.ts
await runHookEntry(sessionNameHook);
