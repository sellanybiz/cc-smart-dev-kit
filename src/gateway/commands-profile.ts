/**
 * `gateway profile <name> slot <slot> <chain>|off|clear`, `gateway profile <name> fallback <slot>
 * on|off` and `gateway profile <name> remove`: one profile's chains and switches in
 * `gateway.json` (D29, GP1's schema and `profileView`), so a project can use other models per
 * slot through its URL `…/p/<name>`.
 *
 * The machine's `gateway slot` rules hold here unchanged: a slot is named as it is there
 * (`scout`, `worker`, `opus`, `fable`, `judge`, or `cc-smart-dev-kit-<name>`), every target is
 * checked against its backend's live model list, and every change is checked as a whole config
 * before it is saved (`parseConfig`), inside the state folder's lock. A profile never touches
 * the machine's own chains: it names what it changes, and a slot it does not name keeps the
 * machine's chain (`profileSlotChain`).
 *
 * The router reads the config again when the file changes, so a change is live for a session
 * using that profile from its next request.
 */
import { existsSync } from "node:fs";
import { COMMAND } from "../build-info";
import { tildify } from "../cli/paths";
import { plural } from "../cli/ui/out";
import { withLock } from "../setup/lock";
import { formatKeyPath } from "../setup/managed-json";
import { listModels } from "./backends";
import type { GatewayContext } from "./commands";
import { chainProblem, notSlotName, splitChain } from "./commands-chains";
import { gatewayOut } from "./commands-out";
import {
  fallbackOn,
  type GatewayConfig,
  loadConfigFile,
  PROFILE_NAME_RULE,
  type ProfileConfig,
  parseConfig,
  profileSlotChain,
  profileView,
  saveConfig,
} from "./config";
import { isProfileName, JUDGE_SLOT, parseTarget, slotKeyFromArg } from "./targets";

/** A slot's change inside one profile: the config after it, and its own entry before and after. */
export interface ProfileSlotPlan {
  config: GatewayConfig;
  key: string;
  name: string;
  /** The profile's own entry after: a chain, `"claude"`, or null when it names none. */
  next: null | "claude" | string[];
  /** The profile's own entry before; null when it named none (the machine's chain applied). */
  was: null | "claude" | string[];
}

/** A profile's fallback switch after a change. */
export interface ProfileFallbackPlan {
  config: GatewayConfig;
  key: string;
  name: string;
  now: boolean;
  was: boolean;
}

/** Why the profile cannot be used, in one line with the fix. */
function missingProfile(config: GatewayConfig, name: string): string {
  const names = Object.keys(config.profiles ?? {}).sort();
  return `gateway.json has no profile "${name}" (profiles: ${names.length > 0 ? names.join(", ") : "none"}). Make it: ${COMMAND} gateway profile ${name} slot <slot> <targets>`;
}

/** The targets a profile slot command must check against the live model list. */
function targetsToCheck(text: string): string[] {
  const word = text.trim();
  if (word === "clear" || word === "off" || word === "claude" || word === "custom") return [];
  return splitChain(word);
}

/** A profile with one switch of one slot removed; the field itself goes when it is empty. */
function withoutSwitch(
  profile: ProfileConfig,
  field: "breaker" | "fallback",
  slot: string,
): ProfileConfig {
  const held = profile[field];
  if (held === undefined || !Object.hasOwn(held, slot)) return profile;
  const kept = Object.entries(held).filter(([named]) => named !== slot);
  const next: ProfileConfig = { ...profile };
  if (kept.length > 0) next[field] = Object.fromEntries(kept);
  else delete next[field];
  return next;
}

/** The config with one profile replaced; `profiles` itself goes when no profile is left. */
function withProfile(
  config: GatewayConfig,
  name: string,
  profile: null | ProfileConfig,
): GatewayConfig {
  const profiles = { ...(config.profiles ?? {}) };
  if (profile === null) delete profiles[name];
  else profiles[name] = profile;
  const next: GatewayConfig = { ...config };
  if (Object.keys(profiles).length > 0) next.profiles = profiles;
  else delete next.profiles;
  return next;
}

/**
 * The config with one slot of one profile changed:
 * - `<targets>`: the profile's own chain there, after `chainProblem`'s checks, exactly as
 *   `gateway slot` checks the machine's;
 * - `off` (or `claude`): `"claude"`, plain Claude in this profile whatever the machine's chain;
 * - `clear`: the entry goes, so the machine's chain applies there again;
 * - the profile's fallback and breaker entries for a slot it no longer has a chain for go with
 *   the chain (the config refuses a switch on a slot with no chain; the judge's fallback is the
 *   one exception, and it is the judge's own switch there).
 */
export function planProfileSlotChange(
  current: GatewayConfig,
  name: string,
  slotArg: string,
  text: string,
  modelsByBackend: Record<string, null | string[]>,
): ProfileSlotPlan | { error: string } {
  if (!isProfileName(name)) return { error: PROFILE_NAME_RULE };
  const profile = Object.hasOwn(current.profiles ?? {}, name)
    ? current.profiles?.[name]
    : undefined;
  if (profile === undefined) return { error: missingProfile(current, name) };
  const key = slotKeyFromArg(slotArg);
  if (key === null) return { error: notSlotName(slotArg) };
  const word = text.trim();
  const was =
    profile.slots !== undefined && Object.hasOwn(profile.slots, key)
      ? (profile.slots[key] ?? null)
      : null;
  const slots = { ...(profile.slots ?? {}) };
  if (word === "clear") {
    if (!Object.hasOwn(slots, key)) {
      return {
        error: `${name} does not name ${key}: the machine's chain already applies there`,
      };
    }
    delete slots[key];
  } else if (word === "off" || word === "claude") {
    if (slots[key] === "claude") return { error: `${name}: ${key} is already Claude` };
    slots[key] = "claude";
  } else if (word === "custom") {
    return {
      error: `a profile has no saved chain of its own: give the slot its targets, or "off" for plain Claude there (${COMMAND} gateway slot <slot> custom saves and uses the machine's chain)`,
    };
  } else {
    const chain = word
      .split(",")
      .map((target) => target.trim())
      .filter((target) => target !== "");
    if (chain.length === 0) return { error: "give at least one target" };
    const problem = chainProblem(current, chain, modelsByBackend);
    if (problem !== null) return { error: problem };
    slots[key] = chain;
  }
  let next: ProfileConfig = { ...profile, slots };
  if (Object.keys(slots).length === 0) delete next.slots;
  // A slot with no chain in this profile has nothing to fall back to and no request to hold.
  const chained = profileSlotChain(current, next, key) !== null;
  if (!chained) {
    next = withoutSwitch(next, "breaker", key);
    if (key !== JUDGE_SLOT) next = withoutSwitch(next, "fallback", key);
  }
  const checked = parseConfig(withProfile(current, name, next));
  if ("error" in checked) return { error: checked.error };
  const saved = checked.config.profiles?.[name]?.slots;
  return {
    config: checked.config,
    key,
    name,
    next: saved !== undefined && Object.hasOwn(saved, key) ? (saved[key] ?? null) : null,
    was,
  };
}

/**
 * The config with one slot's fallback switch set inside one profile: on, the profile's next
 * target answers when the one before it fails or rests; off, only the first. A slot the
 * profile has no chain for cannot fall back (the judge is the one exception: its switch says
 * whether the worker's tested targets stand in while Claude is limited or down). A value equal
 * to what the profile's view already says without an entry is written as no entry.
 */
export function planProfileFallbackChange(
  current: GatewayConfig,
  name: string,
  slotArg: string,
  value: string,
): ProfileFallbackPlan | { error: string } {
  if (!isProfileName(name)) return { error: PROFILE_NAME_RULE };
  const profile = Object.hasOwn(current.profiles ?? {}, name)
    ? current.profiles?.[name]
    : undefined;
  if (profile === undefined) return { error: missingProfile(current, name) };
  const key = slotKeyFromArg(slotArg);
  if (key === null) return { error: notSlotName(slotArg) };
  if (value !== "on" && value !== "off") return { error: `say on or off, not "${value}"` };
  if (key !== JUDGE_SLOT && profileSlotChain(current, profile, key) === null) {
    return {
      error: `profile ${name} has no chain for ${key}, so there is nothing to fall back to. Give it one first: ${COMMAND} gateway profile ${name} slot <slot> <targets>`,
    };
  }
  const view = profileView(current, name);
  if (view === null) return { error: missingProfile(current, name) };
  const now = value === "on";
  const was = fallbackOn(view, key);
  const without = withoutSwitch(profile, "fallback", key);
  const plain = profileView(withProfile(current, name, without), name);
  if (plain === null) return { error: missingProfile(current, name) };
  const fallback = { ...(profile.fallback ?? {}) };
  if (fallbackOn(plain, key) === now) delete fallback[key];
  else fallback[key] = now;
  const next: ProfileConfig = { ...profile };
  if (Object.keys(fallback).length > 0) next.fallback = fallback;
  else delete next.fallback;
  const checked = parseConfig(withProfile(current, name, next));
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, key, name, now, was };
}

/** The config without one profile: every project pointing at it then answers as plain Claude. */
export function planProfileRemove(
  current: GatewayConfig,
  name: string,
): { config: GatewayConfig; name: string; slots: number } | { error: string } {
  if (!isProfileName(name)) return { error: PROFILE_NAME_RULE };
  const profile = Object.hasOwn(current.profiles ?? {}, name)
    ? current.profiles?.[name]
    : undefined;
  if (profile === undefined) return { error: missingProfile(current, name) };
  const checked = parseConfig(withProfile(current, name, null));
  if ("error" in checked) return { error: checked.error };
  return {
    config: checked.config,
    name,
    slots: Object.keys(profile.slots ?? {}).length,
  };
}

/** One settings file's line in `project status`: what it holds, and where it is. */
/** The second line under a slot change: what the slot is in this profile now. */
function slotNowWords(plan: ProfileSlotPlan, current: GatewayConfig): string {
  if (plan.next === "claude") return "Claude (plain Claude in this profile)";
  if (plan.next === null) {
    const machine = current.slots[plan.key];
    return `the machine's chain (${machine === undefined ? "none" : machine.join(" → ")})`;
  }
  const fallback = fallbackOn(profileView(plan.config, plan.name) ?? {}, plan.key);
  return `${plan.next.join(" → ")}  (fallback ${fallback ? "on" : "off"})`;
}

/** One entry of a profile's `slots`, as the change line shows it. */
function entryWords(entry: null | "claude" | string[]): string {
  if (entry === null) return "(none)";
  return entry === "claude" ? "claude" : entry.join(",");
}

/** The config file's change line for a profile slot, in the shape `restore` and setup print. */
function slotChangeLine(path: string, plan: ProfileSlotPlan, home: string): string {
  return `~ ${tildify(path, home)}: ${formatKeyPath(["profiles", plan.name, "slots", plan.key])}: ${entryWords(plan.was)} -> ${entryWords(plan.next)}`;
}

/**
 * Parses `gateway profile <name> <command>`: `remove`, or `slot <slot> <targets>` and
 * `fallback <slot> on|off`. Null on a wrong number of words.
 */
function profileArgs(
  args: string[],
):
  | null
  | { action: "fallback" | "slot"; name: string; slot: string; text: string }
  | { action: "remove"; name: string } {
  const [name, action, ...rest] = args;
  if (name === undefined || action === undefined) return null;
  if (action === "remove") return rest.length === 0 ? { action, name } : null;
  if (action !== "slot" && action !== "fallback") return null;
  const [slot, text] = rest;
  if (slot === undefined || text === undefined || rest.length !== 2) return null;
  return { action, name, slot, text };
}

/** `gateway profile <name> slot|fallback|remove`. */
export async function commandProfile(
  ctx: GatewayContext,
  args: string[],
  usage: string,
): Promise<number> {
  const parsed = profileArgs(args);
  if (parsed === null) {
    ctx.error(usage);
    return 2;
  }
  const { name } = parsed;
  if (!isProfileName(name)) throw new Error(PROFILE_NAME_RULE);
  const configPath = ctx.paths.gatewayConfigFile;
  if (!existsSync(configPath)) {
    throw new Error(
      `the gateway has no config yet (${tildify(configPath, ctx.paths.home)}): a profile lives in it. Make one: ${COMMAND} gateway setup --no-backend-key`,
    );
  }
  const config = loadConfigFile(configPath);
  const out = gatewayOut(ctx);

  if (parsed.action === "remove") {
    const plan = await withLock(
      ctx.paths.stateDir,
      () => {
        const planned = planProfileRemove(loadConfigFile(configPath), name);
        if ("error" in planned) throw new Error(planned.error);
        saveConfig(configPath, planned.config);
        return planned;
      },
      { waitMs: 10_000 },
    );
    out.line(
      "removed",
      `the profile "${plan.name}" (${plural(plan.slots, "slot named", "slots named")}) from ${tildify(configPath, ctx.paths.home)}`,
    );
    out.say("A project whose URL still names it answers as plain Claude.", 2);
    out.say(
      `Its projects keep working: ${COMMAND} gateway project status shows each one, and ${COMMAND} gateway project on --profile <name> points one at another profile.`,
      2,
    );
    out.verdict("ok", "Done. The router reads the config again within about a second.");
    return 0;
  }

  if (parsed.action === "fallback") {
    const plan = await withLock(
      ctx.paths.stateDir,
      () => {
        const planned = planProfileFallbackChange(
          loadConfigFile(configPath),
          name,
          parsed.slot,
          parsed.text,
        );
        if ("error" in planned) throw new Error(planned.error);
        saveConfig(configPath, planned.config);
        return planned;
      },
      { waitMs: 10_000 },
    );
    out.line(
      "changed",
      `${plan.name}: ${plan.key}: fallback ${plan.was ? "on" : "off"} → ${plan.now ? "on" : "off"}`,
    );
    out.say(
      plan.now
        ? "In this profile, the next target answers when the one before it fails or rests."
        : "In this profile, only the first target answers; when it fails, its error goes back to Claude Code.",
      2,
    );
    out.verdict(
      "ok",
      "The router uses it from its next request: it reads the config again within about a second.",
    );
    return 0;
  }

  // The model lists come from the network: read before the lock, through the context's own
  // fetch (a test's fake, so no test reaches a real backend).
  const modelsByBackend: Record<string, null | string[]> = {};
  for (const text of targetsToCheck(parsed.text)) {
    const target = parseTarget(text);
    if (!("target" in target) || target.target.kind !== "backend") continue;
    const backend = Object.hasOwn(config.backends, target.target.backend)
      ? config.backends[target.target.backend]
      : undefined;
    if (backend === undefined || Object.hasOwn(modelsByBackend, target.target.backend)) continue;
    const listed = await listModels(backend.baseUrl, backend.apiKey, 10_000, ctx.apiFetch);
    modelsByBackend[target.target.backend] =
      "models" in listed && listed.status === 200 ? listed.models.map((model) => model.id) : null;
  }
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const planned = planProfileSlotChange(
        loadConfigFile(configPath),
        name,
        parsed.slot,
        parsed.text,
        modelsByBackend,
      );
      if ("error" in planned) throw new Error(planned.error);
      saveConfig(configPath, planned.config);
      return planned;
    },
    { waitMs: 10_000 },
  );
  out.marked([slotChangeLine(configPath, plan, ctx.paths.home)]);
  out.say(`${plan.name}: ${plan.key}: ${slotNowWords(plan, config)}`, 2);
  out.verdict(
    "ok",
    "The router uses it from its next request: it reads the config again within about a second.",
  );
  return 0;
}

/** `gateway profile`'s lines in `gateway`'s command list (`USAGE`). */
export const PROFILE_HELP = `  profile <name> <command>
                         One profile's own chains and switches, over the machine's: a project
                         reaches it through its URL (project on --profile <name>). The first
                         chain makes the profile.
                           slot <slot> <targets>  <target>,<target>… from "models", checked
                                                  like "slot". A slot a profile does not name
                                                  keeps the machine's chain.
                           slot <slot> off        Plain Claude for that slot in this profile.
                           slot <slot> clear      Forget it here: the machine's chain applies.
                           fallback <slot> on|off May the next target answer in this profile?
                           remove                 Delete the profile. A project whose URL
                                                  still names it answers as plain Claude.`;
