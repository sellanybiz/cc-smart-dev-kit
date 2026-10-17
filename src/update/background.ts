/**
 * The self-update: the SessionStart hook's part (`sessionStart`, which must return at
 * once) and the detached background check it starts (`backgroundCheck`).
 *
 * Why it exists: Claude Code's own plugin auto-update did not run on a machine where it
 * was on (`autoUpdate: true`): 15 minutes after a session started, not even the
 * marketplace copy was refreshed (anthropics/claude-code#61854). The same two commands by
 * hand worked at once. The person chose this self-update, and accepted its trade-off: a
 * bad release reaches every machine within the hour. `cc-smart-dev-kit update --hold` stops it on
 * one machine, and Claude Code's own switches for updates stop it too (`./opt-out.ts`).
 *
 * What it never does: restart the router, a service or a session; change a permission;
 * ask a question. It installs the new version only; a session loads it when it restarts.
 */

import { COMMAND, PLUGIN, PLUGIN_ID } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { detachedArgv } from "../hooks/detached";
import { bunConfigArg } from "../setup/bun-config";
import { type InstructionsPaths, refreshInstructionsCopy } from "../setup/instructions";
import { LockBusyError, withLock } from "../setup/lock";
import { redactUrlsIn } from "../setup/marketplace-access";
import {
  type ApplyResult,
  applyUpdate,
  type CommandRunner,
  installedText,
  ROUTER_SETUP_HINT,
  routerNeedsSetup,
} from "./apply";
import { checkForUpdate } from "./check";
import { blockingVar } from "./opt-out";
import {
  appendLog,
  type CheckResult,
  isDue,
  isHeld,
  isoSeconds,
  type LastCheck,
  markReported,
  readLastCheck,
  registerSession,
  unreachableCheck,
  updateFiles,
  wasReported,
  writeLastCheck,
} from "./state";

type Env = Record<string, string | undefined>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The detail of a check skipped because Claude Code's switch for updates is set. */
export function optOutDetail(name: string): string {
  return `${name} is set`;
}

/**
 * True when a person sees this session's messages. Claude Code sets
 * `CLAUDE_CODE_SESSION_ATTENDED=0` for its hooks in `claude -p` (and `1` in an interactive
 * session; seen on 2.1.300). The hook's input does not say which (the same fields in
 * both). Without the variable (another Claude Code version), the session counts as
 * attended, as before.
 */
export function isAttended(env: Env): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
}

/**
 * The detached check's own command line: this bun and this bundle again, with `--background`,
 * and the two flags every run of the plugin's own bundles gets (`src/setup/bun-config.ts`).
 * The child runs in the home folder: without them bun would read that folder's `.env` files
 * and its `bunfig.toml`.
 */
export function backgroundCommand(bunPath: string, entryPath: string, pluginDir: string): string[] {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), entryPath, "--background"];
}

export interface SessionStartDeps {
  paths: CliPaths;
  /** The hook's environment: the update switches, and whether a person is there. */
  env: Env;
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
 * updates are not held.
 *
 * With one of Claude Code's switches for updates in force (`DISABLE_AUTOUPDATER`, …,
 * without `FORCE_AUTOUPDATE_PLUGINS`), it starts nothing and says nothing: it records
 * "skipped: <name> is set", once (a record that says so already stays, with its time).
 *
 * Its answer (stdout) is empty, unless the last background check failed and no session
 * was told yet: then one `systemMessage`, to an attended session only. A `claude -p`
 * session does not count as told, so the next interactive one says it.
 */
export function sessionStart(deps: SessionStartDeps): string {
  const files = updateFiles(deps.paths.stateDir);
  if (deps.sessionPid !== null) registerSession(files, deps.sessionPid, deps.version);
  if (isHeld(files)) return "";
  const last = readLastCheck(files);
  const blocked = blockingVar(deps.env, deps.paths.settingsFile);
  if (blocked !== null) {
    const detail = optOutDetail(blocked);
    if (last?.result !== "skipped" || last.detail !== detail) {
      writeLastCheck(files, { at: isoSeconds(deps.nowMs), detail, result: "skipped" });
    }
    return "";
  }
  let answer = "";
  // One streak of an unreadable marketplace is told once, not once per hourly check.
  const reportKey = last?.since ?? last?.at ?? "";
  if (last?.result === "failed" && !wasReported(files, reportKey) && isAttended(deps.env)) {
    markReported(files, reportKey);
    answer = JSON.stringify({
      systemMessage: `${PLUGIN}: the background update failed at ${last.at} (${last.detail}). The log: ${tildify(files.log, deps.paths.home)}. To try now: ${COMMAND} update`,
    });
  }
  if (isDue(last, deps.nowMs)) deps.spawnBackground();
  return answer;
}

/**
 * The argv the detached background check runs: this Bun, the same bundle, `--background`.
 *
 * On Windows it goes through the `cmd /c start` trampoline (`detachedArgv`) — a plain
 * detached child dies with its hook there (oven-sh/bun#31603) — and carries `--no-env-file`:
 * the trampoline starts in the home folder, where Bun would otherwise load a `.env` of the
 * person's into the check. Linux and macOS keep the argv they had.
 */
export function backgroundCheckArgv(
  platform: NodeJS.Platform,
  bun: string,
  bundle: string,
  pluginDir: string,
): string[] {
  return detachedArgv(platform, backgroundCommand(bun, bundle, pluginDir));
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

/** What the instructions refresh needs: where the copy goes, and this session's version. */
export interface InstructionsRefreshDeps {
  /** The managed copy's paths (`instructionsPaths`), with the plugin's instructions as source. */
  where: InstructionsPaths;
  /** The plugin version this session loaded: the copy is brought up to it. */
  version: string;
  /** One line, when the refresh fails; the session goes on either way. */
  log: (line: string) => void;
  /** How long it may wait for the state folder's lock. Default 2 s. */
  waitMs?: number;
}

/**
 * The one thing a session start does for the instructions: a plugin update installs the new
 * version's files, but the running version's code wrote the managed copy — so the **first
 * session start of a new version** brings the copy up to it. The copy only: never the
 * `CLAUDE.md` block, never a question, nothing when the person chose `--no-instructions` or
 * setup never installed it (`instructionsNeedRefresh`), nothing from a session of a version
 * that is neither the installed one nor newer than the copy (`refreshMayWrite`: an old session
 * that resumes or compacts after an update), and nothing when another process holds the
 * state lock (it does the work). A failure is one line, and the session goes on.
 */
export async function refreshInstructionsAtSessionStart(
  deps: InstructionsRefreshDeps,
): Promise<void> {
  try {
    await refreshInstructionsCopy(deps.where, deps.version, { waitMs: deps.waitMs ?? 2_000 });
  } catch (error) {
    // Another session holds the state lock: it is doing the refresh, or has just done it.
    // Nothing is wrong, and a session start says nothing about it.
    if (error instanceof LockBusyError) return;
    deps.log(
      `${PLUGIN}: the instructions copy was not refreshed (${messageOf(error)}). A plain ${COMMAND} setup brings it up to date.`,
    );
  }
}

/**
 * The background check, in a detached process. Under the update lock (`update/lock` in
 * the state folder; a busy lock means another check runs, so it leaves at once), it asks
 * again whether a check is due, updates are not held and not switched off, so two
 * sessions that start together check once. Then: the check, and when there is something
 * newer, the two `claude plugin` commands. Each step goes to `update.log`; the result to
 * `update-check.json`; a new version installed gives one desktop notification.
 *
 * A marketplace that cannot be read is `unreachable` (information) until it has been so
 * for 24 h in a row, then `failed`. Claude Code busy with the same marketplace copy is
 * `skipped`.
 */
export async function backgroundCheck(deps: BackgroundDeps): Promise<void> {
  const files = updateFiles(deps.paths.stateDir);
  const log = (line: string) => appendLog(files, line, deps.now());
  let at = isoSeconds(deps.now());
  try {
    await withLock(
      files.lockDir,
      () => {
        const previous = readLastCheck(files);
        if (isHeld(files) || !isDue(previous, deps.now())) return;
        at = isoSeconds(deps.now());
        const write = (check: LastCheck) => {
          writeLastCheck(files, check);
          log(`${check.result}: ${check.detail}`);
        };
        const record = (result: CheckResult, detail: string) => write({ at, detail, result });
        const blocked = blockingVar(deps.env, deps.paths.settingsFile);
        if (blocked !== null) {
          record("skipped", optOutDetail(blocked));
          return;
        }
        // A check that crashes stays `checking`; it keeps an unreachable streak's start.
        writeLastCheck(files, {
          at,
          detail: "",
          result: "checking",
          ...(previous?.since !== undefined && { since: previous.since }),
        });
        const status = checkForUpdate(deps.paths, deps.env);
        switch (status.kind) {
          case "not-installed":
            record("skipped", `${PLUGIN_ID} is not installed for this user`);
            return;
          case "no-marketplace":
            record("skipped", status.detail);
            return;
          case "unreachable":
            write(unreachableCheck(previous, at, deps.now(), status.detail));
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
            if (result.busy === true) {
              record("skipped", result.detail);
              return;
            }
            if (!result.ok) {
              record("failed", result.detail);
              return;
            }
            if (result.after === result.before) {
              record("up-to-date", result.after ?? "(no version)");
              return;
            }
            const routerChanged = routerNeedsSetup(deps.paths);
            record(
              "updated",
              `${result.after ?? "(no version)"} (was ${result.before ?? "none"})${routerChanged ? `; ${ROUTER_SETUP_HINT}` : ""}`,
            );
            deps.notify(installedText(result.after, routerChanged));
            return;
          }
        }
      },
      { waitMs: 0 },
    );
  } catch (error) {
    // Another check holds the lock: it does the work.
    if (error instanceof LockBusyError) return;
    const detail = redactUrlsIn(messageOf(error));
    try {
      writeLastCheck(files, { at, detail, result: "failed" });
      log(`failed: ${detail}`);
    } catch {
      // The state folder cannot be written: nothing more to record anything in.
    }
  }
}
