// @bun
// src/hooks/run.ts
import { appendFileSync as appendFileSync3 } from "fs";

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
function managedAgentsDir(platform = process.platform) {
  const root = platform === "darwin" ? "/Library/Application Support/ClaudeCode" : platform === "win32" ? "C:\\Program Files\\ClaudeCode" : "/etc/claude-code";
  return join2(root, ".claude", "agents");
}
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
    workflowConfigFile: join2(router.home, ".config", "cc-smart-dev-kit", "workflow.json"),
    machinesFile: join2(router.home, ".config", "cc-smart-dev-kit", "machines.json"),
    tmuxConfFile: join2(router.home, ".tmux.conf"),
    tavilyKeyFile: join2(claudeConfigDir, "cc-smart-dev-kit", "tavily.key"),
    managedAgentsDir: managedAgentsDir()
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

// src/project/config.ts
import { existsSync, readFileSync as readFileSync2 } from "fs";
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
// src/build-info/index.ts
var info = {
  version: "4.9.0",
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

// src/workflow/schema.ts
var PERCENT = { kind: "whole", max: 100, min: 1 };
var AT_LEAST_ZERO = { kind: "whole", min: 0 };
var PHASE_COUNT = { kind: "whole", max: 50, min: 1 };
function numberSchema(rule) {
  const whole = number2().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}
var NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO,
  "plans.maxPhases": PHASE_COUNT
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
  plans: strictObject({
    maxPhases: numberField("plans.maxPhases")
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
  crew: unknown().optional()
});
var personalWorkflowSchema = workflowSchema.extend({
  switches: strictObject({ jobRoute: boolean2().optional(), leadHint: boolean2().optional() }).optional()
});
var workflowDefaults = {
  autoCommit: false,
  autoPush: false,
  openPr: "off",
  autoMerge: false,
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
    enabled: false,
    allowPublic: false,
    foundLabel: "kit:found",
    fixedLabel: "fixed-unreleased",
    readyLabel: "kit:ready"
  },
  alerts: {
    usagePercent: 85
  },
  plans: {
    maxPhases: 10
  }
};
var SWITCH_NAMES = [
  "statusLine",
  "sessionNames",
  "jobRoute",
  "updateHold",
  "leadHint"
];
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
  "issues.foundLabel",
  "issues.fixedLabel",
  "issues.readyLabel",
  "alerts.usagePercent",
  "plans.maxPhases"
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
var RANGE_START = /^\s*(>=|>|\^|~|=|<=|<)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;
function lowestAllowed(range) {
  let lowest = null;
  for (const part of range.split("||")) {
    const match = RANGE_START.exec(part);
    if (match === null)
      return null;
    const version = match[1]?.startsWith("<") ? "0.0.0" : `${match[2]}.${match[3] ?? "0"}.${match[4] ?? "0"}`;
    if (lowest === null || Bun.semver.order(version, lowest) < 0)
      lowest = version;
  }
  return lowest;
}
var NO_TOP = "999999.0.0";
var WRITTEN_VERSION = new RegExp(`v?(${NUMBER})(?:\\.(${NUMBER})(?:\\.(${NUMBER})(?:-(${IDENT}))?(?:\\+${IDENT})?)?)?`, "g");
function partNumber(part) {
  return part === undefined || /^[xX*]$/.test(part) ? 0 : Number(part);
}
function allowsNewer(version, range) {
  if (!isValidRange(range))
    throw new Error(`"${range}" is not a valid version range`);
  const candidates = [NO_TOP];
  for (const match of range.matchAll(WRITTEN_VERSION)) {
    const major = partNumber(match[1]);
    const minor = partNumber(match[2]);
    const patch = partNumber(match[3]);
    const pre = match[4] === undefined ? "" : `-${match[4]}`;
    candidates.push(`${major}.${minor}.${patch}${pre}`, `${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`);
  }
  return candidates.some((candidate) => Bun.semver.order(candidate, version) > 0 && Bun.semver.satisfies(candidate, range));
}

// src/project/config.ts
var PLUGIN_HOOK_NAMES = [
  "git-guard",
  "merge-guard",
  "main-folder-guard",
  "agent-guard",
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
var RETIRED_HOOK_NAMES = [
  "serena-root",
  "crew-role",
  "lead-notes",
  "message-guard"
];
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
function baseForBranch(worktrees, branch) {
  let match = null;
  for (const prefix of Object.keys(worktrees.bases ?? {})) {
    if (branch.startsWith(prefix) && (match === null || prefix.length > match.length)) {
      match = prefix;
    }
  }
  return match === null ? worktrees.base : worktrees.bases?.[match] ?? worktrees.base;
}

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
  if (satisfiesRange(pluginVersion, requires))
    return;
  if (!allowsNewer(pluginVersion, requires)) {
    const lowest = lowestAllowed(requires);
    const [major, minor] = lowest?.split(".") ?? [];
    const example = lowest === null || lowest === "0.0.0" ? "" : ` (for example >=${major}.${minor})`;
    throw new CcSmartDevKitVersionError(`${file}: this project's requires ${requires} does not let in cc-smart-dev-kit ` + `${pluginVersion}, which is newer; widen requires in that file${example}`);
  }
  throw new CcSmartDevKitVersionError(`${file}: this project needs cc-smart-dev-kit ${requires}; you have ${pluginVersion}; ` + `run ${PLUGIN_UPDATE_COMMAND}`);
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
    const raw = readUserJson(file);
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
  return parseCcSmartDevKitConfig(readFileSync2(file, "utf8"), file, pluginVersion);
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
function checkoutFailure(error) {
  if (error instanceof GitTimedOutError)
    return GIT_TIMED_OUT;
  return error instanceof Error ? error.message : String(error);
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
function gitInAsync(cwd, env, timeoutMs = RESOLVE_GIT_TIMEOUT_MS, timeFor) {
  return async (args) => {
    const limit = callLimit(timeoutMs, timeFor);
    if (limit <= 0)
      return NO_TIME_LEFT;
    try {
      const child = Bun.spawn(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: limit,
        windowsHide: true
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);
      return { ok: code === 0, stdout, stderr, timedOut: child.signalCode === "SIGTERM" };
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
function gitTimedOut(where) {
  return { found: false, where, why: GIT_TIMED_OUT };
}
function refNotKnown(where, ref, read) {
  if (read.timedOut === true)
    return gitTimedOut(where);
  return {
    found: false,
    where,
    why: `${ref} is not known in this repository (no origin, or the branch was never fetched)`
  };
}
function noCommittedFile(where, ref, read) {
  if (read.timedOut === true)
    return gitTimedOut(where);
  return { found: false, where, why: `${ref} has no ${CONFIG_PATH} committed` };
}
function unreadableCommitted(where, read) {
  if (read.timedOut === true)
    return gitTimedOut(where);
  return { found: false, where, why: `git could not read ${where}` };
}
function committedOf(text, where, options) {
  return {
    found: true,
    where,
    config: parseCcSmartDevKitConfig(text.stdout, where, options.pluginVersion)
  };
}
function readCommittedConfig(checkout, branch, options = {}) {
  const ref = `origin/${branch}`;
  const where = `${ref}:${CONFIG_PATH}`;
  const git = gitIn(checkout.root, gitEnv(options.env ?? process.env), options.timeoutMs, options.timeFor);
  const commit = git(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`]);
  if (!commit.ok)
    return refNotKnown(where, ref, commit);
  const blob = git(["rev-parse", "--verify", "--quiet", `${commit.stdout.trim()}:${CONFIG_PATH}`]);
  if (!blob.ok)
    return noCommittedFile(where, ref, blob);
  const text = git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok)
    return unreadableCommitted(where, text);
  return committedOf(text, where, options);
}
async function readCommittedConfigAsync(checkout, branch, options = {}) {
  const ref = `origin/${branch}`;
  const where = `${ref}:${CONFIG_PATH}`;
  const git = gitInAsync(checkout.root, gitEnv(options.env ?? process.env), options.timeoutMs, options.timeFor);
  const commit = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`]);
  if (!commit.ok)
    return refNotKnown(where, ref, commit);
  const blob = await git([
    "rev-parse",
    "--verify",
    "--quiet",
    `${commit.stdout.trim()}:${CONFIG_PATH}`
  ]);
  if (!blob.ok)
    return noCommittedFile(where, ref, blob);
  const text = await git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok)
    return unreadableCommitted(where, text);
  return committedOf(text, where, options);
}

// src/hooks/ask-log.ts
import { join as join7 } from "path";

// src/hooks/jsonl-log.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync4, readFileSync as readFileSync6, statSync as statSync5 } from "fs";
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
  readFileSync as readFileSync3,
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

// src/update/state.ts
import {
  appendFileSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync5,
  rmSync,
  statSync as statSync4,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join6 } from "path";

// src/setup/lock.ts
import {
  closeSync as closeSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readFileSync as readFileSync4,
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
    const stat = readFileSync4(`/proc/${pid}/stat`, "utf8");
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
    info = parseLock(readFileSync4(file, "utf8"));
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

// src/update/state.ts
var CHECK_INTERVAL_MS = 60 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
function updateFiles(stateDir) {
  return {
    hold: join6(stateDir, "update-hold"),
    check: join6(stateDir, "update-check.json"),
    reported: join6(stateDir, "update-reported"),
    major: join6(stateDir, "update-major.json"),
    log: join6(stateDir, "update.log"),
    lockDir: join6(stateDir, "update"),
    sessions: join6(stateDir, "sessions")
  };
}
var UNREACHABLE_FAILS_AFTER_HOURS = 24;
var UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;
function isHeld(files) {
  return existsSync4(files.hold);
}

// src/hooks/jsonl-log.ts
function cutBack(file) {
  let size;
  try {
    size = statSync5(file).size;
  } catch {
    return;
  }
  if (size <= LOG_MAX_BYTES)
    return;
  const text = readFileSync6(file, "utf8");
  const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
  atomicWrite(file, keep.slice(keep.indexOf(`
`) + 1), 384);
}
function appendJsonLine(file, value) {
  mkdirSync4(dirname2(file), { recursive: true, mode: 448 });
  cutBack(file);
  appendFileSync2(file, `${JSON.stringify(value)}
`, { mode: 384 });
}

// src/hooks/ask-log.ts
var ASK_LOG_FILE = "guard-asks.jsonl";
var ASK_REASON_MAX = 200;
function askLogFile(stateDir) {
  return join7(stateDir, ASK_LOG_FILE);
}
function appendAsk(file, ask) {
  appendJsonLine(file, ask);
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
function addContext(event, text) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text }
    })
  };
}
function addContextAndTitle(event, text, title) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        ...text === null ? {} : { additionalContext: text },
        sessionTitle: title
      }
    })
  };
}
function systemMessage(text) {
  return { stdout: JSON.stringify({ systemMessage: text }) };
}
function addContextAndMessage(event, text, message) {
  return {
    stdout: JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: event, additionalContext: text }
    })
  };
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
function scopeOfStateKey(key) {
  const at = key.indexOf("/");
  return at === -1 ? { profile: null, slot: key } : { profile: key.slice(0, at), slot: key.slice(at + 1) };
}
function parseLimitState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
var UNKNOWN_CLOCK = "an unknown time";
function formatClock(epochSec, nowMs, timeZone) {
  const at = new Date(epochSec * 1000);
  if (Number.isNaN(at.getTime()))
    return UNKNOWN_CLOCK;
  const day = (date) => new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone
  }).format(at);
  if (day(at) === day(new Date(nowMs)))
    return time;
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone
  }).format(at);
  return `${date} ${time}`;
}
function current(resetsAt, lastMs, nowMs) {
  if (resetsAt !== null)
    return resetsAt * 1000 > nowMs;
  return nowMs - lastMs < NO_RESET_FRESH_MS;
}
function currentChecksDown(state, nowMs) {
  return Object.entries(state.checksDown ?? {}).filter(([, record2]) => current(null, record2.lastAt, nowMs)).sort(([a], [b]) => a < b ? -1 : 1);
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
  const expanded = [];
  const owed = [];
  let open = false;
  let unparsable = false;
  let at = 0;
  let afterPipe = false;
  let matching = null;
  let semicolons = null;
  const push = (piece, from, filledIn = false) => {
    segments.push(piece);
    piped.push(from);
    expanded.push(filledIn);
  };
  function addInner(inner, body, filledIn = false) {
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
      push(read.segments[i] ?? "", read.piped[i] ?? null, filledIn || read.expanded[i] === true);
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
          raw += `$(${read(true).raw}`;
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
    expanded.length = mark;
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
  function read(nested, substitutions = 0) {
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
        if (char === "$" && next === "(" && substitutions < MAX_INNER) {
          at += 2;
          const substitution = read(true, substitutions + 1);
          if (!substitution.closed)
            open = true;
          take(`$(${substitution.raw}`);
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
      if (SEPARATORS.has(char) || isGroupBrace(char, wordStart) || blind && bash && char === "`") {
        push(current, afterPipe ? segments[segments.length - 1] ?? null : null);
        afterPipe = char === "|";
        if (nested && char === ")" && depth === 0) {
          at++;
          return { closed: true, raw: `${raw})` };
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
    return { closed: false, raw };
  }
  if (options.body === true)
    readDouble(false);
  else
    read(false);
  return { expanded, open, piped, segments, unparsable };
}
function shellSteps(command, { blindWhenOpen = false, dialect = "bash", joinLines = false } = {}) {
  const read = lex(command, { blind: false, dialect, join: joinLines });
  if (read.unparsable)
    return [];
  const chosen = read.open && blindWhenOpen ? lex(command, { blind: true, dialect, join: joinLines }) : read;
  return chosen.segments.map((text, index) => ({
    expanded: chosen.expanded[index] === true,
    pipedFrom: chosen.piped[index] ?? null,
    text
  }));
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
var REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|>&|&>)(.*)$/s;
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
function isWrapper(word) {
  return WRAPPERS[programName(word)] !== undefined;
}
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
function programName(word) {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
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
  if (!word.startsWith("$") && !word.startsWith("`"))
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
function startProcess(args) {
  let file = null;
  let list = null;
  let fresh = null;
  const positional = [];
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    const parameter = startProcessParameter(arg);
    if (parameter === null) {
      if (!arg.startsWith("-"))
        positional.push(arg);
      continue;
    }
    const { name, takesValue } = parameter;
    let value = parameter.value;
    if (takesValue && value === undefined) {
      value = args[index + 1];
      index++;
    }
    if (name === "filepath" && value !== undefined)
      file = value;
    else if (name === "argumentlist" && value !== undefined) {
      list = value.split(",").flatMap((part) => wordsOf(part)).filter((one) => one !== "");
    } else if (name === "usenewenvironment")
      fresh = arg;
  }
  file ??= positional[0] ?? null;
  list ??= positional.length > 1 ? wordsOf(positional.slice(1).join(" ")) : [];
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
var WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "<>"]);
function redirectionTargets(words) {
  const targets = [];
  for (let index = 0;index < words.length; index++) {
    const redirection = REDIRECTION.exec(words[index] ?? "");
    if (redirection === null)
      continue;
    let target = redirection[2] ?? "";
    if (target === "")
      target = words[++index] ?? "";
    const operator = redirection[1] ?? "";
    if (operator === ">&")
      continue;
    if (operator === "&>" && target.startsWith(">"))
      target = target.slice(1);
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
  if (program === "find")
    return findCommands(args);
  if (program === "watch")
    return watchCommand(args);
  if (program === "su")
    return suCommand(args);
  if (program === "parallel")
    return parallelCommand(args);
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
var anyFill = (word) => /[$`]/.test(word);
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
function invocationsOf(command, dialect) {
  const walk = (line, one, depth, into, inherited) => {
    for (const step of shellSteps(line, { blindWhenOpen: true, dialect: one, joinLines: true })) {
      const read = wordsWithFill(step.text, one);
      const words = read.map((word) => word.text);
      const fill = fillOfStep(step, read, one, inherited);
      const invocation = invocationOf(words);
      if (invocation === undefined)
        continue;
      into.push({
        args: invocation.args,
        computed: invocation.computed,
        filled: [...fill.filled, ...derivedFill(words, invocation.args)],
        program: invocation.program,
        words
      });
      const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
      if (inner !== undefined && depth < MAX_NESTING) {
        walk(inner, nestedDialect(invocation.program), depth + 1, into, fill.passes);
      }
    }
  };
  const found = [];
  for (const one of dialect === undefined ? ["bash", "powershell"] : [dialect]) {
    walk(command, one, 0, found, false);
  }
  const seen = new Set;
  return found.filter((one) => {
    const key = JSON.stringify(one);
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

// src/user-away/state.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7 } from "fs";
import { join as join8 } from "path";
var PARK_KINDS = ["question", "action", "decision"];
var AWAY_LOCK_WAIT_MS = 5000;
var MAX_ITEMS = 500;
var MAX_SAID = 100;
var itemSchema = object({
  id: number2().int().positive(),
  kind: _enum(PARK_KINDS),
  text: string2(),
  command: string2().nullable(),
  tool: string2().nullable(),
  options: array(string2()),
  recommend: number2().int().positive().nullable(),
  session: string2(),
  cwd: string2(),
  at: string2()
});
var stateSchema2 = object({
  unavailable: boolean2(),
  since: string2().nullable(),
  until: string2().nullable(),
  items: array(itemSchema),
  nextId: number2().int().positive(),
  said: record(string2(), string2()),
  stopSaid: record(string2(), string2()).default({})
});

class AwayStateError extends Error {
  name = "AwayStateError";
}
function freshState() {
  return {
    unavailable: false,
    since: null,
    until: null,
    items: [],
    nextId: 1,
    said: {},
    stopSaid: {}
  };
}
function awayDir(stateDir) {
  return join8(stateDir, "user-away");
}
function awayStateFile(stateDir) {
  return join8(awayDir(stateDir), "state.json");
}
function readAway(stateDir) {
  const file = awayStateFile(stateDir);
  let text;
  try {
    text = readFileSync7(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return freshState();
    throw new AwayStateError(`${file} cannot be read: ${error.message}`);
  }
  try {
    return stateSchema2.parse(JSON.parse(text));
  } catch (error) {
    throw new AwayStateError(`${file} is not a state file (${error.message.split(`
`)[0]}). Fix it or remove it.`);
  }
}
async function change(stateDir, apply, waitMs = AWAY_LOCK_WAIT_MS) {
  const folder = awayDir(stateDir);
  mkdirSync5(folder, { mode: 448, recursive: true });
  return await withLock(folder, () => {
    const state = readAway(stateDir);
    const result = apply(state);
    atomicWrite(awayStateFile(stateDir), `${JSON.stringify(state, null, 2)}
`, 384);
    return { result, state };
  }, { waitMs });
}
function sameItem(items, draft) {
  const what = (item) => item.command ?? item.text;
  return items.find((item) => item.kind === draft.kind && what(item) === what(draft) && item.cwd === draft.cwd);
}
async function parkItem(stateDir, draft, nowMs, waitMs = AWAY_LOCK_WAIT_MS) {
  const { result } = await change(stateDir, (state) => {
    const same = sameItem(state.items, draft);
    if (same !== undefined)
      return { added: false, item: same };
    if (state.items.length >= MAX_ITEMS) {
      throw new AwayStateError(`the list already holds ${String(MAX_ITEMS)} items: go through it with the user-available skill first`);
    }
    const item = { ...draft, id: state.nextId, at: new Date(nowMs).toISOString() };
    state.nextId += 1;
    state.items.push(item);
    return { added: true, item };
  }, waitMs);
  return result;
}
function periodKey(state) {
  return `${state.since}|${state.until}`;
}
function saidKey(state) {
  return `${periodKey(state)}|${String(state.items.length)}`;
}
function saidCovers(state, session) {
  return state.said[session]?.startsWith(`${periodKey(state)}|`) === true;
}
async function sayOnce(stateDir, session, key) {
  return await recordOnce(stateDir, "said", session, key);
}
async function stopSayOnce(stateDir, session, key) {
  return await recordOnce(stateDir, "stopSaid", session, key);
}
async function recordOnce(stateDir, mark, session, key) {
  if (readAway(stateDir)[mark][session] === key)
    return false;
  const { result } = await change(stateDir, (state) => {
    const heard = state[mark];
    if (heard[session] === key)
      return false;
    delete heard[session];
    heard[session] = key;
    for (const old of Object.keys(heard).slice(0, -MAX_SAID))
      delete heard[old];
    return true;
  });
  return result;
}
async function forgetSaid(stateDir, session) {
  const heard = (state) => state.said[session] !== undefined || state.stopSaid[session] !== undefined;
  if (!heard(readAway(stateDir)))
    return false;
  const { result } = await change(stateDir, (state) => {
    if (!heard(state))
      return false;
    delete state.said[session];
    delete state.stopSaid[session];
    return true;
  });
  return result;
}

// src/user-away/whose.ts
import { existsSync as existsSync6 } from "fs";
import { dirname as dirname7 } from "path";

// src/hooks/sessions.ts
import { existsSync as existsSync5, readdirSync as readdirSync3, readFileSync as readFileSync9, statSync as statSync6 } from "fs";
import { uptime } from "os";
import { join as join9 } from "path";

// src/jobs/ancestry.ts
import { readFileSync as readFileSync8 } from "fs";
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
function ancestorPids(pid, readStat) {
  return ancestorsBy(pid, (one) => {
    const stat = readStat(one);
    return stat === null ? null : parentPidFromStat(stat);
  });
}
function readProcStat(pid) {
  try {
    return readFileSync8(`/proc/${String(pid)}/stat`, "utf8");
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
  const dir = join9(claudeConfigDir, "sessions");
  if (!existsSync5(dir))
    return [];
  const bootedAt = Date.now() - uptime() * 1000;
  const live = [];
  for (const file of readdirSync3(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid) || !(facts.running ?? isRunning)(pid))
      continue;
    let text;
    try {
      if (statSync6(join9(dir, file)).mtimeMs < bootedAt)
        continue;
      text = readFileSync9(join9(dir, file), "utf8");
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

// src/tasks/context.ts
import { realpathSync as realpathSync4 } from "fs";

// src/hooks/git.ts
import { readFileSync as readFileSync10, realpathSync as realpathSync3 } from "fs";
import { basename as basename2, dirname as dirname4, join as join10, resolve as resolve3 } from "path";

// src/path-compare.ts
import { statSync as statSync7 } from "fs";
import { dirname as dirname3, resolve as resolve2 } from "path";
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
function samePath(a, b, ignoreCase = IGNORE_CASE) {
  return isInside(a, b, ignoreCase) && isInside(b, a, ignoreCase);
}
function folderId(path) {
  try {
    const stat = statSync7(path, { bigint: true });
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
  let at = resolve2(path);
  for (;; ) {
    if (folderId(at) === target)
      return true;
    const up = dirname3(at);
    if (up === at)
      return false;
    at = up;
  }
}
function sameFolderOnDisk(a, b, ignoreCase = IGNORE_CASE) {
  if (samePath(a, b, ignoreCase))
    return true;
  const id = folderId(a);
  return id !== null && id === folderId(b);
}

// src/hooks/git.ts
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
    const err = result.signalCode ? "timed out" : result.stderr.toString().trim();
    const code = result.signalCode ? null : result.exitCode;
    const out = result.stdout.toString();
    return { ok: result.exitCode === 0, out: trim ? out.trim() : out, err, code };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: "", err, code: null };
  }
}
async function runGitAsync(cwd, args, env, timeoutMs = 15000, own = {}) {
  try {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      env: { ...gitEnv(env), ...own },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    const signaled = child.signalCode !== null && child.signalCode !== undefined;
    return {
      ok: code === 0,
      out: stdout.trim(),
      err: signaled ? "timed out" : stderr.trim(),
      code: signaled ? null : code
    };
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
      return join10(realpathSync3(at), ...rest);
    } catch {
      const parent = dirname4(at);
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
function worktreeAdminDir(worktree) {
  let text;
  try {
    text = readFileSync10(join10(worktree, ".git"), "utf8");
  } catch {
    return null;
  }
  const target = /^gitdir:\s*(.+)$/.exec(text.trim())?.[1]?.trim();
  return target === undefined || target === "" ? null : resolve3(worktree, target);
}
var REFLOG_HEADER = /^[a-f0-9]+ [a-f0-9]+ .*<[^<>]*> (\d+) [+-]\d{4}$/;
function reflogEntryTime(line) {
  const tab = line.indexOf("\t");
  const epoch = REFLOG_HEADER.exec(tab < 0 ? line : line.slice(0, tab))?.[1];
  if (epoch === undefined)
    return null;
  const time = Number(epoch) * 1000;
  return Number.isFinite(time) ? time : null;
}

// src/workflow/reviews.ts
import { createHash } from "crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync11 } from "fs";
import { dirname as dirname5, join as join11 } from "path";
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
  return join11(stateDir, "reviews", `${repoKey(repo)}.json`);
}
function reviewStartsFile(stateDir, repo) {
  return join11(stateDir, "reviews", `${repoKey(repo)}.starts.json`);
}
function readObject(file) {
  try {
    const parsed = JSON.parse(readFileSync11(file, "utf8"));
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
function trustedReviews(file, agents) {
  return Object.entries(readReviews(file)).filter(([, entry]) => trusted(entry, agents)).sort(([, a], [, b]) => b.at.localeCompare(a.at)).map(([sha, entry]) => ({ sha, at: entry.at, branches: entry.branches ?? [] }));
}
async function underRecordLock(file, write) {
  const folder = dirname5(file);
  mkdirSync6(folder, { mode: 448, recursive: true });
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

// src/tasks/project/files.ts
import { basename as basename3, dirname as dirname6, isAbsolute, join as join12, relative, resolve as resolve4, sep as sep2 } from "path";

// src/tasks/project/format.ts
var date2 = string2().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Expected a calendar date (YYYY-MM-DD)");
var projectTaskSchema = object({
  id: string2().regex(/^T-[a-z2-7]{6}$/),
  title: string2().min(1).max(200),
  kind: _enum(["production", "database", "teammate", "follow-up"]),
  status: _enum(["open", "done", "dropped"]),
  when: _enum(["now", "next-release", "any"]).optional(),
  weight: _enum(["blocks-release", "after-deploy", "owner"]).optional(),
  flags: array(_enum(["needs-yes", "twice-safe", "spends-money", "real-people", "destructive"])).optional(),
  created: date2,
  closed: date2.optional(),
  from: string2().optional(),
  refs: array(string2()).optional(),
  evidence: string2().optional()
}).passthrough();

// src/tasks/project/files.ts
var DEFAULT_TASKS_DIR = ".claude/tasks";
function projectTasksDir(checkoutRoot, settings) {
  const dir = settings.dir ?? DEFAULT_TASKS_DIR;
  const target = resolve4(checkoutRoot, dir);
  const rel = relative(checkoutRoot, target);
  if (isAbsolute(dir) || rel === ".." || rel.startsWith(`..${sep2}`))
    throw new Error("Task folder must be inside the checkout");
  return target;
}

// src/tasks/project/check.ts
var DEFAULT_STALE_DAYS = 30;
var DAY_MS = 86400000;

// src/tasks/context.ts
var DEFAULT_RELEASE_BRANCH = "main";
var RELEASE_BRANCH_GIT_TIMEOUT_MS = 5000;
function projectKey(repo) {
  return repoKey(repo);
}
function taskContext(cwd, env = process.env) {
  let checkout;
  try {
    checkout = locateCheckout(cwd, { env });
  } catch (error) {
    return { ok: false, why: checkoutFailure(error) };
  }
  return contextOf(checkout, cwd, env);
}
function keyOf(checkout, cwd) {
  return projectKey(checkout === null ? realpathSync4(cwd) : checkout.mainCheckout ?? checkout.root);
}
function folderProject(cwd, options = {}) {
  return keyOf(locateCheckout(cwd, options), cwd);
}
function contextOf(checkout, cwd, env) {
  if (checkout === null) {
    return {
      ok: true,
      project: keyOf(null, cwd),
      repo: null,
      checkoutRoot: null,
      projectTasks: { ok: false, why: "not in a git checkout: project tasks live in a repository" },
      projectConfig: { ok: true, config: null }
    };
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  const base = {
    ok: true,
    project: keyOf(checkout, cwd),
    repo,
    checkoutRoot: checkout.root
  };
  let config;
  try {
    config = loadProjectConfig(checkout).config;
  } catch (error) {
    const why = checkoutFailure(error);
    return { ...base, projectTasks: { ok: false, why }, projectConfig: { ok: false, why } };
  }
  const settings = config?.tasks;
  const root = checkout.root;
  return {
    ...base,
    projectConfig: { ok: true, config },
    projectTasks: {
      ok: true,
      dir: projectTasksDir(root, settings?.dir === undefined ? {} : { dir: settings.dir }),
      staleDays: settings?.staleDays ?? DEFAULT_STALE_DAYS,
      legacyFolders: settings?.legacyFolders ?? [],
      releaseBranch: () => {
        if (settings?.releaseBranch !== undefined)
          return settings.releaseBranch;
        const head = runGit(root, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env, RELEASE_BRANCH_GIT_TIMEOUT_MS);
        const name = head.ok ? head.out.replace(/^origin\//, "") : "";
        return name === "" ? DEFAULT_RELEASE_BRANCH : name;
      }
    }
  };
}

// src/user-away/words.ts
var UNAVAILABLE_SKILL = `/${PLUGIN}:user-unavailable`;
var AVAILABLE_SKILL = `/${PLUGIN}:user-available`;
function plural(count, one, many) {
  return `${String(count)} ${count === 1 ? one : many}`;
}
var TEXT_MAX = 4000;
var COMMAND_MAX = 16000;
var USER_USAGE = `Usage: ${COMMAND} user <command>

The person's availability. While they cannot answer, a session parks what needs them instead
of asking, and the hooks hold the line (${UNAVAILABLE_SKILL}).

Commands:
  unavailable [--until <time>]
                 The person cannot answer now. --until says when they are expected back
                 (8h, 90m, 07:30 or an ISO time): a note only, it never switches back.
  available      They can answer again. What was parked stays on the list for them.
  status [--json]
                 Whether they can answer, and how many items wait.
  park --kind <question|action|decision> "<text>" [--command "<command>"]
       [--option "<option>"]... [--recommend <n>]
                 Put one item on the list. An action names its exact command, a question its
                 options and the recommended one (counted from 1).
  list [--json]  The items, each with who answers it and its exact command. Judged for the
                 session that runs it: this session's, another session's, or no session's.
  clear <n>... | --all
                 Take answered items off the list.

Use ${AVAILABLE_SKILL} when the person is back: it goes through the list with them.`;

// src/user-away/whose.ts
var THIS = { whose: "this session", waitsIn: null };
var NOBODY = { whose: "no session", waitsIn: null };
var UNSEEN = { whose: "another session", waitsIn: null };
function ownerOf(item, facts) {
  const asker = facts.session;
  const isAsker = (id) => asker !== null && id === asker;
  if (isAsker(item.session))
    return THIS;
  if (item.session !== "") {
    if (facts.live === null)
      return UNSEEN;
    const running = facts.live.find((one) => one.sessionId === item.session);
    if (running !== undefined) {
      return { whose: "another session", waitsIn: { name: running.name, cwd: running.cwd } };
    }
  }
  const project = item.cwd === "" ? null : facts.projectOf(item.cwd);
  return project !== null && project === facts.project ? THIS : NOBODY;
}
function orNull(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
function projectOnDisk(cwd, asker) {
  let folder = cwd;
  while (!existsSync6(folder) && dirname7(folder) !== folder)
    folder = dirname7(folder);
  return folderProject(folder, {
    env: asker.env,
    ...asker.timeFor === undefined ? {} : { timeFor: asker.timeFor }
  });
}
function ownerFacts(asker, sources = {}) {
  const projects = new Map;
  const projectOf = (cwd) => {
    if (projects.has(cwd))
      return projects.get(cwd) ?? null;
    const key = orNull(() => sources.projectOf ? sources.projectOf(cwd) : projectOnDisk(cwd, asker));
    projects.set(cwd, key);
    return key;
  };
  return {
    session: asker.session,
    project: asker.cwd === "" ? null : projectOf(asker.cwd),
    live: orNull(() => (sources.sessions ?? (() => liveSessions(asker.paths.claudeConfigDir)))()),
    projectOf
  };
}
function ownedItems(items, asker, sources = {}) {
  if (items.length === 0)
    return [];
  const facts = ownerFacts(asker, sources);
  return items.map((item) => ({ ...item, ...ownerOf(item, facts) }));
}
function waitingLines(owned) {
  const mine = owned.filter((one) => one.whose === "this session").length;
  const ended = owned.filter((one) => one.whose === "no session").length;
  const elsewhere = new Map;
  for (const one of owned) {
    if (one.whose !== "another session")
      continue;
    const name = one.waitsIn === null ? "a session it cannot name" : plainText(one.waitsIn.name);
    elsewhere.set(name, (elsewhere.get(name) ?? 0) + 1);
  }
  const others = owned.length - mine - ended;
  const lines = [];
  if (mine > 0) {
    lines.push(`${plural(mine, "item waits", "items wait")} for this session: go through ${mine === 1 ? "it" : "them"} with ${AVAILABLE_SKILL}.`);
  }
  if (others > 0) {
    const where = [...elsewhere].map(([name, count]) => `${name} (${String(count)})`).join(", ");
    lines.push(`${plural(others, "item waits", "items wait")} in other sessions, which go through their own: ${where}.`);
  }
  if (ended > 0) {
    lines.push(`${plural(ended, "item was", "items were")} parked in another project by a session that ended: ${AVAILABLE_SKILL} asks whether to take ${ended === 1 ? "it" : "them"} here.`);
  }
  return lines;
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

// src/herdr/labels.ts
function parseLeadId(value) {
  const parts = value.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? { core: parts[0], address: parts[1] } : null;
}
var HERDR_AGENT_PREFIX = "herdr:";
function isHerdrAgent(value) {
  return value.startsWith(HERDR_AGENT_PREFIX) && parseLeadId(value.slice(HERDR_AGENT_PREFIX.length)) !== null;
}
var REPORT_TAG = "kit-report";
var CHILD_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
function validChildName(name) {
  return CHILD_NAME_PATTERN.test(name);
}

// src/hooks/transcript.ts
import { closeSync as closeSync3, fstatSync, openSync as openSync3, readSync } from "fs";
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
function toolUseNames(entry) {
  const content = isJsonObject(entry.message) ? entry.message.content : undefined;
  if (!Array.isArray(content))
    return [];
  return content.flatMap((block) => isJsonObject(block) && block.type === "tool_use" && typeof block.name === "string" ? [block.name] : []);
}
function stopFeedbackGiven(transcriptPath, text, resetBy) {
  const lines = tailLines(transcriptPath);
  return lines !== null && stopFeedbackIn(lines, text, resetBy);
}
function stopFeedbackIn(lines, text, resetBy) {
  let given = false;
  for (const line of lines) {
    if (!line.includes(STOP_FEEDBACK) && !line.includes('"tool_use"'))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isJsonObject(entry) || entry.isSidechain === true)
      continue;
    if (entry.type === "user" && stopFeedbackTexts(entry).some((said) => said.includes(text))) {
      given = true;
    } else if (given && toolUseNames(entry).some((name) => resetBy.includes(name))) {
      given = false;
    }
  }
  return given;
}
function tailLines(transcriptPath, bytes = TRANSCRIPT_TAIL_BYTES) {
  let text;
  try {
    const fd = openSync3(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync3(fd);
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
    if (isJsonObject(entry))
      yield entry;
  }
}
function lastClaudeModel(transcriptPath) {
  const lines = tailLines(transcriptPath);
  if (lines === null)
    return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.isSidechain === true)
      continue;
    if (entry.type !== "assistant" || !isJsonObject(entry.message))
      continue;
    const model = entry.message.model;
    if (typeof model === "string" && model.startsWith("claude-"))
      return model;
  }
  return null;
}
function lastAssistantText(transcriptPath) {
  const lines = tailLines(transcriptPath);
  if (lines === null)
    return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.type !== "assistant" || !isJsonObject(entry.message))
      continue;
    const content = entry.message.content;
    if (!Array.isArray(content))
      continue;
    return content.filter((block) => isJsonObject(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join(" ");
  }
  return null;
}
var BRIEF_HEAD_BYTES = 1024 * 1024;
function messageText(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return null;
  return content.filter((block) => isJsonObject(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join(`
`);
}
var PROMPT_SCAN_MAX_BYTES = 16 * 1024 * 1024;
var SYSTEM_REMINDER_OPEN = "<system-reminder>";
var SYSTEM_REMINDER_CLOSE = "</system-reminder>";
var HARMLESS_META_PREFIXES = [
  "<command-message>",
  "<command-name>",
  SYSTEM_REMINDER_OPEN,
  "Base directory for this skill:"
];
var STRUCTURED_OUTPUT_NUDGE = "[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.";
var USER_WORD = '"user"';
function mayHoldQueuedPrompt(line) {
  return line.includes('"attachment"') && (line.includes('"queued_command"') || line.includes('"origin"') || line.includes('"prompt"'));
}
function attachmentPrompt(entry) {
  if (entry.type !== "attachment" || !isJsonObject(entry.attachment))
    return null;
  const attachment = entry.attachment;
  const hasOrigin = attachment.origin !== undefined && attachment.origin !== null;
  if (attachment.type !== "queued_command" && !hasOrigin && typeof attachment.prompt !== "string")
    return null;
  return typeof attachment.prompt === "string" ? attachment.prompt : "";
}
function harmlessText(text) {
  if (typeof text !== "string")
    return false;
  if (text.trimEnd() === STRUCTURED_OUTPUT_NUDGE)
    return true;
  if (text.startsWith(SYSTEM_REMINDER_OPEN)) {
    const close = text.indexOf(SYSTEM_REMINDER_CLOSE);
    return close !== -1 && close + SYSTEM_REMINDER_CLOSE.length === text.trimEnd().length;
  }
  return HARMLESS_META_PREFIXES.some((prefix) => text.startsWith(prefix));
}
function harmlessMeta(entry, content) {
  if (entry.isMeta !== true || entry.origin !== undefined && entry.origin !== null)
    return false;
  if (typeof content === "string")
    return harmlessText(content);
  return Array.isArray(content) && content.length > 0 && content.every((block) => isJsonObject(block) && block.type === "text" && harmlessText(block.text));
}
function onlyToolResults(content) {
  return Array.isArray(content) && content.length > 0 && content.every((block) => isJsonObject(block) && block.type === "tool_result");
}
function scanPrompts(text, briefOnly) {
  let brief;
  const later = [];
  for (const line of text.split(`
`)) {
    if (!line.includes(USER_WORD) && (brief === undefined || !mayHoldQueuedPrompt(line)))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      if (brief !== undefined)
        later.push("");
      continue;
    }
    if (!isJsonObject(entry))
      continue;
    if (brief !== undefined) {
      const queued = attachmentPrompt(entry);
      if (queued !== null) {
        later.push(queued);
        continue;
      }
    }
    if (entry.type !== "user")
      continue;
    const message = isJsonObject(entry.message) ? entry.message : null;
    if (brief === undefined) {
      if (message === null)
        continue;
      brief = messageText(message.content);
      if (briefOnly)
        break;
      continue;
    }
    const content = message?.content;
    if (onlyToolResults(content) || harmlessMeta(entry, content))
      continue;
    later.push(messageText(content) ?? "");
  }
  return { brief: brief ?? null, later };
}
function firstPromptText(transcriptPath) {
  let text;
  try {
    const fd = openSync3(transcriptPath, "r");
    try {
      const buffer = Buffer.alloc(BRIEF_HEAD_BYTES);
      const read = readSync(fd, buffer, 0, BRIEF_HEAD_BYTES, 0);
      text = buffer.subarray(0, read).toString("utf8");
    } finally {
      closeSync3(fd);
    }
  } catch {
    return null;
  }
  return scanPrompts(text, true).brief;
}
function runPrompts(transcriptPath, maxBytes = PROMPT_SCAN_MAX_BYTES) {
  let text;
  try {
    const fd = openSync3(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      if (size > maxBytes)
        return null;
      const buffer = Buffer.alloc(size);
      const read = readSync(fd, buffer, 0, size, 0);
      text = buffer.subarray(0, read).toString("utf8");
    } finally {
      closeSync3(fd);
    }
  } catch {
    return null;
  }
  return scanPrompts(text, false);
}

// src/hooks/prompt-source.ts
var NOT_PERSON_PREFIXES = [
  "<cross-session-message",
  "<task-notification",
  "<agent-message",
  "<hc ",
  `<${REPORT_TAG}`,
  STOP_FEEDBACK
];
function hasNotPersonWrapper(prompt) {
  const text = prompt.trimStart();
  return NOT_PERSON_PREFIXES.some((prefix) => text.startsWith(prefix));
}

// src/hooks/user-away-stop.ts
function periodTag(state) {
  return `[away period ${periodKey(state)}]`;
}
function awayStopBlock(input, stateDir) {
  if (input.stop_hook_active === true)
    return null;
  const session = stringField(input.session_id);
  if (session === null)
    return null;
  const state = readAway(stateDir);
  if (!state.unavailable)
    return null;
  if (saidCovers(state, session))
    return null;
  const transcript = stringField(input.transcript_path);
  const lines = transcript === null ? null : tailLines(transcript);
  if (lines === null)
    return null;
  if (stopFeedbackIn(lines, periodTag(state), []))
    return null;
  return { session, state };
}

// src/hooks/user-away.ts
var PARK_WAIT_MS = BUDGET_MARGIN_MS / 2;
var AWAY_ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"];
var SHELL_TOOLS = ["Bash", "PowerShell"];
var STATE_COMMANDS = [
  ["user", "available"],
  ["user", "status"],
  ["user", "status", "--json"],
  ["user", "list"],
  ["user", "list", "--json"]
];
var REASON_MAX = 600;
function inAwayDomain(input) {
  const tool = stringField(input.tool_name);
  return tool !== null && AWAY_ASK_TOOLS.includes(tool);
}
function whenText(state, nowMs, options) {
  const clock = (iso) => {
    const at = Date.parse(iso);
    return Number.isNaN(at) ? iso : formatClock(at / 1000, nowMs, options.timeZone);
  };
  const from = state.since === null ? "" : ` since ${clock(state.since)}`;
  const back = state.until === null ? "" : `, back about ${clock(state.until)}`;
  return `${from}${back}`;
}
function stateLine(error) {
  return `cc-smart-dev-kit user-away: ${error.message}`;
}
function questionStep(when) {
  return `The person is unavailable${when}: do not wait for an answer. Park the question with \`${COMMAND} user park --kind question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\` and go on with whatever it does not block. A choice that is easy to undo, with a recommended option in the plan, you take yourself and park as \`--kind decision\`. The rules: ${UNAVAILABLE_SKILL}.`;
}
function planStep(when) {
  return `The person is unavailable${when}: the plan cannot be approved now. Park it with \`${COMMAND} user park --kind question "Approve the plan: <where it is, in one line>" --option "approve" --option "change it" --recommend 1\`, and go on with what needs no approval: reading, research, notes. The rules: ${UNAVAILABLE_SKILL}.`;
}
function questionToolStep(tool, when) {
  return tool === "ExitPlanMode" ? planStep(when) : questionStep(when);
}
function parkedStep(when, item) {
  return `The person is unavailable${when}, so this was not asked: it is parked as #${String(item.id)}, an action that waits for their yes. Do not run it another way; go on with work that does not need it. The rules: ${UNAVAILABLE_SKILL}.`;
}
function notParkedStep(when, why) {
  return `The person is unavailable${when}, so this was not asked, and it could not be parked (${why}): park it by hand with \`${COMMAND} user park --kind action "<what>" --command "<command>"\`, then go on with work that does not need it. The rules: ${UNAVAILABLE_SKILL}.`;
}
var TARGET_FIELDS = ["file_path", "notebook_path", "to", "url", "path", "pattern", "query"];
var DETAIL_MAX = 300;
function callLabel(input) {
  const tool = stringField(input.tool_name) ?? "a tool";
  if (SHELL_TOOLS.includes(tool))
    return tool;
  const args = toolInput(input);
  const field = TARGET_FIELDS.find((name) => stringField(args[name]) !== null);
  const target = field === undefined ? null : maskedLine(stringField(args[field]) ?? "", [], DETAIL_MAX);
  const rest = Object.fromEntries(Object.entries(args).filter(([name]) => name !== field));
  const detail = Object.keys(rest).length === 0 ? "" : ` ${maskedLine(JSON.stringify(rest), [], DETAIL_MAX)}`;
  return `${tool}${target === null ? "" : ` ${target}`}${detail}`;
}
function callCommand(input) {
  const tool = stringField(input.tool_name);
  if (tool === null || !SHELL_TOOLS.includes(tool))
    return null;
  return stringField(toolInput(input).command);
}
async function parkCall(input, paths, nowMs, words) {
  const full = callCommand(input);
  const cut = full !== null && full.length > COMMAND_MAX;
  const command = cut ? full.slice(0, COMMAND_MAX) : full;
  const text = `${words}${cut ? ` The command was cut at ${String(COMMAND_MAX)} characters.` : ""}`;
  try {
    const { item } = await parkItem(paths.stateDir, {
      command,
      cwd: stringField(input.cwd) ?? "",
      kind: "action",
      options: [],
      recommend: null,
      session: stringField(input.session_id) ?? "",
      text: text.slice(0, TEXT_MAX),
      tool: stringField(input.tool_name)
    }, nowMs, PARK_WAIT_MS);
    return { item, ok: true };
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}
function isStateCommand(input) {
  const command = callCommand(input);
  if (command === null)
    return false;
  const dialect = dialectOfTool(input.tool_name) ?? "bash";
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  if (steps.length === 0)
    return false;
  return steps.every((step) => {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined || invocation.computed || invocation.prefix.length > 0) {
      return false;
    }
    if (invocation.program !== COMMAND)
      return false;
    const operands = invocation.args;
    if (withoutRedirections(operands).length !== operands.length)
      return false;
    return STATE_COMMANDS.some((known) => known.length === operands.length && known.every((word, at) => word === operands[at]));
  });
}
function permissionDeny(message) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message }
      }
    })
  };
}
async function permissionAnswer(input, paths, nowMs, options) {
  const state = readAway(paths.stateDir);
  if (!state.unavailable)
    return SILENT;
  if (isStateCommand(input))
    return SILENT;
  const when = whenText(state, nowMs, options);
  const tool = stringField(input.tool_name) ?? "";
  if (AWAY_ASK_TOOLS.includes(tool)) {
    return permissionDeny(questionToolStep(tool, when));
  }
  const parked = await parkCall(input, paths, nowMs, `Claude Code's own permission prompt: ${callLabel(input)}`);
  if (parked.ok)
    return permissionDeny(parkedStep(when, parked.item));
  return {
    ...permissionDeny(notParkedStep(when, parked.why)),
    stderr: `cc-smart-dev-kit user-away: could not park: ${parked.why}`
  };
}
function isPersonsPrompt(input) {
  const prompt = stringField(input.prompt);
  return prompt !== null && !hasNotPersonWrapper(prompt);
}
function parkedText(count) {
  if (count === 0)
    return "Nothing is parked yet.";
  return `${plural(count, "item is", "items are")} parked.`;
}
function unavailableNote(when, count) {
  return `The person is unavailable${when}. Follow ${UNAVAILABLE_SKILL}: park what needs them, go on with the rest. ${parkedText(count)}`;
}
async function stopAnswer(input, paths, nowMs, options) {
  const block = awayStopBlock(input, paths.stateDir);
  if (block === null)
    return SILENT;
  const { session, state } = block;
  const reason = `${unavailableNote(whenText(state, nowMs, options), state.items.length)} Do not end the turn on a question for them: park it with \`${COMMAND} user park\` and go on with the work it does not block. If nothing is left to do, end the turn. ${periodTag(state)}`;
  const answer = { stdout: JSON.stringify({ decision: "block", reason }) };
  try {
    await stopSayOnce(paths.stateDir, session, saidKey(state));
    return answer;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      ...answer,
      stderr: `cc-smart-dev-kit user-away: could not record the stop note: ${why}`
    };
  }
}
async function noteAnswer(input, env, paths, nowMs, options) {
  const session = stringField(input.session_id);
  if (session === null)
    return SILENT;
  const state = readAway(paths.stateDir);
  const count = state.items.length;
  if (!state.unavailable) {
    if (!await forgetSaid(paths.stateDir, session))
      return SILENT;
    const { timeFor } = startBudget(env, Date.now, SHORT_GUARD_BUDGET_MS, nowMs);
    const asker = { session, cwd: stringField(input.cwd) ?? "", env, paths, timeFor };
    const left = count === 0 ? "Nothing is left parked." : waitingLines(ownedItems(state.items, asker, options.owners)).join(" ");
    return addContext("UserPromptSubmit", `The person is available again: ask your questions as usual. ${left}`);
  }
  const when = whenText(state, nowMs, options);
  const key = saidKey(state);
  const heardAtStop = state.stopSaid[session] === key && !saidCovers(state, session);
  const first = await sayOnce(paths.stateDir, session, key) && !heardAtStop;
  if (isPersonsPrompt(input)) {
    const waiting = count === 0 ? "Nothing is parked yet." : `${plural(count, "item waits", "items wait")} for ${AVAILABLE_SKILL}.`;
    return addContext("UserPromptSubmit", `The person wrote, and is still marked unavailable${when}: a message does not switch it back (it may come from a phone). Do what it asks, and keep following ${UNAVAILABLE_SKILL}. ${waiting}`);
  }
  if (!first)
    return SILENT;
  return addContext("UserPromptSubmit", unavailableNote(when, count));
}
async function userAwayAnswer(input, event, env, paths, nowMs, options = {}) {
  try {
    if (event === "PreToolUse") {
      const tool = stringField(input.tool_name);
      if (tool === null || !AWAY_ASK_TOOLS.includes(tool))
        return SILENT;
      const state = readAway(paths.stateDir);
      if (!state.unavailable)
        return SILENT;
      return toolDecision("deny", questionToolStep(tool, whenText(state, nowMs, options)));
    }
    if (event === "PermissionRequest")
      return await permissionAnswer(input, paths, nowMs, options);
    if (event === "UserPromptSubmit")
      return await noteAnswer(input, env, paths, nowMs, options);
    if (event === "Stop")
      return await stopAnswer(input, paths, nowMs, options);
    return SILENT;
  } catch (error) {
    if (error instanceof AwayStateError)
      return { stderr: stateLine(error) };
    throw error;
  }
}
async function askedWhileAway(input, result, _env, paths, nowMs, options = {}) {
  const reason = askReason(result);
  if (reason === null || input === null)
    return result;
  if (stringField(input.hook_event_name) !== "PreToolUse")
    return result;
  let state;
  try {
    state = readAway(paths.stateDir);
  } catch (error) {
    if (error instanceof AwayStateError)
      return { ...result, stderr: stateLine(error) };
    throw error;
  }
  if (!state.unavailable)
    return result;
  const when = whenText(state, nowMs, options);
  const parked = await parkCall(input, paths, nowMs, `${callLabel(input)}: ${maskedLine(reason, [], REASON_MAX)}`);
  const lead = reason === "" ? "" : `${reason}

`;
  if (parked.ok)
    return toolDecision("deny", `${lead}${parkedStep(when, parked.item)}`);
  return {
    ...toolDecision("deny", `${lead}${notParkedStep(when, parked.why)}`),
    stderr: `cc-smart-dev-kit user-away: could not park: ${parked.why}`
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
async function answer(spec, input, context) {
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
    let project;
    try {
      project = loadProjectConfig(checkout);
    } catch (error) {
      if (error instanceof CcSmartDevKitConfigError) {
        return await spec.onConfigProblem(error.message, input, event, checkout, context);
      }
      throw error;
    }
    return await spec.run({
      input,
      event,
      cwd,
      project,
      env,
      paths: context.paths,
      nowMs: context.nowMs,
      ...context.start !== undefined && { start: context.start }
    });
  } catch (error) {
    return crashResult(spec, errorMessage(error), input, event, context);
  }
}
async function whileAway(spec, input, result, context) {
  if (spec.name === "user-away" || askReason(result) === null)
    return result;
  try {
    return await askedWhileAway(input, result, context.env, context.paths, context.nowMs);
  } catch (error) {
    return {
      ...result,
      stderr: `cc-smart-dev-kit ${spec.name}: the person's availability could not be read (${errorMessage(error)})`
    };
  }
}
async function handleHook(spec, text, env, nowMs = Date.now(), start) {
  const context = {
    env,
    paths: cliPaths(env),
    nowMs,
    ...start !== undefined && { start }
  };
  const input = parseHookInput(text);
  const result = await answer(spec, input, context);
  return recordAsk(spec, input, await whileAway(spec, input, result, context), context);
}
function logRun(spec, text, result, env, nowMs) {
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
      stdout: (result.stdout ?? "").slice(0, 2000),
      ...Object.keys(facts).length === 0 ? {} : { facts }
    })}
`);
  } catch {}
}
async function runHookEntry(spec) {
  const text = await Bun.stdin.text();
  const nowMs = Date.now();
  const result = await handleHook(spec, text, process.env, nowMs);
  logRun(spec, text, result, process.env, nowMs);
  if (result.stdout !== undefined)
    await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined)
    await Bun.write(Bun.stderr, `${result.stderr}
`);
  process.exit(result.exitCode ?? 0);
}

// src/hooks/after-merge.ts
import { createHash as createHash3 } from "crypto";
import { existsSync as existsSync8, mkdirSync as mkdirSync8, writeFileSync as writeFileSync3 } from "fs";
import { tmpdir } from "os";
import { join as join17 } from "path";

// src/workflow/resolve.ts
import { existsSync as existsSync7, readFileSync as readFileSync12 } from "fs";

// src/setup/statusline.ts
import { join as join13 } from "path";
function statuslineSetting(paths) {
  return { command: `${shellWord(join13(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
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
  if (!existsSync7(file))
    return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync12(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = personalWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowConfigError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}
function personalWorkflowOrDefault(paths) {
  try {
    return loadWorkflow(personalWorkflowFile(paths));
  } catch {
    return {};
  }
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
  const issues = mergedGroup(personal.issues, project.issues);
  if (issues !== undefined)
    merged.issues = issues;
  const plans = mergedGroup(personal.plans, project.plans);
  if (plans !== undefined)
    merged.plans = plans;
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
    usagePercent: of("alerts.usagePercent", alerts.usagePercent ?? workflowDefaults.alerts.usagePercent)
  };
}
function plansFrom(personal, project) {
  const plans = mergeWorkflows(personal, project).plans ?? {};
  return {
    maxPhases: {
      value: plans.maxPhases ?? workflowDefaults.plans.maxPhases,
      source: sourceOf(personal, project, "plans.maxPhases")
    }
  };
}
function statusLineIsOurs(paths) {
  try {
    const parsed = JSON.parse(readFileSync12(paths.settingsFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return false;
    const statusLine = parsed.statusLine;
    return Bun.deepEquals(statusLine, statuslineSetting(paths), true);
  } catch {
    return false;
  }
}
function current2(value, source) {
  return { value, source };
}
function projectFlag(value) {
  return value === undefined ? current2(false, "default") : current2(value, "project");
}
function jobRouteFrom(personal, projectConfig) {
  const project = projectConfig?.jobs?.route;
  if (project !== undefined)
    return current2(project, "project");
  const own = personal.switches?.jobRoute;
  return own === undefined ? current2(false, "default") : current2(own, "personal");
}
function resolveJobRoute(paths, projectConfig) {
  return jobRouteFrom(personalWorkflowOrDefault(paths), projectConfig);
}
var LEAD_HINT_DEFAULT = true;
function leadHintFrom(personal) {
  const own = personal.switches?.leadHint;
  return own === undefined ? current2(LEAD_HINT_DEFAULT, "default") : current2(own, "personal");
}
function resolveLeadHint(paths) {
  return leadHintFrom(personalWorkflowOrDefault(paths));
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
  return gateOfCommitted(paths, branch, committed);
}
async function resolveGateAsync(paths, checkout, branch, options = {}) {
  if (branch === null) {
    return { ok: true, gate: { branch, config: null, resolved: resolveWorkflow(paths, null) } };
  }
  let committed;
  try {
    committed = await readCommittedConfigAsync(checkout, branch, options);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  return gateOfCommitted(paths, branch, committed);
}
function gateOfCommitted(paths, branch, committed) {
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
  const issues = merged.issues ?? {};
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
    issues: {
      enabled: of("issues.enabled", issues.enabled ?? workflowDefaults.issues.enabled),
      allowPublic: of("issues.allowPublic", issues.allowPublic ?? workflowDefaults.issues.allowPublic),
      foundLabel: of("issues.foundLabel", issues.foundLabel ?? workflowDefaults.issues.foundLabel),
      fixedLabel: of("issues.fixedLabel", issues.fixedLabel ?? workflowDefaults.issues.fixedLabel),
      readyLabel: of("issues.readyLabel", issues.readyLabel ?? workflowDefaults.issues.readyLabel)
    },
    alerts: alertsFrom(personal, project),
    plans: plansFrom(personal, project),
    switches: {
      statusLine: statusLineIsOurs(paths) ? current2(true, "personal") : current2(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: jobRouteFrom(personal, projectConfig),
      updateHold: isHeld(updateFiles(paths.stateDir)) ? current2(true, "personal") : current2(false, "default"),
      leadHint: leadHintFrom(personal)
    }
  };
}

// src/worktrees/auto-start.ts
import { basename as basename5, join as join16 } from "path";

// src/hooks/attended.ts
function isAttended(env) {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
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

// src/setup/bun-config.ts
import { basename as basename4, join as join14 } from "path";
var BUN_CONFIG_NAME = "bunfig.toml";
function bunConfigPath(pluginDir) {
  return join14(pluginDir, BUN_CONFIG_NAME);
}
function bunConfigArg(pluginDir) {
  return `--config=${bunConfigPath(pluginDir)}`;
}
function pluginFolderBeside(importDir) {
  return basename4(importDir) === "dist" ? join14(importDir, "..") : join14(importDir, "..", "..", "plugin");
}

// src/worktrees/auto-state.ts
import { createHash as createHash2 } from "crypto";
import { mkdirSync as mkdirSync7, readFileSync as readFileSync13 } from "fs";
import { dirname as dirname8, join as join15 } from "path";
var AUTO_CLEAN_INTERVAL_MS = 60 * 60 * 1000;
var TOLD_NAMES_MAX = 8;
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
  return join15(stateDir, "worktrees-auto-clean.log");
}
function autoCleanFiles(stateDir, repo) {
  const key = createHash2("sha256").update(pathForm(repo)).digest("hex").slice(0, 16);
  const dir = join15(stateDir, "worktrees-auto-clean");
  return {
    log: autoCleanLog(stateDir),
    result: join15(dir, `${key}.json`),
    told: join15(dir, `${key}.told.json`)
  };
}
function readJson(file, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync13(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeJson(file, value) {
  mkdirSync7(dirname8(file), { recursive: true, mode: 448 });
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
function markTold(files, seq) {
  if (readTold(files) >= seq)
    return;
  writeJson(files.told, { seq });
}
function untold(record, told) {
  return record !== null && record.seq > told && record.removed.length > 0 ? record : null;
}
function toldLine(record) {
  const count = record.removed.length;
  const shown = record.removed.slice(0, TOLD_NAMES_MAX).map((one) => one.name);
  const names = count > TOLD_NAMES_MAX ? `${shown.join(", ")} and ${String(count - TOLD_NAMES_MAX)} more` : shown.join(", ");
  const noun = count === 1 ? "1 finished worktree" : `${String(count)} finished worktrees`;
  return `${COMMAND} removed ${noun}: ${names} (work on ${record.base})`;
}

// src/worktrees/auto-start.ts
var AUTO_CLEAN_BUNDLE = "worktrees-clean";
function autoCleanOn(context) {
  return context.project.config?.worktrees?.autoClean !== false;
}
function autoCleanEntry(importDir) {
  return basename5(importDir) === "dist" ? join16(importDir, `${AUTO_CLEAN_BUNDLE}.js`) : join16(importDir, "..", "entries", `${AUTO_CLEAN_BUNDLE}.ts`);
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
function takeToldLine(context, repo) {
  if (!isAttended(context.env))
    return null;
  const files = autoCleanFiles(context.paths.stateDir, repo);
  const record = untold(readRepoRecord(files), readTold(files));
  if (record === null)
    return null;
  try {
    markTold(files, record.seq);
  } catch (error) {
    console.error(`${COMMAND} worktrees clean: could not mark the removals as told: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return toldLine(record);
}

// src/hooks/git-guard.ts
import { isAbsolute as isAbsolute2, resolve as resolve5 } from "path";
var DEFAULT_PROTECTED_BRANCHES = ["main"];
var PUSH_VALUE_OPTIONS = [
  ["--exec", 4],
  ["--push-option", 4],
  ["--receive-pack", 5],
  ["--repo", 6]
];
function longOption2(arg, full, min) {
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
  if (isAbsolute2(path))
    return resolve5(path);
  return folder === null ? null : resolve5(folder, path);
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
function pushQuestions(args, place, protectedBranches, autoPushAsk) {
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
      if (longOption2(arg, "--force", 6) || longOption2(arg, "--force-if-includes", 9) || longOption2(arg, "--force-with-lease", 9)) {
        force = true;
      }
      if (longOption2(arg, "--all", 4) || longOption2(arg, "--mirror", 6))
        everyBranch = true;
      if (longOption2(arg, "--dry-run", 4))
        dryRun = true;
      if (longOption2(arg, "--tags", 4))
        tagsOnly = true;
      if (longOption2(arg, "--delete", 5))
        deleting = true;
      if (longOption2(arg, "--repo", 6)) {
        repoGiven = true;
        repo = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[i + 1] ?? null;
      }
      if (!arg.includes("=") && PUSH_VALUE_OPTIONS.some(([full, min]) => longOption2(arg, full, min)))
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
  const autoPush = autoPushAsk();
  if (autoPush !== null)
    found.push(autoPush);
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
function discardAsk(sub) {
  return `\`git ${sub}\` here overwrites files in this folder with another version, and any ` + "uncommitted change in them is lost for good. Approve only if you want them gone; a " + "WIP commit keeps the work first. Switching branch, and `git restore --staged`, do not ask.";
}
var WORKTREE_REMOVE_ASK = "`git worktree remove --force` deletes a worktree even when it holds uncommitted or " + "untracked work, and git cannot bring that back. Look in it first.";
var BRANCH_DELETE_ASK = "`git branch -D` deletes a branch even if it was never merged: its commits are then " + "only in the reflog. `git branch -d` deletes a merged branch, and does not ask.";
var RESET_HARD_ASK = "`git reset --hard` throws away every uncommitted change in this folder, for good. " + "Approve only if you want them gone; a WIP commit keeps the work first.";
var RESET_MERGE_ASK = "`git reset --merge` throws away changes that are staged but not committed: a staged " + "change to a tracked file goes back to the target version, and a staged new file is " + "deleted from the folder (measured). Your working files are kept: it refuses rather than " + "overwrite one whose working copy differs from the target, including a file with both " + "staged and unstaged changes (measured on git 2.53). Approve only if you want the " + "staged work gone; a WIP commit keeps it first.";
var CLEAN_FORCE_ASK = "`git clean -f` deletes untracked files for good: git cannot bring them back. " + "`git clean -n` shows what it would delete, without deleting.";
var STASH_CLEAR_ASK = "`git stash clear` throws away every stash for good: git cannot bring them back. " + "`git stash list` shows what they hold, `git stash show -p` one of them.";
var STASH_DROP_ASK = "`git stash drop` with no stash named drops the newest one, whoever made it. " + "`git stash list` shows them; `git stash drop stash@{n}` drops the one you mean.";
var STASH_SHARED_ASK = "The git stash is shared by every worktree of this repo, so a bare `git stash` or " + "`git stash pop` can take or restore another session's work. A WIP commit is safer; " + "or `git stash push -u -m <tag>`, then `git stash apply <its sha>`.";
function stashAsk(args, sharedStash) {
  const sub = args[0];
  const named = args.slice(1).some((arg) => !arg.startsWith("-"));
  if (sub === "clear")
    return STASH_CLEAR_ASK;
  if (sub === "drop" && !named)
    return STASH_DROP_ASK;
  if (!sharedStash)
    return null;
  const tagged = args.some((arg) => longOption2(arg, "--message", 6) || isShort(arg) && shortFlags(arg, "m").flags.includes("m"));
  const untaggedPush = (sub === undefined || sub.startsWith("-") || sub === "push") && !tagged;
  const saveWithoutMessage = sub === "save" && !named;
  if (sub !== "pop" && !untaggedPush && !saveWithoutMessage)
    return null;
  return STASH_SHARED_ASK;
}
function discardsChanges(sub, rest) {
  if (sub === "switch") {
    return rest.some((arg) => longOption2(arg, "--force", 6) || longOption2(arg, "--discard-changes", 8) || isShort(arg) && shortFlags(arg, "cC").flags.includes("f"));
  }
  if (sub === "checkout") {
    const dashes = rest.indexOf("--");
    const pathsGiven = dashes !== -1 && dashes < rest.length - 1;
    const force = rest.some((arg) => longOption2(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "bB").flags.includes("f"));
    return pathsGiven || force || rest.slice(0, dashes === -1 ? undefined : dashes).includes(".");
  }
  const staged = rest.some((arg) => longOption2(arg, "--staged", 6) || isShort(arg) && shortFlags(arg, "s").flags.includes("S"));
  const worktree = rest.some((arg) => longOption2(arg, "--worktree", 6) || isShort(arg) && shortFlags(arg, "s").flags.includes("W"));
  return !staged || worktree;
}
function forceDeletesBranch(rest) {
  const has = (long, min, short) => rest.some((arg) => long !== undefined && longOption2(arg, long, min) || isShort(arg) && shortFlags(arg, "").flags.includes(short));
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
var COMPUTED_PUSH_ASK = "This command runs a program it works out when it runs, and its words name a push, so this guard cannot tell whether it pushes. Write the command out in full (for example `git push \u2026`) if you meant it.";
function namesPush(words) {
  return words.some((word) => word === "push" || word === "send-pack");
}
function computedPushIn(command, dialect) {
  return readingsOf(command, dialect).some((reading) => shellSteps(command, {
    blindWhenOpen: true,
    dialect: reading.dialect,
    joinLines: reading.joinLines
  }).some((step) => {
    const words = wordsOf(step.text, reading.dialect);
    const invocation = invocationOf(words);
    return invocation?.computed === true && namesPush(words);
  }));
}
function gitQuestions(args, folder, run) {
  return gitCalls(args).flatMap((call) => callQuestions(call, folder, run));
}
function pushAlias(call) {
  const value = call.config.get(`alias.${call.sub.toLowerCase()}`);
  if (value === null || value === undefined)
    return null;
  const words = wordsOf(value);
  const first = words[0] ?? "";
  return first === "push" || first === "send-pack" ? words.slice(1) : null;
}
function callQuestions(call, folder, run) {
  const { options } = run;
  const { rest, sub } = call;
  const alias = pushAlias(call);
  if (sub === "push" || sub === "send-pack" || alias !== null) {
    const where = folder === null ? null : resolve5(folder, ...call.dirs);
    const place = {
      branch: () => where === null ? undefined : currentBranch(where, run),
      bare: (remote) => {
        const branch = where === null ? undefined : currentBranch(where, run);
        if (where === null || branch === undefined)
          return [];
        return bareRefspecs(remote, branch, pushConfig(where, run), call.config);
      }
    };
    return pushQuestions(alias === null ? rest : [...alias, ...rest], place, options.protectedBranches, options.autoPushAsk);
  }
  if (sub === "stash") {
    const ask = stashAsk(rest, options.sharedStash);
    return ask === null ? [] : [ask];
  }
  if (sub === "worktree" && rest[0] === "remove") {
    const force = rest.slice(1).some((arg) => longOption2(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "").flags.includes("f"));
    if (force)
      return [WORKTREE_REMOVE_ASK];
  }
  if ((sub === "checkout" || sub === "restore" || sub === "switch") && discardsChanges(sub, rest)) {
    return [discardAsk(sub)];
  }
  if (sub === "branch" && forceDeletesBranch(rest))
    return [BRANCH_DELETE_ASK];
  if (sub === "reset" && rest.some((arg) => longOption2(arg, "--hard", 4))) {
    return [RESET_HARD_ASK];
  }
  if (sub === "reset" && rest.some((arg) => longOption2(arg, "--merge", 4))) {
    return [RESET_MERGE_ASK];
  }
  if (sub === "clean") {
    const force = rest.some((arg) => longOption2(arg, "--force", 6) || isShort(arg) && shortFlags(arg, "e").flags.includes("f"));
    const dryRun = rest.some((arg) => longOption2(arg, "--dry-run", 4) || isShort(arg) && shortFlags(arg, "e").flags.includes("n"));
    if (force && !dryRun)
      return [CLEAN_FORCE_ASK];
  }
  return [];
}
function inspect(command, cwd, reading, run, depth = 0) {
  const found = [];
  let folder = cwd;
  const { dialect, joinLines } = reading;
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    const invocation = invocationOf(words);
    if (invocation === undefined)
      continue;
    const { args, program } = invocation;
    const operands = withoutRedirections(args);
    if (program === "git")
      found.push(...gitQuestions(operands, folder, run));
    if (invocation.computed && namesPush(words))
      found.push(COMPUTED_PUSH_ASK);
    if (CHANGE_DIR.has(program))
      folder = movedTo(program, folder, operands);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const nested of readingsOf(inner, nestedDialect(program))) {
        found.push(...inspect(inner, folder, nested, run, depth + 1));
      }
    }
  }
  return found;
}
function guardQuestions(command, cwd, options) {
  const run = { options, branches: new Map, pushConfigs: new Map };
  const found = readingsOf(command, options.dialect).flatMap((reading) => inspect(command, cwd, reading, run));
  return [...new Set(found)];
}
function runsGit(command, dialect) {
  return programsOf(command, dialect).includes("git") || computedPushIn(command, dialect);
}

// src/hooks/after-merge.ts
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
var GH_POINTING_TEXT = /GH_(?:REPO|HOST)/;
var GH_POINTING = /^GH_(?:REPO|HOST)=/;
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
  if (before.some((word) => GH_POINTING.test(word))) {
    return "{the} sets `GH_REPO`/`GH_HOST` itself, so which repository it {acts} is not certain";
  }
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
var COMPUTED_MERGE = "This command runs a program it works out when it runs, and its words name a merge, so this guard cannot tell whether it merges a pull request. Write the command out in full if you meant it.";
function computedInvocationRisk(command, dialect, names) {
  return readingsOf(command, dialect).some((reading) => shellSteps(command, {
    blindWhenOpen: true,
    dialect: reading.dialect,
    joinLines: reading.joinLines
  }).some((step) => {
    const words = wordsOf(step.text, reading.dialect);
    const invocation = invocationOf(words);
    return invocation?.computed === true && names(words);
  }));
}
function computedMergeRisk(command, dialect) {
  return computedInvocationRisk(command, dialect, (words) => words.some((word) => /merge/i.test(word)));
}
function namesPullRequestChange(words) {
  const lower = words.map((word) => word.toLowerCase());
  if (lower.some((word) => /merge/i.test(word)))
    return true;
  return lower.includes("pr") && lower.some((word) => PR_OPENERS.has(word));
}
function computedPullRequestRisk(command, dialect) {
  return computedInvocationRisk(command, dialect, namesPullRequestChange);
}
function requestsPullRequestChange(command, dialect) {
  return pullRequestCalls(command, null, dialect).some((one) => !one.disarms) || computedPullRequestRisk(command, dialect);
}
function exactMergeOf(command, dialect) {
  const readings = readingsOf(command, dialect);
  if (readings.length !== 1)
    return null;
  const reading = readings[0];
  if (reading === undefined)
    return null;
  const steps = shellSteps(command, { dialect: reading.dialect, joinLines: reading.joinLines });
  const step = steps[0];
  if (steps.length !== 1 || step === undefined || step.pipedFrom !== null)
    return null;
  const words = wordsOf(step.text, reading.dialect);
  if (redirectionTargets(words).length > 0)
    return null;
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.program !== "gh")
    return null;
  if (invocation.prefix.length > 0)
    return null;
  const calls = pullRequestCalls(step.text, null, reading.dialect);
  const one = calls[0];
  if (calls.length !== 1 || one === undefined || !isMerge(one))
    return null;
  if (one.refusal !== null || one.unread !== null || one.unknown !== null)
    return null;
  if (one.unknownFlag !== null || one.admin || one.disarms || one.arms)
    return null;
  const ref = one.target?.ref ?? null;
  return ref !== null && /^\d+$/.test(ref) ? one : null;
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
function clearsAfterMerge(context) {
  try {
    return resolveWorkflow(context.paths, context.project.config).clearWorktreeAfterMerge.value;
  } catch (error) {
    if (error instanceof WorkflowConfigError)
      return false;
    throw error;
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
  const key = createHash3("sha256").update(repo).digest("hex").slice(0, 16);
  return join17(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-merges", `${key}-${number}`);
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
    seen: record !== null && existsSync8(record),
    target,
    worktree
  });
  if (outcome.intoBase !== null && record !== null) {
    mkdirSync8(join17(record, ".."), { recursive: true });
    writeFileSync3(record, "");
    startAutoClean(context, repo, "merge");
  }
  if (outcome.clear === null)
    return SILENT;
  return addContext(event, clearWorktreeNote(outcome.clear.path, outcome.clear.branch, clearsAfterMerge(context)));
}

// src/gateway/config.ts
import { mkdirSync as mkdirSync9, readFileSync as readFileSync14, statSync as statSync8 } from "fs";

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
var PROFILE_PATH_PREFIX = "/p/";
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
var CLAUDE_FAMILIES = ["opus", "sonnet", "haiku", "fable"];
function familyLabel(family) {
  return family.charAt(0).toUpperCase() + family.slice(1);
}
function familyEnv(family) {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
}
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
function familySlotKey(family) {
  return Object.keys(FAMILY_SLOTS).find((key) => FAMILY_SLOTS[key] === family) ?? null;
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
function profileView(config, name) {
  if (!isProfileName(name))
    return null;
  const profile = config.profiles !== undefined && Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  if (profile === undefined)
    return null;
  const slots = { ...config.slots };
  for (const slot of Object.keys(profile.slots ?? {})) {
    const chain = profileSlotChain(config, profile, slot);
    if (chain === null)
      delete slots[slot];
    else
      slots[slot] = chain;
  }
  const view = { ...config, slots };
  const fallback = { ...config.fallback, ...profile.fallback };
  if (Object.keys(fallback).length === 0)
    delete view.fallback;
  else
    view.fallback = fallback;
  const breaker = { ...config.breaker, ...profile.breaker };
  if (Object.keys(breaker).length === 0)
    delete view.breaker;
  else
    view.breaker = breaker;
  return view;
}
function plainClaudeView(config) {
  const view = { ...config, aliases: {}, slots: {} };
  delete view.breaker;
  delete view.fallback;
  return view;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

class ConfigError extends Error {
  name = "ConfigError";
}
function parseConfig(raw) {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success)
    return { error: prettifyError(result.error) };
  const config = result.data;
  if (config.effort !== undefined) {
    const effort = Object.fromEntries(Object.entries(config.effort).flatMap(([slot, pins]) => {
      const chain = Object.hasOwn(config.slots, slot) ? config.slots[slot] : undefined;
      const active = Object.fromEntries(Object.entries(pins).filter(([target]) => chain?.includes(target)));
      return Object.keys(active).length === 0 ? [] : [[slot, active]];
    }));
    if (Object.keys(effort).length === 0)
      delete config.effort;
    else
      config.effort = effort;
  }
  for (const saved of Object.values(config.kept ?? {})) {
    if (saved.effort === undefined)
      continue;
    const pins = Object.fromEntries(Object.entries(saved.effort).filter(([target]) => saved.targets.includes(target)));
    if (Object.keys(pins).length === 0)
      delete saved.effort;
    else
      saved.effort = pins;
  }
  return { config };
}
function loadConfigFile(path, platform = hostPlatform()) {
  let mode;
  try {
    mode = statSync8(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if (!isOwnerOnly(mode, platform)) {
    throw new ConfigError(`${path} can be read by other users (mode ${(mode & 511).toString(8)}); it holds API keys. Run: chmod 600 ${path}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync14(path, "utf8"));
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
import { existsSync as existsSync10, readFileSync as readFileSync16 } from "fs";

// src/setup/managed-json.ts
import { existsSync as existsSync9, readFileSync as readFileSync15 } from "fs";
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectIndent(text) {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
function readJsonObject(file) {
  if (!existsSync9(file))
    return { data: {}, indent: "  ", text: null };
  const text = readFileSync15(file, "utf8");
  if (text.trim() === "")
    return { data: {}, indent: "  ", text };
  let parsed;
  try {
    parsed = parseUserJson(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject2(parsed))
    throw new Error(`${file} must hold a JSON object.`);
  return { data: parsed, indent: detectIndent(text), text };
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
function normalizedBaseUrl(url) {
  return url.replace(/\/+$/, "");
}
function baseUrlPointsAtGateway(url) {
  return url !== null && normalizedBaseUrl(url) !== DEFAULT_ANTHROPIC_BASE_URL;
}
var RETIRED_GATEWAY_ENV_KEYS = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"
];
var RETIRED_MODEL_PIN_KEYS = [familyEnv("fable")];
var GATEWAY_ENV_KEYS = Object.keys(gatewayEnv(20100));
var GATEWAY_ENV_KEYS_ALL = [
  ...GATEWAY_ENV_KEYS,
  ...RETIRED_GATEWAY_ENV_KEYS,
  ...RETIRED_MODEL_PIN_KEYS
];
var SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];
var LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSettings(path) {
  if (!existsSync10(path))
    return {};
  const text = readFileSync16(path, "utf8");
  if (text.trim() === "")
    return {};
  let parsed;
  try {
    parsed = parseUserJson(text);
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it by hand, then run again.`);
  }
  if (!isJsonObject2(parsed))
    throw new Error(`${path} is not a JSON object; not touching it`);
  const env = parsed.env;
  if (env !== undefined && !isJsonObject2(env))
    throw new Error(`${path} has an "env" that is not an object`);
  return parsed;
}
function readGatewaySettings(settingsPath) {
  const settings = readSettings(settingsPath);
  const env = isJsonObject2(settings.env) ? settings.env : {};
  const held = env.ANTHROPIC_BASE_URL;
  const usable = typeof held === "string" && held.trim() !== "";
  const baseUrlProblem = Object.hasOwn(env, "ANTHROPIC_BASE_URL") && !usable ? `${settingsPath}: env.ANTHROPIC_BASE_URL is not a text with an address in it` : null;
  const loginOverrides = LOGIN_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  if (Object.hasOwn(settings, "apiKeyHelper"))
    loginOverrides.push("apiKeyHelper");
  const subagentOverrides = SUBAGENT_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  const modelKeys = [];
  if (typeof settings.model === "string") {
    modelKeys.push({ key: "model", value: settings.model });
  }
  for (const family of CLAUDE_FAMILIES) {
    const key = familyEnv(family);
    const value = env[key];
    if (typeof value === "string")
      modelKeys.push({ key: `env.${key}`, value });
  }
  return {
    baseUrl: usable ? held : null,
    baseUrlProblem,
    loginOverrides,
    modelKeys,
    subagentOverrides
  };
}

// src/gateway/project-state.ts
var PERSONAL_FILE = "settings.local.json";
var PERSONAL_EXCLUDE_LINE = `/.claude/${PERSONAL_FILE}`;
function profileUrlOf(routerUrl, name) {
  return `${routerUrl}${PROFILE_PATH_PREFIX}${name}`;
}
function urlMeaning(url, routerUrl) {
  if (url === null)
    return { profile: null, state: "default" };
  if (!baseUrlPointsAtGateway(url))
    return { profile: null, state: "off" };
  const clean = normalizedBaseUrl(url);
  if (clean === routerUrl)
    return { profile: null, state: "on" };
  const prefix = profileUrlOf(routerUrl, "");
  if (clean.startsWith(prefix)) {
    const name = clean.slice(prefix.length);
    if (isProfileName(name))
      return { profile: name, state: "on" };
  }
  return { profile: null, state: "other" };
}

// src/models/agent-definition.ts
import {
  closeSync as closeSync4,
  existsSync as existsSync12,
  openSync as openSync4,
  readdirSync as readdirSync4,
  readFileSync as readFileSync18,
  readSync as readSync2,
  realpathSync as realpathSync5,
  statSync as statSync9
} from "fs";
import { dirname as dirname9, isAbsolute as isAbsolute3, join as join18, relative as relative2, resolve as resolve6, sep as sep3 } from "path";

// src/setup/installed-plugins.ts
import { existsSync as existsSync11, readFileSync as readFileSync17 } from "fs";
function pluginsRecord(installedPluginsFile) {
  if (!existsSync11(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync17(installedPluginsFile, "utf8"));
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

// src/models/agent-definition.ts
var AGENT_SCAN_MAX_DEPTH = 8;
var AGENT_SCAN_MAX_ENTRIES = 2000;

class ScanTooLarge extends Error {
}
var BUILT_INS = {
  "claude-code-guide": "haiku",
  "statusline-setup": "sonnet",
  "web-fetch": null,
  Explore: null,
  Plan: null,
  "general-purpose": null
};
function files(path, budget, depth = 0, visited = new Set) {
  const found = readable(() => ({ real: realpathSync5(path), stat: statSync9(path) }));
  if (found === null || visited.has(found.real))
    return [];
  visited.add(found.real);
  budget.entries += 1;
  if (budget.entries > AGENT_SCAN_MAX_ENTRIES)
    throw new ScanTooLarge;
  if (found.stat.isFile())
    return path.endsWith(".md") ? [path] : [];
  if (!found.stat.isDirectory())
    return [];
  if (depth > AGENT_SCAN_MAX_DEPTH)
    throw new ScanTooLarge;
  const entries = readable(() => readdirSync4(path).sort()) ?? [];
  return entries.flatMap((entry) => files(join18(path, entry), budget, depth + 1, visited));
}
function readable(read) {
  try {
    return read();
  } catch {
    return null;
  }
}
function frontmatter(file) {
  const fd = openSync4(file, "r");
  try {
    const byte = Buffer.alloc(1);
    const lines = [];
    let line = "";
    let opened = false;
    while (readSync2(fd, byte, 0, 1, null) !== 0) {
      if (byte[0] !== 10) {
        line += byte.toString("latin1");
        continue;
      }
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!opened) {
        if (normalized !== "---")
          return null;
        opened = true;
      } else if (normalized === "---") {
        return Buffer.from(lines.join(`
`), "latin1").toString("utf8");
      } else {
        lines.push(normalized);
      }
      line = "";
    }
    return opened && line === "---" ? Buffer.from(lines.join(`
`), "latin1").toString("utf8") : null;
  } finally {
    closeSync4(fd);
  }
}
function claiming(paths, name, local = true) {
  for (const file of paths) {
    try {
      const header = frontmatter(file);
      if (header === null)
        continue;
      const raw = Bun.YAML.parse(header);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        continue;
      const fields = raw;
      if (fields.name !== name)
        continue;
      if (local && (typeof fields.description !== "string" || name.startsWith("-") || name.includes(":") || name.length > 256))
        continue;
      const model = stringField(fields.model)?.trim() || null;
      return {
        model: model?.toLowerCase() === "inherit" ? null : model,
        effort: stringField(fields.effort)?.trim().toLowerCase() || null
      };
    } catch {}
  }
  return null;
}
function inside(checkout, project) {
  const path = relative2(resolve6(project), resolve6(checkout));
  return path === "" || path !== ".." && !path.startsWith(`..${sep3}`) && !isAbsolute3(path);
}
function topFiles(folder, budget) {
  const entries = readable(() => readdirSync4(folder).sort()) ?? [];
  return entries.flatMap((entry) => {
    budget.entries += 1;
    if (budget.entries > AGENT_SCAN_MAX_ENTRIES)
      throw new ScanTooLarge;
    const file = join18(folder, entry);
    return file.endsWith(".md") && readable(() => statSync9(file).isFile()) === true ? [file] : [];
  });
}
function pluginFiles(root, budget) {
  const defaults = topFiles(join18(root, "agents"), budget);
  let listed;
  try {
    listed = JSON.parse(readFileSync18(join18(root, ".claude-plugin", "plugin.json"), "utf8"))?.agents;
  } catch {
    return defaults;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : [];
  if (listed === undefined)
    return defaults;
  return paths.flatMap((path) => {
    if (typeof path !== "string" || !path.startsWith("./"))
      return [];
    const file = resolve6(root, path);
    if (!inside(file, root))
      return [];
    try {
      return statSync9(file).isFile() && file.endsWith(".md") ? [file] : [];
    } catch {
      return [];
    }
  });
}
function projectFolders(checkout, cwd) {
  const root = realpathSync5(checkout);
  const start = realpathSync5(cwd ?? checkout);
  const folders = [];
  let at = isInsideOnDisk(start, root) ? start : root;
  for (;; ) {
    folders.push(join18(at, ".claude", "agents"));
    const up = dirname9(at);
    if (sameFolderOnDisk(at, root) || up === at)
      return folders;
    at = up;
  }
}
function agentDefinition(name, place) {
  try {
    return lookup(name, place, { entries: 0 });
  } catch (error) {
    if (error instanceof ScanTooLarge)
      return null;
    throw error;
  }
}
function lookup(name, place, budget) {
  if (name === null)
    return null;
  const colon = name.indexOf(":");
  if (colon === -1) {
    const folders = [
      place.paths.managedAgentsDir,
      ...place.checkout === null ? [] : projectFolders(place.checkout, place.cwd),
      join18(place.paths.claudeConfigDir, "agents")
    ];
    for (const folder of folders) {
      const found = claiming(files(folder, budget), name);
      if (found !== null)
        return found;
    }
  }
  if (colon !== -1) {
    const installs = installsOfPlugin(place.paths.installedPluginsFile, name.slice(0, colon));
    const given = place.cwd ?? place.checkout;
    const real = given == null ? null : readable(() => realpathSync5(given));
    const cwds = [given, real].filter((one) => one != null);
    const project = installs.filter((one) => one.scope !== "user" && one.projectPath !== null && cwds.some((cwd) => isInsideOnDisk(cwd, one.projectPath ?? ""))).sort((a, b) => (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0));
    const root = [...project, ...installs.filter((one) => one.scope === "user")].find((one) => existsSync12(one.installPath))?.installPath;
    return root === undefined ? null : claiming(pluginFiles(root, budget), name.slice(colon + 1), false);
  }
  return Object.hasOwn(BUILT_INS, name) ? { model: BUILT_INS[name] ?? null, effort: null, builtIn: true } : null;
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
function effortAllowed(effort) {
  return ALLOWED_EFFORTS.includes(effort.toLowerCase());
}
var UI_POLICY = {
  minEffort: "high",
  tiers: ["opus", "fable"]
};
var UI_REASON_WORDS = ["ui", "ui-design"];
function uiTierAllowed(real) {
  return real.tier !== null && UI_POLICY.tiers.includes(real.tier);
}
function uiEffortAllowed(effort) {
  if (effort === null)
    return false;
  const levels = ALLOWED_EFFORTS;
  return levels.indexOf(effort.toLowerCase()) >= levels.indexOf(UI_POLICY.minEffort);
}
var UI_EFFORTS = ALLOWED_EFFORTS.filter((one) => uiEffortAllowed(one));
function uiRuleText() {
  const named = (levels) => levels.length < 2 ? levels.map((one) => `\`${one}\``).join("") : `${levels.slice(0, -1).map((one) => `\`${one}\``).join(", ")} or \`${levels.at(-1)}\``;
  return `${named(UI_POLICY.tiers)} at ${named(UI_EFFORTS)}`;
}
function premiumTier(family) {
  return family === "fable" || family === "opus" ? family : null;
}
function tierOfReading(family) {
  return family === null ? "opus" : premiumTier(family);
}
function familyFirstTarget(gateway, family) {
  if (!gateway.gatewayOn || gateway.config === null || family === null)
    return null;
  const slot = familySlotKey(family);
  if (slot === null || !Object.hasOwn(gateway.config.slots, slot))
    return null;
  return gateway.config.slots[slot]?.[0] ?? null;
}
function tierOfMappedId(model, gateway, env, order) {
  const id = withoutContextSuffix(model.trim());
  for (const premium of order) {
    const override = stringField(env[familyEnv(premium)]);
    if (override !== null && withoutContextSuffix(override.trim()) === id)
      return premium;
    const first = familyFirstTarget(gateway, premium);
    if (first !== null && withoutContextSuffix(first.trim()) === id)
      return premium;
  }
  return null;
}
function answeringFamily(real) {
  if (!real.claude)
    return null;
  return claudeFamily(real.model) ?? CLAUDE_FAMILIES.find((one) => one === real.model.toLowerCase()) ?? null;
}
function asNamed(answered, family, tier) {
  const real = premiumTier(answeringFamily(answered) ?? answered.family);
  return tier === null && real !== null ? { ...answered, family: real, tier: real } : { ...answered, family, tier };
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
    const mapped = tierOfMappedId(text, gateway, env, ["fable", "opus"]);
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
function resolveSessionModel(session, gateway, env) {
  if (!session.served)
    return resolveLaunchModel(session.model, gateway, env);
  const text = withoutContextSuffix(session.model.trim());
  const family = claudeFamily(text);
  const own = family !== null || text.startsWith("claude-") ? { claude: true, family, model: text, tier: tierOfReading(family) } : resolveTarget(text);
  const mapped = tierOfMappedId(text, gateway, env, ["opus", "fable"]);
  return mapped === null ? own : { ...own, family: mapped, tier: mapped };
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
function effectiveLaunch(launch, env, sessionModel, definition = null) {
  if (launch.fork) {
    return { effort: launch.effort, effortFrom: null, model: sessionModel, modelFrom: "fork" };
  }
  const level = stringField(env[EFFORT_LEVEL_ENV])?.trim().toLowerCase() ?? "";
  const effort = level === "" ? launch.effort !== null ? { effort: launch.effort, effortFrom: null } : {
    effort: definition?.effort ?? null,
    effortFrom: definition?.effort ? "frontmatter" : null
  } : { effort: level, effortFrom: EFFORT_LEVEL_ENV };
  if (switchOn(env[SUBAGENT_MODEL_FORCE_ENV])) {
    const forced = modelVariable(env, SUBAGENT_MODEL_ENV);
    return forced === null ? { ...effort, model: sessionModel, modelFrom: "force-session" } : { ...effort, model: forced, modelFrom: "force" };
  }
  const workflowModel = launch.workflow ? modelVariable(env, WORKFLOW_SUBAGENT_MODEL_ENV) : null;
  if (workflowModel !== null)
    return { ...effort, model: workflowModel, modelFrom: "workflow" };
  if (launch.model !== null)
    return { ...effort, model: launch.model, modelFrom: "call" };
  const model = definition?.model?.trim() ?? "";
  if (model !== "" && model.toLowerCase() !== "inherit") {
    return { ...effort, model, modelFrom: "frontmatter" };
  }
  return { ...effort, model: null, modelFrom: "call" };
}

// src/hooks/agent-guard-workflows.ts
import { existsSync as existsSync13, readdirSync as readdirSync5, readFileSync as readFileSync19, statSync as statSync10 } from "fs";
import { dirname as dirname10, isAbsolute as isAbsolute4, join as join19, resolve as resolve7, sep as sep4 } from "path";
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
var META_HEAD = /^export\s+const\s+meta\s*=\s*(?=\{)/;
function metaExportAt(script) {
  const start = skipBlank(script, 0);
  return META_HEAD.test(script.slice(start)) ? start : null;
}
function workflowMetaName(script) {
  const start = metaExportAt(script);
  if (start === null)
    return null;
  const head = META_HEAD.exec(script.slice(start));
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
  if (cwd === "" && !isAbsolute4(path)) {
    return {
      unreadable: `The workflow script \`${path}\` is a relative path, and the hook input names no folder it is relative to.`
    };
  }
  const file = resolve7(cwd, path);
  let size;
  try {
    const stat = statSync10(file);
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
    return { file, script: normalized(readFileSync19(file, "utf8")) };
  } catch {
    return { unreadable: `The workflow script \`${file}\` cannot be read.` };
  }
}
function workflowFiles(folder) {
  let names;
  try {
    names = readdirSync5(folder).filter((name) => name.endsWith(".js"));
  } catch {
    return [];
  }
  return names.sort().map((name) => join19(folder, name));
}
function claiming2(files, name) {
  const found = [];
  for (const file of files) {
    try {
      const stat = statSync10(file);
      if (!stat.isFile() || stat.size > WORKFLOW_SCRIPT_MAX_BYTES)
        continue;
      const script = normalized(readFileSync19(file, "utf8"));
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
  let at = resolve7(place.cwd);
  const home = resolve7(place.home);
  while (place.cwd !== "" && at !== home) {
    folders.push(join19(at, ".claude", "workflows"));
    if (existsSync13(join19(at, ".git")))
      break;
    const up = dirname10(at);
    if (up === at)
      break;
    at = up;
  }
  folders.push(join19(place.claudeConfigDir, "workflows"));
  return folders;
}
function noFile(name) {
  return {
    unreadable: `The workflow \`${name}\` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.`
  };
}
function within(folder, inside) {
  const root = resolve7(inside);
  const path = resolve7(folder);
  return path === root || path.startsWith(root.endsWith(sep4) ? root : `${root}${sep4}`);
}
function pluginFolder(plugin, place) {
  if (plugin === PLUGIN && place.pluginRoot !== null)
    return place.pluginRoot;
  const installs = installsOfPlugin(place.installedPluginsFile, plugin);
  const project = installs.filter((one) => one.scope !== "user" && one.projectPath !== null && place.cwd !== "" && within(place.cwd, one.projectPath)).sort((a, b) => b.projectPath.length - a.projectPath.length);
  const user = installs.filter((one) => one.scope === "user");
  return [...project, ...user].find((one) => existsSync13(one.installPath))?.installPath ?? null;
}
function pluginWorkflowFiles(root) {
  let listed;
  try {
    const manifest = JSON.parse(readFileSync19(join19(root, ".claude-plugin", "plugin.json"), "utf8"));
    listed = manifest?.workflows ?? manifest?.experimental?.workflows;
  } catch {
    listed = undefined;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : null;
  if (paths === null)
    return workflowFiles(join19(root, "workflows"));
  return paths.filter((one) => typeof one === "string").flatMap((one) => {
    const path = resolve7(root, one);
    try {
      if (statSync10(path).isDirectory())
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
    return oneOf2(claiming2(pluginWorkflowFiles(root), own), name) ?? {
      unreadable: `The workflow \`${name}\`: the plugin's folder \`${root}\` holds no workflow named \`${own}\`.`
    };
  }
  for (const folder of savedFolders(place)) {
    const found = oneOf2(claiming2(workflowFiles(folder), name), name);
    if (found !== null)
      return found;
  }
  return noFile(name);
}

// src/hooks/agent-launches.ts
import {
  appendFileSync as appendFileSync4,
  closeSync as closeSync5,
  fstatSync as fstatSync2,
  mkdirSync as mkdirSync10,
  openSync as openSync5,
  readFileSync as readFileSync20,
  readSync as readSync3
} from "fs";
import { dirname as dirname11, join as join20 } from "path";
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
  return join20(stateDir, "agent-launches.jsonl");
}
var RECORD_TAIL_BYTES = 64 * 1024;
function tailLines2(file) {
  let fd;
  try {
    fd = openSync5(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync2(fd).size;
    const from = Math.max(0, size - RECORD_TAIL_BYTES);
    const buffer = Buffer.alloc(size - from);
    const read = readSync3(fd, buffer, 0, buffer.length, from);
    const lines = buffer.subarray(0, read).toString("utf8").split(`
`);
    return (from > 0 ? lines.slice(1) : lines).filter((line) => line.trim() !== "");
  } catch {
    return [];
  } finally {
    closeSync5(fd);
  }
}
function launchKey(launch) {
  return `${launch.session}\x00${launch.toolUseId}\x00${launch.launchIndex}`;
}
function appendAgentLaunches(file, launches) {
  const written = new Set(tailLines2(file).map(parseAgentLaunch).filter((one) => one !== null && one.toolUseId !== "").map(launchKey));
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
    mkdirSync10(dirname11(file), { recursive: true, mode: 448 });
    appendFileSync4(file, fresh.map((one) => `${JSON.stringify(one)}
`).join(""));
  } catch {}
}
function isJsonObject3(value) {
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
  if (!isJsonObject3(value))
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

// src/hooks/workflow-script.ts
var SCRIPT_FUNCTIONS = ["agent", "workflow"];
var scriptParser = null;
var lastRead = null;
var PARSE_OPTIONS = {
  allowAwaitOutsideFunction: true,
  allowHashBang: false,
  allowReturnOutsideFunction: true,
  ecmaVersion: "latest",
  locations: true,
  sourceType: "script",
  strict: true
};
var ROUTE_NAMES = [
  "eval",
  "Function",
  "arguments",
  "globalThis",
  "global",
  "self"
];
var COMMON_ROUTE_NAMES = ["global", "self"];
var SCRIPT_THIS = "`this` outside a non-arrow function (an arrow uses the script's own `this`)";
var CONSTRUCTOR = "constructor";
var HTML_COMMENT_MARKERS = ["<!--", "-->"];
var HTML_COMMENT = "an HTML-like comment (`<!--`, or `-->` at a line's start), which a script reads as a comment and a module as code, so a launch could hide in it";
var PROTOTYPE_KEY = "__proto__";
function lineOf(node) {
  return node.loc?.start.line ?? 1;
}
function fixedString(node) {
  if (node === undefined)
    return null;
  if (node.type === "Literal") {
    const value = node.value;
    return typeof value === "string" ? value : null;
  }
  if (node.type === "TemplateLiteral") {
    const template = node;
    if (template.expressions.length > 0)
      return null;
    return template.quasis[0]?.value.cooked ?? null;
  }
  return null;
}
function keyName(property) {
  const { computed, key } = property;
  if (computed)
    return null;
  if (key.type === "Identifier")
    return key.name;
  const value = key.value;
  return key.type === "Literal" && typeof value === "string" ? value : null;
}
function readObject2(node) {
  const keys = new Map;
  if (node?.type !== "ObjectExpression")
    return { hidden: false, keys, plain: false };
  const seen = new Set;
  let hidden = false;
  let plain = true;
  for (const one of node.properties) {
    if (one.type !== "Property") {
      hidden = true;
      plain = false;
      continue;
    }
    const name = keyName(one);
    if (name === null) {
      if (one.computed)
        hidden = true;
      plain = false;
      continue;
    }
    if (seen.has(name))
      hidden = true;
    seen.add(name);
    if (one.kind !== "init" || one.method || one.shorthand || name === PROTOTYPE_KEY)
      plain = false;
    if (one.kind === "init" && !keys.has(name))
      keys.set(name, fixedString(one.value));
  }
  return { hidden, keys, plain: plain && !hidden };
}
function agentCall(call) {
  const args = call.arguments;
  const spread = args.some((one) => one.type === "SpreadElement");
  const options = readObject2(args[1]);
  return {
    hidden: spread || options.hidden,
    keys: options.keys,
    line: lineOf(call),
    plain: !spread && args.length === 2 && options.plain,
    prompt: fixedString(args[0])
  };
}
function workflowCall(call) {
  const [first] = call.arguments;
  const object = readObject2(first);
  return {
    line: lineOf(call),
    name: fixedString(first),
    scriptPath: object.plain ? object.keys.get("scriptPath") ?? null : null
  };
}
function ownThis(node, field) {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
      return field === "params" || field === "body";
    case "PropertyDefinition":
      return field === "value";
    case "StaticBlock":
      return true;
    default:
      return false;
  }
}
function routeOf(node, parent, inFunction) {
  switch (node.type) {
    case "Identifier": {
      const { name } = node;
      if (!ROUTE_NAMES.includes(name))
        return null;
      return COMMON_ROUTE_NAMES.includes(name) ? `\`${name}\` (even as a name of your own: rename it)` : `\`${name}\``;
    }
    case "ThisExpression":
      return inFunction ? null : SCRIPT_THIS;
    case "ImportExpression":
      return "`import(\u2026)`";
    case "MemberExpression": {
      const { computed, property } = node;
      const name = computed ? fixedString(property) : property.name;
      return name === CONSTRUCTOR ? "a `constructor` member" : null;
    }
    case "Property":
      return parent?.type === "ObjectPattern" && keyOrComputedName(node) === CONSTRUCTOR ? "a `constructor` member" : null;
    default:
      return null;
  }
}
function keyOrComputedName(property) {
  const { computed, key } = property;
  return computed ? fixedString(key) : keyName(property);
}
function codeChildren(node) {
  const fields = node;
  const skip = new Set(["loc", "range"]);
  switch (node.type) {
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      if (fields.computed !== true)
        skip.add("key");
      break;
    case "MemberExpression":
      if (fields.computed !== true)
        skip.add("property");
      break;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      skip.add("label");
      break;
    case "MetaProperty":
      return [];
  }
  const children = [];
  for (const [field, value] of Object.entries(fields)) {
    if (skip.has(field))
      continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      if (typeof one === "object" && one !== null && typeof one.type === "string") {
        children.push([field, one]);
      }
    }
  }
  return children;
}
function directCallee(node, parent) {
  return parent?.type === "CallExpression" && parent.callee === node && !parent.optional;
}
function parseFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const loc = error?.loc;
  return {
    line: typeof loc?.line === "number" ? loc.line : null,
    ok: false,
    why: message.replace(/\s*\(\d+:\d+\)$/, "")
  };
}
function bodyText(script) {
  const at = metaExportAt(script);
  if (at === null)
    return script;
  return `${script.slice(0, at)}${" ".repeat("export".length)}${script.slice(at + "export".length)}`;
}
function parseScript(script) {
  if (lastRead?.script === script)
    return lastRead.read;
  const read = parseFresh(script);
  lastRead = { read, script };
  return read;
}
function parseFresh(script) {
  if (scriptParser === null) {
    return {
      line: null,
      ok: false,
      why: "the guard's script parser is not loaded in this program"
    };
  }
  const text = bodyText(script);
  const htmlComments = [];
  let program;
  try {
    program = scriptParser(text, {
      ...PARSE_OPTIONS,
      onComment: (_block, _text, start, _end, startLoc) => {
        if (HTML_COMMENT_MARKERS.some((marker) => text.startsWith(marker, start))) {
          htmlComments.push(startLoc?.line ?? 1);
        }
      }
    });
  } catch (error) {
    return parseFailure(error);
  }
  const [htmlLine] = htmlComments;
  if (htmlLine !== undefined)
    return { line: htmlLine, ok: false, why: HTML_COMMENT };
  const agents = [];
  const workflows = [];
  const handed = [];
  const routes = [];
  const stack = [
    { inFunction: false, node: program, parent: null }
  ];
  for (let next = stack.pop();next !== undefined; next = stack.pop()) {
    const { inFunction, node, parent } = next;
    const route = routeOf(node, parent, inFunction);
    if (route !== null)
      routes.push({ at: node.start, read: { line: lineOf(node), what: route } });
    if (node.type === "Identifier" && SCRIPT_FUNCTIONS.includes(node.name)) {
      const name = node.name;
      if (!directCallee(node, parent)) {
        handed.push({ at: node.start, read: { line: lineOf(node), name } });
      } else if (name === "agent") {
        agents.push({ at: parent.start, read: agentCall(parent) });
      } else {
        workflows.push({ at: parent.start, read: workflowCall(parent) });
      }
    }
    for (const [field, child] of codeChildren(node)) {
      stack.push({ inFunction: inFunction || ownThis(node, field), node: child, parent: node });
    }
  }
  const inOrder = (found) => found.sort((a, b) => a.at - b.at).map((one) => one.read);
  return {
    agents: inOrder(agents),
    handed: inOrder(handed),
    ok: true,
    routes: inOrder(routes),
    workflows: inOrder(workflows)
  };
}

// src/hooks/agent-guard.ts
var AGENT_TOOLS = ["Agent", "Task"];
var WORKFLOW_TOOLS = ["Workflow"];
var PRINT_RUN = "claude -p";
var HERDR_START = "herdr start";
var FORK = "fork";
var BUILDER_WORDS = [FABLE_BUILD_REASON];
var READ_ONLY_AGENTS = [
  "Plan",
  "Explore",
  `${PLUGIN}:auditor`,
  `${PLUGIN}:edge-case-hunter`,
  `${PLUGIN}:researcher`
];
var READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";
function keyPart(part) {
  return part.trim().toLowerCase().replace(/[\s_-]+/g, "-");
}
function agentKey(type) {
  return keyPart(type.includes(":") ? type.split(":").pop() ?? type : type);
}
function readOnlyType(type, ctx, env) {
  if ((ctx.readOnlyAgents ?? READ_ONLY_AGENTS).includes(type)) {
    if (type.includes(":") || ctx.definition === undefined)
      return true;
    return ctx.definition(type)?.builtIn === true;
  }
  if (ctx.readOnlyAgents !== undefined)
    return false;
  const listed = (env[READ_ONLY_AGENTS_ENV] ?? "").split(",").map((one) => one.trim()).filter((one) => one !== "");
  return new Set(listed.map(agentKey)).has(agentKey(type));
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

class UnreadableScript extends Error {
}
function parsedScript(script) {
  const read = parseScript(script);
  if (!read.ok)
    throw new UnreadableScript(read.why);
  return read;
}
function unreadableScript(line, why) {
  const where = line === null ? "" : ` at line ${line}`;
  return [
    `This Workflow's script cannot be read${where}: ${why}.`,
    "The guard parses the script the way Claude Code runs it (the body of an async function), and a script it cannot parse could hide a launch.",
    "Fix the script so it runs as JavaScript."
  ].join(`
`);
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
var ROUTES_REFUSED = 'Write every launch as a direct `agent("<prompt>", { model: "\u2026", effort: "\u2026" })` call, and leave out `eval`, `Function`, `arguments`, `globalThis`, `global`, `self`, a `this` outside a non-arrow function (an arrow uses the script\'s own `this`), `import(\u2026)` and `.constructor`.';
var OPTIONS_BUILT_AT_RUNTIME = [
  "Its options are not what they seem: a `...spread`, a computed `[\u2026]` key, or the same option written twice (the last one wins at run time, while the guard reads the first). The model and effort it will really run on cannot be read.",
  "Write `model`, `effort` and `agentType` once each, as string literals in the call's own options object."
].join(`
`);
function workflowRefusal(script) {
  const read = parseScript(script);
  if (!read.ok)
    return unreadableScript(read.line, read.why);
  const [route] = read.routes;
  if (route !== undefined) {
    return [
      `This Workflow uses ${route.what} (line ${route.line}): that can reach \`agent\` under another name, or build code at run time, so it could launch an agent the guard never sees.`,
      ROUTES_REFUSED
    ].join(`
`);
  }
  for (const name of ["agent", "workflow"]) {
    const handed = read.handed.find((use) => use.name === name);
    if (handed === undefined)
      continue;
    return [
      `This Workflow uses \`${name}\` without calling it at once (line ${handed.line}): a variable holds it, it is optional-called (\`${name}?.(\u2026)\`), or it is passed as a value.`,
      HANDED_AROUND[name]
    ].join(`
`);
  }
  const hidden = read.agents.find((call) => call.hidden);
  if (hidden === undefined)
    return null;
  return [
    `This Workflow's \`agent(\u2026)\` call at line ${hidden.line} cannot be read.`,
    OPTIONS_BUILT_AT_RUNTIME
  ].join(`
`);
}
function nestedWorkflows(script) {
  const read = parseScript(script);
  if (!read.ok)
    return { refusal: unreadableScript(read.line, read.why) };
  const calls = [];
  for (const { line, name, scriptPath } of read.workflows) {
    if (name !== null)
      calls.push({ line, name });
    else if (scriptPath !== null)
      calls.push({ line, scriptPath });
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
var POLICY_KEYS2 = ["model", "effort", "agentType"];
function launchOf(call) {
  const { keys, plain, prompt } = call;
  const unreadable = POLICY_KEYS2.find((key) => keys.has(key) && keys.get(key) === null);
  const policy = (key) => plain ? keys.get(key) ?? null : null;
  return {
    ...unreadable === undefined ? {} : { unreadable },
    ...plain ? {} : { optionsNotPlain: true },
    agentType: policy("agentType"),
    effort: policy("effort"),
    model: policy("model"),
    prompt,
    where: keys.get("label") ?? prompt?.split(`
`)[0]?.slice(0, 60) ?? "(unreadable)"
  };
}
function readWorkflowScript(script) {
  return parsedScript(script).agents.map(launchOf);
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
function noWorkflowField(field) {
  return [
    `This Workflow launch names no \`${field}\` the guard can read, in its options or its agent definition.`,
    `A value held in a variable, or options that are not one plain object literal (a getter, a method, a shorthand key, \`__proto__\`, a ternary, a second object), can set the run's \`${field}\` where a hook never sees it, so no agent definition stands in for it then.`,
    'Write `model` and `effort` as string literals in one plain options object: `agent("<prompt>", { model: "\u2026", effort: "\u2026" })`.'
  ].join(`
`);
}
var NO_WORKFLOW_MODEL = noWorkflowField("model");
var NO_WORKFLOW_EFFORT = noWorkflowField("effort");
var PROMPT_UNREADABLE = "The launch's prompt is built at run time, so the guard cannot read a `Fable reason:` line in it.";
function judgeWorkflow(script, ctx, env, from = null) {
  return readWorkflowScript(script).map((launch) => {
    const bare = () => effectiveLaunch({ model: null, effort: null, fork: false, workflow: true }, env, ctx.sessionModel);
    if (launch.optionsNotPlain === true) {
      const ran = bare();
      const missing = ran.modelFrom === "call" ? NO_WORKFLOW_MODEL : ran.effort === null ? NO_WORKFLOW_EFFORT : null;
      if (missing !== null)
        return { from, launch, verdict: { ...deny(null, missing), ran } };
    }
    if (launch.unreadable !== undefined) {
      return {
        from,
        launch,
        verdict: {
          ...deny(null, `This Workflow launch's \`${launch.unreadable}\` is not a string literal the guard can read. Write policy options as string literals.`),
          ran: bare()
        }
      };
    }
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
    const childRefusal = workflowRefusal(found.script);
    if (childRefusal !== null) {
      return refused(`In the workflow \`${from}\` this one runs: ${childRefusal}`);
    }
    const deeper = parsedScript(found.script).workflows[0];
    if (deeper !== undefined) {
      return refused(`The workflow \`${from}\` this one runs nests a workflow of its own (line ${deeper.line}): Claude Code runs workflows one level deep, and the guard reads no deeper.`);
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
    return {
      decision: "deny",
      reason: [...call.unreadable, UNREADABLE_UNATTENDED].join(`
`)
    };
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
  const word = firstWord(text) ?? "";
  return allowed.includes(word) ? word : null;
}
var REASON_WORD_MAX = 40;
function firstWord(text) {
  const found = /^[^a-z0-9]*([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(text?.toLowerCase() ?? "");
  return found?.[1]?.slice(0, REASON_WORD_MAX) ?? null;
}
function uiDeclaration(prompt) {
  for (const label of ["Opus reason", "Fable reason"]) {
    const said = reasonLine(prompt, label);
    const word = firstWord(said);
    if (word !== null && UI_REASON_WORDS.includes(word)) {
      return `${label}: ${said}`;
    }
  }
  return null;
}
var NO_MODEL = [
  "Neither this Agent launch nor its agent definition names a `model` the guard can read.",
  "Pass `model` on the launch or set it in the agent's frontmatter; `inherit` does not choose a model."
].join(`
`);
function levelsText(levels) {
  const named = levels.map((one) => `\`${one}\``);
  return named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}
var EFFORTS = levelsText(ALLOWED_EFFORTS);
var EFFORT_USE = "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).";
var NO_EFFORT = [
  "Neither this Agent launch nor its agent definition names an `effort` the guard can read.",
  `Pass \`effort\` on the launch or set it in the agent's frontmatter: ${EFFORTS}.`,
  EFFORT_USE
].join(`
`);
var PRINT_NO_MODEL = [
  "This `claude -p` run names no `model` the guard can read.",
  "A run given none starts on the default model, which nobody chose, and no agent definition stands behind a print run."
].join(`
`);
var PRINT_NO_EFFORT = [
  "This `claude -p` run names no `effort` the guard can read.",
  `Name one of ${EFFORTS}.`,
  EFFORT_USE
].join(`
`);
function effortDenial(effort, fromFrontmatter) {
  return [
    `This launch asks for effort \`${effort}\`, which no subagent may run at (the plugin's rule).`,
    ...fromFrontmatter ? [
      `Effort \`${effort}\` comes from the agent's frontmatter; pass \`effort\` on the call to override it.`
    ] : [],
    `A subagent runs at ${EFFORTS} \u2014 never \`low\`, on any model.`,
    EFFORT_USE
  ].join(`
`);
}
function uiDenial(real, effort, declared) {
  return [
    `This launch declares UI/UX work (\`${declared}\`) and would run on \`${real.model}\` ${atEffort(effort)}.`,
    `Use ${uiRuleText()} for UI/UX work (D50).`,
    "Checking is not design: `cc-smart-dev-kit:ui-verifier` may run on an affordable model, and you judge its measured facts and screenshots on one of those tiers."
  ].join(`
`);
}
function namedModel(real) {
  const answered = answeringFamily(real);
  if (real.claude && (answered === null || answered === real.tier)) {
    return real.tier === "fable" ? "Claude Fable" : "Claude Opus";
  }
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
  if (ran.effortFrom !== EFFORT_LEVEL_ENV)
    return null;
  return `It runs at effort \`${ran.effort}\` because \`${ran.effortFrom}\` is set: Claude Code ignores the launch's own \`effort\`, and only the person can change the variable, ${WHERE_SET}.`;
}
function judgeLaunch(launch, ctx, env) {
  if (launch.tool === HERDR_START) {
    const ran = {
      model: launch.model,
      effort: launch.effort,
      modelFrom: "call",
      effortFrom: null
    };
    if (launch.model === null || launch.effort === null)
      return { ...deny(null, "Pass both --model and --effort to herdr start."), ran };
    if (!effortAllowed(launch.effort))
      return { ...deny(null, effortDenial(launch.effort, false)), ran };
    const real = resolveLaunchModel(launch.model, ctx, env);
    const verdict = real.tier === "fable" || real.tier === "opus" && launch.effort === OPUS_ASK_EFFORT ? {
      decision: "ask",
      real,
      reason: `Approve this herdr start on ${launch.model} at effort ${launch.effort}; it spends the person's own plan usage.`,
      why: "herdr-premium"
    } : judgeModel(launch, real, ctx, env);
    return { ...verdict, ran };
  }
  const needsDefinition = !launch.fork && launch.tool !== PRINT_RUN && launch.subagentType !== null && (launch.model === null || launch.effort === null);
  const ran = effectiveLaunch({
    effort: launch.effort,
    fork: launch.fork,
    model: launch.model,
    workflow: launch.tool === "Workflow"
  }, env, ctx.sessionModel, needsDefinition ? ctx.definition?.(launch.subagentType) ?? null : null);
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
    const print = launch.tool === PRINT_RUN;
    if (ran.modelFrom === "call" && ran.model === null) {
      return judged(deny(null, print ? PRINT_NO_MODEL : NO_MODEL));
    }
    if (ran.effort === null)
      return judged(deny(null, print ? PRINT_NO_EFFORT : NO_EFFORT));
  }
  const real = ran.modelFrom === "fork" || ran.modelFrom === "force-session" ? sessionLaunchModel(ran.model, ctx.sessionServed === true, ctx, env) : resolveLaunchModel(ran.model ?? "", ctx, env);
  const auto = ran.effortFrom === EFFORT_LEVEL_ENV && ran.effort === EFFORT_AUTO;
  if (ran.effort !== null && !auto && !effortAllowed(ran.effort)) {
    return ran.effortFrom !== EFFORT_LEVEL_ENV ? judged(deny(real, effortDenial(ran.effort, ran.effortFrom === "frontmatter"))) : { namesEffortLevel: true, verdict: deny(real, effortLevelDenial(ran.effort)) };
  }
  return judged(judgeModel({ ...launch, effort: ran.effort }, real, ctx, env));
}
function judgeModel(launch, real, ctx, env) {
  const type = launch.subagentType ?? "";
  const builder = !readOnlyType(type, ctx, env);
  const declared = uiDeclaration(launch.prompt);
  if (declared !== null) {
    const effort = launch.effort?.toLowerCase() ?? null;
    const tooLow = effort !== null && !uiEffortAllowed(effort);
    if (!uiTierAllowed(real) || tooLow)
      return deny(real, uiDenial(real, effort, declared));
  }
  if (real.tier === "fable") {
    const said = reasonLine(launch.prompt, "Fable reason");
    const word = reasonWord(said, builder ? BUILDER_WORDS : FABLE_REASONS);
    if (word === null)
      return deny(real, builder ? fableBuildDenial(real, type) : fableDenial(real));
    if (nobodyWatches(env)) {
      const why = "A Fable launch is approved by the person, one by one, and this session has nobody to answer";
      return deny(real, [`${why} (\`claude -p\`).`, "Run it in an interactive session."].join(`
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
        const why = `This launch names \`${real.model}\`, which the guard cannot read as Claude Opus, and such a launch is approved by the person, one by one: this session has nobody to answer`;
        return deny(real, [`${why} (\`claude -p\`).`, "Name `opus` (or a Claude Opus id) as its model."].join(`
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
    const why = opusWhy(effort, firstWord(said));
    if (effort !== OPUS_ASK_EFFORT)
      return allow(real, why);
    if (nobodyWatches(env)) {
      const nobody = `A launch on ${namedModel(real)} at effort \`${effort}\` is approved by the person, one by one, and this session has nobody to answer`;
      return deny(real, [
        `${nobody} (\`claude -p\`).`,
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
  return allow(real, "");
}
function nobodyWatches(env) {
  return !isAttended(env);
}
function sessionLaunchModel(sessionModel, served, gateway, env) {
  if (sessionModel === null)
    return { claude: true, family: "opus", model: "the session's model (unknown)", tier: "opus" };
  return resolveSessionModel({ model: sessionModel, served }, gateway, env);
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
  if (answered !== null)
    return { model: answered, served: true };
  const started = stringField(env.ANTHROPIC_MODEL);
  return started === null ? null : { model: started, served: false };
}
function sessionGatewayOf(paths, env) {
  const raw = env.ANTHROPIC_BASE_URL;
  const url = raw === undefined || raw === "" ? null : raw;
  const config = gatewayConfigOf(paths);
  if (!baseUrlPointsAtGateway(url))
    return { config, gatewayOn: false, profile: null };
  const profile = config === null ? null : urlMeaning(url, routerBaseUrl(config.port)).profile;
  if (config === null || profile === null)
    return { config, gatewayOn: true, profile: null };
  return {
    config: profileView(config, profile) ?? plainClaudeView(config),
    gatewayOn: true,
    profile
  };
}
function readGuardContext(paths, input, env) {
  const { config, gatewayOn } = sessionGatewayOf(paths, env);
  const session = sessionModelOf(input, env);
  const cwd = stringField(input.cwd);
  const definitions = new Map;
  const definition = (name) => {
    if (name === null)
      return null;
    if (definitions.has(name))
      return definitions.get(name) ?? null;
    let found = null;
    try {
      const checkout = !name.includes(":") && cwd !== null ? locateCheckout(cwd)?.root ?? cwd : null;
      found = agentDefinition(name, { paths, checkout, cwd });
    } catch {}
    definitions.set(name, found);
    return found;
  };
  return {
    config,
    gatewayOn,
    definition,
    sessionModel: session?.model ?? null,
    sessionServed: session?.served ?? false
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
function resolvedModelOf(input) {
  const response = input.tool_response;
  if (typeof response !== "object" || response === null || Array.isArray(response))
    return null;
  return stringField(response.resolvedModel);
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
    model: resolvedModelOf(input) ?? result.real?.model ?? "",
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
function judgeCall(input, env, paths, cwd) {
  const tool = stringField(input.tool_name);
  const context = readGuardContext(paths, input, env);
  if (tool !== null && WORKFLOW_TOOLS.includes(tool)) {
    const call = judgeWorkflowCall(toolInput(input), context, env, workflowPlace(paths, env, cwd));
    const answer = workflowAnswer(call, env);
    return { kind: "workflow", call, decision: answer.decision, reason: answer.reason };
  }
  const launch = readLaunch(input);
  if (launch === null)
    return null;
  return { kind: "launch", launch, verdict: judgeLaunch(launch, context, env) };
}
function agentGuard(input, env, paths, cwd, nowMs = Date.now()) {
  const judged = judgeCall(input, env, paths, cwd);
  if (judged === null)
    return SILENT;
  const ran = afterTheCall(input);
  const file = agentLaunchesFile(paths.stateDir);
  const record = (lines) => {
    const records = lines.map((one, index) => recorded(one.verdict, one.launch, input, cwd, nowMs, index)).filter((line) => line !== null);
    if (records.length > 0)
      appendAgentLaunches(file, records);
  };
  if (judged.kind === "workflow") {
    const { call, decision, reason } = judged;
    if (decision === "deny")
      return ran ? SILENT : toolDecision("deny", reason);
    const asked = decision === "ask";
    if (ran === asked) {
      record(call.results.map((one) => ({ launch: asLaunch(one.launch), verdict: one.verdict })));
    }
    if (ran || !asked)
      return SILENT;
    return toolDecision("ask", reason);
  }
  const { launch, verdict } = judged;
  if (verdict.decision === (ran ? "ask" : "allow"))
    record([{ launch, verdict }]);
  return ran || verdict.decision === "allow" ? SILENT : toolDecision(verdict.decision, verdict.reason);
}

// src/hooks/agent-usage.ts
import { readFileSync as readFileSync21 } from "fs";
import { join as join21 } from "path";

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
  return join21(stateDir, AGENT_USAGE_FILE);
}
function isJsonObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function tokensOf(usage) {
  if (!isJsonObject4(usage))
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
    if (!isJsonObject4(line) || line.type !== "assistant")
      continue;
    const lineAgent = stringField(line.agentId);
    if (agentId !== "" && lineAgent !== null && lineAgent !== agentId)
      continue;
    const message = line.message;
    if (!isJsonObject4(message))
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
    text = readFileSync21(transcript, "utf8");
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

// src/mcp/task-server-name.ts
var TASKS_SERVER_NAME = `${COMMAND}-tasks`;

// src/tasks/words.ts
var TASK_TOOL = {
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
var TASK_TOOLS_ALLOW_RULE = `mcp__${TASKS_SERVER_NAME}__*`;
var TASK_COMMAND = `${COMMAND} task`;

// src/tasks/work/read.ts
import { existsSync as existsSync15 } from "fs";

// src/tasks/work/db.ts
import { Database } from "bun:sqlite";
import { chmodSync as chmodSync2, existsSync as existsSync14, mkdirSync as mkdirSync11, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname12, join as join22 } from "path";

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
    agent: row.agent ?? null,
    branch: row.branch ?? null,
    worktree: row.worktree ?? null,
    base: row.base ?? null,
    createdBy: row.created_by,
    claim: row.claim_pid === null ? null : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    waitsFor: dependencies.get(row.id) ?? [],
    type: row.blocking === 0 ? "non-blocking" : "blocking"
  }));
}
function isOpen(task) {
  return task.status === "pending" || task.status === "in_progress";
}
function inProgressFirst(a, b) {
  return Number(b.status === "in_progress") - Number(a.status === "in_progress") || a.number - b.number;
}
function openBlockers(task, byId) {
  return task.waitsFor.map((id) => byId.get(id)).filter((t) => t !== undefined && isOpen(t)).sort((a, b) => a.number - b.number);
}
function isBlocked(task, byId) {
  return isOpen(task) && openBlockers(task, byId).length > 0;
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
function claimHeldBy(claim, who) {
  if (!claim || !who || who.pid === null || claim.pid !== who.pid)
    return false;
  if (claim.procStart !== null && who.procStart !== null)
    return claim.procStart === who.procStart;
  return who.sessionId !== null && claim.sessionId === who.sessionId;
}
function claimState(task, isLive, who) {
  if (!task.claim || !isLive(task.claim))
    return "free";
  return claimHeldBy(task.claim, who) ? "mine" : "another session";
}
function waitsForTask(tasks, start, target) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reached = new Set;
  const pending = [start];
  while (pending.length) {
    const id = pending.pop();
    if (!id || reached.has(id))
      continue;
    if (id === target)
      return true;
    reached.add(id);
    pending.push(...byId.get(id)?.waitsFor ?? [], ...holdingUnder(tasks, id).map((task) => task.id));
  }
  return false;
}

// src/tasks/work/db.ts
var WORK_SCHEMA_VERSION = 4;
var LEGACY_LIFT_REASON = "lift legacy nested task";
var WRITE_TIMEOUT_MS = 3000;
var HOOK_TIMEOUT_MS = 200;
var NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
function workDbFile(paths) {
  return join22(paths.stateDir, "tasks", "work.db");
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
  "ALTER TABLE tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1 CHECK(blocking IN (0,1))",
  `ALTER TABLE tasks ADD COLUMN agent TEXT;
   ALTER TABLE tasks ADD COLUMN branch TEXT;
   ALTER TABLE tasks ADD COLUMN worktree TEXT;
   ALTER TABLE tasks ADD COLUMN base TEXT;`,
  repairTaskLayers
];

class BackupFailure extends Error {
}
function repairTaskLayers(sqlite, file) {
  const nestedExists = sqlite.query("SELECT 1 FROM tasks t JOIN tasks p ON p.id=t.parent_id WHERE t.kind='task' AND p.kind='task' LIMIT 1").get();
  if (!nestedExists)
    return;
  const rows = sqlite.query("SELECT id,project,number,parent_id,kind,blocking,status FROM tasks ORDER BY project,number").all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const originalHolds = new Map;
  const reader = { sqlite, writable: false, close() {} };
  for (const project of new Set(rows.map((row) => row.project))) {
    const tasks = allTasks(reader, project);
    for (const task of tasks.filter((task) => task.kind === "task" && tasks.some((child) => child.kind === "task" && child.parentId === task.id)))
      originalHolds.set(task.id, holdingUnder(tasks, task.id).map((held) => held.id));
  }
  let backed = false;
  const move = (row, parent, above) => {
    if (!backed) {
      if (!existsSync14(`${file}.v4.bak`)) {
        try {
          writeFileSync4(`${file}.v4.bak.tmp`, sqlite.serialize(), { mode: 384 });
          renameSync2(`${file}.v4.bak.tmp`, `${file}.v4.bak`);
        } catch (error) {
          let cleanup = "";
          try {
            rmSync2(`${file}.v4.bak.tmp`, { force: true });
          } catch (cleanupError) {
            cleanup = ` Temporary backup cleanup also failed: ${String(cleanupError)}.`;
          }
          throw new BackupFailure(`task lift needs a backup: ${error instanceof Error ? error.message : String(error)}. Fix: free disk space and check folder rights for ${dirname12(file)}. The next task call tries again.${cleanup}`);
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
      for (const [id, held] of originalHolds)
        for (const h of held) {
          if (waitsForTask(allTasks(reader, byId.get(id)?.project ?? ""), h, id))
            continue;
          sqlite.query("INSERT OR IGNORE INTO task_deps(task_id,waits_for) VALUES (?,?)").run(id, h);
        }
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
  const fresh = !existsSync14(file);
  if (hook && fresh)
    throw new Error("task store does not exist");
  if (!hook)
    mkdirSync11(dirname12(file), { recursive: true, mode: 448 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
  let writeRefusal;
  try {
    sqlite.run(`PRAGMA busy_timeout = ${hook ? HOOK_TIMEOUT_MS : WRITE_TIMEOUT_MS}`);
    sqlite.run("PRAGMA foreign_keys = ON");
    if (!hook) {
      chmodSync2(dirname12(file), 448);
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

// src/worktrees/machine-facts.ts
import { readdirSync as readdirSync6, readFileSync as readFileSync22, readlinkSync as readlinkSync3 } from "fs";
import { platform } from "os";
var PROGRAMS_TIMEOUT_MS = 15000;
var PS_PROGRAMS_ARGV = ["ps", "-ww", "-axo", "pid=,ppid=,args="];
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
var OUR_TOOLS = new Set(["git", "docker", "ps", "powershell", "pgrep"]);
var SHELL_NAMES = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "pwsh", "powershell"]);
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
    return readdirSync6("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
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

// src/tasks/work/identity.ts
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
var cached2 = new Map;
function callerOf(facts = {}) {
  const env = facts.env ?? process.env;
  const platform = facts.platform ?? process.platform;
  const pid = facts.pid ?? process.pid;
  const readStat = facts.readStat ?? readProcStat;
  const config = facts.claudeConfigDir ?? cliPaths(env).claudeConfigDir;
  const cacheKey = `${config}:${pid}:${platform}`;
  const records = liveSessions(config, {
    readStat,
    platform,
    ...facts.running ? { running: facts.running } : {}
  });
  const previous = cached2.get(cacheKey);
  const live = previous ? records.find((r) => r.pid === previous.pid && (r.procStart ?? null) === previous.procStart) : null;
  let record = live;
  if (!record) {
    const parent = facts.ppid ?? process.ppid;
    const grandparent = platform === "linux" ? null : (facts.parentOf ?? listedParentOf(platform))(parent);
    const pids = platform === "linux" ? ancestorPids(pid, readStat) : [parent, ...grandparent ? [grandparent] : []];
    record = pids.map((p) => records.find((r) => r.pid === p)).find((r) => r !== undefined);
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

// src/tasks/work/read.ts
function readWorkStore(paths, body) {
  let db;
  try {
    const file = workDbFile(paths);
    if (!existsSync15(file))
      return { state: "none" };
    db = openWorkDb(file, { mode: "hook" });
    return { state: "ready", value: body(db) };
  } catch (error) {
    return { state: "unreadable", why: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}
function startView(paths, project, who, options) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const byId = new Map(all.map((t) => [t.id, t]));
    const open = all.filter((t) => isOpen(t)).map((t) => ({ task: t, claim: claimState(t, claimLive, who) }));
    const shown = open.filter(({ task, claim }) => claim === "mine" || options.staleBefore === undefined || task.updatedAt >= options.staleBefore);
    shown.sort((a, b) => Number(b.claim === "mine") - Number(a.claim === "mine") || Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress") || b.task.updatedAt - a.task.updatedAt || a.task.number - b.task.number);
    const limit = Math.max(0, Math.floor(options.limit));
    return {
      tasks: shown.slice(0, limit).map(({ task, claim }) => ({
        id: task.id,
        number: task.number,
        subject: task.subject,
        status: task.status,
        claim,
        type: task.type,
        blocked: isBlocked(task, byId)
      })),
      more: Math.max(0, shown.length - limit),
      stale: open.length - shown.length
    };
  });
}
function holdingSteps(paths, project, number) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const task = all.find((t) => t.number === number);
    if (!task)
      return null;
    return {
      number: task.number,
      open: holdingUnder(all, task.id).map((t) => ({ number: t.number, subject: t.subject }))
    };
  });
}

// src/hooks/capped-list.ts
var HOOK_LIST_LIMIT = 8;
function cappedHookList(items, render, command, separator = ", ") {
  const shown = items.slice(0, HOOK_LIST_LIMIT).map(render);
  if (items.length > HOOK_LIST_LIMIT)
    shown.push(`+${items.length - HOOK_LIST_LIMIT} more: ${command}`);
  return shown.join(separator);
}

// src/hooks/subagent-worktree.ts
function subagentWorktreeOf(cwd, agentId) {
  if (agentId === null || !/^[0-9a-f]+$/.test(agentId))
    return null;
  const found = new RegExp(String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-${agentId})(?:[\\/]|$)`).exec(cwd);
  return found?.[1] ?? null;
}

// src/hooks/review-record.ts
var REVIEW_MODE_MARKER = "Mode: review";
var MARKER_LINE = new RegExp(`^${REVIEW_MODE_MARKER}[ \\t\\r]*$`, "m");
function isReviewRun(transcriptPath) {
  const prompts = runPrompts(transcriptPath);
  if (prompts === null || prompts.brief === null)
    return false;
  return [prompts.brief, ...prompts.later].every((text) => MARKER_LINE.test(text));
}
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
function said2(why) {
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
    return said2(`the workflow settings cannot be read (${why})`);
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
    const transcript = stringField(input.agent_transcript_path);
    if (transcript === null || !isReviewRun(transcript))
      return SILENT;
    if (commit === null)
      return SILENT;
    if (start === null) {
      if (input.stop_hook_active === true)
        return SILENT;
      return said2("no start was seen for this review agent, so no review is recorded: run the review again");
    }
    await recordReview(reviewsFile(paths.stateDir, repository), start.head, agent, Date.now(), start.branch);
  } catch (error) {
    return said2(`cannot write the record (${error instanceof Error ? error.message : String(error)})`);
  }
  return SILENT;
}

// src/hooks/builder-finish.ts
var BUILDER_TYPE_ENDS = ["builder", "rules-maintainer"];
var TASK_LINE = /^Your task: #(\d+)[ \t\r]*$/m;
function isBuilder(agentType) {
  return agentType !== null && BUILDER_TYPE_ENDS.some((end) => agentType.endsWith(end));
}
function briefTaskNumber(brief) {
  const found = TASK_LINE.exec(brief)?.[1];
  return found === undefined ? null : Number(found);
}
function handBackReason(task, open) {
  return [
    `Task #${task} still has ${open.length} open blocking ${open.length === 1 ? "step" : "steps"}. Close each one, then hand back:`,
    cappedHookList(open, (step) => {
      const ref = `"#${step.number}"`;
      return `- #${step.number} ${step.subject.replace(/\s+/g, " ")}: finish it and close it with \`${TASK_TOOL.done}\` (task ${ref}, with evidence), or drop it with \`${TASK_TOOL.done}\` (task ${ref}, outcome "dropped") and a note saying why.`;
    }, TASK_TOOL.list, `
`)
  ].join(`
`);
}
function builderFinish(context) {
  return builderFinishAnswer(context.input, context.event, context.project, context.paths);
}
function builderFinishAnswer(input, event, project, paths) {
  if (event !== "SubagentStop")
    return SILENT;
  if (input.stop_hook_active === true)
    return SILENT;
  if (!isBuilder(agentTypeOf(input)))
    return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null)
    return SILENT;
  const brief = firstPromptText(transcript);
  if (brief === null)
    return SILENT;
  const task = briefTaskNumber(brief);
  if (task === null)
    return SILENT;
  const read = holdingSteps(paths, projectKey(project.mainCheckout ?? project.root), task);
  if (read.state === "unreadable") {
    return { stderr: `${COMMAND} builder-finish: the task list cannot be read (${read.why})` };
  }
  if (read.state === "none" || read.value === null || read.value.open.length === 0)
    return SILENT;
  return {
    stdout: JSON.stringify({ decision: "block", reason: handBackReason(task, read.value.open) })
  };
}

// src/hooks/fable-session.ts
import { createHash as createHash4 } from "crypto";
import { existsSync as existsSync17, mkdirSync as mkdirSync13, writeFileSync as writeFileSync6 } from "fs";
import { dirname as dirname13, join as join24 } from "path";

// src/hooks/session-name.ts
import { existsSync as existsSync16, mkdirSync as mkdirSync12, readFileSync as readFileSync23, renameSync as renameSync3, rmSync as rmSync3, writeFileSync as writeFileSync5 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join23 } from "path";
var MAX_SESSION_NAME = 60;
function cleanSessionName(raw) {
  const firstLine = raw.split(/\r?\n|\r/)[0] ?? "";
  const plain = firstLine.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (plain === "")
    return null;
  return [...plain].slice(0, MAX_SESSION_NAME).join("").trimEnd();
}
function isSessionId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function namesDir(env) {
  return join23(env.TMPDIR || tmpdir2(), "cc-smart-dev-kit-session-names");
}
function readName(file) {
  try {
    return existsSync16(file) ? cleanSessionName(readFileSync23(file, "utf8")) : null;
  } catch {
    return null;
  }
}
function writeAtomic(file, text) {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync5(partial, text);
  renameSync3(partial, file);
}
function appliedFile(env, sessionId) {
  return join23(namesDir(env), sessionId);
}
function readAppliedName(env, sessionId) {
  return readName(appliedFile(env, sessionId));
}
function rememberAppliedName(env, sessionId, title) {
  mkdirSync12(namesDir(env), { recursive: true });
  writeAtomic(appliedFile(env, sessionId), title);
}
function titleToSet(env, sessionId, wanted, current) {
  if (wanted === readAppliedName(env, sessionId))
    return null;
  rememberAppliedName(env, sessionId, wanted);
  return wanted === current ? null : wanted;
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
  const wanted = readName(join23(namesDir(env), `${sessionId}.name`));
  const note = namingNote(sessionId, wanted);
  const reminded = join23(namesDir(env), `${sessionId}.reminded`);
  if (event === "SessionStart") {
    rmSync3(reminded, { force: true });
    return addContext(event, note);
  }
  if (wanted === null) {
    if (existsSync16(reminded))
      return SILENT;
    mkdirSync12(namesDir(env), { recursive: true });
    writeAtomic(reminded, "reminded");
    return addContext(event, note);
  }
  const title = titleToSet(env, sessionId, wanted, stringField(input.session_title));
  return title !== null ? addContextAndTitle(event, null, title) : SILENT;
}

// src/hooks/fable-session.ts
function fableSessionMessage(named) {
  return `${COMMAND}: this session runs on ${named}, the premium model \u2014 it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.`;
}
function leadHintMessage(named, viaGateway = false) {
  const fix = viaGateway ? `Put Claude Opus first in the gateway's opus slot (/${PLUGIN}:gateway), or start the session with ${COMMAND} launch --no-gateway.` : "Switch with /model.";
  return `${COMMAND}: this session runs on ${named}. The kit works best with the lead on Claude Opus at high effort. ${fix} (To stop this hint: ${COMMAND} workflow set switches.leadHint false.)`;
}
function sessionModelName(real) {
  if (real.claude) {
    const family = answeringFamily(real);
    return family === null ? real.model : `Claude ${familyLabel(family)}`;
  }
  const tier = real.tier ?? real.family;
  return tier === null ? real.model : `the \`${tier}\` model, ${real.model}`;
}
function sessionMark(env, sessionId, kind) {
  return join24(namesDir(env), `${sessionId}.${kind}`);
}
function judgedMark(env, sessionId, model, served = false) {
  const key = served ? `served:${model}` : model;
  const hash = createHash4("sha256").update(key).digest("hex").slice(0, 16);
  return join24(namesDir(env), `${sessionId}.judged-${hash}`);
}
function firstTime(mark) {
  try {
    mkdirSync13(dirname13(mark), { recursive: true });
    writeFileSync6(mark, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
function leadVerdict(real) {
  if (real.tier === "fable")
    return "fable";
  const answered = answeringFamily(real);
  if (real.tier === "opus" && (answered === "opus" || answered === "fable"))
    return "none";
  return "lead";
}
function currentModel(event, input, env) {
  const asked = (model) => model === null ? null : { model, served: false };
  if (event === "SessionStart")
    return asked(stringField(input.model));
  if (event === "PostModelSwitch") {
    const alias = stringField(input.requested_model);
    const family = alias === null ? undefined : CLAUDE_FAMILIES.find((one) => one === alias);
    return asked(family ?? stringField(input.to_model));
  }
  return sessionModelOf(input, env);
}
function fableSession(input, env, paths) {
  const event = stringField(input.hook_event_name);
  const sessionId = input.session_id;
  if (event === null || !isSessionId(sessionId))
    return SILENT;
  if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0")
    return SILENT;
  const fableMark = sessionMark(env, sessionId, "fable");
  const leadMark = sessionMark(env, sessionId, "lead");
  if (existsSync17(fableMark) && existsSync17(leadMark))
    return SILENT;
  const session = currentModel(event, input, env);
  if (session === null)
    return SILENT;
  const judged = judgedMark(env, sessionId, session.model, session.served);
  if (existsSync17(judged))
    return SILENT;
  const real = resolveSessionModel(session, sessionGatewayOf(paths, env), env);
  const verdict = leadVerdict(real);
  let said = SILENT;
  if (verdict === "fable" && firstTime(fableMark)) {
    said = systemMessage(fableSessionMessage(sessionModelName(real)));
  } else if (verdict === "lead" && resolveLeadHint(paths).value && firstTime(leadMark)) {
    const viaGateway = real.tier === "opus" && !real.claude;
    said = systemMessage(leadHintMessage(sessionModelName(real), viaGateway));
  }
  firstTime(judged);
  return said;
}

// src/hooks/issue-writes.ts
var ISSUE_READS = new Set(["help", "list", "ls", "status", "view"]);
var LABEL_READS = new Set(["help", "list", "ls"]);
var WRITE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
var ISSUES_PATH = /^(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/(?:issues|labels)(?:\/.*)?$/i;
var PULL_REQUEST_MUTATIONS = new Set([
  "createPullRequest",
  "enablePullRequestAutoMerge",
  "markPullRequestReadyForReview",
  "mergePullRequest"
]);
function apiPath(endpoint) {
  return endpoint.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "").replace(/^api\/v3\//i, "");
}
function isGraphql(endpoint) {
  const path = apiPath(endpoint).toLowerCase();
  return path === "graphql" || path.endsWith("/graphql");
}
function graphqlWrite(fields, body) {
  if (body) {
    return "a gh api graphql request that cannot be read (its body comes from a file or standard input)";
  }
  for (const { filled, value } of fields) {
    if (!value.startsWith("query="))
      continue;
    const query = value.slice("query=".length);
    if (query.startsWith("@") || filled) {
      return "a gh api graphql request that cannot be read (its query comes from a file or the shell)";
    }
    if (!/\bmutation\b/i.test(query))
      continue;
    const tokens = query.replace(/#[^\r\n]*|[,\uFEFF]/g, " ");
    const named = [...tokens.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*input\s*:/g)].map((one) => one[1]);
    const issueWrites = named.filter((name) => name !== undefined && !PULL_REQUEST_MUTATIONS.has(name));
    if (named.length > 0 && issueWrites.length === 0)
      continue;
    return issueWrites.length > 0 ? `a gh api graphql mutation (${[...new Set(issueWrites)].join(", ")})` : "a gh api graphql mutation";
  }
  return null;
}
function apiIssueWrite(rest, isFilled) {
  const fields = [];
  let endpoint = null;
  let body = false;
  let method = null;
  const from = (word, value) => ({ filled: isFilled(word), value });
  for (let index = 0;index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      const after = rest[index + 1];
      if (endpoint === null && after !== undefined)
        endpoint = from(after, after);
      break;
    }
    if (word === "-h" || word === "--help")
      return null;
    if (word.startsWith("--")) {
      const at = word.indexOf("=");
      const name = at === -1 ? word : word.slice(0, at);
      if (!API_VALUE_FLAGS.has(name) && !API_PLAIN_FLAGS.has(name))
        return null;
      if (name === "--input")
        body = true;
      const source = at === -1 ? rest[index + 1] ?? "" : word;
      const value = at === -1 ? source : word.slice(at + 1);
      if (name === "--method")
        method = from(source, value);
      if (name === "--field" || name === "--raw-field")
        fields.push(from(source, value));
      if (at === -1 && API_VALUE_FLAGS.has(name))
        index += 1;
      continue;
    }
    if (isShort(word)) {
      const { flags, value: attached, wantsNext } = shortFlags(word, API_VALUE_LETTERS);
      const letter = flags.slice(-1);
      if (letter === "" || !API_VALUE_LETTERS.includes(letter))
        continue;
      const source = wantsNext ? rest[index + 1] ?? "" : word;
      const value = wantsNext ? source : attached;
      if (wantsNext)
        index += 1;
      if (letter === "f" || letter === "F")
        fields.push(from(source, value));
      if (letter === "X")
        method = from(source, value);
      continue;
    }
    endpoint ??= from(word, word);
  }
  if (endpoint === null)
    return null;
  const used = (method?.value ?? (fields.length > 0 || body ? "POST" : "GET")).toUpperCase();
  if (!WRITE_METHODS.has(used) && method?.filled !== true)
    return null;
  if (endpoint.filled) {
    return `a gh api ${used} to an endpoint that cannot be read (${endpoint.value})`;
  }
  if (isGraphql(endpoint.value))
    return graphqlWrite(fields, body);
  const path = apiPath(endpoint.value);
  return ISSUES_PATH.test(path) ? `a gh api ${used} to ${path}` : null;
}
function isHelpAt(words, index) {
  const word = words[index] ?? "";
  if (word !== "-h" && word !== "--help")
    return false;
  const before = words[index - 1] ?? "";
  return !(before.startsWith("-") && !before.includes("="));
}
function aliasWrite(word, rest, aliases, found, depth, named, isFilled) {
  const expansion = aliases?.get(word);
  if (expansion === undefined) {
    if (!found.unnamed.includes(word))
      found.unnamed.push(word);
    return null;
  }
  if (expansion.startsWith("!")) {
    return `a gh alias that runs a shell command (\`gh ${named}\`)`;
  }
  if (depth >= MAX_NESTING) {
    return `a gh alias that expands to further commands (\`gh ${named}\`)`;
  }
  const own = wordsOf(expansion);
  const filled = (text) => own.includes(text) && anyFill(text) || isFilled(text);
  return ghIssueWrite([...own, ...rest], aliases, found, filled, depth + 1, named);
}
function ghIssueWrite(args, aliases, found, isFilled, depth = 0, named = "") {
  const dashes = args.indexOf("--");
  const words = dashes === -1 ? args : args.slice(0, dashes);
  if (words.some((_, index) => isHelpAt(words, index)))
    return null;
  const positional = [];
  for (let index = 0;index < args.length; index++) {
    const word = args[index] ?? "";
    if (word.startsWith("-")) {
      if (!word.includes("=") && word !== "-h" && word !== "--help")
        index += 1;
      continue;
    }
    positional.push(word);
    if (positional.length === 1) {
      const command = word.toLowerCase();
      if (command === "api")
        return apiIssueWrite(args.slice(index + 1), isFilled);
      if (isFilled(word))
        return `a gh command the shell fills in (\`gh ${word}\`)`;
      if (!GH_COMMANDS.has(command)) {
        const rest = args.slice(index + 1);
        const alias = named === "" ? word : named;
        return aliasWrite(word, rest, aliases, found, depth, alias, isFilled);
      }
      if (command !== "issue" && command !== "label")
        return null;
    }
    if (positional.length === 2)
      break;
  }
  const [group, sub] = positional;
  if (sub === undefined)
    return null;
  const name = sub.toLowerCase();
  if (group?.toLowerCase() === "label") {
    return LABEL_READS.has(name) ? null : `gh label ${name}`;
  }
  if (ISSUE_READS.has(name))
    return null;
  if (name === "develop" && args.some((word) => word === "-l" || word === "--list"))
    return null;
  return `gh issue ${name}`;
}
function readLine(command, dialect, aliases) {
  const found = { writes: [], unnamed: [] };
  for (const run of invocationsOf(command, dialect)) {
    if (run.computed || run.program !== "gh")
      continue;
    const write = ghIssueWrite(run.args, aliases, found, fillTest(run.filled));
    if (write !== null && !found.writes.includes(write))
      found.writes.push(write);
  }
  return found;
}
function issueWrites(command, dialect, aliases = null) {
  return readLine(command, dialect, aliases).writes;
}
function issueWritesWithAliases(command, readAliases, dialect) {
  const plain = readLine(command, dialect, null);
  if (plain.unnamed.length === 0)
    return plain;
  const aliases = readAliases();
  if (aliases === null) {
    const words = plain.unnamed.map((word) => `gh ${word}`).join(", ");
    return {
      writes: [...plain.writes, `a gh alias that cannot be read (${words})`],
      unnamed: plain.unnamed
    };
  }
  return readLine(command, dialect, aliases);
}
function computedIssueRisk(command, dialect) {
  return computedInvocationRisk(command, dialect, (words) => words.some((word) => /(?:^|\/)(?:issue|label)s?(?:\/|$)/i.test(word) || /^(?:issue|label)s?$/i.test(word)));
}
function requestsIssueWrite(command, dialect) {
  return issueWrites(command, dialect).length > 0 || computedIssueRisk(command, dialect);
}

// src/hooks/job-route.ts
import { existsSync as existsSync18 } from "fs";

// src/cli/git-bash.ts
import { win32 as win322 } from "path";
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
    const beside = win322.join(win322.dirname(git), "..", "bin", "bash.exe");
    if (facts.exists(beside))
      return { ignoredVariable, path: beside };
  }
  return { ignoredVariable, path: null };
}

// src/jobs/classify.ts
import { isAbsolute as isAbsolute5, join as join25, normalize } from "path";
function runOf(source) {
  return { source, folder: source?.folder ?? null, cache: new Map };
}
function scriptsAt(run) {
  if (run.source === undefined || run.folder === null)
    return null;
  const folder = run.folder;
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
function scriptOnly(call, run) {
  if (call.script === undefined || call.name === "")
    return;
  const scripts = scriptsAt(run);
  return scripts === null ? undefined : scripts.has(call.script);
}
var CD_OPTIONS = new Set(["-L", "-P", "-e", "-@", "--"]);
var COMPUTED_FOLDER = /[$`*?[\]{}~]/;
function folderWord(args) {
  let index = 0;
  while (CD_OPTIONS.has(args[index] ?? ""))
    index++;
  return args[index];
}
function folderAfter(program, args, folder) {
  if (folder === null)
    return null;
  if (program !== "cd" && program !== "chdir" && program !== "pushd")
    return null;
  const target = folderWord(args);
  if (target === undefined || target === "-" || COMPUTED_FOLDER.test(target))
    return null;
  return isAbsolute5(target) ? normalize(target) : normalize(join25(folder, target));
}
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
function firstWord2(args, from, valued) {
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
  const at = (valued, from = 0) => firstWord2(args, from, valued);
  if (["bun", "npm", "pnpm", "yarn"].includes(program)) {
    const index = at(program === "bun" ? BUN_VALUED : program === "pnpm" || program === "yarn" ? PNPM_VALUED : []);
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
        const nameAt = firstWord2(args, index + 1, BUN_VALUED);
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
        const nameAt = firstWord2(rest, 0, []);
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
        const nameAt = firstWord2(rest, 0, []);
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
    const index = firstWord2(args, from, valued);
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
function ruleMatches(rule, call, scriptOnly = false) {
  if ("script" in rule)
    return call.script === rule.script;
  if (scriptOnly)
    return false;
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
function kindOfCall(call, kinds, scriptOnly = false) {
  for (const [name, kind] of Object.entries(kinds)) {
    const heavy = (kind.match ?? []).some((rule) => ruleMatches(rule, call, scriptOnly) && (("script" in rule) || !printsOnly(kind, call.args)));
    if (heavy)
      return name;
  }
  return null;
}
function inspect2(command, kinds, dialect, depth, run) {
  const found = [];
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  for (const step of steps) {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined)
      continue;
    const { program, args } = invocation;
    const plain = withoutRedirections(args);
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    const call = toolOf(program, plain);
    const kind = call === undefined ? null : kindOfCall(call, kinds, scriptOnly(call, run) === true);
    if (kind !== null)
      found.push(kind);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      found.push(...inspect2(inner, kinds, nestedDialect(program), depth + 1, { ...run }));
    }
  }
  return found;
}
function classifyHeavyCommand(command, kinds, source, dialect = "bash") {
  const found = inspect2(command, kinds, dialect, 0, runOf(source));
  return found[0] ?? null;
}
var READS_ONLY = () => true;
var isOption = (arg) => arg.startsWith("-") && arg !== "-";
var isShortCluster = (arg) => /^-[^-]/.test(arg);
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
  let files = 0;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-f" || arg === "-s" || arg === "-w")
      index++;
    else if (!isOption(arg))
      files++;
  }
  return files <= 1;
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
    const expression = /^-[nErsuz]*e(.*)$/s.exec(arg);
    if (expression !== null) {
      const value = expression[1] === "" ? args[++index] : expression[1];
      if (value === undefined)
        return false;
      scripts.push(value);
    } else if (arg === "--expression") {
      const value = args[++index];
      if (value === undefined)
        return false;
      scripts.push(value);
    } else if (arg.startsWith("--expression=")) {
      scripts.push(arg.slice("--expression=".length));
    } else if (/^--line-length=\d+$/.test(arg)) {} else if (arg === "-l" && /^\d+$/.test(args[index + 1] ?? "")) {
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
function awkReadsOnly(args) {
  let program;
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      program = args[index + 1];
      break;
    }
    if (arg === "-F" || arg === "-v")
      index++;
    else if (/^-[Fv]./s.test(arg))
      continue;
    else if (isOption(arg))
      return false;
    else {
      program = arg;
      break;
    }
  }
  return program !== undefined && !/[>|@]|system/.test(program);
}
var READ_ONLY_FILTERS = {
  awk: awkReadsOnly,
  cat: catReadsStdin,
  cut: READS_ONLY,
  egrep: READS_ONLY,
  fgrep: READS_ONLY,
  gawk: awkReadsOnly,
  grep: READS_ONLY,
  head: READS_ONLY,
  mawk: awkReadsOnly,
  nawk: awkReadsOnly,
  rg: rgReadsOnly,
  sed: sedReadsOnly,
  sort: sortReadsOnly,
  tail: READS_ONLY,
  tee: teeWritesNoFile,
  tr: READS_ONLY,
  uniq: uniqReadsOnly,
  wc: READS_ONLY
};
function isReadOnlyFilter(step) {
  if (step.pipedFrom === null || step.pipedFrom.trim() === "" || step.expanded)
    return false;
  const filled = wordsWithFill(step.text, "bash");
  if (filled.length === 0 || filled.some((word) => word.filled))
    return false;
  const words = filled.map((word) => word.text);
  const program = programName(words[0] ?? "");
  const check = READ_ONLY_FILTERS[program];
  if (check === undefined)
    return false;
  const invocation = invocationOf(words);
  if (invocation === undefined || invocation.computed || invocation.prefix.length > 0 || invocation.program !== program) {
    return false;
  }
  if (redirectionTargets(words).some((target) => target !== "/dev/null"))
    return false;
  return check(withoutRedirections(invocation.args));
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
function routableKinds(command, kinds, dialect, depth, run) {
  const found = [];
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  for (const step of steps) {
    const words = wordsOf(step.text, dialect);
    if (words.length === 0 || isAssignmentOnly(words))
      continue;
    const invocation = invocationOf(words);
    if (invocation === undefined)
      return null;
    const { program, args } = invocation;
    const plain = withoutRedirections(args);
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    if (isRunnerProgram(program))
      return null;
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined) {
      if (depth >= MAX_NESTING)
        return null;
      const nested = routableKinds(inner, kinds, nestedDialect(program), depth + 1, {
        ...run
      });
      if (nested === null)
        return null;
      found.push(...nested);
      continue;
    }
    const call = toolOf(program, plain);
    const kind = call === undefined ? null : kindOfCall(call, kinds, scriptOnly(call, run) === true);
    if (kind === null)
      return null;
    found.push(kind);
  }
  return found;
}
function routableLine(bashCommand, kinds, source) {
  const split = splitAtFilters(bashCommand.trim());
  if (split !== null && feedsFiltersAlone(split.heavy)) {
    const kind = routableKinds(split.heavy, kinds, "bash", 0, runOf(source))?.[0];
    return kind === undefined ? null : { filters: split.filters, heavy: split.heavy, kind };
  }
  const kind = routableKinds(bashCommand, kinds, "bash", 0, runOf(source))?.[0];
  return kind === undefined ? null : { filters: "", heavy: bashCommand, kind };
}

// src/jobs/package-scripts.ts
import { readFileSync as readFileSync24 } from "fs";
import { join as join26 } from "path";
function packageScripts(folder) {
  let text;
  try {
    text = readFileSync24(join26(folder, "package.json"), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object")
    return null;
  const scripts = parsed.scripts;
  if (scripts === undefined)
    return new Set;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts))
    return null;
  return new Set(Object.keys(scripts));
}

// src/hooks/bash-judge.ts
import { isAbsolute as isAbsolute6, resolve as resolve8 } from "path";

// src/herdr/machines.ts
import { readFileSync as readFileSync25 } from "fs";
var MachinesSchema = object({
  version: literal(1),
  machines: record(string2(), object({ allow: literal(true).optional(), production: literal(true).optional() }).strict())
}).strict();

class MachinesFileError extends Error {
}
function readMachines(file) {
  let text;
  try {
    text = readFileSync25(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return { version: 1, machines: {} };
    throw new MachinesFileError(`${file} cannot be read: ${error.message}`);
  }
  try {
    return MachinesSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new MachinesFileError(`${file} is not a machine list (${error.message.split(`
`)[0]}). Fix it or remove it.`);
  }
}
function machineRule(list, name) {
  const entry = Object.hasOwn(list.machines, name) ? list.machines[name] : undefined;
  return entry?.production ? "production" : entry?.allow ? "free" : "ask";
}

// src/cli/args.ts
function parseOptions(argv, known, flagNames = [], repeatable = []) {
  const options = new Map;
  const lists = new Map;
  const flags = new Set;
  const positionals = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    index += 1;
    if (arg === "--") {
      positionals.push(...argv.slice(index));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (flagNames.includes(name)) {
      if (equals !== -1)
        return { error: `${name} takes no value` };
      if (flags.has(name))
        return { error: `${name} is given twice` };
      flags.add(name);
      continue;
    }
    if (!known.includes(name))
      return { error: `Unknown option: ${arg}` };
    let value;
    if (equals === -1) {
      value = argv[index];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === "" || equals === -1 && value.startsWith("--")) {
      return { error: `${name} needs a value` };
    }
    if (repeatable.includes(name)) {
      const values = lists.get(name) ?? [];
      values.push(value);
      lists.set(name, values);
      continue;
    }
    if (options.has(name))
      return { error: `${name} is given twice` };
    options.set(name, value);
  }
  return { flags, lists, options, positionals };
}

// src/herdr/words.ts
var RELAY_MESSAGE_LIMIT = 800;
var RELAY_TRANSPORT_CUT_MIN_BYTES = 2048 - 4 + 1;
function relayMessageLength(text) {
  return text.length;
}
var MODE_ORDER = ["plan", "default", "acceptEdits", "auto", "dontAsk"];
function normalizeMode(mode) {
  const value = mode === "manual" ? "default" : mode;
  return MODE_ORDER.find((one) => one === value) ?? null;
}
function modeWiderThan(a, b) {
  return MODE_ORDER.indexOf(a) > MODE_ORDER.indexOf(b);
}
function childModeAllowed(lead, child) {
  if (lead === "bypassPermissions" || child === "bypassPermissions")
    return { ok: false, why: "bypassPermissions is never allowed." };
  const parent = normalizeMode(lead), next = normalizeMode(child);
  if (!parent)
    return { ok: false, why: "Unknown lead mode: ask the person." };
  if (parent === "plan")
    return { ok: false, why: "Approve the plan first." };
  if (!next)
    return { ok: false, why: "Unknown child mode: ask the person." };
  if (modeWiderThan(next, parent))
    return { ok: false, why: "The child mode is wider than the lead mode." };
  return { ok: true };
}
var HERDR_VERBS = [
  "start",
  "list",
  "send",
  "answer",
  "wait",
  "report",
  "adopt",
  "stop",
  "machines"
];
var USAGE_LINES = {
  start: `start --model <${CLAUDE_FAMILIES.join("|")}> --effort <${ALLOWED_EFFORTS.join("|")}> --mode <${MODE_ORDER.join("|")}|manual> [--cwd <dir>] [--on <machine>] [--name <name>] [--task <#n>] [--independent] [--asked] -- <brief>`,
  list: "list [--all] [--json]",
  send: "send <terminal> <text>",
  answer: "answer <terminal> --expect <msg> --expect-turn <n> (--option <k> | --text <words>)",
  wait: "wait [--any | --all] [--timeout <seconds>] [--seen <addr>:<turn|?>:<blocked|error|done|end>[,\u2026]]",
  report: "report <text>",
  adopt: "adopt",
  stop: "stop <terminal>",
  machines: "machines [list | allow <name> | forget <name> | production <name>]"
};
var HERDR_USAGE = HERDR_VERBS.map((verb) => `Usage: ${COMMAND} herdr ${USAGE_LINES[verb]}`).join(`
`);
function parseHerdrArgs(args) {
  const verb = HERDR_VERBS.find((v) => v === args[0]);
  const fail = (why) => ({
    error: `${why}
${verb ? `Usage: ${COMMAND} herdr ${USAGE_LINES[verb]}` : HERDR_USAGE}`
  });
  if (!verb)
    return fail("Choose a herdr verb.");
  const rest = args.slice(1);
  if (verb === "start") {
    const split = rest.indexOf("--");
    if (split < 0)
      return fail("Put -- before the brief.");
    const parsed = parseOptions(rest.slice(0, split), ["--model", "--effort", "--mode", "--cwd", "--on", "--name", "--task"], ["--independent", "--asked"]);
    if ("error" in parsed)
      return fail(parsed.error);
    const { options: o, flags: f, positionals: p } = parsed;
    const model = CLAUDE_FAMILIES.find((v) => v === o.get("--model")), effort = ALLOWED_EFFORTS.find((v) => v === o.get("--effort")), mode = normalizeMode(o.get("--mode") ?? "");
    const brief = rest.slice(split + 1).join(" ");
    if (!model || !effort || !mode || p.length || !brief.trim())
      return fail("Give a valid model, effort, mode and brief.");
    const independent = f.has("--independent"), task = o.get("--task"), name = o.get("--name");
    if (task && independent)
      return fail("An independent session cannot have a task.");
    if (task && !/^#[1-9]\d*$/.test(task))
      return fail("Use a task reference such as #7.");
    if (name && !validChildName(name))
      return fail("A name needs 1\u201332 lower-case letters, digits, - or _.");
    for (const [key, value] of o)
      if (!value.trim())
        return fail(`${key} needs a value.`);
    const cwd = o.get("--cwd"), on = o.get("--on");
    return {
      verb,
      model,
      effort,
      mode,
      independent,
      asked: f.has("--asked"),
      brief,
      ...cwd !== undefined ? { cwd } : {},
      ...on !== undefined ? { on } : {},
      ...name ? { name } : {},
      ...task ? { task } : {}
    };
  }
  const known = verb === "answer" ? ["--expect", "--expect-turn", "--option", "--text"] : verb === "wait" ? ["--timeout", "--seen"] : [];
  const flags = verb === "list" ? ["--all", "--json"] : verb === "wait" ? ["--any", "--all"] : [];
  const parsed = parseOptions(rest, known, flags);
  if ("error" in parsed)
    return fail(parsed.error);
  const { options: o, flags: f, positionals: p } = parsed;
  if (p.some((s) => !s.trim()))
    return fail("Arguments must not be empty.");
  const target = p[0] ?? "";
  switch (verb) {
    case "list":
      return p.length ? fail("list takes no arguments.") : { verb, all: f.has("--all"), json: f.has("--json") };
    case "wait": {
      const timeout = o.get("--timeout");
      const cursor = o.get("--seen");
      const seen = {};
      if (cursor !== undefined)
        for (const pair of cursor.split(",")) {
          const match = /^([^:]+):(\d+|\?):(blocked|error|done|end)$/.exec(pair);
          if (!match?.[1] || !match[2] || !match[3])
            return fail("--seen needs address:turn:state entries.");
          let address;
          try {
            address = decodeURIComponent(match[1]);
          } catch {
            return fail("--seen has an invalid encoded address.");
          }
          if (!address || Object.hasOwn(seen, address) || match[2] !== "?" && !Number.isSafeInteger(Number(match[2])))
            return fail("--seen needs unique addresses and safe turn numbers.");
          const state = match[3];
          if (state !== "blocked" && state !== "error" && state !== "done" && state !== "end")
            return fail("Unknown cursor state.");
          seen[address] = { turn: match[2] === "?" ? null : Number(match[2]), state };
        }
      if (timeout !== undefined && (!/^\d+$/.test(timeout) || !Number.isSafeInteger(Number(timeout) * 1000) || Number(timeout) <= 0))
        return fail("A timeout needs a positive whole number of seconds.");
      return p.length || f.has("--all") && f.has("--any") ? fail("Choose either --any or --all.") : {
        verb,
        ...cursor === undefined ? {} : { seen },
        mode: f.has("--all") ? "all" : "any",
        ...timeout === undefined ? {} : { timeoutMs: Number(timeout) * 1000 }
      };
    }
    case "adopt":
      return p.length ? fail("adopt takes no arguments.") : { verb };
    case "stop":
      return p.length === 1 ? { verb, target } : fail("Give one terminal.");
    case "send":
      return p.length === 2 ? { verb, target, text: p[1] ?? "" } : fail("Give a terminal and text.");
    case "report":
      return p.length === 1 ? { verb, text: target } : fail("Give the report text.");
    case "answer": {
      const expect = o.get("--expect"), turn = o.get("--expect-turn"), option = o.get("--option"), text = o.get("--text");
      if (p.length !== 1 || !expect || !turn || !/^\d+$/.test(turn) || !Number.isSafeInteger(Number(turn)) || o.has("--option") === o.has("--text") || !(option ?? text)?.trim())
        return fail("Give the terminal, expected message and turn, and one answer.");
      const common = { verb, target, expect, expectTurn: Number(turn) };
      return option !== undefined ? { ...common, option } : { ...common, text: text ?? "" };
    }
    case "machines": {
      const action = p[0] ?? "list";
      if (action === "list")
        return p.length <= 1 ? { verb, action } : fail("machines list takes no name.");
      if ((action === "allow" || action === "forget" || action === "production") && p.length === 2)
        return { verb, action, name: p[1] ?? "" };
      return fail("Choose a machines action and its name.");
    }
  }
}

// src/hooks/kit-invocation.ts
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
var KIT_TOKEN = new RegExp(`(^|[^\\w.-])${COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.(?:exe|cmd|ps1|bat))?(?=$|[^\\w.\\-/\\\\])`, "i");
var PATH_BREAKS = /[\s"'`=;&|<>()]+/;
function namesKit(text) {
  return KIT_TOKEN.test(text) || text.split(PATH_BREAKS).some((piece) => KIT_BUNDLE.test(piece));
}
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

// src/hooks/bash-judge.ts
var CLAUDE_VALUED = [
  "--add-dir",
  "--agent",
  "--agents",
  "--allowedTools",
  "--allowed-tools",
  "--append-system-prompt",
  "--autocompact",
  "--betas",
  "--debug-file",
  "--disallowedTools",
  "--disallowed-tools",
  "--effort",
  "--environment",
  "--fallback-model",
  "--file",
  "--input-format",
  "--json-schema",
  "--max-budget-usd",
  "--mcp-config",
  "--model",
  "--output-format",
  "--permission-mode",
  "--permission-prompts",
  "--plugin-dir",
  "--plugin-url",
  "--remote-control-session-name-prefix",
  "--session-id",
  "--setting-sources",
  "--settings",
  "--system-prompt",
  "--tools",
  "-n",
  "--name"
];
function hasFlag2(args, ...names) {
  return args.some((arg) => names.includes(arg) || arg.startsWith("--") && names.some((name) => arg.startsWith(`${name}=`)));
}
function optionValue(args, name) {
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === name)
      return args[index + 1] ?? null;
    if (arg.startsWith(`${name}=`))
      return arg.slice(name.length + 1);
  }
  return null;
}
function positionalsOf(args, valued) {
  const found = [];
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      found.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && valued.includes(arg))
        index++;
      continue;
    }
    found.push(arg);
  }
  return found;
}
function claudeLaunch(step) {
  if (step.program !== "claude")
    return null;
  const bg = hasFlag2(step.args, "--bg", "--background");
  const print = hasFlag2(step.args, "-p", "--print");
  if (!bg && !print)
    return null;
  return {
    effort: optionValue(step.args, "--effort"),
    form: bg ? "bg" : "print",
    model: optionValue(step.args, "--model"),
    prompt: positionalsOf(step.args, CLAUDE_VALUED).join(" ")
  };
}
function kitWordsOf(step) {
  if (!step.computed)
    return kitArguments(step.program, withoutRedirections(step.args));
  return withoutRedirections(step.words);
}
function kitWordAt(words, step, word) {
  if (words[0] === word)
    return 0;
  return step.computed ? words.indexOf(word) : -1;
}
function asksHelp(words) {
  for (const word of words) {
    if (word === "--")
      return false;
    if (word === "-h" || word === "--help")
      return true;
  }
  return false;
}
function isWorkflowPropose(step, lineNamesKit) {
  const words = kitWordsOf(step);
  if (words === null)
    return false;
  const at = kitWordAt(words, step, "workflow");
  if (at === -1 || asksHelp(words.slice(at + 1)))
    return false;
  const sub = words[at + 1];
  if (sub === "propose")
    return true;
  if (sub !== undefined && !isComputedWord(sub))
    return false;
  return !step.computed || lineNamesKit;
}
function proposalOf(step, moved) {
  if (step.computed)
    return { unread: "the program is worked out when the line runs" };
  const words = kitWordsOf(step) ?? [];
  const at = kitWordAt(words, step, "workflow");
  const sub = words[at + 1];
  if (sub === undefined)
    return { unread: "the line names no subcommand" };
  if (sub !== "propose")
    return { unread: "the subcommand is worked out when the line runs" };
  const flag = words.indexOf("--folder", at + 2);
  const folder = flag === -1 ? null : words[flag + 1] ?? "";
  if (folder !== null && (folder === "" || isComputedWord(folder))) {
    return { unread: "its --folder is worked out when the line runs" };
  }
  if (moved && (folder === null || !isAbsolute6(folder))) {
    return { unread: "the line changes its folder before it" };
  }
  return { folder };
}
function isJobRun(program, args) {
  return program === COMMAND && args[0] === "job" && args[1] === "run";
}
function walk(line, dialect, depth, all) {
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const words = wordsOf(step.text, dialect);
    if (words.length === 0)
      continue;
    const invocation = invocationOf(words);
    if (invocation === undefined)
      continue;
    all.push({
      args: invocation.args,
      computed: invocation.computed,
      program: invocation.program,
      words
    });
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      walk(inner, nestedDialect(invocation.program), depth + 1, all);
    }
  }
}
function computedLaunch(step) {
  if (!step.computed)
    return null;
  const lower = step.words.map((word) => word.toLowerCase());
  const bg = lower.some((word) => word === "--bg" || word === "--background");
  const print = lower.some((word) => word === "-p" || word === "--print") && lower.some((word) => word.includes("claude"));
  if (!bg && !print)
    return null;
  return {
    effort: optionValue(step.args, "--effort"),
    form: bg ? "bg" : "print",
    model: optionValue(step.args, "--model"),
    prompt: positionalsOf(step.args, CLAUDE_VALUED).join(" ")
  };
}
function readBash(command, dialect = "bash") {
  const steps = [];
  walk(command, dialect, 0, steps);
  let workflowPropose = false;
  const proposals = [];
  const moved = steps.some((step) => CHANGE_DIR.has(step.program));
  const lineNamesKit = namesKit(command);
  const launches = [];
  for (const step of steps) {
    if (isWorkflowPropose(step, lineNamesKit)) {
      workflowPropose = true;
      proposals.push(proposalOf(step, moved));
    }
    const launch = claudeLaunch(step) ?? computedLaunch(step);
    if (launch !== null)
      launches.push(launch);
  }
  const invocations = invocationsOf(command, dialect);
  const namesHerdr = shellSteps(command, { dialect, blindWhenOpen: true, joinLines: true }).some((step) => wordsOf(step.text, dialect).some((word) => word.split(/[=\s()]+/).some((token) => ["hc", "herdr-app"].includes(token) || token === "herdr" && namesKit(command)))) || invocations.some((one) => one.program === "hc" || one.program === "herdr-app");
  return {
    launches,
    proposals,
    steps,
    workflowPropose,
    invocations,
    namesHerdr,
    identityAssigned: assignsHerdrIdentity(command, dialect)
  };
}
var BACKGROUND_LAUNCH_REASON = [
  "This starts a raw background session (`claude --bg`): it runs beside this session, nobody watches it, and it reports to nobody.",
  "Build the work with subagents instead (the Agent tool): each one reports back to the session that started it."
].join(`
`);
function proposeActs(base) {
  const into = base === null ? "the project's integration base (worktrees.base)" : `\`${base}\``;
  return `This runs \`${COMMAND} workflow propose\`: it pushes a new branch to origin and opens a pull request into ${into} that is ready for review, in child processes no hook sees, so the git and merge guards never ask about either.`;
}
var APPROVE_IF_MEANT = "Approve it if you meant it.";
function cannotTellProject(why) {
  return `${proposeActs(null)}
${COMMAND} cannot tell which project's workflow this line proposes into (${why}), so it cannot read the gate. ${APPROVE_IF_MEANT}`;
}
function proposeQuestion(folder, context, timeFor) {
  let checkout;
  let base;
  try {
    checkout = locateCheckout(folder, { env: context.env, timeFor });
    if (checkout === null)
      return cannotTellProject(`${folder} is not in a git project`);
    base = loadProjectConfig(checkout).config?.worktrees?.base ?? null;
  } catch (error) {
    return cannotTellProject(checkoutFailure(error));
  }
  const acts = proposeActs(base);
  try {
    const read = resolveGate(context.paths, checkout, base, {
      env: context.env,
      timeFor,
      timeoutMs: GUARD_GIT_TIMEOUT_MS
    });
    if (!read.ok) {
      return `${acts}
${COMMAND} cannot tell whether the push and the pull request are allowed: the workflow committed on ${base} cannot be read (${read.why}). ${APPROVE_IF_MEANT}`;
    }
    const { autoPush, openPr } = read.gate.resolved;
    const off = [];
    if (!autoPush.value)
      off.push(`autoPush is off (${sourceLabel(autoPush, base)})`);
    if (openPr.value !== "ready") {
      off.push(`openPr is ${openPr.value} (${sourceLabel(openPr, base)})`);
    }
    if (off.length === 0)
      return null;
    return `${acts}
${off.join(", and ")}, so the push and the pull request are yours to approve. ${APPROVE_IF_MEANT}`;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `${acts}
${COMMAND} cannot tell whether the push and the pull request are allowed: the workflow settings cannot be read (${why}). ${APPROVE_IF_MEANT}`;
  }
}
function judgeProposals(proposals, context) {
  const cwd = stringField(context.input.cwd);
  const { timeFor } = startBudget(context.env, Date.now, SHORT_GUARD_BUDGET_MS, context.startedAtMs);
  let question = null;
  for (const proposal of proposals) {
    if ("unread" in proposal) {
      question = cannotTellProject(proposal.unread);
    } else if (cwd === null) {
      question = cannotTellProject("the call names no folder");
    } else {
      question = proposeQuestion(proposal.folder === null ? cwd : resolve8(cwd, proposal.folder), context, timeFor);
    }
    if (question !== null)
      break;
  }
  if (question === null)
    return null;
  if (!isAttended(context.env)) {
    return {
      decision: "deny",
      reason: `${question}
Nobody answers a question in \`claude -p\`, so the proposal is refused.`,
      why: "propose"
    };
  }
  return { decision: "ask", reason: question, why: "propose" };
}
var PRINT_FORM = "This Bash command starts a Claude Code session in print mode (`claude -p`), and the launch policy judges its model and effort like any Agent launch: name them as `--model <model> --effort <effort>`.";
function judgeClaudeLaunch(launch, context) {
  if (launch.form === "bg") {
    if (!isAttended(context.env)) {
      return {
        decision: "deny",
        reason: `${BACKGROUND_LAUNCH_REASON}
Nobody answers a question in \`claude -p\`, so the raw launch is refused.`,
        why: "bg"
      };
    }
    return { decision: "ask", reason: BACKGROUND_LAUNCH_REASON, why: "bg" };
  }
  const guard = readGuardContext(context.paths, context.input, context.env);
  const verdict = judgeLaunch({
    effort: launch.effort,
    fork: false,
    model: launch.model,
    prompt: launch.prompt,
    subagentType: "general-purpose",
    tool: PRINT_RUN
  }, guard, context.env);
  if (verdict.decision === "allow")
    return null;
  return { decision: verdict.decision, reason: `${PRINT_FORM}
${verdict.reason}`, why: "print" };
}
function powershellIdentity(command) {
  return [
    /\$\{?env:hc_terminal_id\}?\s*\+?=(?!=)/i,
    /\b(?:set-item|si|new-item|ni|set-content|add-content|copy-item|rename-item|move-item)\b[^\n;|]*\benv:[\\/]?hc_terminal_id\b/i,
    /\bSetEnvironmentVariable\s*\(\s*['"]HC_TERMINAL_ID['"]/i,
    /\brename-item\b[^\n;|]*\benv:[^\n;|]*\s+['"]?HC_TERMINAL_ID\b/i
  ].some((pattern) => pattern.test(command));
}
function assignsHerdrIdentity(command, dialect, depth = 0) {
  if (dialect === "powershell" && powershellIdentity(command))
    return true;
  const assigned = (word) => /^HC_TERMINAL_ID(?:\+?=|$)/.test(word);
  return shellSteps(command, { dialect, blindWhenOpen: true, joinLines: true }).some((step) => {
    const words = wordsOf(step.text, dialect);
    if (["for", "select"].includes(words[0] ?? "") && assigned(words[1] ?? ""))
      return true;
    const invocation = invocationOf(words);
    if (words[0] === "HC_TERMINAL_ID" && words[1] === "=")
      return true;
    if (invocation === undefined)
      return words.some(assigned);
    const { program, args, prefix } = invocation;
    if (prefix.some((word) => /^HC_TERMINAL_ID\+?=/.test(word)) || ["export", "declare", "typeset", "local", "readonly"].includes(program) && args.some(assigned) || program === "printf" && args.some((word, at) => word === "-v" && assigned(args[at + 1] ?? "") || word.startsWith("-v") && assigned(word.slice(2))) || program === "let" && args.some((word) => /^HC_TERMINAL_ID\s*(?:\+?=|$)/.test(word)) || program === "getopts" && args.some(assigned) || ["declare", "typeset", "local"].includes(program) && args.some((word) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word)) && args.some((word) => word.split("=")[1] === "HC_TERMINAL_ID") || ["read", "mapfile", "readarray"].includes(program) && args.some(assigned))
      return true;
    const inner = nestedCommand(program, args, step.pipedFrom);
    return inner !== undefined && depth < MAX_NESTING && assignsHerdrIdentity(inner, nestedDialect(program), depth + 1);
  });
}
function herdrArguments(one, reading) {
  const args = kitArguments(one.program, withoutRedirections(one.args));
  if (args?.[0] === "herdr")
    return args.slice(1);
  if (one.computed) {
    const at = one.args.indexOf("herdr");
    if (at >= 0 && (reading.namesHerdr || HERDR_VERBS.includes(one.args[at + 1] ?? "")))
      return one.args.slice(at + 1);
  }
  return null;
}
function herdrDomain(reading) {
  return reading.invocations.some((one) => one.program === "hc" || one.program === "herdr-app" || one.computed && reading.namesHerdr || herdrArguments(one, reading) !== null);
}
function herdrExcerpt(text) {
  const excerpt = text.slice(0, RELAY_MESSAGE_LIMIT);
  const points = Array.from(excerpt);
  const quoted = points.map((char) => /[\p{Cc}\p{Cf}]/u.test(char) ? Array.from({ length: char.length }, (_, i) => `\\u${char.charCodeAt(i).toString(16).padStart(4, "0")}`).join("") : JSON.stringify(char).slice(1, -1)).join("");
  return `"${quoted}"${relayMessageLength(text) > RELAY_MESSAGE_LIMIT ? "\u2026" : ""}`;
}
function judgeHerdr(reading, context) {
  if (!herdrDomain(reading))
    return null;
  const verdict = (decision, reason) => ({
    decision,
    reason,
    why: "herdr"
  });
  if (reading.identityAssigned)
    return verdict("deny", "Do not set HC_TERMINAL_ID: Herdr supplies the terminal identity.");
  let ask = null;
  const hasAnswer = reading.steps.some((step) => herdrArguments(step, reading)?.[0] === "answer");
  if (reading.invocations.some((one) => herdrArguments(one, reading)?.[0] === "answer" && one.filled.length > 0))
    return verdict("deny", "Pass the exact prompt msg literally in single quotes; do not let the shell fill any herdr answer words.");
  if (reading.steps.some((step) => herdrArguments(step, reading)?.[0] === "answer" && step.words[0] !== COMMAND && !step.words[0]?.endsWith(`/${COMMAND}`)))
    return verdict("deny", "Run herdr answer directly, with no wrapper, so one approval sends one answer.");
  if (hasAnswer && reading.steps.length > 1)
    return verdict("deny", "Run herdr answer as the only step on its Bash line so the person approves exactly one answer.");
  const remember = (reason) => {
    ask ??= isAttended(context.env) ? verdict("ask", reason) : verdict("deny", `${reason}
Nobody answers a question in \`claude -p\`; run this in an interactive session.`);
  };
  const remoteRead = (machine) => {
    try {
      const rule = machineRule(readMachines(context.paths.machinesFile), machine);
      if (rule !== "free")
        remember(`Approve Herdr read on ${machine}: ${rule === "production" ? "this is a production machine" : "this machine is not allowlisted"}.`);
    } catch (error) {
      remember(`Cannot read the Herdr machine rules: ${error instanceof Error ? error.message : String(error)} Approve this remote read only if you meant it.`);
    }
  };
  for (const one of reading.invocations) {
    if (one.computed && reading.namesHerdr) {
      remember("This line computes a Herdr program at run time. Approve it only if you meant it.");
      continue;
    }
    const args = withoutRedirections(one.args);
    if (["export", "declare", "typeset", "local", "readonly"].includes(one.program) && args.some(isComputedWord))
      remember("This line computes an environment assignment on a Herdr line. Approve only if it does not change HC_TERMINAL_ID.");
    if (one.program === "herdr-app" && args[0] === "do") {
      return verdict("deny", `Raw herdr-app do is not allowed. Use ${COMMAND} herdr start, send, answer or stop instead.`);
    }
    if (one.program === "hc") {
      const raw = [...args];
      while (raw[0] === "--json")
        raw.shift();
      const [verb, sub] = raw;
      if (raw.length === 1 && ["--version", "-V", "--skill", "--help", "-h"].includes(verb ?? ""))
        continue;
      if (raw.length === 2 && !verb?.startsWith("-") && ["--help", "-h"].includes(sub ?? ""))
        continue;
      const read = ["ls", "get", "read", "wait", "templates", "schema"].includes(verb ?? "") || verb === "machine" && sub === "ls" || verb === "file" && sub === "read" || verb === "server" && sub === "status";
      const machine = optionValue(raw.slice(0, raw.indexOf("--") < 0 ? undefined : raw.indexOf("--")), "--on");
      if (verb === "file" && sub === "read" && machine)
        remoteRead(machine);
      const terminalArgs = raw.slice(1);
      const addresses = ["read", "get", "wait"].includes(verb ?? "") ? [
        ...positionalsOf(terminalArgs, [
          "--lines",
          "--children",
          "--output",
          "--timeout"
        ]).slice(0, 1),
        ...verb === "wait" ? [optionValue(terminalArgs, "--children")] : []
      ] : verb === "events" ? [optionValue(terminalArgs, "--terminal"), optionValue(terminalArgs, "--children-of")] : [];
      for (const address of addresses) {
        const slash = address?.indexOf("/") ?? -1;
        if (address && slash > 0)
          remoteRead(address.slice(0, slash));
      }
      if (verb === "events") {
        const input = context.input.tool_input;
        if (typeof input === "object" && input !== null && "run_in_background" in input && input.run_in_background === true)
          continue;
        return verdict("deny", `hc events never ends: run it in the background or use ${COMMAND} herdr wait.`);
      }
      if (read)
        continue;
      const fix = verb === "run" ? "herdr start" : verb === "send" || verb === "keys" ? "herdr send or herdr answer" : verb === "kill" || verb === "rm" ? "herdr stop" : verb === "label" ? "herdr adopt" : verb === "attach" ? "herdr send or herdr answer" : "job run for a background program (or a guarded herdr verb)";
      return verdict("deny", `Raw hc ${verb ?? "write"} is not allowed. Use ${COMMAND} ${fix}.`);
    }
    const herdr = herdrArguments(one, reading);
    if (herdr === null || herdr.length === 2 && ["--help", "-h"].includes(herdr[1] ?? ""))
      continue;
    if (herdr[0] === "answer") {
      const parsed = parseHerdrArgs(herdr);
      const detail = !("error" in parsed) && parsed.verb === "answer" ? `${herdrExcerpt(parsed.target)}: ${parsed.option !== undefined ? `option ${herdrExcerpt(parsed.option)}` : `text ${herdrExcerpt(parsed.text ?? "")}`}; expected prompt ${herdrExcerpt(parsed.expect)}` : herdrExcerpt(herdr.slice(1).join(" "));
      remember(`Approve the answer to Herdr child ${detail}. Only the person may answer a permission prompt.`);
      continue;
    }
    if (herdr[0] === "machines") {
      const parsed = parseHerdrArgs(herdr);
      if (!("error" in parsed) && parsed.verb === "machines" && parsed.action === "list")
        continue;
      remember(`Approve this Herdr machine rule change: ${herdr.slice(1).join(" ")}.`);
      continue;
    }
    if (herdr[0] !== "start")
      continue;
    if (!isAttended(context.env))
      return verdict("deny", "Nobody answers or watches a Herdr session started by `claude -p`; its reports would reach nobody. Start it from an interactive session.");
    const flags = herdr.slice(1, herdr.indexOf("--") < 0 ? undefined : herdr.indexOf("--"));
    if (optionValue(flags, "--mode") === "bypassPermissions")
      return verdict("deny", "bypassPermissions is never allowed.");
    const parsed = parseHerdrArgs(herdr);
    if ("error" in parsed)
      return verdict("deny", `Pass both --model and --effort, plus --mode, to herdr start.
${parsed.error}`);
    if (parsed.verb !== "start")
      continue;
    const lead = stringField(context.input.permission_mode) ?? "";
    if (lead === "bypassPermissions")
      return verdict("deny", "The lead's own mode is bypassPermissions, which is never allowed. Change the lead mode before starting a child.");
    const mode = childModeAllowed(lead, parsed.mode);
    if (!mode.ok) {
      const reason = `${mode.why} Lead mode: ${lead || "unknown"}; child mode: ${parsed.mode}.`;
      if (!normalizeMode(lead) && lead !== "bypassPermissions")
        remember(reason);
      else
        return verdict("deny", reason);
    }
    const launch = judgeLaunch({
      tool: HERDR_START,
      fork: false,
      model: parsed.model,
      effort: parsed.effort,
      prompt: parsed.brief,
      subagentType: null
    }, readGuardContext(context.paths, context.input, context.env), context.env);
    if (launch.decision === "deny")
      return verdict("deny", launch.reason);
    if (launch.decision === "ask")
      remember(launch.reason);
    if (parsed.on) {
      try {
        const rule = machineRule(readMachines(context.paths.machinesFile), parsed.on);
        if (rule !== "free")
          remember(`Approve Herdr start on ${parsed.on}: ${rule === "production" ? "this is a production machine" : "this machine is not allowlisted"}.`);
      } catch (error) {
        remember(`Cannot read the Herdr machine rules: ${error instanceof Error ? error.message : String(error)} Approve this remote launch only if you meant it.`);
      }
    }
  }
  return ask;
}
function judgeBash(reading, context) {
  let ask = judgeHerdr(reading, context);
  if (ask?.decision === "deny")
    return ask;
  if (reading.proposals.length > 0) {
    const proposed = judgeProposals(reading.proposals, context);
    if (proposed?.decision === "deny")
      return proposed;
    ask ??= proposed;
  }
  for (const launch of reading.launches) {
    const verdict = judgeClaudeLaunch(launch, context);
    if (verdict === null)
      continue;
    if (verdict.decision === "deny")
      return verdict;
    ask ??= verdict;
  }
  return ask;
}
function judgeAnswer(verdict) {
  return toolDecision(verdict.decision, verdict.reason);
}
function commandOf(input) {
  const fields = input.tool_input;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields))
    return null;
  return stringField(fields.command);
}
function judgedDomain(reading) {
  return reading.launches.length > 0 || reading.workflowPropose || herdrDomain(reading);
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
function routeHeavyCommand(command, kinds, shell, source) {
  if (runsJobRun(command))
    return null;
  const line = routableLine(command, kinds, source);
  if (line === null)
    return null;
  const queued = jobRunCommand(line.kind, line.heavy, shell);
  return {
    command: line.filters === "" ? queued : `${queued} ${line.filters}`,
    kind: line.kind
  };
}
var REWRITE_SUPPORTED = true;
function rewriteAnswer(fields, command) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...fields, command } }
    })
  };
}
function bashToolExists(env, platform = process.platform, facts = {
  exists: existsSync18,
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
  return words.map(shellWord2).join(" ");
}
function powerShellDenial(command, kinds, source) {
  const kind = classifyHeavyCommand(command, kinds, source, "powershell");
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
function routeDenial(routed) {
  return toolDecision("deny", [
    `This is a heavy command (${routed.kind}): running it raw does not wait for a free slot, and many heavy runs at once have run machines out of memory.`,
    "Run it through the queue instead:",
    routed.command
  ].join(`
`));
}
function routesHeavyCommands(context) {
  return resolveJobRoute(context.paths, context.project.config).value;
}
function judgeCommandAnswer(input, context) {
  const command = commandOf(input);
  if (command === null)
    return null;
  const verdict = judgeBash(readBash(command, inputDialect(input)), {
    env: context.env,
    input,
    paths: context.paths,
    startedAtMs: context.nowMs
  });
  return verdict === null ? null : judgeAnswer(verdict);
}
function inputDialect(input) {
  return dialectOfTool(input.tool_name) ?? "bash";
}
function jobRoute(context, bashTool = bashToolExists) {
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null)
    return SILENT;
  const dialect = inputDialect(context.input);
  const verdict = judgeBash(readBash(command, dialect), {
    env: context.env,
    input: context.input,
    paths: context.paths,
    startedAtMs: context.nowMs
  });
  if (verdict !== null)
    return judgeAnswer(verdict);
  const kinds = mergeKinds(context.project.config?.jobs?.kinds);
  const source = { folder: context.cwd, scriptsIn: packageScripts };
  if (dialect !== "bash") {
    if (!routesHeavyCommands(context))
      return SILENT;
    const refused = powerShellDenial(command, kinds, source);
    return refused !== null && bashTool(context.env) ? refused : SILENT;
  }
  const routed = routesHeavyCommands(context) ? routeHeavyCommand(command, kinds, routedShell(context.env), source) : null;
  if (routed === null)
    return SILENT;
  return REWRITE_SUPPORTED ? rewriteAnswer(fields, routed.command) : routeDenial(routed);
}
function jobRouteConfigAnswer(message, input, context) {
  const judged = judgeCommandAnswer(input, context);
  if (judged !== null)
    return judged;
  const command = commandOf(input);
  const dialect = inputDialect(input);
  if (command === null || classifyHeavyCommand(command, mergeKinds(undefined), undefined, dialect) === null || dialect !== "bash" && !bashToolExists(context.env)) {
    return SILENT;
  }
  return toolDecision("ask", `cc-smart-dev-kit cannot check whether this project routes heavy commands through its job queue: ${message}`);
}
function jobRouteOutsideGit(input, context) {
  return judgeCommandAnswer(input, context) ?? SILENT;
}
function jobRouteDomain(input) {
  const command = commandOf(input);
  if (command === null)
    return false;
  const dialect = inputDialect(input);
  if (judgedDomain(readBash(command, dialect)))
    return true;
  return classifyHeavyCommand(command, mergeKinds(undefined), undefined, dialect) !== null;
}
function routeFacts(input, context) {
  const command = commandOf(input);
  if (command === null)
    return {};
  const reading = readBash(command, inputDialect(input));
  const verdict = judgeBash(reading, {
    env: context.env,
    input,
    paths: context.paths,
    startedAtMs: context.nowMs
  });
  const facts = { job_run: runsJobRun(command) };
  if (reading.launches.length > 0)
    facts.launches = reading.launches.map((one) => one.form);
  if (reading.workflowPropose)
    facts.workflow_propose = true;
  if (verdict !== null) {
    facts.decision = verdict.decision;
    facts.why = verdict.why;
  }
  return facts;
}

// src/tasks/work/phases.ts
var NOTHING_OPEN = { inProgress: [], ready: [] };
function refOf(task) {
  const agent = task.agent?.trim() || null;
  return { number: task.number, subject: task.subject, plan: task.plan, agent };
}
function isPhase(task) {
  return task.kind === "phase" && task.plan !== null && task.phase !== null;
}
function openPhasesOf(paths, project, caller) {
  const read = readWorkStore(paths, (db) => allTasks(db, project));
  if (read.state !== "ready")
    return read;
  const all = read.value;
  const phases = all.filter(isPhase);
  if (!phases.some((t) => t.status === "in_progress")) {
    return { state: "ready", value: NOTHING_OPEN };
  }
  const who = caller();
  if (who === null)
    return { state: "ready", value: NOTHING_OPEN };
  const mine = new Set(all.flatMap((t) => t.plan !== null && claimHeldBy(t.claim, who) ? [t.plan] : []));
  const own = phases.filter((t) => mine.has(t.plan));
  const inProgress = own.filter((t) => t.status === "in_progress");
  const busy = new Set(inProgress.map((t) => t.plan));
  const byId = new Map(all.map((t) => [t.id, t]));
  const hasSteps = (phase) => all.some((t) => t.parentId === phase.id && t.status !== "dropped");
  const ready = own.filter((t) => t.status === "pending" && busy.has(t.plan) && !isBlocked(t, byId) && hasSteps(t));
  return { state: "ready", value: { inProgress: inProgress.map(refOf), ready: ready.map(refOf) } };
}

// src/hooks/keep-going.ts
var SEND_MESSAGE_TOOL = "SendMessage";
var SUBAGENT_WORK = [...AGENT_TOOLS, ...WORKFLOW_TOOLS, SEND_MESSAGE_TOOL];
var KEEP_GOING = "keep-going";
var WAIT_MARK = "Waiting for:";
var LEADING_MARKS = /^(?:[*_>#\- ]|\d+[.)])+/;
function waitsOnSomething(said) {
  const mark = WAIT_MARK.toLowerCase();
  return said.split(/\r?\n/).some((line) => line.trim().replace(LEADING_MARKS, "").toLowerCase().startsWith(mark));
}
function lastSaid(input) {
  if (typeof input.last_assistant_message === "string")
    return input.last_assistant_message;
  const transcript = stringField(input.transcript_path);
  return transcript === null ? null : lastAssistantText(transcript);
}
function named(phase) {
  return `#${phase.number} ${phase.subject}`;
}
function keepGoingReason(inProgress, ready) {
  const one = inProgress.length === 1;
  const shown = inProgress.slice(0, HOOK_LIST_LIMIT);
  const refs = shown.map((phase) => `#${phase.number}`).join(", ");
  const names = cappedHookList(inProgress, named, TASK_TOOL.list);
  const head = one ? `Phase ${names} is still in progress, and no subagent runs.` : `${inProgress.length} phases are still in progress, and no subagent runs: ${names}.`;
  const wait = `end the turn with a \`${WAIT_MARK} <what>\` line`;
  const next = ready[0];
  const options = [];
  for (const phase of shown) {
    if (phase.agent !== null) {
      if (isHerdrAgent(phase.agent)) {
        options.push(`wait for Herdr child \`${phase.agent}\` with \`${COMMAND} herdr wait\` in the background, or use \`${COMMAND} herdr send\` to continue it`);
        continue;
      }
      options.push(`resume ${one ? "its builder" : `the builder for #${phase.number}`} (\`${phase.agent}\`) with \`${SEND_MESSAGE_TOOL}\` (or start a fresh one)`);
    }
  }
  const fresh = shown.filter((phase) => phase.agent === null);
  if (fresh.length > 0) {
    options.push(`start ${fresh.length === 1 ? "a fresh builder" : "fresh builders"} on ${one ? "it" : fresh.map((phase) => `#${phase.number}`).join(", ")}`);
  }
  if (next !== undefined)
    options.push(`start ${named(next)} now (dispatch its builder)`);
  options.push(`close ${inProgress.length > shown.length ? "every phase (including those not shown)" : refs} with \`${TASK_TOOL.done}\``);
  options.push(`or record ${one ? "the" : "each"} blocker with \`${TASK_TOOL.note}\` and ${wait}`);
  const recovery = options.join(", ");
  return `${head} ${recovery.charAt(0).toUpperCase()}${recovery.slice(1)}. Never move a phase back to pending only to end the turn.`;
}
function keepGoingAnswer(input, project, paths, env, findCaller = callerOf) {
  if (input.stop_hook_active === true)
    return SILENT;
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0)
    return SILENT;
  const said = lastSaid(input);
  if (said === null || waitsOnSomething(said))
    return SILENT;
  const cwd = stringField(input.cwd);
  if (cwd === null)
    return SILENT;
  const view = openPhasesOf(paths, projectKey(project.mainCheckout ?? project.root), () => findCaller({ env, cwd, claudeConfigDir: paths.claudeConfigDir }));
  if (view.state === "unreadable")
    return { stderr: `${COMMAND} ${KEEP_GOING}: ${view.why}` };
  if (view.state === "none" || view.value.inProgress.length === 0)
    return SILENT;
  const reason = keepGoingReason(view.value.inProgress, view.value.ready);
  const transcript = stringField(input.transcript_path);
  if (transcript !== null && stopFeedbackGiven(transcript, reason, SUBAGENT_WORK))
    return SILENT;
  return { stdout: JSON.stringify({ decision: "block", reason }) };
}
function keepGoing(context) {
  if (context.event !== "Stop")
    return SILENT;
  return keepGoingAnswer(context.input, context.project, context.paths, context.env);
}

// src/hooks/main-folder-guard.ts
import { isAbsolute as isAbsolute7, resolve as resolve9 } from "path";
function editedFile(input, cwd) {
  const fields = toolInput(input);
  const path = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (path === null)
    return null;
  return realPath(isAbsolute7(path) ? resolve9(path) : resolve9(cwd, path));
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

// src/workflow/review-cover.ts
import { mkdtempSync, rmSync as rmSync4 } from "fs";
import { tmpdir as tmpdir3 } from "os";
import { join as join27 } from "path";
var MIN_COVER_GIT = "2.40.0";
var PATHS_PER_CALL = 200;
function short(sha) {
  return sha.slice(0, 7);
}
function counted(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function exactOnly(limits) {
  return limits.lines === 0 && limits.files === 0 && limits.percent === 0;
}
function allowanceOf(reviewed, limits) {
  return {
    files: Math.max(limits.files, Math.floor(reviewed.files * limits.percent / 100)),
    lines: Math.max(limits.lines, Math.floor(reviewed.lines * limits.percent / 100))
  };
}
function coverRefusal(delta, reviewed, limits, review) {
  const of = short(review);
  if (exactOnly(limits)) {
    return `fixesAfterReview is 0/0/0, so only the reviewed commit ${of} itself counts`;
  }
  const [binary, ...more] = delta.binary;
  if (binary !== undefined) {
    const others = more.length === 0 ? "" : ` (and ${counted(more.length, "other")})`;
    return `${binary}${others} is a binary file changed after the review of ${of}: its change cannot be counted`;
  }
  const allowance = allowanceOf(reviewed, limits);
  if (delta.lines <= allowance.lines && delta.files <= allowance.files)
    return null;
  return `${counted(delta.lines, "line")} in ${counted(delta.files, "file")} changed after the review of ${of}, ` + `over the limit of ${counted(allowance.lines, "line")} and ${counted(allowance.files, "file")} ` + `(fixesAfterReview: ${counted(limits.lines, "line")}, ${counted(limits.files, "file")}, ` + `or ${limits.percent}% of the reviewed ${counted(reviewed.lines, "line")} in ${counted(reviewed.files, "file")})`;
}
function parseGitVersion(out) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  return match === null ? null : `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
}
function tooOldToCover(version) {
  return Bun.semver.order(version, MIN_COVER_GIT) < 0;
}
function oldGit(version, head) {
  return `git ${version} is older than 2.40, so a change after a review cannot be measured: only a review of ${short(head)} itself counts (update git)`;
}
function parseNumstat(out) {
  const parts = out.split("\x00");
  const changed = [];
  for (let index = 0;index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (part === "")
      continue;
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(part);
    if (match === null)
      throw new Error(`git diff --numstat printed a line it cannot read: ${part}`);
    let path = match[3] ?? "";
    if (path === "") {
      path = parts[index + 2] ?? "";
      index += 2;
      if (path === "")
        throw new Error("git diff --numstat printed a rename without its path");
    }
    const lines = match[1] === "-" || match[2] === "-" ? null : Number(match[1]) + Number(match[2]);
    changed.push({ path, lines });
  }
  return changed;
}

class Uncovered extends Error {
  review;
  constructor(message, review = null) {
    super(message);
    this.review = review;
  }
}
function alternateEntry(folder) {
  return `"${folder.replaceAll("\\", "\\\\").replaceAll('"', "\\\"")}"`;
}
async function readCover(checkout, target, records, limits, git) {
  const { head, branch } = target;
  if (records.some((record) => record.sha === head)) {
    return { covered: true, review: head, delta: null, reviewed: null };
  }
  const candidates = [
    ...new Set(branch === null ? [] : records.filter((record) => record.branches.includes(branch)).map((r) => r.sha))
  ];
  if (candidates.length === 0) {
    const earlier = branch === null ? "" : ` or for an earlier commit of ${branch}`;
    return {
      covered: false,
      review: null,
      why: `no review is recorded for ${short(head)}${earlier}`
    };
  }
  if (exactOnly(limits)) {
    return {
      covered: false,
      review: candidates[0] ?? null,
      why: `fixesAfterReview is 0/0/0, so only a review of ${short(head)} itself counts`
    };
  }
  let objects = null;
  try {
    objects = mkdtempSync(join27(tmpdir3(), `${COMMAND}-cover-`));
    return await measure(checkout, target, candidates, limits, git, objects);
  } catch (error) {
    if (error instanceof Uncovered)
      return { covered: false, review: error.review, why: error.message };
    const why = error instanceof Error ? error.message : String(error);
    return {
      covered: false,
      review: null,
      why: `the change after the review cannot be read (${why})`
    };
  } finally {
    if (objects !== null)
      rmSync4(objects, { recursive: true, force: true });
  }
}
async function measure(checkout, { head, branch, base }, candidates, limits, git, objects) {
  const baseRef = `refs/remotes/origin/${base}`;
  const own = {
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateEntry(join27(checkout.commonDir, "objects"))
  };
  const run = async (args) => {
    const left = (git.timeFor ?? ((limit) => limit))(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0)
      throw new Uncovered("the time to measure the change after the review ran out");
    const result = await (git.run ?? runGitAsync)(checkout.root, args, git.env, left, own);
    if (result.code === null && result.err === "timed out") {
      throw new Uncovered("the time to measure the change after the review ran out");
    }
    return result;
  };
  const commit = async (rev) => {
    const found = await run(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    return found.ok && COMMIT_SHA.test(found.out) ? found.out : null;
  };
  const asked = await run(["--version"]);
  if (!asked.ok)
    throw new Uncovered(`git cannot be run here (${asked.err})`);
  const version = parseGitVersion(asked.out);
  if (version !== null && tooOldToCover(version))
    throw new Uncovered(oldGit(version, head));
  if (!COMMIT_SHA.test(head) || await commit(head) === null) {
    throw new Uncovered(`${short(head)} is not in this checkout: fetch it (git fetch origin)`);
  }
  if (await commit(baseRef) === null) {
    throw new Uncovered(`origin/${base} is not in this checkout: fetch it (git fetch origin ${base})`);
  }
  const mergeBase = async (a, b) => {
    const found = await run(["merge-base", a, b]);
    if (!found.ok) {
      throw new Uncovered(`${short(a)} and origin/${base} share no history`, a === head ? null : a);
    }
    return found.out;
  };
  const numstat = async (from, to, review) => {
    const diff = await run([
      "diff",
      "--no-textconv",
      "--no-ext-diff",
      "--numstat",
      "-z",
      "-M",
      from,
      to
    ]);
    if (!diff.ok) {
      throw new Uncovered(`the change after the review of ${short(review)} cannot be read (${diff.err})`, review);
    }
    return parseNumstat(diff.out);
  };
  const generatedOf = async (paths) => {
    const generated = new Set;
    for (let at = 0;at < paths.length; at += PATHS_PER_CALL) {
      const some = paths.slice(at, at + PATHS_PER_CALL);
      const attrs = await run([
        "check-attr",
        `--source=${baseRef}`,
        "-z",
        "linguist-generated",
        "--",
        ...some
      ]);
      if (!attrs.ok) {
        throw new Uncovered(`which files origin/${base} marks as generated cannot be read (${attrs.err})`);
      }
      const fields = attrs.out.split("\x00");
      for (let index = 0;index + 2 < fields.length; index += 3) {
        const value = fields[index + 2];
        if (value === "set" || value === "true")
          generated.add(fields[index] ?? "");
      }
    }
    return generated;
  };
  const tally = (changed, generated) => {
    const count = { lines: 0, files: 0, generated: [], binary: [] };
    for (const one of changed) {
      if (generated.has(one.path)) {
        count.generated.push(one.path);
        continue;
      }
      count.files += 1;
      if (one.lines === null)
        count.binary.push(one.path);
      else
        count.lines += one.lines;
    }
    return count;
  };
  const onBase = await mergeBase(head, baseRef);
  const measured = [];
  const unread = [];
  for (const review of candidates) {
    try {
      if (await commit(review) === null) {
        throw new Uncovered(`the reviewed commit ${short(review)} is not in this checkout: fetch it (git fetch origin)`, review);
      }
      const replay = await run(["merge-tree", "--write-tree", "--no-messages", onBase, review]);
      const tree = replay.out.split(`
`)[0] ?? "";
      if (replay.code !== 0 && replay.code !== 1 || !COMMIT_SHA.test(tree)) {
        throw new Uncovered(`the review of ${short(review)} cannot be replayed on origin/${base} (${replay.err})`, review);
      }
      const same = await run(["diff", "--no-textconv", "--no-ext-diff", "--quiet", onBase, tree]);
      if (same.code === 0)
        continue;
      if (same.code !== 1) {
        throw new Uncovered(`the review of ${short(review)} cannot be compared (${same.err})`, review);
      }
      const after = await numstat(tree, head, review);
      const before = await numstat(await mergeBase(review, baseRef), review, review);
      const generated = await generatedOf([
        ...new Set([...after, ...before].map((one) => one.path))
      ]);
      const delta = tally(after, generated);
      const reviewed = tally(before, generated);
      measured.push({
        review,
        delta,
        reviewed,
        refusal: coverRefusal(delta, reviewed, limits, review)
      });
    } catch (error) {
      if (!(error instanceof Uncovered) || error.review === null)
        throw error;
      unread.push(error);
    }
  }
  measured.sort((a, b) => Number(a.delta.binary.length > 0) - Number(b.delta.binary.length > 0) || a.delta.lines - b.delta.lines || a.delta.files - b.delta.files);
  const covering = measured.find((one) => one.refusal === null);
  if (covering !== undefined) {
    return {
      covered: true,
      review: covering.review,
      delta: covering.delta,
      reviewed: covering.reviewed
    };
  }
  const smallest = measured[0];
  if (smallest !== undefined && smallest.refusal !== null) {
    return {
      covered: false,
      review: smallest.review,
      why: smallest.refusal,
      delta: smallest.delta,
      reviewed: smallest.reviewed
    };
  }
  const [first] = unread;
  if (first !== undefined)
    throw first;
  const listed = candidates.map(short).join(", ");
  throw new Uncovered(`the review of ${branch ?? "this branch"} (${listed}) covers nothing new: its change is already in origin/${base}`);
}

// src/workflow/merge-check.ts
var GH_TIMEOUT_MS2 = 1e4;
var runGh = async (args, { folder, env, input, timeoutMs }) => {
  try {
    const child = Bun.spawn(["gh", ...args], {
      cwd: folder,
      env,
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true
    });
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    if (child.signalCode !== null) {
      const kind = child.signalCode === "SIGTERM" ? "timeout" : "failed";
      return { code: null, err: err.trim(), kind, out };
    }
    return {
      code: child.exitCode,
      err: err.trim(),
      kind: child.exitCode === 0 ? "ok" : "failed",
      out
    };
  } catch (error) {
    return {
      code: null,
      err: error instanceof Error ? error.message : String(error),
      kind: Bun.which("gh", { PATH: env.PATH ?? "" }) === null ? "missing" : "failed",
      out: ""
    };
  }
};
var spawnGh = async (args, call) => {
  const { kind, out } = await runGh(args, call);
  if (kind === "missing" || kind === "timeout")
    return null;
  return out.trim() === "" ? null : out;
};
var PULL_REQUEST_FACTS = "number,baseRefName,headRefName,headRefOid";
function parsePullRequestFacts(json) {
  try {
    const view = JSON.parse(json);
    const { baseRefName, headRefName, headRefOid, number } = view;
    if (typeof number !== "number" || typeof baseRefName !== "string")
      return null;
    if (typeof headRefName !== "string" || headRefName === "")
      return null;
    if (typeof headRefOid !== "string" || !COMMIT_SHA.test(headRefOid))
      return null;
    return { number, base: baseRefName, headRef: headRefName, headOid: headRefOid };
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
function reviewGateOf(paths, checkout, resolved) {
  const repository = checkout.mainCheckout ?? checkout.root;
  return {
    reviewBeforePush: resolved.reviewBeforePush.value,
    agents: resolved.reviewAgents.value,
    limits: {
      lines: resolved.fixesAfterReview.lines.value,
      files: resolved.fixesAfterReview.files.value,
      percent: resolved.fixesAfterReview.percent.value
    },
    file: reviewsFile(paths.stateDir, repository)
  };
}
async function coverOf(world, review, target) {
  if (!review.reviewBeforePush)
    return null;
  return await readCover(world.checkout, target, trustedReviews(review.file, review.agents), review.limits, {
    env: world.env,
    timeFor: world.timeFor
  });
}
function reviewRefusal(cover) {
  if (cover === null || cover.covered)
    return null;
  if (cover.review !== null)
    return cover.why;
  return `${cover.why} (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)`;
}
function counted2(change) {
  return { binary: change.binary.length, files: change.files, lines: change.lines };
}
function countsOf(change) {
  return change === null || change === undefined ? null : counted2(change);
}
function detailOf(cover, limits) {
  const reviewed = cover?.reviewed;
  return {
    allowance: reviewed === null || reviewed === undefined ? null : allowanceOf(reviewed, limits),
    delta: countsOf(cover?.delta),
    limits: { files: limits.files, lines: limits.lines, percent: limits.percent },
    review: cover?.review ?? null,
    reviewed: countsOf(reviewed)
  };
}
function short2(sha) {
  return sha.slice(0, 7);
}
function pullRequestAllowed(cover) {
  if (cover === null)
    return "its required checks are green, and reviewBeforePush is off";
  return `the review of ${short2(cover.review)} covers its head, and its required checks are green`;
}
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
  return facts.reviewRefusal;
}
function policyUnread(branch, why, policy = "merge policy") {
  const where = branch === null ? "the workflow settings" : `the ${policy} committed on ${branch}`;
  if (branch !== null && why.startsWith(`origin/${branch} is not known in this repository`)) {
    return `${where} cannot be read: ${why}; the base branch may never have been pushed: push it once (git push -u origin ${branch}), then run merge-check again; if it already exists on origin, fetch it first`;
  }
  return `${where} cannot be read: ${why}; a policy counts once it is committed, pushed and fetched`;
}
function workflowUnread(error) {
  return `the workflow settings cannot be read (${error instanceof Error ? error.message : String(error)})`;
}
function notByItself(reason, number = null) {
  const which = number === null ? "this pull request" : `#${number}`;
  return `cc-smart-dev-kit will not merge ${which} by itself: ${reason}. Approve the merge yourself if you meant it.`;
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
async function ghStdout(args, folder, env, timeoutMs, run) {
  return await run(args, { env, folder, timeoutMs });
}
async function viewPullRequest2(target, folder, env, timeoutMs = GH_TIMEOUT_MS2, run = spawnGh) {
  const out = await ghStdout([
    "pr",
    "view",
    ...target.ref === null ? [] : [target.ref],
    ...target.repo === null ? [] : ["--repo", target.repo],
    "--json",
    PULL_REQUEST_FACTS
  ], folder, env, timeoutMs, run);
  return out === null ? null : parsePullRequestFacts(out);
}
async function requiredChecks(number, repo, folder, env, timeoutMs = GH_TIMEOUT_MS2, run = spawnGh) {
  const out = await ghStdout([
    "pr",
    "checks",
    String(number),
    "--required",
    ...repo === null ? [] : ["--repo", repo],
    "--json",
    "name,bucket"
  ], folder, env, timeoutMs, run);
  return out === null ? null : parseRequiredChecks(out);
}
async function defaultBranchOf(folder, env, repo = null, timeoutMs = GH_TIMEOUT_MS2, run = spawnGh) {
  const out = await ghStdout(["repo", "view", ...repo === null ? [] : [repo], "--json", "defaultBranchRef"], folder, env, timeoutMs, run);
  return out === null ? null : parseDefaultBranch(out);
}
async function gateFor(world, branch) {
  if (world.gateOf !== undefined)
    return await world.gateOf(branch);
  const left = world.timeFor(GUARD_GIT_TIMEOUT_MS);
  if (left <= 0)
    return "late";
  return await resolveGateAsync(world.paths, world.checkout, branch, {
    env: world.env,
    timeoutMs: left
  });
}
async function checkPullRequest(world, target, defaultBranches = new Map) {
  const viewLeft = world.timeFor(GH_TIMEOUT_MS2);
  if (viewLeft <= 0) {
    return { kind: "late", number: null, what: "the pull request this command names" };
  }
  const view = await viewPullRequest2(target, world.folder, world.env, viewLeft, world.gh ?? spawnGh);
  if (view === null) {
    return { kind: "unread", number: null, what: "the pull request this command names" };
  }
  let read;
  try {
    read = await gateFor(world, view.base);
  } catch (error) {
    return { detail: null, kind: "refused", number: view.number, reason: workflowUnread(error) };
  }
  if (read === "late") {
    return { kind: "late", number: view.number, what: `the policy committed on ${view.base}` };
  }
  if (!read.ok) {
    return {
      detail: null,
      kind: "refused",
      number: view.number,
      reason: policyUnread(view.base, read.why)
    };
  }
  const { resolved, config: committed } = read.gate;
  if (committed?.ownHooks?.includes("merge-guard") === true)
    return { kind: "silent" };
  const where = target.repo ?? "";
  if (!defaultBranches.has(where)) {
    const branchLeft = world.timeFor(GH_TIMEOUT_MS2);
    if (branchLeft <= 0) {
      return { kind: "late", number: view.number, what: "this repository's default branch" };
    }
    defaultBranches.set(where, await defaultBranchOf(world.folder, world.env, target.repo, branchLeft, world.gh ?? spawnGh));
  }
  const defaultBranch = defaultBranches.get(where) ?? null;
  if (defaultBranch === null) {
    return { kind: "unread", number: view.number, what: "this repository's default branch" };
  }
  const branchRefusal = autoMergeRefusal(resolved, committed, view.base, defaultBranch);
  let checks = null;
  if (branchRefusal === null) {
    const checksLeft = world.timeFor(GH_TIMEOUT_MS2);
    if (checksLeft <= 0) {
      return { kind: "late", number: view.number, what: `the required checks of #${view.number}` };
    }
    checks = await requiredChecks(view.number, target.repo, world.folder, world.env, checksLeft, world.gh ?? spawnGh);
    if (checks === null) {
      return {
        kind: "unread",
        number: view.number,
        what: `the required checks of #${view.number}`
      };
    }
  }
  const before = mergeRefusal({ branchRefusal, checks, reviewRefusal: null });
  if (before !== null) {
    return { detail: null, kind: "refused", number: view.number, reason: before };
  }
  const review = reviewGateOf(world.paths, world.checkout, resolved);
  const cover = await coverOf(world, review, {
    head: view.headOid,
    branch: view.headRef,
    base: view.base
  });
  const refused = reviewRefusal(cover);
  if (refused !== null) {
    return {
      detail: detailOf(cover, review.limits),
      kind: "refused",
      number: view.number,
      reason: refused
    };
  }
  return {
    detail: detailOf(cover, review.limits),
    kind: "allowed",
    reason: pullRequestAllowed(cover?.covered === true ? cover : null)
  };
}

// src/workflow/pr-switches.ts
function turnOn(key, value, base) {
  const where = base ?? "the integration base (worktrees.base)";
  const literal = value === "true" ? "true" : `"${value}"`;
  const json = key.split(".").reduceRight((inner, part) => `{"${part}": ${inner}}`, literal);
  return `turn it on for yourself with \`${COMMAND} workflow set ${key} ${value}\`, or for the project in ${CONFIG_PATH} ("workflow": ${json}), committed to ${where} and pushed`;
}
function autoPushOff(resolved, base) {
  if (resolved.autoPush.value)
    return null;
  return `autoPush is off (${sourceLabel(resolved.autoPush, base)}), so a push is yours to approve: ${turnOn("autoPush", "true", base)}`;
}
function openPrRefusal(resolved, base, opening) {
  const { value } = resolved.openPr;
  const from = sourceLabel(resolved.openPr, base);
  if (value === "ready")
    return null;
  if (value === "draft") {
    if (opening.kind === "create" && opening.draft)
      return null;
    return opening.kind === "ready" ? `openPr is draft (${from}), so marking a pull request ready for review is yours to decide: ${turnOn("openPr", "ready", base)}` : `openPr is draft (${from}), and this pull request does not open as a draft (add \`--draft\`): ${turnOn("openPr", "ready", base)}`;
  }
  return `openPr is off (${from}), so opening or readying a pull request is yours to approve: ${turnOn("openPr", "draft", base)}`;
}

// src/hooks/merge-guard.ts
var ALIAS_LIMIT_MS = 3000;
var ALIAS_READERS = new WeakMap;
function aliasReaderOf(context, timeoutMs) {
  let reader = ALIAS_READERS.get(context);
  if (reader === undefined) {
    reader = onceAliases(context.cwd, context.env, timeoutMs);
    ALIAS_READERS.set(context, reader);
  }
  return reader;
}
function notOpenedByItself(opening, reason) {
  const what = opening.opens === "ready" ? "marks a pull request ready for review" : "opens a pull request";
  return `cc-smart-dev-kit asks before this ${what}: ${reason}. Approve it yourself if you meant it.`;
}
function opensElsewhere(into, head, expected) {
  return `the pull request would open into \`${into}\`, but this project sends a \`${head}\` branch into \`${expected}\` (worktrees.base, or worktrees.bases for that branch)`;
}
var OPENING_DEFAULT_UNREAD = "gh could not read this repository's default branch, so this guard cannot tell which branch this pull request opens into";
var OPENING_DEFAULT_LATE = "reading this repository's default branch would have taken longer than the guard's own budget allows";
function headBranchOf(head) {
  if (head === null)
    return null;
  const branch = head.slice(head.lastIndexOf(":") + 1);
  return branch === "" ? null : branch;
}
function adminRefusal(ref) {
  const which = ref === null ? "the current branch's pull request" : numericRef(ref) === null ? `\`${ref}\`` : `#${ref}`;
  return `the command merges ${which} with \`--admin\`, which uses administrator rights to merge past the repository's branch protection (its required reviews, a code-owner approval among them, its required checks and its merge queue), so you decide each one`;
}
function adminMerge(calls) {
  return calls.find((one) => one.admin && !one.disarms);
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
function askFor(verdict, env) {
  if (verdict.kind === "refused")
    return notByItself(verdict.reason, verdict.number);
  if (verdict.kind === "unread")
    return notChecked(verdict.what, env);
  return notInTime(verdict.what);
}
async function mergeGuard(context) {
  const answer = await pullRequestGuard(context);
  if (answer.stdout !== undefined)
    return answer;
  return issueWriteAnswer(context);
}
function issueWriteQuestion(context) {
  const { project, input } = context;
  const command = stringField(toolInput(input).command);
  if (command === null || project.config === null)
    return null;
  const dialect = dialectOfTool(input.tool_name);
  const writes = issueWritesWithAliases(command, aliasReaderOf(context, ALIAS_LIMIT_MS), dialect).writes;
  if (writes.length === 0 && !computedIssueRisk(command, dialect))
    return null;
  const what = writes.length > 0 ? `writes to GitHub's issues (${writes.join(", ")})` : "runs a program it works out when it runs, and its words name an issue, so this guard cannot tell whether it writes to GitHub's issues";
  return `${COMMAND} asks before this command ${what}: an issue is text that leaves the machine, so a raw gh write is yours to approve. The kit files issues itself with \`${COMMAND} issue file\` once issues.enabled is on. Approve it yourself if you meant it.`;
}
function issueWriteAnswer(context) {
  const question = issueWriteQuestion(context);
  return question === null ? SILENT : toolDecision("ask", question);
}
async function pullRequestGuard(context) {
  const { project, input, env, cwd, paths } = context;
  const command = stringField(toolInput(input).command);
  const dialect = dialectOfTool(input.tool_name);
  if (command === null)
    return SILENT;
  if (!requestsPullRequestChange(command, dialect))
    return SILENT;
  const config = project.config;
  if (config === null)
    return SILENT;
  const ask = (why) => toolDecision("ask", why);
  if (computedMergeRisk(command, dialect)) {
    return ask(notByItself(COMPUTED_MERGE));
  }
  const admin = adminMerge(pullRequestMerges(command, null, dialect));
  if (admin !== undefined) {
    return ask(notByItself(adminRefusal(admin.target?.ref ?? null)));
  }
  const { timeFor } = startBudget(env);
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
  let branchHere;
  const currentBranch = () => {
    if (branchHere !== undefined)
      return branchHere;
    const left = timeFor(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0) {
      branchHere = null;
      return null;
    }
    const read = runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], env, left);
    branchHere = read.ok && read.out !== "" ? read.out : null;
    return branchHere;
  };
  const openingDefaults = new Map;
  const defaultBranchHere = async (repo) => {
    const key = repo ?? "";
    if (openingDefaults.has(key))
      return openingDefaults.get(key) ?? null;
    const left = timeFor(GH_TIMEOUT_MS2);
    if (left <= 0)
      return "late";
    let branch = await defaultBranchOf(cwd, env, repo, left);
    if (branch === null) {
      const gitLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
      if (gitLeft <= 0)
        return "late";
      const origin = runGit(cwd, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env, gitLeft);
      const name = origin.ok ? origin.out.replace(/^origin\//, "") : "";
      branch = name === "" ? null : name;
    }
    if (branch === null)
      return "unread";
    openingDefaults.set(key, branch);
    return branch;
  };
  const opensOutsideBase = async (opening, worktrees) => {
    if (opening.opens !== "create" || opening.cli !== true || worktrees === undefined)
      return null;
    const head = headBranchOf(opening.head ?? null) ?? currentBranch();
    if (head === null)
      return null;
    const expected = baseForBranch(worktrees, head);
    const into = opening.base ?? await defaultBranchHere(opening.target?.repo ?? null);
    if (into === "late" || into === "unread")
      return into;
    if (into === null)
      return null;
    return into === expected ? null : opensElsewhere(into, head, expected);
  };
  const aliasTime = timeFor(ALIAS_LIMIT_MS);
  const calls = pullRequestCallsWithAliases(command, cwd, env, aliasTime, dialect, aliasReaderOf(context, aliasTime));
  const merges = calls.filter((one) => isMerge(one) && !one.disarms);
  const openings = calls.filter((one) => !isMerge(one));
  const integration = config.worktrees?.base ?? null;
  if (integration !== null && merges.length > 0) {
    let early;
    try {
      early = gateOf(integration);
    } catch (error) {
      return ask(notByItself(workflowUnread(error)));
    }
    if (early === "late")
      return ask(notInTime(`the policy committed on ${integration}`));
    if (!early.ok)
      return ask(notByItself(policyUnread(integration, early.why)));
    if (early.gate.config?.ownHooks?.includes("merge-guard") === true)
      return SILENT;
    const off = autoMergeOff(early.gate.resolved, integration);
    if (off !== null)
      return ask(notByItself(off));
  }
  const world = {
    paths,
    checkout: {
      root: project.root,
      commonDir: project.commonDir,
      isWorktree: project.isWorktree,
      mainCheckout: project.mainCheckout
    },
    folder: cwd,
    env,
    timeFor,
    gateOf
  };
  const defaultBranches = new Map;
  let own = null;
  let ownRead = false;
  const foreignReason = (repo) => {
    if (!ownRead) {
      const left = timeFor(GUARD_GIT_TIMEOUT_MS);
      if (left <= 0)
        return { late: true, reason: null };
      own = ownRepository(project, env, left);
      ownRead = true;
    }
    return { late: false, reason: foreignRepository(repo, own) };
  };
  let allowed = null;
  for (const merge of merges) {
    const number = numericRef(merge.target?.ref ?? null);
    if (merge.admin) {
      return ask(notByItself(adminRefusal(merge.target?.ref ?? null)));
    }
    if (merge.unread !== null)
      return ask(notChecked(merge.unread, env));
    if (merge.refusal !== null)
      return ask(notByItself(merge.refusal, number));
    const target = merge.target;
    if (target === null)
      continue;
    if (target.repo !== null) {
      const foreign = foreignReason(target.repo);
      if (foreign.late)
        return ask(notInTime("this project's own repository"));
      if (foreign.reason !== null) {
        return ask(notByItself(foreign.reason, number));
      }
    }
    const verdict = await checkPullRequest(world, target, defaultBranches);
    if (verdict.kind === "silent")
      return SILENT;
    if (verdict.kind !== "allowed")
      return ask(askFor(verdict, env));
    allowed = verdict.reason;
  }
  for (const opening of openings) {
    if (opening.refusal !== null) {
      return ask(notOpenedByItself(opening, opening.refusal));
    }
    const repo = opening.target?.repo ?? null;
    if (repo !== null) {
      const foreign = foreignReason(repo);
      if (foreign.late) {
        return ask(notOpenedByItself(opening, "reading this project's own repository would have taken longer than the guard's own budget allows"));
      }
      if (foreign.reason !== null) {
        return ask(notOpenedByItself(opening, foreign.reason));
      }
    }
    let read;
    try {
      read = gateOf(integration);
    } catch (error) {
      return ask(notOpenedByItself(opening, workflowUnread(error)));
    }
    if (read === "late") {
      return ask(notOpenedByItself(opening, "reading the policy would have taken longer than the guard's own budget allows"));
    }
    if (!read.ok) {
      return ask(notOpenedByItself(opening, policyUnread(integration, read.why, "openPr policy")));
    }
    if (read.gate.config?.ownHooks?.includes("merge-guard") === true)
      return SILENT;
    const why = openPrRefusal(read.gate.resolved, integration, {
      draft: opening.draft === true,
      kind: opening.opens ?? "create"
    });
    if (why !== null)
      return ask(notOpenedByItself(opening, why));
    const outside = await opensOutsideBase(opening, read.gate.config?.worktrees);
    if (outside === "late") {
      return ask(notOpenedByItself(opening, OPENING_DEFAULT_LATE));
    }
    if (outside === "unread") {
      return ask(notOpenedByItself(opening, OPENING_DEFAULT_UNREAD));
    }
    if (outside !== null)
      return ask(notOpenedByItself(opening, outside));
  }
  if (allowed !== null && exactMergeOf(command, dialect) !== null) {
    return toolDecision("allow", allowed);
  }
  return SILENT;
}

// src/hooks/push-policy.ts
function autoPushQuestion(context) {
  const { env, paths, project } = context;
  const base = project.config?.worktrees?.base ?? null;
  try {
    const read = resolveGate(paths, project, base, { env, timeoutMs: GUARD_GIT_TIMEOUT_MS });
    if (!read.ok) {
      return `${COMMAND} cannot tell whether this push is allowed: the push policy committed on ${base} cannot be read (${read.why}); a policy counts once it is committed, pushed and fetched. Approve the push yourself if it is right.`;
    }
    const off = autoPushOff(read.gate.resolved, base);
    return off === null ? null : `This push leaves the machine, and ${off}. Approve it yourself if you meant it.`;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `${COMMAND} cannot tell whether this push is allowed: the workflow settings cannot be read (${why}). Approve the push yourself if it is right.`;
  }
}

// src/hooks/session-escape-guard.ts
import { dirname as dirname14, isAbsolute as isAbsolute8, posix as posix2, relative as relative3, resolve as resolve10, win32 as win323 } from "path";

// src/ports.ts
var DEFAULT_PORTAL_PORT = 20150;

// src/hooks/session-escape-guard.ts
var ESCAPE_SHELL_TOOLS = ["Bash", "PowerShell"];
var ESCAPE_EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"];
var CLAUDECODE = "CLAUDECODE";
var PROJECT_FILE = `${COMMAND}.json`;
var PROJECT_FOLDER = ".claude";
var OVERWRITTEN = "is overwritten (`CLAUDECODE=\u2026`)";
var UNSET = "is unset";
var CLEARED = "is gone: the whole environment is cleared (`env -i`)";
var RESET = "is gone: the program starts the command with a fresh environment";
var RESETTERS = new Set([
  "doas",
  "runuser",
  "ssh",
  "su",
  "sudo",
  "systemd-run"
]);
var ASSIGNS_CLAUDECODE = new RegExp(`^${CLAUDECODE}=`, "i");
var ENV_VALUED_LONG = ["--chdir", "--split-string"];
function prefixDrop(prefix, program) {
  if (program === "-" && programName(prefix.at(-1) ?? "") === "env")
    return CLEARED;
  if (prefix.some((word) => ASSIGNS_CLAUDECODE.test(word)))
    return OVERWRITTEN;
  if (prefix.some((word) => RESETTERS.has(programName(word))))
    return RESET;
  if (prefix.some((word, at) => isFreshEnvironment(prefix[at - 1] ?? "", word)))
    return RESET;
  for (let at = 0;at < prefix.length; at++) {
    if (programName(prefix[at] ?? "") !== "env")
      continue;
    for (let index = at + 1;index < prefix.length; index++) {
      const word = prefix[index] ?? "";
      if (word === "--")
        break;
      if (word === "-")
        return CLEARED;
      if (word.startsWith("--")) {
        const [name = "", inline] = word.split("=", 2);
        if (name === "--ignore-environment")
          return CLEARED;
        if (name === "--unset") {
          if ((inline ?? prefix[++index]) === CLAUDECODE)
            return UNSET;
        } else if (ENV_VALUED_LONG.includes(name) && inline === undefined)
          index++;
        continue;
      }
      if (!isShort(word)) {
        if (/^\w+=/.test(word))
          continue;
        break;
      }
      const { flags, wantsNext } = shortFlags(word, "uCS");
      if (flags.includes("i"))
        return CLEARED;
      if (flags.endsWith("u")) {
        const name = wantsNext ? prefix[++index] : word.slice(flags.length + 1);
        if (name === CLAUDECODE)
          return UNSET;
      } else if (wantsNext)
        index++;
    }
  }
  return null;
}
function isFreshEnvironment(before, parameter) {
  if (programName(before) !== "start-process")
    return false;
  const given = /^-([a-z]+)$/i.exec(parameter)?.[1]?.toLowerCase() ?? "";
  return given !== "" && "usenewenvironment".startsWith(given);
}
var POWERSHELL_DROPS = [
  new RegExp(String.raw`\$\{?env:${CLAUDECODE}\}?\s*=(?!=)`, "i"),
  new RegExp(String.raw`\b(?:clear-item|cli|new-item|ni|remove-item|ri|rm|del|erase|set-item|si)\b[^\n;|]*\benv:\\?${CLAUDECODE}\b`, "i"),
  new RegExp(String.raw`\bSetEnvironmentVariable\s*\(\s*['"]${CLAUDECODE}['"]`, "i")
];
function powershellDrop(line) {
  return POWERSHELL_DROPS.some((pattern) => pattern.test(line)) ? OVERWRITTEN : null;
}
function persistentDrop(words, program, args) {
  if (program === undefined) {
    return words.some((word) => ASSIGNS_CLAUDECODE.test(word)) ? OVERWRITTEN : null;
  }
  const names = args.filter((arg) => !arg.startsWith("-") || ASSIGNS_CLAUDECODE.test(arg));
  if (program === "unset")
    return names.includes(CLAUDECODE) ? UNSET : null;
  if (["declare", "export", "local", "readonly", "set", "typeset"].includes(program)) {
    if (args.some((arg) => ASSIGNS_CLAUDECODE.test(arg)))
      return OVERWRITTEN;
    const stopsExporting = args.includes("-n") || args.includes("+x");
    return stopsExporting && names.includes(CLAUDECODE) ? UNSET : null;
  }
  return null;
}
function pathRules(platform) {
  return platform === "win32" ? win323 : posix2;
}
function shellTargetPath(path, platform = process.platform, dialect = "bash") {
  if (platform !== "win32" || dialect !== "bash")
    return path;
  const drive = /^\/+([A-Za-z])\//.exec(path);
  return drive === null ? path : `${drive[1]?.toUpperCase()}:/${path.slice(drive[0].length)}`;
}
var REVIEW_DONE_DENIAL = `\`${COMMAND} workflow review-done\` records a review by hand, for the person in their own terminal. A session never records its own review: the review-record hook records it when a review agent (the \`reviewAgents\` setting) returns. Run the review agent on the change instead; if it did and nothing was recorded, tell the person.`;
function droppedDenial(why) {
  return `This runs a ${COMMAND} command with CLAUDECODE removed: it ${why}. Claude Code sets CLAUDECODE for the commands it runs, and the commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while it is set, because they are for the person in their own terminal. Dropping it to get past that is not allowed. If the person wants the command run, they run it themselves.`;
}
function judgeKitCommand(kitArgs, dropped, found) {
  const operands = withoutRedirections(kitArgs);
  if (operands[0] === "workflow" && operands[1] === "review-done") {
    found.denials.add(REVIEW_DONE_DENIAL);
  }
  if (dropped !== null)
    found.denials.add(droppedDenial(dropped));
}
var WRITES_ITS_FILES = new Set([
  "ac",
  "add-content",
  "out-file",
  "sc",
  "set-content",
  "tee",
  "tee-object"
]);
var COPIES = new Set([
  "copy",
  "copy-item",
  "cp",
  "cpi",
  "install",
  "ln",
  "mi",
  "move",
  "move-item",
  "mv"
]);
var MOVES = new Set(["mi", "move", "move-item", "mv"]);
var CHANGES_FOLDER = new Set([
  "cd",
  "chdir",
  "popd",
  "push-location",
  "pushd",
  "set-location",
  "sl"
]);
function isString(value) {
  return typeof value === "string";
}
var COMPUTED_PATH = /[$`*?[\]]|%\w+%/;
function parameterValues(args, names) {
  const values = [];
  for (let index = 0;index < args.length; index++) {
    const parameter = /^-([a-z]+)(?::(.*))?$/i.exec(args[index] ?? "");
    const given = parameter?.[1]?.toLowerCase() ?? "";
    if (given.length < 2 || !names.some((name) => name.startsWith(given)))
      continue;
    const value = parameter?.[2] ?? args[++index];
    if (value !== undefined)
      values.push(value);
  }
  return values;
}
function targetDirectories(args) {
  const found = [];
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-t" || arg === "--target-directory")
      found.push(args[++index] ?? "");
    else if (arg.startsWith("--target-directory="))
      found.push(arg.slice(19));
    else if (/^-t./.test(arg) && !arg.startsWith("--"))
      found.push(arg.slice(2));
  }
  return found.filter((one) => one !== "");
}
function writtenPaths(words, invocation) {
  const written = redirectionTargets(words);
  if (invocation === undefined)
    return written;
  const { program } = invocation;
  const args = withoutRedirections(invocation.args);
  const operands = args.filter((arg) => !arg.startsWith("-"));
  if (WRITES_ITS_FILES.has(program))
    written.push(...operands);
  else if (program === "dd")
    written.push(...args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3)));
  else if (program === "sed" || program === "perl") {
    if (args.some((arg) => arg.startsWith("--in-place") || /^-[a-z]*i/.test(arg))) {
      written.push(...operands);
    }
  } else if (COPIES.has(program)) {
    const given = [...parameterValues(args, ["destination"]), ...targetDirectories(args)];
    written.push(...given.length > 0 ? given : operands.slice(-1));
    if (MOVES.has(program))
      written.push(...operands);
  }
  return written;
}
function movedTo2(invocation, folder, ctx, dialect) {
  const to = withoutRedirections(invocation.args).find((arg) => !arg.startsWith("-"));
  if (to === undefined)
    return invocation.program === "cd" ? ctx.paths.home : folder;
  const path = shellTargetPath(expanded(to, ctx.paths.home), ctx.platform, dialect);
  if (COMPUTED_PATH.test(path) || path === "-")
    return null;
  const rules = pathRules(ctx.platform);
  return rules.isAbsolute(path) ? rules.resolve(path) : folder === null ? null : rules.resolve(folder, path);
}
function protectedNeedles(paths) {
  const settings = dirname14(paths.workflowConfigFile);
  const needles = [PROJECT_FILE, settings, paths.stateDir, paths.pluginCacheDir];
  for (const folder of [settings, paths.stateDir, paths.pluginCacheDir]) {
    const underHome = relative3(paths.home, folder);
    if (!underHome.startsWith("..") && !isAbsolute8(underHome))
      needles.push(underHome);
    needles.push(realPath(folder));
  }
  return needles.map((needle) => needle.replace(/\\/g, "/").toLowerCase());
}
function namesProtected(text, paths) {
  const lower = text.replace(/\\/g, "/").toLowerCase();
  return protectedNeedles(paths).some((needle) => lower.includes(needle));
}
function innerKitPrefix(program, operands) {
  const words = [program, ...operands];
  const atKit = words.findIndex(isKitWord);
  if (atKit === -1)
    return [];
  const atStart = words.slice(0, atKit).findIndex((word) => isWrapper(word) || isAssignmentOnly([word]));
  return atStart === -1 ? [] : words.slice(atStart, atKit);
}
var COMPUTED_KIT_ASK = `This command runs a program it works out when it runs, and its words name the ${COMMAND} command, so the guard cannot tell whether it runs it. Write the command out in full if you meant it.`;
var SETTINGS_TAIL = "These files hold the limits the kit's guards enforce, so a session that changes them changes its own limits. Allow it only if you asked for this change.";
function settingsQuestion(what, file, action) {
  return `${action} ${what}: ${file}. ${SETTINGS_TAIL}`;
}
function judgeWrites(raw, folder, ctx, found, dialect) {
  const { cwd, paths } = ctx;
  const rules = pathRules(ctx.platform);
  let computed = null;
  for (const target of raw) {
    const path = shellTargetPath(expanded(target, paths.home), ctx.platform, dialect);
    if (COMPUTED_PATH.test(path)) {
      computed ??= target;
      continue;
    }
    if (!rules.isAbsolute(path) && folder === null)
      computed ??= target;
    const bases = rules.isAbsolute(path) ? [""] : [...new Set([folder, cwd, "/"].filter(isString))];
    const files = bases.flatMap((base) => {
      const written = rules.resolve(base, path);
      return [written, realPath(written)];
    });
    for (const file of new Set(files)) {
      const what = kitFileKind(file, paths);
      if (what !== null) {
        found.asks.add(settingsQuestion(what, file, "This command writes into"));
        break;
      }
    }
  }
  if (computed !== null && namesProtected(ctx.text, paths)) {
    found.asks.add(`This command writes to a path it works out when it runs (${computed}), and it names the kit's own settings. ${SETTINGS_TAIL}`);
  }
}
function readLine2(line, reading, start, folder, depth, found, ctx) {
  const { dialect, joinLines } = reading;
  let dropped = start ?? (dialect === "powershell" ? powershellDrop(line) : null);
  let where = folder;
  let ranKit = false;
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    const invocation = invocationOf(words);
    const writes = writtenPaths(words, invocation);
    if (writes.length > 0)
      judgeWrites(writes, where, ctx, found, dialect);
    if (invocation !== undefined && CHANGES_FOLDER.has(invocation.program)) {
      where = invocation.program === "popd" ? null : movedTo2(invocation, where, ctx, dialect);
    }
    const later = persistentDrop(words, invocation?.program, invocation === undefined ? [] : withoutRedirections(invocation.args));
    if (invocation !== undefined) {
      const { args, prefix, program } = invocation;
      const operands = withoutRedirections(args);
      const resets = RESETTERS.has(program) ? RESET : null;
      const here = dropped ?? prefixDrop(prefix, program) ?? resets;
      const kit = kitArguments(program, operands);
      if (kit !== null) {
        const inside = prefixDrop(innerKitPrefix(program, operands), program);
        judgeKitCommand(kit, here ?? inside, found);
      }
      if (invocation.computed && (kit !== null || ctx.namesKit || ranKit)) {
        found.asks.add(COMPUTED_KIT_ASK);
      }
      ranKit ||= isKitWord(program);
      if (depth < MAX_NESTING) {
        const nested = nestedCommand(program, args, step.pipedFrom);
        if (nested !== undefined) {
          for (const inner of readingsOf(nested, nestedDialect(program))) {
            const after = readLine2(nested, inner, here, where, depth + 1, found, ctx);
            if (program === "eval")
              dropped = after ?? dropped;
          }
        }
        if (resets !== null) {
          for (const operand of operands.filter((one) => /\s/.test(one))) {
            for (const inner of readingsOf(operand, "bash")) {
              readLine2(operand, inner, here, where, depth + 1, found, ctx);
            }
          }
        }
      }
    }
    dropped = later ?? dropped;
  }
  return dropped;
}
var LOOPBACK = String.raw`(?:[\w-]+\.)?localhost|127(?:\.\d{1,3}){0,3}|0\.0\.0\.0|0x7f[\da-f.x]*|2130706433|\[?::1?\]?|\[?::ffff:[\d.]+\]?`;
var PORTAL_ADDRESS = new RegExp(String.raw`(?<![\w.:-])(?:${LOOPBACK})[\s:/,'")\]]{1,8}${DEFAULT_PORTAL_PORT}(?!\d)`, "i");
var PORTAL_QUESTION = `This command reaches the portal's port (${DEFAULT_PORTAL_PORT}) on this machine. The portal has no sign-in of its own: its pages change the gateway, the safety judge, updates and the workflow settings, the review gate included. It is for you, in your own browser. Allow this only if you asked for it.`;
function commandOf2(input) {
  return stringField(toolInput(input).command) ?? "";
}
function judgeShell(input, paths, platform) {
  const command = commandOf2(input);
  if (command === "")
    return SILENT;
  const found = { denials: new Set, asks: new Set };
  const ctx = {
    cwd: stringField(input.cwd),
    namesKit: namesKit(command),
    paths,
    platform,
    text: command
  };
  for (const reading of readingsOf(command, dialectOfTool(input.tool_name))) {
    readLine2(command, reading, null, ctx.cwd, 0, found, ctx);
  }
  if (found.denials.size > 0)
    return toolDecision("deny", [...found.denials].join(`
`));
  if (PORTAL_ADDRESS.test(command))
    found.asks.add(PORTAL_QUESTION);
  return found.asks.size > 0 ? toolDecision("ask", [...found.asks].join(`
`)) : SILENT;
}
var PROJECT_FILE_WHAT = `the project's ${COMMAND} settings (the workflow gate, which hooks run)`;
var SETTINGS_WHAT = "the kit's own settings folder (the person's workflow and gateway settings)";
var STATE_WHAT = "the kit's own state folder (the review record, the ask log)";
var PLUGIN_WHAT = "the kit's own installed plugin folder (the guards and hooks Claude Code runs from it)";
function expanded(path, home) {
  return /^~(?=$|[\\/])/.test(path) ? `${home}${path.slice(1)}` : path;
}
function folderForms(folder) {
  return [folder, realPath(folder)];
}
function kitFileKind(path, paths) {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  if (name.toLowerCase() === PROJECT_FILE.toLowerCase() && (parts.at(-2) ?? "").toLowerCase() === PROJECT_FOLDER) {
    return PROJECT_FILE_WHAT;
  }
  const settingsFolders = [paths.workflowConfigFile, paths.gatewayConfigFile].map(dirname14);
  const inside = (folder) => folderForms(folder).some((form) => isInside(path, form, true));
  if (settingsFolders.some(inside))
    return SETTINGS_WHAT;
  if (inside(paths.stateDir))
    return STATE_WHAT;
  return inside(paths.pluginCacheDir) ? PLUGIN_WHAT : null;
}
function editedPaths(input, cwd, home) {
  const fields = toolInput(input);
  const given = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (given === null)
    return [];
  const path = expanded(given, home);
  const written = isAbsolute8(path) ? resolve10(path) : resolve10(cwd ?? "/", path);
  return [...new Set([written, realPath(written)])];
}
function judgeEdit(input, paths) {
  for (const file of editedPaths(input, stringField(input.cwd), paths.home)) {
    const what = kitFileKind(file, paths);
    if (what !== null)
      return toolDecision("ask", settingsQuestion(what, file, "This edit changes"));
  }
  return SILENT;
}
function sessionEscapeGuard(input, paths, platform = process.platform) {
  const tool = stringField(input.tool_name) ?? "";
  if (ESCAPE_SHELL_TOOLS.includes(tool))
    return judgeShell(input, paths, platform);
  if (ESCAPE_EDIT_TOOLS.includes(tool))
    return judgeEdit(input, paths);
  return SILENT;
}
var DOMAIN_TEXT = new RegExp(`${COMMAND}|${CLAUDECODE}|${DEFAULT_PORTAL_PORT}|(?:dist|entries)[\\\\/](?:cli|portal)\\.`, "i");
function inEscapeDomain(input) {
  const tool = stringField(input.tool_name) ?? "";
  if (ESCAPE_EDIT_TOOLS.includes(tool))
    return true;
  return ESCAPE_SHELL_TOOLS.includes(tool) && DOMAIN_TEXT.test(commandOf2(input));
}

// src/hooks/subagent-background.ts
import { readFileSync as readFileSync26 } from "fs";
var HAND_BACK_REASON = "Your background work is still running: wait for it or stop it, then report.";
var BACKGROUND_ID = /Command running in background with ID: ([A-Za-z0-9_-]+)/;
var AGENT_ID = /agentId: ([A-Za-z0-9_-]+)/;
function backgroundTaskIds(input) {
  if (!Array.isArray(input.background_tasks))
    return [];
  const ids = [];
  for (const task of input.background_tasks) {
    if (typeof task !== "object" || task === null || Array.isArray(task))
      continue;
    const id = stringField(task.id);
    if (id !== null)
      ids.push(id);
  }
  return ids;
}
function lineObject(line) {
  if (line.trim() === "")
    return null;
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function contentBlocks(line) {
  const message = line.message;
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return [];
  const content = message.content;
  if (!Array.isArray(content))
    return [];
  return content.filter((block) => typeof block === "object" && block !== null && !Array.isArray(block));
}
function resultText(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return "";
  return content.map((block) => {
    if (typeof block !== "object" || block === null || Array.isArray(block))
      return "";
    const text = block.text;
    return typeof text === "string" ? text : "";
  }).join(`
`);
}
function startedByAgent(text, ids) {
  const wanted = new Set(ids);
  if (wanted.size === 0)
    return false;
  const tools = new Map;
  const results = [];
  for (const raw of text.split(`
`)) {
    const line = lineObject(raw);
    if (line === null)
      continue;
    for (const block of contentBlocks(line)) {
      if (block.type === "tool_use") {
        const id = stringField(block.id);
        const name = stringField(block.name);
        if (id !== null && name !== null)
          tools.set(id, name);
      } else if (block.type === "tool_result") {
        results.push({
          text: resultText(block.content),
          tool: tools.get(stringField(block.tool_use_id) ?? "")
        });
      }
    }
  }
  for (const result of results) {
    const found = result.tool === "Bash" ? BACKGROUND_ID.exec(result.text)?.[1] : result.tool !== undefined && AGENT_TOOLS.includes(result.tool) && AGENT_ID.exec(result.text)?.[1];
    if (typeof found === "string" && wanted.has(found))
      return true;
  }
  return false;
}
function subagentBackground(context) {
  const { input, event, project } = context;
  if (project.config === null)
    return SILENT;
  if (event !== "SubagentStop")
    return SILENT;
  if (input.stop_hook_active === true)
    return SILENT;
  const selfId = stringField(input.agent_id);
  const ids = backgroundTaskIds(input).filter((id) => id !== selfId);
  if (ids.length === 0)
    return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null)
    return SILENT;
  let text;
  try {
    text = readFileSync26(transcript, "utf8");
  } catch {
    return SILENT;
  }
  return startedByAgent(text, ids) ? { stdout: JSON.stringify({ decision: "block", reason: HAND_BACK_REASON }) } : SILENT;
}

// src/mcp/records.ts
import { existsSync as existsSync19, readFileSync as readFileSync27 } from "fs";
import { join as join28 } from "path";
var RECORD_FILE = "mcp-servers.json";
function mcpRecordsFile(stateDir) {
  return join28(stateDir, RECORD_FILE);
}
function isRecord(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const { at, json, pending } = value;
  return typeof json === "string" && typeof at === "string" && (pending === undefined || typeof pending === "boolean");
}
function readMcpRecords(stateDir, file = mcpRecordsFile(stateDir)) {
  if (!existsSync19(file))
    return {};
  const parsed = JSON.parse(readFileSync27(file, "utf8"));
  const servers = parsed?.servers;
  if (typeof servers !== "object" || servers === null || !Object.values(servers).every((entry) => isRecord(entry))) {
    throw new Error(`Invalid ${file}: expected { "servers": { <name>: { json, at } } }`);
  }
  return servers;
}

// src/hooks/task-start.ts
var START_TASK_LIMIT = 8;
function taskStart(input, paths, env, now = Date.now) {
  const cwd = stringField(input.cwd);
  if (cwd === null)
    return SILENT;
  const context = taskContext(cwd, env);
  if (!context.ok)
    return { stderr: `${COMMAND} task-start: ${context.why}` };
  const who = callerOf({ env, cwd, claudeConfigDir: paths.claudeConfigDir }) ?? {
    sessionId: stringField(input.session_id),
    crewId: null,
    pid: null,
    procStart: null
  };
  const staleDays = context.projectTasks.ok ? context.projectTasks.staleDays : DEFAULT_STALE_DAYS;
  const view = startView(paths, context.project, who, {
    limit: START_TASK_LIMIT,
    staleBefore: now() - staleDays * DAY_MS
  });
  if (view.state === "unreadable")
    return { stderr: `${COMMAND} task-start: ${view.why}` };
  const lines = [];
  if (view.state === "ready" && view.value.tasks.length > 0) {
    lines.push("Open tasks here (the kit's task list):");
    for (const task of view.value.tasks) {
      const status = [
        task.status === "in_progress" ? "in progress" : task.status,
        ...task.type === "non-blocking" ? ["non-blocking"] : [],
        ...task.blocked ? ["blocked"] : []
      ].join(" \xB7 ");
      lines.push(`#${task.number} [${status}] ${task.subject}${task.claim === "another session" ? " (another session)" : ""}`);
    }
    if (view.value.more > 0)
      lines.push(`+${view.value.more} more: ${TASK_TOOL.list}`);
  }
  if (view.state === "ready" && view.value.stale > 0) {
    lines.push(`${view.value.stale} open ${view.value.stale === 1 ? "task" : "tasks"} untouched for ${staleDays} days or more, not shown: ${TASK_TOOL.list} with scope "project", then finish or drop them.`);
  }
  const record = readMcpRecords(paths.stateDir)[TASKS_SERVER_NAME];
  if (record === undefined || record.pending === true) {
    lines.push(`The kit's task list is not set up on this machine yet: run \`${COMMAND} setup\`.`);
  }
  return lines.length === 0 ? SILENT : addContext("SessionStart", lines.join(`
`));
}

// src/hooks/tier-view.ts
import { existsSync as existsSync21, mkdirSync as mkdirSync14, readFileSync as readFileSync31, rmSync as rmSync5, writeFileSync as writeFileSync7 } from "fs";
import { dirname as dirname16, join as join31 } from "path";

// src/cli/usage-window.ts
import { existsSync as existsSync20, readFileSync as readFileSync28 } from "fs";
import { join as join29 } from "path";
var WINDOW_SPAN_MS = 5 * 60 * 60000;
var SEVEN_DAY_SPAN_MS = 7 * 24 * 60 * 60000;
function usageWindowFile(paths) {
  return join29(paths.stateDir, "usage-window.json");
}
var windowSchema = object({ percent: number2(), resetsAt: number2().nullable() });
var storedSchema = looseObject({
  fiveHour: windowSchema.optional(),
  readAt: string2(),
  sevenDay: windowSchema.optional()
});
function readStored(file) {
  if (!existsSync20(file))
    return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync28(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function currentWindow(window, readAt, spanMs, nowMs) {
  if (window === undefined)
    return null;
  if (window.resetsAt !== null)
    return window.resetsAt * 1000 <= nowMs ? null : window;
  const read = Date.parse(readAt);
  return Number.isFinite(read) && nowMs - read > spanMs ? null : window;
}
function readUsageWindows(paths, nowMs) {
  const stored = readStored(usageWindowFile(paths));
  if (stored === null)
    return { fiveHour: null, readAt: null, sevenDay: null };
  const readAt = Date.parse(stored.readAt);
  return {
    fiveHour: currentWindow(stored.fiveHour, stored.readAt, WINDOW_SPAN_MS, nowMs),
    readAt: Number.isFinite(readAt) ? readAt : null,
    sevenDay: currentWindow(stored.sevenDay, stored.readAt, SEVEN_DAY_SPAN_MS, nowMs)
  };
}

// src/gateway/checks-down.ts
import { readFileSync as readFileSync29 } from "fs";
function checksDownNow(statePath, nowMs) {
  try {
    const state = parseLimitState(readFileSync29(statePath, "utf8"));
    return state === null ? [] : currentChecksDown(state, nowMs);
  } catch {
    return [];
  }
}
function claudeWords(record, nowMs, timeZone) {
  if (record.claim !== null || record.resetsAt !== null) {
    const claim = record.claim === null ? "" : ` (${record.claim})`;
    const reset = record.resetsAt === null ? "" : ` until ${formatClock(record.resetsAt, nowMs, timeZone)}`;
    return `Claude is at its plan limit${claim}${reset}`;
  }
  if (record.why === "failed")
    return "Claude is limited or down";
  return record.status === 429 ? "Claude is rate-limiting requests (HTTP 429)" : `Claude is down (HTTP ${String(record.status)})`;
}
var CAUSES = {
  "chain-failed": (record) => `your judge chain failed (HTTP ${String(record.status)})`,
  "chain-untested": () => "no target of your judge chain has passed the judge test",
  failed: (record) => `the stand-in failed too (HTTP ${String(record.status)})`,
  "no-worker": () => "the worker slot has no affordable target to stand in",
  off: () => "the judge's stand-in is switched off",
  untested: () => "no worker target has passed the judge test"
};
function checksDownCause(record) {
  return CAUSES[record.why](record);
}
function checksDownReason(record, nowMs, timeZone) {
  const cause = checksDownCause(record);
  if (record.why === "chain-failed")
    return cause;
  return `${claudeWords(record, nowMs, timeZone)}, and ${cause}`;
}
function checksDownFix(record, profile, nowMs, timeZone) {
  const own = (machine, forProfile) => `${COMMAND} ${profile === null ? machine : forProfile(profile)}`;
  switch (record.why) {
    case "untested":
      return `${COMMAND} gateway setup`;
    case "no-worker":
      return own("gateway slot worker <targets>", (name) => `gateway profile ${name} slot worker <targets>`);
    case "off":
      return own("gateway fallback judge on", (name) => `gateway profile ${name} fallback judge on`);
    case "chain-untested":
      return `${COMMAND} gateway slot judge <targets>`;
    case "chain-failed":
      return `${COMMAND} gateway status`;
    case "failed":
      return record.resetsAt === null ? `wait for Claude to answer again (${COMMAND} gateway status shows the stand-in)` : `wait until ${formatClock(record.resetsAt, nowMs, timeZone)}`;
  }
}
function checksDownNote(record, profile, nowMs, timeZone) {
  return `Auto mode's safety checks are failing: ${checksDownReason(record, nowMs, timeZone)}. You cannot fix this; say it to the person once (what they can do: ${checksDownFix(record, profile, nowMs, timeZone)}), then stop and wait \u2014 do not retry or argue.`;
}

// src/machine/claude-settings.ts
import { readFileSync as readFileSync30, statSync as statSync11 } from "fs";
import { basename as basename6, dirname as dirname15, join as join30, resolve as resolve11 } from "path";
function settingsPathsOf(sources) {
  const mainLocal = join30(sources.mainCheckout, ".claude", "settings.local.json");
  const projectLocal = join30(sources.projectFolder, ".claude", "settings.local.json");
  return [
    ...mainLocal === projectLocal ? [] : [mainLocal],
    projectLocal,
    join30(sources.projectFolder, ".claude", "settings.json"),
    join30(sources.configDir, "settings.json")
  ];
}
function mainCheckoutOfFolder(folder) {
  for (let dir = resolve11(folder);; dir = dirname15(dir)) {
    const root = checkoutRootAt(dir);
    if (root !== null)
      return root;
    if (dirname15(dir) === dir)
      return resolve11(folder);
  }
}
function checkoutRootAt(dir) {
  const entry = join30(dir, ".git");
  try {
    if (statSync11(entry).isDirectory())
      return dir;
    const line = readFileSync30(entry, "utf8").split(`
`, 1)[0] ?? "";
    if (!line.startsWith("gitdir:"))
      return dir;
    const gitdir = resolve11(dir, line.slice("gitdir:".length).trim());
    const worktrees = dirname15(gitdir);
    const common = dirname15(worktrees);
    return basename6(worktrees) === "worktrees" && basename6(common) === ".git" ? dirname15(common) : dir;
  } catch {
    return null;
  }
}

// src/models/tier-view.ts
var TIERS = ["haiku", "sonnet", "opus", "fable"];
var TIER_NOTE_HEADER = "Subagent tiers now (the Agent tool's `model`):";
function modelName(real) {
  if (!real.claude)
    return `${real.model} (a backend)`;
  const family = answeringFamily(real);
  return family === null ? real.model : `Claude ${familyLabel(family)}`;
}
var TIER_NOTE_FOOTER = `Choose the tier and effort by the job (\`/cc-smart-dev-kit:subagent-decision\`), never by the model behind a tier. \`opus\` at \`${OPUS_ASK_EFFORT}\` and any \`fable\` launch (with a \`Fable reason:\` line) ask the person.`;
function tierLine(tier, gateway, env) {
  const real = resolveLaunchModel(tier, gateway, env);
  return `- ${tier} \u2192 ${modelName(real)}.`;
}
function tierNote(gateway, env) {
  return [
    TIER_NOTE_HEADER,
    ...TIERS.map((tier) => tierLine(tier, gateway, env)),
    TIER_NOTE_FOOTER
  ].join(`
`);
}

// src/hooks/tier-view.ts
function tierNoteUnknown() {
  return `Subagent tiers now: not known \u2014 the gateway config cannot be read (\`${COMMAND} doctor\` says why). The Agent guard judges each launch and names the effort it needs.`;
}
function tierViewMark(env, sessionId) {
  return join31(namesDir(env), `${sessionId}.tiers`);
}
function currentNote(paths, env) {
  const gateway = sessionGatewayOf(paths, env);
  if (gateway.gatewayOn && gateway.config === null && existsSync21(paths.gatewayConfigFile)) {
    return tierNoteUnknown();
  }
  return tierNote(gateway, env);
}
function checksNote(paths, env, nowMs) {
  const gateway = sessionGatewayOf(paths, env);
  if (!gateway.gatewayOn)
    return null;
  const found = checksDownNow(paths.gatewayStateFile, nowMs).find(([key]) => scopeOfStateKey(key).profile === gateway.profile);
  return found === undefined ? null : checksDownNote(found[1], gateway.profile, nowMs);
}
function lastSaid2(mark) {
  try {
    return readFileSync31(mark, "utf8");
  } catch {
    return null;
  }
}
function keep(mark, note) {
  try {
    mkdirSync14(dirname16(mark), { recursive: true });
    writeFileSync7(mark, note);
    return true;
  } catch {
    return false;
  }
}
var USAGE_THRESHOLDS = [50, 75, 90];
var USAGE_WINDOWS = [
  ["fiveHour", "5-hour"],
  ["sevenDay", "7-day"]
];
function usageMark(env, sessionId) {
  return join31(namesDir(env), `${sessionId}.usage`);
}
function usageLevel(percent) {
  let level = 0;
  for (const threshold of USAGE_THRESHOLDS)
    if (percent >= threshold)
      level = threshold;
  return level;
}
function toldUsage(mark) {
  const text = lastSaid2(mark);
  if (text === null)
    return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
function usageLine(windows, told, nowMs, timeZone) {
  const next = {};
  const parts = [];
  for (const [key, name] of USAGE_WINDOWS) {
    const window = windows[key];
    const before = told[key];
    const same = before !== undefined && typeof before.resetsAt === "number" && typeof before.level === "number" && before.resetsAt * 1000 > nowMs;
    if (same)
      next[key] = before;
    if (window === null || window.resetsAt === null || window.resetsAt * 1000 <= nowMs)
      continue;
    const level = usageLevel(window.percent);
    if (level <= (same ? before.level : 0))
      continue;
    next[key] = { level, resetsAt: window.resetsAt };
    parts.push(`${name} window ${Math.floor(window.percent)}% used (resets ${formatClock(window.resetsAt, nowMs, timeZone)})`);
  }
  if (parts.length === 0)
    return { line: null, next };
  const asOf = windows.readAt === null ? "" : ` (as of ${formatClock(Math.floor(windows.readAt / 1000), nowMs, timeZone)})`;
  return {
    line: `Plan usage${asOf}: ${parts.join("; ")}. Follow /cc-smart-dev-kit:subagent-decision \xA7 Usage left.`,
    next
  };
}
var PROVIDER_ENV = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY"
];
function setText(value) {
  return (value ?? "").trim() !== "";
}
function otherLogin(env, paths, cwd) {
  if (PROVIDER_ENV.some((key) => switchOn(env[key])))
    return true;
  if (LOGIN_OVERRIDE_ENV.some((key) => setText(env[key])))
    return true;
  if (setText(env.ANTHROPIC_PROFILE))
    return true;
  if (setText(env.ANTHROPIC_FEDERATION_RULE_ID) && setText(env.ANTHROPIC_ORGANIZATION_ID)) {
    return true;
  }
  const files = settingsPathsOf({
    configDir: paths.claudeConfigDir,
    mainCheckout: mainCheckoutOfFolder(cwd),
    projectFolder: cwd
  });
  return files.some((file) => {
    try {
      return readGatewaySettings(file).loginOverrides.includes("apiKeyHelper");
    } catch {
      return false;
    }
  });
}
function usageNote(paths, env, sessionId, cwd, nowMs, timeZone) {
  const windows = readUsageWindows(paths, nowMs);
  if (windows.fiveHour === null && windows.sevenDay === null)
    return null;
  const mark = usageMark(env, sessionId);
  const { line, next } = usageLine(windows, toldUsage(mark), nowMs, timeZone);
  if (line === null || otherLogin(env, paths, cwd))
    return null;
  return keep(mark, JSON.stringify(next)) ? line : null;
}
function forgetUsage(env, sessionId) {
  try {
    rmSync5(usageMark(env, sessionId), { force: true });
  } catch {}
}
function tierView(input, env, paths, nowMs = Date.now(), timeZone) {
  const event = stringField(input.hook_event_name);
  if (event !== "SessionStart" && event !== "UserPromptSubmit")
    return SILENT;
  const sessionId = input.session_id;
  const mark = isSessionId(sessionId) ? tierViewMark(env, sessionId) : null;
  const checks = checksNote(paths, env, nowMs);
  const note = checks === null ? currentNote(paths, env) : [currentNote(paths, env), checks].join(`

`);
  if (event === "SessionStart") {
    if (mark !== null)
      keep(mark, note);
    const source = stringField(input.source);
    if (isSessionId(sessionId) && (source === "compact" || source === "clear")) {
      forgetUsage(env, sessionId);
    }
    return addContext(event, note);
  }
  if (mark === null || !isSessionId(sessionId))
    return SILENT;
  const parts = [];
  if (lastSaid2(mark) !== note && keep(mark, note))
    parts.push(note);
  const cwd = stringField(input.cwd);
  const usage = cwd === null ? null : usageNote(paths, env, sessionId, cwd, nowMs, timeZone);
  if (usage !== null)
    parts.push(usage);
  return parts.length === 0 ? SILENT : addContext(event, parts.join(`

`));
}

// src/hooks/verify-gate.ts
import { extname, isAbsolute as isAbsolute9, join as join32, resolve as resolve12 } from "path";
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
function resultText2(content) {
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
      const text = resultText2(block.content);
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
function verifyGateWouldBlock(input, config, env) {
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
  const root = realPath(checkout.root);
  const paths = cliPaths(env);
  let plans = join32(paths.claudeConfigDir, "plans");
  for (const settings of [
    paths.settingsFile,
    join32(root, ".claude/settings.json"),
    join32(root, ".claude/settings.local.json")
  ]) {
    const configured = stringField(readJsonObject(settings).data.plansDirectory);
    if (configured !== null)
      plans = configured.startsWith("~/") ? join32(paths.home, configured.slice(2)) : resolve12(root, configured);
  }
  const excluded = [realPath(plans), realPath(join32(root, ".claude/plans"))];
  const seen = seenIn(lines, check, (block, editCwd) => {
    const fields = objectOf(block.input);
    const path = stringField(block.name === "NotebookEdit" ? fields?.notebook_path : fields?.file_path);
    if (path === null || path.trim() === "" || path.includes("\x00") || !isAbsolute9(path) && (editCwd === null || !isAbsolute9(editCwd)))
      return true;
    const file = editedFile({ tool_input: { file_path: path } }, editCwd ?? cwd);
    if (file === null)
      return true;
    return isInside(file, root) && ![".md", ".mdx"].includes(extname(file).toLowerCase()) && !excluded.some((folder) => isInside(file, folder));
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

// src/hooks/worktree-leftovers.ts
import { closeSync as closeSync7, existsSync as existsSync22, fstatSync as fstatSync3, openSync as openSync7, readSync as readSync5, statSync as statSync12 } from "fs";
import { basename as basename7, join as join34, resolve as resolve13 } from "path";

// src/hooks/local-files.ts
import {
  closeSync as closeSync6,
  lstatSync as lstatSync2,
  openSync as openSync6,
  readdirSync as readdirSync7,
  readFileSync as readFileSync32,
  readlinkSync as readlinkSync4,
  readSync as readSync4
} from "fs";
import { join as join33 } from "path";
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
var INCLUDE_COPY_SLACK_MS = 120000;
var FIRST_REFLOG_BYTES = 4096;
function setupTime(worktree) {
  const admin = worktreeAdminDir(worktree);
  if (admin === null)
    return null;
  const times = [];
  try {
    const time = lstatSync2(join33(admin, "commondir")).mtimeMs;
    if (Number.isFinite(time))
      times.push(time);
  } catch {}
  try {
    const fd = openSync6(join33(admin, "logs", "HEAD"), "r");
    try {
      const buffer = Buffer.alloc(FIRST_REFLOG_BYTES);
      const size = readSync4(fd, buffer, 0, buffer.length, 0);
      const text = buffer.toString("utf8", 0, size);
      const end = text.indexOf(`
`);
      if (end !== -1 || size < buffer.length) {
        const time = reflogEntryTime(end === -1 ? text : text.slice(0, end));
        if (time !== null)
          times.push(time);
      }
    } finally {
      closeSync6(fd);
    }
  } catch {}
  return times.length === 0 ? null : Math.min(...times);
}
function untouchedCopy(worktree, mainCheckout, entry) {
  try {
    const here = lstatSync2(join33(worktree, entry));
    if (!here.isFile() || !lstatSync2(join33(mainCheckout, entry)).isFile())
      return false;
    const setup = setupTime(worktree);
    return setup !== null && here.mtimeMs <= setup + INCLUDE_COPY_SLACK_MS;
  } catch {
    return false;
  }
}
function parseIgnored(porcelain) {
  return porcelain.split("\x00").filter((entry) => entry.startsWith("!! ")).map((entry) => entry.slice(3));
}
function sameAsMain(worktree, mainCheckout, path) {
  let budget = MAX_COMPARED;
  const same = (relative) => {
    if (--budget < 0)
      return false;
    const here = join33(worktree, relative);
    const there = join33(mainCheckout, relative);
    try {
      const a = lstatSync2(here);
      const b = lstatSync2(there);
      if (a.isSymbolicLink() || b.isSymbolicLink()) {
        return a.isSymbolicLink() && b.isSymbolicLink() && readlinkSync4(here) === readlinkSync4(there);
      }
      if (a.isDirectory()) {
        return b.isDirectory() && readdirSync7(here).every((entry) => same(join33(relative, entry)));
      }
      return a.isFile() && b.isFile() && a.size === b.size && readFileSync32(here).equals(readFileSync32(there));
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
    const patterns = loadCcSmartDevKitConfig(join33(mainCheckout, CONFIG_PATH))?.worktrees?.rebuildable ?? [];
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
      if (lstatSync2(join33(worktree, entry)).isFile())
        return true;
    } catch {
      return false;
    }
  }
  return mainCheckout !== null && (sameAsMain(worktree, mainCheckout, entry) || untouchedCopy(worktree, mainCheckout, entry));
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
        if (!lstatSync2(join33(worktree, path)).isDirectory())
          return safe(path);
        const folder = `${path.replace(/\/$/, "")}/`;
        return safe(folder) || readdirSync7(join33(worktree, path)).every((name) => visit(`${folder}${name}`));
      } catch {
        return false;
      }
    };
    return visit(entry);
  };
  return parseIgnored(status.out).filter((entry) => !safe(entry) && !onlySafeInside(entry));
}

// src/hooks/worktree-leftovers.ts
var IDLE_MINUTES = 60;
var REFLOG_TAIL_BYTES = 8 * 1024;
function lastReflogTime(file, now) {
  try {
    const fd = openSync7(file, "r");
    try {
      const size = fstatSync3(fd).size;
      const start = Math.max(0, size - REFLOG_TAIL_BYTES);
      const buffer = Buffer.alloc(Math.min(size, REFLOG_TAIL_BYTES));
      const length = readSync5(fd, buffer, 0, buffer.length, start);
      const tail = buffer.toString("utf8", 0, length);
      const end = tail.lastIndexOf(`
`);
      if (end < 0)
        return null;
      const previous = tail.lastIndexOf(`
`, end - 1);
      if (start > 0 && previous < 0)
        return null;
      const time = reflogEntryTime(tail.slice(previous + 1, end));
      return time !== null && time <= now ? time : null;
    } finally {
      closeSync7(fd);
    }
  } catch {
    return null;
  }
}
function idleMinutesOrNull(worktree, now) {
  const admin = worktreeAdminDir(worktree);
  if (admin === null)
    return null;
  let last = lastReflogTime(join34(admin, "logs", "HEAD"), now) ?? 0;
  for (const file of ["index", "HEAD"]) {
    try {
      last = Math.max(last, statSync12(join34(admin, file)).mtimeMs);
    } catch {}
  }
  return last === 0 ? null : (now - last) / 60000;
}
function idleMinutes(worktree, now) {
  return idleMinutesOrNull(worktree, now) ?? 0;
}
function judgeWorktree(repo, listed, base, sessions, env, now) {
  if (listed.locked)
    return "kept";
  if (listed.prunable)
    return "gone";
  try {
    statSync12(listed.path);
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
function leftoversNote(base, finished, gone, keptBy = new Map) {
  const parts = [];
  if (finished.length > 0) {
    const names = cappedHookList(finished, (worktree) => {
      const why = keptBy.get(worktree.path);
      return why === undefined ? basename7(worktree.path) : `${basename7(worktree.path)} (kept by the last clean: ${why})`;
    }, "git worktree list --porcelain");
    const count = finished.length === 1 ? "1 finished worktree is" : `${finished.length} finished worktrees are`;
    parts.push(`${count} left in this repo: ${names}. Each has every commit on origin/${base}, nothing uncommitted, no running session, and no git use for an hour. ` + "Tell the user, and when they agree, clear them in the main checkout with `cc-smart-dev-kit worktrees --clean` \u2014 it judges each one again, Docker containers and running programs included, before it removes anything.");
  }
  if (gone.length > 0) {
    parts.push(`${gone.length === 1 ? "1 worktree is still listed, but its folder is gone" : `${gone.length} worktrees are still listed, but their folders are gone`}: ${cappedHookList(gone, (worktree) => worktree.path, "git worktree list --porcelain")}. \`git worktree prune\` in the main checkout forgets ${gone.length === 1 ? "it" : "them"}.`);
  }
  return parts.length === 0 ? null : parts.join(`
`);
}
function operationInProgress(repo, env) {
  const paths = runGit(repo, [
    "rev-parse",
    "--git-path",
    "MERGE_HEAD",
    "--git-path",
    "rebase-merge",
    "--git-path",
    "rebase-apply",
    "--git-path",
    "CHERRY_PICK_HEAD"
  ], env, GUARD_GIT_TIMEOUT_MS);
  if (!paths.ok)
    return null;
  const [merge, rebaseMerge, rebaseApply, cherryPick] = paths.out.split(/\r?\n/);
  const held = (path) => path !== undefined && path !== "" && existsSync22(resolve13(repo, path));
  if (held(merge))
    return "merge";
  if (held(rebaseMerge) || held(rebaseApply))
    return "rebase";
  if (held(cherryPick))
    return "cherry-pick";
  return null;
}
function mainFolderNotes(repo, main, base, env, guarded) {
  if (!isAttended(env))
    return [];
  const notes = [];
  const fix = (own, command, when) => guarded ? `ask the person to run \`${command}\` in the main checkout ${when}` : `${own} ${when}`;
  const operation = operationInProgress(repo, env);
  if (operation !== null) {
    notes.push(guarded ? `The main checkout is in the middle of a ${operation}: ask the person to finish it or abort it before starting a new worktree.` : `The main checkout is in the middle of a ${operation}: finish it or abort it before starting a new worktree.`);
  }
  const onBase = main.branch === base;
  if (!onBase) {
    const where = main.branch === null ? "a detached HEAD" : `\`${main.branch}\``;
    notes.push(`The main checkout is on ${where}, not \`${base}\`: a new worktree starts from its HEAD, so ${fix(`switch it to \`${base}\``, `git switch ${base}`, "first.")}`);
  }
  const behind = runGit(repo, ["rev-list", "--count", `refs/heads/${base}..refs/remotes/origin/${base}`], env, GUARD_GIT_TIMEOUT_MS);
  const count = behind.ok && /^\d+$/.test(behind.out) ? Number(behind.out) : 0;
  if (count > 0) {
    const commits = `${count} ${count === 1 ? "commit" : "commits"} behind origin/${base}`;
    const step = fix(`fast-forward it there (\`git merge --ff-only origin/${base}\`)`, `git merge --ff-only origin/${base}`, "before starting a new worktree.");
    notes.push(onBase ? `The main checkout is ${commits}: ${step}` : `The main checkout's \`${base}\` is ${commits}: after the switch, ${step}`);
  }
  return notes;
}
function worktreeLeftovers(context) {
  const { project, env, paths, event } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined)
    return SILENT;
  const repo = project.mainCheckout ?? project.root;
  const told = takeToldLine(context, repo);
  const [main, ...linked] = listWorktrees(repo, env);
  const guarded = project.config?.worktrees?.guardMainFolder === true;
  const mainNotes = main === undefined ? [] : mainFolderNotes(repo, main, base, env, guarded);
  const answer = (note) => {
    const lines = [...mainNotes, ...note === null ? [] : [note]];
    if (lines.length === 0)
      return told === null ? SILENT : systemMessage(told);
    const text = lines.join(`
`);
    return told === null ? addContext(event, text) : addContextAndMessage(event, text, told);
  };
  if (linked.length === 0)
    return answer(null);
  startAutoClean(context, repo, "session");
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], env).ok) {
    return answer(null);
  }
  let sessions;
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    return answer(null);
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
  const kept = readRepoRecord(autoCleanFiles(paths.stateDir, repo))?.kept ?? [];
  return answer(leftoversNote(base, finished, gone, new Map(kept.map((one) => [one.path, one.why]))));
}

// src/hooks/specs.ts
function cannotCheck(what, message) {
  return `cc-smart-dev-kit cannot check ${what}: ${message}`;
}
function guardCrash(what, inDomain) {
  return (why, input, event) => {
    if (event !== "" && event !== "PreToolUse")
      return SILENT;
    if (input !== null && !judgesCall(inDomain, input))
      return SILENT;
    return toolDecision("ask", cannotCheck(what, why));
  };
}
function judgesCall(inDomain, input) {
  try {
    return inDomain(input);
  } catch {
    return true;
  }
}
function toolOf2(input) {
  return input === null ? "" : stringField(input.tool_name) ?? "";
}
function commandOf3(input) {
  return input === null ? "" : stringField(toolInput(input).command) ?? "";
}
var gitGuardHook = {
  name: "git-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command !== null && runsGit(command) ? toolDecision("ask", cannotCheck("this git command", message)) : SILENT;
  },
  onCrash: guardCrash("this git command", (input) => {
    const command = commandOf3(input);
    return command !== "" && runsGit(command);
  }),
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  run: (context) => {
    const { project, input, cwd, env } = context;
    const config = project.config;
    if (config === null)
      return SILENT;
    const command = stringField(toolInput(input).command);
    if (command === null)
      return SILENT;
    const questions = guardQuestions(command, cwd, {
      protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
      autoPushAsk: () => autoPushQuestion(context),
      sharedStash: config.worktrees !== undefined || project.isWorktree,
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
    if (command === null)
      return SILENT;
    if (requestsPullRequestChange(command)) {
      return toolDecision("ask", cannotCheck("whether this merge may happen by itself", message));
    }
    return requestsIssueWrite(command) ? toolDecision("ask", cannotCheck("whether this issue write may happen by itself", message)) : SILENT;
  },
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  onCrash: guardCrash("whether this merge may happen by itself", (input) => {
    const command = commandOf3(input);
    return command !== "" && (requestsPullRequestChange(command) || requestsIssueWrite(command));
  }),
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
  onCrash: guardCrash("whether this edit belongs in a worktree", (input) => ["Edit", "Write", "NotebookEdit"].includes(toolOf2(input))),
  run: mainFolderGuard
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
var subagentBackgroundHook = {
  name: "subagent-background",
  events: ["SubagentStop"],
  onConfigProblem: (message) => ({
    stderr: `cc-smart-dev-kit subagent-background: ${message}`
  }),
  run: subagentBackground
};
var builderFinishHook = {
  name: "builder-finish",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, checkout, context) => builderFinishAnswer(input, event, checkout, context.paths),
  run: builderFinish
};
var verifyGateHook = {
  name: "verify-gate",
  events: ["Stop"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit verify-gate: ${message}` }),
  run: verifyGate
};
var keepGoingHook = {
  name: KEEP_GOING,
  events: ["Stop"],
  onConfigProblem: (_message, input, event, checkout, context) => event === "Stop" ? keepGoingAnswer(input, checkout, context.paths, context.env) : SILENT,
  run: keepGoing
};
var agentUsageHook = {
  name: "agent-usage",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, _checkout, context) => recordAgentUsage(input, event, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) => recordAgentUsage(input, event, context.paths, context.nowMs),
  run: ({ input, event, paths, nowMs }) => recordAgentUsage(input, event, paths, nowMs)
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
var userAwayHook = {
  name: "user-away",
  events: ["PreToolUse", "PermissionRequest", "UserPromptSubmit", "Stop"],
  alwaysOn: true,
  onConfigProblem: (_message, input, event, _checkout, context) => userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) => userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  onCrash: (why, input, event, context) => event === "PermissionRequest" || event === "UserPromptSubmit" || event === "Stop" ? { stderr: `cc-smart-dev-kit user-away: ${why}` } : guardCrash("whether the person is available", inAwayDomain)(why, input, event, context),
  run: ({ input, event, env, paths, nowMs }) => userAwayAnswer(input, event, env, paths, nowMs)
};
var agentGuardHook = {
  name: "agent-guard",
  events: ["PreToolUse", "PostToolUse"],
  onConfigProblem: (_message, input, _event, _checkout, context) => agentGuard(input, context.env, context.paths, cwdOf2(input)),
  outsideGit: (input, _event, _why, context) => agentGuard(input, context.env, context.paths, cwdOf2(input)),
  onCrash: guardCrash("the model this launch runs on", (input) => [...AGENT_TOOLS, ...WORKFLOW_TOOLS].includes(toolOf2(input))),
  logFacts: guardFacts,
  run: ({ input, env, paths, cwd }) => agentGuard(input, env, paths, cwd)
};
var sessionEscapeGuardHook = {
  name: "session-escape-guard",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: (_message, input, _event, _checkout, context) => sessionEscapeGuard(input, context.paths, process.platform),
  outsideGit: (input, _event, _why, context) => sessionEscapeGuard(input, context.paths, process.platform),
  onCrash: guardCrash("whether this call goes around the limits set for the session", inEscapeDomain),
  run: ({ input, paths }) => sessionEscapeGuard(input, paths, process.platform)
};
var fableSessionHook = {
  name: "fable-session",
  events: ["SessionStart", "PostModelSwitch", "Stop"],
  onConfigProblem: (_message, input, _event, _checkout, context) => fableSession(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => fableSession(input, context.env, context.paths),
  run: ({ input, env, paths }) => fableSession(input, env, paths)
};
var tierViewHook = {
  name: "tier-view",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (_message, input, _event, _checkout, context) => tierView(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => tierView(input, context.env, context.paths),
  run: ({ input, env, paths }) => tierView(input, env, paths)
};
var jobRouteHook = {
  name: "job-route",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: (message, input, _event, _checkout, context) => jobRouteConfigAnswer(message, input, context),
  outsideGit: (input, _event, _why, context) => jobRouteOutsideGit(input, context),
  logFacts: routeFacts,
  onCrash: guardCrash("whether this launch or heavy command may run", jobRouteDomain),
  run: jobRoute
};
function cwdOf2(input) {
  return stringField(input.cwd) ?? "";
}
var taskStartHook = {
  name: "task-start",
  events: ["SessionStart"],
  onConfigProblem: (_message, input, _event, _checkout, context) => taskStart(input, context.paths, context.env),
  outsideGit: (input, _event, _why, context) => taskStart(input, context.paths, context.env),
  run: ({ input, paths, env }) => taskStart(input, paths, env)
};
var HOOKS = [
  taskStartHook,
  gitGuardHook,
  mergeGuardHook,
  mainFolderGuardHook,
  agentGuardHook,
  sessionEscapeGuardHook,
  fableSessionHook,
  tierViewHook,
  jobRouteHook,
  afterMergeHook,
  reviewRecordHook,
  subagentBackgroundHook,
  builderFinishHook,
  verifyGateHook,
  keepGoingHook,
  agentUsageHook,
  worktreeLeftoversHook,
  sessionNameHook,
  userAwayHook
];
var NON_GUARD_PRE_TOOL_USE = new Set(["playwright-output"]);
var GUARD_BUNDLES = new Set(HOOKS.filter((spec) => spec.events.includes("PreToolUse") && !NON_GUARD_PRE_TOOL_USE.has(spec.name)).map((spec) => spec.name));
var USER_HOOKS = ["update-check", "playwright-output"];
var MACHINE_WIDE_HOOKS = [
  ...USER_HOOKS,
  "task-start",
  "keep-going",
  "builder-finish",
  "agent-guard",
  "fable-session",
  "tier-view",
  "session-escape-guard",
  "agent-usage",
  "user-away"
];

// src/entries/job-route.ts
await runHookEntry(jobRouteHook);
