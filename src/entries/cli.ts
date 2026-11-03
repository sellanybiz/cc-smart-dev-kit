import { existsSync, statSync } from "node:fs";
import { uptime } from "node:os";
import { join, resolve } from "node:path";
import { browserCheckCommand, runBrowserCheck } from "../browser/check";
import { desktopEnvironment, realStartChrome, runDesktopLookup } from "../browser/chrome-start";
import { realBrowserDoctorDeps } from "../browser/doctor";
import { runBrowserMcp } from "../browser/launcher";
import { browserSetup, realBrowserSetupDeps } from "../browser/setup";
import { clearBrowserToken, savePastedToken } from "../browser/token";
import { COMMAND, VERSION } from "../build-info";
import { parseOptions } from "../cli/args";
import { oldBunRefusal } from "../cli/bun-check";
import { runClaudeMem } from "../cli/claude-mem";
import { DOCTOR_FLAGS, runDoctor } from "../cli/doctor";
import {
  asksForHelp,
  commandWords,
  HELP_COMMAND,
  HOOK_HELP,
  HOOK_NAMES,
  helpTextFor,
  unknownCommand,
  usageError,
} from "../cli/help";
import { realRunSession, runLaunch } from "../cli/launch";
import type { LiveRunner } from "../cli/live-check";
import { runMigrate } from "../cli/migrate";
import { cliPaths } from "../cli/paths";
import { runProjectInit } from "../cli/project-init";
import { runReport } from "../cli/report";
import { runRestore } from "../cli/restore";
import { cleanSecretLine } from "../cli/secret-line";
import { runSetup } from "../cli/setup";
import { runStatusline } from "../cli/statusline";
import { runSubagentStatusline } from "../cli/subagent-statusline";
import { createOut, dryRunEnding } from "../cli/ui/out";
import { terminalPrompts } from "../cli/ui/prompt";
import { currentTerminal } from "../cli/ui/terminal";
import { runUpdate } from "../cli/update";
import { runUsage } from "../cli/usage";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { gatewayContext as buildGatewayContext } from "../gateway/context";
import { loopbackFetch, realProbe } from "../gateway/health";
import { type Runner, routerServiceKind } from "../gateway/service";
import { windowsAccount } from "../gateway/service-windows";
import {
  ALERT_SCREEN_MS,
  parseNotifyWorkerAlert,
  runDesktopAlert,
  type Watch,
} from "../hooks/desktop-alert";
import { runtimeDir } from "../hooks/notify";
import { runNotifyEntry } from "../hooks/notify-entry";
import { recordSessionName } from "../hooks/session-name";
import { RETIRED_ENGINE_HOOKS } from "../hooks/settings-hooks";
import { ALERT_WORKER_COMMAND, parseAlert, runAlert, spawnRunner } from "../hooks/stop-failure";
import { runIssue } from "../issues/command";
import { runJobCommand } from "../jobs/commands";
import { realMachine } from "../machine/machine";
import { realMcpDoctorDeps } from "../mcp/doctor";
import { mcpServerStatus, mcpServerStatusLine } from "../mcp/status";
import { runOmniroute } from "../omniroute/commands";
import { projectsList } from "../portal/api/projects";
import { runPortal } from "../portal/command";
import { probePortal, realPortalProbe, testPortalState } from "../portal/health";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { WORKTREE_ENGINE_RETIRED_IN } from "../project/config";
import { locateCheckout } from "../project/resolve";
import { runSessions } from "../sessions/command";
import { pluginFolderBeside } from "../setup/bun-config";
import { instructionsFolder } from "../setup/instructions";
import { MAX_SUBAGENTS_FLAG, parseMaxSubagents } from "../setup/max-subagents";
import { NO_RETRY_WATCHDOG_FLAG, RETRY_WATCHDOG_FLAG } from "../setup/retry-watchdog";
import { USER_NOTIFY_HOOK_NAME } from "../setup/user-notify-hook";
import { runUser } from "../user-away/command";
import { alertsAt } from "../workflow/alerts";
import { runWorkflow } from "../workflow/commands";
import { runWorktrees } from "../worktrees/command";

/**
 * The plugin's other bundles beside this one (plugin/dist/<name>.js): the router, and the
 * Playwright MCP's init page. Run from the source (src/entries/cli.ts, in tests and
 * development), the repo's plugin/dist.
 */
function distBundle(name: string): string {
  const beside = join(import.meta.dir, name);
  return existsSync(beside) ? beside : join(import.meta.dir, "..", "..", "plugin", "dist", name);
}

function routerBundle(): string {
  return distBundle("router.js");
}

/**
 * The plugin's instructions folder (plugin/instructions), beside dist/. Run from the source
 * (src/entries/cli.ts), the repo's plugin/instructions.
 */
/**
 * The plugin folder this CLI belongs to (`plugin/`, holding `dist/`): what `doctor --live`
 * loads with `--plugin-dir`. Run from the source, the repo's `plugin/`.
 */
function pluginDir(): string {
  return pluginFolderBeside(import.meta.dir);
}

const liveRunner: LiveRunner = (argv, { cwd, env, timeoutMs }) => {
  try {
    const result = Bun.spawnSync(argv, {
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  } catch (error) {
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
};

// 180 s: a `systemctl --user restart` of the router returns only once the old router has
// drained its answers in flight (the unit's TimeoutStopSec, 120 s). A shorter timeout
// would kill systemctl mid-wait and report a restart that is still going on as failed.
const runner: Runner = (cmd) => {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: 180_000 });
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

/** systemd user units need Linux and systemctl on PATH. */
const systemd = process.platform === "linux" && Bun.which("systemctl") !== null;

/** The service that runs the router here: systemd's units, or a Windows Scheduled Task. */
const service = routerServiceKind(process.platform, (command) =>
  Bun.which(command, { PATH: process.env.PATH ?? "" }),
);

/** The Windows account a Scheduled Task runs as (`MACHINE\user`); null everywhere else. */
const account = windowsAccount(process.env);

/**
 * The questions every command asks, from their one home (`src/cli/ui/prompt.ts`); null when
 * stdin is not a terminal (a pipe, a script, a test): then nothing is asked.
 */
const prompts = terminalPrompts(currentTerminal(process.env));

/** A yes/no question whose default is no; null when there is no terminal to ask on. */
const ask = prompts === null ? null : (question: string) => prompts.confirm(question, false);

/**
 * The projects list the kit shows, in one place: `gateway projects`, `gateway off`'s
 * "still on" lines and `doctor`'s per-project lines all read the portal's own `projectsList`,
 * so the command, the doctor and the Projects page can never disagree about which projects
 * exist.
 */
function projectsReader(paths: ReturnType<typeof cliPaths>) {
  return async (folder: string) => {
    const list = await projectsList({
      cwd: folder,
      env: process.env,
      now: () => Date.now(),
      paths,
    });
    return { note: list.note, projects: list.projects };
  };
}

/**
 * The gateway commands' context. `src/gateway/context.ts` owns it — including the one decision
 * `--omniroute-password` needs (`readSecret` on a terminal whose echo can be switched off, and
 * nothing on a pipe), which this entry used to leave out.
 */
function gatewayContext(paths: ReturnType<typeof cliPaths>): GatewayContext {
  return {
    ...buildGatewayContext({
      account,
      bundle: routerBundle(),
      confirm: ask,
      paths,
      platform: process.platform,
      runner,
      service,
      terminal: process.stdin,
    }),
    // `gateway projects` lists the portal's own projects (`projectsList`): one reader for the
    // page and the command, so the two can never disagree about which projects exist.
    projects: projectsReader(paths),
  };
}

/**
 * What `launch` needs: the gateway's config (a port, a profile), the state folder for its
 * settings file, and this machine's `claude`. The session runs attached to this terminal,
 * so its stdin, stdout and stderr are this process's own (`realRunSession`).
 */
function launchContext(paths: ReturnType<typeof cliPaths>) {
  return {
    configPath: paths.gatewayConfigFile,
    cwd: process.cwd(),
    env: process.env,
    error: (line: string) => console.error(line),
    fetch: loopbackFetch,
    home: paths.home,
    platform: process.platform,
    print: (line: string) => console.log(line),
    runSession: realRunSession,
    settingsFile: paths.settingsFile,
    stateDir: paths.stateDir,
    which: (command: string) => Bun.which(command, { PATH: process.env.PATH ?? "" }),
  };
}

/** What `omniroute status`, `update` and `rollback` need: systemd, the registry, a question. */
function omnirouteContext(paths: ReturnType<typeof cliPaths>) {
  return {
    confirm: ask,
    env: process.env,
    health: loopbackFetch,
    now: () => Date.now(),
    paths,
    registry: (url: string, init: RequestInit) => fetch(url, init),
    runner,
    say: (line: string) => console.log(line),
    sleep: (ms: number) => Bun.sleep(ms),
    systemd,
    which: (command: string) => Bun.which(command, { PATH: process.env.PATH ?? "" }),
  };
}

/**
 * Reads a program's stdout line by line while it runs: the notification server's signal
 * monitor (`gdbus monitor`, `src/hooks/desktop-alert.ts`). The alert's wait ends on one of
 * those lines, or on the minute; `stop` ends the monitor either way.
 */
const watchLines: Watch = (argv, onLine) => {
  const monitor = Bun.spawn(argv, { stdin: "ignore", stderr: "ignore", stdout: "pipe" });
  const read = async (): Promise<void> => {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of monitor.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    }
  };
  read().catch((error) =>
    // The monitor dying early only means the alert waits out its minute instead of the
    // click; one line says so, and the process is one the hook never sees.
    console.error(`${COMMAND}: the notification monitor stopped: ${String(error)}`),
  );
  return { stop: () => monitor.kill() };
};

async function main(argv: string[]): Promise<number> {
  // The one argument step, before any command runs: `-h` or `--help` anywhere before a `--`
  // prints that command's own help and exits 0. So `worktrees --help` never scans, and neither
  // does a typo (`worktrees --clena` is refused, not run). It runs before the Bun check too:
  // printing help needs no Bun, no machine and no key.
  const asked = asksForHelp(argv);
  const helpWords = commandWords(argv);
  if (asked) {
    const text = helpTextFor(helpWords);
    if (text !== null) {
      console.log(text);
      return 0;
    }
  }
  const [command, ...rest] = argv;
  const refusal = oldBunRefusal(command, Bun.version, process.execPath);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const paths = cliPaths();

  switch (command) {
    case "setup": {
      const flags = [
        "--dry-run",
        "--yes",
        "--warp",
        "--remove-warp",
        "--no-instructions",
        "--instructions",
        "--statusline",
        RETRY_WATCHDOG_FLAG,
        NO_RETRY_WATCHDOG_FLAG,
        "--tavily-key-stdin",
      ];
      let project = process.cwd();
      let maxSubagents: number | null = null;
      const unknown: string[] = [];
      for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index] ?? "";
        if (arg === MAX_SUBAGENTS_FLAG) {
          try {
            maxSubagents = parseMaxSubagents(rest[index + 1]);
          } catch (error) {
            console.error(
              usageError(error instanceof Error ? error.message : String(error), "setup"),
            );
            return 2;
          }
          index += 1;
        } else if (arg === "--project") {
          const dir = rest[index + 1];
          if (dir === undefined || dir.startsWith("--")) {
            console.error(usageError("--project needs a folder", "setup"));
            return 2;
          }
          project = resolve(dir);
          index += 1;
        } else if (!flags.includes(arg)) {
          unknown.push(arg);
        }
      }
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "setup"));
        return 2;
      }
      const off = rest.includes("--no-instructions");
      const on = rest.includes("--instructions");
      if (off && on) {
        console.error(usageError("Use --no-instructions or --instructions, not both.", "setup"));
        return 2;
      }
      const watchdogOn = rest.includes(RETRY_WATCHDOG_FLAG);
      const watchdogOff = rest.includes(NO_RETRY_WATCHDOG_FLAG);
      if (watchdogOn && watchdogOff) {
        console.error(
          usageError(`Use ${RETRY_WATCHDOG_FLAG} or ${NO_RETRY_WATCHDOG_FLAG}, not both.`, "setup"),
        );
        return 2;
      }
      if (rest.includes("--warp") && rest.includes("--remove-warp")) {
        console.error(usageError("--warp and --remove-warp do opposite things: give one", "setup"));
        return 2;
      }
      if (!existsSync(project) || !statSync(project).isDirectory()) {
        // Not a usage mistake: the option is spelled right, the folder is wrong (UX-13).
        console.error(
          `Not a folder: ${project}\nFix: give the folder of a project, or leave --project out to use the folder you are in`,
        );
        return 1;
      }
      // The Tavily key on stdin, never an argument (a command line is readable in `/proc`
      // and lands in the shell's history). Read before anything else is planned, so the
      // plan and a real run say the same thing. Cleaned: a paste may arrive wrapped in the
      // bracketed-paste markers (`src/cli/secret-line.ts`).
      let tavilyKeyStdin: null | string = null;
      if (rest.includes("--tavily-key-stdin")) {
        const value = cleanSecretLine(await Bun.stdin.text());
        if (value === "") {
          console.error(usageError("No key arrived on stdin", "setup"));
          return 2;
        }
        tavilyKeyStdin = value;
      }
      return runSetup(paths, {
        dryRun: rest.includes("--dry-run"),
        tavilyKeyStdin,
        env: process.env,
        yes: rest.includes("--yes"),
        warp: rest.includes("--warp"),
        removeWarp: rest.includes("--remove-warp"),
        project,
        machine: realMachine(process.env, ask),
        instructions: off ? false : on ? true : null,
        instructionsSource: instructionsFolder(import.meta.dir),
        statusline: rest.includes("--statusline"),
        retryWatchdog: watchdogOn ? true : watchdogOff ? false : null,
        maxSubagents,
      });
    }
    case "statusline":
      // Claude Code pipes its JSON in; run by hand in a terminal, there is none to wait for.
      // The warning share comes from the workflow settings of the folder the session is in.
      return runStatusline(
        paths,
        () => (process.stdin.isTTY ? Promise.resolve("") : Bun.stdin.text()),
        Date.now(),
        alertsAt(paths, process.cwd(), process.env),
        process.env,
      );
    case "usage":
      return runUsage(paths, rest, Date.now());
    case "subagent-statusline":
      // Claude Code runs it from the plugin's settings: its input on stdin, one JSON line
      // per subagent row on stdout (`src/cli/subagent-statusline.ts`).
      return runSubagentStatusline();
    case "report":
      // The flow report (`src/sessions/flow.ts`): counts, times, tool and hook names only.
      return runReport(paths, rest, Date.now());
    case ALERT_WORKER_COMMAND: {
      // Not in --help: the notifier starts it, detached, through the launcher, so the wait for a
      // click — a minute on screen — runs from the installed version, not the hook's version
      // folder (src/entries/notify.ts). The usage-limit hook shows its plain alert itself; the
      // worker still reads that hook's own format, for an older hook in a running session.
      const argument = rest.length === 1 ? (rest[0] ?? "") : null;
      const notifyAlert = argument === null ? null : parseNotifyWorkerAlert(argument);
      if (notifyAlert !== null) {
        // The notifier's alert: the desktop extras around it, everything that waits, and
        // the window raised on a click (`src/hooks/desktop-alert.ts`).
        const outcome = await runDesktopAlert(notifyAlert, {
          capture: spawnRunner,
          nowMs: () => Date.now(),
          screenMs: ALERT_SCREEN_MS,
          sleep: (ms) => Bun.sleep(ms),
          stateDir: runtimeDir(process.env),
          watch: watchLines,
          which: (command) => Bun.which(command, { PATH: process.env.PATH ?? "" }),
        });
        if (outcome === "no notifier") {
          console.error(`${COMMAND}: ${notifyAlert.title}. ${notifyAlert.body}`);
        }
        return 0;
      }
      const alert = argument === null ? null : parseAlert(argument);
      if (alert === null) {
        console.error(`Usage: ${COMMAND} ${ALERT_WORKER_COMMAND} <alert JSON> (the hook runs it)`);
        return 2;
      }
      if (runAlert(alert, process.platform, spawnRunner) === "no notifier") {
        console.error(`${COMMAND}: ${alert.title}. ${alert.body}`);
      }
      return 0;
    }
    case "doctor": {
      const unknown = rest.filter((arg) => !DOCTOR_FLAGS.includes(arg));
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "doctor"));
        return 2;
      }
      const doctorOut = createOut(currentTerminal(process.env));
      const doctorPrint = { json: rest.includes("--json"), verbose: rest.includes("--verbose") };
      return runDoctor(
        paths,
        process.env,
        {
          browser: realBrowserDoctorDeps(realMachine(process.env, null), paths.home),
          bun: { path: process.execPath, version: Bun.version },
          gateway: {
            bundle: routerBundle(),
            runner,
            service,
            machine: realMachine(process.env, null),
            projects: projectsReader(paths),
          },
          local: { instructionsSource: instructionsFolder(import.meta.dir), cwd: process.cwd() },
          mcp: realMcpDoctorDeps(),
          portal: () =>
            testPortalState(process.env) ?? probePortal(DEFAULT_PORTAL_PORT, realPortalProbe()),
          project: {
            cwd: process.cwd(),
            pluginHooksFile: join(pluginDir(), "hooks", "hooks.json"),
          },
          live: rest.includes("--live")
            ? {
                pluginDir: pluginDir(),
                run: liveRunner,
              }
            : null,
        },
        doctorOut,
        doctorPrint,
      );
    }
    case "hook": {
      const [name, ...extra] = rest;
      if (name === undefined) {
        console.log(HOOK_HELP);
        return 0;
      }
      if (name === USER_NOTIFY_HOOK_NAME && extra.length === 0) {
        // The same wiring as `plugin/dist/notify.js`: one function, one answer. This is the
        // command the user-level hook setup writes for agent view runs
        // (`src/setup/user-notify-hook.ts`).
        await runNotifyEntry();
        return 0;
      }
      // A line the retired worktree engine had a project wire: the fix, never the old answer.
      // Read nothing: whatever Claude Code sent on stdin does not change it.
      //
      // Exit 1, never 2. Exit 2 is Claude Code's blocking exit (its hooks reference): on
      // `SubagentStop` it blocks the stop, and nothing here reads `stop_hook_active`, so a
      // leftover `hook subagent-stop` line would block every subagent's stop for ever. Exit 1
      // is a non-blocking error on `SubagentStop` (the subagent stops) and on `WorktreeRemove`
      // (the worktree is kept and the session goes on), and on `WorktreeCreate` any non-zero
      // exit still fails the creation and shows this line. The rows:
      // `docs/claude-code-contract.md` § Hooks — the SubagentStop row (its blocking answer
      // repeats with `stop_hook_active`), the WorktreeCreate row (a failing line stops the
      // creation and shows its stderr) and the WorktreeRemove row (exit 1 keeps the worktree).
      if (RETIRED_ENGINE_HOOKS.some((retired) => retired === name)) {
        console.error(
          `${COMMAND} hook ${name}: this hook was retired in ${WORKTREE_ENGINE_RETIRED_IN}: remove its line from your settings — \`${COMMAND} project init\` does it`,
        );
        return 1;
      }
      // The only hook left is the notifier, which ran above. Every other name is unknown.
      console.error(
        `Unknown hook: ${[name, ...extra].join(" ")}\n\n${usageError(`Usage: ${COMMAND} hook <${HOOK_NAMES}>`, "hook")}`,
      );
      return 2;
    }
    case "project": {
      const [sub, ...flags] = rest;
      if (sub !== "init") {
        console.error(
          usageError(`Usage: ${COMMAND} project init [--dry-run] [--yes] [flags]`, "project init"),
        );
        return 2;
      }
      // `--help` is answered above, before this runs; the repo is resolved only for a run that
      // would write.
      let root = process.cwd();
      try {
        const checkout = locateCheckout(process.cwd(), { env: process.env });
        if (checkout === null) {
          // Not a usage mistake: the command is spelled right, the folder is wrong (UX-13).
          console.error(
            `${COMMAND} project init: this folder is not in a git project\nFix: run it in the project's folder, or run git init here first`,
          );
          return 1;
        }
        root = checkout.root;
      } catch (error) {
        console.error(
          `${COMMAND} project init: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      return runProjectInit(flags, {
        root,
        env: process.env,
        stateDir: paths.stateDir,
        home: paths.home,
        prompts,
        out: createOut(currentTerminal(process.env)),
        error: (line) => console.error(line),
      });
    }
    case "issue":
      return runIssue(rest, {
        cwd: process.cwd(),
        env: process.env,
        error: (line) => console.error(line),
        paths,
        print: (line) => console.log(line),
        readStdin: () => Bun.stdin.text(),
      });
    case "workflow":
      return runWorkflow(rest, {
        paths,
        cwd: process.cwd(),
        env: process.env,
        print: (line) => console.log(line),
        error: (line) => console.error(line),
      });
    case "session-name": {
      const [sessionId, ...words] = rest;
      if (sessionId === undefined || words.length === 0) {
        // The usage line, then the help that explains it: `hook-commands.test.ts` pins the
        // first line, and `session-name --help` prints the rest.
        console.error(
          usageError(`Usage: ${COMMAND} session-name <session id> <name>`, "session-name"),
        );
        return 2;
      }
      let name: string;
      try {
        name = recordSessionName(sessionId, words.join(" "), process.env);
      } catch (error) {
        // A wrong argument (a name that is not a session id, a name that is empty) is a
        // usage mistake, not a failed command: exit 2, and say what is wrong.
        console.error(
          usageError(error instanceof Error ? error.message : String(error), "session-name"),
        );
        return 2;
      }
      console.log(`This session will be named "${name}" from the next prompt.`);
      return 0;
    }
    case "restore": {
      const unknown = rest.filter((arg) => arg !== "--yes" && arg !== "--now");
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "restore"));
        return 2;
      }
      return runRestore(paths, {
        // What stage 1 names when it removed the launcher: the bundle a person runs then.
        cliBundle: distBundle("cli.js"),
        claude: (argv) => {
          const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
          return {
            ok: result.exitCode === 0,
            out: `${result.stdout.toString()}\n${result.stderr.toString()}`,
          };
        },
        yes: rest.includes("--yes"),
        now: rest.includes("--now"),
        runner,
        service,
        confirm: ask,
        probe: realProbe(),
        which: (command) => Bun.which(command),
      });
    }
    case "mcp": {
      const [sub, ...mcpRest] = rest;
      if (sub !== "status") {
        console.error(usageError(`Usage: ${COMMAND} mcp status [--json]`, "mcp status"));
        return 2;
      }
      const unknown = mcpRest.filter((arg) => arg !== "--json");
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "mcp status"));
        return 2;
      }
      const servers = mcpServerStatus(paths);
      if (mcpRest.includes("--json")) {
        console.log(JSON.stringify({ servers, userConfigFile: paths.userConfigFile }, null, 2));
      } else {
        for (const server of servers) {
          console.log(mcpServerStatusLine(server));
        }
      }
      // 1: Claude Code's own config could not be read, so nothing here can be trusted — the
      // difference between "nothing is foreign" and "could not check" matters to the installer.
      return servers.some((server) => server.state === "unreadable") ? 1 : 0;
    }
    case "migrate": {
      const unknown = rest.filter((arg) => arg !== "--dry-run" && arg !== "--yes");
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "migrate"));
        return 2;
      }
      return runMigrate(paths, {
        dryRun: rest.includes("--dry-run"),
        yes: rest.includes("--yes"),
        bunPath: process.execPath,
        bunVersion: Bun.version,
        bundle: routerBundle(),
        instructionsSource: instructionsFolder(import.meta.dir),
        runner,
        systemd,
        confirm: ask,
        probe: realProbe(),
        env: process.env,
      });
    }
    case "update":
      return runUpdate(paths, process.env, rest);
    case "browser": {
      const [sub, ...extra] = rest;
      const machine = realMachine(process.env, null);
      const browserDeps = realBrowserSetupDeps(machine, paths.home);
      if (sub === "mcp") {
        // Runs until the MCP exits. Nothing here may write to stdout: it IS the MCP stream.
        return await runBrowserMcp(paths, extra, {
          chrome: browserDeps,
          // This session's environment: the desktop lookup (the user manager's DISPLAY for a
          // background session) and the environment of a Chrome the launcher starts itself.
          env: process.env,
          desktop: () =>
            desktopEnvironment(process.env, {
              platform: machine.platform,
              run: (argv) => runDesktopLookup(argv, process.env),
            }),
          log: (line) => console.error(`[cc-smart-dev-kit-browser] ${line}`),
          spawn: (argv, options) => {
            // The token goes on top of this process's environment: the MCP must find bun and
            // everything else as usual. The folder is the launcher's choice, never this one's.
            const child = Bun.spawn(argv, {
              cwd: options.cwd,
              env: { ...process.env, ...options.env },
              stdio: [...options.stdio],
            });
            return {
              stdin: child.stdin,
              stdout: child.stdout,
              exited: child.exited,
              kill: (signal) => child.kill(signal),
            };
          },
          clientInput: Bun.stdin.stream(),
          clientOutput: Bun.stdout.writer(),
          startChrome: realStartChrome,
          which: (command) => Bun.which(command),
        });
      }
      if (sub === "setup") {
        const unknown = extra.filter((arg) => arg !== "--dry-run");
        if (unknown.length > 0) {
          console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "browser setup"));
          return 2;
        }
        const apply = !extra.includes("--dry-run");
        const result = browserSetup(paths, browserDeps, { apply });
        const browserOut = createOut(currentTerminal(process.env));
        browserOut.marked([
          ...(result.changes.length > 0 ? result.changes : ["Nothing to change."]),
          ...result.info,
          ...result.notes,
          ...result.guide,
        ]);
        if (!apply) browserOut.say(dryRunEnding(["written", "run"]));
        return result.ok ? 0 : 1;
      }
      if (sub === "token") {
        const unknown = extra.filter((arg) => arg !== "--clear");
        if (unknown.length > 0) {
          console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "browser token"));
          return 2;
        }
        if (extra.includes("--clear")) {
          const removed = clearBrowserToken(paths);
          console.log(
            removed === null
              ? `  nothing to remove: there is no token file at ${paths.browserTokenFile}`
              : `- ${paths.browserTokenFile}: removed`,
          );
          return 0;
        }
        // The secret read of the prompts' one home: null where the terminal cannot hide what
        // is typed, and then a terminal is refused (the token would show), never read with echo.
        const secret = prompts?.secret ?? null;
        // The four outcomes (0 saved, 130 Ctrl+C, 1 a wrong shape, 1 a read that failed) are
        // decided in one place, `savePastedToken`, so each is tested there.
        return await savePastedToken(
          paths,
          {
            isTTY: process.stdin.isTTY === true,
            readAll: () => Bun.stdin.text(),
            ...(secret === null ? {} : { readSecret: secret }),
          },
          (line) => console.log(line),
          (line) => console.error(line),
        );
      }
      if (sub === "check") {
        if (extra.length > 0) {
          console.error(usageError(`Unknown option: ${extra.join(" ")}`, "browser check"));
          return 2;
        }
        // One real launcher (this CLI) with a real Playwright MCP, on the person's own Chrome
        // through the Playwright extension. It opens a window in the claude-code profile.
        const result = await runBrowserCheck({
          check: (name, ok, why) =>
            console.log(
              `${ok ? "✓" : "✗"} ${name}${ok || why === undefined ? "" : ` — ${why.slice(0, 400)}`}`,
            ),
          // The launcher is this CLI again, with the two flags every run of the plugin's own
          // bundles gets (the hook shim, `doctor --live`): the working folder's `.env` files and
          // its `bunfig.toml` stay out of it.
          cli: browserCheckCommand(process.execPath, process.argv[1] ?? "", pluginDir()),
          log: (line) => console.error(line),
          machine: browserDeps,
          paths,
        });
        console.log(
          result.failed === 0
            ? `\nAll ${String(result.total)} checks passed.`
            : `\n${String(result.failed)} of ${String(result.total)} checks failed.`,
        );
        return result.failed === 0 ? 0 : 1;
      }
      console.error(
        usageError(
          sub === undefined
            ? `Usage: ${COMMAND} browser <mcp|setup|token|check> [options]`
            : `Unknown browser command: ${sub}`,
          "browser",
        ),
      );
      return 2;
    }
    case "launch":
      // One session on a model path of its own, attached to this terminal (`src/cli/launch.ts`).
      // Everything after `--` is Claude Code's: the command reads its own options and no more.
      return await runLaunch(rest, launchContext(paths));
    case "sessions": {
      const parsed = parseOptions(
        rest,
        ["--id"],
        ["--open", "--dry-run", "--finished", "--remove", "--yes"],
        ["--id"],
      );
      if ("error" in parsed) {
        console.error(usageError(parsed.error, "sessions"));
        return 2;
      }
      const unknown = parsed.positionals;
      const ids = parsed.lists.get("--id") ?? [];
      if (rest.includes("--finished") && (rest.includes("--open") || rest.includes("--dry-run"))) {
        console.error(
          usageError("--finished cannot be combined with --open or --dry-run", "sessions"),
        );
        return 2;
      }
      if (
        (rest.includes("--remove") && !rest.includes("--finished")) ||
        (rest.includes("--yes") && !rest.includes("--remove"))
      ) {
        console.error(
          usageError("--remove requires --finished, and --yes requires --remove", "sessions"),
        );
        return 2;
      }
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "sessions"));
        return 2;
      }
      return await runSessions(
        paths,
        {
          dryRun: rest.includes("--dry-run"),
          open: rest.includes("--open"),
          finished: rest.includes("--finished"),
          ids,
          remove: rest.includes("--remove"),
          yes: rest.includes("--yes"),
        },
        {
          command: COMMAND,
          now: Date.now(),
          platform: process.platform,
          sleep: (ms) => Bun.sleep(ms),
          spawnDetached: (argv) => {
            const child = Bun.spawn(argv, {
              detached: true,
              stdio: ["ignore", "ignore", "ignore"],
            });
            child.unref();
            return { exited: child.exited };
          },
          uptimeSeconds: uptime(),
          which: (command) => Bun.which(command),
        },
      );
    }
    case "worktrees": {
      const removeAt = rest.indexOf("--remove");
      const removeTarget = removeAt === -1 ? null : (rest[removeAt + 1] ?? "");
      // The word after --remove is the path, whatever it looks like: an option there means the
      // path is missing (`--remove --clean` removed what --clean named, or scanned it, silently).
      if (
        removeAt !== -1 &&
        (removeTarget === null || removeTarget === "" || removeTarget.startsWith("-"))
      ) {
        console.error(
          usageError("--remove needs the path of one worktree: --remove <path>", "worktrees"),
        );
        return 2;
      }
      // The word after --remove is the path, so it is never read as an option — and with no
      // --remove, no word is a path: the first word used to slip through unchecked, and
      // `worktrees --clena` ran the scan (UX-2).
      const unknown = rest.filter(
        (arg, index) =>
          arg !== "--clean" &&
          arg !== "--json" &&
          arg !== "--no-fetch" &&
          arg !== "--remove" &&
          (removeAt === -1 || index !== removeAt + 1),
      );
      if (unknown.length > 0) {
        console.error(usageError(`Unknown option: ${unknown.join(" ")}`, "worktrees"));
        return 2;
      }
      // `--json` is the answer a page reads: it lists, and changes nothing.
      if (rest.includes("--json") && (rest.includes("--clean") || removeAt !== -1)) {
        console.error(
          usageError("--json prints the list: it takes neither --clean nor --remove", "worktrees"),
        );
        return 2;
      }
      return await runWorktrees(
        paths,
        {
          clean: rest.includes("--clean"),
          json: rest.includes("--json"),
          noFetch: rest.includes("--no-fetch"),
          remove: removeTarget,
        },
        process.env,
      );
    }
    case "claude-mem": {
      // The key comes on stdin, never as an argument (the card's own rule). On a terminal it is
      // read with no echo — the prompts' one secret read — and from a pipe or a file as it is.
      // A terminal that cannot hide what is typed throws instead: the key would be shown on screen.
      const secret = prompts?.secret ?? null;
      return await runClaudeMem(rest, {
        confirm: ask,
        out: createOut(currentTerminal(process.env)),
        paths,
        read: async () => {
          if (process.stdin.isTTY !== true) return await Bun.stdin.text();
          if (secret === null) {
            throw new Error(
              "this terminal cannot hide what you type, so the key would be shown on screen",
            );
          }
          return await secret("Paste the key for claude-mem's backend, then press Enter");
        },
      });
    }
    case "gateway":
      return runGateway(rest, gatewayContext(paths));
    case "omniroute":
      return runOmniroute(rest, omnirouteContext(paths));
    case "portal":
      return await runPortal(
        {
          bunPath: process.execPath,
          env: process.env,
          error: (line) => console.error(line),
          kill: (pid) => process.kill(pid, "SIGTERM"),
          machine: realMachine(process.env, null),
          paths,
          // The portal's bundle is copied from this command's own plugin folder, which is the
          // version Claude Code installed (the launcher runs this CLI from it).
          pluginDir: pluginDir(),
          print: (line) => console.log(line),
        },
        rest,
      );
    case "user":
      return await runUser(rest, {
        cwd: process.cwd(),
        env: process.env,
        nowMs: Date.now(),
        out: createOut(currentTerminal(process.env)),
        paths,
        print: (line) => console.log(line),
        say: (line) => console.error(line),
      });
    case "task": {
      if (rest[0] === "mcp") {
        if (rest.length !== 1) {
          console.error("task mcp takes no arguments");
          return 2;
        }
        // Keep the SDK in its own bundle: a computed import cannot be inlined by Bun.build.
        const built = join(import.meta.dir, "tasks-mcp.js");
        const entry = existsSync(built) ? built : join(import.meta.dir, "tasks-mcp.ts");
        await import(entry);
        return 0;
      }
      const { runTaskCommand } = await import("../tasks/command");
      return await runTaskCommand(rest);
    }
    case "job":
      return runJobCommand(rest, {
        paths,
        cwd: process.cwd(),
        execArgv: process.execArgv,
        say: (line) => console.error(line),
        print: (line) => console.log(line),
      });
    case "version":
    case "--version":
      console.log(`${COMMAND} ${VERSION}`);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      // `help <command>`, and `help` alone (or no command at all) prints the top-level help.
      // `--help` and `-h` are answered above, before any command runs.
      const text = helpTextFor(command === HELP_COMMAND ? [HELP_COMMAND, ...rest] : []);
      if (text === null) {
        console.error(unknownCommand(rest[0] ?? ""));
        return 2;
      }
      console.log(text);
      return 0;
    }
    default:
      console.error(unknownCommand(command));
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
