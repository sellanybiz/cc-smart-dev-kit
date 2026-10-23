/**
 * The router as a long-running service: its copy in `~/.local/share/cc-smart-dev-kit/router.js`,
 * and the service that runs it — on Linux the systemd user unit
 * `cc-smart-dev-kit-router.service` and the socket unit `cc-smart-dev-kit-router.socket`
 * that holds its port, on Windows a per-user Scheduled Task (`./service-windows.ts`),
 * which has no socket to hold one.
 *
 * The copy, never the plugin's own `dist/router.js`: Claude Code deletes an old version
 * folder some time after an update, even under a running process. The files go
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
 *
 * `installRouter` drives whichever service this machine has (`RouterService`): the steps
 * are the same everywhere — refuse an old bun, ask the port, write the copy and the
 * service's own definition, start it, wait for the health page — and the driver holds what
 * each platform does and how it says it. The socket unit's promise (no request fails
 * during a restart) exists on Linux only; the Windows driver says plainly what its restart
 * does instead (`TASK_RESTART_WARNING` in `./service-windows.ts`).
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bunTooOld, COMMAND } from "../build-info";
import { tildify } from "../cli/paths";
import { atomicWrite, type WriteOutcome, writeManagedFile } from "../setup/write";
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

/** Which service this machine can run the router under. */
export type RouterServiceKind = "none" | "scheduled-task" | "systemd";

/**
 * The service this machine has: systemd user units on Linux (with `systemctl` on PATH), a
 * per-user Scheduled Task on Windows (with PowerShell), nothing anywhere else — macOS has
 * no service this plugin installs, and `commands.ts` refuses there.
 */
export function routerServiceKind(
  platform: NodeJS.Platform,
  which: (command: string) => null | string,
): RouterServiceKind {
  if (platform === "win32") return which("powershell") === null ? "none" : "scheduled-task";
  if (platform === "linux" && which("systemctl") !== null) return "systemd";
  return "none";
}

/** What a service needs to write and start the router copy (`InstallOptions`, narrowed). */
export interface ServiceInput {
  /** The bun that runs the router: `process.execPath` of this command. */
  bunPath: string;
  /** The plugin's own `dist/router.js`'s copy that the service runs. */
  copyPath: string;
  /** The home folder: the unit's working folder, the task's Windows account. */
  home: string;
  /** The port the router serves on (`gateway.json`, or the default). */
  port: number;
  /** Asks the port where a restart has to wait for it; a test passes fakes. */
  probe: HealthProbe;
  say: (line: string) => void;
  /** Windows: the account the task runs as (`MACHINE\user`). Never read on Linux. */
  account?: string;
}

/** A file the service needs besides the router copy: where it goes, its text, what it is. */
export interface ServiceDefinition {
  /** Its key in `RestartPlan.outcomes`: `unit`, `socket`, `task`. */
  id: string;
  /** Its short name in the messages: `unit`, `socket unit`, `task`. */
  what: string;
  path: string;
  text: string;
}

/** What a restart of the running router does, from what really changed. */
export interface RestartPlan {
  /** The service's own listener holds the port (systemd's socket; nothing on Windows). */
  listenerUp: boolean;
  /** The router runs under this service now. */
  running: boolean;
  /**
   * This restart must (re)open the listener, so it refuses new requests for one drain.
   * On Windows every restart is like that: the router binds its own port there.
   */
  rebind: boolean;
  /** What writing each definition did, by `id`. */
  outcomes: Readonly<Record<string, WriteOutcome>>;
}

/**
 * The service that runs the router on this machine. One driver per platform (systemd user
 * units on Linux, a Scheduled Task on Windows), so `installRouter` and `restore` say the
 * same steps everywhere while each platform keeps its own commands, states and words.
 */
export interface RouterService {
  /** Its name in every message: `cc-smart-dev-kit-router.service`, or `the task cc-smart-dev-kit-router`. */
  readonly name: string;
  /** Every warning it says before the question, so `commands.ts` drops them in the second pass. */
  readonly warnings: readonly string[];
  /** Where to look when the router does not start. */
  readonly logHint: string;
  /** Said once the router answers after a (re)start. */
  readonly started: string;
  /** Its definition files, besides the router copy. */
  definitions(input: ServiceInput): ServiceDefinition[];
  /** True when it already runs what setup writes (Windows: the registered task matches). */
  current(runner: Runner, input: ServiceInput): boolean;
  /** True when its own listener holds the port (systemd's socket; a Windows task has none). */
  listenerUp(runner: Runner): boolean;
  /** True when the router runs under it now. */
  running(runner: Runner): boolean;
  /** Its state, as the platform names it (`active`, `Running`, `not registered`, …). */
  state(runner: Runner): string;
  /** What this restart does, from what changed: the warning said before the question. */
  plan(
    listenerUp: boolean,
    running: boolean,
    outcomes: Readonly<Record<string, WriteOutcome>>,
  ): RestartPlan;
  /** What this restart does, in one line, said before the question. */
  restartWarning(input: ServiceInput, plan: RestartPlan): string;
  /** After the definitions are written: what the platform must re-read or re-register. */
  afterWrite(runner: Runner, input: ServiceInput): void;
  /** Starts it if it is stopped, leaving a running router alone (nothing changed). */
  ensureRunning(runner: Runner): void;
  /** Makes it run the new copy now. Says what it does. */
  activate(runner: Runner, input: ServiceInput, plan: RestartPlan): Promise<void>;
  /** Stops it for good, for `restore`: `port` null when the config gives none. */
  stop(runner: Runner, port: null | number, probe: HealthProbe): Promise<StopResult>;
  /** After its definition files are removed (systemd: daemon-reload; a task is already gone). */
  forget(runner: Runner): void;
  /** The error text when the router did not answer within `waitedMs` of the (re)start. */
  noAnswer(runner: Runner, port: number, waitedMs: number): string;
}

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

export interface InstallOptions extends ServiceInput {
  /** That bun's version: `Bun.version` of this command. Older than `MIN_BUN`: refused. */
  bunVersion: string;
  /** The plugin's own `dist/router.js`, copied to `copyPath`. */
  bundle: string;
  stateDir: string;
  runner: Runner;
  /** `--yes`: restart without asking. */
  yes: boolean;
  /** Asks the person; null when there is no one to ask (no terminal). */
  confirm: ((question: string) => boolean) | null;
  dryRun?: boolean;
  /** The service this machine runs: systemd's units, or a Windows Scheduled Task. */
  service: RouterService;
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
 * Puts the copy and the service's definition in place, then starts it, or restarts the
 * router when the copy or a definition changed (or an earlier setup did not finish).
 * Re-running it is the upgrade path. A running router is restarted only after a yes;
 * without one nothing is written (`declined`).
 *
 * First of all, it refuses a bun older than `MIN_BUN`: that router would send a backend's
 * key through a proxy from the environment. Then, before any write or question, it asks
 * the port: a program that is not this router there (an older router, say) stops it, with
 * nothing written. A port that holds connections without an answer while the service's own
 * listener holds it (systemd's socket; a Windows task whose router is down holds none) is
 * that listener: its router is down or restarting, and setup goes on.
 *
 * What the (re)start does is the service's own (`RouterService`): on Linux a restart under
 * the open socket refuses no request, and every way that (re)opens the socket refuses new
 * requests for one drain — the warning names why it reopens. On Windows no socket keeps
 * the port, so every restart stops the router and starts it again, and its warning says so.
 *
 * After the (re)start it waits for the health page; when that never answers, it throws with
 * the service's state, and the restart-pending marker stays.
 */
/**
 * The router's port, asked before any write or question: another program there (an older
 * router, say) refuses the setup, with the words below. A port that answers while our own
 * listener is up is ours. `installRouter` asks it first; `gateway setup` asks it before its
 * questions too, so nobody answers them, and no backend is called, for a port it cannot have.
 * Says whether our listener (the socket, or the task) is up.
 */
export async function checkRouterPort(
  options: Pick<InstallOptions, "port" | "probe" | "runner" | "service">,
): Promise<{ listenerUp: boolean }> {
  const port = await probeRouterPort(options.port, options.probe.fetch);
  const listenerUp = options.service.listenerUp(options.runner);
  if (port.state === "other" && !listenerUp) {
    throw new Error(
      `port ${options.port} is used by another program (an older router? stop it first)`,
    );
  }
  return { listenerUp };
}

export async function installRouter(options: InstallOptions): Promise<InstallResult> {
  const tooOld = bunTooOld(options.bunVersion, tildify(options.bunPath, options.home));
  if (tooOld !== null) {
    throw new Error(
      `${tooOld} The router is not installed. Upgrade this Bun, then run: ${COMMAND} gateway setup`,
    );
  }
  const { service } = options;
  const { listenerUp } = await checkRouterPort(options);
  const short = (path: string) => tildify(path, options.home);
  const copyText = readFileSync(options.bundle, "utf8");
  const definitions = service.definitions(options);
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
  const outcomes: Record<string, WriteOutcome> = {};
  for (const definition of definitions) {
    outcomes[definition.id] = write(definition.path, definition.text, true).outcome;
  }
  const filesUnchanged =
    copyPlan === "unchanged" &&
    definitions.every((definition) => outcomes[definition.id] === "unchanged") &&
    service.current(options.runner, options);
  if (filesUnchanged && listenerUp && !existsSync(marker)) {
    if (options.dryRun) return "up-to-date";
    // Starts the router if it was stopped; leaves a running one alone.
    service.ensureRunning(options.runner);
    options.say(UP_TO_DATE);
    return "up-to-date";
  }

  const running = service.running(options.runner);
  const plan = service.plan(listenerUp, running, outcomes);
  if (plan.running) {
    options.say(service.restartWarning(options, plan));
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
  const said = (file: string, what: string, outcome: WriteOutcome) => {
    if (outcome !== "unchanged") {
      options.say(`${outcome === "created" ? "+" : "~"} ${short(file)}: ${what} ${outcome}`);
    }
  };
  said(options.copyPath, "router copy", write(options.copyPath, copyText, false).outcome);
  for (const definition of definitions) {
    said(definition.path, definition.what, write(definition.path, definition.text, false).outcome);
  }
  service.afterWrite(options.runner, options);
  await service.activate(options.runner, options, plan);
  if (!(await waitForRouter(options.port, options.probe, HEALTH_WAIT_MS))) {
    throw new Error(service.noAnswer(options.runner, options.port, HEALTH_WAIT_MS));
  }
  rmSync(marker, { force: true });
  options.say(service.started);
  return "installed";
}

/**
 * The Linux router service: the systemd user units `cc-smart-dev-kit-router.service` and
 * `cc-smart-dev-kit-router.socket`, at the paths given (`paths.routerUnitFile`,
 * `paths.routerSocketFile`). A unit file's name is the unit's name.
 *
 * What a restart of the running router does, from what really changed: a restart under the
 * open socket refuses nothing; every way that (re)opens the socket refuses new requests for
 * one drain, and the warning names why it reopens (`restartWarning`). Two ways to
 * (re)start:
 *   - the socket is open and its file did not change: `restart` the service. The socket
 *     keeps the port; new requests wait for the new router.
 *   - otherwise (the move from the older unit, a changed socket unit, a socket that is not
 *     open): stop the service without waiting (`--no-block`: the old router closes its
 *     port at once and drains), stop the socket when it is open, clear a start limit the
 *     units hit (`reset-failed`), then start the socket and the service. systemd starts
 *     them once the old router has drained. A socket that cannot open is said, and the
 *     service starts without it: the router binds the port itself.
 */
export function systemdService(options: { unitPath: string; socketPath: string }): RouterService {
  const unitName = basename(options.unitPath);
  const socketName = basename(options.socketPath);
  return {
    async activate(runner, input, plan): Promise<void> {
      if (plan.rebind) {
        // Right after `restore`, or in the move, an old router may still drain its answers:
        // the start waits for that, up to the unit's `TimeoutStopSec`. Say so, or setup
        // looks stuck.
        const state = unitState(runner, unitName);
        if (state === "active" || state === "deactivating") input.say(DRAIN_NOTE);
        // `--no-block`: systemd sends SIGTERM and returns; the old router closes its port at
        // once. A blocking stop would wait the whole drain here, for nothing. A unit that is
        // not running (inactive, failed) needs no stop.
        if (state !== "inactive" && state !== "failed") {
          run(runner, ["systemctl", "--user", "stop", "--no-block", unitName]);
        }
        // systemd runs a stop before a start of units ordered against each other (the
        // service is After= its socket), so this returns once the old router has drained.
        if (plan.listenerUp) run(runner, ["systemctl", "--user", "stop", socketName]);
        // A unit that hit its start limit (a crash loop; systemd then closed the socket too)
        // would refuse a start within the limit's window: clear that first. Its answer does
        // not matter (a unit that did not fail has nothing to clear).
        runner(["systemctl", "--user", "reset-failed", socketName, unitName]);
        // The same order makes the socket's start wait for the old router's exit, so it binds
        // a free port. Two calls, socket first: started together, the service's start takes
        // the place of its stop, and systemd refuses the socket while the old router still
        // drains (seen live). A port still taken is another program's (a `gateway serve` in
        // a terminal): the socket fails to open. Then the router starts without it and binds
        // the port itself (when it can), so the gateway still serves, and setup says so.
        const openSocket = ["systemctl", "--user", "start", socketName];
        const opened = runner(openSocket);
        if (opened.exitCode !== 0) {
          input.say(
            `${openSocket.join(" ")} failed (exit ${opened.exitCode}): ${(opened.output.trim().split("\n")[0] ?? "").replace(/\.$/, "")}. Starting ${stem(unitName)} without its socket: the router binds 127.0.0.1:${input.port} itself, and until the socket opens, a restart refuses new requests while the old router drains. Is another program on that port? See: ss -ltnp, and journalctl --user -u ${socketName} -n 30. Then run ${COMMAND} gateway setup again.`,
          );
        }
        run(runner, ["systemctl", "--user", "start", unitName]);
        return;
      }
      if (plan.running) input.say(`restarting ${stem(unitName)} (new requests wait in its socket)`);
      // `restart` starts it when stopped, and loads the new copy when running. It returns
      // once the old router has drained and the new one started.
      run(runner, ["systemctl", "--user", "restart", unitName]);
    },
    afterWrite(runner): void {
      run(runner, ["systemctl", "--user", "daemon-reload"]);
      run(runner, ["systemctl", "--user", "enable", socketName, unitName]);
    },
    // Its files are its definition: what setup writes is what systemd reads.
    current: () => true,
    definitions(input): ServiceDefinition[] {
      return [
        {
          id: "unit",
          path: options.unitPath,
          text: renderUnit(input.bunPath, input.copyPath, socketName),
          what: "unit",
        },
        {
          id: "socket",
          path: options.socketPath,
          text: renderSocket(input.port, unitName),
          what: "socket unit",
        },
      ];
    },
    ensureRunning(runner): void {
      run(runner, ["systemctl", "--user", "enable", "--now", socketName, unitName]);
    },
    forget(runner): void {
      run(runner, ["systemctl", "--user", "daemon-reload"]);
    },
    listenerUp(runner): boolean {
      return unitActive(runner, socketName);
    },
    logHint: `journalctl --user -u ${stem(unitName)} -n 30`,
    name: unitName,
    noAnswer(runner, port, waitedMs): string {
      return `${unitName} did not answer on 127.0.0.1:${port} within ${waitedMs / 1000} s of the restart (systemctl --user is-active: ${unitState(runner, unitName)}). See why: journalctl --user -u ${stem(unitName)} -n 30. Then run ${COMMAND} gateway setup again.`;
    },
    plan(listenerUp, running, outcomes): RestartPlan {
      // The socket must (re)open: it is not open (the move from the older unit, whose router
      // holds the port itself, or a socket that was stopped), or its unit changed.
      return {
        listenerUp,
        outcomes,
        rebind: !listenerUp || outcomes.socket !== "unchanged",
        running,
      };
    },
    restartWarning(input, plan): string {
      if (!plan.rebind) return RESTART_WARNING;
      // Not open: no socket unit yet (the move from the older unit), or one that was stopped.
      if (!plan.listenerUp) {
        return plan.outcomes.socket === "created" ? MOVE_WARNING : SOCKET_STOPPED_WARNING;
      }
      const oldPort = existsSync(options.socketPath)
        ? socketPort(readFileSync(options.socketPath, "utf8"))
        : null;
      return oldPort !== null && oldPort !== input.port ? PORT_WARNING : SOCKET_CHANGED_WARNING;
    },
    running(runner): boolean {
      return unitActive(runner, unitName);
    },
    async stop(runner, port, probe): Promise<StopResult> {
      // Not `disable --now`: that waits until the router has drained its answers in flight,
      // up to the unit's `TimeoutStopSec` (120 s), and the port is closed in the first
      // second, so every new request of every session fails for that whole time while
      // restore looks stuck. So: it asks the unit's state, then runs `disable` and
      // `stop --no-block` through `stopUnits` (systemd closes the socket and sends the
      // router SIGTERM, and returns; one call, so no connection reopens the router in
      // between), then asks the port (`probe`) while this router answers there, for up to
      // 15 s. The drain finishes in the background.
      //
      // `stopUnits` skips a unit whose file is not there (a socket a version older than
      // the socket unit never wrote) instead of failing the stop. It waits only for the
      // unit's own router: only when the unit was `active` or `deactivating` before the
      // stop, and only while the port answers as this router. A crash-looping unit
      // (another program holds the port, so it never binds) and a router started by hand
      // (`gateway serve`) are not the unit's: a wait for them would never end. `port`
      // null: the port is unknown (an unusable config), so there is nothing to ask; the
      // stop is sent all the same.
      const state = port === null ? null : unitState(runner, unitName);
      const stop = stopUnits(runner, {
        dir: dirname(options.unitPath),
        names: [socketName, unitName],
      });
      // A unit whose file is not there is skipped above; a systemctl that refuses one stops a
      // restore before anything is restored (a move to this version goes on instead).
      const refused = stop.refused[0];
      if (refused !== undefined) {
        throw new Error(
          `${refused.command} failed (exit ${refused.exitCode}):\n${refused.output.trim()}`,
        );
      }
      if (port === null || state === null) return { kind: "no-port" };
      if (!HOLDS_ITS_PORT.has(state)) return { kind: "not-running", state };
      const result = await waitWhileRouterAnswers(port, probe, STOP_WAIT_MS);
      if (result.state === "free") return { kind: "closed" };
      if (result.state === "other") return { detail: result.detail, kind: "other" };
      throw new Error(
        `${unitName} is disabled and was told to stop, but 127.0.0.1:${port} still takes connections after ${STOP_WAIT_MS / 1000} s. Nothing else was restored. See why: systemctl --user status ${stem(unitName)} (and ss -ltnp for another program on the port). Then run ${COMMAND} restore again.`,
      );
    },
    started: `enabled and (re)started ${unitName} and ${socketName}`,
    state(runner): string {
      return unitState(runner, unitName);
    },
    warnings: INSTALL_WARNINGS,
  };
}

/** How long a `stop` waits for the router's port to close. */
export const STOP_WAIT_MS = 15_000;

/**
 * `systemctl --user is-active` states in which the unit's own router holds its port:
 * running, or still draining after an earlier stop.
 */
const HOLDS_ITS_PORT = new Set(["active", "deactivating"]);

/** What `RouterService.stop` waited for, so `restore` can say it. */
export type StopResult =
  /** The router's port closed: it takes no new request. */
  | { kind: "closed" }
  /** The port is unknown (an unusable config): nothing was asked. */
  | { kind: "no-port" }
  /** The unit was not running (`state`, from `is-active`): nothing of it to wait for. */
  | { kind: "not-running"; state: string }
  /** Something that is not this router answers on the port: not waited for. */
  | { detail: string; kind: "other" };

/** What `stopUnits` did, so its callers can say it and go on. */
export interface UnitStop {
  /** The units whose files are there: disabled, and told to stop (`--no-block`). */
  stopped: string[];
  /** The units whose files are not there: nothing of them to stop. */
  missing: string[];
  /** Calls systemctl refused, with what it said. `stopUnits` never throws on them. */
  refused: { command: string; exitCode: number; output: string }[];
}

/**
 * Disables and stops the units whose files are there, and reports — never throws — what
 * systemctl refused.
 *
 * Why both parts matter: a machine set up by a version before the socket unit has no socket
 * file, and `systemctl --user disable <name>.socket` then fails with "Unit … does not
 * exist". A `restore` may stop on that (nothing is half done yet); a move to this version
 * must not, because half a moved machine is worse than a unit left disabled — it says what
 * systemctl answered and goes on.
 *
 * Two calls altogether (one `disable`, one `stop --no-block`), so nothing reopens a router
 * between them; `--no-block` returns at once and the drain goes on in the background.
 */
export function stopUnits(
  runner: Runner,
  options: { dir: string; names: readonly string[] },
): UnitStop {
  const result: UnitStop = { missing: [], refused: [], stopped: [] };
  const there = options.names.filter((name) => {
    if (existsSync(join(options.dir, name))) return true;
    result.missing.push(name);
    return false;
  });
  if (there.length === 0) return result;
  for (const args of [["disable"], ["stop", "--no-block"]]) {
    const cmd = ["systemctl", "--user", ...args, ...there];
    const ran = runner(cmd);
    if (ran.exitCode !== 0) {
      result.refused.push({ command: cmd.join(" "), exitCode: ran.exitCode, output: ran.output });
    }
  }
  result.stopped = there;
  return result;
}
