import { existsSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import {
  applyManagedJson,
  getKey,
  type ManagedJsonResult,
  ownedRecords,
  ownership,
  readJsonObject,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";
import { slotName } from "./commands-chains";
import { type GatewayConfig, loadConfigFile, messageOf, profileView } from "./config";
import { BASE_URL_PATH, normalizedBaseUrl, retireOldModelKeys, routerBaseUrl } from "./settings";
import { targetModel } from "./target-label";
import { CLAUDE_FAMILIES, familySlotKey, parseTarget } from "./targets";

export const PICKER_PATH = ["modelPicker"];

/** Aliases follow Claude Code's newest models; descriptions name the chain's first answerer. */
export function pickerFor(
  config: GatewayConfig,
  profile?: string,
): {
  replaceBuiltInOptions: boolean;
  options: { model: string; label: string; description: string }[];
} {
  const view = profile === undefined ? config : (profileView(config, profile) ?? config);
  return {
    replaceBuiltInOptions: true,
    options: CLAUDE_FAMILIES.map((family) => {
      const label = family.charAt(0).toUpperCase() + family.slice(1);
      const slot = familySlotKey(family);
      const first = slot === null ? undefined : view.slots[slot]?.[0];
      const parsed = first === undefined ? null : parseTarget(first);
      return {
        model: family,
        label,
        description:
          parsed !== null && "target" in parsed && parsed.target.kind === "backend" && slot !== null
            ? `answered by ${targetModel(parsed.target.model)} (${slotName(slot)} slot)`
            : `Claude's newest ${label}`,
      };
    }),
  };
}

/** Decide before the managed write, so env and menu share one backup and one write. */
export function pickerWrite(file: string, stateDir: string, config: GatewayConfig) {
  const current = getKey(readJsonObject(file).data, PICKER_PATH);
  const whose = ownership(ownedRecords(stateDir, realTarget(file)), PICKER_PATH, current);
  if (whose === "changed" || (current.found && whose !== "ours")) {
    return {
      set: [],
      skipped: [{ path: PICKER_PATH, reason: "set, changed or removed by you; left alone" }],
    };
  }
  return { set: [[PICKER_PATH, pickerFor(config)] as const], skipped: [] };
}

/** Preserve a person's picker, including an owned key they removed by hand. */
export function writePicker(options: {
  file: string;
  stateDir: string;
  config: GatewayConfig;
  dryRun?: boolean;
}): ManagedJsonResult {
  const plan = pickerWrite(options.file, options.stateDir, options.config);
  const result = applyManagedJson({
    file: options.file,
    stateDir: options.stateDir,
    set: plan.set,
    dryRun: options.dryRun ?? false,
  });
  result.skipped.push(...plan.skipped);
  return result;
}

/** Setup and slot changes refresh only our active gateway, never turn it on. Caller holds the lock. */
export function applyModelPickerStep(paths: CliPaths, dryRun: boolean): string[] {
  try {
    const retired = retireOldModelKeys({
      settingsFile: paths.settingsFile,
      stateDir: paths.stateDir,
      dryRun,
    });
    const lines = retired.changes.map(
      (change) => `~ ${change.path.join(".")}: retired gateway key removed`,
    );
    for (const skip of retired.skipped.filter(
      (skip) => getKey(readJsonObject(paths.settingsFile).data, skip.path).found,
    ))
      lines.push(`· ${skip.path.join(".")}: ${skip.reason}`);
    if (!existsSync(paths.gatewayConfigFile)) return lines;
    const config = loadConfigFile(paths.gatewayConfigFile);
    const address = getKey(readJsonObject(paths.settingsFile).data, BASE_URL_PATH);
    if (
      ownership(
        ownedRecords(paths.stateDir, realTarget(paths.settingsFile)),
        BASE_URL_PATH,
        address,
      ) !== "ours" ||
      normalizedBaseUrl(String(address.value)) !== routerBaseUrl(config.port)
    )
      return lines;
    const result = writePicker({
      file: paths.settingsFile,
      stateDir: paths.stateDir,
      config,
      dryRun,
    });
    lines.push(...result.changes.map(() => "~ modelPicker: refresh the gateway model menu"));
    lines.push(...result.skipped.map((skip) => `· ${skip.path.join(".")}: ${skip.reason}`));
    return lines;
  } catch (error) {
    return [`! gateway model menu was not refreshed: ${messageOf(error)}`];
  }
}
