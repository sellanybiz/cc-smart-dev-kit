/**
 * `anymodel update`: the self-update by hand.
 *
 *   update            check now and install a newer version, in this terminal, with the
 *                     output of each `claude plugin` command
 *   update --check    only say whether a newer version exists; changes nothing
 *   update --hold     the SessionStart hook stops checking on this machine
 *   update --resume   it checks again (at most once an hour)
 *
 * The background check and this command share the update lock, so they never run at once.
 */

import {
  COMMAND,
  MARKETPLACE_ADD_COMMAND,
  PLUGIN,
  PLUGIN_ID,
  PLUGIN_INSTALL_COMMAND,
} from "../build-info";
import { withLock } from "../setup/lock";
import { redactUrl } from "../setup/marketplace-access";
import {
  applyUpdate,
  CLAUDE_TIMEOUT_MS,
  type CommandRunner,
  commandContext,
  ROUTER_SETUP_HINT,
  routerNeedsSetup,
} from "../update/apply";
import { checkForUpdate, isOlder, remotePluginVersion, type UpdateStatus } from "../update/check";
import {
  type CheckResult,
  checkRunning,
  heldSince,
  hold,
  isHeld,
  isoSeconds,
  readLastCheck,
  resume,
  unreachableCheck,
  updateFiles,
  writeLastCheck,
} from "../update/state";
import { type CliPaths, tildify } from "./paths";

type Env = Record<string, string | undefined>;

export const UPDATE_USAGE = `Usage: ${COMMAND} update [--check | --hold | --resume]`;

/** Said by `--hold` and `--resume` while a check holds the update lock. */
export const CHECK_RUNNING = "A check is running now; it finishes.";

/** Runs a command with its output on this terminal, in the home folder, without git's repo variables. */
const terminalRunner = (env: Env, home: string): CommandRunner => {
  const context = commandContext(env, home);
  return (argv) => {
    try {
      const result = Bun.spawnSync(argv, {
        ...context,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        timeout: CLAUDE_TIMEOUT_MS,
      });
      return { exitCode: result.exitCode ?? 1, output: "" };
    } catch (error) {
      return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
    }
  };
};

/** Says why there is nothing to update here; the exit code. */
function cannotUpdate(status: UpdateStatus): null | number {
  switch (status.kind) {
    case "not-installed":
      console.error(`${PLUGIN_ID} is not installed for this user. Run: ${PLUGIN_INSTALL_COMMAND}`);
      return 1;
    case "no-marketplace":
      console.error(`${status.detail}. Run: ${MARKETPLACE_ADD_COMMAND}`);
      return 1;
    case "unreachable":
      console.error(
        `cannot read the marketplace (${status.detail}). Check your git access: an SSH key, or a git credential helper.`,
      );
      return 1;
    default:
      return null;
  }
}

async function check(paths: CliPaths, env: Env): Promise<number> {
  const status = checkForUpdate(paths, env);
  const stop = cannotUpdate(status);
  if (stop !== null) return stop;
  if (status.kind === "up-to-date") {
    console.log(`${PLUGIN} ${status.installed} is the newest version.`);
    return 0;
  }
  if (status.kind !== "behind") return 1;
  const installed = status.installed ?? "(no version)";
  let available = status.inCopy;
  if (status.catalogBehind && status.remote !== null) {
    const remote = remotePluginVersion(status.remote.url, status.remote.ref, env);
    if (!remote.ok) {
      console.log(
        `The marketplace has commits this machine has not fetched (${redactUrl(status.remote.url)}); their version could not be read (${remote.detail}). Run: ${COMMAND} update`,
      );
      return 0;
    }
    available = remote.version;
  }
  if (isOlder(status.installed, available)) {
    console.log(
      `${PLUGIN} ${available} is available (installed: ${installed}). Run: ${COMMAND} update`,
    );
  } else {
    console.log(
      `${PLUGIN} ${installed} is the newest version${status.catalogBehind ? " (the marketplace has newer commits, with no new version)" : ""}.`,
    );
  }
  return 0;
}

async function updateNow(paths: CliPaths, env: Env, now: () => number): Promise<number> {
  const files = updateFiles(paths.stateDir);
  return withLock(
    files.lockDir,
    () => {
      const at = isoSeconds(now());
      const previous = readLastCheck(files);
      const record = (result: CheckResult, detail: string) =>
        writeLastCheck(files, { at, detail, result });
      const status = checkForUpdate(paths, env);
      const stop = cannotUpdate(status);
      if (stop !== null) {
        if (status.kind === "unreachable") {
          // The same rule as the background check: a failure only after 24 h in a row.
          writeLastCheck(files, unreachableCheck(previous, at, now(), status.detail));
        } else {
          record("skipped", "detail" in status ? status.detail : `${PLUGIN_ID} is not installed`);
        }
        return stop;
      }
      let code = 0;
      if (status.kind === "up-to-date") {
        console.log(`${PLUGIN} ${status.installed} is up to date.`);
        record("up-to-date", status.installed);
      } else {
        const claude = Bun.which("claude", { PATH: env.PATH ?? "" });
        const result = applyUpdate(paths, claude, terminalRunner(env, paths.home), (line) =>
          console.log(`$ ${line}`),
        );
        if (!result.ok) {
          console.error(result.detail);
          record(result.busy === true ? "skipped" : "failed", result.detail);
          code = 1;
        } else if (result.after === result.before) {
          console.log(`${PLUGIN} ${result.after ?? "(no version)"} is the newest version.`);
          record("up-to-date", result.after ?? "(no version)");
        } else {
          console.log(
            `${PLUGIN} ${result.after ?? "(no version)"} installed (was ${result.before ?? "none"}). Restart Claude sessions to load it.`,
          );
          const routerChanged = routerNeedsSetup(paths);
          record(
            "updated",
            `${result.after ?? "(no version)"} (was ${result.before ?? "none"})${routerChanged ? `; ${ROUTER_SETUP_HINT}` : ""}`,
          );
          if (routerChanged) {
            console.log(
              `Its router changed too. To run it: ${COMMAND} gateway setup (it asks before the restart).`,
            );
          }
        }
      }
      if (isHeld(files)) {
        console.log(
          `Background updates stay on hold (since ${heldSince(files)}). To resume them: ${COMMAND} update --resume`,
        );
      }
      return code;
    },
    { waitMs: 10_000 },
  );
}

/** `anymodel update [--check | --hold | --resume]`; the exit code. */
export async function runUpdate(
  paths: CliPaths,
  env: Env,
  args: string[],
  now: () => number = () => Date.now(),
): Promise<number> {
  const files = updateFiles(paths.stateDir);
  if (args.length > 1) {
    console.error(UPDATE_USAGE);
    return 2;
  }
  switch (args[0]) {
    case undefined:
      return updateNow(paths, env, now);
    case "--check":
      return check(paths, env);
    // No lock: one atomic write (or removal). A check that runs now is not waited for.
    case "--hold":
      if (!hold(files, now())) {
        console.log(`Background updates were already on hold (since ${heldSince(files)}).`);
      } else {
        console.log(
          `Background updates are on hold: a new Claude session no longer checks for a newer ${PLUGIN}. To resume: ${COMMAND} update --resume`,
        );
      }
      if (checkRunning(files)) console.log(CHECK_RUNNING);
      return 0;
    case "--resume":
      console.log(
        resume(files)
          ? `Background updates resume: a new Claude session checks for a newer ${PLUGIN}, at most once an hour (${tildify(files.log, paths.home)}).`
          : "Background updates were not on hold.",
      );
      if (checkRunning(files)) console.log(CHECK_RUNNING);
      return 0;
    default:
      console.error(`Unknown option: ${args[0]}\n\n${UPDATE_USAGE}`);
      return 2;
  }
}
