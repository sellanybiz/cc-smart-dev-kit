import { bunTooOld, COMMAND } from "../build-info";

/**
 * The commands that run on any Bun. None of them sends a backend key, and each helps a
 * person whose Bun is too old: `doctor` names it as its first ✗ (and skips the gateway
 * checks, which send the key), `restore` removes anymodel, and help and version print.
 * Every other command stops at once (`oldBunRefusal`).
 */
const RUNS_ON_ANY_BUN = new Set<string | undefined>([
  undefined,
  "doctor",
  "restore",
  "version",
  "--version",
  "help",
  "--help",
  "-h",
]);

/**
 * What the CLI prints, and then stops, when `command` needs a newer Bun than `version`
 * (at `path`, the Bun running the CLI); null when the command may run.
 */
export function oldBunRefusal(
  command: string | undefined,
  version: string,
  path: string,
): null | string {
  if (RUNS_ON_ANY_BUN.has(command)) return null;
  const tooOld = bunTooOld(version, path);
  return tooOld === null
    ? null
    : `${COMMAND}: ${tooOld} Upgrade this Bun, then run the command again.`;
}
