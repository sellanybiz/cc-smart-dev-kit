import { COMMAND } from "../build-info";
import { type Runner, stopRouter, UNIT_NAME, unitActive } from "../gateway/service";
import { withLock } from "../setup/lock";
import { type RestoreResult, restore } from "../setup/restore";
import { readChanged, realTarget } from "../setup/write";
import { type CliPaths, tildify } from "./paths";

function describe(result: RestoreResult, short: (path: string) => string): string {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before cc-agentic`;
    case "removed":
      return `- ${file}: removed (cc-agentic had created it)`;
    case "cleaned":
      return `~ ${file}: removed ${result.details.join(", ")}; everything else kept`;
    case "unchanged":
      return `  ${file}: nothing of cc-agentic left in it`;
    case "no-backup":
      return `! ${file}: the backup from before cc-agentic is missing; left alone`;
  }
}

/** Said before restore stops a running router, and before the question. */
export const STOP_WARNING =
  "anymodel-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.";

export interface RestoreOptions {
  /** `--yes`: stop a running router without asking. */
  yes: boolean;
  runner: Runner;
  systemd: boolean;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
}

/**
 * Restore also undoes the router service when `gateway setup` installed its unit: it stops
 * and disables the unit (while its file is still there), then removes the files, then
 * reloads systemd. Stopping a running router cuts the answers in flight, so it asks first.
 */
export async function runRestore(paths: CliPaths, options: RestoreOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const unitTracked =
    options.systemd && Object.hasOwn(readChanged(paths.stateDir), realTarget(paths.routerUnitFile));
  if (unitTracked && unitActive(options.runner)) {
    console.log(STOP_WARNING);
    if (!options.yes) {
      const yes = options.confirm?.("Stop anymodel-router and restore?") ?? null;
      if (yes !== true) {
        console.log(
          yes === null
            ? `Nothing was changed. Run again with --yes to stop it: ${COMMAND} restore --yes`
            : "Nothing was changed.",
        );
        return 1;
      }
    }
  }
  return withLock(
    paths.stateDir,
    () => {
      if (unitTracked) {
        stopRouter(options.runner);
        console.log(`- ${UNIT_NAME}: stopped and disabled`);
      }
      const results = restore(paths.stateDir);
      if (unitTracked) options.runner(["systemctl", "--user", "daemon-reload"]);
      if (results.length === 0) {
        console.log("Nothing to restore: cc-agentic has nothing in any file.");
        return 0;
      }
      for (const result of results) {
        console.log(describe(result, short));
        if (result.savedAs) {
          console.log(`  (its state before this restore: ${short(result.savedAs)})`);
        }
      }
      return results.some((result) => result.action === "no-backup") ? 1 : 0;
    },
    { waitMs: 10_000 },
  );
}
