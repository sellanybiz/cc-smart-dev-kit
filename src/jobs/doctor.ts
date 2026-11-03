import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { Check } from "../cli/check";
import type { CliPaths } from "../cli/paths";
import { parseUserJson } from "../setup/user-json";
import { heavyLimitLine, jobsPaths, readHeavyLimit } from "./config";

export function heavyJobChecks(paths: CliPaths): Check[] {
  const checks: Check[] = [];
  try {
    checks.push({ ok: true, info: true, text: heavyLimitLine(readHeavyLimit(paths.home)) });
  } catch (error) {
    checks.push({
      ok: false,
      text: `Heavy-job limit cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      fix: `Run ${COMMAND} job set max <n> with a valid limit, or remove maxConcurrent from the new file`,
    });
  }
  const file = jobsPaths(paths.home).legacyFile;
  try {
    const old: unknown = parseUserJson(readFileSync(file, "utf8"));
    if (typeof old === "object" && old !== null && "maxJobs" in old)
      checks.push({
        ok: true,
        info: true,
        text: `${file}: legacy maxJobs is ignored`,
        fix: `Remove maxJobs from that old file; use ${COMMAND} job set max <n> to choose the new limit`,
      });
  } catch (error) {
    // Legacy settings never govern the queue. An unreadable leftover is information only.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      checks.push({
        ok: true,
        info: true,
        text: `${file}: unreadable legacy job settings are ignored`,
        fix: "Remove the old file if it is no longer needed",
      });
  }
  return checks;
}
