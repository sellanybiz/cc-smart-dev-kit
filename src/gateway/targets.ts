/**
 * Where one request to the AI gateway goes: parsing the slot targets, and picking the
 * route for a model name.
 *
 * Claude Code sends every request to the local router (`ANTHROPIC_BASE_URL`), with the
 * person's own Claude login on it. The model name decides the way out:
 *   - `claude-…`               → Anthropic, untouched (the own login is meant for it);
 *   - a slot key (`anymodel-scout`)  → the slot's targets, in order, first that answers;
 *   - `<backend>:<model>`      → that backend, no fallback (an ad-hoc try);
 *   - anything else            → Anthropic, untouched: never a guess at a backend.
 * An alias from the config's `aliases` is resolved first (`resolveAlias`), so an old
 * model name reaches its new slot. One request is recognised by its body, not its name:
 * auto mode's safety check (`isAutoModeGuard`, on the request as it came) goes to the
 * `anymodel-judge` slot (`JUDGE_SLOT`), or stays on Claude in a config without one
 * (`resolveRequestRoute`), also when an alias would send it to a cheap backend.
 *
 * A target is written as text in the config and on the command line (and an explicit
 * `<backend>:<model>` works as a model name too, for a one-off try):
 *   - `claude-sonnet-5-5`  → Anthropic, the body's model set to that id;
 *   - `<backend>:<model>`  → that backend (its own API key), e.g.
 *                            `omniroute:glm-5.3-flash`. The model part may hold `:` or
 *                            `/` itself: only the first `:` splits.
 *
 * The functions here are pure, so they can be tested. The router is `router.ts`; the
 * design: docs/gateway.md.
 */

/** Anthropic, on the client's own login; `model` is the full id (`claude-sonnet-5-5`). */
export interface AnthropicTarget {
  kind: "anthropic";
  model: string;
}

/** A cheap backend from the config's `backends`; it gets the backend's own key. */
export interface BackendTarget {
  backend: string;
  kind: "backend";
  model: string;
}

export type Target = AnthropicTarget | BackendTarget;

/** A backend name: lower-case letters, digits, `-` and `_`. */
const BACKEND_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** The prefix of every slot key. */
export const SLOT_PREFIX = "anymodel-";

/** A slot key: `anymodel-` and a short lower-case name. (A model slot: `MODEL_SLOTS`.) */
const SLOT_KEY = /^anymodel-[a-z0-9][a-z0-9-]*$/;

/**
 * Claude Code reads `[1m]` on a model id as "1M context" and is documented to strip it
 * before sending. Stripped here too, so a client that does not still finds its slot.
 */
const CONTEXT_SUFFIX = /\[1m\]$/i;

export function isBackendName(name: string): boolean {
  return BACKEND_NAME.test(name);
}

export function isSlotKey(name: string): boolean {
  return SLOT_KEY.test(name);
}

/** A model name without the `[1m]` context suffix. */
export function withoutContextSuffix(name: string): string {
  return name.replace(CONTEXT_SUFFIX, "");
}

/** The text of a target, the way the config and `gateway slot` spell it. */
export function formatTarget(target: Target): string {
  return target.kind === "anthropic" ? target.model : `${target.backend}:${target.model}`;
}

/** One target from its text; an error message when the text is not a target. */
export function parseTarget(text: string): { error: string } | { target: Target } {
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

/**
 * The slot key a person types on the command line: `scout` means `anymodel-scout`, `anymodel-worker`
 * stays as it is. Null when it cannot be a slot key.
 */
export function slotKeyFromArg(arg: string): null | string {
  const key = arg.startsWith(SLOT_PREFIX) ? arg : `${SLOT_PREFIX}${arg}`;
  return isSlotKey(key) ? key : null;
}

/**
 * An alias from the config's `aliases` for this model name (looked up without `[1m]`),
 * or null when there is none. The config was checked at load, so `to` is a slot key or a
 * target, never another alias.
 */
export function resolveAlias(
  model: unknown,
  aliases: Readonly<Record<string, string>>,
): { from: string; to: string } | null {
  if (typeof model !== "string" || model === "") return null;
  const name = withoutContextSuffix(model);
  if (!Object.hasOwn(aliases, name)) return null;
  const to = aliases[name];
  return to === undefined ? null : { from: name, to };
}

/** Where a `/v1/messages` request goes, decided from its model name alone. */
export type Route =
  /** `claude-…`, no model, or a name the router does not know: Anthropic, bytes untouched. */
  | { kind: "anthropic" }
  /**
   * Auto mode's safety check that would reach no Claude target (`resolveRequestRoute`):
   * Anthropic, with the bytes as Claude Code sent them, before any alias.
   */
  | { kind: "anthropic-as-sent" }
  /** `<backend>:<model>` naming a configured backend: that backend alone, no fallback. */
  | { kind: "explicit"; target: BackendTarget }
  /** A configured slot key: its targets in order. */
  | { kind: "slot"; slot: string; targets: Target[] }
  /** `anymodel-…` that no slot has: an error, never a guess. */
  | { kind: "unknown-slot"; slot: string };

/** The parts of the config the route depends on. */
export interface RouteConfig {
  backends: Record<string, unknown>;
  slots: Record<string, string[]>;
}

/**
 * The route for a model name. Anything the router does not recognise goes to Anthropic
 * as it came: that is where the own login is meant to go, and Anthropic answers the
 * error. A cheap backend is reached only by name (a slot, or an explicit
 * `<backend>:<model>`), never by a guess. Slot targets were checked when the config
 * loaded; one that does not parse here is skipped.
 */
export function resolveRoute(model: unknown, config: RouteConfig): Route {
  if (typeof model !== "string" || model === "" || model.startsWith("claude-")) {
    return { kind: "anthropic" };
  }
  const name = withoutContextSuffix(model);
  if (isSlotKey(name)) {
    const texts = Object.hasOwn(config.slots, name) ? config.slots[name] : undefined;
    if (texts === undefined) return { kind: "unknown-slot", slot: name };
    const targets: Target[] = [];
    for (const text of texts) {
      const parsed = parseTarget(text);
      if ("target" in parsed) targets.push(parsed.target);
    }
    return { kind: "slot", slot: name, targets };
  }
  const parsed = parseTarget(name);
  if (
    "target" in parsed &&
    parsed.target.kind === "backend" &&
    Object.hasOwn(config.backends, parsed.target.backend)
  ) {
    return { kind: "explicit", target: parsed.target };
  }
  return { kind: "anthropic" };
}

/**
 * The first words of the system prompt Claude Code sends with auto mode's safety check:
 * the request that judges each action before it runs. Seen in two forms on Claude Code
 * 2.1.x, both with this prompt and no tools: model `claude-sonnet-5`, thinking disabled,
 * `<severity>N` answers; and the `sonnet` alias (with the gateway on, `anymodel-worker`), no
 * thinking field, `<block>yes|no` answers. (docs/claude-code-contract.md)
 */
export const GUARD_PROMPT = "You are a security monitor for autonomous AI coding agents";

/**
 * Is this request auto mode's safety check? Its model name says nothing (a `claude-…` id,
 * the sonnet slot, or an old name in the config's `aliases`), so only its system prompt
 * tells it apart. Call it on the request as it came, before the alias is applied: an
 * alias may point at `<backend>:<model>`, and the check must still be seen. An explicit
 * `<backend>:<model>` sent as the model name is someone's own test and keeps its route.
 * When Claude Code changes the prompt, the check stops matching and goes by its model name.
 */
export function isAutoModeGuard(
  body: Record<string, unknown>,
  aliases: Readonly<Record<string, string>> = {},
): boolean {
  const model = body.model;
  if (typeof model !== "string") return false;
  // The check offers no tools; a request that does is a conversation quoting the prompt.
  const tools = body.tools;
  if (Array.isArray(tools) && tools.length > 0) return false;
  const name = withoutContextSuffix(model);
  if (!model.startsWith("claude-") && !isSlotKey(name) && !Object.hasOwn(aliases, name)) {
    return false;
  }
  const system = body.system;
  if (typeof system === "string") return system.includes(GUARD_PROMPT);
  if (!Array.isArray(system)) return false;
  return system.some((block: unknown) => {
    if (typeof block !== "object" || block === null || !("text" in block)) return false;
    return typeof block.text === "string" && block.text.includes(GUARD_PROMPT);
  });
}

/**
 * The route for a whole `/v1/messages` body, after any alias: by its model name, except
 * auto mode's safety check (`guard`: `isAutoModeGuard` on the request as it came) when the
 * config has no `anymodel-judge` slot (with one, the router sends every check there before
 * this runs). Then the check stays on Claude:
 *   - a `claude-…` model (sent so, or an alias to one) → Anthropic with that model;
 *   - a slot with a Claude target → only that slot's Claude targets (only `model` changes);
 *   - a slot with none, or a `<backend>:<model>` (only an alias leads there) →
 *     `anthropic-as-sent`: Anthropic gets the request as Claude Code sent it, before any
 *     alias. It refuses the unknown name; Claude Code then retries the check on another
 *     Claude model, which goes to Anthropic untouched.
 * A `claude-…` check keeps its own model: Claude Code builds the body for the model it
 * names, and Claude Sonnet 5.5 answered 400 to the older form's `thinking: disabled` (it
 * wants `between_tools`). A slot-named check carries no thinking field (Claude Code knows
 * no features for a slot name), and Sonnet 5.5 took it.
 */
export function resolveRequestRoute(
  body: Record<string, unknown>,
  config: RouteConfig,
  guard: boolean,
): Route {
  const route = resolveRoute(body.model, config);
  if (!guard) return route;
  if (route.kind === "explicit") return { kind: "anthropic-as-sent" };
  if (route.kind !== "slot") return route;
  const claude = route.targets.filter((target) => target.kind === "anthropic");
  return claude.length > 0 ? { ...route, targets: claude } : { kind: "anthropic-as-sent" };
}

/**
 * The fallback judge for auto mode's safety checks, opt-in and OFF by default: a new config
 * has no such slot. Set or not, every check goes to Claude first (`resolveRequestRoute`);
 * the judge answers only when Claude cannot: the plan's usage limit, a 401, or no login
 * (the router's `judgeAsFallback`). So auto mode also works at the Claude limit.
 * `gateway slot judge <target>[,<target>]` sets it after each target passes the judge test
 * (`judge-test.ts`); `gateway slot judge off` removes it. The trade-off: a cheaper judge can
 * block good work, a weak one can let a risky command through, and it reads the
 * conversation (docs/gateway.md).
 */
export const JUDGE_SLOT = "anymodel-judge";

/**
 * The model slots: a fallback for a Claude model Claude Code sends by its real id (the main
 * session's Opus, a Fable agent). OFF by default: with no entry in the config's
 * `modelSlots`, `claude-opus-5-5` goes to Anthropic byte for byte, as it always did.
 * `gateway slot opus claude-opus-5-5,<target>…` turns one on. Its first target is the model
 * itself, sent byte for byte; the router moves to the next target ONLY when Anthropic
 * answers with the plan's usage limit (`planUsageLimit`), never on a short 429 or a 5xx.
 * The value is the family the slot's first target must name, so a typo such as
 * `slot opus claude-sonnet-5-5,…` is refused.
 */
export const MODEL_SLOTS: Readonly<Record<string, string>> = {
  "anymodel-fable": "fable",
  "anymodel-opus": "opus",
};

/** Is this slot key a model slot (`anymodel-opus`, `anymodel-fable`)? */
export function isModelSlot(slot: string): boolean {
  return Object.hasOwn(MODEL_SLOTS, slot);
}

/** The model slot for a model name, from the config's `modelSlots`; null when it has none. */
export function modelSlotFor(
  model: unknown,
  modelSlots: Readonly<Record<string, string>> | undefined,
): null | { model: string; slot: string } {
  if (typeof model !== "string" || !model.startsWith("claude-") || modelSlots === undefined) {
    return null;
  }
  const name = withoutContextSuffix(model);
  if (!Object.hasOwn(modelSlots, name)) return null;
  const slot = modelSlots[name];
  return slot === undefined ? null : { model: name, slot };
}

/**
 * A subscription plan's usage limit, as Anthropic answers it to a Claude login. Not a short
 * rate limit: those carry no `anthropic-ratelimit-unified-status: rejected`.
 *   - `claim`: which window ran out (`five_hour`, `seven_day`, `seven_day_opus`, …), from
 *     `anthropic-ratelimit-unified-representative-claim`; null when absent or odd.
 *   - `resetsAt`: when it resets, Unix seconds, from `anthropic-ratelimit-unified-reset`.
 */
export interface PlanLimit {
  claim: null | string;
  resetsAt: null | number;
}

/**
 * Is this answer the plan's usage limit? Status 429, `anthropic-ratelimit-unified-status:
 * rejected`, and no paid extra usage taking over (`…-overage-status` absent or `rejected`).
 * Claude Code 2.1.300 reads the same three headers the same way: its own test limiter builds
 * exactly this answer, and with it Claude Code shows "You've hit your limit · resets …" and
 * does not retry (docs/claude-code-contract.md). A 429 without these headers is a short
 * rate limit, which Claude Code retries itself: it is never a plan limit here.
 */
export function planUsageLimit(
  status: number,
  header: (name: string) => null | string,
): null | PlanLimit {
  if (status !== 429) return null;
  const state = header("anthropic-ratelimit-unified-status")?.trim().toLowerCase();
  if (state !== "rejected") return null;
  const overage = header("anthropic-ratelimit-unified-overage-status")?.trim().toLowerCase();
  if (overage !== undefined && overage !== "" && overage !== "rejected") return null;
  const claim = header("anthropic-ratelimit-unified-representative-claim")?.trim() ?? "";
  const reset = Number(header("anthropic-ratelimit-unified-reset")?.trim() ?? "");
  return {
    claim: /^[a-z0-9_]{1,40}$/.test(claim) ? claim : null,
    resetsAt: Number.isInteger(reset) && reset > 0 ? reset : null,
  };
}

/** Statuses that mean "this target cannot answer now: try the next one". */
const FALLBACK_ANY = new Set([408, 429, 500, 502, 503, 504, 529]);

/**
 * Does this status move on to the next target?
 *   - Anthropic: only the "cannot answer now" statuses. Every other answer is the real
 *     one, and reaches Claude Code unchanged: it recovers from a 400 itself (it retries
 *     without thinking fields, for one), but only from the original body.
 *   - A cheap backend that is not the last target: any status but 2xx. A 401 / 404 is a
 *     wrong key or model id, a 400 can be one model refusing another model's reasoning
 *     history: the next target may still answer (logged as a warning).
 * The caller returns the last target's answer whatever it is.
 */
export function fallbackKind(status: number, target: Target): "next" | "next-warn" | "stay" {
  if (FALLBACK_ANY.has(status)) return "next";
  if (target.kind === "backend" && (status < 200 || status > 299)) return "next-warn";
  return "stay";
}

/** Seconds a target rests after a failure, when the answer names no `retry-after`. */
export const COOLDOWN_DEFAULT_SEC = { busy: 60, down: 30 } as const;

/** The longest rest a `retry-after` can ask for; a wild value must not park a target for a day. */
export const COOLDOWN_MAX_SEC = 600;

/**
 * How long a target should rest after this answer, in seconds; null for none.
 * 429 (busy) rests `retry-after` or 60 s; 408 and 5xx / 529 (down) `retry-after` or
 * 30 s. A network error or a timeout passes `status` null and rests 30 s.
 */
export function cooldownSeconds(status: null | number, retryAfter: null | number): null | number {
  let fallback: null | number = null;
  if (status === null || status === 408 || status >= 500) fallback = COOLDOWN_DEFAULT_SEC.down;
  if (status === 429) fallback = COOLDOWN_DEFAULT_SEC.busy;
  if (fallback === null) return null;
  const seconds = status !== null && retryAfter !== null ? retryAfter : fallback;
  return Math.min(Math.max(seconds, 0), COOLDOWN_MAX_SEC);
}
