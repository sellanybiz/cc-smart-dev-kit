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
  version: "3.0.1",
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
function numberSchema(rule) {
  const whole = number2().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}
var NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
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
  clearWorktreeAfterMerge: false,
  issues: {
    enabled: false,
    allowPublic: false,
    foundLabel: "kit:found",
    fixedLabel: "fixed-unreleased",
    readyLabel: "kit:ready"
  },
  alerts: {
    usagePercent: 85
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
  "alerts.usagePercent"
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
  "message-guard",
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
  "lead-notes"
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
var ASSIGNMENT = /^[A-Za-z_]\w*=/;
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
import { realpathSync as realpathSync3 } from "fs";
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

// src/workflow/reviews.ts
import { createHash } from "crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync10 } from "fs";
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
    const parsed = JSON.parse(readFileSync10(file, "utf8"));
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
      projectTasks: { ok: false, why: "not in a git checkout: project tasks live in a repository" }
    };
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  const base = {
    ok: true,
    project: keyOf(checkout, cwd),
    repo,
    checkoutRoot: checkout.root
  };
  let settings;
  try {
    settings = loadProjectConfig(checkout).config?.tasks;
  } catch (error) {
    return { ...base, projectTasks: { ok: false, why: checkoutFailure(error) } };
  }
  const root = checkout.root;
  return {
    ...base,
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
  STOP_FEEDBACK
];
function hasNotPersonWrapper(prompt) {
  return NOT_PERSON_PREFIXES.some((prefix) => prompt.startsWith(prefix));
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

// node_modules/acorn/dist/acorn.mjs
var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 31, 4, 33, 15, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 199, 7, 137, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 55, 9, 7, 0, 259, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 481, 1, 61, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 12, 2, 9, 1, 3, 0, 33, 1, 1357, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 233, 0, 3, 0, 8, 1, 6, 0, 475, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];
var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 13, 65, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 7, 25, 39, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 5, 18, 21, 18, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 18, 0, 182, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 24, 43, 22, 0, 239, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 111, 6, 206, 13, 310, 2314, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 33, 24, 3, 24, 45, 74, 6, 0, 67, 12, 65, 1, 2, 0, 15, 4, 10, 7386, 37, 33, 96, 114, 14, 913, 15, 50, 7710, 3, 2, 6, 2, 1, 2, 296, 10, 0, 30, 2, 3, 0, 15, 4, 8, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 340, 2, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 129, 15, 6, 55, 50, 49, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 208, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 225, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4382, 2, 5773, 3, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 8489, 39815, 11327];
var nonASCIIidentifierChars = "\u200C\u200D\xB7\u0300-\u036F\u0387\u0483-\u0487\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05C9\u0610-\u061A\u064B-\u0669\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u06F0-\u06F9\u0711\u0730-\u074A\u07A6-\u07B0\u07C0-\u07C9\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u0897-\u089F\u08CA-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0966-\u096F\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09E6-\u09EF\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A66-\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AE6-\u0AEF\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B53-\u0B57\u0B62\u0B63\u0B66-\u0B6F\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0BE6-\u0BEF\u0C00-\u0C04\u0C3C\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0CE6-\u0CEF\u0CF3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D66-\u0D6F\u0D81-\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E50-\u0E59\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECE\u0ED0-\u0ED9\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1040-\u1049\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F-\u109D\u135D-\u135F\u1369-\u1371\u1712-\u1715\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u17E0-\u17E9\u180B-\u180D\u180F-\u1819\u18A9\u1920-\u192B\u1930-\u193B\u1946-\u194F\u19D0-\u19DA\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AB0-\u1ABD\u1ABF-\u1AF0\u1B00-\u1B04\u1B34-\u1B44\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BB0-\u1BB9\u1BE6-\u1BF3\u1C24-\u1C37\u1C40-\u1C49\u1C50-\u1C59\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DFF\u200C\u200D\u203F\u2040\u2054\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\u30FB\uA620-\uA629\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA880\uA881\uA8B4-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F1\uA8FF-\uA909\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9D0-\uA9D9\uA9E5\uA9F0-\uA9F9\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA50-\uAA59\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uABF0-\uABF9\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFF10-\uFF19\uFF3F\uFF65";
var nonASCIIidentifierStartChars = "\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0558\u0559\u0560-\u0588\u058B\u058C\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u0870-\u0887\u0889-\u088F\u08A0-\u08C9\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C5C\u0C5D\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDC-\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u1711\u171F-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4C\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C8A\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u208F-\u209F\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7DD\uA7E2\uA7F1-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB6C\uAB6D\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC";
var reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"
};
var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";
var keywords$1 = {
  5: ecma5AndLessKeywords,
  "5module": ecma5AndLessKeywords + " export import",
  6: ecma5AndLessKeywords + " const class extends export import super"
};
var keywordRelationalOperator = /^in(stanceof)?$/;
var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
function isInAstralSet(code, set) {
  var pos = 65536;
  for (var i = 0;i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) {
      return false;
    }
    pos += set[i + 1];
    if (pos >= code) {
      return true;
    }
  }
  return false;
}
function isIdentifierStart(code, astral) {
  if (code < 65) {
    return code === 36;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifierStart.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes);
}
function isIdentifierChar(code, astral) {
  if (code < 48) {
    return code === 36;
  }
  if (code < 58) {
    return true;
  }
  if (code < 65) {
    return false;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifier.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}
var TokenType = function TokenType(label, conf) {
  if (conf === undefined)
    conf = {};
  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
};
function binop(name, prec) {
  return new TokenType(name, { beforeExpr: true, binop: prec });
}
var beforeExpr = { beforeExpr: true };
var startsExpr = { startsExpr: true };
var keywords = {};
function kw(name, options) {
  if (options === undefined)
    options = {};
  options.keyword = name;
  return keywords[name] = new TokenType(name, options);
}
var types$1 = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"),
  bracketL: new TokenType("[", { beforeExpr: true, startsExpr: true }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr: true, startsExpr: true }),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", { beforeExpr: true, startsExpr: true }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", { beforeExpr: true, startsExpr: true }),
  eq: new TokenType("=", { beforeExpr: true, isAssign: true }),
  assign: new TokenType("_=", { beforeExpr: true, isAssign: true }),
  incDec: new TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }),
  prefix: new TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", { beforeExpr: true }),
  coalesce: binop("??", 1),
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", { isLoop: true, beforeExpr: true }),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", { isLoop: true }),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", { isLoop: true }),
  _with: kw("with"),
  _new: kw("new", { beforeExpr: true, startsExpr: true }),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", { beforeExpr: true, binop: 7 }),
  _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }),
  _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }),
  _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }),
  _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true })
};
var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");
function isNewLine(code) {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}
function nextLineBreak(code, from, end) {
  if (end === undefined)
    end = code.length;
  for (var i = from;i < end; i++) {
    var next = code.charCodeAt(i);
    if (isNewLine(next)) {
      return i < end - 1 && next === 13 && code.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
  }
  return -1;
}
var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
var ref = Object.prototype;
var hasOwnProperty = ref.hasOwnProperty;
var toString = ref.toString;
var hasOwn = Object.hasOwn || function(obj, propName) {
  return hasOwnProperty.call(obj, propName);
};
var isArray = Array.isArray || function(obj) {
  return toString.call(obj) === "[object Array]";
};
var regexpCache = Object.create(null);
function wordsRegexp(words) {
  return regexpCache[words] || (regexpCache[words] = new RegExp("^(?:" + words.replace(/ /g, "|") + ")$"));
}
function codePointToString(code) {
  if (code <= 65535) {
    return String.fromCharCode(code);
  }
  code -= 65536;
  return String.fromCharCode((code >> 10) + 55296, (code & 1023) + 56320);
}
var loneSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/;
var Position = function Position(line, col) {
  this.line = line;
  this.column = col;
};
Position.prototype.offset = function offset(n) {
  return new Position(this.line, this.column + n);
};
var SourceLocation = function SourceLocation(p, start, end) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) {
    this.source = p.sourceFile;
  }
};
function getLineInfo(input, offset) {
  for (var line = 1, cur = 0;; ) {
    var nextBreak = nextLineBreak(input, cur, offset);
    if (nextBreak < 0) {
      return new Position(line, offset - cur);
    }
    ++line;
    cur = nextBreak;
  }
}
var defaultOptions = {
  ecmaVersion: null,
  sourceType: "script",
  strict: false,
  onInsertedSemicolon: null,
  onTrailingComma: null,
  allowReserved: null,
  allowReturnOutsideFunction: false,
  allowImportExportEverywhere: false,
  allowAwaitOutsideFunction: null,
  allowSuperOutsideMethod: null,
  allowHashBang: false,
  checkPrivateFields: true,
  locations: false,
  startLocation: null,
  onToken: null,
  onComment: null,
  ranges: false,
  program: null,
  sourceFile: null,
  directSourceFile: null,
  preserveParens: false
};
var warnedAboutEcmaVersion = false;
function getOptions(opts) {
  var options = {};
  for (var opt in defaultOptions) {
    options[opt] = opts && hasOwn(opts, opt) ? opts[opt] : defaultOptions[opt];
  }
  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn(`Since Acorn 8.0.0, options.ecmaVersion is required.
Defaulting to 2020, but this will stop working in the future.`);
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }
  if (options.allowReserved == null) {
    options.allowReserved = options.ecmaVersion < 5;
  }
  if (!opts || opts.allowHashBang == null) {
    options.allowHashBang = options.ecmaVersion >= 14;
  }
  if (isArray(options.onToken)) {
    var tokens = options.onToken;
    options.onToken = function(token) {
      return tokens.push(token);
    };
  }
  if (isArray(options.onComment)) {
    options.onComment = pushComment(options, options.onComment);
  }
  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction) {
    throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs");
  }
  return options;
}
function pushComment(options, array) {
  return function(block, text, start, end, startLoc, endLoc) {
    var comment = {
      type: block ? "Block" : "Line",
      value: text,
      start,
      end
    };
    if (options.locations) {
      comment.loc = new SourceLocation(this, startLoc, endLoc);
    }
    if (options.ranges) {
      comment.range = [start, end];
    }
    array.push(comment);
  };
}
var SCOPE_TOP = 1;
var SCOPE_FUNCTION = 2;
var SCOPE_ASYNC = 4;
var SCOPE_GENERATOR = 8;
var SCOPE_ARROW = 16;
var SCOPE_SIMPLE_CATCH = 32;
var SCOPE_SUPER = 64;
var SCOPE_DIRECT_SUPER = 128;
var SCOPE_CLASS_STATIC_BLOCK = 256;
var SCOPE_CLASS_FIELD_INIT = 512;
var SCOPE_SWITCH = 1024;
var SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}
var BIND_NONE = 0;
var BIND_VAR = 1;
var BIND_LEXICAL = 2;
var BIND_FUNCTION = 3;
var BIND_SIMPLE_CATCH = 4;
var BIND_OUTSIDE = 5;
var Parser = function Parser(options, input, startPos) {
  this.options = options = getOptions(options);
  this.sourceFile = options.sourceFile;
  this.keywords = wordsRegexp(keywords$1[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
  var reserved = "";
  if (options.allowReserved !== true) {
    reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
    if (options.sourceType === "module") {
      reserved += " await";
    }
  }
  this.reservedWords = wordsRegexp(reserved);
  var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
  this.reservedWordsStrict = wordsRegexp(reservedStrict);
  this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
  this.input = String(input);
  this.containsEsc = false;
  this.pos = startPos || 0;
  this.curLine = 1;
  if (options.startLocation) {
    this.lineStart = this.pos - options.startLocation.column;
    this.curLine = options.startLocation.line;
  } else if (startPos) {
    this.lineStart = this.input.lastIndexOf(`
`, startPos - 1) + 1;
    if (this.options.locations) {
      this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
    }
  } else {
    this.lineStart = 0;
  }
  this.type = types$1.eof;
  this.value = null;
  this.start = this.end = this.pos;
  this.startLoc = this.endLoc = this.curPosition();
  this.lastTokEndLoc = this.lastTokStartLoc = null;
  this.lastTokStart = this.lastTokEnd = this.pos;
  this.context = this.initialContext();
  this.exprAllowed = true;
  this.inModule = options.sourceType === "module";
  this.strict = this.inModule || options.strict === true || this.strictDirective(this.pos);
  this.potentialArrowAt = -1;
  this.potentialArrowInForAwait = false;
  this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
  this.labels = [];
  this.undefinedExports = Object.create(null);
  if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!") {
    this.skipLineComment(2);
  }
  this.scopeStack = [];
  this.enterScope(this.options.sourceType === "commonjs" ? SCOPE_FUNCTION : SCOPE_TOP);
  this.regexpState = null;
  this.privateNameStack = [];
};
var prototypeAccessors = { inFunction: { configurable: true }, inGenerator: { configurable: true }, inAsync: { configurable: true }, canAwait: { configurable: true }, allowReturn: { configurable: true }, allowSuper: { configurable: true }, allowDirectSuper: { configurable: true }, treatFunctionsAsVar: { configurable: true }, allowNewDotTarget: { configurable: true }, allowUsing: { configurable: true }, inClassStaticBlock: { configurable: true } };
Parser.prototype.parse = function parse() {
  var this$1$1 = this;
  var node = this.options.program || this.startNode();
  this.nextToken();
  return this.catchStackOverflow(function() {
    return this$1$1.parseTopLevel(node);
  });
};
prototypeAccessors.inFunction.get = function() {
  return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0;
};
prototypeAccessors.inGenerator.get = function() {
  return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0;
};
prototypeAccessors.inAsync.get = function() {
  return (this.currentVarScope().flags & SCOPE_ASYNC) > 0;
};
prototypeAccessors.canAwait.get = function() {
  for (var i = this.scopeStack.length - 1;i >= 0; i--) {
    var ref = this.scopeStack[i];
    var flags = ref.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) {
      return false;
    }
    if (flags & SCOPE_FUNCTION) {
      return (flags & SCOPE_ASYNC) > 0;
    }
  }
  return this.inModule && this.options.ecmaVersion >= 13 || this.options.allowAwaitOutsideFunction;
};
prototypeAccessors.allowReturn.get = function() {
  if (this.inFunction) {
    return true;
  }
  if (this.options.allowReturnOutsideFunction && this.currentVarScope().flags & SCOPE_TOP) {
    return true;
  }
  return false;
};
prototypeAccessors.allowSuper.get = function() {
  var ref = this.currentThisScope();
  var flags = ref.flags;
  return (flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod;
};
prototypeAccessors.allowDirectSuper.get = function() {
  return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0;
};
prototypeAccessors.treatFunctionsAsVar.get = function() {
  return this.treatFunctionsAsVarInScope(this.currentScope());
};
prototypeAccessors.allowNewDotTarget.get = function() {
  for (var i = this.scopeStack.length - 1;i >= 0; i--) {
    var ref = this.scopeStack[i];
    var flags = ref.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) || flags & SCOPE_FUNCTION && !(flags & SCOPE_ARROW)) {
      return true;
    }
  }
  return false;
};
prototypeAccessors.allowUsing.get = function() {
  var ref = this.currentScope();
  var flags = ref.flags;
  if (flags & SCOPE_SWITCH) {
    return false;
  }
  if (!this.inModule && flags & SCOPE_TOP) {
    return false;
  }
  return true;
};
prototypeAccessors.inClassStaticBlock.get = function() {
  return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
};
Parser.extend = function extend() {
  var plugins = [], len = arguments.length;
  while (len--)
    plugins[len] = arguments[len];
  var cls = this;
  for (var i = 0;i < plugins.length; i++) {
    cls = plugins[i](cls);
  }
  return cls;
};
Parser.parse = function parse(input, options) {
  return new this(options, input).parse();
};
Parser.parseExpressionAt = function parseExpressionAt(input, pos, options) {
  var parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression();
};
Parser.tokenizer = function tokenizer(input, options) {
  return new this(options, input);
};
Object.defineProperties(Parser.prototype, prototypeAccessors);
var pp$9 = Parser.prototype;
var literal2 = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
pp$9.strictDirective = function(start) {
  if (this.options.ecmaVersion < 5) {
    return false;
  }
  for (;; ) {
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    var match = literal2.exec(this.input.slice(start));
    if (!match) {
      return false;
    }
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length;
      var spaceAfter = skipWhiteSpace.exec(this.input), end = spaceAfter.index + spaceAfter[0].length;
      var next = this.input.charAt(end);
      return next === ";" || next === "}" || lineBreak.test(spaceAfter[0]) && !(/[(`.[+\-/*%<>=,?^&]/.test(next) || next === "!" && this.input.charAt(end + 1) === "=" || next === "i" && keywordOpAt(this, end));
    }
    start += match[0].length;
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    if (this.input[start] === ";") {
      start++;
    }
  }
};
function keywordOpAt(parser, pos) {
  var end = pos + 1, stop = Math.min(parser.input.length, pos + 11);
  while (end < stop) {
    var ch = parser.fullCharCodeAt(end);
    if (!isIdentifierChar(ch, true)) {
      break;
    }
    end += ch <= 65535 ? 1 : 2;
  }
  return end === pos + 2 && parser.input.slice(pos, end) === "in" || end === pos + 10 && parser.input.slice(pos, end) === "instanceof";
}
pp$9.eat = function(type) {
  if (this.type === type) {
    this.next();
    return true;
  } else {
    return false;
  }
};
pp$9.isContextual = function(name) {
  return this.type === types$1.name && this.value === name && !this.containsEsc;
};
pp$9.eatContextual = function(name) {
  if (!this.isContextual(name)) {
    return false;
  }
  this.next();
  return true;
};
pp$9.catchStackOverflow = function(f) {
  try {
    return f();
  } catch (e) {
    if (e instanceof Error && (/\bstack\b.*\b(exceeded|overflow)\b/i.test(e.message) || /\btoo much recursion\b/i.test(e.message))) {
      this.raise(this.start, "Not enough stack space to parse input");
    } else {
      throw e;
    }
  }
};
pp$9.expectContextual = function(name) {
  if (!this.eatContextual(name)) {
    this.unexpected();
  }
};
pp$9.canInsertSemicolon = function() {
  return this.type === types$1.eof || this.type === types$1.braceR || lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$9.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon) {
      this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc);
    }
    return true;
  }
};
pp$9.semicolon = function() {
  if (!this.eat(types$1.semi) && !this.insertSemicolon()) {
    this.unexpected();
  }
};
pp$9.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma) {
      this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc);
    }
    if (!notNext) {
      this.next();
    }
    return true;
  }
};
pp$9.expect = function(type) {
  this.eat(type) || this.unexpected();
};
pp$9.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};
var DestructuringErrors = function DestructuringErrors() {
  this.shorthandAssign = this.trailingComma = this.parenthesizedAssign = this.parenthesizedBind = this.doubleProto = -1;
};
pp$9.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) {
    return;
  }
  if (refDestructuringErrors.trailingComma > -1) {
    this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element");
  }
  var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) {
    this.raiseRecoverable(parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern");
  }
};
pp$9.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) {
    return false;
  }
  var shorthandAssign = refDestructuringErrors.shorthandAssign;
  var doubleProto = refDestructuringErrors.doubleProto;
  if (!andThrow) {
    return shorthandAssign >= 0 || doubleProto >= 0;
  }
  if (shorthandAssign >= 0) {
    this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns");
  }
  if (doubleProto >= 0) {
    this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property");
  }
};
pp$9.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos)) {
    this.raise(this.yieldPos, "Yield expression cannot be a default value");
  }
  if (this.awaitPos) {
    this.raise(this.awaitPos, "Await expression cannot be a default value");
  }
};
pp$9.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression") {
    return this.isSimpleAssignTarget(expr.expression);
  }
  return expr.type === "Identifier" || expr.type === "MemberExpression";
};
var pp$8 = Parser.prototype;
pp$8.parseTopLevel = function(node) {
  var exports$1 = Object.create(null);
  if (!node.body) {
    node.body = [];
  }
  while (this.type !== types$1.eof) {
    var stmt = this.parseStatement(null, true, exports$1);
    node.body.push(stmt);
  }
  if (this.inModule) {
    for (var i = 0, list = Object.keys(this.undefinedExports);i < list.length; i += 1) {
      var name = list[i];
      this.raiseRecoverable(this.undefinedExports[name].start, "Export '" + name + "' is not defined");
    }
  }
  this.adaptDirectivePrologue(node.body);
  this.next();
  node.sourceType = this.options.sourceType === "commonjs" ? "script" : this.options.sourceType;
  return this.finishNode(node, "Program");
};
var loopLabel = { kind: "loop" };
var switchLabel = { kind: "switch" };
pp$8.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, nextCh = this.fullCharCodeAt(next);
  if (nextCh === 91 || nextCh === 92) {
    return true;
  }
  if (context) {
    return false;
  }
  if (nextCh === 123) {
    return true;
  }
  if (isIdentifierStart(nextCh)) {
    var start = next;
    do {
      next += nextCh <= 65535 ? 1 : 2;
    } while (isIdentifierChar(nextCh = this.fullCharCodeAt(next)));
    if (nextCh === 92) {
      return true;
    }
    var ident = this.input.slice(start, next);
    if (!keywordRelationalOperator.test(ident)) {
      return true;
    }
  }
  return false;
};
pp$8.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, after;
  return !lineBreak.test(this.input.slice(this.pos, next)) && this.input.slice(next, next + 8) === "function" && (next + 8 === this.input.length || !(isIdentifierChar(after = this.fullCharCodeAt(next + 8)) || after === 92));
};
pp$8.isUsingKeyword = function(isAwaitUsing, isFor) {
  if (this.options.ecmaVersion < 17 || !this.isContextual(isAwaitUsing ? "await" : "using")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length;
  if (lineBreak.test(this.input.slice(this.pos, next))) {
    return false;
  }
  if (isAwaitUsing) {
    var usingEndPos = next + 5, after;
    if (this.input.slice(next, usingEndPos) !== "using" || usingEndPos === this.input.length || isIdentifierChar(after = this.fullCharCodeAt(usingEndPos)) || after === 92) {
      return false;
    }
    skipWhiteSpace.lastIndex = usingEndPos;
    var skipAfterUsing = skipWhiteSpace.exec(this.input);
    next = usingEndPos + skipAfterUsing[0].length;
    if (skipAfterUsing && lineBreak.test(this.input.slice(usingEndPos, next))) {
      return false;
    }
  }
  var ch = this.fullCharCodeAt(next);
  if (!isIdentifierStart(ch) && ch !== 92) {
    return false;
  }
  var idStart = next;
  do {
    next += ch <= 65535 ? 1 : 2;
  } while (isIdentifierChar(ch = this.fullCharCodeAt(next)));
  if (ch === 92) {
    return true;
  }
  var id = this.input.slice(idStart, next);
  if (keywordRelationalOperator.test(id)) {
    return false;
  }
  if (isFor && !isAwaitUsing && id === "of") {
    skipWhiteSpace.lastIndex = next;
    var skipAfterOf = skipWhiteSpace.exec(this.input);
    next = next + skipAfterOf[0].length;
    if (this.input.charCodeAt(next) !== 61 || (ch = this.input.charCodeAt(next + 1)) === 61 || ch === 62) {
      return false;
    }
  }
  return true;
};
pp$8.isAwaitUsing = function(isFor) {
  return this.isUsingKeyword(true, isFor);
};
pp$8.isUsing = function(isFor) {
  return this.isUsingKeyword(false, isFor);
};
pp$8.parseStatement = function(context, topLevel, exports$1) {
  var starttype = this.type, node = this.startNode(), kind;
  if (this.isLet(context)) {
    starttype = types$1._var;
    kind = "let";
  }
  switch (starttype) {
    case types$1._break:
    case types$1._continue:
      return this.parseBreakContinueStatement(node, starttype.keyword);
    case types$1._debugger:
      return this.parseDebuggerStatement(node);
    case types$1._do:
      return this.parseDoStatement(node);
    case types$1._for:
      return this.parseForStatement(node);
    case types$1._function:
      if (context && (this.strict || context !== "if" && context !== "label") && this.options.ecmaVersion >= 6) {
        this.unexpected();
      }
      return this.parseFunctionStatement(node, false, !context);
    case types$1._class:
      if (context) {
        this.unexpected();
      }
      return this.parseClass(node, true);
    case types$1._if:
      return this.parseIfStatement(node);
    case types$1._return:
      return this.parseReturnStatement(node);
    case types$1._switch:
      return this.parseSwitchStatement(node);
    case types$1._throw:
      return this.parseThrowStatement(node);
    case types$1._try:
      return this.parseTryStatement(node);
    case types$1._const:
    case types$1._var:
      kind = kind || this.value;
      if (context && kind !== "var") {
        this.unexpected();
      }
      return this.parseVarStatement(node, kind);
    case types$1._while:
      return this.parseWhileStatement(node);
    case types$1._with:
      return this.parseWithStatement(node);
    case types$1.braceL:
      return this.parseBlock(true, node);
    case types$1.semi:
      return this.parseEmptyStatement(node);
    case types$1._export:
    case types$1._import:
      if (this.options.ecmaVersion > 10 && starttype === types$1._import) {
        skipWhiteSpace.lastIndex = this.pos;
        var skip = skipWhiteSpace.exec(this.input);
        var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
        if (nextCh === 40 || nextCh === 46) {
          return this.parseExpressionStatement(node, this.parseExpression());
        }
      }
      if (!this.options.allowImportExportEverywhere) {
        if (!topLevel) {
          this.raise(this.start, "'import' and 'export' may only appear at the top level");
        }
        if (!this.inModule) {
          this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'");
        }
      }
      return starttype === types$1._import ? this.parseImport(node) : this.parseExport(node, exports$1);
    default:
      if (this.isAsyncFunction()) {
        if (context) {
          this.unexpected();
        }
        this.next();
        return this.parseFunctionStatement(node, true, !context);
      }
      var usingKind = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
      if (usingKind) {
        if (!this.allowUsing) {
          this.raise(this.start, "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement");
        }
        if (context) {
          this.raise(this.start, "Using declaration is not allowed in single-statement positions");
        }
        if (usingKind === "await using") {
          if (!this.canAwait) {
            this.raise(this.start, "Await using cannot appear outside of async function");
          }
          this.next();
        }
        this.next();
        this.parseVar(node, false, usingKind);
        this.semicolon();
        return this.finishNode(node, "VariableDeclaration");
      }
      var maybeName = this.value, expr = this.parseExpression();
      if (starttype === types$1.name && expr.type === "Identifier" && this.eat(types$1.colon)) {
        return this.parseLabeledStatement(node, maybeName, expr, context);
      } else {
        return this.parseExpressionStatement(node, expr);
      }
  }
};
pp$8.parseBreakContinueStatement = function(node, keyword) {
  var isBreak = keyword === "break";
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.label = null;
  } else if (this.type !== types$1.name) {
    this.unexpected();
  } else {
    node.label = this.parseIdent();
    this.semicolon();
  }
  var i = 0;
  for (;i < this.labels.length; ++i) {
    var lab = this.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) {
        break;
      }
      if (node.label && isBreak) {
        break;
      }
    }
  }
  if (i === this.labels.length) {
    this.raise(node.start, "Unsyntactic " + keyword);
  }
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
};
pp$8.parseDebuggerStatement = function(node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement");
};
pp$8.parseDoStatement = function(node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(types$1._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6) {
    this.eat(types$1.semi);
  } else {
    this.semicolon();
  }
  return this.finishNode(node, "DoWhileStatement");
};
pp$8.parseForStatement = function(node) {
  this.next();
  var awaitAt = this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await") ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(types$1.parenL);
  if (this.type === types$1.semi) {
    if (awaitAt > -1) {
      this.unexpected(awaitAt);
    }
    return this.parseFor(node, null);
  }
  var isLet = this.isLet();
  if (this.type === types$1._var || this.type === types$1._const || isLet) {
    var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init$1, true, kind);
    this.finishNode(init$1, "VariableDeclaration");
    return this.parseForAfterInit(node, init$1, awaitAt);
  }
  var startsWithLet = this.isContextual("let"), isForOf = false;
  var usingKind = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
  if (usingKind) {
    var init$2 = this.startNode();
    this.next();
    if (usingKind === "await using") {
      if (!this.canAwait) {
        this.raise(this.start, "Await using cannot appear outside of async function");
      }
      this.next();
    }
    this.parseVar(init$2, true, usingKind);
    this.finishNode(init$2, "VariableDeclaration");
    return this.parseForAfterInit(node, init$2, awaitAt);
  }
  var containsEsc = this.containsEsc;
  var refDestructuringErrors = new DestructuringErrors;
  var initPos = this.start;
  var init = awaitAt > -1 ? this.parseExprSubscripts(refDestructuringErrors, "await") : this.parseExpression(true, refDestructuringErrors);
  if (this.type === types$1._in || (isForOf = this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (awaitAt > -1) {
      if (this.type === types$1._in) {
        this.unexpected(awaitAt);
      }
      node.await = true;
    } else if (isForOf && this.options.ecmaVersion >= 8) {
      if (init.start === initPos && !containsEsc && init.type === "Identifier" && init.name === "async") {
        this.unexpected();
      } else if (this.options.ecmaVersion >= 9) {
        node.await = false;
      }
    }
    if (startsWithLet && isForOf) {
      this.raise(init.start, "The left-hand side of a for-of loop may not start with 'let'.");
    }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLValPattern(init);
    return this.parseForIn(node, init);
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseForAfterInit = function(node, init, awaitAt) {
  if ((this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) && init.declarations.length === 1) {
    if (this.type === types$1._in) {
      if ((init.kind === "using" || init.kind === "await using") && !init.declarations[0].init) {
        this.raise(this.start, "Using declaration is not allowed in for-in loops");
      }
      if (this.options.ecmaVersion >= 9 && awaitAt > -1) {
        this.unexpected(awaitAt);
      }
    } else if (this.options.ecmaVersion >= 9) {
      node.await = awaitAt > -1;
    }
    return this.parseForIn(node, init);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
};
pp$8.parseIfStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(types$1._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement");
};
pp$8.parseReturnStatement = function(node) {
  if (!this.allowReturn) {
    this.raise(this.start, "'return' outside of function");
  }
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.argument = null;
  } else {
    node.argument = this.parseExpression();
    this.semicolon();
  }
  return this.finishNode(node, "ReturnStatement");
};
pp$8.parseSwitchStatement = function(node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(types$1.braceL);
  this.labels.push(switchLabel);
  this.enterScope(SCOPE_SWITCH);
  var cur;
  for (var sawDefault = false;this.type !== types$1.braceR; ) {
    if (this.type === types$1._case || this.type === types$1._default) {
      var isCase = this.type === types$1._case;
      if (cur) {
        this.finishNode(cur, "SwitchCase");
      }
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) {
          this.raiseRecoverable(this.lastTokStart, "Multiple default clauses");
        }
        sawDefault = true;
        cur.test = null;
      }
      this.expect(types$1.colon);
    } else {
      if (!cur) {
        this.unexpected();
      }
      cur.consequent.push(this.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) {
    this.finishNode(cur, "SwitchCase");
  }
  this.next();
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement");
};
pp$8.parseThrowStatement = function(node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) {
    this.raise(this.lastTokEnd, "Illegal newline after throw");
  }
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement");
};
var empty$1 = [];
pp$8.parseCatchClauseParam = function() {
  var param = this.parseBindingAtom();
  var simple = param.type === "Identifier";
  this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
  this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
  this.expect(types$1.parenR);
  return param;
};
pp$8.parseTryStatement = function(node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === types$1._catch) {
    var clause = this.startNode();
    this.next();
    if (this.eat(types$1.parenL)) {
      clause.param = this.parseCatchClauseParam();
    } else {
      if (this.options.ecmaVersion < 10) {
        this.unexpected();
      }
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(types$1._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer) {
    this.raise(node.start, "Missing catch or finally clause");
  }
  return this.finishNode(node, "TryStatement");
};
pp$8.parseVarStatement = function(node, kind, allowMissingInitializer) {
  this.next();
  this.parseVar(node, false, kind, allowMissingInitializer);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration");
};
pp$8.parseWhileStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement");
};
pp$8.parseWithStatement = function(node) {
  if (this.strict) {
    this.raise(this.start, "'with' in strict mode");
  }
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement");
};
pp$8.parseEmptyStatement = function(node) {
  this.next();
  return this.finishNode(node, "EmptyStatement");
};
pp$8.parseLabeledStatement = function(node, maybeName, expr, context) {
  for (var i$1 = 0, list = this.labels;i$1 < list.length; i$1 += 1) {
    var label = list[i$1];
    if (label.name === maybeName) {
      this.raise(expr.start, "Label '" + maybeName + "' is already declared");
    }
  }
  var kind = this.type.isLoop ? "loop" : this.type === types$1._switch ? "switch" : null;
  for (var i = this.labels.length - 1;i >= 0; i--) {
    var label$1 = this.labels[i];
    if (label$1.statementStart === node.start) {
      label$1.statementStart = this.start;
      label$1.kind = kind;
    } else {
      break;
    }
  }
  this.labels.push({ name: maybeName, kind, statementStart: this.start });
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement");
};
pp$8.parseExpressionStatement = function(node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement");
};
pp$8.parseBlock = function(createNewLexicalScope, node, exitStrict) {
  if (createNewLexicalScope === undefined)
    createNewLexicalScope = true;
  if (node === undefined)
    node = this.startNode();
  node.body = [];
  this.expect(types$1.braceL);
  if (createNewLexicalScope) {
    this.enterScope(0);
  }
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  if (exitStrict) {
    this.strict = false;
  }
  this.next();
  if (createNewLexicalScope) {
    this.exitScope();
  }
  return this.finishNode(node, "BlockStatement");
};
pp$8.parseFor = function(node, init) {
  node.init = init;
  this.expect(types$1.semi);
  node.test = this.type === types$1.semi ? null : this.parseExpression();
  this.expect(types$1.semi);
  node.update = this.type === types$1.parenR ? null : this.parseExpression();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement");
};
pp$8.parseForIn = function(node, init) {
  var isForIn = this.type === types$1._in;
  this.next();
  if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || this.options.ecmaVersion < 8 || this.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
    this.raise(init.start, (isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer");
  }
  node.left = init;
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
};
pp$8.parseVar = function(node, isFor, kind, allowMissingInitializer) {
  node.declarations = [];
  node.kind = kind;
  for (;; ) {
    var decl = this.startNode();
    this.parseVarId(decl, kind);
    if (this.eat(types$1.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (!allowMissingInitializer && kind === "const" && !(this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
      this.unexpected();
    } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && this.options.ecmaVersion >= 17 && this.type !== types$1._in && !this.isContextual("of")) {
      this.raise(this.lastTokEnd, "Missing initializer in " + kind + " declaration");
    } else if (!allowMissingInitializer && decl.id.type !== "Identifier" && !(isFor && (this.type === types$1._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(types$1.comma)) {
      break;
    }
  }
  return node;
};
pp$8.parseVarId = function(decl, kind) {
  decl.id = kind === "using" || kind === "await using" ? this.parseIdent() : this.parseBindingAtom();
  this.checkLValPattern(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
};
var FUNC_STATEMENT = 1;
var FUNC_HANGING_STATEMENT = 2;
var FUNC_NULLABLE_ID = 4;
pp$8.parseFunction = function(node, statement, allowExpressionBody, isAsync, forInit) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === types$1.star && statement & FUNC_HANGING_STATEMENT) {
      this.unexpected();
    }
    node.generator = this.eat(types$1.star);
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  if (statement & FUNC_STATEMENT) {
    node.id = statement & FUNC_NULLABLE_ID && this.type !== types$1.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT)) {
      this.checkLValSimple(node.id, this.strict || node.generator || node.async ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION);
    }
  }
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(node.async, node.generator));
  if (!(statement & FUNC_STATEMENT)) {
    node.id = this.type === types$1.name ? this.parseIdent() : null;
  }
  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression");
};
pp$8.parseFunctionParams = function(node) {
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};
pp$8.parseClass = function(node, isStatement) {
  this.next();
  var oldStrict = this.strict;
  this.strict = true;
  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  var privateNameMap = this.enterClassBody();
  var classBody = this.startNode();
  var hadConstructor = false;
  classBody.body = [];
  this.expect(types$1.braceL);
  while (this.type !== types$1.braceR) {
    var element = this.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) {
          this.raiseRecoverable(element.start, "Duplicate constructor in the same class");
        }
        hadConstructor = true;
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        this.raiseRecoverable(element.key.start, "Identifier '#" + element.key.name + "' has already been declared");
      }
    }
  }
  this.strict = oldStrict;
  this.next();
  node.body = this.finishNode(classBody, "ClassBody");
  this.exitClassBody();
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
};
pp$8.parseClassElement = function(constructorAllowsSuper) {
  if (this.eat(types$1.semi)) {
    return null;
  }
  var ecmaVersion = this.options.ecmaVersion;
  var node = this.startNode();
  var keyName = "";
  var isGenerator = false;
  var isAsync = false;
  var kind = "method";
  var isStatic = false;
  if (this.eatContextual("static")) {
    if (ecmaVersion >= 13 && this.eat(types$1.braceL)) {
      this.parseClassStaticBlock(node);
      return node;
    }
    if (this.isClassElementNameStart() || this.type === types$1.star) {
      isStatic = true;
    } else {
      keyName = "static";
    }
  }
  node.static = isStatic;
  if (!keyName && ecmaVersion >= 8 && this.eatContextual("async")) {
    if ((this.isClassElementNameStart() || this.type === types$1.star) && !this.canInsertSemicolon()) {
      isAsync = true;
    } else {
      keyName = "async";
    }
  }
  if (!keyName && (ecmaVersion >= 9 || !isAsync) && this.eat(types$1.star)) {
    isGenerator = true;
  }
  if (!keyName && !isAsync && !isGenerator) {
    var lastValue = this.value;
    if (this.eatContextual("get") || this.eatContextual("set")) {
      if (this.isClassElementNameStart()) {
        kind = lastValue;
      } else {
        keyName = lastValue;
      }
    }
  }
  if (keyName) {
    node.computed = false;
    node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc);
    node.key.name = keyName;
    this.finishNode(node.key, "Identifier");
  } else {
    this.parseClassElementName(node);
  }
  if (ecmaVersion < 13 || this.type === types$1.parenL || kind !== "method" || isGenerator || isAsync) {
    var isConstructor = !node.static && checkKeyName(node, "constructor");
    var allowsDirectSuper = isConstructor && constructorAllowsSuper;
    if (isConstructor && kind !== "method") {
      this.raise(node.key.start, "Constructor can't have get/set modifier");
    }
    node.kind = isConstructor ? "constructor" : kind;
    this.parseClassMethod(node, isGenerator, isAsync, allowsDirectSuper);
  } else {
    this.parseClassField(node);
  }
  return node;
};
pp$8.isClassElementNameStart = function() {
  return this.type === types$1.name || this.type === types$1.privateId || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword;
};
pp$8.parseClassElementName = function(element) {
  if (this.type === types$1.privateId) {
    if (this.value === "constructor") {
      this.raise(this.start, "Classes can't have an element named '#constructor'");
    }
    element.computed = false;
    element.key = this.parsePrivateIdent();
  } else {
    this.parsePropertyName(element);
  }
};
pp$8.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  var key = method.key;
  if (method.kind === "constructor") {
    if (isGenerator) {
      this.raise(key.start, "Constructor can't be a generator");
    }
    if (isAsync) {
      this.raise(key.start, "Constructor can't be an async method");
    }
  } else if (method.static && checkKeyName(method, "prototype")) {
    this.raise(key.start, "Classes may not have a static property named prototype");
  }
  var value = method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
  if (method.kind === "get" && value.params.length !== 0) {
    this.raiseRecoverable(value.start, "getter should have no params");
  }
  if (method.kind === "set" && value.params.length !== 1) {
    this.raiseRecoverable(value.start, "setter should have exactly one param");
  }
  if (method.kind === "set" && value.params[0].type === "RestElement") {
    this.raiseRecoverable(value.params[0].start, "Setter cannot use rest params");
  }
  return this.finishNode(method, "MethodDefinition");
};
pp$8.parseClassField = function(field) {
  if (checkKeyName(field, "constructor")) {
    this.raise(field.key.start, "Classes can't have a field named 'constructor'");
  } else if (field.static && checkKeyName(field, "prototype")) {
    this.raise(field.key.start, "Classes can't have a static field named 'prototype'");
  }
  if (this.eat(types$1.eq)) {
    this.enterScope(SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
    field.value = this.parseMaybeAssign();
    this.exitScope();
  } else {
    field.value = null;
  }
  this.semicolon();
  return this.finishNode(field, "PropertyDefinition");
};
pp$8.parseClassStaticBlock = function(node) {
  node.body = [];
  var oldLabels = this.labels;
  this.labels = [];
  this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  this.next();
  this.exitScope();
  this.labels = oldLabels;
  return this.finishNode(node, "StaticBlock");
};
pp$8.parseClassId = function(node, isStatement) {
  if (this.type === types$1.name) {
    node.id = this.parseIdent();
    if (isStatement) {
      this.checkLValSimple(node.id, BIND_LEXICAL, false);
    }
  } else {
    if (isStatement === true) {
      this.unexpected();
    }
    node.id = null;
  }
};
pp$8.parseClassSuper = function(node) {
  node.superClass = this.eat(types$1._extends) ? this.parseExprSubscripts(null, false) : null;
};
pp$8.enterClassBody = function() {
  var element = { declared: Object.create(null), used: [] };
  this.privateNameStack.push(element);
  return element.declared;
};
pp$8.exitClassBody = function() {
  var ref = this.privateNameStack.pop();
  var declared = ref.declared;
  var used = ref.used;
  if (!this.options.checkPrivateFields) {
    return;
  }
  var len = this.privateNameStack.length;
  var parent = len === 0 ? null : this.privateNameStack[len - 1];
  for (var i = 0;i < used.length; ++i) {
    var id = used[i];
    if (!hasOwn(declared, id.name)) {
      if (parent) {
        parent.used.push(id);
      } else {
        this.raiseRecoverable(id.start, "Private field '#" + id.name + "' must be declared in an enclosing class");
      }
    }
  }
};
function isPrivateNameConflicted(privateNameMap, element) {
  var name = element.key.name;
  var curr = privateNameMap[name];
  var next = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) {
    next = (element.static ? "s" : "i") + element.kind;
  }
  if (curr === "iget" && next === "iset" || curr === "iset" && next === "iget" || curr === "sget" && next === "sset" || curr === "sset" && next === "sget") {
    privateNameMap[name] = "true";
    return false;
  } else if (!curr) {
    privateNameMap[name] = next;
    return false;
  } else {
    return true;
  }
}
function checkKeyName(node, name) {
  var computed = node.computed;
  var key = node.key;
  return !computed && (key.type === "Identifier" && key.name === name || key.type === "Literal" && key.value === name);
}
pp$8.parseExportAllDeclaration = function(node, exports$1) {
  if (this.options.ecmaVersion >= 11) {
    if (this.eatContextual("as")) {
      node.exported = this.parseModuleExportName();
      this.checkExport(exports$1, node.exported, this.lastTokStart);
    } else {
      node.exported = null;
    }
  }
  this.expectContextual("from");
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.source = this.parseExprAtom();
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ExportAllDeclaration");
};
pp$8.parseExport = function(node, exports$1) {
  this.next();
  if (this.eat(types$1.star)) {
    return this.parseExportAllDeclaration(node, exports$1);
  }
  if (this.eat(types$1._default)) {
    this.checkExport(exports$1, "default", this.lastTokStart);
    node.declaration = this.parseExportDefaultDeclaration();
    return this.finishNode(node, "ExportDefaultDeclaration");
  }
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseExportDeclaration(node);
    if (node.declaration.type === "VariableDeclaration") {
      this.checkVariableExport(exports$1, node.declaration.declarations);
    } else {
      this.checkExport(exports$1, node.declaration.id, node.declaration.id.start);
    }
    node.specifiers = [];
    node.source = null;
    if (this.options.ecmaVersion >= 16) {
      node.attributes = [];
    }
  } else {
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports$1);
    if (this.eatContextual("from")) {
      if (this.type !== types$1.string) {
        this.unexpected();
      }
      node.source = this.parseExprAtom();
      if (this.options.ecmaVersion >= 16) {
        node.attributes = this.parseWithClause();
      }
    } else {
      for (var i = 0, list = node.specifiers;i < list.length; i += 1) {
        var spec = list[i];
        this.checkUnreserved(spec.local);
        this.checkLocalExport(spec.local);
        if (spec.local.type === "Literal") {
          this.raise(spec.local.start, "A string literal cannot be used as an exported binding without `from`.");
        }
      }
      node.source = null;
      if (this.options.ecmaVersion >= 16) {
        node.attributes = [];
      }
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration");
};
pp$8.parseExportDeclaration = function(node) {
  return this.parseStatement(null);
};
pp$8.parseExportDefaultDeclaration = function() {
  var isAsync;
  if (this.type === types$1._function || (isAsync = this.isAsyncFunction())) {
    var fNode = this.startNode();
    this.next();
    if (isAsync) {
      this.next();
    }
    return this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
  } else if (this.type === types$1._class) {
    var cNode = this.startNode();
    return this.parseClass(cNode, "nullableID");
  } else {
    var declaration = this.parseMaybeAssign();
    this.semicolon();
    return declaration;
  }
};
pp$8.checkExport = function(exports$1, name, pos) {
  if (!exports$1) {
    return;
  }
  if (typeof name !== "string") {
    name = name.type === "Identifier" ? name.name : name.value;
  }
  if (hasOwn(exports$1, name)) {
    this.raiseRecoverable(pos, "Duplicate export '" + name + "'");
  }
  exports$1[name] = true;
};
pp$8.checkPatternExport = function(exports$1, pat) {
  var type = pat.type;
  if (type === "Identifier") {
    this.checkExport(exports$1, pat, pat.start);
  } else if (type === "ObjectPattern") {
    for (var i = 0, list = pat.properties;i < list.length; i += 1) {
      var prop = list[i];
      this.checkPatternExport(exports$1, prop);
    }
  } else if (type === "ArrayPattern") {
    for (var i$1 = 0, list$1 = pat.elements;i$1 < list$1.length; i$1 += 1) {
      var elt = list$1[i$1];
      if (elt) {
        this.checkPatternExport(exports$1, elt);
      }
    }
  } else if (type === "Property") {
    this.checkPatternExport(exports$1, pat.value);
  } else if (type === "AssignmentPattern") {
    this.checkPatternExport(exports$1, pat.left);
  } else if (type === "RestElement") {
    this.checkPatternExport(exports$1, pat.argument);
  }
};
pp$8.checkVariableExport = function(exports$1, decls) {
  if (!exports$1) {
    return;
  }
  for (var i = 0, list = decls;i < list.length; i += 1) {
    var decl = list[i];
    this.checkPatternExport(exports$1, decl.id);
  }
};
pp$8.shouldParseExportStatement = function() {
  return this.type.keyword === "var" || this.type.keyword === "const" || this.type.keyword === "class" || this.type.keyword === "function" || this.isLet() || this.isAsyncFunction();
};
pp$8.parseExportSpecifier = function(exports$1) {
  var node = this.startNode();
  node.local = this.parseModuleExportName();
  node.exported = this.eatContextual("as") ? this.parseModuleExportName() : node.local;
  this.checkExport(exports$1, node.exported, node.exported.start);
  return this.finishNode(node, "ExportSpecifier");
};
pp$8.parseExportSpecifiers = function(exports$1) {
  var nodes = [], first = true;
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseExportSpecifier(exports$1));
  }
  return nodes;
};
pp$8.parseImport = function(node) {
  this.next();
  if (this.type === types$1.string) {
    node.specifiers = empty$1;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === types$1.string ? this.parseExprAtom() : this.unexpected();
  }
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration");
};
pp$8.parseImportSpecifier = function() {
  var node = this.startNode();
  node.imported = this.parseModuleExportName();
  if (this.eatContextual("as")) {
    node.local = this.parseIdent();
  } else {
    this.checkUnreserved(node.imported);
    node.local = node.imported;
  }
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportSpecifier");
};
pp$8.parseImportDefaultSpecifier = function() {
  var node = this.startNode();
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportDefaultSpecifier");
};
pp$8.parseImportNamespaceSpecifier = function() {
  var node = this.startNode();
  this.next();
  this.expectContextual("as");
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportNamespaceSpecifier");
};
pp$8.parseImportSpecifiers = function() {
  var nodes = [], first = true;
  if (this.type === types$1.name) {
    nodes.push(this.parseImportDefaultSpecifier());
    if (!this.eat(types$1.comma)) {
      return nodes;
    }
  }
  if (this.type === types$1.star) {
    nodes.push(this.parseImportNamespaceSpecifier());
    return nodes;
  }
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseImportSpecifier());
  }
  return nodes;
};
pp$8.parseWithClause = function() {
  var nodes = [];
  if (!this.eat(types$1._with)) {
    return nodes;
  }
  this.expect(types$1.braceL);
  var attributeKeys = {};
  var first = true;
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var attr = this.parseImportAttribute();
    var keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    if (hasOwn(attributeKeys, keyName)) {
      this.raiseRecoverable(attr.key.start, "Duplicate attribute key '" + keyName + "'");
    }
    attributeKeys[keyName] = true;
    nodes.push(attr);
  }
  return nodes;
};
pp$8.parseImportAttribute = function() {
  var node = this.startNode();
  node.key = this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
  this.expect(types$1.colon);
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.value = this.parseExprAtom();
  return this.finishNode(node, "ImportAttribute");
};
pp$8.parseModuleExportName = function() {
  if (this.options.ecmaVersion >= 13 && this.type === types$1.string) {
    var stringLiteral = this.parseLiteral(this.value);
    if (loneSurrogate.test(stringLiteral.value)) {
      this.raise(stringLiteral.start, "An export name cannot include a lone surrogate.");
    }
    return stringLiteral;
  }
  return this.parseIdent(true);
};
pp$8.adaptDirectivePrologue = function(statements) {
  for (var i = 0;i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
};
pp$8.isDirectiveCandidate = function(statement) {
  return this.options.ecmaVersion >= 5 && statement.type === "ExpressionStatement" && statement.expression.type === "Literal" && typeof statement.expression.value === "string" && (this.input[statement.start] === '"' || this.input[statement.start] === "'");
};
var pp$7 = Parser.prototype;
pp$7.toAssignable = function(node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
      case "Identifier":
        if (this.inAsync && node.name === "await") {
          this.raise(node.start, "Cannot use 'await' as identifier inside an async function");
        }
        break;
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        break;
      case "ObjectExpression":
        node.type = "ObjectPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        for (var i = 0, list = node.properties;i < list.length; i += 1) {
          var prop = list[i];
          this.toAssignable(prop, isBinding);
          if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) {
            this.raise(prop.argument.start, "Unexpected token");
          }
        }
        break;
      case "Property":
        if (node.kind !== "init") {
          this.raise(node.key.start, "Object pattern can't contain getter or setter");
        }
        this.toAssignable(node.value, isBinding);
        break;
      case "ArrayExpression":
        node.type = "ArrayPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        this.toAssignableList(node.elements, isBinding);
        break;
      case "SpreadElement":
        node.type = "RestElement";
        this.toAssignable(node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern") {
          this.raise(node.argument.start, "Rest elements cannot have a default value");
        }
        break;
      case "AssignmentExpression":
        if (node.operator !== "=") {
          this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
        }
        node.type = "AssignmentPattern";
        delete node.operator;
        this.toAssignable(node.left, isBinding);
        break;
      case "ParenthesizedExpression":
        this.toAssignable(node.expression, isBinding, refDestructuringErrors);
        break;
      case "ChainExpression":
        this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side");
        break;
      case "MemberExpression":
        if (!isBinding) {
          break;
        }
      default:
        this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) {
    this.checkPatternErrors(refDestructuringErrors, true);
  }
  return node;
};
pp$7.toAssignableList = function(exprList, isBinding) {
  var end = exprList.length;
  for (var i = 0;i < end; i++) {
    var elt = exprList[i];
    if (elt) {
      this.toAssignable(elt, isBinding);
    }
  }
  if (end) {
    var last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier") {
      this.unexpected(last.argument.start);
    }
  }
  return exprList;
};
pp$7.parseSpread = function(refDestructuringErrors) {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement");
};
pp$7.parseRestBinding = function() {
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion === 6 && this.type !== types$1.name) {
    this.unexpected();
  }
  node.argument = this.parseBindingAtom();
  return this.finishNode(node, "RestElement");
};
pp$7.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
      case types$1.bracketL:
        var node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(types$1.bracketR, true, true);
        return this.finishNode(node, "ArrayPattern");
      case types$1.braceL:
        return this.parseObj(true);
    }
  }
  return this.parseIdent();
};
pp$7.parseBindingList = function(close, allowEmpty, allowTrailingComma, allowModifiers) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (first) {
      first = false;
    } else {
      this.expect(types$1.comma);
    }
    if (allowEmpty && this.type === types$1.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      break;
    } else if (this.type === types$1.ellipsis) {
      var rest = this.parseRestBinding();
      this.parseBindingListItem(rest);
      elts.push(rest);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      this.expect(close);
      break;
    } else {
      elts.push(this.parseAssignableListItem(allowModifiers));
    }
  }
  return elts;
};
pp$7.parseAssignableListItem = function(allowModifiers) {
  var elem = this.parseMaybeDefault(this.start, this.startLoc);
  this.parseBindingListItem(elem);
  return elem;
};
pp$7.parseBindingListItem = function(param) {
  return param;
};
pp$7.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(types$1.eq)) {
    return left;
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern");
};
pp$7.checkLValSimple = function(expr, bindingType, checkClashes) {
  if (bindingType === undefined)
    bindingType = BIND_NONE;
  var isBind = bindingType !== BIND_NONE;
  switch (expr.type) {
    case "Identifier":
      if (this.strict && this.reservedWordsStrictBind.test(expr.name)) {
        this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode");
      }
      if (isBind) {
        if (bindingType === BIND_LEXICAL && expr.name === "let") {
          this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name");
        }
        if (checkClashes) {
          if (hasOwn(checkClashes, expr.name)) {
            this.raiseRecoverable(expr.start, "Argument name clash");
          }
          checkClashes[expr.name] = true;
        }
        if (bindingType !== BIND_OUTSIDE) {
          this.declareName(expr.name, bindingType, expr.start);
        }
      }
      break;
    case "ChainExpression":
      this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side");
      break;
    case "MemberExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding member expression");
      }
      break;
    case "ParenthesizedExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding parenthesized expression");
      }
      return this.checkLValSimple(expr.expression, bindingType, checkClashes);
    default:
      this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
};
pp$7.checkLValPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === undefined)
    bindingType = BIND_NONE;
  switch (expr.type) {
    case "ObjectPattern":
      for (var i = 0, list = expr.properties;i < list.length; i += 1) {
        var prop = list[i];
        this.checkLValInnerPattern(prop, bindingType, checkClashes);
      }
      break;
    case "ArrayPattern":
      for (var i$1 = 0, list$1 = expr.elements;i$1 < list$1.length; i$1 += 1) {
        var elem = list$1[i$1];
        if (elem) {
          this.checkLValInnerPattern(elem, bindingType, checkClashes);
        }
      }
      break;
    default:
      this.checkLValSimple(expr, bindingType, checkClashes);
  }
};
pp$7.checkLValInnerPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === undefined)
    bindingType = BIND_NONE;
  switch (expr.type) {
    case "Property":
      this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
      break;
    case "AssignmentPattern":
      this.checkLValPattern(expr.left, bindingType, checkClashes);
      break;
    case "RestElement":
      this.checkLValPattern(expr.argument, bindingType, checkClashes);
      break;
    default:
      this.checkLValPattern(expr, bindingType, checkClashes);
  }
};
var TokContext = function TokContext(token, isExpr, preserveSpace, override, generator) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
};
var types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function(p) {
    return p.tryReadTemplateToken();
  }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};
var pp$6 = Parser.prototype;
pp$6.initialContext = function() {
  return [types.b_stat];
};
pp$6.curContext = function() {
  return this.context[this.context.length - 1];
};
pp$6.braceIsBlock = function(prevType) {
  var parent = this.curContext();
  if (parent === types.f_expr || parent === types.f_stat) {
    return true;
  }
  if (prevType === types$1.colon && (parent === types.b_stat || parent === types.b_expr)) {
    return !parent.isExpr;
  }
  if (prevType === types$1._return || prevType === types$1.name && this.exprAllowed) {
    return lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
  }
  if (prevType === types$1._else || prevType === types$1.semi || prevType === types$1.eof || prevType === types$1.parenR || prevType === types$1.arrow) {
    return true;
  }
  if (prevType === types$1.braceL) {
    return parent === types.b_stat;
  }
  if (prevType === types$1._var || prevType === types$1._const || prevType === types$1.name) {
    return false;
  }
  return !this.exprAllowed;
};
pp$6.inGeneratorContext = function() {
  for (var i = this.context.length - 1;i >= 1; i--) {
    var context = this.context[i];
    if (context.token === "function") {
      return context.generator;
    }
  }
  return false;
};
pp$6.updateContext = function(prevType) {
  var update, type = this.type;
  if (type.keyword && prevType === types$1.dot) {
    this.exprAllowed = false;
  } else if (update = type.updateContext) {
    update.call(this, prevType);
  } else {
    this.exprAllowed = type.beforeExpr;
  }
};
pp$6.overrideContext = function(tokenCtx) {
  if (this.curContext() !== tokenCtx) {
    this.context[this.context.length - 1] = tokenCtx;
  }
};
types$1.parenR.updateContext = types$1.braceR.updateContext = function() {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return;
  }
  var out = this.context.pop();
  if (out === types.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};
types$1.braceL.updateContext = function(prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
  this.exprAllowed = true;
};
types$1.dollarBraceL.updateContext = function() {
  this.context.push(types.b_tmpl);
  this.exprAllowed = true;
};
types$1.parenL.updateContext = function(prevType) {
  var statementParens = prevType === types$1._if || prevType === types$1._for || prevType === types$1._with || prevType === types$1._while;
  this.context.push(statementParens ? types.p_stat : types.p_expr);
  this.exprAllowed = true;
};
types$1.incDec.updateContext = function() {};
types$1._function.updateContext = types$1._class.updateContext = function(prevType) {
  if (prevType.beforeExpr && prevType !== types$1._else && !(prevType === types$1.semi && this.curContext() !== types.p_stat) && !(prevType === types$1._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) && !((prevType === types$1.colon || prevType === types$1.braceL) && this.curContext() === types.b_stat)) {
    this.context.push(types.f_expr);
  } else {
    this.context.push(types.f_stat);
  }
  this.exprAllowed = false;
};
types$1.colon.updateContext = function() {
  if (this.curContext().token === "function") {
    this.context.pop();
  }
  this.exprAllowed = true;
};
types$1.backQuote.updateContext = function() {
  if (this.curContext() === types.q_tmpl) {
    this.context.pop();
  } else {
    this.context.push(types.q_tmpl);
  }
  this.exprAllowed = false;
};
types$1.star.updateContext = function(prevType) {
  if (prevType === types$1._function) {
    var index = this.context.length - 1;
    if (this.context[index] === types.f_expr) {
      this.context[index] = types.f_expr_gen;
    } else {
      this.context[index] = types.f_gen;
    }
  }
  this.exprAllowed = true;
};
types$1.name.updateContext = function(prevType) {
  var allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== types$1.dot) {
    if (this.value === "of" && !this.exprAllowed || this.value === "yield" && this.inGeneratorContext()) {
      allowed = true;
    }
  }
  this.exprAllowed = allowed;
};
var pp$5 = Parser.prototype;
pp$5.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement") {
    return;
  }
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand)) {
    return;
  }
  var key = prop.key;
  var name;
  switch (key.type) {
    case "Identifier":
      name = key.name;
      break;
    case "Literal":
      name = String(key.value);
      break;
    default:
      return;
  }
  var kind = prop.kind;
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key.start;
          }
        } else {
          this.raiseRecoverable(key.start, "Redefinition of __proto__ property");
        }
      }
      propHash.proto = true;
    }
    return;
  }
  name = "$" + name;
  var other = propHash[name];
  if (other) {
    var redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition) {
      this.raiseRecoverable(key.start, "Redefinition of property");
    }
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};
pp$5.parseExpression = function(forInit, refDestructuringErrors) {
  var this$1$1 = this;
  return this.catchStackOverflow(function() {
    var { start: startPos, startLoc } = this$1$1;
    var expr = this$1$1.parseMaybeAssign(forInit, refDestructuringErrors);
    if (this$1$1.type === types$1.comma) {
      var node = this$1$1.startNodeAt(startPos, startLoc);
      node.expressions = [expr];
      while (this$1$1.eat(types$1.comma)) {
        node.expressions.push(this$1$1.parseMaybeAssign(forInit, refDestructuringErrors));
      }
      return this$1$1.finishNode(node, "SequenceExpression");
    }
    return expr;
  });
};
pp$5.parseMaybeAssign = function(forInit, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) {
      return this.parseYield(forInit);
    } else {
      this.exprAllowed = false;
    }
  }
  var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldDoubleProto = refDestructuringErrors.doubleProto;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors;
    ownDestructuringErrors = true;
  }
  var startPos = this.start, startLoc = this.startLoc;
  if (this.type === types$1.parenL || this.type === types$1.name) {
    this.potentialArrowAt = this.start;
    this.potentialArrowInForAwait = forInit === "await";
  }
  var left = this.parseMaybeConditional(forInit, refDestructuringErrors);
  if (afterLeftParse) {
    left = afterLeftParse.call(this, left, startPos, startLoc);
  }
  if (this.type.isAssign) {
    var node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    if (this.type === types$1.eq) {
      left = this.toAssignable(left, false, refDestructuringErrors);
    }
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
      if (refDestructuringErrors.shorthandAssign >= left.start) {
        refDestructuringErrors.shorthandAssign = -1;
      }
      if (refDestructuringErrors.doubleProto >= left.start) {
        refDestructuringErrors.doubleProto = -1;
      }
    }
    if (this.type === types$1.eq) {
      this.checkLValPattern(left);
    } else {
      this.checkLValSimple(left);
    }
    node.left = left;
    this.next();
    node.right = this.parseMaybeAssign(forInit);
    if (oldDoubleProto > -1) {
      refDestructuringErrors.doubleProto = oldDoubleProto;
    }
    return this.finishNode(node, "AssignmentExpression");
  } else {
    if (ownDestructuringErrors) {
      this.checkExpressionErrors(refDestructuringErrors, true);
    }
  }
  if (oldParenAssign > -1) {
    refDestructuringErrors.parenthesizedAssign = oldParenAssign;
  }
  if (oldTrailingComma > -1) {
    refDestructuringErrors.trailingComma = oldTrailingComma;
  }
  return left;
};
pp$5.parseMaybeConditional = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprOps(forInit, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  if (!(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.question)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(types$1.colon);
    node.alternate = this.parseMaybeAssign(forInit);
    return this.finishNode(node, "ConditionalExpression");
  }
  return expr;
};
pp$5.parseExprOps = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeUnary(refDestructuringErrors, false, false, forInit);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, forInit);
};
pp$5.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, forInit) {
  var prec = this.type.binop;
  if (prec != null && (!forInit || this.type !== types$1._in)) {
    if (prec > minPrec) {
      var logical = this.type === types$1.logicalOR || this.type === types$1.logicalAND;
      var coalesce = this.type === types$1.coalesce;
      if (coalesce) {
        prec = types$1.logicalAND.binop;
      }
      var op = this.value;
      this.next();
      var startPos = this.start, startLoc = this.startLoc;
      var right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), startPos, startLoc, prec, forInit);
      var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
      if (logical && this.type === types$1.coalesce || coalesce && (this.type === types$1.logicalOR || this.type === types$1.logicalAND)) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit);
    }
  }
  return left;
};
pp$5.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") {
    this.raise(right.start, "Private identifier can only be left side of binary expression");
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression");
};
pp$5.parseMaybeUnary = function(refDestructuringErrors, sawUnary, incDec, forInit) {
  var startPos = this.start, startLoc = this.startLoc, expr;
  if (this.isContextual("await") && this.canAwait) {
    expr = this.parseAwait(forInit);
    sawUnary = true;
  } else if (this.type.prefix) {
    var node = this.startNode(), update = this.type === types$1.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true, update, forInit);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) {
      this.checkLValSimple(node.argument);
    } else if (this.strict && node.operator === "delete" && isLocalVariableAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Deleting local variable in strict mode");
    } else if (node.operator === "delete" && isPrivateFieldAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Private fields can not be deleted");
    } else {
      sawUnary = true;
    }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (!sawUnary && this.type === types$1.privateId) {
    if ((forInit || this.privateNameStack.length === 0) && this.options.checkPrivateFields) {
      this.unexpected();
    }
    expr = this.parsePrivateIdent();
    if (this.type !== types$1._in) {
      this.unexpected();
    }
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors, forInit);
    if (this.checkExpressionErrors(refDestructuringErrors)) {
      return expr;
    }
    while (this.type.postfix && !this.canInsertSemicolon()) {
      var node$1 = this.startNodeAt(startPos, startLoc);
      node$1.operator = this.value;
      node$1.prefix = false;
      node$1.argument = expr;
      this.checkLValSimple(expr);
      this.next();
      expr = this.finishNode(node$1, "UpdateExpression");
    }
  }
  if (!incDec && !(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.starstar)) {
    if (sawUnary) {
      this.unexpected(this.lastTokStart);
    } else {
      return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false);
    }
  } else {
    return expr;
  }
};
function isLocalVariableAccess(node) {
  return node.type === "Identifier" || node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression);
}
function isPrivateFieldAccess(node) {
  return node.type === "MemberExpression" && node.property.type === "PrivateIdentifier" || node.type === "ChainExpression" && isPrivateFieldAccess(node.expression) || node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression);
}
pp$5.parseExprSubscripts = function(refDestructuringErrors, forInit) {
  var startPos = this.start, startLoc = this.startLoc;
  var oldDoubleProto = -1, oldShorthandAssign = -1;
  if (refDestructuringErrors) {
    oldDoubleProto = refDestructuringErrors.doubleProto;
    oldShorthandAssign = refDestructuringErrors.shorthandAssign;
    refDestructuringErrors.doubleProto = refDestructuringErrors.shorthandAssign = -1;
  }
  var expr = this.parseExprAtom(refDestructuringErrors, forInit);
  if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")") {
    return expr;
  }
  var result = this.parseSubscripts(expr, startPos, startLoc, false, forInit);
  if (refDestructuringErrors) {
    if (result.end > expr.end) {
      this.checkExpressionErrors(refDestructuringErrors, true);
      if (refDestructuringErrors.parenthesizedAssign >= result.start) {
        refDestructuringErrors.parenthesizedAssign = -1;
      }
      if (refDestructuringErrors.parenthesizedBind >= result.start) {
        refDestructuringErrors.parenthesizedBind = -1;
      }
      if (refDestructuringErrors.trailingComma >= result.start) {
        refDestructuringErrors.trailingComma = -1;
      }
    }
    if (oldDoubleProto > -1) {
      refDestructuringErrors.doubleProto = oldDoubleProto;
    }
    if (oldShorthandAssign > -1) {
      refDestructuringErrors.shorthandAssign = oldShorthandAssign;
    }
  }
  return result;
};
pp$5.parseSubscripts = function(base, startPos, startLoc, noCalls, forInit) {
  var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" && this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.potentialArrowAt === base.start;
  var optionalChained = false;
  while (true) {
    var element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit);
    if (element.optional) {
      optionalChained = true;
    }
    if (element.end === base.end || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        var chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = element;
        element = this.finishNode(chainNode, "ChainExpression");
      }
      return element;
    }
    base = element;
    maybeAsyncArrow = false;
  }
};
pp$5.shouldParseAsyncArrow = function() {
  return !this.canInsertSemicolon() && this.eat(types$1.arrow);
};
pp$5.parseSubscriptAsyncArrow = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true, forInit);
};
pp$5.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  var optionalSupported = this.options.ecmaVersion >= 11;
  var optional = optionalSupported && this.eat(types$1.questionDot);
  if (noCalls && optional) {
    this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");
  }
  var computed = this.eat(types$1.bracketL);
  if (computed || optional && this.type !== types$1.parenL && this.type !== types$1.backQuote || this.eat(types$1.dot)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    if (computed) {
      node.property = this.parseExpression();
      this.expect(types$1.bracketR);
    } else if (this.type === types$1.privateId && base.type !== "Super") {
      node.property = this.parsePrivateIdent();
    } else {
      node.property = this.parseIdent(this.options.allowReserved !== "never");
    }
    node.computed = !!computed;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(types$1.parenL)) {
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    var exprList = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !optional && this.shouldParseAsyncArrow()) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0) {
        this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function");
      }
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseSubscriptAsyncArrow(startPos, startLoc, exprList, forInit);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    var node$1 = this.startNodeAt(startPos, startLoc);
    node$1.callee = base;
    node$1.arguments = exprList;
    if (optionalSupported) {
      node$1.optional = optional;
    }
    base = this.finishNode(node$1, "CallExpression");
  } else if (this.type === types$1.backQuote) {
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    }
    var node$2 = this.startNodeAt(startPos, startLoc);
    node$2.tag = base;
    node$2.quasi = this.parseTemplate({ isTagged: true });
    base = this.finishNode(node$2, "TaggedTemplateExpression");
  }
  return base;
};
pp$5.parseExprAtom = function(refDestructuringErrors, forInit, forNew) {
  if (this.type === types$1.slash) {
    this.readRegexp();
  }
  var node, canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
    case types$1._super:
      if (!this.allowSuper) {
        this.raise(this.start, "'super' keyword outside a method");
      }
      node = this.startNode();
      this.next();
      if (this.type === types$1.parenL && !this.allowDirectSuper) {
        this.raise(node.start, "super() call outside constructor of a subclass");
      }
      if (this.type !== types$1.dot && this.type !== types$1.bracketL && this.type !== types$1.parenL) {
        this.unexpected();
      }
      return this.finishNode(node, "Super");
    case types$1._this:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "ThisExpression");
    case types$1.name:
      var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
      var id = this.parseIdent(false);
      if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(types$1._function)) {
        this.overrideContext(types.f_expr);
        return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true, forInit);
      }
      if (canBeArrow && !this.canInsertSemicolon()) {
        if (this.eat(types$1.arrow)) {
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false, forInit);
        }
        if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === types$1.name && !containsEsc && (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
          id = this.parseIdent(false);
          if (this.canInsertSemicolon() || !this.eat(types$1.arrow)) {
            this.unexpected();
          }
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true, forInit);
        }
      }
      return id;
    case types$1.regexp:
      var value = this.value;
      node = this.parseLiteral(value.value);
      node.regex = { pattern: value.pattern, flags: value.flags };
      return node;
    case types$1.num:
    case types$1.string:
      return this.parseLiteral(this.value);
    case types$1._null:
    case types$1._true:
    case types$1._false:
      node = this.startNode();
      node.value = this.type === types$1._null ? null : this.type === types$1._true;
      node.raw = this.type.keyword;
      this.next();
      return this.finishNode(node, "Literal");
    case types$1.parenL:
      var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit);
      if (refDestructuringErrors) {
        if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr)) {
          refDestructuringErrors.parenthesizedAssign = start;
        }
        if (refDestructuringErrors.parenthesizedBind < 0) {
          refDestructuringErrors.parenthesizedBind = start;
        }
      }
      return expr;
    case types$1.bracketL:
      node = this.startNode();
      this.next();
      node.elements = this.parseExprList(types$1.bracketR, true, true, refDestructuringErrors);
      return this.finishNode(node, "ArrayExpression");
    case types$1.braceL:
      this.overrideContext(types.b_expr);
      return this.parseObj(false, refDestructuringErrors);
    case types$1._function:
      node = this.startNode();
      this.next();
      return this.parseFunction(node, 0);
    case types$1._class:
      return this.parseClass(this.startNode(), false);
    case types$1._new:
      return this.parseNew();
    case types$1.backQuote:
      return this.parseTemplate();
    case types$1._import:
      if (this.options.ecmaVersion >= 11) {
        return this.parseExprImport(forNew);
      } else {
        return this.unexpected();
      }
    default:
      return this.parseExprAtomDefault();
  }
};
pp$5.parseExprAtomDefault = function() {
  this.unexpected();
};
pp$5.parseExprImport = function(forNew) {
  var node = this.startNode();
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword import");
  }
  this.next();
  if (this.type === types$1.parenL && !forNew) {
    return this.parseDynamicImport(node);
  } else if (this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "import";
    node.meta = this.finishNode(meta, "Identifier");
    return this.parseImportMeta(node);
  } else {
    this.unexpected();
  }
};
pp$5.parseDynamicImport = function(node) {
  this.next();
  node.source = this.parseMaybeAssign();
  if (this.options.ecmaVersion >= 16) {
    if (!this.eat(types$1.parenR)) {
      this.expect(types$1.comma);
      if (!this.afterTrailingComma(types$1.parenR)) {
        node.options = this.parseMaybeAssign();
        if (!this.eat(types$1.parenR)) {
          this.expect(types$1.comma);
          if (!this.afterTrailingComma(types$1.parenR)) {
            this.unexpected();
          }
        }
      } else {
        node.options = null;
      }
    } else {
      node.options = null;
    }
  } else {
    if (!this.eat(types$1.parenR)) {
      var errorPos = this.start;
      if (this.eat(types$1.comma) && this.eat(types$1.parenR)) {
        this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()");
      } else {
        this.unexpected(errorPos);
      }
    }
  }
  return this.finishNode(node, "ImportExpression");
};
pp$5.parseImportMeta = function(node) {
  this.next();
  var containsEsc = this.containsEsc;
  node.property = this.parseIdent(true);
  if (node.property.name !== "meta") {
    this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'");
  }
  if (containsEsc) {
    this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters");
  }
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere) {
    this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module");
  }
  return this.finishNode(node, "MetaProperty");
};
pp$5.parseLiteral = function(value) {
  var node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110) {
    node.bigint = node.value != null ? node.value.toString() : node.raw.slice(0, -1).replace(/_/g, "");
  }
  this.next();
  return this.finishNode(node, "Literal");
};
pp$5.parseParenExpression = function() {
  this.expect(types$1.parenL);
  var val = this.parseExpression();
  this.expect(types$1.parenR);
  return val;
};
pp$5.shouldParseArrow = function(exprList) {
  return !this.canInsertSemicolon();
};
pp$5.parseParenAndDistinguishExpression = function(canBeArrow, forInit) {
  var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();
    var innerStartPos = this.start, innerStartLoc = this.startLoc;
    var exprList = [], first = true, lastIsComma = false;
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    while (this.type !== types$1.parenR) {
      first ? first = false : this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(types$1.parenR, true)) {
        lastIsComma = true;
        break;
      } else if (this.type === types$1.ellipsis) {
        spreadStart = this.start;
        exprList.push(this.parseParenItem(this.parseRestBinding()));
        if (this.type === types$1.comma) {
          this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
        }
        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
      }
    }
    var innerEndPos = this.lastTokEnd, innerEndLoc = this.lastTokEndLoc;
    this.expect(types$1.parenR);
    if (canBeArrow && this.shouldParseArrow(exprList) && this.eat(types$1.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit);
    }
    if (!exprList.length || lastIsComma) {
      this.unexpected(this.lastTokStart);
    }
    if (spreadStart) {
      this.unexpected(spreadStart);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }
  if (this.options.preserveParens) {
    var par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression");
  } else {
    return val;
  }
};
pp$5.parseParenItem = function(item) {
  return item;
};
pp$5.parseParenArrowList = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, false, forInit);
};
var empty = [];
pp$5.parseNew = function() {
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword new");
  }
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion >= 6 && this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "new";
    node.meta = this.finishNode(meta, "Identifier");
    this.next();
    var containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target") {
      this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'");
    }
    if (containsEsc) {
      this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters");
    }
    if (!this.allowNewDotTarget) {
      this.raiseRecoverable(node.start, "'new.target' can only be used in functions and class static block");
    }
    return this.finishNode(node, "MetaProperty");
  }
  var startPos = this.start, startLoc = this.startLoc;
  node.callee = this.parseSubscripts(this.parseExprAtom(null, false, true), startPos, startLoc, true, false);
  if (node.callee.type === "Super") {
    this.raiseRecoverable(startPos, "Invalid use of 'super'");
  }
  if (this.eat(types$1.parenL)) {
    node.arguments = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false);
  } else {
    node.arguments = empty;
  }
  return this.finishNode(node, "NewExpression");
};
pp$5.parseTemplateElement = function(ref) {
  var isTagged = ref.isTagged;
  var elem = this.startNode();
  if (this.type === types$1.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value.replace(/\r\n?/g, `
`),
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, `
`),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === types$1.backQuote;
  return this.finishNode(elem, "TemplateElement");
};
pp$5.parseTemplate = function(ref) {
  if (ref === undefined)
    ref = {};
  var isTagged = ref.isTagged;
  if (isTagged === undefined)
    isTagged = false;
  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement({ isTagged });
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this.type === types$1.eof) {
      this.raise(this.pos, "Unterminated template literal");
    }
    this.expect(types$1.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(types$1.braceR);
    node.quasis.push(curElt = this.parseTemplateElement({ isTagged }));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral");
};
pp$5.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" && (this.type === types$1.name || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword || this.options.ecmaVersion >= 9 && this.type === types$1.star) && !lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$5.parseObj = function(isPattern, refDestructuringErrors) {
  var node = this.startNode(), first = true, propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var prop = this.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) {
      this.checkPropClash(prop, propHash, refDestructuringErrors);
    }
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
};
pp$5.parseProperty = function(isPattern, refDestructuringErrors) {
  var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(types$1.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement");
    }
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    if (this.type === types$1.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    return this.finishNode(prop, "SpreadElement");
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern) {
      isGenerator = this.eat(types$1.star);
    }
  }
  var containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(types$1.star);
    this.parsePropertyName(prop);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property");
};
pp$5.parseGetterSetter = function(prop) {
  var kind = prop.key.name;
  this.parsePropertyName(prop);
  prop.value = this.parseMethod(false);
  prop.kind = kind;
  var paramCount = prop.kind === "get" ? 0 : 1;
  if (prop.value.params.length !== paramCount) {
    var start = prop.value.start;
    if (prop.kind === "get") {
      this.raiseRecoverable(start, "getter should have no params");
    } else {
      this.raiseRecoverable(start, "setter should have exactly one param");
    }
  } else {
    if (prop.kind === "set" && prop.value.params[0].type === "RestElement") {
      this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params");
    }
  }
};
pp$5.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === types$1.colon) {
    this.unexpected();
  }
  if (this.eat(types$1.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === types$1.parenL) {
    if (isPattern) {
      this.unexpected();
    }
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
    prop.kind = "init";
  } else if (!isPattern && !containsEsc && this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.type !== types$1.comma && this.type !== types$1.braceR && this.type !== types$1.eq)) {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.parseGetterSetter(prop);
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = startPos;
    }
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else if (this.type === types$1.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0) {
        refDestructuringErrors.shorthandAssign = this.start;
      }
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else {
      prop.value = this.copyNode(prop.key);
    }
    prop.kind = "init";
    prop.shorthand = true;
  } else {
    this.unexpected();
  }
};
pp$5.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(types$1.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types$1.bracketR);
      return prop.key;
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === types$1.num || this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
};
pp$5.initFunction = function(node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) {
    node.generator = node.expression = false;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = false;
  }
};
pp$5.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 6) {
    node.generator = isGenerator;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true, false);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression");
};
pp$5.parseArrowExpression = function(node, params, isAsync, forInit) {
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression");
};
pp$5.parseFunctionBody = function(node, isArrowFunction, isMethod, forInit) {
  var isExpression = isArrowFunction && this.type !== types$1.braceL;
  var oldStrict = this.strict, useStrict = false;
  if (isExpression) {
    node.body = this.parseMaybeAssign(forInit);
    node.expression = true;
    this.checkParams(node, false);
  } else {
    var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      if (useStrict && nonSimple) {
        this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list");
      }
    }
    var oldLabels = this.labels;
    this.labels = [];
    if (useStrict) {
      this.strict = true;
    }
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    if (this.strict && node.id) {
      this.checkLValSimple(node.id, BIND_OUTSIDE);
    }
    node.body = this.parseBlock(false, undefined, useStrict && !oldStrict);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();
};
pp$5.isSimpleParamList = function(params) {
  for (var i = 0, list = params;i < list.length; i += 1) {
    var param = list[i];
    if (param.type !== "Identifier") {
      return false;
    }
  }
  return true;
};
pp$5.checkParams = function(node, allowDuplicates) {
  var nameHash = Object.create(null);
  for (var i = 0, list = node.params;i < list.length; i += 1) {
    var param = list[i];
    this.checkLValInnerPattern(param, BIND_VAR, allowDuplicates ? null : nameHash);
  }
};
pp$5.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (!first) {
      this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(close)) {
        break;
      }
    } else {
      first = false;
    }
    var elt = undefined;
    if (allowEmpty && this.type === types$1.comma) {
      elt = null;
    } else if (this.type === types$1.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this.type === types$1.comma && refDestructuringErrors.trailingComma < 0) {
        refDestructuringErrors.trailingComma = this.start;
      }
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts;
};
pp$5.checkUnreserved = function(ref) {
  var start = ref.start;
  var end = ref.end;
  var name = ref.name;
  if (this.inGenerator && name === "yield") {
    this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator");
  }
  if (this.inAsync && name === "await") {
    this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function");
  }
  if (!(this.currentThisScope().flags & SCOPE_VAR) && name === "arguments") {
    this.raiseRecoverable(start, "Cannot use 'arguments' in class field initializer");
  }
  if (this.inClassStaticBlock && (name === "arguments" || name === "await")) {
    this.raise(start, "Cannot use " + name + " in class static initialization block");
  }
  if (this.keywords.test(name)) {
    this.raise(start, "Unexpected keyword '" + name + "'");
  }
  if (this.options.ecmaVersion < 6 && this.input.slice(start, end).indexOf("\\") !== -1) {
    return;
  }
  var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await") {
      this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function");
    }
    this.raiseRecoverable(start, "The keyword '" + name + "' is reserved");
  }
};
pp$5.parseIdent = function(liberal) {
  var node = this.parseIdentNode();
  this.next(!!liberal);
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = node.start;
    }
  }
  return node;
};
pp$5.parseIdentNode = function() {
  var node = this.startNode();
  if (this.type === types$1.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;
    if ((node.name === "class" || node.name === "function") && (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
    this.type = types$1.name;
  } else {
    this.unexpected();
  }
  return node;
};
pp$5.parsePrivateIdent = function() {
  var node = this.startNode();
  if (this.type === types$1.privateId) {
    node.name = this.value;
  } else {
    this.unexpected();
  }
  this.next();
  this.finishNode(node, "PrivateIdentifier");
  if (this.options.checkPrivateFields) {
    if (this.privateNameStack.length === 0) {
      this.raise(node.start, "Private field '#" + node.name + "' must be declared in an enclosing class");
    } else {
      this.privateNameStack[this.privateNameStack.length - 1].used.push(node);
    }
  }
  return node;
};
pp$5.parseYield = function(forInit) {
  if (!this.yieldPos) {
    this.yieldPos = this.start;
  }
  var node = this.startNode();
  this.next();
  if (this.type === types$1.semi || this.canInsertSemicolon() || this.type !== types$1.star && !this.type.startsExpr) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(types$1.star);
    node.argument = this.parseMaybeAssign(forInit);
  }
  return this.finishNode(node, "YieldExpression");
};
pp$5.parseAwait = function(forInit) {
  if (!this.awaitPos) {
    this.awaitPos = this.start;
  }
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true, false, forInit);
  return this.finishNode(node, "AwaitExpression");
};
var pp$4 = Parser.prototype;
pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (this.sourceFile) {
    message += " in " + this.sourceFile;
  }
  var err = new SyntaxError(message);
  err.pos = pos;
  err.loc = loc;
  err.raisedAt = this.pos;
  throw err;
};
pp$4.raiseRecoverable = pp$4.raise;
pp$4.curPosition = function() {
  if (this.options.locations) {
    return new Position(this.curLine, this.pos - this.lineStart);
  }
};
var pp$3 = Parser.prototype;
var Scope = function Scope(flags) {
  this.flags = flags;
  this.var = [];
  this.lexical = [];
  this.functions = [];
};
pp$3.enterScope = function(flags) {
  this.scopeStack.push(new Scope(flags));
};
pp$3.exitScope = function() {
  this.scopeStack.pop();
};
pp$3.treatFunctionsAsVarInScope = function(scope) {
  return scope.flags & SCOPE_FUNCTION || !this.inModule && scope.flags & SCOPE_TOP;
};
pp$3.declareName = function(name, bindingType, pos) {
  var redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    var scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && scope.flags & SCOPE_TOP) {
      delete this.undefinedExports[name];
    }
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    var scope$1 = this.currentScope();
    scope$1.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    var scope$2 = this.currentScope();
    if (this.treatFunctionsAsVar) {
      redeclared = scope$2.lexical.indexOf(name) > -1;
    } else {
      redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1;
    }
    scope$2.functions.push(name);
  } else {
    for (var i = this.scopeStack.length - 1;i >= 0; --i) {
      var scope$3 = this.scopeStack[i];
      if (scope$3.lexical.indexOf(name) > -1 && !(scope$3.flags & SCOPE_SIMPLE_CATCH && scope$3.lexical[0] === name) || !this.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
        redeclared = true;
        break;
      }
      scope$3.var.push(name);
      if (this.inModule && scope$3.flags & SCOPE_TOP) {
        delete this.undefinedExports[name];
      }
      if (scope$3.flags & SCOPE_VAR) {
        break;
      }
    }
  }
  if (redeclared) {
    this.raiseRecoverable(pos, "Identifier '" + name + "' has already been declared");
  }
};
pp$3.checkLocalExport = function(id) {
  if (this.scopeStack[0].lexical.indexOf(id.name) === -1 && this.scopeStack[0].var.indexOf(id.name) === -1) {
    this.undefinedExports[id.name] = id;
  }
};
pp$3.currentScope = function() {
  return this.scopeStack[this.scopeStack.length - 1];
};
pp$3.currentVarScope = function() {
  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK)) {
      return scope;
    }
  }
};
pp$3.currentThisScope = function() {
  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK) && !(scope.flags & SCOPE_ARROW)) {
      return scope;
    }
  }
};
var Node = function Node(parser, pos, loc) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations) {
    this.loc = new SourceLocation(parser, loc);
  }
  if (parser.options.directSourceFile) {
    this.sourceFile = parser.options.directSourceFile;
  }
  if (parser.options.ranges) {
    this.range = [pos, 0];
  }
};
var pp$2 = Parser.prototype;
pp$2.startNode = function() {
  return new Node(this, this.start, this.startLoc);
};
pp$2.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc);
};
function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations) {
    node.loc.end = loc;
  }
  if (this.options.ranges) {
    node.range[1] = pos;
  }
  return node;
}
pp$2.finishNode = function(node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc);
};
pp$2.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc);
};
pp$2.copyNode = function(node) {
  var newNode = new Node(this, node.start, this.startLoc);
  for (var prop in node) {
    newNode[prop] = node[prop];
  }
  return newNode;
};
var scriptValuesAddedInUnicode = "Berf Beria_Erfe Gara Garay Gukh Gurung_Khema Hrkt Katakana_Or_Hiragana Kawi Kirat_Rai Krai Nag_Mundari Nagm Ol_Onal Onao Sidetic Sidt Sunu Sunuwar Tai_Yo Tayo Todhri Todr Tolong_Siki Tols Tulu_Tigalari Tutg Unknown Zzzz";
var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
var ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
var ecma11BinaryProperties = ecma10BinaryProperties;
var ecma12BinaryProperties = ecma11BinaryProperties + " EBase EComp EMod EPres ExtPict";
var ecma13BinaryProperties = ecma12BinaryProperties;
var ecma14BinaryProperties = ecma13BinaryProperties;
var unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma10BinaryProperties,
  11: ecma11BinaryProperties,
  12: ecma12BinaryProperties,
  13: ecma13BinaryProperties,
  14: ecma14BinaryProperties
};
var ecma14BinaryPropertiesOfStrings = "Basic_Emoji Emoji_Keycap_Sequence RGI_Emoji_Modifier_Sequence RGI_Emoji_Flag_Sequence RGI_Emoji_Tag_Sequence RGI_Emoji_ZWJ_Sequence RGI_Emoji";
var unicodeBinaryPropertiesOfStrings = {
  9: "",
  10: "",
  11: "",
  12: "",
  13: "",
  14: ecma14BinaryPropertiesOfStrings
};
var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";
var ecma9ScriptValues = "Adlam Adlm Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
var ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
var ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
var ecma12ScriptValues = ecma11ScriptValues + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi";
var ecma13ScriptValues = ecma12ScriptValues + " Cypro_Minoan Cpmn Old_Uyghur Ougr Tangsa Tnsa Toto Vithkuqi Vith";
var ecma14ScriptValues = ecma13ScriptValues + " " + scriptValuesAddedInUnicode;
var unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma10ScriptValues,
  11: ecma11ScriptValues,
  12: ecma12ScriptValues,
  13: ecma13ScriptValues,
  14: ecma14ScriptValues
};
var data = {};
function buildUnicodeData(ecmaVersion) {
  var d = data[ecmaVersion] = {
    binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
    binaryOfStrings: wordsRegexp(unicodeBinaryPropertiesOfStrings[ecmaVersion]),
    nonBinary: {
      General_Category: wordsRegexp(unicodeGeneralCategoryValues),
      Script: wordsRegexp(unicodeScriptValues[ecmaVersion])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;
  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}
for (i = 0, list = [9, 10, 11, 12, 13, 14];i < list.length; i += 1) {
  ecmaVersion = list[i];
  buildUnicodeData(ecmaVersion);
}
var ecmaVersion;
var i;
var list;
var pp$1 = Parser.prototype;
var BranchID = function BranchID(parent, base) {
  this.parent = parent;
  this.base = base || this;
};
BranchID.prototype.separatedFrom = function separatedFrom(alt) {
  for (var self = this;self; self = self.parent) {
    for (var other = alt;other; other = other.parent) {
      if (self.base === other.base && self !== other) {
        return true;
      }
    }
  }
  return false;
};
BranchID.prototype.sibling = function sibling() {
  return new BranchID(this.parent, this.base);
};
var RegExpValidationState = function RegExpValidationState(parser) {
  this.parser = parser;
  this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "") + (parser.options.ecmaVersion >= 13 ? "d" : "") + (parser.options.ecmaVersion >= 15 ? "v" : "");
  this.unicodeProperties = data[parser.options.ecmaVersion >= 14 ? 14 : parser.options.ecmaVersion];
  this.source = "";
  this.flags = "";
  this.start = 0;
  this.switchU = false;
  this.switchV = false;
  this.switchN = false;
  this.pos = 0;
  this.lastIntValue = 0;
  this.lastStringValue = "";
  this.lastAssertionIsQuantifiable = false;
  this.numCapturingParens = 0;
  this.maxBackReference = 0;
  this.groupNames = Object.create(null);
  this.backReferenceNames = [];
  this.branchID = null;
};
RegExpValidationState.prototype.reset = function reset(start, pattern, flags) {
  var unicodeSets = flags.indexOf("v") !== -1;
  var unicode = flags.indexOf("u") !== -1;
  this.start = start | 0;
  this.source = pattern + "";
  this.flags = flags;
  if (unicodeSets && this.parser.options.ecmaVersion >= 15) {
    this.switchU = true;
    this.switchV = true;
    this.switchN = true;
  } else {
    this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
    this.switchV = false;
    this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
  }
};
RegExpValidationState.prototype.raise = function raise(message) {
  this.parser.raiseRecoverable(this.start, "Invalid regular expression: /" + this.source + "/: " + message);
};
RegExpValidationState.prototype.at = function at(i, forceU) {
  if (forceU === undefined)
    forceU = false;
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return -1;
  }
  var c = s.charCodeAt(i);
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i + 1 >= l) {
    return c;
  }
  var next = s.charCodeAt(i + 1);
  return next >= 56320 && next <= 57343 ? (c << 10) + next - 56613888 : c;
};
RegExpValidationState.prototype.nextIndex = function nextIndex(i, forceU) {
  if (forceU === undefined)
    forceU = false;
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return l;
  }
  var c = s.charCodeAt(i), next;
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i + 1 >= l || (next = s.charCodeAt(i + 1)) < 56320 || next > 57343) {
    return i + 1;
  }
  return i + 2;
};
RegExpValidationState.prototype.current = function current(forceU) {
  if (forceU === undefined)
    forceU = false;
  return this.at(this.pos, forceU);
};
RegExpValidationState.prototype.lookahead = function lookahead(forceU) {
  if (forceU === undefined)
    forceU = false;
  return this.at(this.nextIndex(this.pos, forceU), forceU);
};
RegExpValidationState.prototype.advance = function advance(forceU) {
  if (forceU === undefined)
    forceU = false;
  this.pos = this.nextIndex(this.pos, forceU);
};
RegExpValidationState.prototype.eat = function eat(ch, forceU) {
  if (forceU === undefined)
    forceU = false;
  if (this.current(forceU) === ch) {
    this.advance(forceU);
    return true;
  }
  return false;
};
RegExpValidationState.prototype.eatChars = function eatChars(chs, forceU) {
  if (forceU === undefined)
    forceU = false;
  var pos = this.pos;
  for (var i = 0, list = chs;i < list.length; i += 1) {
    var ch = list[i];
    var current = this.at(pos, forceU);
    if (current === -1 || current !== ch) {
      return false;
    }
    pos = this.nextIndex(pos, forceU);
  }
  this.pos = pos;
  return true;
};
pp$1.validateRegExpFlags = function(state) {
  var validFlags = state.validFlags;
  var flags = state.flags;
  var u = false;
  var v = false;
  for (var i = 0;i < flags.length; i++) {
    var flag = flags.charAt(i);
    if (validFlags.indexOf(flag) === -1) {
      this.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i + 1) > -1) {
      this.raise(state.start, "Duplicate regular expression flag");
    }
    if (flag === "u") {
      u = true;
    }
    if (flag === "v") {
      v = true;
    }
  }
  if (this.options.ecmaVersion >= 15 && u && v) {
    this.raise(state.start, "Invalid regular expression flag");
  }
};
function hasProp(obj) {
  for (var _ in obj) {
    return true;
  }
  return false;
}
pp$1.validateRegExpPattern = function(state) {
  this.regexp_pattern(state);
  if (!state.switchN && this.options.ecmaVersion >= 9 && hasProp(state.groupNames)) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};
pp$1.regexp_pattern = function(state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames = Object.create(null);
  state.backReferenceNames.length = 0;
  state.branchID = null;
  this.regexp_disjunction(state);
  if (state.pos !== state.source.length) {
    if (state.eat(41)) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(93) || state.eat(125)) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var i = 0, list = state.backReferenceNames;i < list.length; i += 1) {
    var name = list[i];
    if (!state.groupNames[name]) {
      state.raise("Invalid named capture referenced");
    }
  }
};
pp$1.regexp_disjunction = function(state) {
  var trackDisjunction = this.options.ecmaVersion >= 16;
  if (trackDisjunction) {
    state.branchID = new BranchID(state.branchID, null);
  }
  this.regexp_alternative(state);
  while (state.eat(124)) {
    if (trackDisjunction) {
      state.branchID = state.branchID.sibling();
    }
    this.regexp_alternative(state);
  }
  if (trackDisjunction) {
    state.branchID = state.branchID.parent;
  }
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(123)) {
    state.raise("Lone quantifier brackets");
  }
};
pp$1.regexp_alternative = function(state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state)) {}
};
pp$1.regexp_eatTerm = function(state) {
  if (this.regexp_eatAssertion(state)) {
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true;
  }
  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true;
  }
  return false;
};
pp$1.regexp_eatAssertion = function(state) {
  var start = state.pos;
  state.lastAssertionIsQuantifiable = false;
  if (state.eat(94) || state.eat(36)) {
    return true;
  }
  if (state.eat(92)) {
    if (state.eat(66) || state.eat(98)) {
      return true;
    }
    state.pos = start;
  }
  if (state.eat(40) && state.eat(63)) {
    var lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(60);
    }
    if (state.eat(61) || state.eat(33)) {
      this.regexp_disjunction(state);
      if (!state.eat(41)) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true;
    }
  }
  state.pos = start;
  return false;
};
pp$1.regexp_eatQuantifier = function(state, noError) {
  if (noError === undefined)
    noError = false;
  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(63);
    return true;
  }
  return false;
};
pp$1.regexp_eatQuantifierPrefix = function(state, noError) {
  return state.eat(42) || state.eat(43) || state.eat(63) || this.regexp_eatBracedQuantifier(state, noError);
};
pp$1.regexp_eatBracedQuantifier = function(state, noError) {
  var start = state.pos;
  if (state.eat(123)) {
    var min = 0, max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(44) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(125)) {
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true;
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatAtom = function(state) {
  return this.regexp_eatPatternCharacters(state) || state.eat(46) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state);
};
pp$1.regexp_eatReverseSolidusAtomEscape = function(state) {
  var start = state.pos;
  if (state.eat(92)) {
    if (this.regexp_eatAtomEscape(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatUncapturingGroup = function(state) {
  var start = state.pos;
  if (state.eat(40)) {
    if (state.eat(63)) {
      if (this.options.ecmaVersion >= 16) {
        var addModifiers = this.regexp_eatModifiers(state);
        var hasHyphen = state.eat(45);
        if (addModifiers || hasHyphen) {
          for (var i = 0;i < addModifiers.length; i++) {
            var modifier = addModifiers.charAt(i);
            if (addModifiers.indexOf(modifier, i + 1) > -1) {
              state.raise("Duplicate regular expression modifiers");
            }
          }
          if (hasHyphen) {
            var removeModifiers = this.regexp_eatModifiers(state);
            if (!addModifiers && !removeModifiers && state.current() === 58) {
              state.raise("Invalid regular expression modifiers");
            }
            for (var i$1 = 0;i$1 < removeModifiers.length; i$1++) {
              var modifier$1 = removeModifiers.charAt(i$1);
              if (removeModifiers.indexOf(modifier$1, i$1 + 1) > -1 || addModifiers.indexOf(modifier$1) > -1) {
                state.raise("Duplicate regular expression modifiers");
              }
            }
          }
        }
      }
      if (state.eat(58)) {
        this.regexp_disjunction(state);
        if (state.eat(41)) {
          return true;
        }
        state.raise("Unterminated group");
      }
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatCapturingGroup = function(state) {
  if (state.eat(40)) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 63) {
      state.raise("Invalid group");
    }
    this.regexp_disjunction(state);
    if (state.eat(41)) {
      state.numCapturingParens += 1;
      return true;
    }
    state.raise("Unterminated group");
  }
  return false;
};
pp$1.regexp_eatModifiers = function(state) {
  var modifiers = "";
  var ch = 0;
  while ((ch = state.current()) !== -1 && isRegularExpressionModifier(ch)) {
    modifiers += codePointToString(ch);
    state.advance();
  }
  return modifiers;
};
function isRegularExpressionModifier(ch) {
  return ch === 105 || ch === 109 || ch === 115;
}
pp$1.regexp_eatExtendedAtom = function(state) {
  return state.eat(46) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state) || this.regexp_eatInvalidBracedQuantifier(state) || this.regexp_eatExtendedPatternCharacter(state);
};
pp$1.regexp_eatInvalidBracedQuantifier = function(state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false;
};
pp$1.regexp_eatSyntaxCharacter = function(state) {
  var ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isSyntaxCharacter(ch) {
  return ch === 36 || ch >= 40 && ch <= 43 || ch === 46 || ch === 63 || ch >= 91 && ch <= 94 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatPatternCharacters = function(state) {
  var start = state.pos;
  var ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start;
};
pp$1.regexp_eatExtendedPatternCharacter = function(state) {
  var ch = state.current();
  if (ch !== -1 && ch !== 36 && !(ch >= 40 && ch <= 43) && ch !== 46 && ch !== 63 && ch !== 91 && ch !== 94 && ch !== 124) {
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_groupSpecifier = function(state) {
  if (state.eat(63)) {
    if (!this.regexp_eatGroupName(state)) {
      state.raise("Invalid group");
    }
    var trackDisjunction = this.options.ecmaVersion >= 16;
    var known = state.groupNames[state.lastStringValue];
    if (known) {
      if (trackDisjunction) {
        for (var i = 0, list = known;i < list.length; i += 1) {
          var altID = list[i];
          if (!altID.separatedFrom(state.branchID)) {
            state.raise("Duplicate capture group name");
          }
        }
      } else {
        state.raise("Duplicate capture group name");
      }
    }
    if (trackDisjunction) {
      (known || (state.groupNames[state.lastStringValue] = [])).push(state.branchID);
    } else {
      state.groupNames[state.lastStringValue] = true;
    }
  }
};
pp$1.regexp_eatGroupName = function(state) {
  state.lastStringValue = "";
  if (state.eat(60)) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(62)) {
      return true;
    }
    state.raise("Invalid capture group name");
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierName = function(state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString(state.lastIntValue);
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierStart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierStart(ch) {
  return isIdentifierStart(ch, true) || ch === 36 || ch === 95;
}
pp$1.regexp_eatRegExpIdentifierPart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierPart(ch) {
  return isIdentifierChar(ch, true) || ch === 36 || ch === 95 || ch === 8204 || ch === 8205;
}
pp$1.regexp_eatAtomEscape = function(state) {
  if (this.regexp_eatBackReference(state) || this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state) || state.switchN && this.regexp_eatKGroupName(state)) {
    return true;
  }
  if (state.switchU) {
    if (state.current() === 99) {
      state.raise("Invalid unicode escape");
    }
    state.raise("Invalid escape");
  }
  return false;
};
pp$1.regexp_eatBackReference = function(state) {
  var start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    var n = state.lastIntValue;
    if (state.switchU) {
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true;
    }
    if (n <= state.numCapturingParens) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatKGroupName = function(state) {
  if (state.eat(107)) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true;
    }
    state.raise("Invalid named reference");
  }
  return false;
};
pp$1.regexp_eatCharacterEscape = function(state) {
  return this.regexp_eatControlEscape(state) || this.regexp_eatCControlLetter(state) || this.regexp_eatZero(state) || this.regexp_eatHexEscapeSequence(state) || this.regexp_eatRegExpUnicodeEscapeSequence(state, false) || !state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state) || this.regexp_eatIdentityEscape(state);
};
pp$1.regexp_eatCControlLetter = function(state) {
  var start = state.pos;
  if (state.eat(99)) {
    if (this.regexp_eatControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatZero = function(state) {
  if (state.current() === 48 && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlEscape = function(state) {
  var ch = state.current();
  if (ch === 116) {
    state.lastIntValue = 9;
    state.advance();
    return true;
  }
  if (ch === 110) {
    state.lastIntValue = 10;
    state.advance();
    return true;
  }
  if (ch === 118) {
    state.lastIntValue = 11;
    state.advance();
    return true;
  }
  if (ch === 102) {
    state.lastIntValue = 12;
    state.advance();
    return true;
  }
  if (ch === 114) {
    state.lastIntValue = 13;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlLetter = function(state) {
  var ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
function isControlLetter(ch) {
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122;
}
pp$1.regexp_eatRegExpUnicodeEscapeSequence = function(state, forceU) {
  if (forceU === undefined)
    forceU = false;
  var start = state.pos;
  var switchU = forceU || state.switchU;
  if (state.eat(117)) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      var lead = state.lastIntValue;
      if (switchU && lead >= 55296 && lead <= 56319) {
        var leadSurrogateEnd = state.pos;
        if (state.eat(92) && state.eat(117) && this.regexp_eatFixedHexDigits(state, 4)) {
          var trail = state.lastIntValue;
          if (trail >= 56320 && trail <= 57343) {
            state.lastIntValue = (lead - 55296) * 1024 + (trail - 56320) + 65536;
            return true;
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true;
    }
    if (switchU && state.eat(123) && this.regexp_eatHexDigits(state) && state.eat(125) && isValidUnicode(state.lastIntValue)) {
      return true;
    }
    if (switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }
  return false;
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 1114111;
}
pp$1.regexp_eatIdentityEscape = function(state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true;
    }
    if (state.eat(47)) {
      state.lastIntValue = 47;
      return true;
    }
    return false;
  }
  var ch = state.current();
  if (ch !== 99 && (!state.switchN || ch !== 107)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatDecimalEscape = function(state) {
  state.lastIntValue = 0;
  var ch = state.current();
  if (ch >= 49 && ch <= 57) {
    do {
      state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
      state.advance();
    } while ((ch = state.current()) >= 48 && ch <= 57);
    return true;
  }
  return false;
};
var CharSetNone = 0;
var CharSetOk = 1;
var CharSetString = 2;
pp$1.regexp_eatCharacterClassEscape = function(state) {
  var ch = state.current();
  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return CharSetOk;
  }
  var negate = false;
  if (state.switchU && this.options.ecmaVersion >= 9 && ((negate = ch === 80) || ch === 112)) {
    state.lastIntValue = -1;
    state.advance();
    var result;
    if (state.eat(123) && (result = this.regexp_eatUnicodePropertyValueExpression(state)) && state.eat(125)) {
      if (negate && result === CharSetString) {
        state.raise("Invalid property name");
      }
      return result;
    }
    state.raise("Invalid property name");
  }
  return CharSetNone;
};
function isCharacterClassEscape(ch) {
  return ch === 100 || ch === 68 || ch === 115 || ch === 83 || ch === 119 || ch === 87;
}
pp$1.regexp_eatUnicodePropertyValueExpression = function(state) {
  var start = state.pos;
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(61)) {
    var name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      var value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return CharSetOk;
    }
  }
  state.pos = start;
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    var nameOrValue = state.lastStringValue;
    return this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
  }
  return CharSetNone;
};
pp$1.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
  if (!hasOwn(state.unicodeProperties.nonBinary, name)) {
    state.raise("Invalid property name");
  }
  if (!state.unicodeProperties.nonBinary[name].test(value)) {
    state.raise("Invalid property value");
  }
};
pp$1.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
  if (state.unicodeProperties.binary.test(nameOrValue)) {
    return CharSetOk;
  }
  if (state.switchV && state.unicodeProperties.binaryOfStrings.test(nameOrValue)) {
    return CharSetString;
  }
  state.raise("Invalid property name");
};
pp$1.regexp_eatUnicodePropertyName = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 95;
}
pp$1.regexp_eatUnicodePropertyValue = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch);
}
pp$1.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
  return this.regexp_eatUnicodePropertyValue(state);
};
pp$1.regexp_eatCharacterClass = function(state) {
  if (state.eat(91)) {
    var negate = state.eat(94);
    var result = this.regexp_classContents(state);
    if (!state.eat(93)) {
      state.raise("Unterminated character class");
    }
    if (negate && result === CharSetString) {
      state.raise("Negated character class may contain strings");
    }
    return true;
  }
  return false;
};
pp$1.regexp_classContents = function(state) {
  if (state.current() === 93) {
    return CharSetOk;
  }
  if (state.switchV) {
    return this.regexp_classSetExpression(state);
  }
  this.regexp_nonEmptyClassRanges(state);
  return CharSetOk;
};
pp$1.regexp_nonEmptyClassRanges = function(state) {
  while (this.regexp_eatClassAtom(state)) {
    var left = state.lastIntValue;
    if (state.eat(45) && this.regexp_eatClassAtom(state)) {
      var right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};
pp$1.regexp_eatClassAtom = function(state) {
  var start = state.pos;
  if (state.eat(92)) {
    if (this.regexp_eatClassEscape(state)) {
      return true;
    }
    if (state.switchU) {
      var ch$1 = state.current();
      if (ch$1 === 99 || isOctalDigit(ch$1)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  var ch = state.current();
  if (ch !== 93) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatClassEscape = function(state) {
  var start = state.pos;
  if (state.eat(98)) {
    state.lastIntValue = 8;
    return true;
  }
  if (state.switchU && state.eat(45)) {
    state.lastIntValue = 45;
    return true;
  }
  if (!state.switchU && state.eat(99)) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state);
};
pp$1.regexp_classSetExpression = function(state) {
  var result = CharSetOk, subResult;
  if (this.regexp_eatClassSetRange(state))
    ;
  else if (subResult = this.regexp_eatClassSetOperand(state)) {
    if (subResult === CharSetString) {
      result = CharSetString;
    }
    var start = state.pos;
    while (state.eatChars([38, 38])) {
      if (state.current() !== 38 && (subResult = this.regexp_eatClassSetOperand(state))) {
        if (subResult !== CharSetString) {
          result = CharSetOk;
        }
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
    while (state.eatChars([45, 45])) {
      if (this.regexp_eatClassSetOperand(state)) {
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
  } else {
    state.raise("Invalid character in character class");
  }
  for (;; ) {
    if (this.regexp_eatClassSetRange(state)) {
      continue;
    }
    subResult = this.regexp_eatClassSetOperand(state);
    if (!subResult) {
      return result;
    }
    if (subResult === CharSetString) {
      result = CharSetString;
    }
  }
};
pp$1.regexp_eatClassSetRange = function(state) {
  var start = state.pos;
  if (this.regexp_eatClassSetCharacter(state)) {
    var left = state.lastIntValue;
    if (state.eat(45) && this.regexp_eatClassSetCharacter(state)) {
      var right = state.lastIntValue;
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatClassSetOperand = function(state) {
  if (this.regexp_eatClassSetCharacter(state)) {
    return CharSetOk;
  }
  return this.regexp_eatClassStringDisjunction(state) || this.regexp_eatNestedClass(state);
};
pp$1.regexp_eatNestedClass = function(state) {
  var start = state.pos;
  if (state.eat(91)) {
    var negate = state.eat(94);
    var result = this.regexp_classContents(state);
    if (state.eat(93)) {
      if (negate && result === CharSetString) {
        state.raise("Negated character class may contain strings");
      }
      return result;
    }
    state.pos = start;
  }
  if (state.eat(92)) {
    var result$1 = this.regexp_eatCharacterClassEscape(state);
    if (result$1) {
      return result$1;
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_eatClassStringDisjunction = function(state) {
  var start = state.pos;
  if (state.eatChars([92, 113])) {
    if (state.eat(123)) {
      var result = this.regexp_classStringDisjunctionContents(state);
      if (state.eat(125)) {
        return result;
      }
    } else {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_classStringDisjunctionContents = function(state) {
  var result = this.regexp_classString(state);
  while (state.eat(124)) {
    if (this.regexp_classString(state) === CharSetString) {
      result = CharSetString;
    }
  }
  return result;
};
pp$1.regexp_classString = function(state) {
  var count = 0;
  while (this.regexp_eatClassSetCharacter(state)) {
    count++;
  }
  return count === 1 ? CharSetOk : CharSetString;
};
pp$1.regexp_eatClassSetCharacter = function(state) {
  var start = state.pos;
  if (state.eat(92)) {
    if (this.regexp_eatCharacterEscape(state) || this.regexp_eatClassSetReservedPunctuator(state)) {
      return true;
    }
    if (state.eat(98)) {
      state.lastIntValue = 8;
      return true;
    }
    state.pos = start;
    return false;
  }
  var ch = state.current();
  if (ch < 0 || ch === state.lookahead() && isClassSetReservedDoublePunctuatorCharacter(ch)) {
    return false;
  }
  if (isClassSetSyntaxCharacter(ch)) {
    return false;
  }
  state.advance();
  state.lastIntValue = ch;
  return true;
};
function isClassSetReservedDoublePunctuatorCharacter(ch) {
  return ch === 33 || ch >= 35 && ch <= 38 || ch >= 42 && ch <= 44 || ch === 46 || ch >= 58 && ch <= 64 || ch === 94 || ch === 96 || ch === 126;
}
function isClassSetSyntaxCharacter(ch) {
  return ch === 40 || ch === 41 || ch === 45 || ch === 47 || ch >= 91 && ch <= 93 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatClassSetReservedPunctuator = function(state) {
  var ch = state.current();
  if (isClassSetReservedPunctuator(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isClassSetReservedPunctuator(ch) {
  return ch === 33 || ch === 35 || ch === 37 || ch === 38 || ch === 44 || ch === 45 || ch >= 58 && ch <= 62 || ch === 64 || ch === 96 || ch === 126;
}
pp$1.regexp_eatClassControlLetter = function(state) {
  var ch = state.current();
  if (isDecimalDigit(ch) || ch === 95) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatHexEscapeSequence = function(state) {
  var start = state.pos;
  if (state.eat(120)) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true;
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatDecimalDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
    state.advance();
  }
  return state.pos !== start;
};
function isDecimalDigit(ch) {
  return ch >= 48 && ch <= 57;
}
pp$1.regexp_eatHexDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start;
};
function isHexDigit(ch) {
  return ch >= 48 && ch <= 57 || ch >= 65 && ch <= 70 || ch >= 97 && ch <= 102;
}
function hexToInt(ch) {
  if (ch >= 65 && ch <= 70) {
    return 10 + (ch - 65);
  }
  if (ch >= 97 && ch <= 102) {
    return 10 + (ch - 97);
  }
  return ch - 48;
}
pp$1.regexp_eatLegacyOctalEscapeSequence = function(state) {
  if (this.regexp_eatOctalDigit(state)) {
    var n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      var n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatOctalDigit = function(state) {
  var ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 48;
    state.advance();
    return true;
  }
  state.lastIntValue = 0;
  return false;
};
function isOctalDigit(ch) {
  return ch >= 48 && ch <= 55;
}
pp$1.regexp_eatFixedHexDigits = function(state, length) {
  var start = state.pos;
  state.lastIntValue = 0;
  for (var i = 0;i < length; ++i) {
    var ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false;
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true;
};
var Token = function Token(p) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations) {
    this.loc = new SourceLocation(p, p.startLoc, p.endLoc);
  }
  if (p.options.ranges) {
    this.range = [p.start, p.end];
  }
};
var pp = Parser.prototype;
pp.next = function(ignoreEscapeSequenceInKeyword) {
  if (!ignoreEscapeSequenceInKeyword && this.type.keyword && this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword);
  }
  if (this.options.onToken) {
    this.options.onToken(new Token(this));
  }
  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};
pp.getToken = function() {
  this.next();
  return new Token(this);
};
if (typeof Symbol !== "undefined") {
  pp[Symbol.iterator] = function() {
    var this$1$1 = this;
    return {
      next: function() {
        var token = this$1$1.getToken();
        return {
          done: token.type === types$1.eof,
          value: token
        };
      }
    };
  };
}
pp.nextToken = function() {
  var curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) {
    this.skipSpace();
  }
  this.start = this.pos;
  if (this.options.locations) {
    this.startLoc = this.curPosition();
  }
  if (this.pos >= this.input.length) {
    return this.finishToken(types$1.eof);
  }
  if (curContext.override) {
    return curContext.override(this);
  } else {
    this.readToken(this.fullCharCodeAtPos());
  }
};
pp.readToken = function(code) {
  if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92) {
    return this.readWord();
  }
  return this.getTokenFromCode(code);
};
pp.fullCharCodeAt = function(pos) {
  var code = this.input.charCodeAt(pos);
  if (code <= 55295 || code >= 56320) {
    return code;
  }
  var next = this.input.charCodeAt(pos + 1);
  return next <= 56319 || next >= 57344 ? code : (code << 10) + next - 56613888;
};
pp.fullCharCodeAtPos = function() {
  return this.fullCharCodeAt(this.pos);
};
pp.skipBlockComment = function() {
  var startLoc = this.options.onComment && this.curPosition();
  var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) {
    this.raise(this.pos - 2, "Unterminated comment");
  }
  this.pos = end + 2;
  if (this.options.locations) {
    for (var nextBreak = undefined, pos = start;(nextBreak = nextLineBreak(this.input, pos, this.pos)) > -1; ) {
      ++this.curLine;
      pos = this.lineStart = nextBreak;
    }
  }
  if (this.options.onComment) {
    this.options.onComment(true, this.input.slice(start + 2, end), start, this.pos, startLoc, this.curPosition());
  }
};
pp.skipLineComment = function(startSkip) {
  var start = this.pos;
  var startLoc = this.options.onComment && this.curPosition();
  var ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !isNewLine(ch)) {
    ch = this.input.charCodeAt(++this.pos);
  }
  if (this.options.onComment) {
    this.options.onComment(false, this.input.slice(start + startSkip, this.pos), start, this.pos, startLoc, this.curPosition());
  }
};
pp.skipSpace = function() {
  loop:
    while (this.pos < this.input.length) {
      var ch = this.input.charCodeAt(this.pos);
      switch (ch) {
        case 32:
        case 160:
          ++this.pos;
          break;
        case 13:
          if (this.input.charCodeAt(this.pos + 1) === 10) {
            ++this.pos;
          }
        case 10:
        case 8232:
        case 8233:
          ++this.pos;
          if (this.options.locations) {
            ++this.curLine;
            this.lineStart = this.pos;
          }
          break;
        case 47:
          switch (this.input.charCodeAt(this.pos + 1)) {
            case 42:
              this.skipBlockComment();
              break;
            case 47:
              this.skipLineComment(2);
              break;
            default:
              break loop;
          }
          break;
        default:
          if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
            ++this.pos;
          } else {
            break loop;
          }
      }
    }
};
pp.finishToken = function(type, val) {
  this.end = this.pos;
  if (this.options.locations) {
    this.endLoc = this.curPosition();
  }
  var prevType = this.type;
  this.type = type;
  this.value = val;
  this.updateContext(prevType);
};
pp.readToken_dot = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) {
    return this.readNumber(true);
  }
  var next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) {
    this.pos += 3;
    return this.finishToken(types$1.ellipsis);
  } else {
    ++this.pos;
    return this.finishToken(types$1.dot);
  }
};
pp.readToken_slash = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) {
    ++this.pos;
    return this.readRegexp();
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.slash, 1);
};
pp.readToken_mult_modulo_exp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  var tokentype = code === 42 ? types$1.star : types$1.modulo;
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = types$1.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, size + 1);
  }
  return this.finishOp(tokentype, size);
};
pp.readToken_pipe_amp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) {
        return this.finishOp(types$1.assign, 3);
      }
    }
    return this.finishOp(code === 124 ? types$1.logicalOR : types$1.logicalAND, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(code === 124 ? types$1.bitwiseOR : types$1.bitwiseAND, 1);
};
pp.readToken_caret = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.bitwiseXOR, 1);
};
pp.readToken_plus_min = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 && (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken();
    }
    return this.finishOp(types$1.incDec, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.plusMin, 1);
};
pp.readToken_lt_gt = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) {
      return this.finishOp(types$1.assign, size + 1);
    }
    return this.finishOp(types$1.bitShift, size);
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 && this.input.charCodeAt(this.pos + 3) === 45) {
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken();
  }
  if (next === 61) {
    size = 2;
  }
  return this.finishOp(types$1.relational, size);
};
pp.readToken_eq_excl = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
  }
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) {
    this.pos += 2;
    return this.finishToken(types$1.arrow);
  }
  return this.finishOp(code === 61 ? types$1.eq : types$1.prefix, 1);
};
pp.readToken_question = function() {
  var ecmaVersion = this.options.ecmaVersion;
  if (ecmaVersion >= 11) {
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) {
        return this.finishOp(types$1.questionDot, 2);
      }
    }
    if (next === 63) {
      if (ecmaVersion >= 12) {
        var next2$1 = this.input.charCodeAt(this.pos + 2);
        if (next2$1 === 61) {
          return this.finishOp(types$1.assign, 3);
        }
      }
      return this.finishOp(types$1.coalesce, 2);
    }
  }
  return this.finishOp(types$1.question, 1);
};
pp.readToken_numberSign = function() {
  var ecmaVersion = this.options.ecmaVersion;
  var code = 35;
  if (ecmaVersion >= 13) {
    ++this.pos;
    code = this.fullCharCodeAtPos();
    if (isIdentifierStart(code, true) || code === 92) {
      return this.finishToken(types$1.privateId, this.readWord1());
    }
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.getTokenFromCode = function(code) {
  switch (code) {
    case 46:
      return this.readToken_dot();
    case 40:
      ++this.pos;
      return this.finishToken(types$1.parenL);
    case 41:
      ++this.pos;
      return this.finishToken(types$1.parenR);
    case 59:
      ++this.pos;
      return this.finishToken(types$1.semi);
    case 44:
      ++this.pos;
      return this.finishToken(types$1.comma);
    case 91:
      ++this.pos;
      return this.finishToken(types$1.bracketL);
    case 93:
      ++this.pos;
      return this.finishToken(types$1.bracketR);
    case 123:
      ++this.pos;
      return this.finishToken(types$1.braceL);
    case 125:
      ++this.pos;
      return this.finishToken(types$1.braceR);
    case 58:
      ++this.pos;
      return this.finishToken(types$1.colon);
    case 96:
      if (this.options.ecmaVersion < 6) {
        break;
      }
      ++this.pos;
      return this.finishToken(types$1.backQuote);
    case 48:
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === 120 || next === 88) {
        return this.readRadixNumber(16);
      }
      if (this.options.ecmaVersion >= 6) {
        if (next === 111 || next === 79) {
          return this.readRadixNumber(8);
        }
        if (next === 98 || next === 66) {
          return this.readRadixNumber(2);
        }
      }
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57:
      return this.readNumber(false);
    case 34:
    case 39:
      return this.readString(code);
    case 47:
      return this.readToken_slash();
    case 37:
    case 42:
      return this.readToken_mult_modulo_exp(code);
    case 124:
    case 38:
      return this.readToken_pipe_amp(code);
    case 94:
      return this.readToken_caret();
    case 43:
    case 45:
      return this.readToken_plus_min(code);
    case 60:
    case 62:
      return this.readToken_lt_gt(code);
    case 61:
    case 33:
      return this.readToken_eq_excl(code);
    case 63:
      return this.readToken_question();
    case 126:
      return this.finishOp(types$1.prefix, 1);
    case 35:
      return this.readToken_numberSign();
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.finishOp = function(type, size) {
  var str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str);
};
pp.readRegexp = function() {
  var escaped, inClass, start = this.pos;
  for (;; ) {
    if (this.pos >= this.input.length) {
      this.raise(start, "Unterminated regular expression");
    }
    var ch = this.input.charAt(this.pos);
    if (lineBreak.test(ch)) {
      this.raise(start, "Unterminated regular expression");
    }
    if (!escaped) {
      if (ch === "[") {
        inClass = true;
      } else if (ch === "]" && inClass) {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        break;
      }
      escaped = ch === "\\";
    } else {
      escaped = false;
    }
    ++this.pos;
  }
  var pattern = this.input.slice(start, this.pos);
  ++this.pos;
  var flagsStart = this.pos;
  var flags = this.readWord1();
  if (this.containsEsc) {
    this.unexpected(flagsStart);
  }
  var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);
  var value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {}
  return this.finishToken(types$1.regexp, { pattern, flags, value });
};
pp.readInt = function(radix, len, maybeLegacyOctalNumericLiteral) {
  var allowSeparators = this.options.ecmaVersion >= 12 && len === undefined;
  var isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && this.input.charCodeAt(this.pos) === 48;
  var start = this.pos, total = 0, lastCode = 0;
  for (var i = 0, e = len == null ? Infinity : len;i < e; ++i, ++this.pos) {
    var code = this.input.charCodeAt(this.pos), val = undefined;
    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals");
      }
      if (lastCode === 95) {
        this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore");
      }
      if (i === 0) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits");
      }
      lastCode = code;
      continue;
    }
    if (code >= 97) {
      val = code - 97 + 10;
    } else if (code >= 65) {
      val = code - 65 + 10;
    } else if (code >= 48 && code <= 57) {
      val = code - 48;
    } else {
      val = Infinity;
    }
    if (val >= radix) {
      break;
    }
    lastCode = code;
    total = total * radix + val;
  }
  if (allowSeparators && lastCode === 95) {
    this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits");
  }
  if (this.pos === start || len != null && this.pos - start !== len) {
    return null;
  }
  return total;
};
function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8);
  }
  return parseFloat(str.replace(/_/g, ""));
}
function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null;
  }
  return BigInt(str.replace(/_/g, ""));
}
pp.readRadixNumber = function(radix) {
  var start = this.pos;
  this.pos += 2;
  var val = this.readInt(radix);
  if (val == null) {
    this.raise(this.start + 2, "Expected number in radix " + radix);
  }
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  return this.finishToken(types$1.num, val);
};
pp.readNumber = function(startsWithDot) {
  var start = this.pos;
  if (!startsWithDot && this.readInt(10, undefined, true) === null) {
    this.raise(start, "Invalid number");
  }
  var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) {
    this.raise(start, "Invalid number");
  }
  var next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    var val$1 = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if (isIdentifierStart(this.fullCharCodeAtPos())) {
      this.raise(this.pos, "Identifier directly after number");
    }
    return this.finishToken(types$1.num, val$1);
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) {
    octal = false;
  }
  if (next === 46 && !octal) {
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) {
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) {
      ++this.pos;
    }
    if (this.readInt(10) === null) {
      this.raise(start, "Invalid number");
    }
  }
  if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  var val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(types$1.num, val);
};
pp.readCodePoint = function() {
  var ch = this.input.charCodeAt(this.pos), code;
  if (ch === 123) {
    if (this.options.ecmaVersion < 6) {
      this.unexpected();
    }
    var codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 1114111) {
      this.invalidStringToken(codePos, "Code point out of bounds");
    }
  } else {
    code = this.readHexChar(4);
  }
  return code;
};
pp.readString = function(quote) {
  var out = "", chunkStart = ++this.pos;
  for (;; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated string constant");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === quote) {
      break;
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else if (ch === 8232 || ch === 8233) {
      if (this.options.ecmaVersion < 10) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
      if (this.options.locations) {
        this.curLine++;
        this.lineStart = this.pos;
      }
    } else {
      if (isNewLine(ch)) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(types$1.string, out);
};
var INVALID_TEMPLATE_ESCAPE_ERROR = {};
pp.tryReadTemplateToken = function() {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err;
    }
  }
  this.inTemplateElement = false;
};
pp.invalidStringToken = function(position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR;
  } else {
    this.raise(position, message);
  }
};
pp.readTmplToken = function() {
  var out = "", chunkStart = this.pos;
  for (;; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated template");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) {
      if (this.pos === this.start && (this.type === types$1.template || this.type === types$1.invalidTemplate)) {
        if (ch === 36) {
          this.pos += 2;
          return this.finishToken(types$1.dollarBraceL);
        } else {
          ++this.pos;
          return this.finishToken(types$1.backQuote);
        }
      }
      out += this.input.slice(chunkStart, this.pos);
      return this.finishToken(types$1.template, out);
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(true);
      chunkStart = this.pos;
    } else if (isNewLine(ch)) {
      out += this.input.slice(chunkStart, this.pos);
      ++this.pos;
      switch (ch) {
        case 13:
          if (this.input.charCodeAt(this.pos) === 10) {
            ++this.pos;
          }
        case 10:
          out += `
`;
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      chunkStart = this.pos;
    } else {
      ++this.pos;
    }
  }
};
pp.readInvalidTemplateToken = function() {
  for (;this.pos < this.input.length; this.pos++) {
    switch (this.input[this.pos]) {
      case "\\":
        ++this.pos;
        break;
      case "$":
        if (this.input[this.pos + 1] !== "{") {
          break;
        }
      case "`":
        return this.finishToken(types$1.invalidTemplate, this.input.slice(this.start, this.pos));
      case "\r":
        if (this.input[this.pos + 1] === `
`) {
          ++this.pos;
        }
      case `
`:
      case "\u2028":
      case "\u2029":
        ++this.curLine;
        this.lineStart = this.pos + 1;
        break;
    }
  }
  this.raise(this.start, "Unterminated template");
};
pp.readEscapedChar = function(inTemplate) {
  var ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
    case 110:
      return `
`;
    case 114:
      return "\r";
    case 120:
      return String.fromCharCode(this.readHexChar(2));
    case 117:
      return codePointToString(this.readCodePoint());
    case 116:
      return "\t";
    case 98:
      return "\b";
    case 118:
      return "\v";
    case 102:
      return "\f";
    case 13:
      if (this.input.charCodeAt(this.pos) === 10) {
        ++this.pos;
      }
    case 10:
      if (this.options.locations) {
        this.lineStart = this.pos;
        ++this.curLine;
      }
      return "";
    case 56:
    case 57:
      if (this.strict) {
        this.invalidStringToken(this.pos - 1, "Invalid escape sequence");
      }
      if (inTemplate) {
        var codePos = this.pos - 1;
        this.invalidStringToken(codePos, "Invalid escape sequence in template string");
      }
    default:
      if (ch >= 48 && ch <= 55) {
        var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
        var octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        this.pos += octalStr.length - 1;
        ch = this.input.charCodeAt(this.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
          this.invalidStringToken(this.pos - 1 - octalStr.length, inTemplate ? "Octal literal in template string" : "Octal literal in strict mode");
        }
        return String.fromCharCode(octal);
      }
      if (isNewLine(ch)) {
        if (this.options.locations) {
          this.lineStart = this.pos;
          ++this.curLine;
        }
        return "";
      }
      return String.fromCharCode(ch);
  }
};
pp.readHexChar = function(len) {
  var codePos = this.pos;
  var n = this.readInt(16, len);
  if (n === null) {
    this.invalidStringToken(codePos, "Bad character escape sequence");
  }
  return n;
};
pp.readWord1 = function() {
  this.containsEsc = false;
  var word = "", first = true, chunkStart = this.pos;
  var astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    var ch = this.fullCharCodeAtPos();
    if (isIdentifierChar(ch, astral)) {
      this.pos += ch <= 65535 ? 1 : 2;
    } else if (ch === 92) {
      this.containsEsc = true;
      word += this.input.slice(chunkStart, this.pos);
      var escStart = this.pos;
      if (this.input.charCodeAt(++this.pos) !== 117) {
        this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX");
      }
      ++this.pos;
      var esc = this.readCodePoint();
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral)) {
        this.invalidStringToken(escStart, "Invalid Unicode escape");
      }
      word += codePointToString(esc);
      chunkStart = this.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos);
};
pp.readWord = function() {
  var word = this.readWord1();
  var type = types$1.name;
  if (this.keywords.test(word)) {
    type = keywords[word];
  }
  return this.finishToken(type, word);
};
var version2 = "8.19.0";
Parser.acorn = {
  Parser,
  version: version2,
  defaultOptions,
  Position,
  SourceLocation,
  getLineInfo,
  Node,
  TokenType,
  tokTypes: types$1,
  keywordTypes: keywords,
  TokContext,
  tokContexts: types,
  isIdentifierChar,
  isIdentifierStart,
  Token,
  isNewLine,
  lineBreak,
  lineBreakG,
  nonASCIIwhitespace
};
function parse4(input, options) {
  return Parser.parse(input, options);
}

// src/hooks/agent-guard-workflows.ts
import { existsSync as existsSync8, readdirSync as readdirSync4, readFileSync as readFileSync12, statSync as statSync8 } from "fs";
import { dirname as dirname8, isAbsolute as isAbsolute2, join as join13, resolve as resolve5, sep as sep3 } from "path";

// src/setup/installed-plugins.ts
import { existsSync as existsSync7, readFileSync as readFileSync11 } from "fs";
function pluginsRecord(installedPluginsFile) {
  if (!existsSync7(installedPluginsFile))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync11(installedPluginsFile, "utf8"));
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
  if (cwd === "" && !isAbsolute2(path)) {
    return {
      unreadable: `The workflow script \`${path}\` is a relative path, and the hook input names no folder it is relative to.`
    };
  }
  const file = resolve5(cwd, path);
  let size;
  try {
    const stat = statSync8(file);
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
    return { file, script: normalized(readFileSync12(file, "utf8")) };
  } catch {
    return { unreadable: `The workflow script \`${file}\` cannot be read.` };
  }
}
function workflowFiles(folder) {
  let names;
  try {
    names = readdirSync4(folder).filter((name) => name.endsWith(".js"));
  } catch {
    return [];
  }
  return names.sort().map((name) => join13(folder, name));
}
function claiming(files, name) {
  const found = [];
  for (const file of files) {
    try {
      const stat = statSync8(file);
      if (!stat.isFile() || stat.size > WORKFLOW_SCRIPT_MAX_BYTES)
        continue;
      const script = normalized(readFileSync12(file, "utf8"));
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
    folders.push(join13(at, ".claude", "workflows"));
    if (existsSync8(join13(at, ".git")))
      break;
    const up = dirname8(at);
    if (up === at)
      break;
    at = up;
  }
  folders.push(join13(place.claudeConfigDir, "workflows"));
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
  return path === root || path.startsWith(root.endsWith(sep3) ? root : `${root}${sep3}`);
}
function pluginFolder(plugin, place) {
  if (plugin === PLUGIN && place.pluginRoot !== null)
    return place.pluginRoot;
  const installs = installsOfPlugin(place.installedPluginsFile, plugin);
  const project = installs.filter((one) => one.scope !== "user" && one.projectPath !== null && place.cwd !== "" && within(place.cwd, one.projectPath)).sort((a, b) => b.projectPath.length - a.projectPath.length);
  const user = installs.filter((one) => one.scope === "user");
  return [...project, ...user].find((one) => existsSync8(one.installPath))?.installPath ?? null;
}
function pluginWorkflowFiles(root) {
  let listed;
  try {
    const manifest = JSON.parse(readFileSync12(join13(root, ".claude-plugin", "plugin.json"), "utf8"));
    listed = manifest?.workflows ?? manifest?.experimental?.workflows;
  } catch {
    listed = undefined;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : null;
  if (paths === null)
    return workflowFiles(join13(root, "workflows"));
  return paths.filter((one) => typeof one === "string").flatMap((one) => {
    const path = resolve5(root, one);
    try {
      if (statSync8(path).isDirectory())
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

// src/hooks/workflow-script.ts
var SCRIPT_FUNCTIONS = ["agent", "workflow"];
var scriptParser = null;
var lastRead = null;
function useScriptParser(parser) {
  scriptParser = parser;
  lastRead = null;
}
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

// src/hooks/script-parser.ts
function loadScriptParser() {
  useScriptParser(parse4);
}

// src/hooks/after-merge.ts
import { createHash as createHash3 } from "crypto";
import { existsSync as existsSync9, mkdirSync as mkdirSync8, writeFileSync as writeFileSync3 } from "fs";
import { tmpdir } from "os";
import { join as join17 } from "path";

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
import { dirname as dirname9, join as join15 } from "path";
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
  mkdirSync7(dirname9(file), { recursive: true, mode: 448 });
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
import { isAbsolute as isAbsolute3, resolve as resolve6 } from "path";
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
  if (isAbsolute3(path))
    return resolve6(path);
  return folder === null ? null : resolve6(folder, path);
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
    const where = folder === null ? null : resolve6(folder, ...call.dirs);
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
  const message = `${base} now has #${pr.number} (${quotableTitle(pr.title)}). At your next stop, once your current work is committed: ` + `git fetch origin ${base}, then git merge origin/${base}, and fix any conflict. ` + `Never commit unfinished work just to take the merge. After the merge, run the install your project uses if the merge changed a lock file. Run the tests the merge touched. ` + `${caution === null ? "" : `${caution} `}No reply needed.`;
  return [
    `That merged #${pr.number} into ${base}.`,
    "Tell the person's other sessions in this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo that is not this session and not a subagent, with exactly this text:",
    `"${message}"`,
    "Merged several pull requests this turn? Send each session one message, naming every merged number."
  ].join(`
`);
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
function announcedFile(repo, number, env) {
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
  const record = pr === null ? null : announcedFile(repo, pr.number, env);
  const outcome = mergeOutcome({
    announced: record !== null && existsSync9(record),
    base,
    failed: event === "PostToolUseFailure",
    now: Date.now(),
    pr,
    sameRepo: pr !== null && origin.ok && sameRepository(pr.url, origin.out),
    target,
    worktree
  });
  const notes = [];
  if (outcome.clear !== null) {
    notes.push(clearWorktreeNote(outcome.clear.path, outcome.clear.branch));
  }
  if (outcome.announce !== null && record !== null) {
    notes.push(tellSessionsNote(outcome.announce, base, project.config?.worktrees?.bases ?? {}));
    mkdirSync8(join17(record, ".."), { recursive: true });
    writeFileSync3(record, "");
  }
  if (outcome.announce !== null)
    startAutoClean(context, repo, "merge");
  return notes.length === 0 ? SILENT : addContext(event, notes.join(`

`));
}

// src/gateway/config.ts
import { mkdirSync as mkdirSync9, readFileSync as readFileSync14, statSync as statSync9 } from "fs";

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
var CLAUDE_FAMILIES = ["fable", "haiku", "opus", "sonnet"];
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
    mode = statSync9(path).mode;
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
import { existsSync as existsSync11, readFileSync as readFileSync16 } from "fs";

// src/setup/managed-json.ts
import { existsSync as existsSync10, readFileSync as readFileSync15 } from "fs";
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectIndent(text) {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
function readJsonObject(file) {
  if (!existsSync10(file))
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
var GATEWAY_ENV_KEYS = Object.keys(gatewayEnv(20100));
var GATEWAY_ENV_KEYS_ALL = [...GATEWAY_ENV_KEYS, ...RETIRED_GATEWAY_ENV_KEYS];
var SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];
var LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSettings(path) {
  if (!existsSync11(path))
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
  readdirSync as readdirSync5,
  readFileSync as readFileSync17,
  readSync as readSync2,
  realpathSync as realpathSync5,
  statSync as statSync10
} from "fs";
import { dirname as dirname10, isAbsolute as isAbsolute4, join as join18, relative as relative2, resolve as resolve7, sep as sep4 } from "path";
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
  const found = readable(() => ({ real: realpathSync5(path), stat: statSync10(path) }));
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
  const entries = readable(() => readdirSync5(path).sort()) ?? [];
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
function claiming2(paths, name, local = true) {
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
  const path = relative2(resolve7(project), resolve7(checkout));
  return path === "" || path !== ".." && !path.startsWith(`..${sep4}`) && !isAbsolute4(path);
}
function topFiles(folder, budget) {
  const entries = readable(() => readdirSync5(folder).sort()) ?? [];
  return entries.flatMap((entry) => {
    budget.entries += 1;
    if (budget.entries > AGENT_SCAN_MAX_ENTRIES)
      throw new ScanTooLarge;
    const file = join18(folder, entry);
    return file.endsWith(".md") && readable(() => statSync10(file).isFile()) === true ? [file] : [];
  });
}
function pluginFiles(root, budget) {
  const defaults = topFiles(join18(root, "agents"), budget);
  let listed;
  try {
    listed = JSON.parse(readFileSync17(join18(root, ".claude-plugin", "plugin.json"), "utf8"))?.agents;
  } catch {
    return defaults;
  }
  const paths = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : [];
  if (listed === undefined)
    return defaults;
  return paths.flatMap((path) => {
    if (typeof path !== "string" || !path.startsWith("./"))
      return [];
    const file = resolve7(root, path);
    if (!inside(file, root))
      return [];
    try {
      return statSync10(file).isFile() && file.endsWith(".md") ? [file] : [];
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
    const up = dirname10(at);
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
      const found = claiming2(files(folder, budget), name);
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
    return root === undefined ? null : claiming2(pluginFiles(root, budget), name.slice(colon + 1), false);
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
function answeringFamily(real) {
  if (!real.claude)
    return null;
  return claudeFamily(real.model) ?? CLAUDE_FAMILIES.find((one) => one === real.model.toLowerCase()) ?? null;
}
function asNamed(answered, family, tier) {
  const real = premiumTier(answered.family);
  return tier === null && real !== null ? { ...answered, tier: real } : { ...answered, family, tier };
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
    if (mapped === null)
      return resolved;
    return { ...resolved, family: mapped, tier: mapped };
  }
  const tier = premiumTier(family);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) {
    return asNamed(resolveName(withoutContextSuffix(override.trim()), gateway), family, tier);
  }
  return throughFamilySlot(text, family, gateway);
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

// src/hooks/agent-launches.ts
import {
  appendFileSync as appendFileSync4,
  closeSync as closeSync5,
  fstatSync as fstatSync2,
  mkdirSync as mkdirSync10,
  openSync as openSync5,
  readFileSync as readFileSync18,
  readSync as readSync3
} from "fs";
import { dirname as dirname11, join as join19 } from "path";
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
  return join19(stateDir, "agent-launches.jsonl");
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

// src/hooks/agent-guard.ts
var AGENT_TOOLS = ["Agent", "Task"];
var WORKFLOW_TOOLS = ["Workflow"];
var PRINT_RUN = "claude -p";
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
  const real = ran.modelFrom === "fork" || ran.modelFrom === "force-session" ? sessionLaunchModel(ran.model, ctx, env) : resolveLaunchModel(ran.model ?? "", ctx, env);
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
import { readFileSync as readFileSync19 } from "fs";
import { join as join20 } from "path";

// src/gateway/prices.ts
var CLAUDE_PRICES = [
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
  return join20(stateDir, AGENT_USAGE_FILE);
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
    text = readFileSync19(transcript, "utf8");
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
import { existsSync as existsSync14 } from "fs";

// src/tasks/work/db.ts
import { Database } from "bun:sqlite";
import { chmodSync as chmodSync2, existsSync as existsSync13, mkdirSync as mkdirSync11 } from "fs";
import { dirname as dirname12, join as join21 } from "path";
var WORK_SCHEMA_VERSION = 3;
var WRITE_TIMEOUT_MS = 3000;
var HOOK_TIMEOUT_MS = 200;
var NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
function workDbFile(paths) {
  return join21(paths.stateDir, "tasks", "work.db");
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
   ALTER TABLE tasks ADD COLUMN base TEXT;`
];
function openWorkDb(file, options) {
  const hook = options.mode === "hook";
  const fresh = !existsSync13(file);
  if (hook && fresh)
    throw new Error("task store does not exist");
  if (!hook)
    mkdirSync11(dirname12(file), { recursive: true, mode: 448 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
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

// src/worktrees/machine-facts.ts
import { readdirSync as readdirSync6, readFileSync as readFileSync20, readlinkSync as readlinkSync3 } from "fs";
import { platform } from "os";
var PROGRAMS_TIMEOUT_MS = 15000;
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

// src/tasks/work/read.ts
function readWorkStore(paths, body) {
  let db;
  try {
    const file = workDbFile(paths);
    if (!existsSync14(file))
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

// src/workflow/resolve.ts
import { existsSync as existsSync15, readFileSync as readFileSync21 } from "fs";

// src/setup/statusline.ts
import { join as join22 } from "path";
function statuslineSetting(paths) {
  return { command: `${shellWord(join22(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
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
  if (!existsSync15(file))
    return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync21(file, "utf8"));
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
function statusLineIsOurs(paths) {
  try {
    const parsed = JSON.parse(readFileSync21(paths.settingsFile, "utf8"));
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
    switches: {
      statusLine: statusLineIsOurs(paths) ? current2(true, "personal") : current2(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: jobRouteFrom(personal, projectConfig),
      updateHold: isHeld(updateFiles(paths.stateDir)) ? current2(true, "personal") : current2(false, "default"),
      leadHint: leadHintFrom(personal)
    }
  };
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
import { existsSync as existsSync17, mkdirSync as mkdirSync13, writeFileSync as writeFileSync5 } from "fs";
import { dirname as dirname13, join as join24 } from "path";

// src/hooks/session-name.ts
import { existsSync as existsSync16, mkdirSync as mkdirSync12, readFileSync as readFileSync22, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "fs";
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
    return existsSync16(file) ? cleanSessionName(readFileSync22(file, "utf8")) : null;
  } catch {
    return null;
  }
}
function writeAtomic(file, text) {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync4(partial, text);
  renameSync2(partial, file);
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
    rmSync2(reminded, { force: true });
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
    return family === null ? real.model : `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)}`;
  }
  const tier = real.tier ?? real.family;
  return tier === null ? real.model : `the \`${tier}\` model, ${real.model}`;
}
function sessionMark(env, sessionId, kind) {
  return join24(namesDir(env), `${sessionId}.${kind}`);
}
function judgedMark(env, sessionId, model) {
  const hash = createHash4("sha256").update(model).digest("hex").slice(0, 16);
  return join24(namesDir(env), `${sessionId}.judged-${hash}`);
}
function firstTime(mark) {
  try {
    mkdirSync13(dirname13(mark), { recursive: true });
    writeFileSync5(mark, "", { flag: "wx" });
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
  if (event === "SessionStart")
    return stringField(input.model);
  if (event === "PostModelSwitch")
    return stringField(input.to_model);
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
  const model = currentModel(event, input, env);
  if (model === null)
    return SILENT;
  const judged = judgedMark(env, sessionId, model);
  if (existsSync17(judged))
    return SILENT;
  const real = resolveLaunchModel(model, sessionGatewayOf(paths, env), env);
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
import { readFileSync as readFileSync23 } from "fs";
import { join as join26 } from "path";
function packageScripts(folder) {
  let text;
  try {
    text = readFileSync23(join26(folder, "package.json"), "utf8");
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
  return { launches, proposals, steps, workflowPropose };
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
function judgeBash(reading, context) {
  let ask = null;
  if (reading.proposals.length > 0) {
    const proposed = judgeProposals(reading.proposals, context);
    if (proposed?.decision === "deny")
      return proposed;
    ask = proposed;
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
  return reading.launches.length > 0 || reading.workflowPropose;
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
  const ready = own.filter((t) => t.status === "pending" && busy.has(t.plan) && !isBlocked(t, byId));
  return { state: "ready", value: { inProgress: inProgress.map(refOf), ready: ready.map(refOf) } };
}

// src/hooks/message-guard.ts
var SEND_MESSAGE_TOOL = "SendMessage";
function withoutListRef(name) {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}
function messageLeavesRepo(to, sessions, repoFolders) {
  const name = withoutListRef(to);
  const named = sessions.filter((session) => session.name === name);
  const outside = named.filter((session) => !repoFolders.some((folder) => isInside(realPath(session.cwd), folder)));
  return named.length > 0 && outside.length === named.length ? outside[0]?.cwd ?? null : null;
}
function otherRepoFolder(to, repo, env, claudeConfigDir) {
  let sessions;
  try {
    sessions = liveSessions(claudeConfigDir);
  } catch {
    return null;
  }
  const name = withoutListRef(to);
  if (!sessions.some((session) => session.name === name))
    return null;
  const folders = listWorktrees(realPath(repo), env, GUARD_GIT_TIMEOUT_MS).map((worktree) => realPath(worktree.path));
  return messageLeavesRepo(to, sessions, folders);
}
function otherRepoQuestion(to, folder) {
  return [
    `"${to}" works in ${folder}, outside this repo. Send this message to a session of another repo?`,
    "ListAgents lists every Claude session on the machine, other projects too."
  ].join(`
`);
}
function otherRepoAnswer(input, env, repo, claudeConfigDir, configProblem) {
  const to = stringField(toolInput(input).to);
  if (to === null)
    return SILENT;
  const folder = otherRepoFolder(to, repo, env, claudeConfigDir);
  if (folder === null)
    return SILENT;
  const question = otherRepoQuestion(to, folder);
  return toolDecision("ask", configProblem === null ? question : `${question}
The project's settings file cannot be used, and this rule reads nothing from it: ${configProblem}`);
}
function messageGuardConfigProblem(configProblem, input, env, repo, claudeConfigDir) {
  return otherRepoAnswer(input, env, repo, claudeConfigDir, configProblem);
}
function messageGuard(context) {
  const { project, input, env, paths } = context;
  if (project.config === null)
    return SILENT;
  const repo = project.mainCheckout ?? project.root;
  return otherRepoAnswer(input, env, repo, paths.claudeConfigDir, null);
}

// src/hooks/keep-going.ts
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
import { mkdtempSync, rmSync as rmSync3 } from "fs";
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
      rmSync3(objects, { recursive: true, force: true });
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
import { readFileSync as readFileSync24 } from "fs";
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
    text = readFileSync24(transcript, "utf8");
  } catch {
    return SILENT;
  }
  return startedByAgent(text, ids) ? { stdout: JSON.stringify({ decision: "block", reason: HAND_BACK_REASON }) } : SILENT;
}

// src/mcp/records.ts
import { existsSync as existsSync19, readFileSync as readFileSync25 } from "fs";
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
  const parsed = JSON.parse(readFileSync25(file, "utf8"));
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
import { existsSync as existsSync21, mkdirSync as mkdirSync14, readFileSync as readFileSync29, rmSync as rmSync4, writeFileSync as writeFileSync6 } from "fs";
import { dirname as dirname16, join as join31 } from "path";

// src/cli/usage-window.ts
import { existsSync as existsSync20, readFileSync as readFileSync26 } from "fs";
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
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync26(file, "utf8")));
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
import { readFileSync as readFileSync27 } from "fs";
function checksDownNow(statePath, nowMs) {
  try {
    const state = parseLimitState(readFileSync27(statePath, "utf8"));
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
import { readFileSync as readFileSync28, statSync as statSync11 } from "fs";
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
    const line = readFileSync28(entry, "utf8").split(`
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
function capitalised(family) {
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}`;
}
function modelName(real) {
  if (!real.claude)
    return `${real.model} (a backend)`;
  const family = answeringFamily(real);
  return family === null ? real.model : `Claude ${capitalised(family)}`;
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
    return readFileSync29(mark, "utf8");
  } catch {
    return null;
  }
}
function keep(mark, note) {
  try {
    mkdirSync14(dirname16(mark), { recursive: true });
    writeFileSync6(mark, note);
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
    rmSync4(usageMark(env, sessionId), { force: true });
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
import { existsSync as existsSync22, readFileSync as readFileSync31, statSync as statSync12 } from "fs";
import { basename as basename7, isAbsolute as isAbsolute10, join as join34, resolve as resolve13 } from "path";

// src/hooks/local-files.ts
import { lstatSync as lstatSync2, readdirSync as readdirSync7, readFileSync as readFileSync30, readlinkSync as readlinkSync4 } from "fs";
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
      return a.isFile() && b.isFile() && a.size === b.size && readFileSync30(here).equals(readFileSync30(there));
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
function idleMinutesOrNull(worktree, now) {
  let admin;
  try {
    admin = readFileSync31(join34(worktree, ".git"), "utf8").trim().replace(/^gitdir:\s*/, "");
  } catch {
    return null;
  }
  if (!isAbsolute10(admin))
    admin = resolve13(worktree, admin);
  let last = 0;
  for (const file of ["index", "HEAD", join34("logs", "HEAD")]) {
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
var messageGuardHook = {
  name: "message-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input, _event, checkout, { env, paths }) => messageGuardConfigProblem(message, input, env, checkout.mainCheckout ?? checkout.root, paths.claudeConfigDir),
  onCrash: guardCrash("whether this message may go to that session", (input) => toolOf2(input) === SEND_MESSAGE_TOOL),
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
  messageGuardHook,
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

// src/entries/agent-guard.ts
loadScriptParser();
await runHookEntry(agentGuardHook);
