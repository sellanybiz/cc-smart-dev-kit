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
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { messageOf } from "../error-message";
// From ./names, not the index: the index bakes in the version, and the router bundle
// must not change with it (a changed bundle restarts every machine's router).
import { hostPlatform } from "../machine/host";
import { isOwnerOnly } from "../setup/file-mode";
import { readUserJson } from "../setup/user-json";
import { atomicWrite } from "../setup/write";
import { HISTORY_MAX_RETENTION_DAYS, HISTORY_RETENTION_DAYS } from "./history";
import {
  BACKEND_EFFORT_LEVELS,
  type BackendEffort,
  claudeFamily,
  FAMILY_SLOTS,
  isBackendName,
  isProfileName,
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
 * The default of `timeouts.streamIdleMs`: how long a streaming answer may send no byte, from
 * its headers, before the router ends it. A judgment, not a measurement: the request history
 * holds each answer's time to its headers (the first real event, for a held stream), never
 * the gaps between events (88,926 rows, 2026-10: that time is at most 60 s for 99 of 100 answers
 * on the slowest target and 102 s at most). A pause inside an answer (a reasoning pause, a large
 * tool call) is likely of the same size, so 120 s sits above the longest wait seen, and still ends
 * a stall in two minutes, not in the 21 a session once waited (Claude Code ended no stalled
 * stream in 179 s: `docs/claude-code-contract.md` § The gateway). For Anthropic the margin
 * is its ping events (no interval in its docs; one third-party measurement saw about 30 s
 * between events), not measured here.
 */
export const DEFAULT_STREAM_IDLE_MS = 120_000;
/** The longest a `setTimeout` waits (2^31 - 1 ms); a longer one fires after 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/** The refusal of a timeout above `MAX_TIMER_MS`, with what such a value would do. */
function timerTooLong(consequence: string): string {
  return `too long: at most ${MAX_TIMER_MS} ms, the longest a timer can wait (above it the wait is 1 ms and ${consequence})`;
}

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
  effort: z.record(z.string(), z.enum(BACKEND_EFFORT_LEVELS)).optional(),
  fallback: z.boolean().optional(),
  targets: z.array(z.string().min(1)).min(1),
});

/**
 * Why a profile name is refused, in the words the file's reader shows. A `z.record` key
 * schema's own message never reaches the person ("Invalid key in record"), so the key is
 * checked in the schema's own pass (`superRefine`) instead.
 */
export const PROFILE_NAME_RULE =
  "a profile name is lower-case letters, digits and - (the /p/<name> of a project's URL), at most 64";

/** Why a slot key is refused, in the words the file's reader shows (the same reason as above). */
const SLOT_KEY_RULE = (slot: string) => `"${slot}" is not a slot key (cc-smart-dev-kit-<name>)`;

/**
 * One slot in a profile: a chain in use there, or `"claude"` — plain Claude for that slot in
 * this profile, whatever the machine's chain is (the simplest shape, owner D29: a profile
 * says what it changes, and a slot it does not name keeps the machine's chain).
 */
const profileSlotSchema = z.union([z.literal("claude"), z.array(z.string().min(1)).min(1)], {
  error:
    'a profile slot is "claude" (plain Claude for that slot there) or a chain: a list of one or more targets',
});

/**
 * A profile: a named set of slot chains and switches over the machine's, reached by a
 * project's URL `…/p/<name>` (`docs/gateway.md` § Profiles). Everything not named here is
 * machine-wide: `backends`, `port`, `timeouts`, `aliases`, `judgeTested`, `history`. Loose,
 * so a field a newer version adds is kept when a command saves the file. `kept` is a
 * profile's own saved chains (same shape as the top level's), not in use; only commands
 * write it.
 */
const profileSchema = z.looseObject({
  breaker: z.record(z.string(), z.boolean()).optional(),
  fallback: z.record(z.string(), z.boolean()).optional(),
  kept: z.record(z.string(), keptChainSchema).optional(),
  slots: z.record(z.string(), profileSlotSchema).optional(),
});

export const gatewayConfigSchema = z
  .looseObject({
    /**
     * Old model names and what they mean now: `{"<old name>": "<slot or target>"}`. The
     * router resolves an alias before it routes. The plugin ships none; a project's own
     * migration writes them, so a machine's old names keep working while it moves.
     */
    aliases: z.record(z.string(), z.string()).default({}),
    /** Per slot and backend target; kept by older loose-schema readers. */
    effort: z.record(z.string(), z.record(z.string(), z.enum(BACKEND_EFFORT_LEVELS))).optional(),
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
     * The request history (`history.ts`, D51). Absent: 90 days, kept in
     * `~/.local/state/cc-smart-dev-kit/history.db`. `retentionDays: 0` turns the log off:
     * the router writes no row, and an existing database stays as it is.
     */
    history: z
      .looseObject({
        retentionDays: z
          .int()
          .min(0, "0 turns the request history off, which is the smallest value")
          .max(
            HISTORY_MAX_RETENTION_DAYS,
            `at most ${String(HISTORY_MAX_RETENTION_DAYS)} days (ten years), so a typo cannot fill the disk`,
          )
          .optional(),
      })
      .optional(),
    /**
     * 0.4.x only, read and never written again: the Claude ids whose requests a model slot
     * took (`{"claude-opus-5-5": "cc-smart-dev-kit-opus"}`). A request reaches its slot by
     * its family now (`familySlotFor`), and the entry changes nothing: such a chain starts
     * with its fallback switch at the default, off (`fallbackOn`). Kept so such
     * a config loads; `gateway slot opus|fable` drops the entry.
     */
    modelSlots: z.record(z.string(), z.string()).optional(),
    port: z.int().min(1).max(65_535).default(DEFAULT_PORT),
    /**
     * A project's own chains and switches, by name: its `ANTHROPIC_BASE_URL` ends in
     * `…/p/<name>` (owner D29, `docs/gateway.md` § Profiles). A slot a profile does not name
     * keeps the machine's chain; `"claude"` turns it off for that profile. The names are the
     * URL segments a project can carry, so the pattern is checked here too. Optional: a
     * machine without profiles writes no key.
     */
    profiles: z.record(z.string(), profileSchema).optional(),
    slots: z.record(z.string(), z.array(z.string()).min(1)),
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
        firstByteMs: z
          .int()
          .positive()
          .max(MAX_TIMER_MS, timerTooLong("every wait it bounds would end at once"))
          .default(DEFAULT_FIRST_BYTE_MS),
        /**
         * How long a streaming answer may send no byte (an event, a ping or a comment line
         * all count), counted from its headers, before the router ends it, in whole ms. Absent:
         * `DEFAULT_STREAM_IDLE_MS`, read through `streamIdleMs`.
         */
        streamIdleMs: z
          .int()
          .positive()
          .max(MAX_TIMER_MS, timerTooLong("every stream would be cut"))
          .optional(),
      })
      .default({ firstByteMs: DEFAULT_FIRST_BYTE_MS }),
    version: z.literal(1),
  })
  .superRefine((config, ctx) => {
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
      // The name is a URL segment, so it is checked before anything under it is read. A key
      // no URL can carry is refused once, and its body is not checked further.
      if (!isProfileName(name)) {
        ctx.addIssue({ code: "custom", message: PROFILE_NAME_RULE, path: ["profiles", name] });
        continue;
      }
      for (const field of ["slots", "kept"] as const) {
        for (const slot of Object.keys(profile[field] ?? {})) {
          if (isSlotKey(slot)) continue;
          ctx.addIssue({
            code: "custom",
            message: SLOT_KEY_RULE(slot),
            path: ["profiles", name, field, slot],
          });
        }
      }
      for (const [slot, chain] of Object.entries(profile.slots ?? {})) {
        if (chain === "claude") continue;
        chainIssues(config, chain, ["profiles", name, "slots", slot], ctx);
      }
      // The slots this profile has a chain for: its own, and the machine's for the rest
      // (absent = the machine's chain; `"claude"` = no chain here, so nothing to fall back to).
      const chained = new Set(
        [...Object.keys(config.slots), ...Object.keys(profile.slots ?? {})].filter(
          (slot) => profileSlotChain(config, profile, slot) !== null,
        ),
      );
      for (const slot of Object.keys(profile.fallback ?? {})) {
        // The judge's switch needs no judge chain, as at the top level (D44).
        if (slot !== JUDGE_SLOT && !chained.has(slot)) {
          ctx.addIssue({
            code: "custom",
            message: `fallback names slot "${slot}", which profile "${name}" has no chain for (a slot with no chain has nothing to fall back to)`,
            path: ["profiles", name, "fallback", slot],
          });
        }
      }
      for (const slot of Object.keys(profile.breaker ?? {})) {
        if (slot === JUDGE_SLOT) {
          ctx.addIssue({
            code: "custom",
            message: `breaker names ${slot}: ${JUDGE_NEVER_HOLDS}`,
            path: ["profiles", name, "breaker", slot],
          });
        } else if (!chained.has(slot)) {
          ctx.addIssue({
            code: "custom",
            message: `breaker names slot "${slot}", which profile "${name}" has no chain for (a slot with no chain has no request to hold)`,
            path: ["profiles", name, "breaker", slot],
          });
        }
      }
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
 * Add an issue for each target of a chain that cannot be used: text that is not a target,
 * or a backend the config does not hold. The same check at the top level and in a profile.
 */
function chainIssues(
  config: Pick<GatewayConfig, "backends">,
  targets: readonly string[],
  path: (number | string)[],
  ctx: z.RefinementCtx,
): void {
  targets.forEach((text, index) => {
    const parsed = parseTarget(text);
    if ("error" in parsed) {
      ctx.addIssue({ code: "custom", message: parsed.error, path: [...path, index] });
    } else if (
      parsed.target.kind === "backend" &&
      !Object.hasOwn(config.backends, parsed.target.backend)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `"${text}" names backend "${parsed.target.backend}", which is not in backends`,
        path: [...path, index],
      });
    }
  });
}

/** A pin names only a valid backend target; stale chain membership is pruned on read. */
function effortIssues(
  pins: Record<string, BackendEffort>,
  path: (number | string)[],
  ctx: z.RefinementCtx,
): void {
  for (const target of Object.keys(pins)) {
    const parsed = parseTarget(target);
    const error =
      "error" in parsed
        ? parsed.error
        : parsed.target.kind === "anthropic"
          ? "a Claude target cannot pin effort: Anthropic gets only the fields its model refuses changed"
          : null;
    if (error !== null) ctx.addIssue({ code: "custom", message: error, path: [...path, target] });
  }
}

/** The effective slot's pin, never one for a Claude target or a target outside its chain. */
export function effortPin(
  config: Pick<GatewayConfig, "effort" | "slots">,
  slot: string,
  target: string,
): BackendEffort | undefined {
  const parsed = parseTarget(target);
  if (!("target" in parsed) || parsed.target.kind !== "backend") return undefined;
  if (!Object.hasOwn(config.slots, slot) || !config.slots[slot]?.includes(target)) return undefined;
  const pins = config.effort;
  if (pins === undefined || !Object.hasOwn(pins, slot)) return undefined;
  const own = pins[slot];
  return own !== undefined && Object.hasOwn(own, target) ? own[target] : undefined;
}

/** One profile as the config holds it. */
export type ProfileConfig = z.output<typeof profileSchema>;

/**
 * True when `profile` names the slot itself (a chain, or `"claude"`); false when it does not
 * name it, or does not exist, and so uses the machine's chain there (`profileSlotChain`).
 */
export function profileNamesSlot(
  config: Pick<GatewayConfig, "profiles">,
  profile: string,
  slot: string,
): boolean {
  const named = config.profiles !== undefined && Object.hasOwn(config.profiles, profile);
  const slots = named ? config.profiles?.[profile]?.slots : undefined;
  return slots !== undefined && Object.hasOwn(slots, slot);
}

/**
 * The chain a slot has in a profile: the profile's own chain, null when the profile says
 * `"claude"`, and the machine's chain when the profile does not name the slot. Null too when
 * neither has one (the slot is off there).
 */
export function profileSlotChain(
  config: Pick<GatewayConfig, "slots">,
  profile: ProfileConfig,
  slot: string,
): null | string[] {
  const own =
    profile.slots !== undefined && Object.hasOwn(profile.slots, slot)
      ? profile.slots[slot]
      : undefined;
  if (own === "claude") return null;
  if (own !== undefined) return own;
  return Object.hasOwn(config.slots, slot) ? (config.slots[slot] ?? null) : null;
}

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
 * Is this slot's fallback switch on? The person's own setting (`fallback`) when there is one,
 * else the slot's default: off for every slot but the judge (D66, the owner), on for the judge
 * (the owner, 2026-10-27).
 *
 * - **Every slot but the judge** answers with its first target alone until the person turns the
 *   switch on (`gateway fallback <slot> on`). A 0.4.x opus or fable chain starts off the same
 *   way: "on" moves on at any 408, 429, 5xx, 529 or network error, so turning it on is the
 *   person's choice.
 * - **The judge**: Claude judges auto mode's safety checks first, and with no judge chain of the
 *   person's own, the worker's tested targets stand in while Claude is limited or down (D44), by
 *   default. The default is safe because a stand-in must have passed the judge test
 *   (`workerJudgeTargets`): with none tested, Claude judges alone, as before. An explicit
 *   `gateway fallback judge off` wins. The same switch lets the next target of a judge chain
 *   the person set answer, as it does for any chain.
 *
 * One home, no list of slots anywhere else: every reader asks here.
 */
export function fallbackOn(config: Pick<GatewayConfig, "fallback">, slot: string): boolean {
  const set = config.fallback;
  if (set !== undefined && Object.hasOwn(set, slot)) return set[slot] === true;
  return slot === JUDGE_SLOT;
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
 * How long a streaming answer may send no byte, from its headers, in milliseconds: the
 * config's `timeouts.streamIdleMs`, else `DEFAULT_STREAM_IDLE_MS`.
 */
export function streamIdleMs(config: Pick<GatewayConfig, "timeouts">): number {
  return config.timeouts.streamIdleMs ?? DEFAULT_STREAM_IDLE_MS;
}

/**
 * How long the request history keeps a row, in days: the config's
 * `history.retentionDays`, else `HISTORY_RETENTION_DAYS`. 0 turns the log off.
 */
export function historyRetentionDays(config: Pick<GatewayConfig, "history">): number {
  return config.history?.retentionDays ?? HISTORY_RETENTION_DAYS;
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
 *
 * A slot is one whether it is Custom or Claude: in `slots`, saved in `kept`, or one of the
 * five, which exist with no chain at all. Moving a slot to Claude never breaks its aliases;
 * a request under one then gets the answer a slot-named request for a Claude slot gets.
 */
function aliasError(
  name: string,
  to: string,
  config: {
    aliases: Record<string, string>;
    backends: Record<string, unknown>;
    kept?: object | undefined;
    slots: object;
  },
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
    return Object.hasOwn(config.slots, to) ||
      Object.hasOwn(config.kept ?? {}, to) ||
      Object.hasOwn(FAMILY_SLOTS, to) ||
      to === JUDGE_SLOT
      ? null
      : `alias "${name}" points at slot "${to}", which is no slot: not in slots, not saved in kept, and none of the five`;
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
 * The aliases that point at a slot in Claude mode (the slot is not in `slots`), as
 * `[alias, slot]`, sorted by alias. 1.2.0's `aliasError` accepts them; a 1.1.x router refuses
 * the whole file for one, so a command that would save one asks the running router for the
 * `claude-slot-aliases` feature first (`routerFeature`).
 */
export function aliasesAtClaudeSlots(
  config: Pick<GatewayConfig, "aliases" | "slots">,
): [string, string][] {
  return Object.entries(config.aliases)
    .filter(([, to]) => isSlotKey(to) && !Object.hasOwn(config.slots, to))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

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

/** The profile names a config holds, sorted: what the health page lists. */
export function profileNames(config: Pick<GatewayConfig, "profiles">): string[] {
  return Object.keys(config.profiles ?? {}).sort();
}

/**
 * What a request under profile `name` sees: the machine's config, with that profile's slot
 * chains over the machine's (a slot it does not name keeps the machine's chain, `"claude"`
 * turns it off there) and its fallback and breaker switches over the machine's. Everything
 * else stays machine-wide: `backends`, `port`, `timeouts`, `aliases`, `judgeTested`,
 * `history`. Null when the config holds no such profile; the caller then answers as plain
 * Claude (`plainClaudeView`, owner D29).
 *
 * The view is a copy: every reader the router already has (`resolveRoute`, `fallbackOn`,
 * `breakerOn`, `workerJudgeTargets`, `judgeTargetsOf`) works on it unchanged, and it is never
 * saved. A name that is not lower-case letters, digits and `-` is not a profile.
 */
export function profileView(config: GatewayConfig, name: string): GatewayConfig | null {
  if (!isProfileName(name)) return null;
  const profile =
    config.profiles !== undefined && Object.hasOwn(config.profiles, name)
      ? config.profiles[name]
      : undefined;
  if (profile === undefined) return null;
  const slots: Record<string, string[]> = { ...config.slots };
  for (const slot of Object.keys(profile.slots ?? {})) {
    const chain = profileSlotChain(config, profile, slot);
    if (chain === null) delete slots[slot];
    else slots[slot] = chain;
  }
  const view: GatewayConfig = { ...config, slots };
  const fallback = { ...config.fallback, ...profile.fallback };
  if (Object.keys(fallback).length === 0) delete view.fallback;
  else view.fallback = fallback;
  const breaker = { ...config.breaker, ...profile.breaker };
  if (Object.keys(breaker).length === 0) delete view.breaker;
  else view.breaker = breaker;
  return view;
}

/**
 * What a request under a name the config does not hold answers as (owner D29): plain Claude.
 * Every slot is off, so each Claude model's request goes to Anthropic as Claude Code sent it,
 * on the person's own login; a slot-named request gets the usual "this slot is off" 400, and
 * the judge is Claude. Never an error a session cannot read.
 *
 * The aliases go too: a name in `aliases` may point at a slot, and plain Claude must not reach
 * a chain through one. The rest of the config stays — backends and their keys (the log masks
 * with them), the login's path — and an explicit `<backend>:<model>` is still the one-off try
 * it is anywhere, since it is the request's own name, not a profile's chain.
 */
export function plainClaudeView(config: GatewayConfig): GatewayConfig {
  const view: GatewayConfig = { ...config, aliases: {}, slots: {} };
  delete view.breaker;
  delete view.fallback;
  return view;
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

/**
 * Who may judge auto mode's safety checks in Claude's place, in `config` (the machine's, or a
 * profile's view of it): `ready` when the worker's tested targets stand in while Claude is
 * limited or down, else the one reason none does (the router records it when a check fails for
 * want of capacity, `ChecksDownWhy`, and `claudeFirstJudge` asks here):
 *   - `chain-untested`: the person set a judge chain (it wins, the worker's targets are never
 *     added to it); Claude judges alone when none of its targets is usable;
 *   - `no-worker`: the worker slot has no affordable (backend) target;
 *   - `untested`: it has some, and none has passed the judge test;
 *   - `off`: one passed, and the person turned the judge's fallback switch off.
 * Untested is said before off: turning the switch on would change nothing without a tested target.
 */
export function judgeStandInState(
  config: Pick<GatewayConfig, "backends" | "fallback" | "judgeTested" | "slots">,
): "chain-untested" | "no-worker" | "off" | "ready" | "untested" {
  if (Object.hasOwn(config.slots, JUDGE_SLOT)) return "chain-untested";
  if (workerJudgeTargets(config).length === 0) {
    const worker = Object.hasOwn(config.slots, WORKER_SLOT)
      ? (config.slots[WORKER_SLOT] ?? [])
      : [];
    const affordable = worker.some((text) => {
      const parsed = parseTarget(text);
      return "target" in parsed && parsed.target.kind === "backend";
    });
    return affordable ? "untested" : "no-worker";
  }
  return fallbackOn(config, JUDGE_SLOT) ? "ready" : "off";
}

// Its home is `src/error-message.ts`; many files have always imported it from here, so
// this file hands it on rather than every one of them changing its import.
export { messageOf };

/** A config file that cannot be used, with the reason in words. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Check a parsed value against the schema; the reason in words when it fails. */
export function parseConfig(raw: unknown): { config: GatewayConfig } | { error: string } {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) return { error: z.prettifyError(result.error) };
  const config = result.data;
  // An older loose-schema writer preserves pins while changing chains. Ignore and prune
  // those stale entries, never reject the new chain and keep routing on an old one.
  if (config.effort !== undefined) {
    const effort = Object.fromEntries(
      Object.entries(config.effort).flatMap(([slot, pins]) => {
        const chain = Object.hasOwn(config.slots, slot) ? config.slots[slot] : undefined;
        const active = Object.fromEntries(
          Object.entries(pins).filter(([target]) => chain?.includes(target)),
        );
        return Object.keys(active).length === 0 ? [] : [[slot, active]];
      }),
    );
    if (Object.keys(effort).length === 0) delete config.effort;
    else config.effort = effort;
  }
  for (const saved of Object.values(config.kept ?? {})) {
    if (saved.effort === undefined) continue;
    const pins = Object.fromEntries(
      Object.entries(saved.effort).filter(([target]) => saved.targets.includes(target)),
    );
    if (Object.keys(pins).length === 0) delete saved.effort;
    else saved.effort = pins;
  }
  return { config };
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
    raw = readUserJson(path);
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
