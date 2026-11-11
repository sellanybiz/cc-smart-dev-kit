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
import { GATEWAY_FABLE_ENV, GATEWAY_FABLE_MODEL } from "./fable-model";
import { BASE_URL_PATH, normalizedBaseUrl, routerBaseUrl } from "./settings";

/** No new routing choice: only refresh Fable pin while our own active address still matches. */
export function applyFableModelStep(paths: CliPaths, dryRun: boolean): string[] {
  if (!existsSync(paths.gatewayConfigFile)) return [];
  let settings: ReturnType<typeof readJsonObject>["data"];
  try {
    settings = readJsonObject(paths.settingsFile).data;
  } catch (error) {
    return [`! gateway Fable pin was not refreshed: ${messageOf(error)}`];
  }
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  const address = getKey(settings, BASE_URL_PATH);
  if (!address.found || ownership(records, BASE_URL_PATH, address) !== "ours") return [];
  let port: number;
  try {
    port = loadConfigFile(paths.gatewayConfigFile).port;
  } catch (error) {
    return [`! gateway Fable pin was not refreshed: ${messageOf(error)}`];
  }
  if (normalizedBaseUrl(String(address.value)) !== routerBaseUrl(port)) return [];
  const path = ["env", GATEWAY_FABLE_ENV];
  const current = getKey(settings, path);
  if (current.found && ownership(records, path, current) !== "ours") {
    return [`  env.${GATEWAY_FABLE_ENV} stays: set or changed by you`];
  }
  const result = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: [[path, GATEWAY_FABLE_MODEL]],
    dryRun,
  });
  return result.changes.map(
    () => `~ env.${GATEWAY_FABLE_ENV}: refresh Fable model for the gateway already on`,
  );
}
