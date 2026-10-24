/**
 * `plugin/dist/portal.js`: the portal itself, in three shapes.
 *
 *   - `--serve` — the long-running server, started detached from its copy in
 *     `~/.local/share/cc-smart-dev-kit/` (by `cc-smart-dev-kit portal`, or by the
 *     session-start part's starter). No browser is opened, and every line it has to say goes
 *     to the portal's log: its stdout is nobody's.
 *   - `--ensure` — the starter the SessionStart hook runs, detached. It resolves the version
 *     Claude Code records as installed, refreshes the copy through `writeManagedFile`, and
 *     then starts, restarts or leaves the server alone (`src/portal/lifecycle.ts`). An older
 *     bundle re-runs the installed one instead of starting itself: an old session's hook after
 *     an update never starts an older version (D10).
 *   - no mode — a person running the copy by hand: the server in their terminal, the address
 *     printed, and their browser opened (unless `--no-open`, or Chrome's `claude-code`
 *     profile is on the machine: `mayAutoOpen`).
 *
 * It is a bundle of its own, so nothing here changes `router.js` (a changed router bundle
 * restarts every machine's router).
 *
 * It runs from the copy, never from the plugin's version folder: Claude Code deletes an old
 * version folder some time after an update. The copy is a managed file, so `restore` removes
 * it. `--plugin-dir` is the fallback for every plugin file the server reads while it runs
 * (`plugin-folder.ts` resolves the installed version first).
 */

import { join } from "node:path";
import { realBrowserDoctorDeps } from "../browser/doctor";
import { legacyBrowserLeftovers, processCommandLinesAsync } from "../browser/legacy";
import { VERSION } from "../build-info";
import type { DoctorOptions } from "../cli/doctor";
import { cliPaths, tildify } from "../cli/paths";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { startDetached } from "../hooks/detached";
import { type Machine, realMachine } from "../machine/machine";
import { openUrlOnDesktop } from "../machine/open-url";
import { realMcpDoctorDeps } from "../mcp/doctor";
import { projectsList } from "../portal/api/projects";
import {
  claudeCodeProfileHere,
  installedPluginFolder,
  mayAutoOpen,
  openYourselfLine,
  PORTAL_USAGE,
  parsePortalChildArgs,
} from "../portal/command";
import type { PortalContext, ReadRunner } from "../portal/context";
import { probePortal, realPortalProbe } from "../portal/health";
import { ensurePortal, portalLog, portalStarterArgv } from "../portal/lifecycle";
import { resolvePluginFolder } from "../portal/plugin-folder";
import { startPortal } from "../portal/server";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { pluginFolderBeside } from "../setup/bun-config";
import { instructionsFolder } from "../setup/instructions";
import { isOlder } from "../update/check";

/** How long a command may take; `claude plugin` alone may clone for a while. */
const RUN_TIMEOUT_MS = 300_000;

/** Ctrl+C: 130, the shell's own code for "ended by SIGINT" (128 + 2). Not 0: the run did not finish. */
const SIGINT_EXIT = 130;

const runner: Runner = (cmd) => {
  try {
    const result = Bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe", timeout: RUN_TIMEOUT_MS });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The pages' reads, off the server's loop: `journalctl` for the router's log, `systemctl` for
 * its socket. `Bun.spawn`, never `spawnSync`: a synchronous one froze every page, every other
 * action and the live stream while it ran. The same command, the same timeout and the same
 * words as `runner`, which the actions' changing commands keep.
 */
const runRead: ReadRunner = async (cmd, extraEnv) => {
  try {
    const child = Bun.spawn(cmd, {
      // A read that needs its own variable (`MCP_TIMEOUT` for `claude mcp get`) adds it over
      // this process's own environment.
      env: extraEnv === undefined ? process.env : { ...process.env, ...extraEnv },
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
      timeout: RUN_TIMEOUT_MS,
      windowsHide: true,
    });
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // A signal ended it when `exited` is 128 + the signal (Bun's timeout kill is SIGTERM, 143):
    // the sync runner says 1 for a child with no exit code, and so does this.
    return { exitCode: child.signalCode === null ? exitCode : 1, output: `${output}${errors}` };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
};

/** This process's environment, without the `undefined` values `spawn` does not take. */
function startEnv(env: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

/**
 * Opens a URL in the person's own browser. Never waits, and never fails the portal. Which
 * program opens it, per platform: `open-url.ts` (one home for that rule). Started detached
 * (`Machine.spawnDetached`): `xdg-open` may start the browser as its own child, and in this
 * terminal's process group the Ctrl+C that stops the portal would close that browser too.
 */
function openBrowser(machine: Machine, url: string): void {
  openUrlOnDesktop(machine.platform, url, {
    which: machine.which,
    spawn: machine.spawnDetached,
  });
}

/**
 * The starter: the copy is refreshed from the installed version, then the portal is started,
 * restarted onto this version, or left alone. Everything it has to say goes to the portal's
 * log, because the hook that started it has already returned.
 */
async function runEnsure(
  paths: ReturnType<typeof cliPaths>,
  pluginDir: null | string,
): Promise<number> {
  const fallback = pluginDir ?? pluginFolderBeside(import.meta.dir);
  const installed = installedPluginFolder(paths, fallback);
  const log = (line: string) => portalLog(paths, line);
  // A newer version is installed than the one this starter belongs to: an old session's hook
  // after an update never starts an older portal (D10). The installed bundle does the work;
  // when it is not there, nothing starts and doctor reports the broken install.
  const newerInstalled = installed.version !== null && isOlder(VERSION, installed.version);
  if (newerInstalled && installed.source === "fallback") {
    log(
      `failed: ${installed.version} is installed, but its portal bundle is missing (${installed.folder}); nothing was started. Run cc-smart-dev-kit doctor, then reinstall the plugin.`,
    );
    return 1;
  }
  if (newerInstalled) {
    log(`handed over: this starter is ${VERSION}, the installed version is ${installed.version}`);
    startDetached(
      process.platform,
      portalStarterArgv(
        process.execPath,
        join(installed.folder, "dist", "portal.js"),
        installed.folder,
      ),
      {
        cwd: paths.home,
        env: startEnv(process.env),
        onError: (message) => log(`failed: ${message}`),
      },
    );
    return 0;
  }
  const outcome = await ensurePortal({
    bunPath: process.execPath,
    kill: (pid) => process.kill(pid, "SIGTERM"),
    log,
    paths,
    pluginFolder: installed.folder,
    port: DEFAULT_PORTAL_PORT,
    probe: {
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      sleep: (ms) => Bun.sleep(ms),
    },
    spawn: (argv) =>
      startDetached(process.platform, argv, {
        cwd: paths.home,
        env: startEnv(process.env),
        onError: (message) => log(`failed: ${message}`),
      }),
    // The version of the bundle this start copies: the installed one, or this starter's own.
    version: installed.source === "installed" ? (installed.version ?? VERSION) : VERSION,
  });
  return outcome.kind === "failed" || outcome.kind === "other" ? 1 : 0;
}

/** The server: `--serve` from the copy, or the same thing in a terminal when run by hand. */
async function runServer(
  paths: ReturnType<typeof cliPaths>,
  options: { noOpen: boolean; pluginDir: null | string; serve: boolean },
): Promise<number> {
  const which = (name: string): null | string => Bun.which(name, { PATH: process.env.PATH ?? "" });
  const machine = realMachine(process.env, null);
  /** Where the plugin's files are now: the installed version, else the folder the parent passed. */
  const fallback = options.pluginDir ?? pluginFolderBeside(import.meta.dir);
  const ctx: PortalContext = {
    bunVersion: Bun.version,
    env: process.env,
    fetch: (url, init) => fetch(url, init),
    machine,
    now: () => Date.now(),
    openBrowser: (url) => openBrowser(machine, url),
    paths,
    pluginFolder: () => resolvePluginFolder(paths.installedPluginsFile, fallback),
    probe: realProbe(),
    runRead,
    runner,
    systemd: process.platform === "linux" && which("systemctl") !== null,
    which,
  };
  /**
   * The doctor pass, built from the plugin's folder as it is **now**: this process runs from a
   * copy in `~/.local/share/`, so a path made here at startup points into a version folder Claude
   * Code may delete during the run. `{ error }` in words when there is no folder left at all.
   */
  const doctor = async (): Promise<DoctorOptions | { error: string }> => {
    const found = ctx.pluginFolder();
    if ("error" in found) return found;
    const { folder } = found;
    // The 0.3.0 browser's process list, off the server's loop: on macOS it is `ps`, on Windows
    // PowerShell. It is read only when 0.3.0 left something — its own first question — so a
    // machine that never ran it spawns nothing (B6e's rule, `.claude/rules/portal.md`).
    const processes = legacyBrowserLeftovers(ctx.paths)
      ? await processCommandLinesAsync(machine.platform, runRead)
      : null;
    return {
      browser: { ...realBrowserDoctorDeps(machine, ctx.paths.home), processes: () => processes },
      bun: { path: process.execPath, version: Bun.version },
      gateway: {
        bundle: join(folder, "dist", "router.js"),
        machine,
        // The pass's own reads — the service's state, what holds the port — run off the loop:
        // one Machine page load must never freeze every page and the stream on `systemctl`
        // (B6e's rule, `.claude/rules/portal.md`).
        read: runRead,
        runner,
        service: ctx.systemd ? "systemd" : "none",
        // The per-project doctor lines read the portal's own list: the same reader the
        // Projects page uses, so the page and the doctor cannot disagree (GP4a).
        projects: async (projectFolder) => {
          const list = await projectsList({
            cwd: projectFolder,
            env: ctx.env,
            now: ctx.now,
            paths: ctx.paths,
          });
          return { note: list.note, projects: list.projects };
        },
      },
      live: null,
      local: { cwd: process.cwd(), instructionsSource: instructionsFolder(join(folder, "dist")) },
      mcp: realMcpDoctorDeps(runRead),
      portal: () => probePortal(DEFAULT_PORTAL_PORT, realPortalProbe()),
      project: { cwd: process.cwd(), pluginHooksFile: join(folder, "hooks", "hooks.json") },
      // The pass's own reads — the launcher's `version`, the old launcher's, Warp's package
      // manager, `claude --version` for the live record — run off the loop too: the Machine
      // page shows this pass, and a page load must never freeze on one (B6e's rule).
      read: runRead,
    };
  };

  const portal = await startPortal(ctx, {
    cwd: process.cwd(),
    doctor,
    port: DEFAULT_PORTAL_PORT,
    // The export beside the copy in the state folder, never one the bundle's own folder holds:
    // the server runs from `~/.local/share/cc-smart-dev-kit/portal.js`, and the copy is what
    // `refreshPortalCopy` refreshed. No folder there: the server-rendered pages answer.
    staticFolder: paths.portalUiFolder,
  });
  // `portal stop`, and the starter's version hand-over, end it with SIGTERM: stop the server
  // properly (the socket closes, the log says so) instead of killing the process where it is.
  process.on("SIGTERM", () => portal.stop());
  const log = (line: string) => portalLog(paths, line);
  log(`serve: version ${VERSION}, pid ${process.pid}, on 127.0.0.1:${portal.port}`);

  if (!options.serve) {
    console.log(`cc-smart-dev-kit portal ${VERSION}`);
    console.log(`Running from ${tildify(import.meta.path, paths.home)}.`);
    console.log("");
    console.log(`  ${portal.url}`);
    console.log("");
    console.log(
      `It binds 127.0.0.1:${portal.port} only and stays up until you stop it: Ctrl+C here, or \`cc-smart-dev-kit portal stop\`.`,
    );
    const profileHere = claudeCodeProfileHere(machine, paths.home);
    if (mayAutoOpen({ claudeCodeProfile: profileHere, noOpen: options.noOpen })) {
      ctx.openBrowser(portal.url);
    } else if (!options.noOpen) {
      console.log("");
      console.log(openYourselfLine());
    }
  }

  await portal.finished;
  log("stopped");
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const options = parsePortalChildArgs(argv);
  if ("error" in options) {
    console.error(`${options.error}\n\n${PORTAL_USAGE}`);
    return 2;
  }
  const paths = cliPaths();
  return options.ensure
    ? await runEnsure(paths, options.pluginDir)
    : await runServer(paths, options);
}

process.on("SIGINT", () => process.exit(SIGINT_EXIT));

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `cc-smart-dev-kit portal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
