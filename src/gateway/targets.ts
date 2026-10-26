/**
 * Where one request to the AI gateway goes: parsing the slot targets, and picking the
 * route for a model name.
 *
 * Claude Code sends every request to the local router (`ANTHROPIC_BASE_URL`), with the
 * person's own Claude login on it. The model name decides the way out:
 *   - `claude-…`               → the slot for its family (`familySlotFor`: haiku → scout,
 *                                sonnet → worker, opus → opus, fable → fable) when that slot
 *                                has a chain; with none (the slot is off), Anthropic,
 *                                untouched (the own login is meant for it);
 *   - a slot key (`cc-smart-dev-kit-scout`)  → the slot's targets, in order;
 *   - `<backend>:<model>`      → that backend, no fallback (an ad-hoc try);
 *   - anything else            → Anthropic, untouched: never a guess at a backend.
 * A slot's next target answers only while the slot's fallback switch is on (`fallbackOn`,
 * config.ts); the router never adds a target of its own, Claude included.
 * An alias from the config's `aliases` is resolved first (`resolveAlias`), so an old
 * model name reaches its new slot. One request is recognised by its body, not its name:
 * auto mode's safety check (`isAutoModeGuard`, on the request as it came) goes to the
 * `cc-smart-dev-kit-judge` slot (`JUDGE_SLOT`) when it has a tested chain, or stays on
 * Claude in a config without one (`resolveRequestRoute`), also when an alias would send it
 * to an affordable backend.
 *
 * A target is written as text in the config and on the command line (and an explicit
 * `<backend>:<model>` works as a model name too, for a one-off try):
 *   - `claude-sonnet-5-5`  → Anthropic, the body's model set to that id;
 *   - `<backend>:<model>`  → that backend (its own API key), e.g.
 *                            `omniroute:<model>`. The model part may hold `:` or
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

/** An affordable backend from the config's `backends`; it gets the backend's own key. */
export interface BackendTarget {
  backend: string;
  kind: "backend";
  model: string;
}

export type Target = AnthropicTarget | BackendTarget;

/** Claude Code's effort words, plus the backend-only value that turns reasoning off. */
export const BACKEND_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type BackendEffort = (typeof BACKEND_EFFORT_LEVELS)[number];

/** A backend name: lower-case letters, digits, `-` and `_`. */
const BACKEND_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** The prefix of every slot key. */
export const SLOT_PREFIX = "cc-smart-dev-kit-";

/** A slot key: `cc-smart-dev-kit-` and a short lower-case name. (A model slot: `MODEL_SLOTS`.) */
const SLOT_KEY = /^cc-smart-dev-kit-[a-z0-9][a-z0-9-]*$/;

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

/**
 * A Claude model id as the router records one it saw (`seenClaude`): `claude-`, then up to 80
 * letters, digits, `.`, `_`, `@` or `-`, without `[1m]`. Anything else a client sends as a
 * model name is not kept: the record feeds a list a person picks a target from.
 */
const CLAUDE_MODEL_ID = /^claude-[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$/;

export function isClaudeModelId(name: string): boolean {
  return CLAUDE_MODEL_ID.test(name);
}

/** A model name without the `[1m]` context suffix. */
export function withoutContextSuffix(name: string): string {
  return name.replace(CONTEXT_SUFFIX, "");
}

/**
 * The path a project's `ANTHROPIC_BASE_URL` carries to reach a profile: `…/p/<profile>`
 * (owner D29, `docs/gateway.md` § Profiles). One home: the router strips it, and the
 * commands that write a project's URL build it from this.
 */
export const PROFILE_PATH_PREFIX = "/p/";

/**
 * A profile name, as a URL segment and as a key in `gateway.json`'s `profiles`: lower-case
 * letters, digits and `-`, at most 64. A name the pattern refuses is never a profile and is
 * never looked up, so a hand-written config key such as `__proto__` cannot be reached from a
 * path, and a typo answers as plain Claude instead of an error.
 */
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isProfileName(name: string): boolean {
  return PROFILE_NAME.test(name);
}

/** What a request path says about a profile: the name it carries, and the path under it. */
export interface ProfilePath {
  /** The segment after `/p/`, exactly as the path carried it (check `isProfileName`); null: no prefix. */
  name: null | string;
  /** The path without the `/p/<name>` prefix: what the route branches read and Anthropic gets. */
  path: string;
}

/**
 * Split a request path (its query is not part of a path) into the profile it names and the
 * path under it (owner D29):
 *   - `/p/<name>/v1/messages` → name `<name>`, path `/v1/messages`;
 *   - `/p/<name>` and `/p/<name>/` → name `<name>`, path `/`;
 *   - no `/p/` prefix, or none with a name after it (`/p/`, `/p//…`) → no name, path as it came.
 * The rest of the path is kept exactly as it came, so the bytes Anthropic gets are the bytes
 * Claude Code sent minus the prefix. Pure: the caller decides what an unknown name means
 * (plain Claude, never an error a session cannot read).
 */
export function profileFromPath(pathname: string): ProfilePath {
  if (!pathname.startsWith(PROFILE_PATH_PREFIX)) return { name: null, path: pathname };
  const rest = pathname.slice(PROFILE_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  const name = slash === -1 ? rest : rest.slice(0, slash);
  if (name === "") return { name: null, path: pathname };
  return { name, path: slash === -1 ? "/" : rest.slice(slash) };
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
 * The slot key a person types on the command line: `scout` means `cc-smart-dev-kit-scout`, `cc-smart-dev-kit-worker`
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
  /** `cc-smart-dev-kit-…` that no slot has: an error, never a guess. */
  | { kind: "unknown-slot"; slot: string };

/** The parts of the config the route depends on. */
export interface RouteConfig {
  backends: Record<string, unknown>;
  slots: Record<string, string[]>;
}

/**
 * The route for a model name. Anything the router does not recognise goes to Anthropic
 * as it came: that is where the own login is meant to go, and Anthropic answers the
 * error. An affordable backend is reached only by name (a slot, or an explicit
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
 * `<severity>N` answers; and the `sonnet` alias (with the gateway on, `cc-smart-dev-kit-worker`), no
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
 * config has no `cc-smart-dev-kit-judge` slot (with one, the router sends every check there before
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
 * The judge for auto mode's safety checks, opt-in and OFF by default: a new config has no
 * such slot, and every check then goes to Claude (`resolveRequestRoute`). With a chain, the
 * check goes to the judge's targets in order, like any slot's request (the next one only
 * while its fallback switch is on); the router uses only a target that passed the judge test
 * (`judge-test.ts`, `judgeTargetTested`). `gateway slot judge <target>[,<target>]` sets it
 * after each target passes; `gateway slot judge off` removes it. The trade-off: an affordable
 * judge can block good work, a weak one can let a risky command through, and it reads the
 * conversation (docs/gateway.md).
 */
export const JUDGE_SLOT = "cc-smart-dev-kit-judge";

/**
 * The model slots: the slots for the premium families, Opus and Fable, which Claude Code
 * sends by their real ids (the main session's Opus, an `opus` or `fable` agent). Like every
 * slot: OFF by default (no chain: the request goes to Anthropic byte for byte), any target in
 * any order once the person gives it a chain. The value is the family the slot answers for.
 */
export const MODEL_SLOTS: Readonly<Record<string, ClaudeFamily>> = {
  "cc-smart-dev-kit-fable": "fable",
  "cc-smart-dev-kit-opus": "opus",
};

/** Is this slot key a model slot (`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`)? */
export function isModelSlot(slot: string): boolean {
  return Object.hasOwn(MODEL_SLOTS, slot);
}

/** The Claude families a model id can name: `claude-<family>-…` or `claude-3-5-<family>-…`. */
export const CLAUDE_FAMILIES = ["fable", "haiku", "opus", "sonnet"] as const;
export type ClaudeFamily = (typeof CLAUDE_FAMILIES)[number];

/**
 * Claude Code's own override for a family: `ANTHROPIC_DEFAULT_OPUS_MODEL`, … (all four exist
 * in Claude Code 2.1.301). One home, here beside the families: the launch policy resolves a
 * model through it, and the gateway's settings reader reports a project file that sets one.
 */
export function familyEnv(family: ClaudeFamily): string {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
}

/**
 * The slot that answers for Sonnet: the worker. Its tested targets also judge auto mode's
 * checks while Claude cannot (owner D44, `workerJudgeTargets` in `config.ts`).
 */
export const WORKER_SLOT = "cc-smart-dev-kit-worker";

/**
 * The slot that answers for each Claude family, when it has a chain. Read from the id Claude
 * Code sends, so a newer version of a family (`claude-opus-6-0`) reaches its slot with no
 * change here. Scout and worker are Haiku's and Sonnet's: background calls, `haiku` and
 * `sonnet` agents, and a main session on Sonnet.
 */
export const FAMILY_SLOTS: Readonly<Record<string, ClaudeFamily>> = {
  "cc-smart-dev-kit-scout": "haiku",
  [WORKER_SLOT]: "sonnet",
  ...MODEL_SLOTS,
};

/**
 * A provider's prefix before a Claude id, as a cloud names its copy of the model:
 * `us.anthropic.claude-…`, `anthropic.claude-…` (dot-separated words). Never one with a `:`
 * or a `/` in it: `<backend>:<model>` is a backend's model, whatever its name says.
 */
const PROVIDER_PREFIX = /^(?:[a-z0-9-]+\.)*claude-/;

/**
 * The Claude family a model id names, by its `-<family>-` part (`claude-opus-5-5`,
 * `claude-3-5-haiku-20241022`, `us.anthropic.claude-fable-5-1-20261001-v1:0`), `[1m]`
 * ignored; null for anything else (a backend's model, a slot key, a Claude id that names no
 * family).
 */
export function claudeFamily(model: string): ClaudeFamily | null {
  const name = `${withoutContextSuffix(model).toLowerCase()}-`;
  const prefix = PROVIDER_PREFIX.exec(name);
  if (prefix === null) return null;
  const id = name.slice(prefix[0].length - "claude-".length);
  return CLAUDE_FAMILIES.find((family) => id.includes(`-${family}-`)) ?? null;
}

/** A Claude model's version: `claude-opus-5-5` is 5.5, `claude-opus-5` is 5.0. */
export interface ClaudeVersion {
  major: number;
  minor: number;
}

/**
 * A version at the start of `text`: `5-5`, `4`, never a date (`4-20250514` is 4.0: a minor
 * has one or two digits, a date eight).
 */
const VERSION_AT_START = /^(\d{1,3})(?:-(\d{1,2})(?!\d))?(?!\d)/;

/**
 * The version a Claude model id names, `[1m]` and a provider's prefix ignored: after its
 * family (`claude-opus-4-5-20251101` → 4.5, `claude-sonnet-5` → 5.0,
 * `us.anthropic.claude-fable-5-1-20261001-v1:0` → 5.1), or before it in the older form
 * (`claude-3-5-haiku-20241022` → 3.5). Null when the id names no family, or no version
 * (`claude-opus-latest`).
 */
export function claudeVersion(model: string): ClaudeVersion | null {
  const family = claudeFamily(model);
  if (family === null) return null;
  const name = `${withoutContextSuffix(model).toLowerCase()}-`;
  const id = name.slice((PROVIDER_PREFIX.exec(name)?.[0].length ?? 0) - "claude-".length);
  const at = id.indexOf(`-${family}-`);
  const before = id.slice("claude-".length, at);
  const after = id.slice(at + family.length + 2);
  const match = VERSION_AT_START.exec(before === "" ? after : before);
  if (match === null) return null;
  return { major: Number(match[1]), minor: match[2] === undefined ? 0 : Number(match[2]) };
}

/** Is `version` this one, or newer? */
export function versionAtLeast(version: ClaudeVersion, since: ClaudeVersion): boolean {
  return version.major !== since.major ? version.major > since.major : version.minor >= since.minor;
}

/**
 * The slot key that answers for a Claude family (`familySlotKey("opus")` →
 * `cc-smart-dev-kit-opus`), from `FAMILY_SLOTS`; null for a family no slot answers for.
 */
export function familySlotKey(family: ClaudeFamily): null | string {
  return Object.keys(FAMILY_SLOTS).find((key) => FAMILY_SLOTS[key] === family) ?? null;
}

/**
 * The slot for a Claude model a request names (`familySlotFor("claude-opus-6-0")` →
 * `cc-smart-dev-kit-opus`), with the id as Claude Code sent it, without `[1m]`; null for a
 * name that is not a Claude id of a known family. Whether the slot is on is the config's.
 */
export function familySlotFor(model: unknown): null | { model: string; slot: string } {
  if (typeof model !== "string") return null;
  const family = claudeFamily(model);
  if (family === null) return null;
  const slot = familySlotKey(family);
  return slot === null ? null : { model: withoutContextSuffix(model), slot };
}

/**
 * The targets a slot's request may use: the whole chain while its fallback switch is on, its
 * first target alone while it is off. The rest stay saved, unused.
 */
export function targetsInUse<T>(targets: readonly T[], fallback: boolean): T[] {
  return fallback ? [...targets] : targets.slice(0, 1);
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
 * A reset time (Unix seconds) that a date can hold, or null. A reset header, or a hand edit of
 * the state file, may say any number, and `toISOString` throws past Date's range: a reset no
 * date can hold is no reset time at all.
 */
export function dateHeldReset(resetsAt: null | number): null | number {
  if (resetsAt === null) return null;
  return Number.isNaN(new Date(resetsAt * 1000).getTime()) ? null : resetsAt;
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
    resetsAt: Number.isInteger(reset) && reset > 0 ? dateHeldReset(reset) : null,
  };
}

/**
 * Statuses that mean "this target cannot answer now: try the next one". They are also the
 * statuses of a capacity failure, the ones the breaker holds a request for
 * (`isCapacityFailure`, `./breaker.ts`).
 */
export const CAPACITY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504, 529]);

/**
 * Is this status a capacity failure of Claude: it cannot answer now? The statuses a chain
 * moves on for (`fallbackKind`) and every other 5xx, such as the 52x a proxy in front of
 * Anthropic answers when its origin is down. For the answer that stands in for a web search
 * (D44): a search that failed any of these ways would be retried for minutes, and a note
 * naming Tavily is better at once. A chain's own list stays `fallbackKind`'s.
 */
export function capacityFailureStatus(status: number): boolean {
  return CAPACITY_STATUSES.has(status) || (status >= 500 && status <= 599);
}

/**
 * Does this status move on to the next target?
 *   - Anthropic: only the "cannot answer now" statuses. Every other answer is the real
 *     one, and reaches Claude Code unchanged: it recovers from a 400 itself (it retries
 *     without thinking fields, for one), but only from the original body.
 *   - An affordable backend that is not the last target: any status but 2xx. A 401 / 404 is a
 *     wrong key or model id, a 400 can be one model refusing another model's reasoning
 *     history: the next target may still answer (logged as a warning).
 * The caller returns the last target's answer whatever it is.
 */
export function fallbackKind(status: number, target: Target): "next" | "next-warn" | "stay" {
  if (CAPACITY_STATUSES.has(status)) return "next";
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
