import { getKey, ownedRecords, ownership, readJsonObject } from "../setup/managed-json";
import { realTarget } from "../setup/write";
import { slotName } from "./commands-chains";
import { type GatewayConfig, plainClaudeView, profileView } from "./config";
import { shortTargetName } from "./target-label";
import { CLAUDE_FAMILIES, familyLabel, familySlotKey } from "./targets";

export const PICKER_PATH = ["modelPicker"];

/** Aliases follow Claude Code's newest models; descriptions name the chain's first answerer. */
export function pickerFor(
  config: GatewayConfig,
  profile?: string,
): {
  replaceBuiltInOptions: boolean;
  options: { model: string; label: string; description: string }[];
} {
  const view =
    profile === undefined ? config : (profileView(config, profile) ?? plainClaudeView(config));
  return {
    replaceBuiltInOptions: true,
    options: CLAUDE_FAMILIES.map((family) => {
      const label = familyLabel(family);
      const slot = familySlotKey(family);
      const first = slot === null ? undefined : view.slots[slot]?.[0];
      return {
        model: family,
        label,
        description:
          first !== undefined && slot !== null
            ? `answered by ${shortTargetName(first)} (${slotName(slot)} slot)`
            : `Claude's newest ${label}`,
      };
    }),
  };
}

/** Whose the user menu is: the kit's unchanged one, missing and never owned, or the person's. */
export function pickerOwner(file: string, stateDir: string): "ours" | "free" | "yours" {
  const current = getKey(readJsonObject(file).data, PICKER_PATH);
  const whose = ownership(ownedRecords(stateDir, realTarget(file)), PICKER_PATH, current);
  if (whose === "ours") return "ours";
  return whose === "none" && !current.found ? "free" : "yours";
}

/** The kit may write a missing, never-owned menu or refresh its unchanged menu. */
export function mayWritePicker(file: string, stateDir: string, refreshOwned = true): boolean {
  const owner = pickerOwner(file, stateDir);
  return (refreshOwned && owner === "ours") || owner === "free";
}

/** Decide before the managed write, so env and menu share one backup and one write. */
export function pickerWrite(file: string, stateDir: string, config: GatewayConfig) {
  if (!mayWritePicker(file, stateDir)) {
    return {
      set: [],
      skipped: [{ path: PICKER_PATH, reason: "set, changed or removed by you; left alone" }],
    };
  }
  return { set: [[PICKER_PATH, pickerFor(config)] as const], skipped: [] };
}
