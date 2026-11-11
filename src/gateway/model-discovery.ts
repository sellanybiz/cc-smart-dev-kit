/** Normal setup's upgrade step. The caller holds setup's lock for a real write. */
import { existsSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import {
  applyManagedJson,
  getKey,
  ownedRecords,
  ownership,
  readJsonObject,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";
import { loadConfigFile, messageOf } from "./config";
import {
  BASE_URL_PATH,
  MODEL_DISCOVERY_ENV,
  MODEL_DISCOVERY_VALUE,
  normalizedBaseUrl,
  routerBaseUrl,
} from "./settings";

/** No new routing choice: only refresh discovery while our own active address still matches. */
export function applyModelDiscoveryStep(paths: CliPaths, dryRun: boolean): string[] {
  if (!existsSync(paths.gatewayConfigFile)) return [];
  const settings = readJsonObject(paths.settingsFile).data;
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  const address = getKey(settings, BASE_URL_PATH);
  if (!address.found || ownership(records, BASE_URL_PATH, address) !== "ours") return [];
  let port: number;
  try {
    port = loadConfigFile(paths.gatewayConfigFile).port;
  } catch (error) {
    return [`! gateway model discovery was not refreshed: ${messageOf(error)}`];
  }
  if (normalizedBaseUrl(String(address.value)) !== routerBaseUrl(port)) return [];
  const path = ["env", MODEL_DISCOVERY_ENV];
  const current = getKey(settings, path);
  if (current.found && ownership(records, path, current) !== "ours") {
    return [`  env.${MODEL_DISCOVERY_ENV} stays: set or changed by you`];
  }
  const result = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: [[path, MODEL_DISCOVERY_VALUE]],
    dryRun,
  });
  return result.changes.map(
    () => `~ env.${MODEL_DISCOVERY_ENV}: enable live model discovery for the gateway already on`,
  );
}
