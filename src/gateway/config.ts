/**
 * The AI gateway's config file: `~/.config/anymodel/gateway.json`, one per machine.
 *
 * It holds the cheap backends' API keys, so only its owner may read it: a file whose mode
 * lets the group or others read it is refused, never loaded. No Claude credential is ever
 * in it: Claude requests carry the person's own login.
 *
 * The router reads it again when the file changes, so `anymodel gateway slot` switches
 * a slot live. A bad edit keeps the last good config, with one error line.
 *
 * Every function takes the file's path, so the tests run against a temp folder.
 * The design: docs/gateway.md.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
// From ./names, not the index: the index bakes in the version, and the router bundle
// must not change with it (a changed bundle restarts every machine's router).
import { COMMAND } from "../build-info/names";
import { atomicWrite } from "../setup/write";
import {
  isBackendName,
  isSlotKey,
  JUDGE_SLOT,
  MODEL_SLOTS,
  parseTarget,
  withoutContextSuffix,
} from "./targets";

export const DEFAULT_PORT = 20100;
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_FIRST_BYTE_MS = 60_000;

/** What both slots answer on while there is no good config file. */
const FALLBACK_SLOT_TARGET = "claude-sonnet-5-5";

/** The log's words for running on `emptyConfig()`. */
const NO_CONFIG_MEANS = `every haiku / sonnet call answers on ${FALLBACK_SLOT_TARGET} (your own Claude login) until it is fixed`;

/** An http(s) URL, without the trailing slash, so `base + "/v1/messages"` is clean. */
const baseUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ""));

// Loose objects (the top level, each backend, `timeouts`): a field this version does not
// know, written by a newer version or by hand, is kept when a command saves the file.
const backendSchema = z.looseObject({
  apiKey: z.string().min(1),
  baseUrl,
});

export const gatewayConfigSchema = z
  .looseObject({
    /**
     * Old model names and what they mean now: `{"<old name>": "<slot or target>"}`. The
     * router resolves an alias before it routes. The plugin ships none; a project's own
     * migration writes them, so a machine's old names keep working while it moves.
     */
    aliases: z.record(z.string(), z.string()).default({}),
    // Only Anthropic: Claude requests carry the person's own login, so no config edit may
    // point them anywhere else. (Tests inject a fake through the router.)
    anthropicBaseUrl: z.literal(DEFAULT_ANTHROPIC_BASE_URL).default(DEFAULT_ANTHROPIC_BASE_URL),
    backends: z.record(z.string().refine(isBackendName, "not a backend name"), backendSchema),
    /**
     * The judge targets that passed the judge test: `{"<target>": "<proof>"}`, written only
     * by `gateway slot judge` after the test (`judgeTestProof`). The router uses a judge
     * target only when its proof matches; a target without one is ignored, with a WARN.
     */
    judgeTested: z.record(z.string(), z.string()).optional(),
    /**
     * Claude model ids that have a model slot: `{"claude-opus-5-5": "anymodel-opus"}`.
     * Absent (the default): every `claude-…` request goes to Anthropic byte for byte. With
     * an entry, that model's requests go to the slot, whose first target is the model
     * itself; the next target answers only at the plan's usage limit (`targets.ts`).
     * `gateway slot opus|fable` writes it.
     */
    modelSlots: z.record(z.string(), z.string()).optional(),
    port: z.int().min(1).max(65_535).default(DEFAULT_PORT),
    slots: z.record(
      z.string().refine(isSlotKey, "a slot key is anymodel-<name>"),
      z.array(z.string()).min(1),
    ),
    timeouts: z
      .looseObject({ firstByteMs: z.int().positive().default(DEFAULT_FIRST_BYTE_MS) })
      .default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
    version: z.literal(1),
  })
  .superRefine((config, ctx) => {
    for (const [slot, targets] of Object.entries(config.slots)) {
      targets.forEach((text, index) => {
        const parsed = parseTarget(text);
        if ("error" in parsed) {
          ctx.addIssue({ code: "custom", message: parsed.error, path: ["slots", slot, index] });
        } else if (slot === JUDGE_SLOT && parsed.target.kind === "anthropic") {
          // The check's body is built for the model it names: Claude Sonnet 5.5 answers
          // 400 to its `thinking: disabled`, and auto mode would approve nothing.
          ctx.addIssue({
            code: "custom",
            message: `${JUDGE_SLOT} takes no claude-… target; use "${COMMAND} gateway slot judge off" to put the checks on Claude`,
            path: ["slots", slot, index],
          });
        } else if (
          parsed.target.kind === "backend" &&
          !Object.hasOwn(config.backends, parsed.target.backend)
        ) {
          ctx.addIssue({
            code: "custom",
            message: `"${text}" names backend "${parsed.target.backend}", which is not in backends`,
            path: ["slots", slot, index],
          });
        }
      });
    }
    for (const [name, to] of Object.entries(config.aliases)) {
      const error = aliasError(name, to, config);
      if (error !== null) ctx.addIssue({ code: "custom", message: error, path: ["aliases", name] });
    }
    for (const [model, slot] of Object.entries(config.modelSlots ?? {})) {
      const error = modelSlotError(model, slot, config.slots);
      if (error !== null) {
        ctx.addIssue({ code: "custom", message: error, path: ["modelSlots", model] });
      }
    }
  });

/**
 * Why a `modelSlots` entry cannot be used, or null when it can. The key is the Claude id
 * Claude Code sends (without `[1m]`); the slot is a model slot (`anymodel-opus`,
 * `anymodel-fable`) whose FIRST target is that same id, so a request that is not at its
 * limit still reaches Anthropic byte for byte; and the slot has a target after it.
 */
export function modelSlotError(
  model: string,
  slot: string,
  slots: Readonly<Record<string, readonly string[]>>,
): null | string {
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
  if (!model.includes(`-${family}-`)) {
    return `modelSlots "${model}" points at ${slot}, which is for ${family} models`;
  }
  const targets = Object.hasOwn(slots, slot) ? slots[slot] : undefined;
  if (targets === undefined)
    return `modelSlots "${model}" points at slot "${slot}", which is not in slots`;
  if (targets[0] !== model) {
    return `slot ${slot} must start with "${model}" itself: that target is the model, sent unchanged`;
  }
  if (targets.length < 2) {
    return `slot ${slot} names no target after "${model}" to answer at its usage limit`;
  }
  return null;
}

/**
 * Why an alias cannot be used, or null when it can. An alias names a slot or a target,
 * never another alias: so the router resolves each name in one step, and a loop
 * (`a` → `b` → `a`, or `a` → `a`) cannot exist.
 */
function aliasError(
  name: string,
  to: string,
  config: { aliases: Record<string, string>; backends: Record<string, unknown>; slots: object },
): null | string {
  if (name.trim() === "" || /\s/.test(name)) return `alias "${name}" is not a model name`;
  if (withoutContextSuffix(name) !== name) {
    return `alias "${name}": write it without [1m]; the router looks names up without it`;
  }
  // A claude-… request goes to Anthropic untouched, on the own login: no alias moves it.
  if (name.startsWith("claude-")) return `alias "${name}": a claude-… name cannot be an alias`;
  if (Object.hasOwn(config.slots, name)) {
    return `alias "${name}" has the name of a slot; a slot cannot be an alias too`;
  }
  if (Object.hasOwn(config.aliases, to)) {
    return `alias "${name}" points at "${to}", which is an alias too; point it at a slot or a model`;
  }
  if (isSlotKey(to)) {
    return Object.hasOwn(config.slots, to)
      ? null
      : `alias "${name}" points at slot "${to}", which is not in slots`;
  }
  const parsed = parseTarget(to);
  if ("error" in parsed) return `alias "${name}": ${parsed.error}`;
  if (parsed.target.kind === "backend" && !Object.hasOwn(config.backends, parsed.target.backend)) {
    return `alias "${name}" names backend "${parsed.target.backend}", which is not in backends`;
  }
  return null;
}

export type GatewayConfig = z.output<typeof gatewayConfigSchema>;

/**
 * The judge test's version. Raise it when the test changes: every judge target then
 * counts as untested until `gateway slot judge` tests it again.
 */
export const JUDGE_TEST_VERSION = 1;

/**
 * The proof that a judge target passed the judge test, as `gateway slot judge` writes it
 * into `judgeTested`: the first 32 hex characters of the SHA-256 of the test version, the
 * target and its backend's URL. Why in the config, and why a digest: the slot and its proof
 * are saved in one atomic write, so they cannot drift apart; the router already reads that
 * file on each change; and a hand edit that adds a judge target, copies another target's
 * entry, or moves the backend gets no matching proof. It stops a mistake, not a person who
 * means it: anyone who reads this code can compute it.
 */
export function judgeTestProof(target: string, backendUrl: string): string {
  return createHash("sha256")
    .update(`anymodel judge test ${JUDGE_TEST_VERSION}\n${target}\n${backendUrl}`)
    .digest("hex")
    .slice(0, 32);
}

/** Did this judge target pass the judge test, by the config's `judgeTested`? */
export function judgeTargetTested(
  config: Pick<GatewayConfig, "backends" | "judgeTested">,
  target: string,
): boolean {
  const parsed = parseTarget(target);
  if (!("target" in parsed) || parsed.target.kind !== "backend") return false;
  const backend = Object.hasOwn(config.backends, parsed.target.backend)
    ? config.backends[parsed.target.backend]
    : undefined;
  const proof =
    config.judgeTested !== undefined && Object.hasOwn(config.judgeTested, target)
      ? config.judgeTested[target]
      : undefined;
  return (
    backend !== undefined &&
    proof !== undefined &&
    proof === judgeTestProof(target, backend.baseUrl)
  );
}

/** The words of a caught error, whatever was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A config file that cannot be used, with the reason in words. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Check a parsed value against the schema; the reason in words when it fails. */
export function parseConfig(raw: unknown): { config: GatewayConfig } | { error: string } {
  const result = gatewayConfigSchema.safeParse(raw);
  return result.success ? { config: result.data } : { error: z.prettifyError(result.error) };
}

/**
 * Read and check the config file. Throws a ConfigError when the file is missing, readable
 * by the group or others, not JSON, or not a valid config. The error never quotes the
 * file's text: it holds API keys.
 */
export function loadConfigFile(path: string): GatewayConfig {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if ((mode & 0o077) !== 0) {
    throw new ConfigError(
      `${path} can be read by other users (mode ${(mode & 0o777).toString(8)}); it holds API keys. Run: chmod 600 ${path}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // Not the parser's message: it can quote the text around the mistake, a key included.
    throw new ConfigError(`${path} is not valid JSON. Fix it by hand.`, { cause: error });
  }
  const parsed = parseConfig(raw);
  if ("error" in parsed)
    throw new ConfigError(`${path} is not a valid gateway config:\n${parsed.error}`);
  return parsed.config;
}

/**
 * Save a config: checked first, folder made owner-only, file mode 600, and atomic
 * (`atomicWrite`: a temp file in the same folder, created with mode 600 before any byte
 * is in it, fsynced, then renamed over the old one; a reader never sees half a file).
 * A caller that read the file first saves inside `withLock`, so two commands never
 * overwrite each other's change.
 */
export function saveConfig(path: string, config: GatewayConfig): void {
  const parsed = parseConfig(config);
  if ("error" in parsed)
    throw new ConfigError(`refusing to save an invalid config:\n${parsed.error}`);
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  atomicWrite(path, `${JSON.stringify(parsed.config, null, 2)}\n`, 0o600);
}

/**
 * The config the router runs on while the file is missing or bad at start: no backends,
 * and both slots on Claude Sonnet 5.5 (1M context, like the `[1m]` the slot names
 * announce) on the person's own login. So every haiku / sonnet call still answers, only
 * not cheaply. Better than a service that crash-loops, or a 400 on every subagent, for
 * every Claude Code session on the machine.
 */
export function emptyConfig(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: {},
    port: DEFAULT_PORT,
    slots: {
      "anymodel-scout": [FALLBACK_SLOT_TARGET],
      "anymodel-worker": [FALLBACK_SLOT_TARGET],
    },
    timeouts: { firstByteMs: DEFAULT_FIRST_BYTE_MS },
    version: 1,
  };
}

/** The live config, read again whenever the file changes. */
export interface ConfigSource {
  get(): GatewayConfig;
  /** False while the router runs on `emptyConfig()` because no good file was ever read. */
  loaded(): boolean;
}

/** What `watchConfig` needs from the file system; a test passes its own. */
export interface WatchDeps {
  load: (path: string) => GatewayConfig;
  stat: (path: string) => { ctimeMs: number; mode: number; mtimeMs: number; size: number };
}

const REAL_WATCH_DEPS: WatchDeps = { load: loadConfigFile, stat: statSync };

/**
 * The config, checked against the file's stamp (modification and change time, size,
 * mode) on every `get()`: one `stat` per request, nothing next to an upstream call. (Not
 * `fs.watch`: saving by rename replaces the file, and a watcher on the old one goes
 * quiet.) A changed file is loaded; a bad or missing one keeps the last good config
 * (`emptyConfig()` when there never was one) and logs ONE error until the file changes
 * again.
 */
export function watchConfig(
  path: string,
  log: (line: string) => void,
  deps: WatchDeps = REAL_WATCH_DEPS,
): ConfigSource {
  let current = emptyConfig();
  let good = false;
  let seen: null | string = null;

  const refresh = () => {
    let stamp: string;
    try {
      const stats = deps.stat(path);
      // `mode` and `ctimeMs` too: a `chmod 600` alone changes neither mtime nor size, and
      // must still bring a refused file in.
      stamp = `${stats.mtimeMs}:${stats.size}:${stats.mode}:${stats.ctimeMs}`;
    } catch (error) {
      const gone = `gone:${messageOf(error)}`;
      if (gone !== seen) {
        log(
          `ERROR config ${path} cannot be read (${messageOf(error)}); ${good ? "keeping the last good config" : NO_CONFIG_MEANS}`,
        );
      }
      seen = gone;
      return;
    }
    if (stamp === seen) return;
    seen = stamp;
    try {
      current = deps.load(path);
      if (good) log(`config reloaded from ${path}`);
      good = true;
    } catch (error) {
      log(`ERROR ${messageOf(error)}\n${good ? "keeping the last good config" : NO_CONFIG_MEANS}`);
    }
  };

  refresh();
  return {
    get() {
      refresh();
      return current;
    },
    loaded: () => good,
  };
}
