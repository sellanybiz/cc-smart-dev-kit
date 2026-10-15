// @bun
// src/entries/cli.ts
import { existsSync as existsSync18 } from "fs";
import { join as join11 } from "path";

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

// src/cli/doctor.ts
import { accessSync, constants, existsSync as existsSync9, readFileSync as readFileSync10 } from "fs";
import { join as join7 } from "path";

// src/gateway/doctor.ts
import { existsSync as existsSync6, readFileSync as readFileSync7 } from "fs";

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
    routerUnitFile: join(home, ".config", "systemd", "user", "anymodel-router.service")
  };
}
function tildify(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// src/gateway/config.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, statSync as statSync2 } from "fs";
import { dirname as dirname2 } from "path";

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
// src/setup/write.ts
import {
  chmodSync,
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
import { basename, dirname, join as join2, resolve } from "path";
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
      return parent === path ? path : join2(realTarget(parent), basename(path));
    }
    path = resolve(dirname(path), readlinkSync(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}
function fileMode(file) {
  return existsSync(file) ? statSync(file).mode & 4095 : null;
}
function writeTemp(file, content, mode) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join2(dir, `.${basename(file)}.anymodel-tmp-${process.pid}-${crypto.randomUUID()}`);
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
  return join2(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}
function makePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
}
function listBackups(stateDir, file) {
  const dir = backupDir(stateDir, file);
  if (!existsSync(dir))
    return [];
  const base = basename(realTarget(file));
  return readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup !== null).sort((a, b) => a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1).map((backup) => {
    const path = join2(dir, backup.name);
    return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 384 };
  });
}
function copyNotExecutable(file, target) {
  const mode = fileMode(file) ?? 384;
  const safeMode = mode & ~73;
  writeFileSync(target, readFileSync(file), { flag: "wx", mode: safeMode });
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
  makePrivateDir(join2(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  const sameStamp = readdirSync(dir).map((name) => parseBackupName(base, name)).filter((backup) => backup?.stamp === stamp);
  const counter = sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join2(dir, `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`);
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
  const file = join2(stateDir, CHANGED_FILE);
  if (!existsSync(file))
    return {};
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const files = parsed?.files;
  if (typeof files !== "object" || files === null || !Object.values(files).every((entry) => isChangedEntry(entry))) {
    throw new Error(`Invalid ${file}: expected { "files": { <path>: { kinds, baseline } } }`);
  }
  return files;
}
function writeChanged(stateDir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
  atomicWrite(join2(stateDir, CHANGED_FILE), `${JSON.stringify({ files: sorted }, null, 2)}
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
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
function writeManagedFile(file, content, options) {
  const target = realTarget(file);
  const currentMode = fileMode(target);
  const current = currentMode === null ? null : readFileSync(target, "utf8");
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
    if (!isBaseline && existsSync(backup))
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

// src/gateway/targets.ts
var BACKEND_NAME = /^[a-z0-9][a-z0-9_-]*$/;
var SLOT_PREFIX = "anymodel-";
var SLOT_KEY = /^anymodel-[a-z0-9][a-z0-9-]*$/;
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
function formatTarget(target) {
  return target.kind === "anthropic" ? target.model : `${target.backend}:${target.model}`;
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
function slotKeyFromArg(arg) {
  const key = arg.startsWith(SLOT_PREFIX) ? arg : `${SLOT_PREFIX}${arg}`;
  return isSlotKey(key) ? key : null;
}
function resolveAlias(model, aliases) {
  if (typeof model !== "string" || model === "")
    return null;
  const name = withoutContextSuffix(model);
  if (!Object.hasOwn(aliases, name))
    return null;
  const to = aliases[name];
  return to === undefined ? null : { from: name, to };
}
function resolveRoute(model, config) {
  if (typeof model !== "string" || model === "" || model.startsWith("claude-")) {
    return { kind: "anthropic" };
  }
  const name = withoutContextSuffix(model);
  if (isSlotKey(name)) {
    const texts = Object.hasOwn(config.slots, name) ? config.slots[name] : undefined;
    if (texts === undefined)
      return { kind: "unknown-slot", slot: name };
    const targets = [];
    for (const text of texts) {
      const parsed = parseTarget(text);
      if ("target" in parsed)
        targets.push(parsed.target);
    }
    return { kind: "slot", slot: name, targets };
  }
  const parsed = parseTarget(name);
  if ("target" in parsed && parsed.target.kind === "backend" && Object.hasOwn(config.backends, parsed.target.backend)) {
    return { kind: "explicit", target: parsed.target };
  }
  return { kind: "anthropic" };
}
var GUARD_PROMPT = "You are a security monitor for autonomous AI coding agents";
function isAutoModeGuard(body, aliases = {}) {
  const model = body.model;
  if (typeof model !== "string")
    return false;
  const tools = body.tools;
  if (Array.isArray(tools) && tools.length > 0)
    return false;
  const name = withoutContextSuffix(model);
  if (!model.startsWith("claude-") && !isSlotKey(name) && !Object.hasOwn(aliases, name)) {
    return false;
  }
  const system = body.system;
  if (typeof system === "string")
    return system.includes(GUARD_PROMPT);
  if (!Array.isArray(system))
    return false;
  return system.some((block) => {
    if (typeof block !== "object" || block === null || !("text" in block))
      return false;
    return typeof block.text === "string" && block.text.includes(GUARD_PROMPT);
  });
}
function resolveRequestRoute(body, config, guard) {
  const route = resolveRoute(body.model, config);
  if (!guard)
    return route;
  if (route.kind === "explicit")
    return { kind: "anthropic-as-sent" };
  if (route.kind !== "slot")
    return route;
  const claude = route.targets.filter((target) => target.kind === "anthropic");
  return claude.length > 0 ? { ...route, targets: claude } : { kind: "anthropic-as-sent" };
}
var JUDGE_SLOT = "anymodel-judge";
var FALLBACK_ANY = new Set([408, 429, 500, 502, 503, 504, 529]);
function fallbackKind(status, target) {
  if (FALLBACK_ANY.has(status))
    return "next";
  if (target.kind === "backend" && (status < 200 || status > 299))
    return "next-warn";
  return "stay";
}
var COOLDOWN_DEFAULT_SEC = { busy: 60, down: 30 };
var COOLDOWN_MAX_SEC = 600;
function cooldownSeconds(status, retryAfter) {
  let fallback = null;
  if (status === null || status === 408 || status >= 500)
    fallback = COOLDOWN_DEFAULT_SEC.down;
  if (status === 429)
    fallback = COOLDOWN_DEFAULT_SEC.busy;
  if (fallback === null)
    return null;
  const seconds = status !== null && retryAfter !== null ? retryAfter : fallback;
  return Math.min(Math.max(seconds, 0), COOLDOWN_MAX_SEC);
}

// src/gateway/config.ts
var DEFAULT_PORT = 20100;
var DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
var DEFAULT_FIRST_BYTE_MS = 60000;
var FALLBACK_SLOT_TARGET = "claude-sonnet-5-5";
var NO_CONFIG_MEANS = `every haiku / sonnet call answers on ${FALLBACK_SLOT_TARGET} (your own Claude login) until it is fixed`;
var baseUrl = url({ protocol: /^https?$/ }).transform((url2) => url2.replace(/\/+$/, ""));
var backendSchema = looseObject({
  apiKey: string2().min(1),
  baseUrl
});
var gatewayConfigSchema = looseObject({
  aliases: record(string2(), string2()).default({}),
  anthropicBaseUrl: literal(DEFAULT_ANTHROPIC_BASE_URL).default(DEFAULT_ANTHROPIC_BASE_URL),
  backends: record(string2().refine(isBackendName, "not a backend name"), backendSchema),
  port: int().min(1).max(65535).default(DEFAULT_PORT),
  slots: record(string2().refine(isSlotKey, "a slot key is anymodel-<name>"), array(string2()).min(1)),
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
});
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
function loadConfigFile(path) {
  let mode;
  try {
    mode = statSync2(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if ((mode & 63) !== 0) {
    throw new ConfigError(`${path} can be read by other users (mode ${(mode & 511).toString(8)}); it holds API keys. Run: chmod 600 ${path}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync2(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON. Fix it by hand.`, { cause: error });
  }
  const parsed = parseConfig(raw);
  if ("error" in parsed)
    throw new ConfigError(`${path} is not a valid gateway config:
${parsed.error}`);
  return parsed.config;
}
function saveConfig(path, config) {
  const parsed = parseConfig(config);
  if ("error" in parsed)
    throw new ConfigError(`refusing to save an invalid config:
${parsed.error}`);
  mkdirSync2(dirname2(path), { mode: 448, recursive: true });
  atomicWrite(path, `${JSON.stringify(parsed.config, null, 2)}
`, 384);
}
function emptyConfig() {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: {},
    port: DEFAULT_PORT,
    slots: {
      "anymodel-scout": [FALLBACK_SLOT_TARGET],
      "anymodel-worker": [FALLBACK_SLOT_TARGET]
    },
    timeouts: { firstByteMs: DEFAULT_FIRST_BYTE_MS },
    version: 1
  };
}
var REAL_WATCH_DEPS = { load: loadConfigFile, stat: statSync2 };
function watchConfig(path, log, deps = REAL_WATCH_DEPS) {
  let current = emptyConfig();
  let good = false;
  let seen = null;
  const refresh = () => {
    let stamp;
    try {
      const stats = deps.stat(path);
      stamp = `${stats.mtimeMs}:${stats.size}:${stats.mode}:${stats.ctimeMs}`;
    } catch (error) {
      const gone = `gone:${messageOf(error)}`;
      if (gone !== seen) {
        log(`ERROR config ${path} cannot be read (${messageOf(error)}); ${good ? "keeping the last good config" : NO_CONFIG_MEANS}`);
      }
      seen = gone;
      return;
    }
    if (stamp === seen)
      return;
    seen = stamp;
    try {
      current = deps.load(path);
      if (good)
        log(`config reloaded from ${path}`);
      good = true;
    } catch (error) {
      log(`ERROR ${messageOf(error)}
${good ? "keeping the last good config" : NO_CONFIG_MEANS}`);
    }
  };
  refresh();
  return {
    get() {
      refresh();
      return current;
    },
    loaded: () => good
  };
}

// src/gateway/backends.ts
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseModelList(body) {
  if (!isJsonObject(body) || !Array.isArray(body.data))
    return [];
  const models = [];
  for (const entry of body.data) {
    if (!isJsonObject(entry) || typeof entry.id !== "string")
      continue;
    const context = entry.context_length;
    models.push({ contextLength: typeof context === "number" ? context : null, id: entry.id });
  }
  return models;
}
async function listModels(baseUrl, apiKey, timeoutMs = 1e4) {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { models: [], status: response.status };
    }
    return { models: parseModelList(await response.json()), status: response.status };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

// src/gateway/commands.ts
import { existsSync as existsSync5 } from "fs";

// src/setup/lock.ts
import {
  closeSync as closeSync2,
  fchmodSync,
  mkdirSync as mkdirSync3,
  openSync as openSync2,
  readFileSync as readFileSync3,
  readlinkSync as readlinkSync2,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeSync
} from "fs";
import { hostname } from "os";
import { join as join3 } from "path";
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
    fchmodSync(fd, mode);
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
  mkdirSync3(stateDir, { recursive: true });
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
      throw new LockBusyError(`anymodel is busy: ${who} holds ${file}. Wait for it to finish, then try again.`);
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

// src/setup/managed-json.ts
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "fs";
import { join as join4 } from "path";
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
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function samePath(a, b) {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}
function readJsonObject(file) {
  if (!existsSync2(file))
    return { data: {}, indent: "  ", text: null };
  const text = readFileSync4(file, "utf8");
  if (text.trim() === "")
    return { data: {}, indent: "  ", text };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject2(parsed))
    throw new Error(`${file} must hold a JSON object.`);
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  return { data: parsed, indent, text };
}
function readOwned(stateDir) {
  const file = join4(stateDir, OWNED_FILE);
  if (!existsSync2(file))
    return {};
  const parsed = JSON.parse(readFileSync4(file, "utf8"));
  if (!isObject2(parsed))
    throw new Error(`Invalid ${file}: expected an object`);
  return parsed;
}
function writeOwned(stateDir, owned) {
  atomicWrite(join4(stateDir, OWNED_FILE), `${JSON.stringify(owned, null, 2)}
`, 384);
}
function ownedKeys(stateDir, file) {
  return readOwned(stateDir)[file] ?? [];
}
function getKey(data, path) {
  let node = data;
  for (const segment of path) {
    if (!isObject2(node) || !Object.hasOwn(node, segment))
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
    } else if (!isObject2(next)) {
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
  if (parent.found && isObject2(parent.value) && leaf !== undefined)
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
      throw new ForeignKeyError(`${file}: ${formatKeyPath(path)} is ${JSON.stringify(current.value)}, set by someone else. ` + "anymodel does not overwrite it. Remove it by hand if anymodel should manage it.");
    }
    setKey(data, path, value);
    changes.push({ path, before: current.found ? current.value : undefined, after: value });
    if (!isOwned(path))
      claimed.push([...path]);
  }
  for (const path of options.remove ?? []) {
    if (!isOwned(path)) {
      skipped.push({ path, reason: "not owned by anymodel; left alone" });
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

// src/gateway/router.ts
var HEALTH_PATH = "/__anymodel/health";
var MESSAGES_PATH = "/v1/messages";
var COUNT_TOKENS_PATH = "/v1/messages/count_tokens";
var HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var BACKEND_HEADER_ALLOW_LIST = [
  "accept",
  "anthropic-version",
  "content-type",
  "user-agent",
  "x-claude-code-session-id"
];
var NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
function anthropicError(status, type, message) {
  return Response.json({ error: { message, type }, type: "error" }, { status });
}
function droppedHeaders(headers) {
  const dropped = new Set(HOP_BY_HOP);
  for (const name of (headers.get("connection") ?? "").split(",")) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed !== "")
      dropped.add(trimmed);
  }
  return dropped;
}
function anthropicRequestHeaders(client) {
  const dropped = droppedHeaders(client);
  dropped.add("host");
  dropped.add("content-length");
  const out = new Headers;
  client.forEach((value, name) => {
    if (!dropped.has(name) && !name.startsWith("proxy-"))
      out.append(name, value);
  });
  return out;
}
function backendRequestHeaders(client, apiKey) {
  const out = new Headers;
  for (const name of BACKEND_HEADER_ALLOW_LIST) {
    const value = client.get(name);
    if (value !== null)
      out.set(name, value);
  }
  if (!out.has("content-type"))
    out.set("content-type", "application/json");
  out.set("authorization", `Bearer ${apiKey}`);
  return out;
}
function retryAfterSeconds(value, nowMs) {
  const trimmed = (value ?? "").trim();
  if (trimmed === "")
    return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds))
    return seconds < 0 ? null : Math.ceil(seconds);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at))
    return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}
function responseHeaders(upstream, normalizeRetryAfterAt) {
  const dropped = droppedHeaders(upstream);
  const out = new Headers;
  upstream.forEach((value, name) => {
    if (dropped.has(name) || name.startsWith("proxy-"))
      return;
    if (name === "retry-after" && normalizeRetryAfterAt !== null) {
      const seconds = retryAfterSeconds(value, normalizeRetryAfterAt);
      if (seconds !== null)
        out.set(name, String(seconds));
      return;
    }
    out.append(name, value);
  });
  return out;
}
function sseScanner() {
  let buffer = "";
  let event = null;
  let data = [];
  let fields = false;
  const decide = () => {
    const name = event ?? "message";
    if (name === "error")
      return "error";
    if (name === "ping")
      return null;
    try {
      const parsed = JSON.parse(data.join(`
`));
      if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "error") {
        return "error";
      }
    } catch {}
    return "event";
  };
  return {
    push(text) {
      buffer += text;
      for (;; ) {
        const end = buffer.indexOf(`
`);
        if (end === -1)
          return null;
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          const verdict = fields ? decide() : null;
          if (verdict !== null)
            return verdict;
          event = null;
          data = [];
          fields = false;
          continue;
        }
        if (line.startsWith(":"))
          continue;
        fields = true;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event")
          event = value;
        if (field === "data")
          data.push(value);
      }
    }
  };
}
function printable(text, max = 120) {
  return text.replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?").trim().slice(0, max);
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
var SNIPPET_MAX = 300;
var SNIPPET_READ_BYTES = 2048;
var KEY_CHARACTER = /[A-Za-z0-9_-]/;
function snippetText(bytes, known) {
  const cut = bytes.length > SNIPPET_READ_BYTES;
  let text = new TextDecoder().decode(cut ? bytes.subarray(0, SNIPPET_READ_BYTES) : bytes);
  if (cut) {
    let end = text.length;
    while (end > 0 && KEY_CHARACTER.test(text.charAt(end - 1)))
      end -= 1;
    text = text.slice(0, end);
  }
  return printable(maskSecrets(text, known), SNIPPET_MAX);
}
function decompressionFormat(encoding) {
  switch (encoding.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return "gzip";
    case "deflate":
      return "deflate";
    case "br":
      return "brotli";
    case "zstd":
      return "zstd";
    default:
      return null;
  }
}
function toolSearchForBackend(body) {
  const referenced = new Set;
  const out = { ...body };
  const messages = body.messages;
  if (Array.isArray(messages)) {
    out.messages = messages.map((message) => {
      if (!isJsonObject2(message) || !Array.isArray(message.content))
        return message;
      const content = message.content.map((block) => {
        if (!isJsonObject2(block) || block.type !== "tool_result")
          return block;
        const inner = block.content;
        if (!Array.isArray(inner))
          return block;
        return {
          ...block,
          content: inner.map((part) => {
            if (!isJsonObject2(part) || part.type !== "tool_reference")
              return part;
            const name = part.tool_name;
            if (typeof name !== "string")
              return part;
            referenced.add(name);
            return { text: `Tool loaded: ${name}`, type: "text" };
          })
        };
      });
      return { ...message, content };
    });
  }
  const tools = body.tools;
  if (Array.isArray(tools)) {
    out.tools = tools.flatMap((tool) => {
      if (!isJsonObject2(tool) || tool.defer_loading !== true)
        return [tool];
      const name = tool.name;
      if (typeof name !== "string" || !referenced.has(name))
        return [];
      const loaded = { ...tool };
      delete loaded.defer_loading;
      return [loaded];
    });
  }
  return out;
}
function reasoningOffForBackend(body, options = {}) {
  const thinking = body.thinking;
  const off = isJsonObject2(thinking) ? thinking.type === "disabled" : thinking === undefined && options.absentIsOff === true;
  if (!off)
    return body;
  const outputConfig = isJsonObject2(body.output_config) ? body.output_config : {};
  if (outputConfig.effort !== undefined)
    return body;
  return { ...body, output_config: { ...outputConfig, effort: "none" } };
}
var CLAUDE_TARGET_RULES = {
  "claude-opus-5-5": { thinkingOff: "left out" },
  "claude-sonnet-5-5": { thinkingOff: "between_tools" }
};
var ABOVE_HIGH = new Set(["max", "xhigh"]);
function requestForClaudeFallback(body, model) {
  const id = withoutContextSuffix(model);
  const rules = Object.hasOwn(CLAUDE_TARGET_RULES, id) ? CLAUDE_TARGET_RULES[id] : undefined;
  if (rules === undefined)
    return { body, changes: [] };
  const out = { ...body };
  const changes = [];
  const thinking = body.thinking;
  if (isJsonObject2(thinking) && thinking.type === "disabled") {
    if (rules.thinkingOff === "left out") {
      delete out.thinking;
      changes.push("thinking disabled -> left out (always on)");
      const outputConfig = isJsonObject2(body.output_config) ? body.output_config : undefined;
      if (outputConfig?.effort === undefined) {
        out.output_config = { ...outputConfig, effort: "low" };
        changes.push("effort low (nearest to thinking off)");
      }
    } else {
      out.thinking = { type: "between_tools" };
      changes.push("thinking disabled -> between_tools");
      const outputConfig = body.output_config;
      if (isJsonObject2(outputConfig) && typeof outputConfig.effort === "string" && ABOVE_HIGH.has(outputConfig.effort)) {
        out.output_config = { ...outputConfig, effort: "high" };
        changes.push(`effort ${outputConfig.effort} -> high`);
      }
    }
  } else if (isJsonObject2(thinking) && thinking.type === "enabled") {
    out.thinking = thinking.display === undefined ? { type: "adaptive" } : { display: thinking.display, type: "adaptive" };
    changes.push("thinking enabled (budget) -> adaptive");
  }
  const toolChoice = body.tool_choice;
  if (isJsonObject2(toolChoice) && (toolChoice.type === "any" || toolChoice.type === "tool")) {
    out.tool_choice = toolChoice.disable_parallel_tool_use === undefined ? { type: "auto" } : { disable_parallel_tool_use: toolChoice.disable_parallel_tool_use, type: "auto" };
    changes.push(`tool_choice ${toolChoice.type} -> auto`);
  }
  if (body.temperature !== undefined && body.temperature !== 1) {
    delete out.temperature;
    changes.push("temperature left out");
  }
  for (const field of ["top_p", "top_k"]) {
    if (body[field] !== undefined) {
      delete out[field];
      changes.push(`${field} left out`);
    }
  }
  return changes.length > 0 ? { body: out, changes } : { body, changes };
}
var encoder = new TextEncoder;
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseBody(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return isJsonObject2(parsed) ? parsed : null;
}
function deadline(ms) {
  let timer;
  const done = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, ms));
  });
  return { clear: () => clearTimeout(timer), done };
}
function createRouter(deps) {
  const startedAt = deps.now();
  const stats = { fallbacks: 0, requests: 0 };
  const allowedHosts = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  const cooling = new Map;
  const aliasesLogged = new Set;
  const translationsLogged = new Set;
  async function discard(response) {
    try {
      await response.body?.cancel();
    } catch (error) {
      deps.log(`WARN could not cancel a discarded upstream body: ${messageOf(error)}`);
    }
  }
  async function errorSnippet(response, known) {
    const encoding = response.headers.get("content-encoding");
    const compressed = encoding !== null && encoding.trim().toLowerCase() !== "identity";
    const format = compressed ? decompressionFormat(encoding) : null;
    if (compressed && format === null) {
      discard(response);
      return `(${printable(encoding, 40)} body)`;
    }
    const raw = response.body;
    if (raw === null)
      return "(no body)";
    const body = format === null ? raw : raw.pipeThrough(new DecompressionStream(format));
    const reader = body.getReader();
    const timer = deadline(1000);
    let readFailed = false;
    try {
      const step = await Promise.race([reader.read(), timer.done]);
      if (step === "timeout")
        return "(no body within 1 s)";
      if (step.done)
        return "(empty body)";
      return snippetText(step.value, known);
    } catch (error) {
      readFailed = true;
      return `(${format === null ? "" : `${printable(encoding ?? "", 40)} `}body unreadable: ${messageOf(error)})`;
    } finally {
      timer.clear();
      reader.cancel().catch((error) => {
        if (!readFailed) {
          deps.log(`WARN could not cancel an upstream error body: ${messageOf(error)}`);
        }
      });
    }
  }
  function logErrorAnswer(response, known, prefix) {
    const task = errorSnippet(response, known).then((snippet) => {
      deps.log(`${prefix} \u2014 ${snippet}`);
    }, (error) => {
      deps.log(`${prefix} \u2014 (body unreadable: ${messageOf(error)})`);
    });
    deps.background?.(task);
  }
  function knownSecrets(req, config) {
    const known = Object.values(config.backends).map((backend) => backend.apiKey);
    for (const name of ["x-api-key", "authorization"]) {
      const value = req.headers.get(name);
      if (value === null)
        continue;
      known.push(value);
      const space = value.indexOf(" ");
      if (space !== -1)
        known.push(value.slice(space + 1).trim());
    }
    return known;
  }
  async function send(req, upstream, deadlineAt) {
    if (req.signal.aborted)
      return { failure: "client closed the request", status: null };
    const controller = new AbortController;
    req.signal.addEventListener("abort", () => controller.abort(req.signal.reason), { once: true });
    const timer = deadlineAt === null ? null : deadline(deadlineAt - deps.now());
    const pending = deps.fetch(upstream.url, {
      body: upstream.body,
      decompress: false,
      headers: upstream.headers,
      method: upstream.method,
      redirect: "manual",
      signal: controller.signal
    });
    try {
      const first = await (timer === null ? pending : Promise.race([pending, timer.done]));
      if (first !== "timeout")
        return { response: first };
      controller.abort(new Error("no response headers in time"));
      pending.then(discard, () => {
        return;
      });
      return { failure: "no response headers in time", status: null };
    } catch (error) {
      return { failure: messageOf(error), status: null };
    } finally {
      timer?.clear();
    }
  }
  async function holdFirstEvent(response, deadlineAt) {
    const body = response.body;
    if (body === null)
      return { failure: "an event stream with no body", status: response.status };
    const reader = body.getReader();
    const decoder = new TextDecoder;
    const scanner = sseScanner();
    const held = [];
    const fail = async (failure, status) => {
      try {
        await reader.cancel();
      } catch (error) {
        deps.log(`WARN could not cancel a held upstream stream: ${messageOf(error)}`);
      }
      return { failure, status };
    };
    for (;; ) {
      const timer = deadlineAt === null ? null : deadline(deadlineAt - deps.now());
      let step;
      try {
        step = await (timer === null ? reader.read() : Promise.race([reader.read(), timer.done]));
      } catch (error) {
        return {
          failure: `the stream broke before its first event: ${messageOf(error)}`,
          status: null
        };
      } finally {
        timer?.clear();
      }
      if (step === "timeout")
        return fail("no event in time (only heartbeats)", null);
      if (step.done)
        return { failure: "the stream ended before its first event", status: response.status };
      held.push(step.value);
      const verdict = scanner.push(decoder.decode(step.value, { stream: true }));
      if (verdict === "error")
        return fail("an error event before the first real one", response.status);
      if (verdict === "event")
        break;
    }
    const replay = new ReadableStream({
      cancel: (reason) => reader.cancel(reason),
      async pull(controller) {
        const next = held.shift();
        if (next !== undefined) {
          controller.enqueue(next);
          return;
        }
        const { done, value } = await reader.read();
        if (done)
          controller.close();
        else
          controller.enqueue(value);
      }
    });
    return {
      response: new Response(replay, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      })
    };
  }
  function relay(upstream, target) {
    const headers = responseHeaders(upstream.headers, target?.kind === "backend" ? deps.now() : null);
    return new Response(NULL_BODY_STATUS.has(upstream.status) ? null : upstream.body, {
      headers,
      status: upstream.status,
      statusText: upstream.statusText
    });
  }
  function anthropicUpstream(req, url, config, body) {
    return {
      body,
      headers: anthropicRequestHeaders(req.headers),
      method: req.method,
      url: `${deps.anthropicBaseUrl ?? config.anthropicBaseUrl}${url.pathname}${url.search}`
    };
  }
  function fitForClaude(body, model, guard) {
    if (guard)
      return body;
    const fitted = requestForClaudeFallback(body, model);
    const text = `${model}: ${fitted.changes.join(", ")}`;
    if (fitted.changes.length > 0 && !translationsLogged.has(text)) {
      translationsLogged.add(text);
      deps.log(`translated for ${printable(text, 200)} (requestForClaudeFallback; logged once per kind)`);
    }
    return fitted.body;
  }
  function targetUpstream(req, url, config, body, target, guard) {
    if (target.kind === "anthropic") {
      const bytes = encoder.encode(JSON.stringify({ ...fitForClaude(body, target.model, guard), model: target.model }));
      return { upstream: anthropicUpstream(req, url, config, bytes) };
    }
    const backend = Object.hasOwn(config.backends, target.backend) ? config.backends[target.backend] : undefined;
    if (backend === undefined)
      return { error: `backend "${target.backend}" is not in the config` };
    const cheapBody = {
      ...reasoningOffForBackend(toolSearchForBackend(body), { absentIsOff: guard }),
      model: target.model
    };
    delete cheapBody.metadata;
    return {
      upstream: {
        body: encoder.encode(JSON.stringify(cheapBody)),
        headers: backendRequestHeaders(req.headers, backend.apiKey),
        method: "POST",
        url: `${backend.baseUrl}${url.pathname}`
      }
    };
  }
  function noteCooldown(label, result) {
    if ("response" in result && result.response.ok) {
      cooling.delete(label);
      return;
    }
    const status = "response" in result ? result.response.status : result.status;
    if (status !== null && status >= 200 && status <= 299)
      return;
    const retryAfter = "response" in result ? retryAfterSeconds(result.response.headers.get("retry-after"), deps.now()) : null;
    const seconds = cooldownSeconds(status, retryAfter);
    if (seconds !== null)
      cooling.set(label, deps.now() + seconds * 1000);
  }
  function coolingNow() {
    const now = deps.now();
    const out = {};
    for (const [label, until] of cooling) {
      if (until <= now)
        cooling.delete(label);
      else
        out[label] = Math.ceil((until - now) / 1000);
    }
    return out;
  }
  function closed(result, label) {
    if ("response" in result)
      discard(result.response);
    return {
      fallbacks: 0,
      response: anthropicError(499, "api_error", "client closed the request"),
      skipped: 0,
      target: label
    };
  }
  async function chain(req, url, config, body, targets, name, guard) {
    const failures = [];
    let fallbacks = 0;
    let skipped = 0;
    for (const [index, target] of targets.entries()) {
      const last = index === targets.length - 1;
      const label = formatTarget(target);
      const restsUntil = cooling.get(label);
      if (!last && restsUntil !== undefined && restsUntil > deps.now()) {
        failures.push(`${label}: resting after a failure`);
        skipped += 1;
        continue;
      }
      const deadlineAt = !last && target.kind === "backend" && (body.stream === true || guard) ? deps.now() + config.timeouts.firstByteMs : null;
      const built = targetUpstream(req, url, config, body, target, guard);
      let result = "error" in built ? { failure: built.error, status: null } : await send(req, built.upstream, deadlineAt);
      if (req.signal.aborted)
        return closed(result, label);
      if ("response" in result && !last && target.kind === "backend" && result.response.ok && (result.response.headers.get("content-type") ?? "").includes("text/event-stream")) {
        result = await holdFirstEvent(result.response, deadlineAt);
        if (req.signal.aborted)
          return closed(result, label);
      }
      noteCooldown(label, result);
      if ("failure" in result) {
        failures.push(`${label}: ${result.failure}`);
        if (!last) {
          fallbacks += 1;
          deps.log(`WARN ${label} failed (${result.failure}); trying the next target`);
        }
        continue;
      }
      const status = result.response.status;
      const decision = fallbackKind(status, target);
      if (decision === "stay" || last) {
        if (target.kind === "backend" && status >= 300 && status <= 399) {
          logErrorAnswer(result.response, knownSecrets(req, config), `WARN ${label} answered a redirect (${status}); refused`);
          return {
            fallbacks,
            response: anthropicError(502, "api_error", `anymodel-router: ${label} answered a redirect (${status}); not passed on`),
            skipped,
            target: label
          };
        }
        if (status >= 400) {
          logErrorAnswer(result.response.clone(), knownSecrets(req, config), `WARN ${label} answered ${status}; returned as it is`);
        }
        return { fallbacks, response: relay(result.response, target), skipped, target: label };
      }
      logErrorAnswer(result.response, knownSecrets(req, config), `WARN ${label} answered ${status}; trying the next target`);
      failures.push(`${label}: HTTP ${status}`);
      fallbacks += 1;
    }
    const lastTarget = targets.at(-1);
    return {
      fallbacks,
      response: anthropicError(502, "api_error", `anymodel-router: no target for ${name} answered (${failures.join("; ") || "no targets"})`),
      skipped,
      target: lastTarget === undefined ? "none" : formatTarget(lastTarget)
    };
  }
  function refusal(message) {
    return {
      fallbacks: 0,
      response: anthropicError(403, "permission_error", message),
      skipped: 0,
      target: "refused"
    };
  }
  async function route(req, url, model) {
    const config = deps.getConfig();
    const isMessages = req.method === "POST" && (url.pathname === MESSAGES_PATH || url.pathname === COUNT_TOKENS_PATH);
    if (isMessages) {
      const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json" || !req.headers.has("anthropic-version")) {
        return refusal("anymodel-router wants content-type: application/json and an anthropic-version header");
      }
    }
    const sent = req.method === "GET" || req.method === "HEAD" || req.body === null ? null : new Uint8Array(await req.arrayBuffer());
    let bytes = sent;
    const direct = async (body = bytes) => {
      const result = await send(req, anthropicUpstream(req, url, config, body), null);
      if (isMessages && "response" in result && result.response.status >= 400) {
        logErrorAnswer(result.response.clone(), knownSecrets(req, config), `WARN anthropic answered ${result.response.status}`);
      }
      const response = "response" in result ? relay(result.response, null) : anthropicError(502, "api_error", `anymodel-router: Anthropic did not answer (${result.failure})`);
      return { fallbacks: 0, response, skipped: 0, target: "anthropic" };
    };
    if (!isMessages)
      return direct();
    const parsed = bytes === null ? null : parseBody(bytes);
    if (parsed === null) {
      return {
        fallbacks: 0,
        response: anthropicError(400, "invalid_request_error", "the request body is not a JSON object"),
        skipped: 0,
        target: "none"
      };
    }
    if (typeof parsed.model === "string")
      model.name = parsed.model;
    const guard = isAutoModeGuard(parsed, config.aliases);
    const alias = resolveAlias(parsed.model, config.aliases);
    let body = parsed;
    if (alias !== null) {
      if (!aliasesLogged.has(alias.from)) {
        aliasesLogged.add(alias.from);
        deps.log(`alias ${printable(alias.from)} \u2192 ${printable(alias.to)} (from the config's aliases; logged once per name)`);
      }
      body = { ...parsed, model: alias.to };
      if (alias.to.startsWith("claude-"))
        body = fitForClaude(body, alias.to, guard);
      bytes = encoder.encode(JSON.stringify(body));
    }
    if (guard)
      model.name = `${model.name} (safety check)`;
    const judge = guard ? resolveRoute(JUDGE_SLOT, config) : null;
    if (judge !== null && judge.kind === "slot" && judge.targets.length > 0) {
      model.name = `${model.name} [judge]`;
      if (url.pathname === COUNT_TOKENS_PATH) {
        return {
          fallbacks: 0,
          response: anthropicError(404, "not_found_error", "count_tokens is not available for the judge slot; Claude Code estimates instead"),
          skipped: 0,
          target: "none"
        };
      }
      return chain(req, url, config, body, judge.targets, JUDGE_SLOT, true);
    }
    const decided = resolveRequestRoute(body, config, guard);
    if (decided.kind === "anthropic")
      return direct();
    if (decided.kind === "anthropic-as-sent")
      return direct(sent);
    if (decided.kind === "unknown-slot") {
      const slots = Object.keys(config.slots);
      return {
        fallbacks: 0,
        response: anthropicError(400, "invalid_request_error", `anymodel-router: "${decided.slot}" is not a slot in ${deps.configPath} (slots: ${slots.length > 0 ? slots.join(", ") : "none \u2014 run anymodel gateway setup"})`),
        skipped: 0,
        target: "none"
      };
    }
    const targets = decided.kind === "slot" ? decided.targets : [decided.target];
    const name = decided.kind === "slot" ? decided.slot : model.name;
    if (url.pathname === COUNT_TOKENS_PATH) {
      const first = targets[0];
      if (first === undefined || first.kind === "backend") {
        return {
          fallbacks: 0,
          response: anthropicError(404, "not_found_error", `count_tokens is not available for ${name}; Claude Code estimates instead`),
          skipped: 0,
          target: first === undefined ? "none" : formatTarget(first)
        };
      }
      return chain(req, url, config, body, [first], name, guard);
    }
    return chain(req, url, config, body, targets, name, guard);
  }
  return async function handle(req) {
    const startMs = deps.now();
    const url = new URL(req.url);
    const model = { name: "-" };
    const line = (outcome) => `${new Date(startMs).toISOString()} ${req.method} ${printable(url.pathname)} ${printable(model.name)} \u2192 ${outcome.target} ${outcome.response.status} ${deps.now() - startMs}ms fallbacks=${outcome.fallbacks}${outcome.skipped > 0 ? ` skipped=${outcome.skipped}` : ""}`;
    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (req.headers.has("origin") || !allowedHosts.has(host)) {
      const outcome = refusal("anymodel-router accepts requests from this machine only");
      deps.log(line(outcome));
      return outcome.response;
    }
    if (req.method === "GET" && url.pathname === HEALTH_PATH) {
      return Response.json({
        cooling: coolingNow(),
        fallbacks: stats.fallbacks,
        ok: true,
        port: deps.port,
        requests: stats.requests,
        slots: deps.getConfig().slots,
        uptimeSec: Math.floor((deps.now() - startedAt) / 1000)
      });
    }
    stats.requests += 1;
    let outcome;
    try {
      outcome = await route(req, url, model);
    } catch (error) {
      deps.log(`ERROR ${req.method} ${printable(url.pathname)}: ${messageOf(error)}`);
      outcome = {
        fallbacks: 0,
        response: anthropicError(500, "api_error", "anymodel-router failed on this request; see its log"),
        skipped: 0,
        target: "none"
      };
    }
    stats.fallbacks += outcome.fallbacks;
    deps.log(line(outcome));
    return outcome.response;
  };
}
function startRouter(configPath) {
  const log = (line) => console.log(line);
  const source = watchConfig(configPath, log);
  const { port } = source.get();
  const handler = createRouter({
    configPath,
    fetch: (url, init) => fetch(url, init),
    getConfig: () => source.get(),
    log,
    now: () => Date.now(),
    port
  });
  const server = Bun.serve({ fetch: handler, hostname: "127.0.0.1", idleTimeout: 0, port });
  log(`anymodel-router listening on http://127.0.0.1:${port} (config ${configPath})`);
  process.once("SIGTERM", () => {
    log(`SIGTERM: finishing ${server.pendingRequests} request(s), then exiting`);
    server.stop(false).then(() => process.exit(0), (error) => {
      log(`ERROR while stopping: ${messageOf(error)}`);
      process.exit(1);
    });
  });
  return server;
}

// src/gateway/health.ts
function realProbe() {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms)
  };
}
function isJsonObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function healthUrl(port) {
  return `http://127.0.0.1:${port}${HEALTH_PATH}`;
}
async function routerHealth(port, fetchImpl = (url, init) => fetch(url, init)) {
  try {
    const response = await fetchImpl(healthUrl(port), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { error: `HTTP ${response.status}` };
    }
    return { body: await response.json() };
  } catch (error) {
    return { error: messageOf(error) };
  }
}
function isConnectionRefused(error) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  return error.code === "ConnectionRefused" || error.code === "ECONNREFUSED";
}
async function probeRouterPort(port, fetchImpl, timeoutMs = 2000) {
  let response;
  try {
    response = await fetchImpl(healthUrl(port), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isConnectionRefused(error))
      return { state: "free" };
    return { detail: messageOf(error), state: "other" };
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return { detail: `HTTP ${response.status}`, state: "other" };
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    return { detail: `not a health answer (${messageOf(error)})`, state: "other" };
  }
  return isJsonObject3(body) && body.ok === true ? { state: "ours" } : { detail: "not this router's health answer", state: "other" };
}
async function waitWhileRouterAnswers(port, probe, waitMs) {
  const deadline = probe.now() + waitMs;
  for (;; ) {
    const result = await probeRouterPort(port, probe.fetch, 1000);
    if (result.state !== "ours")
      return result;
    if (probe.now() >= deadline)
      return { state: "held" };
    await probe.sleep(200);
  }
}
async function waitForRouter(port, probe, waitMs = 5000) {
  const deadline = probe.now() + waitMs;
  for (;; ) {
    const result = await probeRouterPort(port, probe.fetch, 1000);
    if (result.state === "ours")
      return true;
    if (probe.now() >= deadline)
      return false;
    await probe.sleep(200);
  }
}

// src/gateway/service.ts
import { existsSync as existsSync3, readFileSync as readFileSync5, rmSync } from "fs";
import { join as join5 } from "path";
var UNIT_NAME = "anymodel-router.service";
var UP_TO_DATE = "router already up to date (no restart)";
var RESTART_WARNING = "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).";
function renderUnit(bunPath, copyPath) {
  for (const path of [bunPath, copyPath]) {
    if (/["\\\n%]/.test(path))
      throw new Error(`cannot put ${JSON.stringify(path)} in a unit file`);
  }
  return `# anymodel-router: the local AI gateway for Claude Code (127.0.0.1 only).
# Written by \`${COMMAND} gateway setup\`; edits here are overwritten by the next setup.
# It runs a copy of the router, never a file in the plugin's version folder.
# Its config: ~/.config/anymodel/gateway.json.

[Unit]
Description=anymodel-router: local AI gateway for Claude Code (127.0.0.1 only)
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="${bunPath}" --no-env-file "${copyPath}"
WorkingDirectory=%h
Restart=always
RestartSec=2
KillMode=mixed
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}
function run(runner, cmd) {
  const result = runner(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${result.exitCode}):
${result.output.trim()}`);
  }
}
function unitActive(runner) {
  return runner(["systemctl", "--user", "is-active", "--quiet", UNIT_NAME]).exitCode === 0;
}
function unitState(runner) {
  const result = runner(["systemctl", "--user", "is-active", UNIT_NAME]);
  return result.output.trim().split(`
`)[0]?.trim() || "unknown";
}
var DRAIN_NOTE = "waiting for the old router to finish its answers (up to 120 s)";
function restartPendingFile(stateDir) {
  return join5(stateDir, "restart-pending");
}
var HEALTH_WAIT_MS = 5000;
async function installRouter(options) {
  const port = await probeRouterPort(options.port, options.probe.fetch);
  if (port.state === "other") {
    throw new Error(`port ${options.port} is used by another program (an older router? stop it first)`);
  }
  const short = (path) => tildify(path, options.home);
  const copyText = readFileSync5(options.bundle, "utf8");
  const unitText = renderUnit(options.bunPath, options.copyPath);
  const marker = restartPendingFile(options.stateDir);
  const write = (file, text, dryRun) => writeManagedFile(file, text, {
    stateDir: options.stateDir,
    kind: "whole-file",
    mode: 420,
    dryRun
  });
  const copyPlan = write(options.copyPath, copyText, true).outcome;
  const unitPlan = write(options.unitPath, unitText, true).outcome;
  if (copyPlan === "unchanged" && unitPlan === "unchanged" && !existsSync3(marker)) {
    if (options.dryRun)
      return "up-to-date";
    run(options.runner, ["systemctl", "--user", "enable", "--now", UNIT_NAME]);
    options.say(UP_TO_DATE);
    return "up-to-date";
  }
  const active = unitActive(options.runner);
  if (active) {
    options.say(RESTART_WARNING);
    if (!options.yes) {
      const yes = options.confirm?.("Restart anymodel-router now?") ?? null;
      if (yes !== true) {
        options.say(yes === null ? `Nothing was changed. Run again with --yes to restart: ${COMMAND} gateway setup --yes` : "Nothing was changed.");
        return "declined";
      }
    }
  }
  if (options.dryRun)
    return "installed";
  atomicWrite(marker, `${COMMAND} gateway setup started a router restart at ${new Date(options.probe.now()).toISOString()}; it has not answered yet.
`, 384);
  const copy = write(options.copyPath, copyText, false);
  if (copy.outcome !== "unchanged") {
    options.say(`${copy.outcome === "created" ? "+" : "~"} ${short(options.copyPath)}: router copy ${copy.outcome}`);
  }
  const unit = write(options.unitPath, unitText, false);
  if (unit.outcome !== "unchanged") {
    options.say(`${unit.outcome === "created" ? "+" : "~"} ${short(options.unitPath)}: unit ${unit.outcome}`);
  }
  run(options.runner, ["systemctl", "--user", "daemon-reload"]);
  run(options.runner, ["systemctl", "--user", "enable", UNIT_NAME]);
  if (active)
    options.say("restarting anymodel-router");
  else if (unitState(options.runner) === "deactivating")
    options.say(DRAIN_NOTE);
  run(options.runner, ["systemctl", "--user", "restart", UNIT_NAME]);
  if (!await waitForRouter(options.port, options.probe, HEALTH_WAIT_MS)) {
    throw new Error(`${UNIT_NAME} did not answer on 127.0.0.1:${options.port} within ${HEALTH_WAIT_MS / 1000} s of the restart (systemctl --user is-active: ${unitState(options.runner)}). See why: journalctl --user -u anymodel-router -n 30. Then run ${COMMAND} gateway setup again.`);
  }
  rmSync(marker, { force: true });
  options.say(`enabled and (re)started ${UNIT_NAME}`);
  return "installed";
}
var STOP_WAIT_MS = 15000;
var HOLDS_ITS_PORT = new Set(["active", "deactivating"]);
async function stopRouter(runner, port, probe) {
  const state = port === null ? null : unitState(runner);
  run(runner, ["systemctl", "--user", "disable", UNIT_NAME]);
  run(runner, ["systemctl", "--user", "stop", "--no-block", UNIT_NAME]);
  if (port === null || state === null)
    return { kind: "no-port" };
  if (!HOLDS_ITS_PORT.has(state))
    return { kind: "not-running", state };
  const result = await waitWhileRouterAnswers(port, probe, STOP_WAIT_MS);
  if (result.state === "free")
    return { kind: "closed" };
  if (result.state === "other")
    return { detail: result.detail, kind: "other" };
  throw new Error(`${UNIT_NAME} is disabled and was told to stop, but 127.0.0.1:${port} still takes connections after ${STOP_WAIT_MS / 1000} s. Nothing else was restored. See why: systemctl --user status anymodel-router (and ss -ltnp for another program on the port). Then run ${COMMAND} restore again.`);
}

// src/gateway/settings.ts
import { existsSync as existsSync4, readFileSync as readFileSync6 } from "fs";
function gatewayEnv(port) {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "anymodel-scout[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: `Cheap model for search and reading: the scout slot (${COMMAND} gateway slot scout \u2026)`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (cheap)",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "anymodel-worker[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: `Cheap model for routine code and docs: the worker slot (${COMMAND} gateway slot worker \u2026)`,
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Worker (cheap)"
  };
}
var FORBIDDEN_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"
];
var GATEWAY_ENV_KEYS = Object.keys(gatewayEnv(20100));
var SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];
var LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var envPath = (key) => ["env", key];
function isJsonObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSettings(path) {
  if (!existsSync4(path))
    return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync6(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it by hand, then run again.`);
  }
  if (!isJsonObject4(parsed))
    throw new Error(`${path} is not a JSON object; not touching it`);
  const env = parsed.env;
  if (env !== undefined && !isJsonObject4(env))
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
function ownedGatewayEnvKeys(settingsFile, stateDir) {
  const owned = ownedKeys(stateDir, realTarget(settingsFile));
  return GATEWAY_ENV_KEYS.filter((key) => owned.some((path) => path.length === 2 && path[0] === "env" && path[1] === key));
}
function assertNoForeignGatewayKeys(settingsFile, stateDir) {
  const env = readSettings(settingsFile).env;
  if (!isJsonObject4(env))
    return;
  const owned = new Set(ownedGatewayEnvKeys(settingsFile, stateDir));
  for (const key of GATEWAY_ENV_KEYS) {
    if (!Object.hasOwn(env, key) || owned.has(key))
      continue;
    const yourOwn = key === "ENABLE_TOOL_SEARCH" ? ` Many people set ENABLE_TOOL_SEARCH themselves; removing it by hand lets ${COMMAND} gateway on manage it (it sets "true", and gateway off removes it again).` : "";
    throw new ForeignKeyError(`${settingsFile}: ${formatKeyPath(envPath(key))} is ${shownValue(env[key])}, set by someone else. ` + `${COMMAND} does not overwrite it. Remove it by hand if ${COMMAND} should manage it.${yourOwn}`);
  }
}
function turnOn(options) {
  assertNoForeignGatewayKeys(options.settingsFile, options.stateDir);
  const set = Object.entries(gatewayEnv(options.port)).map(([key, value]) => [envPath(key), value]);
  for (const [path] of set) {
    if (FORBIDDEN_ENV_KEYS.some((key) => path[1] === key)) {
      throw new Error(`the gateway never writes ${formatKeyPath(path)}`);
    }
  }
  return applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    set,
    ...options.dryRun !== undefined && { dryRun: options.dryRun }
  });
}
function turnOff(options) {
  const env = readSettings(options.settingsFile).env;
  const result = applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    remove: GATEWAY_ENV_KEYS.map(envPath),
    ...options.dryRun !== undefined && { dryRun: options.dryRun }
  });
  const foreign = result.skipped.map((skip) => skip.path[1]).filter((key) => key !== undefined && isJsonObject4(env) && Object.hasOwn(env, key));
  return { result, foreign };
}
function settingsReport(settingsPath) {
  const settings = readSettings(settingsPath);
  const env = isJsonObject4(settings.env) ? settings.env : {};
  const baseUrl = typeof env.ANTHROPIC_BASE_URL === "string" ? shownValue(env.ANTHROPIC_BASE_URL) : null;
  const loginOverrides = LOGIN_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  if (Object.hasOwn(settings, "apiKeyHelper"))
    loginOverrides.push("apiKeyHelper");
  const subagentOverrides = SUBAGENT_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  return { baseUrl, loginOverrides, subagentOverrides };
}

// src/gateway/commands.ts
var USAGE = `Usage: ${COMMAND} gateway <command>

Commands:
  status                 Router health, backends, slots, and the Claude Code settings.
  models                 Every model each backend offers, and the slots.
  slot <slot> <targets>  Set a slot's targets, in order. <slot>: scout, worker or judge.
                         e.g. slot worker omniroute:ollama-cloud/glm-5.3-flash,claude-sonnet-5-5
  slot judge off         Auto mode's safety check goes back to Claude.
  setup [--yes] [--backend-key-stdin <backend> | --no-backend-key]
                         Make the config (the key on stdin), install the router copy and
                         its systemd user unit, and start it. --yes: restart a running
                         router without asking (a restart cuts the answers in flight).
  on                     Point Claude Code at the router (every session on this machine).
  off                    Remove what "on" set. Restart the sessions afterwards.
  serve                  Run the router in this terminal.`;
var NEEDS_SYSTEMD = "the gateway service needs systemd (Linux) for now.";
function isJsonObject5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var KNOWN_BACKENDS = {
  ollama: "https://ollama.com",
  omniroute: "http://127.0.0.1:20128"
};
function defaultConfig(omnirouteKey) {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: omnirouteKey, baseUrl: "http://127.0.0.1:20128" } },
    port: DEFAULT_PORT,
    slots: {
      "anymodel-scout": [
        "omniroute:ollama-cloud/deepseek-v4.1-flash",
        "omniroute:ollama-cloud/glm-5.3-flash",
        "claude-sonnet-5-5"
      ],
      "anymodel-worker": [
        "omniroute:ollama-cloud/deepseek-v4.1-flash",
        "omniroute:ollama-cloud/glm-5.3-flash",
        "claude-sonnet-5-5"
      ]
    },
    timeouts: { firstByteMs: DEFAULT_FIRST_BYTE_MS },
    version: 1
  };
}
function ensureConfig(configPath, key, options = {}) {
  if (!existsSync5(configPath)) {
    if (key === null && options.allowNone === true) {
      return `no config at ${configPath} yet: the router answers every slot on your own Claude login until the OmniRoute key is added (setup --backend-key-stdin omniroute)`;
    }
    if (key?.backend !== "omniroute") {
      throw new ConfigError(`no config at ${configPath}. Create it with the OmniRoute key on stdin: ${COMMAND} gateway setup --backend-key-stdin omniroute`);
    }
    if (options.dryRun !== true)
      saveConfig(configPath, defaultConfig(key.value));
    return `created ${configPath} (mode 600)`;
  }
  const config = loadConfigFile(configPath);
  if (key === null)
    return `kept ${configPath}`;
  const existing = Object.hasOwn(config.backends, key.backend) ? config.backends[key.backend] : undefined;
  const baseUrl = existing?.baseUrl ?? KNOWN_BACKENDS[key.backend];
  if (baseUrl === undefined) {
    throw new ConfigError(`backend "${key.backend}" is unknown; add it to ${configPath} by hand first`);
  }
  if (options.dryRun !== true) {
    saveConfig(configPath, {
      ...config,
      backends: { ...config.backends, [key.backend]: { apiKey: key.value, baseUrl } }
    });
  }
  return `set the key of backend "${key.backend}" (${maskKey(key.value)}) in ${configPath}`;
}
function configuredPort(configPath) {
  return existsSync5(configPath) ? loadConfigFile(configPath).port : DEFAULT_PORT;
}
function planSlotChange(config, slotArg, targetsText, modelsByBackend) {
  const key = slotKeyFromArg(slotArg);
  if (key === null)
    return { error: `"${slotArg}" is not a slot name (scout, worker, judge, or anymodel-<name>)` };
  if (targetsText.trim() === "off") {
    if (key !== JUDGE_SLOT) {
      return { error: `only ${JUDGE_SLOT} can be off; give ${key} its targets instead` };
    }
    if (!Object.hasOwn(config.slots, key))
      return { error: `${JUDGE_SLOT} is already off` };
    const slots = Object.fromEntries(Object.entries(config.slots).filter(([name]) => name !== key));
    const checked = parseConfig({ ...config, slots });
    if ("error" in checked)
      return { error: checked.error };
    return { config: checked.config, key, next: [], old: config.slots[key] ?? [] };
  }
  const next = targetsText.split(",").map((text) => text.trim()).filter((text) => text !== "");
  if (next.length === 0)
    return { error: "give at least one target" };
  for (const text of next) {
    const parsed = parseTarget(text);
    if ("error" in parsed)
      return { error: parsed.error };
    const target = parsed.target;
    if (target.kind === "anthropic")
      continue;
    if (!Object.hasOwn(config.backends, target.backend)) {
      return { error: `"${text}": backend "${target.backend}" is not in the config` };
    }
    const models = Object.hasOwn(modelsByBackend, target.backend) ? modelsByBackend[target.backend] : undefined;
    if (models === undefined || models === null) {
      return {
        error: `"${text}": could not list the models of "${target.backend}", so it cannot be checked`
      };
    }
    if (!models.includes(target.model)) {
      return {
        error: `"${text}": "${target.backend}" has no model "${target.model}" (see ${COMMAND} gateway models)`
      };
    }
  }
  const changed = { ...config, slots: { ...config.slots, [key]: next } };
  const checked = parseConfig(changed);
  if ("error" in checked)
    return { error: checked.error };
  return { config: checked.config, key, next, old: config.slots[key] ?? [] };
}
function printSlots(config) {
  console.log(`
Slots (first that answers wins):`);
  const keys = Object.keys(config.slots).sort();
  if (keys.length === 0)
    console.log("  (none)");
  for (const key of keys)
    console.log(`  ${key.padEnd(16)} ${(config.slots[key] ?? []).join(" \u2192 ")}`);
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    console.log(`  ${JUDGE_SLOT.padEnd(16)} off: auto mode's safety checks go to Claude`);
  }
  const aliases = Object.entries(config.aliases).sort(([a], [b]) => a < b ? -1 : 1);
  if (aliases.length > 0) {
    console.log(`
Aliases (an old name, and what it means now):`);
    for (const [name, to] of aliases)
      console.log(`  ${name.padEnd(16)} \u2192 ${to}`);
  }
}
async function commandModels(ctx) {
  const config = loadConfigFile(ctx.paths.gatewayConfigFile);
  for (const [name, backend] of Object.entries(config.backends)) {
    console.log(`
${name}  ${shownValue(backend.baseUrl)}  (key ${maskKey(backend.apiKey)})`);
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    if ("error" in listed)
      console.log(`  unreachable: ${listed.error}`);
    else if (listed.status !== 200)
      console.log(`  /v1/models answered HTTP ${listed.status}`);
    else {
      for (const model of [...listed.models].sort((a, b) => a.id.localeCompare(b.id))) {
        const context = model.contextLength === null ? "" : `  ${model.contextLength.toLocaleString("en-US")} tokens`;
        console.log(`  ${name}:${model.id}${context}`);
      }
    }
  }
  printSlots(config);
  console.log(`
Any claude-<id> target (e.g. claude-sonnet-5-5) goes to Anthropic on your own Claude login.`);
  return 0;
}
async function commandSlot(ctx, args) {
  const [slotArg, targets, ...extra] = args;
  if (slotArg === undefined || targets === undefined || extra.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const configPath = ctx.paths.gatewayConfigFile;
  const config = loadConfigFile(configPath);
  const modelsByBackend = {};
  for (const text of targets.split(",")) {
    const parsed = parseTarget(text);
    if (!("target" in parsed) || parsed.target.kind !== "backend")
      continue;
    const name = parsed.target.backend;
    const backend = Object.hasOwn(config.backends, name) ? config.backends[name] : undefined;
    if (backend === undefined || Object.hasOwn(modelsByBackend, name))
      continue;
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    modelsByBackend[name] = "models" in listed && listed.status === 200 ? listed.models.map((m) => m.id) : null;
  }
  const first = planSlotChange(config, slotArg, targets, modelsByBackend);
  if ("error" in first)
    throw new Error(first.error);
  const plan = await withLock(ctx.paths.stateDir, () => {
    const again = planSlotChange(loadConfigFile(configPath), slotArg, targets, modelsByBackend);
    if ("error" in again)
      throw new Error(again.error);
    saveConfig(configPath, again.config);
    return again;
  }, { waitMs: 1e4 });
  const now = plan.next.length === 0 ? "off (auto mode's safety check on Claude)" : plan.next.join(" \u2192 ");
  console.log(`${plan.key}: ${plan.old.join(" \u2192 ") || "(new)"}
  now: ${now}`);
  console.log("The router uses it from its next request.");
  return 0;
}
function printOverrides(report) {
  if (report.subagentOverrides.length > 0) {
    console.log(`  WARN ${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly a cheap slot. Remove it by hand unless you want that.`);
  }
  if (report.loginOverrides.length > 0) {
    console.log(`  WARN ${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`);
  }
}
async function commandStatus(ctx) {
  let config = null;
  try {
    config = loadConfigFile(ctx.paths.gatewayConfigFile);
  } catch (error) {
    console.log(`config: ${messageOf(error)}`);
  }
  const port = config?.port ?? DEFAULT_PORT;
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health)
    console.log(`router: DOWN on 127.0.0.1:${port} (${health.error})`);
  else {
    const body = isJsonObject5(health.body) ? health.body : {};
    console.log(`router: up on 127.0.0.1:${String(body.port)} for ${String(body.uptimeSec)} s, ${String(body.requests)} requests, ${String(body.fallbacks)} fallbacks`);
    if (body.port !== port)
      console.log(`  WARN the config says port ${port}; restart the router to move it`);
    const cooling = isJsonObject5(body.cooling) ? Object.entries(body.cooling) : [];
    for (const [target, seconds] of cooling)
      console.log(`  resting: ${target} for ${String(seconds)} s more`);
  }
  if (config !== null) {
    for (const [name, backend] of Object.entries(config.backends)) {
      const listed = await listModels(backend.baseUrl, backend.apiKey);
      const state = "error" in listed ? `unreachable (${listed.error})` : `HTTP ${listed.status}`;
      console.log(`backend ${name}: ${shownValue(backend.baseUrl)} key ${maskKey(backend.apiKey)} \u2192 ${state}`);
    }
    printSlots(config);
  }
  const report = settingsReport(ctx.paths.settingsFile);
  console.log(`
Claude Code (${tildify(ctx.paths.settingsFile, ctx.paths.home)}): ${report.baseUrl === null ? "gateway OFF (no ANTHROPIC_BASE_URL)" : `gateway ON \u2192 ${report.baseUrl}`}`);
  printOverrides(report);
  return 0;
}
function setupOptions(args) {
  let yes = false;
  let keyBackend = null;
  let noKey = false;
  for (let index = 0;index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes")
      yes = true;
    else if (arg === "--no-backend-key")
      noKey = true;
    else if (arg === "--backend-key-stdin") {
      const backend = args[index + 1];
      if (backend === undefined || backend.startsWith("--"))
        return null;
      keyBackend = backend;
      index += 1;
    } else
      return null;
  }
  if (noKey && keyBackend !== null)
    return null;
  return { yes, keyBackend, noKey };
}
async function commandSetup(ctx, args) {
  const options = setupOptions(args);
  if (options === null) {
    console.error(USAGE);
    return 2;
  }
  if (!ctx.systemd) {
    console.error(NEEDS_SYSTEMD);
    return 1;
  }
  const { paths } = ctx;
  let key = null;
  if (options.keyBackend !== null) {
    const value = (await ctx.readStdin()).trim();
    if (value === "")
      throw new Error("no key on stdin");
    key = { backend: options.keyBackend, value };
  }
  const configPath = paths.gatewayConfigFile;
  const install = (overrides) => ({
    bunPath: ctx.bunPath,
    bundle: ctx.bundle,
    copyPath: paths.routerCopy,
    unitPath: paths.routerUnitFile,
    home: paths.home,
    stateDir: paths.stateDir,
    port: configuredPort(configPath),
    probe: ctx.probe,
    runner: ctx.runner,
    say: (line) => console.log(line),
    yes: options.yes,
    confirm: ctx.confirm,
    ...overrides
  });
  ensureConfig(configPath, key, { allowNone: options.noKey, dryRun: true });
  if (await installRouter(install({ dryRun: true })) === "declined")
    return 1;
  return withLock(paths.stateDir, async () => {
    const said = ensureConfig(configPath, key, { allowNone: options.noKey });
    console.log(said.replaceAll(configPath, tildify(configPath, paths.home)));
    await installRouter(install({
      yes: true,
      confirm: null,
      say: (line) => {
        if (line !== RESTART_WARNING)
          console.log(line);
      }
    }));
    if (settingsReport(paths.settingsFile).baseUrl === null) {
      console.log(`Claude Code does not use the gateway yet. Check it: ${COMMAND} gateway status. Then: ${COMMAND} gateway on.`);
    }
    return 0;
  }, { waitMs: 1e4 });
}
function show(value) {
  return value === undefined ? "(none)" : JSON.stringify(value);
}
function changeLines(result, home) {
  return result.changes.map((change) => `~ ${tildify(result.file, home)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`);
}
async function commandOn(ctx) {
  const { paths } = ctx;
  const port = configuredPort(paths.gatewayConfigFile);
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health) {
    throw new Error(`the router does not answer on 127.0.0.1:${port} (${health.error}); every Claude request would fail. Run ${COMMAND} gateway setup first.`);
  }
  const options = { settingsFile: paths.settingsFile, stateDir: paths.stateDir, port };
  turnOn({ ...options, dryRun: true });
  const result = await withLock(paths.stateDir, () => turnOn(options), { waitMs: 1e4 });
  if (result.changes.length === 0) {
    console.log("Nothing to change: the gateway is already on.");
  } else {
    console.log(changeLines(result, paths.home).join(`
`));
    console.log(`Done. The changed file has a backup in ${tildify(paths.stateDir, paths.home)}/backups/.`);
    console.log("Every Claude Code session on this machine, in every folder, uses the gateway from now on: its haiku / sonnet work (background titles and summaries too) goes to the cheap slots.");
  }
  printOverrides(settingsReport(paths.settingsFile));
  return 0;
}
async function commandOff(ctx) {
  const { paths } = ctx;
  const { result, foreign } = await withLock(paths.stateDir, () => turnOff({ settingsFile: paths.settingsFile, stateDir: paths.stateDir }), { waitMs: 1e4 });
  if (result.changes.length === 0) {
    console.log(`Nothing to remove: ${COMMAND} set no gateway key in ${tildify(paths.settingsFile, paths.home)}.`);
  } else {
    console.log(changeLines(result, paths.home).join(`
`));
    console.log("Restart each Claude session: removing a setting needs a restart.");
  }
  for (const key of foreign) {
    console.log(`  env.${key} stays: ${COMMAND} did not set it. Remove it by hand to turn the gateway off.`);
  }
  return 0;
}
async function runGateway(args, ctx) {
  const [command, ...rest] = args;
  const noArgs = (run) => {
    if (rest.length > 0) {
      console.error(USAGE);
      return Promise.resolve(2);
    }
    return run();
  };
  switch (command) {
    case "models":
      return noArgs(() => commandModels(ctx));
    case "slot":
      return commandSlot(ctx, rest);
    case "status":
      return noArgs(() => commandStatus(ctx));
    case "setup":
      return commandSetup(ctx, rest);
    case "on":
      return noArgs(() => commandOn(ctx));
    case "off":
      return noArgs(() => commandOff(ctx));
    case "serve":
      return noArgs(async () => {
        startRouter(ctx.paths.gatewayConfigFile);
        return 0;
      });
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown gateway command: ${command}

${USAGE}`);
      return 2;
  }
}

// src/gateway/doctor.ts
var SETUP = `Run: ${COMMAND} gateway setup`;
async function gatewayChecks(options) {
  const { paths } = options;
  const short = (path) => tildify(path, paths.home);
  const checks = [];
  if (existsSync6(restartPendingFile(paths.stateDir))) {
    checks.push({
      ok: false,
      text: `a gateway setup did not finish; run: ${COMMAND} gateway setup`
    });
  }
  const installed = existsSync6(paths.routerCopy) || existsSync6(paths.routerUnitFile);
  if (!installed) {
    checks.push(existsSync6(paths.gatewayConfigFile) ? {
      ok: true,
      info: true,
      text: `gateway.json kept (${short(paths.gatewayConfigFile)}); the gateway is not installed. To use it: ${COMMAND} gateway setup`
    } : {
      ok: true,
      info: true,
      text: `gateway: not set up (optional). To use it: ${COMMAND} gateway setup`
    });
    return checks;
  }
  if (!options.systemd) {
    checks.push({
      ok: false,
      text: `gateway: ${NEEDS_SYSTEMD}`
    });
  } else {
    const state = options.runner(["systemctl", "--user", "is-active", UNIT_NAME]);
    const word = state.output.trim().split(`
`)[0] || "unknown";
    checks.push(state.exitCode === 0 ? { ok: true, text: `the router service (${UNIT_NAME}) is active` } : { ok: false, text: `the router service (${UNIT_NAME}) is ${word}. ${SETUP}` });
  }
  if (!existsSync6(paths.routerCopy)) {
    checks.push({ ok: false, text: `no router copy at ${short(paths.routerCopy)}. ${SETUP}` });
  } else if (existsSync6(options.bundle) && readFileSync7(paths.routerCopy, "utf8") !== readFileSync7(options.bundle, "utf8")) {
    checks.push({
      ok: false,
      text: `the router copy ${short(paths.routerCopy)} is not this plugin version's router. ${SETUP}`
    });
  } else {
    checks.push({ ok: true, text: `the router copy ${short(paths.routerCopy)} is up to date` });
  }
  let config;
  if (!existsSync6(paths.gatewayConfigFile)) {
    config = emptyConfig();
    checks.push({
      ok: true,
      info: true,
      text: `no ${short(paths.gatewayConfigFile)} yet: the router answers every slot on your own Claude login. To add a backend: ${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`
    });
  } else {
    try {
      config = loadConfigFile(paths.gatewayConfigFile);
    } catch (error) {
      checks.push({ ok: false, text: `gateway config: ${messageOf(error)}` });
      return checks;
    }
  }
  const health = await routerHealth(config.port, options.fetch);
  checks.push("error" in health ? {
    ok: false,
    text: `the router does not answer on 127.0.0.1:${config.port} (${health.error})`
  } : { ok: true, text: `the router answers on 127.0.0.1:${config.port}` });
  for (const [name, backend] of Object.entries(config.backends)) {
    const url = shownValue(backend.baseUrl);
    const listed = await listModels(backend.baseUrl, backend.apiKey, 5000);
    checks.push("error" in listed ? { ok: false, text: `backend ${name} (${url}) is unreachable: ${listed.error}` } : listed.status === 200 ? { ok: true, text: `backend ${name} (${url}) answers` } : {
      ok: false,
      text: `backend ${name} (${url}) answered HTTP ${listed.status}; check its key`
    });
  }
  for (const slot of Object.keys(config.slots).sort()) {
    const first = config.slots[slot]?.[0] ?? "(none)";
    checks.push({ ok: true, info: true, text: `slot ${slot}: first target ${first}` });
  }
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    checks.push({
      ok: true,
      info: true,
      text: `slot ${JUDGE_SLOT}: off, auto mode's safety checks go to Claude`
    });
  }
  return checks;
}

// src/setup/installed-plugins.ts
import { existsSync as existsSync7, readFileSync as readFileSync8 } from "fs";
function findUserInstall(installedPluginsFile) {
  if (!existsSync7(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync8(installedPluginsFile, "utf8"));
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
import { join as join6 } from "path";
var LAUNCHER_NAME = "anymodel";
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
# anymodel launcher. Written by "anymodel setup"; setup rewrites it, so do not edit it.
# It runs the anymodel command from the installed version of the anymodel plugin.
fail() {
  echo "anymodel: $1 Run: claude plugin install ${PLUGIN_ID}" >&2
  exit 1
}
baked_bun=${shellQuote(bunPath)}
if [ -x "$baked_bun" ]; then
  bun="$baked_bun"
elif command -v bun >/dev/null 2>&1; then
  bun=$(command -v bun)
else
  echo "anymodel: bun not found (not at $baked_bun, not on PATH). Install bun, then run: anymodel setup" >&2
  exit 1
fi
config_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
installed="$config_dir/plugins/installed_plugins.json"
[ -f "$installed" ] || fail "the anymodel plugin is not installed."
install_path=$("$bun" -e '${FIND_INSTALL_JS}' -- "$installed" 2>/dev/null) || fail "the anymodel plugin is not installed."
[ -n "$install_path" ] || fail "the anymodel plugin is not installed."
[ -f "$install_path/dist/cli.js" ] || fail "the anymodel plugin folder is missing: $install_path."
# --no-env-file: "anymodel job run" hands its job exactly the environment it was given.
exec "$bun" --no-env-file "$install_path/dist/cli.js" "$@"
`;
}
function installLauncher(binDir, options) {
  const path = join6(binDir, LAUNCHER_NAME);
  const { outcome } = writeManagedFile(path, launcherScript(options.bunPath), {
    stateDir: options.stateDir,
    kind: "whole-file",
    mode: 493,
    ...options.dryRun !== undefined && { dryRun: options.dryRun }
  });
  return { path, outcome };
}

// src/setup/marketplace-access.ts
import { existsSync as existsSync8, readFileSync as readFileSync9 } from "fs";
var ACCESS_TIMEOUT_MS = 1e4;
function marketplaceSource(knownMarketplacesFile, name, env = process.env) {
  if (!existsSync8(knownMarketplacesFile))
    return { kind: "missing" };
  let known;
  try {
    known = JSON.parse(readFileSync9(knownMarketplacesFile, "utf8"));
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
  if (!existsSync8(knownMarketplacesFile))
    return null;
  try {
    const known = JSON.parse(readFileSync9(knownMarketplacesFile, "utf8"));
    const location = known?.[name]?.installLocation;
    return typeof location === "string" && location !== "" ? location : null;
  } catch {
    return null;
  }
}

// src/cli/doctor.ts
var UPDATE_BLOCKING_VARS = [
  "DISABLE_AUTOUPDATER",
  "DISABLE_UPDATES",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
];
var FORCE_PLUGIN_UPDATES_VAR = "FORCE_AUTOUPDATE_PLUGINS";
var MARKETPLACE_UPDATE_COMMAND = `claude plugin marketplace update ${MARKETPLACE}`;
function readSettings2(file) {
  if (!existsSync9(file))
    return null;
  try {
    const parsed = JSON.parse(readFileSync10(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function run2(argv) {
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
  if (!existsSync9(install.installPath)) {
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
  const launcher = join7(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync9(launcher))
    return { ok: false, text: `no launcher at ${where}. Run: anymodel setup` };
  if (!isExecutable(launcher)) {
    return { ok: false, text: `the launcher ${where} is not executable. Run: anymodel setup` };
  }
  const script = readFileSync10(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return { ok: false, text: `the launcher ${where} is out of date. Run: anymodel setup` };
  }
  if (!isExecutable(bun)) {
    return {
      ok: false,
      text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: anymodel setup`
    };
  }
  const result = run2([launcher, "version"]);
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
      return existsSync9(source.path) ? { ok: true, text: `the marketplace folder ${tildify(source.path, paths.home)} exists` } : { ok: false, text: `the marketplace folder is missing: ${source.path}` };
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
    const version = JSON.parse(readFileSync10(manifest, "utf8"))?.version;
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
  const manifest = join7(location, "plugin", ".claude-plugin", "plugin.json");
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
    text: `plugin auto-update is off in ${tildify(paths.settingsFile, paths.home)}. Run: anymodel setup`
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
var OLD_PLUGIN_ID = "cc@cc-agentic";
var OLD_NAME = "cc-agentic";
function isJsonObject6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasEntry(data, field, key) {
  const node = field === null ? data : data?.[field];
  return isJsonObject6(node) && Object.hasOwn(node, key);
}
function checkOldPlugin(settings, paths) {
  const plugins = settings?.enabledPlugins;
  const enabled = isJsonObject6(plugins) && plugins[OLD_PLUGIN_ID] === true;
  if (!existsSync9(join7(paths.claudeConfigDir, OLD_NAME))) {
    if (!enabled)
      return null;
    return {
      ok: false,
      text: `the old plugin ${OLD_PLUGIN_ID} is still enabled: two copies of the same hooks would run. Run: claude plugin uninstall ${OLD_PLUGIN_ID}`
    };
  }
  const short = (path) => tildify(path, paths.home);
  const launcher = join7(paths.binDir, OLD_NAME);
  const left = [
    enabled ? "the plugin enabled" : null,
    hasEntry(readSettings2(paths.installedPluginsFile), "plugins", OLD_PLUGIN_ID) ? "the plugin installed" : null,
    existsSync9(launcher) ? `its launcher ${short(launcher)}` : null,
    hasEntry(settings, "extraKnownMarketplaces", OLD_NAME) ? `extraKnownMarketplaces.${OLD_NAME} in ${short(paths.settingsFile)}` : null,
    hasEntry(readSettings2(paths.knownMarketplacesFile), null, OLD_NAME) ? `the ${OLD_NAME} marketplace` : null
  ].filter((thing) => thing !== null);
  if (left.length === 0)
    return null;
  const then = `claude plugin uninstall ${OLD_PLUGIN_ID}\`, then \`claude plugin marketplace remove ${OLD_NAME}\``;
  const canRun = existsSync9(launcher) && isExecutable(launcher) && run2([launcher, "version"]).ok;
  const steps = canRun ? `Run \`${OLD_NAME} restore\` first, then \`${then}.` : `Its launcher cannot run, so remove by hand ${short(launcher)} and "${OLD_NAME}" under extraKnownMarketplaces in ${short(paths.settingsFile)}; then run \`${then}.`;
  return {
    ok: false,
    text: `the old plugin ${OLD_PLUGIN_ID} (before 0.2.0) left ${left.join(", ")}. ${steps}`
  };
}
async function runDoctor(paths, env, gateway) {
  const settings = readSettings2(paths.settingsFile);
  const checks = [
    checkPlugin(paths),
    checkInstalledVersion(paths),
    checkLauncher(paths),
    await checkMarketplaceAccess(paths, env),
    checkAutoUpdate(settings, paths),
    checkUpdatesNotOff(settings, env, paths),
    checkNameClash(settings),
    checkOldPlugin(settings, paths),
    ...await gatewayChecks({ paths, ...gateway })
  ].filter((check) => check !== null);
  for (const check of checks) {
    console.log(`${check.info ? "\xB7" : check.ok ? "\u2713" : "\u2717"} ${check.text}`);
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}

// src/cli/restore.ts
import { rmSync as rmSync2 } from "fs";

// src/setup/restore.ts
import { existsSync as existsSync11, readFileSync as readFileSync12 } from "fs";

// src/setup/managed-markdown.ts
import { existsSync as existsSync10, readFileSync as readFileSync11 } from "fs";
var BLOCK_BEGIN = "<!-- anymodel:begin -->";
var BLOCK_END = "<!-- anymodel:end -->";
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
    throw new Error(`${file} has a broken anymodel block (${begins} begin and ${ends} end markers). ` + "Fix it by hand: keep one begin marker and one end marker after it.");
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
    const text = existsSync10(file) ? readFileSync11(file, "utf8") : null;
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
    if (!existsSync11(file))
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
  if (!existsSync11(file))
    return false;
  const text = readFileSync12(file, "utf8").trim();
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
      details.push("the anymodel block");
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
function restore(stateDir, options = {}) {
  const except = new Set(options.except ?? []);
  const entries = Object.entries(readChanged(stateDir)).filter(([file]) => !except.has(file));
  return entries.map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file") ? restoreWholeFile(file, entry, stateDir) : restorePartly(file, entry, stateDir);
    if (result.action !== "no-backup")
      forgetChange(stateDir, file);
    return result;
  });
}

// src/cli/restore.ts
function describe2(result, short) {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before anymodel`;
    case "removed":
      return `- ${file}: removed (anymodel had created it)`;
    case "cleaned":
      return `~ ${file}: removed ${result.details.join(", ")}; everything else kept`;
    case "unchanged":
      return `  ${file}: nothing of anymodel left in it`;
    case "no-backup":
      return `! ${file}: the backup from before anymodel is missing; left alone`;
  }
}
var STOP_WARNING = "anymodel-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.";
var NOW_WARNING = `restore --now stops anymodel-router while Claude sessions still use it: every running Claude session fails until it restarts.`;
var STAGE_ONE_DONE = `Restart every running Claude session (they still use the router), then run \`${COMMAND} restore\` again to stop and remove the router.`;
function askFirst(options, warning, question, again) {
  console.log(warning);
  if (options.yes)
    return true;
  const yes = options.confirm?.(question) ?? null;
  if (yes === true)
    return true;
  console.log(yes === null ? `Nothing was changed. Run again with --yes ${again}` : "Nothing was changed.");
  return false;
}
function print(results, short) {
  for (const result of results) {
    console.log(describe2(result, short));
    if (result.savedAs) {
      console.log(`  (its state before this restore: ${short(result.savedAs)})`);
    }
  }
}
async function runRestore(paths, options) {
  const short = (path) => tildify(path, paths.home);
  const changed = readChanged(paths.stateDir);
  const routerFiles = [realTarget(paths.routerCopy), realTarget(paths.routerUnitFile)];
  const routerTracked = routerFiles.some((file) => Object.hasOwn(changed, file));
  const unitTracked = options.systemd && Object.hasOwn(changed, realTarget(paths.routerUnitFile));
  const sessionsUseRouter = routerTracked && ownedGatewayEnvKeys(paths.settingsFile, paths.stateDir).length > 0;
  if (sessionsUseRouter && !options.now) {
    return withLock(paths.stateDir, () => {
      const results = restore(paths.stateDir, { except: routerFiles });
      print(results, short);
      console.log(STAGE_ONE_DONE);
      return results.some((result) => result.action === "no-backup") ? 1 : 0;
    }, { waitMs: 1e4 });
  }
  if (sessionsUseRouter) {
    if (!askFirst(options, NOW_WARNING, "Stop anymodel-router and restore everything now?", `to do it now: ${COMMAND} restore --now --yes`)) {
      return 1;
    }
  } else if (unitTracked && unitActive(options.runner)) {
    if (!askFirst(options, STOP_WARNING, "Stop anymodel-router and restore?", `to stop it: ${COMMAND} restore --yes`)) {
      return 1;
    }
  }
  return withLock(paths.stateDir, async () => {
    if (unitTracked) {
      let port;
      try {
        port = configuredPort(paths.gatewayConfigFile);
      } catch (error) {
        console.log(`  cannot read the router's port (${messageOf(error)}); not waiting for it`);
        port = null;
      }
      const stopped = await stopRouter(options.runner, port, options.probe);
      switch (stopped.kind) {
        case "closed":
          console.log(`- ${UNIT_NAME}: disabled and stopped (port ${port} closed; answers in flight finish in the background)`);
          break;
        case "no-port":
          console.log(`- ${UNIT_NAME}: disabled and stopping`);
          break;
        case "not-running":
          console.log(`  ${UNIT_NAME} was not running (systemctl --user is-active: ${stopped.state}); not waiting for port ${port}`);
          console.log(`- ${UNIT_NAME}: disabled and stopped`);
          break;
        case "other":
          console.log(`  port ${port} answers, but not as this router (${stopped.detail}); not waiting for it`);
          console.log(`- ${UNIT_NAME}: disabled and stopping`);
          break;
      }
    }
    const results = restore(paths.stateDir);
    if (unitTracked)
      options.runner(["systemctl", "--user", "daemon-reload"]);
    rmSync2(restartPendingFile(paths.stateDir), { force: true });
    if (results.length === 0) {
      console.log("Nothing to restore: anymodel has nothing in any file.");
      return 0;
    }
    print(results, short);
    return results.some((result) => result.action === "no-backup") ? 1 : 0;
  }, { waitMs: 1e4 });
}

// src/cli/setup.ts
import { existsSync as existsSync12, readFileSync as readFileSync13 } from "fs";
import { delimiter } from "path";
var AUTO_UPDATE_KEY = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];
function show2(value) {
  return value === undefined ? "(none)" : JSON.stringify(value);
}
function marketplaceKnown(settingsFile) {
  if (!existsSync12(settingsFile))
    return false;
  try {
    const settings = JSON.parse(readFileSync13(settingsFile, "utf8"));
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
    lines.push(`~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${show2(change.before)} -> ${show2(change.after)}`);
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
    console.log(`Note: ${short(paths.binDir)} is not on your PATH. Add it, so the anymodel command works.`);
  }
  return 0;
}

// src/jobs/commands.ts
import { mkdirSync as mkdirSync5, readdirSync as readdirSync3, statSync as statSync6 } from "fs";
import { availableParallelism, hostname as hostname2 } from "os";

// src/project/resolve.ts
import { existsSync as existsSync14, realpathSync as realpathSync2, statSync as statSync4 } from "fs";
import { join as join8 } from "path";

// src/project/config.ts
import { existsSync as existsSync13, readFileSync as readFileSync14 } from "fs";

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
function largestJobGb(kinds) {
  return Math.max(0, ...Object.values(kinds).map((kind) => Math.max(kind.gb, kind.filesGb ?? 0)));
}
function positionals(kind, args) {
  const valued = new Set(kind.valuedFlags ?? []);
  const found = [];
  for (let i = 0;i < args.length; i++) {
    const arg = args[i] ?? "";
    if (valued.has(arg))
      i++;
    else if (!arg.startsWith("-"))
      found.push(arg);
  }
  return found;
}
function reservedGb(kind, args, isFile) {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  if (args.some((arg) => printOnly.has(arg.toLowerCase())))
    return 0;
  if (kind.filesGb === undefined)
    return kind.gb;
  const skip = new Set(kind.skipWords ?? []);
  const given = positionals(kind, args);
  const files = given.length > 0 && skip.has(given[0] ?? "") ? given.slice(1) : given;
  const few = kind.maxFiles === undefined || files.length <= kind.maxFiles;
  return few && files.length > 0 && files.every((path) => isFile(path)) ? kind.filesGb : kind.gb;
}
function workerCount(gb, gbEach, cores) {
  return Math.max(1, Math.min(Math.floor(gb / gbEach), cores - 1));
}
function withWorkers(kind, command, workers) {
  const [program, ...args] = command;
  const spec = kind.workers;
  if (spec === undefined)
    return [program, ...args];
  const names = [spec.flag, ...spec.aliases ?? []];
  const chosen = args.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));
  if (chosen)
    return [program, ...args];
  const flag = `${spec.flag}=${String(workers)}`;
  const end = args.indexOf("--");
  return end === -1 ? [program, ...args, flag] : [program, ...args.slice(0, end), flag, ...args.slice(end)];
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
var anymodelConfigSchema = strictObject({
  requires: string2().refine(isValidRange, 'not a valid version range (like ">=1.2" or "^1.2")').optional(),
  worktrees: strictObject({
    base: string2().min(1),
    prefix: string2().min(1),
    setup: array(string2().min(1)).min(1).optional()
  }).optional(),
  instructions: boolean2().optional(),
  autoMode: array(string2().min(1)).optional(),
  jobs: strictObject({ kinds: kindsSchema.optional() }).optional()
});

class AnymodelConfigError extends Error {
  name = "AnymodelConfigError";
}

class AnymodelVersionError extends AnymodelConfigError {
  name = "AnymodelVersionError";
}
function describeIssue(issue) {
  const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => field === "(top level)" ? key : `${field}.${key}`);
    return `${keys.join(", ")}: unknown field (a newer anymodel may be needed)`;
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
    throw new AnymodelVersionError(`${file}: this project needs anymodel ${requires}; you have ${pluginVersion}; ` + `run ${PLUGIN_UPDATE_COMMAND}`);
  }
}
function loadAnymodelConfig(file, pluginVersion = VERSION) {
  if (!existsSync13(file))
    return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync14(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AnymodelConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  checkRequires(file, raw, pluginVersion);
  const parsed = anymodelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join("; ");
    throw new AnymodelConfigError(`Invalid ${file}: ${issues}`);
  }
  return parsed.data;
}

// src/project/resolve.ts
var MIN_GIT_VERSION = "2.31.0";
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
function gitIn(cwd, env) {
  return (args) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString()
    };
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
  if (!existsSync14(path) || lines.some((line) => line.startsWith("prunable"))) {
    throw new Error(`The main checkout of the repo at ${cwd} is missing: ${path} was moved or deleted. ` + 'If you moved it, run "git worktree repair" in its new folder.');
  }
  return realpathSync2(path);
}
function resolveProject(cwd, options = {}) {
  if (!existsSync14(cwd) || !statSync4(cwd).isDirectory()) {
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
  const root = realpathSync2(top);
  const commonDir = realpathSync2(common);
  const isWorktree = realpathSync2(gitDir) !== commonDir;
  const mainCheckout = isWorktree ? findMainCheckout(git, cwd) : root;
  const own = join8(root, ".claude", "anymodel.json");
  let config = loadAnymodelConfig(own, options.pluginVersion);
  if (config === null && mainCheckout !== null && mainCheckout !== root) {
    config = loadAnymodelConfig(join8(mainCheckout, ".claude", "anymodel.json"), options.pluginVersion);
  }
  return { root, commonDir, isWorktree, mainCheckout, config };
}

// src/jobs/ancestry.ts
import { readFileSync as readFileSync15 } from "fs";
var MAX_DEPTH = 128;
function parentPidFromStat(stat) {
  const end = stat.lastIndexOf(")");
  if (end === -1)
    return null;
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}
function ancestorPids(pid, readStat) {
  const ancestors = [];
  const seen = new Set([pid]);
  let current = pid;
  while (ancestors.length < MAX_DEPTH) {
    const stat = readStat(current);
    if (stat === null)
      break;
    const parent = parentPidFromStat(stat);
    if (parent === null || parent === 0 || seen.has(parent))
      break;
    ancestors.push(parent);
    seen.add(parent);
    current = parent;
  }
  return ancestors;
}
async function isInsideHeavyJob(facts) {
  if (facts.platform !== "linux")
    return false;
  const ancestors = ancestorPids(facts.pid, facts.readStat);
  if (ancestors.length === 0)
    return false;
  const holders = await facts.holderPids();
  return ancestors.some((ancestor) => holders.has(ancestor));
}
function readProcStat(pid) {
  try {
    return readFileSync15(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null;
  }
}

// src/shell/command.ts
var SEPARATORS = new Set([`
`, "\r", "&", "(", ")", ";", "{", "|", "}"]);
var PREFIX_WORDS = new Set(["builtin", "command", "env", "exec", "nohup", "sudo", "time"]);
var ASSIGNMENT = /^[A-Za-z_]\w*=/;
function invocationOf(words) {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (!ASSIGNMENT.test(word) && !PREFIX_WORDS.has(word))
      break;
    index++;
  }
  const first = words[index];
  if (first === undefined)
    return;
  const program = (first.split(/[\\/]/).pop() ?? first).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
  return { args: words.slice(index + 1), program };
}
function nestedCommand(program, args) {
  if (["bash", "dash", "sh", "zsh"].includes(program)) {
    const at = args.findIndex((arg) => /^-[a-z]*c$/.test(arg));
    return at === -1 ? undefined : args[at + 1];
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

// src/jobs/classify.ts
var BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
var NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
var PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
var TIMEOUT_VALUED = ["--kill-after", "--signal", "-k", "-s"];
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
  const again = (words) => {
    const inner = invocationOf(words);
    return inner === undefined ? undefined : toolOf(inner.program, inner.args, depth + 1);
  };
  const at = (valued, from = 0) => firstWord(args, from, valued);
  switch (program) {
    case "timeout":
      return again(args.slice(at(TIMEOUT_VALUED) + 1));
    case "nice":
      return again(args.slice(at(["-n"])));
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
function toolCallOfArgv(argv) {
  const invocation = invocationOf([...argv]);
  if (invocation === undefined)
    return { name: argv[0], args: argv.slice(1) };
  return toolOf(invocation.program, invocation.args) ?? {
    name: invocation.program,
    args: invocation.args
  };
}

// src/jobs/config.ts
import { existsSync as existsSync15, readFileSync as readFileSync16 } from "fs";
import { isAbsolute, join as join9 } from "path";
function jobsPaths(home) {
  return {
    configFile: join9(home, ".config", "anymodel", "jobs.json"),
    stateDir: join9(home, ".local", "share", "anymodel", "jobs")
  };
}
var DEFAULT_RESERVE_GB = 22;
var DEFAULT_SLICE = "anymodel-heavy.slice";
var absolutePath = string2().min(1).refine((path) => isAbsolute(path), "must be an absolute path");
var jobsMachineConfigSchema = strictObject({
  stateDir: absolutePath.optional(),
  budgetGb: number2().int().min(1).optional(),
  reserveGb: number2().int().min(0).optional(),
  sharedDirs: array(absolutePath).optional(),
  launch: _enum(["auto", "plain"]).optional(),
  slice: string2().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*\.slice$/, "must be a slice name like name.slice").optional()
});

class JobsConfigError extends Error {
  name = "JobsConfigError";
}
function loadJobsConfig(file) {
  if (!existsSync15(file))
    return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync16(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new JobsConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = jobsMachineConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      return issue.code === "unrecognized_keys" ? `${issue.keys.join(", ")}: unknown field` : `${field}: ${issue.message}`;
    });
    throw new JobsConfigError(`Invalid ${file}: ${issues.join("; ")}`);
  }
  return parsed.data;
}

// src/jobs/launch.ts
import { spawn, spawnSync } from "child_process";
import { existsSync as existsSync16 } from "fs";
import { constants as constants2 } from "os";

// src/jobs/memory.ts
import { readFileSync as readFileSync17 } from "fs";
import { totalmem } from "os";
var GIB = 1024 ** 3;
var realReadText = (path) => {
  try {
    return readFileSync17(path, "utf8");
  } catch {
    return null;
  }
};
function realMemoryFacts() {
  return { platform: process.platform, read: realReadText, totalmem };
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
function machineBudgetGb(totalBytes, reserveGb, largestGb) {
  return Math.max(largestGb, Math.floor(totalBytes / GIB) - reserveGb);
}
function userSliceCgroup(uid, slice) {
  const parts = slice.replace(/\.slice$/, "").split("-");
  const chain = parts.map((_, i) => `${parts.slice(0, i + 1).join("-")}.slice`);
  return `/user.slice/user-${String(uid)}.slice/user@${String(uid)}.service/${chain.join("/")}`;
}
function sliceBytes(read, uid, slice) {
  return cgroupNumber(read(`/sys/fs/cgroup${userSliceCgroup(uid, slice)}/memory.current`));
}

// src/jobs/launch.ts
var SYSTEMD_TIMEOUT_MS = 1e4;
var HEAVY_OOM_SCORE_ADJ = 900;
function chooseLaunch(facts) {
  if (facts.platform !== "linux")
    return { mode: "plain" };
  if (!facts.hasChoom) {
    return { mode: "plain", note: "no `choom` here: the job runs without its kill mark" };
  }
  if (!facts.hasSystemdRun) {
    return {
      mode: "choom",
      note: "no `systemd-run` here: the job runs with its kill mark only, no memory group"
    };
  }
  if (!facts.hasUserRuntimeDir) {
    return {
      mode: "choom",
      note: "no systemd user manager here: the job runs with its kill mark only, no memory group"
    };
  }
  if (facts.probeScope(true))
    return { mode: "scope", oomPolicy: true };
  if (facts.probeScope(false))
    return { mode: "scope", oomPolicy: false };
  return {
    mode: "choom",
    note: "systemd could not start a scope here (no user session bus?): the job runs with its kill mark only, no memory group"
  };
}
function scopeSwitches(slice, oomPolicy) {
  return [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    `--slice=${slice}`,
    ...oomPolicy ? ["-p", "OOMPolicy=kill"] : []
  ];
}
function probeArgv(slice, oomPolicy) {
  return ["systemd-run", ...scopeSwitches(slice, oomPolicy), "--", "true"];
}
function unitName(slice, kind, pid, startedAt) {
  const prefix = slice.replace(/\.slice$/, "");
  const safeKind = kind === "" ? "job" : kind.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${prefix}-${safeKind}-${String(pid)}-${startedAt.toString(36)}.scope`;
}
function launchArgv(launch, command, where) {
  const choom = ["choom", "-n", String(HEAVY_OOM_SCORE_ADJ), "--"];
  switch (launch.mode) {
    case "choom":
      return [...choom, ...command];
    case "plain":
      return [...command];
    case "scope":
      return [
        "systemd-run",
        ...scopeSwitches(where.slice, launch.oomPolicy),
        `--unit=${unitName(where.slice, where.kind, where.pid, where.startedAt)}`,
        "--",
        ...choom,
        ...command
      ];
  }
}
function exitCodeOf(code, signal) {
  if (code !== null)
    return code;
  if (signal === null)
    return 1;
  const number = constants2.signals[signal];
  return 128 + (number ?? 0);
}
function memoryEvent(memoryEvents, key) {
  if (memoryEvents === null)
    return null;
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(memoryEvents);
  return match?.[1] === undefined ? null : Number(match[1]);
}
function oomKills(memoryEvents) {
  return memoryEvent(memoryEvents, "oom_kill");
}
function oomLimitHits(memoryEvents) {
  return memoryEvent(memoryEvents, "oom");
}
function oomKiller(before, after) {
  const killsBefore = oomKills(before);
  const killsAfter = oomKills(after);
  if (killsBefore === null || killsAfter === null || killsAfter <= killsBefore)
    return null;
  const hitsBefore = oomLimitHits(before);
  const hitsAfter = oomLimitHits(after);
  if (hitsBefore === null || hitsAfter === null)
    return "unknown";
  return hitsAfter > hitsBefore ? "ceiling" : "machine";
}
function killedForMemoryLine(killer, slice, code) {
  switch (killer) {
    case "ceiling":
      return `killed for memory: the heavy jobs running here together went over ${slice}'s ceiling, and the kernel stopped the largest. Run it again when fewer heavy jobs run (exit code ${String(code)}).`;
    case "machine":
      return `killed for memory: the whole machine ran out of memory, and the kernel's OOM killer stopped this job first (its kill mark). Run it again when more memory is free (exit code ${String(code)}).`;
    case "unknown":
      return `killed for memory (the slice's ceiling or the machine's OOM killer). Run it again when fewer heavy jobs run (exit code ${String(code)}).`;
  }
}
function sliceMemoryMax(budgetGb, jobGb) {
  return `${String(Math.max(Math.floor(budgetGb), Math.ceil(jobGb)))}G`;
}
function ceilingArgv(slice, memoryMax) {
  return [
    "systemctl",
    "--user",
    "set-property",
    "--runtime",
    slice,
    `MemoryMax=${memoryMax}`,
    "MemorySwapMax=0"
  ];
}
var FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"];
var LEFTOVER_GRACE_MS = 2000;
var KILL_WAIT_MS = 5000;
var GROUP_POLL_MS = 50;
function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {}
}
function groupIsEmpty(pgid) {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
function spawnAndWait(argv, signals = process, say = () => {
  return;
}, options = {}) {
  const [program, ...args] = argv;
  const scope = options.scope ?? null;
  const pollMs = options.pollMs ?? GROUP_POLL_MS;
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "inherit", detached: true });
    const pgid = child.pid;
    const sendAll = (signal) => {
      if (pgid !== undefined)
        signalGroup(pgid, signal);
      scope?.kill(signal);
    };
    const isEmpty = () => (pgid === undefined || groupIsEmpty(pgid)) && (scope?.isEmpty() ?? true);
    const emptyWithin = async (ms) => {
      const end = Date.now() + ms;
      for (;; ) {
        if (isEmpty())
          return true;
        if (Date.now() >= end)
          return false;
        await Bun.sleep(pollMs);
      }
    };
    const listeners = FORWARDED.map((signal) => [signal, () => sendAll(signal)]);
    for (const [signal, listener] of listeners)
      signals.on(signal, listener);
    let finished = false;
    const done = async (code) => {
      if (finished)
        return;
      finished = true;
      if (!await emptyWithin(options.leftoverGraceMs ?? LEFTOVER_GRACE_MS)) {
        const killWaitMs = options.killWaitMs ?? KILL_WAIT_MS;
        say("the job left processes running: stopping them, so its memory is free");
        sendAll("SIGTERM");
        if (!await emptyWithin(killWaitMs)) {
          sendAll("SIGKILL");
          if (!await emptyWithin(killWaitMs)) {
            say("some of the job's processes still run: its memory is given back anyway");
          }
        }
      }
      for (const [signal, listener] of listeners)
        signals.off(signal, listener);
      resolve(code);
    };
    child.once("error", (error) => {
      say(`could not start ${program}: ${error.code ?? error.message}`);
      done(127);
    });
    child.once("exit", (code, signal) => {
      done(exitCodeOf(code, signal));
    });
  });
}
function exitsZero(argv, timeoutMs) {
  const [program, ...args] = argv;
  return spawnSync(program, args, { stdio: "ignore", timeout: timeoutMs }).status === 0;
}
function canRun(program, timeoutMs) {
  return spawnSync(program, ["--version"], { stdio: "ignore", timeout: timeoutMs }).error === undefined;
}
function realLaunchFacts(slice, timeoutMs = SYSTEMD_TIMEOUT_MS) {
  const uid = process.getuid?.();
  const linux = process.platform === "linux";
  return {
    platform: process.platform,
    hasUserRuntimeDir: uid !== undefined && existsSync16(`/run/user/${String(uid)}`),
    hasSystemdRun: linux && canRun("systemd-run", timeoutMs),
    hasChoom: linux && canRun("choom", timeoutMs),
    probeScope: (withOomPolicy) => exitsZero(probeArgv(slice, withOomPolicy), timeoutMs)
  };
}
function realSliceControl(read, timeoutMs = SYSTEMD_TIMEOUT_MS) {
  return {
    setMemoryMax: (slice, value) => exitsZero(ceilingArgv(slice, value), timeoutMs),
    controlGroup: (slice) => {
      const uid = process.getuid?.();
      return uid === undefined ? null : userSliceCgroup(uid, slice);
    },
    readFile: read
  };
}
function scopeKillArgv(unit, signal) {
  return ["systemctl", "--user", "kill", `--signal=${signal}`, unit];
}
function realScope(slice, unit, read, timeoutMs = SYSTEMD_TIMEOUT_MS) {
  const uid = process.getuid?.();
  if (uid === undefined)
    return null;
  const events = `/sys/fs/cgroup${userSliceCgroup(uid, slice)}/${unit}/cgroup.events`;
  return {
    kill: (signal) => {
      const [program, ...args] = scopeKillArgv(unit, signal);
      spawnSync(program, args, { stdio: "ignore", timeout: timeoutMs });
    },
    isEmpty: () => {
      const text = read(events);
      return text === null || /^populated 0$/m.test(text);
    }
  };
}

// src/jobs/queue.ts
function holderText(record) {
  return JSON.stringify(record);
}
function isObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseHolder(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject3(value) || value.v !== 1)
    return null;
  const { checkout, exclusive, gb, kind, person, pid, since, what } = value;
  if (exclusive !== undefined && typeof exclusive !== "string" || typeof checkout !== "string" || typeof kind !== "string" || typeof person !== "string" || typeof what !== "string" || typeof gb !== "number" || !Number.isFinite(gb) || typeof pid !== "number" || !Number.isInteger(pid) || typeof since !== "number" || !Number.isFinite(since)) {
    return null;
  }
  return {
    checkout,
    ...exclusive !== undefined && { exclusive },
    gb,
    kind,
    person,
    pid,
    since,
    v: 1,
    what
  };
}
function describeHolder(record) {
  const labels = [
    ...record.kind === "" ? [] : [record.kind],
    ...record.exclusive === undefined ? [] : [`exclusive ${record.exclusive}`]
  ];
  return [...labels, `${record.what} in ${record.checkout}`].join(", ");
}
var GIB2 = 1024 ** 3;
function notYetUsedGb(heldGbHere, sliceBytes) {
  if (sliceBytes === null)
    return 0;
  return Math.max(0, heldGbHere - sliceBytes / GIB2);
}
function liveCheckFits(input) {
  if (input.heldGbHere <= 0)
    return true;
  return input.availableBytes / GIB2 - notYetUsedGb(input.heldGbHere, input.sliceBytes) >= input.needGb;
}
function parseEntry(entry) {
  const record = parseHolder(entry.text);
  return {
    exclusive: record?.exclusive ?? null,
    gb: record?.gb ?? 0,
    mine: entry.mine,
    person: record?.person ?? null,
    since: record?.since ?? Number.POSITIVE_INFINITY,
    tie: entry.tie
  };
}
function isBefore(a, b) {
  return a.since < b.since || a.since === b.since && a.tie < b.tie;
}
function gbHeldBy(held, person) {
  return held.reduce((sum, unit) => sum + (unit.holder?.person === person ? unit.gb : 0), 0);
}
function decide(input) {
  const heldGb = input.held.reduce((sum, unit) => sum + unit.gb, 0);
  const heldNames = new Set(input.held.map((unit) => unit.holder?.exclusive));
  const { line } = input;
  const steppedAside = (person) => input.shared && person !== null && gbHeldBy(input.held, person) * 2 >= input.capacityGb && line.some((entry) => entry.person !== null && entry.person !== person);
  const me = line.find((entry) => entry.mine);
  if (me === undefined)
    return { wait: { kind: "no-ticket" } };
  if (input.exclusive !== null && heldNames.has(input.exclusive)) {
    return { wait: { kind: "exclusive", name: input.exclusive } };
  }
  const needsMemory = input.gb > 0;
  if (needsMemory && steppedAside(input.person)) {
    return {
      wait: {
        capacityGb: input.capacityGb,
        heldGb: gbHeldBy(input.held, input.person),
        kind: "fair-share"
      }
    };
  }
  const ahead = line.some((entry) => {
    if (entry.mine || !isBefore(entry, me))
      return false;
    if (entry.exclusive !== null && entry.exclusive === input.exclusive)
      return true;
    return needsMemory && entry.gb > 0 && !steppedAside(entry.person) && !(entry.exclusive !== null && heldNames.has(entry.exclusive));
  });
  if (ahead)
    return { wait: { kind: "behind" } };
  if (!needsMemory)
    return { take: 0 };
  if (input.gb > input.capacityGb) {
    return heldGb > 0 ? { wait: { capacityGb: input.capacityGb, kind: "alone" } } : { take: input.capacityGb };
  }
  const freeGb = input.capacityGb - heldGb;
  if (freeGb < input.gb)
    return { wait: { freeGb: Math.max(0, freeGb), kind: "no-room" } };
  if (input.live !== null && !liveCheckFits({
    heldGbHere: heldGb,
    availableBytes: input.live.availableBytes,
    needGb: input.gb,
    sliceBytes: input.live.sliceBytes
  })) {
    return {
      wait: {
        availableGb: input.live.availableBytes / GIB2,
        kind: "live",
        notYetUsedGb: notYetUsedGb(heldGb, input.live.sliceBytes)
      }
    };
  }
  return { take: input.gb };
}
function twoDigits(value) {
  return String(value).padStart(2, "0");
}
function formatSince(since, now) {
  const at = new Date(since);
  const today = new Date(now);
  const time = `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return sameDay ? time : `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())} ${time}`;
}
function oneDecimal(gb) {
  return String(Math.round(gb * 10) / 10);
}
function reasonText(reason, store) {
  switch (reason.kind) {
    case "alone":
      return `it needs more than ${store}'s whole budget of ${reason.capacityGb} GB, so it runs alone once nothing else holds any`;
    case "behind":
      return `an older job is first in ${store}'s line`;
    case "exclusive":
      return `another job with --exclusive ${reason.name} holds ${store}'s turn for that name`;
    case "fair-share":
      return `this machine already holds ${reason.heldGb} of ${store}'s ${reason.capacityGb} GB while another person waits`;
    case "live":
      return reason.notYetUsedGb > 0 ? `${store} has ${oneDecimal(reason.availableGb)} GB really free, and running jobs will still grow into ${oneDecimal(reason.notYetUsedGb)} GB of it` : `${store} has only ${oneDecimal(reason.availableGb)} GB really free`;
    case "no-room":
      return `only ${reason.freeGb} GB of ${store}'s budget is free`;
    case "no-ticket":
      return `${store}'s line cannot be joined right now`;
  }
}
function holderLines(held, store, now) {
  const groups = new Map;
  for (const unit of held) {
    const key = unit.holder === null ? "unknown" : `${unit.holder.person}\x00${unit.holder.pid}\x00${unit.holder.since}`;
    const group = groups.get(key) ?? { gb: 0, record: unit.holder };
    group.gb += unit.gb;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ gb, record }) => record === null ? `  ${store}: ${gb} GB held by an unknown holder` : `  ${store}: ${gb} GB held by ${record.person}: ${describeHolder(record)}, since ${formatSince(record.since, now)} (pid ${record.pid})`);
}
var POLL_MS = 500;
var WAITING_LINE_EVERY_MS = 60000;

class WaitStoppedError extends Error {
  name = "WaitStoppedError";
}
function once(release) {
  let done = false;
  return () => {
    if (done)
      return;
    done = true;
    release();
  };
}
var NOTHING_HELD = { gb: 0, release: () => {
  return;
} };
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}
async function acquireFrom(stores, job, options) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  const pollMs = options.pollMs ?? POLL_MS;
  const lineEveryMs = options.waitingLineEveryMs ?? WAITING_LINE_EVERY_MS;
  const note = options.onNote ?? options.onWaiting;
  const recordText = (since, exclusive) => holderText({
    checkout: job.checkout,
    ...exclusive !== null && { exclusive },
    gb: job.gb,
    kind: job.kind,
    person: options.person,
    pid: job.pid,
    since,
    v: 1,
    what: job.what
  });
  const wants = job.exclusive === undefined ? `needs ${job.gb} GB` : `needs ${job.gb} GB and the turn for --exclusive ${job.exclusive}`;
  const taken = [];
  const release = once(() => {
    for (const units of [...taken].reverse())
      units.release();
  });
  let waitStartedAt = null;
  let lastLineAt = Number.NEGATIVE_INFINITY;
  const report = async (store, reason) => {
    const at = now();
    if (at - lastLineAt < lineEveryMs)
      return;
    waitStartedAt ??= at;
    lastLineAt = at;
    const waited = Math.round((at - waitStartedAt) / 60000);
    const budgets = [];
    const holders = [];
    for (const each of stores) {
      try {
        const capacity = await each.capacityGb();
        const held = (await each.held()).map((unit) => ({
          gb: unit.gb,
          holder: parseHolder(unit.text)
        }));
        const free = Math.max(0, capacity - held.reduce((sum, unit) => sum + unit.gb, 0));
        budgets.push(`${each.label}: ${free} of ${capacity} GB free`);
        holders.push(...holderLines(held, each.label, at));
      } catch {
        budgets.push(`${each.label}: cannot be read`);
      }
    }
    options.onWaiting(`Heavy job waits for memory: ${job.what} ${wants}${waited > 0 ? ` (waiting ${waited} min)` : ""}. ${budgets.join("; ")}. Why: ${reasonText(reason, store.label)}.`);
    for (const line of holders)
      options.onWaiting(line);
  };
  const stopIfAsked = () => {
    if (options.signal?.aborted === true)
      throw new WaitStoppedError("the wait was stopped");
  };
  const takeFrom = async (store) => {
    let ticket = null;
    try {
      const exclusive = job.exclusive !== undefined && await store.keepsExclusive(job.exclusive) ? job.exclusive : null;
      if (job.gb <= 0 && exclusive === null)
        return NOTHING_HELD;
      for (;; ) {
        stopIfAsked();
        let reason;
        if (job.nested !== true)
          ticket ??= await store.enqueue(recordText(now(), exclusive));
        if (ticket === null && job.nested !== true) {
          reason = { kind: "no-ticket" };
        } else {
          const line = ticket === null ? [{ exclusive, gb: job.gb, mine: true, person: options.person, since: 0, tie: "" }] : (await ticket.line()).map(parseEntry);
          const me = line.find((entry) => entry.mine);
          const plainlyBehind = !store.shared && me !== undefined && job.gb > 0 && line.some((entry) => !entry.mine && isBefore(entry, me) && entry.gb > 0 && entry.exclusive === null);
          let decision;
          if (plainlyBehind) {
            decision = { wait: { kind: "behind" } };
          } else {
            const held = (await store.held()).map((unit) => ({
              gb: unit.gb,
              holder: parseHolder(unit.text)
            }));
            decision = decide({
              capacityGb: await store.capacityGb(),
              exclusive,
              gb: job.gb,
              held,
              line,
              live: store.live?.() ?? null,
              person: options.person,
              shared: store.shared
            });
          }
          if ("take" in decision) {
            const units = await store.tryTake(decision.take, recordText(now(), exclusive), exclusive ?? undefined);
            if (units !== null)
              return units;
            reason = { freeGb: 0, kind: "no-room" };
          } else {
            reason = decision.wait;
          }
        }
        await report(store, reason);
        await sleep(pollMs);
      }
    } catch (error) {
      if (error instanceof WaitStoppedError)
        throw error;
      note(`The heavy-job queue for ${store.label} failed (${messageOf2(error)}): this job runs without that budget.`);
      return NOTHING_HELD;
    } finally {
      ticket?.release();
    }
  };
  try {
    for (const store of stores)
      taken.push(await takeFrom(store));
  } catch (error) {
    release();
    throw error;
  }
  return { gb: job.gb, release };
}
async function pidsHolding(stores, person, exclusive) {
  const pids = new Set;
  for (const store of stores) {
    let held;
    try {
      held = await store.held();
    } catch {
      continue;
    }
    for (const unit of held) {
      const record = parseHolder(unit.text);
      if (record === null)
        continue;
      if (store.shared && record.person !== person)
        continue;
      if (exclusive !== undefined && record.exclusive !== exclusive)
        continue;
      pids.add(record.pid);
    }
  }
  return pids;
}

// src/jobs/run.ts
function describeCommand(command) {
  const what = command.join(" ");
  return what.length > 80 ? `${what.slice(0, 77)}...` : what;
}
function takesOptions(command) {
  const invocation = invocationOf([...command]);
  return invocation === undefined || nestedCommand(invocation.program, invocation.args) === undefined;
}
async function runNested(request, deps) {
  const { exclusive } = request;
  if (exclusive === undefined || await deps.ancestorHoldsName(exclusive)) {
    return deps.run(request.command, null);
  }
  const reservation = await deps.acquire({
    checkout: request.checkout,
    exclusive,
    gb: 0,
    kind: request.kind,
    nested: true,
    pid: request.pid,
    what: describeCommand(request.command)
  }, deps.say);
  try {
    if (deps.stopped?.() === true)
      return 1;
    return await deps.run(request.command, null);
  } finally {
    reservation.release();
  }
}
async function runJob(request, deps) {
  const { command, gb, kind, pid, spec } = request;
  if (await deps.isNested())
    return runNested(request, deps);
  const reservation = await deps.acquire({
    checkout: request.checkout,
    exclusive: request.exclusive,
    gb,
    kind,
    pid,
    what: describeCommand(command)
  }, deps.say);
  try {
    if (deps.stopped?.() === true)
      return 1;
    const workers = spec?.workers;
    const sized = spec !== null && workers !== undefined && gb > 0 && takesOptions(command) ? withWorkers(spec, command, deps.workersFor(gb, workers.gbEach)) : command;
    const facts = gb === 0 ? null : deps.launchFacts();
    const launch = facts === null ? { mode: "plain" } : chooseLaunch(facts);
    if ("note" in launch && launch.note !== undefined)
      deps.say(launch.note);
    let eventsPath = null;
    let scopeUnit = null;
    if (launch.mode === "scope") {
      const memoryMax = deps.memoryMaxFor(gb);
      if (!deps.slice.setMemoryMax(request.slice, memoryMax)) {
        deps.say(`could not set ${request.slice} MemoryMax=${memoryMax}: the job runs without the slice's ceiling`);
      }
      const group = deps.slice.controlGroup(request.slice);
      eventsPath = group === null ? null : `/sys/fs/cgroup${group}/memory.events`;
      scopeUnit = unitName(request.slice, kind, pid, request.startedAt);
    }
    const before = eventsPath === null ? null : deps.slice.readFile(eventsPath);
    const code = await deps.run(launchArgv(launch, sized, { kind, pid, slice: request.slice, startedAt: request.startedAt }), scopeUnit);
    const after = eventsPath === null ? null : deps.slice.readFile(eventsPath);
    const killer = code === 0 ? null : oomKiller(before, after);
    if (killer !== null)
      deps.say(killedForMemoryLine(killer, request.slice, code));
    return code;
  } finally {
    reservation.release();
  }
}

// src/jobs/store.ts
import {
  chmodSync as chmodSync2,
  existsSync as existsSync17,
  mkdirSync as mkdirSync4,
  readdirSync as readdirSync2,
  readFileSync as readFileSync18,
  realpathSync as realpathSync3,
  renameSync as renameSync2,
  statfsSync,
  statSync as statSync5,
  unlinkSync as unlinkSync3,
  utimesSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join10 } from "path";
var HEARTBEAT_MS = 5000;
var UNSEEN_STALE_MS = 30000;
var LOCK_STALE_MS = 30000;
var LOCK_WAIT_MS = 2000;
var LOCK_MODE = 436;
var FILE_MODE = 420;
var LEFTOVER_MS = 60000;
function currentFileHolder() {
  return currentHolder();
}
function parseStoreFile(text) {
  try {
    const value = JSON.parse(text);
    const holder = value?.holder;
    if (value?.store !== 1 || typeof value.gb !== "number" || !Number.isFinite(value.gb) || typeof value.record !== "string" || value.exclusive !== undefined && typeof value.exclusive !== "string" || typeof holder !== "object" || holder === null || typeof holder.pid !== "number" || typeof holder.host !== "string") {
      return null;
    }
    return {
      store: 1,
      gb: value.gb,
      ...value.exclusive !== undefined && { exclusive: value.exclusive },
      record: value.record,
      holder: {
        pid: holder.pid,
        host: holder.host,
        startTime: typeof holder.startTime === "string" ? holder.startTime : null,
        pidns: typeof holder.pidns === "string" ? holder.pidns : null
      }
    };
  } catch {
    return null;
  }
}
function errorCode(error) {
  return error?.code;
}
function writeWhole(file, text, token) {
  const dir = file.slice(0, file.lastIndexOf("/"));
  const temp = join10(dir, `.${token}.tmp`);
  writeFileSync2(temp, text, { mode: FILE_MODE });
  try {
    chmodSync2(temp, FILE_MODE);
    renameSync2(temp, file);
  } catch (error) {
    removeQuietly(temp);
    throw error;
  }
}
function removeQuietly(file) {
  try {
    unlinkSync3(file);
  } catch {}
}
function leaseStore(options) {
  const me = options.self ?? currentFileHolder();
  const isGone = options.isGone ?? ((holder, lastSeenMs, startTimeOf) => {
    const visible = holder !== null && holder.host === me.host && holder.pidns === me.pidns;
    return holderIsGone(visible ? holder : null, lastSeenMs, UNSEEN_STALE_MS, startTimeOf);
  });
  const readStartTime = options.startTimeOf ?? processStartTime;
  const leases = join10(options.dir, "leases");
  const tickets = join10(options.dir, "tickets");
  const mine = new Map;
  const noted = new Set;
  let timer = null;
  const beat = () => {
    const now = new Date;
    for (const [file, text] of mine) {
      try {
        utimesSync(file, now, now);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          try {
            writeWhole(file, text, crypto.randomUUID());
          } catch {}
        }
      }
    }
  };
  const hold = (file, text) => {
    mine.set(file, text);
    if (timer === null) {
      timer = setInterval(beat, options.heartbeatMs ?? HEARTBEAT_MS);
      timer.unref();
    }
  };
  const letGo = (file) => {
    if (!mine.delete(file))
      return;
    removeQuietly(file);
    if (mine.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const noteOnce = (path, line) => {
    if (noted.has(path))
      return;
    noted.add(path);
    options.onNote?.(line);
  };
  const removeLeftover = (path) => {
    try {
      if (Date.now() - statSync5(path).mtimeMs > LEFTOVER_MS)
        removeQuietly(path);
    } catch {}
  };
  const readLive = (folder) => {
    let names;
    try {
      names = readdirSync2(folder);
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return [];
      throw error;
    }
    const startTimes = new Map;
    const startTimeOf = (pid, like) => {
      const key = `${pid}\x00${like?.split(":")[0] ?? ""}`;
      if (!startTimes.has(key))
        startTimes.set(key, readStartTime(pid, like));
      return startTimes.get(key) ?? null;
    };
    const live = [];
    for (const name of names) {
      const path = join10(folder, name);
      if (name.startsWith(".")) {
        if (name.endsWith(".tmp") || name.startsWith(".probe-"))
          removeLeftover(path);
        continue;
      }
      if (!name.endsWith(".json"))
        continue;
      let text;
      let mtimeMs;
      try {
        mtimeMs = statSync5(path).mtimeMs;
      } catch (error) {
        if (errorCode(error) === "ENOENT")
          continue;
        throw error;
      }
      let unreadable = null;
      try {
        text = readFileSync18(path, "utf8");
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT")
          continue;
        if (code !== "EACCES" && code !== "EPERM")
          throw error;
        unreadable = code;
        text = null;
      }
      const file = text === null ? null : parseStoreFile(text);
      if (mine.has(path)) {
        if (file !== null)
          live.push({ token: name.slice(0, -5), file });
        continue;
      }
      if (isGone(file?.holder ?? null, mtimeMs, startTimeOf)) {
        removeQuietly(path);
        continue;
      }
      if (unreadable !== null) {
        noteOnce(path, `${path} cannot be read (${unreadable}): its GB do not count until its writer stops touching it.`);
      }
      if (file !== null)
        live.push({ token: name.slice(0, -5), file });
    }
    return live;
  };
  const write = (folder, gb, record, exclusive) => {
    const token = crypto.randomUUID();
    const path = join10(folder, `${token}.json`);
    const text = JSON.stringify({
      store: 1,
      gb,
      ...exclusive !== undefined && { exclusive },
      holder: me,
      record
    });
    if (!options.shared)
      mkdirSync4(folder, { recursive: true });
    writeWhole(path, text, token);
    hold(path, text);
    return { path, token };
  };
  return {
    dir: options.dir,
    label: options.label,
    shared: options.shared,
    live: options.live,
    capacityGb: () => Promise.resolve().then(options.capacityGb),
    keepsExclusive: (name) => Promise.resolve().then(() => options.keepsExclusive?.(name) ?? true),
    held: () => Promise.resolve().then(() => readLive(leases).map(({ file }) => ({ gb: file.gb, text: file.record }))),
    waiting: () => Promise.resolve().then(() => readLive(tickets).map(({ file }) => ({ gb: file.gb, text: file.record }))),
    enqueue: (recordText) => Promise.resolve().then(() => {
      const gb = JSON.parse(recordText).gb;
      const { path, token } = write(tickets, typeof gb === "number" ? gb : 0, recordText);
      return {
        line: () => Promise.resolve().then(() => readLive(tickets).map((entry) => ({
          mine: entry.token === token,
          tie: entry.token,
          text: entry.file.record
        }))),
        release: () => letGo(path)
      };
    }),
    tryTake: async (gb, recordText, exclusive) => {
      try {
        return await withLock(options.dir, () => {
          const held = readLive(leases);
          if (exclusive !== undefined && held.some(({ file }) => file.exclusive === exclusive)) {
            return null;
          }
          const heldGb = held.reduce((sum, { file }) => sum + file.gb, 0);
          if (gb > 0 && heldGb + gb > options.capacityGb())
            return null;
          const { path } = write(leases, gb, recordText, exclusive);
          return { gb, release: () => letGo(path) };
        }, { waitMs: LOCK_WAIT_MS, fallbackStaleMs: LOCK_STALE_MS, mode: LOCK_MODE });
      } catch (error) {
        if (error instanceof LockBusyError)
          return null;
        throw error;
      }
    }
  };
}
function readBudgetFile(dir) {
  const file = join10(dir, "budget");
  let text;
  try {
    text = readFileSync18(file, "utf8");
  } catch (error) {
    return { problem: `${file} cannot be read (${errorCode(error) ?? String(error)})` };
  }
  const value = text.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    return { problem: `${file} does not hold a whole number of GB` };
  }
  return { gb: Number(value) };
}
function readExclusiveNames(dir) {
  let text;
  try {
    text = readFileSync18(join10(dir, "exclusive"), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return new Set;
    throw error;
  }
  return new Set(text.split(`
`).map((line) => line.replace(/#.*/, "").trim()).filter((line) => line !== ""));
}
var NETWORK_FS = new Map([
  [26985, "NFS"],
  [20859, "SMB"],
  [4283649346, "CIFS"],
  [4266872130, "SMB2"],
  [16914839, "9p"],
  [1397113167, "AFS"],
  [1799439955, "AFS"],
  [12805120, "Ceph"],
  [1937076805, "Coda"],
  [22092, "NCP"],
  [198183888, "Lustre"],
  [18225520, "GFS2"],
  [1952539503, "OCFS2"]
]);
var FUSE_MAGIC = 1702057286;
var NETWORK_FUSE = new Set([
  "sshfs",
  "rclone",
  "s3fs",
  "gcsfuse",
  "goofys",
  "glusterfs",
  "juicefs",
  "davfs",
  "curlftpfs",
  "cephfs"
]);
function unescapeMount(path) {
  return path.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}
function mountTypeOf(path, mountinfo) {
  let best = null;
  for (const line of mountinfo.split(`
`)) {
    const [left, right] = line.split(" - ");
    const point = left?.split(" ")[4];
    const type = right?.split(" ")[0];
    if (point === undefined || type === undefined)
      continue;
    const mount = unescapeMount(point);
    const inside = mount === "/" || path === mount || path.startsWith(`${mount}/`);
    if (inside && (best === null || mount.length >= best.point.length)) {
      best = { point: mount, type };
    }
  }
  return best?.type ?? null;
}
var realSharedFolderFacts = {
  platform: process.platform,
  fsType: (dir) => {
    try {
      return statfsSync(dir).type;
    } catch {
      return null;
    }
  },
  mountinfo: () => {
    try {
      return readFileSync18("/proc/self/mountinfo", "utf8");
    } catch {
      return null;
    }
  }
};
function networkFileSystem(dir, facts) {
  if (facts.platform !== "linux")
    return null;
  const type = facts.fsType(dir);
  if (type === null)
    return null;
  const known = NETWORK_FS.get(type);
  if (known !== undefined)
    return known;
  if (type !== FUSE_MAGIC)
    return null;
  const info = facts.mountinfo();
  let real = dir;
  try {
    real = realpathSync3(dir);
  } catch {}
  const mount = info === null ? null : mountTypeOf(real, info);
  const subtype = mount?.startsWith("fuse.") ? mount.slice(5) : null;
  return subtype !== null && NETWORK_FUSE.has(subtype) ? `fuse.${subtype}` : null;
}
function openSharedStore(dir, options = {}) {
  if (!existsSync17(dir)) {
    return { note: `The shared folder ${dir} is missing: this job runs without its budget.` };
  }
  const network = networkFileSystem(dir, options.facts ?? realSharedFolderFacts);
  if (network !== null) {
    return {
      note: `The shared folder ${dir} is left out: it is on a network file system (${network}). A shared folder is for one host: containers or users on this machine, through a bind mount.`
    };
  }
  const budget = readBudgetFile(dir);
  if ("problem" in budget) {
    return { note: `The shared folder ${dir} is left out: ${budget.problem}.` };
  }
  for (const folder of ["leases", "tickets"]) {
    const path = join10(dir, folder);
    let isFolder = false;
    try {
      isFolder = statSync5(path).isDirectory();
    } catch {}
    if (!isFolder) {
      return { note: `The shared folder ${dir} is left out: ${path} is missing.` };
    }
    const probe = join10(path, `.probe-${crypto.randomUUID()}`);
    try {
      writeFileSync2(probe, "");
      unlinkSync3(probe);
    } catch (error) {
      return {
        note: `The shared folder ${dir} is left out: ${path} cannot be written (${errorCode(error) ?? String(error)}).`
      };
    }
  }
  const store = leaseStore({
    dir,
    label: dir,
    shared: true,
    capacityGb: () => {
      const now = readBudgetFile(dir);
      if ("problem" in now)
        throw new Error(now.problem);
      return now.gb;
    },
    keepsExclusive: (name) => readExclusiveNames(dir).has(name),
    ...options.onNote !== undefined && { onNote: options.onNote }
  });
  return { store };
}

// src/jobs/commands.ts
var USAGE2 = `Usage: ${COMMAND} job <command>

Commands:
  run [--kind <kind>] [--gb <n>] [--exclusive <name>] -- <command...>
                 Wait until this machine has the memory for the job, then run it.
                 Its output, exit code and signals pass through. --exclusive: at
                 most one job with that name at a time, in order. --kind, or
                 --exclusive, or both.
  status         Who holds memory, who waits, and how much is free.
  kinds          The kinds of heavy job, and what each reserves.

How it works: docs/jobs.md in the plugin's repo.`;
var PREFIX = "[anymodel job]";
function machineBudget(config, memory) {
  if (config.budgetGb !== undefined)
    return { gb: config.budgetGb, why: "set in jobs.json" };
  const reserve = config.reserveGb ?? DEFAULT_RESERVE_GB;
  const total = machineMemory(memory).totalBytes;
  const gb = machineBudgetGb(total, reserve, largestJobGb(DEFAULT_KINDS));
  return {
    gb,
    why: `${Math.floor(total / GIB)} GB of memory less ${reserve} GB kept for everything else`
  };
}
function openStores(ctx, config, onNote) {
  const dir = config.stateDir ?? jobsPaths(ctx.paths.home).stateDir;
  try {
    mkdirSync5(dir, { recursive: true, mode: 448 });
  } catch (error) {
    const code = error.code ?? String(error);
    throw new JobsConfigError(`The state folder ${dir} cannot be made (${code}).`);
  }
  const budget = machineBudget(config, ctx.memory);
  const uid = process.getuid?.();
  const slice = config.slice ?? DEFAULT_SLICE;
  const live = () => {
    const memory = machineMemory(ctx.memory);
    if (memory.availableBytes === null)
      return null;
    const used = uid === undefined || config.launch === "plain" ? null : sliceBytes(ctx.memory.read, uid, slice);
    return { availableBytes: memory.availableBytes, sliceBytes: used };
  };
  const machine = leaseStore({
    dir,
    label: "this machine",
    shared: false,
    capacityGb: () => machineBudget(config, ctx.memory).gb,
    live,
    onNote
  });
  const shared = [];
  const notes = [];
  for (const sharedDir of [...new Set(config.sharedDirs ?? [])].sort()) {
    const opened = openSharedStore(sharedDir, { onNote });
    if ("store" in opened)
      shared.push(opened.store);
    else
      notes.push(opened.note);
  }
  return { machine, shared, notes, budget };
}
function envFilesIn(dir) {
  try {
    return readdirSync3(dir).filter((name) => /^\.env(\..+)?$/.test(name));
  } catch {
    return [];
  }
}
function isFileIn(cwd) {
  return (path) => {
    try {
      return statSync6(path.startsWith("/") ? path : `${cwd}/${path}`).isFile();
    } catch {
      return false;
    }
  };
}
function projectKinds(cwd) {
  const project = resolveProject(cwd);
  return mergeKinds(project?.config?.jobs?.kinds);
}
var EXCLUSIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function parseRunArgs(args) {
  let kind = null;
  let gb = null;
  let exclusive = null;
  let index = 0;
  while (index < args.length && args[index] !== "--") {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-"))
      return { error: "put -- before the command" };
    const [name, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (name !== "--kind" && name !== "--gb" && name !== "--exclusive") {
      return { error: `unknown option: ${arg}` };
    }
    const value = inline ?? args[index + 1];
    if (value === undefined || value === "--")
      return { error: `${name} needs a value` };
    index += inline === undefined ? 2 : 1;
    if (name === "--kind")
      kind = value;
    else if (name === "--exclusive") {
      if (!EXCLUSIVE_NAME.test(value)) {
        return {
          error: "--exclusive takes a name: letters, digits, . _ : -, at most 64 characters"
        };
      }
      exclusive = value;
    } else {
      if (!/^\d+$/.test(value))
        return { error: "--gb takes a whole number of GB" };
      gb = Number(value);
    }
  }
  if (kind === null && exclusive === null) {
    return { error: "--kind <kind> or --exclusive <name> is required" };
  }
  if (args[index] !== "--")
    return { error: "put -- before the command" };
  const [program, ...rest] = args.slice(index + 1);
  if (program === undefined || program === "")
    return { error: "no command after --" };
  return { kind, gb, exclusive, command: [program, ...rest] };
}
async function jobRun(args, ctx) {
  const parsed = parseRunArgs(args);
  if ("error" in parsed) {
    ctx.say(`${PREFIX} ${parsed.error}

${USAGE2}`);
    return 2;
  }
  const envFiles = envFilesIn(ctx.cwd);
  if (!ctx.execArgv.includes("--no-env-file") && envFiles.length > 0) {
    ctx.say(`${PREFIX} this folder has ${envFiles.join(", ")}, and bun was started without --no-env-file: ` + `the job would get their values. Run "${COMMAND} setup" to update the launcher, then try again.`);
    return 2;
  }
  const say = (line) => ctx.say(`${PREFIX} ${line}`);
  let config;
  let kinds;
  let opened;
  try {
    config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
    kinds = projectKinds(ctx.cwd);
    opened = openStores(ctx, config, say);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const spec = parsed.kind === null ? null : kinds[parsed.kind];
  if (spec === undefined) {
    ctx.say(`${PREFIX} unknown kind "${parsed.kind}": one of ${Object.keys(kinds).join(", ")}`);
    return 2;
  }
  const stores = [opened.machine, ...opened.shared];
  const now = ctx.now ?? Date.now;
  const slice = config.slice ?? DEFAULT_SLICE;
  const call = toolCallOfArgv(parsed.command);
  const gb = parsed.gb ?? (spec === null ? 0 : reservedGb(spec, call.args, isFileIn(ctx.cwd)));
  const exclusive = parsed.exclusive ?? undefined;
  const stop = new AbortController;
  let caught = null;
  const onSignal = (signal) => () => {
    caught ??= signal;
    stop.abort();
  };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, onSignal(signal)]);
  for (const [signal, handler] of handlers)
    process.on(signal, handler);
  let held = null;
  let started = false;
  const releaseOnExit = () => held?.release();
  process.once("exit", releaseOnExit);
  try {
    const nestedIn = (exclusiveName) => isInsideHeavyJob({
      platform: process.platform,
      pid: process.pid,
      readStat: readProcStat,
      holderPids: () => pidsHolding(stores, hostname2(), exclusiveName)
    });
    const code = await runJob({
      kind: parsed.kind ?? "",
      spec,
      command: parsed.command,
      exclusive,
      gb,
      pid: process.pid,
      checkout: ctx.cwd,
      slice,
      startedAt: now()
    }, {
      isNested: () => nestedIn(),
      ancestorHoldsName: (name) => nestedIn(name),
      acquire: async (job, onWaiting) => {
        for (const note of opened.notes)
          say(note);
        if (job.gb <= 0 && job.exclusive === undefined) {
          return { gb: 0, release: () => {
            return;
          } };
        }
        const reservation = await acquireFrom(stores, job, {
          onWaiting,
          person: hostname2(),
          signal: stop.signal,
          now
        });
        held = reservation;
        return reservation;
      },
      workersFor: (size, gbEach) => workerCount(size, gbEach, availableParallelism()),
      memoryMaxFor: (size) => sliceMemoryMax(opened.budget.gb, size),
      launchFacts: () => config.launch === "plain" ? null : realLaunchFacts(slice),
      slice: realSliceControl(ctx.memory.read),
      run: (argv, scopeUnit) => {
        started = true;
        const scope = scopeUnit === null ? null : realScope(slice, scopeUnit, ctx.memory.read);
        return spawnAndWait(argv, process, say, { scope });
      },
      say,
      stopped: () => stop.signal.aborted
    });
    return started || caught === null ? code : exitCodeOf(null, caught);
  } catch (error) {
    if (error instanceof WaitStoppedError)
      return exitCodeOf(null, caught ?? "SIGTERM");
    throw error;
  } finally {
    for (const [signal, handler] of handlers)
      process.off(signal, handler);
    process.off("exit", releaseOnExit);
  }
}
async function storeLines(store, title, now) {
  const lines = [];
  let capacity;
  let held;
  let waiting;
  try {
    capacity = await store.capacityGb();
    held = (await store.held()).map((unit) => ({ gb: unit.gb, holder: parseHolder(unit.text) }));
    waiting = (await store.waiting()).map((unit) => parseHolder(unit.text)).sort((a, b) => (a?.since ?? Number.POSITIVE_INFINITY) - (b?.since ?? Number.POSITIVE_INFINITY));
  } catch (error) {
    return [`${title}: cannot be read (${error instanceof Error ? error.message : String(error)})`];
  }
  const heldGb = held.reduce((sum, unit) => sum + unit.gb, 0);
  lines.push(`${title}: ${Math.max(0, capacity - heldGb)} of ${capacity} GB free`);
  lines.push(...holderLines(held, store.label, now));
  for (const record of waiting) {
    lines.push(record === null ? `  ${store.label}: an unknown job waits` : `  ${store.label}: waits for ${record.gb} GB: ${record.person}: ${describeHolder(record)}, since ${formatSince(record.since, now)} (pid ${record.pid})`);
  }
  if (held.length === 0 && waiting.length === 0)
    lines.push("  nothing held, nobody waits");
  return lines;
}
async function jobStatus(ctx) {
  const config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
  const opened = openStores(ctx, config, ctx.print);
  const now = (ctx.now ?? Date.now)();
  const home = ctx.paths.home;
  const memory = machineMemory(ctx.memory);
  const free = memory.availableBytes === null ? "free memory cannot be read on this system (no live check)" : `${oneDecimal(memory.availableBytes / GIB)} GB free now`;
  const limit = memory.limit === null ? "" : ` (a memory limit of its group: ${tildify(memory.limit.dir, home)})`;
  ctx.print(`Memory: ${oneDecimal(memory.totalBytes / GIB)} GB${limit}, ${free}.`);
  ctx.print(`Budget for heavy jobs here: ${opened.budget.gb} GB (${opened.budget.why}).`);
  for (const line of await storeLines(opened.machine, `This machine (${tildify(opened.machine.dir, home)})`, now)) {
    ctx.print(line);
  }
  for (const store of opened.shared) {
    for (const line of await storeLines(store, `Shared folder ${store.dir}`, now))
      ctx.print(line);
  }
  for (const note of opened.notes)
    ctx.print(note);
  return 0;
}
function jobKinds(ctx) {
  const project = resolveProject(ctx.cwd);
  const own = project?.config?.jobs?.kinds ?? {};
  const kinds = mergeKinds(own);
  const width = Math.max(...Object.keys(kinds).map((name) => name.length));
  for (const [name, kind] of Object.entries(kinds)) {
    const sizes = [`${kind.gb} GB`];
    if (kind.filesGb !== undefined) {
      const few = kind.maxFiles === undefined ? "" : ` up to ${kind.maxFiles}`;
      sizes.push(`${kind.filesGb} GB for${few} files`);
    }
    if (kind.workers !== undefined) {
      sizes.push(`${kind.workers.flag} at ${kind.workers.gbEach} GB a worker`);
    }
    const from = name in own ? "project" : "default";
    ctx.print(`${name.padEnd(width)}  ${sizes.join(", ")} (${from})`);
    if (kind.about !== undefined)
      ctx.print(`${"".padEnd(width)}  ${kind.about}`);
  }
  return 0;
}
async function runJobCommand(args, ctx) {
  const [command, ...rest] = args;
  switch (command) {
    case "run":
      return jobRun(rest, ctx);
    case "status":
      return jobStatus(ctx);
    case "kinds":
      return jobKinds(ctx);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      ctx.print(USAGE2);
      return command === undefined ? 2 : 0;
    default:
      ctx.say(`Unknown job command: ${command}

${USAGE2}`);
      return 2;
  }
}

// src/entries/cli.ts
var HELP = `anymodel ${VERSION} - set up and check the anymodel plugin for Claude Code

Usage: anymodel <command> [options]

Commands:
  setup [--dry-run]  Install the launcher in ~/.local/bin and turn on plugin auto-update.
                     --dry-run prints what would change and writes nothing.
  doctor             Check the install. Exit code 1 when a check fails.
  restore [--yes] [--now]
                     Remove what anymodel added, and keep everything else: its settings
                     keys, its Markdown blocks, and the files it created (the launcher,
                     the router copy and unit). Each changed file gets a backup first.
                     With the gateway on, it runs in two stages: first everything but the
                     router, which the running sessions still use; after you restart
                     them, again to stop and remove the router (it asks; --yes: without
                     asking). --now: both at once, and every running session fails until
                     it restarts.
  gateway <command>  The AI gateway: status, models, slot, setup, on, off, serve.
                     anymodel gateway --help lists them.
  job <command>      The queue for heavy jobs (type checks, test runs, builds):
                     run, status, kinds. anymodel job --help lists them.
  version            Print the version.
  --help             Print this help.

Paths follow HOME and CLAUDE_CONFIG_DIR.`;
function routerBundle() {
  const beside = join11(import.meta.dir, "router.js");
  return existsSync18(beside) ? beside : join11(import.meta.dir, "..", "..", "plugin", "dist", "router.js");
}
var runner = (cmd) => {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: 30000 });
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`
  };
};
var systemd = process.platform === "linux" && Bun.which("systemctl") !== null;
var ask = process.stdin.isTTY ? (question) => confirm(question) : null;
function gatewayContext(paths) {
  return {
    paths,
    bunPath: process.execPath,
    bundle: routerBundle(),
    runner,
    readStdin: () => Bun.stdin.text(),
    confirm: ask,
    systemd,
    probe: realProbe()
  };
}
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
      return runDoctor(paths, process.env, {
        bundle: routerBundle(),
        runner,
        systemd
      });
    case "restore": {
      const unknown = rest.filter((arg) => arg !== "--yes" && arg !== "--now");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}

${HELP}`);
        return 2;
      }
      return runRestore(paths, {
        yes: rest.includes("--yes"),
        now: rest.includes("--now"),
        runner,
        systemd,
        confirm: ask,
        probe: realProbe()
      });
    }
    case "gateway":
      return runGateway(rest, gatewayContext(paths));
    case "job":
      return runJobCommand(rest, {
        paths,
        cwd: process.cwd(),
        execArgv: process.execArgv,
        memory: realMemoryFacts(),
        say: (line) => console.error(line),
        print: (line) => console.log(line)
      });
    case "version":
    case "--version":
      console.log(`anymodel ${VERSION}`);
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
  console.error(`anymodel: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
