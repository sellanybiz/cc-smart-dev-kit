/**
 * The launch policy: which model and effort a launch really runs on (Claude Code's own overrides,
 * `effectiveLaunch`, then the model's resolution), the effort levels a subagent may run at, the
 * Fable reason words, and the model and effort each kind of worker phase runs on (D46).
 *
 * **One home, pure.** The Agent guard (`src/hooks/agent-guard.ts`) judges every Agent, Task and
 * Workflow launch by it; the worker launcher and the Bash judge read the same table, so a
 * worker never starts on a model or an effort the guard would refuse for a subagent. Nothing
 * here reads a file or the machine: the caller hands in what it knows of the gateway
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
 * model answers behind them. A tier is never affordable and never forced to `max`. A name never
 * runs below the tier of what answers it: an override or a slot that answers a family name with
 * a stricter premium family makes the launch that family and its tier (`asNamed`).
 */

import type { GatewayConfig } from "../gateway/config";
import {
  CLAUDE_FAMILIES,
  type ClaudeFamily,
  claudeFamily,
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
 * owner's decisions D5 and D13): `low` is refused on every model, a Claude model and an
 * affordable gateway slot alike. Two rules name one level each, on top of this one: an
 * affordable slot must be `AFFORDABLE_EFFORT`, and an `opus`-tier launch asks the person at
 * `OPUS_ASK_EFFORT`.
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

/**
 * The effort an affordable gateway slot runs at, with the gateway on: its reasoning costs cents,
 * and an affordable model works well only there.
 */
export const AFFORDABLE_EFFORT = "max";

/** True when an effort a launch names is one a subagent may run at (any case). */
export function effortAllowed(effort: string): boolean {
  return (ALLOWED_EFFORTS as readonly string[]).includes(effort.toLowerCase());
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

/** Claude Code's override for a family: `ANTHROPIC_DEFAULT_OPUS_MODEL`, … */
export function familyEnv(family: ClaudeFamily): string {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
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
 * 2026-10-16).
 */
export function tierOfMappedId(
  model: string,
  gateway: GatewayFacts,
  env: Env,
): "fable" | "opus" | null {
  for (const premium of ["fable", "opus"] as const) {
    const override = stringField(env[familyEnv(premium)]);
    if (override !== null && withoutContextSuffix(override.trim()) === model) return premium;
    if (familyFirstTarget(gateway, premium) === model) return premium;
  }
  return null;
}

/** How strict a tier is: none, then `opus`, then `fable`. */
function tierRank(tier: "fable" | "opus" | null): number {
  return tier === "fable" ? 2 : tier === "opus" ? 1 : 0;
}

/**
 * A name's reading once its override or its family's slot has answered with `answered`. The
 * NAME's family and tier stay the launch's (owner, 2026-10-16) — `opus` is the `opus` tier even
 * when a backend answers it — unless what answers is a model the guard reads as a STRICTER
 * premium family: then the launch is that family and its tier, because it spends that tier's
 * usage (`sonnet` whose override or worker chain is a Claude Opus id is the `opus` tier). A
 * model the guard cannot read as a family never raises the tier.
 */
function asNamed(
  answered: LaunchModel,
  family: ClaudeFamily | null,
  tier: "fable" | "opus" | null,
): LaunchModel {
  const real = premiumTier(answered.family);
  return tierRank(real) > tierRank(tier)
    ? { ...answered, tier: real }
    : { ...answered, family, tier };
}

/**
 * The model behind a Claude family once the router has had it: its slot's first target while
 * the gateway is on and the slot has a chain, else `claude` (the Claude model answers). The
 * family and the tier are the ones the NAME stands for, or the stricter one of what answers
 * (`asNamed`).
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
    // unless the id itself proves its family (a reading with no family is only a default).
    const mapped = tierOfMappedId(text, gateway, env);
    const resolved = resolveName(text, gateway);
    if (mapped === null || (resolved.tier !== null && resolved.family !== null)) return resolved;
    return { ...resolved, family: resolved.family ?? mapped, tier: mapped };
  }
  const tier = premiumTier(family);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) {
    // The NAME's family stays the launch's family: `opus` is the `opus` tier even when a backend
    // answers it, so the record, the free `opus` path and the messages read the same family —
    // unless the override answers with a stricter premium family (`asNamed`).
    return asNamed(resolveName(withoutContextSuffix(override.trim()), gateway), family, tier);
  }
  return throughFamilySlot(text, family, gateway);
}

/**
 * The gateway slot that answers a launch named `name`, followed the way `resolveLaunchModel`
 * follows it: a family name through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, then — a family name or a
 * Claude id — its family's slot while that slot has a chain; a slot key is its own slot. Null
 * when no slot answers: the gateway off, a family slot with no chain (Claude itself answers), a
 * `<backend>:<model>` named directly. What a worker's record names as its `slot`.
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
 * True when an affordable model answers: one that is not Claude, behind a name of no premium
 * tier — a backend target, an affordable slot, or `haiku` / `sonnet` while their family's slot
 * chain starts with a backend. With the gateway on such a launch runs at `AFFORDABLE_EFFORT`. A
 * premium tier is never affordable, whatever answers it.
 */
export function isAffordable(real: LaunchModel): boolean {
  return !real.claude && real.tier === null;
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
 * and it is never `max` — no model's default is — so the opus tier does not ask. An affordable
 * slot still needs `AFFORDABLE_EFFORT`.
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
export type ModelSource = "call" | "fork" | "force" | "force-session" | "workflow";

/** The model and effort a launch really runs on, and which override set each. */
export interface EffectiveLaunch {
  /** The effort it runs at; null when nothing names one (a fork runs at the session's own). */
  effort: null | string;
  /** `EFFORT_LEVEL_ENV` when that variable set the effort; null when the call (or a fork) did. */
  effortFrom: null | typeof EFFORT_LEVEL_ENV;
  /**
   * The model name it runs on; null when the call names none and no override names one, or when
   * it runs on the session's own model and the session's model cannot be read.
   */
  model: null | string;
  modelFrom: ModelSource;
}

/** True where Claude Code reads a switch as on: `1`, `true`, `yes` or `on`, any case. */
function switchOn(value: string | undefined): boolean {
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
 *   default for a call that names none, after the agent's own definition, which no hook can
 *   read — so such a call stays one that names no model.
 * - **Effort.** `EFFORT_LEVEL_ENV` beats the call's `effort` and the session's own.
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
): EffectiveLaunch {
  // A fork keeps the guard's own rule: the session's model, and the effort the call names, if
  // any (none: the session's own, which the person chose).
  if (launch.fork) {
    return { effort: launch.effort, effortFrom: null, model: sessionModel, modelFrom: "fork" };
  }
  const level = stringField(env[EFFORT_LEVEL_ENV])?.trim().toLowerCase() ?? "";
  const effort: Pick<EffectiveLaunch, "effort" | "effortFrom"> =
    level === ""
      ? { effort: launch.effort, effortFrom: null }
      : { effort: level, effortFrom: EFFORT_LEVEL_ENV };
  if (switchOn(env[SUBAGENT_MODEL_FORCE_ENV])) {
    const forced = modelVariable(env, SUBAGENT_MODEL_ENV);
    return forced === null
      ? { ...effort, model: sessionModel, modelFrom: "force-session" }
      : { ...effort, model: forced, modelFrom: "force" };
  }
  const workflowModel = launch.workflow ? modelVariable(env, WORKFLOW_SUBAGENT_MODEL_ENV) : null;
  if (workflowModel !== null) return { ...effort, model: workflowModel, modelFrom: "workflow" };
  return { ...effort, model: launch.model, modelFrom: "call" };
}

/** The model a worker kind names, and the effort it runs at. */
export interface WorkerKindPolicy {
  /** What the kind is for, in a few words: what `worker kinds` prints beside it. */
  about: string;
  /** The effort when an affordable slot answers the family; the same as `effort` for a tier. */
  affordableEffort: Effort;
  /** The effort when Claude answers the family. */
  effort: Effort;
  /** The family name the launcher passes as the worker's `--model`. */
  model: "opus" | "sonnet";
}

/**
 * The kinds of worker phase, and the model and effort each runs on (the owner's decision D46).
 * Routine work — building, docs, tests — goes to `sonnet`, the worker slot: at `max` when an
 * affordable slot answers it, at `high` when Claude Sonnet does. So does code that touches
 * security, money, permissions, a schema or deploy plumbing: it builds like any other code.
 * Only work that needs design judgment — architecture, UI — goes to `opus` at `xhigh`, whatever
 * answers the tier. A kind's name may also be the word of an `Opus reason: <word>` line in a
 * launch record: the guard takes any word there, so `security` still names an Opus review. A
 * person may override one worker's model (the launcher's own flag); the table is the default.
 */
export const WORKER_KINDS = {
  build: { about: "routine building", affordableEffort: "max", effort: "high", model: "sonnet" },
  docs: {
    about: "docs and their updates",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet",
  },
  tests: { about: "tests and test runs", affordableEffort: "max", effort: "high", model: "sonnet" },
  security: {
    about: "code that touches security",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet",
  },
  money: {
    about: "code that touches money",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet",
  },
  permissions: {
    about: "code that touches permissions",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet",
  },
  schema: {
    about: "a schema or a contract",
    affordableEffort: "max",
    effort: "high",
    model: "sonnet",
  },
  deploy: { about: "deploy plumbing", affordableEffort: "max", effort: "high", model: "sonnet" },
  architecture: {
    about: "architecture and design",
    affordableEffort: "xhigh",
    effort: "xhigh",
    model: "opus",
  },
  ui: { about: "UI and UX judgment", affordableEffort: "xhigh", effort: "xhigh", model: "opus" },
} as const satisfies Record<string, WorkerKindPolicy>;

/** One kind of worker phase. */
export type WorkerKind = keyof typeof WORKER_KINDS;

/** Every kind, in the table's order: what a list or a help text shows. */
export const WORKER_KIND_NAMES = Object.keys(WORKER_KINDS) as WorkerKind[];

/** True when `value` names a worker kind, exactly. */
export function isWorkerKind(value: string): value is WorkerKind {
  return Object.hasOwn(WORKER_KINDS, value);
}

/** What one worker of a kind starts on: the name passed, its effort, and what answers it. */
export interface WorkerLaunch {
  effort: Effort;
  model: WorkerKindPolicy["model"];
  /** The model behind the name, resolved the way the guard resolves a launch's. */
  real: LaunchModel;
}

/**
 * The model and effort a worker of `kind` starts on, by the table and the gateway as the caller
 * reads it: the kind's affordable effort when an affordable model answers its family
 * (`isAffordable`), else its Claude effort. So a launch the table makes is one the Agent guard
 * allows.
 */
export function workerLaunch(kind: WorkerKind, gateway: GatewayFacts, env: Env): WorkerLaunch {
  const policy: WorkerKindPolicy = WORKER_KINDS[kind];
  const real = resolveLaunchModel(policy.model, gateway, env);
  return {
    effort: isAffordable(real) ? policy.affordableEffort : policy.effort,
    model: policy.model,
    real,
  };
}
