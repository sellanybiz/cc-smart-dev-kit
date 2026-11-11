import { existsSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import type { ManagedJsonResult } from "../setup/managed-json";
import {
  applyManagedJson,
  createdObjects,
  getKey,
  ownedRecords,
  ownership,
  readJsonObject,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";
import type { GatewayConfig } from "./config";
import { emptyConfig, loadConfigFile, messageOf } from "./config";
import { PICKER_PATH, pickerWrite } from "./model-picker";
import {
  BASE_URL_PATH,
  normalizedBaseUrl,
  RETIRED_MODEL_PIN_KEYS,
  routerBaseUrl,
} from "./settings";

function gatewayConfigOf(paths: CliPaths): GatewayConfig {
  return existsSync(paths.gatewayConfigFile)
    ? loadConfigFile(paths.gatewayConfigFile)
    : emptyConfig();
}

/**
 * Whether the user settings route through our own router: the address is the kit's, unchanged,
 * and names the configured port. Only then may the kit's menu exist; doctor asks the same.
 */
export function ourActiveGateway(paths: CliPaths): boolean {
  const address = getKey(readJsonObject(paths.settingsFile).data, BASE_URL_PATH);
  return (
    ownership(
      ownedRecords(paths.stateDir, realTarget(paths.settingsFile)),
      BASE_URL_PATH,
      address,
    ) === "ours" &&
    normalizedBaseUrl(String(address.value)) === routerBaseUrl(gatewayConfigOf(paths).port)
  );
}

/**
 * Setup and slot changes refresh the kit's menu while our gateway is on, and remove it while it
 * is not: an older `gateway off`, or a rollback, can leave it behind. Never turns the gateway
 * on. Caller holds the lock.
 */
export function applyModelPickerStep(paths: CliPaths, dryRun: boolean, retirePin = true): string[] {
  const lines: string[] = [];
  try {
    const retired = applyManagedJson({
      file: paths.settingsFile,
      remove: retirePin ? RETIRED_MODEL_PIN_KEYS.map((key) => ["env", key]) : [],
      createdObject: createdObjects(paths.stateDir, paths.settingsFile),
      stateDir: paths.stateDir,
      dryRun,
    });
    lines.push(
      ...retired.changes.map((change) => `~ ${change.path.join(".")}: retired gateway key removed`),
    );
    for (const skip of retired.skipped.filter(
      (skip) => getKey(readJsonObject(paths.settingsFile).data, skip.path).found,
    ))
      lines.push(`· ${skip.path.join(".")}: yours; left alone`);
    if (!ourActiveGateway(paths)) {
      // Removes only the menu the kit wrote and nobody changed; a person's own menu stays.
      const stale = applyManagedJson({
        file: paths.settingsFile,
        remove: [PICKER_PATH],
        stateDir: paths.stateDir,
        dryRun,
      });
      lines.push(...stale.changes.map(() => "~ modelPicker: the gateway is off; menu removed"));
      return lines;
    }
    const result = writePicker({
      file: paths.settingsFile,
      stateDir: paths.stateDir,
      config: gatewayConfigOf(paths),
      dryRun,
    });
    lines.push(...result.changes.map(() => "~ modelPicker: refresh the gateway model menu"));
    lines.push(...result.skipped.map((skip) => `· ${skip.path.join(".")}: ${skip.reason}`));
    return lines;
  } catch (error) {
    return [...lines, `! gateway model menu was not refreshed: ${messageOf(error)}`];
  }
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
