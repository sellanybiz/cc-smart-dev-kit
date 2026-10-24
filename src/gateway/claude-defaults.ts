/**
 * D66, the owner (2026-10-25): "by default everything will be set to Claude". A new config keeps
 * no chain and no fallback switch (`defaultConfig`, `fallbackOn`); this is the move that takes a
 * machine set up before it there, once, in `cc-smart-dev-kit setup` (`src/cli/setup.ts`).
 *
 * `planClaudeDefaults` is the pure part: the config as it will be, and one line per change,
 * old → new.
 *
 * - **Every chain goes to Claude**, the machine's and each profile's, through the same plan as
 *   `gateway slot <slot> claude` (`planSlotChange`): the machine's chain is saved in `kept`, not
 *   lost, and `gateway slot <slot> custom` uses it again; the slot's breaker switch and its
 *   0.4.x `modelSlots` entry go with it. A profile has no saved chain of its own, so its chain
 *   goes (the file's backup keeps it), and the slot is the machine's again, which is Claude. A
 *   profile's own `"claude"` stays: it says what it says.
 * - **Every fallback switch is off**: the setting is removed (off is the default now), the
 *   judge's included, a saved chain's and each profile's too. A switch that was on gets a line;
 *   an explicit off is the default's own value, so it goes without one.
 * - **Nothing else is touched**: the backends and their keys, the port, the aliases, the
 *   judge's test proofs. A profile left with nothing to say stays a profile, so its project's
 *   URL still resolves.
 */

import { planSlotChange } from "./commands";
import { slotName } from "./commands-chains";
import { type GatewayConfig, type KeptChain, parseConfig } from "./config";
import { FAMILY_SLOTS, JUDGE_SLOT } from "./targets";

export interface ClaudeDefaultsPlan {
  /** The config after the move, checked. */
  config: GatewayConfig;
  /** One line per change, old → new: the chains first, then the fallback switches that were on. */
  lines: string[];
}

/** The five slots in the order `gateway status` shows them, then any other slot by name. */
function inSlotOrder(keys: readonly string[]): string[] {
  const known = [...Object.keys(FAMILY_SLOTS), JUDGE_SLOT].filter((key) => keys.includes(key));
  return [...known, ...keys.filter((key) => !known.includes(key)).sort()];
}

/** The slots a `{"<slot>": true | false}` record turns on. */
function switchedOn(record: Readonly<Record<string, boolean>> | undefined): string[] {
  return inSlotOrder(
    Object.entries(record ?? {})
      .filter(([, on]) => on)
      .map(([slot]) => slot),
  );
}

/** A saved chain without its fallback switch. */
function withoutFallback(saved: KeptChain): KeptChain {
  const { fallback: _off, ...rest } = saved;
  return rest;
}

/** Every saved chain of `kept` without its fallback switch; undefined when none is saved. */
function keptWithoutFallback(
  kept: Readonly<Record<string, KeptChain>> | undefined,
): Record<string, KeptChain> | undefined {
  if (kept === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(kept).map(([slot, saved]) => [slot, withoutFallback(saved)]),
  );
}

export function planClaudeDefaults(config: GatewayConfig): ClaudeDefaultsPlan | { error: string } {
  const chainLines: string[] = [];
  const fallbackLines: string[] = [];

  // The machine's chains, one slot at a time, exactly as `gateway slot <slot> claude` does.
  let next: GatewayConfig = config;
  for (const key of inSlotOrder(Object.keys(config.slots))) {
    const plan = planSlotChange(next, key, "claude", {});
    if ("error" in plan) return { error: plan.error };
    chainLines.push(`${slotName(key)}: ${plan.old.join(",")} → Claude`);
    next = plan.config;
  }

  // The profiles: their chains go, and every switch they hold. A breaker switch needs a chain
  // (the config refuses one without), and none is left.
  const profiles = Object.fromEntries(
    Object.entries(next.profiles ?? {}).map(([name, profile]) => {
      const { breaker: _breaker, fallback: _fallback, kept, slots, ...rest } = profile;
      const own = Object.entries(slots ?? {});
      for (const [key, entry] of own) {
        if (entry !== "claude") {
          chainLines.push(`profile ${name} ${slotName(key)}: ${entry.join(",")} → Claude`);
        }
      }
      for (const key of switchedOn(profile.fallback)) {
        fallbackLines.push(`profile ${name} fallback ${slotName(key)}: on → off`);
      }
      for (const key of switchedOn(
        Object.fromEntries(
          Object.entries(kept ?? {}).map(([slot, saved]) => [slot, saved.fallback === true]),
        ),
      )) {
        fallbackLines.push(`profile ${name} fallback ${slotName(key)} (saved chain): on → off`);
      }
      const claudeOnly = Object.fromEntries(own.filter(([, entry]) => entry === "claude"));
      return [
        name,
        {
          ...rest,
          ...(Object.keys(claudeOnly).length > 0 ? { slots: claudeOnly } : {}),
          ...(kept === undefined ? {} : { kept: keptWithoutFallback(kept) }),
        },
      ];
    }),
  );

  // The machine's switches that were on, said from the config as it was: the chain's own switch
  // went into `kept` with the chain above, and is taken out of there now.
  for (const key of switchedOn(config.fallback)) {
    fallbackLines.unshift(`fallback ${slotName(key)}: on → off`);
  }
  const savedOn = Object.entries(config.kept ?? {})
    .filter(([, saved]) => saved.fallback === true)
    .map(([slot]) => slot);
  for (const key of inSlotOrder(savedOn)) {
    fallbackLines.push(`fallback ${slotName(key)} (saved chain): on → off`);
  }

  const { fallback: _machine, kept, profiles: _profiles, ...rest } = next;
  const moved: GatewayConfig = {
    ...rest,
    ...(kept === undefined ? {} : { kept: keptWithoutFallback(kept) }),
    ...(Object.keys(profiles).length === 0 ? {} : { profiles }),
  };
  const checked = parseConfig(moved);
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, lines: [...chainLines, ...fallbackLines] };
}
