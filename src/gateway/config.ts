/**
 * The AI gateway's config file: `~/.config/cc-smart-dev-kit/gateway.json`, one per machine.
 *
 * It holds the affordable backends' API keys, so only its owner may read it: a file whose mode
 * lets the group or others read it is refused, never loaded. On Windows the mode says nothing
 * (the numbers there are synthetic) and the profile's ACL is what protects it, so nothing is
 * refused there (`isOwnerOnly`). No Claude credential is ever in it: Claude requests carry the
 * person's own login.
 *
 * The router reads it again when the file changes, so `cc-smart-dev-kit gateway slot` switches
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
import { hostPlatform } from "../machine/host";
import { isOwnerOnly } from "../setup/file-mode";
import { atomicWrite } from "../setup/write";
import {
  claudeFamily,
  FALLBACK_OFF_BY_DEFAULT,
  isBackendName,
  isSlotKey,
  JUDGE_SLOT,
  MODEL_SLOTS,
  parseTarget,
  type Target,
  WORKER_SLOT,
  withoutContextSuffix,
} from "./targets";

export const DEFAULT_PORT = 20100;
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_FIRST_BYTE_MS = 60_000;

/**
 * The longest the breaker holds a request while every target of its slot is limited or down,
 * and the default of `timeouts.breakerHoldMs`. After the hold the router asks Claude Code to
 * retry. Claude Code gives up on a request that gets no answer for too long, so a longer hold
 * risks losing the request; a person can only shorten this one (`0`: no hold).
 */
export const BREAKER_HOLD_CEILING_MS = 240_000;

/**
 * The longest the breaker holds a request that does not stream: Claude Code waits less for a
 * whole answer than for the start of a stream. A constant, not a setting.
 */
export const BREAKER_HOLD_NON_STREAMING_MS = 60_000;

/**
 * Why the judge has no breaker switch. The config's check and `gateway breaker judge …` both
 * say it, so a person reads the same words wherever the judge is refused.
 */
export const JUDGE_NEVER_HOLDS =
  "the judge never holds a request (a held safety check would freeze every action in auto mode), so it has no breaker switch";

/** The log's words for running on `emptyConfig()`. */
const NO_CONFIG_MEANS =
  "every slot is off: each Claude model goes to Anthropic as Claude Code sent it (your own Claude login) until it is fixed";

/** An http(s) URL, without the trailing slash, so `base + "/v1/messages"` is clean. */
const baseUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ""));

// Loose objects (the top level, each backend, `timeouts`): a field this version does not
// know, written by a newer version or by hand, is kept when a command saves the file.
const backendSchema = z.looseObject({
  apiKey: z.string().min(1),
  baseUrl,
});

/**
 * A chain saved for a slot that answers as Claude now: `gateway slot <slot> claude` moves the
 * chain here from `slots`, with the slot's fallback switch when the person had set one;
 * `gateway slot <slot> custom` moves both back. Loose, so a field a newer version adds stays.
 * Only the shape is checked here: a saved chain is not in use, so a target that no longer
 * works (a backend taken out) must not stop the router from loading the file. `custom` checks
 * every target before the chain is used again.
 */
const keptChainSchema = z.looseObject({
  fallback: z.boolean().optional(),
  targets: z.array(z.string().min(1)).min(1),
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
     * The targets that passed the judge test: `{"<target>": "<proof>"}`, written only by
     * `gateway slot judge`, `gateway slot worker` and `gateway setup` after the test
     * (`judgeTestProof`). The router uses a judge target only when its proof matches; a
     * target without one is ignored, with a WARN. Both the judge slot's own chain and the
     * worker chain's targets use it (D44).
     */
    judgeTested: z.record(z.string(), z.string()).optional(),
    /**
     * The chains saved, not in use, by slot: each slot here answers as Claude
     * (`keptChainSchema`). `slots` alone says what is in use, so a router or a CLI of 0.5.x,
     * which does not know this field, reads the file right and writes it back untouched (the
     * top level is a loose object). A switch to Claude never forgets a chain: only
     * `gateway slot <slot> clear` deletes it.
     */
    kept: z
      .record(
        z.string().refine(isSlotKey, "a slot key is cc-smart-dev-kit-<name>"),
        keptChainSchema,
      )
      .optional(),
    /**
     * Each slot's fallback switch, where the person set it: `{"<slot>": true | false}`. On,
     * the next target answers when the one before it fails or rests; off, only the first
     * target ever answers, and the rest stay saved. Absent: the slot's default
     * (`fallbackOn`). `gateway fallback <slot> on|off` writes it.
     */
    fallback: z.record(z.string(), z.boolean()).optional(),
    /**
     * Each slot's breaker switch: may the router hold the slot's requests while every target
     * it uses is limited or down, then ask Claude Code to retry? `{"<slot>": true | false}`.
     * Absent: on for every slot except the judge (`breakerOn`). `gateway breaker <slot>
     * on|off` writes it.
     */
    breaker: z.record(z.string(), z.boolean()).optional(),
    /**
     * 0.4.x only, read and never written again: the Claude ids whose requests a model slot
     * took (`{"claude-opus-5-5": "cc-smart-dev-kit-opus"}`). A request reaches its slot by
     * its family now (`familySlotFor`), and the entry changes nothing: such a chain starts
     * with its fallback switch at the model slots' default, off (`fallbackOn`). Kept so such
     * a config loads; `gateway slot opus|fable` drops the entry.
     */
    modelSlots: z.record(z.string(), z.string()).optional(),
    port: z.int().min(1).max(65_535).default(DEFAULT_PORT),
    slots: z.record(
      z.string().refine(isSlotKey, "a slot key is cc-smart-dev-kit-<name>"),
      z.array(z.string()).min(1),
    ),
    timeouts: z
      .looseObject({
        /**
         * How long the breaker holds a request while every target of its slot is limited or
         * down, in whole milliseconds; 0 holds none. Absent: `BREAKER_HOLD_CEILING_MS`, read
         * through `breakerHoldMs`. Never above that ceiling.
         */
        breakerHoldMs: z
          .int()
          .min(0)
          .max(
            BREAKER_HOLD_CEILING_MS,
            `too long: at most ${BREAKER_HOLD_CEILING_MS} ms (${BREAKER_HOLD_CEILING_MS / 1000} s), because a longer hold risks Claude Code giving up on the request`,
          )
          .optional(),
        firstByteMs: z.int().positive().default(DEFAULT_FIRST_BYTE_MS),
      })
      .default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
    version: z.literal(1),
  })
  .superRefine((config, ctx) => {
    for (const [slot, targets] of Object.entries(config.slots)) {
      targets.forEach((text, index) => {
        const parsed = parseTarget(text);
        if ("error" in parsed) {
          ctx.addIssue({ code: "custom", message: parsed.error, path: ["slots", slot, index] });
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
    for (const slot of Object.keys(config.fallback ?? {})) {
      // The judge's switch needs no judge chain: with none, Claude judges first and the
      // worker's tested targets follow while the switch is on (D44), so `gateway fallback
      // judge off` ("Claude alone") must be savable on a machine that set no judge chain.
      if (slot !== JUDGE_SLOT && !Object.hasOwn(config.slots, slot)) {
        ctx.addIssue({
          code: "custom",
          message: `fallback names slot "${slot}", which is not in slots (a slot with no chain has nothing to fall back to)`,
          path: ["fallback", slot],
        });
      }
    }
    for (const slot of Object.keys(config.breaker ?? {})) {
      if (slot === JUDGE_SLOT) {
        ctx.addIssue({
          code: "custom",
          message: `breaker names ${slot}: ${JUDGE_NEVER_HOLDS}`,
          path: ["breaker", slot],
        });
      } else if (!Object.hasOwn(config.slots, slot)) {
        ctx.addIssue({
          code: "custom",
          message: `breaker names slot "${slot}", which is not in slots (a slot with no chain has no request to hold)`,
          path: ["breaker", slot],
        });
      }
    }
  });

/**
 * Why a 0.4.x `modelSlots` entry cannot be read, or null when it can: the key is a Claude
 * id (without `[1m]`), the slot a model slot of that id's family, and in `slots`. What 0.4.x
 * also asked (the model itself first, a target after it) is no rule any more: a model slot
 * takes any chain, like every slot.
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
  if (claudeFamily(model) !== family) {
    return `modelSlots "${model}" points at ${slot}, which is for ${family} models`;
  }
  if (!Object.hasOwn(slots, slot)) {
    return `modelSlots "${model}" points at slot "${slot}", which is not in slots`;
  }
  return null;
}

/**
 * Is this slot's fallback switch on? The person's own setting (`fallback`) when there is
 * one. Otherwise the slot's default: off for the model slots (`FALLBACK_OFF_BY_DEFAULT`),
 * on for every other slot, the judge included (D44: while Claude cannot judge, the worker's
 * tested targets do; `gateway fallback judge off` keeps Claude alone). A 0.4.x opus or fable
 * chain gets that default too: it moved on only at the plan's usage limit, and "on" now
 * moves on at any 408, 429, 5xx, 529 or network error, so turning it on is the person's
 * choice (`gateway fallback <slot> on`).
 */
export function fallbackOn(config: Pick<GatewayConfig, "fallback">, slot: string): boolean {
  const set = config.fallback;
  if (set !== undefined && Object.hasOwn(set, slot)) return set[slot] === true;
  return !FALLBACK_OFF_BY_DEFAULT.includes(slot);
}

/**
 * Is this slot's breaker switch on? The person's own setting (`breaker`) when there is one;
 * otherwise on, for every slot. Never for the judge, whatever a hand-edited file says: the
 * schema refuses such an entry, and a safety check must answer or fail at once
 * (`JUDGE_NEVER_HOLDS`).
 */
export function breakerOn(config: Pick<GatewayConfig, "breaker">, slot: string): boolean {
  if (slot === JUDGE_SLOT) return false;
  const set = config.breaker;
  if (set !== undefined && Object.hasOwn(set, slot)) return set[slot] === true;
  return true;
}

/**
 * How long the breaker holds a request that streams, in milliseconds: the config's
 * `timeouts.breakerHoldMs`, else `BREAKER_HOLD_CEILING_MS`. 0 means no hold.
 */
export function breakerHoldMs(config: Pick<GatewayConfig, "timeouts">): number {
  return config.timeouts.breakerHoldMs ?? BREAKER_HOLD_CEILING_MS;
}

/**
 * What a slot's breaker switch means, in the words the command line and the portal both
 * show: `breaker on` or `breaker off`. Null for the judge, which has no switch
 * (`JUDGE_NEVER_HOLDS`).
 */
export function breakerWords(config: Pick<GatewayConfig, "breaker">, slot: string): null | string {
  if (slot === JUDGE_SLOT) return null;
  return breakerOn(config, slot) ? "breaker on" : "breaker off";
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

/** A chain saved, not in use, and the slot's fallback switch with it (`kept`). */
export type KeptChain = z.output<typeof keptChainSchema>;

/**
 * What answers for a slot: `custom`, its chain in `slots`; `claude`, no chain in use (its
 * family's requests go to Anthropic as Claude Code sent them; for the judge, Claude judges).
 * Every slot has the same two modes, and every version reads them the same way.
 */
export type SlotMode = "claude" | "custom";

export function slotMode(config: Pick<GatewayConfig, "slots">, slot: string): SlotMode {
  return Object.hasOwn(config.slots, slot) ? "custom" : "claude";
}

/** The chain saved for a slot, not in use; null when there is none. */
export function keptChain(config: Pick<GatewayConfig, "kept">, slot: string): KeptChain | null {
  const kept = config.kept;
  if (kept === undefined || !Object.hasOwn(kept, slot)) return null;
  return kept[slot] ?? null;
}

/**
 * The judge test's version, and what its proof lets a target do. Raise it when the test
 * changes, or what passing it lets a target do: every judge target then counts as untested
 * until `gateway slot judge` tests it again. 2 since 0.3.0: the fixed phrase the proof is
 * made from changed with the plugin's name. 3 since 0.5.0: a judge target judges every check
 * first, where before it answered only when Claude could not. A judge set for the old
 * meaning is not taken for the new one: the router ignores it, and Claude judges, until the
 * person tests and sets it again.
 *
 * It stays 3 since D44 (2026-10-22), which put a target behind Claude: the worker's tested
 * targets judge only while Claude is limited or down, so a target that passed the test under
 * version 3 may do less than it did — never more. A target set for judging every check is
 * safe judging some of them; nobody has to test its targets again.
 */
export const JUDGE_TEST_VERSION = 3;

/**
 * The proof that a target passed the judge test, as `gateway slot judge`, `gateway slot
 * worker` and `gateway setup` write it into `judgeTested`: the first 32 hex characters of the
 * SHA-256 of a fixed phrase naming the test version, the target and its backend's URL. Why in
 * the config, and why a digest: the slot and its proof are saved in one atomic write, so they
 * cannot drift apart; the router already reads that file on each change; and a hand edit that
 * adds a judge target, copies another target's entry, or moves the backend gets no matching
 * proof. It stops a mistake, not a person who means it: anyone who reads this code can
 * compute it.
 */
export function judgeTestProof(target: string, backendUrl: string): string {
  return createHash("sha256")
    .update(`cc-smart-dev-kit judge test ${JUDGE_TEST_VERSION}\n${target}\n${backendUrl}`)
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

/**
 * May this target judge? A `claude-…` target needs no test: Claude is the judge the test
 * compares against, and it judges as the model its id names (D44 lets a judge chain hold
 * one). Any other target needs its proof (`judgeTargetTested`).
 */
export function judgeTargetUsable(
  config: Pick<GatewayConfig, "backends" | "judgeTested">,
  target: string,
): boolean {
  const parsed = parseTarget(target);
  if (!("target" in parsed)) return false;
  return parsed.target.kind === "anthropic" || judgeTargetTested(config, target);
}

/**
 * The worker chain's targets that passed the judge test, in that chain's order: with no
 * judge chain of the person's own, they judge auto mode's checks while Claude is limited or
 * down (owner D44). Only a backend target: a `claude-…` target in the worker chain cannot
 * stand in for Claude when Claude is the one that cannot answer. Empty when the worker slot
 * has no chain, or none of its targets passed the test — Claude then judges alone.
 */
export function workerJudgeTargets(
  config: Pick<GatewayConfig, "backends" | "judgeTested" | "slots">,
): Target[] {
  const chain = Object.hasOwn(config.slots, WORKER_SLOT) ? (config.slots[WORKER_SLOT] ?? []) : [];
  const targets: Target[] = [];
  for (const text of chain) {
    if (!judgeTargetTested(config, text)) continue;
    const parsed = parseTarget(text);
    if ("target" in parsed) targets.push(parsed.target);
  }
  return targets;
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
 *
 * `platform` decides what "readable by others" means (see `isOwnerOnly`): on Windows it is
 * never the mode, because there it says nothing — the ACL of the user profile protects the
 * file, and a refusal over those synthetic bits would leave the router on its fallback
 * config on every Windows machine.
 */
export function loadConfigFile(
  path: string,
  platform: NodeJS.Platform = hostPlatform(),
): GatewayConfig {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
  }
  if (!isOwnerOnly(mode, platform)) {
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
 * The config the router runs on while the file is missing or bad at start: no backends and
 * no slots, so every slot is off and each Claude model's request goes to Anthropic as Claude
 * Code sent it, on the person's own login. Nothing answers on a model the person did not
 * choose. Better than a service that crash-loops for every Claude Code session on the
 * machine.
 */
export function emptyConfig(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: {},
    port: DEFAULT_PORT,
    slots: {},
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
