import type { Check } from "../cli/check";
import {
  coreId,
  defaultHcRunner,
  type HcRunner,
  hcGet,
  hcList,
  hcNewEnough,
  hcVersion,
  MIN_HC_VERSION,
} from "./hc";
import { KIT_INDEPENDENT, KIT_LEAD } from "./labels";
export function herdrChecks(r: HcRunner = defaultHcRunner): Check[] {
  let version: string;
  try {
    version = hcVersion(r);
  } catch {
    return [
      {
        ok: true,
        info: true,
        text: "Herdr: hc is not installed; session orchestration is optional.",
      },
    ];
  }
  if (!hcNewEnough(version))
    return [
      {
        ok: true,
        warn: true,
        text: `Herdr: hc ${version} is too old (needs ${MIN_HC_VERSION}).`,
        fix: "Update Herdr and hc.",
      },
    ];
  const result: Check[] = [{ ok: true, text: `Herdr: hc ${version} is new enough.` }];
  try {
    const core = coreId(r);
    result.push({ ok: true, text: `Herdr: core ${core} answers.` });
    const rows = hcList(r)
      .terminals.map((t) => hcGet(r, t.address))
      .filter((t) => t.state === "live" && (t.labels[KIT_LEAD] || t.labels[KIT_INDEPENDENT]));
    const children = rows.filter((t) => !t.labels[KIT_INDEPENDENT]),
      independent = rows.filter((t) => t.labels[KIT_INDEPENDENT]);
    result.push({
      ok: true,
      info: true,
      text: `Herdr: ${children.length} live kit children, ${independent.length} independent sessions; ${rows.filter((t) => t.status?.state === "blocked").length} blocked.`,
    });
    for (const t of independent.filter((t) => t.status?.state === "blocked"))
      result.push({
        ok: true,
        warn: true,
        text: `Herdr: independent session ${t.name ?? t.address} (${t.address}) is blocked; nobody may be watching.`,
        fix: `Open its pane: hc attach ${t.address}`,
      });
  } catch (error) {
    result.push({
      ok: false,
      text: `Herdr: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Start Herdr, then run doctor again.",
    });
  }
  return result;
}
