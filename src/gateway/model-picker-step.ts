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
import { loadConfigFile, messageOf } from "./config";
import { pickerWrite } from "./model-picker";
import {
  BASE_URL_PATH,
  normalizedBaseUrl,
  RETIRED_MODEL_PIN_KEYS,
  routerBaseUrl,
} from "./settings";

/** Setup and slot changes refresh only our active gateway, never turn it on. Caller holds the lock. */
export function applyModelPickerStep(paths: CliPaths, dryRun: boolean): string[] {
  try {
    const retired = applyManagedJson({
      file: paths.settingsFile,
      remove: RETIRED_MODEL_PIN_KEYS.map((key) => ["env", key]),
      createdObject: createdObjects(paths.stateDir, paths.settingsFile),
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
