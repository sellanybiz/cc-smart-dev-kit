/**
 * The status line's context segment (SL1): how much of the session's context window is used,
 * measured against the point that matters, and the reasoning effort beside it.
 *
 *   `ctx 312k · 78% of 400k · xhigh`
 *
 * **The use** is `context_window.total_input_tokens` (the tokens of the last answer's input,
 * cache included), or, when Claude Code sends only `used_percentage`, that share of
 * `context_window_size`. Claude Code shows its own gauge only near auto-compact and has no
 * setting to show it always (`docs/claude-code-contract.md`).
 *
 * **The window** is `context_window_size` (the model's full window), held down to the
 * auto-compact window the person set (the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` variable, else the
 * `autoCompactWindow` keys: `compactWindowsOf` in `src/machine/claude-settings.ts`, which the
 * caller reads). `"auto"` and no key mean the model's own window.
 *
 * **The warning** is the one the 5h and 7d segments use: from `alerts.usagePercent` the segment
 * starts with `⚠`.
 *
 * **The effort** is `effort.level` of the input, the live session value (it follows `/effort` at
 * the next refresh; Claude Code leaves it out for a model without the parameter, and then nothing
 * is shown, never a guess). On the gateway, when the slot that answers sends the request to a
 * backend target with a pinned effort (D64, `gateway effort`), the pinned one is shown: the one
 * that really answers.
 */
import { effortPin, fallbackOn, type GatewayConfig } from "../gateway/config";
import { currentFallbacks, type LimitState, scopeOfStateKey } from "../gateway/limit-state";
import {
  familySlotFor,
  resolveAlias,
  resolveRoute,
  targetsInUse,
  withoutContextSuffix,
} from "../gateway/targets";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tokens used and the model's window; `size` is null when the input names none. */
export interface ContextUse {
  size: null | number;
  tokens: number;
}

/** A tokens count the way the line says it: `950`, `312k`, `1M`, `1.3M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`;
  const millions = Math.round(tokens / 100_000) / 10;
  return `${millions}M`;
}

/** The use a status line input reports; null when it carries no context data. */
export function contextUseOf(input: unknown): ContextUse | null {
  if (!isJsonObject(input) || !isJsonObject(input.context_window)) return null;
  const { context_window_size, total_input_tokens, used_percentage } = input.context_window;
  const size =
    typeof context_window_size === "number" &&
    Number.isInteger(context_window_size) &&
    context_window_size > 0
      ? context_window_size
      : null;
  if (
    typeof total_input_tokens === "number" &&
    Number.isFinite(total_input_tokens) &&
    total_input_tokens >= 0
  ) {
    return { size, tokens: Math.round(total_input_tokens) };
  }
  if (
    size !== null &&
    typeof used_percentage === "number" &&
    Number.isFinite(used_percentage) &&
    used_percentage >= 0
  ) {
    return { size, tokens: Math.round((used_percentage / 100) * size) };
  }
  return null;
}

/** The session's own reasoning effort, as the input reports it; null when it reports none. */
export function effortOf(input: unknown): null | string {
  if (!isJsonObject(input) || !isJsonObject(input.effort)) return null;
  const level = input.effort.level;
  return typeof level === "string" && level !== "" ? level : null;
}

/**
 * The segment: the use against the window, the effort beside it. `compactWindow` is the
 * auto-compact window the variable or the keys give (null for none); the smaller of it and the
 * model's window measures the use. Without context data the effort stands alone (`effort high`);
 * with nothing to say, null.
 */
export function contextSegment(
  use: ContextUse | null,
  compactWindow: null | number,
  effort: null | string,
  warnPercent: number,
): null | string {
  if (use === null) return effort === null ? null : `effort ${effort}`;
  const window =
    use.size === null
      ? compactWindow
      : compactWindow === null
        ? use.size
        : Math.min(use.size, compactWindow);
  const parts = [`ctx ${formatTokens(use.tokens)}`];
  let warn = false;
  if (window !== null) {
    const percent = Math.round((use.tokens / window) * 100);
    warn = percent >= warnPercent;
    parts.push(`${percent}% of ${formatTokens(window)}`);
  }
  if (effort !== null) parts.push(effort);
  return `${warn ? "⚠ " : ""}${parts.join(" · ")}`;
}

/**
 * The slot a request for `model` is answered from, the way the router routes it: an alias of the
 * config first (and then the name it points to), else a Claude id of a family whose slot has a
 * chain, else a slot key. Null for a name no slot answers (Claude itself, or a backend target).
 */
function slotOf(model: string, config: GatewayConfig): null | string {
  const alias = resolveAlias(model, config.aliases);
  const family = alias === null ? familySlotFor(model) : null;
  const named = family === null ? (alias?.to ?? withoutContextSuffix(model)) : family.slot;
  const route = resolveRoute(named, config);
  return route.kind === "slot" && route.targets.length > 0 ? route.slot : null;
}

/**
 * The pinned effort of the backend target that answers `model` on this session's chain, or null
 * when there is none (no gateway config, the slot is off, its answering target is Claude or has
 * no pin). The answering target is the slot's first target, or, while a fallback record of this
 * chain says the slot is answering from a later one, that one (`profile`: null for the machine's
 * chain). `config` is the session's view (`sessionGatewayOf`), so a profile's chains apply.
 */
export function pinnedEffortOf(
  config: GatewayConfig | null,
  model: null | string,
  state: LimitState | null,
  profile: null | string,
  nowMs: number,
): null | string {
  if (config === null || model === null) return null;
  const slot = slotOf(model, config);
  if (slot === null) return null;
  let target = targetsInUse(config.slots[slot] ?? [], fallbackOn(config, slot))[0];
  if (state !== null) {
    for (const [key, record] of currentFallbacks(state, nowMs)) {
      const scope = scopeOfStateKey(key);
      if (scope.slot === slot && scope.profile === profile) target = record.target;
    }
  }
  return target === undefined ? null : (effortPin(config, slot, target) ?? null);
}
