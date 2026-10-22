/**
 * `cc-smart-dev-kit portal`: the page, `portal status` and `portal stop`.
 *
 * The portal starts with Claude Code and stays up (D10): a new session starts it when it is
 * not running, and a plugin update hands it over to the new version
 * (`src/portal/session-start.ts`, `src/portal/lifecycle.ts`). So this command does not run the
 * server in the foreground any more: it makes sure the portal runs and opens it, or says
 * whether it runs, or stops it. The server itself is the copy in
 * `~/.local/share/cc-smart-dev-kit/portal.js`, never the plugin's version folder, which Claude
 * Code deletes after an update.
 *
 * There is no sign-in any more (D9): the door is the `Host`, `Origin` and `Sec-Fetch-Site`
 * checks plus the CSRF token (`guard.ts`), and nothing here refuses inside a Claude Code
 * session. The session-escape guard asks the person before a session's shell command reaches
 * this port, which is the seatbelt that replaced the refusal.
 *
 * **It never opens the browser Claude drives.** When Chrome's `claude-code` profile — the one
 * Claude Code drives — is on this machine, `portal` opens no browser at all: Chrome opens an
 * outside link in the last window it used, which may be that very profile, where Claude could
 * reach the page's buttons. It prints the address and says where to open it
 * (`mayAutoOpen`, `openYourselfLine`); `--no-open` refuses the browser in every case.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeProfileOn } from "../browser/chrome";
import { realBrowserDoctorDeps } from "../browser/doctor";
import { COMMAND, VERSION } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { startDetached } from "../hooks/detached";
import type { Machine } from "../machine/machine";
import { openUrlOnDesktop } from "../machine/open-url";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { findUserInstall } from "../setup/installed-plugins";
import { type PortalProbe, type PortalState, probePortal, realPortalProbe } from "./health";
import {
  type EnsureOutcome,
  ensurePortal,
  portalLog,
  portalStatusLine,
  type StopOutcome,
  stopPortal,
} from "./lifecycle";

export const PORTAL_USAGE = `Usage: ${COMMAND} portal [status|stop] [--no-open]

Opens the portal in your browser: a page on this machine to see and change the gateway's
settings, the updates, the heavy-job queue and the companions.

  status      whether it runs, on which version, and its address
  stop        stop it now
  --no-open   print the address instead of opening your browser

It binds 127.0.0.1:${DEFAULT_PORTAL_PORT} only. It starts with Claude Code (a new session starts it;
a plugin update hands it over to the new version) and stays up until you stop it. There is no
sign-in: any program or account on this machine can open it. Never open it in the Chrome
profile Claude Code drives (its own, "claude-code"): Claude could reach its buttons.`;

/** What the command does, once its options are read. */
export interface PortalArgs {
  command: "open" | "status" | "stop";
  noOpen: boolean;
}

/**
 * Reads `[status|stop] [--no-open]`. `--port` is gone with the fixed port (D10): every
 * session and the session-start part must find the portal on the same number.
 */
export function parsePortalArgs(args: readonly string[]): PortalArgs | { error: string } {
  let command: PortalArgs["command"] = "open";
  let named = false;
  let noOpen = false;
  for (const arg of args) {
    if (arg === "--no-open") {
      noOpen = true;
      continue;
    }
    if (arg === "status" || arg === "stop") {
      if (named) return { error: "one command at a time: status or stop" };
      command = arg;
      named = true;
      continue;
    }
    return { error: `Unknown option: ${arg}` };
  }
  return { command, noOpen };
}

/** What the bundle's own run reads: the starter, the server, or a person's own terminal. */
export interface PortalChildArgs {
  /** The detached starter the SessionStart hook runs: probe, copy, start or restart. */
  ensure: boolean;
  noOpen: boolean;
  /** The parent's own folder, the fallback for every plugin file the server reads. */
  pluginDir: null | string;
  /** The detached server: no browser, and its lines go to the portal's log. */
  serve: boolean;
}

/**
 * Reads the bundle's options: `--ensure`, `--serve`, `--no-open`, and `--plugin-dir <folder>`
 * (the parent's own, never a person's: pointing the portal at another folder would let it
 * install that folder's router bundle).
 */
export function parsePortalChildArgs(args: readonly string[]): PortalChildArgs | { error: string } {
  let ensure = false;
  let noOpen = false;
  let pluginDir: null | string = null;
  let serve = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--ensure") ensure = true;
    else if (arg === "--serve") serve = true;
    else if (arg === "--no-open") noOpen = true;
    else if (arg === "--plugin-dir") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: "--plugin-dir needs a folder" };
      }
      pluginDir = value;
      index += 1;
    } else return { error: `Unknown option: ${arg}` };
  }
  if (ensure && serve) return { error: "--ensure and --serve are two different runs" };
  return { ensure, noOpen, pluginDir, serve };
}

/** The copy the portal runs from: the plugin deletes the version folder it was built in. */
export function portalCopy(paths: CliPaths): string {
  return paths.portalCopy;
}

/**
 * Whether the portal may open a browser by itself. It may not when Chrome's `claude-code`
 * profile — the one Claude Code drives — is on this machine: Chrome opens an outside link in
 * the window it last used, that window may be Claude's own profile, and Claude could then
 * reach the portal's buttons. `--no-open` refuses it in any case; without that profile it
 * opens, as it always did.
 */
export function mayAutoOpen(options: { claudeCodeProfile: boolean; noOpen: boolean }): boolean {
  return !options.noOpen && !options.claudeCodeProfile;
}

/** What the portal prints instead of opening a browser, when it must not open one. */
export function openYourselfLine(): string {
  return `Chrome's "claude-code" profile is on this machine, and Claude Code drives it: no browser was opened for you. Open the address above in a browser window that is NOT that profile — another Chrome profile, or another browser — and never in the window Claude works in.`;
}

/**
 * True when Chrome's `claude-code` profile — the one Claude Code drives — is on this machine.
 * A read of the profile folders only (`chrome.ts`): nothing is started, and a machine whose
 * Chrome folder cannot be read answers "not here", which is the safe answer for opening a
 * browser (that machine has no profile for Claude to drive).
 */
export function claudeCodeProfileHere(machine: Machine, home: string): boolean {
  return claudeCodeProfileOn(realBrowserDoctorDeps(machine, home)) !== null;
}

/** What `runPortal` needs from outside; a test passes its own. */
export interface PortalCommandContext {
  /** `process.execPath`: the bun a detached server runs on. */
  bunPath: string;
  /** This process's environment. */
  env: Record<string, string | undefined>;
  /** Where a refusal or a failure goes: `console.error` in use, a collector in a test. */
  error: (line: string) => void;
  /** Sends SIGTERM to the portal that answered: `process.kill` in use, a recorder in a test. */
  kill: (pid: number) => void;
  /** The system: which program opens a browser, and on which platform. */
  machine: Machine;
  paths: CliPaths;
  /**
   * The plugin's own folder: the portal bundle is copied from it, and it is the fallback
   * `--plugin-dir` the copy is told. The CLI runs from the version Claude Code installed, so
   * this is that version's folder.
   */
  pluginDir: string;
  /** The port; a test passes a free one. Default: the portal's one fixed port. */
  port?: number;
  /** Where the answer goes: `console.log` in use, a collector in a test. */
  print: (line: string) => void;
  /** Asks the portal's health route; `realPortalProbe()` in use, fakes in a test. */
  probe?: PortalProbe;
  /** Starts a detached argv, never waited for; a recorder in a test. */
  spawn?: (argv: string[], options: { cwd: string; env: Record<string, string> }) => void;
}

/** The environment a detached server gets: this process's, without the `undefined` values. */
function startEnv(env: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

/**
 * `cc-smart-dev-kit portal [status|stop] [--no-open]`; the exit code.
 *
 * `portal` opens the page, starting the server when nothing answers, restarting an older
 * version, and leaving another program's port alone. `status` says what runs and exits 0
 * only when this portal does. `stop` ends it and waits for the port to be free.
 */
export async function runPortal(
  ctx: PortalCommandContext,
  args: readonly string[],
): Promise<number> {
  const options = parsePortalArgs(args);
  if ("error" in options) {
    ctx.error(`${options.error}\n\n${PORTAL_USAGE}`);
    return 2;
  }
  const port = ctx.port ?? DEFAULT_PORTAL_PORT;
  const probe = ctx.probe ?? realPortalProbe();
  const log = (line: string) => portalLog(ctx.paths, line);
  if (options.command === "status") {
    const state: PortalState = await probePortal(port, probe);
    ctx.print(portalStatusLine(state, VERSION, port));
    return state.kind === "ours" ? 0 : 1;
  }
  if (options.command === "stop") {
    const outcome: StopOutcome = await stopPortal({
      kill: ctx.kill,
      log,
      paths: ctx.paths,
      port,
      probe,
    });
    if (outcome.kind === "other") {
      ctx.error(
        `Another program holds 127.0.0.1:${port}; it is not this portal, so nothing was stopped.`,
      );
      return 1;
    }
    if (outcome.kind === "failed") {
      ctx.error(`${COMMAND} portal: ${outcome.reason}.`);
      return 1;
    }
    ctx.print(outcome.kind === "stopped" ? "The portal stopped." : "The portal is not running.");
    return 0;
  }
  const spawn = (argv: string[]) => {
    if (ctx.spawn !== undefined) {
      ctx.spawn(argv, { cwd: ctx.paths.home, env: startEnv(ctx.env) });
      return;
    }
    startDetached(ctx.machine.platform, argv, {
      cwd: ctx.paths.home,
      env: startEnv(ctx.env),
      onError: (message) => ctx.error(`${COMMAND} portal: ${message}`),
    });
  };
  const outcome: EnsureOutcome = await ensurePortal({
    bunPath: ctx.bunPath,
    kill: ctx.kill,
    log,
    paths: ctx.paths,
    pluginFolder: ctx.pluginDir,
    port,
    probe,
    spawn,
    version: VERSION,
  });
  if (outcome.kind === "other") {
    ctx.error(
      `Another program holds 127.0.0.1:${port}, so the portal cannot start. Stop that program, then run ${COMMAND} portal.`,
    );
    return 1;
  }
  if (outcome.kind === "failed") {
    ctx.error(
      `${COMMAND} portal: ${outcome.reason}. The portal's log is ${ctx.paths.portalLogFile}.`,
    );
    return 1;
  }
  ctx.print(
    outcome.kind === "started"
      ? `The portal was not running: started it (version ${outcome.version}).`
      : outcome.kind === "restarted"
        ? `The portal was running ${outcome.from}: restarted it onto ${outcome.to}.`
        : `The portal is running (version ${outcome.version}).`,
  );
  const url = `http://127.0.0.1:${port}/`;
  ctx.print(`  ${url}`);
  const profileHere = claudeCodeProfileHere(ctx.machine, ctx.paths.home);
  if (mayAutoOpen({ claudeCodeProfile: profileHere, noOpen: options.noOpen })) {
    openUrlOnDesktop(ctx.machine.platform, url, {
      which: ctx.machine.which,
      spawn: ctx.machine.spawnDetached,
    });
  } else if (!options.noOpen) {
    ctx.print("");
    ctx.print(openYourselfLine());
  }
  return 0;
}

/** Where a start copies the portal bundle from, and the version Claude Code records. */
export interface PortalBundleSource {
  folder: string;
  /**
   * `installed`: the folder Claude Code records, with a portal bundle in it; `fallback`: the
   * folder the starter sits in (the installed bundle is missing, or no version is recorded).
   */
  source: "fallback" | "installed";
  /** The installed version, or null when Claude Code records none. */
  version: null | string;
}

/**
 * The plugin folder a start copies the portal bundle from: the version Claude Code records as
 * installed, else the fallback folder while it exists. `version` is the **record's**, even
 * when the fallback is used, so a caller can still tell that a newer version is installed and
 * refuse to start an older bundle (D10's one-way rule).
 */
export function installedPluginFolder(paths: CliPaths, fallback: string): PortalBundleSource {
  const installed = findUserInstall(paths.installedPluginsFile);
  if (installed !== null && existsSync(join(installed.installPath, "dist", "portal.js"))) {
    return { folder: installed.installPath, source: "installed", version: installed.version };
  }
  return { folder: fallback, source: "fallback", version: installed?.version ?? null };
}
