import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { COMMAND } from "../build-info";
import { configuredPort } from "../gateway/commands";
import { messageOf } from "../gateway/config";
import type { HealthProbe } from "../gateway/health";
import {
  type Runner,
  restartPendingFile,
  SOCKET_NAME,
  stopRouter,
  UNIT_NAME,
  unitActive,
} from "../gateway/service";
import { ownedGatewayEnvKeys } from "../gateway/settings";
import { forgetInstructionsState } from "../setup/instructions";
import { withLock } from "../setup/lock";
import { type RestoreResult, restore } from "../setup/restore";
import { readChanged, realTarget } from "../setup/write";
import { type CliPaths, tildify } from "./paths";

function describe(result: RestoreResult, short: (path: string) => string): string {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before cc-smart-dev-kit`;
    case "removed":
      return `- ${file}: removed (cc-smart-dev-kit had created it)`;
    case "cleaned":
      return `~ ${file}: removed ${result.details.join(", ")}; everything else kept`;
    case "unchanged":
      return `  ${file}: nothing of cc-smart-dev-kit left in it`;
    case "no-backup":
      return `! ${file}: the backup from before cc-smart-dev-kit is missing; left alone`;
  }
}

/** The router's two units, as restore names them. */
const UNITS = `${UNIT_NAME} and ${SOCKET_NAME}`;

/** Said before restore stops a running router, and before the question. */
export const STOP_WARNING =
  "cc-smart-dev-kit-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.";

/** Said before `restore --now`, and before the question. */
export const NOW_WARNING = `restore --now stops cc-smart-dev-kit-router while Claude sessions still use it: every running Claude session fails until it restarts.`;

/** Said at the end of stage 1. */
export const STAGE_ONE_DONE = `Restart every running Claude session (they still use the router), then run \`${COMMAND} restore\` again to stop and remove the router.`;

export interface RestoreOptions {
  /** `--yes`: stop a running router without asking. */
  yes: boolean;
  /** `--now`: both stages at once, though running sessions still use the router. */
  now: boolean;
  runner: Runner;
  systemd: boolean;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /** Asks the router's port after the stop, until it is closed; a test passes a fake. */
  probe: HealthProbe;
}

/** Asks before something that cuts running sessions; true to go on. Prints why it stops. */
function askFirst(
  options: RestoreOptions,
  warning: string,
  question: string,
  again: string,
): boolean {
  console.log(warning);
  if (options.yes) return true;
  const yes = options.confirm?.(question) ?? null;
  if (yes === true) return true;
  console.log(
    yes === null ? `Nothing was changed. Run again with --yes ${again}` : "Nothing was changed.",
  );
  return false;
}

function print(results: RestoreResult[], short: (path: string) => string): void {
  for (const result of results) {
    console.log(describe(result, short));
    if (result.savedAs) {
      console.log(`  (its state before this restore: ${short(result.savedAs)})`);
    }
  }
}

/**
 * Restore takes the instructions out, so their two state files go too: the version stamp,
 * and the stored `setup --no-instructions` (a setup after a restore starts fresh). Prints a
 * line when a stored choice was forgotten; true when it was.
 */
function forgetInstructionChoice(stateDir: string, short: (path: string) => string): boolean {
  const forgotten = forgetInstructionsState(stateDir);
  if (forgotten === null) return false;
  console.log(
    `- ${short(forgotten)}: removed (your --no-instructions choice; the next setup installs the instructions)`,
  );
  return true;
}

/**
 * Restore also undoes the router service when `gateway setup` installed it. Running Claude
 * sessions read `ANTHROPIC_BASE_URL` at start, so while cc-smart-dev-kit's gateway env keys are in
 * the settings they still send every request to the router; stopping it would make each of
 * them fail. (A key cc-smart-dev-kit set and the person changed since is theirs, and does not count
 * here: `ownedGatewayEnvKeys` keeps only the keys that still hold cc-smart-dev-kit's value.) So,
 * with the router installed:
 *   - stage 1, while cc-smart-dev-kit's gateway env keys are there: everything is restored but the
 *     router's copy and units, and the router keeps running. It says to restart the
 *     sessions and run `restore` again.
 *   - stage 2, with no such key left: it disables and stops the unit and its socket (asking first when it
 *     runs, because that cuts answers in flight) and waits up to 15 s for its port to
 *     close (`stopRouter`; the drain goes on in the background), restores the rest (the
 *     copy and the units are removed), reloads systemd, and clears the restart-pending
 *     marker.
 *   - `--now`: both at once, after the warning that every running session fails until it
 *     restarts (asked, or `--yes`).
 */
export async function runRestore(paths: CliPaths, options: RestoreOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const changed = readChanged(paths.stateDir);
  const routerFiles = [
    realTarget(paths.routerCopy),
    realTarget(paths.routerUnitFile),
    realTarget(paths.routerSocketFile),
  ];
  const routerTracked = routerFiles.some((file) => Object.hasOwn(changed, file));
  const unitTracked = options.systemd && Object.hasOwn(changed, realTarget(paths.routerUnitFile));
  // A key the person changed since is theirs: `ownedGatewayEnvKeys` leaves it out, so it
  // does not keep the router up for sessions that no longer point at it.
  const sessionsUseRouter =
    routerTracked && ownedGatewayEnvKeys(paths.settingsFile, paths.stateDir).length > 0;

  if (sessionsUseRouter && !options.now) {
    // Stage 1: nothing stops, so nothing is asked.
    return withLock(
      paths.stateDir,
      () => {
        const results = restore(paths.stateDir, { except: routerFiles });
        print(results, short);
        forgetInstructionChoice(paths.stateDir, short);
        console.log(STAGE_ONE_DONE);
        return results.some((result) => result.action === "no-backup") ? 1 : 0;
      },
      { waitMs: 10_000 },
    );
  }

  if (sessionsUseRouter) {
    if (
      !askFirst(
        options,
        NOW_WARNING,
        "Stop cc-smart-dev-kit-router and restore everything now?",
        `to do it now: ${COMMAND} restore --now --yes`,
      )
    ) {
      return 1;
    }
  } else if (unitTracked && unitActive(options.runner)) {
    if (
      !askFirst(
        options,
        STOP_WARNING,
        "Stop cc-smart-dev-kit-router and restore?",
        `to stop it: ${COMMAND} restore --yes`,
      )
    ) {
      return 1;
    }
  }

  return withLock(
    paths.stateDir,
    async () => {
      if (unitTracked) {
        // The port the router listens on: the config's. An unusable config leaves it
        // unknown; the stop is sent all the same, with no port to wait for. (Its health
        // answer names its port too, but it can only be asked on a port already known.)
        let port: null | number;
        try {
          port = configuredPort(paths.gatewayConfigFile);
        } catch (error) {
          console.log(`  cannot read the router's port (${messageOf(error)}); not waiting for it`);
          port = null;
        }
        const stopped = await stopRouter(options.runner, port, options.probe, {
          dir: dirname(paths.routerUnitFile),
          socket: SOCKET_NAME,
          unit: UNIT_NAME,
        });
        switch (stopped.kind) {
          case "closed":
            console.log(
              `- ${UNITS}: disabled and stopped (port ${port} closed; answers in flight finish in the background)`,
            );
            break;
          case "no-port":
            console.log(`- ${UNITS}: disabled and stopping`);
            break;
          case "not-running":
            console.log(
              `  ${UNIT_NAME} was not running (systemctl --user is-active: ${stopped.state}); not waiting for port ${port}`,
            );
            console.log(`- ${UNITS}: disabled and stopped`);
            break;
          case "other":
            console.log(
              `  port ${port} answers, but not as this router (${stopped.detail}); not waiting for it`,
            );
            console.log(`- ${UNITS}: disabled and stopping`);
            break;
        }
      }
      const results = restore(paths.stateDir);
      if (unitTracked) options.runner(["systemctl", "--user", "daemon-reload"]);
      // The router is gone: a setup that did not finish has nothing left to finish.
      rmSync(restartPendingFile(paths.stateDir), { force: true });
      // So is its limit state: no status line or alert may read a stale fallback from it.
      const stateGone = routerTracked && existsSync(paths.gatewayStateFile);
      if (stateGone) rmSync(paths.gatewayStateFile, { force: true });
      print(results, short);
      if (stateGone) {
        console.log(`- ${short(paths.gatewayStateFile)}: removed (the router's limit state)`);
      }
      const forgot = forgetInstructionChoice(paths.stateDir, short);
      if (results.length === 0 && !stateGone) {
        if (!forgot) console.log("Nothing to restore: cc-smart-dev-kit has nothing in any file.");
        return 0;
      }
      return results.some((result) => result.action === "no-backup") ? 1 : 0;
    },
    { waitMs: 10_000 },
  );
}
