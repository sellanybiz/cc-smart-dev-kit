import { existsSync, readFileSync } from "node:fs";
import { DEPENDENCIES } from "../build-info";
import type { Dependency } from "../build-info/manifest";
import type { CliPaths } from "../cli/paths";
import { isValidRange } from "../project/version-range";
import { findUserInstall } from "../setup/installed-plugins";
import type { Machine } from "./machine";

/**
 * The companion plugins: the other plugins anymodel depends on (plugin.json's
 * `dependencies`). Claude Code installs a dependency only from a marketplace the person
 * has added; without it, `claude plugin install anymodel@anymodel` still succeeds, and
 * anymodel then does not load (seen live: `docs/claude-code-contract.md`). So setup adds
 * each missing marketplace, which also installs the missing dependency.
 */

/** Where each marketplace comes from: what `claude plugin marketplace add` takes. */
export const MARKETPLACE_SOURCES: Readonly<Record<string, string>> = {
  thedotmack: "thedotmack/claude-mem",
  "claude-plugins-official": "anthropics/claude-plugins-official",
  "claude-code-warp": "warpdotdev/claude-code-warp",
};

export interface Companion {
  /** `<name>@<marketplace>`. */
  id: string;
  name: string;
  marketplace: string;
  /** The version range plugin.json asks for, when it has one. */
  range: string | null;
  /** The marketplace's source, for `claude plugin marketplace add`. */
  source: string;
}

/** The companions, from plugin.json's `dependencies`. Throws for a marketplace with no source. */
export function companions(dependencies: readonly Dependency[] = DEPENDENCIES): Companion[] {
  return dependencies.map((dependency) => {
    const source = MARKETPLACE_SOURCES[dependency.marketplace];
    if (source === undefined) {
      throw new Error(
        `plugin.json depends on ${dependency.name}@${dependency.marketplace}, but anymodel does not know where the ${dependency.marketplace} marketplace comes from (MARKETPLACE_SOURCES)`,
      );
    }
    return {
      id: `${dependency.name}@${dependency.marketplace}`,
      name: dependency.name,
      marketplace: dependency.marketplace,
      range: dependency.version ?? null,
      source,
    };
  });
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** True when Claude Code's list of added marketplaces has `name`. */
export function marketplaceAdded(paths: CliPaths, name: string): boolean {
  const known = readJson(paths.knownMarketplacesFile);
  return known !== null && Object.hasOwn(known, name);
}

/** True when the user settings turn the plugin on (`enabledPlugins[id] === true`). */
export function pluginEnabled(paths: CliPaths, id: string): boolean {
  const enabled = readJson(paths.settingsFile)?.enabledPlugins;
  return (
    typeof enabled === "object" &&
    enabled !== null &&
    (enabled as Record<string, unknown>)[id] === true
  );
}

/**
 * A version as Claude Code records it, ready for a range check. A dependency resolved
 * from a git tag carries a 12-character commit suffix (`2.1.0-8713c5b11005`); the range
 * check uses the tag's version, so the suffix goes. Null when it is not a version at all
 * (a commit id, for a plugin with no version).
 */
export function comparableVersion(version: string | null): string | null {
  if (version === null) return null;
  const plain = version.replace(/-[0-9a-f]{12}$/, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plain) ? plain : null;
}

export type CompanionState =
  | { kind: "no-marketplace" }
  | { kind: "not-installed" }
  | { kind: "off"; version: string | null }
  | { kind: "outside-range"; version: string | null }
  /** The recorded version is no version number (a commit id): it cannot be checked. */
  | { kind: "unknown-version"; version: string | null }
  | { kind: "ok"; version: string | null };

export function companionState(paths: CliPaths, companion: Companion): CompanionState {
  const install = findUserInstall(paths.installedPluginsFile, companion.id);
  if (install === null || !existsSync(install.installPath)) {
    return marketplaceAdded(paths, companion.marketplace)
      ? { kind: "not-installed" }
      : { kind: "no-marketplace" };
  }
  const version = install.version;
  if (!pluginEnabled(paths, companion.id)) return { kind: "off", version };
  if (companion.range !== null && isValidRange(companion.range)) {
    const comparable = comparableVersion(version);
    if (comparable === null) return { kind: "unknown-version", version };
    if (!Bun.semver.satisfies(comparable, companion.range)) {
      return { kind: "outside-range", version };
    }
  }
  return { kind: "ok", version };
}

/** One `claude` command setup runs for the companions, and the line it prints. */
export interface CompanionStep {
  argv: string[];
  line: string;
}

/**
 * What setup does for the companions: add a missing marketplace (Claude Code then
 * installs the missing dependency from it), or install a plugin whose marketplace is
 * there. A companion the person turned off, or one outside the range, is not changed:
 * setup says what to run (`notes`).
 */
export function companionPlan(
  paths: CliPaths,
  list: readonly Companion[] = companions(),
): { steps: CompanionStep[]; notes: string[] } {
  const steps: CompanionStep[] = [];
  const notes: string[] = [];
  for (const companion of list) {
    const state = companionState(paths, companion);
    switch (state.kind) {
      case "no-marketplace":
        steps.push({
          argv: ["claude", "plugin", "marketplace", "add", companion.source],
          line: `+ marketplace ${companion.marketplace} (${companion.source}), which installs ${companion.id}`,
        });
        break;
      case "not-installed":
        steps.push({
          argv: ["claude", "plugin", "install", companion.id],
          line: `+ plugin ${companion.id}`,
        });
        break;
      case "off":
        notes.push(
          `! ${companion.id} is turned off, and anymodel does not load without it. Run: claude plugin enable ${companion.id}`,
        );
        break;
      case "outside-range":
        notes.push(
          `! ${companion.id} ${state.version ?? "(no version)"} is outside ${companion.range}, and anymodel does not load with it. Run: claude plugin update ${companion.id}`,
        );
        break;
      case "unknown-version":
        notes.push(`! ${unknownVersionText(companion, state.version)}`);
        break;
      case "ok":
        break;
    }
  }
  return { steps, notes };
}

/**
 * Runs the steps with `claude`, in order. Returns the lines to print and whether all
 * worked. A step that fails prints Claude Code's own words (the last line), and the
 * rest still run: each companion is separate.
 */
export function runCompanionSteps(
  steps: readonly CompanionStep[],
  machine: Machine,
): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  let ok = true;
  for (const step of steps) {
    const result = machine.run(step.argv);
    if (result.exitCode === 0) {
      lines.push(step.line);
    } else {
      ok = false;
      const reason = result.output.trim().split("\n").at(-1) ?? "";
      lines.push(`! ${step.argv.join(" ")} failed (exit ${result.exitCode}): ${reason}`);
    }
  }
  return { lines, ok };
}

/** A companion whose recorded version is a commit id, not a version number. */
function unknownVersionText(companion: Companion, version: string | null): string {
  return `${companion.id} ${version ?? "(no version)"}: its version is unknown (not a version number), so anymodel cannot check it against ${companion.range}. Run: claude plugin update ${companion.id}`;
}

/** One doctor line per companion. */
export function companionChecks(
  paths: CliPaths,
  list: readonly Companion[] = companions(),
): { ok: boolean; text: string }[] {
  return list.map((companion) => companionCheck(paths, companion));
}

function companionCheck(paths: CliPaths, companion: Companion): { ok: boolean; text: string } {
  {
    const state = companionState(paths, companion);
    switch (state.kind) {
      case "no-marketplace":
        return {
          ok: false,
          text: `the ${companion.marketplace} marketplace is not added, so ${companion.id} is missing and anymodel does not load. Run: anymodel setup`,
        };
      case "not-installed":
        return {
          ok: false,
          text: `${companion.id} is not installed, and anymodel does not load without it. Run: anymodel setup`,
        };
      case "off":
        return {
          ok: false,
          text: `${companion.id} is turned off, and anymodel does not load without it. Run: claude plugin enable ${companion.id}`,
        };
      case "outside-range":
        return {
          ok: false,
          text: `${companion.id} ${state.version ?? "(no version)"} is outside ${companion.range}. Run: claude plugin update ${companion.id}`,
        };
      case "unknown-version":
        return { ok: false, text: unknownVersionText(companion, state.version) };
      case "ok":
        return {
          ok: true,
          text: `${companion.id} ${state.version ?? "(no version)"} is installed and on`,
        };
    }
  }
}
