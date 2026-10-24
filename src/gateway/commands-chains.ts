/**
 * The words and checks a slot's chain goes through, for `gateway slot` (the machine's chains)
 * and `gateway profile <name> slot` (a profile's): one home, so a chain is judged the same
 * wherever a person types it. Pure — no file, no network: the model lists come in as an
 * argument. No import of `commands.ts`, which imports this.
 */

import { COMMAND } from "../build-info";
import {
  fallbackOn,
  type GatewayConfig,
  judgeTargetTested,
  keptChain,
  workerJudgeTargets,
} from "./config";
import {
  formatTarget,
  JUDGE_SLOT,
  parseTarget,
  SLOT_PREFIX,
  slotKeyFromArg,
  type Target,
  WORKER_SLOT,
} from "./targets";

/**
 * The words `gateway slot <slot> …` takes in place of a chain. None of them can be a target:
 * a target is `claude-<id>` or `<backend>:<model>`.
 */
export const SLOT_WORDS: Readonly<Record<"claude" | "clear" | "custom", readonly string[]>> = {
  /** No chain in use: the chain moves to `kept`. `off` is the word of 0.5.x and before. */
  claude: ["claude", "off"],
  /** Delete the chain, in use or saved. */
  clear: ["clear"],
  /** The saved chain in use again. */
  custom: ["custom"],
};

/** A slot key's short name, as a person types it: `cc-smart-dev-kit-scout` → `scout`. */
export function slotName(key: string): string {
  return key.startsWith(SLOT_PREFIX) ? key.slice(SLOT_PREFIX.length) : key;
}

/** Why a slot name cannot be used, in the words every slot command says it. */
export function notSlotName(slotArg: string): string {
  return `"${slotArg}" is not a slot name (scout, worker, opus, fable, judge, or cc-smart-dev-kit-<name>)`;
}

/** The targets of a typed chain: `a,b` → `["a", "b"]`, each trimmed, none empty. */
export function splitChain(text: string): string[] {
  return text
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target !== "");
}

/**
 * Why a chain cannot be used, or null when it can: each target parses, its backend exists,
 * and its model is in that backend's list. `claude-…` targets are taken as they are:
 * Anthropic's list is not reachable without the person's login. The portal's `slot.check`
 * asks it too, so a target typed on the Slots page is judged exactly as `gateway slot` would.
 */
export function chainProblem(
  config: GatewayConfig,
  targets: readonly string[],
  modelsByBackend: Readonly<Record<string, null | string[]>>,
): null | string {
  for (const text of targets) {
    const parsed = parseTarget(text);
    if ("error" in parsed) return parsed.error;
    const target: Target = parsed.target;
    if (target.kind === "anthropic") continue;
    if (!Object.hasOwn(config.backends, target.backend)) {
      return `"${text}": backend "${target.backend}" is not in the config`;
    }
    const models = Object.hasOwn(modelsByBackend, target.backend)
      ? modelsByBackend[target.backend]
      : undefined;
    if (models === undefined || models === null) {
      return `"${text}": could not list the models of "${target.backend}", so it cannot be checked`;
    }
    if (!models.includes(target.model)) {
      return `"${text}": "${target.backend}" has no model "${target.model}" (see ${COMMAND} gateway models)`;
    }
  }
  return null;
}

/**
 * The chain a slot change uses, for the checks before it: the targets given, or for `custom`,
 * the chain saved for the slot. None for the other words.
 */
export function chainToCheck(config: GatewayConfig, slotArg: string, text: string): string[] {
  const word = text.trim();
  if (SLOT_WORDS.custom.includes(word)) {
    const key = slotKeyFromArg(slotArg);
    return key === null ? [] : (keptChain(config, key)?.targets ?? []);
  }
  if (SLOT_WORDS.claude.includes(word) || SLOT_WORDS.clear.includes(word)) {
    return [];
  }
  return splitChain(word);
}

/** The worker chain's backend targets that have not passed the judge test, in its order. */
function untestedWorkerTargets(config: GatewayConfig): string[] {
  return (config.slots[WORKER_SLOT] ?? []).filter((text) => {
    const parsed = parseTarget(text);
    return (
      "target" in parsed && parsed.target.kind === "backend" && !judgeTargetTested(config, text)
    );
  });
}

/**
 * What the judge is, in words, while the person set no judge chain (owner D44): Claude
 * judges every check first, as it always did; while it is limited or down, the worker
 * chain's targets that passed the judge test judge in its place, as long as the judge's
 * fallback switch is on (it is, by default). One home for the words that `gateway status`,
 * `slot judge off`, `fallback judge` and `doctor` say, and for the profile commands: a
 * profile's judge is read from the profile's view the same way (`claudeFirstJudge`).
 */
export function judgeDefaultWords(config: GatewayConfig): string {
  if (!fallbackOn(config, JUDGE_SLOT)) return "Claude judges every check, alone (fallback off)";
  const standIns = workerJudgeTargets(config).map(formatTarget);
  const untested = untestedWorkerTargets(config);
  if (standIns.length === 0) {
    return untested.length > 0
      ? `Claude judges every check, alone: no worker target has passed the judge test yet (${untested.join(", ")}; ${COMMAND} gateway setup tests them)`
      : "Claude judges every check, alone (the worker chain has no affordable target to stand in)";
  }
  return `Claude first; while Claude is limited or down: ${standIns.join(", ")} (fallback on)${untested.length > 0 ? `; not tested, so never judging: ${untested.join(", ")} (${COMMAND} gateway setup tests them)` : ""}`;
}
