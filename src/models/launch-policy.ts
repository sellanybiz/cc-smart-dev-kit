/**
 * The launch policy: which model and effort a launch really runs on (Claude Code's own overrides,
 * `effectiveLaunch`, then the model's resolution), the effort levels a subagent may run at, the
 * Fable reason words and UI/UX policy.
 *
 * **One home, pure.** The Agent guard judges every Agent, Task and Workflow launch by it.
 * Nothing here reads a file or the machine: the caller hands in the gateway facts
 * (`GatewayFacts`) and the environment. The hook's own parts — reading a Workflow script, the
 * agent types, the record, the messages — stay in the guard.
 *
 * **Which model, exactly.** A name is resolved the way Claude Code and the router resolve it:
 *   1. `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, when the person set one, replaces the family's model;
 *   2. with the gateway on (`ANTHROPIC_BASE_URL` in Claude Code's settings), the router sends a
 *      Claude model to its FAMILY's slot (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus
 *      → opus, fable → fable) while that slot has a chain, and the chain's first target answers.
 *      A slot with no chain is off: the Claude model itself answers, on the person's own login.
 *
 * **Tiers, not vendors** (the owner, 2026-10-16): `opus` and `fable` mean the TIER, whatever
 * model answers behind them. A premium name keeps its own tier whatever answers it: `opus`
 * whose slot or override answers with Claude Fable is still the `opus` tier — the person chose
 * that mapping (the owner, 2026-11-11). Only a name with no premium tier of its own (`sonnet`,
 * `haiku`) runs at the tier of a premium Claude model that answers it (`asNamed`).
 */

import type { GatewayConfig } from "../gateway/config";
import {
  CLAUDE_FAMILIES,
  type ClaudeFamily,
  claudeFamily,
  familyEnv,
  familySlotKey,
  isSlotKey,
  MODEL_SLOTS,
  parseTarget,
  withoutContextSuffix,
} from "../gateway/targets";
import { stringField } from "../hooks/io";
import type { Env } from "../hooks/run";

/**
 * The one reason word an agent that can change files may use on Fable: the person asked Fable
 * to build it (the owner, 2026-10-16). Every other word, and no word, is refused there — and it
 * is not one of the read-only words (`FABLE_REASONS`): a read-only agent never builds.
 */
export const FABLE_BUILD_REASON = "build";

/** What `Fable reason:` may name for a read-only agent (the owner's list). */
export const FABLE_REASONS = [
  "hard",
  "rewrite",
  "ui-design",
  "architecture",
  "review",
  "plan",
  "unsatisfied",
] as const;

/**
 * The effort levels a subagent may run at, lowest first — the one home of that list (the
 * owner's decisions D5 and D13): `low` is refused on every model, a Claude model and a gateway
 * backend alike. Claude picks the level by the task on every tier, whatever model answers it
 * (the owner, 2026-10-26: no level is forced on a backend; a person who wants a backend at one
 * level pins it in the router, D64). One rule names a level on top of this one: an `opus`-tier
 * launch asks the person at `OPUS_ASK_EFFORT`.
 */
export const ALLOWED_EFFORTS = ["medium", "high", "xhigh", "max"] as const;

/** One level of `ALLOWED_EFFORTS`. */
export type Effort = (typeof ALLOWED_EFFORTS)[number];

/**
 * The one effort at which an `opus`-tier launch asks the person (the owner's decision D11):
 * every lower level of `ALLOWED_EFFORTS` runs with no question, for any agent and any purpose.
 */
export const OPUS_ASK_EFFORT = "max";

/** The levels an `opus`-tier launch runs at with no question: every allowed one below `max`. */
export const OPUS_FREE_EFFORTS = ALLOWED_EFFORTS.filter((one) => one !== OPUS_ASK_EFFORT);

/** True when an effort a launch names is one a subagent may run at (any case). */
export function effortAllowed(effort: string): boolean {
  return (ALLOWED_EFFORTS as readonly string[]).includes(effort.toLowerCase());
}

/**
 * Where UI/UX work may run (the owner's decision D50, 2026-10-22): design judgment, layout,
 * components, pages and styling run only on these tiers, at this effort or above. Affordable
 * models — Haiku, Sonnet, a backend target behind a slot — are not good at UI/UX design today.
 * **Checking is not design:** the `ui-verifier` may run on `sonnet`, and the design verdict is
 * made on one of these tiers.
 *
 * **One home.** The Agent guard's UI rule reads these
 * two values. Lift the rule in one change — both values here, with the guard's and the
 * policy's tests — when a cheap open-source model proves good at UI/UX.
 */
export const UI_POLICY = {
  /** The lowest effort UI/UX work runs at. */
  minEffort: "high",
  /** The tiers UI/UX work may run on, in the order a message names them. */
  tiers: ["opus", "fable"],
} as const satisfies { minEffort: Effort; tiers: readonly string[] };

/**
 * The reason words that declare UI/UX work (D50), read as the first word of an
 * `Opus reason:` or `Fable reason:` line: `ui` and `ui-design` (the Fable
 * read-only word). A prompt is never sniffed for keywords: the declaration is the contract.
 */
export const UI_REASON_WORDS = ["ui", "ui-design"] as const;

/** True when a launch's tier is one UI/UX work may run on (D50). */
export function uiTierAllowed(real: LaunchModel): boolean {
  return real.tier !== null && UI_POLICY.tiers.includes(real.tier);
}

/** True when an effort is at or above UI/UX work's minimum; false for none or an unknown one. */
export function uiEffortAllowed(effort: null | string): boolean {
  if (effort === null) return false;
  const levels = ALLOWED_EFFORTS as readonly string[];
  return levels.indexOf(effort.toLowerCase()) >= levels.indexOf(UI_POLICY.minEffort);
}

/** The efforts UI/UX work may run at, lowest first: the minimum and above. */
export const UI_EFFORTS = ALLOWED_EFFORTS.filter((one) => uiEffortAllowed(one));

/**
 * UI/UX work's rule in words, for a refusal: the tiers and the efforts it may run at, built
 * from `UI_POLICY` (`opus` or `fable` at `high`, `xhigh` or `max`).
 */
export function uiRuleText(): string {
  const named = (levels: readonly string[]) =>
    levels.length < 2
      ? levels.map((one) => `\`${one}\``).join("")
      : `${levels
          .slice(0, -1)
          .map((one) => `\`${one}\``)
          .join(", ")} or \`${levels.at(-1)}\``;
  return `${named(UI_POLICY.tiers)} at ${named(UI_EFFORTS)}`;
}

/** The model a launch will really run on, after Claude Code's env and the gateway config. */
export interface LaunchModel {
  /** True when the first target that answers is a Claude model (the person's own login). */
  claude: boolean;
  /** The family the launch's name stands for: a family name and a Claude id keep their own
   * through an override or their family's slot, a slot key reads its first target's, and null
   * is anything the guard cannot read as a family (a backend target, a name no rule knows). */
  family: ClaudeFamily | null;
  /** How the launch names it: the resolved id, the slot's first target, or the name as sent. */
  model: string;
  /**
   * The premium tier the launch's NAME stands for (owner, 2026-10-16): `opus` and `fable` mean
   * the tier, whatever model answers behind them — Claude, a backend through the gateway, a
   * name no rule knows. Null for everything else (Haiku, Sonnet, an affordable target).
   */
  tier: "fable" | "opus" | null;
}

/**
 * What the policy knows of the gateway: its config (null when there is none, or it cannot be
 * used), and whether Claude Code's settings send the requests to it.
 */
export interface GatewayFacts {
  config: GatewayConfig | null;
  /** True when Claude Code's settings point at the router (`ANTHROPIC_BASE_URL`). */
  gatewayOn: boolean;
}

/** The premium tier a family name or a Claude id stands for; null for Haiku and Sonnet. */
function premiumTier(family: ClaudeFamily | null): "fable" | "opus" | null {
  return family === "fable" || family === "opus" ? family : null;
}

/**
 * The tier a Claude reading carries: its family when that is `opus` or `fable`, null for Haiku
 * and Sonnet, and for a family the guard cannot read — a Claude id from the future, a name no
 * rule knows (`best`, `default`, …) — the strict one, `opus`, exactly as the rules treated it
 * before there were tiers.
 */
function tierOfReading(family: ClaudeFamily | null): "fable" | "opus" | null {
  return family === null ? "opus" : premiumTier(family);
}

/**
 * The first target of the slot that answers for a Claude family, the way the router picks it
 * (`familySlotKey`, `FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable →
 * fable). Null when the gateway is off (Claude Code sends nothing to the router), when there
 * is no config, and when the slot has no chain: it is off, and the Claude model itself answers.
 */
function familyFirstTarget(gateway: GatewayFacts, family: ClaudeFamily | null): null | string {
  if (!gateway.gatewayOn || gateway.config === null || family === null) return null;
  const slot = familySlotKey(family);
  if (slot === null || !Object.hasOwn(gateway.config.slots, slot)) return null;
  return gateway.config.slots[slot]?.[0] ?? null;
}

/**
 * The tier an id stands for when a person's own override or a premium family's slot answers
 * with it: the session's model may be the backend id an `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` or
 * the opus or fable slot's first target names, and that id is still the family's tier (owner,
 * 2026-10-16). Both sides are compared without a context suffix (`[1m]`): the router sends the
 * model without it, so the id that answers never carries it.
 *
 * An id both tiers name is read in `order`. **An id that answered reads `opus` first** (the owner,
 * 2026-11-11): the person put it behind `opus`, and the kit does not second-guess that mapping.
 * An id a launch NAMES reads `fable` first, the stricter one: it asks for a model, and nothing
 * says which tier it meant.
 */
function tierOfMappedId(
  model: string,
  gateway: GatewayFacts,
  env: Env,
  order: readonly ["fable", "opus"] | readonly ["opus", "fable"],
): "fable" | "opus" | null {
  const id = withoutContextSuffix(model.trim());
  for (const premium of order) {
    const override = stringField(env[familyEnv(premium)]);
    if (override !== null && withoutContextSuffix(override.trim()) === id) return premium;
    const first = familyFirstTarget(gateway, premium);
    if (first !== null && withoutContextSuffix(first.trim()) === id) return premium;
  }
  return null;
}

/**
 * The Claude family of the model that answers a launch: read from its id, or the family name
 * itself when no slot or override stands in (`opus`). Null for a backend and a name no rule
 * reads. Never the NAME's family, which `LaunchModel.family` keeps through a slot: `opus` whose
 * slot answers with Claude Fable answers as `fable` here.
 */
export function answeringFamily(real: LaunchModel): ClaudeFamily | null {
  if (!real.claude) return null;
  return (
    claudeFamily(real.model) ??
    CLAUDE_FAMILIES.find((one) => one === real.model.toLowerCase()) ??
    null
  );
}

/**
 * A name's reading once its override or its family's slot has answered with `answered`. The
 * NAME's family and tier stay the launch's (owner, 2026-10-16): `opus` is the `opus` tier when a
 * backend answers it, and when Claude Fable answers it (owner, 2026-11-11) — the person mapped
 * that slot, so the tier's rules are `opus`'s, not Fable's. Only a name with no premium tier
 * (`sonnet`, `haiku`) takes the tier of a premium Claude model that answers it, because it would
 * otherwise spend that usage with no rule at all (`sonnet` whose worker chain is a Claude Opus id
 * is the `opus` tier). A model the guard cannot read as a family never raises the tier.
 */
function asNamed(
  answered: LaunchModel,
  family: ClaudeFamily | null,
  tier: "fable" | "opus" | null,
): LaunchModel {
  // The model that really answers decides the raise: `sonnet` whose override is a Claude Opus id
  // whose own slot answers with Claude Fable spends Fable, though that inner hop kept `opus`.
  const real = premiumTier(answeringFamily(answered) ?? answered.family);
  return tier === null && real !== null
    ? { ...answered, family: real, tier: real }
    : { ...answered, family, tier };
}

/**
 * The model behind a Claude family once the router has had it: its slot's first target while
 * the gateway is on and the slot has a chain, else `claude` (the Claude model answers). The
 * family and the tier are the ones the NAME stands for, or — for a name with no premium tier —
 * the premium tier of what answers (`asNamed`).
 */
function throughFamilySlot(
  claude: string,
  family: ClaudeFamily | null,
  gateway: GatewayFacts,
): LaunchModel {
  const tier = tierOfReading(family);
  const first = familyFirstTarget(gateway, family);
  if (first === null) return { claude: true, family, model: claude, tier };
  return asNamed(resolveTarget(first), family, tier);
}

/** A Claude id, slot key or `<backend>:<model>` as the model behind the launch. */
function resolveName(text: string, gateway: GatewayFacts): LaunchModel {
  // A Claude id, also as a cloud provider names it (`us.anthropic.claude-fable-…`).
  const family = claudeFamily(text);
  if (family !== null || text.startsWith("claude-")) {
    return throughFamilySlot(text, family, gateway);
  }
  if (isSlotKey(text)) {
    const first = gateway.config?.slots[text]?.[0];
    const model =
      first === undefined
        ? { claude: false, family: null, model: text, tier: null }
        : resolveTarget(first);
    // A model slot (`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`) is its family's tier,
    // whether or not the config names a target for it.
    const slotFamily = MODEL_SLOTS[text];
    return slotFamily === "fable" || slotFamily === "opus"
      ? { ...model, family: slotFamily, tier: slotFamily }
      : model;
  }
  const parsed = parseTarget(text);
  if ("target" in parsed && parsed.target.kind === "backend") {
    return { claude: false, family: null, model: text, tier: null };
  }
  // A name no rule knows (`best`, `opusplan`, `default`, `inherit`, anything else): never read
  // as an affordable slot. Only a slot key and a `<backend>:<model>` target are affordable —
  // every other name gets the strictest rule, the one for a Claude id with no family to read.
  return { claude: true, family: null, model: text, tier: "opus" };
}

/** A slot target as the model behind the launch. */
function resolveTarget(text: string): LaunchModel {
  const parsed = parseTarget(text);
  if (!("target" in parsed) || parsed.target.kind !== "anthropic") {
    return { claude: false, family: null, model: text, tier: null };
  }
  const family = claudeFamily(parsed.target.model);
  return { claude: true, family, model: parsed.target.model, tier: tierOfReading(family) };
}

/**
 * The model behind a launch that names `name`: a family name goes through Claude Code's
 * environment, then — with the gateway on — its family's slot; a Claude id through its family's
 * slot; anything else is resolved as itself. **A family name keeps its tier** through the
 * override and the slot: `opus` is the premium tier even when the target that answers it is not
 * a Claude model.
 */
export function resolveLaunchModel(name: string, gateway: GatewayFacts, env: Env): LaunchModel {
  const text = withoutContextSuffix(name.trim());
  const family = CLAUDE_FAMILIES.find((one) => one === text.toLowerCase());
  if (family === undefined) {
    // A person's own override may name this id for a family: it is that family's tier then,
    // unless the id itself proves its family (a reading with no family is only a default). A
    // launch that names an id asks for that model: `claude-fable-…` named outright is Fable,
    // even where the opus slot answers with it. Only an id that already ANSWERED reads as the
    // tier it was mapped behind (`resolveSessionModel`).
    const mapped = tierOfMappedId(text, gateway, env, ["fable", "opus"]);
    const resolved = resolveName(text, gateway);
    if (mapped === null || (resolved.tier !== null && resolved.family !== null)) return resolved;
    return { ...resolved, family: resolved.family ?? mapped, tier: mapped };
  }
  const tier = premiumTier(family);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) {
    // The NAME's family stays the launch's family: `opus` is the `opus` tier even when a backend
    // answers it, so the record, the free `opus` path and the messages read the same family; a
    // name with no premium tier takes the tier of a premium Claude model that answers (`asNamed`).
    return asNamed(resolveName(withoutContextSuffix(override.trim()), gateway), family, tier);
  }
  return throughFamilySlot(text, family, gateway);
}

/**
 * How the session's own model was read: a name Claude Code asked for (the start's or a switch's
 * model, `ANTHROPIC_MODEL`), or the id that ANSWERED its last turn (the transcript).
 */
export interface SessionModel {
  model: string;
  /** True for the id that answered: the router already chose it, so it is never routed again. */
  served: boolean;
}

/**
 * The model behind the session's own model (a fork, FORCE with no model, the Fable-session
 * hook). A name Claude Code asked for is resolved as a launch's (`resolveLaunchModel`). An id
 * that answered is the model itself — never sent through a slot again, since the router already
 * did — and its tier is the one the person mapped it behind (`tierOfMappedId`, `opus` first),
 * else its own family's (owner, 2026-11-11): a session whose opus slot answers with Claude Fable
 * leaves `claude-fable-…` in its transcript, and that is the `opus` tier.
 *
 * The transcript cannot tell that from a session switched to Fable outright: both answer with
 * the same id. A switch itself is read from the name it asked for, so it still gets the Fable
 * line; only a later read of the transcript takes the mapped tier.
 */
export function resolveSessionModel(
  session: SessionModel,
  gateway: GatewayFacts,
  env: Env,
): LaunchModel {
  if (!session.served) return resolveLaunchModel(session.model, gateway, env);
  const text = withoutContextSuffix(session.model.trim());
  const family = claudeFamily(text);
  const own: LaunchModel =
    family !== null || text.startsWith("claude-")
      ? { claude: true, family, model: text, tier: tierOfReading(family) }
      : resolveTarget(text);
  const mapped = tierOfMappedId(text, gateway, env, ["opus", "fable"]);
  return mapped === null ? own : { ...own, family: mapped, tier: mapped };
}

/**
 * The gateway slot that answers a launch named `name`, followed the way `resolveLaunchModel`
 * follows it: a family name through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, then — a family name or a
 * Claude id — its family's slot while that slot has a chain; a slot key is its own slot. Null
 * when no slot answers: the gateway off, a family slot with no chain (Claude itself answers), a
 * `<backend>:<model>` named directly.
 */
export function answeringSlot(name: string, gateway: GatewayFacts, env: Env): null | string {
  if (!gateway.gatewayOn || gateway.config === null) return null;
  let text = withoutContextSuffix(name.trim());
  const family = CLAUDE_FAMILIES.find((one) => one === text.toLowerCase());
  if (family !== undefined) {
    const override = stringField(env[familyEnv(family)]);
    if (override === null) {
      return familyFirstTarget(gateway, family) === null ? null : familySlotKey(family);
    }
    text = withoutContextSuffix(override.trim());
  }
  if (isSlotKey(text)) return text;
  const idFamily = claudeFamily(text);
  return familyFirstTarget(gateway, idFamily) === null || idFamily === null
    ? null
    : familySlotKey(idFamily);
}

/**
 * Claude Code's switch that puts every subagent, teammate and Workflow agent on one model:
 * `CLAUDE_CODE_SUBAGENT_MODEL` when it is set too, else the session's own model.
 */
export const SUBAGENT_MODEL_FORCE_ENV = "CLAUDE_CODE_SUBAGENT_MODEL_FORCE";

/** The subagent model Claude Code uses: forced with `SUBAGENT_MODEL_FORCE_ENV`, else a default. */
export const SUBAGENT_MODEL_ENV = "CLAUDE_CODE_SUBAGENT_MODEL";

/** The model every Workflow `agent()` runs on, whatever the script names. */
export const WORKFLOW_SUBAGENT_MODEL_ENV = "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL";

/** The effort every subagent runs at, whatever the call names (and the session's own). */
export const EFFORT_LEVEL_ENV = "CLAUDE_CODE_EFFORT_LEVEL";

/**
 * The `EFFORT_LEVEL_ENV` value that lets the model pick its own default level (Claude Code's
 * docs). The person chose it, like a fork's inherited effort: a launch is never refused for it,
 * and it is never `max` — no model's default is — so the opus tier does not ask.
 */
export const EFFORT_AUTO = "auto";

/** What a launch asks for, before Claude Code's overrides: the call's own fields. */
export interface LaunchAsked {
  /** The effort the call names; null when it names none. */
  effort: null | string;
  /** True for `subagent_type: "fork"`: it runs on the session's model and effort. */
  fork: boolean;
  /** The model the call names; null when it names none. */
  model: null | string;
  /** True for a Workflow script's `agent()` launch, false for the Agent (or Task) tool. */
  workflow: boolean;
}

/**
 * Where the model a launch really runs on comes from: the call itself, the session (a fork),
 * `SUBAGENT_MODEL_FORCE_ENV` with `SUBAGENT_MODEL_ENV` (`force`) or without it
 * (`force-session`: the session's own model), or `WORKFLOW_SUBAGENT_MODEL_ENV`.
 */
export type ModelSource = "call" | "frontmatter" | "fork" | "force" | "force-session" | "workflow";

/** The model and effort a launch really runs on, and which override set each. */
export interface EffectiveLaunch {
  /** The effort it runs at; null when nothing names one (a fork runs at the session's own). */
  effort: null | string;
  /** `EFFORT_LEVEL_ENV` when that variable set the effort; null when the call (or a fork) did. */
  effortFrom: null | "frontmatter" | typeof EFFORT_LEVEL_ENV;
  /**
   * The model name it runs on; null when the call names none and no override names one, or when
   * it runs on the session's own model and the session's model cannot be read.
   */
  model: null | string;
  modelFrom: ModelSource;
}

/** True where Claude Code reads a switch as on: `1`, `true`, `yes` or `on`, any case. */
export function switchOn(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

/** A model variable as Claude Code reads it: trimmed; empty and `inherit` are unset. */
function modelVariable(env: Env, name: string): null | string {
  const value = stringField(env[name])?.trim() ?? "";
  return value === "" || value.toLowerCase() === "inherit" ? null : value;
}

/**
 * The model and effort a launch will REALLY run on, after Claude Code's own overrides — the
 * order proved live on 2.1.306 (and in Claude Code's docs):
 *
 * - **Model.** `SUBAGENT_MODEL_FORCE_ENV` comes first: the model in `SUBAGENT_MODEL_ENV`, else
 *   the session's own. Then `WORKFLOW_SUBAGENT_MODEL_ENV`, for a Workflow agent only. Then the
 *   call's own `model`. A plain `SUBAGENT_MODEL_ENV` never beats the call's model: it is only a
 *   default for a call that names none, after the agent's own definition. The caller supplies
 *   that definition; an unseen definition stays refused rather than guessing a default.
 * - **Effort.** `EFFORT_LEVEL_ENV` beats the call's `effort`, then definition, then session.
 * - **A fork** runs on the session's own model under every override (the docs: "These
 *   subagents still run on the main conversation's model: a fork"), and is judged at the effort
 *   it names, else at the session's own — the guard's rule before these overrides.
 *
 * Under FORCE Claude Code removes `model` from the Agent tool, and under `EFFORT_LEVEL_ENV` it
 * removes `effort`: the call carries none, and this is what the launch runs on all the same.
 * The built-in Explore agent under FORCE alone runs on its own listed model (Opus where the
 * session runs Fable); a person's own agent named `Explore` runs on the session's. A hook cannot
 * tell the two apart, so both read as the session's model: the stricter reading.
 *
 * The caller reads these variables from the hook's own environment: a settings file's `env`
 * reaches it there too (proved live on 2.1.306, for `--settings` and a project's
 * `.claude/settings.json`).
 */
export function effectiveLaunch(
  launch: LaunchAsked,
  env: Env,
  sessionModel: null | string,
  definition: { model: null | string; effort: null | string } | null = null,
): EffectiveLaunch {
  // A fork keeps the guard's own rule: the session's model, and the effort the call names, if
  // any (none: the session's own, which the person chose).
  if (launch.fork) {
    return { effort: launch.effort, effortFrom: null, model: sessionModel, modelFrom: "fork" };
  }
  const level = stringField(env[EFFORT_LEVEL_ENV])?.trim().toLowerCase() ?? "";
  const effort: Pick<EffectiveLaunch, "effort" | "effortFrom"> =
    level === ""
      ? launch.effort !== null
        ? { effort: launch.effort, effortFrom: null }
        : {
            effort: definition?.effort ?? null,
            effortFrom: definition?.effort ? "frontmatter" : null,
          }
      : { effort: level, effortFrom: EFFORT_LEVEL_ENV };
  if (switchOn(env[SUBAGENT_MODEL_FORCE_ENV])) {
    const forced = modelVariable(env, SUBAGENT_MODEL_ENV);
    return forced === null
      ? { ...effort, model: sessionModel, modelFrom: "force-session" }
      : { ...effort, model: forced, modelFrom: "force" };
  }
  const workflowModel = launch.workflow ? modelVariable(env, WORKFLOW_SUBAGENT_MODEL_ENV) : null;
  if (workflowModel !== null) return { ...effort, model: workflowModel, modelFrom: "workflow" };
  if (launch.model !== null) return { ...effort, model: launch.model, modelFrom: "call" };
  const model = definition?.model?.trim() ?? "";
  if (model !== "" && model.toLowerCase() !== "inherit") {
    return { ...effort, model, modelFrom: "frontmatter" };
  }
  // Deliberately require a chosen model; environment defaults cannot prove unseen SDK definitions.
  return { ...effort, model: null, modelFrom: "call" };
}
