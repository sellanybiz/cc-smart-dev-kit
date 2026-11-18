import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { type Check, SETUP_FIX } from "../cli/check";
import { type CliPaths, tildify } from "../cli/paths";
import { hostPlatform } from "../machine/host";
import { parseUserJson } from "../setup/user-json";
import { heavyLimitLine, jobsPaths, readHeavyLimit } from "./config";
import { HOOK_NAMES } from "./git-hooks";
import { gitHooksState } from "./hook-folder";

/** How many problems of the git hooks folder one doctor line names. */
const PROBLEMS_SHOWN = 3;

/**
 * The line for the kit's git hooks folder (`hook-folder.ts`): present, every hook name there,
 * executable and in this version's text. Native Windows has no folder yet: one line says so.
 */
export function gitHooksCheck(paths: CliPaths, platform: NodeJS.Platform = hostPlatform()): Check {
  if (platform === "win32") {
    return {
      ok: true,
      info: true,
      text: "Git hook queue: not set up on Windows yet; commit and push hooks run as they are",
    };
  }
  const where = tildify(paths.gitHooksFolder, paths.home);
  const state = gitHooksState(paths);
  // A folder that is not there is no breakage: `update` does not run setup, and the route adds
  // nothing without the folder, so a heavy hook just runs without waiting for a slot. A warning.
  if (state.kind === "missing") {
    return {
      ok: true,
      warn: true,
      text: `Git hooks folder is missing (${where}): a commit or push whose hook runs heavy work does not wait for a slot`,
      fix: SETUP_FIX,
    };
  }
  if (state.kind === "problems") {
    const shown = state.problems.slice(0, PROBLEMS_SHOWN).join(", ");
    const more = state.problems.length - PROBLEMS_SHOWN;
    return {
      ok: false,
      text: `Git hooks folder ${where}: ${shown}${more > 0 ? ` and ${more} more` : ""}`,
      fix: SETUP_FIX,
    };
  }
  return {
    ok: true,
    text: `Git hooks folder: ${HOOK_NAMES.length} hook scripts, executable and up to date`,
  };
}

export function heavyJobChecks(
  paths: CliPaths,
  platform: NodeJS.Platform = hostPlatform(),
): Check[] {
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
  checks.push(gitHooksCheck(paths, platform));
  return checks;
}
