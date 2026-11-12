/**
 * `cc-smart-dev-kit update`: the self-update by hand.
 *
 *   update            check now and install a newer version, in this terminal, with the
 *                     output of each `claude plugin` command; a new major version too (the
 *                     background check holds one for this, D33), after the repos that still
 *                     carry a retired piece are listed
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
import { isOlder } from "../build-info/semver";
import { withLock } from "../setup/lock";
import { redactUrl } from "../setup/marketplace-access";
import {
  applyUpdate,
  CLAUDE_TIMEOUT_MS,
  type CommandRunner,
  commandContext,
  type MajorStep,
  ROUTER_SETUP_HINT,
  routerNeedsSetup,
} from "../update/apply";
import { checkForUpdate, remotePluginVersion, type UpdateStatus } from "../update/check";
import {
  isNewMajor,
  majorHeldDetail,
  majorInstallLine,
  majorSetupLine,
  majorStillWaitsLine,
} from "../update/major";
import { retiredRepoLines } from "../update/retired-repos";
import {
  type CheckResult,
  checkRunning,
  clearHeldMajor,
  heldSince,
  hold,
  isHeld,
  isoSeconds,
  readHeldMajor,
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

/** Says why there is nothing to update here; the exit code. A failure goes to the error sink. */
function cannotUpdate(status: UpdateStatus, error: (line: string) => void): null | number {
  switch (status.kind) {
    case "not-installed":
      error(`${PLUGIN_ID} is not installed for this user. Run: ${PLUGIN_INSTALL_COMMAND}`);
      return 1;
    case "no-marketplace":
      error(`${status.detail}. Run: ${MARKETPLACE_ADD_COMMAND}`);
      return 1;
    case "unreachable":
      error(
        `cannot read the marketplace (${status.detail}). Check your git access: an SSH key, or a git credential helper.`,
      );
      return 1;
    default:
      return null;
  }
}

async function check(paths: CliPaths, env: Env, sinks: Sinks): Promise<number> {
  const { error, print } = sinks;
  const status = checkForUpdate(paths, env);
  const stop = cannotUpdate(status, error);
  if (stop !== null) return stop;
  if (status.kind === "up-to-date") {
    print(`${PLUGIN} ${status.installed} is the newest version.`);
    return 0;
  }
  if (status.kind !== "behind") return 1;
  const installed = status.installed ?? "(no version)";
  let available = status.inCopy;
  if (status.catalogBehind && status.remote !== null) {
    const remote = remotePluginVersion(status.remote.url, status.remote.ref, env);
    if (!remote.ok) {
      print(
        `The marketplace has commits this machine has not fetched (${redactUrl(status.remote.url)}); their version could not be read (${remote.detail}). Run: ${COMMAND} update`,
      );
      return 0;
    }
    available = remote.version;
  }
  if (isOlder(status.installed, available)) {
    const major = isNewMajor(status.installed, available)
      ? " It is a major version: read What's new first."
      : "";
    print(
      `${PLUGIN} ${available} is available (installed: ${installed}).${major} Run: ${COMMAND} update`,
    );
  } else {
    print(
      `${PLUGIN} ${installed} is the newest version${status.catalogBehind ? " (the marketplace has newer commits, with no new version)" : ""}.`,
    );
  }
  return 0;
}

async function updateNow(
  paths: CliPaths,
  env: Env,
  now: () => number,
  sinks: Sinks,
): Promise<number> {
  const { error, print } = sinks;
  const files = updateFiles(paths.stateDir);
  return withLock(
    files.lockDir,
    async () => {
      const at = isoSeconds(now());
      const previous = readLastCheck(files);
      const record = (result: CheckResult, detail: string) =>
        writeLastCheck(files, { at, detail, result });
      const status = checkForUpdate(paths, env);
      const stop = cannotUpdate(status, error);
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
        clearHeldMajor(files);
        print(`${PLUGIN} ${status.installed} is up to date.`);
        record("up-to-date", status.installed);
      } else {
        const claude = Bun.which("claude", { PATH: env.PATH ?? "" });
        // The major version this run was asked to install, when there is one.
        const seen: { major: MajorStep | null } = { major: null };
        const result = await applyUpdate(
          paths,
          claude,
          sinks.run ?? terminalRunner(env, paths.home),
          (line) => print(`$ ${line}`),
          // The person's own `update` is their word for a new major version (D33). First the
          // repos it would break, so they know where `project init` has work to do.
          (major) => {
            seen.major = major;
            print(majorInstallLine(major.to, major.notes));
            for (const line of retiredRepoLines(paths, env)) print(line);
            return true;
          },
        );
        const major = seen.major;
        // A major version that did not get installed still waits: a failed install, or a
        // `claude plugin update` that ended well and installed nothing.
        const majorWaits = major !== null && isOlder(result.after, major.to);
        // The hold goes only once the version it holds is really installed.
        const clearHoldIfInstalled = () => {
          const held = readHeldMajor(files);
          if (held === null || !isOlder(result.after, held.version)) clearHeldMajor(files);
        };
        if (!result.ok) {
          error(result.detail);
          if (majorWaits) error(majorStillWaitsLine(major.to, major.notes));
          record(result.busy === true ? "skipped" : "failed", result.detail);
          code = 1;
        } else if (majorWaits) {
          error(majorStillWaitsLine(major.to, major.notes));
          record("skipped", majorHeldDetail(major.to, major.notes));
          code = 1;
        } else if (result.after === result.before) {
          clearHoldIfInstalled();
          print(`${PLUGIN} ${result.after ?? "(no version)"} is the newest version.`);
          record("up-to-date", result.after ?? "(no version)");
        } else {
          clearHoldIfInstalled();
          print(
            `${PLUGIN} ${result.after ?? "(no version)"} installed (was ${result.before ?? "none"}). Restart Claude sessions to load it.`,
          );
          const routerChanged = routerNeedsSetup(paths);
          record(
            "updated",
            `${result.after ?? "(no version)"} (was ${result.before ?? "none"})${routerChanged ? `; ${ROUTER_SETUP_HINT}` : ""}`,
          );
          if (routerChanged) {
            print(
              `Its router changed too. To run it: ${COMMAND} gateway setup (it asks before the restart). A machine set up before Claude became the default runs ${COMMAND} setup once first, which moves it.`,
            );
          }
          // A major version's own one-time steps run in its setup.
          if (major !== null) print(majorSetupLine());
        }
      }
      if (isHeld(files)) {
        print(
          `Background updates stay on hold (since ${heldSince(files)}). To resume them: ${COMMAND} update --resume`,
        );
      }
      return code;
    },
    { waitMs: 10_000 },
  );
}

/**
 * Where the command's lines go, and how its `claude plugin` steps run. The CLI's own
 * `console.log` / `console.error` and a runner that inherits the terminal; the portal passes
 * a collector and a runner that captures each command's output, because the terminal is not
 * where the person is looking.
 *
 * A failure goes to `error`, so a script (or the page) can read it apart from the rest.
 */
export interface UpdateSinks {
  print: (line: string) => void;
  error: (line: string) => void;
  /** Runs one `claude plugin …` step. Absent: `terminalRunner`, which inherits the terminal. */
  run?: CommandRunner;
}

type Sinks = UpdateSinks;

const CONSOLE_SINKS: UpdateSinks = {
  error: (line) => console.error(line),
  print: (line) => console.log(line),
};

/** `cc-smart-dev-kit update [--check | --hold | --resume]`; the exit code. */
export async function runUpdate(
  paths: CliPaths,
  env: Env,
  args: string[],
  now: () => number = () => Date.now(),
  /** Where every line goes: `console.log` and `console.error` in use, a collector in the portal. */
  sinks: UpdateSinks = CONSOLE_SINKS,
): Promise<number> {
  const { error, print } = sinks;
  const files = updateFiles(paths.stateDir);
  if (args.length > 1) {
    error(UPDATE_USAGE);
    return 2;
  }
  switch (args[0]) {
    case undefined:
      return updateNow(paths, env, now, sinks);
    case "--check":
      return check(paths, env, sinks);
    // No lock: one atomic write (or removal). A check that runs now is not waited for.
    case "--hold":
      if (!hold(files, now())) {
        print(`Background updates were already on hold (since ${heldSince(files)}).`);
      } else {
        print(
          `Background updates are on hold: a new Claude session no longer checks for a newer ${PLUGIN}. To resume: ${COMMAND} update --resume`,
        );
      }
      if (checkRunning(files)) print(CHECK_RUNNING);
      return 0;
    case "--resume":
      print(
        resume(files)
          ? `Background updates resume: a new Claude session checks for a newer ${PLUGIN}, at most once an hour (${tildify(files.log, paths.home)}).`
          : "Background updates were not on hold.",
      );
      if (checkRunning(files)) print(CHECK_RUNNING);
      return 0;
    default:
      error(`Unknown option: ${args[0]}\n\n${UPDATE_USAGE}`);
      return 2;
  }
}
