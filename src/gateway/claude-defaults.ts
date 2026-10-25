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
 *
 * The step around the plan (`planClaudeDefaultsStep`, `applyClaudeDefaultsStep`) is setup's, and
 * only setup's: a session start or the background update never reaches this file
 * (`src/cli/setup-claude-default.test.ts` walks their imports). It runs once per machine: a
 * marker file in the kit's own state says so, and it is written at the first real setup on
 * EVERY machine, one with no `gateway.json` too — else a chain the person sets later would be
 * taken by the next setup. `restore` leaves the marker, as it leaves `gateway.json` (it holds
 * the person's key): removing it would send the next setup over a chain set since. A
 * `--dry-run` writes nothing, the marker included. The gateway is turned off through
 * `turnOff`, the code `gateway off` runs; a project's own switch (`gateway project on`) is the
 * project's choice and is left as it is.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND, VERSION } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { atomicWrite, backupDir, backupFile } from "../setup/write";
import { planSlotChange } from "./commands";
import { slotName } from "./commands-chains";
import { changeLines } from "./commands-out";
import {
  type GatewayConfig,
  type KeptChain,
  loadConfigFile,
  messageOf,
  parseConfig,
  saveConfig,
} from "./config";
import { maskedLine } from "./plain-text";
import { foreignRouting, turnOff } from "./settings";
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
  const profileFallbackLines: string[] = [];

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
        profileFallbackLines.push(`profile ${name} fallback ${slotName(key)}: on → off`);
      }
      for (const key of switchedOn(
        Object.fromEntries(
          Object.entries(kept ?? {}).map(([slot, saved]) => [slot, saved.fallback === true]),
        ),
      )) {
        profileFallbackLines.push(
          `profile ${name} fallback ${slotName(key)} (saved chain): on → off`,
        );
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
  // went into `kept` with the chain above, and is taken out of there now. Then the saved
  // chains' switches, then each profile's.
  const machineFallbackLines = switchedOn(config.fallback).map(
    (key) => `fallback ${slotName(key)}: on → off`,
  );
  const savedOn = Object.entries(config.kept ?? {})
    .filter(([, saved]) => saved.fallback === true)
    .map(([slot]) => slot);
  const savedFallbackLines = inSlotOrder(savedOn).map(
    (key) => `fallback ${slotName(key)} (saved chain): on → off`,
  );

  const { fallback: _machine, kept, profiles: _profiles, ...rest } = next;
  const moved: GatewayConfig = {
    ...rest,
    ...(kept === undefined ? {} : { kept: keptWithoutFallback(kept) }),
    ...(Object.keys(profiles).length === 0 ? {} : { profiles }),
  };
  const checked = parseConfig(moved);
  if ("error" in checked) return { error: checked.error };
  return {
    config: checked.config,
    lines: [...chainLines, ...machineFallbackLines, ...savedFallbackLines, ...profileFallbackLines],
  };
}

/** The state file that says the move ran on this machine (`claudeDefaultsMarkerFile`). */
export const CLAUDE_DEFAULTS_MARKER = "claude-by-default";

export const claudeDefaultsMarkerFile = (stateDir: string): string =>
  join(stateDir, CLAUDE_DEFAULTS_MARKER);

/** The marker holds the kit's version that ran the move: a fact for the person who looks. */
function markClaudeDefaultsDone(stateDir: string): void {
  atomicWrite(claudeDefaultsMarkerFile(stateDir), `${VERSION}\n`, 0o600);
}

/**
 * What the step does on this machine, planned without writing anything:
 * - `done`: the marker is there. Nothing, and nothing said.
 * - `nothing`: no `gateway.json`, so nothing to move and nothing said; the marker is written.
 * - `unreadable`: `gateway.json` cannot be used, or its move cannot be planned. One `!` line,
 *   no marker, and setup goes on: fixed by hand, the next setup moves it.
 * - `move`: the plan. The gateway is turned off whenever it runs, chains or not.
 */
export type ClaudeDefaultsStep =
  | { kind: "done" }
  | { kind: "nothing" }
  | { kind: "unreadable"; line: string }
  | { kind: "move"; plan: ClaudeDefaultsPlan };

export function planClaudeDefaultsStep(paths: CliPaths): ClaudeDefaultsStep {
  if (existsSync(claudeDefaultsMarkerFile(paths.stateDir))) return { kind: "done" };
  if (!existsSync(paths.gatewayConfigFile)) return { kind: "nothing" };
  const file = tildify(paths.gatewayConfigFile, paths.home);
  const unreadable = (why: string): ClaudeDefaultsStep => ({
    kind: "unreadable",
    line: `! setup did not move the slots to Claude or turn the gateway off: ${maskedLine(why, [], 300).replaceAll(paths.gatewayConfigFile, file)} Then run ${COMMAND} setup again.`,
  });
  let config: GatewayConfig;
  try {
    config = loadConfigFile(paths.gatewayConfigFile);
  } catch (error) {
    return unreadable(messageOf(error));
  }
  const plan = planClaudeDefaults(config);
  if ("error" in plan) return unreadable(plan.error);
  return { kind: "move", plan };
}

/** The gateway as the move will leave it, for a plan that reads it before the move is written. */
export function gatewayAfterStep(step: ClaudeDefaultsStep): GatewayConfig | undefined {
  return step.kind === "move" ? step.plan.config : undefined;
}

/**
 * Does the step, and returns its lines in setup's marks (`~` a change, `!` a warning, two
 * spaces for information). With `dryRun` nothing is written: the lines are what a real run
 * would say. A real run, inside setup's lock, in this order:
 * 1. a backup of `gateway.json` (the state folder's `backups/`), when the config changes;
 * 2. the config, moved; 3. the gateway off, by `turnOff`; 4. the marker.
 * A run that stops between them leaves a state the next setup finishes: no marker means it
 * plans again, and a config already moved plans no change.
 */
export function applyClaudeDefaultsStep(
  paths: CliPaths,
  step: ClaudeDefaultsStep,
  dryRun: boolean,
): string[] {
  if (step.kind === "unreadable") return [step.line];
  if (step.kind === "done") return [];
  if (step.kind === "nothing") {
    if (!dryRun) markClaudeDefaultsDone(paths.stateDir);
    return [];
  }
  const { plan } = step;
  const changes = plan.lines.length > 0;
  let backup: string | null = null;
  if (changes && !dryRun) {
    backup = backupFile(paths.stateDir, paths.gatewayConfigFile);
    saveConfig(paths.gatewayConfigFile, plan.config);
  }
  const off = turnOff({ dryRun, settingsFile: paths.settingsFile, stateDir: paths.stateDir });
  if (!dryRun) markClaudeDefaultsDone(paths.stateDir);

  const lines: string[] = [];
  if (off.switched) lines.push("~ the gateway: on → off");
  lines.push(...plan.lines.map((line) => `~ ${line}`));
  lines.push(...changeLines(off.result, paths.home));
  for (const key of foreignRouting(off.foreign, paths.settingsFile).routing) {
    lines.push(
      `! env.${key} stays: ${COMMAND} did not set it. Remove it by hand to turn the gateway off`,
    );
  }
  if (changes) {
    const where =
      backup === null ? backupDir(paths.stateDir, paths.gatewayConfigFile) : dirname(backup);
    lines.push(
      dryRun
        ? `  the config would be kept in ${tildify(where, paths.home)}/ before it changes`
        : `  the config as it was before is in ${tildify(where, paths.home)}/`,
    );
  }
  return lines;
}
