/**
 * The router as a long-running service: its copy in `~/.local/share/cc-smart-dev-kit/router.js`,
 * its systemd user unit `cc-smart-dev-kit-router.service`, and the socket unit
 * `cc-smart-dev-kit-router.socket` that holds its port.
 *
 * The copy, never the plugin's own `dist/router.js`: Claude Code deletes an old version
 * folder some time after an update, even under a running process. The three files go
 * through `writeManagedFile` (backup, record for `restore`, atomic write).
 *
 * Why a socket unit (socket activation): systemd, not the router, opens 127.0.0.1:<port>
 * and passes it to the router (`./listen.ts`). On a restart the old router stops taking
 * connections and finishes its answers in flight, and the socket stays open the whole
 * time: a new request waits in its queue for the new router instead of failing. The
 * restart still waits for that drain (up to `TimeoutStopSec`), so it happens only when
 * the copy or a unit really changed (or an earlier setup did not finish:
 * `restartPendingFile`), and only after the person said yes (or gave `--yes`).
 *
 * The restarts that cannot keep the port open are those that must (re)open the socket:
 * the move from the older unit (no socket) to this shape, a socket that is not open, a
 * changed socket unit or port. systemd refuses to start a socket while its service still
 * runs, and starts it only once the old router has drained, so new requests fail until
 * then, as on every restart before. Setup names the case before it asks.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { bunTooOld, COMMAND } from "../build-info";
import { tildify } from "../cli/paths";
import { atomicWrite, writeManagedFile } from "../setup/write";
import { type HealthProbe, probeRouterPort, waitForRouter, waitWhileRouterAnswers } from "./health";

/** The systemd user unit's name. */
export const UNIT_NAME = "cc-smart-dev-kit-router.service";

/** The socket unit's name: it holds the router's port. */
export const SOCKET_NAME = "cc-smart-dev-kit-router.socket";

/** What `install` says when nothing changed. */
export const UP_TO_DATE = "router already up to date (no restart)";

/** Said before a restart of a router that already has its socket, and before the question. */
export const RESTART_WARNING =
  "cc-smart-dev-kit-router is running. A restart lets its answers in flight finish first (up to 120 s; a longer one is cut, and Claude Code retries it). New requests wait in its socket meanwhile; none fails.";

/**
 * Said before the restart that moves a running router to its socket, and before the
 * question: the one restart that refuses new requests while the old router drains.
 */
export const MOVE_WARNING =
  "cc-smart-dev-kit-router is running without its socket unit. This setup moves it to one, so later restarts refuse no request. This restart cannot: until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).";

/**
 * Said before the restart that opens the socket again: its unit file is there, but the
 * socket is not open (stopped by hand, or closed by systemd after the router failed to
 * start too often), so a running router holds the port itself.
 */
export const SOCKET_STOPPED_WARNING =
  "cc-smart-dev-kit-router is running, but its socket is not open: the router holds the port itself. This setup opens the socket again, so later restarts refuse no request. This restart cannot: until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).";

/** Said before the restart that reopens the socket on a new port (the config's changed). */
export const PORT_WARNING =
  "cc-smart-dev-kit-router is running, and its socket moves to a new port. Until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).";

/** Said before the restart that reopens the socket on the same port: its unit file changed. */
export const SOCKET_CHANGED_WARNING =
  "cc-smart-dev-kit-router is running, and its socket unit changed, so the socket closes and opens again. Until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).";

/** Every warning `installRouter` says before its question. */
export const INSTALL_WARNINGS: readonly string[] = [
  RESTART_WARNING,
  MOVE_WARNING,
  SOCKET_STOPPED_WARNING,
  PORT_WARNING,
  SOCKET_CHANGED_WARNING,
];

/** How often the router may fail to start within `START_LIMIT_SECONDS` before systemd gives up. */
export const START_LIMIT_BURST = 5;
export const START_LIMIT_SECONDS = 60;

/** Runs a command and waits; a test passes its own. */
export type Runner = (cmd: string[]) => { exitCode: number; output: string };

/** A unit file holds paths in double quotes: refuse what would break out of them. */
function checkUnitPath(path: string): void {
  if (/["\\\n%]/.test(path)) throw new Error(`cannot put ${JSON.stringify(path)} in a unit file`);
}

/** The unit name without its `.service` or `.socket` suffix. */
function stem(unitName: string): string {
  return unitName.replace(/\.(service|socket)$/, "");
}

/**
 * The socket unit. systemd opens 127.0.0.1:<port> and keeps it open across restarts of
 * the router; it hands the socket to the service of the same name.
 *
 * - `127.0.0.1` only: the router serves this machine alone (`docs/gateway.md` § Local only).
 * - `NoDelay`: answers stream event by event; no Nagle delay on small writes.
 * - `WantedBy=sockets.target`: the socket opens when the user's systemd starts.
 */
export function renderSocket(port: number, unitName = UNIT_NAME): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`not a port: ${port}`);
  }
  return `# ${stem(unitName)}: the socket of the local AI gateway for Claude Code (127.0.0.1 only).
# Written by \`${COMMAND} gateway setup\`; edits here are overwritten by the next setup.
# systemd holds the router's port, so a request waits while the router restarts.

[Unit]
Description=${stem(unitName)} socket: holds 127.0.0.1:${port} across router restarts

[Socket]
ListenStream=127.0.0.1:${port}
NoDelay=true

[Install]
WantedBy=sockets.target
`;
}

/**
 * The unit file. It runs the copy with the absolute bun path, never a file under the
 * plugin's version folder.
 *
 * - `Wants=` / `After=` the socket: systemd passes the socket's file descriptor to the
 *   router. Without the socket (it failed to open), the router still starts and binds
 *   the port itself.
 * - `RuntimeDirectory`: a private folder (0700) for the router's inner unix socket,
 *   removed when the unit stops.
 * - `--no-env-file`: the router needs no environment, and must not load anyone's .env files.
 * - Stopping: systemd sends SIGTERM; the router stops taking connections and exits once
 *   the answers in flight are done. `KillMode=mixed` sends that SIGTERM to the router
 *   alone, and only after `TimeoutStopSec` the SIGKILL to everything left. 120 s lets a
 *   normal answer finish; a longer one is cut, and Claude Code retries it.
 * - A start limit (`START_LIMIT_BURST` starts within `START_LIMIT_SECONDS`): a router that
 *   cannot start (a crash loop) stops being retried, and systemd then closes the socket
 *   too (its result `service-start-limit-hit`; seen live, systemd 259). The port refuses
 *   again, so every request fails at once with "connection refused" instead of waiting
 *   in an open socket for an answer that never comes. `doctor` says so; `gateway setup`
 *   opens both again. One crash is retried after 2 s, as before.
 * - `WantedBy=default.target`: the router starts at login, so the first request does not
 *   wait for it; `Also=` enables the socket with it.
 */
export function renderUnit(bunPath: string, copyPath: string, socketName = SOCKET_NAME): string {
  for (const path of [bunPath, copyPath]) checkUnitPath(path);
  const name = stem(socketName);
  return `# ${name}: the local AI gateway for Claude Code (127.0.0.1 only).
# Written by \`${COMMAND} gateway setup\`; edits here are overwritten by the next setup.
# It runs a copy of the router, never a file in the plugin's version folder.
# Its config: ~/.config/cc-smart-dev-kit/gateway.json. Its port: ${socketName}.

[Unit]
Description=${name}: local AI gateway for Claude Code (127.0.0.1 only)
Wants=${socketName}
After=${socketName}
StartLimitIntervalSec=${START_LIMIT_SECONDS}
StartLimitBurst=${START_LIMIT_BURST}

[Service]
Type=simple
ExecStart="${bunPath}" --no-env-file "${copyPath}"
WorkingDirectory=%h
RuntimeDirectory=${name}
RuntimeDirectoryMode=0700
Restart=always
RestartSec=2
KillMode=mixed
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
Also=${socketName}
`;
}

/** The port a socket unit's text listens on (`ListenStream=127.0.0.1:<port>`), or null. */
export function socketPort(text: string): null | number {
  const match = /^ListenStream=127\.0\.0\.1:(\d+)$/m.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

function run(runner: Runner, cmd: string[]): void {
  const result = runner(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${result.exitCode}):\n${result.output.trim()}`);
  }
}

/** True when the unit runs now (`systemctl --user is-active`). */
export function unitActive(runner: Runner, unitName = UNIT_NAME): boolean {
  return runner(["systemctl", "--user", "is-active", "--quiet", unitName]).exitCode === 0;
}

/**
 * The unit's state as `systemctl --user is-active` names it (`active`, `deactivating`,
 * `activating`, `inactive`, `failed`, …); `unknown` when it printed nothing.
 */
export function unitState(runner: Runner, unitName = UNIT_NAME): string {
  const result = runner(["systemctl", "--user", "is-active", unitName]);
  return result.output.trim().split("\n")[0]?.trim() || "unknown";
}

/** Said by `gateway setup` before a restart that waits for an old router's drain. */
export const DRAIN_NOTE = "waiting for the old router to finish its answers (up to 120 s)";

export interface InstallOptions {
  /** The bun that runs the router: `process.execPath` of this command. */
  bunPath: string;
  /** That bun's version: `Bun.version` of this command. Older than `MIN_BUN`: refused. */
  bunVersion: string;
  /** The plugin's own `dist/router.js`, copied to `copyPath`. */
  bundle: string;
  copyPath: string;
  /** The service unit; its file name is the unit's name. */
  unitPath: string;
  /** The socket unit; its file name is the unit's name. */
  socketPath: string;
  home: string;
  stateDir: string;
  /** The port in the config (the default without one): the socket listens there. */
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
 * The marker of a setup that has not finished: written before the copy and the units, and
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
 * What a restart of the running router does, from what really changed: a restart under the
 * open socket refuses nothing; every way that (re)opens the socket refuses new requests
 * for one drain, and the warning names why it reopens.
 */
function restartWarning(
  rebind: boolean,
  socketOpen: boolean,
  socketPlan: string,
  socketPath: string,
  port: number,
): string {
  if (!rebind) return RESTART_WARNING;
  // Not open: no socket unit yet (the move from the older unit), or one that was stopped.
  if (!socketOpen) return socketPlan === "created" ? MOVE_WARNING : SOCKET_STOPPED_WARNING;
  const oldPort = existsSync(socketPath) ? socketPort(readFileSync(socketPath, "utf8")) : null;
  return oldPort !== null && oldPort !== port ? PORT_WARNING : SOCKET_CHANGED_WARNING;
}

/**
 * Puts the copy and the two units in place, then starts them, or restarts the router when
 * the copy or a unit changed (or an earlier setup did not finish). Re-running it is the
 * upgrade path. A running router is restarted only after a yes; without one nothing is
 * written (`declined`).
 *
 * First of all, it refuses a bun older than `MIN_BUN`: that router would send a backend's
 * key through a proxy from the environment. Then, before any write or question, it asks
 * the port: a program that is not this router there (an older router, say) stops it, with
 * nothing written. A port that holds connections without an answer while the router's own
 * socket is open is the socket: its router is down or restarting, and setup goes on.
 *
 * Two ways to (re)start:
 *   - the socket is open and its file did not change: `restart` the service. The socket
 *     keeps the port; new requests wait for the new router.
 *   - otherwise (the move from the older unit, a changed socket unit, a socket that is not
 *     open): stop the service without waiting (`--no-block`: the old router closes its
 *     port at once and drains), stop the socket when it is open, clear a start limit the
 *     units hit (`reset-failed`), then start the socket and the service. systemd starts
 *     them once the old router has drained. A socket that cannot open is said, and the
 *     service starts without it: the router binds the port itself.
 * After either, it waits for the health page; when that never answers, it throws with
 * the unit's state, and the restart-pending marker stays.
 */
export async function installRouter(options: InstallOptions): Promise<InstallResult> {
  const tooOld = bunTooOld(options.bunVersion, tildify(options.bunPath, options.home));
  if (tooOld !== null) {
    throw new Error(
      `${tooOld} The router is not installed. Upgrade this Bun, then run: ${COMMAND} gateway setup`,
    );
  }
  const unitName = basename(options.unitPath);
  const socketName = basename(options.socketPath);
  const port = await probeRouterPort(options.port, options.probe.fetch);
  const socketOpen = unitActive(options.runner, socketName);
  if (port.state === "other" && !socketOpen) {
    throw new Error(
      `port ${options.port} is used by another program (an older router? stop it first)`,
    );
  }
  const short = (path: string) => tildify(path, options.home);
  const copyText = readFileSync(options.bundle, "utf8");
  const unitText = renderUnit(options.bunPath, options.copyPath, socketName);
  const socketText = renderSocket(options.port, unitName);
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
  const socketPlan = write(options.socketPath, socketText, true).outcome;
  const filesUnchanged =
    copyPlan === "unchanged" && unitPlan === "unchanged" && socketPlan === "unchanged";
  if (filesUnchanged && socketOpen && !existsSync(marker)) {
    if (options.dryRun) return "up-to-date";
    // Starts the router if it was stopped; leaves a running one alone.
    run(options.runner, ["systemctl", "--user", "enable", "--now", socketName, unitName]);
    options.say(UP_TO_DATE);
    return "up-to-date";
  }

  // The socket must (re)open: it is not open (the move from the older unit, whose router
  // holds the port itself, or a socket that was stopped), or its unit changed.
  const rebind = !socketOpen || socketPlan !== "unchanged";
  const active = unitActive(options.runner, unitName);
  if (active) {
    options.say(restartWarning(rebind, socketOpen, socketPlan, options.socketPath, options.port));
    if (!options.yes) {
      const yes = options.confirm?.("Restart cc-smart-dev-kit-router now?") ?? null;
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
  const said = (file: string, what: string, outcome: string) => {
    if (outcome !== "unchanged") {
      options.say(`${outcome === "created" ? "+" : "~"} ${short(file)}: ${what} ${outcome}`);
    }
  };
  said(options.copyPath, "router copy", write(options.copyPath, copyText, false).outcome);
  said(options.unitPath, "unit", write(options.unitPath, unitText, false).outcome);
  said(options.socketPath, "socket unit", write(options.socketPath, socketText, false).outcome);
  run(options.runner, ["systemctl", "--user", "daemon-reload"]);
  run(options.runner, ["systemctl", "--user", "enable", socketName, unitName]);

  if (rebind) {
    // Right after `restore`, or in the move, an old router may still drain its answers:
    // the start waits for that, up to the unit's `TimeoutStopSec`. Say so, or setup
    // looks stuck.
    const state = unitState(options.runner, unitName);
    if (state === "active" || state === "deactivating") options.say(DRAIN_NOTE);
    // `--no-block`: systemd sends SIGTERM and returns; the old router closes its port at
    // once. A blocking stop would wait the whole drain here, for nothing. A unit that is
    // not running (inactive, failed) needs no stop.
    if (state !== "inactive" && state !== "failed") {
      run(options.runner, ["systemctl", "--user", "stop", "--no-block", unitName]);
    }
    // systemd runs a stop before a start of units ordered against each other (the
    // service is After= its socket), so this returns once the old router has drained.
    if (socketOpen) run(options.runner, ["systemctl", "--user", "stop", socketName]);
    // A unit that hit its start limit (a crash loop; systemd then closed the socket too)
    // would refuse a start within the limit's window: clear that first. Its answer does
    // not matter (a unit that did not fail has nothing to clear).
    options.runner(["systemctl", "--user", "reset-failed", socketName, unitName]);
    // The same order makes the socket's start wait for the old router's exit, so it binds
    // a free port. Two calls, socket first: started together, the service's start takes
    // the place of its stop, and systemd refuses the socket while the old router still
    // drains (seen live). A port still taken is another program's (a `gateway serve` in
    // a terminal): the socket fails to open. Then the router starts without it and binds
    // the port itself (when it can), so the gateway still serves, and setup says so.
    const openSocket = ["systemctl", "--user", "start", socketName];
    const opened = options.runner(openSocket);
    if (opened.exitCode !== 0) {
      options.say(
        `${openSocket.join(" ")} failed (exit ${opened.exitCode}): ${(opened.output.trim().split("\n")[0] ?? "").replace(/\.$/, "")}. Starting ${stem(unitName)} without its socket: the router binds 127.0.0.1:${options.port} itself, and until the socket opens, a restart refuses new requests while the old router drains. Is another program on that port? See: ss -ltnp, and journalctl --user -u ${socketName} -n 30. Then run ${COMMAND} gateway setup again.`,
      );
    }
    run(options.runner, ["systemctl", "--user", "start", unitName]);
  } else {
    if (active) options.say(`restarting ${stem(unitName)} (new requests wait in its socket)`);
    // `restart` starts it when stopped, and loads the new copy when running. It returns
    // once the old router has drained and the new one started.
    run(options.runner, ["systemctl", "--user", "restart", unitName]);
  }
  if (!(await waitForRouter(options.port, options.probe, HEALTH_WAIT_MS))) {
    throw new Error(
      `${unitName} did not answer on 127.0.0.1:${options.port} within ${HEALTH_WAIT_MS / 1000} s of the restart (systemctl --user is-active: ${unitState(options.runner, unitName)}). See why: journalctl --user -u ${stem(unitName)} -n 30. Then run ${COMMAND} gateway setup again.`,
    );
  }
  rmSync(marker, { force: true });
  options.say(`enabled and (re)started ${unitName} and ${socketName}`);
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
 * Disables the unit and its socket and stops both, for `restore`, while their files are
 * still there.
 *
 * Not `disable --now`: that waits until the router has drained its answers in flight, up
 * to the unit's `TimeoutStopSec` (120 s), and the port is closed in the first second, so
 * every new request of every session fails for that whole time while restore looks
 * stuck. So: it asks the unit's state, then runs `disable` for both, then `stop
 * --no-block` for both in one call (systemd closes the socket and sends the router
 * SIGTERM, and returns; one call, so no connection reopens the router in between), then
 * asks the port (`probe`) while this router answers there, for up to 15 s. The drain
 * finishes in the background.
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
  names: { socket: string; unit: string } = { socket: SOCKET_NAME, unit: UNIT_NAME },
): Promise<StopResult> {
  const state = port === null ? null : unitState(runner, names.unit);
  run(runner, ["systemctl", "--user", "disable", names.socket, names.unit]);
  run(runner, ["systemctl", "--user", "stop", "--no-block", names.socket, names.unit]);
  if (port === null || state === null) return { kind: "no-port" };
  if (!HOLDS_ITS_PORT.has(state)) return { kind: "not-running", state };
  const result = await waitWhileRouterAnswers(port, probe, STOP_WAIT_MS);
  if (result.state === "free") return { kind: "closed" };
  if (result.state === "other") return { detail: result.detail, kind: "other" };
  throw new Error(
    `${names.unit} is disabled and was told to stop, but 127.0.0.1:${port} still takes connections after ${STOP_WAIT_MS / 1000} s. Nothing else was restored. See why: systemctl --user status ${stem(names.unit)} (and ss -ltnp for another program on the port). Then run ${COMMAND} restore again.`,
  );
}
