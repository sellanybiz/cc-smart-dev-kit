/**
 * The router as a long-running service: its copy in `~/.local/share/anymodel/router.js`
 * and its systemd user unit `anymodel-router.service`.
 *
 * The copy, never the plugin's own `dist/router.js`: Claude Code deletes an old version
 * folder some time after an update, even under a running process. Both files go through
 * `writeManagedFile` (backup, record for `restore`, atomic write). A restart cuts every
 * answer in flight on the machine, so the service restarts only when the copy or the
 * unit really changed (or an earlier setup did not finish: `restartPendingFile`), and
 * only after the person said yes (or gave `--yes`).
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import { tildify } from "../cli/paths";
import { atomicWrite, writeManagedFile } from "../setup/write";
import { type HealthProbe, probeRouterPort, waitForRouter, waitWhileRouterAnswers } from "./health";

/** The systemd user unit's name. */
export const UNIT_NAME = "anymodel-router.service";

/** What `install` says when nothing changed. */
export const UP_TO_DATE = "router already up to date (no restart)";

/** Said before a restart, and before the question. */
export const RESTART_WARNING =
  "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).";

/** Runs a command and waits; a test passes its own. */
export type Runner = (cmd: string[]) => { exitCode: number; output: string };

/**
 * The unit file. It runs the copy with the absolute bun path, never a file under the
 * plugin's version folder.
 *
 * - `--no-env-file`: the router needs no environment, and must not load anyone's .env files.
 * - Stopping: systemd sends SIGTERM; the router stops taking requests and exits once the
 *   answers in flight are done. `KillMode=mixed` sends that SIGTERM to the router alone,
 *   and only after `TimeoutStopSec` the SIGKILL to everything left. 120 s lets a normal
 *   answer finish; a longer one is cut, and Claude Code retries it.
 * - `StartLimitIntervalSec=0`: no start limit, so a crash loop keeps retrying every 2 s
 *   and never parks the unit in "failed": every session depends on it.
 */
export function renderUnit(bunPath: string, copyPath: string): string {
  for (const path of [bunPath, copyPath]) {
    if (/["\\\n%]/.test(path)) throw new Error(`cannot put ${JSON.stringify(path)} in a unit file`);
  }
  return `# anymodel-router: the local AI gateway for Claude Code (127.0.0.1 only).
# Written by \`${COMMAND} gateway setup\`; edits here are overwritten by the next setup.
# It runs a copy of the router, never a file in the plugin's version folder.
# Its config: ~/.config/anymodel/gateway.json.

[Unit]
Description=anymodel-router: local AI gateway for Claude Code (127.0.0.1 only)
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="${bunPath}" --no-env-file "${copyPath}"
WorkingDirectory=%h
Restart=always
RestartSec=2
KillMode=mixed
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}

function run(runner: Runner, cmd: string[]): void {
  const result = runner(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${result.exitCode}):\n${result.output.trim()}`);
  }
}

/** True when the unit runs now (`systemctl --user is-active`). */
export function unitActive(runner: Runner): boolean {
  return runner(["systemctl", "--user", "is-active", "--quiet", UNIT_NAME]).exitCode === 0;
}

/**
 * The unit's state as `systemctl --user is-active` names it (`active`, `deactivating`,
 * `activating`, `inactive`, `failed`, …); `unknown` when it printed nothing.
 */
export function unitState(runner: Runner): string {
  const result = runner(["systemctl", "--user", "is-active", UNIT_NAME]);
  return result.output.trim().split("\n")[0]?.trim() || "unknown";
}

/** Said by `gateway setup` before a restart that waits for an old router's drain. */
export const DRAIN_NOTE = "waiting for the old router to finish its answers (up to 120 s)";

export interface InstallOptions {
  /** The bun that runs the router: `process.execPath` of this command. */
  bunPath: string;
  /** The plugin's own `dist/router.js`, copied to `copyPath`. */
  bundle: string;
  copyPath: string;
  unitPath: string;
  home: string;
  stateDir: string;
  /** The port in the config (the default without one): the router listens there. */
  port: number;
  /** Asks the port, and waits for the router after the restart; a test passes fakes. */
  probe: HealthProbe;
  runner: Runner;
  say: (line: string) => void;
  /** `--yes`: restart without asking. */
  yes: boolean;
  /** Asks the person; null when there is no one to ask (no terminal). */
  confirm: ((question: string) => boolean) | null;
  dryRun?: boolean;
}

export type InstallResult = "up-to-date" | "installed" | "declined";

/**
 * The marker of a setup that has not finished: written before the copy and the unit, and
 * removed only once the restarted router answers its health page. While it exists, the
 * next `gateway setup` restarts the unit even when the files are up to date, and `doctor`
 * says the setup did not finish.
 */
export function restartPendingFile(stateDir: string): string {
  return join(stateDir, "restart-pending");
}

/** How long `installRouter` waits for the restarted router to answer. */
const HEALTH_WAIT_MS = 5_000;

/**
 * Puts the copy and the unit in place, then enables and starts the unit, or restarts it
 * when the copy or the unit changed (or an earlier setup did not finish). Re-running it is
 * the upgrade path. A running router is restarted only after a yes; without one nothing is
 * written (`declined`).
 *
 * First of all, before any write or question, it asks the port: a program that is not
 * this router there (an older router, say) stops it, with nothing written. After the
 * restart it waits for the health page; when that never answers, it throws with the
 * unit's state, and the restart-pending marker stays.
 */
export async function installRouter(options: InstallOptions): Promise<InstallResult> {
  const port = await probeRouterPort(options.port, options.probe.fetch);
  if (port.state === "other") {
    throw new Error(
      `port ${options.port} is used by another program (an older router? stop it first)`,
    );
  }
  const short = (path: string) => tildify(path, options.home);
  const copyText = readFileSync(options.bundle, "utf8");
  const unitText = renderUnit(options.bunPath, options.copyPath);
  const marker = restartPendingFile(options.stateDir);
  const write = (file: string, text: string, dryRun: boolean) =>
    writeManagedFile(file, text, {
      stateDir: options.stateDir,
      kind: "whole-file",
      mode: 0o644,
      dryRun,
    });

  // A read-only pass first: what would change, before anything is written or asked.
  const copyPlan = write(options.copyPath, copyText, true).outcome;
  const unitPlan = write(options.unitPath, unitText, true).outcome;
  if (copyPlan === "unchanged" && unitPlan === "unchanged" && !existsSync(marker)) {
    if (options.dryRun) return "up-to-date";
    // Starts it if it was stopped; leaves a running router alone.
    run(options.runner, ["systemctl", "--user", "enable", "--now", UNIT_NAME]);
    options.say(UP_TO_DATE);
    return "up-to-date";
  }

  const active = unitActive(options.runner);
  if (active) {
    options.say(RESTART_WARNING);
    if (!options.yes) {
      const yes = options.confirm?.("Restart anymodel-router now?") ?? null;
      if (yes !== true) {
        options.say(
          yes === null
            ? `Nothing was changed. Run again with --yes to restart: ${COMMAND} gateway setup --yes`
            : "Nothing was changed.",
        );
        return "declined";
      }
    }
  }
  if (options.dryRun) return "installed";

  // Before the files: a crash from here on leaves the marker, and the next setup restarts.
  atomicWrite(
    marker,
    `${COMMAND} gateway setup started a router restart at ${new Date(options.probe.now()).toISOString()}; it has not answered yet.\n`,
    0o600,
  );
  const copy = write(options.copyPath, copyText, false);
  if (copy.outcome !== "unchanged") {
    options.say(
      `${copy.outcome === "created" ? "+" : "~"} ${short(options.copyPath)}: router copy ${copy.outcome}`,
    );
  }
  const unit = write(options.unitPath, unitText, false);
  if (unit.outcome !== "unchanged") {
    options.say(
      `${unit.outcome === "created" ? "+" : "~"} ${short(options.unitPath)}: unit ${unit.outcome}`,
    );
  }
  run(options.runner, ["systemctl", "--user", "daemon-reload"]);
  run(options.runner, ["systemctl", "--user", "enable", UNIT_NAME]);
  if (active) options.say("restarting anymodel-router");
  // Right after `restore`, the old router may still drain its answers (`stop --no-block`
  // returned at once). `restart` then waits for that stop to end, up to the unit's
  // `TimeoutStopSec`: say so, or setup looks stuck.
  else if (unitState(options.runner) === "deactivating") options.say(DRAIN_NOTE);
  // `restart` starts it when stopped, and loads the new copy when running.
  run(options.runner, ["systemctl", "--user", "restart", UNIT_NAME]);
  if (!(await waitForRouter(options.port, options.probe, HEALTH_WAIT_MS))) {
    throw new Error(
      `${UNIT_NAME} did not answer on 127.0.0.1:${options.port} within ${HEALTH_WAIT_MS / 1000} s of the restart (systemctl --user is-active: ${unitState(options.runner)}). See why: journalctl --user -u anymodel-router -n 30. Then run ${COMMAND} gateway setup again.`,
    );
  }
  rmSync(marker, { force: true });
  options.say(`enabled and (re)started ${UNIT_NAME}`);
  return "installed";
}

/** How long `stopRouter` waits for the router's port to close. */
export const STOP_WAIT_MS = 15_000;

/**
 * `systemctl --user is-active` states in which the unit's own router holds its port:
 * running, or still draining after an earlier stop.
 */
const HOLDS_ITS_PORT = new Set(["active", "deactivating"]);

/** What `stopRouter` waited for, so `restore` can say it. */
export type StopResult =
  /** The router's port closed: it takes no new request. */
  | { kind: "closed" }
  /** The port is unknown (an unusable config): nothing was asked. */
  | { kind: "no-port" }
  /** The unit was not running (`state`, from `is-active`): nothing of it to wait for. */
  | { kind: "not-running"; state: string }
  /** Something that is not this router answers on the port: not waited for. */
  | { detail: string; kind: "other" };

/**
 * Disables the unit and stops it, for `restore`, while its unit file is still there.
 *
 * Not `disable --now`: that waits until the router has drained its answers in flight, up
 * to the unit's `TimeoutStopSec` (120 s), and the router closes its port in the first
 * second, so every new request of every session fails for that whole time while restore
 * looks stuck. So: it asks the unit's state, then runs `disable`, then `stop --no-block`
 * (systemd sends SIGTERM and returns), then asks the port (`probe`) while this router
 * answers there, for up to 15 s. The drain finishes in the background.
 *
 * It waits only for the unit's own router: only when the unit was `active` or
 * `deactivating` before the stop, and only while the port answers as this router. A
 * crash-looping unit (another program holds the port, so it never binds) and a router
 * started by hand (`gateway serve`) are not the unit's: a wait for them would never end.
 * `port` null: the port is unknown (an unusable config), so there is nothing to ask; the
 * stop is sent all the same.
 *
 * Throws when this router still answers on the port after 15 s.
 */
export async function stopRouter(
  runner: Runner,
  port: null | number,
  probe: HealthProbe,
): Promise<StopResult> {
  const state = port === null ? null : unitState(runner);
  run(runner, ["systemctl", "--user", "disable", UNIT_NAME]);
  run(runner, ["systemctl", "--user", "stop", "--no-block", UNIT_NAME]);
  if (port === null || state === null) return { kind: "no-port" };
  if (!HOLDS_ITS_PORT.has(state)) return { kind: "not-running", state };
  const result = await waitWhileRouterAnswers(port, probe, STOP_WAIT_MS);
  if (result.state === "free") return { kind: "closed" };
  if (result.state === "other") return { detail: result.detail, kind: "other" };
  throw new Error(
    `${UNIT_NAME} is disabled and was told to stop, but 127.0.0.1:${port} still takes connections after ${STOP_WAIT_MS / 1000} s. Nothing else was restored. See why: systemctl --user status anymodel-router (and ss -ltnp for another program on the port). Then run ${COMMAND} restore again.`,
  );
}
