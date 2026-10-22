/**
 * The portal's life: its one copy in `~/.local/share/cc-smart-dev-kit/`, the decision whether
 * it should run, and the two ways it ends — a start after nothing answered, a restart of an
 * older version after an update, and a stop.
 *
 * One fixed local port (`DEFAULT_PORTAL_PORT`). Three callers share every rule here:
 * `cc-smart-dev-kit portal` (open it, starting it when it is not there), the session-start
 * part (`src/portal/session-start.ts`, through the copy's own `--ensure`), and `portal
 * status` / `portal stop`.
 *
 * **It always runs from the copy, never from the plugin's version folder**: Claude Code
 * deletes an old version folder after an update, even under a running process. The copy goes
 * through `writeManagedFile`, so `restore` removes it like the router's copy. The copy is
 * refreshed from the folder Claude Code records as installed when this runs, which is what
 * keeps an old session's hook from starting an older version after an update
 * (`isOlder(installed, running)` only ever restarts forward).
 *
 * A port held by another program is never taken: the probe says `other`, one line says so,
 * and nothing starts. The line is written once (a state file remembers the port), not at
 * every session start.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { bunConfigArg } from "../setup/bun-config";
import { LockBusyError, withLock } from "../setup/lock";
import { removeManagedFolder, writeManagedFolder } from "../setup/managed-folder";
import { atomicWrite, writeManagedFile } from "../setup/write";
import { isOlder } from "../update/check";
import { appendLogLine, isoSeconds } from "../update/state";
import {
  PORTAL_START_WAIT_MS,
  PORTAL_STOP_WAIT_MS,
  type PortalProbe,
  type PortalState,
  probePortal,
  waitForPortal,
} from "./health";

/** What the portal's `--ensure` runs: this bundle, and the installed one after an update. */
export function portalStarterArgv(bunPath: string, bundle: string, pluginDir: string): string[] {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), bundle, "--ensure"];
}

/**
 * The long-running server: the copy in `~/.local/share/`, told where the plugin's own files
 * are as a fallback (`--plugin-dir`). The detached start gives it no terminal and no pipe, so
 * nothing in a session ever waits for it.
 */
export function portalServerArgv(bunPath: string, copy: string, pluginDir: string): string[] {
  return [
    bunPath,
    "--no-env-file",
    bunConfigArg(pluginDir),
    copy,
    "--serve",
    "--plugin-dir",
    pluginDir,
  ];
}

/** How long a copy waits for another cc-smart-dev-kit run's lock: both writes are short. */
export const PORTAL_COPY_LOCK_WAIT_MS = 10_000;

/**
 * Brings the copy up to the installed version: the bundle, and the Next.js export beside it
 * (`portal-ui/`, D49). The exact text and the export's bytes are compared first, so a second
 * start writes nothing. Both go through setup's writers, so `restore` removes them.
 *
 * The export is build output: when it fails to copy, the old folder (or none) stays and `note`
 * says so — the portal still starts, and the server-rendered pages answer.
 */
export function refreshPortalCopy(
  paths: CliPaths,
  pluginFolder: string,
): { copy: string; note?: string } | { error: string } {
  const bundle = join(pluginFolder, "dist", "portal.js");
  if (!existsSync(bundle)) {
    return {
      error: `the portal bundle is missing (${bundle}); this install is incomplete. Run ${COMMAND} doctor, then reinstall the plugin.`,
    };
  }
  writeManagedFile(paths.portalCopy, readFileSync(bundle, "utf8"), {
    kind: "whole-file",
    stateDir: paths.stateDir,
  });
  return { copy: paths.portalCopy, ...refreshPortalExport(paths, pluginFolder) };
}

/**
 * The export beside the copy. A version with no export (an older install) removes the copy's
 * export, so new pages are never served with an older bundle; a copy that fails leaves the old
 * folder as it was and says so, because the portal itself must still start.
 */
function refreshPortalExport(paths: CliPaths, pluginFolder: string): { note?: string } {
  const source = join(pluginFolder, "portal-ui");
  try {
    if (existsSync(join(source, "index.html"))) {
      writeManagedFolder(paths.portalUiFolder, source, { stateDir: paths.stateDir });
    } else {
      removeManagedFolder(paths.portalUiFolder, paths.stateDir);
    }
    return {};
  } catch (error) {
    return {
      note: `the portal's export was not refreshed (${messageOf(error)}); the page that is there, or the server-rendered one, answers`,
    };
  }
}

/**
 * The copy's refresh under setup's lock: two runs that start together (two sessions, a command
 * and a session's hook) never swap the export under each other. A run that finds the lock held
 * longer than the wait starts the copy that is already there; with no copy at all, it fails.
 */
async function refreshCopyLocked(
  deps: PortalLifeDeps,
): Promise<{ copy: string; note?: string } | { error: string }> {
  try {
    return await withLock(
      deps.paths.stateDir,
      () => refreshPortalCopy(deps.paths, deps.pluginFolder),
      { waitMs: PORTAL_COPY_LOCK_WAIT_MS },
    );
  } catch (error) {
    if (!(error instanceof LockBusyError)) throw error;
    if (existsSync(deps.paths.portalCopy)) {
      return {
        copy: deps.paths.portalCopy,
        note: "another cc-smart-dev-kit run holds the lock; the copy that is already there was used",
      };
    }
    return { error: `the portal's copy could not be written: ${error.message}` };
  }
}

/** Everything a start or a stop needs; a test passes fakes for the probe, the spawn and the kill. */
export interface PortalLifeDeps {
  bunPath: string;
  /** Sends SIGTERM to the portal that answered: `process.kill` in use, a recorder in a test. */
  kill: (pid: number) => void;
  /** One line about what happened, to the portal's log. */
  log: (line: string) => void;
  paths: CliPaths;
  /** The folder the portal's bundle is copied from, and the plugin's own folder for `--plugin-dir`. */
  pluginFolder: string;
  port: number;
  probe: PortalProbe;
  /** Starts an argv detached, with no terminal and no pipe; a recorder in a test. */
  spawn: (argv: string[]) => void;
  /** The version Claude Code records as installed: what the portal must run. */
  version: string;
}

/** What a start found, or did. */
export type EnsureOutcome =
  /** Our portal answers, and it is this version (or a newer one): nothing to do. */
  | { kind: "running"; pid: number; version: string }
  /** Nothing answered: it was started, and now it does. */
  | { kind: "started"; pid: number; version: string }
  /** An older version answered: it was stopped, and this version now runs. */
  | { kind: "restarted"; from: string; pid: number; to: string }
  /** Another program holds the port: nothing was started. */
  | { kind: "other" }
  | { kind: "failed"; reason: string };

/** What a stop found, or did. */
export type StopOutcome =
  | { kind: "stopped" }
  | { kind: "not-running" }
  | { kind: "other" }
  | { kind: "failed"; reason: string };

/**
 * Decides by the version alone: a newer *installed* version restarts the running one, and an
 * older installed version never replaces a newer running one (a rollback, or an old session's
 * hook after an update: D10's one-way rule).
 */
export function portalOutdated(installed: string, running: string): boolean {
  return running !== installed && isOlder(running, installed);
}

/**
 * Starts the portal when nothing answers, restarts it when an older version answers, and
 * leaves a current or newer one alone. A port held by another program is one line and
 * nothing started.
 */
export async function ensurePortal(deps: PortalLifeDeps): Promise<EnsureOutcome> {
  const copy = await refreshCopyLocked(deps);
  if ("error" in copy) {
    deps.log(`failed: ${copy.error}`);
    return { kind: "failed", reason: copy.error };
  }
  if (copy.note !== undefined) deps.log(`note: ${copy.note}`);
  const state = await probePortal(deps.port, deps.probe);
  if (state.kind === "free") {
    clearHeldPort(deps.paths);
    return startServer(deps, copy.copy, null);
  }
  if (state.kind === "other") {
    // Said once, not at every session start: the marker remembers this port (D10's noise rule).
    if (noteHeldPortOnce(deps.paths, deps.port, deps.probe.now())) {
      deps.log(
        `port ${deps.port} is held by another program: nothing was started. Stop that program, or find it with the tool this system has for open ports.`,
      );
    }
    return { kind: "other" };
  }
  if (!portalOutdated(deps.version, state.version)) {
    if (state.version !== deps.version) {
      deps.log(
        `left alone: the portal runs ${state.version}, newer than the installed ${deps.version}`,
      );
    }
    return { kind: "running", pid: state.pid, version: state.version };
  }
  // An older version answers: stop this pid (the one that gave the answer), wait for the
  // port, then start this version's copy.
  deps.log(`restart: the portal runs ${state.version}; the installed version is ${deps.version}`);
  try {
    deps.kill(state.pid);
  } catch (error) {
    const reason = `the portal (pid ${state.pid}) could not be stopped: ${messageOf(error)}`;
    deps.log(`failed: ${reason}`);
    return { kind: "failed", reason };
  }
  const after = await waitForPortal(deps.port, deps.probe, "free", PORTAL_STOP_WAIT_MS);
  if (after.kind === "ours") {
    const reason = `the portal (pid ${after.pid}) did not stop within ${PORTAL_STOP_WAIT_MS / 1_000} s; it was left running`;
    deps.log(`failed: ${reason}`);
    return { kind: "failed", reason };
  }
  return startServer(deps, copy.copy, state.version);
}

/** Starts the copy and waits for its health answer. */
async function startServer(
  deps: PortalLifeDeps,
  copy: string,
  restartFrom: null | string,
): Promise<EnsureOutcome> {
  deps.spawn(portalServerArgv(deps.bunPath, copy, deps.pluginFolder));
  const state = await waitForPortal(deps.port, deps.probe, "ours", PORTAL_START_WAIT_MS);
  if (state.kind !== "ours") {
    const reason =
      state.kind === "other"
        ? `another program took 127.0.0.1:${deps.port} before the portal started`
        : `the portal did not answer on 127.0.0.1:${deps.port} within ${PORTAL_START_WAIT_MS / 1_000} s`;
    deps.log(`failed: ${reason}`);
    return { kind: "failed", reason };
  }
  deps.log(`started: version ${state.version}, pid ${state.pid}, on 127.0.0.1:${deps.port}`);
  return restartFrom === null
    ? { kind: "started", pid: state.pid, version: state.version }
    : { kind: "restarted", from: restartFrom, pid: state.pid, to: state.version };
}

/** Stops the portal that answers, and waits for the port to be free. */
export async function stopPortal(
  deps: Omit<PortalLifeDeps, "bunPath" | "pluginFolder" | "spawn" | "version">,
): Promise<StopOutcome> {
  const state = await probePortal(deps.port, deps.probe);
  if (state.kind === "free") return { kind: "not-running" };
  if (state.kind === "other") return { kind: "other" };
  try {
    deps.kill(state.pid);
  } catch (error) {
    const reason = `the portal (pid ${state.pid}) could not be stopped: ${messageOf(error)}`;
    deps.log(`failed: ${reason}`);
    return { kind: "failed", reason };
  }
  const after = await waitForPortal(deps.port, deps.probe, "free", PORTAL_STOP_WAIT_MS);
  if (after.kind === "free") {
    deps.log(`stopped: version ${state.version}, pid ${state.pid}`);
    return { kind: "stopped" };
  }
  const reason = `the portal (pid ${state.pid}) did not stop within ${PORTAL_STOP_WAIT_MS / 1_000} s`;
  deps.log(`failed: ${reason}`);
  return { kind: "failed", reason };
}

/** One line for `portal status`, from what answered and the version Claude Code installed. */
export function portalStatusLine(
  state: PortalState,
  installed: string,
  port: number = DEFAULT_PORTAL_PORT,
): string {
  const address = `http://127.0.0.1:${port}`;
  if (state.kind === "free") {
    return `The portal is not running. It starts with your next Claude Code session; to open it now: ${COMMAND} portal`;
  }
  if (state.kind === "other") {
    return `Another program holds 127.0.0.1:${port}, so the portal cannot start there. Stop that program, then run ${COMMAND} portal`;
  }
  const running = `The portal is running at ${address} (version ${state.version}, process ${state.pid})`;
  if (state.version === installed) return `${running}.`;
  if (portalOutdated(installed, state.version)) {
    return `${running}, but this install is ${installed}: the next Claude Code session restarts it onto ${installed}.`;
  }
  return `${running}, newer than the installed ${installed}: it is left as it is.`;
}

/** Appends one line to the portal's log (`<stateDir>/portal.log`). Never throws. */
export function portalLog(paths: CliPaths, line: string, nowMs: number = Date.now()): void {
  try {
    appendLogLine(paths.portalLogFile, line, nowMs);
  } catch {
    // A state folder that cannot be written is not a reason to fail a start or a stop.
  }
}

/**
 * True when this port being held is news: the first time, or after another port was held.
 * The marker is cleared when the portal starts, so a hold that ends is said again if it
 * comes back.
 */
export function noteHeldPortOnce(paths: CliPaths, port: number, nowMs: number): boolean {
  try {
    const text = readFileSync(paths.portalHeldFile, "utf8");
    const held = JSON.parse(text) as { port?: unknown };
    if (held.port === port) return false;
  } catch {
    // No marker yet, or one that cannot be read: this hold is news.
  }
  try {
    atomicWrite(
      paths.portalHeldFile,
      `${JSON.stringify({ at: isoSeconds(nowMs), port })}\n`,
      0o600,
    );
  } catch {
    // The log line still goes out; the marker is only what keeps it to once.
  }
  return true;
}

/** Forgets a held port: the portal started, so the next hold is news again. */
export function clearHeldPort(paths: CliPaths): void {
  try {
    rmSync(paths.portalHeldFile, { force: true });
  } catch {
    // Nothing to forget.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
