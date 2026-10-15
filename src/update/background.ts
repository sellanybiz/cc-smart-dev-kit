/**
 * The self-update: the SessionStart hook's part (`sessionStart`, which must return at
 * once) and the detached background check it starts (`backgroundCheck`).
 *
 * Why it exists: Claude Code's own plugin auto-update did not run on a machine where it
 * was on (`autoUpdate: true`): 15 minutes after a session started, not even the
 * marketplace copy was refreshed (anthropics/claude-code#61854). The same two commands by
 * hand worked at once. The person chose this self-update, and accepted its trade-off: a
 * bad release reaches every machine within the hour. `anymodel update --hold` stops it on
 * one machine.
 *
 * What it never does: restart the router, a service or a session; change a permission;
 * ask a question. It installs the new version only; a session loads it when it restarts.
 */

import { COMMAND, PLUGIN, PLUGIN_ID } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { LockBusyError, withLock } from "../setup/lock";
import { type ApplyResult, applyUpdate, type CommandRunner, installedText } from "./apply";
import { checkForUpdate } from "./check";
import {
  appendLog,
  type CheckResult,
  isDue,
  isHeld,
  isoSeconds,
  markReported,
  readLastCheck,
  registerSession,
  updateFiles,
  wasReported,
  writeLastCheck,
} from "./state";

type Env = Record<string, string | undefined>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SessionStartDeps {
  paths: CliPaths;
  nowMs: number;
  /** The Claude session's process (`CLAUDE_PID`), or null when unknown. */
  sessionPid: null | number;
  /** The plugin version this hook belongs to: the one the session loaded. */
  version: string;
  /** Starts `backgroundCheck` in a detached process and returns at once. */
  spawnBackground: () => void;
}

/**
 * The SessionStart hook: fast, no network, no lock. It records which version this session
 * loaded, and starts the background check when one is due (at most one an hour) and
 * updates are not held. Its answer (stdout) is empty, unless the last background check
 * failed and no session was told yet: then one `systemMessage` for the person.
 */
export function sessionStart(deps: SessionStartDeps): string {
  const files = updateFiles(deps.paths.stateDir);
  if (deps.sessionPid !== null) registerSession(files, deps.sessionPid, deps.version);
  if (isHeld(files)) return "";
  const last = readLastCheck(files);
  let answer = "";
  if (last?.result === "failed" && !wasReported(files, last.at)) {
    markReported(files, last.at);
    answer = JSON.stringify({
      systemMessage: `${PLUGIN}: the background update failed at ${last.at} (${last.detail}). The log: ${tildify(files.log, deps.paths.home)}. To try now: ${COMMAND} update`,
    });
  }
  if (isDue(last, deps.nowMs)) deps.spawnBackground();
  return answer;
}

export interface BackgroundDeps {
  paths: CliPaths;
  env: Env;
  now: () => number;
  /** The claude command's path, or null when it is not on PATH. */
  claude: null | string;
  run: CommandRunner;
  /** Shows a desktop notification, where the machine has a way to. */
  notify: (text: string) => void;
}

/**
 * The background check, in a detached process. Under the update lock (`update/lock` in
 * the state folder; a busy lock means another check runs, so it leaves at once), it asks
 * again whether a check is due and updates are not held, so two sessions that start
 * together check once. Then: the check, and when there is something newer, the two
 * `claude plugin` commands. Each step goes to `update.log`; the result to
 * `update-check.json`; a new version installed gives one desktop notification.
 */
export async function backgroundCheck(deps: BackgroundDeps): Promise<void> {
  const files = updateFiles(deps.paths.stateDir);
  const log = (line: string) => appendLog(files, line, deps.now());
  let at = isoSeconds(deps.now());
  try {
    await withLock(
      files.lockDir,
      () => {
        if (isHeld(files) || !isDue(readLastCheck(files), deps.now())) return;
        at = isoSeconds(deps.now());
        writeLastCheck(files, { at, detail: "", result: "checking" });
        const record = (result: CheckResult, detail: string) => {
          writeLastCheck(files, { at, detail, result });
          log(`${result}: ${detail}`);
        };
        const status = checkForUpdate(deps.paths, deps.env);
        switch (status.kind) {
          case "not-installed":
            record("skipped", `${PLUGIN_ID} is not installed for this user`);
            return;
          case "no-marketplace":
            record("skipped", status.detail);
            return;
          case "unreachable":
            record("failed", `cannot read the marketplace (${status.detail})`);
            return;
          case "up-to-date":
            record("up-to-date", status.installed);
            return;
          case "behind": {
            log(
              `newer: installed ${status.installed ?? "(no version)"}, the marketplace copy ${status.inCopy ?? "(unreadable)"}${status.catalogBehind ? ", and the copy is behind the remote" : ""}`,
            );
            const result: ApplyResult = applyUpdate(deps.paths, deps.claude, deps.run, (line) =>
              log(`run: ${line}`),
            );
            if (!result.ok) {
              record("failed", result.detail);
              return;
            }
            if (result.after === result.before) {
              record("up-to-date", result.after ?? "(no version)");
              return;
            }
            record("updated", `${result.after ?? "(no version)"} (was ${result.before ?? "none"})`);
            deps.notify(installedText(result.after));
            return;
          }
        }
      },
      { waitMs: 0 },
    );
  } catch (error) {
    // Another check holds the lock: it does the work.
    if (error instanceof LockBusyError) return;
    const detail = messageOf(error);
    try {
      writeLastCheck(files, { at, detail, result: "failed" });
      log(`failed: ${detail}`);
    } catch {
      // The state folder cannot be written: nothing more to record anything in.
    }
  }
}
