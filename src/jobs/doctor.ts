import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { type Check, SETUP_FIX } from "../cli/check";
import { type CliPaths, tildify } from "../cli/paths";
import { hostPlatform } from "../machine/host";
import { parseUserJson } from "../setup/user-json";
import { heavyLimitLine, jobsPaths, readHeavyLimit, readLimitSettings } from "./config";
import { HOOK_NAMES } from "./git-hooks";
import { gitHooksState } from "./hook-folder";
import {
  JOBS_SLICE,
  type LimitFacts,
  limitKeysFix,
  limitsBlocker,
  liveSlice,
  machineCpus,
} from "./limits";

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
  // Setup never replaces a folder it did not make, so "run setup" would only fail the same way.
  if (state.kind === "not-ours") {
    return {
      ok: false,
      text: `Git hooks folder ${where} was not made by ${COMMAND}, so setup leaves it alone`,
      fix: `move that folder away by hand, then run: ${SETUP_FIX}`,
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

/**
 * The lines for the heavy jobs' CPU and memory caps (`limits.ts`): the settings, why they cannot
 * apply here, what the jobs' slice carries now (read from its cgroup files before any claim),
 * and whether the watchdog (systemd-oomd) runs. A line about a cap is information or a warning,
 * never a failure: the jobs run without a cap that cannot apply. It reads files and the process
 * list only, never systemd, so the portal can show the same lines.
 */
export function limitsChecks(paths: CliPaths, facts: LimitFacts): Check[] {
  if (facts.platform !== "linux") {
    return [
      {
        ok: true,
        info: true,
        text: `Heavy-job CPU and memory caps: not applied on ${facts.platform}; heavy jobs run as they are`,
      },
    ];
  }
  const read = readLimitSettings(paths.home);
  if (!read.ok) {
    return [
      {
        ok: true,
        warn: true,
        text: `Heavy-job caps are off: ${read.message}`,
        fix:
          read.keys.length > 0
            ? limitKeysFix(read.keys)
            : "make the file valid JSON holding an object, or remove it",
      },
    ];
  }
  const blocker = limitsBlocker(facts);
  if (blocker !== null) {
    return [
      {
        ok: true,
        warn: true,
        text: `Heavy-job caps cannot apply here: ${blocker}; heavy jobs run without them`,
        fix: "see docs/jobs.md § CPU and memory limits in the plugin's repo for what the caps need",
      },
    ];
  }
  const { cpuPercent, memoryPercent } = read.settings;
  const wanted = `CPU ${cpuPercent}%, memory ${memoryPercent}%`;
  const live = liveSlice(facts, read.settings);
  const checks: Check[] = [];
  if (live.state === "applied") {
    checks.push({
      ok: true,
      text: `Heavy-job caps applied on ${JOBS_SLICE}: ${wanted} (${machineCpus(facts)} CPUs); the jobs yield to your apps`,
    });
  } else if (live.state === "absent") {
    checks.push({
      ok: true,
      info: true,
      text: `Heavy-job caps: ${wanted}; written to ${JOBS_SLICE} when the next heavy job starts`,
    });
  } else {
    checks.push({
      ok: true,
      warn: true,
      text: `${JOBS_SLICE} carries cpu.max "${live.cpuMax}" and memory.max "${live.memoryMax}", not the caps set (${wanted})`,
      fix:
        "the next heavy job writes the caps again; check them with: systemctl --user show " +
        JOBS_SLICE,
    });
  }
  if (!facts.oomdRunning()) {
    checks.push({
      ok: true,
      warn: true,
      text: "systemd-oomd is not running: the caps hold, but nothing stops a heavy job that stalls on memory",
      fix: "start it (as root): systemctl enable --now systemd-oomd",
    });
  }
  return checks;
}

/**
 * `limits`: this machine's facts for the caps' lines (`limitsChecks`); null leaves those lines
 * out (a caller that is not about the caps, such as a test of another part of `doctor`).
 */
export function heavyJobChecks(
  paths: CliPaths,
  limits: LimitFacts | null,
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
  if (limits !== null) checks.push(...limitsChecks(paths, limits));
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
